// The eagle-eye sheets, at the seam a maintainer uses: the script's command
// line. scripts/eagle-eye-sheets.mjs draws the two SVGs eagle-eye's README
// shows — the page with every pane it hides, and the tour's walk — from a box
// file and its tour. A README shows an image with no script and no request, so
// everything a sheet needs is inside it.
//
// No fixture is committed: each box is derived from the shipped example and
// written to a temporary directory.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, exampleBox, run } from './helpers.mjs';

const sheetsScript = join(root, 'scripts', 'eagle-eye-sheets.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-eagle-sheets-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
/** The shipped example, mutated, written to scratch as <name>.box.json. */
function derive(mutate) {
  const box = JSON.parse(readFileSync(exampleBox, 'utf8'));
  mutate(box);
  const p = join(work, `case-${n++}.box.json`);
  writeFileSync(p, JSON.stringify(box, null, 2));
  return p;
}
const drawn = file => {
  const dir = mkdtempSync(join(work, 'draw-'));
  const r = run(sheetsScript, [file, dir]);
  const name = file.split(/[\\/]/).pop().replace(/\.box\.json$/, '');
  const read = f => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  return { r, one: read(`${name}-sheet-1.svg`), two: read(`${name}-sheet-2.svg`) };
};

test('the script writes two self-contained sheets from a box with a tour', () => {
  const { r, one, two } = drawn(exampleBox);
  assert.equal(r.code, 0, r.stderr);
  for (const svg of [one, two]) {
    assert.ok(svg, 'the sheet is written');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<script\b/i, 'an image runs no script');
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:/, 'an image fetches nothing');
    assert.equal((svg.match(/@font-face/g) || []).length, 6, 'the six faces travel inside it');
  }
});

test('the script refuses a box with no tour, because the sheets are drawn from it', () => {
  const { r, one } = drawn(derive(b => { delete b.tour; }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /carries no tour, and the sheets are drawn from it/);
  assert.equal(one, null);
});

test('a box the renderer refuses is refused here too, with the renderer\'s reason', () => {
  const { r, one } = drawn(derive(b => { b.tour = [{ region: 'grid', now: 'x' }]; }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /error: tour\[0\]\.region: "grid" is not a region of the page/);
  assert.equal(one, null);
});

test('the walk draws each stop that changes the page, and at most six', () => {
  const { two } = drawn(exampleBox);
  // The example's ten stops: 1–3 share the chosen set, 5 and 6 share the break
  // test, 8–10 share the chosen set again, so 1, 4, 5, 7 and 8 change the page.
  assert.deepEqual([...two.matchAll(/>STOP (\d+) ·/g)].map(m => Number(m[1])), [1, 4, 5, 7, 8]);
  const still = derive(b => { b.tour = [{ region: 'index', now: 'a' }, { region: 'verdict', now: 'b' }, { region: 'start', now: 'c' }]; });
  const r = drawn(still);
  assert.equal(r.r.code, 0, r.r.stderr);
  assert.deepEqual([...r.two.matchAll(/>STOP (\d+) ·/g)].map(m => Number(m[1])), [1], 'three stops on one page are one picture');
});

test('sheet one is drawn at the break test, and its parts list names every region in the page\'s words', () => {
  const { one } = drawn(exampleBox);
  assert.match(one, /Prompt-only swapped in: does not hold/, 'the stop that changes an option and shows the findings');
  for (const label of ['views', 'presets', 'coach', 'export', 'reset', 'index', 'verdict', 'brief', 'findings', 'option cards', 'sheet']) {
    assert.match(one, new RegExp(`>${label}<`), label);
  }
});

test('box text reaches a sheet as text, never as markup', () => {
  const file = derive(b => { b.tour = [{ region: 'verdict', now: '<script>alert(1)</script> & done' }]; });
  const { r, two } = drawn(file);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(two, /<script\b/i);
  assert.match(two, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; done/);
});
