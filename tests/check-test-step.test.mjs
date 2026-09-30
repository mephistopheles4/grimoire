// Tests of scripts/check.mjs: the test step. The fixture they share, and why
// every case copies the tree, is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, run } from './helpers.mjs';
import { tree, checkIn } from './check-fixture.mjs';

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
