// The one module the page and the renderer both run, reached directly.
//
// This is the seam that makes the walk fold testable at all. The repository
// takes no dependency, so there is no headless browser and there never will
// be: the fold has to be reachable from Node with no DOM. The module lives
// apart from the markup that calls it for exactly that reason, and
// render.mjs inlines it into the page so the page and this test run the same
// function.
//
// The files tab is the one piece of markup the module builds itself, because
// the tab is written into the page at click time and no rendered page carries
// it as a string. Its markup is at the end of this file for that reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, exampleFlightpath, layeredFlightpath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const G = require(join(root, 'skills', 'groundtrack', 'scripts', 'groundtrack.js'));

// A file states a change and lists its graphs. Everything below reads one
// graph, so everything below reads a view: the change's node map with one
// graph's entry and runs on it. That is the shape the fold, the tree and the
// page all take, and it is why none of the tests under it had to change when
// the container did.
const view = (path, i = 0) => G.graphView(JSON.parse(readFileSync(path, 'utf8')), i);
const greet = view(exampleFlightpath);
const layered = view(layeredFlightpath);
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

/* -- one change, several graphs ------------------------------------------- */

test('a view carries the change\'s node map with one graph\'s entry and runs', () => {
  // The node map belongs to the change, so a symbol two graphs reach is
  // defined once. What a view swaps is the entry and the runs, which is the
  // whole of what a graph is.
  const prog = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  const v = G.graphView(prog, 0);
  assert.equal(v.entry, prog.graphs[0].entry);
  assert.deepEqual(v.presets, prog.graphs[0].presets);
  assert.deepEqual(Object.keys(v.nodes), Object.keys(prog.nodes));
  assert.equal(v.graph.id, prog.graphs[0].id);
});

test('a view with no index is the first graph', () => {
  const prog = JSON.parse(readFileSync(exampleFlightpath, 'utf8'));
  assert.equal(G.graphView(prog).entry, G.graphView(prog, 0).entry);
});

test('what a graph draws is what its entry reaches through call edges', () => {
  assert.deepEqual([...G.reachable(greet, 'greet')].sort(), ['greet', 'lookupName']);
  // Enter at the callee and the caller is not in the drawing: a call edge runs
  // one way.
  assert.deepEqual([...G.reachable(greet, 'lookupName')], ['lookupName']);
});

test('a node two entries reach is in both drawings, and defined once', () => {
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  const first = G.reachable(prog, 'buildShelf');
  const second = G.reachable(prog, 'bindSheet');
  assert.ok(first.has('bindSheet') && second.has('bindSheet'));
  assert.equal(Object.keys(prog.nodes).filter(id => id === 'bindSheet').length, 1);
});

test('reachability terminates on a cycle', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  assert.deepEqual([...G.reachable(prog, 'greet')].sort(), ['greet', 'lookupName']);
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

/* -- the complexity of a node, as drawn ----------------------------------- */

test('cyclomatic complexity is one plus the ifs, the handlers and the loops', () => {
  // greet: one if, one onError handler on its call, and a goto that jumps
  // forward — which is no loop. lookupName: one if and nothing else.
  assert.deepEqual(G.complexityOf(greet.nodes.greet), { value: 3, ifs: 1, handlers: 1, loops: 0 });
  assert.deepEqual(G.complexityOf(greet.nodes.lookupName), { value: 2, ifs: 1, handlers: 0, loops: 0 });
});

test('a jump backward is a loop, and a node with no fork has one path', () => {
  const node = {
    steps: [
      { op: 'note', note: 'top', label: 'top' },
      { op: 'if', cond: 'again?', then: 'top', else: 'out' },
      { op: 'return', expr: 'x', label: 'out' },
    ],
  };
  assert.deepEqual(G.complexityOf(node), { value: 3, ifs: 1, handlers: 0, loops: 1 });
  assert.deepEqual(G.complexityOf({ steps: [{ op: 'return', expr: 'x' }] }), { value: 1, ifs: 0, handlers: 0, loops: 0 });
  assert.equal(G.complexityOf({}).value, 1);
});

/* -- the failure kind ----------------------------------------------------- */

test('the kind table reads the throw steps and the raised moves of the whole file', () => {
  // greet's lookupName throws NoSuchUser as an escape. Nothing throws
  // SendFailed anywhere; one walk raises it from an effect, as a retry. Both
  // reach the table, because both are what the file says.
  // Spread to compare, because the table has no prototype on purpose — see
  // the tag named after a property of every object, below.
  assert.deepEqual({ ...G.failureKinds(greet) }, { NoSuchUser: ['escape'], SendFailed: ['retry'] });
});

test('a tag the file gives no kind for is absent from the table, so the row prints bare', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.channels.E.push('Ghost');
  assert.equal(G.failureKinds(prog).Ghost, undefined);
});

test('a handler is not a source of a kind', () => {
  // An onError entry names the tag it catches and no channel. It says where a
  // failure stops, never what kind of failure it was. greet declares a handler
  // for NoSuchUser and throws nothing; take lookupName's throw away and the
  // tag has no kind left, however many handlers name it.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.lookupName.steps = prog.nodes.lookupName.steps.filter(s => s.op !== 'throw');
  // The kind is file-wide, so the walks are cleared where the file keeps them.
  // Emptying the view's own `presets` would leave every graph's walks in place
  // and the table would still find the raise.
  for (const g of prog.graphs) g.presets = [];
  prog.presets = [];
  assert.deepEqual({ ...G.failureKinds(prog) }, {});
});

test('a throw move is not a source of a kind — the step it ran is', () => {
  // The move repeats the step's channel, so reading both would be reading one
  // fact twice. Contradict them and the step is what the table says. The
  // validator refuses this file; the module is asked directly, which is what
  // makes the source of the fact visible.
  const prog = JSON.parse(JSON.stringify(greet));
  for (const p of prog.presets) for (const m of p.walk.steps) if (m.k === 'throw') m.channel = 'die';
  assert.deepEqual(G.failureKinds(prog).NoSuchUser, ['escape']);
});

test('a kind supplied only by another graph\'s walk still reaches this sheet', () => {
  // The kind is file-wide, and this is the case that says so. Read per graph,
  // a tag whose only `raised` lives in a walk of a graph you are not looking
  // at loses its kind and prints bare — no error, no failing test, and
  // invisible in every one-graph file that ships. The whole file is one
  // change, so what the change says about a tag holds on every sheet of it.
  const prog = JSON.parse(JSON.stringify(greet));
  const fails = prog.graphs[0].presets.find(p => p.walk.steps.some(m => m.k === 'effect' && m.raised));
  const dies = JSON.parse(JSON.stringify(fails));
  for (const m of dies.walk.steps) if (m.k === 'effect' && m.raised) m.raised.channel = 'die';

  // Move the fatal reading into a second graph, and leave the first with only
  // the retry. Read file-wide the tag has both; read per graph it has one.
  prog.graphs.push({ id: 'second', title: 'a second entry', blurb: 'b', entry: 'lookupName', presets: [dies] });
  assert.deepEqual(G.failureKinds(prog).SendFailed, ['retry', 'die']);

  // And a view of the *first* graph gives the same answer, which is the point:
  // the reader on sheet one is told what the change knows, not what sheet one
  // happens to contain.
  assert.deepEqual(G.failureKinds(G.graphView(prog, 0)).SendFailed, ['retry', 'die']);
});

test('a tag named after a property of every object is still just a tag', () => {
  // A failure tag is author text, and nothing validates it — only a node id is
  // constrained. So the kind table is looked up by a stranger's string, and a
  // plain object answers "constructor" and "toString" with something truthy
  // that is not a list of kinds. A file with such a tag rendered before this
  // table existed, and has to keep rendering.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.channels.E.push('constructor', 'toString', '__proto__');
  const table = G.failureKinds(prog);
  for (const tag of ['constructor', 'toString', '__proto__']) {
    assert.equal(table[tag], undefined, `${tag} has no kind`);
  }
  const rows = G.treeRows(prog, runNamed(prog, 'a known user').walk);
  const entry = rows.find(r => r.id === 'greet');
  for (const tag of ['constructor', 'toString', '__proto__']) {
    assert.equal(entry.kinds[tag], undefined, `${tag} carries no kind onto the row`);
  }
  // And the tags themselves are still on the row, to be printed bare.
  assert.ok(entry.E.includes('constructor'));
});

test('a tag raised with two kinds keeps both, retry before escape before die', () => {
  // A tag that retries in one place and dies in another is two facts, and
  // flattening them to one would lose the one the reader came for.
  const prog = JSON.parse(JSON.stringify(greet));
  const fails = prog.presets.find(p => p.walk.steps.some(m => m.k === 'effect' && m.raised));
  const dies = JSON.parse(JSON.stringify(fails));
  dies.name = 'the post dies';
  for (const m of dies.walk.steps) if (m.k === 'effect' && m.raised) m.raised.channel = 'die';
  // Written to the graph, which is where the file keeps its walks and where
  // the file-wide table reads them. Die is met first; the order out is still
  // retry, die.
  prog.graphs[0].presets = [dies, fails];
  prog.presets = prog.graphs[0].presets;
  assert.deepEqual(G.failureKinds(prog).SendFailed, ['retry', 'die']);
});

test('the tree row carries the kinds of the tags it prints, and nothing else', () => {
  const rows = G.treeRows(greet, runNamed(greet, 'a known user').walk);
  const entry = rows.find(r => r.id === 'greet');
  const callee = rows.find(r => r.id === 'lookupName');
  assert.deepEqual({ ...entry.kinds }, { NoSuchUser: ['escape'], SendFailed: ['retry'] });
  assert.deepEqual({ ...callee.kinds }, { NoSuchUser: ['escape'] });
  // The E channel is still the list of tags it always was.
  assert.deepEqual(callee.E, ['NoSuchUser']);
});

/* -- what a node does with a tag ------------------------------------------ */

test('a node throws a tag, catches it, or lets it pass up from beneath', () => {
  // greet declares a handler for NoSuchUser and throws nothing, so it catches.
  // lookupName throws it. Neither node names SendFailed in a throw or a
  // handler, so on greet it passes up from beneath.
  assert.deepEqual(G.tagFate(greet.nodes.greet, 'NoSuchUser'), { throws: false, catches: true });
  assert.deepEqual(G.tagFate(greet.nodes.lookupName, 'NoSuchUser'), { throws: true, catches: false });
  assert.deepEqual(G.tagFate(greet.nodes.greet, 'SendFailed'), { throws: false, catches: false });
});

test('a node that both throws a tag and catches it says both', () => {
  // No shipped example holds one, and it is the case a two-way answer would
  // get wrong: a node that raises a tag on one path and catches it on another
  // is not "the thrower" and not "the catcher".
  const node = {
    steps: [
      { op: 'call', target: 'x', onError: [{ tag: 'Wobble', goto: 'out' }] },
      { op: 'throw', tag: 'Wobble', message: 'again', channel: 'retry' },
      { op: 'return', expr: 'x', label: 'out' },
    ],
  };
  assert.deepEqual(G.tagFate(node, 'Wobble'), { throws: true, catches: true });
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

/* -- the files tab -------------------------------------------------------- */

// The tab is built at runtime from `innerHTML`, so the rendered page as a
// string cannot show the tree. The grouping lives here instead, which is the
// same seam the fold uses: a pure function the page calls and this file calls,
// with no DOM between them.

test('the three groups a node sees are read off the change and the node map', () => {
  const f = G.filesOf(layered, 'bindSheet');
  assert.deepEqual(f.mine, ['packages/site/src/shelf/woodwork.ts', 'packages/site/public/wood/sapele-diff-512.jpg']);
  // scene.ts is buildShelf's, and woodwork.ts is several nodes' — a file this
  // node touches is still listed against the others that touch it.
  assert.ok(f.others.includes('packages/site/src/shelf/scene.ts'));
  assert.ok(f.others.includes('packages/site/src/shelf/woodwork.ts'));
  assert.equal(f.unaccounted.length, 14);
  assert.ok(!f.unaccounted.includes('packages/site/src/shelf/scene.ts'));
});

test('the second group is not empty while other nodes touch files', () => {
  // A tripwire, and the shape of the bug it is set for matters more than the
  // assertion. Once a file lists graphs there is no top-level `entry` — only a
  // view of one graph has one — so a reader that narrows this group by what
  // the entry reaches, handed the raw program, narrows it by `undefined` and
  // gets nothing. The group renders empty, and empty is what a files tab looks
  // like when a node touches nothing, so the page still reads as if it were
  // telling the truth.
  //
  // The failure cannot be provoked here: nothing on this branch narrows the
  // group, and the graphs shape does not exist yet. What can be held is the
  // symptom, which is the same whatever causes it. The two `includes` above
  // would also catch it, but they are asserting something else and would not
  // survive a rewrite of that test with this property intact. They were
  // written the same day as this one, which is the point rather than a
  // mitigation: a test acquires an unnamed load-bearing assertion as soon as
  // it is written, not once it has aged into folklore, and the next person to
  // tidy it drops the property with a green suite.
  for (const [prog, id] of [[layered, 'bindSheet'], [layered, 'fibreMapFor'], [greet, 'greet']]) {
    assert.ok(G.filesOf(prog, id).others.length > 0, id);
  }
});

test('a file that states no changed files leaves nothing unaccounted for', () => {
  const bare = { ...layered };
  delete bare.files;
  assert.deepEqual(G.filesOf(bare, 'bindSheet').unaccounted, []);
});

test('paths group under their directories, in first-appearance order', () => {
  const rows = G.fileTree(G.filesOf(layered, 'bindSheet').unaccounted);
  const dirs = rows.filter(r => !r.path).map(r => r.label);
  assert.deepEqual(dirs, ['gates', 'packages/site/src/shelf', 'docs', 'adr']);
  // Every path put in comes back out exactly once, and nothing else does.
  const files = rows.filter(r => r.path);
  assert.equal(files.length, 14);
  assert.equal(new Set(files.map(r => r.path)).size, 14);
});

test('a directory holding one thing collapses into the line below it', () => {
  const rows = G.fileTree(G.filesOf(layered, 'bindSheet').unaccounted);
  // docs/log holds one file, so it is one row and not a header plus a row.
  const log = rows.filter(r => r.label.startsWith('log/'));
  assert.equal(log.length, 1);
  assert.equal(log[0].path, 'docs/log/2026-08-30-the-species-menu-and-the-read-back.md');
  assert.equal(log[0].label, 'log/2026-08-30-the-species-menu-and-the-read-back.md');
  // And a chain of one-child directories is one header, not four.
  assert.equal(rows.filter(r => r.label === 'packages').length, 0);
});

test('a lone path is one line with no header above it', () => {
  assert.deepEqual(G.fileTree(['src/greet.ts']), [{ depth: 0, label: 'src/greet.ts', path: 'src/greet.ts' }]);
  assert.deepEqual(G.fileTree([]), []);
});

test('a row sits one level under the header that names its directory', () => {
  const rows = G.fileTree(['a/one.ts', 'a/two.ts', 'b/c/three.ts', 'b/d/four.ts']);
  assert.deepEqual(rows, [
    { depth: 0, label: 'a' },
    { depth: 1, label: 'one.ts', path: 'a/one.ts' },
    { depth: 1, label: 'two.ts', path: 'a/two.ts' },
    { depth: 0, label: 'b' },
    { depth: 1, label: 'c/three.ts', path: 'b/c/three.ts' },
    { depth: 1, label: 'd/four.ts', path: 'b/d/four.ts' },
  ]);
});

test('a label joined to its ancestors is the path again, whatever the path holds', () => {
  // The label is what prints. If it did not reconstruct the path, the tab
  // would be showing a reader a path that is not the one in the change.
  for (const p of ['/leading.ts', 'doubled//sep.ts', 'trailing/', 'bare.ts']) {
    const rows = G.fileTree([p]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].label, p);
    assert.equal(rows[0].path, p);
  }
});

/* -- the files tab, as markup --------------------------------------------- */

// This is the only surface the tab has. It is written into the cutaway with
// `innerHTML` at click time, so no rendered page carries it as a string and
// tests/groundtrack-render.test.mjs cannot see it at all. The function is in
// the module for that reason, and these are the tests that reason bought.

const POISON = '<img src=x onerror=alert(1)> & "quoted" </script><script>alert(2)</script>';

test('every author string on a row reaches the tab escaped', () => {
  // A path with a separator in it poisons a directory segment and a leaf, and
  // the `why` poisons the comment that trails the leaf. Drop the `esc` from
  // any of the three and this is what says so.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.files[0].path = `${POISON}/${POISON}`;
  prog.files[0].why = POISON;
  prog.nodes.greet.touches = [`${POISON}/${POISON}`];
  const out = G.filesMarkup(prog, 'greet');
  assert.doesNotMatch(out, /<img src=x onerror/);
  assert.match(out, /&lt;img src=x onerror/);
  assert.equal((out.match(/&lt;script>alert\(2\)/g) || []).length, 3, 'the segment, the leaf and the why');
});

test('the tab opens and closes one div per level it indents', () => {
  // The depth loop is where broken nesting would live, and broken nesting on
  // an innerHTML assignment silently eats the rest of the tab.
  for (const [prog, id] of [[layered, 'bindSheet'], [layered, 'buildShelf'], [greet, 'greet']]) {
    const out = G.filesMarkup(prog, id);
    assert.equal((out.match(/<div/g) || []).length, (out.match(/<\/div>/g) || []).length, id);
  }
});

test('a file row carries its mark, its leaf, its counts and its why', () => {
  const out = G.filesMarkup(layered, 'buildShelf');
  assert.match(out, /<span class="fchange">N<\/span>/, 'a new file is marked N');
  assert.match(out, /<span class="fchange">E<\/span>/, 'an edited one is marked E');
  assert.match(out, /<span class="fpath">one-sheet\.test\.ts <span class="fwhy">&mdash; G53/);
  assert.match(out, /<span class="fnum">\+194 &minus;0<\/span>/);
  // The collapsed row prints the segments it swallowed, not a bare leaf.
  assert.match(out, /<span class="fpath">log\/2026-08-30-the-species-menu-and-the-read-back\.md /);
  assert.doesNotMatch(out, /<div class="fdir">log\//);
  assert.match(out, /<div class="fdir">gates\/<\/div>/);
  assert.match(out, /in the change, on no node of this sheet/);
});

test('a change kind outside the four prints a question mark, not a function', () => {
  // The validator refuses one, and this does not lean on the validator: a
  // bare-object lookup would find Object's own constructor and print it.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.files[0].change = 'constructor';
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /<span class="fchange">\?<\/span>/);
  assert.doesNotMatch(out, /function Object/);
});

test('a path that is a prototype member name still reads its own row', () => {
  // The second key into a plain object in this function, and the one with no
  // validator behind it at all: a path is author text. It has to *be* a
  // prototype name, not end in one — `src/constructor` is an ordinary key.
  //
  // With a bare `{}`, a node touching a path the change does not state finds
  // Object's own constructor, which is truthy, so the `|| {}` fallback never
  // fires and the row prints its change, adds and dels as undefined.
  const prog = JSON.parse(JSON.stringify(greet));
  prog.nodes.greet.touches = ['constructor'];
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /<span class="fchange">E<\/span>/, 'the fallback fired');
  assert.match(out, /<span class="fnum">\+0 &minus;0<\/span>/);
  assert.doesNotMatch(out, /undefined/);
  assert.doesNotMatch(out, /function Object/);
});

test('a file that states no changed files says so instead of drawing a tree', () => {
  const prog = JSON.parse(JSON.stringify(greet));
  delete prog.files;
  const out = G.filesMarkup(prog, 'greet');
  assert.match(out, /not stated by this file/);
  assert.doesNotMatch(out, /in the change, on no node/);
});
