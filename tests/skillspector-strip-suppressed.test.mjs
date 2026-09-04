// The strip decides what GitHub's Security tab is told, and the workflow is
// the only caller. So the seam under test is the one the workflow uses: two
// paths in, a written file and an exit code out.
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
