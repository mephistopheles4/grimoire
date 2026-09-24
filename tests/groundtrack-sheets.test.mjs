// The groundtrack sheets, at the seam a maintainer uses: the script's command
// line. scripts/groundtrack-sheets.mjs draws the two SVGs the groundtrack
// README shows — the page with every pane it hides, and the tour's walk — from
// a flightpath file and its tour. A README shows an image with no script and
// no request, so everything a sheet needs is inside it.
//
// No fixture is committed: each file is derived from the shipped greet example
// and written to a temporary directory.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, exampleFlightpath, run } from './helpers.mjs';

const sheetsScript = join(root, 'scripts', 'groundtrack-sheets.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-sheets-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
/** The greet example without its tour, mutated, written to scratch. */
function derive(mutate) {
  const prog = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  delete prog.tour;
  mutate(prog);
  const p = join(work, `case-${n++}.flightpath.json`);
  writeFileSync(p, JSON.stringify(prog, null, 2));
  return p;
}
const stop = (over = {}) => ({ region: 'callStack', run: 'no such user', move: 5, now: 'lookupName has just thrown.', ...over });

test('a file the renderer refuses is refused here too, with the renderer\'s reason', () => {
  const file = derive(p => { p.tour = [stop({ region: 'stack' })]; });
  const dir = mkdtempSync(join(work, 'draw-'));
  const r = run(sheetsScript, [file, dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /tour\[0\]\.region: "stack" is not a region of the page/);
  assert.equal(existsSync(join(dir, 'example-greet-sheet-1.svg')), false);
});


const drawn = (file, extra = []) => {
  const dir = mkdtempSync(join(work, 'draw-'));
  const r = run(sheetsScript, [file, dir, ...extra]);
  const read = name => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  return { r, dir, one: read('example-greet-sheet-1.svg'), two: read('example-greet-sheet-2.svg') };
};

test('the script writes two self-contained sheets from a file with a tour', () => {
  const { r, one, two } = drawn(exampleFlightpath);
  assert.equal(r.code, 0, r.stderr);
  for (const svg of [one, two]) {
    assert.ok(svg, 'the sheet is written');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<script/i, 'an image runs no script');
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:/, 'an image fetches nothing');
    assert.equal((svg.match(/@font-face/g) || []).length, 6, 'the six faces travel inside it');
  }
});

test('the script refuses a file with no tour, because the sheets are drawn from it', () => {
  const { r, one } = drawn(derive(() => {}));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /carries no tour, and the sheets are drawn from it/);
  assert.equal(one, null);
});
test('the walk draws each stop that moves the cursor, and at most six', () => {
  const { two } = drawn(exampleFlightpath);
  // greet's ten stops: 1 and 2 share a move, 8, 9 and 10 share another, so
  // stops 1, 3, 4, 5, 6 and 7 move the cursor, and the sixth is the last kept.
  assert.deepEqual([...two.matchAll(/>STOP (\d+) ·/g)].map(m => Number(m[1])), [1, 3, 4, 5, 6, 7]);
  const still = derive(p => { p.tour = [stop(), stop({ region: 'errorPath' }), stop({ region: 'effectsLedger' })]; });
  const r = drawn(still);
  assert.equal(r.r.code, 0, r.r.stderr);
  assert.deepEqual([...r.two.matchAll(/>STOP (\d+) ·/g)].map(m => Number(m[1])), [1], 'three stops at one move are one picture');
});

test('the parts list names every region the page has, in the page\'s words', () => {
  const { one } = drawn(exampleFlightpath);
  for (const label of ['the drawing', 'runs', 'step controls', 'tools', 'call stack', 'arguments', 'error path', 'effects ledger', 'cutaway', 'title block', 'trace']) {
    assert.match(one, new RegExp(`>${label}<`), label);
  }
  assert.doesNotMatch(one, />sheet</, 'a one-graph page has no sheet picker to call out');
});

test('author text reaches a sheet as text, never as markup', () => {
  const file = derive(p => { p.tour = [stop({ now: '<script>alert(1)</script> & done' })]; });
  const { r, two } = drawn(file);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(two, /<script\b/i, 'no script element, in any case');
  assert.match(two, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; done/);
});