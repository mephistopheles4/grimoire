/* migrate.mjs — carry the three prototype programs onto the locked shape.
 *
 * Renames, in the order groundtrack-ir.md states them:
 *   node.kind        → node.role
 *   node.tests       → node.enteredBy
 *   node.card        → dropped
 *   walk {k:'at'}    → {k:'move', at: <the step that ran>, next: <the landing>}
 *   walk effect.label→ walk effect.desc
 *   walk.recordedBy  → dropped
 *
 * The `at` rename is the one that needs work. In the old tape `at` was the
 * LANDING on a cursor move and the STEP THAT RAN everywhere else. To split
 * them, replay the frame model and read the cursor.
 *
 *   node migrate.mjs <in-dir> <out-dir>
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const labelMap = (n) => { const m = {}; n.steps.forEach((s, i) => { if (s.label !== undefined) m[s.label] = i; }); return m; };

function migrateWalk(prog, walk) {
  const frames = [];
  const top = () => frames[frames.length - 1];
  const out = [];
  for (const m of walk.steps) {
    if (m.k === 'enter') { frames.push({ nodeId: m.node, pc: 0 }); out.push({ ...m }); continue; }
    if (m.k === 'unwind') { frames.pop(); out.push({ k: 'unwind' }); continue; }
    if (m.k === 'done' || m.k === 'uncaught') { frames.length = 0; out.push({ ...m }); continue; }

    const f = top();
    const node = prog.nodes[f.nodeId];
    if (m.k === 'at') {
      // old: one `move` for four ops, and `at` was the landing. New: `k` is the
      // op that ran, and the landing is `next`.
      out.push({ k: node.steps[f.pc].op, at: f.pc, next: m.at });
      f.pc = m.at;
      continue;
    }
    if (m.k === 'effect') {
      // `status` and `error` said twice what the tape says once.
      const { label, status, error, ...rest } = m;
      if (status === 'ok') { out.push({ ...rest, desc: label, next: m.at + 1 }); f.pc = m.at + 1; }
      else out.push({ ...rest, desc: label, raised: { tag: error.tag, message: error.message, channel: error.channel } });
      continue;
    }
    if (m.k === 'call') { out.push({ ...m, next: m.at + 1 }); f.pc = m.at + 1; frames.push({ nodeId: m.to, pc: 0 }); continue; }
    if (m.k === 'return') { out.push({ ...m }); frames.pop(); continue; }
    if (m.k === 'handled') {
      // old: `at` was the landing. New: `at` is the step whose onError caught,
      // and `next` is the landing.
      const catcher = node.steps.findIndex((s) => (s.onError || []).some((h) => h.goto === m.goto));
      out.push({ k: 'handled', at: catcher, goto: m.goto, next: m.at });
      f.pc = m.at;
      continue;
    }
    if (m.k === 'raise') {
      // A raise off an effect is now the effect's own `raised`, already written
      // above. A raise off a `throw` step becomes a `throw` move.
      if (node.steps[m.at].op === 'throw') { const { k, ...rest } = m; out.push({ k: 'throw', ...rest }); }
      continue;
    }
    out.push({ ...m });
  }
  return { provenance: walk.provenance, steps: out };
}

const [inDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

for (const file of readdirSync(inDir).filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(readFileSync(join(inDir, file), 'utf8'));

  for (const [id, n] of Object.entries(p.nodes)) {
    n.role = n.kind; delete n.kind;
    n.enteredBy = n.tests || []; delete n.tests;
    delete n.card;
    n.touches = n.touches || [];
    n.params = n.params || [];
    n.loc = n.loc || id;
    for (const s of n.steps) {
      if (s.op === 'return' && s.expr === undefined) s.expr = 'nothing';
      // `note` was both an op and an annotation on any step. Rule 1: rename one side.
      if (s.op !== 'note' && s.note !== undefined) { s.aside = s.note; delete s.note; }
      // The four mock fields drove the interpreter. Nothing runs, so they die here.
      delete s.result; delete s.failIf; delete s.failOnAttempt; delete s.failWith;
    }
  }

  p.files = p.files || [];
  for (const f of p.files) { f.adds = f.adds ?? 0; f.dels = f.dels ?? 0; }
  p.env = p.env || {};
  p.layers = p.layers && Object.keys(p.layers).length ? p.layers : { production: { nodes: {} } };
  for (const [ln, l] of Object.entries(p.layers)) {
    if (!l.nodes) { const { entry, ...rest } = l; p.layers[ln] = { ...(entry ? { entry } : {}), nodes: rest }; }
  }
  p.sheet = p.sheet || { scopeRule: 'one graph per entry point', graphsNotDrawn: [] };

  for (const pr of p.presets) { pr.blurb = pr.blurb || pr.name; pr.walk = migrateWalk(p, pr.walk); }

  writeFileSync(join(outDir, file), JSON.stringify(p, null, 2) + '\n');
  console.log(`migrated ${file}`);
}
