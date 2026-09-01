// The one tree walk both scripts use, and the one place that decides what a
// walk does not enter.
//
// Both scripts carried an identical hardcoded skip set — node_modules, .git,
// site — and .gitignore excludes more than that. It excludes
// .claude/worktrees/, which neither walker knew, so `node scripts/check.mjs`
// descended into every stale worktree and validated other checkouts of itself:
// 19 failures on the maintainer's machine at the time, 18 of them from
// worktrees. CI never saw it, because a fresh checkout has no worktrees, so
// the one-command gate was red for anybody with a worktree open and green
// everywhere it was measured.
//
// Say the width, as the other guards in this repository do. The .gitignore
// reader handles a comment, a blank line, a `!` negation, a trailing `/` for
// directory-only, a leading or embedded `/` for a pattern anchored to the
// root, and `*` and `?` as glob characters that do not cross a `/`. It does
// not read `**`, a character class, or a nested .gitignore in a subdirectory.
// Every pattern this repository's .gitignore holds is inside that width.
//
// Shelling out to git would read the whole of it and cannot be used here: the
// check's own tests run against copied trees that are not repositories, so the
// walk has to work with no git and no .gitignore at all.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// `*` and `?` stay out of the escape set, because they are the two characters
// the glob is made of.
const escape = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
const toRegExp = glob => new RegExp(`^${escape(glob).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);

export function parseIgnore(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    // A pattern holding a slash is matched against the whole repo-relative
    // path; one without is matched against the name, at any depth. That is
    // git's own rule, and it is what makes `site/` and `.claude/worktrees/`
    // mean two different things.
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line) continue;
    rules.push({ re: toRegExp(line), negated, dirOnly, anchored });
  }
  return rules;
}

// Last match wins, so a later `!` line can bring a path back.
export function isIgnored(rules, relPath, isDir) {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(r.anchored ? relPath : name)) ignored = !r.negated;
  }
  return ignored;
}

function rulesFor(root) {
  try {
    return { rules: parseIgnore(readFileSync(join(root, '.gitignore'), 'utf8')), note: null };
  } catch (e) {
    // Only "it is not there" is a skip. Anything else is a .gitignore that
    // exists and cannot be read, which is not the same answer.
    if (e.code !== 'ENOENT') throw e;
    // Say so. A walk that quietly skips nothing reads as a walk that found
    // everything, and those are two different answers.
    return { rules: [], note: 'no .gitignore — the walk skipped only .git' };
  }
}

// Every file in the tree that git would track, plus a note when there was no
// .gitignore to read. Callers filter for what they want.
export function walk(root) {
  const { rules, note } = rulesFor(root);
  const files = [];
  const descend = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // .git is not in .gitignore — git does not ignore its own directory —
      // and no walk here has any business inside it.
      if (e.name === '.git') continue;
      const full = join(dir, e.name);
      if (isIgnored(rules, relative(root, full).split(sep).join('/'), e.isDirectory())) continue;
      if (e.isDirectory()) descend(full);
      else files.push(full);
    }
  };
  descend(root);
  return { files, note };
}
