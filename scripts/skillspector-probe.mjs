#!/usr/bin/env node
// Proves the scanner honours a baseline entry's `file`.
//
//   node scripts/skillspector-probe.mjs <report.json>
//
// The workflow copies skills/eagle-eye/ to a folder of the same name under the
// runner's temp folder, copies audit.mjs inside the copy to lib/audit.mjs, and
// scans the copy with --use-shipped-baseline. The baseline's E1 entry names
// audit.mjs, so a scanner that honours `file` suppresses the original's E1
// finding and reports the copy's. A scanner that ignores `file` suppresses
// both, and this exits 1: a pin bump cannot quietly turn the narrowing off.
//
// It reads `issues` and `suppressed` by rule `id` (or `rule_id`), case-folded, and `location.file`, and
// judges nothing else. It does not say the copy is complete: the copy is read in
// part, as audit.mjs is. The step that runs it proves the installer's route
// (--use-shipped-baseline); the gate loads the same file by --baseline.
//
// What it prints is each finding's rule and its report-relative file, never the
// path it was handed, and a name from the report goes through shown(). Its test
// is tests/skillspector-probe.test.mjs, which feeds it reports by hand.

import { appendFileSync, readFileSync } from 'node:fs';
import { shown } from './lib/printable.mjs';

const path = process.argv[2];
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const note = [];

// One table cell, escaped as the gate's is: a pipe or line break would end the
// cell early, and the text is the scanner's.
const cell = v => {
  const s = String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .trim();
  return s || '—';
};

function finish(code, message) {
  if (message) console.error(message);
  if (summaryFile) {
    try {
      appendFileSync(summaryFile, `### scanner honours file: ${code ? 'red' : 'pass'}\n\n${note.join('\n')}\n\n`);
    } catch (e) {
      console.error(`note: could not write the run summary: ${e.code || e.message}`);
    }
  }
  process.exit(code);
}

let report;
try {
  if (!path) throw new Error('no report');
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch {
  finish(1, 'cannot read the report: it is missing or not JSON');
}
const list = v => (Array.isArray(v) ? v : null);
const issues = list(report?.issues);
const suppressed = list(report?.suppressed);
if (!issues || !suppressed) finish(1, 'cannot read the report: it holds no issues and suppressed lists');

const rows = items =>
  items
    .filter(i => i && typeof i === 'object')
    .map(i => ({ id: String(i.id ?? i.rule_id ?? '').toUpperCase(), file: String(i.location?.file ?? '') }))
    .filter(r => r.id === 'E1');
const reported = rows(issues);
const hidden = rows(suppressed);
for (const r of reported) console.log(`reported: ${r.id} ${shown(r.file)}`);
for (const r of hidden) console.log(`suppressed: ${r.id} ${shown(r.file)}`);
note.push('| State | Rule | File |', '| --- | --- | --- |');
for (const [state, set] of [['reported', reported], ['suppressed', hidden]]) for (const r of set) note.push(`| ${state} | ${cell(r.id)} | ${cell(shown(r.file))} |`);

const problems = [];
if (!reported.some(r => r.file === 'lib/audit.mjs')) problems.push('E1 on lib/audit.mjs was not reported — the scanner ignored the baseline entry\'s file, or the copy was not scanned');
if (!hidden.some(r => r.file === 'audit.mjs')) problems.push('E1 on audit.mjs was not suppressed — the baseline did not load, or its entry no longer names the file');
finish(problems.length ? 1 : 0, problems.join('\n'));
