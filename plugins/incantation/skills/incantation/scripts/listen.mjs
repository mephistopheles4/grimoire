// The always-on listener (docs/spec/incantation.md, S6). Node built-ins only.
//
//   node listen.mjs start   holds the mic open until its session ends or it is stopped
//   node listen.mjs wait    prints what was heard, once a turn is waiting
//   node listen.mjs stop    stops the running listener, through its own channel
//
// It reaches the engine only through the seam (S5): playback() to mute, and
// transcribe() for each turn, in memory, on 127.0.0.1. It writes no audio and
// no heard text to any file or log. Every line it prints is fixed text, or
// the heard text a waiter asked for.

import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { captureArgs, listDevices, resolveRecorder, stampOf } from './capture/ffmpeg.mjs';
import { isEngine, loadEngine } from './engines/index.mjs';
import { Gate, HeardQueue, KNOBS, formatHeard, frameBytes, isFragment, isStopWord } from './gate.mjs';
import { checkFile, readSettings, readText, runDir, secureState, writePrivate } from './lib.mjs';

class Stop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const stop = reason => {
  throw new Stop(reason);
};

export const REASONS = ['recorder', 'device', 'mic', 'playback', 'engine', 'settings', 'state', 'session', 'stt', 'busy', 'warm', 'ended'];

const listenFile = home => join(runDir(home), 'listen.json');

// The channel's address, from listen.json, or null. Never printed.
export function readChannel(home, options = {}) {
  try {
    if (!checkFile(listenFile(home), options)) return null;
    const given = JSON.parse(readText(listenFile(home)));
    if (!Number.isInteger(given?.port) || given.port < 1 || given.port > 65535 || typeof given.token !== 'string' || !/^[0-9a-f]{64}$/.test(given.token)) return null;
    return given;
  } catch {
    return null;
  }
}

// One exchange on the channel: sends `<command> <token>`, resolves the reply
// (until the listener closes the connection), or null when nothing answers.
export function ask(channel, command, timeoutMs = 0) {
  return new Promise(resolve => {
    if (!channel) return resolve(null);
    const socket = connect({ host: '127.0.0.1', port: channel.port });
    let out = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${command} ${channel.token}\n`));
    socket.on('data', d => {
      if (out.length < 1_000_000) out += d;
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(out || null);
    });
  });
}

const sameToken = (given, token) => {
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), token);
};

// A device listing through the recorder: stdout and stderr joined, or null.
// ffmpeg prints the Windows and macOS listings on stderr, the Linux one on stdout.
export const runListing = (cwd, run = execFile) => (file, args) =>
  new Promise(resolve =>
    run(file, args, { cwd, shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && (error.code === 'ENOENT' || error.killed)) return resolve(null);
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
    }),
  );

// What `wait` may print: only lines in the listener's own grammar (S6). Any
// other line, from whatever answers on the port listen.json names, is dropped.
const WAIT_LINE = new RegExp(
  [
    '^(?:',
    'Heard(?: \\(after reply\\))?: "(?:[^"\\\\\\n]|\\\\["\\\\])*"',
    '|timing: wait \\d{1,5} stt \\d{1,6}',
    '|plays \\d{1,4}',
    '|ready \\d{1,6} voice [A-Za-z0-9-]{1,64}',
    '|dropped \\d{1,4}',
    '|stt-dropped|muted|quiet|stopped',
    `|listener error (?:${REASONS.join('|')})`,
    ')$',
  ].join(''),
);
export const waitLines = out =>
  String(out)
    .split('\n')
    .filter(l => WAIT_LINE.test(l))
    .map(l => `${l}\n`)
    .join('');

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

// The listener. Everything a test replaces comes in through `options`: the
// engine, the recorder (its listing and its spawn), the parent, a clock and
// the knobs. The command line passes only `home`. Resolves { done, stop } once
// it is listening; rejects with { reason } when it cannot start. `done`
// resolves with the reason it ended.
export async function startListener(options = {}) {
  const { home } = options;
  const platform = options.platform ?? process.platform;
  const knobs = { ...KNOBS, ...options.knobs };
  const clock = options.clock ?? (() => performance.now());
  const fsOptions = { platform };
  let finished = false;
  let finish = async () => {};

  try {
    if (typeof home !== 'string' || !home) stop('settings');
    let settings;
    try {
      settings = readSettings(home, fsOptions);
    } catch (e) {
      return stop(e.message === 'state' ? 'state' : 'settings');
    }
    if (!isEngine(settings.engine)) stop('engine');
    try {
      secureState(home, fsOptions);
    } catch {
      stop('state');
    }
    const run = runDir(home);

    // The recorder: resolved again by the platform rule, and it must be the one setup pinned.
    const recorder = options.recorder ?? {
      path: resolveRecorder({ platform, pathValue: process.env.PATH ?? process.env.Path, startDir: process.cwd() }),
      list: runListing(run),
      spawn: (file, args) => spawn(file, args, { cwd: run, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }),
    };
    if (!recorder.path || recorder.path !== settings.recorder) stop('recorder');

    // The device: the list again, and its stamp must be the one setup kept.
    const listing = await listDevices({ recorder: recorder.path, platform, run: recorder.list });
    if (listing.row < 0 || stampOf(listing.devices) !== settings.device.stamp) stop('device');
    const device = listing.devices[settings.device.index];
    if (!device) stop('device');

    // One listener at a time.
    const live = readChannel(home, fsOptions);
    if (live && (await ask(live, 'ping', 1000)) === 'alive\n') stop('busy');

    let engine;
    try {
      engine = options.engine ?? (await loadEngine(settings.engine, settings));
    } catch {
      return stop('engine');
    }
    if (!(await engine.health())) stop('engine');
    const tailMs = Math.min(Math.max(engine.tailMs ?? knobs.tailMs, 0), 1500);
    const gateKnobs = { ...knobs, tailMs };

    const gate = new Gate({ silenceMs: settings.endOfSpeechMs, knobs: gateKnobs, t: clock() });
    const queue = new HeardQueue(gateKnobs);
    const notices = new Map();
    const token = randomBytes(32);
    const parentPid = options.parentPid ?? process.ppid;
    const currentPpid = options.ppid ?? (() => process.ppid);
    const parentAlive =
      options.parentAlive ??
      (pid => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return e.code === 'EPERM';
        }
      });
    let waiter = null;
    let feed = null;
    let child = null;
    let childExited = null;
    let server;
    let quietTimer = null;
    let rateTimer = null;
    let idleTimer = null;
    let noWaiterTimer = null;
    let parentTimer = null;
    let sttMs = 0;
    let sttFails = 0;
    let transcribing = Promise.resolve();
    let playing = 0;
    let plays = 0;

    let resolveDone;
    const done = new Promise(r => (resolveDone = r));
    finish = async reason => {
      if (finished) return;
      finished = true;
      for (const t of [quietTimer, rateTimer, idleTimer, noWaiterTimer]) clearTimeout(t);
      clearInterval(parentTimer);
      queue.items = [];
      feed?.close?.();
      if (child && childExited) {
        child.kill();
        await Promise.race([childExited, new Promise(r => setTimeout(r, 2000).unref())]);
      }
      if (waiter) {
        // A stop the person asked for is no error.
        waiter.end(reason === 'stopped' ? 'stopped\n' : `listener error ${reason}\n`);
        waiter = null;
      }
      server?.close();
      server?.closeAllConnections?.();
      const mine = readChannel(home, fsOptions);
      if (mine && mine.token === token.toString('hex')) rmSync(listenFile(home), { force: true });
      resolveDone(reason);
    };

    const armNoWaiter = () => {
      clearTimeout(noWaiterTimer);
      noWaiterTimer = setTimeout(() => finish('ended'), knobs.noWaiterMs);
    };

    const serve = () => {
      if (!waiter || finished) return;
      const now = Date.now();
      if (!queue.ready(now) && !notices.size) {
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
        lines.push(`timing: wait ${settings.endOfSpeechMs} stt ${Math.round(sttMs)}`);
        // Playbacks since the last delivery, from any caller: the skill counts a
        // heard yes only when exactly one, its own say-back, came between.
        lines.push(`plays ${Math.min(plays, 9999)}`);
        plays = 0;
        dropped = taken.dropped;
        gate.delivered(clock());
      }
      if (notices.has('ready')) lines.push(notices.get('ready'));
      if (dropped) lines.push(`dropped ${dropped}`);
      for (const n of ['stt-dropped', 'muted']) if (notices.has(n)) lines.push(n);
      notices.clear();
      const w = waiter;
      waiter = null;
      clearTimeout(quietTimer);
      clearTimeout(rateTimer);
      armNoWaiter();
      w.end(`${lines.join('\n')}\n`);
    };

    const heard = turn => {
      transcribing = transcribing.then(async () => {
        if (finished) return;
        const began = clock();
        const text = await engine.transcribe(turn.pcm);
        sttMs = clock() - began;
        if (finished) return;
        if (text === null) {
          sttFails++;
          if (sttFails >= knobs.sttFailures) return finish('stt');
          notices.set('stt-dropped', true);
          return serve();
        }
        sttFails = 0;
        if (!text || isFragment(text)) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish('ended'), knobs.idleMs);
        queue.push({ text, afterReply: turn.afterReply, exempt: turn.firstAfterReply || isStopWord(text), at: Date.now() });
        serve();
      });
    };

    // A connection says `wait`, `stop` or `ping`, with the token, within 2 s,
    // or it is closed. Until then it holds no slot.
    server = createServer(socket => {
      socket.on('error', () => {});
      const idle = setTimeout(() => socket.destroy(), knobs.handshakeMs);
      let pending = '';
      const onData = d => {
        pending += d.toString('latin1');
        if (pending.length > 256) return socket.destroy();
        const nl = pending.indexOf('\n');
        if (nl < 0) return;
        socket.off('data', onData);
        clearTimeout(idle);
        const m = /^(wait|stop|ping) ([0-9a-f]{64})\r?$/.exec(pending.slice(0, nl));
        if (!m || !sameToken(m[2], token)) return socket.destroy();
        if (m[1] === 'ping') return void socket.end('alive\n');
        if (m[1] === 'stop') return void finish('stopped').then(() => socket.end('stopped\n'));
        if (waiter) return void socket.end('listener error busy\n');
        waiter = socket;
        clearTimeout(noWaiterTimer);
        socket.on('close', () => {
          if (waiter === socket) {
            waiter = null;
            clearTimeout(quietTimer);
            if (!finished) armNoWaiter();
          }
        });
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          if (waiter === socket) {
            waiter = null;
            armNoWaiter();
            socket.end('quiet\n');
          }
        }, knobs.quietMs);
        serve();
      };
      socket.on('data', onData);
      socket.once('close', () => clearTimeout(idle));
    });
    await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', res);
    });
    writePrivate(listenFile(home), JSON.stringify({ port: server.address().port, token: token.toString('hex') }), fsOptions);

    // The playback feed first: nothing is captured until it answers, so no
    // playback can begin unseen while the mic is open.
    feed = engine.playback();
    const opened = new Promise((resolve, reject) => {
      feed.once('open', resolve);
      feed.once('error', reject);
    });
    feed.on('start', () => {
      playing++;
      plays++;
      gate.playback(playing, clock());
    });
    feed.on('end', () => {
      playing = Math.max(0, playing - 1);
      gate.playback(playing, clock());
    });
    feed.on('error', () => finish('playback'));
    try {
      await withTimeout(opened, knobs.feedOpenMs);
    } catch {
      stop('playback');
    }

    // Warm in the background; `ready` goes to the next waiter.
    withTimeout(engine.warm(), knobs.warmMs).then(
      ms => {
        notices.set('ready', `ready ${ms} voice ${settings.profile}`);
        serve();
      },
      () => finish('warm'),
    );

    child = recorder.spawn(recorder.path, captureArgs(platform, listing.row, device.id));
    childExited = new Promise(r => child.once('exit', r));
    child.on('error', () => finish('recorder'));
    child.on('exit', () => finish('recorder'));
    const size = frameBytes(knobs);
    const silentFrames = Math.ceil(knobs.silentStartMs / knobs.frameMs);
    let framesSeen = 0;
    let anySound = false;
    let carry = Buffer.alloc(0);
    child.stdout.on('data', d => {
      carry = carry.length ? Buffer.concat([carry, d]) : d;
      while (carry.length >= size && !finished) {
        const frame = Buffer.from(carry.subarray(0, size));
        carry = carry.subarray(size);
        if (!anySound) {
          framesSeen++;
          if (frame.some(b => b !== 0)) anySound = true;
          else if (framesSeen >= silentFrames) return void finish('mic');
        }
        for (const e of gate.frame(frame, clock())) {
          if (e.type === 'turn') heard(e);
          else if (e.type === 'muted') {
            notices.set('muted', true);
            serve();
          }
        }
      }
    });

    parentTimer = setInterval(() => {
      if (currentPpid() !== parentPid || !parentAlive(parentPid)) finish('ended');
    }, knobs.parentPollMs);
    idleTimer = setTimeout(() => finish('ended'), knobs.idleMs);
    armNoWaiter();

    return { done, stop: reason => finish(reason ?? 'ended'), port: server.address().port };
  } catch (e) {
    await finish('settings');
    throw e instanceof Stop ? { reason: e.reason } : { reason: 'settings' };
  }
}

async function main(argv, home = homedir()) {
  const say = text => process.stdout.write(`${text}\n`);
  const command = argv[2];
  if (command === 'start') {
    let listener;
    try {
      listener = await startListener({ home });
    } catch (e) {
      return say(`listener error ${REASONS.includes(e?.reason) ? e.reason : 'settings'}`), 1;
    }
    const end = () => listener.stop('ended');
    process.on('SIGTERM', end);
    process.on('SIGINT', end);
    const reason = await listener.done;
    if (reason === 'stopped') return say('listener stopped'), 0;
    return say(`listener error ${REASONS.includes(reason) ? reason : 'ended'}`), 1;
  }
  if (command === 'wait') {
    // The first wait can start before the listener is up: look for its channel
    // for a few seconds before saying it is not running.
    let channel = readChannel(home);
    for (let i = 0; !channel && i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      channel = readChannel(home);
    }
    const out = waitLines((await ask(channel, 'wait')) ?? '');
    if (!out) return say('listener error ended'), 1;
    process.stdout.write(out);
    return /^listener error /m.test(out) ? 1 : 0;
  }
  if (command === 'stop') {
    const out = await ask(readChannel(home), 'stop', 5000);
    if (out === 'stopped\n') return say('listener stopped'), 0;
    return say('listener: not running'), 0;
  }
  say('usage: listen.mjs start | wait | stop');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code;
  try {
    code = await main(process.argv);
  } catch {
    process.stdout.write('listener error settings\n');
    code = 1;
  }
  process.exit(code);
}

export { main };
