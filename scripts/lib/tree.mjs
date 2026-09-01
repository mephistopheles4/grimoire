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
// root, and `*` and `?` as glob characters that do not cross a `/`. A `**` or
// a character class is refused by name rather than compiled wrong, and a
// nested .gitignore in a subdirectory is not read at all. Every pattern this
// repository's .gitignore holds is inside that width.
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

// A pattern this reader cannot compile correctly. `**` is expanded as two
// independent `*`, so `**/build` compiles to a regex matching exactly one
// directory level — it matches x/build and misses build and x/y/build. A
// character class is escaped to a literal, so `*.[bl]ak` matches the filename
// "notes.[bl]ak" and misses notes.bak. Both are valid .gitignore syntax
// producing a wrong answer, which is worse than an unread one: the walk then
// enters a directory git excludes, which is the bug this file exists to fix.
// Skipped and named, rather than compiled wrong in silence.
const UNSUPPORTED = /\*\*|\[/;

function parseIgnore(text) {
  const rules = [];
  const skipped = [];
  for (const raw of text.split('\n')) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (UNSUPPORTED.test(line)) {
      skipped.push(line);
      continue;
    }
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
  return { rules, skipped };
}

// Last match wins, so a later `!` line can bring a path back.
function isIgnored(rules, relPath, isDir) {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(r.anchored ? relPath : name)) ignored = !r.negated;
  }
  return ignored;
}

function rulesFor(root) {
  let text;
  try {
    text = readFileSync(join(root, '.gitignore'), 'utf8');
  } catch (e) {
    // Only "it is not there" is a skip. Anything else is a .gitignore that
    // exists and cannot be read, which is not the same answer.
    if (e.code !== 'ENOENT') throw e;
    // Say so. A walk that quietly skips nothing reads as a walk that found
    // everything, and those are two different answers.
    return { rules: [], notes: ['no .gitignore — the walk skipped only .git'] };
  }
  const { rules, skipped } = parseIgnore(text);
  // Every path out says which one it took, so an unread pattern is announced
  // rather than passed over. A skipped pattern means the walk enters something
  // git would not.
  const notes = skipped.length
    ? [`.gitignore: ${skipped.length} pattern(s) not read, so the walk enters what they exclude: ${skipped.join(', ')}`]
    : [];
  return { rules, notes };
}

// Every file the root .gitignore does not exclude, plus any notes the walk
// owes the reader. Callers filter the files for what they want, and print
// every note.
//
// Not "every file git would track": an untracked file git has never been told
// about comes back from here, which is the answer both callers want — a box
// file nobody has committed yet still has to validate. Nor is it every rule
// git would apply: .git/info/exclude, a global core.excludesFile and a nested
// .gitignore in a subdirectory are all unread.
export function walk(root) {
  const { rules, notes } = rulesFor(root);
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
  return { files, notes };
}
