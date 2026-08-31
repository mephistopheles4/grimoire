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

// ---- the call sites ----
//
// The escape is only worth what its callers do with it. SECURITY.md says box
// text is escaped "before box text reaches innerHTML", and the findings are a
// place it reaches innerHTML: template.html builds the find list from
// `m.text` and assigns the result to `$('view').innerHTML`.
//
// This is not a command-line test, because the command line cannot see it.
// The findings are built in the browser from the box data, so the payload is
// never in the file render.mjs writes, and `--check` strips every tag before
// it prints. The module is where the text is built, so the module is where the
// assertion belongs.

const PAYLOAD = '<img src=x onerror=alert(1)>';

// One box that fires all six findings, with the payload in every kind of box
// text a finding interpolates: a row name, an option short name and a why.
function payloadBox() {
  return {
    title: 'A box',
    dims: [
      { id: 'one', name: `Row one ${PAYLOAD}`, opts: [
        { id: 'a1', label: 'Option A1', short: `A1 ${PAYLOAD}`, chosen: true },
        { id: 'a2', label: 'Option A2', short: `A2 ${PAYLOAD}`, strawman: true },
      ] },
      { id: 'two', name: `Row two ${PAYLOAD}`, opts: [
        { id: 'b1', label: 'Option B1', short: `B1 ${PAYLOAD}`, chosen: true },
        { id: 'b2', label: 'Option B2', short: `B2 ${PAYLOAD}`, strawman: true },
      ] },
      { id: 'three', name: `Row three ${PAYLOAD}`, opts: [
        { id: 'c1', label: 'Option C1', short: `C1 ${PAYLOAD}`, chosen: true },
        { id: 'c2', label: 'Option C2', short: `C2 ${PAYLOAD}`, strawman: true },
      ] },
    ],
    rel: {
      a2: { why: 'The strawman for row one', rel: [['b1', 'conf', `A2 rules B1 out ${PAYLOAD}`]] },
    },
  };
}

// Row one is changed to its strawman, which is what makes "row not opened" and
// "weakest edge" fire. Row three carries no edge, which is what makes "row with
// no edges" fire.
const payloadMoves = () => EagleEye.analyse(payloadBox(), { one: 'a2', two: 'b1', three: 'c1' }).moves;

test('every finding fires on the box the escape tests use', () => {
  // The assertions below are worth nothing if a finding is silent, so pin the
  // set. A seventh finding, or a renamed one, lands here first.
  assert.deepEqual(payloadMoves().map(m => m.kind), [
    'row not opened', 'weakest edge', 'most connected',
    'row with no edges', 'strawman not rejected', 'evidence for the verdict',
  ]);
});

test('no finding writes a row name, an option name or a why as markup', () => {
  for (const m of payloadMoves()) {
    assert.equal(m.text.includes(PAYLOAD), false, `${m.kind} carries the payload as markup: ${m.text}`);
  }
});

test('a finding still says the name, escaped rather than dropped', () => {
  // The test above passes if the names disappear. This one says they are there,
  // as text: every finding that names a row prints the payload escaped.
  for (const m of payloadMoves()) {
    if (m.kind === 'row not opened' || m.kind === 'row with no edges' || m.kind === 'evidence for the verdict')
      assert.ok(m.text.includes('&lt;img src=x onerror=alert(1)>'), `${m.kind} dropped the name: ${m.text}`);
  }
});

test('a made-up tier cannot break out of the class attribute it lands in', () => {
  // The tier is the one box value a finding writes into an HTML attribute, and
  // esc leaves the double quote alone. render.mjs refuses a tier outside the
  // three names, so no page it writes carries one — but the module does not
  // lean on the caller having checked.
  const b = payloadBox();
  b.rel.a2.rel = [['b1', 'conf', 'A2 rules B1 out', 'measured" onmouseover=alert(1) x="', 'a source']];
  const weakest = EagleEye.analyse(b, { one: 'a2', two: 'b1', three: 'c1' }).moves.find(m => m.kind === 'weakest edge');
  assert.equal(weakest.text.match(/<span[^>]*>/)[0], '<span class="tier argued">');
});
