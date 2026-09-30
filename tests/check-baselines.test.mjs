// Tests of scripts/check.mjs: the two SkillSpector baselines agree. The
// fixture they share, and why every case copies the tree, is in
// check-fixture.mjs.

import { test } from 'node:test';
import { rmSync, readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { baselineName, tree, rootBaselineIn, skillBaselineIn, assertPasses, assertFails } from './check-fixture.mjs';

// Rule 7: the two SkillSpector baselines agree.
//
// The baselines are the argument for every finding this repository has decided
// is wrong, and the workflow fails on anything they do not cover. So the
// failure worth testing is not a scan — it is a suppression that stopped
// meaning what it says: a reason reworded in one file, a rule added to one and
// not the other, a fingerprint creeping in, or a shape the hand-written reader
// would have to guess at.
//
// No scan runs here. The scanner is a Python tool that installs on a runner,
// and this repository has no install step.

test('the two baselines as shipped agree', () => {
  assertPasses(tree());
});

test('a reason reworded in one baseline and not the other fails', () => {
  // This is the drift the rule exists for. Both files still suppress AR2, and
  // a reader comparing them now gets two different arguments for it.
  const dir = tree();
  const skill = readFileSync(skillBaselineIn(dir), 'utf8');
  writeFileSync(skillBaselineIn(dir), skill.replace(/reason: "False positive\./, 'reason: "Accepted.'));
  assertFails(dir, /gives a different reason here/);
});

test('a rule suppressed in the skill and not at the root fails', () => {
  const dir = tree();
  appendFileSync(skillBaselineIn(dir), '  - rule_id: "ZZ1"\n    reason: "Not argued anywhere else."\n');
  assertFails(dir, /ZZ1 is suppressed here and not at the repository root/);
});

test('a rule suppressed at the root and not in the skill passes', () => {
  // The root covers the whole tree and the skill covers one directory, so the
  // root is a superset by design. Only the overlap has to match.
  const dir = tree();
  appendFileSync(rootBaselineIn(dir), '  - rule_id: "ZZ1"\n    reason: "Fires outside the skill only."\n');
  assertPasses(dir);
});

test('a missing baseline at the repository root fails', () => {
  const dir = tree();
  rmSync(rootBaselineIn(dir));
  assertFails(dir, /missing from the repository root/);
});

test('a tree with no baseline under any skill fails', () => {
  // A reader who scans a skill rather than the repository finds no baseline
  // and no reasons, which is the state this file exists to end.
  //
  // The rule is tree-level rather than per skill, and that is a limit rather
  // than an oversight: only the scanner knows which directory a finding lands
  // in, so nothing here can say which skills need a baseline of their own. It
  // catches the practice being abandoned wholesale, and the agreement rules
  // below cover every baseline that does ship. Every skill in the copy carries
  // one today, the test fixture included, so this test removes them all.
  const dir = tree();
  for (const skill of readdirSync(join(dir, 'skills'))) {
    const p = join(dir, 'skills', skill, baselineName);
    if (existsSync(p)) rmSync(p);
  }
  assertFails(dir, /a reader who scans the skill/);
});

test('one skill keeping its baseline is not enough to excuse the other', () => {
  // Stated as the limit it is: with eagle-eye's baseline still there, removing
  // groundtrack's passes here. It fails in the SkillSpector workflow instead,
  // which scans groundtrack with groundtrack's own file and names the findings
  // it no longer suppresses. Only the scanner's report knows that, and the
  // report lives on the runner rather than here.
  const dir = tree();
  rmSync(join(dir, 'skills', 'groundtrack', baselineName));
  assertPasses(dir);
});

test('a fingerprint suppression fails, because it expires without saying so', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    'version: 2\nfingerprints: [one]\n\nrules:\n  - rule_id: "AR2"\n    reason: "x"\n',
  );
  assertFails(dir, /fingerprints is/);
});

test('a baseline with no version fails rather than being read as version 2', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'fingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    reason: "x"\n');
  assertFails(dir, /version is absent/);
});

test('a rule with no reason fails, because a suppression nobody can audit is noise', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n');
  assertFails(dir, /has no reason/);
});
