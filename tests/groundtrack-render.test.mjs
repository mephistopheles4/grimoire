// The groundtrack renderer, at the seam a reader and an agent actually use:
// its command line. `scripts/check.mjs` already proves a flightpath file
// renders without throwing. It cannot prove the page is right, and it cannot
// prove a crafted file fails to inject script. These tests do both.
//
// Nothing here commits a fixture. Both root scripts walk the whole tree for
// every artifact suffix the registry names, so a valid fixture on disk would
// be published to the public site and a broken one would fail the check. Every
// fixture is derived from the shipped example and written to a temporary
// directory.
//
// The validator is the format, so this file is also what binds
// references/flightpath-file.md to the code. A rule stated there and not
// tested here is a rule nothing holds.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { groundtrack, examples, exampleFlightpath, layeredFlightpath, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-groundtrack-'));
after(() => rmSync(work, { recursive: true, force: true }));

const base = () => JSON.parse(readFileSync(exampleFlightpath, 'utf8'));

/** Write a derived program to the scratch directory and return its path. */
let n = 0;
function derive(mutate) {
  const prog = base();
  mutate(prog);
  const p = join(work, `case-${n++}.flightpath.json`);
  writeFileSync(p, JSON.stringify(prog, null, 2));
  return p;
}

const check = file => run(groundtrack, [file, '--check']);

// The small example states one change and one graph, and every mutator below
// reaches into that graph's runs. Named so the reshape reads as one thing
// rather than as a hundred index changes.
const only = prog => prog.graphs[0];
const runs = prog => prog.graphs[0].presets;

/**
 * Give a derived program a second entry point, sharing the one node map.
 *
 * A change with two entry points is what the container exists for, and the
 * small example has one. The second graph's run takes the first graph's name
 * on purpose: uniqueness is per graph.
 */
function addSecondGraph(prog) {
  prog.nodes.applyPanel = {
    name: 'applyPanel',
    role: 'handler',
    loc: 'src/panel.ts:1',
    params: [],
    channels: { A: 'void', E: [], R: [] },
    steps: [
      { op: 'call', target: 'lookupName', args: { id: 'id' } },
      { op: 'return', expr: 'undefined' },
    ],
    touches: ['src/panel.ts'],
    enteredBy: [],
  };
  prog.graphs.push({
    id: 'panel-apply',
    title: 'apply the panel',
    blurb: 'The second entry point of the same change. It reaches lookupName, which the first graph reaches too.',
    entry: 'applyPanel',
    presets: [
      {
        name: 'a known user',
        blurb: 'The same run name as the first graph, which is legal: uniqueness is per graph.',
        input: {},
        walk: {
          provenance: 'authored',
          steps: [
            { k: 'call', at: 0, to: 'lookupName', next: 1 },
            { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: { displayName: 'Ada' } },
            { k: 'if', at: 1, next: 2 },
            { k: 'return', at: 2, value: 'Ada' },
            { k: 'return', at: 1 },
            { k: 'done' },
          ],
        },
      },
    ],
  });
  return prog;
}

/* -- the acceptance set --------------------------------------------------- */

test('every shipped worked example validates', () => {
  const shipped = readdirSync(examples).filter(f => f.endsWith('.flightpath.json'));
  assert.ok(shipped.length >= 2, 'the skill ships worked examples');
  for (const f of shipped) {
    const r = check(join(examples, f));
    assert.equal(r.code, 0, `${f} did not validate:\n${r.stderr}`);
  }
});

test('the two structural checks change the verdict on no shipped example', () => {
  // The pair earns its place by costing nothing elsewhere. This is the half
  // worth pinning: the check that refuses a green-and-wrong file must not
  // start refusing files that were green and right.
  for (const f of readdirSync(examples).filter(x => x.endsWith('.flightpath.json'))) {
    const r = check(join(examples, f));
    assert.doesNotMatch(r.stderr, /is uncaught, but/);
    assert.doesNotMatch(r.stderr, /emptied the frame stack/);
  }
});

/* -- what a refusal says -------------------------------------------------- */

test('a refusal in a walk names the path, then the graph, the run and the move', () => {
  // Every refusal carries a path into the document, so a tool locates the
  // fault without parsing prose. A walk refusal spells the same place out in
  // words after it, because counting into two arrays is work a person should
  // not have to do.
  // A tag cannot be uncaught while a frame it is passing through declares a
  // handler for it. In "no such user" the callee throws NoSuchUser, the callee
  // unwinds, and greet's call step catches it. Claim the error reached the top
  // instead, and the file contradicts itself: greet is still suspended at that
  // guarded call.
  const file = derive(prog => {
    const w = runs(prog)[1].walk.steps;
    const at = w.findIndex(m => m.k === 'handled');
    w.splice(at, w.length - at, { k: 'uncaught', tag: 'NoSuchUser', message: 'no row', channel: 'escape' });
  });
  const r = check(file);
  assert.equal(r.code, 1, r.stdout);
  assert.match(
    r.stderr,
    /case-\d+\.flightpath\.json: graphs\[0\]\.presets\[1\]\.walk\.steps\[\d+\]: graph "greet", run "no such user", move \d+: "NoSuchUser" is uncaught, but greet\[1\] declares onError for it/,
  );
});

test('a refusal in the file shape names a path into the document, and no run', () => {
  // A top-level unknown key is refused before a walk is read, so there is no
  // graph, no run and no move to name. A refusal that named one anyway would
  // be naming something that does not exist.
  const file = derive(prog => {
    prog.presests = [];
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /: file: unknown key "presests"/);
  assert.doesNotMatch(r.stderr, /graph "|run "|move \d+/);
});

test('two graphs may share a run name, and a refusal names the second graph', () => {
  // Uniqueness is per graph, so "a known user" can exist on each sheet. The
  // two runs are then told apart by the graph, which is why the graph is in
  // the words and not only in the path.
  const clean = derive(addSecondGraph);
  assert.equal(check(clean).code, 0, check(clean).stderr);

  const file = derive(prog => {
    addSecondGraph(prog);
    prog.graphs[1].presets[0].walk.steps[0].to = 'greet'; // the step targets lookupName
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr.split('\n')[0],
    /graphs\[1\]\.presets\[0\]\.walk\.steps\[0\]: graph "panel-apply", run "a known user", move 0: call to "greet", but step 0 targets "lookupName"/,
  );
  // The first graph's identically named run is untouched, so nothing points at
  // it. Only the graph tells the two apart.
  assert.doesNotMatch(r.stderr, /graph "greet"/);
});

test('a refusal names the move that emptied the frame stack, not the first to notice', () => {
  // One measured run went 34 errors, then 36, then 36, then 36, and finished
  // blaming the checker — when the whole fault was one spurious unwind, a
  // single move earlier than the refusal pointed.
  const file = derive(prog => {
    const walk = runs(prog)[0].walk.steps;
    const i = walk.findIndex(m => m.k === 'return');
    walk.splice(i, 0, { k: 'unwind' }, { k: 'unwind' });
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /emptied the frame stack, and move \d+ \(\w+\) then ran with none open/);
  const named = Number(/move (\d+): \w+ emptied the frame stack/.exec(r.stderr)[1]);
  const noticed = Number(/emptied the frame stack, and move (\d+)/.exec(r.stderr)[1]);
  assert.ok(named < noticed, 'the refusal blames the earlier move');
});

/* -- one refusal per rule ------------------------------------------------- */

const cases = [
  ['a missing core field', p => delete p.blurb, /file: missing required key "blurb"/],
  ['a graph missing a core field', p => delete only(p).entry, /graphs\[0\]: missing required key "entry"/],
  ['an unknown key one letter from a real one', p => { p.nodes.greet.channles = {}; }, /nodes\.greet: unknown key "channles"/],
  ['an unknown key on a step', p => { p.nodes.greet.steps[0].notes = 'x'; }, /steps\[0\] \(note\): unknown key "notes"/],
  ['an unknown key on a move', p => { runs(p)[0].walk.steps[0].att = 0; }, /walk\.steps\[0\] \(note\): unknown key "att"/],
  ["a graph whose entry is not in the node map", p => { only(p).entry = 'nowhere'; }, /graphs\[0\]\.entry: "nowhere" is not a node/],
  ['a graph id that is not plain', p => { only(p).id = 'first paint'; }, /graphs\[0\]\.id: "first paint" is not a plain letters-digits-and-hyphens id/],
  ['two graphs with one id', p => { p.graphs.push({ ...only(p) }); }, /graphs\[1\]\.id: "greet" is already the id of another graph/],
  ['an empty graphs list', p => { p.graphs = []; }, /graphs: state at least one graph/],
  ['a node id that is not plain', p => { p.nodes['greet!'] = p.nodes.greet; }, /nodes\.greet!: a node id must be plain letters, digits and hyphens/],
  ['a call to a node that is not there', p => { p.nodes.greet.steps[1].target = 'missing'; }, /target "missing" is not a node/],
  ['a goto naming no label', p => { p.nodes.greet.steps[4].to = 'nowhere'; }, /to "nowhere" is not a label in greet/],
  ['a throw channel outside the three', p => { p.nodes.lookupName.steps[3].channel = 'panic'; }, /channel "panic" is not one of retry, escape, die/],
  ['a provenance outside the two', p => { runs(p)[0].walk.provenance = 'guessed'; }, /provenance: "guessed" is not authored or captured/],
  ['a layer naming a node that is not there', p => { p.layers.tests.nodes.absent = { R: ['x'] }; }, /layers\.tests\.nodes\.absent: is not a node/],
  ['an empty files list', p => { p.files = []; }, /files: state the changed files, or leave the key out/],
  ['an empty layer map', p => { p.layers = {}; }, /layers: state at least one layer, or leave the key out/],
  ['a move kind that names no op', p => { runs(p)[0].walk.steps[0].k = 'raise'; }, /k "raise" is not a move kind/],
  ['a move whose kind is not the step it ran', p => { runs(p)[0].walk.steps[0].k = 'let'; }, /a "let" move ran step 0, which is a "note"/],
  ['an at that is not where the cursor sits', p => { runs(p)[0].walk.steps[0].at = 1; }, /ran step 1, but the cursor sits at 0/],
  ['a next the step cannot reach', p => { runs(p)[0].walk.steps[0].next = 5; }, /no edge from 0 \(note\) to 5/],
  ['a call whose target is not the step target', p => { runs(p)[0].walk.steps[1].to = 'greet'; }, /call to "greet", but step 1 targets "lookupName"/],
  ['an effect carrying next and raised at once', p => {
    const m = runs(p)[0].walk.steps.find(x => x.k === 'effect');
    m.raised = { tag: 'X', message: 'y', channel: 'die' };
  }, /an effect carries next or raised, never both/],
  ['a handled catch its step does not declare', p => {
    const m = runs(p)[1].walk.steps.find(x => x.k === 'handled');
    m.goto = 'named';
    m.next = 3;
  }, /its onError does not name "named"/],
  ['a nodes map that is a list', p => { p.nodes = []; }, /nodes: expected an object keyed by node id/],
  ['an unwind with no error travelling', p => {
    const w = runs(p)[0].walk.steps;
    w.splice(2, 0, { k: 'unwind' });
  }, /unwind with no error travelling/],
  ['an uncaught nothing raised', p => {
    const w = runs(p)[0].walk.steps;
    w.splice(w.length - 1, 1, { k: 'uncaught', tag: 'Invented', message: 'nothing raised this', channel: 'die' });
  }, /"Invented" reached the top uncaught, and no move before it raised anything/],
  ['an uncaught naming a tag other than the one travelling', p => {
    const w = runs(p)[2].walk.steps;
    w[w.length - 1].tag = 'SomethingElse';
  }, /"SomethingElse" reached the top, but the error travelling is "SendFailed"/],
  ['a handled that catches nothing', p => {
    const w = runs(p)[0].walk.steps;
    w.splice(2, 0, { k: 'handled', at: 1, goto: 'plain', next: 5 });
  }, /handled at 1 catches nothing — no move before it raised/],
  ['a handled whose goto is declared for another tag', p => {
    p.nodes.greet.steps[1].onError.push({ tag: 'Other', goto: 'named' });
    const w = runs(p)[1].walk.steps;
    const m = w.find(x => x.k === 'handled');
    m.goto = 'named';
    m.next = 3;
  }, /which greet declares for "Other", and the error travelling is "NoSuchUser"/],
  ['a return that discards a travelling error', p => {
    // "no such user": the callee throws, its frame unwinds, and the caller
    // catches. Drop the catch and let the caller return instead, and the walk
    // has thrown an error away with no catch and no top.
    const w = runs(p)[1].walk.steps;
    const at = w.findIndex(x => x.k === 'handled');
    w.splice(at, 1);
  }, /ran while "NoSuchUser" was still travelling \(raised at move \d+\)/],
  ['a done that arrives while an error is travelling', p => {
    const w = runs(p)[2].walk.steps;
    w.splice(w.length - 1, 1, { k: 'done' });
  }, /done arrived while "SendFailed" was still travelling/],
  ['a walk that ends while an error is still travelling', p => {
    // The last move unwinds the last frame. No frame is open, so the
    // frames-still-open rule is content, and the error has nowhere left to go.
    only(p).presets = [runs(p)[2]];
    const w = runs(p)[0].walk.steps;
    w.splice(w.length - 1, 1, { k: 'unwind' });
  }, /the walk ended while "SendFailed" was still travelling/],
  ['a walk that ends with a frame open', p => {
    // Drop the entry frame's return and the done that followed it.
    const w = runs(p)[0].walk.steps;
    w.splice(w.length - 2, 2);
  }, /the walk ended with 1 frame\(s\) still open/],
  ['a done that arrives with a frame still open', p => {
    const w = runs(p)[0].walk.steps;
    w.splice(w.length - 2, 1);
  }, /done arrived with 1 frame\(s\) still open/],
];

for (const [what, mutate, expected] of cases) {
  test(`refuses ${what}`, () => {
    const r = check(derive(mutate));
    assert.equal(r.code, 1, `expected a refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, expected);
  });
}

test('the old one-graph shape is refused, and the message names graphs', () => {
  // A file states one change, not one graph. Accepting both shapes would be
  // two ways to say one thing, so a stale file fails loudly rather than
  // rendering half of what it means.
  const file = derive(prog => {
    prog.entry = prog.graphs[0].entry;
    prog.presets = prog.graphs[0].presets;
    delete prog.graphs;
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /file: this is the old one-graph shape/);
  assert.match(r.stderr, /"graphs"/);
  // One refusal, not a cascade: the fix is one reshape, and three lines
  // describing the symptom help nobody.
  assert.match(r.stderr, /: 1 refusal\(s\)/);
});

test('a file carrying only a top-level presets is refused the same way', () => {
  const file = derive(prog => {
    prog.presets = prog.graphs[0].presets;
  });
  const r = check(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /this is the old one-graph shape/);
});

test('an absent optional field is not refused, and the empty one is', () => {
  // Leave a field out rather than write it empty. "files": [] claims a change
  // that touched nothing, which is a different statement from saying nothing
  // about changed files.
  const absent = derive(prog => {
    delete prog.files;
    delete prog.layers;
    delete prog.sheet;
  });
  assert.equal(check(absent).code, 0);
  assert.equal(check(derive(p => { p.files = []; })).code, 1);
});

/* -- findings are not refusals -------------------------------------------- */

test('a finding prints on standard output and the exit code stays zero', () => {
  const r = check(layeredFlightpath);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /several nodes edit /);
  assert.match(r.stdout, /no node accounts for /);
});

test("a node no graph's entry reaches is a finding, and the file still validates", () => {
  // Legal, and worth seeing: a node the author wrote and has not connected yet
  // is a work in progress, not a contradiction. Refusing it would refuse a
  // file that says exactly what its author meant.
  const file = derive(prog => {
    prog.nodes.orphan = { ...JSON.parse(JSON.stringify(prog.nodes.lookupName)), name: 'orphan' };
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /no graph's entry reaches orphan, so no sheet draws it/);
});

test('the unaccounted-files finding reads every node of the change', () => {
  // A file another graph covers is not reported. Per graph this finding was
  // true of one sheet and silent about the rest, so a reader holding two files
  // got two answers that did not add up.
  const file = derive(prog => {
    prog.files.push({ path: 'src/panel.ts', change: 'new', why: 'the second entry point', adds: 40, dels: 0 });
    addSecondGraph(prog);
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /no node accounts for src\/panel\.ts/);
  assert.doesNotMatch(r.stdout, /no graph's entry reaches/);
});

test('an E tag nothing beneath the node can produce is a finding', () => {
  const file = derive(prog => {
    prog.nodes.greet.channels.E.push('NeverRaised');
  });
  const r = check(file);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /greet declares E tag "NeverRaised", and nothing beneath it produces that tag/);
});

/* -- the text output ------------------------------------------------------ */

test('the text prints one row per call site and lists the runs it did not print', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text']);
  assert.equal(r.code, 0);
  // bindSheet is called twice from buildShelf, so it appears twice, and the
  // two rows carry different end marks.
  const rows = r.stdout.split('\n').filter(l => /->\s+bindSheet/.test(l));
  assert.equal(rows.length, 2);
  assert.match(r.stdout, /other runs in this file:/);
  assert.match(r.stdout, /"no 2D context" — /);
});

test('the text suggests the longest walk', () => {
  const prog = JSON.parse(readFileSync(layeredFlightpath, 'utf8'));
  const longest = runs(prog).reduce((a, b) => (b.walk.steps.length > a.walk.steps.length ? b : a));
  const r = run(groundtrack, [layeredFlightpath, '--text']);
  assert.match(r.stdout, new RegExp(`run "${longest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('the run the reader names is the run that prints', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text', '?tune= flat']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /run "\?tune= flat"/);
});

test('a run the file has not got is refused by name', () => {
  const r = run(groundtrack, [layeredFlightpath, '--text', 'no such run']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no run called "no such run"/);
});

test('a several-graph file without --graph lists the graphs and stops', () => {
  // Nothing ranks the graphs and nothing suggests one. A change with two entry
  // points has two starting points and no reason to prefer either, so the
  // command says what there is and lets the reader choose.
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^greet {2}greet a user$/m);
  assert.match(r.stdout, /^panel-apply {2}apply the panel$/m);
  assert.match(r.stderr, /this file states 2 graphs\. Name one with --graph <id>/);
  assert.doesNotMatch(r.stdout, /\[handler\]/, 'no tree was printed');
});

test('--graph names the graph that prints', () => {
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text', '--graph', 'panel-apply']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^applyPanel {2}\[handler\]/m);
  assert.doesNotMatch(r.stdout, /^greet {2}\[/m, 'the first graph is not on this sheet');
});

test('a graph the file has not got is refused by name', () => {
  const file = derive(addSecondGraph);
  const r = run(groundtrack, [file, '--text', '--graph', 'no-such-graph']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no graph called "no-such-graph"\. This file has: "greet", "panel-apply"/);
});

test('a one-graph file needs no --graph, and takes one', () => {
  const bare = run(groundtrack, [exampleFlightpath, '--text']);
  const named = run(groundtrack, [exampleFlightpath, '--text', '--graph', 'greet']);
  assert.equal(bare.code, 0);
  assert.equal(named.code, 0, named.stderr);
  assert.equal(bare.stdout, named.stdout);
});

test('--graph with no value, or followed by a flag, lands at the usage line', () => {
  for (const args of [[exampleFlightpath, '--graph'], [exampleFlightpath, '--graph', '--check']]) {
    const r = run(groundtrack, args);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^usage: node render\.mjs/m);
  }
});

test('the end marks differ between runs, so choosing one changes what is read', () => {
  const a = run(groundtrack, [layeredFlightpath, '--text', 'default page']).stdout;
  const b = run(groundtrack, [layeredFlightpath, '--text', 'the sheet 404s']).stdout;
  assert.notEqual(a, b);
});

test('a repeated node is marked and stopped rather than expanded forever', () => {
  // The shipped examples hold no cycle, so this one is derived: greet calls
  // lookupName, and lookupName is given a call back to greet. The call goes on
  // the end of the node so no step index moves and every shipped walk still
  // fits.
  const file = derive(prog => {
    prog.nodes.lookupName.steps.push({ op: 'call', target: 'greet', label: 'again' });
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /seen above — stopped/);
  // And it terminates: the file validates too.
  assert.equal(check(file).code, 0);
});

test('the text prints the failure kind beside every E tag', () => {
  // The kind is what tells a blip from a crash, and it is the one thing the
  // skill calls the point of the drawing. Before this it reached the reader
  // only when the run they happened to pick hit that failure.
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.equal(r.code, 0, r.stderr);
  // greet declares NoSuchUser and SendFailed; lookupName declares NoSuchUser.
  assert.equal((r.stdout.match(/NoSuchUser escape/g) || []).length, 2);
  assert.equal((r.stdout.match(/SendFailed retry/g) || []).length, 1);
});

test('a tag the file gives no kind for prints bare', () => {
  // The page invents nothing. An E channel may name a tag no throw step and no
  // walk accounts for — the check reports it as a finding, and the row still
  // has to print it.
  const file = derive(prog => {
    prog.nodes.greet.channels.E.push('Ghost');
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Ghost(?! (retry|escape|die))/);
});

test('a tag named after a property of every object prints, rather than crashing the renderer', () => {
  // A failure tag is a stranger's text and nothing constrains it. Looking a
  // kind up in a plain object answers "constructor" with a function, and the
  // row then asks the function for its kinds. The tag has no kind, so it
  // prints bare, exactly like any other tag the file says nothing about.
  const file = derive(prog => {
    prog.nodes.greet.channels.E.push('constructor', 'toString');
  });
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /constructor(?! (retry|escape|die))/);
  assert.equal(check(file).code, 0);
});

test('a tag raised with two kinds prints both, retry before escape before die', () => {
  // A tag that retries in one place and dies in another is two facts. The
  // second run is the first with its channel changed, so the file says both.
  const file = derive(prog => {
    const fails = prog.presets.find(p => p.walk.steps.some(m => m.k === 'effect' && m.raised));
    const dies = JSON.parse(JSON.stringify(fails));
    dies.name = 'the post dies';
    dies.blurb = 'the same failure, fatal';
    for (const m of dies.walk.steps) if (m.k === 'effect' && m.raised) m.raised.channel = 'die';
    prog.presets.unshift(dies); // met first, and still printed last
  });
  assert.equal(check(file).code, 0);
  const r = run(groundtrack, [file, '--text']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /SendFailed retry die/);
});

test('the text says where the walks came from, above everything', () => {
  const r = run(groundtrack, [exampleFlightpath, '--text']);
  assert.match(r.stdout.split('\n')[0], /written by hand\. They are claims about the program, not recordings of it\./);
});

/* -- the page as a string ------------------------------------------------- */

const pageOf = file => {
  const out = join(work, `page-${n++}.html`);
  const r = run(groundtrack, [file, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  return readFileSync(out, 'utf8');
};

test('the page embeds the file', () => {
  const html = pageOf(exampleFlightpath);
  assert.match(html, /"id":"example-greet"/);
});

test('the page prints the failure kind beside the tag, and what the node does with it', () => {
  // A limit, stated: the page draws its rows in the browser, so no assertion
  // here can read a rendered row. What it can read is that the page carries
  // the one derivation the module exports and the closed vocabulary it prints
  // — the alternative, a kind table baked into the page by the renderer, would
  // be a second copy of a fact the module already computes.
  const html = pageOf(exampleFlightpath);
  // The page derives the table for itself. A table the renderer had computed
  // and baked in would be a second copy of a fact the module already holds.
  assert.match(html, /G\.failureKinds\(/);
  assert.doesNotMatch(html, /"failureKinds":/);
  // The tree row and the contract tab both read it, and neither writes it.
  assert.match(html, /row\.kinds/);
  assert.match(html, /G\.tagFate\(/);
  // The kind is a mark with a class of its own, not author text.
  assert.match(html, /class="ekind"/);
  // And the contract tab can say all three things about a tag.
  for (const word of ['throws', 'catches', 'passes up from beneath']) {
    assert.ok(html.includes(word), `the contract tab can say "${word}"`);
  }
});

test('a one-graph file draws no sheet control', () => {
  // A control that does nothing is worse than no control. The picker arrives
  // with the sheets; until then a one-graph file must not grow one.
  const html = pageOf(exampleFlightpath);
  assert.doesNotMatch(html, /id="sheet"/);
  assert.doesNotMatch(html, /data-sheet=/);
});

test('the page reads its graph through one accessor, not off the file root', () => {
  // The prefactor the sheets ticket needs: which graph is on the sheet is one
  // line, not fifteen reads of PROG.entry and PROG.presets scattered through
  // the template.
  const template = readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8');
  const body = template.slice(template.indexOf('function start()'));
  assert.doesNotMatch(body, /PROG\.presets/);
  assert.doesNotMatch(body, /PROG\.entry/);
  assert.match(body, /const SHEET = G\.graphView\(PROG, 0\);/);});

test('the page contains no dynamic code evaluation', () => {
  const html = pageOf(layeredFlightpath);
  assert.doesNotMatch(html, /\bnew Function\s*\(/);
  assert.doesNotMatch(html, /[^.\w]eval\s*\(/);
  assert.doesNotMatch(html, /setTimeout\s*\(\s*["'`]/);
});

test('the emitted page holds zero external references', () => {
  // The inverse of the incumbent's assertion, which pins its external link
  // count at exactly one. Here the count is zero, and this test is what keeps
  // a convenience link from creeping back.
  //
  // The SVG namespace is not a reference: no browser fetches it. Everything
  // that would go on the wire is listed here.
  const html = pageOf(layeredFlightpath);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /\bhref\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
  // The faces are here instead, inlined: two subsets for each of three
  // weights, each under the unicode-range IBM declares for it.
  assert.equal((html.match(/@font-face/g) || []).length, 6);
  assert.equal((html.match(/src:url\(data:font\/woff2;base64,/g) || []).length, 6);
  assert.equal((html.match(/unicode-range:/g) || []).length, 6);
});

// The bytes that shipped, hashed. Taken from the files fetched from IBM's own
// repository when they were vendored.
//
// What this pins is drift here, not IBM's canonical release: it turns "somebody
// swapped in a hand-cut subset" or "somebody edited the licence" into a test
// failure, which is the failure mode assets/FONTS.md is written against. A name
// and a file signature cannot see edited bytes.
const VENDORED = {
  'IBMPlexMono-Medium-Latin1.woff2': '41201b658a328b9d00368215c2f1102770f80b15952ab82631e4006255e6365d',
  'IBMPlexMono-Medium-Pi.woff2': '92bd18415e8c43a2569f615e4e84a94b1b1c4e0377ba9d8f4d894bbf6ffcc39d',
  'IBMPlexMono-Regular-Latin1.woff2': 'e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56',
  'IBMPlexMono-Regular-Pi.woff2': 'b8002770aa636f544ba43e124da6a227301769754f295eae26e16475b469c767',
  'IBMPlexMono-SemiBold-Latin1.woff2': 'b7acd05041ab65f3b7039e218ddd893065e11a07e85ea85019473152a51b6b7d',
  'IBMPlexMono-SemiBold-Pi.woff2': '1637166246d386507b1351d59ddda93b732f781d06c0a6574e486104a00897b1',
  'OFL.txt': '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da',
};

test("the shipped faces are IBM's own, unmodified", () => {
  // The licence names "Plex" as a Reserved Font Name, and a face we had cut
  // down ourselves would be a Modified Version that may not use it. So the
  // assets are IBM's published subsets, and this test is what notices if
  // somebody swaps in a hand-made one. See assets/FONTS.md.
  const assets = join(groundtrack, '..', '..', 'assets');
  const faces = readdirSync(assets).filter(f => f.endsWith('.woff2')).sort();
  assert.deepEqual(faces, Object.keys(VENDORED).filter(f => f.endsWith('.woff2')).sort());

  for (const [name, want] of Object.entries(VENDORED)) {
    const bytes = readFileSync(join(assets, name));
    const got = createHash('sha256').update(bytes).digest('hex');
    assert.equal(got, want, `${name} is not the file that was vendored`);
  }
  for (const f of faces) {
    assert.equal(readFileSync(join(assets, f)).subarray(0, 4).toString('latin1'), 'wOF2', `${f} is not a woff2`);
  }

  // The licence travels with them, and it is IBM's copy rather than the blank
  // template: their copyright line is the first thing in it.
  const ofl = readFileSync(join(assets, 'OFL.txt'), 'utf8');
  assert.match(ofl.split('\n')[0], /Copyright .* IBM Corp\. with Reserved Font Name "Plex"/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  // IBM ship it with CRLF, and .gitattributes keeps it that way. A normalised
  // copy is no longer the file IBM publishes, and the hash above would catch
  // it — this says which of the two went wrong.
  assert.ok(ofl.includes('\r\n'), 'the licence lost its original line endings');
});

test('author text reaches the page as text, in every field the page shows', () => {
  // One field left out of this fixture is one field with no coverage, which is
  // how the incumbent shipped a row name that reached the page as markup.
  const POISON = '<img src=x onerror=alert(1)> & "quoted" </script><script>alert(2)</script>';
  const file = derive(prog => {
    prog.title = `T ${POISON}`;
    prog.blurb = `B ${POISON}`;
    only(prog).title = `GT ${POISON}`; // a graph's title — the sheet picker's label
    only(prog).blurb = `GB ${POISON}`;
    prog.nodes.greet.loc = POISON; // a node's location — a path or a URL
    prog.nodes.greet.name = `N ${POISON}`;
    prog.nodes.greet.role = `R ${POISON}`;
    prog.nodes.greet.channels.A = POISON;
    prog.nodes.greet.channels.R = [POISON];
    prog.nodes.greet.steps[0].note = POISON;
    prog.nodes.greet.steps[3].expr = POISON; // an expression
    prog.nodes.greet.steps[1].aside = POISON; // a step remark
    prog.nodes.greet.steps[6].desc = POISON; // an effect description
    prog.nodes.lookupName.steps[3].message = POISON; // an error message
    runs(prog)[0].blurb = `RB ${POISON}`;
    runs(prog)[0].input[POISON] = 'a run input name is author-keyed too';
    runs(prog)[0].input.user = POISON; // a run input
    prog.layers.tests.nodes.lookupName = { R: [POISON] }; // a layer token
    prog.layers[`layer ${POISON}`] = { nodes: {} }; // and a layer name
    // A path with a separator in it, because the files tab splits on the
    // separator and prints each segment: poison the directory and the leaf.
    // The tab's own escape is pinned in tests/groundtrack-fold.test.mjs, which
    // is the only place that can see it; what this pins is the payload, which
    // is the half a page as a string can show.
    prog.files[0].path = `${POISON}/${POISON}`;
    prog.nodes.greet.touches = [`${POISON}/${POISON}`];
    prog.files[0].why = POISON; // and its reason, which trails the leaf
    prog.env.poison = POISON; // an ambient value
  });
  const r = check(file);
  assert.equal(r.code, 0, r.stderr);
  const html = pageOf(file);

  // The script block cannot be closed from inside the embedded file. Only the
  // closing sequence matters: a bare "<script" inside a script block is text,
  // and the escape leaves it alone on purpose.
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'the page has exactly the two closers it ships');
  assert.match(html, /<\\\/script>/, 'the payload carries the closing tag escaped');

  // Every poisoned string reaches the markup escaped, and the raw tag appears
  // nowhere outside the JSON payload the page parses as data.
  const payloadStart = html.indexOf('const PROG =');
  const payloadEnd = html.indexOf('\n', payloadStart);
  const markup = html.slice(0, payloadStart) + html.slice(payloadEnd);
  assert.doesNotMatch(markup, /<img src=x onerror/);
});

test('the files tab names its groups and says what its marks mean', () => {
  // Only the fixed text is here. The tab itself is written into the cutaway
  // with `innerHTML` when a reader clicks it, so no page carries it as a
  // string — tests/groundtrack-fold.test.mjs holds it, against the same
  // function the tab calls.
  const html = pageOf(layeredFlightpath);
  assert.match(html, /in the change, on no node of this sheet/);
  assert.match(html, /N new, E edit, D delete, F forbidden/, 'the tab says what the marks mean');
});

test('the escape is pinned at its width, both what it does and what it does not', () => {
  // The narrow escape is safe only while the attribute rule holds, so a silent
  // widening hides the fact that the pairing moved. SECURITY.md carries why.
  const html = pageOf(exampleFlightpath);
  assert.match(html, /const esc = s => String\(s \?\? ''\)\.replace\(\/&\/g, '&amp;'\)\.replace\(\/<\/g, '&lt;'\);/);
});

test('no escaped author text reaches an HTML attribute', () => {
  // This is a limit, not a proof, and the security policy says so: proving the
  // whole claim needs a parse of the rendered page, and nothing here parses
  // one. What this test holds is the one shape a reviewer would otherwise have
  // to spot by eye.
  //
  // Every author string on the page goes through `esc`, and `esc` deliberately
  // leaves the double quote alone. So an `esc(...)` inside an attribute value
  // is exactly the construct that breaks the pairing. There is none, and this
  // test is what has to change first if somebody adds one.
  //
  // Both files. The shared module builds the files tab's markup and is where
  // `esc` is defined, so a new attribute interpolation there is the same
  // change to the security policy as one in the template.
  const sources = [
    readFileSync(join(groundtrack, '..', '..', 'assets', 'template.html'), 'utf8'),
    readFileSync(join(groundtrack, '..', 'groundtrack.js'), 'utf8'),
  ];
  for (const src of sources) {
    for (const m of src.matchAll(/="/g)) {
      const end = src.indexOf('"', m.index + 2);
      const value = src.slice(m.index + 2, end === -1 ? src.length : end);
      assert.ok(!value.includes('esc('), `an attribute value interpolates escaped author text: ${value}`);
    }
  }
});

/* -- the argument parser -------------------------------------------------- */

test('a flag missing its value lands at the usage line', () => {
  const r = run(groundtrack, [exampleFlightpath, '--out']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a flag followed by another flag lands at the usage line', () => {
  const r = run(groundtrack, [exampleFlightpath, '--out', '--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a repeated value selects the file the reader named', () => {
  // Each argument is judged at its own index. Looked up by value, a repeated
  // value makes the guard read the wrong neighbour.
  const out = join(work, 'repeat.html');
  const r = run(groundtrack, ['--out', out, exampleFlightpath, out]);
  assert.equal(r.code, 2, 'two positional arguments is a usage error, not a silent pick');
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('no positional file at all lands at the usage line', () => {
  const r = run(groundtrack, ['--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: node render\.mjs/m);
});

test('a default render writes nothing and says so', () => {
  const before = readdirSync(examples).sort();
  const r = run(groundtrack, [exampleFlightpath]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /name the page to write with --out/);
  assert.deepEqual(readdirSync(examples).sort(), before, 'nothing landed beside the input');
  assert.ok(!existsSync(exampleFlightpath.replace(/\.flightpath\.json$/, '.html')));
});

test('valid JSON that is not a flightpath file is refused, not crashed on', () => {
  // `null`, a number and a list all parse. Reading a field off one threw a
  // stack trace where a refusal belongs.
  for (const body of ['null', '42', '[]', '"a string"']) {
    const p = join(work, `notaprogram-${n++}.flightpath.json`);
    writeFileSync(p, body);
    const r = run(groundtrack, [p, '--check']);
    assert.equal(r.code, 1, `${body} should be refused, not accepted`);
    assert.match(r.stderr, /file: expected an object — this is valid JSON and is not a flightpath file/);
    assert.doesNotMatch(r.stderr, /at Object|TypeError|Cannot read/);
  }
});

test('--out naming the input file is refused, and the input survives', () => {
  const p = join(work, 'self.flightpath.json');
  const before = readFileSync(exampleFlightpath, 'utf8');
  writeFileSync(p, before);
  const r = run(groundtrack, [p, '--out', p]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--out names the file being rendered/);
  assert.equal(readFileSync(p, 'utf8'), before, 'the program was not replaced by its own page');
});

test('--out naming a second name for the input file is refused too', t => {
  // Two names can be one file. Comparing the text of the paths does not see a
  // link, so the identity is read off the filesystem as well.
  const src = join(work, 'linked.flightpath.json');
  const alias = join(work, 'alias.html');
  const before = readFileSync(exampleFlightpath, 'utf8');
  writeFileSync(src, before);
  try {
    linkSync(src, alias);
  } catch (e) {
    // A hard link needs the two names on one volume, and some environments
    // refuse it outright. Say which, rather than pass in silence.
    t.skip(`this filesystem would not make a hard link: ${e.code}`);
    return;
  }
  const r = run(groundtrack, [src, '--out', alias]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--out names the file being rendered/);
  assert.equal(readFileSync(src, 'utf8'), before, 'the program was not replaced through its other name');
});

test('a file that is not JSON is refused before anything else', () => {
  const p = join(work, 'broken.flightpath.json');
  writeFileSync(p, '{ not json');
  const r = run(groundtrack, [p, '--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot read /);
});
