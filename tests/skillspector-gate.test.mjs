// The gate decides pass from fail for the SkillSpector workflow, and the
// workflow is the only caller. So the seam under test is the one the workflow
// uses: a report path and a label in, an exit code, a message and a section of
// the run's summary page out.
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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run as runScript } from './helpers.mjs';

const gate = join(root, 'scripts', 'skillspector-gate.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-gate-'));
after(() => rmSync(work, { recursive: true, force: true }));

// Every run below clears GITHUB_STEP_SUMMARY unless a test sets it. This suite
// runs inside the `check` job on a runner, where the variable names that job's
// real summary page, and every red case here would otherwise land on it.
const run = (script, args = [], opts = {}) =>
  runScript(script, args, { ...opts, env: { GITHUB_STEP_SUMMARY: null, ...opts.env } });

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

test('a finding that matched no line is described by its explanation', () => {
  // The shape LP3 arrives in: a rule about what a manifest lacks has no line
  // to quote, so `finding` is null and the text is in `explanation`. Printing
  // the null left a red gate with an empty line where the reason should be.
  const r = clean();
  r.issues = [
    {
      id: 'XX9',
      severity: 'MEDIUM',
      location: { file: 'SKILL.md', start_line: 1, end_line: null },
      finding: null,
      explanation: 'placeholder explanation for the gate test',
    },
  ];
  assert.match(assertFails(report(r), /XX9/).stderr, /placeholder explanation for the gate test/);
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

// A ledger exception in the shape SkillSpector 2.11.0 writes, field for field.
// The two below are the ones that turned this workflow red: the whole-tree
// scan's bytecode walk running out of its five seconds, and a link whose text
// named a path that exists only from the repository root.
const runtimeLimit = () => ({
  outcome: 'partial',
  phase: 'static',
  reason_code: 'runtime_limit',
  message: 'Inspection reached its configured runtime limit.',
  path: 'docs/brand/grimoire',
  start_line: null,
  end_line: null,
  fatal: false,
  analyzers: ['static_patterns_supply_chain_bytecode_runtime_limit'],
});
const unresolved = () => ({
  outcome: 'partial',
  phase: 'reference_resolution',
  reason_code: 'reference_unresolved',
  message: 'A local path-like reference could not be resolved unambiguously.',
  path: 'SKILL.md',
  start_line: 84,
  end_line: 84,
  fatal: false,
});

test('an exception the scanner recorded while reading fails', () => {
  const r = clean();
  r.analysis_completeness.ledger_exceptions = [runtimeLimit()];
  assertFails(report(r), /1 exception\(s\) while reading/);
});

test('and it says which one and why, because the report is gone by the time anyone reads the run', () => {
  // The workflow writes the report outside the checkout and keeps nothing, so
  // a count on its own is a red gate a contributor cannot act on. So was a path
  // on its own: this gate once read a `reason` field the scanner never writes,
  // and printed three red runs as bare directory names.
  const r = clean();
  r.analysis_completeness.ledger_exceptions = [runtimeLimit(), unresolved()];
  const out = assertFails(report(r), /2 exception\(s\) while reading/);
  assert.match(out.stderr, /docs\/brand\/grimoire: runtime_limit — Inspection reached its configured runtime limit\./);
  assert.match(out.stderr, /\[static_patterns_supply_chain_bytecode_runtime_limit\]/);
  assert.match(out.stderr, /SKILL\.md:84: reference_unresolved/);
  assert.match(out.stderr, /\(partial, reference_resolution\)/);
});

test('a field the gate does not format is printed as itself, not dropped', () => {
  // The scanner owns this shape. A field this gate has not heard of is exactly
  // the one a reader needs, so it is appended rather than skipped.
  const r = clean();
  r.analysis_completeness.ledger_exceptions = [{ ...runtimeLimit(), error_class: 'PermissionError' }];
  const out = assertFails(report(r), /1 exception\(s\) while reading/);
  assert.match(out.stderr, /"error_class":"PermissionError"/);
});

test('an exception in a shape the gate does not know is printed as itself, not dropped', () => {
  // The scanner owns the shape of these entries. A gate that only understood
  // {path, reason} would answer a new shape with silence, which is the failure
  // printing them exists to prevent.
  const r = clean();
  r.analysis_completeness.ledger_exceptions = ['PermissionError: skills/x', { note: 'no path here' }];
  const out = assertFails(report(r), /2 exception\(s\) while reading/);
  assert.match(out.stderr, /PermissionError: skills\/x/);
  assert.match(out.stderr, /no path here/);
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

test('a clean report tallies the suppressions by rule', () => {
  // A count alone says a number was silenced. It does not say whether the six
  // rules the baseline argues about are still the six that fire, and that is
  // the fact a reader of the CI log needs.
  const r = clean();
  r.suppressed_count = 3;
  r.suppressed = [{ rule_id: 'RP1' }, { rule_id: 'AS3' }, { rule_id: 'RP1' }];
  const out = assertPasses(report(r));
  assert.match(out.stdout, /by rule: AS3×1, RP1×2/);
});

test('a suppression the gate cannot identify is tallied, not dropped', () => {
  const r = clean();
  r.suppressed_count = 1;
  r.suppressed = [null];
  assert.match(assertPasses(report(r)).stdout, /unidentified×1/);
});

// The label. The workflow scans each skill separately and passes the skill's
// directory, so a red line names the skill rather than a temporary path.

test('a red gate names what was scanned when given a label', () => {
  const r = clean();
  r.issues = [null];
  const out = run(gate, [report(r), '--label', 'skills/eagle-eye']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /^skills\/eagle-eye: the SkillSpector gate is red/m);
});

test('a red gate names the report path when given no label', () => {
  const r = clean();
  r.issues = [null];
  const p = report(r);
  assert.ok(assertFails(p, /gate is red/).stderr.includes(`${p}: the SkillSpector gate is red`));
});

test('a label with no value fails with usage rather than labelling nothing', () => {
  const out = run(gate, [report(clean()), '--label']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /usage/);
});

test('a second report path fails with usage rather than judging one of them', () => {
  const out = run(gate, [report(clean()), report(clean())]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /usage/);
});

// The summary page. GITHUB_STEP_SUMMARY names a file the runner renders as
// markdown on the run's page. The seam is the same one the workflow uses: the
// variable set, the file read back.

const summaryPath = () => join(work, `summary-${n++}.md`);
function gateWithSummary(path, file, args = []) {
  return run(gate, [path, ...args], { env: { GITHUB_STEP_SUMMARY: file } });
}

test('a passing gate writes its verdict and the suppression tally to the summary', () => {
  const r = clean();
  r.suppressed_count = 3;
  r.suppressed = [{ rule_id: 'RP1' }, { rule_id: 'AS3' }, { rule_id: 'RP1' }];
  const file = summaryPath();
  assert.equal(gateWithSummary(report(r), file, ['--label', 'skills/eagle-eye']).code, 0);
  const page = readFileSync(file, 'utf8');
  assert.match(page, /^### skills\/eagle-eye: pass$/m);
  assert.match(page, /3 suppressed by the baseline/);
  assert.match(page, /Read 30 of 30 components/);
  assert.match(page, /AS3×1, RP1×2/);
});

test('an exception is a table row with its reason code on the summary', () => {
  const r = clean();
  r.analysis_completeness.ledger_exceptions = [unresolved()];
  const file = summaryPath();
  assert.equal(gateWithSummary(report(r), file, ['--label', 'skills/groundtrack']).code, 1);
  const page = readFileSync(file, 'utf8');
  assert.match(page, /^### skills\/groundtrack: red$/m);
  assert.match(page, /^\| SKILL\.md:84 \| reference_unresolved \| A local path-like reference/m);
});

test('a finding is a table row on the summary, and a pipe in it does not break the table', () => {
  // The message is the scanner's and echoes the text it matched. A pipe in it
  // would end the cell early and shift every column after it.
  const r = clean();
  r.issues = [
    { id: 'XX9', severity: 'LOW', location: { file: 'SKILL.md', start_line: 3 }, message: 'left | right' },
  ];
  const file = summaryPath();
  gateWithSummary(report(r), file);
  assert.match(readFileSync(file, 'utf8'), /^\| XX9 \| LOW \| SKILL\.md:3 \| left \\\| right \|$/m);
});

test('a backslash before a pipe does not break the table either', () => {
  // Escaping the pipe alone turns `\|` into `\\|`: an escaped backslash, then a
  // bare pipe that ends the cell. Raised by CodeQL on this gate.
  const r = clean();
  r.issues = [
    { id: 'XX9', severity: 'LOW', location: { file: 'SKILL.md', start_line: 3 }, message: 'left \\| right' },
  ];
  const file = summaryPath();
  gateWithSummary(report(r), file);
  const row = readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('| XX9 '));
  // The backslash doubled, then the pipe escaped: three backslashes and a pipe.
  assert.equal(row, '| XX9 | LOW | SKILL.md:3 | left \\\\\\| right |');
});

test('a report the gate cannot read is red on the summary too', () => {
  // A section missing from the page reads as a skill nobody scanned.
  const file = summaryPath();
  assert.equal(gateWithSummary(join(work, 'never-written.json'), file, ['--label', 'skills/x']).code, 1);
  const page = readFileSync(file, 'utf8');
  assert.match(page, /^### skills\/x: red$/m);
  assert.match(page, /cannot read/);
});

test('each run appends a section rather than replacing the page', () => {
  const file = summaryPath();
  gateWithSummary(report(clean()), file, ['--label', 'skills/one']);
  gateWithSummary(report(clean()), file, ['--label', 'skills/two']);
  const page = readFileSync(file, 'utf8');
  assert.match(page, /### skills\/one: pass/);
  assert.match(page, /### skills\/two: pass/);
});

test('a summary it cannot write is said out loud and leaves the verdict alone', () => {
  // The exit code is the verdict. A page the runner could not take must not
  // turn a clean scan red, and must not pass without a word either.
  const out = gateWithSummary(report(clean()), work);
  assert.equal(out.code, 0, `${out.stdout}${out.stderr}`);
  assert.match(out.stderr, /could not write the run summary/);
});

// ---- the allowance ----
//
// `--allowances` names .skillspector-allowances.json, the partial reads this
// repository has accepted. scripts/lib/skillspector-allowances.mjs holds the
// rules; these tests drive them through the gate, the way the workflow does.
// Every case is the accepted report below with exactly one thing changed.

const HASH = 'a'.repeat(64);
const TM = 'static_patterns_tool_misuse';

// An allowance accepting one parse-limit read of lib/long.mjs in the skill
// `demo`, and one AE1 reference to it from SKILL.md.
const allowance = () => ({
  version: 1,
  exceptions: [
    { skill: 'demo', path: 'lib/long.mjs', reason_code: 'static_parse_limit', analyzers: [TM], sha256: HASH, reason: 'A neutral reason for the test.' },
  ],
  references: [{ skill: 'demo', from: 'SKILL.md', target: 'lib/long.mjs', count: 1 }],
});
function allowanceFile(value) {
  const p = join(work, `allow-${n++}.json`);
  writeFileSync(p, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return p;
}
const partialException = (path = 'lib/long.mjs', over = {}) => ({
  outcome: 'partial',
  phase: 'static',
  reason_code: 'static_parse_limit',
  message: 'The parser stopped early.',
  path,
  start_line: 1,
  end_line: 1,
  fatal: false,
  analyzers: [TM],
  ...over,
});
const ae1 = (target = 'lib/long.mjs', over = {}) => ({
  id: 'AE1',
  severity: 'HIGH',
  location: { file: 'SKILL.md', start_line: 5 },
  finding: `${target} (partial)`,
  tags: ['target-disposition:partial'],
  ...over,
});
// The scan the allowance above accepts: one file read in part, one component
// short, and one AE1 finding pointing at it.
const accepted = () => {
  const r = clean();
  r.analysis_completeness.is_complete = false;
  r.analysis_completeness.status = 'partial';
  r.analysis_completeness.scanned_components = 29;
  r.analysis_completeness.partially_inspected_files = 1;
  r.analysis_completeness.ledger_exceptions = [partialException()];
  r.issues = [ae1()];
  return r;
};
const withAllowance = (r, a = allowance(), label = 'skills/demo') => run(gate, [report(r), '--label', label, '--allowances', allowanceFile(a)]);
function allowedPasses(r, a) {
  const out = withAllowance(r, a);
  assert.equal(out.code, 0, `expected a pass, got:\n${out.stdout}${out.stderr}`);
  return out;
}
function allowedFails(r, pattern, a, label) {
  const out = withAllowance(r, a, label);
  assert.equal(out.code, 1, `expected a failure, got:\n${out.stdout}${out.stderr}`);
  assert.match(out.stderr, pattern);
  return out;
}

test('the allowance accepts its partial read and its AE1 finding, and says so', () => {
  const out = allowedPasses(accepted());
  assert.match(out.stdout, /1 partial read\(s\) and 1 AE1 finding\(s\) accepted by \.skillspector-allowances\.json/);
  assert.match(out.stdout, /partial: lib\/long\.mjs:1: static_parse_limit/);
  assert.match(out.stdout, /AE1: SKILL\.md -> lib\/long\.mjs/);
});

test('the same report without --allowances is red, as before the allowance existed', () => {
  const out = run(gate, [report(accepted()), '--label', 'skills/demo']);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /the scan read 1 file\(s\) only in part/);
  assert.doesNotMatch(out.stderr, /skillspector-allowances/);
});

test('the summary lists what the allowance accepted, apart from the baseline tally', () => {
  const file = summaryPath();
  const out = run(gate, [report(accepted()), '--label', 'skills/demo', '--allowances', allowanceFile(allowance())], {
    env: { GITHUB_STEP_SUMMARY: file },
  });
  assert.equal(out.code, 0, `${out.stdout}${out.stderr}`);
  const page = readFileSync(file, 'utf8');
  assert.match(page, /Accepted by \.skillspector-allowances\.json: 1 partial read\(s\), 1 AE1 finding\(s\)/);
  assert.match(page, /^\| lib\/long\.mjs:1 \| static_parse_limit \| static_patterns_tool_misuse \|$/m);
  assert.match(page, /^\| SKILL\.md \| lib\/long\.mjs \|$/m);
});

test('an exception with a reason code outside the two is refused', () => {
  const r = accepted();
  r.analysis_completeness.ledger_exceptions = [partialException('lib/long.mjs', { reason_code: 'runtime_limit' })];
  const out = allowedFails(r, /1 exception\(s\) the allowance does not accept[\s\S]*runtime_limit/);
  assert.match(out.stderr, /can be accepted\nin \.skillspector-allowances\.json/);
});

test('an allowed file with an extra check is refused', () => {
  const r = accepted();
  r.analysis_completeness.ledger_exceptions = [partialException('lib/long.mjs', { analyzers: [TM, 'static_patterns_ssrf'] })];
  allowedFails(r, /the allowance does not accept[\s\S]*static_patterns_ssrf/);
});

test('an allowed file with a check missing is refused too', () => {
  // Exact, not a subset. A list that shrank is a scanner that changed, and
  // that is worth a look before anything is accepted.
  const a = allowance();
  a.exceptions[0].analyzers = ['static_patterns_ssrf', TM];
  allowedFails(accepted(), /the allowance does not accept/, a);
});

test('an allowed reason code with fatal true is refused', () => {
  const r = accepted();
  r.analysis_completeness.ledger_exceptions = [partialException('lib/long.mjs', { fatal: true })];
  allowedFails(r, /the allowance does not accept/);
});

test('an allowed reason code in a phase other than static is refused', () => {
  const r = accepted();
  r.analysis_completeness.ledger_exceptions = [partialException('lib/long.mjs', { phase: 'discovery' })];
  allowedFails(r, /the allowance does not accept/);
});

test('an allowed reason code with an outcome other than partial is refused', () => {
  const r = accepted();
  r.analysis_completeness.ledger_exceptions = [partialException('lib/long.mjs', { outcome: 'skipped' })];
  allowedFails(r, /the allowance does not accept/);
});

test('an entirely uninspected file is refused whatever the allowance says', () => {
  const r = accepted();
  r.analysis_completeness.entirely_uninspected_files = 1;
  allowedFails(r, /1 file\(s\) entirely uninspected/);
});

test('a short component with no matching partial file is refused', () => {
  const r = accepted();
  r.analysis_completeness.scanned_components = 28;
  allowedFails(r, /read 28 of 30 components, and the allowance accepts 1 file\(s\) as read in part/);
});

test('a partial count with no matching exception is refused', () => {
  const r = accepted();
  r.analysis_completeness.partially_inspected_files = 2;
  r.analysis_completeness.scanned_components = 28;
  allowedFails(r, /read 2 file\(s\) only in part, and the allowance accepts 1/);
});

test('an AE1 finding on a file without an entry is refused', () => {
  const r = accepted();
  r.issues = [ae1(), ae1('other.mjs')];
  allowedFails(r, /AE1 HIGH SKILL\.md:5[\s\S]*other\.mjs is not a file the allowance accepts/);
});

test('an AE1 finding on a target that is not partial is refused', () => {
  const r = accepted();
  r.issues = [ae1('lib/long.mjs', { tags: ['target-disposition:missing'] })];
  allowedFails(r, /not tagged target-disposition:partial/);
});

test('an AE1 count above its entry is refused', () => {
  const r = accepted();
  r.issues = [ae1(), ae1()];
  allowedFails(r, /expects 1 AE1 finding\(s\) and the scan has 2/);
});

test('an AE1 count below its entry is refused', () => {
  const a = allowance();
  a.references[0].count = 2;
  allowedFails(accepted(), /expects 2 AE1 finding\(s\) and the scan has 1/, a);
});

test('an AE1 text the gate cannot parse is refused', () => {
  const r = accepted();
  r.issues = [ae1('lib/long.mjs', { finding: 'lib/long.mjs (not read)' })];
  allowedFails(r, /does not parse as a reference to a partly read file/);
});

test('an unused exception entry is refused', () => {
  const a = allowance();
  a.exceptions.push({ ...a.exceptions[0], path: 'lib/fixed.mjs' });
  allowedFails(accepted(), /entry this scan does not need: exception entry lib\/fixed\.mjs \(static_parse_limit\) matched no ledger exception/, a);
});

test('an unused references entry is refused', () => {
  const r = accepted();
  r.issues = [];
  allowedFails(r, /references entry SKILL\.md -> lib\/long\.mjs matched no AE1 finding/);
});

test('entries for another skill are not this scan\'s business', () => {
  const a = allowance();
  a.exceptions.push({ ...a.exceptions[0], skill: 'elsewhere' });
  allowedPasses(accepted(), a);
});

test('a missing allowance file is refused, not read as empty', () => {
  const out = run(gate, [report(clean()), '--label', 'skills/demo', '--allowances', join(work, 'never-written.json')]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /the allowance file cannot be used[\s\S]*cannot read/);
});

test('a malformed allowance file is refused', () => {
  const a = allowance();
  a.exceptions[0].reason_code = 'runtime_limit';
  allowedFails(accepted(), /the allowance file cannot be used[\s\S]*"reason_code" "runtime_limit" is not one of/, a);
});

test('a label that is not skills/<name> is refused', () => {
  for (const label of ['demo', 'skills/demo/lib', 'skills/..', 'other/demo']) {
    allowedFails(accepted(), /--allowances needs --label skills\/<name>/, allowance(), label);
  }
  const out = run(gate, [report(accepted()), '--allowances', allowanceFile(allowance())]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /--allowances needs --label skills\/<name>/);
});

test('skill and file names that are also object keys are judged as names', () => {
  // `constructor` and `__proto__` would answer from the prototype of a plain
  // object. Every lookup is a Map, so they match their own entries and nothing
  // else.
  for (const name of ['constructor', '__proto__']) {
    const a = allowance();
    a.exceptions[0].skill = name;
    a.exceptions[0].path = name;
    a.references[0] = { skill: name, from: 'SKILL.md', target: name, count: 1 };
    const r = accepted();
    r.analysis_completeness.ledger_exceptions = [partialException(name)];
    r.issues = [ae1(name)];
    const out = withAllowance(r, a, `skills/${name}`);
    assert.equal(out.code, 0, `${name}: expected a pass, got:\n${out.stdout}${out.stderr}`);
    // And an entry under one of those names accepts nothing in another skill.
    allowedFails(r, /the allowance does not accept/, a, 'skills/demo');
  }
});