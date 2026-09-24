#!/usr/bin/env node
// The two sheets eagle-eye's README shows, drawn from a box file and its tour,
// so the picture says what the page says. This repository's tool, not the
// skill's: it ships to no install.
//
//   node scripts/eagle-eye-sheets.mjs <box.json> <dir>
//
//   sheet 1  the page at the tour's break test — one option changed — with a
//            numbered callout on every region, and a view of every pane the
//            page hides until a click: the option cards, the sheet, export,
//            and coach's prediction
//   sheet 2  the tour's walk: each stop that changes the page, framed
//
// It writes <name>-sheet-1.svg and <name>-sheet-2.svg into <dir>, <name> being
// the box file's name without .box.json. The box is validated by the renderer
// first, and a box with no tour is refused, because both sheets are drawn from
// it. Nothing checks the committed sheets are current; docs/brand/README.md
// says when to redraw them.
//
// The verdict, the findings and every coloured state are the module's
// analyse(), read rather than copied, so the drawing cannot disagree with the
// page about what a configuration means.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { INK, PAPER, CAUTION, NORMAL, ink, n, T, R, L, wrap, clip, MONO, sheet, balloon, letterBox, partsTable, titleBlock } from './lib/drafting.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, '..', 'skills', 'eagle-eye');
const E = createRequire(import.meta.url)(resolve(skill, 'lib', 'eagle-eye.js'));
const ASSETS = resolve(skill, 'assets');

const strip = s => { let p, o = String(s); do { p = o; o = o.replace(/<[^>]+>/g, ''); } while (o !== p); return o; };
const TONE = { 'does not hold': CAUTION, incomplete: CAUTION, consistent: NORMAL, 'as chosen': INK };

/* -- a page state ----------------------------------------------------------
 *
 * A stop states its whole page: the chosen set with its `set` swapped in, the
 * row it opens, and the view. Anything else is the default. */
function snapshot(box, stop) {
  const { optById, chosenOf } = E.index(box);
  const sel = { ...chosenOf }, touched = new Set();
  for (const [d, o] of Object.entries(stop.set || {})) if (Object.hasOwn(optById, o) && optById[o].dim.id === d) { sel[d] = o; touched.add(d); }
  if (stop.open) touched.add(stop.open);
  return { box, sel, optById, chosenOf, open: stop.open || null, view: stop.view || 'findings', r: E.analyse(box, sel, touched), stop };
}
const S = (snap, id) => snap.optById[id].short || snap.optById[id].label;
const ref = (box, d) => String(box.dims.indexOf(d) + 1).padStart(2, '0');

/* -- the page, drawn at 1000 × 680 in its own units ------------------------
 *
 * Returns the drawing and the box of every region in it, so a callout or a
 * tour frame lands on the part of the drawing the page's element would be. */
const PW = 1000, PH = 680;
function drawPage(snap) {
  const { box, sel, chosenOf, r } = snap;
  const g = [], boxes = {};
  const lbl = (tx, ty, t, o = {}) => T(tx, ty, t.toUpperCase(), 8.5, { fill: ink(0.7), ls: 1.4, ...o });
  const chip = (cx, t, on) => {
    const w = t.length * 5.6 + 16;
    g.push(R(cx, 58, w, 22, { fill: on ? INK : PAPER, stroke: on ? INK : ink(0.3) }), T(cx + w / 2, 72.5, t.toUpperCase(), 8.5, { anchor: 'middle', ls: 1, fill: on ? PAPER : INK }));
    return w;
  };
  g.push(R(0, 0, PW, PH, { fill: PAPER, sw: 2 }));

  /* the head */
  g.push(R(14, 12, 30, 30, { fill: INK }));
  g.push(lbl(54, 22, clip(box.eyebrow || `Morphological box · ${box.dims.length} decisions`, 80)));
  g.push(T(54, 42, clip(box.title, 60), 16, { w: 600 }));
  let cx = 14;
  const group = (name, label, items) => {
    const x0 = cx;
    if (label) { g.push(lbl(cx, 73, label)); cx += label.length * 6.2 + 10; }
    for (const [t, on] of items) cx += chip(cx, t, on) + 5;
    boxes[name] = [x0 - 3, 54, cx - x0 + 1, 30];
    cx += 14;
  };
  group('views', 'view', [['Findings', snap.view === 'findings'], ['Sheet', snap.view === 'sheet']]);
  const px0 = cx;
  g.push(lbl(cx, 73, 'presets')); cx += 60;
  for (const p of box.presets.slice(0, 4)) cx += chip(cx, clip(p.title, 14), false) + 5;
  cx += chip(cx, 'Free', false) + 5;
  boxes.presets = [px0 - 3, 54, cx - px0 + 1, 30]; cx += 14;
  group('coach', '', [['Coach: off', false]]);
  group('export', '', [['Export', false]]);
  group('reset', '', [['Reset', false]]);
  g.push(R(PW - 90, 58, 44, 22, { stroke: ink(0.3) }), T(PW - 68, 72.5, 'TOUR', 8.5, { anchor: 'middle', ls: 1 }));
  g.push(R(PW - 40, 58, 26, 22, { stroke: ink(0.3) }), T(PW - 27, 73.5, '☾', 11, { anchor: 'middle' }));
  g.push(L(0, 92, PW, 92, { sw: 1.5 }));

  if (snap.view === 'sheet') {
    /* the sheet: every decision a row, every option a column */
    const cols = Math.max(...box.dims.map(d => d.opts.length));
    const cw = (PW - 20 - 36 - 210) / cols, rh = Math.min(38, (PH - 150) / (box.dims.length + 1));
    const gx = 10, gy = 104;
    ['REF', 'DECISION', ...Array.from({ length: cols }, (_, i) => String.fromCharCode(65 + i))].forEach((h, i) => {
      g.push(lbl(i === 0 ? gx : i === 1 ? gx + 36 : gx + 246 + (i - 2) * cw + 6, gy + 14, h));
    });
    box.dims.forEach((d, i) => {
      const y = gy + rh * (i + 1);
      g.push(L(gx, y, PW - 10, y, { stroke: ink(0.12) }));
      g.push(T(gx, y + rh * 0.62, ref(box, d), 9, { fill: ink(0.7) }), T(gx + 36, y + rh * 0.62, clip(d.name, 32), 9.5, { w: 500 }));
      d.opts.forEach((o, j) => {
        const x = gx + 246 + j * cw;
        const selected = sel[d.id] === o.id, chosen = chosenOf[d.id] === o.id;
        const conf = selected && r.conflicts.some(e => e.from === o.id || e.to === o.id);
        const out = !selected && r.overrides.length && r.closed.has(o.id);
        if (selected) g.push(R(x + 2, y + 3, cw - 6, rh - 6, { stroke: conf ? CAUTION : INK, sw: conf || !chosen ? 2 : 1.5 }));
        g.push(T(x + 8, y + rh * 0.62, clip(S(snap, o.id), Math.floor((cw - 14) / 5.4)) + (selected && !chosen ? ' ←' : ''), 9, { fill: out ? ink(0.3) : INK }));
      });
    });
    boxes.sheet = [gx - 4, gy, PW - 12, rh * (box.dims.length + 1) + 6];
    return { svg: g.join(''), boxes };
  }

  /* the index: one row a decision, its selected option, and its dot */
  const rh = Math.min(38, (PH - 150) / box.dims.length);
  box.dims.forEach((d, i) => {
    const y = 96 + i * rh;
    const id = sel[d.id], over = id !== chosenOf[d.id];
    if (snap.open === d.id) g.push(R(0, y, 330, rh, { fill: ink(0.1), stroke: null }));
    g.push(T(14, y + rh * 0.62, ref(box, d), 8.5, { fill: ink(0.7) }));
    g.push(T(40, y + rh * 0.62, clip(d.name, 22), 9.5, { w: 500 }), T(40 + Math.min(d.name.length, 22) * 5.8 + 6, y + rh * 0.62, clip(`· ${S(snap, id)}${over ? ' ←' : ''}`, Math.max(4, 26 - Math.min(d.name.length, 22) / 2)), 9, { fill: ink(0.7) }));
    const bad = r.conflicts.some(e => e.from === id || e.to === id) || r.unmet.some(e => snap.optById[e.to].dim.id === d.id);
    const good = !bad && r.overrides.length && r.met.some(e => e.to === id);
    if (bad || good) g.push(`<circle cx="318" cy="${n(y + rh / 2)}" r="4" fill="${bad ? CAUTION : NORMAL}"/>`);
    g.push(L(0, y + rh, 330, y + rh, { stroke: ink(0.12) }));
  });
  g.push(T(14, PH - 14, '● conflict or requirement not met   ● requirement met   ← changed', 8, { fill: ink(0.7) }));
  g.push(`<circle cx="17" cy="${PH - 17}" r="3.5" fill="${CAUTION}"/>`, `<circle cx="${14 + 34 * 5.1}" cy="${PH - 17}" r="3.5" fill="${NORMAL}"/>`);
  boxes.index = [0, 92, 330, PH - 92];
  g.push(L(330, 92, 330, PH, { sw: 1.5 }));

  /* the verdict */
  const changes = r.overrides.length;
  g.push(lbl(348, 114, `Verdict for the selected options · ${changes} change${changes === 1 ? '' : 's'}`));
  g.push(T(348, 132, changes ? `Active edges: ${r.basis.map(([t, k]) => `${k} ${t}`).join(' · ')}` : 'No option changed. Nobody tested the chosen set.', 9, { fill: ink(0.7) }));
  const vw = r.verdict.length * 7.2 + 24;
  g.push(R(PW - 18 - vw, 104, vw, 30, { stroke: TONE[r.verdict], sw: 2 }), T(PW - 18 - vw / 2, 124, r.verdict.toUpperCase(), 11, { anchor: 'middle', w: 600, ls: 1.4, fill: TONE[r.verdict] }));
  boxes.verdict = [330, 92, 670, 56];
  g.push(L(330, 148, PW, 148, { stroke: ink(0.3) }));

  if (snap.open) {
    /* the open row: every option as a card */
    const d = box.dims.find(q => q.id === snap.open);
    g.push(lbl(348, 170, `Row ${ref(box, d)} · ${d.opts.length} options`), T(348, 192, clip(d.name, 44), 15, { w: 600 }));
    const cw = 314, ch = d.opts.length > 2 ? 225 : 300;
    d.opts.slice(0, 4).forEach((o, j) => {
      const x = 348 + (j % 2) * (cw + 8), y = 206 + Math.floor(j / 2) * (ch + 8);
      const selected = sel[d.id] === o.id, chosen = chosenOf[d.id] === o.id;
      g.push(R(x, y, cw, ch, { stroke: selected ? INK : ink(0.3), sw: selected ? 2 : 1 }));
      g.push(lbl(x + 10, y + 16, o.strawman ? 'strawman' : chosen ? 'chosen' : selected ? 'your change' : 'option'));
      wrap(o.label, 50).slice(0, 2).forEach((l, k) => g.push(T(x + 10, y + 34 + k * 14, l, 10, { w: 600 })));
      const what = E.analyse(box, { ...sel, [d.id]: o.id });
      g.push(lbl(x + 10, y + 74, selected ? 'Verdict with this option' : 'Verdict if you pick it'), T(x + cw - 10, y + 74, what.verdict.toUpperCase(), 8.5, { anchor: 'end', w: 600, fill: TONE[what.verdict], ls: 1 }));
      const edges = ((box.rel[o.id] && box.rel[o.id].rel) || []).filter(([to]) => snap.optById[to] && snap.optById[to].dim.id !== d.id);
      let yy = y + 94;
      for (const [to, kind] of edges.slice(0, ch > 250 ? 6 : 4)) {
        g.push(`<circle cx="${x + 14}" cy="${n(yy - 3)}" r="3" fill="${kind === 'conf' ? CAUTION : NORMAL}"/>`);
        g.push(T(x + 22, yy, clip(`${kind === 'conf' ? 'Rules out' : 'Requires'} ${snap.optById[to].dim.name}: ${S(snap, to)}`, 52), 8.5));
        yy += 16;
      }
      if (!edges.length) g.push(T(x + 10, yy, 'No edges: independent, or one is missing.', 8.5, { fill: ink(0.7) }));
    });
    boxes.cards = [340, 200, 652, Math.min(PH - 206, (d.opts.length > 2 ? 2 : 1) * (ch + 8) + 4)];
    return { svg: g.join(''), boxes };
  }

  /* the brief */
  const top = 172;
  g.push(lbl(348, top, changes ? 'Options you changed' : 'Start here'));
  g.push(T(348, top + 22, clip(changes ? r.overrides.map(id => S(snap, id)).join(' + ') : `${box.dims.length} rows, one chosen option in each`, 56), 15, { w: 600 }));
  const brief = wrap(box.problem, 104).slice(0, 3);
  brief.forEach((l, k) => g.push(T(348, top + 44 + k * 15, l + (k === 2 && wrap(box.problem, 104).length > 3 ? ' …' : ''), 9, { fill: ink(0.8) })));
  boxes.start = [340, top - 14, 652, 44 + brief.length * 15 + 6];

  /* the findings */
  const finds = [
    ...r.conflicts.map(e => ['conflict', `${snap.optById[e.from].dim.name}: ${S(snap, e.from)} vs ${snap.optById[e.to].dim.name}: ${S(snap, e.to)}. ${e.why}`, true]),
    ...r.unmet.map(e => ['requirement not met', `${S(snap, e.from)} requires ${S(snap, e.to)}. ${e.why}`, true]),
    ...r.moves.map(m => [m.kind, strip(m.text), false]),
  ];
  let fy = boxes.start[1] + boxes.start[3] + 18;
  const f0 = fy - 12;
  finds.forEach(([tag, text, caution], k) => {
    const lines = wrap(`${tag}. ${text}`, 92).slice(0, 2);
    if (fy + lines.length * 13 > PH - 8) return;
    g.push(T(348, fy, `FIND ${String(k + 1).padStart(2, '0')}`, 8, { w: 600, ls: 1.2, fill: caution ? CAUTION : INK }));
    lines.forEach((l, j) => g.push(T(408, fy + j * 13, l + (j === 1 && wrap(`${tag}. ${text}`, 92).length > 2 ? ' …' : ''), 9, j === 0 ? { w: 500 } : {})));
    fy += lines.length * 13 + 10;
  });
  if (!finds.length) { g.push(T(348, fy, 'No findings for this set.', 9, { fill: ink(0.7) })); fy += 16; }
  boxes.findings = [340, f0, 652, Math.min(PH - 4, fy) - f0];
  return { svg: g.join(''), boxes };
}

/* -- callouts --------------------------------------------------------------- */

/** The regions, numbered by the order the tour first names them, then the
 *  module's order for the rest. */
function numbered(box) {
  const order = [];
  for (const s of box.tour) if (!order.includes(s.region)) order.push(s.region);
  for (const r of E.TOUR_REGIONS) if (!order.includes(r.name)) order.push(r.name);
  return order.map(name => E.tourRegion(name)).map((r, i) => ({ ...r, num: i + 1 }));
}

/* -- the hidden panes -------------------------------------------------------- */

const VW = 600;
function panel(g, head, lines) {
  g.push(T(16, 26, head, 14, { fill: ink(0.7), ls: 1.5 }), L(0, 40, VW, 40));
  let y = 70;
  for (const [text, o = {}] of lines) {
    for (const l of wrap(text, Math.floor((VW - 32) / ((o.size || 16) * MONO)))) { g.push(T(16, y, l, o.size || 16, o)); y += (o.size || 16) + 8; }
    y += 6;
  }
  return y;
}
function viewExport(snap) {
  const { box, r, sel, chosenOf } = snap;
  const code = box.dims.filter(d => sel[d.id] !== chosenOf[d.id]).map(d => sel[d.id]).join(', ') || 'none';
  const g = [];
  const h = panel(g, 'PASTE THIS TO THE AGENT', [
    [`eagle-eye: ${code}`, { w: 600, size: 17 }],
    [`## eagle-eye · ${box.title} · ${r.overrides.length} change${r.overrides.length === 1 ? '' : 's'} · ${r.verdict}`, { size: 14 }],
    ['| # | Decision | Chosen | My choice |', { size: 14, fill: ink(0.8) }],
    ...box.dims.filter(d => sel[d.id] !== chosenOf[d.id]).slice(0, 2).map(d => [`| ${ref(box, d)} | ${d.name} | ${S(snap, chosenOf[d.id])} | **${S(snap, sel[d.id])}** |`, { size: 14, fill: ink(0.8) }]),
  ]);
  return [g.join(''), h];
}
function viewCoach(snap) {
  const d = snap.box.dims.find(q => snap.sel[q.id] !== snap.chosenOf[q.id]) || snap.box.dims[0];
  const g = [];
  const h = panel(g, 'COACH · PREDICT, THEN REVEAL', [
    [`You changed ${d.name} to “${S(snap, snap.sel[d.id])}”. Which rows does this change affect? Click those rows in the index. Then click Reveal.`, {}],
    ['The index shows no colours, and the findings stay hidden until you predict.', { fill: ink(0.8), size: 15 }],
  ]);
  g.push(R(16, h, 90, 30, { fill: INK }), T(61, h + 20, 'REVEAL', 13, { anchor: 'middle', fill: PAPER, ls: 1.2 }), R(114, h, 70, 30, { stroke: ink(0.3) }), T(149, h + 20, 'SKIP', 13, { anchor: 'middle', ls: 1.2 }));
  return [g.join(''), h + 46];
}

/* -- sheet 1 ---------------------------------------------------------------- */

/** The stop sheet 1 is drawn at: the tour's break test — the first stop that
 *  changes an option and shows the findings with no row open — else the first
 *  stop. It shows the verdict move and the findings that explain it. */
function showcase(box) {
  const s = box.tour.find(t => t.set && Object.keys(t.set).length && !t.open && (t.view || 'findings') === 'findings') || box.tour[0];
  return snapshot(box, s);
}

function sheetOne(box, name) {
  const snap = showcase(box);
  const { svg, boxes } = drawPage(snap);
  const regions = numbered(box);
  const W = 1600, k = 0.74, px = 110, py = 190;
  const m = (ux, uy) => [px + ux * k, py + uy * k];
  const g = [];
  g.push(T(60, 84, 'GENERAL ARRANGEMENT AND VIEWS', 34, { w: 600, ls: 2 }));
  g.push(T(60, 118, clip(`FIG. 01 — ${box.title}, with ${r1(snap)}, and every pane the page hides until you click.`, 118), 18, { fill: ink(0.8) }));
  g.push(`<svg x="${px}" y="${py}" width="${PW * k}" height="${PH * k}" viewBox="0 0 ${PW} ${PH}">${svg}</svg>`);
  const pageRight = px + PW * k;

  /* Callouts on the page: the controls above it, the index on its left, the
   * right pane's parts on its right. The cards and the sheet are views. */
  const placed = new Set();
  for (const r of regions) {
    const b = boxes[r.name];
    if (!b) continue;
    placed.add(r.name);
    if (b[1] < 92) { const [a, y] = m(b[0] + b[2] / 2, b[1]); g.push(balloon(r.num, a, py - 34, a, y)); }
    else if (b[0] < 330) { const [a, y] = m(b[0] + 6, b[1] + 40); g.push(balloon(r.num, px - 44, y, a, y)); }
    else { const [a, y] = m(b[0] + b[2] - 4, b[1] + Math.min(b[3], 60) / 2); g.push(balloon(r.num, pageRight + 36, y, a, y)); }
  }

  /* Views, stacked down the right. */
  const vx = 960;
  let vy = 170;
  const views = [];
  const cardsStop = box.tour.find(t => t.region === 'cards') || { region: 'cards', open: box.dims[0].id };
  views.push({ letter: 'A', title: 'OPTION CARDS', sub: 'Hidden until you open a row. Every option in it, with its edges.', region: 'cards', crop: () => {
    const s = snapshot(box, { ...cardsStop, view: 'findings' });
    const p = drawPage(s);
    return { svg: p.svg, view: [330, 150, 670, 530] };
  } });
  views.push({ letter: 'B', title: 'THE SHEET', sub: 'Hidden until you click Sheet. The same set as one grid.', region: 'sheet', crop: () => {
    const p = drawPage({ ...snap, view: 'sheet' });
    return { svg: p.svg, view: [0, 92, 1000, 588] };
  } });
  views.push({ letter: 'C', title: 'EXPORT', sub: 'Hidden until you click Export. One line to paste back to the agent.', panel: () => viewExport(snap) });
  views.push({ letter: 'D', title: 'COACH', sub: 'Hidden until Coach is on and you change an option.', panel: () => viewCoach(snap) });
  for (const v of views) {
    g.push(letterBox(v.letter, vx + 15, vy + 2), T(vx + 44, vy + 9, `VIEW ${v.letter} — ${v.title}`, 20, { w: 600, ls: 1.5 }));
    const subs = wrap(v.sub, 48);
    subs.forEach((l, i) => g.push(T(vx + 44, vy + 36 + i * 22, l, 17, { fill: ink(0.8) })));
    vy += 36 + subs.length * 22 + 8;
    if (v.crop) {
      const { svg: s, view: [x0, y0, w0, h0] } = v.crop();
      const vk = VW / w0, hh = h0 * vk;
      g.push(`<svg x="${vx}" y="${vy}" width="${VW}" height="${n(hh)}" viewBox="${x0} ${y0} ${w0} ${h0}">${s}</svg>`, R(vx, vy, VW, hh, { sw: 2 }));
      const r = regions.find(q => q.name === v.region);
      if (r) g.push(balloon(r.num, vx - 40, vy + 30, vx + 4, vy + 30));
      vy += hh + 56;
    } else {
      const [s, h] = v.panel();
      g.push(`<g transform="translate(${vx} ${n(vy)})">${R(0, 0, VW, h, { fill: PAPER, stroke: null })}${s}</g>`, R(vx, vy, VW, h, { sw: 2 }));
      vy += h + 56;
    }
  }

  const pageBottom = py + PH * k;
  const [pl, pend] = partsTable(60, pageBottom + 60, 820, 'PARTS LIST — THE REGIONS OF THE PAGE', regions.map(r => [String(r.num), r.label, r.what]));
  const [vl, vend] = partsTable(60, pend + 40, 820, 'VIEWS — WHAT THE PAGE HIDES', views.map(v => [v.letter, v.title.toLowerCase(), v.sub]));
  g.push(pl, vl);
  const H = Math.max(vy, vend + 230) + 30;
  g.push(titleBlock(60, H - 200, 820, { kicker: 'EAGLE-EYE', subject: 'THE PAGE AND ITS VIEWS', from: `${name} · its tour`, dwg: `${name}-1`, sheetNo: '1 OF 2' }));
  return sheet(W, H, `${box.title} — the page and its views`, g.join(''), ASSETS);
}
function r1(snap) {
  const c = snap.r.overrides;
  return c.length ? `${c.map(id => S(snap, id)).join(' + ')} swapped in: ${snap.r.verdict}` : `the chosen set: ${snap.r.verdict}`;
}

/* -- sheet 2 ---------------------------------------------------------------- */

/** The stops sheet 2 draws: each one that changes the page — its options, its
 *  open row or its view differ from the stop before — and no more than six. A
 *  stop that only turns to another region of the same page is the same
 *  picture. */
function walkStops(box) {
  const out = [];
  let prev = null;
  box.tour.forEach((s, i) => {
    const key = JSON.stringify([s.set || {}, s.open || null, s.view || 'findings']);
    if (key !== prev) out.push({ s, i });
    prev = key;
  });
  return out.slice(0, 6);
}

function sheetTwo(box, name) {
  const stops = walkStops(box);
  const W = 1600, k = 0.68, fw = PW * k, fh = PH * k;
  const g = [];
  g.push(T(60, 84, 'THE WALK — THE TOUR, STOP BY STOP', 34, { w: 600, ls: 2 }));
  g.push(T(60, 118, `FIG. 02 — the ${stops.length} stops of the tour that change the page. Framed: the region each one explains.`, 18, { fill: ink(0.8) }));
  let y = 160, rowH = 0;
  stops.forEach(({ s, i }, j) => {
    const col = j % 2;
    if (col === 0 && j) { y += rowH; rowH = 0; }
    const fx = 60 + col * (fw + 100);
    const snap = snapshot(box, s);
    const { svg, boxes } = drawPage(snap);
    g.push(`<svg x="${fx}" y="${y}" width="${n(fw)}" height="${n(fh)}" viewBox="0 0 ${PW} ${PH}">${svg}</svg>`);
    const b = boxes[s.region];
    if (b) g.push(R(fx + b[0] * k - 3, y + b[1] * k - 3, b[2] * k + 6, b[3] * k + 6, { stroke: CAUTION, sw: 3 }));
    const cy = y + fh + 34;
    const region = E.tourRegion(s.region);
    g.push(`<circle cx="${fx + 18}" cy="${cy}" r="17" fill="${INK}"/>`, T(fx + 18, cy + 6, String(i + 1), 17, { anchor: 'middle', w: 600, fill: PAPER }));
    g.push(T(fx + 48, cy - 2, clip(`STOP ${i + 1} · ${region.label.toUpperCase()} · ${snap.r.verdict.toUpperCase()}`, 52), 15, { w: 600, ls: 1 }));
    const lines = wrap(s.now, Math.floor((fw - 48) / (19 * MONO))).slice(0, 4);
    lines.forEach((l, q) => g.push(T(fx + 48, cy + 26 + q * 26, l, 19)));
    if (col === 0 && j + 1 < stops.length) g.push(`<path d="M${fx + fw + 24} ${y + fh / 2} h52 m-10 -8 l10 8 l-10 8" stroke="${INK}" stroke-width="2" fill="none"/>`);
    rowH = Math.max(rowH, fh + 60 + lines.length * 26 + 40);
  });
  y += rowH;
  const H = y + 190;
  g.push(titleBlock(W - 60 - 620, H - 190, 620, { kicker: 'EAGLE-EYE', subject: 'THE TOUR, WALKED', from: `${name} · its tour`, dwg: `${name}-2`, sheetNo: '2 OF 2' }));
  return sheet(W, H, `${box.title} — the tour, walked`, g.join(''), ASSETS);
}

/* -- the command line ------------------------------------------------------- */

const [file, dir] = process.argv.slice(2);
if (!file || !dir) {
  console.error('usage: node scripts/eagle-eye-sheets.mjs <box.json> <dir>');
  process.exit(2);
}
/* The renderer is the format, so it validates. It prints warnings on stderr
 * and exits 1 on an error; only the exit code is read. */
const checked = spawnSync(process.execPath, [resolve(skill, 'render.mjs'), file, '--check'], { encoding: 'utf8' });
if (checked.status !== 0) {
  process.stderr.write(checked.stderr);
  process.exit(checked.status || 1);
}
const box = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(box.tour) || !box.tour.length) {
  console.error(`${file}: this box carries no tour, and the sheets are drawn from it. Write the tour first — see "The tour" in skills/eagle-eye/SKILL.md.`);
  process.exit(1);
}
const name = basename(file).replace(/\.box\.json$/, '').replace(/\.json$/, '');
mkdirSync(dir, { recursive: true });
for (const [out, svg] of [[`${name}-sheet-1.svg`, sheetOne(box, name)], [`${name}-sheet-2.svg`, sheetTwo(box, name)]]) {
  const target = resolve(dir, out);
  writeFileSync(target, svg);
  console.error(`wrote ${target}`);
}
