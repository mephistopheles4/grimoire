/* record.mjs — run the D-00 VM once, offline, and write the walk into the IR.
 *
 * This is where #28's amendment lands in the build. The VM has not been
 * deleted; it has been moved from READ time to RECORD time. D-01 no longer
 * computes a next state — it plays a tape this script produced.
 *
 * The VM is lifted out of ../callstack-debugger/index.html by the same line
 * range build.ps1 used to splice, so D-00 stays the single source of it.
 * Nothing here is transcribed.
 *
 *   node record.mjs            # rewrite every prototypes/programs/*.json
 *   node record.mjs --check    # exit 1 if any walk is stale, write nothing
 *   node record.mjs --print    # dump the tapes to stdout
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

const HERE = new URL('./', import.meta.url);
const D00 = new URL('../callstack-debugger/index.html', HERE);
const PROGRAMS = new URL('../programs/', HERE);

const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const PRINT = ARGS.has('--print');

/* -- lift the VM ----------------------------------------------------------- */

/** The same two markers build.ps1 anchored on, so the lift cannot silently
 *  drift onto a different block if D-00 is edited. */
function liftVM() {
  const src = readFileSync(fileURLToPath(D00), 'utf8').split('\n');
  const start = src.findIndex((l) => /^\s+let PROG = null;/.test(l));
  const end = src.findIndex((l) => /^\s+3\. DRIVER/.test(l));
  if (start < 0 || end < 0 || end <= start) throw new Error('could not find the VM block in D-00');
  // back off the section banner (2 lines) and the blank line above it
  return src.slice(start, end - 2).join('\n');
}

const vm = new Function(`
  ${liftVM()}
  return {
    get PROG() { return PROG; },
    set PROG(v) { PROG = v; },
    prepare, validate, initState, step,
  };
`)();

/* -- the walk shape --------------------------------------------------------
 *
 * A walk is a flat list of MOVES over the IR. Every entry names where it
 * happened and what happened there; nothing has to be worked out to replay it.
 * That is the whole constraint: THE PLAYER MAY DERIVE, NEVER DECIDE. Which
 * branch an `if` took, what an effect returned, whether a handler caught — each
 * is a literal in the tape, so an authored walk is a list of checkable claims
 * rather than a program that has to be believed.
 *
 *   { k: 'enter',   node }             push the entry frame
 *   { k: 'at',      at }               the cursor moves — note / let / if / goto
 *   { k: 'call',    at, to }           cursor to `at`, then push `to` at 0
 *   { k: 'effect',  at, kind, label, status, result?, error?, attempt? }
 *   { k: 'raise',   at, tag, message, channel }
 *   { k: 'handled', at, goto }         caught here; cursor lands on the handler
 *   { k: 'unwind' }                    pop a frame the error passed through
 *   { k: 'return',  at, value? }       pop a frame that returned
 *   { k: 'done',    result? }          the entry returned
 *   { k: 'uncaught', tag, message, channel }
 * ------------------------------------------------------------------------- */

const topOf = (s) => s.frames[s.frames.length - 1];

/** Turn one VM transition into the moves it represents. */
function moves(prev, next) {
  const out = [];
  const before = topOf(prev);
  const at = before ? before.pc : undefined;

  // execEffect pushes its record and then throws, so a failed effect and the
  // raise it caused arrive in the same VM step. Two moves, in that order.
  if (next.effects.length > prev.effects.length) {
    const r = next.effects[next.effects.length - 1];
    out.push({
      k: 'effect',
      at,
      kind: r.kind,
      label: r.label,
      status: r.status,
      ...(r.status === 'ok' ? { result: r.result } : { error: r.error }),
      ...(r.attempt > 1 ? { attempt: r.attempt } : {}),
    });
  }

  switch (next.lastEvent) {
    case 'call':
      out.push({ k: 'call', at, to: topOf(next).nodeId });
      break;
    case 'return':
      out.push({ k: 'return', at, ...(next.lastReturn.value === undefined ? {} : { value: next.lastReturn.value }) });
      break;
    case 'raise': {
      const e = prev.errorLog.length < next.errorLog.length ? next.errorLog[prev.errorLog.length] : null;
      if (e) out.push({ k: 'raise', at, tag: e.tag, message: e.message, channel: e.channel });
      break;
    }
    case 'unwind':
      out.push({ k: 'unwind' });
      break;
    case 'effect':
      break; // already emitted above
    default:
      // note / let / if / goto — the cursor moved, and for an `if` that move IS
      // the decision. One move, carrying the landing index.
      if (topOf(next) && before && topOf(next).nodeId === before.nodeId && topOf(next).pc !== before.pc)
        out.push({ k: 'at', at: topOf(next).pc });
  }

  if (next.handled) {
    const f = topOf(next);
    const rec = next.errorLog[next.errorLog.length - 1];
    out.push({ k: 'handled', at: f.pc, goto: rec.goto });
  }

  if (next.status === 'done')
    out.push({ k: 'done', ...(next.result === undefined ? {} : { result: next.result }) });
  if (next.status === 'error')
    out.push({ k: 'uncaught', tag: next.error.tag, message: next.error.message, channel: next.error.channel });

  return out;
}

function record(prog, presetIdx) {
  vm.PROG = vm.prepare(structuredClone(prog));
  vm.PROG.input = structuredClone(prog.presets[presetIdx].input);
  const errs = vm.validate(vm.PROG);
  if (errs.length) throw new Error(`${prog.id} / ${prog.presets[presetIdx].name}: ${errs.join(' · ')}`);

  const steps = [{ k: 'enter', node: prog.entry }];
  let s = vm.initState();
  let vmSteps = 0;
  for (let n = 0; n < 4000 && s.status === 'running'; n++) {
    const nx = vm.step(s);
    vmSteps++;
    steps.push(...moves(s, nx));
    s = nx;
  }
  if (s.status === 'running') throw new Error(`${prog.id} / ${presetIdx}: did not settle in 4000 steps`);

  return {
    walk: {
      // The honest half of #28's amendment. Nothing executed the real
      // buildShelf: this tape came out of a model of it. `captured` is
      // reserved for a walk a real run produced.
      provenance: 'authored',
      recordedBy: 'record.mjs, replaying the D-00 VM over this IR',
      steps,
    },
    // kept out of the file — the parity report only
    _vm: { vmSteps, effects: s.effects.length, errors: s.errorLog.length, status: s.status },
  };
}

/* -- run ------------------------------------------------------------------- */

const files = readdirSync(fileURLToPath(PROGRAMS)).filter((f) => f.endsWith('.json')).sort();
let stale = 0;

for (const f of files) {
  const url = new URL(f, PROGRAMS);
  const prog = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  const report = [];

  prog.presets.forEach((pr, i) => {
    const { walk, _vm } = record(prog, i);
    const same = JSON.stringify(pr.walk) === JSON.stringify(walk);
    if (!same) stale++;
    pr.walk = walk;
    report.push(
      `    ${String(walk.steps.length).padStart(3)} moves  ${String(_vm.vmSteps).padStart(3)} vm steps  ` +
        `${_vm.status.padEnd(7)} ${_vm.effects} effects  ${_vm.errors} error rows  ${pr.name}`,
    );
    if (PRINT) for (const m of walk.steps) report.push(`      ${JSON.stringify(m)}`);
  });

  if (!CHECK) writeFileSync(fileURLToPath(url), JSON.stringify(prog, null, 2) + '\n');
  console.log(`  ${basename(f)}`);
  console.log(report.join('\n'));
}

if (CHECK && stale) {
  console.error(`\n${stale} walk(s) stale — run: node record.mjs`);
  process.exit(1);
}
console.log(CHECK ? '\nwalks are current' : `\n${files.length} file(s) rewritten`);
