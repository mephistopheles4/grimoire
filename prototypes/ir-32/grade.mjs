/* grade.mjs — score eval runs and bucket every failure to a box row.
 *
 * A pass rate teaches nothing. Each error is attributed to the decision in the
 * #32 box that it indicts, so the eval discriminates between options rather
 * than producing one number.
 *
 *   node grade.mjs <runs-dir>
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './check.mjs';

/* Order matters: the first pattern that matches wins. Keep the walk patterns
 * ahead of the generic ones, or a walk fault lands in a shape bucket. */
const ROW = [
  [/missing required key "next"/i, 'Who makes the walk'],
  [/unknown key/i, 'An unknown key'],
  [/missing required key|state at least one/i, 'What a file must carry'],
  [/no edge from|cursor sits at|frame\(s\)|move ran|lands at|is not a step of|with no frame|done with|next \d+ is not a step|move ran step \d+, which is a|a "\w+" move ran step|next when it went on|never both|is not a move kind/i, 'Who makes the walk'],
  [/is not a label|onError does not name|onError goto|named by no onError/i, 'One name, two meanings'],
  [/role is blank/i, 'The node category'],
  [/^layers|entry "/i, 'What a layer may say'],
  [/effect kind|raise tag/i, 'Who makes the walk'],
  [/is not a node|op "|k "|change "|channel "|provenance "/i, 'One name, two meanings'],
  [/not JSON/i, 'Not valid JSON'],
];

const bucket = (e) => (ROW.find(([re]) => re.test(e)) || [, 'other'])[1];

const dir = process.argv[2];
const runs = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const rows = new Map();
const perRun = [];

for (const f of runs) {
  let prog, errs;
  try { prog = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
  catch (e) { errs = ['not JSON: ' + e.message]; }
  if (!errs) { try { errs = check(prog); } catch (e) { errs = ['checker threw: ' + e.message]; } }
  const tally = new Map();
  for (const e of errs) { const b = bucket(e); tally.set(b, (tally.get(b) || 0) + 1); rows.set(b, (rows.get(b) || 0) + 1); }
  perRun.push({ f, n: errs.length, tally, errs });
}

console.log('RUN'.padEnd(34) + 'ERRORS  BUCKETS');
for (const r of perRun) {
  const t = [...r.tally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ');
  console.log(`${r.f.padEnd(34)}${String(r.n).padStart(6)}  ${r.n ? t : 'clean'}`);
}

const clean = perRun.filter((r) => r.n === 0).length;
console.log(`\n${clean}/${perRun.length} files valid on the first attempt`);
console.log('\nFAILURES BY BOX ROW');
for (const [row, n] of [...rows].sort((a, b) => b[1] - a[1])) {
  const files = perRun.filter((r) => r.tally.has(row)).length;
  console.log(`  ${row.padEnd(28)} ${String(n).padStart(4)} errors in ${files} of ${perRun.length} files`);
}

if (process.argv.includes('--detail')) {
  console.log('\nDETAIL');
  for (const r of perRun) { if (!r.n) continue; console.log(`\n${r.f}`); for (const e of r.errs.slice(0, 10)) console.log('   ' + e); if (r.errs.length > 10) console.log(`   … ${r.errs.length - 10} more`); }
}
