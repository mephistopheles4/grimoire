#!/usr/bin/env node
// The contract skill's interview script. Zero dependencies, Node 20.0.0 or
// later. It makes an interview's scratch folder, checks a draft, reads an
// answer block back against its draft, and deletes its own three files.
//
//   node render.mjs --version
//   node render.mjs --new-folder ['<parent>']
//   node render.mjs '<draft>' --check
//   node render.mjs '<draft>' --answers '<block>' [--shared]
//   node render.mjs --clean '<folder>' [--draft]
//
// The checks are the format: no schema file ships beside them.
// references/hiring.md states the same shapes in prose, and
// tests/contract-render.test.mjs and tests/contract-interview.test.mjs bind the
// two. The page's logic, the block check included, sits in interview.js; this
// script requires it, so the page and the script run one copy.

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const Interview = createRequire(import.meta.url)(resolve(here, 'interview.js'));

/** The script's own version: the contract skill's version it ships with. */
const VERSION = '0.13.0';

/** SHA-256 over the exact bytes of a file, as the page and the block carry it.
 *  It binds a block to its draft and its kinds table, and proves nothing
 *  about who made either. */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const USAGE =
  'usage:\n' +
  "  node render.mjs --version\n" +
  "  node render.mjs --new-folder ['<parent>']\n" +
  "  node render.mjs '<draft>' --check\n" +
  "  node render.mjs '<draft>' --answers '<block>' [--shared]\n" +
  "  node render.mjs --clean '<folder>' [--draft]";

/* -- what the script prints -------------------------------------------------
 *
 * A draft and a block are a stranger's text, and what this script prints
 * goes back to the agent and the terminal. So every line shows each control
 * character, each character Unicode draws as nothing, and the line and
 * paragraph separators as a `\uXXXX` escape: a string cannot split a line,
 * fake a refusal, move the cursor or hide text. */
const UNSAFE = /[\p{Cc}\p{Default_Ignorable_Code_Point}\u{2028}\u{2029}]/gu;
const unit = u => `\\u${u.toString(16).padStart(4, '0')}`;
const escaped = s => s.replace(UNSAFE, c => [...c].map(ch => unit(ch.charCodeAt(0)) + (ch.length > 1 ? unit(ch.charCodeAt(1)) : '')).join(''));
/** A line to standard error: refusals and the `ok:` line. */
const say = line => console.error(escaped(line));
/** A line to standard output: warnings, the change list and the push-back list. */
const tell = line => console.log(escaped(line));

/* The home folders a draft string is checked against: this account's, and
 * the folder that holds it followed by a separator, so another account's home
 * on the same layout is found too, unless that folder is the file system's
 * root. Read from the system, never written in a shipped file. */
const homes = () => {
  const home = homedir();
  if (!home) return { homes: [], fold: false };
  const up = dirname(home);
  const list = [home];
  if (up !== parse(up).root) list.push(up + sep);
  return { homes: list, fold: process.platform === 'win32' };
};

/* A path the script is given. Every path in a command is single-quoted, so a
 * path holding one of the five single-quote characters PowerShell honours
 * (the ASCII quote and the four curly ones) could close its quotes, and a
 * control character could split the command. hiring.md refuses such a path
 * before composing a command; the script refuses it again. */
const QUOTES = /['\u{2018}\u{2019}\u{201A}\u{201B}]/u;
const pathFault = p => (QUOTES.test(p) ? 'a quote mark' : /\p{Cc}/u.test(p) ? 'a control character' : null);

/* The file a `cannot read` line names: as given, with a home folder shortened
 * to `~`, so the user name stays off the line. */
const named = file => {
  const home = homedir();
  if (!home || !isAbsolute(file)) return file;
  const fold = process.platform === 'win32' ? s => s.toLowerCase().replaceAll('/', '\\') : s => s;
  if (fold(file) === fold(home)) return '~';
  return fold(file).startsWith(fold(home + sep)) ? `~${file.slice(home.length)}` : file;
};

/** A draft or a block read from disk: its bytes and its parsed value, or the
 *  exit code after saying why not. `label` names it in every line. The size
 *  limit is checked before the file is read. A file that is not JSON is named
 *  with where it broke and none of its text: the parser's message can quote
 *  it. */
function readJson(file, label, strip = s => s) {
  let bytes;
  try {
    if (statSync(file).size > Interview.LIMITS.bytes) {
      say(`${label}: file: larger than the limit of ${Interview.LIMITS.bytes.toLocaleString('en-US')} bytes`);
      say(`${label}: 1 refusal(s)`);
      return { code: 1 };
    }
    bytes = readFileSync(file);
  } catch (e) {
    say(`cannot read ${named(file)}: ${e.code || e.name}`);
    return { code: 2 };
  }
  try {
    return { bytes, value: JSON.parse(strip(bytes.toString('utf8'))) };
  } catch (e) {
    const at = e instanceof SyntaxError && /\(line (\d+) column (\d+)\)/.exec(e.message);
    say(`cannot read ${named(file)}: not valid JSON${at ? `, at line ${at[1]} column ${at[2]}` : ''}`);
    return { code: 2 };
  }
}

const kindsBytes = () => readFileSync(resolve(here, 'kinds.json'));

/* -- the scratch folder -----------------------------------------------------
 *
 * One interview's draft, page and answers file live in a folder this script
 * makes, named `contract-interview-` and 16 random lowercase hex digits. On
 * POSIX it is mode 700, so everything in it is owner-only; on Windows the
 * per-user temp folder's own access keeps it private. */
const SCRATCH = /^contract-interview-[0-9a-f]{16}$/;
const FILES = { page: 'interview.html', answers: 'answers.json', draft: 'draft.interview.json' };
const posix = process.platform !== 'win32';
const inScratch = file => SCRATCH.test(basename(dirname(resolve(file))));

/* A file the script reads inside a scratch folder is set to mode 600, so a
 * file Claude wrote with a tool that cannot set a mode is owner-only too.
 * Outside such a folder, such as the repository's example, no mode changes. */
const ownerOnly = file => {
  if (posix && inScratch(file)) chmodSync(file, 0o600);
};

/** The folder a new scratch folder goes in when the person names none: the
 *  per-user temp folder on Windows and macOS, and on Linux and other POSIX
 *  systems a cache folder of the account's own, never a shared /tmp. */
function defaultParent() {
  if (process.platform === 'win32' || process.platform === 'darwin') return tmpdir();
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const dir = join(cache, 'contract-interview');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  return dir;
}

/** The git work tree a folder sits in, found by a `.git` entry in it or any
 *  folder above it. A linked worktree holds a `.git` file, not a folder. */
const inWorkTree = folder => {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
};

function newFolder(parentArg) {
  const parent = parentArg === undefined ? defaultParent() : resolve(parentArg);
  if (parentArg !== undefined && inWorkTree(parent)) {
    say('render.mjs: the parent folder is inside a git work tree, where the answers could be committed. Name a folder outside any repository.');
    return 2;
  }
  const folder = join(parent, `contract-interview-${randomBytes(8).toString('hex')}`);
  const fault = pathFault(folder);
  if (fault) {
    say(`render.mjs: the scratch folder's path holds ${fault}, which could break out of its quotes in a command. Name a parent folder.`);
    return 2;
  }
  try {
    mkdirSync(folder, { mode: 0o700 });
    if (posix) chmodSync(folder, 0o700);
  } catch (e) {
    say(`cannot make a folder in ${named(parent)}: ${e.code || e.name}`);
    return 2;
  }
  console.log(folder);
  return 0;
}

/** Delete the script's own files in a scratch folder: the page and the answers
 *  file, and with `--draft` the draft. Nothing else, and never the folder. */
function clean(folder, withDraft) {
  if (!SCRATCH.test(basename(resolve(folder)))) {
    say('render.mjs: --clean deletes only in a scratch folder, named contract-interview- and 16 lowercase hex digits. This folder is not one.');
    return 2;
  }
  let entries;
  try {
    if (!lstatSync(folder).isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
    entries = readdirSync(folder);
  } catch (e) {
    say(`cannot read ${named(folder)}: ${e.code || e.name}`);
    return 2;
  }
  const mine = [FILES.page, FILES.answers, ...(withDraft ? [FILES.draft] : [])];
  for (const name of mine) {
    const p = join(folder, name);
    if (!entries.includes(name) || lstatSync(p).isDirectory()) continue;
    unlinkSync(p);
    tell(`deleted ${name}`);
  }
  const left = readdirSync(folder).length;
  tell(`${left} other ${left === 1 ? 'entry' : 'entries'} left in the folder, which stays`);
  return 0;
}

/* Claude writes the pasted block verbatim, fence and all. One surrounding
 * code fence is stripped; anything else is read as the block. */
const unfence = text => {
  const m = /^\s*```[A-Za-z]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  return m ? m[1] : text;
};

/** `--answers`: check a block against its draft, then print the change list,
 *  the push-back list and the warnings. */
function answers(draftFile, blockFile, shared) {
  const d = readJson(draftFile, 'draft');
  if (!d.bytes) return d.code;
  const b = readJson(blockFile, 'block', unfence);
  if (!b.bytes) return b.code;
  ownerOnly(draftFile);
  ownerOnly(blockFile);
  const kb = kindsBytes();
  const kinds = JSON.parse(kb.toString('utf8'));
  const draftCheck = Interview.checkDraft(d.value, kinds, homes());
  if (draftCheck.refusals.length) {
    for (const [path, why] of draftCheck.refusals) say(`draft: ${path}: ${why}`);
    say(`draft: ${draftCheck.refusals.length} refusal(s); check the draft with --check`);
    return 1;
  }
  const { refusals } = Interview.checkBlock(b.value, d.value, kinds, { draft: sha256(d.bytes), kinds: sha256(kb) });
  if (refusals.length) {
    for (const [path, why] of refusals) say(`block: ${path}: ${why}`);
    say(`block: ${refusals.length} refusal(s); copy the block again from the page`);
    return 1;
  }
  const { changes, pushback, warnings } = Interview.readBack(b.value, d.value, kinds, { ...homes(), shared });
  tell('Changes:');
  for (const line of changes.length ? changes : ['  none']) tell(line);
  tell('Push back on:');
  for (const line of pushback.length ? pushback : ['  none']) tell(line);
  for (const [name, why] of warnings) tell(`warning: ${name}: ${why}`);
  say(`ok: the block matches its draft, ${d.value.title}`);
  return 0;
}

/** The command, as a function that returns its exit code. It never calls
 * `process.exit`, so a piped stdout drains before Node exits. */
function main(argv) {
  const args = argv.slice(2);
  const usage = () => {
    console.error(USAGE);
    return 2;
  };
  const flags = args.filter(a => a.startsWith('--'));
  const values = args.filter(a => !a.startsWith('--'));
  for (const p of values) {
    const fault = pathFault(p);
    if (fault) {
      say(`render.mjs: a path given holds ${fault}, which could break out of its quotes in a command. Name another path.`);
      return 2;
    }
  }
  const only = (...allowed) => flags.every(f => allowed.includes(f)) && new Set(flags).size === flags.length;

  if (args.length === 1 && args[0] === '--version') {
    console.log(`render.mjs ${VERSION}, Node ${process.version}`);
    return 0;
  }

  if (args[1] === '--check' && args.length === 2 && values.length === 1) {
    const draftFile = values[0];
    const read = readJson(draftFile, 'draft');
    if (!read.bytes) return read.code;
    ownerOnly(draftFile);
    const draft = read.value;
    const kinds = JSON.parse(kindsBytes().toString('utf8'));
    const { refusals, warnings } = Interview.checkDraft(draft, kinds, homes());
    if (refusals.length) {
      for (const [path, why] of refusals) say(`draft: ${path}: ${why}`);
      say(`draft: ${refusals.length} refusal(s)`);
      return 1;
    }
    for (const [path, why] of warnings) tell(`warning: ${path}: ${why}`);
    say(`ok: ${draft.title} — sha256 ${sha256(read.bytes)}`);
    return 0;
  }
  if (args[1] === '--answers' && values.length === 2 && args[2] === values[1] && args.length - 3 === flags.length - 1 && only('--answers', '--shared')) {
    return answers(values[0], values[1], flags.includes('--shared'));
  }
  if (args[0] === '--new-folder' && only('--new-folder') && values.length <= 1 && (values.length === 0 || args[1] === values[0])) return newFolder(values[0]);
  if (args[0] === '--clean' && only('--clean', '--draft') && values.length === 1 && args[1] === values[0]) return clean(values[0], flags.includes('--draft'));
  return usage();
}
// The last guard. A crash no rule foresees prints one line naming the kind of
// error, never a stack trace, which would carry the install path.
try {
  process.exitCode = main(process.argv);
} catch (e) {
  console.error(`render.mjs: the script stopped (${(e && e.code) || (e instanceof Error ? e.name : 'an error')})`);
  process.exitCode = 2;
}
