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

const shrank = (a, b) =>
  b.nodes < a.nodes || b.presets < a.presets || b.moves < a.moves || b.steps < a.steps;

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
  if (passes[finalIdx]?.prog && task) fid = score(passes[finalIdx].prog, task);

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
    shrank: first && final ? shrank(first, final) : null,
    fid,
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
        ? `${fmt(r.first)} → ${fmt(r.final)}${r.shrank ? "  SHRANK" : ""}`
        : "—";
    const fidCol = r.fid
      ? `${r.fid.total - r.fid.misses.length}/${r.fid.total}, ${r.fid.critMisses.length} crit`
      : "—";
    console.log(
      `${r.name.padEnd(14)} ${String(r.passes.length).padEnd(6)}  ${(r.green
        ? String(r.passesToGreen)
        : "no"
      ).padEnd(5)}  ${errSeq.padEnd(18)}  ${sizeCol.padEnd(28)}  ${fidCol}`,
    );
    if (detail) {
      for (const m of r.fid?.critMisses ?? [])
        console.log(`${" ".repeat(16)}! ${m.what}`);
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
  const shrunk = converged.filter((r) => r.shrank);
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
    `${shrunk.length} green run(s) reached clean by shrinking (needs 0)`,
  );

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
