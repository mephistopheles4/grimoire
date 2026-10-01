// Tests of scripts/check.mjs: fixed paths, frontmatter names and missing
// SKILL.md files. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, skillMd, fixtureMd, assertPasses, assertFails } from './check-fixture.mjs';

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
  appendFileSync(fixtureMd(dir), '\n> Never write ~/.claude/skills/ into a skill.\n');
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
