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
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, check, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-check-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;

// A copy of everything check.mjs reads: the script, the renderer and its
// module, one box file to validate, both manifests, and .gitignore — the walk
// reads that file to decide what it does not enter.
function tree() {
  const dir = join(work, `case-${n++}`);
  mkdirSync(dir);
  for (const part of ['scripts', 'skills', '.claude-plugin']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  cpSync(join(root, '.gitignore'), join(dir, '.gitignore'));
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

test('a stale worktree is not walked, because .gitignore excludes it', () => {
  // The walkers used a hardcoded skip set that did not know about
  // .claude/worktrees/, so the check descended into every stale worktree and
  // validated other checkouts of itself. 19 failures on the maintainer's
  // machine, 18 of them worktrees. CI never saw it: a fresh checkout has no
  // worktrees, so the gate was red locally and green everywhere it was
  // measured.
  const dir = tree();
  const stale = join(dir, '.claude', 'worktrees', 'older-branch');
  mkdirSync(join(stale, 'skills', 'eagle-eye'), { recursive: true });
  writeFileSync(join(stale, 'a.box.json'), '{"title":"not a box"}');
  writeFileSync(join(stale, 'skills', 'eagle-eye', 'SKILL.md'), 'no frontmatter, and ~/.claude/skills/ as well\n');
  assertPasses(dir);
});

test('a tree with no .gitignore says so rather than skipping in silence', () => {
  // A walk that quietly skips nothing reads as a walk that found everything.
  const dir = tree();
  rmSync(join(dir, '.gitignore'));
  assert.match(assertPasses(dir).stdout, /no \.gitignore/);
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

test('a fixed path in any file a skill ships fails, not only in its prose', () => {
  // Filtered to SKILL.md, the three patterns never ran against lib/,
  // reference/, the renderer or the schema. A hardcoded home directory
  // anywhere but the skill's own prose passed the gate that exists to catch it.
  const dir = tree();
  appendFileSync(join(dir, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'), '\n// installed at /home/someone/.claude/skills\n');
  assertFails(dir, /lib\/eagle-eye\.js:\d+ holds a fixed path/);
});

test('a fixed path outside skills/ does not fail, because nothing ships it', () => {
  // The rule is about what lands on somebody else's computer under an install
  // route nobody here chooses. A repository script is not that, and this
  // file's own tests carry two of the patterns on purpose.
  const dir = tree();
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), '\n// a note naming ~/.claude/skills/, shipped to nobody\n');
  assertPasses(dir);
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

test('a code fence with no language fails, naming the file and the line', () => {
  const dir = tree();
  const p = skillMd(dir);
  const lines = readFileSync(p, 'utf8').split('\n');
  // The file ends with a newline, so the last element is empty and the fence
  // lands on the next line down. Held as an index rather than searched for: a
  // search finds the first bare ``` in the file, which is a closing fence.
  const fenceLine = lines.length + 1;
  lines.push('```', 'a block that says nothing about itself', '```', '');
  writeFileSync(p, lines.join('\n'));
  assert.equal(lines[fenceLine - 1], '```');
  assertFails(dir, new RegExp(`SKILL\\.md:${fenceLine} opens a code fence with no language`));
});

test('a fence that declares a language passes', () => {
  const dir = tree();
  appendFileSync(skillMd(dir), '\n```bash\nnode scripts/check.mjs\n```\n');
  assertPasses(dir);
});

test('a closing fence is not read as a bare opening fence', () => {
  // The rule started as a per-line regex, which reported every closing fence
  // in the tree: sixteen hits, thirteen of them closing. This is the test that
  // says the state machine is the point.
  const dir = tree();
  appendFileSync(skillMd(dir), '\n```text\nfirst\n```\n\n```text\nsecond\n```\n');
  assertPasses(dir);
});

test('a tilde fence inside a backtick block does not close it', () => {
  const dir = tree();
  appendFileSync(skillMd(dir), '\n```text\n~~~\nstill inside\n~~~\n```\n');
  assertPasses(dir);
});

test('a longer fence may hold a shorter one, which does not close it', () => {
  // CommonMark closes a fence on the same character at the same length or
  // longer. Holding only the character, the inner ``` closed the outer block
  // and the example's own closing fence then read as a new bare one — the rule
  // failing correct markdown. This repository documents fenced blocks, so that
  // file is one somebody here would write.
  const dir = tree();
  appendFileSync(skillMd(dir), '\n````markdown\n```\nan inner example fence\n```\n````\n');
  assertPasses(dir);
});

test('a bare fence after a nested block is still caught', () => {
  // The other half of the same fix. Getting the nesting right must not buy
  // silence: the rule still has to see the bare fence that follows.
  const dir = tree();
  const lines = readFileSync(skillMd(dir), 'utf8').split('\n');
  const added = ['````markdown', '```', 'an inner example fence', '```', '````', '', '```', 'genuinely bare', '```', ''];
  // The bare fence is the seventh line added, and lines.length is its 0-based
  // offset. Derived from the block rather than counted by hand.
  const fenceLine = lines.length + added.indexOf('```', 6) + 1;
  lines.push(...added);
  writeFileSync(skillMd(dir), lines.join('\n'));
  assert.equal(lines[fenceLine - 1], '```');
  assertFails(dir, new RegExp(`SKILL\\.md:${fenceLine} opens a code fence with no language`));
});

test('a tests path that is not a directory fails rather than reading as absent', () => {
  // A bare catch reported every error as a missing directory, so a suite that
  // could not be read passed under a reassuring note.
  const dir = tree();
  writeFileSync(join(dir, 'tests'), 'not a directory\n');
  const r = run(checkIn(dir), [], { cwd: dir, env: { GRIMOIRE_IN_TEST: null } });
  assert.notEqual(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(/no tests\/ directory/.test(r.stdout), false, 'must not report a missing directory');
});

// The version-bump rule needs a merge base, so the two tests below build one.
// Every other test in this file runs against a copy with no .git at all, which
// puts the rule on its "cannot resolve" path and proves only that it says so.
function repo(dir) {
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

test('a skill change with no version bump fails', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(skillMd(dir), '\nOne more sentence, shipped to nobody.\n');
  git('commit', '-aqm', 'change the skill');
  const r = assertFails(dir, /skill file\(s\) changed since origin\/main, but version is still/);
  assert.match(r.stderr, /plugin users receive no update/);
});

test('the same skill change passes once the version moves', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(skillMd(dir), '\nOne more sentence, and a release to carry it.\n');
  const p = join(dir, '.claude-plugin', 'plugin.json');
  const m = readJson(p);
  m.version = '99.0.0';
  writeJson(p, m);
  git('commit', '-aqm', 'change the skill and bump the version');
  assertPasses(dir);
});

test('a change outside skills/ needs no bump', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), '\n// a comment, releasing nothing\n');
  git('commit', '-aqm', 'touch a script');
  assertPasses(dir);
});

test('a failing test file fails the whole check', () => {
  // The gate has to bite. Without this, "check.mjs runs the tests" could be
  // true and worthless.
  //
  // Safe to clear the recursion guard here, because the copy carries only the
  // one test file written below, and that file spawns nothing.
  const dir = tree();
  mkdirSync(join(dir, 'tests'));
  writeFileSync(
    join(dir, 'tests', 'red.test.mjs'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberately red', () => assert.equal(1, 2));\n",
  );
  const r = run(checkIn(dir), [], { cwd: dir, env: { GRIMOIRE_IN_TEST: null } });
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /the test suite failed/);
});

test('a passing test file passes the whole check', () => {
  const dir = tree();
  mkdirSync(join(dir, 'tests'));
  writeFileSync(
    join(dir, 'tests', 'green.test.mjs'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberately green', () => assert.equal(1, 1));\n",
  );
  const r = run(checkIn(dir), [], { cwd: dir, env: { GRIMOIRE_IN_TEST: null } });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /running 1 test file\(s\)/);
});

test('an empty tests directory says so rather than passing in silence', () => {
  const dir = tree();
  mkdirSync(join(dir, 'tests'));
  const r = run(checkIn(dir), [], { cwd: dir, env: { GRIMOIRE_IN_TEST: null } });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /tests\/ holds no \*\.test\.mjs file/);
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
