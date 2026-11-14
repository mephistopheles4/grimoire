// Tests of meter.mjs (docs/spec/incantation.md, T16): the mic's loudness as a
// row of digits, numbers only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METER, Meter, digit, levelsLine } from '../plugins/incantation/skills/incantation/scripts/meter.mjs';

test('a level is a digit from 0 to 8 on the scale from -60 to -15 dBFS, and silence is 0', () => {
  assert.equal(digit(-100), 0);
  assert.equal(digit(-60), 0);
  assert.equal(digit(NaN), 0);
  assert.equal(digit(undefined), 0);
  assert.equal(digit(-15), 8);
  assert.equal(digit(0), 8);
  assert.equal(digit(-37.5), 4);
  const seen = new Set();
  for (let db = -70; db <= 0; db += 0.5) seen.add(digit(db));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a bucket closes every 250 ms with its loudest frame, and the row keeps the last 24', () => {
  const m = new Meter();
  assert.equal(m.digits, '0'.repeat(24));
  let closed = 0;
  for (let t = 0; t < 1000; t += 30) if (m.add(t === 90 ? -15 : -100, t)) closed++;
  assert.equal(closed, 3, 'buckets close at 270, 540 and 810 ms');
  assert.equal(m.digits.length, METER.bars);
  assert.match(m.digits, /^0{21}800$/, 'the loud frame was in the first bucket');
  for (let t = 1000; t < 10_000; t += 30) m.add(-20, t);
  assert.equal(m.digits.length, METER.bars);
  assert.match(m.digits, /^[0-8]{24}$/);
});

test('a muted mic reads 0 in every bucket', () => {
  const m = new Meter();
  for (let t = 0; t < 3000; t += 30) m.add(-15, t, true);
  assert.equal(m.digits, '0'.repeat(24));
});

test('the line holds the stamp, the word and the digits, and nothing else', () => {
  assert.equal(levelsLine(1700000000000, 'hearing', '000012345678000012345678'), '1700000000000 hearing 000012345678000012345678\n');
});
