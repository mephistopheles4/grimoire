// Tests of scripts/check.mjs: what a SkillSpector baseline may hold. The
// fixture they share, and why every case copies the tree, is in
// check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers.mjs';
import { tree, rootBaselineIn, skillBaselineIn, fixtureBaselineIn, assertPasses, assertFails, formatCheckIn, baselineBody } from './check-fixture.mjs';

test('the same rule twice in one baseline fails', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    baselineBody([
      { id: 'AR2', reason: 'One argument.' },
      { id: 'AR2', reason: 'A second argument.' },
    ]),
  );
  assertFails(dir, /AR2 appears twice/);
});

test('an unknown top-level key is named, not ignored', () => {
  // The reader is hand-written and reads one shape. A key it does not know is
  // a key it cannot honour, and honouring nothing quietly is how a baseline
  // grows a field that does nothing.
  const dir = tree();
  appendFileSync(rootBaselineIn(dir), '\nseverity_floor: HIGH\n');
  assertFails(dir, /unknown key "severity_floor"/);
});

test('an unknown field inside a rule entry is named', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    message: "*preview*"\n    reason: "x"\n',
  );
  assertFails(dir, /unknown field "message"/);
});

test('a nested value the reader cannot follow fails rather than being skipped', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    reason:\n      - "x"\n',
  );
  assertFails(dir, /not a "key: value" field|not a rule entry/);
});

test('an empty rules block fails, because a baseline that suppresses nothing is not one', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n');
  assertFails(dir, /no rules/);
});

test('a rule narrowed to a file in one baseline and not the other fails', () => {
  // A file glob narrows a suppression, so the same rule with different scopes
  // is not agreement. Comparing the reason alone let one file suppress AR2
  // everywhere while the other suppressed it in one place, and called that
  // agreement.
  const dir = tree();
  const skill = readFileSync(skillBaselineIn(dir), 'utf8');
  writeFileSync(skillBaselineIn(dir), skill.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "*SKILL.md"\n'));
  assertFails(dir, /narrowed to \*SKILL\.md here and to every file/);
});

test('a rule narrowed to the same file in both baselines passes', () => {
  // Every skill baseline that suppresses AR2 is compared with the root, so
  // each one is narrowed the same way. eagle-eye's baseline sits inside its
  // sealed folder, so the copy's own format check seals it again after the edit.
  const dir = tree();
  for (const p of [rootBaselineIn(dir), skillBaselineIn(dir), fixtureBaselineIn(dir)]) {
    const text = readFileSync(p, 'utf8');
    writeFileSync(p, text.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "*SKILL.md"\n'));
  }
  const reseal = run(formatCheckIn(dir), ['--seal', join(dir, 'skills', 'eagle-eye')], { cwd: dir });
  assert.equal(reseal.code, 0, `eagle-eye did not seal again:\n${reseal.stdout}${reseal.stderr}`);
  assertPasses(dir);
});

test('a quoted version is read, because the entries accept quoting too', () => {
  const dir = tree();
  const text = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), text.replace('version: 2', 'version: "2"'));
  assertPasses(dir);
});
