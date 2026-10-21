// The permission warning's wording module, tested at its own seam: plain
// values in, plain values out. The band itself is drawn by brigade/warning.tsx
// and tested under the engine's own runner, which runs on your machine only.
//
// The module is TypeScript. Node 24, the repository's floor, imports it as it
// is, with type stripping on by default.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const MINIMUM = '24';
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  throw new Error(
    `tests/brigade-warning.test.mjs needs Node ${MINIMUM} or later, which imports TypeScript as it is; this is Node ${process.versions.node}. See CONTRIBUTING.md.`,
  );
}

const { TITLE, RISKS, ALSO, WORDING, versionOf, isAcknowledged } = await import('../brigade/warning-text.ts');

test('the warning says what the head-chef contract says, word for word', () => {
  assert.equal(TITLE, 'Head chef is on. Two things to know:');
  assert.deepEqual(RISKS, [
    'Any device signed in to your account can drive the sessions it starts while Remote Control is on.',
    'Those sessions trust any message that claims to come from it.',
  ]);
  assert.equal(ALSO, 'It also starts sessions, relays between them, and merges or cleans up on your word.');
});

test('the version is stable for one wording and moves when any line changes', () => {
  assert.equal(versionOf(WORDING), versionOf([...WORDING]));
  assert.match(versionOf(WORDING), /^[0-9a-f]{8}$/);
  assert.notEqual(versionOf([...WORDING.slice(0, -1), `${WORDING.at(-1)}.`]), versionOf(WORDING));
  assert.notEqual(versionOf([WORDING[1], WORDING[0], ...WORDING.slice(2)]), versionOf(WORDING));
});

test('only an acknowledgement of the current wording hides the warning for good', () => {
  const version = versionOf(WORDING);
  assert.equal(isAcknowledged({ at: '2026-10-21T12:00:00.000Z', version }, version), true);
  assert.equal(isAcknowledged({ at: '2026-10-21T12:00:00.000Z', version: '00000000' }, version), false);
  for (const stored of [undefined, null, 'yes', 1, {}, { version }, { at: 1, version }, { at: '2026-10-21', version: 7 }]) {
    assert.equal(isAcknowledged(stored, version), false, JSON.stringify(stored));
  }
});
