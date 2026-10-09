// Tests of the tracked-file rule in scripts/check.mjs: a file git tracks and
// the walk skips ships, and no rule reads it. The walk reads .gitignore with
// its own reader, so the rule compares what git tracks with what the walk read.
//
// Each case makes the copied tree a repository of its own. Every git call, and
// the check it runs, gets an environment with the developer's git settings
// taken out: no GIT_* variable from the shell, an empty global and system
// config, a home folder inside the temporary directory, and a placeholder
// author. So a global excludes file, a hook's context or a signing setting
// cannot change a result or reach the real repository, and no real identity
// enters a commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tree, work, checkIn, assertPasses } from './check-fixture.mjs';
import { run } from './helpers.mjs';

const emptyConfig = join(work, 'empty.gitconfig');
writeFileSync(emptyConfig, '');

// The environment every git call and every check here runs in. A null value
// is deleted from the child's environment by the runner in helpers.mjs, and
// the same is done here for git.
const gitEnv = (() => {
  const env = {};
  for (const k of Object.keys(process.env)) if (k.toUpperCase().startsWith('GIT_')) env[k] = null;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    HOME: work,
    USERPROFILE: work,
    XDG_CONFIG_HOME: work,
    GIT_AUTHOR_NAME: 'someone',
    GIT_AUTHOR_EMAIL: 'someone@example.com',
    GIT_COMMITTER_NAME: 'someone',
    GIT_COMMITTER_EMAIL: 'someone@example.com',
  };
})();

function git(dir, ...args) {
  const env = { ...process.env, ...gitEnv };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  return execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' }).toString();
}

function committed(dir) {
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'base');
}

const check = dir => run(checkIn(dir), [], { cwd: dir, env: { ...gitEnv, GITHUB_BASE_REF: null } });
const fails = (dir, pattern) => {
  const r = check(dir);
  assert.equal(r.code, 1, `expected a failure, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  return r;
};

const SKIP = /note: not the top of a git work tree — tracked-file check skipped/;
const notes = dir => join(dir, 'skills', 'unsealed-fixture', 'notes.txt');

test('a clean committed tree passes, and the rule ran', () => {
  const dir = tree();
  committed(dir);
  const r = check(dir);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, SKIP);
});

test('an ignore line matching a file already committed fails, naming it', () => {
  // The housekeeping-edit shape: one pull request adds an ignore line that
  // matches a shipped file, and the check stops reading it.
  const dir = tree();
  writeFileSync(notes(dir), 'notes\n');
  committed(dir);
  appendFileSync(join(dir, '.gitignore'), '\nskills/unsealed-fixture/notes.txt\n');
  const r = fails(dir, /skills\/unsealed-fixture\/notes\.txt .*never read/);
  assert.match(r.stderr, /history/);
});

test('an ignore line differing from a committed name by a trailing tab fails', () => {
  // The walk trims both ends of a line and git trims only trailing spaces, so
  // the walk skips this file and git still tracks it. Asking git what it
  // ignores would list nothing here.
  const dir = tree();
  writeFileSync(notes(dir), 'notes\n');
  appendFileSync(join(dir, '.gitignore'), '\nskills/unsealed-fixture/notes.txt\t\n');
  committed(dir);
  fails(dir, /skills\/unsealed-fixture\/notes\.txt .*never read/);
});

test('a force-added file matching an existing ignore line fails', () => {
  const dir = tree();
  committed(dir);
  const local = join(dir, 'skills', 'unsealed-fixture', 'settings.local.json');
  writeFileSync(local, '{}\n');
  git(dir, 'add', '-f', local);
  git(dir, 'commit', '-q', '--no-verify', '-m', 'force');
  fails(dir, /skills\/unsealed-fixture\/settings\.local\.json .*never read/);
});

test('a tree that is not a repository skips the rule locally and fails it in CI', () => {
  // A broken git step or a moved checkout must not turn the gate green.
  const dir = tree();
  const r = assertPasses(dir);
  assert.match(r.stdout, SKIP);
  const ci = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null, GITHUB_ACTIONS: 'true' } });
  assert.equal(ci.code, 1, `expected a failure, got:\n${ci.stdout}${ci.stderr}`);
  assert.match(ci.stderr, /tracked-file check/);
});
