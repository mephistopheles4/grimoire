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
const { files, note: walkNote } = walk(root);
if (walkNote) console.log(`note: ${walkNote}`);

mkdirSync(out, { recursive: true });

// The page name carries the whole repo-relative path. Keyed on the basename,
// two boxes with the same file name in different directories resolved to one
// path in site/, and the second render silently overwrote the first: a page
// missing from the published site, with no warning and no failure.
//
// Names are resolved before anything is rendered, so a refusal writes no page.
const pages = [];
const takenBy = new Map();
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

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>grimoire — eagle-eye boxes</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 42rem; margin: 4rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.4rem; }
  li { margin: .6rem 0; }
  code { font-size: .8em; opacity: .6; }
</style>
</head>
<body>
  <h1>grimoire — eagle-eye</h1>
  <p>Each page below is one morphological box. Click an option to change it, and
  the page reads the configuration back: what fights, what is missing, and what
  you have not looked at.</p>
  <ul>
${items}
  </ul>
  <p><a href="https://github.com/mephistopheles4/grimoire">Source on GitHub</a></p>
</body>
</html>
`,
);

console.log(`wrote site/index.html and ${pages.length} page(s)`);
