// Tests of scripts/check.mjs: the format check over every skill, and
// dependencies. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, run } from './helpers.mjs';
import { n, tree, checkIn, fixtureMd, manifest, assertPasses, assertFails, formatCheckIn, fixtureSkill, fixtureContract, assertFixtureClean } from './check-fixture.mjs';

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
