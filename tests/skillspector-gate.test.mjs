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
  analysis_completeness: { is_complete: true, status: 'complete', coverage_percent: 100.0 },
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

test('incomplete analysis fails, even with no findings', () => {
  // A scan that read half the tree and found nothing in that half is not a
  // clean scan. This is the failure mode this repository already wrote a
  // commit about: a check that does nothing reads as a check that passed.
  const r = clean();
  r.analysis_completeness = { is_complete: false, status: 'partial', coverage_percent: 61.5 };
  assertFails(report(r), /did not analyse the whole tree/);
});

test('an incomplete report says what the scanner covered', () => {
  const r = clean();
  r.analysis_completeness = { is_complete: false, status: 'partial', coverage_percent: 61.5 };
  assert.match(assertFails(report(r), /partial/).stderr, /61\.5/);
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
