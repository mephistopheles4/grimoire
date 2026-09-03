#!/usr/bin/env node
// grimoire's whole contract. Zero dependencies, one command.
//
//   node scripts/check.mjs
//
// 1. Every *.box.json in the tree validates against the eagle-eye renderer.
// 2. No file a skill ships carries a fixed path. A skill lands in a different
//    directory under every install route, so a path naming one is a defect.
// 3. The single-pass tag strip does not come back, and no code fence in any
//    markdown file declares no language.
// 4. Every plugin in the marketplace manifest exists on disk with a manifest.
// 5. A change to a skill carries a version bump.
// 6. Nothing in the tree takes a dependency: no manifest, no lockfile, and no
//    import of a bare specifier.
// 7. The two SkillSpector baselines agree, so a rule reasoned away at the
//    repository root is reasoned away the same way inside the skill.
// 8. The test suite passes. `node --test` ships with Node, so the tests cost no
//    dependency and this stays one command.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk } from './lib/tree.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const failures = [];
const fail = m => failures.push(m);
const rel = p => relative(root, p).split(sep).join('/');

// The walk reads .gitignore rather than a hardcoded skip set. scripts/lib/tree.mjs
// carries why, and it is shared with build-pages.mjs so the two cannot drift.
const { files, notes: walkNotes } = walk(root);
for (const n of walkNotes) console.log(`note: ${n}`);

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
// all three of these patterns on purpose — as the strings that prove the rule
// works. Counted from the file rather than remembered: an earlier draft of this
// comment said two, and the third was added in the same change that wrote it.
const FIXED = [/~\/\.claude/, /\/home\/[a-z]/i, /C:\\Users\\/i];
// A minified file is one long line, and a refusal nobody can read is a refusal
// nobody acts on.
const excerpt = s => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
for (const shipped of files.filter(f => rel(f).startsWith('skills/'))) {
  // The block-quote exemption is markdown only. `>` opens a quotation in prose
  // and means nothing in JavaScript, JSON or HTML, so honouring it everywhere
  // would let a fixed path walk through the gate on any line that happened to
  // start with one. The exemption exists because a quoted example is not an
  // instruction, and only a markdown file can quote.
  const quotable = shipped.endsWith('.md');
  readFileSync(shipped, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (quotable && line.trimStart().startsWith('>')) return;
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

// 6. Zero dependencies — the claim this file opens with.
//
// CONTRIBUTING states it twice as a rule for patches and nothing enforced it:
// no check mentioned package.json outside a comment, no test covered it, and
// CI runs this script and nothing else. A patch adding a manifest and a
// dependency went green. The rule held only because the tree gave it nowhere
// to land.
//
// Two ways in, so two rules. A manifest or a lockfile is the install step this
// repository does not have. A bare specifier — an import path that is neither
// relative nor a node builtin — is a dependency whether or not a manifest
// declares it.
//
// Say the width, twice over. The rule reads .mjs and .js files only, so the
// inline script in lib/template.html is not scanned — a dynamic import there
// would pass. That file loads in a browser from a file: URL and has nowhere to
// resolve a bare specifier from, so the gap is stated rather than closed.
//
// Within a file it reads string literals: a from-clause, a side-effect import,
// a dynamic import and a require. A computed path cannot be read here and is
// not flagged, which is how build-pages.mjs and render.mjs both reach the
// shared module. Neither rule can skip, so neither has a note to print.
const MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lock',
  'bun.lockb',
]);
for (const f of files.filter(f => MANIFESTS.has(basename(f)))) {
  fail(
    `${rel(f)}: a dependency manifest or lockfile — delete it. This repository takes no dependency and has no install step, which is what lets the tests run on \`node --test\` and the skill run from a checkout. See CONTRIBUTING.md, "Do not add a dependency", and SECURITY.md for why it matters more than it looks.`,
  );
}

// Prose is not code, and this repository writes long prose comments. Scanning
// every line for a quoted string after the word "from" flagged three sentences out
// of three tried, including one that said a refusal is different from "a
// warning" and one saying the tokens were copied from 'the rendered page'. So a
// comment line is skipped, and the two static forms have to begin their line,
// which is where a hoisted import lives. A dynamic import and a require are
// read anywhere but a comment, because those two can hide inside an
// expression. Two gaps stay open and are cheap to live with: a trailing
// comment on a line of code is still read as code, and a comment written
// between the keyword and the specifier — `import /* c */ 'pkg'` — is not
// seen. Closing the second needs a tokenizer, which is a dependency or a
// hand-rolled parser, and this rule exists to keep both out.
const COMMENT = /^\s*(\/\/|\*|\/\*)/;
// A static form needs the word `from` before its quote, or it is a bare
// side-effect import. Without that, `export const renderer = join(root,
// 'skills', ...)` read as a re-export of the package "skills" — three
// false failures on tests/helpers.mjs, which is how this line got written.
const FROM = /^\s*(?:import|export)\b[^'"]*\bfrom\s*(['"])([^'"]+)\1/;
const SIDE_EFFECT = /^\s*import\s*(['"])([^'"]+)\1/;
// The closing line of a wrapped import. `import {` ... `} from 'chalk';` is
// ordinary formatting for a long import list, and read a line at a time none
// of the patterns above see it — a bare dependency in the most common shape a
// formatter produces. A prose line does not begin with a brace, so this costs
// no false positive.
const WRAPPED = /^\s*[}]\s*from\s*(['"])([^'"]+)\1/;
const CALLED = [
  /\bimport\s*\(\s*(['"])([^'"]+)\1/g,
  /\brequire\s*\(\s*(['"])([^'"]+)\1/g,
];
// A relative path, an absolute path and a node: builtin all resolve with
// nothing installed. Everything else is a package.
const bare = spec => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:');
for (const f of files.filter(f => /\.(mjs|js)$/.test(f))) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (COMMENT.test(line)) return;
      const found = [];
      for (const re of [FROM, SIDE_EFFECT, WRAPPED]) {
        const m = re.exec(line);
        if (m) found.push(m[2]);
      }
      for (const re of CALLED) for (const m of line.matchAll(re)) found.push(m[2]);
      for (const spec of found.filter(bare)) {
        fail(
          `${rel(f)}:${i + 1} imports "${spec}" — import a relative path or a node: builtin instead. A bare specifier is a dependency, and this repository has none, so nothing installs it and the file does not load. See CONTRIBUTING.md, "Do not add a dependency".`,
        );
      }
    });
}

// 7. The two SkillSpector baselines agree.
//
// SkillSpector scans the prose this repository ships, and the workflow at
// .github/workflows/skillspector.yml fails on any finding a baseline does not
// cover. The baseline is therefore the argument, and there are two copies of
// it: one at the repository root, one at the top of the skill. Two, because
// the scanner finds a baseline only at the top of the directory it was pointed
// at, and a reader scanning the skill is pointed at the skill.
//
// Two copies drift. The root file covers six rules, the skill file the three
// that fire inside it, and this rule holds the overlap to the same words. A
// rule quietly reasoned away in one file and not the other is a suppression
// nobody has read.
//
// The reader below is written by hand and reads exactly the shape these two
// files are allowed to have: three top-level keys, and a list of entries with
// a rule identifier, an optional file glob and a one-line reason. It is not a
// YAML parser and does not try to be. Adding one would be the dependency this
// repository does not take, so the shape is kept trivial instead, and anything
// outside it is named and refused rather than guessed at. A baseline this
// reader cannot understand is a baseline whose entries nobody here has
// checked.
const BASELINE = '.skillspector-baseline.yaml';
const BASELINE_KEYS = new Set(['version', 'fingerprints', 'rules']);
const ENTRY_KEYS = new Set(['rule_id', 'file', 'reason']);
// A scalar is bare or double-quoted, and a double-quoted one holds no quote
// and no escape of its own. Single quotes and block scalars are valid YAML and
// are not in this shape: an apostrophe inside a single-quoted string has to be
// doubled, and a folded block is two ways to write one line. Returns null when
// the value is quoted and something else, which the caller reports.
const QUOTED = /^"([^"]*)"$/;
function scalar(v) {
  if (!v.startsWith('"')) return v.includes('"') ? null : v;
  const m = QUOTED.exec(v);
  return m && !m[1].includes('\\') ? m[1] : null;
}

function readBaseline(path) {
  const problems = [];
  const top = {};
  const rules = [];
  let inRules = false;
  let entry = null;

  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      const at = `${rel(path)}:${i + 1}`;
      const line = raw.replace(/\r$/, '');
      if (!line.trim() || line.trimStart().startsWith('#')) return;
      const indent = line.length - line.trimStart().length;
      const text = line.trim();

      if (indent === 0) {
        inRules = false;
        entry = null;
        const m = /^([a-z_]+):\s*(.*)$/.exec(text);
        if (!m) return problems.push(`${at}: not a "key: value" line — ${text}`);
        const [, key, value] = m;
        if (!BASELINE_KEYS.has(key)) return problems.push(`${at}: unknown key "${key}"`);
        if (key === 'rules') {
          if (value) return problems.push(`${at}: "rules" must open a block, not hold ${value}`);
          inRules = true;
          return;
        }
        // Recorded either way, so the rules below report what the line said
        // rather than calling a key that is plainly there absent.
        top[key] = value || 'empty';
        if (/^\[.+\]$/.test(value)) problems.push(`${at}: "${key}" holds an inline list — write one entry per line`);
        return;
      }

      if (!inRules) return problems.push(`${at}: indented line outside the rules block — ${text}`);

      if (indent === 2 && text.startsWith('- ')) {
        entry = { at };
        rules.push(entry);
      } else if (indent !== 4 || !entry) {
        return problems.push(`${at}: not a rule entry or one of its fields — ${text}`);
      }

      const field = text.startsWith('- ') ? text.slice(2) : text;
      const m = /^([a-z_]+):\s*(.+)$/.exec(field);
      if (!m) return problems.push(`${at}: not a "key: value" field — ${field}`);
      const [, key, value] = m;
      if (!ENTRY_KEYS.has(key)) return problems.push(`${at}: unknown field "${key}" in a rule entry`);
      if (key in entry) return problems.push(`${at}: "${key}" set twice in one rule entry`);
      const read = scalar(value);
      if (read === null) return problems.push(`${at}: "${key}" is not a bare or plainly quoted value — ${value}`);
      entry[key] = read;
    });

  if (top.version !== '2') {
    problems.push(`${rel(path)}: version is ${top.version ?? 'absent'} — this shape is version 2`);
  }
  // A fingerprint is bound to the text it was taken from and reactivates on
  // the next edit. On prose this repository rewrites constantly that is a
  // suppression which expires without telling anybody, so the file declares an
  // empty list rather than leaving the key out and inviting one.
  if (top.fingerprints !== '[]') {
    problems.push(
      `${rel(path)}: fingerprints is ${top.fingerprints ?? 'absent'} — write "fingerprints: []" and suppress by rule identifier`,
    );
  }
  if (!rules.length) problems.push(`${rel(path)}: no rules — a baseline that suppresses nothing should be deleted`);

  const seen = new Set();
  for (const r of rules) {
    if (!r.rule_id) problems.push(`${r.at}: a rule entry with no rule_id`);
    else if (seen.has(r.rule_id)) problems.push(`${r.at}: ${r.rule_id} appears twice`);
    else seen.add(r.rule_id);
    // The scanner requires a reason too. This says so here, where the author
    // is, rather than on a runner an hour later.
    if (!r.reason) problems.push(`${r.at}: ${r.rule_id ?? 'a rule'} has no reason — a suppression nobody can audit`);
  }
  return { rules, problems };
}

const rootBaseline = join(root, BASELINE);
const skillBaselines = files.filter(f => rel(f).startsWith('skills/') && basename(f) === BASELINE);
let rootRules = null;
try {
  const parsed = readBaseline(rootBaseline);
  for (const p of parsed.problems) fail(p);
  rootRules = new Map(parsed.rules.filter(r => r.rule_id).map(r => [r.rule_id, r]));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  fail(
    `${BASELINE} is missing from the repository root — the SkillSpector workflow passes it explicitly, and without it every known false positive turns the gate red with no reason attached.`,
  );
}

if (!skillBaselines.length) {
  fail(
    `no ${BASELINE} under skills/ — a reader who scans the skill rather than the repository sees the findings and none of the reasons.`,
  );
}
for (const path of skillBaselines) {
  const parsed = readBaseline(path);
  for (const p of parsed.problems) fail(p);
  if (!rootRules) continue;
  for (const r of parsed.rules) {
    if (!r.rule_id) continue;
    const mirror = rootRules.get(r.rule_id);
    if (!mirror) {
      fail(`${r.at}: ${r.rule_id} is suppressed here and not at the repository root — the two baselines disagree`);
    } else if (mirror.reason !== r.reason) {
      fail(`${r.at}: ${r.rule_id} gives a different reason here than ${rel(rootBaseline)} does — say it once, the same way`);
    }
  }
}

// 8. The test suite runs here, under the same one command.
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
