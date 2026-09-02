/* corpus.mjs — the case list that binds groundtrack-ir.md to check.mjs.
 *
 * The shape document and the validator are two artifacts. Nothing makes them
 * agree, and on the sibling skill six differences already exist between a
 * schema file and its renderer. Each case below quotes a claim the document
 * makes and asserts the validator enforces it.
 *
 * One test file. No build step. No dependency.
 *
 *   node corpus.mjs
 */
import { readFileSync } from 'node:fs';
import { check } from './check.mjs';

const BASE = JSON.parse(readFileSync(new URL('./example.flightpath.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(BASE));

/** [what the document claims, how to break it, the text the refusal must contain] */
const CASES = [
  ['the example is valid', (p) => p, null],

  // Rule 2 — an unknown key is an error
  ['an unknown top-level key is refused', (p) => { p.extra = 1; return p; }, 'unknown key "extra"'],
  ['an unknown node key is refused', (p) => { p.nodes.greet.kind = 'handler'; return p; }, 'unknown key "kind"'],
  ['an unknown step key is refused', (p) => { p.nodes.greet.steps[0].result = 'x'; return p; }, 'unknown key "result"'],
  ['an unknown walk-move key is refused', (p) => { p.presets[0].walk.steps[1].label = 'x'; return p; }, 'unknown key "label"'],
  ['a near-miss spelling is refused', (p) => { p.nodes.greet.enteredby = []; return p; }, 'unknown key "enteredby"'],

  // Rule 4 — every part is required
  ['a missing top-level field is refused', (p) => { delete p.sheet; return p; }, 'missing required key "sheet"'],
  ['a missing node field is refused', (p) => { delete p.nodes.greet.enteredBy; return p; }, 'missing required key "enteredBy"'],
  ['a missing files field is refused', (p) => { delete p.files[0].dels; return p; }, 'missing required key "dels"'],
  ['a missing preset blurb is refused', (p) => { delete p.presets[0].blurb; return p; }, 'missing required key "blurb"'],

  // Rule 1 — one name, one meaning
  ['`note` on a non-note step is refused', (p) => { p.nodes.greet.steps[1].note = 'x'; return p; }, 'unknown key "note"'],
  ['`aside` on any step is accepted', (p) => { p.nodes.greet.steps[3].aside = 'x'; return p; }, null],
  ['a walk effect needs `desc`, not `label`', (p) => { const m = p.presets[0].walk.steps.find((s) => s.k === 'effect'); delete m.desc; m.label = 'x'; return m && p; }, 'missing required key "desc"'],

  // Links
  ['an unknown jump target is refused', (p) => { p.nodes.greet.steps[2].then = 'nowhere'; return p; }, 'is not a label'],
  ['an unknown call target is refused', (p) => { p.nodes.greet.steps[1].target = 'nowhere'; return p; }, 'is not a node'],
  ['an unknown entry is refused', (p) => { p.entry = 'nowhere'; return p; }, 'is not a node'],
  ['an onError goto with no label is refused', (p) => { p.nodes.greet.steps[1].onError[0].goto = 'nowhere'; return p; }, 'is not a label'],
  ['a layer over an unknown node is refused', (p) => { p.layers.tests.nodes.nowhere = { R: [] }; return p; }, 'is not a node'],
  ['a layer entry that is not a node is refused', (p) => { p.layers.tests.entry = 'nowhere'; return p; }, 'is not a node'],
  ['a bad change kind is refused', (p) => { p.files[0].change = 'tweaked'; return p; }, 'is not one of'],
  ['a bad throw channel is refused', (p) => { p.nodes.lookupName.steps[3].channel = 'sideways'; return p; }, 'is not one of'],
  ['a bad provenance is refused', (p) => { p.presets[0].walk.provenance = 'guessed'; return p; }, 'is not authored or captured'],

  // The path check
  ['a move with no edge is refused', (p) => { p.presets[0].walk.steps[1].next = 5; return p; }, 'no edge from'],
  ['a call to the wrong node is refused', (p) => { p.presets[0].walk.steps[2].to = 'greet'; return p; }, 'step targets'],
  ['a mismatched effect kind is refused', (p) => { p.presets[0].walk.steps[3].kind = 'http.post'; return p; }, 'kind'],
  ['a return on a non-return step is refused', (p) => { p.presets[0].walk.steps[10].at = 0; return p; }, 'ran'],
  ['a handled goto no onError names is refused', (p) => { p.presets[1].walk.steps[7].goto = 'named'; return p; }, 'named by no onError'],
  ['an unbalanced frame stack is refused', (p) => { p.presets[0].walk.steps.splice(5, 1); return p; }, 'frame'],
  ['an unknown move kind is refused', (p) => { p.presets[0].walk.steps[1].k = 'jump'; return p; }, 'is not a move kind'],

  // What the document says it CANNOT prove — these must PASS
  ['an invented effect result is accepted, as the document states', (p) => { p.presets[0].walk.steps[3].result = { invented: true }; return p; }, null],
  ['any role word is accepted, as the document states', (p) => { p.nodes.greet.role = 'choreographer'; return p; }, null],
  ['any layer name is accepted, as the document states', (p) => { p.layers.smoke = { nodes: {} }; return p; }, null],
];

let pass = 0, fail = 0;
for (const [claim, mutate, want] of CASES) {
  const errs = check(mutate(clone()));
  const got = errs.join(' | ');
  const ok = want === null ? errs.length === 0 : got.includes(want);
  if (ok) { pass++; console.log(`  ok    ${claim}`); }
  else {
    fail++;
    console.log(`  FAIL  ${claim}`);
    console.log(`        wanted ${want === null ? 'no error' : `an error containing "${want}"`}`);
    console.log(`        got    ${errs.length ? got.slice(0, 200) : 'no error'}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} claims checked`);
process.exit(fail ? 1 : 0);
