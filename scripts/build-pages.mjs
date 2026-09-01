#!/usr/bin/env node
// Render every box file in the tree into site/, plus an index that links them.
// The renderer writes one self-contained HTML file, so the site needs no build
// step and no asset pipeline.
//
//   node scripts/build-pages.mjs

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { walk } from './lib/tree.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// The same escape the rendered page uses, from the same file. This script had
// its own copy, and the copy behaved differently: it rendered a missing value
// as the string "undefined". Two escapes are two things to get right, and the
// second one had no test. tests/esc.test.mjs covers this one.
const require = createRequire(import.meta.url);
const { esc } = require(join(root, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'));
const out = join(root, 'site');
const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');

// The walk reads .gitignore rather than a hardcoded skip set, and it is the
// same walk scripts/check.mjs uses. scripts/lib/tree.mjs carries why.
const { files, notes: walkNotes } = walk(root);
for (const n of walkNotes) console.log(`note: ${n}`);

mkdirSync(out, { recursive: true });

// The page name carries the whole repo-relative path. Keyed on the basename,
// two boxes with the same file name in different directories resolved to one
// path in site/, and the second render silently overwrote the first: a page
// missing from the published site, with no warning and no failure.
//
// Names are resolved before anything is rendered, so a refusal writes no page.
const pages = [];
const takenBy = new Map();
// The listing page is a writer of site/ too, and it was not in the guard: a
// box at the repository root called index.box.json rendered to site/index.html
// and was then overwritten by the listing, exit 0 and no warning — the same
// disappearance this change closes for two boxes, reopened for one box and the
// index. Claimed before the loop so the collision message names it.
takenBy.set('index.html', 'the generated listing page');
for (const box of files.filter(f => f.endsWith('.box.json'))) {
  const src = relative(root, box).split(sep).join('/');
  const name = src.replace(/\.box\.json$/, '').replace(/\//g, '-') + '.html';
  // Flattening a path onto one name is not injective: grid/one.box.json and
  // grid-one.box.json both ask for grid-one.html. Refuse rather than overwrite,
  // which is the failure this whole change is about.
  const taken = takenBy.get(name);
  if (taken) {
    console.error(
      `${src} and ${taken} both render to site/${name} — rename one so each box has its own page. Two sources cannot share one output file; the second render overwrites the first and the page disappears from the site. See CONTRIBUTING.md.`,
    );
    process.exit(1);
  }
  takenBy.set(name, src);
  pages.push({ name, src, box });
}

for (const p of pages) {
  execFileSync(process.execPath, [renderer, p.box, '--out', join(out, p.name)], { stdio: 'inherit' });
  p.title = JSON.parse(readFileSync(p.box, 'utf8')).title;
}

const items = pages
  .map(p => `    <li><a href="./${esc(p.name)}">${esc(p.title)}</a> <code>${esc(p.src)}</code></li>`)
  .join('\n');

// The Drafting tokens the rendered pages carry, copied rather than shared. A
// stylesheet in site/ would be one request every page has to make, and every
// page here is self-contained — the claim README and SECURITY.md both make.
//
// The index used to set its own ui-sans-serif stack and declare
// `color-scheme: light dark`. template.html declares no color-scheme and
// carries no prefers-color-scheme block, so a dark-mode browser rendered the
// index dark and every page it linked light: a visible flip on each
// click-through, and two designs for one thing. Same tokens now, and the same
// light/dark commitment, which is to make none.
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>grimoire — eagle-eye boxes</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{
  --dw-paper:#fafaf7; --dw-ink:#22262b; --dw-caution:#d97706;
  --dw-ink-80:rgb(34 38 43 / .8); --dw-ink-55:rgb(34 38 43 / .55); --dw-ink-12:rgb(34 38 43 / .12); --dw-grid:rgb(34 38 43 / .05);
  --dw-font:'IBM Plex Mono',ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;
  --sp-3:20px; --sp-4:28px; --sp-gutter:36px;
  --ease:cubic-bezier(.2,.7,.3,1);
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:var(--dw-font);font-size:15px;line-height:1.6;color:var(--dw-ink);background-color:var(--dw-paper);
  background-image:linear-gradient(to right,var(--dw-grid) 1px,transparent 1px),linear-gradient(to bottom,var(--dw-grid) 1px,transparent 1px);background-size:24px 24px}
.page{min-height:100%;padding:var(--sp-4);display:flex}
.sheet{flex:1;max-width:64rem;margin:0 auto;border:2px solid var(--dw-ink);background:rgb(250 250 247 / .72);padding:var(--sp-4) var(--sp-gutter)}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.16em;font-weight:500;color:var(--dw-ink-55)}
h1{font-size:24px;font-weight:600;line-height:1.25;margin:10px 0 var(--sp-3)}
p{max-width:78ch;color:var(--dw-ink-80)}
ul{list-style:none;padding:0;margin:var(--sp-4) 0;border-top:1px solid var(--dw-ink-12)}
li{border-bottom:1px solid var(--dw-ink-12);padding:14px 0;display:flex;gap:var(--sp-3);align-items:baseline;flex-wrap:wrap}
a{color:var(--dw-ink);text-decoration-color:var(--dw-ink-55);text-underline-offset:3px;
  transition:color .16s var(--ease),text-decoration-color .16s var(--ease)}
a:hover{color:var(--dw-caution);text-decoration-color:var(--dw-caution)}
code{font-size:12px;color:var(--dw-ink-55)}
</style>
</head>
<body>
<div class="page"><div class="sheet">
  <div class="label">grimoire</div>
  <h1>eagle-eye</h1>
  <p>Each page below is one morphological box. Click an option to change it, and
  the page reads the configuration back: what fights, what is missing, and what
  you have not looked at.</p>
  <ul>
${items}
  </ul>
  <p><a href="https://github.com/mephistopheles4/grimoire">Source on GitHub</a></p>
</div></div>
</body>
</html>
`,
);

console.log(`wrote site/index.html and ${pages.length} page(s)`);
