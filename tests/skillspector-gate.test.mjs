// The gate decides pass from fail for the SkillSpector workflow, and the
// workflow is the only caller. So the seam under test is the one the workflow
// uses: a report path in, an exit code and a message out.
//
// The scanner is not run here. It is a Python tool that installs on the
// runner, and a test that needed it would need an install step — the thing
// this repository does not have. Every report below is written by hand, which
// also means the failing cases can be exercised without a scan that produces
// them.
//
// No hostile string is committed for that reason and one more: scripts/check.mjs
// and scripts/build-pages.mjs both walk this tree, so a payload written to
// prove a scanner works would become a payload this repository ships. The
// findings below carry a rule identifier and a neutral message; the gate never
// reads the text.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './helpers.mjs';

const gate = join(root, 'scripts', 'skillspector-gate.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-gate-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
function report(value) {
  const p = join(work, `report-${n++}.json`);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return p;
}

// A scan that found nothing, completed, and succeeded. Every failing case
// below is this object with exactly one thing changed.
const clean = () => ({
  skill: { name: 'grimoire', source: '.', scanned_at: '2026-09-02T00:00:00Z' },
  risk_assessment: { score: 0, severity: 'LOW', recommendation: 'SAFE' },
  issues: [],
  suppressed_count: 15,
  execution_successful: true,
  analysis_completeness: {
    is_complete: true,
    status: 'complete',
    execution_successful: true,
    coverage_percent: 100.0,
    total_components: 30,
    scanned_components: 30,
    fully_inspected_files: 30,
    partially_inspected_files: 0,
    entirely_uninspected_files: 0,
    ledger_exceptions: [],
  },
});

function assertPasses(path) {
  const r = run(gate, [path]);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  return r;
}

// Fails with this message, rather than merely fails. A gate that goes red for
// the wrong reason is a gate nobody can act on.
function assertFails(path, pattern) {
  const r = run(gate, [path]);
  assert.equal(r.code, 1, `expected a failure, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  return r;
}

test('a clean report passes', () => {
  const r = assertPasses(report(clean()));
  assert.match(r.stdout, /no unsuppressed finding/);
});

test('a clean report says how many findings the baseline suppressed', () => {
  // The count is the honesty of the run. Fifteen suppressed and zero reported
  // is a different fact from zero and zero, and the log is the only place a
  // reader sees which one happened.
  assert.match(assertPasses(report(clean())).stdout, /15 suppressed/);
});

test('one unsuppressed finding fails, at any severity', () => {
  // Not the risk score and not the exit code. Two findings across this tree
  // score under the tool's fifty-point threshold and exit 0, so a gate reading
  // either one ships them green.
  const r = clean();
  r.risk_assessment = { score: 5, severity: 'LOW', recommendation: 'SAFE' };
  r.issues = [
    {
      id: 'XX9',
      category: 'example',
      severity: 'LOW',
      location: { file: 'skills/eagle-eye/SKILL.md', start_line: 12 },
      message: 'placeholder finding for the gate test',
    },
  ];
  assertFails(report(r), /1 unsuppressed finding/);
});

test('a failing report names the rule, the severity and the file', () => {
  const r = clean();
  r.issues = [
    {
      id: 'XX9',
      severity: 'HIGH',
      location: { file: 'skills/eagle-eye/SKILL.md', start_line: 12 },
      message: 'placeholder finding for the gate test',
    },
  ];
  const out = assertFails(report(r), /XX9/);
  assert.match(out.stderr, /HIGH/);
  assert.match(out.stderr, /skills\/eagle-eye\/SKILL\.md:12/);
});

test('a finding with no location is still reported', () => {
  // A report shape the gate has not seen must not throw. An exception here is
  // a red workflow with a stack trace instead of a finding.
  const r = clean();
  r.issues = [{ id: 'XX9', severity: 'LOW', message: 'placeholder finding for the gate test' }];
  assertFails(report(r), /XX9/);
});

test('an unsuccessful execution fails, even with no findings', () => {
  const r = clean();
  r.execution_successful = false;
  assertFails(report(r), /did not complete successfully/);
});

test('a component the scanner did not read fails, even with no findings', () => {
  // A scan that read half the tree and found nothing in that half is not a
  // clean scan. This is the failure mode this repository already wrote a
  // commit about: a check that does nothing reads as a check that passed.
  const r = clean();
  r.analysis_completeness.scanned_components = 19;
  assertFails(report(r), /read 19 of 30 components/);
});

test('a file left entirely uninspected fails', () => {
  const r = clean();
  r.analysis_completeness.entirely_uninspected_files = 2;
  assertFails(report(r), /2 file\(s\) entirely uninspected/);
});

test('a file read only in part fails', () => {
  const r = clean();
  r.analysis_completeness.partially_inspected_files = 1;
  assertFails(report(r), /1 file\(s\) only in part/);
});

test('an exception the scanner recorded while reading fails', () => {
  const r = clean();
  r.analysis_completeness.ledger_exceptions = [{ path: 'skills/eagle-eye/lib/template.html', reason: 'too large' }];
  assertFails(report(r), /1 exception\(s\) while reading/);
});

test('a failed status fails', () => {
  const r = clean();
  r.analysis_completeness.status = 'failed';
  assertFails(report(r), /status "failed"/);
});

test('a scanner that does not call its own execution successful fails', () => {
  const r = clean();
  r.analysis_completeness.execution_successful = false;
  assertFails(report(r), /does not call its own execution successful/);
});

test('a partial status with every count clean passes, and says so', () => {
  // The scanner downgrades a complete run to "partial" when its reference pass
  // finds a relative link it did not follow, and this repository's markdown is
  // full of those. Failing on the flag would make the workflow red on arrival
  // for a reason that is not "the scanner missed something". Failing on the
  // counts catches that; this passes and prints what the scanner said.
  const r = clean();
  r.analysis_completeness.is_complete = false;
  r.analysis_completeness.status = 'partial';
  r.analysis_completeness.limitations = ['One or more referenced artifacts were not completely inspected.'];
  const out = assertPasses(report(r));
  assert.match(out.stdout, /calls this run "partial"/);
  assert.match(out.stdout, /referenced artifacts/);
});

test('a completeness block missing a count it reads fails, rather than judging on what is left', () => {
  const r = clean();
  delete r.analysis_completeness.entirely_uninspected_files;
  delete r.analysis_completeness.ledger_exceptions;
  const out = assertFails(report(r), /entirely_uninspected_files/);
  assert.match(out.stderr, /ledger_exceptions/);
});

test('a missing execution_successful fails rather than being assumed true', () => {
  // Absent is not the same as true. A future version of the scanner that drops
  // the field should turn this red and be looked at, not pass by default.
  const r = clean();
  delete r.execution_successful;
  assertFails(report(r), /execution_successful/);
});

test('a missing analysis_completeness fails rather than being assumed complete', () => {
  const r = clean();
  delete r.analysis_completeness;
  assertFails(report(r), /analysis_completeness/);
});

test('a report with no issues array fails rather than reading as clean', () => {
  const r = clean();
  delete r.issues;
  assertFails(report(r), /no "issues" array/);
});

test('a report that is not JSON fails by name', () => {
  assertFails(report('not json at all'), /is not JSON/);
});

test('a report that is JSON but not an object fails', () => {
  assertFails(report('[]'), /not a JSON object/);
});

test('a missing report file fails, because a scan that wrote nothing did not run', () => {
  assertFails(join(work, 'never-written.json'), /cannot read/);
});

test('no argument fails with usage', () => {
  const r = run(gate, []);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /usage/i);
});

test('a finding with a file and no line is reported at the file', () => {
  const r = clean();
  r.issues = [{ id: 'XX9', severity: 'LOW', location: { file: 'README.md' }, message: 'placeholder' }];
  const out = assertFails(report(r), /XX9/);
  assert.match(out.stderr, /README\.md(?!:)/);
});

test('a finding the gate cannot read is printed, not thrown on', () => {
  // A stack trace where the reason for the red should be is a red nobody can
  // act on. The gate still fails; it just says what it saw.
  const r = clean();
  r.issues = [null];
  assertFails(report(r), /a finding the gate cannot read/);
});

test('a non-boolean execution_successful is quoted back, not called false', () => {
  const r = clean();
  r.execution_successful = 'yes';
  assertFails(report(r), /is "yes"/);
});

test('a clean report with no suppressed_count still says how many', () => {
  const r = clean();
  delete r.suppressed_count;
  assert.match(assertPasses(report(r)).stdout, /0 suppressed/);
});
