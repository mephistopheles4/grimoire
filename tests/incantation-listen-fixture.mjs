// The rig the two listener test files share: a fake engine, a fake recorder
// and a fake player, passed in through startListener's options. Tones and
// silence only, never recorded speech, and made-up device listings.

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { fileURLToPath } from 'node:url';
import { SPINNERS, ask, readChannel, say, startListener } from '../skills/incantation/scripts/listen.mjs';
import { runDir, ensureState, settingsPath, writeWhole } from '../skills/incantation/scripts/lib.mjs';

export const LISTEN = fileURLToPath(new URL('../skills/incantation/scripts/listen.mjs', import.meta.url));

export const RECORDER = process.platform === 'win32' ? 'C:\\fake\\bin\\ffmpeg.exe' : '/fake/bin/ffmpeg';
// A made-up listing in the Windows format; the Linux and macOS rows read their own.
const LISTINGS = {
  win32: '[in#0 @ 0000] "Desk Mic One" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP}\\wave_{0001}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog [Desk Mic One]\n',
};
const listing = LISTINGS[process.platform] ?? LISTINGS.linux;
// A listing with nothing but a device that records what plays: never opened as a mic (S5.5).
export const LOOPBACK_ONLY = {
  win32: '[in#0 @ 0000] "Stereo Mix (Made Up)" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{LOOP}\\wave_{0002}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] BlackHole 2ch\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog-stereo.monitor [Monitor of Made Up Speakers]\n',
};
export const PARSED = { win32: [{ name: 'Desk Mic One', id: '@device_cm_{MADEUP}\\wave_{0001}' }], darwin: [{ name: 'Desk Mic One', id: ':0' }], linux: [{ name: 'Desk Mic One', id: 'made_up_source.analog' }] };
const STAMP = stampOf(PARSED[process.platform] ?? PARSED.linux);

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};

export function makeHome(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  ensureState(home);
  const settings = { engine: 'sherpa', profile: 'everly', device: { index: 0, stamp: STAMP }, recorder: RECORDER, endOfSpeechMs: 300, ...overrides };
  writeWhole(settingsPath(home), JSON.stringify(settings));
  return home;
}

export function fakeEngine({ text = 'hello there', warm = async () => 42, health = true, synth } = {}) {
  const engine = {
    calls: 0,
    spun: 0, // spinner words asked for; they are kept out of `synthesized`
    synthesized: [],
    wav: Buffer.from('RIFF-made-up-audio'),
    // The ten spinner words are made once after ready (S5.2); each is its own small buffer, and none is a reply.
    synthesize: async text => {
      if (SPINNERS.includes(text)) {
        engine.spun++;
        return Buffer.from(`RIFF-spin-${text}`);
      }
      engine.synthesized.push(text);
      return synth === undefined ? engine.wav : typeof synth === 'function' ? synth(text) : synth;
    },
    tailMs: 300,
    health: async () => health,
    warm,
    transcribe: async () => {
      engine.calls++;
      return typeof text === 'function' ? text() : text;
    },
  };
  return engine;
}

// A player the test drives: each play is a handle that ends when the test says so.
// A spinner word is not a reply: it is kept apart in `spinners`, and ends by itself after a moment, as a short clip does.
export function fakePlayer({ available = true, spinnerMs = 20 } = {}) {
  const p = { available, plays: [], spinners: [], stops: 0 };
  p.play = wav => {
    if (!available) return null;
    let resolve;
    const done = new Promise(r => (resolve = r));
    const h = { wav, done, stopped: false, ended: false, end: outcome => resolve(outcome ?? 'ended'), stop: () => ((h.stopped = true), p.stops++, resolve('killed')) };
    done.then(() => (h.ended = true));
    if (Buffer.isBuffer(wav) && wav.toString().startsWith('RIFF-spin-')) {
      h.word = wav.toString().slice('RIFF-spin-'.length);
      h.stop = () => ((h.stopped = true), resolve('killed'));
      p.spinners.push(h);
      setTimeout(() => h.end(), spinnerMs);
      return h;
    }
    p.plays.push(h);
    return h;
  };
  return p;
}

export function fakeRecorder({ path = RECORDER, list = listing } = {}) {
  const r = { path, spawned: [], killed: false, exited: false, listed: 0 };
  r.list = async () => (r.listed++, list);
  r.spawn = (file, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    // The recorder takes a moment to exit, so a stop that does not wait for it shows.
    child.kill = signal => {
      r.killed = true;
      r.signals = [...(r.signals ?? []), signal];
      setTimeout(() => {
        r.exited = true;
        child.emit('exit', 0);
      }, 40);
    };
    r.child = child;
    r.spawned.push({ file, args });
    return child;
  };
  return r;
}

// A clock the test moves: each pushed frame is 30 ms.
export function rig(options = {}) {
  const home = options.home ?? makeHome(options.settings);
  const engine = options.engine ?? fakeEngine(options.engineOptions);
  const recorder = options.recorder ?? fakeRecorder();
  const player = options.player ?? fakePlayer();
  const r = { home, engine, recorder, player, t: 0 };
  r.start = () =>
    startListener({
      home,
      engine,
      recorder,
      player,
      clock: () => r.t,
      parentPid: options.parentPid ?? 1234,
      ppid: options.ppid ?? (() => 1234),
      parentAlive: options.parentAlive ?? (() => true),
      knobs: { parentPollMs: 20, handshakeMs: 200, joinMs: 0, ...options.knobs },
    });
  r.push = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      recorder.child.stdout.write(frame(amp));
      r.t += 30;
    }
  };
  r.turn = () => {
    r.push(1000, 34); // the room's level
    r.push(3163, 15); // voice, 10 dB over it
    r.push(1000, 15); // the end of the turn
  };
  r.cleanup = () => rmSync(home, { recursive: true, force: true });
  return r;
}

export const wait = home => ask(readChannel(home), 'wait', 5000);
export const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

// Polls `check` every 10 ms until it returns a truthy value, and returns it.
// `check` may be async; `until` awaits it. A throw counts as not yet. On
// reaching `ms` milliseconds it calls `check` once more, and only if that is
// falsy too does it fail with `what` and the last error, if there was one.
// `ms` has no default.
export async function until(check, what, ms) {
  const end = performance.now() + ms;
  let failed;
  for (;;) {
    const last = performance.now() >= end;
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      failed = e;
    }
    if (last) throw new Error(`not within ${ms} ms: ${what}${failed ? ` (last error: ${failed.message})` : ''}`, { cause: failed });
    await tick(Math.max(Math.min(end - performance.now(), 10), 0));
  }
}

// The promise's value, or `late` once `ms` has passed. The limit's timer is
// cleared when the race settles, so it keeps no test file alive.
export async function within(promise, ms, late) {
  let timer;
  const limit = new Promise(r => {
    timer = setTimeout(() => r(late), ms);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

export const statusOf = home => readFileSync(join(runDir(home), 'status'), 'utf8').trim();
export const texts = (...list) => () => list.shift() ?? 'hello there';
export const cli = (home, command) => ask(readChannel(home), command, 3000);
export const spoken = (r, text) => say(readChannel(r.home), text, 3000);
