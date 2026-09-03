#!/usr/bin/env node
// The pass-or-fail decision for the SkillSpector workflow.
//
//   node scripts/skillspector-gate.mjs <report.json>
//
// Exit 0 when the scan completed and the baseline left nothing behind. Exit 1,
// with the reason on stderr, otherwise.
//
// This is a separate script and not a line of YAML because a decision inside a
// workflow is a decision no test can reach. Every rule below is covered by
// tests/skillspector-gate.test.mjs, which feeds it reports by hand and never
// runs the scanner.
//
// Three things it deliberately does not read:
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
// reasons to defend once. .skillspector-baseline.yaml carries the six rules
// this repository has argued about, and anything outside it is new.
//
// The report's `issues` array already excludes what the baseline suppressed —
// those move to `suppressed` and count toward neither the score nor this gate.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/skillspector-gate.mjs <report.json>');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (e) {
  // A scan that wrote no report did not run. Reading that as a clean tree is
  // the failure this repository already wrote a commit about.
  console.error(`cannot read ${path}: ${e.code || e.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch (e) {
  console.error(`${path} is not JSON: ${e.message}`);
  process.exit(1);
}
if (report === null || typeof report !== 'object' || Array.isArray(report)) {
  console.error(`${path} is not a JSON object`);
  process.exit(1);
}

const failures = [];

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
    if (scanned < total) failures.push(`the scan read ${scanned} of ${total} components`);
    if (skipped > 0) failures.push(`the scan left ${skipped} file(s) entirely uninspected`);
    if (partial > 0) failures.push(`the scan read ${partial} file(s) only in part`);
    if (done.ledger_exceptions.length) {
      failures.push(`the scanner recorded ${done.ledger_exceptions.length} exception(s) while reading the tree`);
    }
  }
}

const issues = report.issues;
if (!Array.isArray(issues)) {
  failures.push('the report has no "issues" array — an absent list is not an empty one');
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
  const describe = i =>
    i === null || typeof i !== 'object'
      ? `    a finding the gate cannot read: ${JSON.stringify(i)}`
      : `    ${i.id ?? '?'} ${i.severity ?? '?'} ${where(i)}\n      ${i.message ?? i.finding ?? ''}`;
  failures.push(`${issues.length} unsuppressed finding(s):\n${issues.map(describe).join('\n')}`);
}

if (failures.length) {
  console.error(`${path}: the SkillSpector gate is red.\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nA finding here is either real or a false positive worth writing down. If it is\n' +
      'a false positive, add a rule-keyed entry to .skillspector-baseline.yaml with a\n' +
      'reason a stranger can read — and to skills/eagle-eye/.skillspector-baseline.yaml\n' +
      'as well if the rule fires inside the skill. Do not reword the prose, the comment\n' +
      'or the test the finding landed on to satisfy a pattern matcher.',
  );
  process.exit(1);
}

// Passing quietly on a status the scanner itself calls partial would be the
// silence this repository keeps writing commits about. Every count came back
// clean, so the run is not failed — and it is not hidden either.
if (done.is_complete !== true) {
  const why = Array.isArray(done.limitations) && done.limitations.length ? `: ${done.limitations.join('; ')}` : '';
  console.log(`note: the scanner calls this run "${done.status ?? 'unknown'}", with every coverage count clean${why}`);
}

const suppressed = typeof report.suppressed_count === 'number' ? report.suppressed_count : 0;
console.log(`ok: no unsuppressed finding, ${suppressed} suppressed by the baseline`);
