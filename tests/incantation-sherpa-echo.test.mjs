// Tests of the sherpa prototype's echo guard (grimoire 646, trial only): the
// listener hears its own voice through a laptop speaker. Two layers: the gate
// marks turns that overlap playback and needs louder voice to barge in while a
// reply plays, and a heard turn that only repeats the line being spoken is
// dropped. The echo canceller's reference feed is checked here too; the
// canceller itself runs in Python and is driven by a fake process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Gate, KNOBS } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/gate.mjs';
import { RefFeed, isEcho, makeAec, wavTo16k } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/echo.mjs';

const frame = amp => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const QUIET = 1000;
const VOICE = 3163; // 10 dB over QUIET
const LOUD = 10000; // 20 dB over QUIET
const GRACE = Math.ceil(KNOBS.bargeGraceMs / 30); // frames of a reply before a barge-in counts

function rig() {
  const gate = new Gate({ silenceMs: 300 });
  const r = { gate, t: 0, turns: [], barges: 0 };
  r.feed = (amp, n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const e of gate.frame(frame(amp), r.t)) (e.type === 'turn' ? r.turns.push(e) : r.barges++);
      r.t += 30;
    }
  };
  r.feed(QUIET, Math.ceil(KNOBS.floorMs / 30));
  return r;
}

const wav = (rate, samples) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};

test('a turn that starts while a reply plays is marked as overlapping it', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(LOUD, 10);
  r.gate.playback(0, r.t);
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].overlap, true);
});

test('a turn well after playback ends does not overlap it', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, 5);
  r.gate.playback(0, r.t);
  r.feed(QUIET, Math.ceil(KNOBS.echoHoldMs / 30) + 2);
  r.feed(VOICE, 10);
  r.feed(QUIET, 12);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].overlap, false);
});

test('voice that only just clears the floor does not barge in on a reply', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, GRACE);
  r.feed(VOICE, 30);
  assert.equal(r.barges, 0);
});

test('louder voice still barges in on a reply', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, GRACE);
  r.feed(LOUD, 30);
  assert.equal(r.barges, 1);
});

test('no barge-in counts in the first moments of a reply, while the canceller settles', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(LOUD, GRACE - 1);
  assert.equal(r.barges, 0);
});

test('a frame the canceller mostly removed does not count toward a barge-in', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, GRACE);
  const before = Math.round(LOUD * 10 ** (KNOBS.bargeRemovedDb / 20)) + 10; // just over the limit taken out
  for (let i = 0; i < 30; i++) {
    for (const e of r.gate.frame(frame(LOUD), r.t, frame(before))) if (e.type === 'barge') r.barges++;
    r.t += 30;
  }
  assert.equal(r.barges, 0);
});

test('a frame the canceller left mostly alone still counts toward a barge-in', () => {
  const r = rig();
  r.gate.playback(1, r.t);
  r.feed(QUIET, GRACE);
  const before = LOUD * 2; // 6 dB taken out: a person over the reply
  for (let i = 0; i < 30; i++) {
    for (const e of r.gate.frame(frame(LOUD), r.t, frame(before))) if (e.type === 'barge') r.barges++;
    r.t += 30;
  }
  assert.equal(r.barges, 1);
});

test('a heard turn that repeats the spoken line is echo', () => {
  assert.equal(isEcho('So you want the branch pushed.', ['So you want the branch pushed, shall I?']), true);
  assert.equal(isEcho('want the branch pushed shall', ['So you want the branch pushed, shall I?']), true);
});

test('the person’s own words are not echo', () => {
  assert.equal(isEcho('Yes, go ahead.', ['So you want the branch pushed, shall I?']), false);
  assert.equal(isEcho('No, push the other branch instead.', ['So you want the branch pushed, shall I?']), false);
  assert.equal(isEcho('anything', []), false);
  assert.equal(isEcho('', ['Okay.']), false);
});

test('wavTo16k resamples a 24 kHz line to 16 kHz samples', () => {
  const out = wavTo16k(wav(24000, Array.from({ length: 2400 }, () => 1000)));
  assert.equal(out.length, 1600);
  assert.ok(out.every(s => s === 1000));
});

test('wavTo16k refuses what is not 16-bit mono PCM', () => {
  assert.equal(wavTo16k(Buffer.from('not a wav')).length, 0);
});

test('RefFeed hands out what was played, mixed, then silence', () => {
  const feed = new RefFeed();
  feed.add(Int16Array.from([100, 100, 100]));
  feed.add(Int16Array.from([10]));
  const first = feed.take(2);
  assert.deepEqual([first.readInt16LE(0), first.readInt16LE(2)], [110, 100]);
  const next = feed.take(3);
  assert.deepEqual([next.readInt16LE(0), next.readInt16LE(2), next.readInt16LE(4)], [100, 0, 0]);
  feed.add(Int16Array.from([5, 5]));
  feed.clear();
  assert.equal(feed.take(1).readInt16LE(0), 0);
});

// A fake worker: answers "AEC1", then returns each mic frame minus its reference.
function fakeSpawn({ ready = true } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  let buf = Buffer.alloc(0);
  child.stdin.on('data', d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 1920) {
      const out = Buffer.alloc(960);
      for (let i = 0; i < 480; i++) out.writeInt16LE(buf.readInt16LE(i * 2) - buf.readInt16LE(960 + i * 2), i * 2);
      buf = buf.subarray(1920);
      child.stdout.write(out);
    }
  });
  if (ready) setImmediate(() => child.stdout.write(Buffer.from('AEC1')));
  return () => child;
}

test('the canceller returns each frame cleaned, in order', async () => {
  const aec = makeAec({ python: 'py', worker: 'w', spawn: fakeSpawn(), exists: () => true });
  await aec.ready;
  const ref = frame(1000);
  const outs = await Promise.all([aec.process(frame(3000), ref), aec.process(frame(5000), ref)]);
  assert.equal(outs[0].readInt16LE(2), 2000);
  assert.equal(outs[1].readInt16LE(2), 4000);
  aec.close();
});

test('with no runtime the canceller passes frames through', async () => {
  const aec = makeAec({ python: 'py', worker: 'w', spawn: fakeSpawn(), exists: () => false });
  const f = frame(3000);
  assert.equal(aec.active, false);
  assert.equal(await aec.process(f, frame(1000)), f);
});

test('before the worker is ready, frames pass through unchanged', async () => {
  const aec = makeAec({ python: 'py', worker: 'w', spawn: fakeSpawn({ ready: false }), exists: () => true });
  const f = frame(3000);
  assert.equal(await aec.process(f, frame(1000)), f);
  aec.close();
});
