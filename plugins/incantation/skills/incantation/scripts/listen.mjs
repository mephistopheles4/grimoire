// The always-on listener (docs/spec/incantation.md, S4.3). A Node script with
// no dependencies.
//
//   node listen.mjs start   holds the mic open until its session ends or it is stopped
//   node listen.mjs wait    prints what was heard, once a turn is waiting
//   node listen.mjs stop    signals the running listener, after checking its pid
//
// It captures with parec, watches playback with pactl, mutes while anything
// plays, cuts the audio into turns, sends each turn only to the speech-to-text
// port on 127.0.0.1, and holds the text in memory until a waiter takes it. It
// writes no audio and no heard text to any file or log. Every line it prints is
// fixed text, or the heard text a waiter asked for.

import { execFile, spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { cleanText, loopbackPorts, readGlobalSettings, runDir } from './lib.mjs';

// The listener's own numbers, in one place. Each is a starting point.
export const KNOBS = {
  frameMs: 30,
  floorMs: 1000, // how long the room's level is measured at start
  voiceDb: 10, // a frame is voice at this many dB over the floor
  minVoiceMs: 250, // a turn with less voice is dropped
  maxTurnMs: 30_000, // a longer turn is cut, and the rest goes on as the next
  tailMs: 300, // muted this long after the last playback ends (O12 may raise it, at most 1500)
  mutedAfterMs: 30_000, // a mute this long is reported once
  queueMax: 20,
  ageMs: 5 * 60_000,
  perMinute: 4,
  idleMs: 30 * 60_000,
  quietMs: 10 * 60_000,
  maxText: 500,
  sttFailures: 3,
  sttTimeoutMs: 15_000,
  sessionPollMs: 500,
  preRollFrames: 3,
};

const SAMPLE_RATE = 16_000;
const frameBytes = (knobs = KNOBS) => (SAMPLE_RATE * 2 * knobs.frameMs) / 1000;
const PULSE = 'unix:/mnt/wslg/PulseServer';
const PROGRAMS = { parec: '/usr/bin/parec', pactl: '/usr/bin/pactl' };
const STOP_WORDS = new Set(['stop', 'thats all', 'wait']);

class Stop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const stop = reason => {
  throw new Stop(reason);
};

// Heard text as a waiter prints it: control, invisible and line-separator
// characters removed, inner quotes escaped, cut at 500 characters.
export function formatHeard(text, afterReply, max = KNOBS.maxText) {
  const clean = cleanText(text, max).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Heard${afterReply ? ' (after reply)' : ''}: "${clean}"`;
}

// Does the whole turn say stop, that's all, or wait?
export function isStopWord(text) {
  return STOP_WORDS.has(String(text).toLowerCase().replace(/['’.,!?]/g, '').replace(/\s+/g, ' ').trim());
}

// The sound server's playing streams, from `pactl list sink-inputs`: the ones
// not corked.
export function countPlaying(text) {
  let n = 0;
  for (const block of String(text).split(/^Sink Input #\d+/m).slice(1)) if (/^\s*Corked:\s*no\b/im.test(block)) n++;
  return n;
}

const levelDb = buf => {
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(n, 1));
  return rms < 1 ? -100 : 20 * Math.log10(rms / 32768);
};

// Turns out of frames. Pure: time comes in with each call, so a test drives it
// with scripted frames and scripted playback, and nothing here reads a clock.
export class Gate {
  constructor({ silenceMs = 1000, knobs = KNOBS, playing = 0, t = 0 } = {}) {
    this.k = knobs;
    this.silenceMs = silenceMs;
    this.count = playing;
    this.playStart = playing > 0 ? t : null;
    this.playEnd = null;
    this.playId = playing > 0 ? 1 : 0;
    this.exemptPlay = 0;
    this.deliveredAt = -Infinity;
    this.muteStart = playing > 0 ? t : null;
    this.mutedReported = false;
    this.floor = null;
    this.calib = [];
    this.roll = [];
    this.turn = null;
  }

  muted(t) {
    return this.count > 0 || (this.playEnd !== null && t < this.playEnd + this.k.tailMs);
  }

  // The number of streams now playing, at time t.
  playback(count, t) {
    if (count > 0 && this.count === 0) {
      if (!this.muted(t)) {
        // a new mute; a restart inside the tail goes on with the one in force
        this.muteStart = t;
        this.mutedReported = false;
      }
      this.playStart = t;
      this.playId++;
      this.turn = null; // a turn open when playback starts is dropped
      this.roll = [];
    } else if (count === 0 && this.count > 0) {
      this.playEnd = t;
    }
    this.count = count;
  }

  delivered(t) {
    this.deliveredAt = t;
  }

  // One frame; returns the events it caused: { type: 'turn', ... } or { type: 'muted' }.
  frame(buf, t) {
    const k = this.k;
    const events = [];
    if (this.muted(t)) {
      if (this.muteStart === null) {
        this.muteStart = t;
        this.mutedReported = false;
      }
      if (!this.mutedReported && t - this.muteStart > k.mutedAfterMs) {
        this.mutedReported = true;
        events.push({ type: 'muted' });
      }
      return events;
    }
    this.muteStart = null;
    const level = levelDb(buf);
    if (this.floor === null) {
      this.calib.push(level);
      if (this.calib.length * k.frameMs >= k.floorMs) this.floor = this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
      return events;
    }
    const voice = level >= this.floor + k.voiceDb;
    if (!this.turn) {
      if (!voice) {
        this.floor = this.floor * 0.98 + level * 0.02;
        this.roll.push(buf);
        if (this.roll.length > k.preRollFrames) this.roll.shift();
        return events;
      }
      const afterReply = this.playStart !== null && this.playEnd !== null && this.playStart > this.deliveredAt && this.playEnd + k.tailMs <= t;
      this.turn = { frames: [...this.roll, buf], voice: 1, silent: 0, afterReply, playId: this.playId };
      this.roll = [];
    } else {
      this.turn.frames.push(buf);
      if (voice) {
        this.turn.voice++;
        this.turn.silent = 0;
      } else {
        this.turn.silent++;
        this.floor = this.floor * 0.98 + level * 0.02;
      }
    }
    const turn = this.turn;
    const length = turn.frames.length * k.frameMs;
    if (turn.silent * k.frameMs >= this.silenceMs || length >= k.maxTurnMs) {
      this.turn = null;
      if (turn.voice * k.frameMs >= k.minVoiceMs) {
        const keep = turn.frames.length - Math.max(0, turn.silent - 10);
        let first = false;
        if (turn.afterReply && this.exemptPlay !== turn.playId) {
          first = true;
          this.exemptPlay = turn.playId;
        }
        events.push({ type: 'turn', pcm: Buffer.concat(turn.frames.slice(0, keep)), afterReply: turn.afterReply, firstAfterReply: first, silenceMs: this.silenceMs });
      }
    }
    return events;
  }
}

// Heard text waiting for a waiter: at most 20 turns, none older than 5 minutes,
// deliveries held to 4 a minute except for the turns that are never held.
export class HeardQueue {
  constructor(knobs = KNOBS) {
    this.k = knobs;
    this.items = [];
    this.dropped = 0;
    this.deliveries = [];
  }

  push(item) {
    this.items.push(item);
    while (this.items.length > this.k.queueMax) {
      this.items.shift();
      this.dropped++;
    }
  }

  age(now) {
    const before = this.items.length;
    this.items = this.items.filter(i => now - i.at <= this.k.ageMs);
    this.dropped += before - this.items.length;
  }

  held(now) {
    this.deliveries = this.deliveries.filter(d => now - d < 60_000);
    return this.deliveries.length >= this.k.perMinute;
  }

  // Can a delivery go now? A turn that is never held lets the whole queue go.
  ready(now) {
    this.age(now);
    if (!this.items.length) return false;
    return this.items.some(i => i.exempt) || !this.held(now);
  }

  // When the cap lifts, for a waiter that is waiting on it; null when it is not the cap.
  nextAt(now) {
    this.age(now);
    if (!this.items.length || !this.held(now)) return null;
    return Math.min(...this.deliveries) + 60_000;
  }

  take(now) {
    const exempt = this.items.some(i => i.exempt);
    const turns = this.items;
    const dropped = this.dropped;
    this.items = [];
    this.dropped = 0;
    if (!exempt) this.deliveries.push(now);
    return { turns, dropped };
  }
}

// The Claude Code process this one runs under: the nearest ancestor whose
// executable or first argument has the base name `claude`. Read from /proc, or
// from a fixture tree for a test. Returns { pid, start } or null.
export function procStat(pid, procRoot = '/proc') {
  const text = readFileSync(join(procRoot, String(pid), 'stat'), 'utf8');
  const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
  return { ppid: Number(rest[1]), start: rest[19] };
}

export function findClaudeAncestor(pid = process.pid, procRoot = '/proc') {
  let current;
  try {
    current = procStat(pid, procRoot).ppid;
  } catch {
    return null;
  }
  for (let depth = 0; depth < 64 && current > 1; depth++) {
    try {
      const argv0 = readFileSync(join(procRoot, String(current), 'cmdline'), 'utf8').split('\0')[0];
      let exe = '';
      try {
        exe = readlinkSync(join(procRoot, String(current), 'exe'));
      } catch {
        exe = '';
      }
      if (basename(argv0) === 'claude' || basename(exe) === 'claude') {
        const { start } = procStat(current, procRoot);
        return { pid: current, start };
      }
      current = procStat(current, procRoot).ppid;
    } catch {
      return null;
    }
  }
  return null;
}

// The program resolver: a link is followed only when it is owned by `owner`
// (root) and sits in a folder `owner` owns and no group or other account can
// write; the target must sit in `binDir`, be owned by `owner` and not be
// writable by any group or other account. Returns the path to run, or throws.
export function resolveProgram(path, { owner = 0, binDir = '/usr/bin' } = {}) {
  if (!isAbsolute(path)) throw new Error('programs');
  const closed = st => st.uid === owner && (st.mode & 0o022) === 0;
  let current = path;
  for (let hops = 0; hops < 8; hops++) {
    const st = lstatSync(current);
    const folder = lstatSync(dirname(current));
    if (st.isSymbolicLink()) {
      if (st.uid !== owner || !folder.isDirectory() || !closed(folder)) throw new Error('programs');
      current = resolve(dirname(current), readlinkSync(current));
      continue;
    }
    if (!st.isFile() || !closed(st) || dirname(current) !== binDir || !closed(folder)) throw new Error('programs');
    return path;
  }
  throw new Error('programs');
}

const wavHeader = bytes => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
};

// One turn's audio to the proxy, as a WAV in memory: { text } or null when the
// proxy does not answer with text.
function transcribe(port, pcm, timeoutMs) {
  const boundary = `----incantation${Math.random().toString(16).slice(2)}`;
  const part = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="turn.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    wavHeader(pcm.length),
    pcm,
    Buffer.from('\r\n'),
    part('model', 'whisper-1'),
    part('response_format', 'json'),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return new Promise(resolveText => {
    const req = request(
      { host: '127.0.0.1', port, path: '/v1/audio/transcriptions', method: 'POST', agent: false, timeout: timeoutMs, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': body.length, host: `127.0.0.1:${port}`, accept: 'application/json' } },
      res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => {
          size += c.length;
          if (size < 1_000_000) chunks.push(c);
        });
        res.on('end', () => {
          try {
            const text = JSON.parse(Buffer.concat(chunks).toString('utf8')).text;
            resolveText(res.statusCode === 200 && typeof text === 'string' ? { text } : null);
          } catch {
            resolveText(null);
          }
        });
        res.on('error', () => resolveText(null));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolveText(null));
    req.end(body);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The listener. Everything a test replaces comes in through `options`: the two
// programs and the trust rule for them, a /proc root, the session, a clock and
// the knobs. The command line passes only `home`.
//
// Resolves { done, stop } once it is listening; rejects with { reason } when it
// cannot start. `done` resolves with the reason it ended.
export async function startListener(options = {}) {
  const { home } = options;
  const knobs = { ...KNOBS, ...options.knobs };
  const clock = options.clock ?? (() => performance.now());
  const procRoot = options.procRoot ?? '/proc';
  let finished = false;
  let finish = () => {};

  try {
    if (typeof home !== 'string' || !home) stop('settings');
    let settings;
    try {
      settings = readGlobalSettings(home);
    } catch {
      return stop('settings');
    }
    const ports = loopbackPorts(settings.get('VOICEMODE_STT_BASE_URLS'));
    if (!ports) stop('settings');
    const sttPort = ports[0];
    const rawSilence = settings.get('VOICEMODE_SILENCE_THRESHOLD_MS');
    const silenceMs = rawSilence === undefined || rawSilence === '' ? 1000 : Number(rawSilence);
    if (!Number.isFinite(silenceMs) || silenceMs < knobs.frameMs || silenceMs > 10_000) stop('settings');

    const programs = { ...PROGRAMS, ...options.programs };
    try {
      for (const name of ['parec', 'pactl']) resolveProgram(programs[name], options.trust);
    } catch {
      stop('programs');
    }

    const session = options.session ?? findClaudeAncestor(process.pid, procRoot);
    if (!session) stop('session');

    const run = runDir(home);
    mkdirSync(run, { recursive: true, mode: 0o700 });
    chmodSync(dirname(run), 0o700);
    chmodSync(run, 0o700);
    const sockPath = join(run, 'listen.sock');
    if (await new Promise(r => {
      const probe = connect(sockPath);
      probe.once('connect', () => (probe.destroy(), r(true)));
      probe.once('error', () => r(false));
    })) stop('busy');
    rmSync(sockPath, { force: true });

    const env = { HOME: home, LANG: 'C', PULSE_SERVER: PULSE };
    const execOpts = { cwd: run, env, timeout: 3000, windowsHide: true, maxBuffer: 1_000_000 };
    const listStreams = () => new Promise((res, rej) => execFile(programs.pactl, ['list', 'sink-inputs'], execOpts, (e, out) => (e ? rej(e) : res(countPlaying(out)))));
    let initial;
    try {
      initial = await listStreams();
    } catch {
      stop('playback');
    }

    const gate = new Gate({ silenceMs, knobs, playing: initial, t: clock() });
    const queue = new HeardQueue(knobs);
    const notices = new Set();
    const children = [];
    let waiter = null;
    let quietTimer = null;
    let sessionTimer = null;
    let rateTimer = null;
    let idleTimer = null;
    let sttMs = 0;
    let sttFails = 0;
    let transcribing = Promise.resolve();
    let server;

    const done = new Promise(resolveDone => {
      finish = reason => {
        if (finished) return;
        finished = true;
        clearInterval(sessionTimer);
        clearTimeout(quietTimer);
        clearTimeout(rateTimer);
        clearTimeout(idleTimer);
        for (const c of children) c.kill('SIGTERM');
        queue.items = [];
        if (waiter) {
          waiter.end(`listener error ${reason}\n`);
          waiter = null;
        }
        server?.close();
        server?.closeAllConnections?.();
        rmSync(sockPath, { force: true });
        try {
          if (JSON.parse(readFileSync(join(run, 'listen.pid'), 'utf8')).pid === process.pid) rmSync(join(run, 'listen.pid'), { force: true });
        } catch {
          // already gone
        }
        resolveDone(reason);
      };
    });

    const serve = () => {
      if (!waiter || finished) return;
      const now = Date.now();
      const noticesReady = notices.size > 0;
      if (!queue.ready(now) && !noticesReady) {
        clearTimeout(rateTimer);
        const at = queue.nextAt(now);
        if (at !== null) rateTimer = setTimeout(serve, Math.max(at - now, 0) + 5);
        return;
      }
      const lines = [];
      let dropped = 0;
      if (queue.ready(now)) {
        const taken = queue.take(now);
        for (const t of taken.turns) lines.push(formatHeard(t.text, t.afterReply, knobs.maxText));
        lines.push(`timing: wait ${silenceMs} stt ${Math.round(sttMs)}`);
        dropped = taken.dropped;
        gate.delivered(clock());
      }
      if (dropped) lines.push(`dropped ${dropped}`);
      for (const n of ['stt-dropped', 'muted']) if (notices.delete(n)) lines.push(n);
      const w = waiter;
      waiter = null;
      clearTimeout(quietTimer);
      clearTimeout(rateTimer);
      w.end(`${lines.join('\n')}\n`);
    };

    const heard = turn => {
      transcribing = transcribing.then(async () => {
        if (finished) return;
        const began = clock();
        const answer = await transcribe(sttPort, turn.pcm, knobs.sttTimeoutMs);
        sttMs = clock() - began;
        if (finished) return;
        if (!answer) {
          sttFails++;
          if (sttFails >= knobs.sttFailures) return finish('stt');
          notices.add('stt-dropped');
          return serve();
        }
        sttFails = 0;
        const text = answer.text.trim();
        if (!text) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish('ended'), knobs.idleMs);
        queue.push({ text, afterReply: turn.afterReply, exempt: turn.firstAfterReply || isStopWord(text), at: Date.now() });
        serve();
      });
    };

    // A connection is a waiter only once it says `wait`: a start that probes
    // the socket to see whether it answers is not one, and is let go.
    server = createServer(socket => {
      socket.on('error', () => {});
      const idle = setTimeout(() => socket.destroy(), 2000);
      socket.once('close', () => clearTimeout(idle));
      socket.once('data', first => {
        clearTimeout(idle);
        if (!/^wait\b/.test(first.toString('latin1'))) return socket.destroy();
        if (waiter) return void socket.end('listener error busy\n');
        waiter = socket;
        socket.on('close', () => {
          if (waiter === socket) {
            waiter = null;
            clearTimeout(quietTimer);
          }
        });
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          if (waiter === socket) {
            waiter = null;
            socket.end('quiet\n');
          }
        }, knobs.quietMs);
        serve();
      });
    });
    await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(sockPath, res);
    });
    chmodSync(sockPath, 0o600);
    writeFileSync(join(run, 'listen.pid'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });

    // The playback watch first: nothing is captured until the mute state is known.
    let refreshing = false;
    let again = false;
    const refresh = async () => {
      if (refreshing) return void (again = true);
      refreshing = true;
      try {
        do {
          again = false;
          gate.playback(await listStreams(), clock());
        } while (again);
      } catch {
        finish('playback');
      }
      refreshing = false;
    };
    const watcher = spawn(programs.pactl, ['subscribe'], { cwd: run, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    children.push(watcher);
    watcher.on('error', () => finish('playback'));
    watcher.on('exit', () => finish('playback'));
    let pending = '';
    watcher.stdout.on('data', d => {
      pending += d.toString('latin1');
      const lines = pending.split('\n');
      pending = lines.pop().slice(-200);
      if (lines.some(l => /sink-input/.test(l))) refresh();
    });

    const recorder = spawn(programs.parec, ['--format=s16le', `--rate=${SAMPLE_RATE}`, '--channels=1'], { cwd: run, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    children.push(recorder);
    recorder.on('error', () => finish('recorder'));
    recorder.on('exit', () => finish('recorder'));
    const size = frameBytes(knobs);
    let carry = Buffer.alloc(0);
    recorder.stdout.on('data', d => {
      carry = carry.length ? Buffer.concat([carry, d]) : d;
      while (carry.length >= size) {
        const frame = Buffer.from(carry.subarray(0, size));
        carry = carry.subarray(size);
        for (const e of gate.frame(frame, clock())) {
          if (e.type === 'turn') heard(e);
          else if (e.type === 'muted') {
            notices.add('muted');
            serve();
          }
        }
      }
    });

    sessionTimer = setInterval(() => {
      try {
        if (procStat(session.pid, procRoot).start !== session.start) finish('ended');
      } catch {
        finish('ended');
      }
    }, knobs.sessionPollMs);
    idleTimer = setTimeout(() => finish('ended'), knobs.idleMs);

    return { done, stop: reason => finish(reason ?? 'ended') };
  } catch (e) {
    finish();
    throw e instanceof Stop ? { reason: e.reason } : { reason: 'settings' };
  }
}

// The pid of a running listen.mjs owned by this person, or null.
function runningListener(home) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(join(runDir(home), 'listen.pid'), 'utf8')).pid;
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!cmd.some(part => /(^|[\\/])listen\.mjs$/.test(part))) return null;
    if (statSync(`/proc/${pid}`).uid !== process.getuid()) return null;
  } catch {
    return null;
  }
  return pid;
}

async function main(argv) {
  const home = homedir();
  const say = text => process.stdout.write(`${text}\n`);
  const command = argv[2];
  if (command === 'start') {
    let listener;
    try {
      listener = await startListener({ home });
    } catch (e) {
      return say(`listener error ${typeof e?.reason === 'string' ? e.reason : 'settings'}`), 1;
    }
    const end = () => listener.stop('ended');
    process.on('SIGTERM', end);
    process.on('SIGINT', end);
    const reason = await listener.done;
    return say(`listener error ${reason}`), 1;
  }
  if (command === 'wait') {
    return new Promise(resolveCode => {
      const socket = connect(join(runDir(home), 'listen.sock'));
      let out = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write('wait\n'));
      socket.on('data', d => (out += d));
      socket.on('error', () => resolveCode((say('listener error ended'), 1)));
      socket.on('close', () => {
        if (!out) return resolveCode((say('listener error ended'), 1));
        process.stdout.write(out);
        resolveCode(/^listener error /m.test(out) ? 1 : 0);
      });
    });
  }
  if (command === 'stop') {
    const pid = runningListener(home);
    if (!pid) return say('listener: not running'), 0;
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      try {
        process.kill(pid, 0);
        if (/^\d+ \([^)]*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) break;
      } catch {
        break;
      }
    }
    return say('listener stopped'), 0;
  }
  say('usage: listen.mjs start | wait | stop');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv);
  process.exit(code);
}
