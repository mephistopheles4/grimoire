// The partial reads this repository has accepted from SkillSpector, read one
// way by every script that needs them.
//
// SkillSpector 2.11.1 and later run two deeper, bounded passes that 2.11.0 did
// not have, and each one gives up on some ordinary code and prose:
//
//   - `static_parse_limit`: the shell-aware destructive-command parser
//     (`static_patterns_tool_misuse`) followed a command past its fixed span.
//     Only that one check stops.
//   - `obfuscated_instruction_text`: the declared-marker pass, which undoes
//     "remove the marker x from this text" tricks, could not settle a
//     directive. It runs on top of the plain scan, so every check still reads
//     the plain text in full.
//
// Where a pass gives up, the scanner records a ledger exception and counts the
// file as partly read, and the gate fails on that, rightly: not-read is not
// clean. .skillspector-allowances.json at the repository root lists the files
// where a person has looked and accepted it, each keyed by skill, file, reason
// code and the exact checks, and each pinned by the file's content. Any edit to
// an accepted file therefore puts the allowance in the same diff, where review
// sees it. docs/security/scanners.md has the argument; issue #178 has the
// measurements.
//
// Three callers, one reader: scripts/check.mjs validates the file and its
// hashes, scripts/skillspector-gate.mjs judges a JSON report against it, and
// scripts/skillspector-strip-suppressed.mjs judges a SARIF report against it.
// Separate readers would read one file two ways.
//
// Every lookup below is a Map. Skill and file names come from pull requests and
// from scanner output, and a plain object keyed by `constructor` or
// `__proto__` answers a question nobody asked.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ALLOWANCES = '.skillspector-allowances.json';

// Only these two. Each one names a deeper pass that gave up while the plain
// scan read everything. Every other code — a deadline overrun, a bytecode-walk
// overrun, a missing reference, a file not read at all — stays red, so the
// allowance cannot drift into "accept any partial read".
export const REASON_CODES = new Map([
  [
    'static_parse_limit',
    {
      pass: 'the shell-aware destructive-command parser (static_patterns_tool_misuse)',
      lookFor: 'a long command expression with a destructive command (rm, del, erase, a recursive delete) inside it',
    },
  ],
  [
    'obfuscated_instruction_text',
    {
      pass: 'the declared-marker pass, which undoes "remove the marker from this text" tricks',
      lookFor: 'a disguised "remove the marker" directive: text that tells a reader to strip characters to reveal an instruction',
    },
  ],
]);

// The AE1 finding text the scanner writes for a reference to a file it read in
// part. A later release that changes it no longer parses here, and the gate
// goes red rather than guess.
export const AE1_TEXT = /^(.+) \(partial\)$/;
export const AE1_TAG = 'target-disposition:partial';

const TOP_KEYS = ['version', 'exceptions', 'references'];
const EXCEPTION_KEYS = ['skill', 'path', 'reason_code', 'analyzers', 'sha256', 'reason'];
const REFERENCE_KEYS = ['skill', 'from', 'target', 'count'];

// A reason a stranger cannot read is no reason. These are the shapes a
// half-written entry takes.
const PLACEHOLDER = /^(?:todo|tbd|fixme|xxx|placeholder|reason|n\/?a|none|\.\.\.|…|-+)\b|<[^>]*>/i;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o, keys) => {
  const have = Object.keys(o);
  return have.length === keys.length && keys.every(k => Object.hasOwn(o, k));
};

// A path as the report writes it: relative to the skill, forward slashes, no
// empty, `.` or `..` segment, no scheme, no leading slash.
export function isSkillPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return false;
  return p.split('/').every(s => s && s !== '.' && s !== '..');
}

// One directory name under skills/.
export const isSkillName = s => typeof s === 'string' && isSkillPath(s) && !s.includes('/');

export const exceptionKey = e => JSON.stringify([e.skill, e.path, e.reason_code]);
export const referenceKey = r => JSON.stringify([r.skill, r.from, r.target]);

// The content pin. SHA-256 of the file's bytes with CRLF and CR turned into LF,
// so a Windows checkout and the CI runner agree. Latin-1 maps each byte to one
// code unit and back, so nothing but the line endings changes.
export function contentHash(bytes) {
  const lf = Buffer.from(Buffer.from(bytes).toString('latin1').replace(/\r\n?/g, '\n'), 'latin1');
  return createHash('sha256').update(lf).digest('hex');
}

// Parse and validate the file's text. Never throws. A file with any problem is
// refused whole: `value` is null whenever `problems` is non-empty, so no caller
// can treat a broken file as an empty one.
export function parseAllowances(text, where = ALLOWANCES) {
  const problems = [];
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { value: null, problems: [`${where} is not JSON: ${e.message}`] };
  }
  // Canonical form. JSON.parse keeps the last of two repeated keys and says
  // nothing, so the one way to refuse a repeat is to refuse every text that is
  // not the single way of writing what was parsed.
  const canonical = `${JSON.stringify(value, null, 2)}\n`;
  if (text.replace(/\r\n/g, '\n') !== canonical) {
    problems.push(
      `${where} is not in canonical form — it must equal JSON.stringify(parsed, null, 2) plus a newline, which also refuses a repeated key`,
    );
  }
  if (!isObject(value) || !sameKeys(value, TOP_KEYS)) {
    problems.push(`${where}: the top level must be an object with exactly the keys ${TOP_KEYS.join(', ')}`);
    return { value: null, problems };
  }
  if (value.version !== 1) problems.push(`${where}: "version" must be 1`);
  if (!Array.isArray(value.exceptions)) problems.push(`${where}: "exceptions" must be a list`);
  if (!Array.isArray(value.references)) problems.push(`${where}: "references" must be a list`);
  if (problems.length && !(Array.isArray(value.exceptions) && Array.isArray(value.references))) return { value: null, problems };

  const seenExceptions = new Map();
  value.exceptions.forEach((e, i) => {
    const at = `${where}: exceptions[${i}]`;
    if (!isObject(e) || !sameKeys(e, EXCEPTION_KEYS)) {
      problems.push(`${at} must have exactly the keys ${EXCEPTION_KEYS.join(', ')}`);
      return;
    }
    if (!isSkillName(e.skill)) problems.push(`${at}: "skill" must be one directory name under skills/`);
    if (!isSkillPath(e.path)) problems.push(`${at}: "path" must be relative to the skill, with forward slashes and no . or .. segment`);
    if (!REASON_CODES.has(e.reason_code)) {
      problems.push(`${at}: "reason_code" ${JSON.stringify(e.reason_code)} is not one of ${[...REASON_CODES.keys()].join(', ')}`);
    }
    if (!Array.isArray(e.analyzers) || !e.analyzers.length || !e.analyzers.every(a => typeof a === 'string' && a)) {
      problems.push(`${at}: "analyzers" must be a non-empty list of check names`);
    } else {
      const sorted = [...e.analyzers].sort();
      if (sorted.some((a, j) => a !== e.analyzers[j])) problems.push(`${at}: "analyzers" must be sorted`);
      if (new Set(e.analyzers).size !== e.analyzers.length) problems.push(`${at}: "analyzers" must not repeat a check`);
    }
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) problems.push(`${at}: "sha256" must be 64 lowercase hex digits`);
    if (typeof e.reason !== 'string' || !e.reason.trim() || PLACEHOLDER.test(e.reason.trim())) {
      problems.push(`${at}: "reason" must be a sentence a stranger can read, not empty and not a placeholder`);
    }
    const key = exceptionKey(e);
    if (seenExceptions.has(key)) problems.push(`${at} repeats exceptions[${seenExceptions.get(key)}] (same skill, path and reason code)`);
    else seenExceptions.set(key, i);
  });

  const seenReferences = new Map();
  value.references.forEach((r, i) => {
    const at = `${where}: references[${i}]`;
    if (!isObject(r) || !sameKeys(r, REFERENCE_KEYS)) {
      problems.push(`${at} must have exactly the keys ${REFERENCE_KEYS.join(', ')}`);
      return;
    }
    if (!isSkillName(r.skill)) problems.push(`${at}: "skill" must be one directory name under skills/`);
    if (!isSkillPath(r.from)) problems.push(`${at}: "from" must be relative to the skill, with forward slashes and no . or .. segment`);
    if (!isSkillPath(r.target)) problems.push(`${at}: "target" must be relative to the skill, with forward slashes and no . or .. segment`);
    if (!Number.isInteger(r.count) || r.count < 1) problems.push(`${at}: "count" must be a positive whole number`);
    const key = referenceKey(r);
    if (seenReferences.has(key)) problems.push(`${at} repeats references[${seenReferences.get(key)}] (same skill, from and target)`);
    else seenReferences.set(key, i);
    // A reference is accepted only to a file under an exception, so one that
    // names no such file can never match and only reads as an allowance.
    if (!value.exceptions.some(e => isObject(e) && e.skill === r.skill && e.path === r.target)) {
      problems.push(`${at}: target ${JSON.stringify(r.target)} in ${JSON.stringify(r.skill)} has no exception entry`);
    }
  });

  return problems.length ? { value: null, problems } : { value, problems };
}

// Read and parse the file. A missing or unreadable file is a problem, never an
// empty allowance.
export function readAllowances(path, where = ALLOWANCES) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { value: null, problems: [`cannot read ${where}: ${e.code || e.message}`] };
  }
  return parseAllowances(text, where);
}

// The skill a label names. The workflow labels each scan `skills/<name>`, and
// only that shape says which skill's entries apply.
export function skillFromLabel(label) {
  const m = /^skills\/([^/]+)$/.exec(label ?? '');
  return m && isSkillName(m[1]) ? m[1] : null;
}

const sortedEqual = (a, b) => {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const s = [...a].sort();
  return s.every((x, i) => x === b[i]);
};

/**
 * Judge one scan of one skill against the allowance. Both reports go through
 * here, so the gate and the strip step apply the same rules.
 *
 * `exceptions` are the scanner's ledger exceptions, each read into
 * { path, reason_code, analyzers, outcome, fatal, phase }. `ae1` is every AE1
 * finding, each read into { from, target, tagged } — `target` null when its
 * text did not parse.
 *
 * Returns:
 *   - `acceptedExceptions`: indices into `exceptions` an entry accepts.
 *   - `acceptedFiles`: the files whose every exception is accepted.
 *   - `acceptedAe1`: indices into `ae1` an entry accepts.
 *   - `refusedAe1`: { index, why } for the rest.
 *   - `unused`: one line per entry for this skill that matched nothing.
 *   - `miscounted`: one line per reference whose count disagrees with the scan.
 */
export function judge(skill, { exceptions, ae1 }, allowances) {
  const entries = new Map();
  for (const e of allowances.exceptions) if (e.skill === skill) entries.set(exceptionKey(e), { entry: e, used: false });
  const refs = new Map();
  for (const r of allowances.references) if (r.skill === skill) refs.set(JSON.stringify([r.from, r.target]), { entry: r, seen: [] });

  const acceptedExceptions = new Set();
  const byFile = new Map();
  exceptions.forEach((x, i) => {
    const file = typeof x.path === 'string' ? x.path : null;
    let ok = false;
    if (file !== null && x.outcome === 'partial' && x.fatal === false && x.phase === 'static') {
      const hit = entries.get(exceptionKey({ skill, path: file, reason_code: x.reason_code }));
      if (hit && sortedEqual(x.analyzers, hit.entry.analyzers)) {
        hit.used = true;
        ok = true;
      }
    }
    if (ok) acceptedExceptions.add(i);
    // An exception with no path still counts against a file, one no real path
    // can equal: the NUL character never appears in a path the scanner writes,
    // so that file is never an accepted one.
    const k = file ?? '\u{0}unknown';
    byFile.set(k, (byFile.get(k) ?? true) && ok);
  });
  const acceptedFiles = new Set([...byFile].filter(([, ok]) => ok).map(([f]) => f));

  const refusedAe1 = [];
  ae1.forEach((f, i) => {
    if (!f.tagged) return refusedAe1.push({ index: i, why: `it is not tagged ${AE1_TAG}` });
    if (f.target === null) return refusedAe1.push({ index: i, why: 'its text does not parse as a reference to a partly read file' });
    if (!acceptedFiles.has(f.target)) return refusedAe1.push({ index: i, why: `its target ${f.target} is not a file the allowance accepts in this scan` });
    const ref = refs.get(JSON.stringify([f.from, f.target]));
    if (!ref) return refusedAe1.push({ index: i, why: `no references entry names ${f.from} to ${f.target}` });
    ref.seen.push(i);
  });
  // A count that disagrees refuses every finding of the pair, not the extra
  // ones: which of them is "the new one" is not something the report says.
  const acceptedAe1 = new Set();
  const unused = [];
  const miscounted = [];
  for (const { entry, seen } of refs.values()) {
    if (!seen.length) {
      unused.push(`references entry ${entry.from} -> ${entry.target} matched no AE1 finding the allowance accepts`);
    } else if (seen.length !== entry.count) {
      miscounted.push(`references entry ${entry.from} -> ${entry.target} expects ${entry.count} AE1 finding(s) and the scan has ${seen.length}`);
      for (const i of seen) refusedAe1.push({ index: i, why: `the pair has ${seen.length} finding(s) and its entry expects ${entry.count}` });
    } else {
      for (const i of seen) acceptedAe1.add(i);
    }
  }
  for (const { entry, used } of entries.values()) {
    if (!used) unused.push(`exception entry ${entry.path} (${entry.reason_code}) matched no ledger exception`);
  }
  refusedAe1.sort((a, b) => a.index - b.index);
  return { acceptedExceptions, acceptedFiles, acceptedAe1, refusedAe1, unused, miscounted };
}

// One JSON-report AE1 finding, read for `judge`.
export function readJsonAe1(issue) {
  const m = AE1_TEXT.exec(typeof issue.finding === 'string' ? issue.finding : '');
  return {
    from: typeof issue.location?.file === 'string' ? issue.location.file : null,
    target: m ? m[1] : null,
    tagged: Array.isArray(issue.tags) && issue.tags.includes(AE1_TAG),
  };
}

export const isAe1 = issue => isObject(issue) && (issue.id ?? issue.rule_id) === 'AE1';

// The hash and existence checks, for scripts/check.mjs. `readFile(skill, path)`
// returns the file's bytes or null when it is not there; `isSkill(skill)` says
// whether skills/<skill>/SKILL.md exists. Injected, so this module reads no
// tree of its own.
export function checkAgainstTree(allowances, { isSkill, readFile }) {
  const problems = [];
  allowances.exceptions.forEach((e, i) => {
    const at = `${ALLOWANCES}: exceptions[${i}] (${e.skill}/${e.path}, ${e.reason_code})`;
    if (!isSkill(e.skill)) return problems.push(`${at}: skills/${e.skill}/ has no SKILL.md`);
    const bytes = readFile(e.skill, e.path);
    if (bytes === null) return problems.push(`${at}: skills/${e.skill}/${e.path} does not exist`);
    if (contentHash(bytes) !== e.sha256) {
      const code = REASON_CODES.get(e.reason_code);
      // No new hash, ever. A message that prints the value to paste turns a
      // review into a copy, and the pin exists to make someone look.
      problems.push(
        `${at}: skills/${e.skill}/${e.path} changed since its allowance was written. ` +
          `SkillSpector does not read this file in full under ${code.pass}, so the change has had no scan there. ` +
          `Review the diff of that file by hand for ${code.lookFor}. ` +
          'If it is clean, recompute the sha256 of the file (LF line endings) yourself and update the entry in the same pull request.',
      );
    }
  });
  allowances.references.forEach((r, i) => {
    const at = `${ALLOWANCES}: references[${i}] (${r.skill}: ${r.from} -> ${r.target})`;
    if (!isSkill(r.skill)) return problems.push(`${at}: skills/${r.skill}/ has no SKILL.md`);
    if (readFile(r.skill, r.from) === null) problems.push(`${at}: skills/${r.skill}/${r.from} does not exist`);
    if (readFile(r.skill, r.target) === null) problems.push(`${at}: skills/${r.skill}/${r.target} does not exist`);
  });
  return problems;
}

// What changed against the base: entries added, removed, re-hashed or with
// changed checks, and references added, removed or recounted. A re-hash and a
// change of checks on one entry are two lines, so neither hides the other.
// `before` may be null when the base has no file.
export function diffAllowances(before, after) {
  const lines = [];
  const index = (list, key) => new Map((list ?? []).map(x => [key(x), x]));
  const was = index(before?.exceptions, exceptionKey);
  const now = index(after.exceptions, exceptionKey);
  for (const [k, e] of now) {
    const old = was.get(k);
    if (!old) lines.push(`added exception ${e.skill}/${e.path} (${e.reason_code})`);
    else {
      if (old.sha256 !== e.sha256) lines.push(`re-hashed exception ${e.skill}/${e.path} (${e.reason_code})`);
      if (!sortedEqual(old.analyzers, e.analyzers)) lines.push(`changed the checks on exception ${e.skill}/${e.path} (${e.reason_code})`);
    }
  }
  for (const [k, e] of was) if (!now.has(k)) lines.push(`removed exception ${e.skill}/${e.path} (${e.reason_code})`);
  const wasR = index(before?.references, referenceKey);
  const nowR = index(after.references, referenceKey);
  for (const [k, r] of nowR) {
    const old = wasR.get(k);
    if (!old) lines.push(`added reference ${r.skill}: ${r.from} -> ${r.target} (${r.count})`);
    else if (old.count !== r.count) lines.push(`recounted reference ${r.skill}: ${r.from} -> ${r.target} (${old.count} to ${r.count})`);
  }
  for (const [k, r] of wasR) if (!nowR.has(k)) lines.push(`removed reference ${r.skill}: ${r.from} -> ${r.target}`);
  return lines;
}
