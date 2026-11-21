// The instant acknowledgement of the sherpa trial (grimoire 646): the listener
// says one short spinner word the moment a turn is heard, a different one each
// time, so the person never waits in silence and never hears the same opener twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPINNERS, pickSpinner } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/listen.mjs';

test('the spinner words are short lines, one per entry', () => {
  assert.ok(SPINNERS.length >= 6);
  for (const w of SPINNERS) assert.ok(w.split(/\s+/).length <= 4, w);
  assert.equal(new Set(SPINNERS).size, SPINNERS.length);
});

test('a pick never repeats the one before it', () => {
  for (let last = 0; last < 5; last++) {
    for (const r of [0, 0.2, 0.5, 0.99]) {
      const i = pickSpinner(5, last, () => r);
      assert.notEqual(i, last);
      assert.ok(i >= 0 && i < 5);
    }
  }
});

test('every word can come up, and one word alone still plays', () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) seen.add(pickSpinner(5, -1, () => k / 40));
  assert.equal(seen.size, 5);
  assert.equal(pickSpinner(1, 0, () => 0.5), 0);
});
