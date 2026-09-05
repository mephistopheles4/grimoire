#!/usr/bin/env node
// ship-check.mjs — does round six still stand at ship time?
//
//   node ship-check.mjs <ship-ref>        e.g. origin/claude/implement-58-62-...
//
// #63 gated #61. #58 asks for more than that: "The eval is re-run, on the same
// procedure, before this ships" — and #58 does not ship until #62 lands as
// well. So between the round and the ship there is a window in which the thing
// the round measured can move.
//
// A second nine-run round is the honest answer ONLY if something an author
// touches has moved. The round measured two surfaces and nothing else:
//
//   1. THE SHAPE DOCUMENT, which is what an agent reads before it writes.
//   2. THE VALIDATOR'S RULES, which are what it fixes against.
//
// A change that leaves both alone cannot have changed how hard the file is to
// author, whatever else it changed — so the round carries, and this prints the
// evidence for saying so. A change that moves either one invalidates the round
// and it must be re-run. This decides which, and refuses to guess.
//
// The second surface is compared by BEHAVIOUR, not by diff. Round six's own
// rebase moved `render.mjs` by thirteen lines and changed no verdict, because
// the lines moved a computation behind a helper. Reading the diff would have
// called that a change; running both validators over every attempt file of the
// round called it what it was.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PINNED = "ecfb727"; // what PREREG-63.md pinned the round to
const DOC = "skills/groundtrack/references/flightpath-file.md";
const VALIDATOR = "skills/groundtrack/scripts/render.mjs";
const RUNS = "runs-loop63";

const ship = process.argv[2];
if (!ship) {
  console.error("usage: node ship-check.mjs <ship-ref>");
  console.error("  e.g. node ship-check.mjs origin/main");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const sha = (r) => git("rev-parse", "--short", r).trim();

/* Every attempt file of the round, which is the corpus the two validators are
 * compared on. Nothing else exercises as many shapes of wrong file. */
const attempts = readdirSync(RUNS)
  .map((n) => join(RUNS, n))
  .filter((p) => statSync(p).isDirectory())
  .flatMap((d) =>
    readdirSync(d)
      .filter((n) => /^attempt-\d+\.json$/.test(n))
      .map((n) => join(d, n)),
  )
  .sort();

const run = (script, file) => {
  try {
    return {
      out: execFileSync("node", [script, file, "--check"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      code: 0,
    };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
};

console.log(`round six was pinned to  ${PINNED}`);
console.log(`checking it against      ${ship} (${sha(ship)})\n`);

// ---------------------------------------------------------- surface 1: the document
const docBefore = git("show", `${PINNED}:${DOC}`);
const docAfter = git("show", `${ship}:${DOC}`);
const docSame = docBefore === docAfter;
console.log(
  `1. THE SHAPE DOCUMENT — ${
    docSame
      ? "byte-identical. What an agent reads has not moved."
      : "CHANGED. What an agent reads is not what the round measured."
  }`,
);
if (!docSame) {
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  console.log(`   ${words(docBefore)} words -> ${words(docAfter)} words`);
}

// ---------------------------------------------------------- surface 2: the rules
const tmp = mkdtempSync(join(tmpdir(), "shipcheck-"));
let differing = [];
try {
  git("worktree", "add", "-q", "--detach", tmp, ship);
  const shipValidator = join(tmp, ...VALIDATOR.split("/"));
  const pinnedValidator = join("..", "..", ...VALIDATOR.split("/"));
  for (const f of attempts) {
    const a = run(pinnedValidator, f);
    const b = run(shipValidator, f);
    if (a.out !== b.out || a.code !== b.code) differing.push(f);
  }
} finally {
  try {
    git("worktree", "remove", "--force", tmp);
  } catch {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const rulesSame = differing.length === 0;
console.log(
  `\n2. THE VALIDATOR'S RULES — ${
    rulesSame
      ? `same verdict on all ${attempts.length} attempt files of the round.`
      : `${differing.length} of ${attempts.length} attempt files get a DIFFERENT verdict.`
  }`,
);
for (const f of differing.slice(0, 10)) console.log(`   ${f}`);

// ---------------------------------------------------------- the answer
const carries = docSame && rulesSame;
console.log(
  `\nVERDICT: ${
    carries
      ? "round six CARRIES to this commit. Neither surface it measured has moved,\n         so the authoring cost it reported is still the authoring cost."
      : "round six DOES NOT CARRY. A surface it measured has moved, so its numbers\n         describe a shape that is no longer the one shipping. Re-run the round."
  }`,
);
process.exit(carries ? 0 : 1);
