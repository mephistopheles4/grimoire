#!/usr/bin/env node
// The two sheets groundtrack's README shows, drawn from a flightpath file and
// its tour, so the picture says what the page says. This repository's tool,
// not the skill's: it ships to no install.
//
//   node scripts/groundtrack-sheets.mjs <topic>.flightpath.json <dir>
//
//   sheet 1  the page at one move of one run, with a numbered callout on every
//            region and a view of every pane the page hides until a click
//   sheet 2  the tour's walk: each stop that moves the cursor, framed
//
// It writes <id>-sheet-1.svg and <id>-sheet-2.svg into <dir>. The file is
// validated by the renderer first, and a file with no tour is refused, because
// both sheets are drawn from it. Nothing checks the committed sheets are
// current; docs/brand/README.md says when to redraw them.
//
// A README shows an SVG as an image: no script runs and nothing is fetched.
// So a sheet carries its own faces, and it is plain drawing — rectangles,
// lines, paths and text. Every author string is escaped for XML here, because
// it lands in element content and in nothing else.
//
// The page's arithmetic is the module's, read rather than copied: layout for
// where the nodes sit, fold for the state at a move, stepTokens for how a step
// prints, treeRows for the tree, filesOf and fileTree for the files, and the
// tour's own regions for what each part of the page is for.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, '..', 'skills', 'groundtrack');
const G = createRequire(import.meta.url)(resolve(skill, 'scripts', 'groundtrack.js'));

/* -- the ink ----------------------------------------------------------------
 *
 * The Aviation system's deck palette, as literal values: an image has no
 * stylesheet to read a custom property from. One ink, one paper, the caution
 * amber for the one state it means — the frame on a tour stop, the running
 * node, the error path — and the green only for an effect that landed. */
const INK = '#22262b';
const PAPER = '#fafaf7';
const CAUTION = '#b45309';
const NORMAL = '#15803d';
const ink = a => `rgba(34,38,43,${a})`;

const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = v => Math.round(v * 100) / 100;

function T(tx, ty, text, size, o = {}) {
  return `<text x="${n(tx)}" y="${n(ty)}" font-size="${n(size)}" fill="${o.fill || INK}"` +
    (o.w ? ` font-weight="${o.w}"` : '') + (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
    (o.ls ? ` letter-spacing="${o.ls}"` : '') + `>${x(text)}</text>`;
}
function R(rx, ry, w, h, o = {}) {
  return `<rect x="${n(rx)}" y="${n(ry)}" width="${n(w)}" height="${n(h)}" fill="${o.fill || 'none'}"` +
    (o.stroke === null ? '' : ` stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"`) +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
function L(x1, y1, x2, y2, o = {}) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
/** Words to lines of at most `max` characters. Mono, so a character count is
 *  a width. A word longer than a line is cut rather than left to overrun. */
function wrap(text, max) {
  const out = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > max) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, max)); word = word.slice(max); }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= max) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const clip = (s, max) => (String(s).length > max ? String(s).slice(0, max - 1) + '…' : String(s));
const MONO = 0.6; /* a Plex Mono advance, as a fraction of the size */

/* -- the faces ---------------------------------------------------------------
 *
 * The page's six, byte for byte and with their own unicode ranges — the same
 * list render.mjs inlines into the page. An image may not fetch a font, so
 * the faces go in as data. */
const LATIN1 =
  'U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, ' +
  'U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, ' +
  'U+2122, U+2212, U+FB01-FB02';
const PI =
  'U+03C0, U+0E3F, U+2000-200D, U+2010-2012, U+2015, U+2028-2029, U+202F, U+2032-2033, ' +
  'U+203E, U+205F, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, ' +
  'U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, ' +
  'U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+2219-221A, ' +
  'U+221E, U+222B, U+2236, U+2248, U+2260, U+2264-2265, U+2400-2421, U+2500-259F, ' +
  'U+25CA, U+2713, U+274C, U+2B0E-2B11, U+3000, U+FEFF, U+FFFD';
const FACES = [
  ['400', 'IBMPlexMono-Regular-Latin1.woff2', LATIN1],
  ['400', 'IBMPlexMono-Regular-Pi.woff2', PI],
  ['500', 'IBMPlexMono-Medium-Latin1.woff2', LATIN1],
  ['500', 'IBMPlexMono-Medium-Pi.woff2', PI],
  ['600', 'IBMPlexMono-SemiBold-Latin1.woff2', LATIN1],
  ['600', 'IBMPlexMono-SemiBold-Pi.woff2', PI],
];
let facesCss = null;
function faces() {
  if (facesCss) return facesCss;
  facesCss = FACES.map(([weight, file, range]) => {
    const b64 = readFileSync(resolve(skill, 'assets', file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-weight:${weight};unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('');
  return facesCss;
}

function sheet(W, H, title, body) {
  const grid = [];
  for (let gx = 24; gx < W; gx += 24) grid.push(`M${gx} 0V${H}`);
  for (let gy = 24; gy < H; gy += 24) grid.push(`M0 ${gy}H${W}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${x(title)}">` +
    `<title>${x(title)}</title>` +
    `<style>${faces()}text{font-family:'IBM Plex Mono',ui-monospace,monospace}</style>` +
    R(0, 0, W, H, { fill: PAPER, stroke: null }) +
    `<path d="${grid.join('')}" stroke="${ink(0.05)}" stroke-width="1" fill="none"/>` +
    R(20, 20, W - 40, H - 40, { sw: 2 }) +
    body +
    '</svg>\n'
  );
}

/* -- where a stop puts the page ----------------------------------------------*/

function snapshot(prog, stop) {
  const view = G.graphView(prog, stop.graphIndex);
  const preset = view.presets[stop.runIndex];
  const states = G.fold(view, preset.trace);
  const move = Math.min(stop.move, states.length - 1);
  return { prog, view, preset, states, move, st: states[move], last: states.length - 1, lay: G.layout(view), stop };
}

/* The page, drawn at 1000 × 680 in its own units. The boxes are the regions a
 * tour frames, in those units, so a callout or a frame lands on the part of
 * the drawing the page's element would be. */
const PW = 1000, PH = 680;
const REGION_BOX = {
  sheet: [48, 60, 170, 26], run: [48, 60, 424, 26], controls: [486, 60, 270, 26],
  plan: [0, 92, 660, 328], tools: [660, 92, 340, 104], callStack: [660, 196, 340, 88],
  arguments: [660, 284, 340, 50], errorPath: [660, 334, 340, 86], effectsLedger: [660, 420, 340, 140],
  cutaway: [0, 420, 660, 140], titleBlock: [0, 560, 1000, 80], trace: [0, 640, 1000, 40],
};
/* The rail's regions are drawn in view A at a readable size, and called out
 * there rather than on the page. */
const RAIL = new Set(['callStack', 'arguments', 'errorPath', 'effectsLedger']);

function cursorOf(snap) {
  const frames = snap.st.frames;
  const top = frames.length ? frames[frames.length - 1] : null;
  return top ? { id: top.nodeId, pc: top.pc } : { id: snap.view.entry, pc: -1 };
}

function drawPage(snap) {
  const { prog, view, preset, st, lay } = snap;
  const multi = prog.graphs.length > 1;
  const g = [];
  const lbl = (tx, ty, t) => T(tx, ty, t.toUpperCase(), 9, { fill: ink(0.7), ls: 1.5 });
  g.push(R(0, 0, PW, PH, { fill: PAPER, sw: 2 }));

  /* the head */
  g.push(R(16, 12, 32, 32, { fill: INK }));
  g.push(T(60, 27, clip(prog.title, 52), 15, { w: 600 }));
  g.push(T(60, 43, clip(preset.blurb, 96), 9.5, { fill: ink(0.7) }));
  g.push(R(870, 12, 64, 28, { sw: 1.5 }), T(902, 30.5, 'TOUR', 10, { anchor: 'middle', w: 600, ls: 1.5 }));
  g.push(R(940, 12, 44, 28), T(962, 31, '☾', 14, { anchor: 'middle' }));
  let runX = 50;
  if (multi) {
    g.push(lbl(16, 77, 'sheet'), R(56, 62, 160, 22), T(64, 77, clip(view.graph.title, 22), 9.5));
    runX = 260;
    g.push(lbl(226, 77, 'run'));
  } else g.push(lbl(16, 77, 'run'));
  g.push(R(runX, 62, 470 - runX, 22), T(runX + 8, 77, clip(`${preset.name} — ${preset.blurb}`, Math.floor((470 - runX - 24) / 5.7)), 9.5));
  let bx = 488;
  for (const [t, w] of [['|<', 34], ['<', 34], ['PLAY', 56], ['>', 34], ['>|', 34]]) {
    g.push(R(bx, 62, w, 22), T(bx + w / 2, 77, t, 9, { anchor: 'middle', w: 500 }));
    bx += w + 6;
  }
  g.push(T(752, 77, `${snap.move} / ${snap.last}`, 9.5, { anchor: 'end' }));
  g.push(L(0, 92, PW, 92, { sw: 1.5 }));

  /* the drawing: the module's layout, scaled into the plan */
  const k = Math.min(620 / lay.canvasW, 300 / lay.canvasH, 1);
  const ox = 20 + (620 - lay.canvasW * k) / 2, oy = 106;
  const cursor = cursorOf(snap);
  const plan = [];
  for (const e of lay.edges) {
    if (e.hasE && e.err) plan.push(`<path d="${e.err}" fill="none" stroke="${ink(0.3)}" stroke-width="2" stroke-dasharray="6 5"/>`);
    if (e.call) plan.push(`<path d="${e.call}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  }
  for (const id of lay.order) {
    const p = lay.pos[id];
    const node = prog.nodes[id];
    const state = G.nodeState(st, id);
    const hot = state === 'running';
    const cold = state === 'not called';
    const c = node.channels || {};
    plan.push(R(p.x, p.y, lay.width, p.h, { fill: PAPER, stroke: hot ? CAUTION : cold ? ink(0.3) : INK, sw: hot ? 4 : 2.5 }));
    plan.push(T(p.x + 18, p.y + 28, String(node.role).toUpperCase(), 13, { fill: ink(0.7), ls: 2 }));
    plan.push(T(p.x + lay.width - 18, p.y + 28, state.toUpperCase(), 13, { anchor: 'end', fill: hot ? CAUTION : ink(0.7), ls: 2 }));
    plan.push(T(p.x + 18, p.y + 60, clip(node.name, 22), 22, { w: 600 }));
    plan.push(T(p.x + 18, p.y + 82, clip(node.loc || '', 36), 13, { fill: ink(0.7) }));
    const rows = [['success', c.success || '—'], ['error', (c.error || []).join(' · ') || 'never'], ['requirements', (c.requirements || []).join(', ') || 'none']];
    rows.forEach(([key, v], i) => {
      plan.push(T(p.x + 18, p.y + 114 + i * 22, key, 14, { w: 600 }));
      plan.push(T(p.x + 140, p.y + 114 + i * 22, clip(v, 24), 14));
    });
  }
  for (let gx = 24; gx < 660; gx += 24) g.push(L(gx, 92, gx, 420, { stroke: ink(0.05) }));
  for (let gy = 116; gy < 420; gy += 24) g.push(L(0, gy, 660, gy, { stroke: ink(0.05) }));
  g.push(`<g transform="translate(${n(ox)} ${n(oy)}) scale(${n(k)})">${plan.join('')}</g>`);

  /* the cutaway: the node the cursor is in, four lines about its step */
  const cnode = prog.nodes[cursor.id];
  const steps = cnode.steps || [];
  g.push(L(0, 420, 660, 420, { sw: 1.5 }));
  g.push(lbl(16, 438, 'cutaway'), T(84, 438, clip(cnode.name, 20), 11, { w: 600 }));
  g.push(T(94 + Math.min(cnode.name.length, 20) * 6.6, 438, clip(cnode.loc || '', 30), 8.5, { fill: ink(0.7) }));
  [['source', 470], ['files', 524], ['contract', 572]].forEach(([t, tx]) => {
    g.push(T(tx, 438, t.toUpperCase(), 8, { ls: 1.2, w: t === 'source' ? 600 : 400 }));
    if (t === 'source') g.push(L(tx, 442, tx + 36, 442));
  });
  g.push(R(0, 448, 660, 112, { fill: ink(0.05), stroke: null }));
  const from = Math.max(0, Math.min(cursor.pc - 1, steps.length - 4));
  steps.slice(from, from + 4).forEach((s, j) => {
    const i = from + j;
    const ly = 452 + j * 26;
    if (i === cursor.pc) g.push(R(0, ly, 660, 24, { fill: ink(0.12), stroke: null }), L(2, ly, 2, ly + 24, { sw: 3 }));
    const words = G.stepTokens(s).map(t => t.t).join(' ');
    g.push(T(16, ly + 16, `${i}`, 9, { fill: ink(0.7) }), T(34, ly + 16, clip(s.label || '', 8).toUpperCase(), 9, { fill: ink(0.7) }));
    g.push(T(100, ly + 16, clip(words, 88), 9.5));
  });

  /* the rail */
  g.push(L(660, 92, 660, 640, { sw: 1.5 }));
  const layers = Object.keys(prog.layers || {});
  [['zoom', '−   FIT   +'], ['layer', layers.length ? layers.join('   ').toUpperCase() : 'TESTS'], ['view', 'PLAN   TREE'], ['hold', '□ EFFECT   □ ERROR']].forEach(([key, v], i) => {
    g.push(lbl(680, 118 + i * 22, key), T(752, 118 + i * 22, clip(v, 38), 8.5, { w: 500 }));
  });
  g.push(L(660, 196, PW, 196));
  g.push(railPart(snap, 660, 196));
  g.push(L(0, 560, PW, 560, { sw: 2 }));

  /* the title block */
  const cells = [
    ['file', prog.id], ['nodes', String(lay.order.length)], ['runs', String(view.presets.length)],
    ['changed files', prog.files ? String(prog.files.length) : 'not stated'],
  ];
  cells.forEach(([key, v], i) => {
    const cx = i * 200;
    if (i) g.push(L(cx, 560, cx, 640, { stroke: ink(0.3) }));
    g.push(lbl(cx + 16, 582, key), T(cx + 16, 608, clip(v, 28), 11));
  });
  g.push(L(800, 560, 800, 640, { stroke: ink(0.3) }), lbl(816, 582, 'trace'));
  g.push(R(816, 592, 110, 22, { stroke: CAUTION, sw: 1.5 }), T(871, 607, `● ${preset.trace.provenance.toUpperCase()}`, 8.5, { anchor: 'middle', fill: CAUTION, ls: 1.2 }));

  /* the trace, a dimension line with the cursor's tick on it */
  g.push(L(0, 640, PW, 640, { stroke: ink(0.3) }));
  const at = 40 + (snap.last ? snap.move / snap.last : 0) * 900;
  g.push(L(40, 660, 940, 660, { stroke: ink(0.3) }), L(40, 660, at, 660, { sw: 2 }), L(at, 651, at, 669, { sw: 2 }));
  return g.join('');
}

/* The rail's four blocks, from the fold at the move. Drawn in page units from
 * (rx, ry), so the page and view A draw the same thing. */
function railPart(snap, rx, ry) {
  const { prog, preset, st } = snap;
  const g = [];
  const lbl = (tx, ty, t) => T(tx, ty, t.toUpperCase(), 9, { fill: ink(0.7), ls: 1.5 });
  const frames = st.frames.slice().reverse();
  g.push(lbl(rx + 20, ry + 20, 'call stack'));
  if (!frames.length) g.push(T(rx + 30, ry + 44, 'no frame open', 10, { fill: ink(0.7) }));
  frames.slice(0, 3).forEach((f, i) => {
    if (i === 0) g.push(L(rx + 22, ry + 31, rx + 22, ry + 49, { sw: 2 }));
    g.push(T(rx + 30, ry + 44 + i * 18, `${clip(prog.nodes[f.nodeId].name, 26)} [${f.pc}]`, 10));
  });
  g.push(L(rx, ry + 88, rx + 340, ry + 88, { stroke: ink(0.12) }));
  g.push(lbl(rx + 20, ry + 106, 'arguments'));
  const input = Object.entries(preset.input || {});
  g.push(T(rx + 30, ry + 124, input.length ? clip(input.map(([a, v]) => `${a} ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('  '), 44) : 'this run starts from nothing', 9.5, input.length ? {} : { fill: ink(0.7) }));
  g.push(L(rx, ry + 138, rx + 340, ry + 138, { stroke: ink(0.12) }));
  g.push(lbl(rx + 20, ry + 156, 'error path'));
  const MARK = { thrown: '◆', propagated: '│', caught: '└', 'reached the top uncaught': '↑' };
  if (!st.errorPath.length) g.push(T(rx + 30, ry + 176, 'nothing has thrown', 10, { fill: ink(0.7) }));
  st.errorPath.slice(0, 3).forEach((e, i) => {
    const who = e.nodeId ? prog.nodes[e.nodeId].name : 'the top';
    g.push(T(rx + 20, ry + 176 + i * 18, clip(`${MARK[e.how] || ' '} ${who} ${e.how}${e.tag ? ' ' + e.tag : ''}`, 50), 9.5, { fill: CAUTION }));
  });
  g.push(L(rx, ry + 224, rx + 340, ry + 224, { stroke: ink(0.12) }));
  g.push(lbl(rx + 20, ry + 242, 'effects ledger'));
  if (!st.ledger.length) g.push(T(rx + 30, ry + 262, 'nothing touched the outside world yet', 9.5, { fill: ink(0.7) }));
  st.ledger.slice(-3).forEach((l, i) => {
    const seq = st.ledger.length - Math.min(3, st.ledger.length) + i + 1;
    const out = l.outcome === 'threw' ? `threw ${l.raised.tag}` : l.result === undefined ? 'went on' : typeof l.result === 'string' ? l.result : JSON.stringify(l.result);
    g.push(T(rx + 20, ry + 262 + i * 34, clip(`${seq} ${l.kind} ${l.desc}`, 48), 9.5));
    g.push(T(rx + 34, ry + 276 + i * 34, clip(out, 44), 9, { fill: l.outcome === 'threw' ? CAUTION : NORMAL }));
  });
  return g.join('');
}

/* -- callouts ----------------------------------------------------------------*/

function balloon(num, bx, by, ax, ay, r = 16) {
  const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy) || 1;
  return L(bx + (dx / d) * r, by + (dy / d) * r, ax, ay, { sw: 1.5 }) +
    `<circle cx="${n(ax)}" cy="${n(ay)}" r="3.5" fill="${INK}"/>` +
    `<circle cx="${n(bx)}" cy="${n(by)}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
    T(bx, by + 6, String(num), 17, { anchor: 'middle', w: 600 });
}
function letterBox(letter, bx, by) {
  return R(bx - 15, by - 15, 30, 30, { fill: PAPER, sw: 1.5 }) + T(bx, by + 7, letter, 18, { anchor: 'middle', w: 600 });
}

/** The regions this page has, numbered by the order the tour first names
 *  them, then the page's own order for the rest. */
function numbered(prog) {
  const has = r => r.name !== 'sheet' || prog.graphs.length > 1;
  const order = [];
  for (const s of G.tourStops(prog)) if (s && !order.includes(s.region.name)) order.push(s.region.name);
  for (const r of G.TOUR_REGIONS) if (!order.includes(r.name)) order.push(r.name);
  return order.map(name => G.tourRegion(name)).filter(has).map((r, i) => ({ ...r, num: i + 1 }));
}

function partsTable(px, py, w, head, rows, fs = 19) {
  const g = [];
  const cN = 70, cR = 230, cW = w - cN - cR;
  const chars = Math.floor((cW - 24) / (fs * MONO));
  g.push(R(px, py, w, 44, { sw: 2 }), T(px + 16, py + 29, head, 16, { w: 600, ls: 2 }));
  let yy = py + 44;
  g.push(R(px, yy, w, 32));
  [['NO.', px + 12], ['REGION', px + cN + 12], ['WHAT IT IS', px + cN + cR + 12]].forEach(([t, tx]) => g.push(T(tx, yy + 22, t, 13, { fill: ink(0.7), ls: 1.5 })));
  yy += 32;
  for (const [num, name, what] of rows) {
    const lines = wrap(what, chars);
    const h = 18 + lines.length * (fs + 7);
    g.push(R(px, yy, w, h));
    g.push(T(px + cN / 2, yy + fs + 8, num, fs, { anchor: 'middle', w: 600 }), T(px + cN + 12, yy + fs + 8, name, fs, { w: 600 }));
    lines.forEach((l, i) => g.push(T(px + cN + cR + 12, yy + fs + 8 + i * (fs + 7), l, fs)));
    yy += h;
  }
  g.push(L(px + cN, py + 44, px + cN, yy), L(px + cN + cR, py + 44, px + cN + cR, yy), R(px, py, w, yy - py, { sw: 2 }));
  return [g.join(''), yy];
}

function titleBlock(tx, ty, w, prog, dwg, sheetNo, subject) {
  const g = [];
  const h = 150;
  g.push(R(tx, ty, w, h, { fill: PAPER, sw: 2 }), L(tx, ty + 62, tx + w, ty + 62), L(tx, ty + 104, tx + w, ty + 104));
  g.push(L(tx + w * 0.5, ty + 104, tx + w * 0.5, ty + h), L(tx + w * 0.75, ty + 104, tx + w * 0.75, ty + h));
  g.push(T(tx + 16, ty + 26, 'GROUNDTRACK', 13, { fill: ink(0.7), ls: 2 }), T(tx + 16, ty + 52, subject, 22, { w: 600, ls: 1 }));
  g.push(T(tx + 16, ty + 80, 'DRAWN FROM', 11, { fill: ink(0.7), ls: 1.5 }), T(tx + 16, ty + 97, clip(`${prog.id} · its tour`, Math.floor((w - 32) / (15 * MONO))), 15));
  [['DWG NO.', dwg, 0], ['SCALE', 'NONE', 0.5], ['SHEET', sheetNo, 0.75]].forEach(([key, v, f]) => {
    g.push(T(tx + w * f + 16, ty + 122, key, 11, { fill: ink(0.7), ls: 1.5 }), T(tx + w * f + 16, ty + 142, v, 16, { w: 600 }));
  });
  return g.join('');
}

/* -- the hidden panes --------------------------------------------------------
 *
 * Every pane the page hides until a click gets a view: the files and contract
 * tabs, the tree, and each layer past the first. Drawn at 620 wide, from the
 * module, at the move sheet 1 shows. */

const VW = 600;
function viewHead(g, left, right) {
  g.push(T(16, 26, left, 14, { fill: ink(0.7), ls: 1.5 }));
  if (right) g.push(T(VW - 16, 26, right, 14, { anchor: 'end', w: 600, ls: 1.5 }));
  g.push(L(0, 40, VW, 40));
}
function viewFiles(snap, id) {
  const { prog } = snap;
  const g = [];
  viewHead(g, `CUTAWAY · ${clip(prog.nodes[id].name, 18)}`, 'FILES');
  const byPath = new Map((prog.files || []).map(f => [f.path, f]));
  const MARK = { new: 'NEW', edit: 'MODIFIED', delete: 'DELETED', forbidden: 'FORBIDDEN' };
  const row = (ry, path, indent) => {
    const f = byPath.get(path);
    const tag = f ? MARK[f.change] || f.change : '';
    g.push(T(16 + indent, ry, f ? `+${f.adds} −${f.dels}` : '', 15, { fill: ink(0.7) }));
    g.push(T(120 + indent, ry, clip(path.split('/').pop(), 24), 16, { w: 600 }));
    if (tag) g.push(R(VW - 26 - tag.length * 9.6 - 16, ry - 16, tag.length * 9.6 + 16, 22), T(VW - 26 - 8, ry, tag, 14, { anchor: 'end', ls: 1 }));
  };
  const fo = G.filesOf(snap.view, id);
  let yy = 70;
  for (const [head, list] of [['THIS NODE', fo.mine], ['OTHER NODES ON THIS SHEET', fo.others]]) {
    g.push(T(16, yy, head, 13, { fill: ink(0.7), ls: 1.5 }));
    yy += 28;
    if (!list.length) { g.push(T(32, yy, 'none', 15, { fill: ink(0.7) })); yy += 30; }
    for (const p of list.slice(0, 3)) { row(yy, p, 0); yy += 30; }
    yy += 8;
  }
  g.push(T(16, yy, 'EVERY FILE IN THE CHANGE', 13, { fill: ink(0.7), ls: 1.5 }));
  yy += 28;
  for (const r of G.fileTree((prog.files || []).map(f => f.path)).slice(0, 6)) {
    if (r.path) row(yy, r.path, r.depth * 18);
    else g.push(T(16 + r.depth * 18, yy, clip(r.label, 40), 16, { w: 600 }));
    yy += 30;
  }
  return [g.join(''), yy - 8];
}
/** The contract tab's paths line, in the page's words. */
function paths(node) {
  const cx = G.complexityOf(node);
  const parts = [];
  if (cx.ifs) parts.push(cx.ifs + ' if');
  if (cx.handlers) parts.push(cx.handlers + ' handler' + (cx.handlers === 1 ? '' : 's'));
  if (cx.loops) parts.push(cx.loops + ' loop' + (cx.loops === 1 ? '' : 's'));
  return String(cx.value) + (parts.length ? ' — 1 + ' + parts.join(' + ') : ' — one path through');
}
function viewContract(snap, id) {
  const node = snap.prog.nodes[id];
  const c = node.channels || {};
  const g = [];
  viewHead(g, `CUTAWAY · ${clip(node.name, 18)}`, 'CONTRACT');
  const rows = [
    ['role', node.role], ['takes', (node.params || []).join(', ') || 'nothing'], ['success', c.success || '—'],
    ['error', (c.error || []).join(' · ') || 'never'], ['requirements', (c.requirements || []).join(', ') || 'none'],
    ['entered by', (node.enteredBy || []).join(', ') || 'nothing in this change'], ['paths', paths(node)],
  ];
  let yy = 72;
  for (const [key, v] of rows) {
    g.push(T(16, yy, key.toUpperCase(), 13, { fill: ink(0.7), ls: 1.5 }));
    const lines = wrap(v, 32);
    lines.slice(0, 2).forEach((l, i) => g.push(T(200, yy + i * 22, l, 16)));
    yy += 14 + Math.min(lines.length, 2) * 22;
  }
  return [g.join(''), yy - 8];
}
function viewTree(snap) {
  const g = [];
  viewHead(g, 'VIEW', 'TREE');
  const rows = G.treeRows(snap.view, snap.preset.trace, null, snap.move, snap.states);
  let yy = 72;
  for (const row of rows.slice(0, 6)) {
    const dx = 16 + row.depth * 28;
    const hot = row.state === 'running';
    g.push(T(dx, yy, `${row.depth ? '→ ' : ''}${clip(row.name, 22)}`, 17, { w: 600, fill: hot ? CAUTION : INK }));
    g.push(T(VW - 16, yy, `${String(row.role).toUpperCase()} · ${row.state.toUpperCase()}`, 13, { anchor: 'end', fill: hot ? CAUTION : ink(0.7), ls: 1 }));
    yy += 24;
    const e = row.error.length ? row.error.join(' · ') : 'never';
    g.push(T(dx + 16, yy, clip(`success ${row.success || '—'} · error ${e}`, Math.floor((VW - dx - 32) / (14 * MONO))), 14, { fill: ink(0.8) }));
    yy += 34;
  }
  return [g.join(''), yy - 12];
}
function viewLayer(snap, name) {
  const { prog } = snap;
  const g = [];
  viewHead(g, 'LAYER', name.toUpperCase());
  const over = Object.entries((prog.layers[name] && prog.layers[name].nodes) || {});
  let yy = 72;
  if (!over.length) { g.push(T(16, yy, 'This layer renames no requirement.', 16, { fill: ink(0.7) })); yy += 30; }
  for (const [id, ov] of over.slice(0, 4)) {
    g.push(T(16, yy, clip(prog.nodes[id] ? prog.nodes[id].name : id, 30), 17, { w: 600 }));
    yy += 26;
    for (const r of (ov.requirements || []).slice(0, 2)) {
      wrap(`requirements ${r}`, 50).slice(0, 2).forEach(l => { g.push(T(32, yy, l, 15)); yy += 22; });
    }
    yy += 10;
  }
  return [g.join(''), yy - 6];
}

/* -- sheet 1 ---------------------------------------------------------------- */

/** The stop sheet 1 is drawn at: the one with the deepest call stack, and the
 *  later of any tie, because the deepest stack shows the most of the page at
 *  once. */
function showcase(prog, stops) {
  let best = null, depth = -1;
  for (const s of stops) {
    const snap = snapshot(prog, s);
    if (snap.st.frames.length >= depth) { best = snap; depth = snap.st.frames.length; }
  }
  return best;
}

function sheetOne(prog) {
  const stops = G.tourStops(prog).filter(Boolean);
  const snap = showcase(prog, stops);
  const regions = numbered(prog);
  const cursor = cursorOf(snap);
  const W = 1600;
  const k = 0.74, px = 110, py = 170;
  const m = (ux, uy) => [px + ux * k, py + uy * k];
  const box = name => REGION_BOX[name];
  const g = [];
  g.push(T(60, 84, 'GENERAL ARRANGEMENT AND VIEWS', 34, { w: 600, ls: 2 }));
  g.push(T(60, 118, clip(`FIG. 01 — ${snap.preset.name}, move ${snap.move} of ${snap.last}, and every pane the page hides until you click.`, 118), 18, { fill: ink(0.8) }));
  g.push(`<svg x="${px}" y="${py}" width="${PW * k}" height="${PH * k}" viewBox="0 0 ${PW} ${PH}">${drawPage(snap)}</svg>`);

  /* Callouts on the page, each in the margin nearest its region. */
  const pageRight = px + PW * k, pageBottom = py + PH * k;
  const onPage = regions.filter(r => !RAIL.has(r.name));
  const left = [], top = [], bottom = [], right = [];
  for (const r of onPage) {
    const [bxu, byu, bwu, bhu] = box(r.name);
    if (byu < 92 || r.name === 'tools') top.push(r);
    else if (byu >= 560) bottom.push(r);
    else if (bxu >= 660) right.push(r);
    else left.push(r);
    r.box = [bxu, byu, bwu, bhu];
  }
  top.forEach(r => { const [a, b] = m(r.box[0] + r.box[2] / 2, r.box[1]); g.push(balloon(r.num, a, py - 30, a, b)); });
  left.forEach(r => { const [a, b] = m(r.box[0] + 4, r.box[1] + r.box[3] * 0.45); g.push(balloon(r.num, px - 44, b, a, b)); });
  bottom.forEach((r, i) => { const [a, b] = m(r.box[0] + r.box[2] * (0.3 + i * 0.4), r.box[1] + r.box[3]); g.push(balloon(r.num, a, pageBottom + 34, a, b)); });
  right.forEach(r => { const [a, b] = m(r.box[0] + r.box[2] - 4, r.box[1] + r.box[3] / 2); g.push(balloon(r.num, pageRight + 34, b, a, b)); });

  /* The rail, cut on the page as A–A and drawn larger as view A. */
  const [rx0, ry0] = m(660, 196), [rx1, ry1] = m(1000, 560);
  g.push(L(rx1 + 12, ry0, rx1 + 12, ry1, { sw: 1.5, dash: '14 4 3 4' }));
  g.push(T(rx1 + 4, ry0 - 8, 'A', 20, { w: 600 }), T(rx1 + 4, ry1 + 22, 'A', 20, { w: 600 }));

  /* Hidden panes: a dashed ring on the control that opens each, and its
   * view's letter. */
  const views = [];
  const letters = 'BCDEFGH';
  const ring = (ux, uy, rxu, letter, bx, by) => {
    const [a, b] = m(ux, uy);
    const rr = rxu * k;
    g.push(`<ellipse cx="${n(a)}" cy="${n(b)}" rx="${n(rr)}" ry="9" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    const dx = bx - a, dy = by - b, d = Math.hypot(dx, dy) || 1;
    g.push(L(a + (dx / d) * rr, b + (dy / d) * 9, bx - (dx / d) * 15, by - (dy / d) * 15, { sw: 1.5 }), letterBox(letter, bx, by));
  };
  const add = (title, sub, fn) => { const letter = letters[views.length]; views.push({ letter, title, sub, fn }); return letter; };
  if (snap.prog.files) {
    const L1 = add('FILES TAB', 'Hidden until you click FILES. Every file the change touches.', () => viewFiles(snap, cursor.id));
    ring(535, 435, 18, L1, ...m(520, 392));
  }
  const L2 = add('CONTRACT TAB', 'Hidden until you click CONTRACT. What the node declares.', () => viewContract(snap, cursor.id));
  ring(592, 435, 24, L2, ...m(600, 392));
  const L3 = add('TREE VIEW', 'Hidden until you click TREE. The same graph as rows.', () => viewTree(snap));
  const layerNames = Object.keys(snap.prog.layers || {});
  ring(796, 156, 16, L3, pageRight + 44, m(0, 156)[1] + 20);
  layerNames.slice(1).forEach((ln, i) => {
    const Ln = add(`${ln.toUpperCase()} LAYER`, `Hidden until you click ${ln.toUpperCase()}. What it renames.`, () => viewLayer(snap, ln));
    ring(752 + (layerNames[0].length + 3) * 5.1 + 12, 134, 16, Ln, pageRight + 44 + i * 36, m(0, 134)[1] - 20);
  });

  /* Views, stacked down the right. */
  const vx = 960;
  let vy = 170;
  const viewTitle = (letter, head, sub) => {
    g.push(letterBox(letter, vx + 15, vy + 2), T(vx + 44, vy + 9, head, 20, { w: 600, ls: 1.5 }));
    wrap(sub, 48).forEach((l, i) => g.push(T(vx + 44, vy + 36 + i * 22, l, 17, { fill: ink(0.8) })));
    vy += 36 + wrap(sub, 48).length * 22 + 8;
  };
  {
    viewTitle('A', `VIEW A — THE RAIL AT MOVE ${snap.move}`, `Run "${clip(snap.preset.name, 30)}". Everything in it is read off the trace at this move.`);
    const vk = 1.5, sw = 340, sh = 364;
    g.push(`<svg x="${vx}" y="${vy}" width="${sw * vk}" height="${sh * vk}" viewBox="660 196 ${sw} ${sh}">${R(660, 196, sw, sh, { fill: PAPER, stroke: null })}${railPart(snap, 660, 196)}</svg>`);
    g.push(R(vx, vy, sw * vk, sh * vk, { sw: 2 }));
    for (const r of regions.filter(q => RAIL.has(q.name))) {
      const [, byu, , bhu] = REGION_BOX[r.name];
      const cy = vy + (byu - 196 + Math.min(bhu, 40) / 2) * vk;
      g.push(balloon(r.num, vx + sw * vk + 36, cy, vx + sw * vk - 6, cy));
    }
    vy += sh * vk + 56;
  }
  for (const v of views) {
    viewTitle(v.letter, `VIEW ${v.letter} — ${v.title}`, v.sub);
    const [svg, h] = v.fn();
    g.push(`<g transform="translate(${vx} ${n(vy)})">${R(0, 0, VW, h, { fill: PAPER, stroke: null })}${svg}</g>`, R(vx, vy, VW, h, { sw: 2 }));
    vy += h + 56;
  }

  /* Left column under the page: what each number is, what each letter is. */
  const [pl, pend] = partsTable(60, pageBottom + 90, 820, 'PARTS LIST — THE REGIONS OF THE PAGE', regions.map(r => [String(r.num), r.label, r.what]));
  const [vl, vend] = partsTable(60, pend + 40, 820, 'VIEWS — WHAT THE PAGE HIDES', [
    ['A', 'the rail', 'Call stack, arguments, error path and effects, at one move of one run.'],
    ...views.map(v => [v.letter, v.title.toLowerCase(), v.sub]),
  ]);
  g.push(pl, vl);
  const H = Math.max(vy, vend + 230) + 30;
  g.push(titleBlock(60, H - 200, 820, snap.prog, `${snap.prog.id}-1`, '1 OF 2', 'THE PAGE AND ITS VIEWS'));
  return sheet(W, H, `${snap.prog.title} — the page and its views`, g.join(''));
}

/* -- sheet 2 ---------------------------------------------------------------- */

/** The stops sheet 2 draws: each one that moves the cursor — its run or its
 *  move differs from the stop before it — and no more than six. A stop that
 *  only turns to another region at the same move is the same picture. */
function walkStops(stops) {
  const out = [];
  let prev = null;
  for (const s of stops) {
    if (!prev || s.graphIndex !== prev.graphIndex || s.runIndex !== prev.runIndex || s.move !== prev.move) out.push(s);
    prev = s;
  }
  return out.slice(0, 6);
}

function sheetTwo(prog) {
  const all = G.tourStops(prog).filter(Boolean);
  const stops = walkStops(all);
  const W = 1600;
  const k = 0.68, fw = PW * k, fh = PH * k;
  const g = [];
  g.push(T(60, 84, 'THE WALK — THE TOUR, STOP BY STOP', 34, { w: 600, ls: 2 }));
  g.push(T(60, 118, `FIG. 02 — the ${stops.length} stops of the tour that move the cursor. Framed: the region each one explains.`, 18, { fill: ink(0.8) }));
  let y = 160;
  let rowH = 0;
  stops.forEach((s, i) => {
    const col = i % 2;
    if (col === 0 && i) { y += rowH; rowH = 0; }
    const fx = 60 + col * (fw + 100);
    const snap = snapshot(prog, s);
    g.push(`<svg x="${fx}" y="${y}" width="${n(fw)}" height="${n(fh)}" viewBox="0 0 ${PW} ${PH}">${drawPage(snap)}</svg>`);
    const [bxu, byu, bwu, bhu] = REGION_BOX[s.region.name];
    g.push(R(fx + bxu * k - 3, y + byu * k - 3, bwu * k + 6, bhu * k + 6, { stroke: CAUTION, sw: 3 }));
    const cy = y + fh + 34;
    g.push(`<circle cx="${fx + 18}" cy="${cy}" r="17" fill="${INK}"/>`, T(fx + 18, cy + 6, String(all.indexOf(s) + 1), 17, { anchor: 'middle', w: 600, fill: PAPER }));
    const head = `STOP ${all.indexOf(s) + 1} · ${s.region.label.toUpperCase()} · ${clip(prog.graphs[s.graphIndex].presets[s.runIndex].name, 24).toUpperCase()} · MOVE ${s.move}`;
    g.push(T(fx + 48, cy - 2, clip(head, 52), 15, { w: 600, ls: 1 }));
    const lines = wrap(s.now, Math.floor((fw - 48) / (19 * MONO))).slice(0, 4);
    lines.forEach((l, j) => g.push(T(fx + 48, cy + 26 + j * 26, l, 19)));
    if (col === 0 && i + 1 < stops.length) g.push(`<path d="M${fx + fw + 24} ${y + fh / 2} h52 m-10 -8 l10 8 l-10 8" stroke="${INK}" stroke-width="2" fill="none"/>`);
    rowH = Math.max(rowH, fh + 60 + lines.length * 26 + 40);
  });
  y += rowH;
  const H = y + 190;
  g.push(titleBlock(W - 60 - 620, H - 190, 620, prog, `${prog.id}-2`, '2 OF 2', 'THE TOUR, WALKED'));
  return sheet(W, H, `${prog.title} — the tour, walked`, g.join(''));
}

/* -- the command line ------------------------------------------------------- */

const [file, dir] = process.argv.slice(2);
if (!file || !dir) {
  console.error('usage: node scripts/groundtrack-sheets.mjs <topic>.flightpath.json <dir>');
  process.exit(2);
}
/* The renderer is the format, so it validates. A sheet drawn from a file it
 * would refuse would draw a page that cannot exist. */
const checked = spawnSync(process.execPath, [resolve(skill, 'scripts', 'render.mjs'), file, '--check'], { encoding: 'utf8' });
if (checked.status !== 0) {
  process.stderr.write(checked.stderr);
  process.exit(checked.status || 1);
}
const prog = G.hardenKeys(JSON.parse(readFileSync(file, 'utf8')));
if (!prog.tour) {
  console.error(`${file}: this file carries no tour, and the sheets are drawn from it. Write the tour first — see the tour section of skills/groundtrack/references/flightpath-file.md.`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
for (const [name, svg] of [[`${prog.id}-sheet-1.svg`, sheetOne(prog)], [`${prog.id}-sheet-2.svg`, sheetTwo(prog)]]) {
  const target = resolve(dir, name);
  writeFileSync(target, svg);
  console.error(`wrote ${target}`);
}
