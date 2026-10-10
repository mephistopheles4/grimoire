// Unit tests of scripts/lib/case.mjs and scripts/lib/printable.mjs: the small
// helpers scripts/check.mjs uses to compare names across case and to print a
// string it did not choose. They are seams of their own, and they run in this
// process, so they behave the same on a file system that folds case and on one
// that does not. tests/check-paths.test.mjs drives the same cases through the
// check where the file system allows it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseTwin } from '../scripts/lib/case.mjs';
import { masked, printable } from '../scripts/lib/printable.mjs';

test('a name that folds to the wanted one by either case is its twin', () => {
  // The long s upper-cases to S and lower-cases to itself, so a comparison
  // through toLowerCase() alone misses it.
  assert.equal(caseTwin('\u{17F}kills', 'skills'), true);
  assert.equal(caseTwin('.Claude-plugin', '.claude-plugin'), true);
  assert.equal(caseTwin('Skills', 'skills'), true);
});

test('the wanted name itself, and an unrelated one, are not twins', () => {
  assert.equal(caseTwin('skills', 'skills'), false);
  assert.equal(caseTwin('scripts', 'skills'), false);
});

test('printable keeps a name with a line break on one line', () => {
  // A file name holding a line break could otherwise start a new log line,
  // which a CI runner may read as a command.
  assert.equal(printable('a\nb'), 'a\\u{a}b');
  assert.equal(printable('\r\u{1B}[31m\u{2028}\u{85}x').match(/[\p{Cc}\u{2028}]/u), null);
  assert.equal(printable('skills/eagle-eye/SKILL.md'), 'skills/eagle-eye/SKILL.md');
});

test('printable escapes the marks that reorder or hide text', () => {
  // A right-to-left override or a zero-width space could make a failure line
  // show a different file or line from the one it names.
  assert.equal(printable('a\u{202E}b\u{200B}c\u{2066}d'), 'a\\u{202e}b\\u{200b}c\\u{2066}d');
});

test('masked replaces the whole account segment and every copy of it', () => {
  assert.equal(masked('C:\\Users\\some one\\repo, ask some one'), 'C:\\Users\\<name>\\repo, ask <name>');
  assert.equal(masked('/home/someone/x and /Users/someone'), '/home/<name>/x and /Users/<name>');
  assert.equal(masked('no home here'), 'no home here');
});
