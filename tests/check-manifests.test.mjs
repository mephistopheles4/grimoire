// Tests of scripts/check.mjs: marketplace entries, reporting, code fences and
// the tests path. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers.mjs';
import { tree, checkIn, readJson, writeJson, skillMd, fixtureMd, assertPasses, assertFails, repo } from './check-fixture.mjs';

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
  appendFileSync(fixtureMd(dir), '\nSee ~/.claude/skills/ for the file.\n');
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

test('a bare fence in the fixture skill fails, naming its file', () => {
  // The control for the pass tests below, which edit the fixture: their pass
  // proves something only while the fence rule reads the fixture's file.
  const dir = tree();
  const lines = readFileSync(fixtureMd(dir), 'utf8').split('\n');
  const fenceLine = lines.length + 1;
  lines.push('```', 'a block that says nothing about itself', '```', '');
  writeFileSync(fixtureMd(dir), lines.join('\n'));
  assert.equal(lines[fenceLine - 1], '```');
  assertFails(dir, new RegExp(`skills/unsealed-fixture/SKILL\\.md:${fenceLine} opens a code fence with no language`));
});

test('a fence that declares a language passes', () => {
  const dir = tree();
  appendFileSync(fixtureMd(dir), '\n```bash\nnode scripts/check.mjs\n```\n');
  assertPasses(dir);
});

test('a closing fence is not read as a bare opening fence', () => {
  // The rule started as a per-line regex, which reported every closing fence
  // in the tree: sixteen hits, thirteen of them closing. This is the test that
  // says the state machine is the point.
  const dir = tree();
  appendFileSync(fixtureMd(dir), '\n```text\nfirst\n```\n\n```text\nsecond\n```\n');
  assertPasses(dir);
});

test('a tilde fence inside a backtick block does not close it', () => {
  const dir = tree();
  appendFileSync(fixtureMd(dir), '\n```text\n~~~\nstill inside\n~~~\n```\n');
  assertPasses(dir);
});

test('a longer fence may hold a shorter one, which does not close it', () => {
  // CommonMark closes a fence on the same character at the same length or
  // longer. Holding only the character, the inner ``` closed the outer block
  // and the example's own closing fence then read as a new bare one — the rule
  // failing correct markdown. This repository documents fenced blocks, so that
  // file is one somebody here would write.
  const dir = tree();
  appendFileSync(fixtureMd(dir), '\n````markdown\n```\nan inner example fence\n```\n````\n');
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
