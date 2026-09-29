#!/usr/bin/env node
// Format check for a familiar — a skill's SKILL.md, or an agent's <name>.md —
// and the contract it was built from. Zero dependencies.
//
//   node check.mjs <path>           check
//   node check.mjs --seal <path>    write the mark, then check
//
// <path> is a skill folder, the SKILL.md inside one, or an agent file ending
// .md whose contract sits beside it as <name>.contract.md. For a skill, the
// seal covers every file in its folder but CONTRACT.md (see "the folder").
//
// Exit 0 pass (warnings allowed), 1 fail or cannot check, 2 usage or refusal.
// The exit code is the verdict, and the skill reads the code rather than the
// text. The text is for a person, and it is built so that nothing a file says
// can speak through it: it never echoes a field value, except a `name` that
// already matched the name pattern, and every character it does echo from a
// file or a folder name is cleaned first.
//
// The files this reads may come from a stranger, so the reader below is not a
// YAML parser and does not try to be. It reads one small subset of the format
// and calls everything else "cannot check", which is a failure. A reader that
// guessed at the rest would pass a file whose meaning it had not read.
//
// Node 20 or later, ESM, node: built-ins only. No regex here has a nested
// quantifier, and none runs over a whole file: every regex is applied to one
// line or one value.

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

// Top-level keys admit upper case, because a runtime key such as
// `permissionMode` has to parse before the unknown-key rule can refuse it, or
// pass it when the contract lists it. Metadata keys stay lower case: the mark
// lives there, and nothing else this check reads does.
const TOP_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const META_KEY_RE = /^[a-z][a-z0-9-]*$/;
// Lower-case letters, digits and hyphens, and nameShapeOk() adds the rest: no
// leading, trailing or double hyphen. Written flat so it has no nested
// quantifier.
const NAME_CHARS_RE = /^[a-z0-9-]+$/;
const VERSION_RE = /^Version: (\S+)$/;
const EXTRA_RE = /^Extra keys: (.*)$/;
const MARK_LINE_RE = /^ {2}(contract-version|familiar-digest|contract-digest): .*$/;
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
// matched in any case. The number patterns are the one pattern the format
// gives, split into flat halves so none has a nested quantifier, and tried
// after one leading sign is taken off. A leading zero, as in 017, is YAML 1.1
// octal; the plain digit pattern already refuses it. The other number forms
// are tried after the same sign: hexadecimal (0x1F), binary (0b101), octal
// (0o17) and YAML 1.1 base 60 (1:30 or 190:20:30.15), checked a part at a time
// between the colons. A date or a timestamp, such as 2026-09-27 or
// 2026-09-27T10:00:00Z, is refused by its start alone: four digits, a month
// and a day of one or two digits each, then the end or a T, a t, a space or a
// tab. That is broader than the loaders' own date rule, and refusing a near
// miss is safe.
const YAML_WORDS = new Set(['~', 'null', 'true', 'false', 'yes', 'no', 'on', 'off']);
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
// without being seen: tag characters, bidirectional overrides and isolates,
// zero-width characters, the word joiner, and a byte-order mark anywhere but
// the one leading mark the reader strips.
function isInvisible(cp) {
  return (
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0x200b && cp <= 0x200d) ||
    cp === 0x2060 ||
    cp === 0xfeff
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
 * writes lines back with the ending they came with, so a CRLF or lone-CR file
 * keeps its endings and changes only in the mark lines.
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
 * strict UTF-8, one leading BOM stripped, CRLF and lone CR normalised to LF.
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
  const unsignedLower = unsigned.toLowerCase();
  if (unsignedLower === '.inf' || unsignedLower === '.nan') return true;
  if (YAML_NUMBER_RES.some(re => re.test(unsigned))) return true;
  return yamlBase60(unsigned);
}

/** A one-line value after "key: ". Quoted or plain; anything else is cannot-check. */
function parseScalar(raw, ln, key, extras) {
  if (raw[0] === '"') return parseDoubleQuoted(raw, ln);
  if (raw[0] === "'") return parseSingleQuoted(raw, ln);
  const v = trimEndSpaces(raw);
  if (v === '') throw new CannotCheck(ln, 'an empty value');
  if (v[0] === '\t') throw new CannotCheck(ln, 'a tab before a value');
  if (v.startsWith('[') && v.endsWith(']')) {
    if (key !== 'tools' && !(extras && extras.has(key))) {
      throw new CannotCheck(ln, 'flow sequences are only allowed for tools or Extra keys');
    }
    const inner = v.slice(1, -1);
    if (inner.trim() !== '') {
      const tokens = inner.split(',');
      for (const t of tokens) {
        if (!/^[A-Za-z0-9_-]+$/.test(t.trim())) {
          throw new CannotCheck(ln, 'a flow sequence with an invalid identifier');
        }
      }
    }
    return v;
  }
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
 */
function parseFrontmatter(lines, close, extras) {
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
      top.set(key, { kind: 'text', value: block.value, line: ln });
      i = block.end;
      continue;
    }
    top.set(key, { kind: 'text', value: parseScalar(raw, ln, key, extras), line: ln });
    i += 1;
  }
  return { top, metadata };
}

function parseToml(text, lines) {
  const top = new Map();
  let metadata = null;
  let inString = false;
  let stringStartLine = 1;
  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    if (inString) {
      let stringCount = 0;
      let pos = 0;
      while ((pos = line.indexOf('"""', pos)) !== -1) {
        let slashes = 0;
        let p = pos - 1;
        while (p >= 0 && line[p] === '\\') { slashes++; p--; }
        if (slashes % 2 === 0) stringCount++;
        pos += 3;
      }
      if (stringCount % 2 === 1) inString = false;
      continue;
    }

    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;

    if (t.startsWith('[')) {
      if (!t.endsWith(']')) throw new CannotCheck(ln, 'unclosed table header');
      const tableName = t.slice(1, -1).trim();
      if (tableName === 'metadata') {
        if (metadata !== null) throw new CannotCheck(ln, 'duplicate [metadata] table');
        metadata = { headerIdx: i, entries: new Map(), childIdx: [], end: lines.length };
        currentTable = 'metadata';
      } else {
        if (metadata !== null) throw new CannotCheck(ln, '[metadata] must be the terminal table');
        currentTable = tableName;
      }
      continue;
    }

    const eq = t.indexOf('=');
    if (eq > 0) {
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();

      let stringCount = 0;
      let pos = 0;
      while ((pos = val.indexOf('"""', pos)) !== -1) {
        let slashes = 0;
        let p = pos - 1;
        while (p >= 0 && val[p] === '\\') { slashes++; p--; }
        if (slashes % 2 === 0) stringCount++;
        pos += 3;
      }
      if (stringCount % 2 === 1) {
        inString = true;
        stringStartLine = ln;
      }

      if (currentTable === 'metadata') {
        if (!META_KEY_RE.test(key)) throw new CannotCheck(ln, 'metadata key outside readable subset');
        if (metadata.entries.has(key)) throw new CannotCheck(ln, `duplicate metadata key "${clean(key)}"`);
        let parsedVal = val;
        if (val.startsWith('"') && val.endsWith('"')) {
          parsedVal = val.slice(1, -1);
        }
        metadata.entries.set(key, { value: parsedVal, line: ln });
        metadata.childIdx.push(i);
      } else if (currentTable === null) {
        if (!TOP_KEY_RE.test(key)) throw new CannotCheck(ln, 'a key outside the readable subset');
        if (top.has(key)) throw new CannotCheck(ln, `duplicate key "${clean(key)}"`);
        let parsedVal = val;
        if (val.startsWith('"') && val.endsWith('"') && !val.startsWith('"""')) {
          parsedVal = val.slice(1, -1);
        } else if (val.startsWith("'") && val.endsWith("'") && !val.startsWith("'''")) {
          parsedVal = val.slice(1, -1);
        }
        top.set(key, { kind: 'text', value: parsedVal, line: ln });
      }
    } else {
      if (currentTable === 'metadata') {
        throw new CannotCheck(ln, 'a line under "metadata" that is not "key = value"');
      }
    }
  }

  if (inString) {
    throw new CannotCheck(stringStartLine, 'unclosed multiline string (""")');
  }

  return { top, metadata };
}

// ---------------------------------------------------------------- contract

/**
 * The two lines of a contract this check reads: the first `Version: <v>` and
 * the first `Extra keys: <k>, <k>`. An entry in Extra keys that is not
 * key-shaped is dropped, which can only make the unknown-key rule stricter.
 */
function contractFacts(lines) {
  let version = null;
  let extras = null;
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
    if (version !== null && extras !== null) break;
  }
  return { version, extras: extras ?? new Set() };
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
 * Canonical form of the familiar: the whole file, normalised, with the mark
 * lines inside the metadata block removed (and `metadata:` too, when the mark
 * was all it held). The digest covers the frontmatter as well as the body, so
 * a key added after the seal breaks it.
 */
function canonicalFamiliar(lines, metadata, isToml) {
  const drop = new Set();
  if (metadata) {
    if (isToml) {
      const MARK_LINE_RE_TOML = /^(contract-version|familiar-digest|contract-digest)\s*=\s*.*$/;
      let kept = 0;
      for (const idx of metadata.childIdx) {
        if (MARK_LINE_RE_TOML.test(lines[idx])) drop.add(idx);
        else kept += 1;
      }
      if (kept === 0) drop.add(metadata.headerIdx);
    } else {
      let kept = 0;
      for (const idx of metadata.childIdx) {
        if (MARK_LINE_RE.test(lines[idx])) drop.add(idx);
        else kept += 1;
      }
      if (kept === 0) drop.add(metadata.headerIdx);
    }
  }
  return withOneTrailingLf(lines.filter((_, i) => !drop.has(i)));
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
 * comment, and an editor shows it as two lines. Returns { why } or
 * { bytes, text }.
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
  return { bytes: out.subarray(0, n), text };
}

/**
 * Read the listed files. Returns { ok: false, why } or { ok: true, contents,
 * invisible }, where contents are { rel, bytes } as hashed and invisible holds
 * the first invisible character of each text file that has one.
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
    contents.push({ rel: f.rel, bytes: t.bytes });
    const hit = findInvisible(t.text.charCodeAt(0) === 0xfeff ? t.text.slice(1) : t.text);
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
  return read.contents;
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
  all.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
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
 * Returns { mode, dir, familiarPath, familiarName, familiarExists,
 * contractPath, contractName, contractExists, contractVariant, expectedName,
 * nameRule, problems }. Throws Refusal for the exit-2 shapes.
 */
function locate(arg) {
  const abs = resolve(arg);
  const st = lstatOrNull(abs);
  if (!st) throw new Refusal('path', 'the path does not exist or cannot be read');
  if (st.isDirectory()) return locateSkill(abs, []);
  const name = basename(abs);
  if (name === 'SKILL.md') return locateSkill(dirname(abs), []);
  if (name.toLowerCase() === 'skill.md') {
    return locateSkill(dirname(abs), [{ rule: 'familiar-file', reason: `file must be named SKILL.md (found "${clean(name)}")` }]);
  }
  if (name.toLowerCase().endsWith('.contract.md')) throw new Refusal('path', "give the familiar's file, not its contract");
  if (!name.endsWith('.md') && !name.endsWith('.toml')) throw new Refusal('path', 'the path must be a skill folder, its SKILL.md, or an agent file ending .md or .toml');
  const dir = dirname(abs);
  
  let stem;
  if (name.endsWith('.md')) stem = name.slice(0, -3);
  else stem = name.slice(0, -5);
  
  const contractName = `${stem}.contract.md`;
  const wanted = contractName.toLowerCase();
  const problems = [];
  let contractExists = false;
  
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
 * The field rules on a parsed frontmatter. Records into report.
 *
 * Any key the rules do not name fails unless the contract lists it on its
 * `Extra keys:` line. A key a runtime reads, such as one that sets how much
 * the agent may do without asking, is a change nobody reviewed unless the
 * contract says it was wanted.
 */
function fieldRules(fm, loc, extras, report) {
  const { top } = fm;
  let unknown = 0;
  for (const [key, entry] of top) {
    if (!KNOWN_KEYS.has(key) && !extras.has(key)) {
      unknown += 1;
      report.fail('keys', `unknown key "${clean(key)}" at line ${entry.line}`);
    }
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
    }
    const where = loc.mode === 'skill' ? 'folder' : 'file stem';
    if (v === loc.expectedName) report.pass(loc.nameRule);
    else if (valid) report.fail(loc.nameRule, `name "${v}" differs from the ${where} "${clean(loc.expectedName)}"`);
    else report.fail(loc.nameRule, `line ${name.line}: name differs from the ${where} "${clean(loc.expectedName)}"`);
  }

  const desc = top.get('description');
  if (!desc) report.fail('description', 'missing (required)');
  else if (desc.value.trim() === '') report.fail('description', `line ${desc.line}: empty`);
  else if (codePoints(desc.value) > DESCRIPTION_MAX) report.fail('description', `line ${desc.line}: longer than ${DESCRIPTION_MAX} characters`);
  else report.pass('description');

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

  const meta = top.get('metadata');
  if (meta) {
    if (meta.kind !== 'map') report.fail('metadata', `line ${meta.line}: must be a map of text values`);
    else report.pass('metadata');
  }
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
    report.fail('familiar-file', 'no SKILL.md in the folder');
    return;
  }
  const fam = loadFile(loc.familiarPath, 'familiar', famLabel, report);
  if (!fam) return;
  const contractPresent = loc.contractExists || loc.contractVariant;
  let con = null;
  if (loc.contractExists) con = loadFile(loc.contractPath, 'contract', conLabel, report);

  invisibleRule(fam, famLabel, report);
  if (con) invisibleRule(con, conLabel, report);
  const folder = loc.mode === 'skill' ? folderRules(loc, report) : null;

  const isToml = loc.mode === 'agent' && loc.familiarName.endsWith('.toml');
  
  const facts = con ? contractFacts(con.lines) : { version: null, extras: new Set() };

  let fm;
  if (isToml) {
    try {
      fm = parseToml(fam.text, fam.lines);
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      report.cannot('toml', `${famLabel} line ${err.line}: ${err.reason}`);
      return;
    }
    report.pass('toml');
  } else {
    const close = findFrontmatter(fam.lines);
    if (close < 0) {
      report.fail('frontmatter', 'no frontmatter (the first line must be --- and a later line must be ---)');
      return;
    }
    try {
      fm = parseFrontmatter(fam.lines, close, facts.extras);
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      report.cannot('frontmatter', `${famLabel} line ${err.line}: ${err.reason}`);
      return;
    }
    report.pass('frontmatter');
  }

  fieldRules(fm, loc, facts.extras, report);

  // Advice, not a rule: a long body still loads. A warning never fails.
  if (!isToml) {
    const close = findFrontmatter(fam.lines);
    const bodyLines = bodyLineCount(fam.lines, close);
    if (bodyLines > BODY_LINES_MAX) report.warn('body-length', `body is ${bodyLines} lines; the advised limit is ${BODY_LINES_MAX}`);
    else report.pass('body-length');
  } else {
    report.pass('body-length'); // Doesn't apply in the same way to TOML
  }

  // The mark and the contract travel together. Either one alone is a file
  // somebody changed without the other, so both halves of the mismatch fail.
  const entries = fm.metadata ? fm.metadata.entries : new Map();
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
  // names none.
  const fd = entries.get('familiar-digest');
  const canon = canonicalFamiliar(fam.lines, fm.metadata, isToml);
  if (loc.mode === 'agent') {
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
  if (!loc.familiarExists) throw new Refusal('familiar-file', 'no SKILL.md in the folder');
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

  const conScratch = new Report();
  if (!invisibleRule(con, conLabel, conScratch)) {
    for (const l of conScratch.lines) if (!l.startsWith('PASS ')) report.lines.push(l);
    throw new Refusal('contract-rules', `${conLabel} fails its file rules`);
  }

  const facts = contractFacts(con.lines);
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

  const isToml = loc.mode === 'agent' && loc.familiarName.endsWith('.toml');

  let fm;
  if (isToml) {
    try {
      fm = parseToml(fam.text, fam.lines);
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      throw new Refusal('toml', `cannot check ${famLabel} line ${err.line}: ${err.reason}`);
    }
  } else {
    const close = findFrontmatter(fam.lines);
    if (close < 0) throw new Refusal('frontmatter', 'no frontmatter');
    try {
      fm = parseFrontmatter(fam.lines, close, facts.extras);
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      throw new Refusal('frontmatter', `cannot check ${famLabel} line ${err.line}: ${err.reason}`);
    }
  }

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
  if (loc.mode === 'skill') {
    const folderScratch = new Report();
    folder = folderRules(loc, folderScratch);
    if (folderScratch.failed) {
      for (const l of folderScratch.lines) if (!l.startsWith('PASS ')) report.lines.push(l);
      throw new Refusal('folder-rules', 'the folder fails its file rules');
    }
  }

  const canon = canonicalFamiliar(fam.lines, fm.metadata, isToml);
  const values = {
    'contract-version': facts.version,
    'familiar-digest': folder === null ? digest(canon) : folderDigest(canon, folder),
    'contract-digest': digest(withOneTrailingLf(con.lines)),
  };
  // contract-version is written plain in yaml, quoted in toml
  const markLine = k => {
    if (isToml) {
      return `${k} = "${escapeDq(values[k])}"`;
    }
    return k === 'contract-version' ? `  ${k}: ${values[k]}` : `  ${k}: "${escapeDq(values[k])}"`;
  };

  // Change nothing but the mark. A mark key already there is rewritten in
  // place; a missing one goes after the last metadata entry; with no metadata
  // block, `metadata:` and the three keys go just before the closing `---`.
  // An inserted line takes the line ending of the line above it.
  const raw = fam.rawLines.map(l => ({ text: l.text, eol: l.eol }));
  const meta = fm.metadata;
  let insertAfter;
  let toInsert;
  if (isToml) {
    if (meta) {
      const have = new Map();
      for (const idx of meta.childIdx) {
        const key = raw[idx].text.split('=')[0].trim();
        if (MARK_KEYS.includes(key)) have.set(key, idx);
      }
      for (const [k, idx] of have) raw[idx].text = markLine(k);
      toInsert = MARK_KEYS.filter(k => !have.has(k)).map(markLine);
      insertAfter = meta.childIdx.length > 0 ? meta.childIdx[meta.childIdx.length - 1] : meta.headerIdx;
    } else {
      toInsert = ['[metadata]', ...MARK_KEYS.map(markLine)];
      insertAfter = raw.length - 1;
      if (raw.length > 0 && !raw[raw.length - 1].eol) {
        raw[raw.length - 1].eol = '\n';
      }
    }
  } else {
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
      const close = findFrontmatter(fam.lines);
      insertAfter = close - 1;
    }
  }
  
  const eol = raw[insertAfter].eol || '\n';
  raw.splice(insertAfter + 1, 0, ...toInsert.map(text => ({ text, eol })));
  const out = (fam.bom ? '\u{FEFF}' : '') + raw.map(l => l.text + l.eol).join('');

  // Before writing, the new text must parse and keep the canonical form the
  // digest was taken over. A seal that broke its own file would be refused
  // by the next check, after the file was already changed.
  // A text that would not parse is refused here too, never thrown past the
  // seal, and the contract-version it would hold must be the Version line.
  const newLines = raw.map(l => l.text);
  
  let newFm;
  if (isToml) {
    try {
      newFm = parseToml(out, newLines); // parseToml just ignores text/out actually, it takes lines
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      throw new Refusal('seal', 'internal error: the sealed text would not parse');
    }
  } else {
    const newClose = findFrontmatter(newLines);
    if (newClose < 0) throw new Refusal('seal', 'internal error: the sealed text would have no frontmatter');
    try {
      newFm = parseFrontmatter(newLines, newClose, facts.extras);
    } catch (err) {
      if (!(err instanceof CannotCheck)) throw err;
      throw new Refusal('seal', 'internal error: the sealed text would not parse');
    }
  }
  
  if (canonicalFamiliar(newLines, newFm.metadata, isToml) !== canon) {
    throw new Refusal('seal', 'internal error: the sealed text would not keep its canonical form');
  }
  const newCv = newFm.metadata ? newFm.metadata.entries.get('contract-version') : undefined;
  if (!newCv || newCv.value !== facts.version) {
    throw new Refusal('seal', "internal error: the sealed contract-version would not match the contract's Version line");
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
