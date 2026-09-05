#!/usr/bin/env node
// cost.mjs — what the new shape costs an author, as three numbers.
//
// #63 asks for these reported and NOT gated: the word count of the shape
// document, the number of required fields, and the number of refusal kinds,
// before and after. The method is fixed here, before the numbers are read, so
// a number cannot be chosen by choosing how to count it.
//
//   before = `main`, the shipped one-graph shape
//   after  = this branch, which carries #61
//
//   node cost.mjs
//
// THE THREE METHODS
//
// 1. WORDS. Whitespace-separated tokens in `references/flightpath-file.md`.
//    Fenced code blocks are counted too: an author reads the JSON as much as
//    the prose, and stripping it would flatter whichever version has more.
//
// 2. REQUIRED FIELDS. Every key the validator demands, summed over every
//    object kind in the shape. It is read from the validator, not the prose,
//    because `keys(r, where, obj, req, opt)` IS the list of required keys and
//    the prose is a description of it. A field required on two different object
//    kinds counts twice, because an author writes it twice — and the eight step
//    ops and twelve move kinds are twelve and eight object kinds, not two,
//    because an author writing a `call` step writes `op` and `target` and
//    nothing else.
//
// 3. REFUSAL KINDS. Call sites that can push a refusal: `r.shape(`, `r.walk(`
//    and the walk helper `bad(`. One call site is one thing the file can be
//    refused for. Both versions use the same three helpers, so the count is
//    comparable; `keys()` itself is one call site and yields two messages, and
//    it is counted once on both sides.

import { execFileSync } from "node:child_process";

const DOC = "skills/groundtrack/references/flightpath-file.md";
const VALIDATOR = "skills/groundtrack/scripts/render.mjs";

const show = (rev, path) =>
  execFileSync("git", ["show", `${rev}:${path}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

const words = (s) => s.split(/\s+/).filter(Boolean).length;

const namesIn = (s) =>
  [...s.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);

/* The validator names its required keys three ways: a top-level constant
 * (`CORE`, `NODE`, `GRAPH`, …), an inline literal, and a spread of one row of
 * the `STEP` or `MOVE` table. All three are resolved here, so the total is the
 * validator's own answer and not a reading of it. */
function requiredFields(src) {
  const consts = {};
  for (const m of src.matchAll(/^const ([A-Z_]+) = \[([^\]]*)\];/gm)) {
    consts[m[1]] = namesIn(m[2]);
  }
  const tableRows = (name) => {
    const block = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`));
    if (!block) return [];
    return [...block[1].matchAll(/(\w+):\s*\{\s*req:\s*\[([^\]]*)\]/g)].map((m) => ({
      kind: m[1],
      req: namesIn(m[2]),
    }));
  };
  const STEP = tableRows("STEP");
  const MOVE = tableRows("MOVE");

  const rows = [];
  /* `keys(r, <where>, <obj>, <req>, <opt>?)`. The `where` argument is a
   * template literal that may itself contain a bracket, so the arguments are
   * split rather than matched: take everything after the third comma at depth
   * zero, up to the matching close paren. */
  for (const m of src.matchAll(/\bkeys\(r,/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let i = open + 1;
    const args = [""];
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      if (depth === 0) break;
      if (c === "," && depth === 1) args.push("");
      else args[args.length - 1] += c;
    }
    const req = (args[2] ?? "").trim();
    if (!req) continue;

    if (/^[A-Z_]+$/.test(req)) {
      rows.push({ where: args[0].trim(), req: consts[req] ?? [] });
    } else if (/\.\.\.req\b/.test(req)) {
      /* one step object kind per op */
      const fixed = namesIn(req);
      for (const s of STEP) rows.push({ where: `step (${s.kind})`, req: [...fixed, ...s.req] });
    } else if (/MOVE\[/.test(req)) {
      /* one move object kind per move kind */
      const fixed = namesIn(req);
      for (const s of MOVE) rows.push({ where: `move (${s.kind})`, req: [...fixed, ...s.req] });
    } else {
      rows.push({ where: args[0].trim(), req: namesIn(req) });
    }
  }
  return {
    total: rows.reduce((n, r) => n + r.req.length, 0),
    sites: rows.length,
    rows,
  };
}

const refusalKinds = (src) =>
  (src.match(/\br\.shape\(/g) ?? []).length +
  (src.match(/\br\.walk\(/g) ?? []).length +
  (src.match(/(?<![.\w])bad\(/g) ?? []).length -
  /* the two helper definitions inside `refusals()` are not call sites */
  0;

function measure(rev) {
  const doc = show(rev, DOC);
  const val = show(rev, VALIDATOR);
  const req = requiredFields(val);
  return {
    rev,
    words: words(doc),
    lines: doc.split("\n").length,
    requiredFields: req.total,
    objectKinds: req.sites,
    refusalKinds: refusalKinds(val),
  };
}

const before = measure("main");
const after = measure("HEAD");

const delta = (a, b) => {
  const d = b - a;
  const pct = a === 0 ? "—" : `${d >= 0 ? "+" : ""}${Math.round((d / a) * 100)}%`;
  return `${d >= 0 ? "+" : ""}${d} (${pct})`;
};

const row = (label, key) =>
  `| ${label} | ${before[key]} | ${after[key]} | ${delta(before[key], after[key])} |`;

console.log(`before = main, after = HEAD (${
  execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
})\n`);
console.log("| Measure | Before | After | Change |");
console.log("| --- | --- | --- | --- |");
console.log(row("Words in the shape document", "words"));
console.log(row("Lines in the shape document", "lines"));
console.log(row("Required fields, over every object kind", "requiredFields"));
console.log(row("Object kinds the validator shape-checks", "objectKinds"));
console.log(row("Refusal kinds", "refusalKinds"));
