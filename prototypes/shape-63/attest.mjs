#!/usr/bin/env node
// attest.mjs — did the saved output come from the saved file, under the pinned
// validator?
//
//   node attest.mjs runs-loop63-r7
//
// PREREG-63-ROUND7.md pre-registers this as a guard, run after every run and
// before any number is computed. Round six had to detect both of its failures
// after the fact:
//
//   1. THE WRONG VALIDATOR. The eval runs in a worktree of a repository whose
//      main checkout holds an older validator on the same disk. `t1-haiku-1`
//      resolved the script path against the wrong root, validated the old
//      one-graph shape, and was told it was fine.
//   2. AN ATTEMPT EDITED AFTER IT WAS CHECKED. `t1-haiku-3`'s attempt-1 scores
//      clean while its check-1.txt reports two refusals, so the file that
//      produced that output no longer exists.
//
// Both leave the same trace: the saved attempt file, re-checked now with the
// pinned validator, does not reproduce the saved checker output. Either way the
// run did not measure the shape under test, and the pre-registration declares
// it NOT A RUN before any number exists.
//
// Three things are normalised before comparing, and nothing else is forgiven:
//
//   - NEWLINES. The agents redirect through PowerShell, which writes CRLF;
//     `spawnSync` here reads LF. That is the shell's encoding, not a verdict.
//   - THE PATH THE FILE WAS NAMED BY. A refusal is prefixed with the argument
//     the agent passed. Round six's agents passed an absolute path and round
//     seven's pass a bare filename, so every occurrence of `…attempt-N.json`
//     collapses to `attempt-N.json`. What the file is called is not a verdict.
//   - TRAILING WHITESPACE.
//
// The verdict itself — every refusal, every finding, the ok line and its
// counts — is compared exactly.
//
// `--check` writes its ok line to stderr and its refusals to stdout, and the
// agents capture both with `2>&1`. So both are captured here.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(here, "..", "..", "skills", "groundtrack", "scripts", "render.mjs");

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node attest.mjs <runs-dir>");
  process.exit(2);
}

const norm = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/\S*(attempt-\d+\.json)/g, "$1")
    .replace(/\s+$/, "");

const runCheck = (cwd, file) => {
  const r = spawnSync("node", [VALIDATOR, file, "--check"], {
    cwd,
    encoding: "utf8",
  });
  return (r.stdout ?? "") + (r.stderr ?? "");
};

const runs = readdirSync(dir)
  .map((n) => join(dir, n))
  .filter((p) => statSync(p).isDirectory())
  .sort();

let bad = 0;
let files = 0;

for (const run of runs) {
  const attempts = readdirSync(run)
    .filter((n) => /^attempt-\d+\.json$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const a of attempts) {
    const n = a.match(/\d+/)[0];
    const checkPath = join(run, `check-${n}.txt`);
    files++;

    if (!existsSync(checkPath)) {
      console.log(`X ${basename(run)}/${a}: no check-${n}.txt beside it`);
      bad++;
      continue;
    }

    const saved = norm(readFileSync(checkPath, "utf8"));
    const now = norm(runCheck(run, a));

    if (saved === now) continue;

    bad++;
    const okLine = saved.split("\n").find((l) => l.startsWith("ok:"));
    const oldValidator = okLine && !/graph\(s\)/.test(okLine);
    console.log(
      `X ${basename(run)}/${a}: saved output is not what the pinned validator prints for this file`,
    );
    console.log(
      `    ${
        oldValidator
          ? "its ok line carries no graph count — this came from the OLD validator"
          : "the file or the output was changed after the check"
      }`,
    );
    console.log(`    saved: ${saved.split("\n")[0]}`);
    console.log(`    now:   ${now.split("\n")[0]}`);
  }
}

console.log(
  `\n${files - bad} of ${files} attempt files reproduce their saved checker output under the pinned validator.`,
);
console.log(
  bad === 0
    ? "ATTESTED: every run in this directory measured the shape under test."
    : `NOT ATTESTED: ${bad} file(s) above. The runs holding them are not runs, per PREREG-63-ROUND7.md.`,
);
process.exit(bad === 0 ? 0 : 1);
