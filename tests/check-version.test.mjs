// Tests of scripts/check.mjs: the version bump against the base. The fixture
// they share, and why every case copies the tree, is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tree, readJson, writeJson, skillMd, fixtureMd, manifest, setVersion, assertPasses, assertFails, repo, baseMovesAhead, modFile } from './check-fixture.mjs';

test('a skill change with no version bump fails', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(skillMd(dir), '\nOne more sentence, shipped to nobody.\n');
  git('commit', '-aqm', 'change the skill');
  const r = assertFails(dir, /skill or mod file\(s\) changed since origin\/main, but version is still/);
  assert.match(r.stderr, /plugin users receive no update/);
});

test('the same skill change passes once the version moves', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(fixtureMd(dir), '\nOne more sentence, and a release to carry it.\n');
  setVersion(dir, '99.0.0');
  git('commit', '-aqm', 'change the skill and bump the version');
  assertPasses(dir);
});

test('a change to the mod with no version bump fails', () => {
  // The mod ships in the same plugin, so an edit to it reaches nobody until
  // the version moves, exactly as a skill edit does. The base has no mod
  // folder at all, which is also the shape of the commit that first adds one:
  // the copy's own mod and the manifest's pointer into it are taken out first.
  const dir = tree();
  for (const part of ['brigade', 'hooks']) rmSync(join(dir, part), { recursive: true, force: true });
  const { types, ...rest } = readJson(manifest(dir));
  writeJson(manifest(dir), rest);
  const git = repo(dir);
  modFile(dir, 'brigade/hooks/register.tsx', 'export const register = () => {};\n');
  git('add', '-A');
  git('commit', '-qm', 'add the mod');
  const r = assertFails(dir, /1 skill or mod file\(s\) changed since origin\/main, but version is still/);
  assert.match(r.stderr, /plugin users receive no update/);
});

test('a change to the hooks folder at the plugin root with no version bump fails', () => {
  const dir = tree();
  const git = repo(dir);
  // A new file there, so the tree changes and every pointer still lands.
  modFile(dir, 'hooks/shared.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'add a file to the hooks folder');
  assertFails(dir, /1 skill or mod file\(s\) changed since origin\/main, but version is still/);
});

test('the same mod change passes once the version moves', () => {
  const dir = tree();
  const git = repo(dir);
  modFile(dir, 'brigade/hooks/register.tsx', 'export const register = () => {};\n');
  setVersion(dir, '99.0.0');
  git('add', '-A');
  git('commit', '-qm', 'add the mod and bump the version');
  assertPasses(dir);
});

test('a change outside skills/ and the mod needs no bump', () => {
  const dir = tree();
  const git = repo(dir);
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), '\n// a comment, releasing nothing\n');
  git('commit', '-aqm', 'touch a script');
  assertPasses(dir);
});

test('a version the base already released fails, and says the base moved', () => {
  // Two sibling branches fork from one commit and both bump to the same
  // number. The first lands; the second still reads a bump at its merge base
  // and went green, against a base already carrying that version. Merging it
  // ships no update, which is the outcome the rule exists to prevent.
  const dir = tree();
  const git = repo(dir);
  baseMovesAhead(git, () => setVersion(dir, '99.0.0'));
  appendFileSync(skillMd(dir), '\nOne more sentence, and a version somebody else already took.\n');
  git('commit', '-aqm', 'change the skill and bump to the number main now holds');
  const r = assertFails(dir, /already at 99\.0\.0/);
  assert.match(r.stderr, /plugin users receive no update/);
});

test('a bump past what the base released passes', () => {
  const dir = tree();
  const git = repo(dir);
  baseMovesAhead(git, () => setVersion(dir, '99.0.0'));
  setVersion(dir, '99.0.1');
  appendFileSync(fixtureMd(dir), '\nOne more sentence, and the next version to carry it.\n');
  git('commit', '-aqm', 'change the skill and bump past main');
  assertPasses(dir);
});

test('a base that moved without releasing does not trip the comparison', () => {
  // main moving is not the failure. main moving the version is.
  const dir = tree();
  const git = repo(dir);
  baseMovesAhead(git, () => appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), '\n// a comment, releasing nothing\n'));
  setVersion(dir, '99.0.0');
  appendFileSync(fixtureMd(dir), '\nOne more sentence, released by this branch.\n');
  git('commit', '-aqm', 'change the skill and bump');
  assertPasses(dir);
});

test('a base tip with no manifest says which comparison was skipped', () => {
  // The layout move landing the other way round: the fork point carries a
  // manifest and the tip of the base branch does not. One comparison cannot
  // run, and the run says which one rather than passing in silence — the
  // failure this repository has already written a commit about.
  //
  // The manifest is rewritten after the reset, because the check reads
  // plugin.json from the working tree and the deletion is still staged there.
  const dir = tree();
  const git = repo(dir);
  const original = readJson(manifest(dir));
  baseMovesAhead(git, () => git('rm', '-q', '.claude-plugin/plugin.json'));
  writeJson(manifest(dir), { ...original, version: '99.0.0' });
  appendFileSync(fixtureMd(dir), '\nOne more sentence, against a base with no manifest.\n');
  git('add', '-A');
  git('commit', '-qm', 'change the skill and bump, with no manifest on the base');
  const r = assertPasses(dir);
  assert.match(r.stdout, /no plugin\.json at the tip of origin\/main/);
});

test('a branch that never bumped is told that first, even when the base moved', () => {
  // Both comparisons fail here, and only one of them is worth reading. "You
  // never bumped" is the smaller fact and the one to act on; being told to
  // rebase would send the author somewhere else entirely.
  const dir = tree();
  const git = repo(dir);
  baseMovesAhead(git, () => appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), '\n// a comment, releasing nothing\n'));
  appendFileSync(skillMd(dir), '\nOne more sentence, shipped to nobody.\n');
  git('commit', '-aqm', 'change the skill');
  const r = assertFails(dir, /but version is still/);
  assert.equal(/already at/.test(r.stderr), false, 'must not also tell the author to rebase');
});
