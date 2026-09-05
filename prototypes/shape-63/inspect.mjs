#!/usr/bin/env node
// inspect.mjs — print the three things a fidelity miss usually turns on.
//
// When `loop-report.mjs` says a run misses a claim, the next question is always
// what the file actually says. This prints every node's returns, its throws and
// its E channel, which is enough to tell a real miss from a rubric reading the
// wrong step — the distinction the t2 and t4 misses of round six turned on.
//
//   node inspect.mjs runs-loop63/t4-haiku-1/attempt-2.json [more files...]

import { readFileSync } from "node:fs";
for (const r of process.argv.slice(2)) {
  const p = JSON.parse(readFileSync(r, "utf8"));
  console.log(`=== ${r}`);
  for (const [id, n] of Object.entries(p.nodes)) {
    for (const s of n.steps ?? []) {
      if (s.op === "return") console.log(`  ${id} return expr: ${JSON.stringify(s.expr)}`);
      if (s.op === "throw") console.log(`  ${id} throw ${s.tag} on ${s.channel}`);
    }
    if (n.channels?.E?.length) console.log(`  ${id} E: ${JSON.stringify(n.channels.E)}`);
  }
}
