#!/usr/bin/env node
// Picks the skills the SkillSpector workflow scans on this run.
//
//   EVENT=<github.event_name> BEFORE=<push's before sha> node scripts/skillspector-select.mjs
//   LISTED=<result> SCANNED=<result> COUNT=<n> node scripts/skillspector-select.mjs verdict
//
// The second form is the required `scan` check's verdict (scanVerdict).
//
// Run from the checkout's root. It writes `skills=<json rows>` and `count=<n>`
// to $GITHUB_OUTPUT, one row per skill to scan, each `{skill, dir}` as the
// scan matrix reads it (docs/spec/0005, S5).
//
// **Every skill** on a schedule run or a run by hand, when the changed paths
// cannot be read, and when a change touches the scanner's pin, the allowances
// or the gate's code (SCANNER_PATHS). **Otherwise** the skills whose directory
// holds a changed path, which can be none. A skill's baseline sits in its
// directory, so a baseline change scans its skill.
//
// A tree with no skill still fails by name: no skills is a tree that lost
// them, not a tree with nothing to scan. An empty pick is not an empty tree.
//
// A pull request is read as its merge commit against the first parent, which
// is the base branch's tip; a push as everything since the commit before it,
// so a merge commit or a push of several commits is read whole. Its test is
// tests/skillspector-select.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scanner's pin, the allowances, the gate's scripts and what they import.
export const SCANNER_PATHS = [
  /^\.github\/workflows\/skillspector\.yml$/,
  /^\.skillspector-allowances\.json$/,
  /^scripts\/skillspector-[^/]+$/,
  /^scripts\/lib\/skillspector-[^/]+$/,
  /^scripts\/lib\/printable\.mjs$/,
];

// Every link under skills/, as tree-relative paths. The base listing followed
// a linked skill folder, and a link inside a skill brings content from outside
// its directory; a pick by changed paths can tie neither to its skill, so the
// listing refuses any link by name.
export function findLinks(tree) {
  const found = [];
  const walk = rel => {
    for (const d of readdirSync(join(tree, rel), { withFileTypes: true })) {
      const p = `${rel}/${d.name}`;
      if (d.isSymbolicLink()) found.push(p);
      else if (d.isDirectory()) walk(p);
    }
  };
  if (existsSync(join(tree, 'skills'))) walk('skills');
  return found.sort();
}

// The required `scan` check's verdict, from the listing's result, the scans'
// result and the pick's count, as the workflow passes them.
export function scanVerdict({ listed, scanned, count }) {
  if (listed !== 'success') return { pass: false, why: `the listing ended ${listed || 'without a result'}` };
  if (scanned === 'success') return { pass: true, why: 'every picked skill passed its gate' };
  if (scanned === 'skipped' && count === '0') return { pass: true, why: 'no skill was picked, and none was scanned' };
  return { pass: false, why: `the scans ended ${scanned || 'without a result'} with ${count || 'no'} skill(s) picked` };
}

export function listSkills(tree) {
  const top = join(tree, 'skills');
  if (!existsSync(top)) return [];
  return readdirSync(top, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(top, d.name, 'SKILL.md')))
    .map(d => d.name)
    .sort()
    .map(name => ({ skill: name, dir: `skills/${name}` }));
}

export function selectSkills({ event, skills, changed }) {
  if (event === 'schedule' || event === 'workflow_dispatch') return { skills, why: `every skill: a ${event} run` };
  if (!Array.isArray(changed)) return { skills, why: 'every skill: the changed paths could not be read' };
  const scanner = changed.find(p => SCANNER_PATHS.some(re => re.test(p)));
  if (scanner) return { skills, why: `every skill: ${scanner} changed` };
  const picked = skills.filter(s => changed.some(p => p.startsWith(`${s.dir}/`)));
  return { skills: picked, why: picked.length ? 'the skills this change touched' : 'no skill: this change touched none' };
}

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

export function changedPaths({ event, before, git }) {
  let args;
  // -z, so a name holding a quote, a backslash or a control character comes
  // back as it is rather than quoted; --no-renames, so a moved file is listed
  // at the path it left as well as the one it reached.
  const diff = ['diff', '--name-only', '-z', '--no-renames'];
  if (event === 'pull_request') args = [...diff, 'HEAD^1', 'HEAD'];
  else if (event === 'push') {
    if (!SHA.test(before || '') || /^0+$/.test(before)) return null;
    args = [...diff, before, 'HEAD'];
  } else return null;
  try {
    return String(git(args)).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function verdict() {
  const { pass, why } = scanVerdict({ listed: process.env.LISTED, scanned: process.env.SCANNED, count: process.env.COUNT });
  (pass ? console.log : console.error)(`scan: ${pass ? 'pass' : 'red'}: ${why}`);
  process.exit(pass ? 0 : 1);
}

function main() {
  const event = process.env.EVENT || '';
  const links = findLinks('.');
  if (links.length) {
    for (const l of links) console.error(`${l} is a link — a skill is scanned by the files under its own directory, so no link may sit under skills/`);
    process.exit(1);
  }
  const all = listSkills('.');
  if (all.length === 0) {
    console.error("no directory under skills/ holds a SKILL.md — there is nothing to scan, and that is not a pass");
    process.exit(1);
  }
  const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const changed = changedPaths({ event, before: process.env.BEFORE, git });
  const { skills, why } = selectSkills({ event, skills: all, changed });
  const rows = JSON.stringify(skills);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `skills=${rows}\ncount=${skills.length}\n`);
  console.log(`${why}: ${skills.map(s => s.skill).join(', ') || 'none'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'verdict') verdict();
  else main();
}
