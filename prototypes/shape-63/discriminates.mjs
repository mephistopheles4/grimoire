#!/usr/bin/env node
// discriminates.mjs — does the new task actually exercise the change-wide
// unaccounted-files finding, or would a per-graph reading say the same thing?
//
// #58's evidence for the container change is that "no node accounts for this
// file" was true of one graph and silent about the rest, so two files gave a
// reader two answers that did not add up. Task 4 is only a test of that if the
// two readings differ on it. This prints both, so the claim is measured rather
// than asserted.
//
//   node discriminates.mjs baseline/t4.flightpath.json

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "baseline/t4.flightpath.json";
const f = JSON.parse(readFileSync(path, "utf8"));

const reach = (entry) => {
  const seen = new Set();
  const walk = (id) => {
    if (!id || seen.has(id) || !f.nodes[id]) return;
    seen.add(id);
    for (const s of f.nodes[id].steps ?? []) if (s.op === "call") walk(s.target);
  };
  walk(entry);
  return seen;
};

const unaccounted = (ids) => {
  const touched = new Set();
  for (const id of ids) for (const p of f.nodes[id].touches ?? []) touched.add(p);
  return (f.files ?? []).filter((r) => !touched.has(r.path)).map((r) => r.path);
};

console.log(`${path}\n`);
for (const g of f.graphs) {
  const missing = unaccounted(reach(g.entry));
  console.log(
    `  per-graph reading, sheet "${g.id}": ${
      missing.length ? missing.join(", ") : "nothing unaccounted"
    }`,
  );
}
const all = unaccounted(Object.keys(f.nodes));
console.log(
  `  change-wide reading: ${all.length ? all.join(", ") : "nothing unaccounted"}`,
);
