#!/usr/bin/env node
// make-baseline.mjs — carry a round-five green file onto the #61 shape.
//
// The baseline fixtures exist to answer one question before any run happens:
// is each migrated task still answerable, and does the migrated rubric give a
// good answer full marks? A rubric nobody has run is a rubric nobody has
// tested, and a task nobody has answered is a task that may be impossible.
//
// Two edits, and the difference between them is the point.
//
// 1. THE SHAPE MIGRATION, which is what #61 changed. `entry` and `presets`
//    move into a one-element `graphs` array. Nothing else moves. This is
//    mechanical and applies to every file.
//
// 2. THE RETRY REPAIR, which #61 did not change and which is reported as a
//    confound. Round five's `check.mjs` accepted a two-move retry: an effect
//    that raised on attempt 1, then the same effect succeeding on attempt 2.
//    The shipped validator refuses it — on `main` as much as on #61 — because
//    an error that starts travelling is caught or reaches the top, and a
//    silent retry is neither. The shipped shape writes a successful retry as
//    ONE move carrying `attempt: 2`. So the failed-attempt move is dropped
//    where the same effect succeeds on the next move. The walk still says the
//    upload took two attempts; it says it the way the shipped shape says it.
//
//   node make-baseline.mjs baseline/t1-round5-green.json baseline/t1.json

import { readFileSync, writeFileSync } from "node:fs";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error("usage: node make-baseline.mjs <old.json> <new.json>");
  process.exit(2);
}

const old = JSON.parse(readFileSync(src, "utf8"));
const { entry, presets, ...rest } = old;

const notes = [];

/* Drop a failed effect move whose very next move is the same effect, at the
 * same step, succeeding. That pair is the two-move retry and nothing else:
 * any other raised effect is followed by an unwind, a handled or an uncaught. */
function repairRetries(walk, runName) {
  const out = [];
  for (let i = 0; i < walk.steps.length; i++) {
    const m = walk.steps[i];
    const n = walk.steps[i + 1];
    const isRetriedAway =
      m.k === "effect" &&
      m.raised &&
      n &&
      n.k === "effect" &&
      n.at === m.at &&
      n.kind === m.kind &&
      n.next !== undefined;
    if (isRetriedAway) {
      notes.push(
        `  retry repair: ${runName} move ${i} — "${m.raised.tag}" raised on attempt ${m.attempt ?? 1} and silently retried; the surviving move carries attempt ${n.attempt ?? "?"}`,
      );
      continue;
    }
    out.push(m);
  }
  walk.steps = out;
}

for (const p of presets) repairRetries(p.walk, `"${p.name}"`);

const wrapped = {
  ...rest,
  graphs: [{ id: old.id, title: old.title, blurb: old.blurb, entry, presets }],
};

writeFileSync(dst, JSON.stringify(wrapped, null, 2) + "\n");
console.log(
  `${src} -> ${dst}: one graph, entry "${entry}", ${presets.length} run(s)`,
);
for (const n of notes) console.log(n);
