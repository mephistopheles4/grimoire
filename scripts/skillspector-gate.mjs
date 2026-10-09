#!/usr/bin/env node
// The pass-or-fail decision for the SkillSpector workflow.
//
//   node scripts/skillspector-gate.mjs <report.json> [--label <what was scanned>]
//
// Exit 0 when the scan completed and the baseline left nothing behind. Exit 1,
// with the reason on stderr, otherwise. The label names the scan in every line
// the gate prints — the workflow passes the skill directory — and defaults to
// the report's path.
//
// When GITHUB_STEP_SUMMARY is set, the same verdict is appended to that file
// as markdown, which is the run's summary page. The workflow scans each skill
// separately, so a run has one section per skill, and a reader sees which one
// went red and why without opening a log. The summary carries what the log
// already carries and nothing more: the reports themselves are written outside
// the checkout and kept by no step, because a report echoes the text each
// finding matched.
//
// This is a separate script and not a line of YAML because a decision inside a
// workflow is a decision no test can reach. Every rule below is covered by
// tests/skillspector-gate.test.mjs, which feeds it reports by hand and never
// runs the scanner.
//
// Four things it deliberately does not read. The fourth — the report's own
// `is_complete` flag — is argued where it is skipped, beside the counts read
// in its place. The first three:
//
// **The scanner's exit code.** That code answers "should I install this whole
// skill": 0 at a risk score of fifty or under, 1 above it. A file carrying an
// instruction override and a credential read was added to this tree during
// triage; the scanner found both, scored 42 across thirty files, and exited 0.
// The threshold is the tool's and it is right for the tool's question. It is
// the wrong question for "did this pull request add something".
//
// **The risk score.** Same measurement, same reason.
//
// **The severity.** One unsuppressed finding fails, LOW included. A severity
// floor is a number to defend at every review; the baseline is a list of
// reasons to defend once. Each skill's .skillspector-baseline.yaml carries the
// rules this repository has argued about inside that skill, and anything
// outside it is new.
//
// The report's `issues` array already excludes what the baseline suppressed —
// those move to `suppressed` and count toward neither the score nor this gate.
//
// **The allowance, when asked.** `--allowances <file>` names
// .skillspector-allowances.json, the partial reads this repository has looked
// at and accepted. scripts/lib/skillspector-allowances.mjs reads it and holds
// the argument. With it, the label must be `skills/<name>`, and:
//
//   - a ledger exception passes only when an entry for that skill matches its
//     file, reason code and exact checks, and it is a static, non-fatal,
//     partial read;
//   - the short counts must equal the number of files so accepted, each count
//     on its own;
//   - an AE1 finding passes only when it points at an accepted file and its
//     pair's count equals the entry's;
//   - an entry for this skill that matched nothing is red, because an
//     allowance nobody needs is an allowance waiting for something to hide.
//
// The gate does not check an entry's content hash. scripts/check.mjs does, on
// every pull request. Without `--allowances` the gate behaves as it did before
// the allowance existed.

import { appendFileSync, readFileSync } from 'node:fs';
import { ALLOWANCES, REASON_CODES, isAe1, judge, readAllowances, readJsonAe1, skillFromLabel } from './lib/skillspector-allowances.mjs';

const USAGE =
  'usage: node scripts/skillspector-gate.mjs <report.json> [--label <what was scanned>] [--allowances <file>]';

// The summary page, as markdown. Every exit below writes it, the refusals
// included: a section missing from the page reads as a skill nobody scanned.
// Failing to write it is said out loud and does not change the verdict, which
// is the exit code's job.
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const summary = [];
function writeSummary() {
  if (!summaryFile) return;
  try {
    appendFileSync(summaryFile, `${summary.join('\n')}\n\n`);
  } catch (e) {
    console.error(`note: could not write the run summary to ${summaryFile}: ${e.code || e.message}`);
  }
}

// One table cell. A pipe or a line break would end the cell early, and the text
// is the scanner's, which echoes what it matched, so angle brackets are escaped
// too rather than handed to the page as markup. Backslashes are escaped first:
// otherwise a `\|` in the text becomes `\\|`, an escaped backslash followed by
// a pipe that ends the cell.
const cell = v => {
  const s = String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .trim();
  return s || '—';
};

const args = process.argv.slice(2);
let path;
let label;
let allowancesPath;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--label' || args[i] === '--allowances') {
    const v = args[i + 1];
    i += 1;
    if (!v) {
      console.error(USAGE);
      process.exit(1);
    }
    if (args[i - 1] === '--label') label = v;
    else allowancesPath = v;
  } else if (path === undefined) {
    path = args[i];
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}
if (!path) {
  console.error(USAGE);
  process.exit(1);
}
const name = label ?? path;

// The report could not be judged at all. Red, on both pages.
function refuse(message) {
  console.error(message);
  summary.push(`### ${cell(name)}: red`, '', cell(message));
  writeSummary();
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (e) {
  // A scan that wrote no report did not run. Reading that as a clean tree is
  // the failure this repository already wrote a commit about.
  refuse(`cannot read ${path}: ${e.code || e.message}`);
}

let report;
try {
  report = JSON.parse(raw);
} catch (e) {
  refuse(`${path} is not JSON: ${e.message}`);
}
if (report === null || typeof report !== 'object' || Array.isArray(report)) {
  refuse(`${path} is not a JSON object`);
}

// The allowance, read before anything is judged. A missing or malformed file
// refuses the run: treating it as empty would be quiet, and treating it as
// absent would drop the argument the workflow passed on purpose.
let allowances = null;
let skill = null;
if (allowancesPath !== undefined) {
  skill = skillFromLabel(label);
  if (!skill) refuse(`--allowances needs --label skills/<name>, and the label is ${JSON.stringify(label ?? null)}`);
  const read = readAllowances(allowancesPath, allowancesPath);
  if (!read.value) refuse(`the allowance file cannot be used:\n${read.problems.map(p => `      ${p}`).join('\n')}`);
  allowances = read.value;
}
// What the allowance accepted, for the log and the page. Filled below.
let verdict = null;
let acceptedExceptionRows = [];
let acceptedFindingRows = [];

const failures = [];
// Rows for the summary page, beside the one-line failures. The log prints them
// as indented lines, and the page as tables.
let exceptionRows = [];
let findingRows = [];

// Absent is not the same as true, for either field below. The scanner emits
// both today. A version that stops emitting one should turn this red and be
// looked at, rather than pass because the check found nothing to object to.
if (report.execution_successful !== true) {
  failures.push(
    report.execution_successful === undefined
      ? 'the report has no "execution_successful" field — the gate cannot tell a finished scan from an abandoned one'
      : `the scan did not complete successfully ("execution_successful" is ${JSON.stringify(report.execution_successful)})`,
  );
}

// A scan that read part of the tree and found nothing in that part is not a
// clean scan, so incompleteness fails here as well.
//
// It is read from the counts and not from the report's own `is_complete` flag,
// and that is a decision worth stating. `is_complete` is false whenever the
// scanner's status is anything but "complete", and the status is downgraded to
// "partial" by a reference pass that walks relative links between files —
// which this repository's markdown is full of, SECURITY.md and CONTRIBUTING.md
// most of all. Gating on the flag would make the workflow red on arrival for a
// reason that is not "the scanner missed something", and a check that is red
// on arrival is a check people learn to route around. Every count that means
// the scanner actually skipped something is read instead, each one a required
// field of the report:
//
//   - a component it did not scan
//   - a file left partly or entirely uninspected
//   - an exception it recorded while reading
//   - an execution it does not call successful
//
// A status of "failed" fails too. A status of "partial" with every count clean
// is printed and not failed, and the run says so rather than staying quiet.
const done = report.analysis_completeness;
if (done === null || typeof done !== 'object' || Array.isArray(done)) {
  failures.push(
    'the report has no "analysis_completeness" object — the gate cannot tell a whole scan from a partial one',
  );
} else {
  const num = k => (typeof done[k] === 'number' ? done[k] : null);
  const total = num('total_components');
  const scanned = num('scanned_components');
  const partial = num('partially_inspected_files');
  const skipped = num('entirely_uninspected_files');
  const missing = ['total_components', 'scanned_components', 'partially_inspected_files', 'entirely_uninspected_files']
    .filter(k => num(k) === null)
    .concat(Array.isArray(done.ledger_exceptions) ? [] : ['ledger_exceptions']);

  if (missing.length) {
    // The gate reads these four counts and one list. A report without them is
    // a report it cannot judge, and judging it clean would be the failure this
    // whole workflow exists to prevent.
    failures.push(`the report's "analysis_completeness" is missing ${missing.join(', ')} — the gate cannot tell a whole scan from a partial one`);
  } else {
    if (done.execution_successful !== true) failures.push('the scanner does not call its own execution successful');
    if (done.status === 'failed') failures.push('the scan failed (status "failed")');
    // With the allowance, each count is re-derived from the files it accepts,
    // and each is checked on its own: a short component count with no matching
    // partial file is something else going unread.
    let shortAllowed = 0;
    let refusedExceptions = done.ledger_exceptions;
    if (allowances) {
      const read = x =>
        x !== null && typeof x === 'object' && !Array.isArray(x)
          ? { path: x.path, reason_code: x.reason_code, analyzers: x.analyzers, outcome: x.outcome, fatal: x.fatal, phase: x.phase }
          : {};
      const ae1 = Array.isArray(report.issues) ? report.issues.filter(isAe1).map(readJsonAe1) : [];
      verdict = judge(skill, { exceptions: done.ledger_exceptions.map(read), ae1 }, allowances);
      shortAllowed = verdict.allowedFiles.size;
      refusedExceptions = done.ledger_exceptions.filter((_, i) => !verdict.allowedExceptions.has(i));
      acceptedExceptionRows = done.ledger_exceptions.filter((_, i) => verdict.allowedExceptions.has(i)).map(describeException);
      for (const u of verdict.unused) failures.push(`the allowance for ${skill} has an entry this scan does not need: ${u}`);
    }
    if (allowances ? total - scanned !== shortAllowed : scanned < total) {
      failures.push(
        allowances
          ? `the scan read ${scanned} of ${total} components, and the allowance accepts ${shortAllowed} file(s) as read in part`
          : `the scan read ${scanned} of ${total} components`,
      );
    }
    if (skipped > 0) failures.push(`the scan left ${skipped} file(s) entirely uninspected`);
    if (allowances ? partial !== shortAllowed : partial > 0) {
      failures.push(
        allowances
          ? `the scan read ${partial} file(s) only in part, and the allowance accepts ${shortAllowed}`
          : `the scan read ${partial} file(s) only in part`,
      );
    }
    if (refusedExceptions.length) {
      // SAY WHICH ONES, AND WHY. The count alone is a red gate nobody can act
      // on: the report is written outside the checkout and no step keeps it, so
      // a contributor reading the run sees "1 exception" and has no way to learn
      // which file or why. The entries are already in hand here.
      //
      // The scanner writes the why as `reason_code` and `message`. An earlier
      // version of this gate read a `reason` field the scanner never writes, so
      // three red runs on main printed bare paths and the cause looked
      // unknowable; the code was `runtime_limit` every time. So the fields it
      // documents are formatted, and every other field is appended as itself —
      // the scanner owns this shape, and a field the gate has not heard of is
      // exactly the one a reader needs to see.
      exceptionRows = refusedExceptions.map(describeException);
      failures.push(
        `the scanner recorded ${refusedExceptions.length} exception(s)${allowances ? ' the allowance does not accept' : ''} while reading the tree:\n` +
          exceptionRows.map(e => `      ${e.line}`).join('\n'),
      );
    }
  }
}

let issues = report.issues;
if (!Array.isArray(issues)) {
  failures.push('the report has no "issues" array — an absent list is not an empty one');
}

// The AE1 findings the allowance accepts leave the list, and are said out loud
// below. The ones it refuses stay, each with why. With no verdict — a report
// whose coverage could not be read — nothing is accepted.
const refusedWhy = new Map();
if (Array.isArray(issues) && verdict) {
  const ae1 = issues.filter(isAe1);
  for (const r of verdict.refusedAe1) refusedWhy.set(ae1[r.index], r.why);
  const accepted = new Set([...verdict.acceptedAe1].map(i => ae1[i]));
  acceptedFindingRows = [...accepted].map(i => ({ where: i.location?.file ?? '', target: readJsonAe1(i).target }));
  issues = issues.filter(i => !accepted.has(i));
}

if (Array.isArray(issues) && issues.length) {
  // Print every one. A gate that says "3 findings" and makes the reader open
  // an artifact to see them is a gate people learn to route around.
  const where = i => {
    const f = i.location?.file;
    if (!f) return 'no file recorded';
    const line = i.location?.start_line;
    return line === undefined ? f : `${f}:${line}`;
  };
  // `i` is read defensively for the same reason the fields are. A finding the
  // gate cannot describe still has to be printed as a finding, because the
  // alternative is a stack trace where the reason for the red should be.
  //
  // The text is the first of three fields that holds one. SkillSpector 2.11.0
  // writes `finding` as null on a rule that matched no line — LP3, which fires
  // on what a manifest lacks — and says what it means in `explanation`.
  findingRows = issues.map(i =>
    i === null || typeof i !== 'object'
      ? { unreadable: JSON.stringify(i) }
      : {
          id: i.id ?? '?',
          severity: i.severity ?? '?',
          where: where(i),
          message: [i.message ?? i.finding ?? i.explanation ?? '', refusedWhy.has(i) && `(the allowance refuses it: ${refusedWhy.get(i)})`]
            .filter(Boolean)
            .join(' '),
        },
  );
  const describe = r =>
    r.unreadable !== undefined
      ? `    a finding the gate cannot read: ${r.unreadable}`
      : `    ${r.id} ${r.severity} ${r.where}\n      ${r.message}`;
  failures.push(`${issues.length} unsuppressed finding(s):\n${findingRows.map(describe).join('\n')}`);
}

if (failures.length) {
  console.error(`${name}: the SkillSpector gate is red.\n`);
  for (const f of failures) console.error(`  - ${f}`);
  const advice =
    'An exception or a short count is not a finding. It says the scanner did not read\n' +
    'everything, and its reason code says why.\n\n' +
    (allowances && exceptionRows.length
      ? `An exception with reason code ${[...REASON_CODES.keys()].join(' or ')} can be accepted\n` +
        `in ${ALLOWANCES}, keyed by skill, file, reason code and checks, with\n` +
        'a reason and the file\'s content hash. docs/security/scanners.md says when. No other\n' +
        'reason code can be accepted, and a baseline entry never accepts a partial read.\n\n'
      : '') +
    'A finding is either real or a false positive worth writing down. If it is a false\n' +
    "positive, add a rule-keyed entry with a reason a stranger can read to the skill's\n" +
    'own .skillspector-baseline.yaml — create it if the skill has none — and the same\n' +
    'entry, in the same words, to .skillspector-baseline.yaml at the repository root.\n' +
    'scripts/check.mjs holds the two together. Do not reword the prose, the comment or\n' +
    'the test the finding landed on to satisfy a pattern matcher.';
  console.error(`\n${advice}`);

  summary.push(`### ${cell(name)}: red`, '');
  for (const f of failures) summary.push(`- ${cell(f.split('\n')[0].replace(/:$/, ''))}`);
  if (exceptionRows.length) {
    summary.push('', '| Where | Reason | Message | Phase | Analyzers |', '| --- | --- | --- | --- | --- |');
    for (const e of exceptionRows) {
      summary.push(`| ${cell(e.where)} | ${cell(e.reason)} | ${cell(e.message)} | ${cell(e.phase)} | ${cell(e.analyzers)} |`);
    }
  }
  if (findingRows.length) {
    summary.push('', '| Rule | Severity | Where | Message |', '| --- | --- | --- | --- |');
    for (const r of findingRows) {
      summary.push(
        r.unreadable !== undefined
          ? `| — | — | — | a finding the gate cannot read: ${cell(r.unreadable)} |`
          : `| ${cell(r.id)} | ${cell(r.severity)} | ${cell(r.where)} | ${cell(r.message)} |`,
      );
    }
  }
  // The log wraps at eighty columns and the page wraps itself, so each
  // paragraph is joined back into one line there.
  summary.push('', advice.split('\n\n').map(p => p.replace(/\n/g, ' ')).join('\n\n'));
  writeSummary();
  process.exit(1);
}

summary.push(`### ${cell(name)}: pass`, '');

// Passing quietly on a status the scanner itself calls partial would be the
// silence this repository keeps writing commits about. Every count came back
// clean, so the run is not failed — and it is not hidden either.
if (done.is_complete !== true) {
  const why = Array.isArray(done.limitations) && done.limitations.length ? `: ${done.limitations.join('; ')}` : '';
  const note = `note: the scanner calls this run "${done.status ?? 'unknown'}", with every coverage count clean${allowances ? ` or accepted by ${ALLOWANCES}` : ''}${why}`;
  console.log(note);
  summary.push(`- ${cell(note)}`);
}

const suppressed = typeof report.suppressed_count === 'number' ? report.suppressed_count : 0;
console.log(`ok: no unsuppressed finding, ${suppressed} suppressed by the baseline`);
summary.push(`- No unsuppressed finding, ${suppressed} suppressed by the baseline.`);
summary.push(`- Read ${done.scanned_components} of ${done.total_components} components.`);

// Which rules, and how many each. A count alone says a number was silenced; it
// does not say whether the rules the baseline argues about are still the ones
// that fire. The counts drift as prose is edited and the rule identifiers
// do not, so this line is the one that tells a reader when a new rule appears —
// which cannot happen quietly, because a rule outside the baseline fails above.
// EA3 arrived that way, on a font licence a skill is required to ship.
if (Array.isArray(report.suppressed) && report.suppressed.length) {
  const perRule = new Map();
  for (const s of report.suppressed) {
    const id = (s && typeof s === 'object' && (s.rule_id ?? s.id)) || 'unidentified';
    perRule.set(id, (perRule.get(id) ?? 0) + 1);
  }
  const tally = [...perRule].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, n]) => `${id}×${n}`);
  console.log(`      by rule: ${tally.join(', ')}`);
  summary.push(`- Suppressed by rule: ${cell(tally.join(', '))}.`);
}

// What the allowance accepted, apart from the baseline's tally. A green run
// that read files in part says which, every time, so the acceptance never
// becomes the background.
if (allowances) {
  console.log(`ok: ${acceptedExceptionRows.length} partial read(s) and ${acceptedFindingRows.length} AE1 finding(s) accepted by ${ALLOWANCES}`);
  summary.push(`- Accepted by ${ALLOWANCES}: ${acceptedExceptionRows.length} partial read(s), ${acceptedFindingRows.length} AE1 finding(s).`);
  for (const e of acceptedExceptionRows) console.log(`      partial: ${e.where}: ${e.reason} [${e.analyzers}]`);
  for (const f of acceptedFindingRows) console.log(`      AE1: ${f.where} -> ${f.target}`);
  if (acceptedExceptionRows.length) {
    summary.push('', '| Accepted partial read | Reason | Analyzers |', '| --- | --- | --- |');
    for (const e of acceptedExceptionRows) summary.push(`| ${cell(e.where)} | ${cell(e.reason)} | ${cell(e.analyzers)} |`);
  }
  if (acceptedFindingRows.length) {
    summary.push('', '| Accepted AE1 from | To a file read in part |', '| --- | --- |');
    for (const f of acceptedFindingRows) summary.push(`| ${cell(f.where)} | ${cell(f.target)} |`);
  }
}
writeSummary();

// One ledger exception, as a line for the log and the parts of a table row.
// Hoisted, so the check above can call it.
function describeException(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) {
    const s = String(e);
    return { line: s, where: s };
  }
  const known = new Set(['path', 'start_line', 'end_line', 'reason_code', 'message', 'phase', 'outcome', 'fatal', 'analyzers']);
  const where = e.path ? (e.start_line ? `${e.path}:${e.start_line}` : String(e.path)) : '';
  const why = [e.reason_code, e.message].filter(Boolean).join(' — ');
  const context = [e.outcome, e.phase].filter(Boolean).join(', ');
  const analyzers = Array.isArray(e.analyzers) ? e.analyzers.join(', ') : '';
  const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !known.has(k)));
  const extra = Object.keys(rest).length ? JSON.stringify(rest) : '';
  const line =
    [
      [where, why].filter(Boolean).join(': '),
      context && `(${context})`,
      analyzers && `[${analyzers}]`,
      extra,
    ]
      .filter(Boolean)
      .join(' ') || JSON.stringify(e);
  return {
    line,
    where: where || line,
    reason: e.reason_code,
    message: [e.message, extra].filter(Boolean).join(' '),
    phase: context,
    analyzers,
  };
}
