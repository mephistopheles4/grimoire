// Tests of how scripts/check.mjs prints what rule 2 and the import rules find,
// of the line ends and pass cases of rule 2, and of the root-folder case check.
// Split from check-paths.test.mjs so node --test runs the files in parallel;
// each case runs the whole check. The shapes themselves are in
// check-home-shapes.test.mjs, and the fixture is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tree, fixtureMd, assertPasses, assertFails, modFile, importLine } from './check-fixture.mjs';
import { caseTwin } from '../scripts/lib/case.mjs';
test('the failure names the exact line and masks every copy of the account name', () => {
  // The CI log is public and outlives a rewritten commit. A two-word Windows
  // account is masked whole, and so is a second copy of it on the line.
  const dir = tree();
  modFile(dir, 'hooks/notes.txt', 'first line\nOpen C:\\Users\\some one\\repo, ask some one, or /Users/someone/box.json\n');
  const r = assertFails(dir, /hooks\/notes\.txt:2 holds a fixed path/);
  assert.doesNotMatch(r.stderr, /some|\bone\b/);
});

test('an import naming a home is masked in the import rules too', () => {
  // Rules 6 and 6b print the import path. Without the mask, the same home
  // that rule 2 hides would print whole on the next line.
  const dir = tree();
  modFile(dir, 'brigade/where.ts', importLine('{ a }', 'C:/Users/someone/a.js') + importLine('{ b }', '/Users/someone/b.js'));
  const r = assertFails(dir, /brigade\/where\.ts:1 imports "C:\/Users\/<name>\/a\.js"/);
  assert.match(r.stderr, /brigade\/where\.ts:2 imports "\/Users\/<name>\/b\.js", an absolute path/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('a control character in a printed string is escaped through the check', () => {
  const dir = tree();
  const esc = String.fromCodePoint(0x1b);
  modFile(dir, 'brigade/esc.ts', importLine('{ x }', `pkg${esc}[31m`));
  const r = assertFails(dir, /brigade\/esc\.ts:1 imports "pkg\\u\{1b\}\[31m"/);
  assert.equal(r.stderr.includes(esc), false);
});

test('a file name holding a line break prints on one line', t => {
  // Windows refuses the name, so this runs where the file system allows it.
  const dir = tree();
  try {
    modFile(dir, 'hooks/a\nb.txt', '/Users/someone/\n');
  } catch {
    t.skip('this file system refuses a line break in a name');
    return;
  }
  assertFails(dir, /hooks\/a\\u\{a\}b\.txt:1 holds a fixed path/);
});

test('a home root at the end of a CRLF line fails, as it does on LF', () => {
  // The check splits on \n, so a CRLF checkout leaves \r on every line.
  const dir = tree();
  appendFileSync(fixtureMd(dir), '\r\nThe home folder is /Users\r\n');
  assertFails(dir, /unsealed-fixture\/SKILL\.md:\d+ holds a fixed path/);
  const lf = tree();
  appendFileSync(fixtureMd(lf), '\nThe home folder is /Users\n');
  assertFails(lf, /unsealed-fixture\/SKILL\.md:\d+ holds a fixed path/);
});

test('a URL route, a lowercase REST path and prose about the folder pass', () => {
  // A letter after each, so only the lookbehind and the case of `Users` let
  // them through.
  const dir = tree();
  appendFileSync(
    fixtureMd(dir),
    '\nCall https://example.com/api/Users/42, https://example.com/Users/x or GET /users/someone.\n\nA Mac keeps homes in the /Users folder.\n',
  );
  assertPasses(dir);
});

// A shipped root folder spelled in another case. The check cannot run without
// skills/ and .claude-plugin/, so the test never removes them. On a
// case-sensitive file system the twin sits beside the real folder and the
// check must name it. Where case folds, the two cannot both exist, so the
// comparison the check makes is asserted instead, and the test says which.
for (const [twin, real] of [['Skills', 'skills'], ['.Claude-plugin', '.claude-plugin'], ['\u{17F}kills', 'skills']]) {
  test(`a root ${twin}/ folder fails, or folds to ${real}/ where case folds`, t => {
    const dir = tree();
    try {
      mkdirSync(join(dir, twin));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const names = readdirSync(dir);
    if (names.includes(real) && names.includes(twin)) {
      t.diagnostic('case-sensitive: ran the check');
      writeFileSync(join(dir, twin, 'README.md'), 'a twin\n');
      const r = assertFails(dir, /at the root is .+ in another case/);
      assert.ok(r.stderr.includes(`${twin}/ at the root is ${real}/ in another case`), r.stderr);
    } else {
      t.diagnostic('case folds: asserted caseTwin only');
      assert.equal(caseTwin(twin, real), true);
    }
  });
}
