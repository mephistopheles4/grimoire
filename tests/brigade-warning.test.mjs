// The permission warning's wording module, tested at its own seam: plain
// values in, plain values out. The band itself is drawn by brigade/warning.tsx
// and tested under the engine's own runner, which runs on your machine only.
//
// The module is TypeScript. Node 24, the repository's floor, imports it as it
// is, with type stripping on by default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MINIMUM = '24';
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  throw new Error(
    `tests/brigade-warning.test.mjs needs Node ${MINIMUM} or later, which imports TypeScript as it is; this is Node ${process.versions.node}. See CONTRIBUTING.md.`,
  );
}

const { TITLE, RISKS, ALSO, WORDING, versionOf, isAcknowledged } = await import('../brigade/warning-text.ts');

test("the warning's wording is pinned as the head-chef contract gives it at 1.7.0", () => {
  assert.equal(TITLE, 'Head chef is on. Two things to know:');
  assert.deepEqual(RISKS, [
    'Any device signed in to your account can drive the sessions it starts while Remote Control is on.',
    'Those sessions trust any message that claims to come from it, and any comment on their issue made as you.',
  ]);
  assert.equal(
    ALSO,
    'It also starts sessions and relays between them. It merges, posts, waives reviews, settles security findings and records accepted risks on your word, or on its own toward a goal at a level 3 you confirmed in its chat, a merge that eases a control included; it cleans up only on your typed /brigade done, and removes only what the pact\'s cleaner finds it can recover.',
  );
});

// The skill says the warning in chat when the mod cannot draw it, so its copy
// must be the band's, word for word: a quoted block of "> " lines, each "- "
// line a risk, wrapped lines joined with one space.
test("the head-chef skill's chat copy of the warning is the band's wording", () => {
  const skill = readFileSync(new URL('../skills/head-chef/SKILL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = skill.split('\n## The permission warning\n')[1]?.split('\n\n').find(p => p.startsWith('> '));
  assert.ok(block, 'SKILL.md quotes the warning under "## The permission warning"');
  const lines = [];
  for (const raw of block.split('\n').map(l => l.replace(/^>\s?/, ''))) {
    if (raw === '') lines.push('');
    else if (raw.startsWith('- ') || lines.length === 0 || lines.at(-1) === '') lines.push(raw.replace(/^- /, ''));
    else lines[lines.length - 1] += ` ${raw.trim()}`;
  }
  assert.deepEqual(lines.filter(l => l !== ''), [...WORDING]);
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
