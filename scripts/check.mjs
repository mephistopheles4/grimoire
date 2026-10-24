#!/usr/bin/env node
// grimoire's whole contract. Zero dependencies, one command.
//
//   node scripts/check.mjs
//
// 1. Every artifact in the tree validates against the renderer its registry
//    row names, and every skill that ships artifacts has a row.
// 2. No file a skill or the mod ships carries a fixed path, nor does the root
//    package.json or a file under tests/container/. Both land in a
//    different directory under every install route, so a path naming one is
//    a defect.
//    2b. For every rule, not only 2: every file git tracks is one the walk
//    read, so no rule here skips a file that ships.
//    2c. A skill's frontmatter holds only the allow-listed keys, and no file
//    under skills/, nor the root package.json, nor a file under
//    tests/container/, nor .claude/settings.json or scripts/agent-check-guard.mjs,
//    holds a hidden control or line-separator character.
// 3. The single-pass tag strip does not come back, and no code fence in any
//    markdown file declares no language.
// 4. Every plugin in the marketplace manifest exists on disk with a manifest.
// 5. A change to a skill or the mod carries a version bump.
// 6. Nothing in the tree takes a dependency: no manifest but one, no lockfile,
//    no root binding.gyp, and no import of a bare specifier. The one manifest
//    it accepts is a root package.json holding only an `athanor` key, whose
//    image build folder is held to tests/container/. The
//    mod's module may import the engine's own `claude-code`, which the engine
//    supplies.
//    6b. Every pointer the engine follows to the mod's code, and every
//    relative import in it, lands inside the mod's folders.
//    6c. Nothing else the engine loads: no default component folder or file at
//    the root, and no manifest or marketplace key outside an allow-list.
//    6d. .claude/settings.json holds the one entry that registers
//    scripts/agent-check-guard.mjs and nothing else, and neither it nor the
//    script has a twin spelled in another case.
// 7.The SkillSpector baselines agree, so a rule reasoned away at the
//    repository root is reasoned away the same way inside a skill: the same
//    reason, and a skill entry no broader than the root's.
//    7a. No two paths under skills/ differ only in case.
//    7b. The SkillSpector allowance is well formed, names files that exist,
//    and pins each one by its current content.
// 8. The test suite passes. `node --test` ships with Node, so the tests cost no
//    dependency and this stays one command.

import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, posix, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { walk } from './lib/tree.mjs';
import { ARTIFACTS, rowFor } from './lib/registry.mjs';
import { ALLOWANCES, checkAgainstTree, diffAllowances, parseAllowances, readAllowances, unexplainedRehashes } from './lib/skillspector-allowances.mjs';
import { caseTwin, caseTwinPaths } from './lib/case.mjs';
import { masked, printable, shown } from './lib/printable.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const failures = [];
const fail = m => failures.push(m);
const relRaw = p => relative(root, p).split(sep).join('/');
// Every path a failure names comes through here, so a file name holding a
// line break prints on one line and a home in it prints masked. The rules
// below only test a path's prefix and suffix, which neither touches.
const rel = p => shown(relRaw(p));

// The walk reads .gitignore rather than a hardcoded skip set. scripts/lib/tree.mjs
// carries why, and it is shared with build-pages.mjs so the two cannot drift.
const { files, notes: walkNotes } = walk(root);
for (const n of walkNotes) console.log(`note: ${n}`);

// A host fallback named on the command line (issue 377). scripts/agent-check-guard.mjs
// refuses `node scripts/check.mjs` from an agent while athanor is on the
// machine, and tells the agent to add `--host-fallback=<reason>` when athanor
// produced no result. This is the only thing the flag does: the note puts the
// reason in the output, so the skip shows in the record. It changes no rule,
// no other line and no exit code. The reason is the agent's own text, so it
// prints through `shown` and is cut after masking, like any other string here,
// and a line break in it cannot hide or fake the note.
const fallbackArg = process.argv.slice(2).find(a => a.startsWith('--host-fallback='));
const fallbackReason = fallbackArg ? shown(fallbackArg.slice('--host-fallback='.length).trim()) : '';
if (fallbackReason) console.log(`note: host fallback named: ${fallbackReason.length > 200 ? `${fallbackReason.slice(0, 197)}...` : fallbackReason}`);

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
// Every other place the engine loads from is refused by rule 6c, so none of
// them is read here.
const isShipped = src => src.startsWith('skills/') || underMod(src);
// Code: every suffix Node or the engine loads a module from. The rules that
// read code read all of them, so a suffix is never a way round one. In any
// case, too: an install that folds case loads x.TS as it loads x.ts.
const CODE = /\.(ts|tsx|jsx|js|mjs|cjs|mts|cts)$/i;

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
// Scoped to skills/ and the mod's folders, plus the two places isContainerConfig
// names below, and not to the whole tree, because
// the rule is about what lands on somebody else's computer under an install
// route nobody here chooses. A repository script is not that, and
// tests/check-paths.test.mjs
// carries all five of these patterns on purpose — as the strings that prove
// the rule works. Counted from the file rather than remembered: an earlier
// draft of this comment said two, and the third was added in the same change
// that wrote it.
//
// The five, in order: the config folder under a home; a Linux home; a
// Windows home after any drive letter, with any number of backslashes, a
// forward slash or VS Code's encoded colon, and the bare root a name is
// joined to; a Mac home, a file link to one, and the bare root; and the same
// Windows home as Git Bash, WSL and Cygwin write it. `/Users` is matched
// case-sensitively, because lowercase /users/42 is a REST route. It must not
// follow a word character, a dot or a dash, so a URL route such as
// api/Users/42 passes. A `$` after a root is a template or shell variable
// joined to it. `\r?$` because a CRLF checkout leaves `\r` on every
// line split here. The rule reads text as written; what it does not catch,
// and why, is threat-model row 17, the one list of those to keep in step.
const FIXED = [
  /~\/\.claude/,
  /\/home\/[a-z$]/i,
  /(?<![A-Za-z])[A-Za-z](?::|%3A)(?:\\+|\/)Users(?!\w)/i,
  /(?<![\w.-])\/Users(?:\/[A-Za-z]|\/?(?=['"`$]|\r?$))/,
  /(?<![\w.-])(?:\/mnt|\/cygdrive)?\/[A-Za-z]\/Users(?:\/[A-Za-z]|\/?(?=['"`$]|\r?$))/,
];
// A minified file is one long line, and a refusal nobody can read is a refusal
// nobody acts on. The CI log is public and outlives a rewritten commit, so the
// account name is masked before the line is cut; see scripts/lib/printable.mjs.
const excerpt = s => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
// Two places are read beyond what ships under skills/ and the mod: the root
// package.json and the folder tests/container/. A whole-repository install
// carries them to every installer, and the athanor "commands" are where a
// pasted local path would land. Rule 5 does not take them: isShipped stays as
// it was, so a change to them asks for no version bump. Rule 2c reads the same
// two places, through the same predicate, for hidden characters: they are what
// CONTRIBUTING tells a reader to read before running a branch they did not write.
// In any case, as the manifests are: a checkout that folds case reads
// Tests/Container as tests/container, and Linux CI does not, so a spelling that
// differs only in case would skip these scans while athanor still found it.
const foldsTo = (name, wanted) => name === wanted || caseTwin(name, wanted);
const isContainerConfig = src => {
  if (src === 'package.json') return true;
  const [first, second, ...below] = src.split('/');
  return below.length > 0 && foldsTo(first, 'tests') && foldsTo(second, 'container');
};
const isReadForPaths = src => isShipped(src) || isContainerConfig(src);
// The two files that run when an agent session opens on a branch (issue 377):
// the settings file that registers the guard, and the guard. Like the container
// config, a reader reads them before opening a session on a branch they did not
// write, so rule 2c holds them to the hidden-character rule too. In any case,
// for the reason the container config is.
const GUARD_FILES = ['.claude/settings.json', 'scripts/agent-check-guard.mjs'];
const isGuardFile = src => GUARD_FILES.includes(src.toLowerCase());
for (const shipped of files.filter(f => isReadForPaths(rel(f)))) {
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
      // One failure a line: C:/Users/ matches two patterns, and one fix
      // clears both.
      if (FIXED.some(re => re.test(line))) {
        fail(`${rel(shipped)}:${i + 1} holds a fixed path: ${printable(excerpt(masked(line.trim())))}`);
      }
    });
}

// 2b. Every file git tracks is one the walk read.
//
// The walk skips what .gitignore matches, tracked or not. A file git tracks
// that also matches an ignore line ships in the plugin, and no rule here reads
// it. It gets there by `git add -f`, or by a pull request that adds an ignore
// line matching a file already shipped — a one-line housekeeping edit in
// review. `*.local.*` matches at any depth, and a local settings file is the
// one most likely to hold a person's own paths.
//
// The rule compares what git tracks with what the walk read, rather than
// asking git what it ignores. The walk reads .gitignore with its own reader,
// which trims both ends of a line where git trims only trailing spaces, so a
// line differing from a name by a trailing tab hides the file from the walk
// and not from git. Comparing with the walk's own list closes that whole
// class, whatever the cause. The whole tree, because rules 3 and 6 read the
// whole tree too.
//
// It needs this root to be the top of a git work tree. A tree copied for a
// test is not one, so locally the rule says so and skips. In CI it fails
// instead: a broken git step or a moved checkout must not turn the gate green.
const NOT_TOP = 'not the top of a git work tree, or git failed';
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
function isWorkTreeTop() {
  const top = git('rev-parse', '--show-toplevel');
  if (!top) return false;
  try {
    return samePath(realpathSync.native(resolve(top)), realpathSync.native(root));
  } catch {
    return false;
  }
}
if (!isWorkTreeTop()) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    fail(`the tracked-file check cannot run: ${NOT_TOP}. In CI that is a broken checkout, not a pass.`);
  } else {
    console.log(`note: ${NOT_TOP} — tracked-file check skipped`);
  }
} else {
  // -z so a name comes back as written, not quoted; -s for the mode, which is
  // how a submodule shows. Not through git(), which trims the output. Read as
  // bytes, because a name that is not UTF-8 decodes to a different name, the
  // lookup on disk then misses it, and it would read as deleted.
  let listed = null;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '-c', '-s'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    fail('the tracked-file check cannot run: git ls-files failed');
  }
  const walked = new Set(files.map(f => relRaw(f)).map(p => (process.platform === 'win32' ? p.toLowerCase() : p)));
  const entries = [];
  for (let at = 0; listed && at < listed.length; ) {
    const end = listed.indexOf(0, at);
    entries.push(listed.subarray(at, end === -1 ? listed.length : end));
    at = end === -1 ? listed.length : end + 1;
  }
  for (const bytes of entries.filter(b => b.length)) {
    const entry = bytes.toString('utf8');
    const tab = entry.indexOf('\t');
    const mode = entry.slice(0, entry.indexOf(' '));
    const path = entry.slice(tab + 1);
    if (!Buffer.from(entry, 'utf8').equals(bytes)) {
      fail(`${shown(path)} is tracked by git under a name that is not UTF-8, so the check cannot read it, and it ships. Rename it.`);
      continue;
    }
    if (mode === '160000') {
      fail(`${shown(path)} is a submodule — the check never reads its content, and it ships. Vendor the files or remove it.`);
      continue;
    }
    let st;
    try {
      st = lstatSync(join(root, ...path.split('/')));
    } catch (e) {
      // Deleted on disk and not yet committed: nothing here ships it. Any
      // other error is a file the check could not look at, which is a failure.
      if (e.code === 'ENOENT') continue;
      fail(`${shown(path)} is tracked by git and the check could not read it (${e.code}) — it ships unread.`);
      continue;
    }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    if (walked.has(process.platform === 'win32' ? path.toLowerCase() : path)) continue;
    fail(
      `${shown(path)} is tracked by git, and the check never read it, because .gitignore matches it — so it ships unread. Read it for home paths or secrets first. Then either untrack it (its content stays in history, so rotate any secret found), or remove the ignore line so the check reads it.`,
    );
  }
}

for (const skill of files.filter(f => f.endsWith('SKILL.md'))) {
  if (!/^---\r?\n[\s\S]*?^name:/m.test(readFileSync(skill, 'utf8'))) {
    fail(`${rel(skill)} has no frontmatter name — the invocation name would follow the directory`);
  }
}

// 2c. A skill's frontmatter holds only the keys below, and no file a skill
// ships holds a hidden character.
//
// Claude Code acts on some frontmatter keys: a `hooks` key registers hooks
// when the skill is invoked. `claude plugin validate --strict` checks that a
// frontmatter parses and reads no key's name, so a key like that could merge
// on review alone. This list is the keys the skills here use, decided at
// triage of issue 305. A key added here is a security change: say in the pull
// request what Claude Code does with it.
const SKILL_KEYS = new Set(['name', 'description', 'compatibility', 'license', 'allowed-tools', 'metadata']);
//
// The frontmatter is read by hand, as the baseline reader in rule 7 is: a key
// at the left margin, bare or quoted, then a colon. Indented lines, list items
// at the margin, blank lines and comments are values or nothing, and only key
// names are read. An indented line before the first key at the margin is
// refused: YAML takes a mapping indented as a whole as the top level, so its
// keys are top-level keys this reader would skip as values. Any other line at
// the margin sets keys this reader cannot name — a flow map, a `?` key, a `<<`
// merge, a tab-indented line — so it is refused rather than skipped. A lone CR
// breaks a YAML line as a line feed does, so each line is split on it too.
// Both fences are exactly `---`; a fence with anything after it is refused, as
// a loader might not close there. Every SKILL.md under skills/ is read, in any
// case, not only skills/<name>/SKILL.md: an install that folds case loads
// skill.md, and a nested one costs nothing to hold to the same list.
//
// The characters: every C0 control but tab, line feed and carriage return; a
// CR not followed by a line feed; DEL; every C1 control; the two Unicode line
// separators; the noncharacters U+FFFE and U+FFFF; and every default
// ignorable code point and bidi control, which take in the tag characters a
// model reads as letters, the zero-width characters, the soft hyphen, the
// variation selectors and the marks that reorder text. A BOM is exempt only
// as a file's first character. Each can make the diff a reviewer reads differ
// from the text the model reads. Every file is text
// but a binary kind listed below, and a file of that kind must open with its
// format's signature, so a text file renamed .woff2 is read as text. A new
// binary kind fails here until it is listed with its signature.
const BINARY = new Map([['.woff2', Buffer.from('wOF2')]]);
const binaryKind = f => BINARY.get(posix.extname(f.toLowerCase()));
const HIDDEN = /[\x00-\x08\x0B-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FFFE}\u{FFFF}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;
const FRONTMATTER_KEY = /^(?:"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_][^:#]*?))[ \t]*:(?:[ \t]|$)/;
const codePoint = c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
// A string from a file, for a failure line: masked before it is cut, as rule
// 2 does, so a cut cannot drop the home path that tells the masker the name.
const quoted = s => printable(excerpt(masked(s)));

for (const f of files.filter(f => relRaw(f).startsWith('skills/') || isContainerConfig(relRaw(f)) || isGuardFile(relRaw(f)))) {
  const bytes = readFileSync(f);
  const signature = binaryKind(relRaw(f));
  if (signature && bytes.subarray(0, signature.length).equals(signature)) continue;
  const text = bytes.toString('utf8').replace(/^\u{FEFF}/u, '');
  // Each character once a file, at its first line, with a count: one fix
  // clears every copy, and a file full of them should not bury the rest.
  const found = new Map();
  const split = text.split('\n');
  split.forEach((raw, i) => {
    // The CR of a CRLF ending is not a lone one; any other CR is, the last
    // one in a file with no line feed after it included.
    const line = i < split.length - 1 && raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    for (const [c] of line.matchAll(HIDDEN)) {
      const seen = found.get(c);
      if (seen) seen.count++;
      else found.set(c, { line: i + 1, count: 1 });
    }
  });
  for (const [c, { line, count }] of found) {
    const what = c === '\r' ? `a lone CR (${codePoint(c)})` : codePoint(c);
    const times = count > 1 ? `, ${count} times in the file` : '';
    fail(`${rel(f)}:${line} holds ${what}${times} — a hidden character can make the reviewed diff differ from what the model reads. Remove it.`);
  }
}

for (const f of files.filter(f => relRaw(f).startsWith('skills/') && basename(f).toLowerCase() === 'skill.md')) {
  const lines = readFileSync(f, 'utf8')
    .replace(/^\u{FEFF}/u, '')
    .split('\n')
    .map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[0] !== '---') {
    fail(`${rel(f)} does not open with a line of exactly ---, so the check cannot find its frontmatter`);
    continue;
  }
  const close = lines.findIndex((l, i) => i > 0 && l === '---');
  if (close === -1) {
    fail(`${rel(f)} has no closing line of exactly ---, so the check cannot tell its frontmatter from its body`);
    continue;
  }
  let sawKey = false;
  for (let i = 1; i < close; i++) {
    for (const seg of lines[i].split('\r')) {
      if (!seg.trim() || seg.trimStart().startsWith('#')) continue;
      if (seg.startsWith(' ')) {
        if (sawKey) continue;
        fail(`${rel(f)}:${i + 1} is indented before any key at the margin, so YAML may read it as a top-level key: ${quoted(seg)}`);
        continue;
      }
      if (seg === '-' || seg.startsWith('- ')) continue;
      const m = FRONTMATTER_KEY.exec(seg);
      if (!m) {
        fail(`${rel(f)}:${i + 1} holds a frontmatter line the check cannot read as one key: ${quoted(seg)}`);
        continue;
      }
      sawKey = true;
      const key = m[1] ?? m[2] ?? m[3];
      if (!SKILL_KEYS.has(key)) {
        fail(
          `${rel(f)}:${i + 1} has the frontmatter key "${quoted(key)}", which is not one of ${[...SKILL_KEYS].join(', ')}. Claude Code acts on some keys, such as hooks; add one to SKILL_KEYS in scripts/check.mjs only with a reason.`,
        );
      }
    }
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
    fail(`marketplace.json "${shown(String(p.name))}": source is "${shown(String(p.source))}"; this repo is one plugin, so it must be "./"`);
    continue;
  }
  if (p.name !== plugin.name) {
    fail(`marketplace.json calls the plugin "${shown(String(p.name))}", plugin.json calls it "${shown(String(plugin.name))}"`);
  }
  if (p.version !== undefined) {
    fail(`marketplace.json "${shown(String(p.name))}": drop "version" — plugin.json is where it lives, and two copies drift`);
  }
}
if (mkt.name === plugin.name) {
  fail(`the marketplace and the plugin are both named "${shown(String(mkt.name))}" — give the shelf and the book different names`);
}

// Every skill directory holds a SKILL.md. The default scan reads skills/<name>/,
// one level deep. A nested layout (skills/<category>/<name>/) would need a
// "skills" key in plugin.json, which rule 6c refuses until a rule reads where
// it points, so each skill sits at skills/<name>/.
for (const e of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  try {
    statSync(join(root, 'skills', e.name, 'SKILL.md'));
  } catch {
    fail(
      `skills/${e.name}/ has no SKILL.md — the default scan reads one level, so put each skill at skills/<name>/SKILL.md. A "skills" key in plugin.json that lists deeper folders is refused by rule 6c.`,
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
// Two ways in, so two rules. A manifest that can install, or a lockfile, is
// the install step this repository does not have; the one exemption below is a
// manifest that holds no dependency and nothing an install acts on. A bare
// specifier — an import path that is neither relative nor a node builtin — is
// a dependency whether or not a manifest declares it.
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
// In any case, too: the engine installs packages when the plugin root holds a
// manifest and a lockfile, and an install that folds case finds Package.json.
const isManifest = name => MANIFESTS.has(name) || [...MANIFESTS].some(m => caseTwin(name, m));
//
// One exemption, because athanor reads its configuration from nowhere else: a
// file named exactly `package.json`, in that case, at the root, whose top level
// is an object holding the key `athanor` and no other, with an object as its
// value. The limit is one key because npm and the skills CLI act on the others
// (`dependencies`, `scripts`, `bin`, `type`, `skills`). What is inside `athanor`
// is athanor's to validate, and it exits 125 on a key it does not know, with
// one exception: the folder the image build receives. The build has network
// access and takes the tracked files under the folder the `context` key names,
// as they are in the working tree, uncommitted edits included, and a branch
// sets the key. So the two keys that choose that folder must be present and
// hold today's values, and `inputs`, which adds files from outside it, is
// refused (issue 362, the owner's decision on the data review). Both keys are
// required, not only checked when present: athanor takes a missing `context`
// from wherever a linked Dockerfile really is. For the same reason a symbolic
// link at the folder or the Dockerfile is refused below; athanor follows links
// before it uses either path, so the strings alone prove nothing. A duplicate
// key only hides an earlier copy of the same name, and JSON.parse decodes
// escapes before the key is tested, as athanor's own parser does. The pin runs
// inside the check, after athanor has built the image from the branch, so on a
// branch nobody has read it holds what merges and not that run.
const BUILD_FOLDER = { dockerfile: 'tests/container/Dockerfile', context: 'tests/container' };
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
// Why a root package.json is not the accepted one and what to do about it, or
// null when it is accepted. The accepted file is athanor's configuration, so
// "delete it" is the wrong fix for it: each problem names its own.
function rootManifestProblem(f) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    // No parser text: Node's message quotes a window of the file, and a window
    // that starts after a home root has no root for the mask to find.
    return { problem: 'does not parse as JSON', fix: 'make it valid JSON holding only the "athanor" key' };
  }
  const only = 'holding only an "athanor" key whose value is an object';
  if (!isObject(parsed)) return { problem: 'is not a JSON object', fix: `make it an object ${only}` };
  const others = Object.keys(parsed).filter(k => k !== 'athanor');
  if (others.length) {
    return { problem: `also holds ${others.map(k => `"${shown(k)}"`).join(', ')}`, fix: 'keep only the "athanor" key (or delete the file if athanor is not wanted)' };
  }
  if (!('athanor' in parsed)) return { problem: 'holds no "athanor" key', fix: `put the athanor settings in an "athanor" key ${only}` };
  if (!isObject(parsed.athanor)) return { problem: 'has an "athanor" value that is not an object', fix: `make the "athanor" value an object` };
  const wrong = [
    ...Object.keys(BUILD_FOLDER).filter(k => !Object.hasOwn(parsed.athanor, k) || parsed.athanor[k] !== BUILD_FOLDER[k]),
    ...(Object.hasOwn(parsed.athanor, 'inputs') ? ['inputs'] : []),
  ];
  if (wrong.length) {
    return {
      problem: `does not keep the image build to ${BUILD_FOLDER.context}/ (${wrong.map(k => `"${k}"`).join(', ')}), and the build, which has network access, receives the tracked files under the folder it names, uncommitted edits included`,
      fix: `set "dockerfile" to ${BUILD_FOLDER.dockerfile} and "context" to ${BUILD_FOLDER.context}, and remove "inputs"`,
    };
  }
  return null;
}
for (const f of files.filter(f => isManifest(basename(f)))) {
  const isRoot = relRaw(f) === 'package.json';
  const rootProblem = isRoot ? rootManifestProblem(f) : null;
  if (isRoot && rootProblem === null) continue;
  const fix = isRoot ? ` — ${rootProblem.fix}. The one package.json this repository accepts is the root one, holding only an "athanor" key whose value is an object that keeps the build to tests/container/, and this one ${rootProblem.problem}.` : ' — delete it.';
  fail(
    `${rel(f)}: a dependency manifest or lockfile${fix} This repository takes no dependency and has no install step, which is what lets the tests run on \`node --test\` and the skill run from a checkout. See CONTRIBUTING.md, "Do not add a dependency", and SECURITY.md for why it matters more than it looks.`,
  );
}

// A symbolic link at the build folder, above it, or inside it. athanor follows
// links before it uses the configured paths, so a link at tests/container, or a
// Dockerfile that is a link, moves the build to wherever it points while the
// strings in the root package.json still read as the pinned values. The walk
// lists a link as a file and never enters it, which is why it is found here.
const isBuildFolderPath = p => {
  const [first, second, ...below] = p.split('/');
  return isContainerConfig(p) || (below.length === 0 && foldsTo(first, 'tests') && (second === undefined || foldsTo(second, 'container')));
};
for (const f of files.filter(f => isBuildFolderPath(relRaw(f)))) {
  const [first, second] = relRaw(f).split('/');
  if (relRaw(f) !== 'package.json' && (first !== 'tests' || (second !== undefined && second !== 'container'))) {
    fail(`${rel(f)} is spelled like ${BUILD_FOLDER.context}/ and differs from it only in case — a checkout that folds case would find the pinned folder through it, and Linux CI would not. Rename it.`);
  }
  if (lstatSync(f).isSymbolicLink()) {
    fail(`${rel(f)} is a symbolic link where the image build folder is held to ${BUILD_FOLDER.context}/ — athanor follows links, so the build would receive whatever the link points at. Replace it with a real file or folder.`);
  }
}

// The pinned Dockerfile has to be there and be a plain file, or the removed
// folder is replaced by a link under another spelling and nothing notices.
const rootManifest = files.find(f => relRaw(f) === 'package.json');
if (rootManifest && rootManifestProblem(rootManifest) === null) {
  const dockerfile = files.find(f => relRaw(f) === BUILD_FOLDER.dockerfile);
  if (!dockerfile || lstatSync(dockerfile).isSymbolicLink()) {
    fail(`${BUILD_FOLDER.dockerfile} is missing or is not a plain file, and the athanor key in the root package.json names it as the image build's Dockerfile.`);
  }
}

// With a root package.json in place, npm's git-package route runs a default
// native build from a binding.gyp at the root, with no `scripts` key to see.
// In any case, as the manifests are.
for (const f of files.filter(f => relRaw(f).toLowerCase() === 'binding.gyp' || caseTwin(relRaw(f), 'binding.gyp'))) {
  fail(`${rel(f)}: a native build file at the root — npm builds it at install, beside any root package.json, with no "scripts" key to see. Delete it.`);
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
          `${rel(f)}:${i + 1} imports "${shown(spec)}" — import a relative path or a node: builtin instead. A bare specifier is a dependency, and this repository has none, so nothing installs it and the file does not load. See CONTRIBUTING.md, "Do not add a dependency".`,
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
  const said = shown(spec);
  if (at.why) return void fail(`${what} "${said}", ${at.why} — no install route puts the plugin there`);
  if (!underMod(at.p)) return void fail(`${what} "${said}", which is ${shown(at.p)} — ${MOD_OUTSIDE}`);
  if (!isFile(at.p)) return void fail(`${what} "${said}", and ${shown(at.p)} is not there — the engine would fail to load it`);
  return at.p;
}
function hooksFile(src) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, ...src.split('/')), 'utf8'));
  } catch (e) {
    return fail(`${src} is not JSON (${shown(e.message)}) — the engine cannot read which modules it names, and neither can this check`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(`${src} is not a JSON object with a "modules" list`);
  }
  for (const key of Object.keys(parsed).filter(k => k !== 'modules')) {
    fail(`${src} holds "${shown(key)}" — the check reads only "modules", so anything else is engine-run code it cannot follow`);
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
        if (at.why) fail(`${src}:${i + 1} imports "${shown(m[2])}", ${at.why}`);
        else if (!underMod(at.p)) fail(`${src}:${i + 1} imports "${shown(m[2])}", which is ${shown(at.p)} — ${MOD_OUTSIDE}`);
      }
      if (COMMENT.test(line)) return;
      const found = [];
      for (const re of [FROM, SIDE_EFFECT, WRAPPED]) {
        const m = re.exec(line);
        if (m) found.push(m[2]);
      }
      for (const re of CALLED) for (const m of line.matchAll(re)) found.push(m[2]);
      for (const spec of found.filter(s => /^(?:[\\/]|[A-Za-z]:)/.test(s))) {
        fail(`${src}:${i + 1} imports "${shown(spec)}", an absolute path — no install route puts the plugin there`);
      }
    });
}
// A shipped root folder spelled in another case. The gate runs where case
// counts, and an install on Windows or macOS folds it, so `Hooks/hooks.json`
// would load there and be read by nothing here. skills/ for the same reason,
// and .claude-plugin/, whose manifest rule 6b reads by its exact name.
const ROOT_DIRS = ['skills', '.claude-plugin', ...MOD_DIRS];
for (const e of readdirSync(root, { withFileTypes: true })) {
  const twin = ROOT_DIRS.find(d => caseTwin(e.name, d));
  if (twin) fail(`${shown(e.name)}/ at the root is ${twin}/ in another case — an install that folds case loads it, and the check reads only ${twin}/. Rename it ${twin}/.`);
}
// The same for the hooks file inside its folder: `hooks/Hooks.json` loads where
// case folds and is read by nothing here.
for (const e of existsSync(join(root, 'hooks')) ? readdirSync(join(root, 'hooks')) : []) {
  if (caseTwin(e, 'hooks.json')) fail(`hooks/${shown(e)} is hooks/hooks.json in another case — an install that folds case loads it, and the check reads only hooks/hooks.json. Rename it.`);
}
// The same for the two manifests: every rule reads them by their exact names,
// and a checkout that folds case keeps one of two twins, which may be the one
// no rule read.
for (const e of readdirSync(join(root, '.claude-plugin'))) {
  for (const m of ['plugin.json', 'marketplace.json']) {
    if (caseTwin(e, m)) fail(`.claude-plugin/${shown(e)} is .claude-plugin/${m} in another case — a checkout that folds case keeps one of the two, and the check reads only .claude-plugin/${m}. Remove it.`);
  }
}

// 6c. Nothing else the engine loads.
//
// The engine loads components from more places than skills/ and the mod: the
// default folders and files at the plugin root, a manifest key that adds a
// component location, runs a command or changes what installs, and a
// marketplace entry key that appends components or replaces hooks. A file in
// any of them ships and runs on an installer's machine, and no rule above
// reads it. So a root entry named like one, in any case, fails; and each
// manifest and marketplace key must be on a short list of metadata and the two
// pointers 6b reads. A key off the list fails as an unknown key in a hooks
// file does, whatever the engine does with it today, so a key the engine adds
// later fails until someone reads what it does.
//
// Two gaps are accepted in threat-model row 13: a duplicate key is read as
// JSON.parse reads it, the last one kept, and a root name is compared across
// case only, not across the other ways a file system can equate two names.
//
// The places are the plugin manifest reference's "Standard layout" as fetched
// on 2026-10-18, beyond skills/ and hooks/hooks.json, which the rules above
// read. Unlike the keys, the places are a list of what is refused, so a
// default place the engine adds later passes until it is named here: read the
// reference again when the engine adds one. The root is read
// from the disk, not the walk, as the case rule above reads it: a local
// .mcp.json that git does not track fails too, because the engine loads one
// when it loads this folder as a plugin directory, as `claude --plugin-dir .`
// does. It reads names only and never opens the file.
//
// The lists read names, never values. LOAD_ROOTS lists what is refused, and
// the three key sets list what is allowed. To use a place, take it off
// LOAD_ROOTS and hold what it loads to the rules: add it to isShipped and rule
// 5's pathspec, as MOD_DIRS is. To use a key, add it to its set with a reason:
// a key that loads or runs nothing needs only the reason, and a key that does
// needs a rule that reads where it points, as 6b reads "hooks".
const LOAD_ROOTS = ['commands', 'agents', 'output-styles', 'workflows', 'themes', 'monitors', 'bin', '.mcp.json', '.lsp.json', 'settings.json', 'SKILL.md'];
const PLUGIN_KEYS = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'types', 'hooks']);
const MARKET_KEYS = new Set(['$schema', 'name', 'owner', 'description', 'plugins']);
// version stays on the entry's list so rule 4's message to drop it still fires.
const MARKET_ENTRY_KEYS = new Set(['name', 'source', 'description', 'category', 'keywords', 'version']);
const UNREAD = 'the engine loads components, runs commands or changes what installs from keys like it, and no rule here reads where they point. Remove it, or add it to that list in rule 6c of scripts/check.mjs with a reason, and with a rule that reads where it points if it loads or runs anything.';
// The file, the entry and the key are masked as one string, so an account
// name found in one is masked wherever it repeats on the line.
const keyFail = (where, key, set) => fail(`${shown(`${where} holds "${key}"`)}, which is not one of ${[...set].join(', ')} — ${UNREAD}`);
for (const key of Object.keys(plugin)) if (!PLUGIN_KEYS.has(key)) keyFail('.claude-plugin/plugin.json', key, PLUGIN_KEYS);
for (const key of Object.keys(mkt)) if (!MARKET_KEYS.has(key)) keyFail('.claude-plugin/marketplace.json', key, MARKET_KEYS);
for (const p of mkt.plugins) for (const key of Object.keys(p)) if (!MARKET_ENTRY_KEYS.has(key)) keyFail(`.claude-plugin/marketplace.json "${String(p.name)}"`, key, MARKET_ENTRY_KEYS);
for (const e of readdirSync(root, { withFileTypes: true })) {
  const hit = LOAD_ROOTS.find(d => e.name === d || caseTwin(e.name, d));
  if (hit) fail(`${shown(e.name)}${e.isDirectory() ? '/' : ''} at the root is a place the engine loads (${hit}) — it would load what no rule here reads. Remove it, or take it off LOAD_ROOTS in rule 6c of scripts/check.mjs and hold it to the rules the mod's folders are held to (isShipped and rule 5).`);
}

// 6d. The settings file holds the guard's entry and nothing else.
//
// Claude Code reads .claude/settings.json when a session opens in the folder,
// and it can register hooks, grant permissions, set environment variables and
// run a status line command. A pull request that edits it runs code on the
// reader's machine before anyone has reviewed the branch, and no rule above
// reads the file. So it is held to exactly the one entry that registers
// scripts/agent-check-guard.mjs, written here: any other hook, matcher,
// command, timeout or key fails, and so does a file that is not JSON. To add
// anything, change the entry here, and say in the pull request what Claude Code
// does with it. This runs when the check does, which is after the hook has
// already fired for a session opened on the branch; docs/security/threat-model.md
// says so, and CONTRIBUTING tells a reader to read a branch's hooks first.
//
// A spelling in another case is refused too: a checkout that folds case keeps
// one of two twins, which may be the one no rule read, and Claude Code loads
// the settings file by its folded name. The comparison is on the whole path.
const GUARD_ENTRY = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash|PowerShell',
        hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/scripts/agent-check-guard.mjs'], timeout: 10 }],
      },
    ],
  },
};
for (const f of files.map(relRaw)) {
  const twin = GUARD_FILES.find(g => caseTwin(f, g));
  if (twin) fail(`${shown(f)} is ${twin} in another case — a checkout that folds case keeps one of two twins, and Claude Code loads the settings file by its folded name. Rename it ${twin}.`);
}
if (existsSync(join(root, '.claude', 'settings.json'))) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8').replace(/^\u{FEFF}/u, ''));
  } catch {
    fail('.claude/settings.json is not JSON — Claude Code would read it as it can, and no rule here could say what it registers. Fix it, or remove it.');
  }
  if (settings !== undefined && !isDeepStrictEqual(settings, GUARD_ENTRY)) {
    fail('.claude/settings.json holds more or less than the one guard entry — Claude Code runs what it registers when a session opens on the branch, hooks, permissions, environment variables and status line commands included, and no rule here reads those. Remove the rest, or change GUARD_ENTRY in rule 6d of scripts/check.mjs and say in the pull request what Claude Code does with it.');
  }
}

// 7. The SkillSpector baselines agree: a skill's entry gives the root's reason and is never broader.
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
// Copies drift. The root file covers thirteen rules, a skill file the ones that
// fire inside it, and this rule holds the overlap to the same words. A rule
// quietly reasoned away in one file and not another is a suppression nobody
// has read.
//
// A skill's entry may be narrower than the root's, never broader. The root file
// is for a scan of the whole repository and keeps its entries rule-wide; a
// skill's file is for a scan of the skill's own folder, where a path is exact,
// so it may name the one file its rule fires on. Narrowing is allowed only as
// an exact path or an exact text, because this reader has no glob algebra and a
// wildcard would make "narrower" a claim nobody here could check.
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
// a rule identifier, an optional file glob, an optional message glob and a
// one-line reason, each value double-quoted. It is not a YAML parser and does not try to be. Adding one
// would be the dependency this repository does not take, so the shape is kept
// trivial instead, and anything outside it is named and refused rather than
// guessed at. A baseline this reader cannot understand is a baseline whose
// entries nobody here has checked.
const BASELINE = '.skillspector-baseline.yaml';
const BASELINE_KEYS = new Set(['version', 'fingerprints', 'rules']);
const ENTRY_KEYS = new Set(['rule_id', 'file', 'message', 'reason']);
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

function readBaseline(path, { skill = false } = {}) {
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
        if (!m) return problems.push(`${at}: not a "key: value" line — ${shown(text)}`);
        const [, key, value] = m;
        if (!BASELINE_KEYS.has(key)) return problems.push(`${at}: unknown key "${key}"`);
        if (key === 'rules') {
          if (value) return problems.push(`${at}: "rules" must open a block, not hold ${shown(value)}`);
          inRules = true;
          return;
        }
        // Recorded either way, so the rules below report what the line said
        // rather than calling a key that is plainly there absent.
        const read = scalar(value);
        if (read === null) return problems.push(`${at}: "${key}" is not a bare or plainly quoted value — ${shown(value)}`);
        top[key] = read || 'empty';
        if (/^\[.+\]$/.test(read)) problems.push(`${at}: "${key}" holds an inline list — write one entry per line`);
        return;
      }

      if (!inRules) return problems.push(`${at}: indented line outside the rules block — ${shown(text)}`);

      if (indent === 2 && text.startsWith('- ')) {
        entry = { at };
        rules.push(entry);
      } else if (indent !== 4 || !entry) {
        return problems.push(`${at}: not a rule entry or one of its fields — ${shown(text)}`);
      }

      const field = text.startsWith('- ') ? text.slice(2) : text;
      const m = /^([a-z_]+):\s*(.+)$/.exec(field);
      if (!m) return problems.push(`${at}: not a "key: value" field — ${shown(field)}`);
      const [, key, value] = m;
      if (!ENTRY_KEYS.has(key)) return problems.push(`${at}: unknown field "${key}" in a rule entry`);
      if (key in entry) return problems.push(`${at}: "${key}" set twice in one rule entry`);
      // An entry value is double-quoted, never bare. YAML ends a bare value at
      // a " #" comment and reads a bare ~ or null as no value at all, where
      // this reader would keep the whole line as text. Two files could then
      // agree here while the scanner applied a broader suppression than either
      // says. The top-level keys keep their bare form: `version: 2`.
      if (!value.startsWith('"')) return problems.push(`${at}: "${key}" must be double-quoted — ${shown(value)}`);
      const read = scalar(value);
      if (read === null) return problems.push(`${at}: "${key}" is not a plainly double-quoted value (no inner quote or escape) — ${shown(value)}`);
      // The scanner reads a rule_id as an fnmatch pattern, so a wildcard in one
      // suppresses a family of rules. A file or message of nothing but wildcard
      // characters reads as narrowing and narrows nothing.
      if (key === 'rule_id' && /[*?[]/.test(read)) return problems.push(`${at}: "rule_id" holds a wildcard — ${shown(value)}; name one rule`);
      if ((key === 'file' || key === 'message') && /^[*?[\]]*$/.test(read)) {
        return problems.push(`${at}: "${key}" is empty or made only of wildcard characters —${shown(value)}; it narrows nothing, so leave it out`);
      }
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

  // Rule ids are compared without regard to case: the scanner lower-cases both
  // sides before it matches, so "AR2" and "ar2" are one rule to it.
  const seen = new Map();
  for (const r of rules) {
    if (!r.rule_id) problems.push(`${r.at}: a rule entry with no rule_id`);
    else {
      const key = r.rule_id.toLowerCase();
      const earlier = seen.get(key) ?? [];
      if (!skill && earlier.length) {
        problems.push(
          earlier[0].rule_id === r.rule_id
            ? `${r.at}: ${r.rule_id} appears twice`
            : `${r.at}: ${r.rule_id} and ${earlier[0].rule_id} are one rule, because the scanner ignores letter case`,
        );
      } else if (skill && earlier.length) {
        // A skill baseline may name a rule once per file it fires in. A copy
        // with no file would cover the rest of the folder and make the others
        // pointless; two copies on one file are one entry written twice, and
        // the scanner lower-cases the path before it compares.
        if (r.file === undefined || earlier.some(e => e.file === undefined)) {
          problems.push(`${r.at}: ${r.rule_id} appears twice and a copy names no file — a repeated rule names a file on every copy`);
        } else if (earlier.some(e => e.file.toLowerCase() === r.file.toLowerCase())) {
          problems.push(`${r.at}: ${r.rule_id} appears twice for ${shown(r.file)} — one entry per file`);
        }
      }
      seen.set(key, [...earlier, r]);
    }
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
  rootRules = new Map(parsed.rules.filter(r => r.rule_id).map(r => [r.rule_id.toLowerCase(), r]));
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
  const parsed = readBaseline(path, { skill: true });
  for (const p of parsed.problems) fail(p);
  if (!rootRules) continue;
  for (const r of parsed.rules) {
    if (!r.rule_id) continue;
    const mirror = rootRules.get(r.rule_id.toLowerCase());
    if (!mirror) {
      fail(`${r.at}: ${r.rule_id} is suppressed here and not at the repository root — the two baselines disagree`);
      continue;
    }
    if (mirror.reason !== r.reason) {
      fail(`${r.at}: ${r.rule_id} gives a different reason here than ${rel(rootBaseline)} does — say it once, the same way`);
    }
    // A skill's entry is held to the root's one field at a time. Where the root
    // names no file, the skill may name one exact path; where it names one, the
    // skill names the same. Comparing the reason alone let one file suppress AR2
    // everywhere while the other suppressed it in one place, and called that
    // agreement.
    const wild = v => /[*?[]/.test(v);
    const neverBroader = "a skill entry may be narrower than the root's, never broader";
    const scope = (field, word, exact, none) => {
      const here = r[field];
      const there = mirror[field];
      const say = v => (v === undefined ? none : shown(v));
      const line = clause => fail(`${r.at}: ${r.rule_id} is ${word} ${say(here)} here and to ${say(there)} in ${rel(rootBaseline)} — ${clause}`);
      if (there !== undefined) {
        if (here !== there) line(neverBroader);
      } else if (here !== undefined && wild(here)) {
        line(`a narrowing of a rule-wide entry names ${exact}`);
      }
    };
    // Both lines print each glob through shown(): the root file sits outside
    // skills/, so the home-path rule never reads it, and the CI log is public.
    scope('file', 'narrowed to', 'one exact path', 'every file');
    // A message narrows the same way: the scanner suppresses a finding only
    // when its message, its finding text or its matched text matches.
    scope('message', 'matched to', 'one exact text', 'every message');
  }
}

// 7a. No two paths under skills/ are equal once case-folded. A baseline entry
// names its file, the scanner lower-cases both sides when it matches, and so a
// new file whose path differs from a named one only in case would keep the old
// suppression. On a file system that folds case, one of the pair could also
// overwrite the other at checkout. The walked tree is the tracked tree on a
// runner, which is where this matters.
for (const [a, b] of caseTwinPaths(files.map(relRaw).filter(p => p.startsWith('skills/')))) {
  fail(`${shown(a)} and ${shown(b)} differ only in case — the scanner matches a baseline's file without regard to case, and a checkout that folds case keeps one of them. Rename one.`);
}

// 7b. The SkillSpector allowance.
//
// .skillspector-allowances.json lists the partial reads this repository has
// accepted, and the workflow's gate trusts it. The gate does not read the tree,
// so this is where an entry is held to the files it names: the format, every
// path, and the content hash. The hash is the point. The scanner records a
// give-up once per file, reason and check, with no count and no place, so a
// second give-up inside an accepted file is invisible to the gate. Pinning the
// content makes every edit to an accepted file carry an allowance change in
// the same diff, where review sees it. scripts/lib/skillspector-allowances.mjs
// holds the reader; the gate and the strip step use the same one.
//
// A missing file fails rather than reading as empty. Empty lists are fine, so
// the file can stay once every entry is gone.
{
  const at = join(root, ALLOWANCES);
  const read = readAllowances(at);
  for (const p of read.problems) fail(p);
  if (read.value) {
    const skillDir = s => join(root, 'skills', ...s.split('/'));
    const problems = checkAgainstTree(read.value, {
      isSkill: s => existsSync(join(skillDir(s), 'SKILL.md')),
      readFile: (s, p) => {
        try {
          return readFileSync(join(skillDir(s), ...p.split('/')));
        } catch (e) {
          if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') return null;
          throw e;
        }
      },
    });
    for (const p of problems) fail(p);
    // What changed against the base, by name. An allowance entry is the one
    // place a partial read becomes acceptable, so every added, removed or
    // re-hashed entry is printed for the reviewer, not left to the diff.
    if (!mergeBase) {
      console.log(`note: cannot resolve ${baseRef} — ${ALLOWANCES} change notice skipped`);
    } else {
      const before = git('show', `${baseRef}:${ALLOWANCES}`);
      const parsedBefore = before === null ? null : parseAllowances(`${before}\n`, `${baseRef}:${ALLOWANCES}`).value;
      if (before !== null && !parsedBefore) {
        console.log(`note: ${ALLOWANCES} on ${baseRef} cannot be read — every entry here is listed as added`);
      }
      for (const p of unexplainedRehashes(parsedBefore, read.value)) fail(p);
      const changes = diffAllowances(parsedBefore, read.value);
      if (changes.length) {
        console.log(`note: ${ALLOWANCES} changed against ${baseRef}; review each by hand:`);
        for (const c of changes) console.log(`note:   ${c}`);
        // In CI, also where a reviewer already looks. A re-hash with a new
        // dated reason passes this check by design, so a line in a green job's log is a line nobody
        // reads: each change is a warning on the pull request too, and a list
        // on the run's summary page. Names only, never a hash.
        if (process.env.GITHUB_ACTIONS === 'true') {
          for (const c of changes) console.log(`::warning title=SkillSpector allowance changed::${c} — review the file by hand`);
        }
        if (process.env.GITHUB_STEP_SUMMARY) {
          try {
            appendFileSync(
              process.env.GITHUB_STEP_SUMMARY,
              `### ${ALLOWANCES} changed against ${baseRef}\n\nReview each by hand:\n\n${changes.map(c => `- ${c}`).join('\n')}\n\n`,
            );
          } catch (e) {
            console.error(`note: could not write the run summary: ${e.code || e.message}`);
          }
        }
      }
    }
  }
}

// 8. The test suite runs here, under the same one command.
//
// `node --test` ships with Node and needs no manifest, no install and no
// dependency, which is the only reason a repository with no dependency manifest
// can have tests at all. It runs last because the rules above are cheap and the
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
      // The root package.json holds no "type" key, because the one-key rule
      // refuses it, so Node warns once for each brigade module the tests
      // import: it detects them as ES modules and says so. The warning is
      // about the root file's shape and tells a reader nothing they can act on.
      // The same flag is in the "fast" command of that file. The engine itself
      // was checked and prints no such warning when it loads the mod.
      execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', ...tests], {
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
