// Re-runs the prototype's own layout() geometry (view.html:1129) over the real
// IR, and emits the #canvas fragment: SVG corridors plus absolutely-placed .nd
// parts. Constants lifted verbatim from view.html:1048-1051.
import { readFileSync, writeFileSync } from 'node:fs';

const W = 288, GAP_X = 48, GAP_Y = 96, PAD = 36;
const prog = JSON.parse(readFileSync(new URL('../programs/pr-313-first-paint.json', import.meta.url), 'utf8'));
const nodes = prog.nodes;
const ids = Object.keys(nodes);

const calleesOf = (id) => {
  const out = [];
  for (const s of nodes[id].steps || []) if (s.op === 'call' && nodes[s.target] && !out.includes(s.target)) out.push(s.target);
  return out;
};

// depth = longest path from the entry
const depth = Object.fromEntries(ids.map((i) => [i, 0]));
for (let k = 0; k < ids.length; k++)
  for (const id of ids) for (const c of calleesOf(id)) if (depth[c] < depth[id] + 1) depth[c] = depth[id] + 1;

const order = [], seen = new Set();
(function dfs(id) {
  if (seen.has(id)) return;
  seen.add(id); order.push(id); calleesOf(id).forEach(dfs);
})(prog.entry);
ids.forEach((id) => !seen.has(id) && order.push(id));

const rows = {};
for (const id of order) (rows[depth[id]] ||= []).push(id);

// height model, matching the .nd box: padding 12+12, top row 20, name 24,
// loc 18, channel block 66, plus 21 per effect row.
const effectsOf = (id) => (nodes[id].steps || []).filter((s) => s.op === 'effect');
const H = Object.fromEntries(ids.map((id) => [id, 152 + effectsOf(id).length * 21]));

const widest = Math.max(...Object.values(rows).map((r) => r.length));
const sheetW = widest * W + (widest - 1) * GAP_X;

const POS = {};
let y = PAD;
for (const d of Object.keys(rows).sort((a, b) => a - b)) {
  const row = rows[d];
  const rowW = row.length * W + (row.length - 1) * GAP_X;
  let x = PAD + (sheetW - rowW) / 2;
  for (const id of row) { POS[id] = { x, y, h: H[id] }; x += W + GAP_X; }
  y += Math.max(...row.map((id) => H[id])) + GAP_Y;
}
const canvasW = sheetW + PAD * 2;
const canvasH = y - GAP_Y + PAD;

// corridors: the call runs down the left of the pair, the declared error
// return runs up its right. Same corridor, opposite directions.
const EDGES = [];
for (const from of ids)
  for (const to of calleesOf(from)) {
    const a = POS[from], b = POS[to];
    const sx = a.x + W / 2 - 10, sy = a.y + a.h;
    const ex = b.x + W / 2 - 10, ey = b.y;
    const my = (sy + ey) / 2 - 6;
    EDGES.push({
      from, to,
      call: `M${sx},${sy} L${sx},${my} L${ex},${my} L${ex},${ey}`,
      err: `M${ex + 20},${ey} L${ex + 20},${my + 12} L${sx + 20},${my + 12} L${sx + 20},${sy}`,
      hasE: (nodes[to].channels?.E || []).length > 0,
    });
  }

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* A RECORDED WALK, per #28's amendment. Preset "the sheet 404s", stopped just
   after bindSheet's fetch failed and the warn landed. Authored by hand, not
   captured from a run — which is the provenance question the amendment hands
   to #32, and the reason the base board carries an AUTHORED stamp. */
const WALK = {
  preset: 'the sheet 404s',
  stack: ['buildShelf', 'bindSheet'],
  state: {
    buildShelf: 'active',
    resolveWoodwork: 'warm',
    worldSpaceUvs: 'warm',
    bindSheet: 'active',
    applyWoodFibre: 'cold',
    fibreMapFor: 'cold',
  },
  // caller>callee for every edge control has crossed
  walked: new Set(['buildShelf>resolveWoodwork', 'buildShelf>worldSpaceUvs', 'buildShelf>bindSheet']),
  // node -> effect kind -> outcome
  effects: { bindSheet: { 'net.get': 'fail', 'console.warn': 'ok' } },
};
const CHIP = {
  active: '<span class="dw-label">on stack</span>',
  warm: '<span class="dw-state dw-state--normal">returned</span>',
  cold: '',
};

const SUBSTITUTED = { bindSheet: 1, fibreMapFor: 1 };

const nodeInner = (id) => {
  const n = nodes[id], ch = n.channels || {};
  const fx = effectsOf(id)
    .map((x) => {
      const outcome = WALK.effects[id]?.[x.kind];
      const cls = outcome === 'fail' ? ' fx--fail' : outcome === 'ok' ? ' fx--ok' : '';
      return `        <div class="fx${cls}"><span class="fx-dot"></span><span class="fx-lead"></span><span class="fx-txt">${esc(x.kind)} <span class="dim">${esc(x.desc || '')}</span></span></div>`;
    })
    .join('\n');
  const E = (ch.E || []).length ? ch.E.map(esc).join(' · ') : '<span class="none">never</span>';
  const R = (ch.R || []).length ? esc(ch.R.join(', ')) : '<span class="none">none</span>';
  const chip = SUBSTITUTED[id]
    ? `<span class="dw-label" style="margin-left:auto">{{ chipText }}</span>`
    : CHIP[WALK.state[id]] ? `<span style="margin-left:auto">${CHIP[WALK.state[id]]}</span>` : '';
  const rHole = SUBSTITUTED[id] ? `{{ r_${id} }}` : R;
  return `        <div class="nd-top"><button class="bp" title="Hold on entry"></button><span class="dw-label">${esc(n.kind)}</span>${chip}</div>
        <div class="nd-name">${esc(n.name)}</div>
        <div class="nd-loc">${esc(n.loc || '')}</div>
        <div class="nd-ch">
          <b>A</b><span>${esc(ch.A || '—')}</span>
          <b>E</b><span>${E}</span>
          <b>R</b><span>${rHole}</span>
        </div>${fx ? '\n' + fx : ''}`;
};

const svg = `      <svg id="wires" viewBox="0 0 ${canvasW} ${canvasH}" style="width:${canvasW}px;height:${canvasH}px" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="ar-cold" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="rgb(34 38 43 / 0.3)"></path>
          </marker>
          <marker id="ar-ink" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#22262b"></path>
          </marker>
        </defs>
        <g id="edges">
${EDGES.map((e) => {
  // view.html renderPlan(): on the stack -> 2px ink; walked -> 1.5px ink;
  // neither -> 1px ink-30 construction hairline.
  const key = `${e.from}>${e.to}`;
  const onStack = WALK.stack.includes(e.from) && WALK.stack.includes(e.to);
  const taken = WALK.walked.has(key);
  const w = onStack ? 2 : taken ? 1.5 : 1;
  const col = onStack || taken ? '#22262b' : 'rgb(34 38 43 / 0.3)';
  const mk = onStack || taken ? 'ar-ink' : 'ar-cold';
  let out = `          <path d="${e.call}" fill="none" stroke="${col}" stroke-width="${w}" marker-end="url(#${mk})"></path>`;
  if (e.hasE)
    out += `\n          <path d="${e.err}" fill="none" stroke="rgb(34 38 43 / 0.3)" stroke-width="1" stroke-dasharray="4 4" marker-end="url(#ar-cold)"></path>`;
  return out;
}).join('\n')}
        </g>
      </svg>`;

const nodeEls = order
  .map((id) => {
    const st = WALK.state[id];
    const cls = ['nd', st === 'cold' ? 'nd--cold' : '', st === 'active' ? 'nd--active' : '']
      .filter(Boolean)
      .join(' ');
    return `      <div class="${cls}" style="left:${POS[id].x}px;top:${POS[id].y}px;width:${W}px">
${nodeInner(id)}
      </div>`;
  })
  .join('\n');

writeFileSync(new URL('./_plan.html', import.meta.url), `${svg}\n${nodeEls}\n`);
console.log(`canvas ${canvasW} x ${canvasH}`);
console.log('rows:', Object.entries(rows).map(([d, r]) => `${d}: ${r.join(', ')}`).join(' | '));
console.log('effects:', order.map((id) => `${id}=${effectsOf(id).length}`).join(' '));
for (const id of order) console.log(`  ${id} @ ${POS[id].x},${POS[id].y} h${POS[id].h}`);
