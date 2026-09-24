#!/usr/bin/env node
// Remove the baseline-suppressed results from a SARIF report before it is
// uploaded, so the Security tab carries only what the gate would fail on.
//
//   node scripts/skillspector-strip-suppressed.mjs <in.sarif> <out.sarif> [--prefix <dir>/]
//
// **Why this exists, measured rather than assumed.** SkillSpector keeps a
// baselined finding in its SARIF and marks it `suppressions: [{ kind:
// "external", justification: <the baseline's reason> }]`, which is what SARIF
// says a consumer should exclude from its counts. GitHub code scanning does not
// act on it. Its supported-properties page lists what code scanning reads and
// `result.suppressions` is not on the list. The uploaded report can be fetched
// back from the analyses API, and GitHub had in fact stored the property —
// re-serialised as `{"state": "accepted"}` — beside an alert it opened anyway.
// So twenty-three alerts sat open in the Security tab, every one of them a rule
// .skillspector-baseline.yaml argues away by name, under a workflow whose every
// run was green.
//
// A tab full of findings this project has already reasoned about is a tab
// nobody reads, and it is not even where the reasons are: those live in the
// baseline, and in `--show-suppressed` for anyone scanning this tree
// themselves. What belongs in the tab is what the gate goes red on.
//
// **It drops results and touches nothing else** — not `tool.driver.rules`, not
// `artifacts`, not the order of what stays. Both of those arrays are referenced
// by index from the results that remain, so a tidy-up renumbering them would
// point a kept finding at the wrong rule. A rule descriptor left with no
// finding under it costs a reader nothing.
//
// **Except the paths, when asked, and only the paths.** The workflow scans each
// skill on its own, and the scanner writes every path relative to the directory
// it was pointed at, with no flag to change that: a finding in
// skills/eagle-eye/SKILL.md arrives as `SKILL.md`. GitHub resolves a relative
// path against the repository root, so that alert would point at a file that
// does not exist. `--prefix skills/eagle-eye/` puts the directory back on every
// relative `uri` in an artifact location — the results, the scanner's own
// notifications, and the `artifacts` list. Nothing is renumbered, so the index
// argument above still holds. An absolute URI is left as it was and counted. A
// location carrying a `uriBaseId` fails instead: its path is relative to a base
// this script cannot see, and a guessed prefix would be a wrong path that looks
// right. The scanner writes none today.
//
// **It never drops what it cannot read.** A result that is not an object, or
// whose `suppressions` is not an array, is kept and said out loud. The one
// mistake this script can make is a silent removal, so every branch that
// removes something needs a suppression it could actually read. A malformed
// report fails instead, for the reason the gate refuses the same shapes: a file
// this step cannot read must not upload as a file with nothing in it.
//
// **An empty results array is not a no-op, and skipping the upload is not an
// optimisation.** GitHub marks an alert fixed when the next upload under the
// same category stops carrying it, so the empty array is exactly what closes
// the findings the baseline argued away. It is written, and it is uploaded.
//
// tests/skillspector-strip-suppressed.test.mjs drives every rule above with
// reports written by hand, and never runs the scanner.

import { readFileSync, writeFileSync } from 'node:fs';

const USAGE = 'usage: node scripts/skillspector-strip-suppressed.mjs <in.sarif> <out.sarif> [--prefix <dir>/]';
const positional = [];
let prefix = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--prefix') {
    prefix = args[i + 1] ?? '';
    i += 1;
  } else {
    positional.push(args[i]);
  }
}
const [input, output] = positional;
if (!input || !output || positional.length > 2 || prefix === '') {
  console.error(USAGE);
  process.exit(1);
}
if (prefix !== null) {
  // A repository-relative directory, written the way a SARIF uri is: forward
  // slashes, no scheme, no leading slash, no step upward. Anything else would
  // put a path in the Security tab that the repository does not have.
  if (/^[a-z][a-z0-9+.-]*:/i.test(prefix) || prefix.startsWith('/') || prefix.includes('\\') || prefix.split('/').includes('..')) {
    console.error(`--prefix ${prefix}: not a directory relative to the repository root`);
    process.exit(1);
  }
  if (!prefix.endsWith('/')) prefix += '/';
  // The prefix is a directory name and the result is a URI. A `#` would start
  // a fragment and a space is not allowed at all, so each segment is
  // percent-encoded and the slashes between them are kept. The workflow passes
  // a raw directory name, so nothing here is encoded twice.
  prefix = prefix.split('/').map(encodeURIComponent).join('/');
}

const die = message => {
  console.error(`${input}: ${message}`);
  console.error(
    '\nThe SARIF pass wrote something this step cannot filter. Uploading it unfiltered\n' +
      'would put the baselined findings back in the Security tab; uploading nothing would\n' +
      'mark every open alert fixed. Both are worse than a red step. A scanner version\n' +
      'that changed the report shape is the first thing to check.',
  );
  process.exit(1);
};

let raw;
try {
  raw = readFileSync(input, 'utf8');
} catch (e) {
  die(`cannot read it: ${e.code || e.message}`);
}

let report;
try {
  report = JSON.parse(raw);
} catch (e) {
  die(`not JSON: ${e.message}`);
}
if (report === null || typeof report !== 'object' || Array.isArray(report)) die('not a JSON object');
if (!Array.isArray(report.runs)) die('has no "runs" array — an absent list is not an empty one');

// How many of each rule went, so the log says which findings were silenced and
// not merely how many. The counts drift as prose is edited and the rule
// identifiers do not, which makes this the line that shows a seventh rule
// appearing — it cannot appear quietly, because a rule outside the baseline is
// never suppressed and fails the gate.
const removed = new Map();
let kept = 0;
let unreadable = 0;

report.runs.forEach((run, i) => {
  if (run === null || typeof run !== 'object' || Array.isArray(run)) die(`runs[${i}] is not an object`);
  if (!Array.isArray(run.results)) {
    die(`runs[${i}] has no "results" array — an absent list is not an empty one`);
  }
  run.results = run.results.filter(r => {
    const keep = () => {
      kept += 1;
      return true;
    };
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      unreadable += 1;
      return keep();
    }
    // Absent means no suppression. `null` does not, and the difference is not
    // a JavaScript habit: SkillSpector serialises its SARIF with Pydantic's
    // `exclude_none=True`, so a result it wrote either carries the key as an
    // array or does not carry it at all. A `null` here came from somewhere
    // else, which is exactly the thing this script says out loud rather than
    // reads past.
    const suppressions = r.suppressions;
    if (suppressions === undefined) return keep();
    if (!Array.isArray(suppressions)) {
      unreadable += 1;
      return keep();
    }
    if (!suppressions.length) return keep();
    const id = typeof r.ruleId === 'string' && r.ruleId ? r.ruleId : 'unidentified';
    removed.set(id, (removed.get(id) ?? 0) + 1);
    return false;
  });
});

// The paths, when asked. After the filter, so a dropped result is not counted.
let prefixed = 0;
let absolute = 0;
if (prefix !== null) {
  const rebase = (loc, where) => {
    if (loc === null || typeof loc !== 'object' || typeof loc.uri !== 'string') return;
    if (loc.uriBaseId !== undefined) {
      die(`${where} carries a uriBaseId ("${loc.uriBaseId}"), so its path is relative to a base this step cannot see`);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(loc.uri) || loc.uri.startsWith('/')) {
      absolute += 1;
      return;
    }
    loc.uri = `${prefix}${loc.uri}`;
    prefixed += 1;
  };
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'artifactLocation') rebase(x, `${where}.${k}`);
        walk(x, `${where}.${k}`);
      }
    }
  };
  report.runs.forEach((run, i) => {
    walk(run, `runs[${i}]`);
    // The one artifact location SARIF does not call `artifactLocation`.
    if (Array.isArray(run.artifacts)) run.artifacts.forEach((a, j) => rebase(a?.location, `runs[${i}].artifacts[${j}].location`));
  });
}

try {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
} catch (e) {
  console.error(`cannot write ${output}: ${e.code || e.message}`);
  process.exit(1);
}

const total = [...removed.values()].reduce((a, b) => a + b, 0);
console.log(`ok: stripped ${total} suppressed result(s), kept ${kept}`);
if (total) {
  const tally = [...removed].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, n]) => `${id}×${n}`);
  console.log(`      by rule: ${tally.join(', ')}`);
}
if (prefix !== null) {
  console.log(`ok: put ${prefix} in front of ${prefixed} relative path(s)`);
  if (absolute) console.log(`note: left ${absolute} absolute URI(s) as they were`);
}
if (unreadable) {
  console.log(
    `note: ${unreadable} result(s) kept because this script could not read a suppression on them — nothing is dropped that it cannot judge`,
  );
}
