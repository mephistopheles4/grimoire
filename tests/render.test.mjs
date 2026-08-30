// The renderer, at the seam a reader and an agent actually use: the command
// line. `scripts/check.mjs` already proves a box file renders without
// throwing. It cannot prove the page is right, and it cannot prove a crafted
// box file fails to inject script. These tests do both.
//
// Every valid-path test reads the box file the skill already ships. Nothing
// here commits a fixture: check.mjs and build-pages.mjs both walk the whole
// tree for *.box.json, so a fixture on disk would either fail the check or be
// published to the public site. Boxes that must be malformed are written to a
// temporary directory and deleted.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderer, exampleBox, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-render-'));
after(() => rmSync(work, { recursive: true, force: true }));

// The smallest box the validator accepts. Two rows, one chosen option in each,
// one edge, two presets of which one changes an option.
function box(patch = {}) {
  return {
    title: 'A box',
    problem: 'A box needs one statement of what it decides. This one decides nothing; it exists so a test has a valid box to break.',
    dims: [
      {
        id: 'one',
        name: 'Row one',
        opts: [
          { id: 'a1', label: 'Option A1', short: 'A1', chosen: true, src: 'test' },
          { id: 'a2', label: 'Option A2', short: 'A2', strawman: true },
        ],
      },
      {
        id: 'two',
        name: 'Row two',
        opts: [
          { id: 'b1', label: 'Option B1', short: 'B1', chosen: true, src: 'test' },
          { id: 'b2', label: 'Option B2', short: 'B2', strawman: true },
        ],
      },
    ],
    rel: {
      a1: { why: 'The first option, because something', rel: [['b2', 'conf', 'A1 rules B2 out']] },
      a2: { why: 'The strawman for row one' },
      b1: { why: 'The first option of row two' },
      b2: { why: 'The strawman for row two' },
    },
    presets: [
      { title: 'Baseline', text: 'The chosen set.', steps: [{ label: 'Look' }] },
      { title: 'Stress', text: 'One change.', steps: [{ label: 'Change row one', set: { one: 'a2' } }] },
    ],
    ...patch,
  };
}

function write(name, value) {
  const p = join(work, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

test('--check validates the shipped example and names the chosen verdict', () => {
  const r = run(renderer, [exampleBox, '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verdict: as chosen/);
  assert.match(r.stderr, /^ok: /m);
});

test('--check writes no page', () => {
  const page = exampleBox.replace(/\.box\.json$/, '.html');
  const before = existsSync(page);
  run(renderer, [exampleBox, '--check']);
  assert.equal(existsSync(page), before);
});

test('--sel reads a configuration back and reports the conflict it creates', () => {
  // This is the round trip the skill is built on: the page writes a restore
  // code, and the renderer reads the same code back to the same verdict.
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: coach-always']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verdict: does not hold \(1 change/);
  assert.match(r.stdout, /conflict: Coach layer: Always a quiz vs Depth control/);
});

test('--sel with no change returns the chosen verdict, not a changed one', () => {
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: none']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verdict: as chosen/);
});

test('--sel refuses an option id that is not in the box', () => {
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: no-such-option']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no-such-option/);
});

test('--out writes the page with the box and the module inside it', () => {
  const out = join(work, 'page.html');
  const r = run(renderer, [exampleBox, '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, new RegExp(`wrote .*${'page.html'.replace('.', '\\.')}`));
  const html = readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  // The three substitutions the renderer makes: title, box data, module.
  assert.match(html, /<title>[^<]*eagle-eye<\/title>/);
  assert.match(html, /const BOX = \{/);
  assert.match(html, /const EagleEye = \(\(\) => \{/);
});

test('the page loads no code from anywhere else', () => {
  // "Self-contained" is the claim README and SECURITY.md make, and it is true
  // of everything that runs: no script and no image is fetched. One external
  // request remains, and this test states it rather than rounding it off — a
  // Google Fonts stylesheet, which the page falls back from when it fails.
  // Any new external reference turns this test red, which is the point.
  //
  // Say the width, as SECURITY.md does for the escape. This looks at src and
  // href on a script, link or img element. A CSS @import, a url(), a fetch or
  // an iframe would be a second way out and this test would stay green.
  const out = join(work, 'external.html');
  run(renderer, [exampleBox, '--out', out]);
  const html = readFileSync(out, 'utf8');
  const external = html.match(/<(?:script|link|img)[^>]+(?:src|href)="(https?:[^"]*)"/gi) || [];
  assert.equal(external.length, 1, `unexpected external references: ${external.join(', ')}`);
  assert.match(external[0], /^<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\//);
  assert.equal(/<script[^>]+src=/i.test(html), false, 'no script is loaded from a URL');
});

test('the page carries no leftover module.exports line', () => {
  // render.mjs strips it with a regex anchored to the end of the file. If a
  // line is ever added after it, the strip misses and the page throws on load.
  const out = join(work, 'stripped.html');
  run(renderer, [exampleBox, '--out', out]);
  assert.equal(readFileSync(out, 'utf8').includes('module.exports = EagleEye'), false);
});

test('a box whose text closes the script block cannot close it', () => {
  // The threat SECURITY.md names: a .box.json you did not write becomes an
  // HTML page you open. The box JSON is written inside a <script> block, and
  // the first "</script>" in that block ends it — whatever the quotes say.
  const payload = '</script><script>window.__pwned = 1;</script>';
  const clean = join(work, 'clean.html');
  run(renderer, [write('clean.box.json', box()), '--out', clean]);

  const b = box();
  b.rel.a1.why = `A reason containing ${payload} in the middle`;
  const out = join(work, 'injected.html');
  const r = run(renderer, [write('injected.box.json', b), '--out', out]);
  assert.equal(r.code, 0);
  const html = readFileSync(out, 'utf8');

  // The payload is in the page, so this test cannot pass by the text being
  // dropped. It is there with the slash escaped, which no parser reads as a
  // closing tag.
  assert.ok(html.includes('window.__pwned'), 'the payload should reach the page, escaped');
  assert.ok(html.includes('<\\/script>'), 'the closing tag should be written with an escaped slash');

  // Only "</script>" ends a script block. The payload's opening tag sits
  // inside a JavaScript string and does nothing, so the count that matters is
  // the closing one: the injected page must close exactly as many blocks as
  // the same box closes without the payload.
  const closes = s => (readFileSync(s, 'utf8').match(/<\/script\s*>/gi) || []).length;
  assert.equal(closes(out), closes(clean), 'the payload closed no script block');
});

test('a title cannot carry markup into the head', () => {
  // The title is the one piece of box text the renderer writes outside a
  // script block, so it gets its own guard: < > and & are removed, not
  // escaped. Nothing else in the page interpolates box text into markup.
  const b = box({ title: 'Break <img src=x onerror=alert(1)> out' });
  const out = join(work, 'title.html');
  run(renderer, [write('title.box.json', b), '--out', out]);
  const head = readFileSync(out, 'utf8').split('</head>')[0];
  assert.equal(/<img/i.test(head), false);
  assert.match(head, /<title>Break img src=x onerror=alert\(1\) out — eagle-eye<\/title>/);
});

test('a box with two chosen options in one row is refused, and no page is written', () => {
  const b = box();
  b.dims[0].opts[1].chosen = true;
  const src = write('two-chosen.box.json', b);
  const r = run(renderer, [src]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exactly one option must be chosen \(found 2\)/);
  assert.equal(existsSync(src.replace(/\.box\.json$/, '.html')), false);
});

test('an edge to an option that does not exist is refused', () => {
  const b = box();
  b.rel.a1.rel = [['ghost', 'conf', 'points at nothing']];
  const r = run(renderer, [write('ghost-edge.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /target "ghost" is not an option/);
});

test('a measured edge that names no source is refused', () => {
  // The tier system is the skill's honesty claim. An edge may say it was
  // measured only if it says what was measured.
  const b = box();
  b.rel.a1.rel = [['b2', 'conf', 'A1 rules B2 out', 'measured']];
  const r = run(renderer, [write('unsourced.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a measured edge must name its src/);
});

test('an option with no short name is refused, because an id is not a name', () => {
  const b = box();
  delete b.dims[0].opts[0].short;
  const r = run(renderer, [write('no-short.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /short: required/);
});

test('a box whose presets never change an option is refused', () => {
  const b = box();
  b.presets = [
    { title: 'One', text: 'A walk.', steps: [{ label: 'Look' }] },
    { title: 'Two', text: 'Another walk.', steps: [{ label: 'Look again' }] },
  ];
  const r = run(renderer, [write('flat-presets.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /At least one must carry a "set" step/);
});

test('a box with no problem statement is refused, and no page is written', () => {
  // The failure this field exists for: a reader opens a kept box weeks later
  // and finds rows, a grid, and no sentence saying what is being decided. A
  // row's own `problem` explains one decision; nothing explained the set.
  const b = box();
  delete b.problem;
  const src = write('no-problem.box.json', b);
  const r = run(renderer, [src]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: problem: required/m);
  assert.equal(existsSync(src.replace(/\.box\.json$/, '.html')), false);
});

test('the refusal names the field, says what to write, and says where to read more', () => {
  // An author must be able to fix this without opening render.mjs.
  const b = box();
  delete b.problem;
  const r = run(renderer, [write('no-problem-message.box.json', b)]);
  assert.match(r.stderr, /state the problem this box decides/);
  assert.match(r.stderr, /the people it affects/);
  assert.match(r.stderr, /the date it must be settled/);
  assert.match(r.stderr, /SKILL\.md, "The brief"/);
});

test('a problem statement of whitespace is refused, as the schema says', () => {
  // The schema states minLength 1 and the pattern \S. The renderer trims. The
  // two must agree, or the documented shape is not the enforced one.
  const r = run(renderer, [write('blank-problem.box.json', box({ problem: ' \n\t ' }))]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: problem: required/m);
});

test('a box with a problem and no who and no when renders', () => {
  // Who and when are optional. The brief is not a form.
  const out = join(work, 'brief-only.html');
  const r = run(renderer, [write('brief-only.box.json', box()), '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(existsSync(out), true);
});

test('who and when are accepted, and a blank one is refused rather than ignored', () => {
  const ok = run(renderer, [
    write('who-when.box.json', box({ who: 'The two maintainers.', when: 'Not known.' })),
    '--check',
  ]);
  assert.equal(ok.code, 0);

  for (const field of ['who', 'when']) {
    const r = run(renderer, [write(`blank-${field}.box.json`, box({ [field]: '  ' })), '--check']);
    assert.equal(r.code, 1, `a blank ${field} should be refused`);
    assert.match(r.stderr, new RegExp(`^error: ${field}: `, 'm'));
  }
});

test('a row with no problem statement still warns, and the box renders', () => {
  // The row-level field keeps the treatment it had. Only the box-level one is
  // refused, and the two messages name different places.
  const b = box();
  b.dims[0].problem = undefined;
  const r = run(renderer, [write('row-no-problem.box.json', b), '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /^warning: dims\[0\] "Row one": no problem/m);
});

test('unreadable JSON exits 2, not 1', () => {
  // 2 is "I could not read the file", 1 is "I read it and it is wrong". A
  // caller that cannot tell those apart reports a typo as a broken box.
  const p = join(work, 'broken.box.json');
  writeFileSync(p, '{ not json');
  const r = run(renderer, [p]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot read/);
});

test('no box path at all exits 2 with the usage line', () => {
  const r = run(renderer, []);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: node render\.mjs/);
});
