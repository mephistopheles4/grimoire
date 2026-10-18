#!/usr/bin/env node
// The five social cards, 1280 by 640, written as self-contained SVG, and the
// skill sigils the root README shows (see the end of this file).
//
//   node docs/brand/cards.mjs
//
// Each card is the layout the brand handoff specifies, inside the design
// system's zone border: the mark at 200px, the name over a rule, the tagline,
// and a title-block footer.
// The two faces the wordmark and the tagline use are inlined from the copies
// groundtrack already ships, so a card renders the same in a README, in a
// browser, and in a link preview, and fetches nothing to do it. Zero
// dependencies, like everything else in this tree.
//
// The marks are read from the SVGs beside this script and inlined by their
// geometry. A card is a new drawing, so the provenance block a mark carries is
// not copied into it; the mark files themselves are left exactly as delivered.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fonts = join(root, 'skills', 'groundtrack', 'assets');

const INK = '#22262B';
const PAPER = '#FAFAF7';
const alpha = a => `rgb(34 38 43 / ${a})`;
const SURFACE = 'rgb(250 250 247 / 0.72)'; // --av-deck-surface, the translucent sheet fill

const face = (weight, file) =>
  `@font-face{font-family:'IBM Plex Mono';font-weight:${weight};font-style:normal;` +
  `src:url(data:font/woff2;base64,${readFileSync(join(fonts, file)).toString('base64')}) format('woff2')}`;

/** The mark's drawing, and nothing else: the root element and any metadata go. */
function markBody(name) {
  const svg = readFileSync(join(here, name, `${name}-mark.svg`), 'utf8');
  return svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}

const CARDS = [
  {
    name: 'grimoire',
    title: 'Grimoire',
    tagline: ['A spellbook of agent skills for AI.', 'Cast wisely.'],
    footer: 'github.com/mephistopheles4/grimoire',
  },
  {
    name: 'eagle-eye',
    title: 'Eagle-eye',
    tagline: ['Coupled decisions,', 'as a morphological box.'],
    footer: 'grimoire · skills/eagle-eye',
  },
  {
    name: 'groundtrack',
    title: 'Groundtrack',
    tagline: ['A plan or a change, as a call', 'graph you can step through.'],
    footer: 'grimoire · skills/groundtrack',
  },
  {
    name: 'contract',
    title: 'Contract',
    tagline: ['Agree the terms,', 'then seal the file.'],
    footer: 'grimoire · skills/contract',
  },
  {
    name: 'head-chef',
    title: 'Head-chef',
    tagline: ['Lead the sessions;', 'let them do the work.'],
    footer: 'grimoire · skills/head-chef',
  },
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* The card is a fixed-size sheet, which is what the design system's zone
 * border is for: zone numbers across the top and bottom, letters down the
 * sides, in a 36px band at 18px and ink 70, inside a bold outline. The field
 * inside it carries the réseau, one 13px cross every 120px at ink 30, and the
 * text sits on surface-filled panels, never bare on the crosses. Zones are
 * about 240px wide, five across; the field is 564px tall, so two rows, as on
 * the design system's own zone-border card. No zone is cited, because no card
 * names one. This draws aviation.css's .av-zones and .av-grid in SVG, since a
 * card cannot load a stylesheet. */
function card({ name, title, tagline, footer }) {
  const W = 1280, H = 640, RULE = 2, BAND = 36, PAD = 36;
  const F = { x: RULE + BAND, y: RULE + BAND };
  F.w = W - 2 * F.x; F.h = H - 2 * F.y;
  const COLS = 5, ROWS = 2, LETTERS = 'ABCDEFGHJKLMNPQRSTUVWX';
  const IN = { x: F.x + PAD, y: F.y + PAD, r: F.x + F.w - PAD, b: F.y + F.h - PAD };
  const MARK = 200, SHEET_X = IN.x + MARK + 24, TEXT_X = SHEET_X + PAD;
  const FOOT = 56; // the title block's height, on the field's bottom edge
  // The mark and its sheet sit on the middle of the field above the title
  // block, so the crosses show evenly above and below them.
  const TOP = Math.round((IN.y + IN.b - FOOT - MARK) / 2);

  // One band's labels and the hairlines between them, centred on each zone.
  const label = (x, y, t) =>
    `<text x="${x}" y="${y}" font-size="18" letter-spacing="2.88" fill="${alpha(0.7)}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const band = [];
  const cw = F.w / COLS, rh = F.h / ROWS;
  for (let i = 0; i < COLS; i++) {
    const cx = F.x + cw * (i + 0.5);
    band.push(label(cx, RULE + BAND / 2, i + 1), label(cx, H - RULE - BAND / 2, i + 1));
    if (i) band.push(`<path d="M${F.x + cw * i} ${RULE}V${F.y}M${F.x + cw * i} ${F.y + F.h}V${H - RULE}" stroke="${alpha(0.3)}" stroke-width="1"/>`);
  }
  for (let i = 0; i < ROWS; i++) {
    const cy = F.y + rh * (i + 0.5);
    band.push(label(RULE + BAND / 2, cy, LETTERS[i]), label(W - RULE - BAND / 2, cy, LETTERS[i]));
    if (i) band.push(`<path d="M${RULE} ${F.y + rh * i}H${F.x}M${F.x + F.w} ${F.y + rh * i}H${W - RULE}" stroke="${alpha(0.3)}" stroke-width="1"/>`);
  }

  const tag = tagline
    .map((line, i) => `<tspan x="${TEXT_X}" y="${TOP + 128 + i * 40}">${esc(line)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${esc(title)} — ${esc(tagline.join(' '))}</title>
<style>
${face(400, 'IBMPlexMono-Regular-Latin1.woff2')}
${face(600, 'IBMPlexMono-SemiBold-Latin1.woff2')}
text{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}
</style>
<defs>
  <pattern id="reseau" x="${F.x}" y="${F.y}" width="120" height="120" patternUnits="userSpaceOnUse">
    <path d="M54 60.5H67M60.5 54V67" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1" shape-rendering="crispEdges"/>
  </pattern>
</defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" fill="url(#reseau)" stroke="${alpha(0.3)}" stroke-width="1"/>
<rect x="${RULE / 2}" y="${RULE / 2}" width="${W - RULE}" height="${H - RULE}" fill="none" stroke="${INK}" stroke-width="${RULE}"/>
${band.join('\n')}
<svg x="${IN.x}" y="${TOP}" width="${MARK}" height="${MARK}" viewBox="0 0 24 24">
${markBody(name)}
</svg>
<rect x="${SHEET_X + 1}" y="${TOP + 1}" width="${IN.r - SHEET_X - 2}" height="${MARK - 2}" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/>
<text x="${TEXT_X}" y="${TOP + 66}" font-size="64" font-weight="600" letter-spacing="7.68" fill="${INK}">${esc(title.toUpperCase())}</text>
<rect x="${TEXT_X}" y="${TOP + 86}" width="520" height="2" fill="${INK}"/>
<text font-size="30" font-weight="400" fill="${alpha(0.8)}">${tag}</text>
<rect x="${IN.x + 0.5}" y="${IN.b - FOOT + 0.5}" width="${IN.r - IN.x - 1}" height="${FOOT - 1}" fill="${SURFACE}" stroke="${alpha(0.3)}" stroke-width="1"/>
<text x="${IN.x + 24}" y="${IN.b - FOOT / 2}" font-size="18" font-weight="400" letter-spacing="2.88" fill="${alpha(0.7)}" dominant-baseline="central">${esc(footer.toUpperCase())}</text>
<text x="${IN.r - 24}" y="${IN.b - FOOT / 2}" font-size="18" font-weight="400" letter-spacing="2.88" fill="${alpha(0.7)}" text-anchor="end" dominant-baseline="central">A. DIAB</text>
</svg>
`;
}

for (const c of CARDS) {
  const out = join(here, `${c.name}-card.svg`);
  writeFileSync(out, card(c));
  console.log(`wrote ${out}`);
}

// The sigils: each skill's mark with its name set under it, 192 by 160, on a
// transparent canvas. The root README shows them in a row at width 112, which
// puts the mark's 24-unit box at 56px. A caption beside an image centres as its
// own line and drifts from the mark; a name inside the image cannot. The name
// is anchored on the mark's centre line, so it is centred by construction.
// Each skill gets two: the name in ink for a light page and in paper for a
// dark one. The README picks between them with a <picture>.
const SIGILS = ['eagle-eye', 'contract', 'groundtrack', 'head-chef'];
const THEMES = { light: INK, dark: PAPER };

function sigil(name, fill) {
  const W = 192, H = 160, MARK = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${esc(name)}</title>
<style>
${face(600, 'IBMPlexMono-SemiBold-Latin1.woff2')}
text{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}
</style>
<svg x="${(W - MARK) / 2}" y="16" width="${MARK}" height="${MARK}" viewBox="0 0 24 24">
${markBody(name)}
</svg>
<text x="${W / 2}" y="140" font-size="22" font-weight="600" fill="${fill}" text-anchor="middle">${esc(name)}</text>
</svg>
`;
}

for (const name of SIGILS) {
  for (const [theme, fill] of Object.entries(THEMES)) {
    const out = join(here, name, `${name}-sigil-${theme}.svg`);
    writeFileSync(out, sigil(name, fill));
    console.log(`wrote ${out}`);
  }
}
