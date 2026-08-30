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

// ---- chains ----
// The chain finding reads the join between two edges, over the whole box. A
// chain needs three rows: an edge out of row one, an edge out of row two, and
// the far option in row three. Each test writes the edges it needs and reads
// the finding back off the command line.
function chainBox(rel) {
  const row = (id, name, p) => ({ id, name, opts: [
    { id: `${p}1`, label: `Option ${p}1`, short: `${p.toUpperCase()}1`, chosen: true, src: 'test' },
    { id: `${p}2`, label: `Option ${p}2`, short: `${p.toUpperCase()}2`, strawman: true },
  ] });
  return {
    title: 'A chain box',
    dims: [row('one', 'Row one', 'a'), row('two', 'Row two', 'b'), row('three', 'Row three', 'c')],
    rel: Object.fromEntries(Object.entries(rel).map(([id, edges]) => [id, { why: `The reason for ${id}`, rel: edges }])),
    presets: [
      { title: 'Baseline', text: 'The chosen set.', steps: [{ label: 'Look' }] },
      { title: 'Stress', text: 'One change.', steps: [{ label: 'Change row one', set: { one: 'a2' } }] },
    ],
  };
}

const checkChain = (name, rel) => run(renderer, [write(name, chainBox(rel)), '--check']).stdout;

test('two req edges derive a requires relation, and the finding names the path', () => {
  const out = checkChain('chain-req.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.match(out, /chain: Row one: A1 requires Row three: C1, through Row two: B1\./);
  assert.match(out, /The box does not state it/);
  assert.match(out, /weakest edge on the path is argued/);
});

test('a req edge closed by a conf edge derives a rules out relation', () => {
  const out = checkChain('chain-conf.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'conf', 'B1 rules C1 out']],
  });
  assert.match(out, /chain: Row one: A1 rules out Row three: C1, through Row two: B1\./);
});

test('a conf edge starts no chain', () => {
  // The rule the whole finding turns on: a conf removes the target from the
  // set, so the target's own edges never fire and compose with nothing.
  const out = checkChain('chain-conf-first.box.json', {
    a1: [['b1', 'conf', 'A1 rules B1 out']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.equal(/chain:/.test(out), false, out);
});

test('two options that require each other are one cycle, reported once', () => {
  const out = checkChain('chain-cycle.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['a1', 'req', 'B1 needs A1']],
  });
  assert.match(out, /cycle: Row one: A1 and Row two: B1 require each other/);
  assert.equal((out.match(/cycle:/g) || []).length, 1, out);
  assert.equal(/chain:/.test(out), false, out);
});

test('a derived relation between two options of one row is not reported', () => {
  // A2 is the other option of A1's row. Choosing one option in a row already
  // excludes its siblings, so the pair derives nothing worth saying.
  const out = checkChain('chain-same-row.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['a2', 'req', 'B1 needs A2']],
  });
  assert.equal(/chain:/.test(out), false, out);
});

test('a derived relation the box already states is reported as stated', () => {
  const out = checkChain('chain-stated.box.json', {
    a1: [['b1', 'req', 'A1 needs B1'], ['c1', 'req', 'A1 needs C1 as well']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.match(out, /The box states this relation/);
});

test('the shipped example box reports its chain and holds no cycle', () => {
  const out = run(renderer, [exampleBox, '--check']).stdout;
  assert.match(out, /chain: Coach layer: Opt-in predict rules out Box file format: Embedded in page/);
  assert.equal(/cycle:/.test(out), false, out);
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
