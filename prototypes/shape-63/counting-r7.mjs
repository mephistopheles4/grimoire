#!/usr/bin/env node
// counting-r7.mjs — the arithmetic under every counting of the voided run.
//
//   node counting-r7.mjs
//
// PREREG-63-ROUND7.md promises that when a run is voided, "the arithmetic under
// every counting -- void set aside, void kept and replacement dropped, both kept
// at n = 10 -- is reported, as round six reported it, so no counting is hidden."
// This computes it.
//
// It does NOT reuse loop-report.mjs's pass count, and the reason is the whole
// point of the void rule. `loop-report.mjs:185` reads `check-${n}.txt` for the
// attempt numbered n. The voided run has two attempt files and FOUR check files,
// because the agent checked attempt-2.json, edited it, and checked it again,
// twice. check-3 and check-4 are never read, so loop-report scores that run at
// two passes when its checker ran four times and only went green on the fourth.
//
// That is not a bug to route around. It is the reason the run is void: the
// artifact needed to count it does not exist, so no instrument can count it
// honestly. Here the count comes from the check files alone, which all survive.
//
// Passes to green = the number of times the checker ran, up to and including the
// first clean one. That is round six's own rule for the same defect class, in
// its words: "Its passes are counted by the number of checker runs -- 2, not 1."

import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCORED = "runs-loop63-r7";
const VOIDED = "voided-r7";
const ROUND6 = "runs-loop63";
const MIGRATED = ["t1", "t2", "t3"];

const VALIDATOR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
  "groundtrack",
  "scripts",
  "render.mjs",
);

/* A check file is clean when it carries an ok line and reports no refusals. */
const isClean = (txt) => /^ok:/m.test(txt) && !/\brefusal\(s\)/.test(txt);

function passesToGreen(dir) {
  const checks = readdirSync(dir)
    .filter((n) => /^check-\d+\.txt$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  for (let i = 0; i < checks.length; i++) {
    if (isClean(readFileSync(join(dir, checks[i]), "utf8"))) return i + 1;
  }
  return null; // never went green
}

function runsIn(root) {
  return readdirSync(root)
    .map((n) => ({ name: n, dir: join(root, n) }))
    .filter((r) => statSync(r.dir).isDirectory())
    .map((r) => ({ ...r, task: r.name.split("-")[0], passes: passesToGreen(r.dir) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const scored = runsIn(SCORED);
const voided = runsIn(VOIDED).map((r) => ({ ...r, name: r.name + " (voided)" }));

/* loop-report's own median: the upper middle when n is even. */
const median = (xs) =>
  xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

function score(label, runs) {
  const mig = runs.filter((r) => MIGRATED.includes(r.task));
  const converged = mig.filter((r) => r.passes !== null);
  const ps = converged.map((r) => r.passes);
  const med = median(ps);
  console.log(`\n${label}`);
  console.log(`  migrated runs        ${mig.length}`);
  console.log(
    `  passes to green      ${ps.slice().sort((a, b) => a - b).join(", ")}`,
  );
  console.log(
    `  convergence          ${converged.length}/${mig.length}  ${
      converged.length >= 8 ? "PASS" : "FAIL"
    }  (needs >= 8 of 9)`,
  );
  console.log(
    `  median passes        ${med}  ${med <= 2 ? "PASS" : "FAIL"}  (needs <= 2)`,
  );
}

console.log("PASSES TO GREEN, COUNTED FROM THE CHECK FILES\n");
for (const r of [...scored, ...voided].filter((r) => MIGRATED.includes(r.task)))
  console.log(`  ${r.name.padEnd(24)} ${r.passes ?? "did not converge"}`);

const voidRun = voided.find((r) => r.task === "t3");
const replacement = scored.find((r) => r.name === "t3-haiku-3");

score(
  "A. VOID SET ASIDE, SLOT RE-RUN — what PREREG-63-ROUND7.md pre-registered",
  scored,
);
score(
  "B. VOID KEPT AS THE t3 SLOT, REPLACEMENT DROPPED — round six's counting",
  [...scored.filter((r) => r !== replacement), voidRun],
);
score("C. BOTH KEPT, n = 10 MIGRATED", [...scored, voidRun]);

/* ---------------------------------------------------------------------------
 * The cross-check that makes the comparison symmetric.
 *
 * Round seven's void rule is stricter than round six's, and it is the reason
 * round seven passes rule 2 while countings B and C fail it. So the fair
 * question is the other direction: does ROUND SIX survive ROUND SEVEN's rule?
 * If it does, the two rounds differ in which rule they were scored under, not
 * in whether either could have withstood the other.
 *
 * Void-ness is decided the same way attest.mjs decides it: a run is not a run
 * when a saved attempt file no longer reproduces its saved checker output. */

const norm = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/\S*(attempt-\d+\.json)/g, "$1")
    .replace(/\s+$/, "");

function reproduces(dir) {
  for (const a of readdirSync(dir).filter((n) => /^attempt-\d+\.json$/.test(n))) {
    const n = a.match(/\d+/)[0];
    let saved;
    try {
      saved = readFileSync(join(dir, `check-${n}.txt`), "utf8");
    } catch {
      return false;
    }
    const r = spawnSync("node", [VALIDATOR, a, "--check"], {
      cwd: dir,
      encoding: "utf8",
    });
    if (norm(saved) !== norm((r.stdout ?? "") + (r.stderr ?? ""))) return false;
  }
  return true;
}

const six = runsIn(ROUND6).map((r) => ({ ...r, attested: reproduces(r.dir) }));

console.log("\n\nCROSS-CHECK — ROUND SIX UNDER ROUND SEVEN'S VOID RULE\n");
for (const r of six.filter((r) => MIGRATED.includes(r.task)))
  console.log(
    `  ${r.name.padEnd(24)} ${String(r.passes ?? "did not converge").padEnd(
      18,
    )} ${r.attested ? "" : "NOT A RUN under round seven's rule"}`,
  );

score(
  "D. ROUND SIX, SCORED UNDER ROUND SEVEN'S VOID RULE",
  six.filter((r) => r.attested),
);
