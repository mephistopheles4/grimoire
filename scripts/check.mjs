#!/usr/bin/env node
// grimoire's whole contract. Zero dependencies, one command.
//
//   node scripts/check.mjs
//
// 1. Every *.box.json in the tree validates against the eagle-eye renderer.
// 2. No SKILL.md carries a fixed path. A skill lands in a different directory
//    under every install route, so a path that names one of them is a defect.
// 3. Every plugin in the marketplace manifest exists on disk with a manifest.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SKIP = new Set(['node_modules', '.git', 'site']);
const failures = [];
const fail = m => failures.push(m);
const rel = p => relative(root, p).split(sep).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(join(dir, e.name), out);
    } else out.push(join(dir, e.name));
  }
  return out;
}

const files = walk(root);

// 1. Box files validate.
const boxes = files.filter(f => f.endsWith('.box.json'));
if (!boxes.length) fail('no *.box.json found — the renderer has nothing to check');
for (const box of boxes) {
  const renderer = join(
    root,
    'plugins',
    'eagle-eye',
    'skills',
    'eagle-eye',
    'render.mjs',
  );
  try {
    execFileSync(process.execPath, [renderer, box, '--check'], { stdio: 'pipe' });
    console.log(`ok    ${rel(box)}`);
  } catch (e) {
    fail(`${rel(box)} failed --check:\n${(e.stderr || e.stdout || '').toString().trim()}`);
  }
}

// 2. No fixed paths in a skill.
const FIXED = [/~\/\.claude/, /\/home\/[a-z]/i, /C:\\Users\\/i];
for (const skill of files.filter(f => f.endsWith('SKILL.md'))) {
  const text = readFileSync(skill, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('>')) return; // a quoted example is not an instruction
    for (const re of FIXED) {
      if (re.test(line)) fail(`${rel(skill)}:${i + 1} holds a fixed path: ${line.trim()}`);
    }
  });
  if (!/^---\r?\n[\s\S]*?^name:/m.test(text)) {
    fail(`${rel(skill)} has no frontmatter name — the invocation name would follow the directory`);
  }
}

// 3. The marketplace manifest matches the tree.
const mkt = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
for (const p of mkt.plugins) {
  const src = p.source.replace(/^\.\//, '');
  const manifest = join(root, src, '.claude-plugin', 'plugin.json');
  try {
    statSync(manifest);
  } catch {
    fail(`marketplace.json lists "${p.name}" but ${rel(manifest)} does not exist`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nok: ${boxes.length} box file(s), ${mkt.plugins.length} plugin(s)`);
