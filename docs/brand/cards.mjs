#!/usr/bin/env node
// The four social cards, 1280 by 640, written as self-contained SVG, and the
// three skill sigils the root README shows (see the end of this file).
//
//   node docs/brand/cards.mjs
//
// Each card is the layout the brand handoff specifies: a drafting grid, the
// mark at 200px, the name over a rule, the tagline, and a title-block footer.
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
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function card({ name, title, tagline, footer }) {
  const W = 1280, H = 640, PAD = 88, TEXT_X = PAD + 200 + 48;
  const tag = tagline
    .map((line, i) => `<tspan x="${TEXT_X}" y="${228 + i * 43.5}">${esc(line)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${esc(title)} — ${esc(tagline.join(' '))}</title>
<style>
${face(400, 'IBMPlexMono-Regular-Latin1.woff2')}
${face(600, 'IBMPlexMono-SemiBold-Latin1.woff2')}
text{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}
</style>
<defs>
  <pattern id="minor" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M40 0 H0 V40" fill="none" stroke="${alpha(0.035)}" stroke-width="1"/>
  </pattern>
  <pattern id="major" width="200" height="200" patternUnits="userSpaceOnUse">
    <path d="M200 0 H0 V200" fill="none" stroke="${alpha(0.085)}" stroke-width="1"/>
  </pattern>
</defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<rect width="${W}" height="${H}" fill="url(#minor)"/>
<rect width="${W}" height="${H}" fill="url(#major)"/>
<rect x="36.5" y="36.5" width="${W - 73}" height="${H - 73}" fill="none" stroke="${alpha(0.22)}" stroke-width="1"/>
<svg x="${PAD}" y="${PAD}" width="200" height="200" viewBox="0 0 24 24">
${markBody(name)}
</svg>
<text x="${TEXT_X}" y="150" font-size="64" font-weight="600" letter-spacing="7.68" fill="${INK}">${esc(title.toUpperCase())}</text>
<rect x="${TEXT_X}" y="184" width="520" height="2" fill="${INK}"/>
<text font-size="30" font-weight="400" fill="${alpha(0.8)}">${tag}</text>
<rect x="${PAD}" y="509" width="${W - PAD * 2}" height="1" fill="${alpha(0.5)}"/>
<text x="${PAD}" y="546" font-size="18" font-weight="400" letter-spacing="2.88" fill="${alpha(0.7)}">${esc(footer.toUpperCase())}</text>
<text x="${W - PAD}" y="546" font-size="18" font-weight="400" letter-spacing="2.88" fill="${alpha(0.7)}" text-anchor="end">A. DIAB</text>
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
const SIGILS = ['eagle-eye', 'contract', 'groundtrack'];
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
