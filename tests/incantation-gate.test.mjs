// Tests of gate.mjs (docs/spec/incantation.md, S6; claims 4, 7 and 9), from
// #622's listener tests with the sound server taken out. The turn logic is
// driven with scripted frames and scripted playback, tones and silence only,
// never recorded speech.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gate, HeardQueue, KNOBS, formatHeard, isStopWord } from '../plugins/incantation/skills/incantation/scripts/gate.mjs';


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

test('every frame is discarded from a playback start to its end and the tail after, one playing before start included, whoever started it', () => {
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
