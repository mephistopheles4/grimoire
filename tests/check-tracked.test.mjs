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
import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tree, work, checkIn } from './check-fixture.mjs';
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

const SKIP = /note: not the top of a git work tree, or git failed — tracked-file check skipped/;
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

// The same check run with GITHUB_ACTIONS set, as CI runs it.
const inCi = dir => run(checkIn(dir), [], { cwd: dir, env: { ...gitEnv, GITHUB_BASE_REF: null, GITHUB_ACTIONS: 'true' } });

test('a tree that is not a repository skips the rule locally and fails it in CI', () => {
  // A broken git step or a moved checkout must not turn the gate green.
  const dir = tree();
  const r = check(dir);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, SKIP);
  const ci = inCi(dir);
  assert.equal(ci.code, 1, `expected a failure, got:\n${ci.stdout}${ci.stderr}`);
  assert.match(ci.stderr, /tracked-file check cannot run/);
});

test('a tree below the top of a repository skips locally and fails in CI', () => {
  // A checkout moved into a subfolder: git answers, but for another folder.
  const outer = join(work, `outer-${Date.now()}`);
  mkdirSync(outer);
  git(outer, 'init', '-q');
  const dir = join(outer, 'inner');
  cpSync(tree(), dir, { recursive: true });
  const r = check(dir);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, SKIP);
  const ci = inCi(dir);
  assert.equal(ci.code, 1, `expected a failure, got:\n${ci.stdout}${ci.stderr}`);
  assert.match(ci.stderr, /tracked-file check cannot run/);
});

test('a submodule entry fails, because its content is never read', () => {
  const dir = tree();
  committed(dir);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'update-index', '--add', '--cacheinfo', `160000,${head},skills/unsealed-fixture/vendor`);
  git(dir, 'commit', '-q', '--no-verify', '-m', 'submodule');
  fails(dir, /skills\/unsealed-fixture\/vendor is a submodule/);
});

test('a tracked file deleted on disk is not compared', () => {
  // Nothing on disk ships from this checkout, so there is nothing to read.
  const dir = tree();
  writeFileSync(notes(dir), 'notes\n');
  committed(dir);
  rmSync(notes(dir));
  const r = check(dir);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, SKIP);
});

test('a tracked name that is not UTF-8 fails rather than reading as deleted', t => {
  // Decoded, the name names a different file, so a lookup on disk would miss
  // it. Windows refuses such a name, so this runs where the file system takes it.
  const dir = tree();
  committed(dir);
  const name = Buffer.concat([Buffer.from(join(dir, 'skills', 'unsealed-fixture', 'x')), Buffer.from([0xff]), Buffer.from('.local.json')]);
  const odd = Buffer.concat([Buffer.from('x'), Buffer.from([0xff]), Buffer.from('.local.json')]);
  let kept = false;
  try {
    writeFileSync(name, '{}\n');
    // Windows takes the name but stores a replacement character in its place.
    kept = readdirSync(join(dir, 'skills', 'unsealed-fixture'), { encoding: 'buffer' }).some(n => n.equals(odd));
  } catch {
    // refused outright
  }
  if (!kept) {
    t.skip('this file system does not keep a name that is not UTF-8');
    return;
  }
  git(dir, 'add', '-f', 'skills/unsealed-fixture');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'odd name');
  fails(dir, /not UTF-8/);
});
