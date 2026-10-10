// The strip decides what GitHub's Security tab is told, and the workflow is
// the only caller. So the seam under test is the one the workflow uses: two
// paths and a directory prefix in, a written file and an exit code out.
//
// The scanner is not run here, for the reason tests/skillspector-gate.test.mjs
// gives: it is a Python tool that installs on the runner, and a test needing it
// would need the install step this repository does not have. Every report below
// is written by hand, which is also the only way to reach the shapes a real
// scan does not produce.
//
// No hostile string is committed. scripts/check.mjs and scripts/build-pages.mjs
// both walk this tree, and SkillSpector scans it — a payload written to prove a
// filter works would become a payload this repository ships, and a rule firing
// on a fixture would turn the gate red on a file invented to keep it green. The
// results below carry a rule identifier and a neutral message, and the strip
// never reads the text.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './helpers.mjs';

const strip = join(root, 'scripts', 'skillspector-strip-suppressed.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-strip-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
function sarif(value) {
  const p = join(work, `in-${n++}.sarif`);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return p;
}
const out = () => join(work, `out-${n++}.sarif`);

// One result, in the two shapes that matter: carrying a baseline suppression
// and not carrying one. The shape is SkillSpector's, down to the `kind` and the
// justification it writes the baseline reason into.
const result = (ruleId, suppressed) => ({
  ruleId,
  message: { text: `${ruleId} matched a line` },
  level: 'warning',
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: 'README.md', index: 0 },
        region: { startLine: 20, endLine: 20 },
      },
    },
  ],
  ...(suppressed
    ? { suppressions: [{ kind: 'external', justification: 'False positive. Argued in the baseline.' }] }
    : {}),
});

// A report with the two arrays the results point into by index. Nothing below
// reindexes them, and one test holds them byte for byte.
// No `$schema` key, deliberately. The strip never reads one, and a fixture is
// still a file in a tree this repository scans — an invented URL would be the
// only novel token in it.
const report = (...results) => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'SkillSpector',
          version: '2.11.0',
          rules: [{ id: 'AR2' }, { id: 'RP1' }, { id: 'ZZ9' }],
        },
      },
      artifacts: [{ location: { uri: 'README.md' } }],
      results,
    },
  ],
});

function assertStrips(input, path = out()) {
  const r = run(strip, [input, path]);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  return { ...r, report: JSON.parse(readFileSync(path, 'utf8')), path };
}

// Fails with this message, rather than merely fails. A step that goes red for
// the wrong reason is a step nobody can act on.
function assertFails(args, pattern) {
  const r = run(strip, args);
  assert.equal(r.code, 1, `expected a failure, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  return r;
}

test('a suppressed result is dropped and an unsuppressed one is kept', () => {
  const r = assertStrips(sarif(report(result('AR2', true), result('ZZ9', false))));
  assert.deepEqual(
    r.report.runs[0].results.map(x => x.ruleId),
    ['ZZ9'],
  );
});

test('it says how many it dropped, how many it kept, and which rules', () => {
  // The counts are the honesty of the step. A file arriving at the Security tab
  // with results removed and no line saying which is the silence this
  // repository keeps writing commits about.
  const r = assertStrips(sarif(report(result('AR2', true), result('AR2', true), result('RP1', true), result('ZZ9', false))));
  assert.match(r.stdout, /stripped 3 suppressed result\(s\), kept 1/);
  assert.match(r.stdout, /AR2×2, RP1×1/);
});

test('every result suppressed still writes a file, with an empty results array', () => {
  // The case this whole script was written for, and the one an optimisation
  // would delete. GitHub marks an alert fixed when the next upload under the
  // same category no longer carries it, so an empty array is what closes the
  // findings the baseline already argued away. Skipping the upload leaves them
  // open forever.
  const r = assertStrips(sarif(report(result('AR2', true), result('RP1', true))));
  assert.deepEqual(r.report.runs[0].results, []);
  assert.match(r.stdout, /stripped 2 suppressed result\(s\), kept 0/);
});

test('an empty suppressions array is not a suppression', () => {
  const r = assertStrips(sarif(report({ ...result('ZZ9', false), suppressions: [] })));
  assert.equal(r.report.runs[0].results.length, 1);
});

test('the rules and artifacts arrays come through untouched', () => {
  // The results that stay point into both by index. A tidy-up that dropped the
  // descriptors with no findings left under them would renumber the rest and
  // point a kept finding at the wrong rule.
  const before = report(result('AR2', true), result('ZZ9', false));
  const r = assertStrips(sarif(before));
  assert.deepEqual(r.report.runs[0].tool, before.runs[0].tool);
  assert.deepEqual(r.report.runs[0].artifacts, before.runs[0].artifacts);
});

test('the kept results keep their order', () => {
  const r = assertStrips(
    sarif(report(result('ZZ9', false), result('AR2', true), result('RP1', false), result('MP3', true))),
  );
  assert.deepEqual(
    r.report.runs[0].results.map(x => x.ruleId),
    ['ZZ9', 'RP1'],
  );
});

test('every run is filtered, not only the first', () => {
  const two = report(result('AR2', true), result('ZZ9', false));
  two.runs.push(JSON.parse(JSON.stringify(two.runs[0])));
  const r = assertStrips(sarif(two));
  assert.equal(r.report.runs.length, 2);
  for (const one of r.report.runs) {
    assert.deepEqual(
      one.results.map(x => x.ruleId),
      ['ZZ9'],
    );
  }
});

test('a result it cannot read is kept and said out loud', () => {
  // The one mistake this script can make is a silent removal. Anything it
  // cannot judge stays in the file and gets a line of its own.
  const r = assertStrips(sarif(report('not a result', result('AR2', true))));
  assert.equal(r.report.runs[0].results.length, 1);
  assert.match(r.stdout, /could not read a suppression/);
});

test('a suppressions field that is not an array is kept and said out loud', () => {
  const r = assertStrips(sarif(report({ ...result('ZZ9', false), suppressions: 'accepted' })));
  assert.equal(r.report.runs[0].results.length, 1);
  assert.match(r.stdout, /could not read a suppression/);
});

test('a null suppressions is malformed, not absent', () => {
  // The scanner serialises with Pydantic's exclude_none=True, so it writes the
  // key as an array or omits it. A null came from somewhere else, and reading
  // it as "no suppression" would be the silent pass this script refuses.
  const r = assertStrips(sarif(report({ ...result('ZZ9', false), suppressions: null })));
  assert.equal(r.report.runs[0].results.length, 1);
  assert.match(r.stdout, /could not read a suppression/);
});

test('a result with no suppressions key is not called unreadable', () => {
  // The other half of the line above. Absent is the ordinary shape of an
  // unsuppressed finding, and a note on every one of them is noise.
  const r = assertStrips(sarif(report(result('ZZ9', false))));
  assert.equal(r.report.runs[0].results.length, 1);
  assert.doesNotMatch(r.stdout, /could not read a suppression/);
});

test('a missing output path fails rather than guessing one', () => {
  assertFails([sarif(report())], /usage:/);
});

test('a report that is not there fails', () => {
  // A step that wrote no file did not run, and reading that as a report with
  // nothing in it would upload an empty results array — which marks every open
  // alert fixed.
  assertFails([join(work, 'absent.sarif'), out()], /cannot read it/);
});

test('a report that is not JSON fails', () => {
  assertFails([sarif('{'), out()], /not JSON/);
});

test('a report that is not an object fails', () => {
  assertFails([sarif('[]'), out()], /not a JSON object/);
});

test('a report with no runs array fails', () => {
  assertFails([sarif({ version: '2.1.0' }), out()], /no "runs" array/);
});

test('a run with no results array fails', () => {
  // Absent is not empty, for the same reason the gate refuses the shape: a
  // report the step cannot read must not upload as a report with nothing in it.
  const r = report();
  delete r.runs[0].results;
  assertFails([sarif(r), out()], /no "results" array/);
});

test('a run that is not an object fails', () => {
  assertFails([sarif({ version: '2.1.0', runs: ['run'] }), out()], /runs\[0\] is not an object/);
});

// --prefix. The workflow scans each skill on its own, and the scanner writes
// every path relative to the directory it was pointed at. GitHub resolves a
// relative path against the repository root, so without the directory put back
// an alert points at a file that does not exist.

function assertPrefixes(input, prefix) {
  const path = out();
  const r = run(strip, [input, path, '--prefix', prefix]);
  assert.equal(r.code, 0, `expected a pass, got:\n${r.stdout}${r.stderr}`);
  return { ...r, report: JSON.parse(readFileSync(path, 'utf8')) };
}
const uriOf = x => x.locations[0].physicalLocation.artifactLocation;

test('the prefix goes on every kept result, and the index beside it is untouched', () => {
  const r = assertPrefixes(sarif(report(result('AR2', true), result('ZZ9', false))), 'skills/eagle-eye/');
  assert.deepEqual(uriOf(r.report.runs[0].results[0]), { uri: 'skills/eagle-eye/README.md', index: 0 });
  assert.match(r.stdout, /put skills\/eagle-eye\/ in front of 2 relative path\(s\)/);
});

test('the prefix goes on the artifacts list too', () => {
  const r = assertPrefixes(sarif(report(result('ZZ9', false))), 'skills/eagle-eye/');
  assert.deepEqual(r.report.runs[0].artifacts, [{ location: { uri: 'skills/eagle-eye/README.md' } }]);
});

test("the prefix goes on the scanner's own notifications", () => {
  // The scanner lists the files it could not treat as text under
  // invocations, in the same location shape as a finding.
  const r0 = report(result('ZZ9', false));
  r0.runs[0].invocations = [
    {
      executionSuccessful: true,
      toolExecutionNotifications: [
        { message: { text: 'binary' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'assets/a.woff2' } } }] },
      ],
    },
  ];
  const r = assertPrefixes(sarif(r0), 'skills/eagle-eye/');
  assert.equal(
    r.report.runs[0].invocations[0].toolExecutionNotifications[0].locations[0].physicalLocation.artifactLocation.uri,
    'skills/eagle-eye/assets/a.woff2',
  );
});

test('a prefix with no trailing slash gets one, rather than gluing two names together', () => {
  const r = assertPrefixes(sarif(report(result('ZZ9', false))), 'skills/eagle-eye');
  assert.equal(uriOf(r.report.runs[0].results[0]).uri, 'skills/eagle-eye/README.md');
});

test('a directory name that is not URI-safe is percent-encoded, segment by segment', () => {
  // A `#` would start a fragment and cut the path short, and a space is not
  // allowed in a URI at all. The slashes between segments stay slashes.
  const r = assertPrefixes(sarif(report(result('ZZ9', false))), 'skills/a b#c/');
  assert.equal(uriOf(r.report.runs[0].results[0]).uri, 'skills/a%20b%23c/README.md');
});

test('an absolute URI is left as it was, and counted', () => {
  const one = result('ZZ9', false);
  uriOf(one).uri = 'file:///elsewhere/README.md';
  const r = assertPrefixes(sarif(report(one)), 'skills/eagle-eye/');
  assert.equal(uriOf(r.report.runs[0].results[0]).uri, 'file:///elsewhere/README.md');
  assert.match(r.stdout, /left 1 absolute URI\(s\)/);
});

test('a location with a uriBaseId fails rather than guessing its base', () => {
  const one = result('ZZ9', false);
  uriOf(one).uriBaseId = '%SRCROOT%';
  assertFails([sarif(report(one)), out(), '--prefix', 'skills/eagle-eye/'], /uriBaseId/);
});

test('a prefix that is not a directory under the repository root fails', () => {
  for (const bad of ['../outside/', '/skills/eagle-eye/', 'file:///skills/', 'skills\\eagle-eye\\']) {
    assertFails([sarif(report()), out(), '--prefix', bad], /not a directory relative to the repository root/);
  }
});

test('a prefix flag with no value fails with usage', () => {
  assertFails([sarif(report()), out(), '--prefix'], /usage:/);
});

test('with no prefix, no path changes', () => {
  const r = assertStrips(sarif(report(result('ZZ9', false))));
  assert.equal(uriOf(r.report.runs[0].results[0]).uri, 'README.md');
  assert.doesNotMatch(r.stdout, /in front of/);
});

// ---- the allowance ----
//
// With `--allowances` and `--label`, an AE1 result is dropped only when the
// gate's own rules accept its pair in this SARIF. The rules live in
// scripts/lib/skillspector-allowances.mjs; these tests drive them through the
// strip step, from the SARIF alone, the way the workflow does.

const TM = 'static_patterns_tool_misuse';
const allowance = () => ({
  version: 1,
  exceptions: [
    { skill: 'demo', path: 'lib/long.mjs', reason_code: 'static_parse_limit', analyzers: [TM], sha256: 'a'.repeat(64), reason: 'A neutral reason for the test.' },
  ],
  references: [{ skill: 'demo', from: 'SKILL.md', target: 'lib/long.mjs', count: 2 }],
});
function allowanceFile(value = allowance()) {
  const p = join(work, `allow-${n++}.json`);
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
  return p;
}
// A notification in the shape SkillSpector 2.11.2 writes for a ledger
// exception, and one it writes for a file it leaves out of scope.
const note = (uri, props) => ({
  message: { text: 'a neutral note' },
  level: 'warning',
  locations: [{ physicalLocation: { artifactLocation: { uri } } }],
  properties: props,
});
const partialNote = (uri = 'lib/long.mjs', over = {}) =>
  note(uri, { outcome: 'partial', phase: 'static', reasonCode: 'static_parse_limit', fatal: false, analyzers: [TM], ...over });
// An AE1 result. The id is a fresh one each time, as the scanner draws them,
// and matches no JSON report: the strip never joins the two.
let fresh = 0;
const ae1Result = (target = 'lib/long.mjs', over = {}) => ({
  ruleId: 'AE1',
  message: { text: 'AE1 matched a line' },
  level: 'error',
  locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 5 } } }],
  properties: { findingId: `sarif-only-${fresh++}`, finding: `${target} (partial)`, tags: ['target-disposition:partial'] },
  ...over,
});
const withNotes = (r, ...notes) => {
  r.runs[0].invocations = [{ executionSuccessful: true, toolExecutionNotifications: notes }];
  return r;
};
const acceptedSarif = () =>
  withNotes(report(ae1Result(), ae1Result(), result('ZZ9', false)), partialNote(), note('font.woff2', { outcome: 'out_of_scope', phase: 'static', reasonCode: 'binary_content', fatal: false }));
function stripAllowed(r, a = allowance(), label = 'skills/demo') {
  const path = out();
  const res = run(strip, [sarif(r), path, '--allowances', allowanceFile(a), '--label', label]);
  assert.equal(res.code, 0, `expected a pass, got:\n${res.stdout}${res.stderr}`);
  return { ...res, report: JSON.parse(readFileSync(path, 'utf8')) };
}
const ruleIds = r => r.report.runs[0].results.map(x => x.ruleId);

test('the AE1 results the allowance accepts are dropped, and everything else is kept', () => {
  const r = stripAllowed(acceptedSarif());
  assert.deepEqual(ruleIds(r), ['ZZ9']);
  assert.match(r.stdout, /stripped 2 AE1 result\(s\) the allowance accepts, in 1 pair\(s\)/);
  assert.match(r.stdout, /SKILL\.md -> lib\/long\.mjs ×2/);
});

test('without --allowances an AE1 result is kept, as before', () => {
  const path = out();
  const res = run(strip, [sarif(acceptedSarif()), path]);
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).runs[0].results.map(x => x.ruleId), ['AE1', 'AE1', 'ZZ9']);
});

test('the ids are never read: SARIF ids that match no JSON report still drop', () => {
  // The workflow scans twice and each scan draws fresh ids. A join by id would
  // drop nothing, or the wrong thing.
  const s = acceptedSarif();
  for (const x of s.runs[0].results) if (x.properties) x.properties.findingId = `unmatched-${fresh++}`;
  assert.deepEqual(ruleIds(stripAllowed(s)), ['ZZ9']);
});

test('a pair whose count the gate would refuse keeps every one of its results', () => {
  const s = acceptedSarif();
  s.runs[0].results.push(ae1Result());
  assert.deepEqual(ruleIds(stripAllowed(s)), ['AE1', 'AE1', 'ZZ9', 'AE1']);
});

test('an AE1 result whose key cannot be read is kept', () => {
  const s = acceptedSarif();
  s.runs[0].results.push(ae1Result('lib/long.mjs', { locations: [] }), ae1Result('lib/long.mjs', { properties: { finding: 'unreadable text', tags: ['target-disposition:partial'] } }));
  const r = stripAllowed(s);
  assert.deepEqual(ruleIds(r), ['ZZ9', 'AE1', 'AE1']);
});

test('an AE1 result whose target has an exception outside the allowance is kept', () => {
  const s = withNotes(report(ae1Result(), ae1Result()), partialNote(), partialNote('lib/long.mjs', { reasonCode: 'runtime_limit' }));
  assert.deepEqual(ruleIds(stripAllowed(s)), ['AE1', 'AE1']);
});

test('an AE1 result whose target the SARIF does not show as partial is kept', () => {
  const s = withNotes(report(ae1Result(), ae1Result()));
  assert.deepEqual(ruleIds(stripAllowed(s)), ['AE1', 'AE1']);
});

test('an AE1 result not tagged as a partial target is kept', () => {
  const s = acceptedSarif();
  s.runs[0].results[1].properties.tags = ['target-disposition:missing'];
  assert.deepEqual(ruleIds(stripAllowed(s)), ['AE1', 'AE1', 'ZZ9']);
});

test('entries for another skill drop nothing here', () => {
  assert.deepEqual(ruleIds(stripAllowed(acceptedSarif(), allowance(), 'skills/elsewhere')), ['AE1', 'AE1', 'ZZ9']);
});

test('the paths are still rebased after the allowance is judged', () => {
  // The allowance writes paths relative to the skill, as the scanner does. The
  // prefix goes on afterwards, so the order of the two is part of the rule.
  const path = out();
  const res = run(strip, [sarif(acceptedSarif()), path, '--prefix', 'skills/demo/', '--allowances', allowanceFile(), '--label', 'skills/demo']);
  assert.equal(res.code, 0, `${res.stdout}${res.stderr}`);
  const kept = JSON.parse(readFileSync(path, 'utf8')).runs[0].results;
  assert.deepEqual(kept.map(x => x.ruleId), ['ZZ9']);
  assert.equal(kept[0].locations[0].physicalLocation.artifactLocation.uri, 'skills/demo/README.md');
});

test('--allowances without a skills/<name> label fails', () => {
  assertFails([sarif(acceptedSarif()), out(), '--allowances', allowanceFile()], /--allowances needs --label skills\/<name>/);
  assertFails([sarif(acceptedSarif()), out(), '--allowances', allowanceFile(), '--label', 'demo'], /--allowances needs --label skills\/<name>/);
});

test('--label without --allowances fails rather than being ignored', () => {
  assertFails([sarif(acceptedSarif()), out(), '--label', 'skills/demo'], /--label is read only with --allowances/);
});

test('a missing or malformed allowance file fails rather than dropping nothing', () => {
  assertFails([sarif(acceptedSarif()), out(), '--allowances', join(work, 'never-written.json'), '--label', 'skills/demo'], /cannot read/);
  const bad = join(work, `allow-${n++}.json`);
  writeFileSync(bad, '{"version": 1}');
  assertFails([sarif(acceptedSarif()), out(), '--allowances', bad, '--label', 'skills/demo'], /cannot be used/);
});