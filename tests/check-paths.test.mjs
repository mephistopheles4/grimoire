// Tests of scripts/check.mjs: fixed paths, frontmatter names and missing
// SKILL.md files. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, skillMd, fixtureMd, assertPasses, assertFails, modFile, importLine } from './check-fixture.mjs';

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

test('a fixed path in a file of the mod fails', () => {
  // A mod ships in the plugin and its module runs on somebody else's computer
  // under an install route nobody here chooses, the same as a skill.
  const dir = tree();
  modFile(dir, 'brigade/hooks/roster.ts', 'export const where = "~/.claude/brigade/roster.json";\n');
  assertFails(dir, /brigade\/hooks\/roster\.ts:1 holds a fixed path/);
});

test('a fixed path in the hooks folder the engine reads at the plugin root fails', () => {
  // The engine finds a plugin's hooks module through hooks/hooks.json at the
  // plugin's root, and this repository's root is the plugin's.
  const dir = tree();
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["~/.claude/plugins/brigade/register.tsx"] }\n');
  assertFails(dir, /hooks\/hooks\.json:1 holds a fixed path/);
});

test('the engine-generated type files are not walked, because .gitignore excludes them', () => {
  // The engine lays its own declarations into .claude-plugin/types/ at every
  // load from a folder the person owns. They are its files, not this
  // repository's, and they may name packages and the machine's own paths.
  // The same content in the mod is the control: it fails there.
  const dir = tree();
  const text = `${importLine('{ x }', 'some-package')}// generated under ~/.claude/plugins\n`;
  modFile(dir, '.claude-plugin/types/claude-code/index.d.ts', text);
  assertPasses(dir);
  modFile(dir, 'brigade/types/index.d.ts', text);
  const r = assertFails(dir, /brigade\/types\/index\.d\.ts:1 imports "some-package"/);
  assert.match(r.stderr, /brigade\/types\/index\.d\.ts:2 holds a fixed path/);
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
