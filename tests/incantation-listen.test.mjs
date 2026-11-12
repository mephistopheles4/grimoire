// Tests of listen.mjs (docs/spec/incantation.md, S4.3; claims 19 to 22). The
// turn logic is tested with scripted frames and scripted playback, tones and
// silence only, never recorded speech. The process layer is tested with a fake
// recorder and a fake playback watcher (small node programs in a fixture bin
// folder), and a fake speech-to-text engine on a free loopback port. The
// process tests skip on win32 and say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gate, HeardQueue, KNOBS, countPlaying, findClaudeAncestor, formatHeard, isStopWord, resolveProgram, startListener } from '../plugins/incantation/skills/incantation/scripts/listen.mjs';
import { cleanup, freePort, localOnlyEnv, makeHome, onWindows } from './incantation-helpers.mjs';

const LISTEN = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/listen.mjs', import.meta.url));
const skip = onWindows ? 'fake programs, sockets and /proc: skipped on win32, run in the athanor container and in CI' : false;

// Frames: 30 ms of a square wave, so its level is exactly the amplitude.
const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const QUIET = 1000;
const VOICE = 3163; // 10.0006 dB over QUIET
const JUST_UNDER = 3162; // 9.9996 dB over QUIET

// A gate and a clock that feeds it: each call advances 30 ms.
function rig(options = {}) {
  const gate = new Gate({ silenceMs: 300, ...options });
  const r = { gate, t: options.t ?? 0, turns: [], muted: 0 };
  r.feed = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const e of gate.frame(frame(amp), r.t)) (e.type === 'turn' ? r.turns.push(e) : r.muted++);
      r.t += 30;
    }
  };
  r.calibrate = () => r.feed(QUIET, 34);
  r.play = n => gate.playback(n, r.t);
  r.skip = ms => (r.t += ms);
  return r;
}

// Claim 19: the turn logic.

test('a frame 10 dB over the floor is voice and one just under is not', () => {
  const over = rig();
  over.calibrate();
  over.feed(VOICE, 10);
  over.feed(QUIET, 12);
  assert.equal(over.turns.length, 1);
  const under = rig();
  under.calibrate();
  under.feed(JUST_UNDER, 10);
  under.feed(QUIET, 12);
  assert.equal(under.turns.length, 0);
});

test('a turn ends after the end-of-speech wait, not before', () => {
  const r = rig({ silenceMs: 300 });
  r.calibrate();
  r.feed(VOICE, 12);
  r.feed(QUIET, 9);
  assert.equal(r.turns.length, 0);
  r.feed(QUIET, 1);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].silenceMs, 300);
});

test('a 0.3 s turn is delivered and a 0.2 s blip is dropped', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 10); // 0.3 s
  r.feed(QUIET, 12);
  r.feed(VOICE, 7); // 0.21 s
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1);
});

test('a turn is cut at 30 s and the rest goes on as the next turn', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 1100); // 33 s of voice
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 2);
  assert.ok(r.turns[0].pcm.length >= 960 * 990 && r.turns[0].pcm.length <= 960 * 1000);
});

test('every frame is discarded while a stream plays and for the tail after, one that exists before start included', () => {
  const before = rig({ playing: 1 });
  before.feed(VOICE, 20);
  before.feed(QUIET, 12);
  assert.equal(before.turns.length, 0);

  const r = rig();
  r.calibrate();
  r.play(1);
  r.feed(VOICE, 20);
  r.play(0);
  r.feed(VOICE, 9); // 270 ms: inside the 300 ms tail
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 0);
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1, 'heard again once the tail has passed');
});

test('a corked stream does not mute', () => {
  const text = 'Sink Input #1\n\tCorked: yes\nSink Input #2\n\tCorked: no\nSink Input #3\n\tCorked: yes\n';
  assert.equal(countPlaying(text), 1);
  assert.equal(countPlaying('Sink Input #1\n\tCorked: yes\n'), 0);
  assert.equal(countPlaying(''), 0);
  const r = rig({ playing: countPlaying('Sink Input #1\n\tCorked: yes\n') });
  r.calibrate();
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1);
});

test('a turn that playback cuts is dropped, not delivered late', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 10); // 300 ms of voice, enough to count as a turn on its own
  r.play(1);
  r.feed(VOICE, 10);
  r.play(0);
  r.skip(400);
  r.feed(QUIET, 20);
  assert.equal(r.turns.length, 0);
});

test('a playback that restarts inside the tail goes on with the one mute, and muted is reported once', () => {
  const r = rig();
  r.calibrate();
  r.play(1);
  r.feed(QUIET, 1100); // 33 s of mute
  assert.equal(r.muted, 1, 'reported once after 30 s');
  r.play(0);
  r.skip(100);
  r.play(1); // inside the 300 ms tail: the same mute
  r.feed(QUIET, 1100);
  assert.equal(r.muted, 1, 'not again while the same mute goes on');
});

test('a turn is marked after reply only when a playback began after the last delivery and ended, tail included, before the turn', () => {
  const r = rig();
  r.calibrate();
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[0].afterReply, false, 'no playback yet');
  r.gate.delivered(r.t);
  // A yes said after the delivery but before the say-back plays is not marked.
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[1].afterReply, false);
  r.gate.delivered(r.t);
  r.skip(30);
  r.play(1);
  r.skip(900);
  r.play(0);
  r.feed(QUIET, 12); // the tail passes
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[2].afterReply, true);
  assert.equal(r.turns[2].firstAfterReply, true);
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[3].afterReply, true);
  assert.equal(r.turns[3].firstAfterReply, false, 'only the first after each playback');
  r.gate.delivered(r.t);
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns[4].afterReply, false, 'a delivery clears the mark until the next playback');
});

test('muted is returned once after 30 s of mute, and not again until the mute ended and a new one passed 30 s', () => {
  const r = rig();
  r.calibrate();
  r.play(1);
  r.feed(QUIET, 1100); // 33 s
  assert.equal(r.muted, 1);
  r.feed(QUIET, 300);
  assert.equal(r.muted, 1, 'still the same stretch');
  r.play(0);
  r.feed(QUIET, 40);
  r.play(1);
  r.feed(QUIET, 900); // 27 s: not yet
  assert.equal(r.muted, 1);
  r.feed(QUIET, 200);
  assert.equal(r.muted, 2);
});

test('the queue keeps 20 turns, drops the oldest, and ages out a turn after 5 minutes', () => {
  const q = new HeardQueue();
  for (let i = 0; i < 25; i++) q.push({ text: `t${i}`, at: 0 });
  assert.equal(q.items.length, 20);
  assert.equal(q.items[0].text, 't5');
  assert.equal(q.dropped, 5);
  assert.equal(q.ready(KNOBS.ageMs + 1), false);
  assert.equal(q.dropped, 25);
});

test('deliveries are held to 4 a minute, except the turns that are never held', () => {
  const q = new HeardQueue();
  const put = (text, extra = {}) => q.push({ text, at: 0, ...extra });
  for (let i = 0; i < 4; i++) {
    put(`a${i}`);
    assert.equal(q.ready(i * 1000), true);
    q.take(i * 1000);
  }
  put('held');
  assert.equal(q.ready(10_000), false);
  assert.equal(q.nextAt(10_000), 60_000);
  assert.equal(q.ready(60_001), true);
  q.take(60_001);
  put('hold-again');
  put('stop', { exempt: isStopWord('Stop.') });
  assert.equal(q.ready(61_000), true);
  const taken = q.take(61_000);
  assert.deepEqual(taken.turns.map(t => t.text), ['hold-again', 'stop'], 'a never-held turn lets the whole queue go, in order');
  assert.equal(q.deliveries.length, 4, 'and does not count toward the cap');
  q.push({ text: 'first marked', at: 0, exempt: true });
  assert.equal(q.ready(62_000), true);
  q.take(62_000);
  q.push({ text: 'second marked', at: 0, exempt: false });
  q.deliveries = [61_000, 61_100, 61_200, 61_300];
  assert.equal(q.ready(62_100), false, 'a second marked turn after the same playback is held');
});

test('stop, that is all and wait, as a whole turn, are never held', () => {
  for (const yes of ['Stop.', 'stop', "That's all!", 'thats all', 'Wait', 'wait.']) assert.equal(isStopWord(yes), true, yes);
  for (const no of ['stop that now', 'wait for the build', 'please stop', '']) assert.equal(isStopWord(no), false, no);
});

// Claim 21: what `wait` prints.

test('heard text is printed with hidden characters removed, quotes escaped and cut at 500', () => {
  assert.equal(formatHeard('hello', false), 'Heard: "hello"');
  assert.equal(formatHeard('hello', true), 'Heard (after reply): "hello"');
  assert.equal(formatHeard('a\u0007b‮c d​e\u0000f\ng', false), 'Heard: "abcdefg"');
  assert.equal(formatHeard('say "hi" \\ now', false), 'Heard: "say \\"hi\\" \\\\ now"');
  const long = formatHeard('x'.repeat(900), false);
  assert.equal(long, `Heard: "${'x'.repeat(500)}"`);
});

// Claim 22: the program resolver. Fixture folders are the person's own, so the
// trusted owner is this user and the trusted folder is the fixture's bin.

function fixtureBin() {
  const root = mkdtempSync(join(tmpdir(), 'incantation-bin-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { mode: 0o755 });
  chmodSync(bin, 0o755);
  const trust = { owner: process.getuid?.() ?? 0, binDir: bin };
  return { root, bin, trust, remove: () => rmSync(root, { recursive: true, force: true }) };
}
const program = (path, mode = 0o755) => {
  writeFileSync(path, '#!/bin/sh\n', { mode });
  chmodSync(path, mode);
};

test('a program runs when it is in the trusted folder, owned by the trusted owner and closed to group and others', { skip }, t => {
  const f = fixtureBin();
  t.after(f.remove);
  program(join(f.bin, 'parec'));
  assert.equal(resolveProgram(join(f.bin, 'parec'), f.trust), join(f.bin, 'parec'));
});

test('a link to a sibling in the trusted folder runs', { skip }, t => {
  const f = fixtureBin();
  t.after(f.remove);
  program(join(f.bin, 'pacat'));
  symlinkSync('pacat', join(f.bin, 'parec'));
  assert.equal(resolveProgram(join(f.bin, 'parec'), f.trust), join(f.bin, 'parec'));
});

test('a link in a writable folder, a writable target, a target outside the folder and a relative path fail closed', { skip }, t => {
  const f = fixtureBin();
  t.after(f.remove);
  program(join(f.bin, 'pacat'));
  const loose = join(f.root, 'loose');
  mkdirSync(loose);
  chmodSync(loose, 0o777);
  symlinkSync(join(f.bin, 'pacat'), join(loose, 'parec'));
  assert.throws(() => resolveProgram(join(loose, 'parec'), f.trust), /programs/);

  program(join(f.bin, 'writable'), 0o775);
  assert.throws(() => resolveProgram(join(f.bin, 'writable'), f.trust), /programs/);
  program(join(f.bin, 'other-writable'), 0o757);
  assert.throws(() => resolveProgram(join(f.bin, 'other-writable'), f.trust), /programs/);

  const elsewhere = join(f.root, 'elsewhere');
  mkdirSync(elsewhere, { mode: 0o755 });
  program(join(elsewhere, 'parec'));
  assert.throws(() => resolveProgram(join(elsewhere, 'parec'), f.trust), /programs/);
  symlinkSync(join(elsewhere, 'parec'), join(f.bin, 'to-elsewhere'));
  assert.throws(() => resolveProgram(join(f.bin, 'to-elsewhere'), f.trust), /programs/);

  assert.throws(() => resolveProgram('parec', f.trust), /programs/);
  assert.throws(() => resolveProgram(join(f.bin, 'missing'), f.trust), /ENOENT|programs/);
  chmodSync(f.bin, 0o775);
  assert.throws(() => resolveProgram(join(f.bin, 'pacat'), f.trust), /programs/);
});

test('with the default trust, a file that is not root-owned in /usr/bin does not run', { skip }, t => {
  const f = fixtureBin();
  t.after(f.remove);
  program(join(f.bin, 'parec'));
  assert.throws(() => resolveProgram(join(f.bin, 'parec')), /programs/);
});

test('a program or a link that the trusted owner does not own fails closed, though it is in the trusted folder and closed to others', { skip }, t => {
  const f = fixtureBin();
  t.after(f.remove);
  program(join(f.bin, 'pacat'));
  symlinkSync('pacat', join(f.bin, 'parec'));
  const stranger = { ...f.trust, owner: f.trust.owner + 1 };
  assert.equal(resolveProgram(join(f.bin, 'pacat'), f.trust), join(f.bin, 'pacat'), 'it runs for its own owner');
  assert.throws(() => resolveProgram(join(f.bin, 'pacat'), stranger), /programs/);
  assert.throws(() => resolveProgram(join(f.bin, 'parec'), stranger), /programs/);
});

// Claim 20: the session, from a fixture /proc.

function fakeProc(tree) {
  const root = mkdtempSync(join(tmpdir(), 'incantation-proc-'));
  const write = (pid, { comm = 'x', ppid, start = '1', argv = ['x'], exe }) => {
    mkdirSync(join(root, String(pid)), { recursive: true });
    writeFileSync(join(root, String(pid), 'stat'), `${pid} (${comm}) S ${ppid} ${'0 '.repeat(17)}${start} 0 0\n`);
    writeFileSync(join(root, String(pid), 'cmdline'), `${argv.join('\0')}\0`);
    if (exe) symlinkSync(exe, join(root, String(pid), 'exe'));
  };
  for (const [pid, entry] of Object.entries(tree)) write(pid, entry);
  return { root, write, remove: () => rmSync(root, { recursive: true, force: true }) };
}

test('the session is the nearest ancestor whose executable or first argument is named claude', t => {
  const p = fakeProc({
    500: { ppid: 400, argv: ['node', 'listen.mjs', 'start'] },
    400: { ppid: 300, argv: ['bash'] },
    300: { ppid: 200, argv: ['claude'], start: '777' },
    200: { ppid: 100, argv: ['claude'], start: '555' },
    100: { ppid: 1, argv: ['init'] },
  });
  t.after(p.remove);
  assert.deepEqual(findClaudeAncestor(500, p.root), { pid: 300, start: '777' });
  p.write(300, { ppid: 200, argv: ['/usr/local/bin/node', 'cli.js'], exe: '/opt/claude/claude', start: '777' });
  assert.deepEqual(findClaudeAncestor(500, p.root), { pid: 300, start: '777' });
});

test('a process only named like claude, or no claude ancestor at all, is no session', t => {
  const p = fakeProc({
    500: { ppid: 400, argv: ['node', 'listen.mjs'] },
    400: { ppid: 300, argv: ['claude-helper'] },
    300: { ppid: 1, argv: ['/bin/sh', '-c', 'claude'] },
  });
  t.after(p.remove);
  assert.equal(findClaudeAncestor(500, p.root), null);
  assert.equal(findClaudeAncestor(999, p.root), null);
});

// The process layer, with a fake recorder, a fake playback watcher and a fake
// speech-to-text engine.

const NODE = process.execPath;
const FAKE_PAREC = `#!${NODE}
const fs = require('node:fs');
fs.writeFileSync('env-parec.json', JSON.stringify({ env: process.env, argv: process.argv.slice(2), cwd: process.cwd() }));
const script = JSON.parse(fs.readFileSync('fake-parec.json', 'utf8'));
const queue = [];
for (const s of script.segments) for (let n = 0; n < s.frames; n++) queue.push(s.amp);
const frame = amp => { const b = Buffer.alloc(960); for (let k = 0; k < 480; k++) b.writeInt16LE(k % 2 ? amp : -amp, k * 2); return b; };
process.stdout.on('error', () => process.exit(0));
const timer = setInterval(() => {
  if (!queue.length) { clearInterval(timer); setInterval(() => {}, 1000); return; }
  process.stdout.write(frame(queue.shift()));
}, script.paceMs ?? 2);
`;
const FAKE_PACTL = `#!${NODE}
const fs = require('node:fs');
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
fs.writeFileSync('env-pactl.json', JSON.stringify({ env: process.env, cwd: process.cwd() }));
const mode = read('fake-pactl-mode').trim();
const streams = () => read('fake-streams').split('\\n').filter(Boolean);
if (process.argv[2] === 'list') {
  if (mode === 'fail-list') process.exit(1);
  process.stdout.write(streams().map((s, i) => 'Sink Input #' + (i + 1) + '\\n\\tDriver: x\\n\\tCorked: ' + (s === 'corked' ? 'yes' : 'no') + '\\n').join(''));
  process.exit(0);
}
if (process.argv[2] === 'subscribe') {
  if (mode === 'exit-subscribe') process.exit(0);
  let last = read('fake-streams');
  setInterval(() => { const now = read('fake-streams'); if (now !== last) { last = now; console.log("Event 'change' on sink-input #1"); } }, 20);
}
`;

const MARKER = 'zebra-marker-4421';

async function sttServer(c, respond) {
  const port = await freePort();
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, host: req.headers.host, type: req.headers['content-type'], wav: body.includes('RIFF'), bytes: body.length });
      const answer = respond(seen.length);
      if (answer === null) return res.writeHead(500).end();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: answer }));
    });
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  c.add(() => new Promise(r => (server.closeAllConnections(), server.close(() => r()))));
  return { port, seen };
}

// A home, a bin with the fake programs, a fixture /proc with a session in it.
async function bench(t, { respond = () => MARKER, silenceMs = 90, segments, streams, mode, knobs = {}, tts = 9 } = {}) {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await sttServer(c, respond);
  const h = makeHome({ stt: stt.port, tts, env: localOnlyEnv({ stt: stt.port, tts }).replace('VOICEMODE_SILENCE_THRESHOLD_MS=1000', `VOICEMODE_SILENCE_THRESHOLD_MS=${silenceMs}`) });
  c.add(h.remove);
  const f = fixtureBin();
  c.add(f.remove);
  writeFileSync(join(f.bin, 'parec'), FAKE_PAREC, { mode: 0o755 });
  writeFileSync(join(f.bin, 'pactl'), FAKE_PACTL, { mode: 0o755 });
  chmodSync(join(f.bin, 'parec'), 0o755);
  chmodSync(join(f.bin, 'pactl'), 0o755);
  segments ??= [{ frames: 40, amp: 200 }, { frames: 12, amp: 6000 }, { frames: 12, amp: 200 }];
  writeFileSync(join(h.run, 'fake-parec.json'), JSON.stringify({ segments }));
  if (streams) writeFileSync(join(h.run, 'fake-streams'), streams);
  if (mode) writeFileSync(join(h.run, 'fake-pactl-mode'), mode);
  const proc = fakeProc({ 4242: { ppid: 1, argv: ['claude'], start: '777' } });
  c.add(proc.remove);
  const options = {
    home: h.home,
    programs: { parec: join(f.bin, 'parec'), pactl: join(f.bin, 'pactl') },
    trust: f.trust,
    procRoot: proc.root,
    session: { pid: 4242, start: '777' },
    knobs: { sessionPollMs: 40, ...knobs },
  };
  const begin = async (more = {}) => {
    const l = await startListener({ ...options, ...more });
    c.add(() => l.stop('ended'));
    return l;
  };
  return { c, h, stt, f, proc, options, begin };
}

// A waiter: connects, reads to the end, returns what it was told.
const waiter = h => new Promise(resolve => {
  const s = connect(join(h.run, 'listen.sock'));
  let out = '';
  s.setEncoding('utf8');
  s.on('connect', () => s.write('wait\n'));
  s.on('data', d => (out += d));
  s.on('close', () => resolve(out));
  s.on('error', () => resolve(out));
});
const waitFor = async (test, ms = 3000) => {
  for (let i = 0; i < ms / 20 && !test(); i++) await new Promise(r => setTimeout(r, 20));
};
const filesUnder = dir => readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => join(e.parentPath ?? e.path, e.name));

test('a turn is transcribed through the proxy port only, and a waiter is told what was heard, with the timing', { skip }, async t => {
  const b = await bench(t);
  const l = await b.begin();
  const told = await waiter(b.h);
  assert.match(told, /^Heard: "zebra-marker-4421"\ntiming: wait 90 stt \d+\n$/);
  assert.equal(b.stt.seen.length, 1);
  assert.deepEqual({ ...b.stt.seen[0], bytes: undefined }, { method: 'POST', url: '/v1/audio/transcriptions', host: `127.0.0.1:${b.stt.port}`, type: b.stt.seen[0].type, wav: true, bytes: undefined });
  assert.match(b.stt.seen[0].type, /^multipart\/form-data; boundary=/);
  l.stop('ended');
});

test('the programs run by path, from the run folder, with only HOME, LANG and PULSE_SERVER', { skip }, async t => {
  const b = await bench(t);
  const l = await b.begin();
  await waitFor(() => existsSync(join(b.h.run, 'env-parec.json')) && existsSync(join(b.h.run, 'env-pactl.json')));
  for (const name of ['parec', 'pactl']) {
    const seen = JSON.parse(readFileSync(join(b.h.run, `env-${name}.json`), 'utf8'));
    assert.deepEqual(Object.keys(seen.env).sort(), ['HOME', 'LANG', 'PULSE_SERVER']);
    assert.equal(seen.env.LANG, 'C');
    assert.equal(seen.env.PULSE_SERVER, 'unix:/mnt/wslg/PulseServer');
    assert.equal(seen.env.HOME, b.h.home);
    assert.equal(seen.cwd, b.h.run);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(b.h.run, 'env-parec.json'), 'utf8')).argv, ['--format=s16le', '--rate=16000', '--channels=1']);
  l.stop('ended');
});

test('a stream playing before start mutes, and a corked one does not', { skip }, async t => {
  const playing = await bench(t, { streams: 'playing\n', knobs: { quietMs: 500 } });
  await playing.begin();
  assert.equal(await waiter(playing.h), 'quiet\n');
  assert.equal(playing.stt.seen.length, 0);

  const corked = await bench(t, { streams: 'corked\n' });
  await corked.begin();
  assert.match(await waiter(corked.h), /^Heard: /);
});

test('a playback that starts later mutes from then on', { skip }, async t => {
  const b = await bench(t, {
    segments: [{ frames: 40, amp: 200 }, { frames: 300, amp: 200 }, { frames: 12, amp: 6000 }, { frames: 12, amp: 200 }],
    knobs: { quietMs: 1200 },
  });
  await b.begin();
  await new Promise(r => setTimeout(r, 150));
  writeFileSync(join(b.h.run, 'fake-streams'), 'playing\n');
  assert.equal(await waiter(b.h), 'quiet\n');
  assert.equal(b.stt.seen.length, 0);
});

test('no file under the fixture home or the temp folder holds audio or heard text after a turn', { skip }, async t => {
  // The listener runs in this process, so a TMPDIR set here is the temp folder it would use.
  const temp = mkdtempSync(join(tmpdir(), 'incantation-temp-'));
  const was = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  t.after(() => {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
    rmSync(temp, { recursive: true, force: true });
  });
  const b = await bench(t);
  const l = await b.begin();
  await waiter(b.h);
  l.stop('ended');
  await l.done;
  for (const dir of [b.h.home, b.f.root, temp]) {
    for (const file of filesUnder(dir)) {
      if (statSync(file).isSocket?.()) continue;
      const bytes = readFileSync(file);
      assert.equal(bytes.includes(MARKER), false, `${file} holds the heard text`);
      assert.equal(bytes.includes('RIFF'), false, `${file} holds audio`);
    }
  }
});

test('the listener fails closed, capturing nothing, when the playback watcher is missing, fails or exits', { skip }, async t => {
  const missing = await bench(t);
  await assert.rejects(() => missing.begin({ programs: { ...missing.options.programs, pactl: join(missing.f.bin, 'absent') } }), { reason: 'programs' });
  assert.equal(existsSync(join(missing.h.run, 'env-parec.json')), false);

  const fails = await bench(t, { mode: 'fail-list' });
  await assert.rejects(() => fails.begin(), { reason: 'playback' });
  assert.equal(existsSync(join(fails.h.run, 'env-parec.json')), false, 'the recorder was never started');

  const exits = await bench(t, { mode: 'exit-subscribe', segments: [{ frames: 5000, amp: 200 }] });
  const l = await exits.begin();
  assert.equal(await l.done, 'playback');
});

test('a recorder that exits ends the listener with a fixed reason', { skip }, async t => {
  const b = await bench(t);
  writeFileSync(join(b.f.bin, 'parec'), `#!${NODE}\nprocess.exit(3);\n`, { mode: 0o755 });
  const l = await b.begin();
  assert.equal(await l.done, 'recorder');
});

test('a start with no Claude Code ancestor fails closed', { skip }, async t => {
  const b = await bench(t);
  const bare = fakeProc({ 4242: { ppid: 1, argv: ['bash'] } });
  b.c.add(bare.remove);
  await assert.rejects(() => b.begin({ session: undefined, procRoot: bare.root }), { reason: 'session' });
});

test('the listener ends when the session ends, even with a waiter, and not while the session lives with none', { skip }, async t => {
  const b = await bench(t, { segments: [{ frames: 5000, amp: 200 }] });
  const l = await b.begin();
  let ended = false;
  l.done.then(() => (ended = true));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(ended, false, 'no waiter and the session lives');
  const pending = waiter(b.h);
  await new Promise(r => setTimeout(r, 100));
  rmSync(join(b.proc.root, '4242'), { recursive: true });
  assert.equal(await l.done, 'ended');
  assert.equal(await pending, 'listener error ended\n');
  assert.equal(existsSync(join(b.h.run, 'listen.sock')), false);
});

test('a recorded process id whose start time no longer matches counts as ended', { skip }, async t => {
  const b = await bench(t, { segments: [{ frames: 5000, amp: 200 }] });
  const l = await b.begin();
  b.proc.write(4242, { ppid: 1, argv: ['claude'], start: '778' });
  assert.equal(await l.done, 'ended');
});

test('a queued turn is dropped with the session', { skip }, async t => {
  const b = await bench(t);
  const l = await b.begin();
  await waitFor(() => b.stt.seen.length === 1);
  await new Promise(r => setTimeout(r, 50));
  rmSync(join(b.proc.root, '4242'), { recursive: true });
  await l.done;
  assert.equal(existsSync(join(b.h.run, 'listen.sock')), false);
});

test('stop ends it, and so does 30 minutes with no turn', { skip }, async t => {
  const a = await bench(t, { segments: [{ frames: 5000, amp: 200 }] });
  const la = await a.begin();
  la.stop();
  assert.equal(await la.done, 'ended');
  const idle = await bench(t, { segments: [{ frames: 5000, amp: 200 }], knobs: { idleMs: 250 } });
  const li = await idle.begin();
  assert.equal(await li.done, 'ended');
});

test('a second start exits with a fixed line and leaves the first running; a second waiter gets busy', { skip }, async t => {
  const b = await bench(t, { segments: [{ frames: 5000, amp: 200 }] });
  const l = await b.begin();
  await assert.rejects(() => startListener(b.options), { reason: 'busy' });
  assert.equal(existsSync(join(b.h.run, 'listen.sock')), true, 'the first is still listening');
  const first = waiter(b.h);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await waiter(b.h), 'listener error busy\n');
  l.stop('ended');
  assert.equal(await first, 'listener error ended\n');
});

test('a stale socket is removed', { skip }, async t => {
  const b = await bench(t);
  spawnSync(NODE, ['-e', `require('node:net').createServer().listen(${JSON.stringify(join(b.h.run, 'listen.sock'))}, () => process.kill(process.pid, 'SIGKILL'))`]);
  assert.equal(existsSync(join(b.h.run, 'listen.sock')), true);
  await b.begin();
  assert.match(await waiter(b.h), /^Heard: /);
});

test('one failure prints stt-dropped and goes on; three in a row end it', { skip }, async t => {
  const twoTurns = [{ frames: 40, amp: 200 }, { frames: 12, amp: 6000 }, { frames: 12, amp: 200 }, { frames: 12, amp: 6000 }, { frames: 12, amp: 200 }];
  const once = await bench(t, { respond: n => (n === 1 ? null : MARKER), segments: twoTurns });
  await once.begin();
  assert.equal(await waiter(once.h), 'stt-dropped\n');
  assert.match(await waiter(once.h), /^Heard: "zebra-marker-4421"\n/);

  const threeTurns = [...twoTurns, { frames: 12, amp: 6000 }, { frames: 12, amp: 200 }, { frames: 5000, amp: 200 }];
  const always = await bench(t, { respond: () => null, segments: threeTurns });
  const l = await always.begin();
  assert.equal(await l.done, 'stt');
});

test('an empty or blank transcript is dropped', { skip }, async t => {
  const b = await bench(t, { respond: () => '   ', knobs: { quietMs: 600 } });
  await b.begin();
  assert.equal(await waiter(b.h), 'quiet\n');
});

test('audio goes only to the port in the global settings; the environment and the start folder are ignored', { skip }, async t => {
  const b = await bench(t);
  const other = await sttServer(b.c, () => 'other');
  const planted = mkdtempSync(join(tmpdir(), 'incantation-cwd-'));
  b.c.add(() => rmSync(planted, { recursive: true, force: true }));
  writeFileSync(join(planted, '.voicemode.env'), localOnlyEnv({ stt: other.port, tts: 9 }));
  const was = process.cwd();
  process.chdir(planted);
  process.env.VOICEMODE_STT_BASE_URLS = `http://127.0.0.1:${other.port}/v1`;
  b.c.add(() => {
    process.chdir(was);
    delete process.env.VOICEMODE_STT_BASE_URLS;
  });
  await b.begin();
  assert.match(await waiter(b.h), /zebra-marker-4421/);
  assert.equal(other.seen.length, 0);
});

test('a speech-to-text URL that is not on 127.0.0.1, or is unset, fails closed before anything runs', { skip }, async t => {
  for (const url of ['http://localhost:2022/v1', 'https://api.openai.com/v1', 'http://10.0.0.1:2022/v1', '']) {
    const b = await bench(t);
    writeFileSync(join(b.h.home, '.voicemode', 'voicemode.env'), localOnlyEnv({ stt: 1, tts: 9 }).replace(/VOICEMODE_STT_BASE_URLS=.*/, `VOICEMODE_STT_BASE_URLS=${url}`));
    await assert.rejects(() => b.begin(), { reason: 'settings' }, url);
    assert.equal(existsSync(join(b.h.run, 'env-parec.json')), false);
  }
});

test('a fixture parec on PATH or in the start folder is never run, and the real paths fail closed when they are not trusted', { skip }, async t => {
  const b = await bench(t);
  const decoy = mkdtempSync(join(tmpdir(), 'incantation-decoy-'));
  b.c.add(() => rmSync(decoy, { recursive: true, force: true }));
  for (const name of ['parec', 'pactl']) writeFileSync(join(decoy, name), `#!${NODE}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(decoy, 'ran'))}, '1');\n`, { mode: 0o755 });
  const was = process.cwd();
  const path = process.env.PATH;
  process.chdir(decoy);
  process.env.PATH = `${decoy}:${path}`;
  b.c.add(() => {
    process.chdir(was);
    process.env.PATH = path;
  });
  if (!existsSync('/usr/bin/parec')) await assert.rejects(() => startListener({ home: b.h.home, session: b.options.session, procRoot: b.options.procRoot }), { reason: 'programs' });
  assert.equal(existsSync(join(decoy, 'ran')), false);
});

// The command line.

test('the command line prints fixed lines only: wait with no listener, stop with none, start with no trusted programs', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = makeHome({ stt: await freePort(), tts: 9 });
  c.add(h.remove);
  const run = args => spawnSync(NODE, [LISTEN, ...args], { env: { HOME: h.home, USERPROFILE: h.home, PATH: process.env.PATH }, encoding: 'utf8', timeout: 8000 });
  assert.equal(run(['wait']).stdout, 'listener error ended\n');
  assert.equal(run(['stop']).stdout, 'listener: not running\n');
  // A pid file naming a process that is not the listener: stop leaves that process alone.
  const decoy = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)']);
  c.add(() => decoy.kill());
  writeFileSync(join(h.run, 'listen.pid'), JSON.stringify({ pid: decoy.pid }));
  assert.equal(run(['stop']).stdout, 'listener: not running\n');
  assert.equal(decoy.exitCode, null, 'the decoy is still running');
  assert.equal(decoy.signalCode, null);
  rmSync(join(h.run, 'listen.pid'), { force: true });
  assert.equal(run(['bogus']).stdout, 'usage: listen.mjs start | wait | stop\n');
  if (!existsSync('/usr/bin/parec')) {
    const started = run(['start']);
    assert.equal(started.stdout, 'listener error programs\n');
    assert.equal(started.status, 1);
    assert.equal(started.stderr, '');
  }
});
