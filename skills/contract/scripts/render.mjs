#!/usr/bin/env node
// The contract skill's interview script. Zero dependencies, Node 24.0.0 or
// later. It makes an interview's scratch folder, checks a draft, writes the
// page the person answers on, reads an answer block back against its draft,
// and deletes its own three files.
//
//   node render.mjs --version
//   node render.mjs --new-folder ['<parent>']
//   node render.mjs '<draft>' --check
//   node render.mjs '<draft>' --out '<page>' [--site] [--shared]
//   node render.mjs '<draft>' --answers '<block>' [--shared]
//   node render.mjs --clean '<folder>' [--draft]
//
// The checks are the format: no schema file ships beside them.
// references/hiring.md states the same shapes in prose, and
// tests/contract-render.test.mjs and tests/contract-interview.test.mjs bind the
// two. The page's logic, the block check included, sits in interview.js; this
// script requires it, so the page and the script run one copy.

import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
  "  node render.mjs '<draft>' --out '<page>' [--site] [--shared]\n" +
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
  // A fold that keeps the length, so the slice below cuts where it matched.
  const fold = process.platform === 'win32' ? Interview.folded : s => s;
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
    const size = statSync(file).size;
    ownerOnly(file);
    if (size > Interview.LIMITS.bytes) {
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
 * file Claude wrote with a tool that cannot set a mode is owner-only too. It
 * is set before the file is parsed, so a file that fails to parse is too.
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
  if (inWorkTree(parent)) {
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
  const h = homes();
  say(`ok: the block matches its draft, sha256 ${sha256(d.bytes)} — ${Interview.quoted(d.value.title, h.homes, h.fold)}`);
  return 0;
}

/* -- the page ----------------------------------------------------------------
 *
 * One self-contained file: the template, the Aviation bundle, the fonts as
 * data, the module and the draft, with nothing loaded from the network. */

/** The page's first line. `--out` overwrites a file only when its first line
 *  is this one, so it never replaces a page or file it did not write. A
 *  comment after the doctype keeps the page in standards mode. */
const MARKER = "<!doctype html><!-- the contract skill's interview page, written by render.mjs -->";

/* Each face with the range IBM declares for it: two rules for one family and weight with no range would leave
 * only the last in force. */
const LATIN1 =
  'U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, ' +
  'U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, ' +
  'U+2122, U+2212, U+FB01-FB02';
const PI =
  'U+03C0, U+0E3F, U+2000-200D, U+2010-2012, U+2015, U+2028-2029, U+202F, U+2032-2033, ' +
  'U+203E, U+205F, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, ' +
  'U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, ' +
  'U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+2219-221A, ' +
  'U+221E, U+222B, U+2236, U+2248, U+2260, U+2264-2265, U+2400-2421, U+2500-259F, ' +
  'U+25CA, U+2713, U+274C, U+2B0E-2B11, U+3000, U+FEFF, U+FFFD';
const FONTS = [
  ['400', 'IBMPlexMono-Regular-Latin1.woff2', LATIN1],
  ['400', 'IBMPlexMono-Regular-Pi.woff2', PI],
  ['500', 'IBMPlexMono-Medium-Latin1.woff2', LATIN1],
  ['500', 'IBMPlexMono-Medium-Pi.woff2', PI],
  ['600', 'IBMPlexMono-SemiBold-Latin1.woff2', LATIN1],
  ['600', 'IBMPlexMono-SemiBold-Pi.woff2', PI],
];

const cspHash = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** The page for a draft that passed its check. `opts.folder` is the scratch
 *  folder's name, or null; `opts.site` and `opts.shared` are the flags. */
function page(draft, draftBytes, opts) {
  const assets = resolve(here, '..', 'assets');
  const template = readFileSync(join(assets, 'template.html'), 'utf8');
  const kb = kindsBytes();
  // The module ends with its Node export line, which the page has no use for.
  const moduleSource = readFileSync(resolve(here, 'interview.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
  /* The Aviation design system, vendored whole from its dist/aviation.bundle.css
   * at 6297a04, the merge commit of its pull request 10 and the first to carry
   * the réseau ground the page stands on. Do not edit it in place: replace it
   * from the design system, and record the commit here when you do. */
  const aviation = readFileSync(join(assets, 'aviation.bundle.css'), 'utf8');
  const faces = FONTS.map(([weight, file, range]) => {
    const b64 = readFileSync(join(assets, file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:block;unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('\n');

  /* JSON inside a script block: every "<" is written as its escape, so no
   * draft string can close the block or open a comment in it. A script reads
   * the escape as "<". */
  const data = JSON.stringify({
    draft,
    kinds: JSON.parse(kb.toString('utf8')),
    hashes: { draft: sha256(draftBytes), kinds: sha256(kb) },
    site: opts.site,
    shared: opts.shared,
    folder: opts.folder,
  }).replace(/</g, '\\u003c');

  /* The policy line comes before every slot, so the template splits there:
   * the head above it holds no slot, and everything below is filled first and
   * then hashed. */
  const [head, tail] = template.split('/*CSP*/');
  if (tail === undefined || /\/\*[A-Z]+\*\//.test(head)) throw new Error('template: the policy slot must come before every other slot');

  /* One pass, with function replacements. A string replacement reads $& and
   * its kin as patterns, so draft text holding one would splice in a slab of
   * the template; filling slot after slot would let a title that spells a
   * later slot take that slot's fill. One regex over the template fills each
   * slot where the template has it, and never searches what a fill put in. */
  const fills = {
    '/*TITLE*/': () => draft.title.replace(/[<>&]/g, ''),
    '/*AVIATION*/': () => aviation,
    '/*FONTS*/': () => faces,
    '/*DATA*/': () => data,
    '/*MODULE*/': () => moduleSource,
  };
  const filled = tail.replace(/\/\*(?:TITLE|AVIATION|FONTS|DATA|MODULE)\*\//g, slot => fills[slot]());

  /* The content security policy: nothing from the network, the page's own
   * scripts and styles allowed by their hashes, fonts and images from inline
   * data only. The template uses no style attribute and no inline handler. */
  const hashesOf = tag => [...filled.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => cspHash(m[1]));
  // The policy hashes what the filled page holds, so it would allow a block a
  // fill slipped in. A page whose script and style blocks are not exactly the
  // template's own is never written.
  const blocks = (text, tag) => (text.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
  for (const tag of ['script', 'style']) {
    if (blocks(filled, tag) !== blocks(tail, tag)) throw new Error(`template: the filled page holds ${blocks(filled, tag)} ${tag} blocks, not the template's ${blocks(tail, tag)}`);
  }
  const csp = [
    "default-src 'none'",
    `script-src ${hashesOf('script').join(' ')}`,
    `style-src ${hashesOf('style').join(' ')}`,
    'font-src data:',
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return head + csp + filled;
}

/** The first line of a file, read from its first bytes only. */
function firstLine(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(MARKER.length + 2);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').split(/\r?\n/)[0];
  } finally {
    closeSync(fd);
  }
}

/** `--out`: check the draft, then write its page. */
function out(draftFile, pageFile, site, shared) {
  if (!pageFile.endsWith('.html')) {
    say('render.mjs: --out writes a page whose name ends in .html. Name another file.');
    return 2;
  }
  // lstat, not exists: a link at the target, even one to nothing, is not a
  // page this script wrote, and writing through it could land anywhere.
  let there;
  try {
    there = lstatSync(pageFile, { throwIfNoEntry: false });
  } catch (e) {
    say(`cannot read ${named(pageFile)}: ${e.code || e.name}`);
    return 2;
  }
  if (there) {
    let own = false;
    try {
      own = there.isFile() && firstLine(pageFile) === MARKER;
    } catch (e) {
      say(`cannot read ${named(pageFile)}: ${e.code || e.name}`);
      return 2;
    }
    if (!own) {
      say('render.mjs: that file exists and is not a page this script wrote, so --out leaves it. Name another file.');
      return 2;
    }
  }
  const read = readJson(draftFile, 'draft');
  if (!read.bytes) return read.code;
  const kinds = JSON.parse(kindsBytes().toString('utf8'));
  const h = homes();
  const { refusals, warnings } = Interview.checkDraft(read.value, kinds, h);
  if (refusals.length) {
    for (const [path, why] of refusals) say(`draft: ${path}: ${why}`);
    say(`draft: ${refusals.length} refusal(s); check the draft with --check`);
    return 1;
  }
  for (const [path, why] of warnings) tell(`warning: ${path}: ${why}`);
  // The top bar names the scratch folder, and only a scratch folder: any
  // other folder's name could be the person's own.
  const folder = !site && inScratch(pageFile) ? basename(dirname(resolve(pageFile))) : null;
  const html = page(read.value, read.bytes, { site, shared, folder });
  // The page holds the person's draft, so it is owner-only wherever it lands,
  // unless it is the published example, and owner-only before the draft is in
  // it: an earlier page is set to 600 first, and a new one is created at 600.
  // A new page is created exclusively, so nothing put at the target since the
  // look above is written through.
  const owner = posix && !site;
  if (owner && there) {
    try {
      chmodSync(pageFile, 0o600);
    } catch (e) {
      say(`cannot make ${named(pageFile)} owner-only, so nothing was written: ${e.code || e.name}`);
      return 2;
    }
  }
  try {
    writeFileSync(pageFile, html, { mode: owner ? 0o600 : 0o666, flag: there ? 'w' : 'wx' });
  } catch (e) {
    say(`cannot write ${named(pageFile)}: ${e.code || e.name}`);
    return 2;
  }
  say(`ok: wrote ${basename(pageFile)}, ${Buffer.byteLength(html).toLocaleString('en-US')} bytes, from sha256 ${sha256(read.bytes)} — ${Interview.quoted(read.value.title, h.homes, h.fold)}`);
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
    const draft = read.value;
    const kinds = JSON.parse(kindsBytes().toString('utf8'));
    const { refusals, warnings } = Interview.checkDraft(draft, kinds, homes());
    if (refusals.length) {
      for (const [path, why] of refusals) say(`draft: ${path}: ${why}`);
      say(`draft: ${refusals.length} refusal(s)`);
      return 1;
    }
    for (const [path, why] of warnings) tell(`warning: ${path}: ${why}`);
    // The hash comes first: Claude reads it from here, and the title is the
    // file's text, printed as a quoted, cut and masked literal.
    const h = homes();
    say(`ok: sha256 ${sha256(read.bytes)} — ${Interview.quoted(draft.title, h.homes, h.fold)}`);
    return 0;
  }
  if (args[1] === '--out' && values.length === 2 && args[2] === values[1] && args.length - 3 === flags.length - 1 && only('--out', '--site', '--shared')) {
    return out(values[0], values[1], flags.includes('--site'), flags.includes('--shared'));
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
