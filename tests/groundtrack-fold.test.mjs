// The one module the page and the renderer both run, reached directly.
//
// This is the seam that makes the walk fold testable at all. The repository
// takes no dependency, so there is no headless browser and there never will
// be: the fold has to be reachable from Node with no DOM. The module lives
// apart from the markup that calls it for exactly that reason, and
// render.mjs inlines it into the page so the page and this test run the same
// function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, exampleFlightpath, layeredFlightpath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const G = require(join(root, 'skills', 'groundtrack', 'scripts', 'groundtrack.js'));

const greet = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
const layered = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
const runNamed = (prog, name) => prog.presets.find(p => p.name === name);

/* -- the escape ----------------------------------------------------------- */

test('esc turns a tag into text', () => {
  assert.equal(G.esc('<script>alert(1)</script>'), '&lt;script>alert(1)&lt;/script>');
});

test('esc escapes the ampersand before the angle bracket', () => {
  // Order is the whole trick. Escape < first and "&lt;" becomes "&amp;lt;",
  // which the browser renders as the text "&lt;" instead of a bracket.
  assert.equal(G.esc('&lt;script>'), '&amp;lt;script>');
});

test('esc leaves the double quote alone', () => {
  // Not an oversight and not a licence. This is the exact fact that makes "no
  // author text reaches an HTML attribute" load-bearing. Widen this and the
  // pairing has moved, which is a change to the security policy.
  assert.equal(G.esc('a "quoted" location'), 'a "quoted" location');
});

test('esc renders a missing value as the empty string, not "undefined"', () => {
  assert.equal(G.esc(undefined), '');
  assert.equal(G.esc(null), '');
});

/* -- the id pattern ------------------------------------------------------- */

test('the id pattern admits letters, digits and hyphens, and nothing else', () => {
  for (const ok of ['greet', 'bindSheet', 'bind-sheet', 't301', 'A1']) assert.ok(G.ID.test(ok), ok);
  for (const no of ['', '-lead', 'has space', 'quote"', 'brack<et', 'under_score']) {
    assert.ok(!G.ID.test(no), no);
  }
});

/* -- the fold ------------------------------------------------------------- */

test('the fold seeds the entry frame with the cursor at zero, before any move', () => {
  // A walk begins in the entry node with the cursor at zero. No move says so,
  // so the seed state has to.
  const s = G.fold(greet, runNamed(greet, 'a known user').walk);
  assert.deepEqual(s[0].frames.map(f => [f.nodeId, f.pc]), [['greet', 0]]);
  assert.deepEqual(s[0].ledger, []);
  assert.equal(s[0].ended, null);
});

test('one state per cursor position, and one more than there are moves', () => {
  const walk = runNamed(greet, 'a known user').walk;
  assert.equal(G.fold(greet, walk).length, walk.steps.length + 1);
});

test('a call pushes a frame at step zero and parks the caller at its own next', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'call');
  const after = s[i + 1];
  assert.deepEqual(after.frames.map(f => [f.nodeId, f.pc]), [['greet', 2], ['lookupName', 0]]);
  // The caller's cursor is already past its own guard while the callee runs.
  // That is exactly what the uncaught check has to get right.
  assert.equal(after.frames[0].callAt, 1);
});

test('a return pops the frame and clears the caller from its call', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'return');
  assert.deepEqual(s[i + 1].frames.map(f => f.nodeId), ['greet']);
  assert.equal(s[i + 1].frames[0].callAt, undefined);
});

test('an unwind pops the frame and keeps the error travelling', () => {
  const walk = runNamed(greet, 'no such user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'unwind');
  assert.deepEqual(s[i + 1].frames.map(f => f.nodeId), ['greet']);
  // The caller is still suspended at the call it made, which is the case the
  // uncaught check exists for.
  assert.equal(s[i + 1].frames[0].callAt, 1);
  assert.ok(s[i + 1].errorPath.some(e => e.how === 'passed through'));
});

test('an effect mark outlives the frame that produced it', () => {
  // The drawing shows one box per node and the tree shows one row per call
  // site. Read off the open frame, a node's marks vanished from the drawing
  // the moment it returned, while the tree kept them — one graph seen two
  // ways, disagreeing. The fold carries both keyings for that reason.
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  assert.equal(end.frames.length, 0, 'nothing is on the stack at the end');
  assert.equal(end.nodeEffects['lookupName[0]'], 'landed');
  assert.equal(end.nodeEffects['greet[6]'], 'landed');
  // And it is still cumulative-to-the-cursor, not the whole walk at once.
  assert.deepEqual(s[0].nodeEffects, {});
});

test('the ledger grows one row per effect, in order, with what the walk claims', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  assert.deepEqual(end.ledger.map(l => [l.nodeId, l.kind, l.outcome]), [
    ['lookupName', 'db.get', 'landed'],
    ['greet', 'http.post', 'landed'],
  ]);
});

test('a failing effect is one move, and it lands in the ledger as raised', () => {
  const walk = runNamed(greet, 'the post fails').walk;
  const s = G.fold(greet, walk);
  const end = s[s.length - 1];
  const failed = end.ledger.filter(l => l.outcome === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].raised.tag, 'SendFailed');
  assert.equal(end.ended, 'uncaught');
  assert.deepEqual(end.frames, []);
});

test('a handled catch moves the cursor and records the catch on the error path', () => {
  const walk = runNamed(greet, 'no such user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'handled');
  assert.ok(s[i + 1].errorPath.some(e => e.how === 'caught'));
  assert.equal(s[i + 1].frames[0].pc, walk.steps[i].next);
});

test('the fold records which edges the walk took, and which nodes it reached', () => {
  const walk = runNamed(layered, 'the sheet 404s').walk;
  const end = G.fold(layered, walk).slice(-1)[0];
  assert.ok(end.edges.includes('buildShelf>bindSheet'));
  assert.ok(end.visited.includes('fibreMapFor'));
  // The terminal move leaves no frame open.
  assert.deepEqual(end.frames, []);
  assert.equal(end.ended, 'done');
});

/* -- stepping backward ---------------------------------------------------- */

test('stepping backward returns the state stepping forward produced, move for move', () => {
  for (const preset of greet.presets) {
    const s = G.fold(greet, preset.walk);
    for (let i = s.length - 1; i > 0; i--) {
      const { state } = G.back(s, i);
      assert.deepEqual(state, s[i - 1], `${preset.name} at move ${i}`);
    }
  }
});

test('stepping back over a call redraws it callee to caller', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'call') + 1;
  assert.deepEqual(s[i].moved, { from: 'greet', to: 'lookupName', dir: 'call' });
  assert.deepEqual(G.back(s, i).redraw, { from: 'lookupName', to: 'greet', dir: 'uncall' });
});

test('stepping back over a return redraws it caller to callee', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  const i = walk.steps.findIndex(m => m.k === 'return') + 1;
  assert.deepEqual(s[i].moved, { from: 'lookupName', to: 'greet', dir: 'return' });
  assert.deepEqual(G.back(s, i).redraw, { from: 'greet', to: 'lookupName', dir: 'unreturn' });
});

test('a move that walks no edge redraws nothing', () => {
  const walk = runNamed(greet, 'a known user').walk;
  const s = G.fold(greet, walk);
  assert.equal(s[1].moved, null); // the opening note
  assert.equal(G.back(s, 1).redraw, null);
});

/* -- the derived cut ------------------------------------------------------ */

test('the shipped layer-carrying example cuts no edge', () => {
  // A layer renames a token, never a node, and a rename only cuts an edge when
  // the token is in that call's own arguments. It is not, here.
  assert.deepEqual(G.cutEdges(layered), []);
});

test('a renamed token in a call step argument cuts that edge', () => {
  const prog = JSON.parse(JSON.stringify(layered));
  const call = prog.nodes.buildShelf.steps.find(s => s.op === 'call' && s.target === 'bindSheet');
  call.args = { loader: 'THREE.TextureLoader' };
  const cuts = G.cutEdges(prog);
  assert.equal(cuts.length, 1);
  assert.deepEqual(
    { layer: cuts[0].layer, from: cuts[0].from, to: cuts[0].to, token: cuts[0].token },
    { layer: 'tests', from: 'buildShelf', to: 'bindSheet', token: 'THREE.TextureLoader' },
  );
});

test('a token that appears in no call argument cuts nothing', () => {
  const prog = JSON.parse(JSON.stringify(layered));
  prog.layers.tests.nodes.bindSheet.R = ['SomethingNobodyPasses -> a double'];
  prog.layers.tests.nodes.applyWoodFibre.R = ['AlsoNobody -> a double'];
  assert.deepEqual(G.cutEdges(prog), []);
});

test('both arrow spellings name the same renamed token', () => {
  assert.equal(G.renamedToken('Loader -> fake()'), 'Loader');
  assert.equal(G.renamedToken('Loader → fake()'), 'Loader');
});

/* -- the tree ------------------------------------------------------------- */

test('one row is a call site, so a node called twice appears twice', () => {
  const rows = G.treeRows(layered, runNamed(layered, 'the sheet 404s').walk);
  assert.equal(rows.filter(r => r.id === 'bindSheet').length, 2);
  // And the two carry different end marks, which is what makes the second row
  // worth printing.
  const [first, second] = rows.filter(r => r.id === 'bindSheet');
  assert.notDeepEqual(first.effects.map(e => e.mark), second.effects.map(e => e.mark));
});

test('the tree marks a repeat and stops, so a cycle terminates', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  const rows = G.treeRows(prog, runNamed(prog, 'a known user').walk);
  assert.ok(rows.some(r => r.repeat));
  assert.ok(rows.length < 10, 'the walk terminated');
});

test('the tree reads its marks at the cursor, not only at the end', () => {
  // Stepping works in tree mode. Only the animation goes.
  const walk = runNamed(greet, 'a known user').walk;
  const states = G.fold(greet, walk);
  const atStart = G.treeRows(greet, walk, null, 0, states);
  const atEnd = G.treeRows(greet, walk, null, undefined, states);
  assert.equal(atStart.find(r => r.id === 'lookupName').state, 'not reached');
  assert.equal(atEnd.find(r => r.id === 'lookupName').state, 'returned');
});

test('the tree carries the layer rename on the row', () => {
  const rows = G.treeRows(greet, runNamed(greet, 'a known user').walk, 'tests');
  const row = rows.find(r => r.id === 'lookupName');
  assert.ok(row.rename && row.rename.length, 'the row carries the renamed tokens');
});

/* -- which run the text suggests ------------------------------------------ */

test('the suggested run is the longest walk', () => {
  for (const prog of [greet, layered]) {
    const i = G.suggestRun(prog);
    const longest = Math.max(...prog.presets.map(p => p.walk.steps.length));
    assert.equal(prog.presets[i].walk.steps.length, longest);
  }
});

/* -- the drawing ---------------------------------------------------------- */

test('a node with one caller sits straight beneath it', () => {
  // fibreMapFor is called by applyWoodFibre and nobody else. Centring each row
  // on the sheet put it under the middle of the drawing instead, three boxes
  // away from the only edge that reaches it.
  const l = G.layout(layered);
  assert.equal(l.pos.fibreMapFor.x, l.pos.applyWoodFibre.x);
  // Placing by caller never lets two boxes in a row overlap.
  const byRow = {};
  for (const [id, p] of Object.entries(l.pos)) (byRow[p.y] = byRow[p.y] || []).push(p.x);
  for (const xs of Object.values(byRow)) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= l.width, 'two boxes in one row overlap');
  }
  // And nothing runs off the right edge of the canvas.
  for (const p of Object.values(l.pos)) assert.ok(p.x + l.width <= l.canvasW);
});

test('the layout places every node and draws every call edge once', () => {
  const l = G.layout(layered);
  assert.deepEqual(Object.keys(l.pos).sort(), Object.keys(layered.nodes).sort());
  const pairs = l.edges.map(e => `${e.from}>${e.to}`);
  assert.equal(new Set(pairs).size, pairs.length, 'no edge is drawn twice');
  assert.ok(l.canvasW > 0 && l.canvasH > 0);
});
