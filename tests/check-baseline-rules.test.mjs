// Tests of scripts/check.mjs: what a SkillSpector baseline may hold. The
// fixture they share, and why every case copies the tree, is in
// check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tree, rootBaselineIn, skillBaselineIn, fixtureBaselineIn, assertPasses, assertFails, baselineBody } from './check-fixture.mjs';

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
    'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    severity: "LOW"\n    reason: "x"\n',
  );
  assertFails(dir, /unknown field "severity"/);
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
  // each one is narrowed the same way.
  const dir = tree();
  for (const p of [rootBaselineIn(dir), skillBaselineIn(dir), fixtureBaselineIn(dir)]) {
    const text = readFileSync(p, 'utf8');
    writeFileSync(p, text.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "*SKILL.md"\n'));
  }
  assertPasses(dir);
});

test('a rule narrowed to a message in one baseline and not the other fails', () => {
  // A message glob narrows a suppression the way a file glob does: the
  // scanner suppresses a finding only when its message, finding or matched
  // text matches. So the same rule with different message globs is not
  // agreement either.
  const dir = tree();
  const skill = readFileSync(skillBaselineIn(dir), 'utf8');
  writeFileSync(skillBaselineIn(dir), skill.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    message: "*preview pane*"\n'));
  assertFails(dir, /matched to \*preview pane\* here and to every message/);
});

test('a rule narrowed to the same message in both baselines passes', () => {
  const dir = tree();
  for (const p of [rootBaselineIn(dir), skillBaselineIn(dir), fixtureBaselineIn(dir)]) {
    const text = readFileSync(p, 'utf8');
    writeFileSync(p, text.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "*SKILL.md"\n    message: "*preview pane*"\n'));
  }
  assertPasses(dir);
});

test('a disagreeing glob is printed masked, because the CI log is public', () => {
  // The root baseline sits outside skills/, so the home-path rule never reads
  // it. A message glob is the field most likely to hold pasted matched text.
  const dir = tree();
  const root = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), root.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "/Users/someone/*"\n    message: "*C:/Users/someone/box*"\n'));
  const r = assertFails(dir, /matched to every message here and to \*C:\/Users\/<name>\/box\* in/);
  assert.match(r.stderr, /narrowed to every file here and to \/Users\/<name>\/\* in/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('a disagreeing glob on the skill side is printed masked too', () => {
  // The same two lines print the skill's glob as well, so the mask is held on
  // that side by its own case.
  const dir = tree();
  const skill = readFileSync(skillBaselineIn(dir), 'utf8');
  writeFileSync(skillBaselineIn(dir), skill.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    file: "/Users/someone/*"\n    message: "*C:/Users/someone/box*"\n'));
  const r = assertFails(dir, /matched to \*C:\/Users\/<name>\/box\* here and to every message in/);
  assert.match(r.stderr, /narrowed to \/Users\/<name>\/\* here and to every file in/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('a value the reader refuses is printed masked too', () => {
  // A Windows path in double quotes holds backslashes, which this reader
  // refuses. The refusal names the value, and the root file is read by no
  // home-path rule, so the mask has to be on this line.
  const dir = tree();
  const root = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), root.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    message: "*C:\\Users\\someone\\box*"\n'));
  const r = assertFails(dir, /"message" is not a plainly double-quoted value/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('two different messages for one rule fail, not only a message on one side', () => {
  // Both sides narrowed is not agreement unless they narrow the same way: a
  // root that matches more than the skill would suppress more than it says.
  const dir = tree();
  for (const [p, glob] of [[rootBaselineIn(dir), '*preview pane*'], [skillBaselineIn(dir), '*preview*'], [fixtureBaselineIn(dir), '*preview pane*']]) {
    const text = readFileSync(p, 'utf8');
    writeFileSync(p, text.replace('  - rule_id: "AR2"\n', `  - rule_id: "AR2"\n    message: "${glob}"\n`));
  }
  assertFails(dir, /matched to \*preview\* here and to \*preview pane\* in/);
});

// The reader and SkillSpector's YAML loader must agree on what an entry says.
// Each case below is a spelling they read differently, so two files could agree
// in the check while the scanner applied a broader suppression than either
// appears to say.
function rootWith(dir, fields) {
  writeFileSync(rootBaselineIn(dir), `version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n${fields}    reason: "x"\n`);
}

test('a bare entry value with a trailing comment fails, because YAML ends the value at the comment', () => {
  const dir = tree();
  rootWith(dir, '    message: preview pane # a note\n');
  assertFails(dir, /"message" must be double-quoted/);
});

test('a bare rule_id or reason fails too', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: AR2\n    reason: "x"\n');
  assertFails(dir, /"rule_id" must be double-quoted/);
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    reason: x\n');
  assertFails(dir, /"reason" must be double-quoted/);
});

test('a file or message written as a YAML null fails, because the scanner reads it as no narrowing', () => {
  for (const nul of ['~', 'null']) {
    for (const key of ['file', 'message']) {
      const dir = tree();
      rootWith(dir, `    ${key}: ${nul}\n`);
      assertFails(dir, new RegExp(`"${key}" must be double-quoted`));
    }
  }
});

test('a rule_id with a wildcard fails, because the scanner reads it as a pattern', () => {
  for (const id of ['A*', 'AR?', 'A[RS]2', '*']) {
    const dir = tree();
    writeFileSync(rootBaselineIn(dir), `version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "${id}"\n    reason: "x"\n`);
    assertFails(dir, /"rule_id" holds a wildcard/);
  }
});

test('a file or message made only of wildcard characters fails, because it narrows nothing', () => {
  for (const key of ['file', 'message']) {
    for (const glob of ['*', '**', '?*', '[*]']) {
      const dir = tree();
      rootWith(dir, `    ${key}: "${glob}"\n`);
      assertFails(dir, new RegExp(`"${key}" is empty or made only of wildcard characters`));
    }
  }
});

test('a quoted version is read, because the entries accept quoting too', () => {
  const dir = tree();
  const text = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), text.replace('version: 2', 'version: "2"'));
  assertPasses(dir);
});
