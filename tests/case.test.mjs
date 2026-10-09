// Unit tests of scripts/lib/case.mjs: the two small helpers scripts/check.mjs
// uses to compare names across case and to print a name it did not choose.
// They run in this process, so they behave the same on a file system that
// folds case and on one that does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseTwin, printable } from '../scripts/lib/case.mjs';

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
  const out = printable('a\nb');
  assert.equal(out.includes('\n'), false);
  assert.match(out, /^a.+b$/);
  assert.equal(printable('\r\u{1B}[31m\u{2028}x').match(/[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/u), null);
  assert.equal(printable('skills/eagle-eye/SKILL.md'), 'skills/eagle-eye/SKILL.md');
});
