// scripts/check.mjs is the whole contract, so it is the thing most worth
// testing. A gate that silently does nothing reads as a gate that passed.
//
// Each test copies the parts of the tree the check reads into a temporary
// directory, breaks exactly one thing, and asserts the check says so. The copy
// is not decoration: check.mjs finds the repository root from its own file
// location, so it cannot be pointed at a fixture any other way. That is also
// why every mutation test runs the copy's own scripts/check.mjs — running this
// repository's would quietly check this repository and pass every time.
//
// The copy has no .git, which puts the version-bump rule on its "cannot
// resolve" path. That path is asserted here too, because a skipped check that
// says nothing is the failure this repository already wrote a commit about.

// The shared fixture for the tests of scripts/check.mjs. The tests are split
// across tests/check-*.test.mjs by topic so that node --test runs them in
// parallel; one file ran them one after another and set the length of the
// whole gate. Nothing here is a test.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './helpers.mjs';

export const work = mkdtempSync(join(tmpdir(), 'grimoire-check-'));

after(() => rmSync(work, { recursive: true, force: true }));

export let n = 0;

export const baselineName = '.skillspector-baseline.yaml';

// A copy of everything check.mjs reads: the script, the renderer and its
// module, one box file to validate, both manifests, the repository's
// SkillSpector baseline — the skill's own copy travels inside skills/ — and
// .gitignore, which the walk reads to decide what it does not enter.
export function tree() {
  const dir = join(work, `case-${n++}`);
  mkdirSync(dir);
  for (const part of ['scripts', 'skills', '.claude-plugin']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  // The mod's folders travel too, when the tree has them: plugin.json names
  // the mod's hooks file and contract, and the check fails a pointer to a file
  // that is not there. The engine's generated types under .claude-plugin/ are
  // excluded by .gitignore, so the walk skips them in the copy as here.
  for (const part of ['brigade', 'hooks']) {
    if (existsSync(join(root, part))) cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  cpSync(join(root, '.gitignore'), join(dir, '.gitignore'));
  cpSync(join(root, baselineName), join(dir, baselineName));
  // eagle-eye is sealed, so any edit to it breaks its mark. A test that edits
  // a skill and expects a pass edits this unsealed fixture instead. It carries a
  // copy of eagle-eye's baseline, so the two-baseline agreement rules see it too.
  const fixture = fixtureSkill(dir, 'unsealed-fixture');
  cpSync(join(root, 'skills', 'eagle-eye', baselineName), join(fixture, baselineName));
  return dir;
}

export const checkIn = dir => join(dir, 'scripts', 'check.mjs');

export const rootBaselineIn = dir => join(dir, baselineName);

export const skillBaselineIn = dir => join(dir, 'skills', 'eagle-eye', baselineName);

export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

export const skillMd = dir => join(dir, 'skills', 'eagle-eye', 'SKILL.md');

export const fixtureMd = dir => join(dir, 'skills', 'unsealed-fixture', 'SKILL.md');

export const fixtureBaselineIn = dir => join(dir, 'skills', 'unsealed-fixture', baselineName);

export const manifest = dir => join(dir, '.claude-plugin', 'plugin.json');

export const setVersion = (dir, v) => writeJson(manifest(dir), { ...readJson(manifest(dir)), version: v });

// A file of the mod, written into the copy at run time. The tests of the rules
// that cover the mod write the files they break here, the way the
// format-check tests write their fixture skills, so a test holds whatever the
// committed mod looks like. `rel` is a forward-slash
// path from the copy's root, such as 'brigade/hooks/register.tsx'.
export function modFile(dir, rel, text) {
  const p = join(dir, ...rel.split('/'));
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
  return p;
}

// An import line, assembled rather than written whole. Written whole, a line
// in this file would carry the shape the dependency rule reads, and the suite
// would fail its own check.
export const importLine = (names, spec) => `import ${names} from ${"'"}${spec}${"'"};\n`;

export function assertPasses(dir) {
  const r = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  return r;
}

// Fails with this message, rather than merely fails. A check that goes red for
// the wrong reason is a check nobody can act on.
export function assertFails(dir, pattern) {
  const r = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.equal(r.code, 1, `expected a failure, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  return r;
}

// ---- the format check over every skill ----
// check.mjs runs skills/contract/scripts/check.mjs on every skills/*/ folder.
// The fixture skills the format-check tests use (check-format.test.mjs) are
// written into the copy at run time and never committed: a SKILL.md anywhere
// in the tree is a skill to the check, and a broken one would fail it. Each is
// sealed by the copy's own format check, for the reason every test of
// scripts/check.mjs runs the copy's own check.mjs.

export const formatCheckIn = dir => join(dir, 'skills', 'contract', 'scripts', 'check.mjs');

export function fixtureSkill(dir, name, { contract, body = '# Fixture\n\nBody text.\n' } = {}) {
  const skill = join(dir, 'skills', name);
  mkdirSync(skill);
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: ${name}\ndescription: A fixture skill that exists only inside this test.\n---\n\n${body}`);
  if (contract !== undefined) {
    writeFileSync(join(skill, 'CONTRACT.md'), contract);
    const r = run(formatCheckIn(dir), ['--seal', skill], { cwd: dir });
    assert.equal(r.code, 0, `the fixture did not seal:\n${r.stdout}${r.stderr}`);
  }
  return skill;
}

export const fixtureContract = 'Version: 1.0.0\n\n# Contract\n\nWhat this fixture is for.\n';

// The control half of each format-check test is asserted on what the check
// says about the fixture, not on a pass of the whole tree, so it holds
// whatever else the tree carries.
export function assertFixtureClean(dir, name) {
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.doesNotMatch(r.stderr, new RegExp(`skills/${name}/`), `the fixture failed before anything was broken:\n${r.stderr}`);
  assert.match(r.stdout, new RegExp(`^ok {4}skills/${name}/ \\(format\\)$`, 'm'));
}

// The version-bump rule needs a merge base, so the tests in
// check-version.test.mjs build one. Every other test of scripts/check.mjs runs
// against a copy with no .git at all, which puts the rule on its "cannot
// resolve" path and proves only that it says so.
export function repo(dir) {
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
      cwd: dir,
      stdio: 'pipe',
    });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  // The rule compares against origin/main. A local ref standing in for the
  // remote one is what makes this testable with no network and no clone.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return git;
}

// Four tests in check-version.test.mjs move origin/main ahead of the branch,
// which is the shape the rule could not see while it read the version at the
// merge base only. `reset --soft` is what builds it: it rewinds the branch to
// the fork point and leaves the newer commit's tree in the working directory,
// so the branch carries the same edit the base just took. A checkout would
// rewrite the working tree, and the check reads plugin.json from there.
export function baseMovesAhead(git, edit) {
  edit();
  git('commit', '-aqm', 'the sibling branch that landed first');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('reset', '-q', '--soft', 'HEAD~1');
}

export const baselineBody = rules =>
  `version: 2\nfingerprints: []\n\nrules:\n${rules.map(r => `  - rule_id: "${r.id}"\n    reason: "${r.reason}"\n`).join('')}`;
