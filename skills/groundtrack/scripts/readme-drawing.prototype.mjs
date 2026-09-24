// PROTOTYPE for #98 — throwaway, never merge. README drawing layouts, as
// Design-canvas artboards, one inline SVG each:
//   node skills/groundtrack/scripts/readme-drawing.prototype.mjs
//   → <tmp>/grimoire-98-drawing/project/*.dc.html + canvas.json
// Sheets: A one sheet · B page + view A · C1 page + views A–E (hidden panes)
// · C2 the walk, four tour stops. C1 + C2 won.
// Everything is hand-placed here; stage 2 generates the same sheets from the
// flightpath file's tour steps. Region text is copied from the live greet page.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const P = join(tmpdir(), 'grimoire-98-drawing', 'project');
mkdirSync(P, { recursive: true });

const INK = '#22262b', PAPER = '#fafaf7', CAU = '#b45309';
const ink = a => `rgba(34,38,43,${a})`;
const F = `font-family="IBM Plex Mono, ui-monospace, monospace"`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = (x, y, s, size = 10, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill || INK}"${o.w ? ` font-weight="${o.w}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
const R = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill || 'none'}" stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const L = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
function wrap(s, n) {
  const out = []; let line = '';
  for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line); return out;
}

/* -- the rendered page, drawn at 1000 × 640 in its own units ---------------- */
const STATES = {
  move2: { step: '2 / 11', greet: 'RUNNING', lookup: 'WAITING', stack: ['greet [1]'], err: [['nothing has thrown', ink(.7)]],
    ledger: [['nothing touched the outside world yet', null]], cutNode: 'greet', cutLoc: 'src/greet.ts:8', cur: 1,
    cut: ['0          greet a user by name, or fall back to a plain hello', '1          call lookupName   the only call that can fail', '2          if name is empty → plain else named', '3 NAMED    var line = "Hello, " + name'] },
  move5: { step: '5 / 11', greet: 'WAITING', lookup: 'RUNNING', stack: ['lookupName [3]', 'greet [2]'], err: [['◆ lookupName thrown NoSuchUser', CAU]],
    ledger: [['1 db.get read the name row', 'null']], cutNode: 'lookupName', cutLoc: 'src/name-store.ts:3', cur: 3,
    cut: ['0          effect db.get read the name row', '1          if row is missing → missing else found', '2 FOUND    return row.displayName', '3 MISSING  throw NoSuchUser fail no row for that id'] },
  move6: { step: '6 / 11', greet: 'RUNNING', lookup: 'DONE', stack: ['greet [5]'], err: [['◆ lookupName thrown NoSuchUser', CAU], ['└ greet caught', CAU]],
    ledger: [['1 db.get read the name row', 'null']], cutNode: 'greet', cutLoc: 'src/greet.ts:8', cur: 1,
    cut: ['0          greet a user by name, or fall back to a plain hello', '1          call lookupName   on NoSuchUser → plain', '2          if name is empty → plain else named', '5 PLAIN    var line = "Hello there"'] },
  move9: { step: '9 / 11', greet: 'RUNNING', lookup: 'DONE', stack: ['greet [6]'], err: [['◆ lookupName thrown NoSuchUser', CAU], ['└ greet caught', CAU]],
    ledger: [['1 db.get read the name row', 'null'], ['2 http.post POST the greeting', 'ok']], cutNode: 'greet', cutLoc: 'src/greet.ts:8', cur: 3,
    cut: ['4          goto send', '5 PLAIN    var line = "Hello there"', '6 SEND     effect http.post POST the greeting', '7          return line'] },
};

// Region boxes in page units: what a callout or a spotlight frames.
const REG = {
  run: [48, 60, 424, 26], step: [486, 60, 270, 26], tour: [876, 12, 68, 32], plan: [0, 92, 660, 328],
  node: [40, 120, 260, 110], tools: [660, 92, 340, 104], stack: [660, 196, 340, 86], errpath: [660, 330, 340, 76],
  ledger: [660, 406, 340, 154], cut: [0, 420, 660, 140], title: [0, 560, 1000, 80],
};

function page(st) {
  const s = STATES[st];
  const g = [];
  g.push(R(0, 0, 1000, 640, { fill: PAPER, sw: 2 }));
  // head
  g.push(R(16, 12, 32, 32, { fill: INK, stroke: INK }));
  g.push(T(60, 26, 'Example · greet a user', 15, { w: 600 }));
  g.push(T(60, 42, 'The lookup returns no row, an if routes to the throw, and the handler catches.', 9.5, { fill: ink(.7) }));
  g.push(R(876, 12, 68, 32, { sw: 1.5 }), T(910, 32, 'TOUR', 10, { anchor: 'middle', w: 600, ls: 1.5 }));
  g.push(R(952, 12, 32, 32), T(968, 33, '☾', 13, { anchor: 'middle' }));
  g.push(T(16, 77, 'RUN', 9, { ls: 1.5, fill: ink(.7) }));
  g.push(R(50, 62, 420, 22), T(58, 77, 'no such user — The lookup returns no row, an if routes…', 9.5), T(460, 77, '⌄', 10, { anchor: 'middle' }));
  let bx = 488;
  for (const [lbl, w] of [['|<', 34], ['<', 34], ['PLAY', 56], ['>', 34], ['>|', 34]]) { g.push(R(bx, 62, w, 22), T(bx + w / 2, 77, lbl, 9, { anchor: 'middle', w: 500 })); bx += w + 6; }
  g.push(T(750, 77, s.step, 9.5, { anchor: 'end' }));
  g.push(L(0, 92, 1000, 92, { sw: 1.5 }));
  // plan with its grid
  for (let x = 24; x < 660; x += 24) g.push(L(x, 92, x, 420, { stroke: ink(.05) }));
  for (let y = 116; y < 420; y += 24) g.push(L(0, y, 660, y, { stroke: ink(.05) }));
  const node = (x, y, role, state, name, loc, lines) => {
    const run = state === 'RUNNING';
    g.push(R(x, y, 260, 110, { fill: PAPER, stroke: run ? CAU : INK, sw: run ? 2 : 1.5 }));
    g.push(T(x + 12, y + 18, role, 8, { ls: 1.5, fill: ink(.7) }), T(x + 248, y + 18, state, 8, { anchor: 'end', ls: 1.5, fill: run ? CAU : ink(.7) }));
    g.push(T(x + 12, y + 38, name, 13, { w: 600 }), T(x + 12, y + 52, loc, 8.5, { fill: ink(.7) }));
    lines.forEach((l, i) => g.push(T(x + 12, y + 72 + i * 13, l, 8.5)));
  };
  node(40, 120, 'HANDLER', s.greet, 'greet', 'src/greet.ts:8', ['success       a greeting line', 'error         NoSuchUser · SendFailed', 'requirements  the name store']);
  node(40, 290, 'IO', s.lookup, 'lookupName', 'src/name-store.ts:3', ['success       a display name', 'error         NoSuchUser', 'requirements  the name store']);
  g.push(L(170, 230, 170, 284, { sw: 1.5 }), `<path d="M165 280 L170 289 L175 280 Z" fill="${INK}"/>`);
  // cutaway
  g.push(L(0, 420, 660, 420, { sw: 1.5 }));
  g.push(T(16, 438, 'CUTAWAY', 8, { ls: 1.5, fill: ink(.7) }), T(80, 438, s.cutNode, 11, { w: 600 }), T(88 + s.cutNode.length * 7, 438, s.cutLoc, 8.5, { fill: ink(.7) }));
  g.push(T(470, 438, 'SOURCE', 8, { ls: 1.2, w: 600 }), L(470, 442, 506, 442), T(524, 438, 'FILES', 8, { ls: 1.2 }), T(572, 438, 'CONTRACT', 8, { ls: 1.2 }));
  g.push(R(0, 448, 660, 112, { fill: ink(.05), stroke: 'none', sw: 0 }));
  s.cut.forEach((l, i) => {
    if (i === s.cur) g.push(R(0, 452 + i * 26, 660, 24, { fill: ink(.12), stroke: 'none', sw: 0 }), L(2, 452 + i * 26, 2, 476 + i * 26, { sw: 3 }));
    g.push(T(16, 468 + i * 26, l, 9));
  });
  // rail
  g.push(L(660, 92, 660, 560, { sw: 1.5 }));
  [['ZOOM', '−   FIT   +   1:0.73'], ['LAYER', 'PRODUCTION   TESTS'], ['VIEW', 'PLAN   TREE'], ['HOLD', '□ EFFECT   □ ERROR']].forEach(([k, v], i) => {
    g.push(T(680, 116 + i * 22, k, 8, { ls: 1.5, fill: ink(.7) }), T(750, 116 + i * 22, v, 8.5, { w: 500 }));
  });
  g.push(L(660, 196, 1000, 196));
  g.push(T(680, 216, 'CALL STACK', 8, { ls: 1.5, fill: ink(.7) }));
  s.stack.forEach((f, i) => { if (i === 0) g.push(L(682, 226, 682, 244, { sw: 2 })); g.push(T(690, 240 + i * 20, f, 10)); });
  g.push(L(660, 282, 1000, 282, { stroke: ink(.12) }));
  g.push(T(680, 302, 'ARGUMENTS', 8, { ls: 1.5, fill: ink(.7) }), T(700, 320, 'userId u-404', 9));
  g.push(L(660, 330, 1000, 330, { stroke: ink(.12) }));
  g.push(T(680, 350, 'ERROR PATH', 8, { ls: 1.5, fill: ink(.7) }));
  s.err.forEach(([t, c], i) => g.push(T(680, 370 + i * 18, t, 9.5, { fill: c })));
  g.push(L(660, 406, 1000, 406, { stroke: ink(.12) }));
  g.push(T(680, 426, 'EFFECTS LEDGER', 8, { ls: 1.5, fill: ink(.7) }));
  s.ledger.forEach(([t, r], i) => { g.push(T(680, 446 + i * 34, t, 9.5)); if (r) g.push(T(694, 460 + i * 34, r, 9, { fill: r === 'ok' ? '#15803d' : ink(.7) })); });
  // title block
  g.push(L(0, 560, 1000, 560, { sw: 2 }));
  [['FILE', 'example-greet', 0], ['NODES', '2', 200], ['RUNS', '3', 400], ['CHANGED FILES', '2', 600], ['TRACE', '', 800]].forEach(([k, v, x]) => {
    if (x) g.push(L(x, 560, x, 640, { stroke: ink(.3) }));
    g.push(T(x + 16, 582, k, 8, { ls: 1.5, fill: ink(.7) }), T(x + 16, 606, v, 11));
  });
  g.push(R(816, 592, 96, 22, { stroke: CAU, sw: 1.5 }), T(864, 607, '● AUTHORED', 8.5, { anchor: 'middle', fill: CAU, ls: 1.2 }));
  return g.join('');
}

// Place the page at (ox, oy) scaled by k; returns [svg, map(x,y)].
function placed(st, ox, oy, k) {
  return [`<svg x="${ox}" y="${oy}" width="${1000 * k}" height="${640 * k}" viewBox="0 0 1000 640">${page(st)}</svg>`, (x, y) => [ox + x * k, oy + y * k]];
}

function balloon(n, bx, by, ax, ay, r = 15) {
  // leader from the balloon's edge to a terminal dot on the region
  const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy) || 1;
  return L(bx + dx / d * r, by + dy / d * r, ax, ay, { sw: 1.5 })
    + `<circle cx="${ax}" cy="${ay}" r="3" fill="${INK}"/>`
    + `<circle cx="${bx}" cy="${by}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`
    + T(bx, by + 5, n, r > 13 ? 14 : 12, { anchor: 'middle', w: 600 });
}

const PARTS = [
  [1, 'Run picker', 'Three recorded runs. Everything else on the page follows the one picked here.'],
  [2, 'Step controls', 'Step one move at a time, or play the run. The arrow keys do the same.'],
  [3, 'Tour', 'Walks this page for you, region by region, on a real run.'],
  [4, 'Graph', 'The change as a call graph: one box per function the change touches.'],
  [5, 'Node', 'What a function returns, what it throws, and what it needs.'],
  [6, 'Cutaway', 'The source of the node the cursor is in, current step marked.'],
  [7, 'Tools', 'Redraw the graph under the test layer, or as an indented tree.'],
  [8, 'Call stack', 'Who called whom, right now. The running node sits on top.'],
  [9, 'Error path', 'Where a throw travels, and where it stops.'],
  [10, 'Effects ledger', 'Every read and write to the outside world, in order.'],
  [11, 'Title block', 'What the file is: nodes, runs, changed files, provenance.'],
];

function partsList(x, y, w, rows, head = 'PARTS LIST — REGIONS OF THE PAGE', fs = 13) {
  const g = []; const cN = 56, cR = 150, cW = w - cN - cR; const chars = Math.floor((cW - 20) / (fs * 0.6));
  g.push(R(x, y, w, 34, { sw: 2 }), T(x + 14, y + 22, head, 11, { ls: 2, w: 600 }));
  let yy = y + 34;
  g.push(R(x, yy, w, 26, { sw: 1 }));
  [['FIND NO.', x + 10], ['REGION', x + cN + 10], ['WHAT IT IS', x + cN + cR + 10]].forEach(([t, tx]) => g.push(T(tx, yy + 17, t, 9, { ls: 1.5, fill: ink(.7) })));
  yy += 26;
  for (const [n, r, what] of rows) {
    const lines = wrap(what, chars); const h = 14 + lines.length * (fs + 5);
    g.push(R(x, yy, w, h, { sw: 1 }));
    g.push(T(x + cN / 2, yy + fs + 6, n, fs, { anchor: 'middle', w: 600 }), T(x + cN + 10, yy + fs + 6, r, fs, { w: 600 }));
    lines.forEach((l, i) => g.push(T(x + cN + cR + 10, yy + fs + 6 + i * (fs + 5), l, fs)));
    yy += h;
  }
  g.push(L(x + cN, y + 34, x + cN, yy), L(x + cN + cR, y + 34, x + cN + cR, yy));
  g.push(R(x, y, w, yy - y, { sw: 2 }));
  return [g.join(''), yy];
}

function titleBlock(x, y, w, dwg, sheet, subject) {
  const h = 140, g = [];
  g.push(R(x, y, w, h, { sw: 2 }), L(x, y + 56, x + w, y + 56), L(x, y + 98, x + w, y + 98), L(x + w * .5, y + 98, x + w * .5, y + h), L(x + w * .75, y + 98, x + w * .75, y + h));
  g.push(T(x + 14, y + 24, 'GRIMOIRE · GROUNDTRACK', 10, { ls: 2, fill: ink(.7) }), T(x + 14, y + 46, subject, 17, { w: 600, ls: 1 }));
  g.push(T(x + 14, y + 72, 'DRAWN FROM', 8, { ls: 1.5, fill: ink(.7) }), T(x + 14, y + 89, 'examples/greet.flightpath.json · run: no such user', 11));
  [['DWG NO.', dwg, 0], ['SCALE', 'NONE', .5], ['SHEET', sheet, .75]].forEach(([k, v, f]) => g.push(T(x + w * f + 14, y + 114, k, 8, { ls: 1.5, fill: ink(.7) }), T(x + w * f + 14, y + 132, v, 12, { w: 600 })));
  return g.join('');
}

function frame(W, H) {
  const g = [R(0, 0, W, H, { fill: PAPER, stroke: 'none', sw: 0 })];
  for (let x = 24; x < W; x += 24) g.push(L(x, 0, x, H, { stroke: ink(.04) }));
  for (let y = 24; y < H; y += 24) g.push(L(0, y, W, y, { stroke: ink(.04) }));
  g.push(R(20, 20, W - 40, H - 40, { sw: 2 }));
  return g.join('');
}

function notes(x, y, lines) {
  return T(x, y, 'NOTES', 10, { ls: 2, w: 600 }) + lines.map((l, i) => T(x, y + 22 + i * 20, `${i + 1}. ${l}`, 12)).join('');
}

/* -- A: one sheet, every callout on the whole page ------------------------- */
function sheetA() {
  const W = 1600, H = 1040; const k = .9; const [pg, m] = placed('move5', 130, 150, k);
  const a = (r, fx = .5, fy = .5) => m(REG[r][0] + REG[r][2] * fx, REG[r][1] + REG[r][3] * fy);
  const g = [frame(W, H), T(60, 76, 'GENERAL ARRANGEMENT — THE RENDERED PAGE', 22, { w: 600, ls: 2 }),
    T(60, 102, 'FIG. 01 — one page, eleven regions. Each number is a stop on the page’s own tour.', 13, { fill: ink(.8) }), pg];
  const B = (n, bx, by, pt) => g.push(balloon(n, bx, by, pt[0], pt[1]));
  B(1, a('run')[0], 124, a('run', .5, 0)); B(2, a('step')[0], 124, a('step', .5, 0)); B(3, a('tour')[0], 124, a('tour', .5, 0));
  B(4, 80, a('plan', 0, .52)[1], a('plan', 0.02, .52)); B(5, 80, a('node', 0, .3)[1], a('node', 0, .3));
  B(6, 80, a('cut')[1], a('cut', 0.02, .5));
  B(7, 1060, a('tools')[1], a('tools', .98, .5)); B(8, 1060, a('stack')[1], a('stack', .98, .5));
  B(9, 1060, a('errpath')[1], a('errpath', .98, .5)); B(10, 1060, a('ledger')[1], a('ledger', .98, .5));
  B(11, a('title', .3)[0], 770, a('title', .3, 1));
  g.push(notes(60, 830, ['The page is drawn at run “no such user”, move 5 of 11: lookupName has just thrown.',
    'Numbers follow the tour’s order. Press TOUR on the page to walk them on a live run.',
    'Every region is read from the flightpath file. Nothing on this sheet is a screenshot.']));
  const [pl] = partsList(1110, 60, 450, PARTS); g.push(pl);
  g.push(titleBlock(1110, 872, 450, 'GT-01', '1 OF 1', 'THE RENDERED PAGE'));
  return g.join('');
}

/* -- B: small general view + an enlarged detail view ------------------------ */
function sheetB() {
  const W = 1600, H = 1040; const k = .62; const [pg, m] = placed('move5', 110, 150, k);
  const a = (r, fx = .5, fy = .5) => m(REG[r][0] + REG[r][2] * fx, REG[r][1] + REG[r][3] * fy);
  const g = [frame(W, H), T(60, 76, 'GENERAL ARRANGEMENT AND VIEW A', 22, { w: 600, ls: 2 }),
    T(60, 102, 'FIG. 01 — the page, and the rail enlarged at the moment the lookup throws.', 13, { fill: ink(.8) }), pg];
  const B = (n, bx, by, pt) => g.push(balloon(n, bx, by, pt[0], pt[1], 13));
  B(1, a('run')[0], 126, a('run', .5, 0)); B(2, a('step')[0], 126, a('step', .5, 0)); B(3, a('tour')[0], 126, a('tour', .5, 0));
  B(4, 70, a('plan', 0, .52)[1], a('plan', .02, .52)); B(5, 70, a('node', 0, .3)[1], a('node', 0, .3)); B(6, 70, a('cut')[1], a('cut', .02, .5));
  B(7, a('title', .3)[0], 580, a('title', .3, 1));
  // section arrow A on the rail
  const [rx, ry] = a('stack', 1, 0), [, ry2] = a('ledger', 1, 1);
  g.push(R(a('stack', 0, 0)[0], ry, (a('stack', 1, 0)[0] - a('stack', 0, 0)[0]), ry2 - ry, { dash: '8 5', sw: 1.5 }));
  g.push(L(rx + 12, ry, rx + 12, ry2, { sw: 1.5, dash: '14 4 3 4' }), T(rx + 28, ry + 6, 'A', 18, { w: 600 }), T(rx + 28, ry2 + 4, 'A', 18, { w: 600 }));
  g.push(`<path d="M${rx + 12} ${ry} l18 0 m-6 -5 l6 5 l-6 5" stroke="${INK}" stroke-width="1.5" fill="none"/>`);
  // VIEW A: rail from stack to ledger, at 1.55×
  const vx = 900, vy = 150, vk = 1.5, sx = 660, sy = 196, sw = 340, sh = 364;
  g.push(`<svg x="${vx}" y="${vy}" width="${sw * vk}" height="${sh * vk}" viewBox="${sx} ${sy} ${sw} ${sh}">${page('move5')}</svg>`);
  g.push(R(vx, vy, sw * vk, sh * vk, { sw: 2 }));
  const vm = (x, y) => [vx + (x - sx) * vk, vy + (y - sy) * vk];
  const B2 = (n, pt, by) => g.push(balloon(n, vx - 50, by, pt[0], pt[1], 15));
  B2(8, vm(700, 240), vm(0, 240)[1]); B2(9, vm(690, 370), vm(0, 370)[1]); B2(10, vm(690, 446), vm(0, 446)[1]);
  g.push(T(vx + sw * vk / 2, vy + sh * vk + 34, 'VIEW A — THE RAIL, RUN “NO SUCH USER”, MOVE 5 OF 11', 13, { anchor: 'middle', w: 600, ls: 1.5 }));
  g.push(T(vx + sw * vk / 2, vy + sh * vk + 54, 'lookupName is on top of greet, and it has just thrown NoSuchUser.', 12, { anchor: 'middle', fill: ink(.8) }));
  // B numbers the general view 1–7 and view A 8–10; the tools row is left out.
  const by = Object.fromEntries(PARTS.map(p => [p[1], p]));
  const renum = ['Run picker', 'Step controls', 'Tour', 'Graph', 'Node', 'Cutaway', 'Title block', 'Call stack', 'Error path', 'Effects ledger']
    .map((r, i) => [i + 1, r, by[r][2]]);
  const [p1] = partsList(60, 700, 500, renum.slice(0, 5), 'PARTS LIST — 1 TO 5', 12);
  const [p2] = partsList(590, 700, 500, renum.slice(5), 'PARTS LIST — 6 TO 10', 12);
  g.push(p1, p2, titleBlock(1110, 872, 450, 'GT-01', '1 OF 1', 'PAGE AND VIEW A'));
  return g.join('');
}

/* -- C: sheet 1 is B with every hidden pane as a view, sheet 2 is the walk -- */
// Views drawn in their own units, 600 wide, from the live greet page's text.
const tag = (x, y, t, o = {}) => { const w = t.length * 6.6 + 12; return R(x, y - 11, w, 15, { sw: 1, stroke: o.stroke || INK }) + T(x + 6, y, t, 9, { ls: 1, fill: o.fill || INK }); };
const lbl = (x, y, t) => T(x, y, t, 9, { ls: 1.5, fill: ink(.7) });
function cutHead(g, active) {
  g.push(lbl(14, 22, 'CUTAWAY'), T(80, 22, 'greet', 12, { w: 600 }), T(128, 22, 'src/greet.ts:8', 9.5, { fill: ink(.7) }));
  [['SOURCE', 400], ['FILES', 460], ['CONTRACT', 510]].forEach(([t, x]) => { g.push(T(x, 22, t, 9, { ls: 1.2, w: t === active ? 600 : 400 })); if (t === active) g.push(L(x, 26, x + t.length * 6.3, 26, { sw: 1.5 })); });
  g.push(L(0, 34, 600, 34));
}
function viewFiles() {
  const g = []; cutHead(g, 'FILES');
  const row = (y, d, path, why, kind, indent = 0) => { g.push(T(14 + indent, y, d, 10, { fill: ink(.7) }), T(78 + indent, y, path, 10.5, { w: 600 }), T(78 + indent + path.length * 6.3 + 8, y, '— ' + why, 10), tag(512, y, kind)); };
  g.push(lbl(14, 56, 'THIS NODE')); row(76, '+12 −3', 'src/greet.ts', 'the handler and the fallback line', 'MODIFIED');
  g.push(lbl(14, 104, 'OTHER NODES ON THIS SHEET')); row(124, '+24 −0', 'src/name-store.ts', 'the lookup the greeting calls', 'NEW');
  g.push(lbl(14, 152, 'EVERY FILE IN THE CHANGE'), T(14, 172, 'src/', 10.5, { w: 600 }));
  row(192, '+12 −3', 'greet.ts', 'the handler and the fallback line', 'MODIFIED', 16); row(212, '+24 −0', 'name-store.ts', 'the lookup the greeting calls', 'NEW', 16);
  return [g.join(''), 228];
}
function viewContract() {
  const g = []; cutHead(g, 'CONTRACT');
  const kv = (y, k, v) => { g.push(lbl(14, y, k.toUpperCase()), T(150, y, v, 10.5)); };
  kv(58, 'role', 'handler'); kv(80, 'takes', 'userId'); kv(102, 'success', 'a greeting line');
  g.push(lbl(14, 124, 'ERROR'), T(150, 124, 'NoSuchUser', 10.5, { w: 600 }), tag(236, 124, 'FAIL'), tag(284, 124, 'CATCHES'));
  g.push(T(150, 146, 'SendFailed', 10.5, { w: 600 }), tag(236, 146, 'FAIL'), tag(284, 146, 'PASSES UP FROM BENEATH'));
  kv(168, 'requirements', 'the name store'); kv(190, 'entered by', 'src/greet.test.ts'); kv(212, 'paths', '3 — 1 + 1 if + 1 handler');
  return [g.join(''), 228];
}
function viewTree() {
  const g = [];
  g.push(lbl(14, 22, 'VIEW'), T(64, 22, 'PLAN', 9, { ls: 1.2 }), T(104, 22, 'TREE', 9, { ls: 1.2, w: 600 }), L(104, 26, 130, 26, { sw: 1.5 }), L(0, 34, 600, 34));
  g.push(T(14, 60, 'greet', 12, { w: 600 }), tag(64, 60, 'HANDLER'));
  g.push(T(30, 80, 'success a greeting line · error NoSuchUser, SendFailed · requirements the name store', 9.5, { fill: ink(.8) }));
  g.push(T(30, 100, '· http.post not called', 10, { fill: ink(.7) }));
  g.push(L(20, 66, 20, 124, { stroke: ink(.3) }), L(20, 124, 34, 124, { stroke: ink(.3) }));
  g.push(T(40, 128, '→ lookupName', 12, { w: 600 }), tag(150, 128, 'IO'));
  g.push(T(56, 148, 'success a display name · error NoSuchUser · requirements the name store', 9.5, { fill: ink(.8) }));
  g.push(T(56, 168, 'the only call that can fail', 10, { fill: ink(.8) }), T(56, 188, '· db.get not called', 10, { fill: ink(.7) }));
  return [g.join(''), 204];
}
function viewTests() {
  const g = [];
  g.push(lbl(14, 22, 'LAYER'), T(70, 22, 'PRODUCTION', 9, { ls: 1.2 }), T(160, 22, 'TESTS', 9, { ls: 1.2, w: 600 }), L(160, 26, 196, 26, { sw: 1.5 }), L(0, 34, 600, 34));
  g.push(R(14, 48, 572, 112, { sw: 1.5 }));
  g.push(T(28, 68, 'IO', 8.5, { ls: 1.5, fill: ink(.7) }), T(28, 88, 'lookupName', 13, { w: 600 }), T(120, 88, 'src/name-store.ts:3', 9, { fill: ink(.7) }));
  g.push(T(28, 110, 'success       a display name', 10), T(28, 126, 'error         NoSuchUser', 10));
  g.push(T(28, 146, 'requirements  the name store', 10), T(226, 146, '→ a fixed map · greet.test.ts:14', 10, { w: 600 }), L(226, 150, 466, 150, { sw: 2 }));
  return [g.join(''), 172];
}

function sheetC1() {
  const W = 1600; const k = .72; const [pg, m] = placed('move5', 110, 150, k);
  const a = (r, fx = .5, fy = .5) => m(REG[r][0] + REG[r][2] * fx, REG[r][1] + REG[r][3] * fy);
  const g = [pg];
  const B = (n, bx, by, pt) => g.push(balloon(n, bx, by, pt[0], pt[1], 14));
  B(1, a('run')[0], 126, a('run', .5, 0)); B(2, a('step')[0], 126, a('step', .5, 0)); B(3, a('tour')[0], 126, a('tour', .5, 0));
  B(4, 70, a('plan', 0, .52)[1], a('plan', .02, .52)); B(5, 70, a('node', 0, .3)[1], a('node', 0, .3)); B(6, 70, a('cut')[1], a('cut', .02, .5));
  B(7, a('title', .3)[0], 660, a('title', .3, 1));
  // A: section line on the rail
  const [rx, ry] = a('stack', 1, 0), [, ry2] = a('ledger', 1, 1);
  g.push(L(rx + 14, ry, rx + 14, ry2, { sw: 1.5, dash: '14 4 3 4' }), T(rx + 4, ry - 8, 'A', 16, { w: 600 }), T(rx + 4, ry2 + 20, 'A', 16, { w: 600 }));
  // Hidden panes: a dashed ring on the control that opens each, and its view letter in a square
  const box = (L1, bx, by) => R(bx - 13, by - 13, 26, 26, { fill: PAPER, sw: 1.5 }) + T(bx, by + 6, L1, 15, { anchor: 'middle', w: 600 });
  // Ring sized to the word it marks; leader runs edge to edge, never through the rail.
  const ring = (L1, px, py, rx, ry, bx, by) => {
    const [x, y] = m(px, py);
    const dx = bx - x, dy = by - y, th = Math.atan2(dy, dx);
    const er = rx * ry / Math.hypot(ry * Math.cos(th), rx * Math.sin(th));
    const bt = Math.min(13 / Math.abs(Math.cos(th) || 1e-9), 13 / Math.abs(Math.sin(th) || 1e-9));
    const d = Math.hypot(dx, dy);
    g.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      L(x + dx / d * er, y + dy / d * er, bx - dx / d * bt, by - dy / d * bt, { sw: 1.5 }), box(L1, bx, by));
  };
  ring('E', 829, 135, 15, 8, 880, 230); ring('D', 796, 157, 13, 8, 880, 262);
  ring('B', 536, 435, 14, 8, 484, 424); ring('C', 591, 435, 20, 8, 560, 424);

  // Views, stacked down the right
  let vy = 150; const vx = 930;
  const title = (L1, head, sub, y) => { g.push(box(L1, vx + 13, y + 2), T(vx + 38, y + 7, head, 13, { w: 600, ls: 1.5 })); g.push(T(vx + 38, y + 27, sub, 12, { fill: ink(.8) })); };
  { const sx = 660, sy = 196, sw = 340, sh = 364, vk = 1.3;
    title('A', 'VIEW A — THE RAIL AT MOVE 5', 'Run “no such user”: lookupName has just thrown.', vy); vy += 48;
    g.push(`<svg x="${vx}" y="${vy}" width="${sw * vk}" height="${sh * vk}" viewBox="${sx} ${sy} ${sw} ${sh}">${page('move5')}</svg>`, R(vx, vy, sw * vk, sh * vk, { sw: 2 }));
    const vm = (x, y) => [vx + (x - sx) * vk, vy + (y - sy) * vk];
    [[8, 700, 240], [9, 690, 370], [10, 690, 446]].forEach(([n, x, y]) => { const p = vm(x, y); g.push(balloon(n, vx + sw * vk + 60, p[1], vm(990, y)[0], p[1], 14)); });
    vy += sh * vk + 56; }
  for (const [L1, head, sub, fn] of [
    ['B', 'VIEW B — FILES TAB', 'Hidden until you click FILES. Every file the change touches, with its lines.', viewFiles],
    ['C', 'VIEW C — CONTRACT TAB', 'Hidden until you click CONTRACT. What the node takes, returns, throws, needs.', viewContract],
    ['D', 'VIEW D — TREE VIEW', 'Hidden until you click TREE. The same graph as an indented tree.', viewTree],
    ['E', 'VIEW E — TESTS LAYER', 'Hidden until you click TESTS. The graph redrawn with the test doubles.', viewTests]]) {
    title(L1, head, sub, vy); vy += 48;
    const [svg, h] = fn();
    g.push(`<g transform="translate(${vx},${vy})">${R(0, 0, 600, h, { fill: PAPER, stroke: 'none', sw: 0 })}${svg}</g>`, R(vx, vy, 600, h, { sw: 2 }));
    vy += h + 56;
  }
  const H = vy + 40;
  const by = Object.fromEntries(PARTS.map(p => [p[1], p]));
  const rows = ['Run picker', 'Step controls', 'Tour', 'Graph', 'Node', 'Cutaway', 'Title block', 'Call stack', 'Error path', 'Effects ledger'].map((r, i) => [i + 1, r, by[r][2]]);
  const [pl, pend] = partsList(60, 740, 800, rows, 'PARTS LIST — FIND NO. 1 TO 10');
  const [vl, vend] = partsList(60, pend + 40, 800, [['A', 'The rail', 'Call stack, arguments, error path and effects, at one move of one run.'],
    ['B', 'Files tab', 'The files this node changes, the ones other nodes change, and every file in the change.'],
    ['C', 'Contract tab', 'What the node declares: what it takes, returns and throws, and what it requires.'],
    ['D', 'Tree view', 'The same graph as an indented tree, one row per call site. Stepping still works.'],
    ['E', 'Tests layer', 'The same graph with its test doubles: here the name store is a fixed map.']], 'VIEWS — A TO E');
  g.push(pl, vl);
  g.push(notes(60, vend + 50, ['The page is drawn at run “no such user”, move 5 of 11.', 'Views B to E are hidden until you click the control ringed on the page.', 'Sheet 2 walks four regions through one run, the way the tour does.']));
  g.push(titleBlock(60, H - 190, 800, 'GT-01', '1 OF 2', 'PAGE AND VIEWS A TO E'));
  const head = [frame(W, H), T(60, 76, 'GENERAL ARRANGEMENT AND VIEWS', 22, { w: 600, ls: 2 }),
    T(60, 102, 'FIG. 01 — the page as it opens, and every pane it hides until you ask for it.', 13, { fill: ink(.8) })];
  return [head.join('') + g.join(''), H];
}
function sheetC2() {
  const W = 1600, H = 1040; const g = [frame(W, H), T(60, 76, 'THE WALK — ONE RUN, FOUR STOPS', 22, { w: 600, ls: 2 }),
    T(60, 102, 'FIG. 02 — run “no such user”, stepped by the tour. Framed: the region each stop explains.', 13, { fill: ink(.8) })];
  const STOPS = [
    ['move2', 'cut', 6, 'Cutaway', 'MOVE 2 OF 11', 'The cursor is in greet, on the call to lookupName — the only call that can fail.'],
    ['move5', 'stack', 8, 'Call stack', 'MOVE 5 OF 11', 'lookupName is on top of greet, and it has just thrown NoSuchUser.'],
    ['move6', 'errpath', 9, 'Error path', 'MOVE 6 OF 11', 'The throw leaves lookupName and lands in greet’s catch. The run survives.'],
    ['move9', 'ledger', 10, 'Effects ledger', 'MOVE 9 OF 11', 'Two effects: the empty db read, then the POST of the fallback “Hello there”.'],
  ];
  const k = .48, cw = 1000 * k, ch = 640 * k;
  STOPS.forEach(([st, reg, n, name, mv, now], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 60 + col * (cw + 70), y = 140 + row * (ch + 130);
    const [pg, m] = placed(st, x, y, k); g.push(pg);
    const [rx, ry, rw, rh] = REG[reg]; const [ax, ay] = m(rx, ry);
    g.push(R(ax - 3, ay - 3, rw * k + 6, rh * k + 6, { stroke: CAU, sw: 2.5 }));
    g.push(`<circle cx="${x + 18}" cy="${y + ch + 30}" r="15" fill="${INK}"/>`, T(x + 18, y + ch + 35, i + 1, 14, { anchor: 'middle', w: 600, fill: PAPER }));
    g.push(T(x + 44, y + ch + 27, `STOP ${i + 1} · ${name.toUpperCase()} (FIND NO. ${n}) · ${mv}`, 11, { ls: 1.2, w: 600 }));
    wrap(now, 52).forEach((l, j) => g.push(T(x + 44, y + ch + 48 + j * 18, l, 13)));
    if (col === 0) g.push(`<path d="M${x + cw + 16} ${y + ch / 2} l38 0 m-8 -6 l8 6 l-8 6" stroke="${INK}" stroke-width="1.5" fill="none"/>`);
  });
  g.push(notes(1150, 150, ['Stops are the tour’s own steps, in order.', 'Find numbers refer to sheet 1.']));
  g.push(titleBlock(1110, 872, 450, 'GT-02', '2 OF 2', 'ONE RUN, WALKED'));
  return g.join('');
}

function dc(title, svg, W = 1600, H = 1040) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#fafaf7}
</style>
</helmet>
<div style="width: ${W}px; height: ${H}px; font-family: 'IBM Plex Mono', monospace; color: #22262b; background: #fafaf7">
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${F} role="img" aria-label="${title}">${svg}</svg>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${W},"height":${H}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
}

const [c1, c1h] = sheetC1();
const boards = {
  'Main.dc.html': ['A · one sheet, every callout', sheetA(), 0, 0, 1040],
  'B-detail-view.dc.html': ['B · page plus view A', sheetB(), 1680, 0, 1040],
  'C1-layout.dc.html': ['C · sheet 1 of 2, page and views A–E', c1, 0, 1440, c1h],
  'C2-walk.dc.html': ['C · sheet 2 of 2, the walk', sheetC2(), 1680, 1440, 1040],
};
const canvas = {
  v: 3, createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
  title: 'groundtrack README drawing', launch: { view: 'canvas' }, pages: [], boards: {}, order: [],
  notes: {
    t1: { x: 0, y: -300, text: 'A and B — one sheet each', kind: 'title1', maxW: 3280 },
    t2: { x: 0, y: 1140, text: 'C — two sheets: the layout, then the walk', kind: 'title1', maxW: 3280 },
  },
  designSystems: [{ title: 'Aviation Design System', namespace: 'aviation', artifact: 'https://claude.ai/artifact/EaUVLUNuYwcrLzmX8g3rgE', version: '1789850419-27d2', copiedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }],
};
for (const [file, [title, svg, x, y, h]] of Object.entries(boards)) {
  writeFileSync(join(P, file), dc(title, svg, 1600, Math.round(h)));
  canvas.boards[file] = { x, y, w: 1600, h: Math.round(h), title };
  canvas.order.push(file);
}
writeFileSync(join(P, 'canvas.json'), JSON.stringify(canvas, null, 2));
console.log('ok', Object.keys(boards).join(' '));
