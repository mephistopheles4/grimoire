/* Step 2 of REFINE.md — measure the base before proposing anything.
   Contrast from drafting.css alphas; fit from view.html's own fit() and the
   sheet-root grid; counts from the real IR. Nothing here is estimated. */
import { readFileSync } from 'node:fs';

const ir = JSON.parse(readFileSync(new URL('../programs/pr-313-first-paint.json', import.meta.url), 'utf8'));

/* -- contrast ------------------------------------------------------------- */
const paper = [250, 250, 247]; // --dw-paper #fafaf7
const ink = [34, 38, 43]; // --dw-ink   #22262b
const over = (a) => paper.map((p, i) => a * ink[i] + (1 - a) * p);
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

console.log('CONTRAST against --dw-paper #fafaf7');
const carried = {
  'ink-80': '.dw-annot on some grounds',
  'ink-55': '.dw-label .nd-loc .nd-ch .fx .fchange .fnum .fdir .fwhy .tab .tp-lbl .row-k .dim .var-k .dw-titleblock-key',
  'ink-30': '.none .tp-n .led-seq, all hairlines',
};
for (const [name, a] of [['ink', 1], ['ink-80', 0.8], ['ink-55', 0.55], ['ink-30', 0.3]]) {
  const r = ratio(over(a), paper);
  console.log(`  ${name.padEnd(7)} ${r.toFixed(2).padStart(5)}:1  ${r >= 4.5 ? 'AA' : r >= 3 ? '-- under 4.5' : '-- under 3'}  ${carried[name] ?? ''}`);
}
for (const [name, hex, rgb] of [['caution', '#d97706', [217, 119, 6]], ['normal', '#15803d', [21, 128, 61]]]) {
  const r = ratio(rgb, paper);
  console.log(`  ${name.padEnd(7)} ${r.toFixed(2).padStart(5)}:1  ${r >= 4.5 ? 'AA' : '-- under 4.5'}  ${hex}`);
}
for (let a = 0.55; a <= 1.001; a += 0.01)
  if (ratio(over(a), paper) >= 4.5) { console.log(`  lowest alpha clearing 4.5:1 -> ${a.toFixed(2)} (${ratio(over(a), paper).toFixed(2)}:1)`); break; }

/* -- fit ------------------------------------------------------------------ */
// view.html fit(): K = min(K_MAX, max(K_MIN, min((r.width-24)/w, (r.height-24)/h, 1)))
const K_MIN = 0.2, K_MAX = 2.5;
const CANVAS = { w: 1368, h: 783 }; // from gen-plan.mjs, view.html's own layout()
const SHEET = { w: 1440, h: 900 };
const SIDE_W = 22 * 16; // --side-w: 22rem
const HEAD_H = 55; // .head: --dw-s2 padding + control height + 2px rule
const BLOCK_H = 74; // .dw-titleblock cell row
const TRACE_H = 43; // .trace row: --dw-s2 padding + 18px span + hairline

const fitK = (planW, planH) =>
  Math.min(K_MAX, Math.max(K_MIN, Math.min((planW - 24) / CANVAS.w, (planH - 24) / CANVAS.h, 1)));
const label = (K) => (K >= 0.999 && K <= 1.001 ? '1:1' : K > 1 ? `${K.toFixed(2)}:1` : `1:${(1 / K).toFixed(2)}`);

console.log(`\nFIT — the drawing is ${CANVAS.w} x ${CANVAS.h}; view.html's fit() decides the scale`);
// #28's amendment restores the trace row and the rail, so the base carries both.
const cases = [
  ['BASE  as built      cut-h 15rem, rail 22rem, trace', 15 * 16, SIDE_W, TRACE_H],
  ['      cut-h 12rem   rail 22rem, trace', 12 * 16, SIDE_W, TRACE_H],
  ['      cut-h 10rem   rail 22rem, trace', 10 * 16, SIDE_W, TRACE_H],
  ['      rail deleted  cut-h 15rem, trace', 15 * 16, 0, TRACE_H],
  ['      trace deleted cut-h 15rem, rail 22rem', 15 * 16, SIDE_W, 0],
];
let baseK = null;
for (const [name, cutH, sideW, traceH] of cases) {
  const planW = SHEET.w - sideW - 2;
  const planH = SHEET.h - HEAD_H - cutH - BLOCK_H - traceH;
  const K = fitK(planW, planH);
  const bound = (planW - 24) / CANVAS.w < (planH - 24) / CANVAS.h ? 'width' : 'height';
  baseK ??= K;
  const delta = K === baseK ? '' : `  ${(((K - baseK) / baseK) * 100 >= 0 ? '+' : '')}${(((K - baseK) / baseK) * 100).toFixed(0)}% vs as built`;
  console.log(`  ${name}  plan ${planW}x${planH}  K=${K.toFixed(4)}  reads "${label(K)}"  ${bound}-bound${delta}`);
}

/* -- counts --------------------------------------------------------------- */
const nodes = ir.nodes;
const ids = Object.keys(nodes);
const calleesOf = (id) => {
  const out = [];
  for (const s of nodes[id].steps || []) if (s.op === 'call' && nodes[s.target] && !out.includes(s.target)) out.push(s.target);
  return out;
};
const FILEMAP = {};
for (const f of ir.files) FILEMAP[f.path] = { touch: [], test: [] };
for (const [id, n] of Object.entries(nodes)) {
  for (const p of n.touches ?? []) (FILEMAP[p] ??= { touch: [], test: [] }).touch.push(id);
  for (const p of n.tests ?? []) (FILEMAP[p] ??= { touch: [], test: [] }).test.push(id);
}
const notices = [];
for (const [path, rel] of Object.entries(FILEMAP))
  if (rel.touch.length > 1)
    notices.push({ tag: 'shared', text: `${path} is edited by ${rel.touch.length} nodes — ${rel.touch.map((i) => nodes[i].name).join(', ')}` });
const orphans = ir.files.filter((f) => !FILEMAP[f.path].touch.length && !FILEMAP[f.path].test.length);
if (orphans.length)
  notices.push({ tag: 'unattached', text: `${orphans.length} of ${ir.files.length} changed files are accounted for by no node on this sheet` });
for (const [id, n] of Object.entries(nodes)) {
  const own = new Set();
  for (const st of n.steps) { if (st.op === 'throw') own.add(st.tag); if (st.op === 'effect' && st.failWith) own.add(st.failWith.tag); }
  for (const c of calleesOf(id)) for (const t of nodes[c].channels?.E ?? []) own.add(t);
  for (const t of n.channels?.E ?? []) if (!own.has(t)) notices.push({ tag: 'declared', text: `${n.name} declares ${t}, and nothing it calls or raises produces it` });
}

console.log(`\nCOUNTS — what the regions were tuned for, against what they now hold`);
console.log(`  rail  .side  was 4 blocks (stack, scope, error path, effects ledger), all live and changing`);
console.log(`                is 0 blocks — every one of them was runtime state`);
console.log(`  title block   was 6 cells: Program, Condition, Step, Status, Notices, Sheet`);
console.log(`                is 2 cells with a referent — Program and Sheet; Condition, Step and Status were runtime`);
console.log(`  trace row     was a dw-dimension spanning the block, driven by TRACE.length — now spans nothing`);
console.log(`  cutaway tabs  Source / Files / Contract — all three survive intact`);
console.log(`\n  NOTICES computed from this IR: ${notices.length}`);
for (const n of notices) console.log(`    [${n.tag}] ${n.text}`);
console.log(`\n  surfaced in ${3} places already: the Notices title-block cell (count only),`);
console.log(`  the Files tab's Notices group (full text), the Contract tab's leaks (declared only)`);
console.log(`  files: ${ir.files.length} in the diff, ${orphans.length} on no node, ${ir.files.length - orphans.length} placed`);
