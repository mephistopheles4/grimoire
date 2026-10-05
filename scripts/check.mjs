#!/usr/bin/env node
// grimoire's whole contract. Zero dependencies, one command.
//
//   node scripts/check.mjs
//
// 1. Every artifact in the tree validates against the renderer its registry
//    row names, and every skill that ships artifacts has a row.
// 2. No file a skill or the mod ships carries a fixed path. Both land in a
//    different directory under every install route, so a path naming one is
//    a defect.
// 3. The single-pass tag strip does not come back, and no code fence in any
//    markdown file declares no language.
// 4. Every plugin in the marketplace manifest exists on disk with a manifest,
//    and every skill passes the format check the contract skill ships.
// 5. A change to a skill or the mod carries a version bump.
// 6. Nothing in the tree takes a dependency: no manifest, no lockfile, and no
//    import of a bare specifier. The mod's module may import the engine's own
//    `claude-code`, which the engine supplies.
//    6b. Every pointer the engine follows to the mod's code, and every
//    relative import in it, lands inside the mod's folders.
// 7. The SkillSpector baselines agree, so a rule reasoned away at the
//    repository root is reasoned away the same way inside a skill.
// 8. The test suite passes. `node --test` ships with Node, so the tests cost no
//    dependency and this stays one command.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, relative, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk } from './lib/tree.mjs';
import { ARTIFACTS, rowFor } from './lib/registry.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const failures = [];
const fail = m => failures.push(m);
const rel = p => relative(root, p).split(sep).join('/');

// The walk reads .gitignore rather than a hardcoded skip set. scripts/lib/tree.mjs
// carries why, and it is shared with build-pages.mjs so the two cannot drift.
const { files, notes: walkNotes } = walk(root);
for (const n of walkNotes) console.log(`note: ${n}`);

// What ships besides the skills: the Claude Code mod. The engine loads its
// hooks module and runs it in every session the plugin is installed in, so it
// is held to the rules a skill is held to — no fixed path, no dependency, and
// a version bump on any change. Two folders, because the engine reads
// hooks/hooks.json at the plugin's root, which is this repository's root, and
// that file may name a module kept in the mod's own folder beside skills/. A
// mod kept anywhere else is outside these rules until it is named here.
//
// The engine also writes its own type declarations into .claude-plugin/types/
// at every load from a folder the person owns. Those are the engine's files,
// not this repository's: .gitignore excludes them, so the walk never sees them.
const MOD_DIRS = ['brigade', 'hooks'];
const underMod = src => MOD_DIRS.some(d => src.startsWith(`${d}/`));
const isShipped = src => src.startsWith('skills/') || underMod(src);
// Code: every suffix Node or the engine loads a module from. The rules that
// read code read all of them, so a suffix is never a way round one.
const CODE = /\.(ts|tsx|jsx|js|mjs|cjs|mts|cts)$/;

// 1. Artifacts validate, against the renderer their registry row names.
//
// Both root scripts used to hard-code one glob and one renderer path, so a
// second skill's artifact was checked by nothing and published by nothing, and
// neither script said so. scripts/lib/registry.mjs is now the one table.
const artifacts = files
  .map(f => {
    const src = rel(f);
    return { path: f, src, row: rowFor(src) };
  })
  .filter(a => a.row);

for (const a of artifacts) {
  const renderer = join(root, ...a.row.renderer.split('/'));
  try {
    execFileSync(process.execPath, [renderer, a.path, ...a.row.checkArgs], { stdio: 'pipe' });
    console.log(`ok    ${a.src}`);
  } catch (e) {
    fail(`${a.src} failed ${a.row.checkArgs.join(' ')}:\n${(e.stderr || e.stdout || '').toString().trim()}`);
  }
}

// Every row names a renderer that is there, and matches something. A gate that
// quietly does nothing reads as a gate that passed.
for (const row of ARTIFACTS) {
  try {
    statSync(join(root, ...row.renderer.split('/')));
  } catch {
    fail(`registry row "${row.type}" names ${row.renderer}, and there is no such file — nothing would validate a ${row.suffix}`);
  }
  if (!artifacts.some(a => a.row === row)) {
    fail(
      `no ${row.suffix} anywhere in the tree, so the "${row.type}" row checked nothing. Every row is here because a skill ships that artifact, and every such skill ships a worked example — so either the example is gone or the row is. A check with nothing to check reads as a check that passed.`,
    );
  }
}

// A skill whose artifacts no row claims is reported rather than skipped. This
// is the failure the registry exists to make impossible to reach quietly: the
// skill ships, the check walks past it, and the run is green.
//
// Scoped to a skill that ships an examples/ directory, which is this
// repository's own mark of a skill that produces something — both skills here
// carry one, and a worked example is a file a reader opens. A prose-only skill
// produces no artifact, so there is no renderer for a row to name and no rule
// for it to break. Asking every skill for a row would be an instruction a
// contributor could follow and still fail this check.
for (const e of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  let ships = false;
  try {
    ships = statSync(join(root, 'skills', e.name, 'examples')).isDirectory();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (!ships) continue;
  if (!ARTIFACTS.some(row => row.renderer.startsWith(`skills/${e.name}/`))) {
    fail(
      `skills/${e.name}/ ships examples/ and has no row in scripts/lib/registry.mjs — nothing validates what it produces and nothing publishes it. Add a row naming its artifact suffix and its renderer.`,
    );
  }
}

// 2. No fixed paths in anything a skill or the mod ships.
//
// This read files named SKILL.md, so the three patterns never ran against a
// skill's lib/, reference/, renderer or schema. A hardcoded home directory
// anywhere but the skill's own prose passed the gate that exists to catch it.
//
// Scoped to skills/ and the mod's folders and not to the whole tree, because
// the rule is about what lands on somebody else's computer under an install
// route nobody here chooses. A repository script is not that, and
// tests/check-paths.test.mjs
// carries all three of these patterns on purpose — as the strings that prove
// the rule works. Counted from the file rather than remembered: an earlier
// draft of this comment said two, and the third was added in the same change
// that wrote it.
const FIXED = [/~\/\.claude/, /\/home\/[a-z]/i, /C:\\Users\\/i];
// A minified file is one long line, and a refusal nobody can read is a refusal
// nobody acts on.
const excerpt = s => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
for (const shipped of files.filter(f => isShipped(rel(f)))) {
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
// bypass is hard to build, so this guard holds a shape, not a hole.
// docs/security/scanners.md carries the triage.
const SINGLE_PASS = /=>\s*s\.replace\(\/<\[\^>\]\+>\/g/;
for (const f of files.filter(f => CODE.test(f) || f.endsWith('.html'))) {
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
// taken. See docs/security/scanners.md for why no linter is installed.
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

// 4b. Every skill passes the format check.
//
// A skill's frontmatter is read by the runtime before a word of its prose: the
// name it is invoked by, the description that decides when it loads, and any
// key that changes what the agent may do without asking. The frontmatter-name
// rule above reads one key. This runs the check the contract skill ships over
// every skill directory, so an unknown key, a field over its limit, or a
// sealed SKILL.md whose CONTRACT.md has drifted or gone goes red here, and
// not on an installer's machine.
//
// It is the same script, called the same way, that a person runs on a skill
// they are building. A second reader of the same format here would be a
// second place for the rules to drift. Its exit code is the verdict: 0 passes,
// warnings included, and anything else fails and names the skill. A warning,
// such as a body longer than the advised 500 lines, is printed as a note.
//
// The script is looked up in the tree being checked, and its absence fails. A
// gate that silently does nothing reads as a gate that passed.
const formatCheck = join(root, 'skills', 'contract', 'scripts', 'check.mjs');
let formatCheckThere = false;
try {
  formatCheckThere = statSync(formatCheck).isFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
if (!formatCheckThere) {
  fail(
    `skills/contract/scripts/check.mjs is missing, so no skill's frontmatter, mark or contract was checked — restore the contract skill's format check`,
  );
} else {
  for (const e of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = spawnSync(process.execPath, [formatCheck, join(root, 'skills', e.name)], { cwd: root, encoding: 'utf8' });
    const lines = (r.stdout || '').split('\n').filter(l => l !== '');
    if (r.status === 0) {
      console.log(`ok    skills/${e.name}/ (format)`);
      for (const w of lines.filter(l => l.startsWith('WARN '))) console.log(`note: skills/${e.name}/ ${w}`);
      continue;
    }
    const why = lines.filter(l => !l.startsWith('PASS ') && !l.startsWith('RESULT:'));
    const exit = r.error ? r.error.code : r.status ?? r.signal;
    fail(
      `skills/${e.name}/ fails the format check (skills/contract/scripts/check.mjs, exit ${exit}):\n${why.map(l => `      ${l}`).join('\n')}`,
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
//
// Two comparisons, because there are two ways to ship no update and the fix
// for each one is different. The merge base answers "did this branch move the
// version since it forked". The tip of the base branch answers "will merging
// this move the released version", and those differ the moment a sibling lands
// first. Both were true of #64 and #65: siblings forked from the same commit,
// both bumped 0.9.2 to 0.9.3, #64 merged, and #65 then read a bump at its
// merge base and passed a local run green against a main already at 0.9.3.
// Merging it would have released one version for two skill changes. It was
// caught by hand, and nothing in the repository required the rebase that fixed
// it.
//
// Equality is the whole of the silent case. Two branches bumping to different
// numbers conflict on the version line and GitHub refuses the merge out loud;
// only the identical bump merges clean and says nothing.
//
// Where each comparison fires is not symmetrical, and saying so is the point.
// On a pull request the runner checks out refs/pull/N/merge — this branch
// already merged into the base tip — so the merge base is that tip, the two
// questions collapse into one, and it is the first message that prints. Read
// from the checkout step of a run on this repository: "HEAD is now at 3f5e7e7
// Merge 2bca1a9 into a925af4". The second comparison is therefore for every
// run where HEAD is the branch itself: a local check, and a merge ref that has
// gone stale against the origin/main the job fetched.
//
// A local run also compares against the origin/main on disk, which is only as
// current as the last fetch. `git fetch origin` first, or the comparison is
// against a base that moved hours ago. CONTRIBUTING says so where the bump is
// asked for.
//
// What neither comparison holds is a green earned before the sibling landed.
// GitHub does not re-run a check when the base moves, so that pass stays on
// the pull request and stays mergeable. "Require branches to be up to date
// before merging" is what closes it, and it is a repository setting rather
// than anything this file can assert. This rule holds the question. It does
// not hold the whole guarantee on its own.
//
// The order matters as much as the pair. A branch that never bumped at all
// fails both comparisons, and only the first is worth reading — "you never
// bumped" is the smaller fact and the one to act on, and being told to rebase
// would send the author somewhere else entirely.
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
  // The mod ships in the same plugin and reaches nobody without a bump either.
  // A pathspec naming a folder the base never had is not an error to git, so
  // the commit that first adds the mod is read like any other.
  const touched = git('diff', '--name-only', `${mergeBase}..HEAD`, '--', 'skills', ...MOD_DIRS);
  const before = git('show', `${mergeBase}:.claude-plugin/plugin.json`);
  if (!touched) {
    // nothing to release
  } else if (!before) {
    // The manifest did not exist at the base, so there is no version to move
    // from. This is the layout move itself. Say it rather than pass in silence.
    console.log('note: no plugin.json at the base commit — version bump check skipped');
  } else {
    const files = touched.split('\n').length;
    const was = JSON.parse(before).version;
    if (was === plugin.version) {
      fail(
        `${files} skill or mod file(s) changed since ${baseRef}, but version is still ${plugin.version} — plugin users receive no update`,
      );
    } else {
      // Read here and not beside `before`, because a branch that never moved
      // the version asks the first question only and should spawn nothing for
      // the second. The names say which end of the base branch each one came
      // from: `was` is the fork point, this is the tip.
      const atBaseTip = git('show', `${baseRef}:.claude-plugin/plugin.json`);
      if (!atBaseTip) {
        // The merge base carries a manifest and the tip of the base branch
        // does not, which is the layout move landing the other way round. The
        // first comparison still ran, so this is one comparison skipped and
        // not the rule, and it says which.
        console.log(`note: no plugin.json at the tip of ${baseRef} — the released-version comparison was skipped`);
      } else if (JSON.parse(atBaseTip).version === plugin.version) {
        fail(
          `${files} skill or mod file(s) changed since ${baseRef}, and the version moved to ${plugin.version}, but ${baseRef} is already at ${plugin.version} — something landed there after this branch forked, so plugin users receive no update. Rebase onto ${baseRef} and bump again.`,
        );
      }
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
// Say the width, twice over. The rule reads every suffix the Claude Code
// engine loads a mod's module from — .ts, .tsx, .jsx, .js, .mjs, .cjs, .mts
// and .cts — which covers Node's own as well. It does not read HTML, so the
// inline script in lib/template.html is not scanned — a dynamic import there
// would pass. That file loads in a browser from a file: URL and has nowhere to
// resolve a bare specifier from, so the gap is stated rather than closed. A
// TypeScript `/// <reference types="..." />` line is a comment to this rule
// and is not read either.
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
// nothing installed. Everything else is a package. A leading `//` is not an
// absolute path: resolved against a file URL it names a host, which is a
// download, so it counts as a package.
const bare = spec =>
  spec.startsWith('//') || (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:'));
// Inside the mod, the engine supplies one more: `claude-code` and the paths
// under it, such as `claude-code/testing`. The name is matched whole, because
// a prefix match would pass `claude-code-x`, which is somebody's package. Each
// segment under it starts with a letter or a digit, so `claude-code/../chalk`
// cannot step out of the engine's name into a package's. Outside the mod
// nothing supplies it — Node would look in node_modules — so there it is a
// dependency like any other.
const ENGINE = /^claude-code(\/[A-Za-z0-9][\w.-]*)*$/;
const engine = spec => ENGINE.test(spec);
for (const f of files.filter(f => CODE.test(f))) {
  const inMod = underMod(rel(f));
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
      for (const spec of found.filter(s => bare(s) && !(inMod && engine(s)))) {
        fail(
          `${rel(f)}:${i + 1} imports "${spec}" — import a relative path or a node: builtin instead. A bare specifier is a dependency, and this repository has none, so nothing installs it and the file does not load. See CONTRIBUTING.md, "Do not add a dependency".`,
        );
      }
    });
}

// 6b. The engine runs only code the mod's folders hold.
//
// The rules above know the mod by folder name, which holds only while the
// code the engine runs sits in those folders. The engine finds that code
// through pointers: the manifest's "hooks" key, hooks/hooks.json at the
// plugin's root, and the "modules" each hooks file lists, each path relative
// to the hooks file. The module then imports the plugin's own files, and the
// engine loads each one it reaches. A pointer or an import out of the mod's
// folders would run code no rule here reads, so each one is resolved and held
// inside them. The manifest's "types" key names the mod's state contract and
// is held there too, so the mod stays in one place.
//
// It reads paths as text: backslashes as separators, `.` and `..` folded. A
// symbolic link inside a mod folder pointing out of it is not followed. The
// walk reads what git would commit, and a link is a file a reviewer sees in
// the diff. A hooks file holding anything but "modules" is refused rather
// than read, because a command hook runs a shell command this check cannot
// follow, and a key this check does not know is a pointer it cannot hold.
const MOD_OUTSIDE = "outside the mod's folders (" + MOD_DIRS.map(d => `${d}/`).join(', ') + ') — the engine would run code no rule here reads';
// The path a pointer lands on, from the repository root, or why it has none.
function landing(fromDir, spec) {
  const s = spec.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return { why: 'an absolute path' };
  const p = posix.normalize(posix.join(fromDir, s));
  if (p === '..' || p.startsWith('../')) return { why: 'a path out of the repository' };
  return { p };
}
const isFile = p => {
  try {
    return statSync(join(root, ...p.split('/'))).isFile();
  } catch {
    return false;
  }
};
// One pointer: where it lands, that it lands inside the mod, and that the file
// is there. Returns the landing path when all three hold.
function pointer(what, fromDir, spec) {
  const at = landing(fromDir, spec);
  if (at.why) return void fail(`${what} "${spec}", ${at.why} — no install route puts the plugin there`);
  if (!underMod(at.p)) return void fail(`${what} "${spec}", which is ${at.p} — ${MOD_OUTSIDE}`);
  if (!isFile(at.p)) return void fail(`${what} "${spec}", and ${at.p} is not there — the engine would fail to load it`);
  return at.p;
}
function hooksFile(src) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, ...src.split('/')), 'utf8'));
  } catch (e) {
    return fail(`${src} is not JSON (${e.message}) — the engine cannot read which modules it names, and neither can this check`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(`${src} is not a JSON object with a "modules" list`);
  }
  for (const key of Object.keys(parsed).filter(k => k !== 'modules')) {
    fail(`${src} holds "${key}" — the check reads only "modules", so anything else is engine-run code it cannot follow`);
  }
  const mods = parsed.modules ?? [];
  if (!Array.isArray(mods) || mods.some(m => typeof m !== 'string')) {
    return fail(`${src} "modules" is not a list of paths`);
  }
  for (const m of mods) pointer(`${src} names the module`, posix.dirname(src), m);
}
const manifestHooks = plugin.hooks === undefined ? [] : plugin.hooks;
if (typeof manifestHooks !== 'string' && !(Array.isArray(manifestHooks) && manifestHooks.every(h => typeof h === 'string'))) {
  fail(`.claude-plugin/plugin.json "hooks" is not a path or a list of paths — the check cannot read where it leads`);
} else {
  const named = (typeof manifestHooks === 'string' ? [manifestHooks] : manifestHooks)
    .map(h => pointer('.claude-plugin/plugin.json "hooks" names', '', h))
    .filter(Boolean);
  // The engine reads hooks/hooks.json at the plugin's root as well, whatever
  // the manifest says, so a file there is read like one the manifest names.
  if (isFile('hooks/hooks.json') && !named.includes('hooks/hooks.json')) named.push('hooks/hooks.json');
  for (const src of named) hooksFile(src);
}
if (plugin.types !== undefined) {
  if (typeof plugin.types !== 'string') fail(`.claude-plugin/plugin.json "types" is not a path`);
  else pointer('.claude-plugin/plugin.json "types" names', '', plugin.types);
}
// Relative paths in the mod's code. Rule 6 reads import lines in the shapes
// a formatter writes, which a hand can step round: a comment in front of the
// keyword, the path on the next line, a semicolon first. So here every quoted
// string in a mod code file that starts with `./` or `../`, or the same with a
// backslash, is resolved from
// that file, on every line, comments included, and fails when it lands out of
// the mod's folders. A string that is no import costs a false failure only if
// it climbs out, which nothing in the mod has reason to write. Only where it
// lands is held; whether the file is there is the engine's to say, since an
// import may leave out the suffix. It reads paths as written text: a string
// spelled with escapes or continued across lines is not seen, and review
// reads the diff for those, as it does for a computed path.
//
// An absolute import path is refused in the mod too, on the lines rule 6
// reads: no install route puts the plugin anywhere a fixed path could name,
// so it can only reach code outside it.
const RELATIVE = /(['"`])(\.{1,2}(?:\/|\\\\)[^'"`\n]*)\1/g;
for (const f of files.filter(f => CODE.test(f) && underMod(rel(f)))) {
  const src = rel(f);
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(RELATIVE)) {
        const at = landing(posix.dirname(src), m[2]);
        if (at.why) fail(`${src}:${i + 1} imports "${m[2]}", ${at.why}`);
        else if (!underMod(at.p)) fail(`${src}:${i + 1} imports "${m[2]}", which is ${at.p} — ${MOD_OUTSIDE}`);
      }
      if (COMMENT.test(line)) return;
      const found = [];
      for (const re of [FROM, SIDE_EFFECT, WRAPPED]) {
        const m = re.exec(line);
        if (m) found.push(m[2]);
      }
      for (const re of CALLED) for (const m of line.matchAll(re)) found.push(m[2]);
      for (const spec of found.filter(s => /^(?:[\\/]|[A-Za-z]:)/.test(s))) {
        fail(`${src}:${i + 1} imports "${spec}", an absolute path — no install route puts the plugin there`);
      }
    });
}
// A mod folder spelled in another case. The gate runs where case counts, and
// an install on Windows or macOS folds it, so `Hooks/hooks.json` would load
// there and be read by nothing here.
for (const e of readdirSync(root, { withFileTypes: true })) {
  const twin = MOD_DIRS.find(d => d.toLowerCase() === e.name.toLowerCase() && d !== e.name);
  if (twin) fail(`${e.name}/ at the root is ${twin}/ in another case — an install that folds case loads it, and the check reads only ${twin}/. Rename it ${twin}/.`);
}
// The same for the hooks file inside its folder: `hooks/Hooks.json` loads where
// case folds and is read by nothing here.
for (const e of existsSync(join(root, 'hooks')) ? readdirSync(join(root, 'hooks')) : []) {
  if (e !== 'hooks.json' && e.toLowerCase() === 'hooks.json') fail(`hooks/${e} is hooks/hooks.json in another case — an install that folds case loads it, and the check reads only hooks/hooks.json. Rename it.`);
}

// 7. The SkillSpector baselines agree.
//
// SkillSpector scans the prose this repository ships, and the workflow at
// .github/workflows/skillspector.yml fails on any finding a baseline does not
// cover. The baseline is therefore the argument, and there is a copy of it per
// directory somebody might scan: one at the top of each skill that needs it,
// and one at the repository root. Copies, because the scanner finds a baseline
// only at the top of the directory it was pointed at. The workflow scans each
// skill with the skill's own file, and so does a reader scanning a skill. The
// root file is for a reader who scans the whole repository, which is what the
// plugin route installs.
//
// Copies drift. The root file covers seven rules, a skill file the ones that
// fire inside it, and this rule holds the overlap to the same words. A rule
// quietly reasoned away in one file and not another is a suppression nobody
// has read.
//
// Every baseline under skills/ is read, not a named pair. What this does not
// hold is that each skill has one: it fails when skills/ carries no baseline
// at all, which is the shape of the tree having lost the argument entirely.
// The workflow holds the rest. It scans each skill with that skill's own file,
// so a skill that needs a baseline and lacks one goes red there, with the
// findings named — only the scanner knows where a finding lands.
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
        const read = scalar(value);
        if (read === null) return problems.push(`${at}: "${key}" is not a bare or plainly quoted value — ${value}`);
        top[key] = read || 'empty';
        if (/^\[.+\]$/.test(read)) problems.push(`${at}: "${key}" holds an inline list — write one entry per line`);
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
    `${BASELINE} is missing from the repository root — a reader who scans the whole repository, which is what the plugin route installs, would get every known false positive with no reason attached, and the skill baselines would have nothing to agree with.`,
  );
}

if (!skillBaselines.length) {
  fail(
    `no ${BASELINE} under skills/ — a reader who scans the skill rather than the repository sees the findings and none of the reasons, and so does the SkillSpector workflow, which scans each skill with its own file.`,
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
      continue;
    }
    if (mirror.reason !== r.reason) {
      fail(`${r.at}: ${r.rule_id} gives a different reason here than ${rel(rootBaseline)} does — say it once, the same way`);
    }
    // The file glob narrows a suppression, so two baselines that agree on the
    // rule and disagree on the glob do not agree. Comparing the reason alone
    // let one file suppress AR2 everywhere while the other suppressed it in
    // one place, and called that agreement.
    if ((mirror.file ?? null) !== (r.file ?? null)) {
      fail(
        `${r.at}: ${r.rule_id} is narrowed to ${r.file ?? 'every file'} here and to ${mirror.file ?? 'every file'} in ${rel(rootBaseline)} — one rule, one scope`,
      );
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
// GRIMOIRE_IN_TEST breaks the loop. tests/check-*.test.mjs run this script, and
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
console.log(`\nok: ${artifacts.length} artifact file(s), ${mkt.plugins.length} plugin(s)`);
