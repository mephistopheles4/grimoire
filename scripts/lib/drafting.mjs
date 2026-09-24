// The drafting kit both README sheet scripts draw with: one ink, one paper, the
// rule weights, text in IBM Plex Mono with its faces carried inside the SVG,
// numbered callouts, a parts list and a title block. This repository's tooling,
// not a skill's — scripts/groundtrack-sheets.mjs and scripts/eagle-eye-sheets.mjs
// each draw their own page with it, in their own skill's words.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* -- the ink ----------------------------------------------------------------
 *
 * The Aviation system's deck palette, as literal values: an image has no
 * stylesheet to read a custom property from. One ink, one paper, the caution
 * amber for the one state it means — the frame on a tour stop, the running
 * node, the error path — and the green only for an effect that landed. */
export const INK = '#22262b';
export const PAPER = '#fafaf7';
export const CAUTION = '#b45309';
export const NORMAL = '#15803d';
export const ink = a => `rgba(34,38,43,${a})`;

export const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const n = v => Math.round(v * 100) / 100;

export function T(tx, ty, text, size, o = {}) {
  return `<text x="${n(tx)}" y="${n(ty)}" font-size="${n(size)}" fill="${o.fill || INK}"` +
    (o.w ? ` font-weight="${o.w}"` : '') + (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
    (o.ls ? ` letter-spacing="${o.ls}"` : '') + `>${x(text)}</text>`;
}
export function R(rx, ry, w, h, o = {}) {
  return `<rect x="${n(rx)}" y="${n(ry)}" width="${n(w)}" height="${n(h)}" fill="${o.fill || 'none'}"` +
    (o.stroke === null ? '' : ` stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"`) +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
export function L(x1, y1, x2, y2, o = {}) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${o.stroke || INK}" stroke-width="${o.sw ?? 1}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '/>';
}
/** Words to lines of at most `max` characters. Mono, so a character count is
 *  a width. A word longer than a line is cut rather than left to overrun. */
export function wrap(text, max) {
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
export const clip = (s, max) => (String(s).length > max ? String(s).slice(0, max - 1) + '…' : String(s));
export const MONO = 0.6; /* a Plex Mono advance, as a fraction of the size */

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
/* Read from the assets folder of the skill whose page is drawn: each skill
 * vendors its own copy of the faces. Cached per folder. */
const facesCss = new Map();
function faces(assets) {
  if (facesCss.has(assets)) return facesCss.get(assets);
  const css = FACES.map(([weight, file, range]) => {
    const b64 = readFileSync(resolve(assets, file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-weight:${weight};unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('');
  facesCss.set(assets, css);
  return css;
}

/** A whole sheet: paper, the 24-unit grid, the frame, and the body. */
export function sheet(W, H, title, body, assets) {
  const grid = [];
  for (let gx = 24; gx < W; gx += 24) grid.push(`M${gx} 0V${H}`);
  for (let gy = 24; gy < H; gy += 24) grid.push(`M0 ${gy}H${W}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${x(title)}">` +
    `<title>${x(title)}</title>` +
    `<style>${faces(assets)}text{font-family:'IBM Plex Mono',ui-monospace,monospace}</style>` +
    R(0, 0, W, H, { fill: PAPER, stroke: null }) +
    `<path d="${grid.join('')}" stroke="${ink(0.05)}" stroke-width="1" fill="none"/>` +
    R(20, 20, W - 40, H - 40, { sw: 2 }) +
    body +
    '</svg>\n'
  );
}

export function balloon(num, bx, by, ax, ay, r = 16) {
  const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy) || 1;
  return L(bx + (dx / d) * r, by + (dy / d) * r, ax, ay, { sw: 1.5 }) +
    `<circle cx="${n(ax)}" cy="${n(ay)}" r="3.5" fill="${INK}"/>` +
    `<circle cx="${n(bx)}" cy="${n(by)}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
    T(bx, by + 6, String(num), 17, { anchor: 'middle', w: 600 });
}
export function letterBox(letter, bx, by) {
  return R(bx - 15, by - 15, 30, 30, { fill: PAPER, sw: 1.5 }) + T(bx, by + 7, letter, 18, { anchor: 'middle', w: 600 });
}

export function partsTable(px, py, w, head, rows, fs = 19) {
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

/** The title block: which skill drew it, what the sheet shows, what it was
 *  drawn from, and its drawing number and sheet. */
export function titleBlock(tx, ty, w, { kicker, subject, from, dwg, sheetNo }) {
  const g = [];
  const h = 150;
  g.push(R(tx, ty, w, h, { fill: PAPER, sw: 2 }), L(tx, ty + 62, tx + w, ty + 62), L(tx, ty + 104, tx + w, ty + 104));
  g.push(L(tx + w * 0.5, ty + 104, tx + w * 0.5, ty + h), L(tx + w * 0.75, ty + 104, tx + w * 0.75, ty + h));
  g.push(T(tx + 16, ty + 26, kicker, 13, { fill: ink(0.7), ls: 2 }), T(tx + 16, ty + 52, subject, 22, { w: 600, ls: 1 }));
  g.push(T(tx + 16, ty + 80, 'DRAWN FROM', 11, { fill: ink(0.7), ls: 1.5 }), T(tx + 16, ty + 97, clip(from, Math.floor((w - 32) / (15 * MONO))), 15));
  [['DWG NO.', dwg, 0], ['SCALE', 'NONE', 0.5], ['SHEET', sheetNo, 0.75]].forEach(([key, v, f]) => {
    g.push(T(tx + w * f + 16, ty + 122, key, 11, { fill: ink(0.7), ls: 1.5 }), T(tx + w * f + 16, ty + 142, v, 16, { w: 600 }));
  });
  return g.join('');
}
