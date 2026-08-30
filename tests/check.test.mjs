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

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, check, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-check-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;

// A copy of everything check.mjs reads: the script, the renderer and its
// module, one box file to validate, and both manifests.
function tree() {
  const dir = join(work, `case-${n++}`);
  mkdirSync(dir);
  for (const part of ['scripts', 'skills', '.claude-plugin']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  return dir;
}

const checkIn = dir => join(dir, 'scripts', 'check.mjs');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
const skillMd = dir => join(dir, 'skills', 'eagle-eye', 'SKILL.md');

function assertPasses(dir) {
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  return r;
}

// Fails with this message, rather than merely fails. A check that goes red for
// the wrong reason is a check nobody can act on.
function assertFails(dir, pattern) {
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1, `expected a failure, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  return r;
}

test('the real repository passes its own check', () => {
  const r = run(check);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^ok: \d+ box file\(s\), \d+ plugin\(s\)$/m);
});

test('an untouched copy of the tree passes', () => {
  assertPasses(tree());
});

test('a copy with no git history says the version check was skipped', () => {
  // The rule cannot run without a merge base. It has to say so out loud: a
  // check that quietly does nothing is indistinguishable from one that passed.
  assert.match(assertPasses(tree()).stdout, /version bump check skipped/);
});

test('a box file that does not validate fails the check by name', () => {
  const dir = tree();
  const box = join(dir, 'skills', 'eagle-eye', 'examples', 'eagle-eye-skill.box.json');
  const b = readJson(box);
  b.dims[0].opts[1].chosen = true;
  writeJson(box, b);
  const r = assertFails(dir, /failed --check/);
  assert.match(r.stderr, /exactly one option must be chosen/);
});

test('a tree with no box file fails, rather than passing with nothing to check', () => {
  const dir = tree();
  rmSync(join(dir, 'skills', 'eagle-eye', 'examples'), { recursive: true, force: true });
  assertFails(dir, /no \*\.box\.json found/);
});

test('a fixed home path in a SKILL.md fails', () => {
  const dir = tree();
  appendFileSync(skillMd(dir), '\nPut the file in ~/.claude/skills/eagle-eye/ and run it.\n');
  assertFails(dir, /holds a fixed path/);
});

test('a fixed Windows path in a SKILL.md fails', () => {
  const dir = tree();
  appendFileSync(skillMd(dir), '\nOpen C:\\Users\\someone\\box.json first.\n');
  assertFails(dir, /holds a fixed path/);
});

test('a fixed path inside a block quote does not fail, because it is an example', () => {
  const dir = tree();
  appendFileSync(skillMd(dir), '\n> Never write ~/.claude/skills/ into a skill.\n');
  assertPasses(dir);
});

test('a SKILL.md with no frontmatter name fails', () => {
  const dir = tree();
  const p = skillMd(dir);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^name:.*$/m, 'nombre: eagle-eye'));
  assertFails(dir, /no frontmatter name/);
});

test('a skill directory with no SKILL.md fails', () => {
  const dir = tree();
  mkdirSync(join(dir, 'skills', 'newcomer'));
  writeFileSync(join(dir, 'skills', 'newcomer', 'README.md'), 'nothing here yet\n');
  assertFails(dir, /skills\/newcomer\/ has no SKILL\.md/);
});

test('the single-pass tag strip cannot come back', () => {
  // CodeQL raised this shape twice on the first scan. The guard holds the
  // shape, not the hole, and this test holds the guard.
  const dir = tree();
  const p = join(dir, 'skills', 'eagle-eye', 'render.mjs');
  // Assembled from two pieces on purpose. Written whole, this line would match
  // the guard in this file as well, and the suite would fail its own check.
  const singlePass = '\nconst naive = s => s.replace(/<[^' + '>]+>/g, "");\n';
  writeFileSync(p, readFileSync(p, 'utf8') + singlePass);
  assertFails(dir, /strips tags in one pass/);
});

test('a marketplace entry that names a different plugin fails', () => {
  const dir = tree();
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  m.plugins[0].name = 'not-grimoire';
  writeJson(p, m);
  assertFails(dir, /marketplace\.json calls the plugin/);
});

test('a marketplace entry that carries its own version fails', () => {
  // Two copies of a version drift. plugin.json is the one place it lives.
  const dir = tree();
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  m.plugins[0].version = '9.9.9';
  writeJson(p, m);
  assertFails(dir, /drop "version"/);
});

test('a marketplace entry that points somewhere other than the repo root fails', () => {
  const dir = tree();
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  m.plugins[0].source = './skills/eagle-eye';
  writeJson(p, m);
  assertFails(dir, /this repo is one plugin, so it must be "\.\/"/);
});

test('a shelf and a book with the same name fail', () => {
  const dir = tree();
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  m.name = readJson(join(dir, '.claude-plugin', 'plugin.json')).name;
  writeJson(p, m);
  assertFails(dir, /give the shelf and the book different names/);
});

test('the check reports every failure at once, not the first one', () => {
  // A gate that stops at the first problem costs a round trip per problem.
  const dir = tree();
  appendFileSync(skillMd(dir), '\nSee ~/.claude/skills/ for the file.\n');
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  m.plugins[0].version = '9.9.9';
  writeJson(p, m);
  const r = assertFails(dir, /2 failure\(s\)/);
  assert.match(r.stderr, /holds a fixed path/);
  assert.match(r.stderr, /drop "version"/);
});

test('the check runs this test suite as its last step', () => {
  // The one command in CONTRIBUTING is the whole contract. A test suite that
  // needs a second command is a test suite a contributor does not run.
  //
  // This asserts the wiring, not the result: the assertion is already running
  // inside that step, so GRIMOIRE_IN_TEST is set and the child does not start
  // the suite again. What it can prove is that check.mjs says which step it is
  // on, rather than skipping in silence.
  const r = run(check);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /tests already running/);
});

test('a tree with no tests directory says so instead of failing', () => {
  // A copy of this repository without tests/ is a real state — tree() makes
  // one — and the check has to survive it with a word rather than a crash.
  //
  // This is the one place the recursion guard is cleared, so the test step
  // actually runs. It is safe here and nowhere else: the copy has no tests/,
  // so there is nothing for the child to start.
  const dir = tree();
  const r = run(checkIn(dir), [], { cwd: dir, env: { GRIMOIRE_IN_TEST: null } });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /no tests\//);
});
