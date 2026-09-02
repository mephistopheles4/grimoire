/* The tree rendering of the plan, in #35's house format: indented `→` arrows.
   Same IR and same recorded walk as gen-plan.mjs, so the two views are the one
   artifact seen twice — which is the property #35 says makes the notation worth
   having. Emits _tree.html. Run: node gen-tree.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const prog = JSON.parse(readFileSync(new URL('../programs/pr-313-first-paint.json', import.meta.url), 'utf8'));
const nodes = prog.nodes;

/* Same walk as gen-plan.mjs: preset "the sheet 404s", stopped just after
   bindSheet's fetch failed and the warn landed. */
const WALK = {
  state: { buildShelf: 'active', resolveWoodwork: 'warm', worldSpaceUvs: 'warm',
           bindSheet: 'active', applyWoodFibre: 'cold', fibreMapFor: 'cold' },
  effects: { bindSheet: { 'net.get': 'fail', 'console.warn': 'ok' } },
};

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const effectsOf = (id) => (nodes[id].steps || []).filter((s) => s.op === 'effect');

/* A CALL TREE, not the node graph: it walks call SITES, so a callee reached
   from two places appears twice. bindSheet is called at step 4 and step 8, so
   the tree is 7 lines where the drawing is 6 boxes. */
const lines = [];
const visit = (id, depth, site, reached) => {
  lines.push({ id, depth, site, reached });
  if (!nodes[id]) return;
  for (const st of nodes[id].steps || []) {
    if (st.op !== 'call' || !nodes[st.target]) continue;
    // On this walk buildShelf stopped at pc 4, so later call sites are unreached.
    const stepReached = id === 'buildShelf' ? (st.label === 'bind' ? 'active' : 'cold') : 'cold';
    visit(st.target, depth + 1, st.label || '', id === 'buildShelf' && st.label !== 'bind' ? 'cold' : stepReached);
  }
};
// hand-ordered to match the recorded walk rather than re-deriving it
lines.push({ id: 'buildShelf', depth: 0, reached: 'active' });
lines.push({ id: 'resolveWoodwork', depth: 1, reached: 'warm' });
lines.push({ id: 'worldSpaceUvs', depth: 1, reached: 'warm' });
lines.push({ id: 'bindSheet', depth: 1, site: 'the resolved sheet', reached: 'active' });
lines.push({ id: 'applyWoodFibre', depth: 1, reached: 'cold' });
lines.push({ id: 'fibreMapFor', depth: 2, reached: 'cold' });
lines.push({ id: 'bindSheet', depth: 1, site: 'the backboard, a constant', reached: 'cold' });

const row = ({ id, depth, site, reached }, i) => {
  const n = nodes[id], ch = n.channels || {};
  const cls = reached === 'cold' ? ' tr--cold' : reached === 'active' ? ' tr--active' : '';
  const arrow = depth ? '→ ' : '';
  const E = (ch.E || []).length ? esc(ch.E.join(' · ')) : '<span class="none">never</span>';
  const R = (ch.R || []).length ? esc(ch.R.join(', ')) : '<span class="none">none</span>';
  const fx = effectsOf(id)
    .map((x) => {
      const o = reached === 'cold' ? null : WALK.effects[id]?.[x.kind];
      const mark = o === 'fail' ? '<span class="caut">failed</span>' : o === 'ok' ? '<span class="ok">landed</span>' : '<span class="none">not reached</span>';
      return `<span class="tr-fx">· ${esc(x.kind)} ${mark}</span>`;
    })
    .join('');
  return `      <div class="tr${cls}" style="padding-left: ${depth * 24}px">
        <span class="tr-name">${arrow}${esc(n.name)}</span>
        <span class="dw-label tr-kind">${esc(n.kind)}</span>
        <span class="tr-ch"><b>A</b> ${esc(ch.A || '—')} &nbsp; <b>E</b> ${E} &nbsp; <b>R</b> ${R}</span>
        ${site ? `<span class="tr-site dim">${esc(site)}</span>` : ''}
        ${fx ? `<span class="tr-fxs">${fx}</span>` : ''}
      </div>`;
};

writeFileSync(new URL('./_tree.html', import.meta.url), lines.map(row).join('\n') + '\n');
console.log(`${lines.length} call sites for ${new Set(lines.map((l) => l.id)).size} nodes`);
for (const l of lines) console.log(`  ${'  '.repeat(l.depth)}${l.depth ? '→ ' : ''}${l.id}${l.site ? '  (' + l.site + ')' : ''}  [${l.reached}]`);
