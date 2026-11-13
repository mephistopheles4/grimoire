// Tests of listen.mjs (docs/spec/incantation.md, S6; claims 4, 6, 8, 10, 11
// and 12). Everything runs on a fake engine and a fake recorder passed in
// through startListener's options: tones and silence only, never recorded
// speech, and made-up device listings. The same tests run on every platform.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { stampOf } from '../plugins/incantation/skills/incantation/scripts/capture/ffmpeg.mjs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ask, readChannel, runListing, startListener, waitLines } from '../plugins/incantation/skills/incantation/scripts/listen.mjs';

const LISTEN = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/listen.mjs', import.meta.url));
import { runDir, secureState, settingsPath, writePrivate } from '../plugins/incantation/skills/incantation/scripts/lib.mjs';

const RECORDER = process.platform === 'win32' ? 'C:\\fake\\bin\\ffmpeg.exe' : '/fake/bin/ffmpeg';
// A made-up listing in the Windows format; the Linux and macOS rows read their own.
const LISTINGS = {
  win32: '[in#0 @ 0000] "Desk Mic One" (audio)\n[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP}\\wave_{0001}"\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n',
  linux: 'Auto-detected sources for pulse:\n* made_up_source.analog [Desk Mic One]\n',
};
const listing = LISTINGS[process.platform] ?? LISTINGS.linux;
const PARSED = { win32: [{ name: 'Desk Mic One', id: '@device_cm_{MADEUP}\\wave_{0001}' }], darwin: [{ name: 'Desk Mic One', id: ':0' }], linux: [{ name: 'Desk Mic One', id: 'made_up_source.analog' }] };
const STAMP = stampOf(PARSED[process.platform] ?? PARSED.linux);

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};

function makeHome(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  secureState(home);
  const settings = { engine: 'voicebox', port: 17493, profile: 'made-up-profile', device: { index: 0, stamp: STAMP }, recorder: RECORDER, endOfSpeechMs: 300, ...overrides };
  writePrivate(settingsPath(home), JSON.stringify(settings));
  return home;
}

function fakeEngine({ text = 'hello there', warm = async () => 42, health = true } = {}) {
  const feed = new EventEmitter();
  feed.close = () => {};
  const engine = {
    calls: 0,
    cancelled: [],
    cancel: async id => (engine.cancelled.push(id), true),
    feed,
    tailMs: 300,
    health: async () => health,
    warm,
    transcribe: async () => {
      engine.calls++;
      return typeof text === 'function' ? text() : text;
    },
    playback: () => (setImmediate(() => feed.emit('open')), feed),
  };
  return engine;
}

function fakeRecorder({ path = RECORDER, list = listing } = {}) {
  const r = { path, spawned: [], killed: false, exited: false, listed: 0 };
  r.list = async () => (r.listed++, list);
  r.spawn = (file, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    // The recorder takes a moment to exit, so a stop that does not wait for it shows.
    child.kill = () => {
      r.killed = true;
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
function rig(options = {}) {
  const home = options.home ?? makeHome(options.settings);
  const engine = options.engine ?? fakeEngine(options.engineOptions);
  const recorder = options.recorder ?? fakeRecorder();
  const r = { home, engine, recorder, t: 0 };
  r.start = () =>
    startListener({
      home,
      engine,
      recorder,
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

const wait = home => ask(readChannel(home), 'wait', 5000);
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

test('a turn goes through the engine and a waiter is told what was heard, with the timing and the ready line', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await tick();
  r.turn();
  await tick(80); // the turn is queued before the wait asks
  const out = await wait(r.home);
  assert.match(out, /^Heard: "hello there"$/m);
  assert.match(out, /^timing: wait 300 stt \d+$/m);
  assert.match(out, /^ready 42 voice made-up-profile$/m);
  assert.equal(r.engine.calls, 1);
  assert.deepEqual(r.recorder.spawned[0].file, RECORDER);
});

test('T5: a turn the engine hears as a lone "you" or "Thank you." never reaches a waiter', async t => {
  for (const text of ['you', 'Thank you.']) {
    const r = rig({ engineOptions: { text }, knobs: { quietMs: 200 } });
    const l = await r.start();
    assert.match(await wait(r.home), /^ready /m);
    await tick();
    r.turn();
    const out = await wait(r.home);
    assert.equal(out, 'quiet\n', text);
    assert.equal(r.engine.calls, 1, 'it was transcribed, then dropped');
    await l.stop();
    r.cleanup();
  }
});

const statusOf = home => readFileSync(join(runDir(home), 'status'), 'utf8').trim();
const texts = (...list) => () => list.shift() ?? 'hello there';
const cli = (home, command) => ask(readChannel(home), command, 3000);

test('T8 and T11: the mic stays open while a reply plays; a person talking over it cuts it off, the session is told, and the turn is heard as a reply', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.push(1000, 34);
  r.engine.feed.emit('start', { at: 0, id: 'gen-7' }); // a reply, from any caller
  r.push(3163, 11);
  assert.deepEqual(r.engine.cancelled, [], 'a cough is not a barge-in');
  const interrupted = wait(r.home);
  r.push(3163, 5);
  assert.equal(await interrupted, 'interrupted\n');
  assert.deepEqual(r.engine.cancelled, ['gen-7']);
  r.push(1000, 15);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "hello there"$/m);
  assert.equal(r.engine.calls, 1);
  r.engine.feed.emit('end', { at: 0, id: 'gen-7' }); // an end after the cut is harmless
});

test('T11: only the person mutes: a spoken mute, then nothing reaches the session until a spoken unmute; the mic stays open', async t => {
  const r = rig({ engineOptions: { text: texts('Mute.', 'do not hear this', 'Unmute.', 'hello there') } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await tick();
  r.turn();
  const first = await wait(r.home);
  assert.match(first, /^mic-muted$/m);
  assert.doesNotMatch(first, /Mute/, 'the mute word is the listener\'s, not heard text');
  assert.equal(statusOf(r.home), 'muted');
  r.turn();
  await tick(60);
  assert.equal(r.engine.calls, 2, 'a muted turn is still transcribed here, only to catch unmute');
  r.turn();
  const second = await wait(r.home);
  assert.match(second, /^mic-unmuted$/m);
  assert.doesNotMatch(second, /Heard/, 'nothing said while muted reaches the session');
  assert.notEqual(statusOf(r.home), 'muted');
  r.turn();
  assert.match(await wait(r.home), /^Heard: "hello there"$/m);
});

test('T11: the mute and unmute commands work through the channel, are the person\'s alone to give, and the status word follows', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'status'), 'listening\n');
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  assert.equal(await cli(r.home, 'status'), 'muted\n');
  r.turn();
  await tick(60);
  assert.equal(r.engine.calls, 1, 'transcribed locally only for the unmute word');
  assert.equal(await cli(r.home, 'unmute'), 'mic-unmuted\n');
  assert.equal(await ask({ ...readChannel(r.home), token: '0'.repeat(64) }, 'mute', 1000), null, 'no mute without the token');
  assert.equal(await cli(r.home, 'status'), 'listening\n');
});

test('T9: the status file holds one word, listening, hearing, speaking or muted, and goes when the listener does', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(statusOf(r.home), 'listening');
  r.push(1000, 34);
  r.push(3163, 3);
  assert.equal(statusOf(r.home), 'hearing');
  r.push(1000, 15);
  r.engine.feed.emit('start', { at: 0 });
  assert.equal(statusOf(r.home), 'speaking');
  r.engine.feed.emit('end', { at: 0 });
  assert.notEqual(statusOf(r.home), 'speaking');
  if (process.platform !== 'win32') assert.equal(statSync(join(runDir(r.home), 'status')).mode & 0o777, 0o600);
  await l.stop();
  assert.equal(existsSync(join(runDir(r.home), 'status')), false);
});

test('T9: a second start that is refused as busy leaves the first listener\'s status file alone', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await assert.rejects(rig({ home: r.home }).start(), { reason: 'busy' });
  assert.equal(statusOf(r.home), 'listening');
});

test('T12: idle returns only once no reply is playing, and gives up after the idle wait', async t => {
  const r = rig({ knobs: { idleWaitMs: 900 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.equal(await cli(r.home, 'idle'), 'idle\n', 'nothing playing: at once');
  r.engine.feed.emit('start', { at: 0, id: 'gen-1' });
  let settled = false;
  const pending = cli(r.home, 'idle').then(v => ((settled = true), v));
  await tick(150);
  assert.equal(settled, false, 'held while a reply plays');
  r.engine.feed.emit('end', { at: 0, id: 'gen-1' });
  await tick(100);
  assert.equal(settled, false, 'and for the tail after it');
  assert.equal(await pending, 'idle\n');
  r.engine.feed.emit('start', { at: 0 });
  assert.equal(await cli(r.home, 'idle'), 'idle-timeout\n', 'a reply that never ends does not hold the session for ever');
});

test('T10: a turn cut at a breath is joined to the next; one that is left hanging goes on its own after the join wait', async t => {
  const r = rig({ engineOptions: { text: texts('and then rename the', 'parse helper, please.', 'so I was thinking') }, knobs: { joinMs: 150 } });
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  r.turn();
  await tick(40);
  r.turn();
  const joined = await wait(r.home);
  assert.match(joined, /^Heard: "and then rename the parse helper, please\."$/m);
  r.turn();
  const hung = await wait(r.home);
  assert.match(hung, /^Heard: "so I was thinking"$/m);
});

test('T13: a second wait while one is live says a wait is already running, and does not end the listener', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.match(await wait(r.home), /^ready /m);
  const first = wait(r.home);
  await tick(50);
  assert.equal(await wait(r.home), 'listener error waiting\n');
  assert.equal(await cli(r.home, 'ping'), 'alive\n');
  await l.stop();
  await first;
});

test('a feed that fails ends the listener with playback, capturing nothing more', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  r.engine.feed.emit('error', new Error('x'));
  assert.equal(await l.done, 'playback');
  assert.equal(r.recorder.killed, true);
});

test('three seconds of all-zero frames at start end it with mic', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  r.push(0, 101);
  assert.equal(await l.done, 'mic');
});

test('a warm that fails or takes too long ends it with warm', async t => {
  for (const warm of [async () => Promise.reject(new Error('x')), () => new Promise(() => {})]) {
    const r = rig({ engineOptions: { warm }, knobs: { warmMs: 50 } });
    const l = await r.start();
    assert.equal(await l.done, 'warm');
    r.cleanup();
  }
  t.diagnostic('both ended with warm');
});

test('the channel binds 127.0.0.1 only and listen.json holds no more than the port and token', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const channel = readChannel(r.home);
  assert.deepEqual(Object.keys(channel).sort(), ['port', 'token']);
  const other = Object.values(networkInterfaces()).flat().find(a => a && !a.internal && a.family === 'IPv4');
  if (other) {
    const refused = await new Promise(res => {
      const s = connect({ host: other.address, port: channel.port });
      s.on('connect', () => (s.destroy(), res(false)));
      s.on('error', () => res(true));
    });
    assert.equal(refused, true, 'not reachable on a non-loopback address');
  } else t.diagnostic('no non-loopback IPv4 address on this runner');
  if (process.platform !== 'win32') assert.equal(statSync(join(runDir(r.home), 'listen.json')).mode & 0o777, 0o600);
});

test('no token, a wrong token, or none within the handshake is closed and holds no slot; a second waiter is busy', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  const channel = readChannel(r.home);
  assert.equal(await ask({ ...channel, token: '0'.repeat(64) }, 'wait', 1000), null);
  assert.equal(await ask({ port: channel.port, token: '' }, 'wait', 1000), null);
  const silent = await new Promise(res => {
    const s = connect({ host: '127.0.0.1', port: channel.port });
    s.on('close', () => res(true));
    s.on('error', () => {});
  });
  assert.equal(silent, true, 'closed after the handshake time');
  assert.match(await wait(r.home), /^ready /m, 'the ready line goes to the first waiter');
  const first = ask(channel, 'wait', 3000);
  await tick(50);
  assert.equal(await ask(channel, 'wait', 1000), 'listener error waiting\n', 'T13: it says a wait is already running');
  l.stop();
  await first;
});

test('ping answers alive, never the token, and takes no queued turn; a second start is busy and leaves the first running', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  await tick();
  r.turn();
  await tick(50);
  const channel = readChannel(r.home);
  const pong = await ask(channel, 'ping', 1000);
  assert.equal(pong, 'alive\n');
  assert.ok(!pong.includes(channel.token));
  await assert.rejects(rig({ home: r.home }).start(), { reason: 'busy' });
  assert.match(await wait(r.home), /^Heard: "hello there"$/m, 'the turn is still there');
});

test('stop reaches the listener only through the channel; its recorder has exited and listen.json is gone', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.match(await wait(r.home), /^ready /m);
  const waiting = wait(r.home);
  await tick(50);
  assert.equal(await ask(readChannel(r.home), 'stop', 3000), 'stopped\n');
  assert.equal(await waiting, 'stopped\n', 'a waiter is told of a stop the person asked for, not an error');
  assert.equal(r.recorder.exited, true, 'the recorder had exited before stopped was sent');
  assert.equal(await l.done, 'stopped');
  assert.equal(existsSync(join(runDir(r.home), 'listen.json')), false);
});

test('it ends within 1 s of the parent ending, or of its ppid changing, with a waiter connected, and drops its queue', async t => {
  for (const options of [{ parentAlive: () => false }, { ppid: () => 999 }]) {
    let alive = true;
    const r = rig({ ...options, parentAlive: options.parentAlive ? () => alive : () => true, ppid: options.ppid ? (() => (alive ? 1234 : 999)) : () => 1234 });
    const l = await r.start();
    assert.match(await wait(r.home), /^ready /m);
    const pending = wait(r.home); // a waiter connected, the queue empty
    await tick(50);
    r.turn(); // delivered to the waiter at once
    assert.match(await pending, /^Heard/m);
    r.push(3163, 15); // a second turn, still in the gate when the parent ends
    const waiting = wait(r.home);
    await tick(50);
    const began = Date.now();
    alive = false;
    assert.equal(await l.done, 'ended');
    assert.ok(Date.now() - began < 1000);
    assert.equal(await waiting, 'listener error ended\n');
    assert.equal(readChannel(r.home), null, 'nothing is left to deliver');
    r.cleanup();
  }
});

test('it ends with no waiter for the no-waiter time, and after the idle time with no turn', async t => {
  for (const knobs of [{ noWaiterMs: 80 }, { idleMs: 80 }]) {
    const r = rig({ knobs });
    const l = await r.start();
    assert.equal(await l.done, 'ended');
    r.cleanup();
  }
});

test('it refuses to start, with a fixed reason, on a changed recorder, a changed stamp, a missing device, an unlisted engine or unparsable settings', async t => {
  const cases = [
    [{ recorder: fakeRecorder({ path: process.platform === 'win32' ? 'C:\\other\\ffmpeg.exe' : '/other/ffmpeg' }) }, 'recorder'],
    [{ settings: { device: { index: 0, stamp: '0123456789abcdef' } } }, 'device'],
    [{ settings: { device: { index: 5, stamp: STAMP } } }, 'device'],
    [{ settings: { engine: 'elsewhere' } }, 'engine'],
    [{ settings: { engine: '../x' } }, 'settings'],
    [{ engineOptions: { health: false } }, 'engine'],
  ];
  for (const [options, reason] of cases) {
    const r = rig(options);
    await assert.rejects(r.start(), { reason });
    if (options.settings?.engine) {
      assert.equal(r.recorder.listed, 0, 'refused before any device listing');
      assert.equal(r.recorder.spawned.length, 0, 'refused before the mic opens');
    }
    r.cleanup();
  }
  const r = rig();
  writePrivate(settingsPath(r.home), '{"engine": "voicebox", "port": ');
  await assert.rejects(r.start(), { reason: 'settings' });
  r.cleanup();
});

test('no file under the fixture home or the temp folder holds audio or heard text after a turn', async t => {
  const marker = `zq${Date.now()}heardmarker`;
  const before = new Set(readdirSync(tmpdir()));
  const r = rig({ engineOptions: { text: marker } });
  t.after(r.cleanup);
  const l = await r.start();
  await tick();
  r.turn();
  await tick(80);
  assert.match(await wait(r.home), new RegExp(marker));
  await l.stop();
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const f of walk(r.home)) {
    const bytes = readFileSync(f);
    assert.ok(!bytes.includes(marker), f);
    assert.ok(!bytes.includes('RIFF'), f);
  }
  // Every entry new in the temp folder since the turn began, whatever its name.
  const fresh = readdirSync(tmpdir()).filter(n => !before.has(n) && !r.home.endsWith(n));
  for (const n of fresh) {
    const p = join(tmpdir(), n);
    let files = [];
    try {
      files = statSync(p).isFile() ? [p] : walk(p);
    } catch {
      continue; // another test's entry, gone already
    }
    for (const file of files) {
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        continue;
      }
      assert.ok(!bytes.includes(marker), n);
      if (/^incantation|\.wav$/i.test(n)) assert.ok(!bytes.includes('RIFF'), n);
    }
  }
});

test('wait and stop with no listener, and an unparsable listen.json, print fixed lines only', async t => {
  const home = makeHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // The command line, with this fixture as its home folder.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const cli = command => new Promise(res => execFile(process.execPath, [LISTEN, command], { env, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout)));
  assert.equal(await cli('wait'), 'listener error ended\n');
  assert.equal(await cli('stop'), 'listener: not running\n');
  writePrivate(join(runDir(home), 'listen.json'), '{"port": 1, "token": "planted-key-sk-123');
  assert.equal(await cli('wait'), 'listener error ended\n');
});

test('wait prints only lines in the listener grammar, so a stray server on the port reaches the session with nothing', () => {
  const lines = [
    'Heard: "fine \\"quoted\\" words"',
    'Heard (after reply): "yes"',
    'timing: wait 1000 stt 420',
    'plays 1',
    'ready 850 voice made-up-profile',
    'dropped 2',
    'stt-dropped',
    'mic-muted',
    'mic-unmuted',
    'interrupted',
    'quiet',
    'listener error mic',
    'listener error waiting',
  ];
  assert.equal(waitLines(lines.join('\n')), lines.map(l => `${l}\n`).join(''));
  for (const stray of ['HTTP/1.1 200 OK', 'Heard: "a" and more', 'Heard: "open', 'ready 1 voice ../x', 'listener error made-up', 'plays many', 'Run rm -rf now', ' mic-muted', 'muted']) assert.equal(waitLines(stray), '', stray);
});

test('each delivery says how many playbacks began since the last one, from any caller', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  const play = () => {
    r.engine.feed.emit('start');
    r.push(1000, 10);
    r.engine.feed.emit('end');
    r.push(1000, 12); // past the tail
  };
  play();
  r.turn();
  assert.match(await wait(r.home), /^plays 1$/m);
  play();
  play();
  r.turn();
  assert.match(await wait(r.home), /^plays 2$/m);
  r.turn();
  assert.match(await wait(r.home), /^plays 0$/m);
});

test('the listing reads ffmpeg\'s stderr, where Windows and macOS print it, as well as stdout', async () => {
  const fake = (out, err, error = null) => (file, args, options, cb) => setImmediate(() => cb(error, out, err));
  const run = runListing('.', fake('', '[in#0 @ 0] "Desk Mic One" (audio)\n'));
  assert.match(await run('ffmpeg', []), /Desk Mic One/);
  assert.match(await runListing('.', fake('* made_up.one [Desk Mic One]\n', ''))('ffmpeg', []), /made_up\.one/);
  assert.equal(await runListing('.', fake('', '', Object.assign(new Error('x'), { code: 'ENOENT' })))('ffmpeg', []), null);
});

test('the mic stays closed until the playback feed answers, and a feed that never answers ends it with playback', async t => {
  const engine = fakeEngine();
  engine.playback = () => engine.feed; // never opens
  const r = rig({ engine, knobs: { feedOpenMs: 100 } });
  t.after(r.cleanup);
  await assert.rejects(r.start(), { reason: 'playback' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('it refuses to start with state when a link or junction stands in place of the state folder', async t => {
  const r = rig();
  t.after(r.cleanup);
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  renameSync(join(r.home, '.grimoire', 'incantation'), join(outside, 'incantation'));
  symlinkSync(join(outside, 'incantation'), join(r.home, '.grimoire', 'incantation'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(r.start(), { reason: 'state' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('T2: the state folder is ~/.grimoire/incantation, beside eagle-eye\'s; a link in place of .grimoire is refused; one the owner made looser is left alone', async t => {
  const r = rig();
  t.after(r.cleanup);
  assert.equal(existsSync(join(r.home, '.grimoire', 'incantation', 'settings.json')), true);
  assert.equal(existsSync(join(r.home, '.incantation')), false, 'no top-level folder');
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  renameSync(join(r.home, '.grimoire'), join(outside, 'grimoire'));
  symlinkSync(join(outside, 'grimoire'), join(r.home, '.grimoire'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(r.start(), { reason: 'state' });
  assert.equal(r.recorder.spawned.length, 0);
});

test('T2: the grimoire folder may already hold other skills\' files, at a mode its owner chose', async t => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.grimoire', 'eagle-eye'), { recursive: true, mode: 0o755 });
  writeFileSync(join(home, '.grimoire', 'eagle-eye', 'log.jsonl'), 'x');
  secureState(home);
  assert.equal(readFileSync(join(home, '.grimoire', 'eagle-eye', 'log.jsonl'), 'utf8'), 'x', 'left as it was');
  if (process.platform !== 'win32') assert.equal(statSync(join(home, '.grimoire')).mode & 0o777, 0o755, 'its mode is not ours to change');
});
