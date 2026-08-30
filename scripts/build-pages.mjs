#!/usr/bin/env node
// Render every box file in the tree into site/, plus an index that links them.
// The renderer writes one self-contained HTML file, so the site needs no build
// step and no asset pipeline.
//
//   node scripts/build-pages.mjs

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// The same escape the rendered page uses, from the same file. This script had
// its own copy, and the copy behaved differently: it rendered a missing value
// as the string "undefined". Two escapes are two things to get right, and the
// second one had no test. tests/esc.test.mjs covers this one.
const require = createRequire(import.meta.url);
const { esc } = require(join(root, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js'));
const out = join(root, 'site');
const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');
const SKIP = new Set(['node_modules', '.git', 'site']);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(join(dir, e.name), acc);
    } else if (e.name.endsWith('.box.json')) acc.push(join(dir, e.name));
  }
  return acc;
}

mkdirSync(out, { recursive: true });
const pages = [];

for (const box of walk(root)) {
  const name = basename(box, '.box.json') + '.html';
  execFileSync(process.execPath, [renderer, box, '--out', join(out, name)], { stdio: 'inherit' });
  const { title } = JSON.parse(readFileSync(box, 'utf8'));
  pages.push({ name, title, src: relative(root, box).split(sep).join('/') });
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
