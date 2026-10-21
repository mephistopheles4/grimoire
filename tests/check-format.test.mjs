// Tests of scripts/check.mjs: dependencies. The fixture they share, and why every case copies the tree,
// is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { tree, assertPasses, assertFails, modFile, importLine } from './check-fixture.mjs';

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

// Issue 362: athanor reads its configuration only from an "athanor" key in the
// root package.json. Rule 6 accepts exactly that file and nothing wider, so
// the exemption opens no route for a package.
const athanorOnly = { athanor: { dockerfile: 'tests/container/Dockerfile', context: 'tests/container', commands: { check: 'node scripts/check.mjs' } } };

test('a root package.json holding only the athanor key passes', () => {
  const dir = tree();
  writeFileSync(join(dir, 'package.json'), JSON.stringify(athanorOnly));
  modFile(dir, 'tests/container/Dockerfile', 'FROM node:24\n');
  assertPasses(dir);
});

test('a root package.json with any other key fails and names each one, printed safely', () => {
  const dir = tree();
  const esc = String.fromCodePoint(0x1b);
  const manifest = { ...athanorOnly };
  for (const k of ['dependencies', 'devDependencies', 'scripts', 'name', 'skills', `a${esc}b`, '/home/zq-acct/x']) manifest[k] = {};
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  const r = assertFails(dir, /package\.json: a dependency manifest or lockfile/);
  for (const k of ['dependencies', 'devDependencies', 'scripts', 'name', 'skills']) assert.match(r.stderr, new RegExp(`"${k}"`));
  assert.match(r.stderr, /"a\\u\{1b\}b"/);
  assert.match(r.stderr, /"\/home\/<name>\/x"/);
  assert.doesNotMatch(r.stderr, /zq-acct/);
  assert.equal(r.stderr.includes(esc), false);
  // The key that is allowed is not named as one of the others.
  assert.doesNotMatch(r.stderr, /also holds[^.]*"athanor"/);
});

test('a root package.json that is not exactly an athanor object fails', () => {
  const bodies = ['{}\n', '[]\n', '"athanor"\n', '{"athanor":1}\n', '{"athanor":null}\n', '{"athanor":[]}\n', '{"athanor":"x"}\n', 'null\n', '1\n', 'true\n', 'not json at all\n', '/home/zq-acct/oops\n',
    // A home path early, then a long stretch, then the error: Node's message
    // quotes only a window around the error, which holds the name and no home
    // root for a mask to find.
    `{"p":"/home/zq-acct/x","pad":"${'a'.repeat(400)}" zq-acct}\n`];
  for (const body of bodies) {
    const dir = tree();
    writeFileSync(join(dir, 'package.json'), body);
    const r = assertFails(dir, /package\.json: a dependency manifest or lockfile/);
    // A parse error can quote the file, and the file is not this check's text.
    assert.doesNotMatch(r.stderr, /zq-acct/, `body ${JSON.stringify(body)}`);
  }
});

test('an athanor key that widens the image build folder fails, because the build has network access', () => {
  // The build receives the tracked files under the folder "context" names,
  // uncommitted edits included, and a branch sets the key. "inputs" adds files
  // from outside it. A key left out is refused too: athanor takes a missing
  // "context" from wherever a linked Dockerfile really is.
  const { context, dockerfile, ...rest } = athanorOnly.athanor;
  const widenings = [
    ['context', { ...rest, dockerfile, context: '.' }],
    ['context', { ...rest, dockerfile, context: '' }],
    ['context', { ...rest, dockerfile, context: 'tests/container/..' }],
    ['dockerfile', { ...rest, context, dockerfile: 'Dockerfile' }],
    ['context', { ...rest, dockerfile }],
    ['dockerfile', { ...rest, context }],
    ['inputs', { ...rest, dockerfile, context, inputs: ['.env'] }],
    ['inputs', { ...rest, dockerfile, context, inputs: [] }],
  ];
  for (const [key, athanor] of widenings) {
    const dir = tree();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ athanor }));
    const r = assertFails(dir, /package\.json: a dependency manifest or lockfile/);
    assert.match(r.stderr, new RegExp(`keep the image build[^)]*"${key}"`), JSON.stringify(athanor));
  }
});

test('a symbolic link at the build folder, or a Dockerfile that is one, fails, because athanor follows links', t => {
  // The pinned strings still read right while the build goes wherever the link
  // points: at the repository root, with every tracked file in it.
  const dir = tree();
  writeFileSync(join(dir, 'package.json'), JSON.stringify(athanorOnly));
  writeFileSync(join(dir, 'Dockerfile'), 'FROM node:24\n');
  try {
    symlinkSync('..', join(dir, 'tests'), 'dir');
  } catch {
    t.skip('this file system or account cannot make symbolic links');
    return;
  }
  assertFails(dir, /tests is a symbolic link where the image build folder is held/);
  const other = tree();
  writeFileSync(join(other, 'package.json'), JSON.stringify(athanorOnly));
  writeFileSync(join(other, 'Dockerfile'), 'FROM node:24\n');
  mkdirSync(join(other, 'tests', 'container'), { recursive: true });
  symlinkSync(join('..', '..', 'Dockerfile'), join(other, 'tests', 'container', 'Dockerfile'));
  assertFails(other, /tests\/container\/Dockerfile is a symbolic link where the image build folder is held/);
});

test('the build folder spelled in another case, or with no Dockerfile in it, fails, because a folding checkout finds it and Linux CI does not', t => {
  // Linux CI reads Tests/Container as an unrelated name, so the exact-name
  // guards never see it, while a checkout that folds case resolves the pinned
  // path through it. The long s upper-cases to S and lower-cases to itself, so
  // only the upper-case half of the fold sees te\u{17F}ts as tests.
  const longS = String.fromCodePoint(0x17f);
  const pinned = JSON.stringify(athanorOnly);
  const folder = tree();
  writeFileSync(join(folder, 'package.json'), pinned);
  modFile(folder, 'Tests/Container/Dockerfile', `FROM node:24\nRUN true ${String.fromCodePoint(0x200b)}\n`);
  const r = assertFails(folder, /Tests\/Container\/Dockerfile is spelled like tests\/container\/ and differs from it only in case/);
  // The scans read it under that spelling too.
  assert.match(r.stderr, /Tests\/Container\/Dockerfile:2 holds U\+200B/);
  const folded = tree();
  writeFileSync(join(folded, 'package.json'), pinned);
  modFile(folded, `te${longS}ts/container/Dockerfile`, 'FROM node:24\n');
  assertFails(folded, /e.ts\/container\/Dockerfile is spelled like tests\/container\/ and differs from it only in case/);
  const missing = tree();
  writeFileSync(join(missing, 'package.json'), pinned);
  assertFails(missing, /tests\/container\/Dockerfile is missing or is not a plain file/);
  const link = tree();
  writeFileSync(join(link, 'package.json'), pinned);
  writeFileSync(join(link, 'Dockerfile'), 'FROM node:24\n');
  mkdirSync(join(link, 'tests'));
  try {
    symlinkSync('..', join(link, 'tests', 'Container'), 'dir');
  } catch {
    t.skip('this file system or account cannot make symbolic links');
    return;
  }
  assertFails(link, /tests\/Container is spelled like tests\/container\/ and differs from it only in case/);
});

test('a package.json in a folder and a lockfile beside an accepted root manifest still fail', () => {
  const dir = tree();
  writeFileSync(join(dir, 'package.json'), JSON.stringify(athanorOnly));
  writeFileSync(join(dir, 'package-lock.json'), '{}\n');
  modFile(dir, 'skills/eagle-eye/package.json', JSON.stringify(athanorOnly));
  const r = assertFails(dir, /- package-lock\.json: a dependency manifest or lockfile/);
  assert.match(r.stderr, /skills\/eagle-eye\/package\.json: a dependency manifest or lockfile/);
  // The accepted root file is not itself named as a failure.
  assert.doesNotMatch(r.stderr, /- package\.json: a dependency manifest/);
});

test('binding.gyp at the root fails, in any case and with or without a manifest, because npm builds it with no scripts key', () => {
  // The dotless i upper-cases to I and lower-cases to itself: a folding checkout
  // reads this name as binding.gyp, and only the upper-case half of the match sees it.
  const dotless = String.fromCodePoint(0x131);
  for (const [name, withManifest] of [['binding.gyp', false], ['Binding.GYP', true], [`b${dotless}nd${dotless}ng.gyp`, true]]) {
    const dir = tree();
    if (withManifest) writeFileSync(join(dir, 'package.json'), JSON.stringify(athanorOnly));
    writeFileSync(join(dir, name), '{}\n');
    assertFails(dir, new RegExp(`${name.replace('.', '\\.')}: .*native build`));
  }
});

test('the athanor configuration forces the add that keeps rule 2b live, and the image is pinned by digest', () => {
  // Without the forced add, a tracked file that .gitignore matches is left out
  // of the container's index, and rule 2b could never fire there.
  const config = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).athanor;
  assert.deepEqual(config.commands.check.slice(0, 2), ['sh', '-c']);
  assert.match(config.commands.check[2], /^git add -A -f && node scripts\/check\.mjs$/);
  const dockerfile = readFileSync(join(root, config.dockerfile), 'utf8');
  assert.match(dockerfile, /^FROM node:24[^\s@]*@sha256:[0-9a-f]{64}$/m);
});

test('a hidden direction-changing character in the container folder fails rule 2c', () => {
  // The Dockerfile and the root config are what CONTRIBUTING tells a reader to
  // read before running a branch they did not write.
  const dir = tree();
  modFile(dir, 'tests/container/Dockerfile', `FROM node:24\nRUN true ${String.fromCodePoint(0x202e)}\n`);
  assertFails(dir, /tests\/container\/Dockerfile:2 holds U\+202E/);
});

test('a home path in the root package.json or the container folder fails rule 2, masked', () => {
  // Both files ship to every installer, and "commands" is where a pasted local
  // path would land.
  const dir = tree();
  const m = structuredClone(athanorOnly);
  m.athanor.commands.check = 'node /home/zq-acct/work/scripts/check.mjs';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(m, null, 2));
  modFile(dir, 'tests/container/Dockerfile', 'FROM node:24\nCOPY . C:\\Users\\zq-acct\\work\n');
  const r = assertFails(dir, /package\.json:\d+ holds a fixed path/);
  assert.match(r.stderr, /tests\/container\/Dockerfile:2 holds a fixed path/);
  assert.doesNotMatch(r.stderr, /zq-acct/);
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
