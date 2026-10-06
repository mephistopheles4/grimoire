// Tests of scripts/check.mjs: the format check over every skill, and
// dependencies. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, run } from './helpers.mjs';
import { n, tree, checkIn, fixtureMd, manifest, assertPasses, assertFails, formatCheckIn, fixtureSkill, fixtureContract, assertFixtureClean, modFile, importLine } from './check-fixture.mjs';

test('a sealed skill whose CONTRACT.md drifted fails, naming the skill', () => {
  // The mark says the SKILL.md and its contract are unchanged since the
  // seal. A clause added to the contract afterwards is a contract the
  // SKILL.md was never regenerated from.
  const dir = tree();
  const skill = fixtureSkill(dir, 'sealed-fixture', { contract: fixtureContract });
  assertFixtureClean(dir, 'sealed-fixture');
  appendFileSync(join(skill, 'CONTRACT.md'), '\nA clause added after the seal.\n');
  const r = assertFails(dir, /skills\/sealed-fixture\/ fails the format check/);
  assert.match(r.stderr, /FAIL contract-digest: line \d+: the seal is broken/);
});

test('a sealed SKILL.md whose CONTRACT.md is gone fails, naming the skill', () => {
  const dir = tree();
  const skill = fixtureSkill(dir, 'sealed-fixture', { contract: fixtureContract });
  assertFixtureClean(dir, 'sealed-fixture');
  rmSync(join(skill, 'CONTRACT.md'));
  const r = assertFails(dir, /skills\/sealed-fixture\/ fails the format check/);
  assert.match(r.stderr, /marked, but its contract is missing/);
});

test('a frontmatter key the format check does not know fails an unmarked skill too', () => {
  // A key that widens what the agent may do, added to a skill built from no
  // contract. Nothing lists it, so it is a change nobody reviewed.
  // The unsealed fixture is that skill: eagle-eye is sealed, and an edit to it
  // would also break its mark.
  const dir = tree();
  const p = fixtureMd(dir);
  const text = readFileSync(p, 'utf8');
  const nameLine = /^name: unsealed-fixture(\r?\n)/m;
  assert.match(text, nameLine, 'the fixture edit found no name line');
  writeFileSync(p, text.replace(nameLine, 'name: unsealed-fixture$1permissionMode: acceptEdits$1'));
  const r = assertFails(dir, /skills\/unsealed-fixture\/ fails the format check/);
  assert.match(r.stderr, /unknown key "permissionMode"/);
  assert.doesNotMatch(r.stderr, /familiar-digest/, 'an unmarked skill has no seal to break');
});

test('a format-check warning passes, and is printed as a note', () => {
  const dir = tree();
  const body = `${Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  fixtureSkill(dir, 'long-fixture', { body });
  assertFixtureClean(dir, 'long-fixture');
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.match(r.stdout, /^note: skills\/long-fixture\/ WARN body-length: /m);
});

test('a missing format check fails rather than skipping every skill', () => {
  const dir = tree();
  rmSync(formatCheckIn(dir));
  assertFails(dir, /skills\/contract\/scripts\/check\.mjs is missing, so no skill's frontmatter, mark or contract was checked/);
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

test('the single-pass tag strip cannot come back in the mod, which draws untrusted text', () => {
  // The guard read .mjs, .js and .html. The mod is TypeScript and shows text
  // other sessions wrote, so its suffixes are read as well.
  const dir = tree();
  const singlePass = 'const naive = s => s.replace(/<[^' + '>]+>/g, "");\n';
  modFile(dir, 'brigade/hooks/card.tsx', singlePass);
  assertFails(dir, /brigade\/hooks\/card\.tsx:1 strips tags in one pass/);
});

// ---- zero dependencies ----
// check.mjs opens with "Zero dependencies, one command" and CONTRIBUTING says
// it twice as a rule for patches. Nothing enforced it: no check mentioned
// package.json outside a comment, no test covered it, and CI runs this script
// and nothing else. A patch adding a manifest and a dependency went green.

test('a dependency manifest anywhere in the tree fails', () => {
  const dir = tree();
  writeFileSync(join(dir, 'package.json'), '{"name":"grimoire","dependencies":{}}\n');
  assertFails(dir, /package\.json: a dependency manifest or lockfile/);
});

test('a lockfile fails on its own, with no manifest beside it', () => {
  const dir = tree();
  writeFileSync(join(dir, 'skills', 'eagle-eye', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  assertFails(dir, /pnpm-lock\.yaml: a dependency manifest or lockfile/);
});

test('a bare import fails, naming the file and the specifier', () => {
  // A dependency needs no manifest to be a dependency.
  //
  // The specifier is assembled rather than written whole, for the reason the
  // single-pass test above gives: written whole, this line would carry the
  // shape it tests, and the suite would fail its own check.
  const dir = tree();
  const q = "'";
  appendFileSync(join(dir, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'), `\nimport chalk from ${q}chalk${q};\n`);
  assertFails(dir, /eagle-eye\.js:\d+ imports "chalk"/);
});

test('prose in a comment is not read as an import', () => {
  // The first version of this rule scanned every line for a quoted string
  // after the word "from", and flagged three prose sentences out of three
  // tried. This repository writes long prose comments, so that was a
  // CI-breaking false positive rather than a theoretical one.
  const dir = tree();
  const q = "'";
  appendFileSync(
    join(dir, 'scripts', 'build-pages.mjs'),
    `\n// The tokens were copied from ${q}the rendered page${q}, not shared.\n` +
      `// A refusal is different from "a warning".\n` +
      `// Read import ${q}x${q} to mean a side-effect import.\n`,
  );
  assertPasses(dir);
});

test('a quoted string on an export line is not read as an import', () => {
  // `export const renderer = join(root, 'skills', ...)` is not a re-export.
  // Anchoring the rule to the start of the line without also requiring the
  // word "from" failed tests/helpers.mjs three times over.
  const dir = tree();
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), "\nexport const where = join(root, 'skills', 'eagle-eye');\n");
  assertPasses(dir);
});

test('a bare import wrapped across lines is still caught', () => {
  // `import {` ... `} from 'chalk';` is what a formatter produces for a long
  // import list. Read one line at a time, none of the single-line patterns see
  // it, so the most ordinary shape of a new dependency walked through.
  const dir = tree();
  const q = "'";
  appendFileSync(
    join(dir, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'),
    `\nimport {\n  red,\n  blue,\n} from ${q}chalk${q};\n`,
  );
  assertFails(dir, /eagle-eye\.js:\d+ imports "chalk"/);
});

test('a node: builtin and a relative path are not dependencies', () => {
  const dir = tree();
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), "\nimport { sep as s2 } from 'node:path';\nimport './lib/tree.mjs';\n");
  assertPasses(dir);
});

// ---- a mod's hooks module ----
// The engine loads a mod's module and supplies `claude-code` itself, so inside
// the mod that one name is no dependency. Everywhere else it is a package name
// like any other.

test('a .tsx file in the mod importing claude-code or claude-code/testing passes', () => {
  const dir = tree();
  modFile(
    dir,
    'brigade/hooks/register.tsx',
    importLine('{ atom, read }', 'claude-code') +
      importLine('type { Register }', 'claude-code') +
      importLine('{ harness }', 'claude-code/testing') +
      importLine('type { Card }', '../types') +
      'export const register: Register = (on) => {};\n',
  );
  assertPasses(dir);
});

test('the engine name read whole: claude-code-x in a .tsx file fails, naming the file', () => {
  // A prefix match would let any package whose name starts with the engine's
  // walk through as a builtin.
  const dir = tree();
  modFile(dir, 'brigade/hooks/register.tsx', importLine('{ x }', 'claude-code-x'));
  assertFails(dir, /brigade\/hooks\/register\.tsx:\d+ imports "claude-code-x"/);
});

test('any other bare specifier in a .ts file of the mod fails, naming the file', () => {
  const dir = tree();
  modFile(dir, 'brigade/hooks/roster.ts', importLine('chalk', 'chalk'));
  assertFails(dir, /brigade\/hooks\/roster\.ts:\d+ imports "chalk"/);
});

test('a bare require in any suffix the engine loads fails, not only .ts and .tsx', () => {
  // The engine loads .ts, .tsx, .jsx, .js, .mjs, .cjs, .mts and .cts. A
  // suffix the rule did not read would be a way round it.
  const dir = tree();
  const q = "'";
  modFile(dir, 'brigade/hooks/old.cts', `const c = require(${q}chalk${q});\n`);
  modFile(dir, 'brigade/hooks/view.mts', importLine('chalk', 'chalk'));
  modFile(dir, 'brigade/hooks/card.jsx', importLine('chalk', 'chalk'));
  modFile(dir, 'brigade/hooks/legacy.cjs', `const c = require(${q}chalk${q});\n`);
  const r = assertFails(dir, /brigade\/hooks\/old\.cts:\d+ imports "chalk"/);
  for (const name of ['view\\.mts', 'card\\.jsx', 'legacy\\.cjs']) {
    assert.match(r.stderr, new RegExp(`brigade/hooks/${name}:\\d+ imports "chalk"`));
  }
});

test('the hooks folder at the plugin root is the mod too: claude-code passes there, a package fails', () => {
  const dir = tree();
  modFile(dir, 'hooks/register.tsx', importLine('type { Register }', 'claude-code'));
  assertPasses(dir);
  modFile(dir, 'hooks/roster.ts', importLine('chalk', 'chalk'));
  assertFails(dir, /hooks\/roster\.ts:\d+ imports "chalk"/);
});

test('a dot segment under claude-code fails, because it steps out of the engine name', () => {
  // `claude-code/../chalk` resolves, under Node's rules, to the package chalk.
  const dir = tree();
  modFile(dir, 'brigade/hooks/register.tsx', importLine('chalk', 'claude-code/../chalk'));
  assertFails(dir, /brigade\/hooks\/register\.tsx:\d+ imports "claude-code\/\.\.\/chalk"/);
});

test('a protocol-relative specifier is a package, not an absolute path', () => {
  // Resolved against a file URL, `//host/x` names a host: a download.
  const dir = tree();
  modFile(dir, 'brigade/hooks/register.tsx', importLine('chalk', '//esm.sh/chalk'));
  assertFails(dir, /brigade\/hooks\/register\.tsx:\d+ imports "\/\/esm\.sh\/chalk"/);
});

test('claude-code outside the mod is a dependency like any other', () => {
  // Outside the engine the name resolves from node_modules, so a repository
  // script or a skill importing it has taken a package.
  const dir = tree();
  appendFileSync(join(dir, 'scripts', 'build-pages.mjs'), `\n${importLine('{ atom }', 'claude-code')}`);
  modFile(dir, 'skills/unsealed-fixture/lib/x.ts', importLine('{ atom }', 'claude-code'));
  const r = assertFails(dir, /scripts\/build-pages\.mjs:\d+ imports "claude-code"/);
  assert.match(r.stderr, /skills\/unsealed-fixture\/lib\/x\.ts:\d+ imports "claude-code"/);
});
