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
  ['an unknown walk-move key is refused', (p) => { p.presets[0].walk.steps[0].label = 'x'; return p; }, 'unknown key "label"'],
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
  ['a move with no edge is refused', (p) => { p.presets[0].walk.steps[0].next = 5; return p; }, 'no edge from'],
  ['a call to the wrong node is refused', (p) => { p.presets[0].walk.steps[1].to = 'greet'; return p; }, 'step targets'],
  ['a mismatched effect kind is refused', (p) => { p.presets[0].walk.steps[2].kind = 'http.post'; return p; }, 'kind'],
  ['a return on a non-return step is refused', (p) => { p.presets[0].walk.steps[9].at = 0; return p; }, 'ran'],
  ['a handled goto the catching step does not name is refused', (p) => { p.presets[1].walk.steps[6].goto = 'named'; return p; }, 'its onError does not name'],
  ['an unbalanced frame stack is refused', (p) => { p.presets[0].walk.steps.splice(4, 1); return p; }, 'frame'],
  ['an unknown move kind is refused', (p) => { p.presets[0].walk.steps[0].k = 'jump'; return p; }, 'is not a move kind'],

  // Rule 2 of the tape — `next` is stated, never worked out.
  // Every case below is a fault the eval measured on a real agent's file.
  ['a call with no next is refused', (p) => { delete p.presets[0].walk.steps[1].next; return p; }, 'missing required key "next"'],
  ['a handled with no next is refused', (p) => { delete p.presets[1].walk.steps[6].next; return p; }, 'missing required key "next"'],
  ['a next outside the node is refused', (p) => { p.presets[0].walk.steps[1].next = 99; return p; }, 'next 99 is not a step'],
  ['a call that resumes in the wrong place is refused', (p) => { p.presets[0].walk.steps[1].next = 0; return p; }, 'cursor sits at'],
  ['`status` on an effect move is refused', (p) => { p.presets[0].walk.steps[2].status = 'ok'; return p; }, 'unknown key "status"'],
  ['`error` on an effect move is refused', (p) => { p.presets[0].walk.steps[2].error = { tag: 'X' }; return p; }, 'unknown key "error"'],
  ['an effect with neither next nor raised is refused', (p) => { delete p.presets[0].walk.steps[2].next; return p; }, 'next when it went on, or raised when it threw'],
  ['an effect with both next and raised is refused', (p) => { p.presets[0].walk.steps[2].raised = { tag: 'X', message: 'y', channel: 'die' }; return p; }, 'never both'],
  ['a raised with no channel is refused', (p) => { const m = p.presets[2].walk.steps.find((s) => s.raised); delete m.raised.channel; return p; }, 'missing required key "channel"'],
  ['an effect that raised is accepted', (p) => p, null],

  // Rule 1 of the tape — `k` is the op that ran.
  ['a move named for the wrong op is refused', (p) => { p.presets[0].walk.steps[6].k = 'if'; return p; }, 'a "if" move ran step 3, which is a "let"'],
  ['`move` is no longer a move kind', (p) => { p.presets[0].walk.steps[0].k = 'move'; return p; }, 'is not a move kind'],
  ['`enter` is no longer a move kind', (p) => { p.presets[1].walk.steps[4].k = 'enter'; return p; }, 'is not a move kind'],
  ['a throw move on a throw step is accepted', (p) => p, null],
  ['a move after a call that ignores the call\'s next is refused', (p) => { p.presets[0].walk.steps[5].at = 1; return p; }, 'cursor sits at'],

  // What the document says it CANNOT prove — these must PASS
  ['an invented effect result is accepted, as the document states', (p) => { p.presets[0].walk.steps[2].result = { invented: true }; return p; }, null],
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
