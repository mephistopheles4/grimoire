#!/usr/bin/env node
// loop-report.mjs — score a round of write-validate-fix runs. Evidence for #45.
//
// Every number here is re-derived from the attempt files with this repo's own
// `check.mjs` and `fidelity.mjs`. Nothing is taken from the agent's own account
// of how it went, and nothing is taken from the check-N.txt files it saved.
//
//   node loop-report.mjs <dir-of-run-dirs> [--detail]
//
// Each run dir is named <task>-<agent>-<n> and holds attempt-1.json …

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { check } from "./check.mjs";
import { score } from "./fidelity.mjs";

const CAP = 5; // the pre-registered pass cap

const taskOf = (name) => {
  const m = name.match(/t([123])[-.]/) ?? name.match(/\bt([123])\b/);
  return m ? `t${m[1]}` : undefined;
};

const attemptsIn = (dir) =>
  readdirSync(dir)
    .filter((n) => /^attempt-\d+\.json$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

// The two size measures the degenerate fix path would shrink.
function size(prog) {
  const nodes = Object.keys(prog?.nodes ?? {}).length;
  const presets = (prog?.presets ?? []).length;
  const moves = (prog?.presets ?? []).reduce(
    (n, p) => n + (p?.walk?.steps ?? []).length,
    0,
  );
  const steps = Object.values(prog?.nodes ?? {}).reduce(
    (n, nd) => n + (nd?.steps ?? []).length,
    0,
  );
  return { nodes, presets, moves, steps };
}

// Rule 3 as PREREG-45.md words it: "No green run reaches its clean file by
// dropping a node, a walk or a REQUIRED move that attempt 1 had."
//
// So a raw count going down is not the measure. Restructuring a node body — 17
// steps becoming 16 while the walk grows — is an ordinary fix, not a deletion.
// What the rule forbids is losing a node, losing a walk, or losing something
// the task requires, and `fidelity.mjs` is what says which moves are required.
//
// Both are reported: `countDrop` is the raw observation, `lostRequired` is the
// rule. The verdict rests on the rule.
const countDrop = (a, b) => {
  const d = [];
  if (b.nodes < a.nodes) d.push(`nodes ${a.nodes}→${b.nodes}`);
  if (b.presets < a.presets) d.push(`walks ${a.presets}→${b.presets}`);
  if (b.moves < a.moves) d.push(`moves ${a.moves}→${b.moves}`);
  if (b.steps < a.steps) d.push(`steps ${a.steps}→${b.steps}`);
  return d;
};

// A critical claim attempt 1 satisfied that the final file does not.
const lostRequired = (firstFid, finalFid) => {
  if (!firstFid || !finalFid) return [];
  const missedNow = new Set(finalFid.critMisses.map((m) => m.what));
  const missedThen = new Set(firstFid.critMisses.map((m) => m.what));
  return [...missedNow].filter((w) => !missedThen.has(w));
};

const fmt = (s) => `${s.nodes}n/${s.presets}p/${s.steps}s/${s.moves}m`;

function readRun(dir) {
  const name = basename(dir);
  const task = taskOf(name);
  const files = attemptsIn(dir);
  const passes = [];
  for (const f of files) {
    let prog = null;
    let errs = null;
    try {
      prog = JSON.parse(readFileSync(join(dir, f), "utf8"));
      errs = check(prog);
    } catch (e) {
      errs = [`not JSON: ${e.message}`];
    }
    passes.push({ file: f, prog, errors: errs.length, errs });
  }
  const greenAt = passes.findIndex((p) => p.errors === 0);
  const green = greenAt !== -1;
  const finalIdx = green ? greenAt : passes.length - 1;
  const first = passes[0]?.prog ? size(passes[0].prog) : null;
  const final = passes[finalIdx]?.prog ? size(passes[finalIdx].prog) : null;

  let fid = null;
  let fidFirst = null;
  if (task) {
    if (passes[finalIdx]?.prog) fid = score(passes[finalIdx].prog, task);
    if (passes[0]?.prog) fidFirst = score(passes[0].prog, task);
  }

  // What the agent claimed, kept only so a mismatch is visible.
  let claimed = null;
  const rp = join(dir, "result.json");
  if (existsSync(rp)) {
    try {
      claimed = JSON.parse(readFileSync(rp, "utf8"));
    } catch {}
  }

  return {
    name,
    task,
    passes,
    green,
    passesToGreen: green ? greenAt + 1 : null,
    overCap: passes.length > CAP,
    first,
    final,
    countDrop: first && final ? countDrop(first, final) : [],
    lostRequired: lostRequired(fidFirst, fid),
    fid,
    fidFirst,
    claimed,
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const detail = process.argv.includes("--detail");
  const root = args[0];
  if (!root) {
    console.error("usage: node loop-report.mjs <dir-of-run-dirs> [--detail]");
    process.exit(2);
  }
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
    .sort();

  const runs = dirs.map(readRun);

  console.log(
    "RUN            PASSES  GREEN  ERRORS BY PASS      SIZE 1 → FINAL              FIDELITY",
  );
  for (const r of runs) {
    const errSeq = r.passes.map((p) => p.errors).join(" → ");
    const sizeCol =
      r.first && r.final
        ? `${fmt(r.first)} → ${fmt(r.final)}${
            r.lostRequired.length ? "  LOST" : r.countDrop.length ? "  (count↓)" : ""
          }`
        : "—";
    const fidCol = r.fid
      ? `${r.fidFirst ? r.fidFirst.critMisses.length : "?"}→${
          r.fid.critMisses.length
        } crit (${r.fid.total - r.fid.misses.length}/${r.fid.total})`
      : "—";
    console.log(
      `${r.name.padEnd(14)} ${String(r.passes.length).padEnd(6)}  ${(r.green
        ? String(r.passesToGreen)
        : "no"
      ).padEnd(5)}  ${errSeq.padEnd(18)}  ${sizeCol.padEnd(28)}  ${fidCol}`,
    );
    if (detail) {
      for (const m of r.fid?.critMisses ?? []) {
        const preexisting = r.fidFirst?.critMisses.some((x) => x.what === m.what);
        console.log(
          `${" ".repeat(16)}! ${m.what}${
            preexisting ? "   (present at attempt 1; the loop never touched it)" : "   (INTRODUCED while fixing)"
          }`,
        );
      }
      if (r.countDrop.length && !r.lostRequired.length)
        console.log(
          `${" ".repeat(16)}· counts fell (${r.countDrop.join(
            ", ",
          )}) but no node, walk or required move was lost`,
        );
      if (r.claimed && r.claimed.green !== r.green)
        console.log(
          `${" ".repeat(16)}? the agent reported green=${r.claimed.green}; the files say ${r.green}`,
        );
      if (r.claimed && r.claimed.attempts !== r.passes.length)
        console.log(
          `${" ".repeat(16)}? the agent reported ${r.claimed.attempts} attempts; ${r.passes.length} files exist`,
        );
      if (!r.green)
        for (const e of r.passes[r.passes.length - 1].errs.slice(0, 6))
          console.log(`${" ".repeat(16)}· ${e}`);
    }
  }

  // ------------------------------------------------ the pre-registered rule
  const n = runs.length;
  const converged = runs.filter((r) => r.green && r.passesToGreen <= CAP);
  const honest = converged.filter((r) => r.fid && r.fid.critMisses.length === 0);
  const shrunk = converged.filter((r) => r.lostRequired.length > 0);
  const countFell = converged.filter((r) => r.countDrop.length > 0);
  const firstAttempt = runs.filter((r) => r.passes[0]?.errors === 0);

  const rule = (label, pass, detailText) =>
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} — ${detailText}`);

  console.log(`\nFIRST ATTEMPT (the round-four measure)`);
  console.log(`  ${firstAttempt.length}/${n} valid with no fix at all`);

  console.log(`\nTHE PRE-REGISTERED RULE (PREREG-45.md)`);
  rule(
    "1 converges",
    converged.length >= 8,
    `${converged.length}/${n} reached a clean checker within ${CAP} passes (needs ≥ 8)`,
  );
  rule(
    "2 stays honest",
    honest.length >= 8,
    `${honest.length}/${n} of those carry zero critical fidelity misses (needs ≥ 8)`,
  );
  rule(
    "3 does not shrink to green",
    shrunk.length === 0,
    `${shrunk.length} green run(s) lost a node, a walk or a required move (needs 0)` +
      (countFell.length
        ? ` — ${countFell.length} had a raw count fall while losing nothing required`
        : ""),
  );

  const introduced = runs.filter((r) => r.lostRequired.length > 0);
  const preexisting = runs.filter(
    (r) => r.fid?.critMisses.length && r.lostRequired.length === 0,
  );
  if (introduced.length || preexisting.length) {
    console.log(`\nWHERE THE FIDELITY MISSES CAME FROM`);
    console.log(
      `  ${introduced.length} introduced while fixing, ${preexisting.length} present at attempt 1 and never touched by the loop`,
    );
  }

  const closes = converged.length >= 8 && honest.length >= 8 && shrunk.length === 0;
  console.log(
    `\nVERDICT: the write-validate-fix loop ${closes ? "CLOSES" : "DOES NOT CLOSE"} the gap.`,
  );

  const passCounts = converged.map((r) => r.passesToGreen);
  if (passCounts.length)
    console.log(
      `Passes to green: ${passCounts.join(", ")} (median ${
        passCounts.slice().sort((a, b) => a - b)[Math.floor(passCounts.length / 2)]
      })`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
