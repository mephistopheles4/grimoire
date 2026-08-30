// The escape SECURITY.md names. It was one line, in one file, never exercised.
//
//   > No test covers the escape function. It is one line, it has never been
//   > exercised by a red test.
//
// It is exercised now. These tests pin the escape at the width SECURITY.md
// states, in both directions: what it escapes, and what it lets through. The
// second half matters more. The escape is narrow on purpose, and it is enough
// only because no box text reaches an HTML attribute. A test that asserted
// only "it escapes things" would go green if somebody widened it, and green
// again if somebody narrowed it back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './helpers.mjs';

const require = createRequire(import.meta.url);
const EagleEye = require(join(root, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'));
const { esc } = EagleEye;

test('esc turns a tag into text', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script>alert(1)&lt;/script>');
});

test('esc escapes the ampersand before the angle bracket', () => {
  // Order is the whole trick. Escape < first and "&lt;" becomes "&amp;lt;",
  // which the browser renders as the text "&lt;" instead of a bracket.
  assert.equal(esc('&lt;script>'), '&amp;lt;script>');
});

test('esc leaves the double quote alone, as SECURITY.md states', () => {
  // Not an oversight, and not a licence either. This is the exact fact that
  // makes SECURITY.md's "no box text reaches an HTML attribute today" load-
  // bearing. If somebody adds ="${...}" to the template, this test is the one
  // that has to change first.
  assert.equal(esc('a "quoted" label'), 'a "quoted" label');
});

test('esc renders a missing value as the empty string, not "undefined"', () => {
  assert.equal(esc(undefined), '');
  assert.equal(esc(null), '');
});

test('esc coerces a non-string without throwing', () => {
  assert.equal(esc(0), '0');
  assert.equal(esc(false), 'false');
});
