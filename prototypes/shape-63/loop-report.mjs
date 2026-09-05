#!/usr/bin/env node
// loop-report.mjs — score a round of write-validate-fix runs against the
// pre-registered bar in PREREG-63.md.
//
// Every number here is re-derived from the attempt files, with the SHIPPED
// validator on the #61 branch — the same `render.mjs --check` the agents ran,
// imported rather than shelled out to. Nothing is taken from the agent's own
// account of how it went, and nothing is taken from the check-N.txt files it
// saved. An agent that misread its own checker output cannot move a number here.
//
//   node loop-report.mjs <dir-of-run-dirs> [--detail]
//
// Each run dir is named <task>-<agent>-<n> and holds attempt-1.json …

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { check, findings } from "../../skills/groundtrack/scripts/render.mjs";
import { score, taskOf, reachable } from "./fidelity.mjs";

const CAP = 5; // the pre-registered pass cap, unchanged from round five

const MIGRATED = ["t1", "t2", "t3"]; // round five's tasks, on the new shape
const NEW = ["t4"]; // the two-entry task

/* What #63 names by hand for the new task. The shared symbol is `formatPrice`,
 * and the two entries are the two the task states. */
const SHARED = /format.?price/i;
const ENTRIES = ["renderCatalog", "applyFilters"];

const attemptsIn = (dir) =>
  readdirSync(dir)
    .filter((n) => /^attempt-\d+\.json$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

/* The validator throws on some malformed input rather than refusing it, which
 * is a fine thing for a CLI and a bad thing for a scorer. A throw is a refusal
 * here, and it is counted as one. */
function refusalsOf(prog, label) {
  try {
    return check(prog, label);
  } catch (e) {
    return [`the validator threw: ${e.message}`];
  }
}

function findingsOf(prog) {
  try {
    return findings(prog);
  } catch {
    return null; // a refused file has no meaningful findings
  }
}

// The measures the degenerate fix path would shrink.
function size(prog) {
  const gs = prog?.graphs ?? [];
  const nodes = Object.keys(prog?.nodes ?? {}).length;
  const runs = gs.reduce((n, g) => n + (g?.presets ?? []).length, 0);
  const moves = gs.reduce(
    (n, g) =>
      n +
      (g?.presets ?? []).reduce((m, p) => m + (p?.walk?.steps ?? []).length, 0),
    0,
  );
  const steps = Object.values(prog?.nodes ?? {}).reduce(
    (n, nd) => n + (nd?.steps ?? []).length,
    0,
  );
  return { nodes, graphs: gs.length, runs, moves, steps };
}

/* Round five's rule 3 wording, kept because the observation is still worth
 * having: "no green run reaches its clean file by dropping a node, a walk or a
 * REQUIRED move that attempt 1 had." A raw count going down is not the measure
 * — restructuring a node body is an ordinary fix. `countDrop` is the raw
 * observation; `lostRequired` is the rule, and `fidelity.mjs` is what says
 * which moves are required.
 *
 * #63's bar does not gate on this. It is reported. */
const countDrop = (a, b) => {
  const d = [];
  if (b.nodes < a.nodes) d.push(`nodes ${a.nodes}→${b.nodes}`);
  if (b.graphs < a.graphs) d.push(`graphs ${a.graphs}→${b.graphs}`);
  if (b.runs < a.runs) d.push(`runs ${a.runs}→${b.runs}`);
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

/* ------------------------------------------------------------- the shared node
 *
 * Three questions #63 asks of the new task, computed from the file rather than
 * from the rubric, so the answer does not rest on one instrument.
 *
 * "Defined once" needs saying carefully. A JSON object cannot hold a duplicate
 * key, so `nodes.formatPrice` existing proves nothing: JSON.parse would have
 * dropped a second one silently. The failure mode this is looking for is a
 * SECOND node — `formatPriceForPanel`, or a per-graph copy under another id —
 * so it counts nodes whose id or name names the symbol. The raw text is
 * counted too, because that is the only place a dropped duplicate key is still
 * visible. */
function sharedNode(prog, raw) {
  const nodes = Object.entries(prog?.nodes ?? {});
  const matching = nodes.filter(
    ([id, n]) => SHARED.test(id) || SHARED.test(n?.name ?? ""),
  );
  const id = matching.length ? matching[0][0] : null;
  const keyOccurrences = id
    ? (raw.match(new RegExp(`"${id}"\\s*:`, "g")) ?? []).length
    : 0;
  const reaches = ENTRIES.map((e) => ({
    entry: e,
    reaches: !!id && reachable(prog, e).has(id),
  }));
  const fs = findingsOf(prog);
  const unaccounted = fs === null ? null : fs.filter((x) => /^no node accounts for /.test(x));
  return {
    ids: matching.map(([i]) => i),
    definedOnce: matching.length === 1 && keyOccurrences <= 1,
    keyOccurrences,
    reaches,
    bothReach: reaches.every((r) => r.reaches),
    unaccounted,
  };
}

/* What the agent's own `check-N.txt` says, so a file that was edited AFTER it
 * was checked is visible. The scorer never trusts this number — it re-derives
 * every count from the attempt file — but a disagreement means the saved
 * checker output was not produced from the saved file, and a run whose passes
 * cannot be counted honestly should not be read as if they could. */
function claimedErrors(dir, n) {
  const p = join(dir, `check-${n}.txt`);
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, "utf8");
  if (/^ok:/m.test(txt)) return 0;
  const m = txt.match(/(\d+) refusal\(s\)/);
  return m ? +m[1] : null;
}

function readRun(dir) {
  const name = basename(dir);
  const task = taskOf(name);
  const files = attemptsIn(dir);
  const passes = [];
  for (const f of files) {
    let prog = null;
    let errs = null;
    let raw = "";
    try {
      raw = readFileSync(join(dir, f), "utf8");
      prog = JSON.parse(raw);
      errs = refusalsOf(prog, f);
    } catch (e) {
      errs = [`not JSON: ${e.message}`];
    }
    const n = +f.match(/\d+/)[0];
    passes.push({
      file: f,
      prog,
      raw,
      errors: errs.length,
      errs,
      claimed: claimedErrors(dir, n),
    });
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

  const shared =
    NEW.includes(task) && passes[finalIdx]?.prog
      ? sharedNode(passes[finalIdx].prog, passes[finalIdx].raw)
      : null;

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
    shared,
    claimed,
  };
}

const fmt = (s) => `${s.nodes}n/${s.graphs}g/${s.runs}r/${s.steps}s/${s.moves}m`;
const median = (xs) =>
  xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

function table(runs) {
  console.log(
    "RUN            PASSES  GREEN  ERRORS BY PASS      SIZE 1 → FINAL                     FIDELITY",
  );
  for (const r of runs) {
    const errSeq = r.passes.map((p) => p.errors).join(" → ");
    const sizeCol =
      r.first && r.final
        ? `${fmt(r.first)} → ${fmt(r.final)}${
            r.lostRequired.length
              ? "  LOST"
              : r.countDrop.length
                ? "  (count↓)"
                : ""
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
      ).padEnd(5)}  ${errSeq.padEnd(18)}  ${sizeCol.padEnd(33)}  ${fidCol}`,
    );
  }
}

function detailFor(r) {
  for (const p of r.passes) {
    if (p.claimed !== null && p.claimed !== p.errors)
      console.log(
        `${" ".repeat(16)}? ${p.file}: its check file says ${p.claimed} refusal(s); the file scores ${p.errors} — it was edited after it was checked`,
      );
    if (p.claimed === null)
      console.log(`${" ".repeat(16)}? ${p.file}: no readable check file beside it`);
  }
  for (const m of r.fid?.critMisses ?? []) {
    const preexisting = r.fidFirst?.critMisses.some((x) => x.what === m.what);
    console.log(
      `${" ".repeat(16)}! ${m.what}${
        preexisting
          ? "   (present at attempt 1; the loop never touched it)"
          : "   (INTRODUCED while fixing)"
      }`,
    );
  }
  if (r.countDrop.length && !r.lostRequired.length)
    console.log(
      `${" ".repeat(16)}· counts fell (${r.countDrop.join(
        ", ",
      )}) but no node, graph, run or required move was lost`,
    );
  if (r.shared) {
    const s = r.shared;
    console.log(
      `${" ".repeat(16)}· shared node: ${
        s.ids.length ? s.ids.join(", ") : "NONE FOUND"
      } — defined once: ${s.definedOnce}; both entries reach it: ${
        s.bothReach
      }; unaccounted findings: ${
        s.unaccounted === null ? "n/a (refused)" : s.unaccounted.length
      }`,
    );
    for (const u of s.unaccounted ?? []) console.log(`${" ".repeat(18)}· ${u}`);
  }
  if (r.claimed && r.claimed.green !== r.green)
    console.log(
      `${" ".repeat(16)}? the agent reported green=${r.claimed.green}; the files say ${r.green}`,
    );
  if (r.claimed && r.claimed.attempts !== r.passes.length)
    console.log(
      `${" ".repeat(16)}? the agent reported ${r.claimed.attempts} attempts; ${r.passes.length} files exist`,
    );
  if (!r.green)
    for (const e of r.passes[r.passes.length - 1].errs.slice(0, 8))
      console.log(`${" ".repeat(16)}· ${e}`);
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
  const migrated = runs.filter((r) => MIGRATED.includes(r.task));
  const fresh = runs.filter((r) => NEW.includes(r.task));

  console.log("THE THREE MIGRATED TASKS — the baseline round five set\n");
  table(migrated);
  if (detail) for (const r of migrated) detailFor(r);

  console.log("\nTHE NEW TWO-ENTRY TASK\n");
  table(fresh);
  if (detail) for (const r of fresh) detailFor(r);

  const rule = (label, pass, text) =>
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} — ${text}`);

  // -------------------------------------------------- the pre-registered bar
  const mConverged = migrated.filter((r) => r.green && r.passesToGreen <= CAP);
  const mFaithful = mConverged.filter(
    (r) => r.fid && r.fid.critMisses.length === 0,
  );
  const mMedian = median(mConverged.map((r) => r.passesToGreen));

  const fConverged = fresh.filter((r) => r.green && r.passesToGreen <= CAP);
  const fShared = fConverged.filter((r) => r.shared?.definedOnce);

  console.log(`\nFIRST ATTEMPT (reported, not gated)`);
  console.log(
    `  migrated: ${migrated.filter((r) => r.passes[0]?.errors === 0).length}/${
      migrated.length
    } valid with no fix at all` +
      `; new task: ${fresh.filter((r) => r.passes[0]?.errors === 0).length}/${fresh.length}`,
  );

  console.log(`\nTHE PRE-REGISTERED BAR (PREREG-63.md)`);
  rule(
    "migrated · convergence",
    mConverged.length >= 8,
    `${mConverged.length}/${migrated.length} reached a clean checker within ${CAP} passes (needs ≥ 8 of 9)`,
  );
  rule(
    "migrated · median passes",
    mMedian !== null && mMedian <= 2,
    `median ${mMedian ?? "—"} passes to green (needs ≤ 2)`,
  );
  rule(
    "migrated · fidelity",
    mFaithful.length >= 7,
    `${mFaithful.length}/${migrated.length} are valid AND carry zero critical fidelity misses (needs ≥ 7 of 9)`,
  );
  rule(
    "new task · convergence",
    fConverged.length >= 2,
    `${fConverged.length}/${fresh.length} reached a clean checker within ${CAP} passes (needs ≥ 2 of 3)`,
  );
  rule(
    "new task · the shared node is defined once",
    fShared.length >= 2,
    `${fShared.length}/${fresh.length} converged runs define the shared symbol once (needs ≥ 2 of 3)`,
  );

  console.log(`\nTHE NEW TASK, MEASURED (reported alongside the bar)`);
  for (const r of fresh) {
    const s = r.shared;
    console.log(
      `  ${r.name.padEnd(14)} green=${r.green ? r.passesToGreen : "no"}  once=${
        s?.definedOnce ?? "—"
      }  bothReach=${s?.bothReach ?? "—"}  unaccounted=${
        s?.unaccounted === null || s === null ? "n/a" : s.unaccounted.length
      }`,
    );
  }

  // ------------------------------------------------ reported, never gated
  const shrunk = [...mConverged, ...fConverged].filter(
    (r) => r.lostRequired.length > 0,
  );
  const countFell = [...mConverged, ...fConverged].filter(
    (r) => r.countDrop.length > 0,
  );
  console.log(`\nSHRINK TO GREEN (reported; #63's bar does not gate on it)`);
  console.log(
    `  ${shrunk.length} green run(s) lost a node, a graph, a run or a required move` +
      (countFell.length
        ? `; ${countFell.length} had a raw count fall while losing nothing required`
        : ""),
  );

  const migratedPass =
    mConverged.length >= 8 && mMedian !== null && mMedian <= 2 && mFaithful.length >= 7;
  const newPass = fConverged.length >= 2 && fShared.length >= 2;

  console.log(
    `\nVERDICT: migrated ${migratedPass ? "PASS" : "FAIL"}, new task ${
      newPass ? "PASS" : "FAIL"
    } — ${
      migratedPass && newPass
        ? "#61 may merge."
        : migratedPass
          ? "#61 does not merge; this reopens the NODE-MAP row of the box."
          : "#61 does not merge; this reopens the CONTAINER row of the box."
    }`,
  );
  if (mConverged.length)
    console.log(
      `Passes to green, migrated: ${mConverged
        .map((r) => r.passesToGreen)
        .join(", ")} (median ${mMedian})`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
