// Tests of scripts/check.mjs: the real repository, the walk, box files, the
// registry. The fixture they share, and why every case copies the tree, is in
// check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, run } from './helpers.mjs';
import { tree, readJson, writeJson, assertPasses, assertFails } from './check-fixture.mjs';

test('the real repository passes its own check', () => {
  const r = run(check);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^ok: \d+ artifact file\(s\), \d+ plugin\(s\)$/m);
});

test('the real repository runs the format check over the contract skill itself', () => {
  // The skill that ships the format check is a skill too. Skipping it would
  // leave the checker's own folder the one folder nothing checks.
  const r = run(check);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^ok {4}skills\/contract\/ \(format\)$/m);
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

test('a .gitignore pattern the reader cannot compile is named, not compiled wrong', () => {
  // `**/x` expanded as two independent `*` matches exactly one directory
  // level, and a character class is escaped to a literal. Both are valid
  // .gitignore syntax producing a wrong answer, and a wrong answer here means
  // the walk enters a directory git excludes — the bug the walk exists to fix.
  const dir = tree();
  appendFileSync(join(dir, '.gitignore'), '**/build/\n*.[bl]ak\n');
  const r = assertPasses(dir);
  assert.match(r.stdout, /2 pattern\(s\) not read/);
  assert.match(r.stdout, /\*\*\/build\//);
});

test('a fixed path on a quoted line fails outside markdown, because > is not a quote there', () => {
  // The exemption exists because a quoted example is not an instruction, and
  // only a markdown file can quote. Rule 2 now reads .js, .json and .html
  // under skills/, where a leading > is not quotation syntax.
  const dir = tree();
  appendFileSync(join(dir, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'), '\n// > installed at /home/someone/.claude\n');
  assertFails(dir, /eagle-eye\.js:\d+ holds a fixed path/);
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

test('a registry row that matches nothing fails, rather than passing with nothing to check', () => {
  // Each row is here because a skill ships that artifact type. A row matching
  // no file means the example went away or the row did, and a check with
  // nothing to check reads as a check that passed.
  const dir = tree();
  rmSync(join(dir, 'skills', 'eagle-eye', 'examples'), { recursive: true, force: true });
  assertFails(dir, /no \.box\.json anywhere in the tree, so the "box" row checked nothing/);
});

test('a registry row naming a renderer that is not there fails', () => {
  const dir = tree();
  rmSync(join(dir, 'skills', 'groundtrack', 'scripts', 'render.mjs'), { force: true });
  assertFails(dir, /names skills\/groundtrack\/scripts\/render\.mjs, and there is no such file/);
});
