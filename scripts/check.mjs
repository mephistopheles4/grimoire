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

// 3. The single-pass tag strip does not come back.
// CodeQL raised js/incomplete-multi-character-sanitization on this exact form,
// in two files, on the first scan. The output is not an HTML sink and the
// bypass is hard to build, so this guard holds a shape, not a hole. SECURITY.md
// carries the triage.
const SINGLE_PASS = /=>\s*s\.replace\(\/<\[\^>\]\+>\/g/;
for (const f of files.filter(f => /\.(mjs|js|html)$/.test(f))) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (SINGLE_PASS.test(line)) {
        fail(`${rel(f)}:${i + 1} strips tags in one pass — repeat until the string stops changing`);
      }
    });
}

// 4. The marketplace manifest matches the tree.
const mkt = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
for (const p of mkt.plugins) {
  const src = p.source.replace(/^\.\//, '');
  const manifest = join(root, src, '.claude-plugin', 'plugin.json');
  try {
    statSync(manifest);
  } catch {
    fail(`marketplace.json lists "${p.name}" but ${rel(manifest)} does not exist`);
    continue;
  }
  const pluginVersion = JSON.parse(readFileSync(manifest, 'utf8')).version;
  if (p.version !== pluginVersion) {
    fail(
      `"${p.name}": marketplace.json says ${p.version}, ${rel(manifest)} says ${pluginVersion}`,
    );
  }
}

// 5. A change to a skill needs a version bump.
//
// Claude Code delivers an update only when the version field moves: "If set,
// users only receive updates when you bump this field."
// (code.claude.com/docs/en/plugins) So a skill edit that ships without a bump
// reaches nobody who installed the plugin, and nothing goes red. Two merged
// pull requests changed the skill under an unmoved 0.1.0 before this check
// existed. The npx route resolves a git ref and was never affected, which is
// what made the gap quiet.
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
const mergeBase = git('merge-base', baseRef, 'HEAD');

if (!mergeBase) {
  // Say so. A check that silently does nothing reads as a check that passed.
  console.log(`note: cannot resolve ${baseRef} — version bump check skipped`);
} else if (mergeBase === git('rev-parse', 'HEAD')) {
  console.log(`note: nothing ahead of ${baseRef} — version bump check skipped`);
} else {
  for (const p of mkt.plugins) {
    const src = p.source.replace(/^\.\//, '');
    const touched = git('diff', '--name-only', `${mergeBase}..HEAD`, '--', `${src}/skills`);
    if (!touched) continue;
    const manifestRel = `${src}/.claude-plugin/plugin.json`;
    const before = git('show', `${mergeBase}:${manifestRel}`);
    if (!before) continue; // new plugin: there is no previous version to move
    const was = JSON.parse(before).version;
    const now = JSON.parse(readFileSync(join(root, manifestRel), 'utf8')).version;
    if (was === now) {
      const files = touched.split('\n').length;
      fail(
        `"${p.name}": ${files} skill file(s) changed since ${baseRef}, but version is still ${now} — plugin users receive no update`,
      );
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nok: ${boxes.length} box file(s), ${mkt.plugins.length} plugin(s)`);
