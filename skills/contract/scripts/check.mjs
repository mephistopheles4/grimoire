#!/usr/bin/env node
// Format check for a familiar — a skill's SKILL.md, an agent's <name>.md or
// <name>.toml, or Claude Code's main agent file, CLAUDE.md — and the contract
// it was built from. Zero dependencies.
//
//   node check.mjs <path>           check
//   node check.mjs --seal <path>    write the mark, then check
//
// <path> is a skill folder, the SKILL.md inside one, an agent file ending .md
// or .toml whose contract sits beside it as <name>.contract.md, or a CLAUDE.md
// with CLAUDE.contract.md beside it. A .md file holds YAML frontmatter; in a
// CLAUDE.md the block is optional, and the seal adds one at the very top (see
// "the main agent file"). A .toml file is a Codex agent file, and its mark is
// three comment lines at its end (see "toml"). For a skill, the seal covers
// every file in its folder but CONTRACT.md (see "the folder").
//
// Exit 0 pass (warnings allowed), 1 fail or cannot check, 2 usage or refusal.
// The exit code is the verdict. The skill also shows the person each WARN
// line, but no line of text changes the verdict. The text is built so that
// nothing a file says can speak through it: it never echoes a field value,
// except a `name` that already matched the name pattern, and every character
// it does echo from a file or a folder name is cleaned first.
//
// A setting the check does not know to be harmless is flagged, not refused:
// the person chose it, and the check says so. A few settings known to let the
// agent do more without asking get a sharper danger warning (see DANGER).
//
// The files this reads may come from a stranger, so the readers below are not
// a YAML parser or a TOML parser and do not try to be. Each reads one small
// subset of its format and calls everything else "cannot check", which is a
// failure. A reader that guessed at the rest would pass a file whose meaning
// it had not read.
//
// Node 20 or later, ESM, node: built-ins only. No regex here has a nested
// quantifier, and none runs over a whole file: every regex is applied to one
// line or one value. None runs on a line of a reference file either: such a
// line can be a megabyte long, and a pattern with no nested quantifier can
// still take time that grows with the square of its length, as a heading
// pattern does on a long run of spaces. The contents rule uses string
// operations only.

import {
  closeSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// 1 MiB per file, checked by the open file's own size before a byte is read.
//
// The cap bounds memory and time on a file nobody here has seen. Every rule
// after it is one pass per line with no regex over the whole file, so the cost
// grows in step with the size and the cap is the only bound the check needs.
// The largest SKILL.md in this repository is about 30 KB, some 34 times under
// the cap. A file of exactly 1 MiB checks in about 0.14 s, of which about
// 0.1 s is Node starting.
//
// A real file that meets it is refused as "cannot check" with the cap named in
// the reason. The fix is to move detail out into the skill's reference files,
// or to raise this constant with a measurement to back it.
const MAX_BYTES = 1024 * 1024;

// The seal covers a skill's whole folder, so the walk over it has limits of
// its own, each checked before the thing it bounds is read. Each is sized
// against this repository's two largest skill folders, eagle-eye and
// groundtrack, as measured on 2026-09-27. A text file in the folder keeps
// MAX_BYTES: the largest, groundtrack's assets/template.html at 111,495 bytes,
// sits 9.4 times under it. A folder at the total, 16 files of 1 MiB of text,
// checks in about 0.2 s, of which about 0.05 s is Node starting; 256 entries
// check in about 0.07 s.
//
// Entries, folders counted as well as files. It bounds the walk, which reads
// one entry at a time and stops here: each folder holds 24, 10.7 times under.
const MAX_ENTRIES = 256;
// Folders deep below the skill folder. It bounds how far down the walk goes:
// neither nests deeper than one.
const MAX_DEPTH = 8;
// Every file but SKILL.md and CONTRACT.md, which keep MAX_BYTES each, added
// up. It bounds memory, because every file's bytes are held until the paths
// are sorted and hashed: groundtrack's come to 652,436 bytes, 25.7 times under.
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
// One font or image, hashed as raw bytes and never decoded: the largest, a
// woff2 font of 17,872 bytes, sits 234 times under.
const MAX_BINARY_BYTES = 4 * 1024 * 1024;

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;
const BODY_LINES_MAX = 500;
const ECHO_MAX = 80;

const MARK_KEYS = ['contract-version', 'familiar-digest', 'contract-digest'];
const KNOWN_KEYS = new Set(['name', 'description', 'compatibility', 'license', 'allowed-tools', 'metadata']);
// A .toml file has keys of its own. Every other key, license and
// compatibility included, needs the contract's `Extra keys:` line, as a .md
// file's does, and then passes with any value.
const TOML_KNOWN_KEYS = new Set(['name', 'description', 'developer_instructions', 'sandbox_mode']);

// Three warnings follow Anthropic's Skills docs for a skill. Its overview
// says a name cannot contain "anthropic" or "claude" and a description cannot
// contain XML tags, and its best-practices page says a reference file over
// 100 lines opens with a contents list. The open Agent Skills specification
// sets none of them, so each only warns, and only on a skill: an agent file
// gets none. Like every warning, none of them fails the check or blocks a
// seal, and none echoes the text it read.
const ANTHROPIC_RULE = "a rule Anthropic's Skills docs set and the open Agent Skills specification does not";
// Matched as substrings of a name that already passed its shape rule, so the
// name is ASCII lower case and a substring test is exact.
const RESERVED_WORDS = ['anthropic', 'claude'];
// A tag shape: "<", an optional "/", a letter, then up to the rest of a
// description's length of characters other than "<", ">" or a line break,
// then ">". So <b>, </b> and <name> match, and a < b, x -> y and <3 do not.
// The middle class stops at the next "<", so the matches tried from one "<"
// never overlap those tried from the next, and one pass is linear in the
// description's length, which DESCRIPTION_MAX bounds anyway.
const TAG_RE = new RegExp(`<\\/?[A-Za-z][^<>\\r\\n]{0,${DESCRIPTION_MAX}}>`);
// A .md file in a skill's folder over this many lines needs a Contents
// heading within its first CONTENTS_WINDOW lines.
const CONTENTS_LINES_MAX = 100;
const CONTENTS_WINDOW = 30;

// The settings this check warns on. Neither kind of warning fails the check,
// and neither refuses a value: the person chose the setting, and the check
// says so. Warnings run only on keys that passed the keys rule.
//
// DANGER, by file kind, then by key: a setting known to let the agent do more
// without asking. A value in `safe` prints nothing; any other value, or any
// value at all when `safe` is null, prints the row's line. The value is never
// echoed, and the key and label come from this table. A Map, so a key such as
// "constructor" is simply not in it.
//
// Mirror of references/binding-*.md; change both.
const warnRow = (safe, label) => ({ safe: safe === null ? null : new Set(safe), label });
const ACT_OUTSIDE = 'may let the agent act outside a sandbox';
const OUTSIDE_FILE = 'loads instructions from a file the seal does not cover';
const DANGER = new Map([
  [
    '.toml',
    new Map([
      ['sandbox_mode', warnRow(['read-only', 'workspace-write'], ACT_OUTSIDE)],
      ['default_permissions', warnRow([':read-only', ':workspace'], ACT_OUTSIDE)],
      ['approval_policy', warnRow(['on-request'], 'may let the agent run commands without asking')],
      ['approvals_reviewer', warnRow(['user'], 'may let something other than the person approve commands')],
      ['web_search', warnRow(['disabled', 'cached'], 'may let the agent reach the live web')],
      ['model_instructions_file', warnRow(null, OUTSIDE_FILE)],
      ['experimental_instructions_file', warnRow(null, OUTSIDE_FILE)],
      ['experimental_compact_prompt_file', warnRow(null, OUTSIDE_FILE)],
      ['model_catalog_json', warnRow(null, 'loads a file the seal does not cover')],
      ['openai_base_url', warnRow(null, "sends the agent's work to a server the file names")],
    ]),
  ],
  [
    '.md',
    new Map([
      ['permissionMode', warnRow(['default', 'plan', 'manual', 'dontAsk'], 'may let the agent act without asking')],
      ['allowed-tools', warnRow(null, 'may let the agent use tools without asking')],
      ['omitClaudeMd', warnRow(null, "starts the agent without the person's CLAUDE.md files")],
      ['initialPrompt', warnRow(null, 'sends a first message the person did not type')],
    ]),
  ],
]);
// HARMLESS, by file kind: listed keys that print nothing. Every other key the
// contract lists, outside the known keys and DANGER, prints the plainer
// `unreviewed` warning. Sets, for the reason DANGER is a Map.
const HARMLESS = new Map([
  ['.toml', new Set(['model', 'model_reasoning_effort'])],
  ['.md', new Set(['tools', 'model', 'effort'])],
]);
// Two warning lines DANGER cannot hold, because each is one per item or one
// per line rather than one per key. A `tools` item in an agent .md written
// mcp__<server>__* prints TOOLS_GRANT under rule `danger`, once per item. A
// body line of a CLAUDE.md holding an @ import prints OUTSIDE_FILE under rule
// `import`, once per line (see importRule).
//
// Mirror of references/binding-claude.md; change both.
const TOOLS_GRANT = 'grants every current and future tool of one server, write tools included';
// The sandbox_mode values that print PASS sandbox-mode: its DANGER row's safe
// set, so the two cannot drift apart.
const SANDBOX_MODES = DANGER.get('.toml').get('sandbox_mode').safe;
// A contract's `Target:` names the tool the familiar is built for, and so the
// file ending that familiar needs. A Map, so a target such as "constructor"
// is simply not in it.
const TARGETS = new Map([
  ['claude', '.md'],
  ['antigravity', '.md'],
  ['codex', '.toml'],
]);
// A contract's `Kind:` line names what the familiar is: optional beside a
// skill or an agent, required beside a CLAUDE.md. KIND_OF maps each mode
// locate() returns to the word its contract writes, and is also the one list
// of modes: isMode() refuses any mode not in it. Maps, for the reason TARGETS
// is one.
const KIND_OF = new Map([
  ['skill', 'skill'],
  ['agent', 'agent'],
  ['main', 'main agent file'],
]);
const KINDS = new Set(KIND_OF.values());
const KIND_ARTICLE = new Map([
  ['skill', 'a skill'],
  ['agent', 'an agent'],
]);

// The main agent file: Claude Code's CLAUDE.md, with its contract beside it.
const MAIN_NAME = 'CLAUDE.md';
const MAIN_CONTRACT = 'CLAUDE.contract.md';
// Keys a CLAUDE.md must not hold. Claude Code finds a sub-agent by its `name`,
// not its file name, so with these the same file copied into an agents folder
// loads as a sub-agent.
const MAIN_REFUSED_KEYS = new Set(['name', 'description', 'tools']);
// A list item that is a list marker before an @ import: "-", "*", "+", or
// digits then "." or ")". Longer than this, the text before the @ is no
// marker, and it is never sliced.
const LIST_MARKER_MAX = 10;

// Why a `tools` item in an agent .md fails (see toolsItemOk). None names the
// item: it came from the file.
const TOOLS_REASON = {
  wildcard: 'a wildcard must name one whole server, written mcp__<server>__*',
  shape: 'an MCP tool must be written mcp__<server>__<tool>, or mcp__<server>__* for a whole server',
  comma: 'a quoted item holding a comma; write each tool as its own item',
  block: 'write tools as a flow list or on one line',
};
// What the tools-missing warning says (see toolsRules). Mirror of
// references/binding-claude.md; change both.
const TOOLS_MISSING = {
  none: 'no tools listed, so the agent may get every tool',
  emptyList: 'an empty tools list, so the agent gets no tools',
};

// Top-level keys admit upper case and "_", because a runtime key such as
// `permissionMode` or `developer_instructions` has to parse before the
// unknown-key rule can refuse it, or pass it when the contract lists it.
// Metadata keys stay lower case: the mark lives there, and nothing else this
// check reads does.
const TOP_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const META_KEY_RE = /^[a-z][a-z0-9-]*$/;
// Lower-case letters, digits and hyphens, and nameShapeOk() adds the rest: no
// leading, trailing or double hyphen. Written flat so it has no nested
// quantifier.
const NAME_CHARS_RE = /^[a-z0-9-]+$/;
const VERSION_RE = /^Version: (\S+)$/;
const EXTRA_RE = /^Extra keys: (.*)$/;
// Any line that starts "Target:", however it goes on, so a second one cannot
// hide by its spacing. A "Kind:" line is found the same way.
const TARGET_RE = /^Target:(.*)$/;
const KIND_RE = /^Kind:(.*)$/;
const MARK_LINE_RE = /^ {2}(contract-version|familiar-digest|contract-digest): .*$/;
// A flow sequence's item: a plain word, before the YAML value rules run on it.
// Shared by every flow list. The `tools` list of an agent .md adds its own
// item rule on top, toolsItemOk, and leaves this one as it is.
const FLOW_ITEM_RE = /^[A-Za-z0-9_-]+$/;
const BLOCK_HEADERS = new Set(['>', '|', '>-', '|-']);

// A name under a skill folder. Every file in this repository's skills fits.
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
// The names Windows keeps for a device, matched on the part before the first
// dot and in any case, so `con.md` is one of them.
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
// Fonts and images: the only files hashed as raw bytes. Decided by the name,
// not the content, so one stray byte cannot turn a text file into one the
// text rules skip.
const BINARY_RE = /\.(woff2|png|jpg|gif|webp)$/i;
// The seal's own temporary file, named as runSeal names it.
const SEAL_TEMP_RE = /^\.SKILL\.md\.[0-9]+\.[0-9a-f]{12}\.tmp$/;
const PLAIN_BAD_START = '{}[]&*!|>%@`#,\'"';

// A plain (unquoted) value that YAML reads as null, a boolean, a number or a
// date. This check reads every plain value as text, and a loader that reads
// the same file would not, so the two would disagree about what the file says.
// Such a value is "cannot check"; quoted, it is text to both. The word list is
// matched in any case, and holds YAML 1.1's y and n as well. The number
// patterns are the one pattern the format gives, split into flat halves so
// none has a nested quantifier, and tried after one leading sign is taken off,
// on the value in lower case with every "_" removed: loaders differ on the
// case of a prefix and on where an underscore may sit among the digits, so
// the check refuses the whole class rather than guess which reading a loader
// takes. Refusing a near miss is safe. A leading zero, as in 017, is YAML 1.1
// octal; the plain digit pattern already refuses it. The other number forms
// are tried after the same sign: hexadecimal (0x1F), binary (0b101), octal
// (0o17) and YAML 1.1 base 60 (1:30 or 190:20:30.15), checked a part at a time
// between the colons. A base prefix followed only by underscores, such as
// 0x_, is refused before the underscores are removed, since removing them
// would leave a bare prefix; a bare 0x with no underscore stays text. A date
// or a timestamp, such as 2026-09-27 or 2026-09-27T10:00:00Z, is refused by
// its start alone: four digits, a month and a day of one or two digits each,
// then the end or a T, a t, a space or a tab. That is broader than the
// loaders' own date rule, and refusing a near miss is safe.
const YAML_WORDS = new Set(['~', 'null', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n']);
const YAML_NUMBER_RES = [
  /^\.[0-9]+$/,
  /^\.[0-9]+[eE][-+]?[0-9]+$/,
  /^[0-9][0-9_]*$/,
  /^[0-9][0-9_]*\.[0-9]*$/,
  /^[0-9][0-9_]*[eE][-+]?[0-9]+$/,
  /^[0-9][0-9_]*\.[0-9]*[eE][-+]?[0-9]+$/,
  /^0x[0-9A-Fa-f_]+$/,
  /^0b[01_]+$/,
  /^0o[0-7_]+$/,
];
const BASE_PREFIX_UNDERSCORES_RE = /^0[xXbBoO]_+$/;
const YAML_DATE_RE = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:$|[Tt \u{9}])/u;
const BASE60_FIRST_RE = /^[0-9][0-9_]*$/;
const BASE60_PART_RE = /^[0-5]?[0-9]$/;
const BASE60_LAST_FRACTION_RE = /^[0-5]?[0-9]\.[0-9_]*$/;

// The seal writes contract-version as a plain (unquoted) value, because a
// quoted dotted value reads to some prose scanners as the name of a file that
// is not there. So the seal takes only one shape of version: numbers separated
// by at least two dots, such as 0.5.0, then optionally a - or + and a suffix
// of letters, digits, dots and hyphens. PyYAML reads that shape as text, and
// the contract's question 19 keeps other loaders open. A bare number such as
// 0.5 reads as a number, and a date such as 2026-09-27 reads as a date to
// PyYAML, so both are refused. Checked in flat pieces, so no regex has a
// nested quantifier.
const VERSION_PART_RE = /^[0-9]+$/;
const VERSION_SUFFIX_RE = /^[0-9A-Za-z.-]+$/;

class Refusal extends Error {
  constructor(rule, reason) {
    super(reason);
    this.rule = rule;
    this.reason = reason;
  }
}

class CannotCheck extends Error {
  constructor(line, reason) {
    super(reason);
    this.line = line;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- output

// Characters a file must not hold, because they change what a reader sees
// without being seen: every default-ignorable code point, which takes in tag
// characters, zero-width characters, the word joiner, the soft hyphen,
// variation selectors and Hangul fillers; the bidirectional marks, overrides
// and isolates, named on their own as well; and a byte-order mark anywhere
// but the one leading mark the reader strips. A model reads each of them
// while a person sees nothing. No default-ignorable code point sits below
// U+00AD, the soft hyphen, so the common case never reaches the regex.
const DEFAULT_IGNORABLE_RE = /^\p{Default_Ignorable_Code_Point}$/u;

function isInvisible(cp) {
  if (cp < 0xad) return false;
  return (
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0x061c ||
    cp === 0x2060 ||
    cp === 0xfeff ||
    DEFAULT_IGNORABLE_RE.test(String.fromCodePoint(cp))
  );
}

// What an echo must not carry. Control characters can move a terminal's
// cursor or colour, and a line or paragraph separator starts a new line for
// some readers and not others — a second line that could claim a verdict. The
// invisible set can reorder or hide what a person reads. The exit code is the
// verdict whatever the text says; this keeps the text honest as well.
function mustClean(cp) {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || isInvisible(cp);
}

/** Echo text from input: unsafe characters become '?', cut to 80 code points. */
function clean(text) {
  let out = '';
  let n = 0;
  for (const ch of String(text)) {
    if (n >= ECHO_MAX) break;
    out += mustClean(ch.codePointAt(0)) ? '?' : ch;
    n += 1;
  }
  return out;
}

/**
 * The same cleaning with no cut. Used only for the path --seal wrote, which a
 * person has to read whole to know where the write landed.
 */
function cleanUncut(text) {
  let out = '';
  for (const ch of String(text)) out += mustClean(ch.codePointAt(0)) ? '?' : ch;
  return out;
}

class Report {
  constructor() {
    this.lines = [];
    this.failed = false;
  }
  add(status, rule, reason) {
    this.lines.push(reason === undefined ? `${status} ${rule}` : `${status} ${rule}: ${reason}`);
  }
  pass(rule, reason) {
    this.add('PASS', rule, reason);
  }
  warn(rule, reason) {
    this.add('WARN', rule, reason);
  }
  fail(rule, reason) {
    this.failed = true;
    this.add('FAIL', rule, reason);
  }
  cannot(rule, reason) {
    this.failed = true;
    this.add('CANNOT-CHECK', rule, reason);
  }
}

// ---------------------------------------------------------------- reading

/**
 * Split decoded text into lines, keeping each line's own terminator. The seal
 * writes lines back with the ending they came with, so a CRLF file keeps its
 * endings and changes only in the mark lines. A lone CR ends a line here too,
 * and is kept as that line's ending so the character rule can see it: a file
 * holding one is refused, never sealed (see isRefusedChar).
 */
function splitRaw(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      const eol = text.charCodeAt(i + 1) === 10 ? '\r\n' : '\r';
      out.push({ text: text.slice(start, i), eol });
      i += eol.length - 1;
      start = i + 1;
    } else if (c === 10) {
      out.push({ text: text.slice(start, i), eol: '\n' });
      start = i + 1;
    }
  }
  out.push({ text: text.slice(start), eol: '' });
  return out;
}

/**
 * Read one file: size from the open file before reading, a bounded read,
 * strict UTF-8, one leading BOM stripped, CRLF normalised to LF. A lone CR
 * also ends a line in `lines` and `text`, and stays in its line's `eol` in
 * `rawLines`, where the character rule finds it and refuses the file.
 * Returns { ok: true, bom, rawLines, lines, text } or { ok: false, why }.
 *
 * The size comes from the open descriptor rather than the path, so a file
 * swapped between the two cannot pass the cap and then be read whole. A read
 * that returns a different count from that size means the file changed while
 * it was read, and a checked prefix is not a checked file.
 */
function readText(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    return { ok: false, why: `cannot be opened (${clean(err.code ?? 'error')})` };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, why: 'is not a regular file' };
    if (st.size > MAX_BYTES) return { ok: false, why: 'is larger than 1 MiB' };
    const buf = Buffer.alloc(st.size + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_BYTES) return { ok: false, why: 'is larger than 1 MiB' };
    if (total !== st.size) return { ok: false, why: 'changed while it was read' };
    let decoded;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, total));
    } catch {
      return { ok: false, why: 'is not valid UTF-8' };
    }
    const bom = decoded.charCodeAt(0) === 0xfeff;
    const raw = bom ? decoded.slice(1) : decoded;
    const rawLines = splitRaw(raw);
    const lines = rawLines.map(l => l.text);
    return { ok: true, bom, rawLines, lines, text: lines.join('\n') };
  } finally {
    closeSync(fd);
  }
}

/** First invisible character in normalised text (the leading BOM is already gone). */
function findInvisible(text) {
  let line = 1;
  for (const ch of text) {
    if (ch === '\n') {
      line += 1;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (isInvisible(cp)) return { line, cp };
  }
  return null;
}

function hex4(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

// The character rule: characters no text file the check reads may hold. A
// line or paragraph separator (U+2028, U+2029) or NEL (U+0085) starts a new
// line for some readers and not others, and so does a lone CR. Every other C0
// control but tab, DEL and every C1 control can move a terminal's cursor or
// read as a line break to some tool, and U+FFFE and U+FFFF are outside the
// characters YAML allows. A file holding one reads one way to this check and
// another way to some loader, so it is cannot-check: refused, not read. The
// rule is its own function, kept apart from isInvisible and mustClean, so
// neither of those changes meaning. Every code point here is in the Basic
// Multilingual Plane, and none is a surrogate, so one UTF-16 code unit is
// enough to test.
function isRefusedChar(c) {
  return (c < 0x20 && c !== 9) || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || c === 0xfffe || c === 0xffff;
}

/**
 * Every line of a file readText read that holds a refused character, with the
 * first one on each line: [{ line, what }]. Each line's own text and its own
 * ending are scanned, never the joined text, whose endings are all LF.
 */
function findRefused(file) {
  const hits = [];
  file.rawLines.forEach((raw, i) => {
    const t = raw.text;
    for (let j = 0; j < t.length; j += 1) {
      const c = t.charCodeAt(j);
      if (isRefusedChar(c)) {
        hits.push({ line: i + 1, what: hex4(c) });
        return;
      }
    }
    if (raw.eol === '\r') hits.push({ line: i + 1, what: 'a carriage return with no line feed after it' });
  });
  return hits;
}

// ---------------------------------------------------------------- frontmatter

function isBlank(line) {
  for (let i = 0; i < line.length; i += 1) if (line[i] !== ' ') return false;
  return true;
}

function isComment(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i += 1;
  return line[i] === '#';
}

/** Leading run of spaces and tabs: { width, tab } where tab says a tab is in it. */
function leading(line) {
  let i = 0;
  let tab = false;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === '\t') tab = true;
    i += 1;
  }
  return { width: i, tab };
}

function trimEndSpaces(s) {
  let end = s.length;
  while (end > 0 && (s[end - 1] === ' ' || s[end - 1] === '\t')) end -= 1;
  return s.slice(0, end);
}

function skipSpaces(s) {
  let i = 0;
  while (i < s.length && s[i] === ' ') i += 1;
  return s.slice(i);
}

/** Frontmatter bounds: index of the closing '---', or -1 when there is none. */
function findFrontmatter(lines) {
  if (lines[0] !== '---') return -1;
  for (let i = 1; i < lines.length; i += 1) if (lines[i] === '---') return i;
  return -1;
}

function parseDoubleQuoted(raw, ln) {
  let out = '';
  let i = 1;
  for (;;) {
    if (i >= raw.length) throw new CannotCheck(ln, 'a double-quoted value that does not close on its line');
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next !== '"' && next !== '\\') throw new CannotCheck(ln, 'a backslash escape other than \\" or \\\\');
      out += next;
      i += 2;
    } else if (ch === '"') {
      i += 1;
      break;
    } else {
      out += ch;
      i += 1;
    }
  }
  if (trimEndSpaces(raw.slice(i)) !== '') throw new CannotCheck(ln, 'text after a closing quote (for example a trailing comment)');
  return out;
}

function parseSingleQuoted(raw, ln) {
  let out = '';
  let i = 1;
  for (;;) {
    if (i >= raw.length) throw new CannotCheck(ln, 'a single-quoted value that does not close on its line');
    const ch = raw[i];
    if (ch === "'") {
      if (raw[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      i += 1;
      break;
    }
    out += ch;
    i += 1;
  }
  if (trimEndSpaces(raw.slice(i)) !== '') throw new CannotCheck(ln, 'text after a closing quote (for example a trailing comment)');
  return out;
}

/** True when a value split on its colons is a YAML 1.1 base-60 number (see YAML_WORDS). */
function yamlBase60(unsigned) {
  const parts = unsigned.split(':');
  if (parts.length < 2) return false;
  if (!BASE60_FIRST_RE.test(parts[0])) return false;
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (!BASE60_PART_RE.test(parts[i])) return false;
  }
  const last = parts[parts.length - 1];
  return BASE60_PART_RE.test(last) || BASE60_LAST_FRACTION_RE.test(last);
}

/** True when YAML would read this plain value as null, a boolean, a number or a date. */
function yamlReadsAsNonText(v) {
  const lower = v.toLowerCase();
  if (YAML_WORDS.has(lower)) return true;
  if (YAML_DATE_RE.test(v)) return true;
  const unsigned = v[0] === '-' || v[0] === '+' ? v.slice(1) : v;
  // A base prefix followed only by underscores, such as 0x_, which removing
  // the underscores below would leave as a bare prefix the patterns read as
  // text. A bare 0x with no underscore stays text.
  if (BASE_PREFIX_UNDERSCORES_RE.test(unsigned)) return true;
  // Lower case, every "_" removed: see YAML_WORDS for why the whole class.
  const bare = unsigned.toLowerCase().replaceAll('_', '');
  if (bare === '.inf' || bare === '.nan') return true;
  if (YAML_NUMBER_RES.some(re => re.test(bare))) return true;
  return yamlBase60(bare);
}

/** A flow sequence's items, split on commas, with spaces and tabs trimmed from each. */
function flowItems(inner) {
  return inner.split(',').map(part => trimEndSpaces(part.slice(leading(part).width)));
}

const FLOW_ITEM_REASON =
  'a flow sequence item that is not a plain word of letters, digits, "_" and "-", or that YAML reads as null, a boolean, a number or a date';

/** True when the empty-or-blank inner text of a flow list holds no item. */
function flowEmpty(inner) {
  return trimEndSpaces(inner.slice(leading(inner).width)) === '';
}

/**
 * The items of a `tools` flow list, split on the commas outside quotes, with
 * spaces and tabs trimmed from each. Each is { text, quoted }: a quoted item
 * is read by the strict quoted readers, so it must close where the item ends,
 * and is cannot-check otherwise. One pass, no regex.
 */
function toolsFlowItems(inner, ln) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote === '"') {
      if (ch === '\\') i += 1;
      else if (ch === '"') quote = null;
    } else if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map(part => {
    const p = trimEndSpaces(part.slice(leading(part).width));
    if (p[0] === '"') return { text: parseDoubleQuoted(p, ln), quoted: true };
    if (p[0] === "'") return { text: parseSingleQuoted(p, ln), quoted: true };
    return { text: p, quoted: false };
  });
}

/** True for an item the tools rule reads: one that holds a "*", or starts with "mcp" in any case. */
function toolsRuleReads(item) {
  return item.includes('*') || item.slice(0, 3).toLowerCase() === 'mcp';
}

/**
 * The item rule of an agent's `tools` list. An item the rule reads (see
 * toolsRuleReads) must be one of two shapes: mcp__<server>__<tool>, or
 * mcp__<server>__* for a whole server. <server> is letters, digits, "_" and
 * "-", holds no "__" (the first "__" ends it), and does not start or end with
 * "_"; <tool> is the same characters, or the "*" alone. The prefix is exactly
 * lower-case "mcp__". Any other item is a plain tool name, and passes.
 * Returns { ok: true, grant } or { ok: false, why }; `grant` is true for a
 * whole-server item. A bare server, mcp__<server>, grants the whole server
 * too in Claude Code, so it fails with the wildcard's reason: a whole-server
 * grant has one written form.
 */
function toolsItemOk(item) {
  if (!toolsRuleReads(item)) return { ok: true, grant: false };
  const bad = { ok: false, why: item.includes('*') ? TOOLS_REASON.wildcard : TOOLS_REASON.shape };
  if (!item.startsWith('mcp__')) return bad;
  const rest = item.slice(5);
  const sep = rest.indexOf('__');
  if (sep < 0) return { ok: false, why: TOOLS_REASON.wildcard };
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (!FLOW_ITEM_RE.test(server) || server.startsWith('_') || server.endsWith('_')) return bad;
  if (tool === '*') return { ok: true, grant: true };
  if (!FLOW_ITEM_RE.test(tool)) return bad;
  return { ok: true, grant: false };
}

/**
 * A one-line value after "key: ". Quoted or plain; anything else is
 * cannot-check. `extras` is the contract's Extra keys, or null under
 * `metadata:`. `agentMd` is true for the top-level keys of an agent .md, where
 * the `tools` key takes its own item rule.
 *
 * A flow sequence such as `[a, b]` is read only for a key the contract lists,
 * and never under `metadata:`, whose extras are null. Each item is a plain word
 * and passes the same rules as a plain value, so no item is null, a boolean, a
 * number or a date. Any other `[` falls through to the indicator rule below.
 *
 * An agent's `tools` key is read a little wider, so that every item its own
 * rule reads reaches that rule and fails there as a rule, never as
 * cannot-check: a value starting "*", and, in a listed flow list, an item the
 * rule reads, quoted or not, and a quoted item holding a comma. Every other
 * item keeps the flow rule, so a quoted plain word is still cannot-check.
 */
function parseScalar(raw, ln, key, extras, agentMd = false) {
  if (raw[0] === '"') return parseDoubleQuoted(raw, ln);
  if (raw[0] === "'") return parseSingleQuoted(raw, ln);
  const v = trimEndSpaces(raw);
  if (v === '') throw new CannotCheck(ln, 'an empty value');
  if (v[0] === '\t') throw new CannotCheck(ln, 'a tab before a value');
  const toolsKey = agentMd && key === 'tools';
  if (v[0] === '[' && v.endsWith(']') && extras && extras.has(key)) {
    const inner = v.slice(1, -1);
    if (flowEmpty(inner)) return v;
    if (toolsKey) {
      for (const item of toolsFlowItems(inner, ln)) {
        if (toolsRuleReads(item.text) || (item.quoted && item.text.includes(','))) continue;
        if (item.quoted || !FLOW_ITEM_RE.test(item.text) || item.text === '-' || yamlReadsAsNonText(item.text)) {
          throw new CannotCheck(ln, FLOW_ITEM_REASON);
        }
      }
      return v;
    }
    for (const item of flowItems(inner)) {
      if (!FLOW_ITEM_RE.test(item) || item === '-' || yamlReadsAsNonText(item)) throw new CannotCheck(ln, FLOW_ITEM_REASON);
    }
    return v;
  }
  if (toolsKey && v[0] === '*') return v;
  if (PLAIN_BAD_START.includes(v[0])) {
    throw new CannotCheck(ln, 'a value starting with a flow, anchor, alias, tag, block or other indicator character');
  }
  if (v === '-' || v === '?' || v === ':' || v.startsWith('- ') || v.startsWith('? ') || v.startsWith(': ')) {
    throw new CannotCheck(ln, 'a value that starts a list item or a complex key');
  }
  if (v.includes(': ') || v.includes(':\t') || v.endsWith(':')) {
    throw new CannotCheck(ln, 'a colon followed by a space inside an unquoted value (quote the value)');
  }
  if (v.includes(' #') || v.includes('\t#')) throw new CannotCheck(ln, 'a trailing comment after a value');
  // A plain = is YAML 1.1's value key and a plain << its merge key, so a
  // loader may read either as something other than text.
  if (v === '=' || v === '<<') {
    throw new CannotCheck(ln, 'an unquoted = or <<, which YAML reads as the value key or the merge key (quote it to use it as text)');
  }
  if (v === 'true' || v === 'false') {
    if (extras && extras.has(key)) return v;
    // Otherwise let it fall through to yamlReadsAsNonText to fail
  }
  if (yamlReadsAsNonText(v)) {
    throw new CannotCheck(ln, 'an unquoted value YAML reads as null, a boolean, a number or a date, such as a hex, octal, binary or base-60 number or a timestamp (quote it to use it as text)');
  }
  return v;
}

/** YAML folding for a '>' block. `ls` holds content lines with the indent removed; '' is an empty line. */
function fold(ls) {
  let out = '';
  let i = 0;
  while (i < ls.length && ls[i] === '') {
    out += '\n';
    i += 1;
  }
  if (i >= ls.length) return out;
  let prev = ls[i];
  out += prev;
  i += 1;
  while (i < ls.length) {
    let empties = 0;
    while (i < ls.length && ls[i] === '') {
      empties += 1;
      i += 1;
    }
    const cur = ls[i];
    const spaced = prev.startsWith(' ') || cur.startsWith(' ');
    if (empties === 0) out += spaced ? '\n' : ' ';
    else out += '\n'.repeat(spaced ? empties + 1 : empties);
    out += cur;
    prev = cur;
    i += 1;
  }
  return out;
}

/** Read a '>' or '|' block under a top-level key. Returns { value, end }. */
function readBlock(lines, start, close, header) {
  const style = header[0];
  const strip = header.length === 2;
  const content = [];
  let contentIndent = -1;
  let j = start;
  while (j < close) {
    const line = lines[j];
    if (isBlank(line)) {
      content.push('');
      j += 1;
      continue;
    }
    const lead = leading(line);
    if (lead.tab) throw new CannotCheck(j + 1, 'a tab used for indentation');
    if (lead.width === 0) break; // less indented than the block: it ends here
    if (contentIndent < 0) contentIndent = lead.width;
    if (lead.width < contentIndent) {
      throw new CannotCheck(j + 1, "a block line indented less than the block's first line");
    }
    content.push(line.slice(contentIndent));
    j += 1;
  }
  while (content.length > 0 && content[content.length - 1] === '') content.pop();
  if (content.length === 0) return { value: '', end: j };
  const body = style === '|' ? content.join('\n') : fold(content);
  return { value: strip ? body : `${body}\n`, end: j };
}

/** The one-level map under `metadata:`. Children sit at exactly two spaces. */
function readMetadata(lines, start, close, headerIdx) {
  const entries = new Map();
  const childIdx = [];
  let j = start;
  while (j < close) {
    const line = lines[j];
    const ln = j + 1;
    if (isBlank(line) || isComment(line)) {
      j += 1;
      continue;
    }
    const lead = leading(line);
    if (lead.tab) throw new CannotCheck(ln, 'a tab used for indentation');
    if (lead.width === 0) break;
    if (lead.width !== 2) {
      throw new CannotCheck(ln, 'a line under "metadata" not indented exactly two spaces (a nested map or a continuation)');
    }
    const body = line.slice(2);
    if (body === '-' || body.startsWith('- ')) throw new CannotCheck(ln, 'a list item under "metadata"');
    const colon = body.indexOf(':');
    if (colon <= 0) throw new CannotCheck(ln, 'a line under "metadata" that is not "key: value"');
    const key = body.slice(0, colon);
    // Line number only. Text before a colon is whatever the file put there,
    // and a sentence with a colon in it is not a key.
    if (!META_KEY_RE.test(key)) throw new CannotCheck(ln, 'a metadata key outside the readable subset');
    if (entries.has(key)) throw new CannotCheck(ln, `duplicate metadata key "${clean(key)}"`);
    const rest = body.slice(colon + 1);
    if (isBlank(rest)) throw new CannotCheck(ln, `metadata key "${clean(key)}" has no value on its line (a nested map or an empty value)`);
    if (rest[0] !== ' ') throw new CannotCheck(ln, `metadata key "${clean(key)}" is not followed by ": "`);
    const raw = skipSpaces(rest);
    if (raw[0] === '|' || raw[0] === '>') throw new CannotCheck(ln, `metadata key "${clean(key)}" holds a block value`);
    entries.set(key, { value: parseScalar(raw, ln, key, null), line: ln });
    childIdx.push(j);
    j += 1;
  }
  return { headerIdx, headerLine: headerIdx + 1, entries, childIdx, end: j };
}

/**
 * Parse frontmatter lines[1 .. close-1]. Returns { top, metadata } where top
 * maps key -> { kind: 'text'|'map', value, line }. Throws CannotCheck.
 *
 * A key seen twice is "cannot check", not "last one wins". Two loaders can
 * pick different copies, so a duplicate is a file that says two things.
 *
 * `agentMd` is true for an agent .md (see parseScalar). There a bare `tools:`
 * reads as an empty value, for the tools-missing warning to see, and a block
 * value on `tools` is marked `block`, for the tools rule to fail.
 */
function parseFrontmatter(lines, close, extras, agentMd = false) {
  const top = new Map();
  let metadata = null;
  let i = 1;
  while (i < close) {
    const line = lines[i];
    const ln = i + 1;
    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    const lead = leading(line);
    if (lead.tab) throw new CannotCheck(ln, 'a tab used for indentation');
    if (lead.width > 0) throw new CannotCheck(ln, 'an indented line where a key was expected (a continuation or nested value)');
    if (line.startsWith('- ') || line === '-') throw new CannotCheck(ln, 'a list item');
    const colon = line.indexOf(':');
    if (colon <= 0) throw new CannotCheck(ln, 'a line that is not "key: value"');
    const key = line.slice(0, colon);
    // Line number only, for the reason readMetadata gives. A key is echoed
    // once it has matched the key pattern, and not before.
    if (!TOP_KEY_RE.test(key)) throw new CannotCheck(ln, 'a key outside the readable subset');
    if (top.has(key)) throw new CannotCheck(ln, `duplicate key "${clean(key)}"`);
    const rest = line.slice(colon + 1);
    if (isBlank(rest) && agentMd && key === 'tools') {
      top.set(key, { kind: 'text', value: '', line: ln });
      i += 1;
      continue;
    }
    if (isBlank(rest)) {
      if (key !== 'metadata') throw new CannotCheck(ln, `key "${clean(key)}" has no value on its line`);
      metadata = readMetadata(lines, i + 1, close, i);
      top.set(key, { kind: 'map', value: metadata.entries, line: ln });
      i = metadata.end;
      continue;
    }
    if (rest[0] !== ' ') throw new CannotCheck(ln, `key "${clean(key)}" is not followed by ": "`);
    const raw = skipSpaces(rest);
    if (raw[0] === '>' || raw[0] === '|') {
      const header = trimEndSpaces(raw);
      if (!BLOCK_HEADERS.has(header)) throw new CannotCheck(ln, `key "${clean(key)}" has a block header this check does not read`);
      const block = readBlock(lines, i + 1, close, header);
      top.set(key, { kind: 'text', value: block.value, line: ln, block: true });
      i = block.end;
      continue;
    }
    // parseScalar takes a plain value starting "[" only as a flow list, and
    // refuses every other one, so a value that parsed from such a start is a
    // flow list. The warning rules compare its items one by one; a quoted
    // "[plan]" is text, and is compared whole.
    const value = parseScalar(raw, ln, key, extras, agentMd);
    top.set(key, { kind: 'text', value, line: ln, flow: raw[0] === '[' });
    i += 1;
  }
  return { top, metadata };
}

// ---------------------------------------------------------------- toml
//
// A .toml familiar is a Codex agent file. The reader takes one subset of TOML
// and calls everything else "cannot check": top-level `key = value` lines,
// blank lines, whole-line comments, and the seal block. A value is a string,
// or an unquoted true or false for a key the contract lists. A table, an
// array, an inline table, a number, a date, a dotted or quoted key and any
// text after a value's close, a comment included, are refused. `[mcp_servers]`
// and the like are valid to Codex, but a table is where a key hides from this
// check, so none is read.
//
// Strings are read the narrow way, as parseDoubleQuoted reads YAML. A basic
// string, "…" or """…""", takes the escapes \" and \\ and no other: a \u
// escape could spell a character the invisible-character rule never sees in
// the raw text. A literal string, '…' or '''…''', takes none, and two single
// quotes in a row inside one are refused. A close with a longer quote run
// than its delimiter is refused too, so the reader closes a string exactly
// where TOML does, and a key after it cannot hide inside it.
//
// The seal is three comment lines at the very end of the file, which Codex
// reads past. They are found by the same pass that knows whether a line is
// inside a string: the same three lines inside a string are text, and stay in
// the digest. Any other comment that names a mark key, in any case or form,
// is refused, because it would read as a seal to a person or a model. So is a
// key named like one, listed or not: no tool reads such a key, and it too
// would read as a seal.

// The seal block, one fully anchored pattern per line, in MARK_KEYS order.
// The version takes the characters sealableVersion() allows, and no quote.
const TOML_SEAL_RES = [
  /^# contract-version = "([0-9A-Za-z.+-]+)"$/,
  /^# familiar-digest = "(sha256:[0-9a-f]{64})"$/,
  /^# contract-digest = "(sha256:[0-9a-f]{64})"$/,
];
// A comment's text, or a key, that names a mark key. Looser than the block on
// purpose: any case, any spacing, any separator and any quoting, and anywhere
// in the key.
const TOML_DECOY_RE = /contract-version|familiar-digest|contract-digest/i;
// The leading run of bare-key characters on a key line. TOP_KEY_RE decides
// afterwards whether the key is one this check reads.
const TOML_BARE_KEY_RE = /^[A-Za-z0-9_-]+/;
// A value TOML reads as a number or a date: a sign or a digit first, or inf
// or nan.
const TOML_NUMBER_START_RE = /^[-+0-9]/;
const TOML_INF_NAN_RE = /^(?:inf|nan)(?:$|[ \t])/;

const TOML_REASON = {
  table: 'a table header ([table] or [[array]]); this check reads top-level keys only',
  dotted: 'a dotted or quoted key',
  notKv: 'a line that is not "key = value", a comment or a blank line',
  metadata: 'a top-level "metadata" key, which stops Codex loading the agent',
  array: 'an array value (this check reads only strings, true and false)',
  inline: 'an inline table value (this check reads only strings, true and false)',
  number: 'a number or a date value (this check reads only strings, true and false)',
  other: 'a value that is not a quoted string, true or false',
  bool: 'an unquoted true or false on a key the contract does not list on its "Extra keys:" line',
  afterQuote: 'text after a closing quote (for example a trailing comment)',
  afterValue: 'text after a value (for example a trailing comment)',
  escape: 'a backslash escape other than \\" or \\\\',
  twoSingle: 'two single quotes in a row inside a literal string (a TOML literal string has no escapes)',
  longClose: 'a closing quote run longer than the three-quote delimiter',
  decoy: 'a comment that names a seal key but is not part of the seal block (three exact lines at the end of the file)',
  decoyKey: 'a key named like a seal key; the seal is three comment lines at the end of the file',
};

/**
 * True when loc.mode is `mode`. A mode outside KIND_OF throws, so no branch
 * can read an unknown mode as one of the three: every mode comparison in this
 * file goes through here.
 */
function isMode(loc, mode) {
  if (!KIND_OF.has(loc.mode) || !KIND_OF.has(mode)) throw new Error('unknown mode');
  return loc.mode === mode;
}

/** True for a .toml agent file, whose reader, keys and seal are its own. A CLAUDE.md is never one. */
function isTomlFamiliar(loc) {
  return isMode(loc, 'agent') && loc.familiarName.endsWith('.toml');
}

/**
 * TOML's own rules for a line's characters, which the file reader is looser
 * about. A line ends in LF or CRLF only: the reader splits on a lone CR, and
 * TOML refuses one. No control character but tab, inside a string or out:
 * no C0 control and no DEL, which TOML refuses as well. Then the rest of the
 * character rule (see isRefusedChar), with a reason of its own: no line or
 * paragraph separator, no C1 control and no U+FFFE or U+FFFF. These run after
 * the C0 and DEL loop, so a line holding both kinds keeps the older reason.
 */
function tomlLineRules(raw, ln) {
  if (raw.eol === '\r') throw new CannotCheck(ln, 'a carriage return with no line feed after it');
  const t = raw.text;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if ((c < 0x20 && c !== 9) || c === 0x7f) throw new CannotCheck(ln, `a control character other than tab (${hex4(c)})`);
  }
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if (isRefusedChar(c)) {
      throw new CannotCheck(ln, `a line or paragraph separator, a C1 control character or a noncharacter (${hex4(c)})`);
    }
  }
}

/**
 * Read a basic string's text from s[i] to its close. `quotes` is 1 or 3.
 * Returns { value, end }, where end is the index just past the close, or -1
 * when the line ends first. Only \" and \\ are escapes. In a """ string one
 * or two quotes are text, three close it, and more than three are refused.
 */
function scanBasic(s, i, quotes, ln) {
  let out = '';
  let j = i;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '\\') {
      const next = s[j + 1];
      if (next !== '"' && next !== '\\') throw new CannotCheck(ln, TOML_REASON.escape);
      out += next;
      j += 2;
    } else if (ch === '"') {
      if (quotes === 1) return { value: out, end: j + 1 };
      let run = 0;
      while (s[j + run] === '"') run += 1;
      if (run > 3) throw new CannotCheck(ln, TOML_REASON.longClose);
      if (run === 3) return { value: out, end: j + 3 };
      out += s.slice(j, j + run);
      j += run;
    } else {
      out += ch;
      j += 1;
    }
  }
  return { value: out, end: -1 };
}

/**
 * Read a literal string's text from s[i] to its close, as scanBasic does, with
 * no escapes. Two single quotes in a row are refused, and in a ''' string a
 * run of more than three is refused as well.
 */
function scanLiteral(s, i, quotes, ln) {
  let j = i;
  for (;;) {
    const at = s.indexOf("'", j);
    if (at < 0) return { value: s.slice(i), end: -1 };
    let run = 0;
    while (s[at + run] === "'") run += 1;
    if (quotes === 1) {
      if (run > 1) throw new CannotCheck(ln, TOML_REASON.twoSingle);
      return { value: s.slice(i, at), end: at + 1 };
    }
    if (run > 3) throw new CannotCheck(ln, TOML_REASON.longClose);
    if (run === 3) return { value: s.slice(i, at), end: at + 3 };
    if (run === 2) throw new CannotCheck(ln, TOML_REASON.twoSingle);
    j = at + 1;
  }
}

/** Nothing but spaces and tabs may follow a string's close. */
function afterClose(s, end, ln) {
  if (trimEndSpaces(s.slice(end)) !== '') throw new CannotCheck(ln, TOML_REASON.afterQuote);
}

/**
 * One value after "key = ". Returns { value } when the value ends on this
 * line, or { open } for a multiline string that goes on past it.
 */
function tomlValue(v, ln, key, extras) {
  const multi = v.startsWith('"""') ? '"""' : v.startsWith("'''") ? "'''" : null;
  if (multi) {
    const literal = multi === "'''";
    const r = literal ? scanLiteral(v, 3, 3, ln) : scanBasic(v, 3, 3, ln);
    if (r.end >= 0) {
      afterClose(v, r.end, ln);
      return { value: r.value };
    }
    // A line ending right after the opening quotes is not part of the value.
    return { open: { key, line: ln, delimiter: multi, literal, parts: r.value === '' ? [] : [r.value] } };
  }
  if (v[0] === '"' || v[0] === "'") {
    const r = v[0] === '"' ? scanBasic(v, 1, 1, ln) : scanLiteral(v, 1, 1, ln);
    if (r.end < 0) {
      throw new CannotCheck(ln, `a ${v[0] === '"' ? 'double' : 'single'}-quoted value that does not close on its line`);
    }
    afterClose(v, r.end, ln);
    return { value: r.value };
  }
  for (const word of ['true', 'false']) {
    if (!v.startsWith(word)) continue;
    const rest = v.slice(word.length);
    if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') break;
    if (trimEndSpaces(rest) !== '') throw new CannotCheck(ln, TOML_REASON.afterValue);
    if (!extras.has(key)) throw new CannotCheck(ln, TOML_REASON.bool);
    return { value: word };
  }
  if (v[0] === '[') throw new CannotCheck(ln, TOML_REASON.array);
  if (v[0] === '{') throw new CannotCheck(ln, TOML_REASON.inline);
  if (TOML_NUMBER_START_RE.test(v) || TOML_INF_NAN_RE.test(v)) throw new CannotCheck(ln, TOML_REASON.number);
  throw new CannotCheck(ln, TOML_REASON.other);
}

/**
 * Parse a .toml familiar. Returns { top, seal }: top maps key -> { kind:
 * 'text', value, line }, and seal is { kind: 'toml', start, entries } for the
 * block at the end of the file, or null. Throws CannotCheck.
 *
 * A key seen twice is "cannot check", as in the frontmatter, and a key whose
 * value runs over several lines takes the same key and duplicate rules.
 */
function parseToml(fam, extras) {
  // TOML has no byte-order mark, and one outside the digest could decide
  // whether the file loads without breaking the seal.
  if (fam.bom) throw new CannotCheck(1, 'a byte-order mark (a .toml file must not start with one)');
  const lines = fam.lines;
  // The file's own lines: a final line ending leaves one empty entry after them.
  const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  let sealStart = -1;
  if (count >= 3 && TOML_SEAL_RES.every((re, k) => re.test(lines[count - 3 + k]))) sealStart = count - 3;

  const top = new Map();
  let seal = null;
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = i + 1;
    tomlLineRules(fam.rawLines[i], ln);
    const line = lines[i];
    if (open) {
      const r = open.literal ? scanLiteral(line, 0, 3, ln) : scanBasic(line, 0, 3, ln);
      open.parts.push(r.value);
      if (r.end < 0) continue;
      afterClose(line, r.end, ln);
      top.set(open.key, { kind: 'text', value: open.parts.join('\n'), line: open.line });
      open = null;
      continue;
    }
    // Reached outside a string, so it is the seal, and nothing follows it.
    // Its other two lines take the line rules too, the last one's ending
    // included, since the loop stops here.
    if (i === sealStart) {
      tomlLineRules(fam.rawLines[i + 1], ln + 1);
      tomlLineRules(fam.rawLines[i + 2], ln + 2);
      seal = { kind: 'toml', start: i, entries: new Map() };
      MARK_KEYS.forEach((k, j) => seal.entries.set(k, { value: TOML_SEAL_RES[j].exec(lines[i + j])[1], line: ln + j }));
      break;
    }
    const lead = leading(line).width;
    if (lead === line.length) continue;
    const body = line.slice(lead);
    if (body[0] === '#') {
      if (TOML_DECOY_RE.test(body)) throw new CannotCheck(ln, TOML_REASON.decoy);
      continue;
    }
    if (body[0] === '[') throw new CannotCheck(ln, TOML_REASON.table);
    const m = TOML_BARE_KEY_RE.exec(body);
    const key = m ? m[0] : '';
    const eq = key.length + leading(body.slice(key.length)).width;
    const next = body[eq];
    if (next === '.' || (key === '' && (next === '"' || next === "'"))) throw new CannotCheck(ln, TOML_REASON.dotted);
    if (key === '' || next !== '=') {
      if (key !== '' && (next === '"' || next === "'")) throw new CannotCheck(ln, TOML_REASON.dotted);
      throw new CannotCheck(ln, TOML_REASON.notKv);
    }
    // Line number only, for the reason readMetadata gives.
    if (!TOP_KEY_RE.test(key)) throw new CannotCheck(ln, 'a key outside the readable subset');
    if (key === 'metadata') throw new CannotCheck(ln, TOML_REASON.metadata);
    if (TOML_DECOY_RE.test(key)) throw new CannotCheck(ln, TOML_REASON.decoyKey);
    if (top.has(key)) throw new CannotCheck(ln, `duplicate key "${clean(key)}"`);
    // Not trimmed at the end: after an opening """ or ''' the spaces are text,
    // and so is the line ending after them. Each branch of tomlValue allows
    // trailing spaces where TOML does.
    const rest = body.slice(eq + 1);
    const v = rest.slice(leading(rest).width);
    if (trimEndSpaces(v) === '') throw new CannotCheck(ln, 'an empty value');
    const r = tomlValue(v, ln, key, extras);
    if (r.open) open = r.open;
    else top.set(key, { kind: 'text', value: r.value, line: ln });
  }
  if (open) throw new CannotCheck(open.line, `unclosed multiline string (${open.delimiter})`);
  return { top, seal };
}

// ---------------------------------------------------------------- the main agent file
//
// Claude Code's main agent file, CLAUDE.md, loads at the start of every
// session in its scope. Claude Code strips a frontmatter block at its very
// top before the model sees it: observed, not documented (the docs describe
// the stripping only for .claude/rules/). So the block is optional,
// and the mark goes there. With no block, the seal adds one holding only the
// mark, and the canonical form drops a block the mark was all of (see
// canonicalFamiliar), so the digest of a file is the same before its first
// seal and after.
//
// The block holds no `name`, `description` or `tools` (see MAIN_REFUSED_KEYS).
// Any other key warns, since Claude Code ignores it there. A byte-order mark
// is refused, because whether Claude Code strips the block after one is
// untested. A mark-shaped line anywhere below the block is refused as a
// decoy, as a .toml's is: it would read as a seal to a person or a model.

/**
 * True when a body line reads as a mark key: optional spaces or tabs, a mark
 * key in any case, optional spaces or tabs, then ":" or "=". Prose that names
 * a key mid-line is not one. String operations only, so a long line costs one
 * pass.
 */
function isDecoyMarkLine(line) {
  const t = line.slice(leading(line).width);
  const lower = t.slice(0, 16).toLowerCase();
  const key = MARK_KEYS.find(k => lower.startsWith(k));
  if (key === undefined) return false;
  let i = key.length;
  while (i < t.length && (t[i] === ' ' || t[i] === '\t')) i += 1;
  return t[i] === ':' || t[i] === '=';
}

/** Parse a CLAUDE.md. Returns { top, seal, close }, with an empty `top` when there is no block. Throws CannotCheck. */
function parseMain(fam, extras) {
  if (fam.bom) throw new CannotCheck(1, 'a byte-order mark (a CLAUDE.md file must not start with one)');
  const close = findFrontmatter(fam.lines);
  const fm = close < 0 ? { top: new Map(), metadata: null } : parseFrontmatter(fam.lines, close, extras);
  for (let i = close + 1; i < fam.lines.length; i += 1) {
    if (isDecoyMarkLine(fam.lines[i])) {
      throw new CannotCheck(i + 1, 'a line outside the top frontmatter block that reads as a mark key; the mark goes only in the block at the very top');
    }
  }
  return { top: fm.top, seal: fm.metadata ? { kind: 'yaml', ...fm.metadata } : null, close };
}

/**
 * True when the text before an @ is a list marker: "-", "*" or "+", or
 * digits then "." or ")", after the line's leading spaces. Text longer than
 * LIST_MARKER_MAX is never one, and is never sliced.
 */
function isListMarker(line, at) {
  const start = leading(line).width;
  if (at <= start || at - start > LIST_MARKER_MAX) return false;
  const m = line.slice(start, at);
  if (m === '-' || m === '*' || m === '+') return true;
  const last = m[m.length - 1];
  if (m.length < 2 || (last !== '.' && last !== ')')) return false;
  for (let j = 0; j < m.length - 1; j += 1) if (m[j] < '0' || m[j] > '9') return false;
  return true;
}

/**
 * True when a body line holds an @ import as Claude Code reads one: an @ at
 * the line's start, after any space character (a no-break space included,
 * since the character rule lets one through), or after a list marker. It
 * warns too often by design, inside a code span or on "a @ b", and never
 * parses a code span.
 */
function holdsImport(line) {
  for (let at = line.indexOf('@'); at >= 0; at = line.indexOf('@', at + 1)) {
    if (at === 0 || /\s/u.test(line[at - 1]) || isListMarker(line, at)) return true;
  }
  return false;
}

/** The import warning: one per body line of a CLAUDE.md that holds an @ import, naming the line, never the path. */
function importRule(lines, close, report) {
  for (let i = close + 1; i < lines.length; i += 1) {
    if (holdsImport(lines[i])) report.warn('import', `line ${i + 1} ${OUTSIDE_FILE}`);
  }
}

/**
 * The one reader for a familiar, whatever its format. Returns { top, seal,
 * close }, or null for a skill's or an agent's .md file with no frontmatter.
 * Throws CannotCheck. `seal` says where the mark is: the frontmatter's
 * `metadata:` block ({ kind: 'yaml', entries, headerIdx, childIdx }), the
 * comment block at the end of a .toml ({ kind: 'toml', start, entries }), or
 * null when there is neither. `close` is the index of the frontmatter's
 * closing `---`, or -1.
 */
function parseFamiliar(fam, loc, extras) {
  if (isTomlFamiliar(loc)) return { ...parseToml(fam, extras), close: -1 };
  if (isMode(loc, 'main')) return parseMain(fam, extras);
  const close = findFrontmatter(fam.lines);
  if (close < 0) return null;
  const fm = parseFrontmatter(fam.lines, close, extras, isMode(loc, 'agent'));
  return { top: fm.top, seal: fm.metadata ? { kind: 'yaml', ...fm.metadata } : null, close };
}

// ---------------------------------------------------------------- contract

/**
 * The lines of a contract this check reads: the first `Version: <v>`, the
 * first `Extra keys: <k>, <k>`, and every `Target:` and `Kind:` line, so that
 * a second one anywhere in the file is seen. An entry in Extra keys that is
 * not key-shaped is dropped, which can only make the unknown-key rule
 * stricter.
 */
function contractFacts(lines) {
  let version = null;
  let extras = null;
  const targets = [];
  const kinds = [];
  for (const line of lines) {
    if (version === null) {
      const m = VERSION_RE.exec(line);
      if (m) version = m[1];
    }
    if (extras === null) {
      const m = EXTRA_RE.exec(line);
      if (m) {
        extras = new Set();
        for (const part of m[1].split(',')) {
          const k = part.trim();
          if (TOP_KEY_RE.test(k)) extras.add(k);
        }
      }
    }
    const t = TARGET_RE.exec(line);
    if (t) targets.push(trimEndSpaces(t[1].slice(leading(t[1]).width)));
    const k = KIND_RE.exec(line);
    if (k) kinds.push(trimEndSpaces(k[1].slice(leading(k[1]).width)));
  }
  return { version, extras: extras ?? new Set(), targets, kinds };
}

// ---------------------------------------------------------------- digests

function withOneTrailingLf(lines) {
  let s = lines.join('\n');
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 10) end -= 1;
  s = s.slice(0, end);
  return `${s}\n`;
}

/**
 * Canonical form of the familiar, given the seal parseFamiliar found. For a
 * .md file: the whole file, normalised, with the mark lines inside the
 * metadata block removed (and `metadata:` too, when the mark was all it held).
 * For a .toml file: every line before the seal block, or every line when there
 * is none. Either way the lines are joined as withOneTrailingLf joins them, so
 * trailing blank lines are not covered, by design. The digest covers the keys
 * as well as the text, so a key added after the seal breaks it.
 *
 * For a CLAUDE.md (`main`), the top block's two `---` lines always stay under
 * the digest, and a file with no block (`close` is -1) reads as one that
 * starts with an empty block: the seal adds a block to a file that had none,
 * so the file reads the same before the seal and after it. Keeping the `---`
 * lines means a line moved out of the top block, into a second block below
 * it, changes the digest.
 */
function canonicalFamiliar(lines, seal, close = -1, main = false) {
  if (seal && seal.kind === 'toml') return withOneTrailingLf(lines.slice(0, seal.start));
  const drop = new Set();
  if (seal) {
    let kept = 0;
    for (const idx of seal.childIdx) {
      if (MARK_LINE_RE.test(lines[idx])) drop.add(idx);
      else kept += 1;
    }
    if (kept === 0) drop.add(seal.headerIdx);
  }
  const kept = lines.filter((_, i) => !drop.has(i));
  if (main && close < 0) kept.unshift('---', '---');
  return withOneTrailingLf(kept);
}

function digest(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------- the folder
//
// A skill is a folder, and its SKILL.md tells the agent to read the files
// beside it. So in skill mode familiar-digest covers SKILL.md and every other
// file under the folder, except CONTRACT.md at its root, which
// contract-digest covers. Nothing else is left out: a stray .DS_Store, a
// nested .git or a seal's leftover temporary file breaks the seal, which
// fails closed. An empty folder holds no file, so it is not covered. An agent
// is one file, and its digest covers that file alone.
//
// The walk and its refusals run on every skill folder, sealed or not.

const NUL_BYTE = Buffer.from([0]);

/** Where a refusal happened: a path under the folder, or the folder itself. */
function where(rel) {
  return rel === '' ? 'the folder' : `"${clean(rel)}"`;
}

/**
 * Why one name under a skill folder is refused, or null. The name a folder
 * lists must be the name that opens the file, on every system the folder is
 * copied to, so a name is refused rather than cleaned: a character outside
 * the safe set, a final "." that Windows drops, or a name Windows keeps for a
 * device.
 */
function nameProblem(name) {
  if (!SAFE_NAME_RE.test(name)) return 'holds a character outside A-Z, a-z, 0-9, ".", "_" and "-"';
  if (name.endsWith('.')) return 'ends in "."';
  if (RESERVED_NAMES.has(name.split('.')[0].toLowerCase())) return 'is a name Windows keeps for a device';
  return null;
}

/**
 * List every entry under a skill folder and refuse the shapes the seal cannot
 * cover. Returns { ok: false, why } or { ok: true, files, leftovers }. `files`
 * holds every regular file but SKILL.md and CONTRACT.md at the root, which
 * the check reads on their own.
 *
 * A folder is read one entry at a time and the count stops at the limit, so a
 * folder of a million entries costs 257 reads, not a million-name listing.
 * Names are read as bytes. Decoded by default, two names that are not UTF-8
 * can both read as the same U+FFFD name, and the listing would then name one
 * file for two.
 */
function listFolder(root) {
  const files = [];
  const leftovers = [];
  // Paths already listed. SKILL.md is the canonical form's path.
  const seen = new Set(['SKILL.md']);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let entries = 0;
  const stack = [{ abs: root, rel: '', depth: 0 }];
  while (stack.length > 0) {
    const { abs, rel, depth } = stack.pop();
    const names = [];
    let dir;
    try {
      dir = opendirSync(abs, { encoding: 'buffer' });
    } catch (err) {
      return { ok: false, why: `${where(rel)} cannot be opened (${clean(err.code ?? 'error')})` };
    }
    try {
      for (let d = dir.readSync(); d !== null; d = dir.readSync()) {
        entries += 1;
        if (entries > MAX_ENTRIES) return { ok: false, why: `the folder holds more than ${MAX_ENTRIES} entries, folders included` };
        try {
          names.push(decoder.decode(d.name));
        } catch {
          return { ok: false, why: `a name in ${where(rel)} is not valid UTF-8` };
        }
      }
    } finally {
      dir.closeSync();
    }
    const byLowerCase = new Map();
    for (const name of names) {
      // Joined from its parts with "/", never by rewriting a separator, so a
      // name holding "\" cannot pass as two parts.
      const path = rel === '' ? name : `${rel}/${name}`;
      const bad = nameProblem(name);
      if (bad) return { ok: false, why: `"${clean(path)}" ${bad}` };
      const twin = byLowerCase.get(name.toLowerCase());
      if (twin !== undefined) return { ok: false, why: `"${clean(twin)}" and "${clean(path)}" differ only in case` };
      byLowerCase.set(name.toLowerCase(), path);
      if (rel === '' && (name === 'SKILL.md' || name === 'CONTRACT.md')) continue;
      if (seen.has(path)) return { ok: false, why: `two entries share the path "${clean(path)}"` };
      seen.add(path);
      const full = join(abs, name);
      let st;
      try {
        st = lstatSync(full, { bigint: true });
      } catch (err) {
        return { ok: false, why: `"${clean(path)}" cannot be read (${clean(err.code ?? 'error')})` };
      }
      if (st.isDirectory()) {
        if (depth + 1 > MAX_DEPTH) return { ok: false, why: `"${clean(path)}" is more than ${MAX_DEPTH} folders deep` };
        stack.push({ abs: full, rel: path, depth: depth + 1 });
      } else if (st.isFile()) {
        if (SEAL_TEMP_RE.test(name)) leftovers.push(path);
        files.push({ rel: path, abs: full, binary: BINARY_RE.test(name), ino: st.ino, dev: st.dev });
      } else {
        return { ok: false, why: `"${clean(path)}" is not a regular file or folder (a symlink, a junction or another kind of entry)` };
      }
    }
  }
  return { ok: true, files, leftovers };
}

/**
 * A covered text file's bytes as hashed: strict UTF-8 with no NUL, and each
 * CRLF made LF, which is the one change git makes to a text file on checkout.
 * A lone CR is refused, not made LF: a shell reads `# note\rcmd` as one
 * comment, and an editor shows it as two lines. After those two, the rest of
 * the character rule (see isRefusedChar), reported with its line and code
 * point. Returns { why } or { bytes, text }.
 */
function textBytes(buf) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return { why: 'is not valid UTF-8' };
  }
  if (buf.includes(0)) return { why: 'holds a NUL byte' };
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 13) {
      if (buf[i + 1] !== 10) return { why: 'holds a carriage return with no line feed after it' };
      continue;
    }
    out[n] = buf[i];
    n += 1;
  }
  // Every CR left is half of a CRLF, and an LF ends a line.
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) line += 1;
    else if (c !== 13 && isRefusedChar(c)) return { why: `line ${line} holds ${hex4(c)}` };
  }
  return { bytes: out.subarray(0, n), text };
}

/**
 * Read the listed files. Returns { ok: false, why } or { ok: true, contents,
 * invisible }, where contents are { rel, bytes } as hashed, with `text` as
 * well for a text file: its decoded text, with one leading byte-order mark
 * stripped and its line endings as they are on disk. invisible holds the
 * first invisible character of each text file that has one.
 *
 * Each file is opened, and its descriptor must name the same regular file the
 * listing saw, so an entry swapped for a link after the listing is refused
 * rather than followed. Its size is added to the total, and checked against
 * its cap, before a byte of it is read.
 */
function readListed(files) {
  const contents = [];
  const invisible = [];
  let total = 0;
  for (const f of files) {
    const cap = f.binary ? MAX_BINARY_BYTES : MAX_BYTES;
    let fd;
    try {
      fd = openSync(f.abs, 'r');
    } catch (err) {
      return { ok: false, why: `"${clean(f.rel)}" cannot be opened (${clean(err.code ?? 'error')})` };
    }
    let buf;
    try {
      const st = fstatSync(fd, { bigint: true });
      if (!st.isFile() || st.ino !== f.ino || st.dev !== f.dev) return { ok: false, why: `"${clean(f.rel)}" changed while the folder was read` };
      const size = Number(st.size);
      if (size > cap) return { ok: false, why: `"${clean(f.rel)}" is larger than ${f.binary ? '4 MiB' : '1 MiB'}` };
      total += size;
      if (total > MAX_TOTAL_BYTES) return { ok: false, why: 'the files in the folder add up to more than 16 MiB' };
      buf = Buffer.alloc(size + 1);
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, null);
        if (n === 0) break;
        got += n;
      }
      if (got !== size) return { ok: false, why: `"${clean(f.rel)}" changed while it was read` };
      buf = buf.subarray(0, size);
    } finally {
      closeSync(fd);
    }
    if (f.binary) {
      contents.push({ rel: f.rel, bytes: buf });
      continue;
    }
    const t = textBytes(buf);
    if (t.why) return { ok: false, why: `"${clean(f.rel)}" ${t.why}` };
    const text = t.text.charCodeAt(0) === 0xfeff ? t.text.slice(1) : t.text;
    contents.push({ rel: f.rel, bytes: t.bytes, text });
    const hit = findInvisible(text);
    if (hit) invisible.push({ rel: f.rel, ...hit });
  }
  return { ok: true, contents, invisible };
}

/**
 * The folder rules, recorded into report. Returns the folder's contents for
 * the digest, or null when the folder could not be read in full.
 */
function folderRules(loc, report) {
  const listed = listFolder(loc.dir);
  if (!listed.ok) {
    report.cannot('folder', listed.why);
    return null;
  }
  const read = readListed(listed.files);
  if (!read.ok) {
    report.cannot('folder', read.why);
    return null;
  }
  for (const p of listed.leftovers) {
    report.fail('folder', `"${clean(p)}" is a temporary file a seal left behind; delete it`);
  }
  if (listed.leftovers.length === 0) report.pass('folder');
  for (const hit of read.invisible) {
    report.fail('invisible-characters', `${clean(hit.rel)} line ${hit.line} holds ${hex4(hit.cp)}`);
  }
  if (read.invisible.length === 0) report.pass('invisible-characters', 'every other text file in the folder');
  contentsRule(read.contents, report);
  return read.contents;
}

/** Path order by UTF-16 code unit, as the digest and the contents rule list files. */
function byRel(a, b) {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
}

/**
 * Lines in a text, counted as bodyLineCount counts a body's: a final line
 * ending does not start a new line, and an empty text has none. One pass, no
 * regex.
 */
function lineCount(text) {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n += 1;
  if (text === '' || text.endsWith('\n')) n -= 1;
  return n;
}

function isSpaceOrTab(c) {
  return c === ' ' || c === '\t';
}

/**
 * True when s[start, end) is a Markdown heading whose text is "Contents", in
 * any case: at most three spaces, one to six "#", a space or a tab, then the
 * text, with spaces, tabs and a closing run of "#" trimmed as Markdown trims
 * them. String operations only, so a megabyte-long line costs one pass.
 */
function isContentsHeading(s, start, end) {
  let i = start;
  while (i < end && i - start < 4 && s[i] === ' ') i += 1;
  if (i - start > 3) return false;
  const hashes = i;
  while (i < end && s[i] === '#') i += 1;
  if (i - hashes < 1 || i - hashes > 6) return false;
  if (i >= end || !isSpaceOrTab(s[i])) return false;
  let textEnd = end;
  while (textEnd > i && isSpaceOrTab(s[textEnd - 1])) textEnd -= 1;
  // A closing run of "#" counts only after a space or a tab.
  let runStart = textEnd;
  while (runStart > i && s[runStart - 1] === '#') runStart -= 1;
  if (runStart < textEnd && isSpaceOrTab(s[runStart - 1])) textEnd = runStart;
  while (textEnd > i && isSpaceOrTab(s[textEnd - 1])) textEnd -= 1;
  while (i < textEnd && isSpaceOrTab(s[i])) i += 1;
  return textEnd - i === 8 && s.slice(i, textEnd).toLowerCase() === 'contents';
}

/**
 * When s[start, end) is a code-fence line, { mark, length, after }: at most
 * three spaces, then three or more "`" or "~", with `after` the index past
 * that run. A "`" run followed by another "`" on its line is not a fence, as
 * Markdown reads it. Otherwise null. Every scan stops at `end`.
 */
function fenceAt(s, start, end) {
  let i = start;
  while (i < end && i - start < 4 && s[i] === ' ') i += 1;
  if (i - start > 3) return null;
  const mark = s[i];
  if (mark !== '`' && mark !== '~') return null;
  const run = i;
  while (i < end && s[i] === mark) i += 1;
  if (i - run < 3) return null;
  if (mark === '`') {
    for (let j = i; j < end; j += 1) if (s[j] === '`') return null;
  }
  return { mark, length: i - run, after: i };
}

/** True when s[start, end) closes `open`: its mark, at least as long, then only spaces or tabs. */
function closesFence(open, s, start, end) {
  const f = fenceAt(s, start, end);
  if (f === null || f.mark !== open.mark || f.length < open.length) return false;
  for (let j = f.after; j < end; j += 1) if (!isSpaceOrTab(s[j])) return false;
  return true;
}

/**
 * True when one of a text's first CONTENTS_WINDOW lines is a Contents heading.
 * A line inside a code fence is code, not a heading; a fence left open runs
 * to the end of the file.
 */
function hasContentsHeading(text) {
  let start = 0;
  let open = null;
  for (let k = 0; k < CONTENTS_WINDOW && start <= text.length; k += 1) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    const stop = end > start && text[end - 1] === '\r' ? end - 1 : end;
    if (open !== null) {
      if (closesFence(open, text, start, stop)) open = null;
    } else {
      open = fenceAt(text, start, stop);
      if (open === null && isContentsHeading(text, start, stop)) return true;
    }
    start = end + 1;
  }
  return false;
}

/**
 * The contents rule, on the text the folder walk already read: it opens no
 * file and follows no link of its own. Each .md file but the top-level
 * README.md, which is for people and not read by the agent, warns when it is
 * over CONTENTS_LINES_MAX lines with no Contents heading in its first
 * CONTENTS_WINDOW. SKILL.md and CONTRACT.md at the top are not in the walk's
 * list. One line per file, in path order, naming the file and never quoting
 * it.
 */
function contentsRule(contents, report) {
  const files = contents.filter(f => f.text !== undefined && f.rel.endsWith('.md') && f.rel !== 'README.md');
  files.sort(byRel);
  for (const f of files) {
    const n = lineCount(f.text);
    if (n > CONTENTS_LINES_MAX && !hasContentsHeading(f.text)) {
      report.warn('contents', `"${clean(f.rel)}" has ${n} lines and no Contents heading in its first ${CONTENTS_WINDOW} (${ANTHROPIC_RULE})`);
    }
  }
}

/**
 * familiar-digest in skill mode. For each covered file, in path order by
 * UTF-16 code unit: its path in UTF-8, a NUL, the byte length of what is
 * hashed for it in decimal, a NUL, then those bytes. A path holds no NUL and
 * every content is framed by its length, so no two folders give the same
 * stream. SKILL.md's bytes are its canonical form in UTF-8.
 */
function folderDigest(canon, contents) {
  const all = [...contents, { rel: 'SKILL.md', bytes: Buffer.from(canon, 'utf8') }];
  all.sort(byRel);
  const hash = createHash('sha256');
  for (const f of all) {
    hash.update(Buffer.from(f.rel, 'utf8'));
    hash.update(NUL_BYTE);
    hash.update(Buffer.from(String(f.bytes.length), 'ascii'));
    hash.update(NUL_BYTE);
    hash.update(f.bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

// ---------------------------------------------------------------- locating

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Skill mode on a folder. The familiar and the contract are found by listing
 * the folder, not by opening a name, because a disk that folds case would open
 * `skill.md` as `SKILL.md` and the wrong name would pass. `extra` carries a
 * problem the caller already found in the path it was given.
 */
function locateSkill(abs, extra) {
  const problems = [];
  const note = p => {
    if (!problems.some(q => q.rule === p.rule && q.reason === p.reason)) problems.push(p);
  };
  for (const p of extra) note(p);
  let real = abs;
  try {
    real = realpathSync.native(abs);
  } catch {
    // keep the resolved path
  }
  let familiarExists = false;
  let contractExists = false;
  // One entry at a time, as the folder walk reads, so a folder of a million
  // entries is never held whole to find two names in it.
  const dir = opendirSync(abs);
  try {
    for (let d = dir.readSync(); d !== null; d = dir.readSync()) {
      const e = d.name;
      const lower = e.toLowerCase();
      if (e === 'SKILL.md') familiarExists = true;
      else if (lower === 'skill.md') note({ rule: 'familiar-file', reason: `file must be named SKILL.md (found "${clean(e)}")` });
      if (e === 'CONTRACT.md') contractExists = true;
      else if (lower === 'contract.md') note({ rule: 'contract-file', reason: `file must be named CONTRACT.md (found "${clean(e)}")` });
    }
  } finally {
    dir.closeSync();
  }
  return {
    mode: 'skill',
    dir: abs,
    familiarName: 'SKILL.md',
    familiarPath: join(abs, 'SKILL.md'),
    familiarExists,
    contractName: 'CONTRACT.md',
    contractPath: join(abs, 'CONTRACT.md'),
    contractExists,
    // A case-variant contract still counts as present for the mark rules, so
    // an unmarked file beside one is not reported as "not built from a
    // contract" as well as failing on the name.
    contractVariant: problems.some(p => p.rule === 'contract-file'),
    // The folder's real name on disk, so `.` and a trailing separator compare
    // against the folder the person is standing in.
    expectedName: basename(real),
    nameRule: 'name-matches-folder',
    problems,
  };
}

/**
 * Main mode, for a path whose name is CLAUDE.md in any case. The file and its
 * contract are found by listing the folder, as locateSkill finds SKILL.md:
 * only an exact CLAUDE.md entry is a main agent file, and a case variant on
 * disk fails, whatever case the person typed. A typed path that is not there
 * still lists its folder, so a case-sensitive disk and one that folds case
 * report the same variant. `typedExists` says the typed path was there.
 */
function locateMain(abs, typedExists) {
  const dir = dirname(abs);
  const problems = [];
  let familiarExists = false;
  let variant = false;
  let contractExists = false;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Refusal('path', 'the path does not exist or cannot be read');
  }
  for (const e of entries) {
    const lower = e.toLowerCase();
    if (e === MAIN_NAME) familiarExists = true;
    else if (lower === 'claude.md') {
      variant = true;
      problems.push({ rule: 'familiar-file', reason: `file must be named ${MAIN_NAME} (found "${clean(e)}")` });
    }
    if (e === MAIN_CONTRACT) contractExists = true;
    else if (lower === 'claude.contract.md') {
      problems.push({ rule: 'contract-file', reason: `file must be named "${MAIN_CONTRACT}" (found "${clean(e)}")` });
    }
  }
  if (!typedExists && !familiarExists && !variant) throw new Refusal('path', 'the path does not exist or cannot be read');
  return {
    mode: 'main',
    dir,
    familiarName: MAIN_NAME,
    familiarPath: join(dir, MAIN_NAME),
    familiarExists,
    contractName: MAIN_CONTRACT,
    contractPath: join(dir, MAIN_CONTRACT),
    contractExists,
    contractVariant: problems.some(p => p.rule === 'contract-file'),
    // A CLAUDE.md has no name to compare: it holds no `name` key.
    expectedName: null,
    nameRule: null,
    problems,
  };
}

/**
 * Returns { mode, dir, familiarPath, familiarName, familiarExists,
 * contractPath, contractName, contractExists, contractVariant, expectedName,
 * nameRule, problems }. Throws Refusal for the exit-2 shapes. `mode` is
 * 'skill', 'agent' or 'main'.
 */
function locate(arg) {
  const abs = resolve(arg);
  const st = lstatOrNull(abs);
  // Before the refusal below: on a case-sensitive disk, a typed CLAUDE.md
  // beside a claude.md is not there, and must still name the variant.
  if (basename(abs).toLowerCase() === 'claude.md' && !(st && st.isDirectory())) return locateMain(abs, st !== null);
  if (!st) throw new Refusal('path', 'the path does not exist or cannot be read');
  if (st.isDirectory()) return locateSkill(abs, []);
  const name = basename(abs);
  // A skill's own SKILL.md means the skill. Read as an agent file, its stem
  // would be "SKILL" and every reason printed after that would mislead.
  if (name === 'SKILL.md') return locateSkill(dirname(abs), []);
  if (name.toLowerCase() === 'skill.md') {
    return locateSkill(dirname(abs), [{ rule: 'familiar-file', reason: `file must be named SKILL.md (found "${clean(name)}")` }]);
  }
  if (name.toLowerCase().endsWith('.contract.md')) throw new Refusal('path', "give the familiar's file, not its contract");
  if (!name.endsWith('.md') && !name.endsWith('.toml')) throw new Refusal('path', 'the path must be a skill folder, its SKILL.md, or an agent file ending .md or .toml');
  const dir = dirname(abs);
  const stem = name.endsWith('.md') ? name.slice(0, -3) : name.slice(0, -5);
  const contractName = `${stem}.contract.md`;
  const wanted = contractName.toLowerCase();
  const problems = [];
  let contractExists = false;
  // An agent in both formats is two familiars for one contract, whichever
  // file the path names.
  let mdExists = false;
  let tomlExists = false;
  for (const e of readdirSync(dir)) {
    if (e === contractName) contractExists = true;
    else if (e.toLowerCase() === wanted) {
      problems.push({ rule: 'contract-file', reason: `file must be named "${clean(contractName)}" (found "${clean(e)}")` });
    }
    if (e.toLowerCase() === `${stem.toLowerCase()}.md`) mdExists = true;
    if (e.toLowerCase() === `${stem.toLowerCase()}.toml`) tomlExists = true;
  }
  if (mdExists && tomlExists) {
    problems.push({ rule: 'path', reason: `both .md and .toml exist for stem "${clean(stem)}" creating ambiguity` });
  }

  return {
    mode: 'agent',
    dir,
    familiarName: name,
    familiarPath: abs,
    familiarExists: true,
    contractName,
    contractPath: join(dir, contractName),
    contractExists,
    contractVariant: problems.some(p => p.rule === 'contract-file'),
    expectedName: stem,
    nameRule: 'name-matches-file',
    problems,
  };
}

// ---------------------------------------------------------------- rules

function nameShapeOk(v) {
  return NAME_CHARS_RE.test(v) && !v.startsWith('-') && !v.endsWith('-') && !v.includes('--');
}

function codePoints(s) {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/**
 * The field rules on a parsed familiar. Records into report.
 *
 * Any key the rules do not name fails unless the contract lists it on its
 * `Extra keys:` line, in a .md file and a .toml file alike, each with its own
 * known keys. A listed key passes with any value: the check refuses no value
 * for what it lets the agent do. It warns instead, once per key, on every key
 * that passed and that it does not know to be harmless (see warningRules).
 *
 * A CLAUDE.md takes mainFieldRules instead.
 */
function fieldRules(fm, loc, extras, report) {
  const { top } = fm;
  if (isMode(loc, 'main')) {
    mainFieldRules(top, report);
    return;
  }
  const toml = isTomlFamiliar(loc);
  const known = toml ? TOML_KNOWN_KEYS : KNOWN_KEYS;
  let unknown = 0;
  for (const [key, entry] of top) {
    if (known.has(key) || extras.has(key)) continue;
    unknown += 1;
    report.fail('keys', `unknown key "${clean(key)}" at line ${entry.line}`);
  }
  if (unknown === 0) report.pass('keys');

  const name = top.get('name');
  if (!name) {
    report.fail('name', 'missing (required)');
    report.fail(loc.nameRule, 'no name to compare');
  } else {
    const v = name.value;
    const len = codePoints(v);
    let valid = false;
    if (len < 1 || len > NAME_MAX) report.fail('name', `line ${name.line}: must be 1-${NAME_MAX} characters`);
    else if (!nameShapeOk(v)) {
      report.fail('name', `line ${name.line}: must be lower-case letters, digits and single hyphens, not starting or ending with a hyphen`);
    } else {
      valid = true;
      report.pass('name', v);
      if (isMode(loc, 'skill')) reservedNameRule(v, report);
    }
    // Main mode returned above, so the stem is an agent's.
    const where = isMode(loc, 'skill') ? 'folder' : 'file stem';
    if (v === loc.expectedName) report.pass(loc.nameRule);
    else if (valid) report.fail(loc.nameRule, `name "${v}" differs from the ${where} "${clean(loc.expectedName)}"`);
    else report.fail(loc.nameRule, `line ${name.line}: name differs from the ${where} "${clean(loc.expectedName)}"`);
  }

  const desc = top.get('description');
  if (!desc) report.fail('description', 'missing (required)');
  else if (desc.value.trim() === '') report.fail('description', `line ${desc.line}: empty`);
  else if (codePoints(desc.value) > DESCRIPTION_MAX) report.fail('description', `line ${desc.line}: longer than ${DESCRIPTION_MAX} characters`);
  else {
    report.pass('description');
    if (isMode(loc, 'skill') && TAG_RE.test(desc.value)) {
      report.warn('description-xml', `line ${desc.line}: the description holds an XML tag (${ANTHROPIC_RULE})`);
    }
  }

  if (toml) {
    tomlKeyRules(top, report);
    warningRules(top, toml, known, extras, report);
    return;
  }

  const compat = top.get('compatibility');
  if (compat) {
    const len = codePoints(compat.value);
    if (len < 1 || len > COMPATIBILITY_MAX) report.fail('compatibility', `line ${compat.line}: must be 1-${COMPATIBILITY_MAX} characters`);
    else report.pass('compatibility');
  }

  for (const key of ['license', 'allowed-tools']) {
    const e = top.get(key);
    if (!e) continue;
    if (e.value.includes('\n')) report.fail(key, `line ${e.line}: must be one line`);
    else report.pass(key);
  }

  metadataRule(top, report);
  if (isMode(loc, 'agent')) toolsRules(top, extras, report);
  warningRules(top, toml, known, extras, report);
}

/** `metadata:` must be a map, in every .md file. */
function metadataRule(top, report) {
  const meta = top.get('metadata');
  if (!meta) return;
  if (meta.kind !== 'map') report.fail('metadata', `line ${meta.line}: must be a map of text values`);
  else report.pass('metadata');
}

/**
 * The field rules of a CLAUDE.md. `name`, `description` and `tools` fail (see
 * MAIN_REFUSED_KEYS). `metadata` is checked as in any .md file. Every other
 * key warns, naming the key and its line, never its value: Claude Code
 * ignores it when the file loads as CLAUDE.md. It is not refused, since it
 * does no harm there and the person may want it. The .md danger rows still
 * apply to it.
 */
function mainFieldRules(top, report) {
  let refused = 0;
  for (const [key, entry] of top) {
    if (!MAIN_REFUSED_KEYS.has(key)) continue;
    refused += 1;
    report.fail('keys', `"${key}" at line ${entry.line}: a main agent file must not hold it; with it, the file loads as a sub-agent from an agents folder`);
  }
  if (refused === 0) report.pass('keys');
  metadataRule(top, report);
  const danger = DANGER.get('.md');
  for (const [key, entry] of top) {
    if (MAIN_REFUSED_KEYS.has(key) || key === 'metadata') continue;
    const row = danger.get(key);
    if (row !== undefined && !dangerSafe(row, entry)) report.warn('danger', `${key} at line ${entry.line} ${row.label}`);
    report.warn('ignored-key', `${clean(key)} at line ${entry.line}: Claude Code ignores it when the file loads as ${MAIN_NAME}`);
  }
}

/** True when a `tools` entry lists nothing: an empty flow list, or an empty or blank value. */
function toolsEmpty(entry) {
  if (entry.flow) return flowEmpty(entry.value.slice(1, -1));
  return entry.value.trim() === '';
}

/**
 * The `tools` rules of an agent .md, run after parsing.
 *
 * tools-missing: no `tools` key, or one that lists nothing, warns. It never
 * fails. With no key, or an empty or blank value, Claude Code may give the
 * agent every tool. With an empty flow list, `tools: []`, the agent gets none,
 * as load test 5 in references/binding-claude.md found.
 *
 * tools-item: each item goes through toolsItemOk, in every written form. A
 * flow list is split on the commas outside quotes, with each quoted item
 * read by the strict readers; a one-line value, already read by parseScalar,
 * is split on every comma, as Claude Code splits it. A quoted flow item that
 * holds a comma fails, since it reads as one item here and two there. A
 * block value fails whole. A failure names the item's position and line,
 * never the item. Each accepted whole-server item warns once, when `tools`
 * passed the keys rule.
 */
function toolsRules(top, extras, report) {
  const entry = top.get('tools');
  if (entry && entry.flow && toolsEmpty(entry)) report.warn('tools-missing', TOOLS_MISSING.emptyList);
  else if (!entry || toolsEmpty(entry)) report.warn('tools-missing', TOOLS_MISSING.none);
  if (!entry) return;
  if (entry.block) {
    report.fail('tools-item', `line ${entry.line}: ${TOOLS_REASON.block}`);
    return;
  }
  const items = entry.flow
    ? toolsFlowItems(entry.value.slice(1, -1), entry.line)
    : entry.value.split(',').map(part => ({ text: part.trim(), quoted: false }));
  items.forEach((item, k) => {
    const where = `item ${k + 1} at line ${entry.line}`;
    if (item.quoted && item.text.includes(',')) {
      report.fail('tools-item', `${where}: ${TOOLS_REASON.comma}`);
      return;
    }
    const r = toolsItemOk(item.text);
    if (!r.ok) report.fail('tools-item', `${where}: ${r.why}`);
    else if (r.grant && extras.has('tools')) report.warn('danger', `tools ${where} ${TOOLS_GRANT}`);
  });
}

/**
 * A skill name, already valid, that holds a reserved word warns once, naming
 * each word it holds. The words come from RESERVED_WORDS, never the name.
 */
function reservedNameRule(name, report) {
  const found = RESERVED_WORDS.filter(w => name.includes(w));
  if (found.length === 0) return;
  const words = found.length === 1 ? `word "${found[0]}"` : `words ${found.map(w => `"${w}"`).join(' and ')}`;
  report.warn('reserved-name', `the name holds the reserved ${words} (${ANTHROPIC_RULE})`);
}

/**
 * The .toml keys past name and description. developer_instructions is the
 * agent's prompt, so it must be there and hold text. sandbox_mode sets what
 * the agent may do without asking. It takes any value: one of its two narrow
 * values prints PASS sandbox-mode, and any other prints nothing here, since
 * its danger warning comes from warningRules. Its value is never echoed.
 */
function tomlKeyRules(top, report) {
  const di = top.get('developer_instructions');
  if (!di) report.fail('developer_instructions', 'missing (required)');
  else if (di.value.trim() === '') report.fail('developer_instructions', `line ${di.line}: empty`);
  else report.pass('developer_instructions');

  const sm = top.get('sandbox_mode');
  if (sm && SANDBOX_MODES.has(sm.value)) report.pass('sandbox-mode');
}

/**
 * True when a DANGER row's value is in its safe set. A row with no safe set
 * is never safe, whatever its value, an empty flow list `[]` included: a
 * loader may read an empty list as a setting that is on. On a row with a safe
 * set, a flow list, `[a, b]`, is safe when every item is, and an empty one
 * holds nothing to warn on. Any other value, a quoted "[a]" included, is
 * compared whole.
 */
function dangerSafe(row, entry) {
  if (row.safe === null) return false;
  if (entry.flow) {
    const inner = entry.value.slice(1, -1);
    if (trimEndSpaces(inner.slice(leading(inner).width)) === '') return true;
    return flowItems(inner).every(item => row.safe.has(item));
  }
  if (entry.kind !== 'text') return false;
  return row.safe.has(entry.value);
}

/**
 * The warnings, one line per key at most, on each key that passed the keys
 * rule: a known key or one the contract lists. A key that failed it has its
 * FAIL line already. A key with a DANGER row prints the row's line unless its
 * value is safe. Any other key outside the known keys and HARMLESS prints the
 * plainer `unreviewed` line, with the key cleaned. No value is ever echoed.
 * Both are warnings: they never fail the check, and --seal still seals.
 */
function warningRules(top, toml, known, extras, report) {
  const kind = toml ? '.toml' : '.md';
  const danger = DANGER.get(kind);
  const harmless = HARMLESS.get(kind);
  for (const [key, entry] of top) {
    if (!known.has(key) && !extras.has(key)) continue;
    const row = danger.get(key);
    if (row !== undefined) {
      if (!dangerSafe(row, entry)) report.warn('danger', `${key} at line ${entry.line} ${row.label}`);
    } else if (!known.has(key) && !harmless.has(key)) {
      report.warn('unreviewed', `${clean(key)} at line ${entry.line} is a setting this check does not review`);
    }
  }
}

/**
 * The contract's `Target:` line against the familiar. Records into report.
 * An agent's contract names the tool it is built for, which fixes the file
 * ending; with none, the check warns, because the ending was then chosen by
 * nobody on record. A skill is the same format everywhere, so its contract
 * names none. A CLAUDE.md is Claude Code's alone, so its contract names
 * claude, and a missing line fails. The target is echoed only once it is one
 * of the known three.
 */
function targetRule(facts, loc, report) {
  const t = facts.targets;
  if (t.length > 1) {
    report.cannot('target', 'the contract has more than one "Target:" line');
    return;
  }
  if (isMode(loc, 'skill')) {
    if (t.length === 1) report.fail('target', "a skill's contract names a target; only an agent's contract has a \"Target:\" line");
    return;
  }
  if (isMode(loc, 'main')) {
    if (t.length === 1 && t[0] === 'claude') report.pass('target', 'claude');
    else report.fail('target', 'a main agent file\'s contract must name claude on its "Target:" line');
    return;
  }
  if (t.length === 0) {
    report.warn('target', 'the contract names no target');
    return;
  }
  const needs = TARGETS.get(t[0]);
  if (needs === undefined) report.fail('target', 'the "Target:" line must name claude, antigravity or codex');
  else if (needs !== (isTomlFamiliar(loc) ? '.toml' : '.md')) report.fail('target', `the contract names ${t[0]}, which needs a ${needs} file`);
  else report.pass('target', t[0]);
}

/**
 * The contract's `Kind:` line against the familiar. Records into report.
 * Beside a skill or an agent the line is optional, so every contract written
 * before it keeps passing; when present it must name what the path is. Beside
 * a CLAUDE.md it is required and must say "main agent file". Two lines, or a
 * value outside the three, fail. The kind is echoed only once it is one of
 * the three.
 */
function kindRule(facts, loc, report) {
  const k = facts.kinds;
  const want = KIND_OF.get(loc.mode);
  if (want === undefined) throw new Error('unknown mode');
  if (k.length > 1) {
    report.fail('kind', 'the contract has more than one "Kind:" line');
    return;
  }
  const mainWant = 'a main agent file\'s contract must say "Kind: main agent file"';
  if (k.length === 0) {
    if (isMode(loc, 'main')) report.fail('kind', mainWant);
    return;
  }
  if (!KINDS.has(k[0])) report.fail('kind', 'the "Kind:" line must say skill, agent or main agent file');
  else if (k[0] === want) report.pass('kind', want);
  else if (isMode(loc, 'main')) report.fail('kind', mainWant);
  else report.fail('kind', `the contract's "Kind:" line does not match the familiar, which is ${KIND_ARTICLE.get(loc.mode)}`);
}

/**
 * A contract holds no frontmatter. One that opens with a `---` line could
 * carry a `name`, and Claude Code loads any .md file in an agents folder that
 * does as an agent, with every tool when it lists none. The binding lets a
 * contract sit beside its agent there, so the check refuses that first line.
 */
function contractFrameRule(con, label, report) {
  if (con.lines[0] === '---') report.fail('contract-frontmatter', `${label} starts with a "---" line; a contract holds no frontmatter`);
}

/** The character rule's hits in one file readText read, each with the file's label. */
function characterHits(file, label) {
  return findRefused(file).map(h => ({ label, ...h }));
}

// The most hit lines the character rule prints in one run, counted across the
// familiar and the contract. The rest are counted in one summary line, so a
// file with a hit on every line cannot flood the output, and twenty are enough
// to find and fix before the next run.
const CHARACTER_HITS_MAX = 20;

/** Record the character rule's hits: the first CHARACTER_HITS_MAX, then a count of the rest. */
function reportCharacters(hits, report) {
  for (const h of hits.slice(0, CHARACTER_HITS_MAX)) report.cannot('characters', `${h.label} line ${h.line} holds ${h.what}`);
  const rest = hits.length - CHARACTER_HITS_MAX;
  if (rest > 0) report.cannot('characters', `${rest} more ${rest === 1 ? 'line holds' : 'lines hold'} a refused character`);
}

/** The character rule under --seal: the hits, then a Refusal, so nothing is written. */
function refuseCharacters(file, label, report) {
  const hits = characterHits(file, label);
  if (hits.length === 0) return;
  const scratch = new Report();
  reportCharacters(hits, scratch);
  report.lines.push(...scratch.lines);
  throw new Refusal('characters', `${label} holds a character this check refuses`);
}

function invisibleRule(file, label, report) {
  const hit = findInvisible(file.text);
  if (hit) report.fail('invisible-characters', `${label} line ${hit.line} holds ${hex4(hit.cp)}`);
  else report.pass('invisible-characters', label);
  return !hit;
}

/** lstat a file, require a regular file, read it. Records a failure and returns null on any problem. */
function loadFile(path, role, label, report) {
  const st = lstatOrNull(path);
  if (!st || !st.isFile()) {
    report.fail(`${role}-file`, `${label} is not a regular file (a symlink, a folder or missing)`);
    return null;
  }
  const r = readText(path);
  if (!r.ok) {
    report.cannot(`${role}-read`, `${label} ${r.why}`);
    return null;
  }
  return r;
}

function bodyLineCount(lines, close) {
  let n = lines.length - close - 1;
  if (n > 0 && lines[lines.length - 1] === '') n -= 1;
  return n;
}

/** The whole check. Reads everything from disk. */
function runCheck(loc, report) {
  const famLabel = clean(loc.familiarName);
  const conLabel = clean(loc.contractName);
  for (const p of loc.problems) report.fail(p.rule, p.reason);
  if (!loc.familiarExists) {
    report.fail('familiar-file', `no ${famLabel} in the folder`);
    return;
  }
  const fam = loadFile(loc.familiarPath, 'familiar', famLabel, report);
  if (!fam) return;
  const contractPresent = loc.contractExists || loc.contractVariant;
  let con = null;
  if (loc.contractExists) con = loadFile(loc.contractPath, 'contract', conLabel, report);

  // The character rule, before any other rule reads either file, so that no
  // PASS or WARN line is built from a file this check read one way and a
  // loader could read another. Both files are scanned in full, and each line
  // that holds one is reported, up to CHARACTER_HITS_MAX lines across the
  // two. A .toml familiar takes the rule in tomlLineRules instead, line by
  // line as its reader goes.
  const toml = isTomlFamiliar(loc);
  const hits = [...(toml ? [] : characterHits(fam, famLabel)), ...(con ? characterHits(con, conLabel) : [])];
  if (hits.length > 0) {
    reportCharacters(hits, report);
    return;
  }

  invisibleRule(fam, famLabel, report);
  if (con) invisibleRule(con, conLabel, report);
  const folder = isMode(loc, 'skill') ? folderRules(loc, report) : null;

  const facts = con ? contractFacts(con.lines) : { version: null, extras: new Set(), targets: [], kinds: [] };
  if (con) {
    targetRule(facts, loc, report);
    kindRule(facts, loc, report);
    contractFrameRule(con, conLabel, report);
  }

  const formatRule = toml ? 'toml' : 'frontmatter';
  let fm;
  try {
    fm = parseFamiliar(fam, loc, facts.extras);
  } catch (err) {
    if (!(err instanceof CannotCheck)) throw err;
    report.cannot(formatRule, `${famLabel} line ${err.line}: ${err.reason}`);
    return;
  }
  if (fm === null) {
    report.fail('frontmatter', 'no frontmatter (the first line must be --- and a later line must be ---)');
    return;
  }
  report.pass(formatRule);

  fieldRules(fm, loc, facts.extras, report);

  // Advice, not a rule: a long body still loads. A warning never fails. A
  // .toml file has no body apart from its keys, so it gets no line at all: a
  // pass for a rule that did not run would be a false report. A CLAUDE.md
  // with no frontmatter is all body.
  if (!toml) {
    const bodyLines = bodyLineCount(fam.lines, fm.close);
    if (bodyLines > BODY_LINES_MAX) report.warn('body-length', `body is ${bodyLines} lines; the advised limit is ${BODY_LINES_MAX}`);
    else report.pass('body-length');
  }
  if (isMode(loc, 'main')) importRule(fam.lines, fm.close, report);

  // The mark and the contract travel together. Either one alone is a file
  // somebody changed without the other, so both halves of the mismatch fail.
  const entries = fm.seal ? fm.seal.entries : new Map();
  const present = MARK_KEYS.filter(k => entries.has(k));
  const hasMark = present.length > 0;
  if (hasMark && present.length < MARK_KEYS.length) {
    const missing = MARK_KEYS.filter(k => !entries.has(k));
    report.fail('mark', `partial mark; missing ${missing.join(', ')}`);
  }
  if (!hasMark && !contractPresent) {
    report.pass('contract', 'not built from a contract');
    return;
  }
  if (hasMark && !contractPresent) {
    report.fail('contract', 'marked, but its contract is missing');
    return;
  }
  if (!hasMark && contractPresent) {
    report.fail('contract', 'contract present, but the file is not sealed');
    return;
  }
  report.pass('contract', 'marked, contract present');
  if (!con) return; // its failure is already recorded
  if (present.length < MARK_KEYS.length) return;

  // The mark says the file and its contract are unchanged since the last
  // seal. It says nothing about who sealed them: anyone can compute a SHA-256.
  //
  // contract-version is the readable half of the mark. A changed Version line
  // also breaks contract-digest, so this rule fires on its own only when the
  // mark's own contract-version is edited by hand — and the mark lines are
  // left out of familiar-digest, so nothing else would catch that.
  const cv = entries.get('contract-version');
  if (facts.version === null) report.fail('contract-version', `${conLabel} has no "Version:" line`);
  else if (cv.value !== facts.version) report.fail('contract-version', `line ${cv.line}: does not match the contract's Version line`);
  else report.pass('contract-version');

  // In skill mode the digest cannot say which file changed, so the failure
  // names none. An agent and a CLAUDE.md are one file each.
  const fd = entries.get('familiar-digest');
  const canon = canonicalFamiliar(fam.lines, fm.seal, fm.close, isMode(loc, 'main'));
  if (isMode(loc, 'agent') || isMode(loc, 'main')) {
    if (fd.value !== digest(canon)) {
      report.fail('familiar-digest', `line ${fd.line}: the seal is broken; ${famLabel} changed since it was sealed`);
    } else report.pass('familiar-digest');
  } else if (folder === null) {
    report.cannot('familiar-digest', 'the folder was not read in full, so the seal was not compared');
  } else if (fd.value !== folderDigest(canon, folder)) {
    report.fail('familiar-digest', "the seal is broken; a file in the familiar's folder changed since it was sealed");
  } else report.pass('familiar-digest');

  const cd = entries.get('contract-digest');
  if (cd.value !== digest(withOneTrailingLf(con.lines))) {
    report.fail('contract-digest', `line ${cd.line}: the seal is broken; ${conLabel} changed since the familiar was sealed`);
  } else report.pass('contract-digest');
}

// ---------------------------------------------------------------- seal

function escapeDq(s) {
  return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/** True when the seal may write this version as a plain value (see VERSION_PART_RE). */
function sealableVersion(v) {
  let cut = -1;
  for (let i = 0; i < v.length; i += 1) {
    if (v[i] === '-' || v[i] === '+') {
      cut = i;
      break;
    }
  }
  const core = cut < 0 ? v : v.slice(0, cut);
  const parts = core.split('.');
  if (parts.length < 3 || !parts.every(p => VERSION_PART_RE.test(p))) return false;
  return cut < 0 || VERSION_SUFFIX_RE.test(v.slice(cut + 1));
}

/**
 * Write the mark into a .md file's lines, which change in place. Nothing but
 * the mark changes. A mark key already there is rewritten in place; a missing
 * one goes after the last metadata entry; with no metadata block, `metadata:`
 * and the three keys go just before the closing `---`. An inserted line takes
 * the line ending of the line above it. contract-version is written plain
 * (see sealableVersion); the digests stay quoted.
 *
 * With no frontmatter at all (`close` is -1), which only a CLAUDE.md may
 * have, a block holding only the mark goes at the very top, its lines taking
 * the first line's ending, or LF when the file is one line with none.
 */
function writeYamlMark(raw, meta, values, close) {
  const markLine = k => (k === 'contract-version' ? `  ${k}: ${values[k]}` : `  ${k}: "${escapeDq(values[k])}"`);
  if (close < 0) {
    const eol = raw[0].eol || '\n';
    raw.splice(0, 0, ...['---', 'metadata:', ...MARK_KEYS.map(markLine), '---'].map(text => ({ text, eol })));
    return;
  }
  let insertAfter;
  let toInsert;
  if (meta) {
    const have = new Map();
    for (const idx of meta.childIdx) {
      const key = raw[idx].text.slice(2, raw[idx].text.indexOf(':'));
      if (MARK_KEYS.includes(key)) have.set(key, idx);
    }
    for (const [k, idx] of have) raw[idx].text = markLine(k);
    toInsert = MARK_KEYS.filter(k => !have.has(k)).map(markLine);
    insertAfter = meta.childIdx.length > 0 ? meta.childIdx[meta.childIdx.length - 1] : meta.headerIdx;
  } else {
    toInsert = ['metadata:', ...MARK_KEYS.map(markLine)];
    insertAfter = close - 1;
  }
  const eol = raw[insertAfter].eol || '\n';
  raw.splice(insertAfter + 1, 0, ...toInsert.map(text => ({ text, eol })));
}

/**
 * Write the seal block into a .toml file's lines, which change in place. A
 * block already there is rewritten line for line, each keeping its ending.
 * Otherwise the block goes directly after the file's last line, and each of
 * its lines takes the file's own ending: that of the last line that has one,
 * or LF. A last line with no ending gets that one first. The values need no
 * escape: sealableVersion() allows no quote or backslash, and a digest is hex.
 */
function writeTomlMark(raw, seal, values) {
  const block = MARK_KEYS.map(k => `# ${k} = "${values[k]}"`);
  if (seal) {
    block.forEach((text, j) => {
      raw[seal.start + j].text = text;
    });
    return;
  }
  let eol = '\n';
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i].eol !== '') {
      eol = raw[i].eol;
      break;
    }
  }
  // A file that ends in a line ending leaves one empty entry after its last
  // line, and the block goes before it.
  const last = raw[raw.length - 1];
  let at = raw.length;
  if (last.text === '') at -= 1;
  else last.eol = eol;
  raw.splice(at, 0, ...block.map(text => ({ text, eol })));
}

/**
 * Write the mark, or throw Refusal with nothing written.
 *
 * Every refusal comes before the write. A seal over a file that fails, or
 * over a contract that fails, would mark something the check then rejects, and
 * a mark on a failing file is a mark somebody might trust.
 */
function runSeal(loc, report) {
  const famLabel = clean(loc.familiarName);
  const conLabel = clean(loc.contractName);
  if (loc.problems.length > 0) throw new Refusal(loc.problems[0].rule, loc.problems[0].reason);
  if (!loc.familiarExists) throw new Refusal('familiar-file', `no ${famLabel} in the folder`);
  // A symlink is refused rather than followed, so the seal writes the file
  // the path names and never a file somewhere else.
  const fst = lstatOrNull(loc.familiarPath);
  if (!fst || !fst.isFile()) throw new Refusal('familiar-file', `${famLabel} is not a regular file (a symlink, a folder or missing)`);
  if (!loc.contractExists) throw new Refusal('contract-file', `no ${conLabel} beside the familiar`);
  const cst = lstatOrNull(loc.contractPath);
  if (!cst || !cst.isFile()) throw new Refusal('contract-file', `${conLabel} is not a regular file (a symlink, a folder or missing)`);

  const fam = readText(loc.familiarPath);
  if (!fam.ok) throw new Refusal('familiar-read', `${famLabel} ${fam.why}`);
  const con = readText(loc.contractPath);
  if (!con.ok) throw new Refusal('contract-read', `${conLabel} ${con.why}`);
  // The character rule first, as in the check, before any line of the
  // contract is read for its meaning.
  refuseCharacters(con, conLabel, report);

  // The contract's own rules: the invisible-character rule, its target and
  // kind against the familiar, and no frontmatter. A missing target only
  // warns beside an agent, so it seals.
  const facts = contractFacts(con.lines);
  const conScratch = new Report();
  invisibleRule(con, conLabel, conScratch);
  targetRule(facts, loc, conScratch);
  kindRule(facts, loc, conScratch);
  contractFrameRule(con, conLabel, conScratch);
  if (conScratch.failed) {
    for (const l of conScratch.lines) if (l.startsWith('FAIL ') || l.startsWith('CANNOT-CHECK ')) report.lines.push(l);
    throw new Refusal('contract-rules', `${conLabel} fails its file rules`);
  }

  if (facts.version === null) throw new Refusal('contract-version', `${conLabel} has no "Version:" line`);
  // The reason is fixed text. The version came from a file a stranger may
  // have written, so it is never echoed.
  if (!sealableVersion(facts.version)) {
    throw new Refusal(
      'contract-version',
      `the Version line in ${conLabel} must be numbers separated by at least two dots, such as 0.5.0, with an optional - or + suffix; a bare number such as 0.5 is refused`,
    );
  }
  // The same value read back the way the check reads it. The shape above
  // already rules out every value that fails here; this holds if it drifts.
  let readBack;
  try {
    readBack = parseScalar(facts.version, 1, null, null);
  } catch (err) {
    if (!(err instanceof CannotCheck)) throw err;
    readBack = null;
  }
  if (readBack !== facts.version) {
    throw new Refusal('contract-version', `the Version line in ${conLabel} would not read back unchanged once written`);
  }

  const toml = isTomlFamiliar(loc);
  // A .toml familiar takes the character rule in its reader, tomlLineRules.
  if (!toml) refuseCharacters(fam, famLabel, report);
  let fm;
  try {
    fm = parseFamiliar(fam, loc, facts.extras);
  } catch (err) {
    if (!(err instanceof CannotCheck)) throw err;
    throw new Refusal(toml ? 'toml' : 'frontmatter', `cannot check ${famLabel} line ${err.line}: ${err.reason}`);
  }
  if (fm === null) throw new Refusal('frontmatter', 'no frontmatter');

  const scratch = new Report();
  invisibleRule(fam, famLabel, scratch);
  fieldRules(fm, loc, facts.extras, scratch);
  if (scratch.failed) {
    for (const l of scratch.lines) if (!l.startsWith('PASS ')) report.lines.push(l);
    throw new Refusal('field-rules', `${famLabel} fails the field rules`);
  }

  // The seal covers the whole folder, so it refuses a folder the check would
  // fail or could not read: a mark over it would cover a file nobody checked.
  let folder = null;
  if (isMode(loc, 'skill')) {
    const folderScratch = new Report();
    folder = folderRules(loc, folderScratch);
    if (folderScratch.failed) {
      for (const l of folderScratch.lines) if (!l.startsWith('PASS ')) report.lines.push(l);
      throw new Refusal('folder-rules', 'the folder fails its file rules');
    }
  }

  const main = isMode(loc, 'main');
  const canon = canonicalFamiliar(fam.lines, fm.seal, fm.close, main);
  const values = {
    'contract-version': facts.version,
    'familiar-digest': folder === null ? digest(canon) : folderDigest(canon, folder),
    'contract-digest': digest(withOneTrailingLf(con.lines)),
  };

  const raw = fam.rawLines.map(l => ({ text: l.text, eol: l.eol }));
  if (toml) writeTomlMark(raw, fm.seal, values);
  else writeYamlMark(raw, fm.seal, values, fm.close);
  const out = (fam.bom ? '\u{FEFF}' : '') + raw.map(l => l.text + l.eol).join('');

  // Before writing, the new text must parse, through the same reader the
  // check uses, and keep the canonical form the digest was taken over. A seal
  // that broke its own file would be refused by the next check, after the
  // file was already changed. A text that would not parse is refused here
  // too, never thrown past the seal, and the mark it would hold must be the
  // mark just written, with the contract's Version line.
  const newLines = raw.map(l => l.text);
  let newFm;
  try {
    newFm = parseFamiliar({ bom: fam.bom, rawLines: raw, lines: newLines }, loc, facts.extras);
  } catch (err) {
    if (!(err instanceof CannotCheck)) throw err;
    throw new Refusal('seal', 'internal error: the sealed text would not parse');
  }
  if (newFm === null) throw new Refusal('seal', 'internal error: the sealed text would have no frontmatter');
  if (canonicalFamiliar(newLines, newFm.seal, newFm.close, main) !== canon) {
    throw new Refusal('seal', 'internal error: the sealed text would not keep its canonical form');
  }
  const newEntries = newFm.seal ? newFm.seal.entries : new Map();
  const newCv = newEntries.get('contract-version');
  if (!newCv || newCv.value !== facts.version) {
    throw new Refusal('seal', "internal error: the sealed contract-version would not match the contract's Version line");
  }
  if (!MARK_KEYS.every(k => newEntries.has(k) && newEntries.get(k).value === values[k])) {
    throw new Refusal('seal', 'internal error: the sealed mark would not read back as it was written');
  }

  // A temporary file in the same folder, then a rename over the familiar. The
  // rename replaces the folder's entry, so a reader sees the old file or the
  // new one and never half of either, and a hard link to the old file keeps
  // the old bytes. The temporary name is created exclusively, so it can never
  // be a file that was already there, and only a file this run created is
  // removed when the write or the rename fails.
  const tmp = join(loc.dir, `.${basename(loc.familiarPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let created = false;
  try {
    const fd = openSync(tmp, 'wx', fst.mode & 0o777);
    created = true;
    try {
      writeFileSync(fd, out, 'utf8');
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, loc.familiarPath);
  } catch (err) {
    if (created) {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing more to do
      }
    }
    throw new Refusal('seal-write', `${famLabel} could not be written (${clean(err && err.code ? err.code : 'error')})`);
  }

  // The real path, not the one typed. A link or a junction in a parent folder
  // is followed by the write, so the path a person typed can name one folder
  // while the file lands in another. Printed whole, so they can see which.
  let realDir = loc.dir;
  try {
    realDir = realpathSync.native(loc.dir);
  } catch {
    // keep the resolved path
  }
  report.pass('seal', `wrote ${cleanUncut(join(realDir, basename(loc.familiarPath)))}`);
}

// ---------------------------------------------------------------- main

const USAGE = 'usage: node check.mjs [--seal] <path>';

function main(argv) {
  const report = new Report();
  let seal = false;
  let target = null;
  // A path that starts with "-" is read as a flag and refused. Write it ./-x.
  if (argv.length === 1 && argv[0] !== '' && !argv[0].startsWith('-')) target = argv[0];
  else if (argv.length === 2 && argv[0] === '--seal' && argv[1] !== '' && !argv[1].startsWith('-')) {
    seal = true;
    target = argv[1];
  }
  let code;
  try {
    if (target === null) throw new Refusal('usage', USAGE);
    const loc = locate(target);
    if (seal) runSeal(loc, report);
    runCheck(loc, report);
    code = report.failed ? 1 : 0;
  } catch (err) {
    if (err instanceof Refusal) {
      report.fail(err.rule, err.reason);
      if (seal) report.fail('seal', 'refused; nothing written');
      code = 2;
    } else {
      // Never a pass. An error in the check itself is a check that did not run.
      report.cannot('internal', `the check itself failed (${clean(err && err.code ? err.code : 'error')})`);
      code = 1;
    }
  }
  report.lines.push(`RESULT: ${code === 0 ? 'pass' : 'fail'}`);
  process.stdout.write(`${report.lines.join('\n')}\n`);
  process.exitCode = code;
}

main(process.argv.slice(2));
