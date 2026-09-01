#!/usr/bin/env node
// grimoire's whole contract. Zero dependencies, one command.
//
//   node scripts/check.mjs
//
// 1. Every *.box.json in the tree validates against the eagle-eye renderer.
// 2. No SKILL.md carries a fixed path. A skill lands in a different directory
//    under every install route, so a path that names one of them is a defect.
// 3. The single-pass tag strip does not come back, and no code fence in any
//    markdown file declares no language.
// 4. Every plugin in the marketplace manifest exists on disk with a manifest.
// 5. A change to a skill carries a version bump.
// 6. The test suite passes. `node --test` ships with Node, so the tests cost no
//    dependency and this stays one command.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk } from './lib/tree.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const failures = [];
const fail = m => failures.push(m);
const rel = p => relative(root, p).split(sep).join('/');

// The walk reads .gitignore rather than a hardcoded skip set. scripts/lib/tree.mjs
// carries why, and it is shared with build-pages.mjs so the two cannot drift.
const { files, note: walkNote } = walk(root);
if (walkNote) console.log(`note: ${walkNote}`);

// 1. Box files validate.
const boxes = files.filter(f => f.endsWith('.box.json'));
if (!boxes.length) fail('no *.box.json found — the renderer has nothing to check');
const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');
for (const box of boxes) {
  try {
    execFileSync(process.execPath, [renderer, box, '--check'], { stdio: 'pipe' });
    console.log(`ok    ${rel(box)}`);
  } catch (e) {
    fail(`${rel(box)} failed --check:\n${(e.stderr || e.stdout || '').toString().trim()}`);
  }
}

// 2. No fixed paths in anything a skill ships.
//
// This read files named SKILL.md, so the three patterns never ran against a
// skill's lib/, reference/, renderer or schema. A hardcoded home directory
// anywhere but the skill's own prose passed the gate that exists to catch it.
//
// Scoped to skills/ and not to the whole tree, because the rule is about what
// lands on somebody else's computer under an install route nobody here
// chooses. A repository script is not that, and tests/check.test.mjs carries
// two of these patterns on purpose — as the strings that prove the rule works.
const FIXED = [/~\/\.claude/, /\/home\/[a-z]/i, /C:\\Users\\/i];
// A minified file is one long line, and a refusal nobody can read is a refusal
// nobody acts on.
const excerpt = s => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
for (const shipped of files.filter(f => rel(f).startsWith('skills/'))) {
  readFileSync(shipped, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trimStart().startsWith('>')) return; // a quoted example is not an instruction
      for (const re of FIXED) {
        if (re.test(line)) fail(`${rel(shipped)}:${i + 1} holds a fixed path: ${excerpt(line.trim())}`);
      }
    });
}

for (const skill of files.filter(f => f.endsWith('SKILL.md'))) {
  if (!/^---\r?\n[\s\S]*?^name:/m.test(readFileSync(skill, 'utf8'))) {
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

// 3b. No fenced code block declares no language.
//
// CodeRabbit raised one of these on #6, and there was no local gate to catch
// it. A bare fence renders without highlighting and tells a reader nothing
// about what they are looking at.
//
// This is a state machine and not a per-line regex, which is the same shape
// the rule started as. A naive regex matches the closing fence too, and every
// closing fence declares no language, so it reported sixteen lines of which
// thirteen were closing ones.
//
// The open fence is held whole, not as its first character. CommonMark closes
// a fence only on the same character, at the same length or longer, so ```` a
// four-backtick block holding a three-backtick example stays one block. Held
// as a character, the inner ``` closed the outer block and the example's own
// closing fence then read as a new bare one — a failure on correct markdown,
// in a repository whose files document fenced blocks. The same rule lets a
// ``` block hold a ~~~ line untouched.
//
// Only the bare fence is checked. markdownlint reports about forty long lines
// in this tree at its defaults, and that is a separate decision nobody has
// taken. See SECURITY.md for why no linter is installed to take it.
const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)/;
for (const md of files.filter(f => f.endsWith('.md'))) {
  let open = null;
  readFileSync(md, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = FENCE.exec(line);
      if (!m) return;
      const [, marker, lang] = m;
      if (open === null) {
        open = marker;
        if (!lang) fail(`${rel(md)}:${i + 1} opens a code fence with no language — say what the block holds`);
      } else if (marker[0] === open[0] && marker.length >= open.length && !lang) {
        open = null;
      }
    });
}

// 4. The two manifests agree, and each listed skill exists.
//
// The repo is one plugin. marketplace.json is the shelf and names the source
// "./"; plugin.json is the book and sits at the same root. That pairing is not
// in the docs, and mattpocock/skills ships it, which is the evidence it works.
//
// The version lives in plugin.json only. A version in a marketplace entry would
// be a second place to forget, so this check rejects one rather than compare it.
const mkt = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const pluginManifestPath = join(root, '.claude-plugin', 'plugin.json');
const plugin = JSON.parse(readFileSync(pluginManifestPath, 'utf8'));

for (const p of mkt.plugins) {
  if (p.source !== './') {
    fail(`marketplace.json "${p.name}": source is "${p.source}"; this repo is one plugin, so it must be "./"`);
    continue;
  }
  if (p.name !== plugin.name) {
    fail(`marketplace.json calls the plugin "${p.name}", plugin.json calls it "${plugin.name}"`);
  }
  if (p.version !== undefined) {
    fail(`marketplace.json "${p.name}": drop "version" — plugin.json is where it lives, and two copies drift`);
  }
}
if (mkt.name === plugin.name) {
  fail(`the marketplace and the plugin are both named "${mkt.name}" — give the shelf and the book different names`);
}

// Every skill directory holds a SKILL.md. The default scan reads skills/<name>/,
// one level deep. A nested layout (skills/<category>/<name>/) needs an explicit
// "skills" array in plugin.json, which this repo does not have and does not need.
for (const e of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  try {
    statSync(join(root, 'skills', e.name, 'SKILL.md'));
  } catch {
    fail(
      `skills/${e.name}/ has no SKILL.md — the default scan reads one level, so a category folder needs a "skills" array in plugin.json`,
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
  const touched = git('diff', '--name-only', `${mergeBase}..HEAD`, '--', 'skills');
  const before = git('show', `${mergeBase}:.claude-plugin/plugin.json`);
  if (!touched) {
    // nothing to release
  } else if (!before) {
    // The manifest did not exist at the base, so there is no version to move
    // from. This is the layout move itself. Say it rather than pass in silence.
    console.log('note: no plugin.json at the base commit — version bump check skipped');
  } else {
    const was = JSON.parse(before).version;
    if (was === plugin.version) {
      const files = touched.split('\n').length;
      fail(
        `${files} skill file(s) changed since ${baseRef}, but version is still ${plugin.version} — plugin users receive no update`,
      );
    }
  }
}

// 6. The test suite runs here, under the same one command.
//
// `node --test` ships with Node and needs no manifest, no install and no
// dependency, which is the only reason a repository with no package.json can
// have tests at all. It runs last because the rules above are cheap and the
// suite spawns processes.
//
// It runs from here rather than from a second CI step, because CONTRIBUTING
// promises one command. A suite behind a command nobody is told to run is a
// suite nobody runs.
//
// The files are listed rather than passed as a directory or a glob. A bare
// `node --test tests/` is a file path on some versions and a directory on
// others, and a glob is the shell's job on one platform and Node's on another.
// A list of paths means the same thing everywhere.
//
// GRIMOIRE_IN_TEST breaks the loop. tests/check.test.mjs runs this script, and
// this script runs the suite. The variable tells the child which of the two is
// already happening.
if (process.env.GRIMOIRE_IN_TEST) {
  console.log('note: tests already running — test step skipped');
} else {
  // Every path out of here says which one it took. A check that silently does
  // nothing reads as a check that passed, and "the suite is missing" and "the
  // suite is empty" are two different ways for it to disappear.
  let tests = null;
  try {
    tests = readdirSync(join(root, 'tests'))
      .filter(f => f.endsWith('.test.mjs'))
      .sort()
      .map(f => join(root, 'tests', f));
  } catch (e) {
    // Only "it is not there" is a skip. A bare catch also swallowed a
    // permission error and a file called tests, and reported both as a missing
    // directory — a suite that cannot be read, passing under a reassuring note.
    if (e.code !== 'ENOENT') throw e;
    console.log('note: no tests/ directory — test step skipped');
  }
  if (tests && !tests.length) {
    console.log('note: tests/ holds no *.test.mjs file — test step skipped');
  } else if (tests) {
    console.log(`\nrunning ${tests.length} test file(s)`);
    try {
      execFileSync(process.execPath, ['--test', ...tests], {
        cwd: root,
        env: { ...process.env, GRIMOIRE_IN_TEST: '1' },
        stdio: 'inherit',
      });
    } catch {
      fail('the test suite failed — the run is printed above');
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nok: ${boxes.length} box file(s), ${mkt.plugins.length} plugin(s)`);
