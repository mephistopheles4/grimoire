// End of turn for the sherpa trial (grimoire 646): a turn that sounds unfinished
// is held, speech that follows joins it, and silence lets it go. The hold only
// ever waits longer than the gate. The model runs in Python, driven here by a
// fake judge and a fake process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { TurnHold, makeTurnJudge } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/turn.mjs';

const turn = (tag, extra = {}) => ({ pcm: Buffer.from(tag), afterReply: false, overlap: false, ...extra });
const judgeOf = (...ps) => ({ done: () => Promise.resolve(ps.length > 1 ? ps.shift() : ps[0]) });

test('a turn that sounds finished goes straight out', async () => {
  const out = [];
  const h = new TurnHold({ judge: judgeOf(0.9), release: t => out.push(t) });
  await h.offer(turn('a'), 0);
  assert.equal(out.length, 1);
  assert.equal(h.holding, false);
});

test('with no model a turn goes straight out', async () => {
  const out = [];
  const h = new TurnHold({ judge: judgeOf(null), release: t => out.push(t) });
  await h.offer(turn('a'), 0);
  assert.equal(out.length, 1);
});

test('an unfinished turn waits, and quiet lets it go', async () => {
  const out = [];
  const h = new TurnHold({ judge: judgeOf(0.1), release: t => out.push(t), holdMs: 1000 });
  await h.offer(turn('a'), 0);
  assert.equal(out.length, 0);
  h.tick(999, false);
  assert.equal(out.length, 0);
  h.tick(1000, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].pcm.toString(), 'a');
});

test('speech during the wait keeps it held, and the next turn joins it', async () => {
  const out = [];
  const h = new TurnHold({ judge: judgeOf(0.1, 0.9), release: t => out.push(t), holdMs: 1000 });
  await h.offer(turn('first ', { afterReply: true }), 0);
  h.tick(800, true);
  h.tick(1500, false); // only 700 ms quiet since the speech
  assert.equal(out.length, 0);
  await h.offer(turn('second', { overlap: true }), 1600);
  assert.equal(out.length, 1);
  assert.equal(out[0].pcm.toString(), 'first second');
  assert.equal(out[0].afterReply, true); // the turn keeps where it began
  assert.equal(out[0].overlap, true);
});

test('joins stop after a few, so a turn cannot be held for ever', async () => {
  const out = [];
  const h = new TurnHold({ judge: judgeOf(0.1), release: t => out.push(t), maxJoins: 2 });
  await h.offer(turn('a'), 0);
  await h.offer(turn('b'), 10);
  assert.equal(out.length, 0);
  await h.offer(turn('c'), 20);
  assert.equal(out.length, 1);
  assert.equal(out[0].pcm.toString(), 'abc');
});

function fakeWorker({ magic = 'TRN1', answer = 0.25 } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = () => child.emit('exit', 1);
  child.got = [];
  child.stdin.on('data', d => {
    child.got.push(d);
    const b = Buffer.alloc(4);
    b.writeFloatLE(answer, 0);
    setImmediate(() => child.stdout.emit('data', b));
  });
  setImmediate(() => child.stdout.emit('data', Buffer.from(magic)));
  return child;
}

test('the judge sends the last eight seconds and reads back a chance', async () => {
  let child;
  const j = makeTurnJudge({ exists: () => true, spawn: () => (child = fakeWorker()) });
  await new Promise(r => setImmediate(r));
  assert.equal(j.active, true);
  const pcm = Buffer.alloc(16000 * 10 * 2);
  assert.equal(await j.done(pcm), 0.25);
  const sent = Buffer.concat(child.got);
  assert.equal(sent.readUInt32LE(0), 16000 * 8);
  assert.equal(sent.length, 4 + 16000 * 8 * 2);
});

test('a judge that never starts or dies answers null', async () => {
  assert.equal(await makeTurnJudge({ exists: () => false }).done(Buffer.alloc(4)), null);
  let child;
  const j = makeTurnJudge({ exists: () => true, spawn: () => (child = fakeWorker({ magic: 'nope' })) });
  await new Promise(r => setImmediate(r));
  assert.equal(j.active, false);
  assert.equal(await j.done(Buffer.alloc(4)), null);
});
