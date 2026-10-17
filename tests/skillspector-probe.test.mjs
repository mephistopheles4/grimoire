// The probe proves, on every CI run, that the scanner honours a baseline
// entry's `file`: a copy of audit.mjs at lib/audit.mjs must keep its E1
// finding while the original's stays suppressed. Its seam is a report path in
// and an exit code, a message and two printed lines out. The scanner is not
// run here; every report is written by hand, as tests/skillspector-gate.test.mjs
// does for the gate. The workflow step runs the real scanner.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run as runScript } from './helpers.mjs';

const probe = join(root, 'scripts', 'skillspector-probe.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-probe-'));
after(() => rmSync(work, { recursive: true, force: true }));
const run = (...args) => runScript(probe, args, { env: { GITHUB_STEP_SUMMARY: null } });

let n = 0;
const report = value => {
  const p = join(work, `report-${n++}.json`);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
};
const finding = (id, file) => ({ id, location: { file, start_line: 1 } });
const good = () => ({ issues: [finding('E1', 'lib/audit.mjs')], suppressed: [finding('E1', 'audit.mjs')] });

test('the copy reported and the original suppressed passes, and both are printed', () => {
  const r = run(report(good()));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /reported: E1 lib\/audit\.mjs/);
  assert.match(r.stdout, /suppressed: E1 audit\.mjs/);
});

test('a copy whose E1 is suppressed fails, which is the scanner ignoring the file', () => {
  const r = run(report({ issues: [], suppressed: [finding('E1', 'audit.mjs'), finding('E1', 'lib/audit.mjs')] }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /E1 on lib\/audit\.mjs was not reported/);
  assert.match(r.stdout, /suppressed: E1 lib\/audit\.mjs/);
});

test('an original whose E1 is reported fails, because the baseline suppressed nothing', () => {
  const r = run(report({ issues: [finding('E1', 'lib/audit.mjs'), finding('E1', 'audit.mjs')], suppressed: [] }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /E1 on audit\.mjs was not suppressed/);
});

test('the rule is read case-folded from rule_id too, and the other rules are ignored', () => {
  const r = run(report({ issues: [{ rule_id: 'e1', location: { file: 'lib/audit.mjs' } }, finding('AE1', 'x')], suppressed: [finding('E1', 'audit.mjs'), finding('PE3', 'audit.mjs')] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('a report it cannot parse fails and names no path', () => {
  for (const body of ['not json', '[]', '{"issues": 3}', '{"issues": [], "suppressed": "x"}']) {
    const p = report(body);
    const r = run(p);
    assert.equal(r.code, 1, body);
    assert.match(r.stderr, /cannot read the report/);
    assert.ok(!(r.stdout + r.stderr).includes(p), 'the report path is not printed');
  }
  const missing = join(work, 'no-such-report.json');
  const r = run(missing);
  assert.equal(r.code, 1);
  assert.ok(!(r.stdout + r.stderr).includes(missing));
});

test('a hostile finding path is printed on one line, and a home in it masked', () => {
  const r = run(report({ issues: [finding('E1', 'lib/audit.mjs'), finding('E1', 'C:/Users/someone/x\nFAKE')], suppressed: [finding('E1', 'audit.mjs')] }));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /someone/);
  assert.doesNotMatch(r.stdout, /\nFAKE/);
});

test('the run summary escapes a cell', () => {
  const summary = join(work, 'summary.md');
  const r = runScript(probe, [report({ issues: [finding('E1', 'lib/audit.mjs'), finding('E1', 'a|b')], suppressed: [finding('E1', 'audit.mjs')] })], { env: { GITHUB_STEP_SUMMARY: summary } });
  assert.equal(r.code, 0);
  assert.match(readFileSync(summary, 'utf8'), /a\\\|b/);
});
