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
      : 'the scan did not complete successfully ("execution_successful" is false)',
  );
}

const done = report.analysis_completeness;
if (done === null || typeof done !== 'object' || Array.isArray(done)) {
  failures.push(
    'the report has no "analysis_completeness" object — the gate cannot tell a whole scan from a partial one',
  );
} else if (done.is_complete !== true) {
  // A scan that read part of the tree and found nothing in that part is not a
  // clean scan. `skillspector scan --fail-on-incomplete` makes the tool say so
  // in its own exit code; this says it again, because the exit code is not
  // what the workflow reads.
  const cover = typeof done.coverage_percent === 'number' ? `, ${done.coverage_percent}% covered` : '';
  failures.push(`the scan did not analyse the whole tree (status "${done.status ?? 'unknown'}"${cover})`);
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
  failures.push(
    `${issues.length} unsuppressed finding(s):\n` +
      issues
        .map(i => `    ${i.id ?? '?'} ${i.severity ?? '?'} ${where(i)}\n      ${i.message ?? i.finding ?? ''}`)
        .join('\n'),
  );
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

const suppressed = typeof report.suppressed_count === 'number' ? report.suppressed_count : 0;
console.log(`ok: no unsuppressed finding, ${suppressed} suppressed by the baseline`);
