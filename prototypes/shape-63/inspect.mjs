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
