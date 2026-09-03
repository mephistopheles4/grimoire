#!/usr/bin/env node
// fidelity.mjs — does a green file describe the program the task asked for?
//
// check.mjs proves a walk is a legal path. It cannot prove it is THE path.
// This asserts what the three task files state, and nothing else. Written from
// the task text before any run of #45. See PREREG-45.md.
//
//   node fidelity.mjs <file.json> <t1|t2|t3>
//   node fidelity.mjs <dir>                  (infers the task from the name)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- helpers

const nodesOf = (f) => f?.nodes ?? {};
const node = (f, id) => nodesOf(f)[id];
const steps = (f, id) => node(f, id)?.steps ?? [];
const stepsWhere = (f, id, fn) => steps(f, id).filter(fn);
const hasStep = (f, id, fn) => stepsWhere(f, id, fn).length > 0;

const presets = (f) => f?.presets ?? [];
const preset = (f, re) => presets(f).find((p) => re.test(p?.name ?? ""));
const moves = (p) => p?.walk?.steps ?? [];
const movesWhere = (p, fn) => moves(p).filter(fn);
const lastMove = (p) => moves(p)[moves(p).length - 1];

const fileRow = (f, path) => (f?.files ?? []).find((r) => r?.path === path);
const layer = (f, name) => f?.layers?.[name];
const renameOf = (f, layerName, id) =>
  (layer(f, layerName)?.nodes?.[id]?.R ?? []).join(" | ");

const entered = (f, id) => node(f, id)?.enteredBy ?? [];
const chanE = (f, id) => node(f, id)?.channels?.E ?? [];
const chanR = (f, id) => node(f, id)?.channels?.R ?? [];

// A call step in `caller` that targets `target`.
const callTo = (f, caller, target) =>
  stepsWhere(f, caller, (s) => s?.op === "call" && s?.target === target);

// An onError entry anywhere in `caller` catching `tag`.
const catches = (f, caller, tag) =>
  steps(f, caller)
    .flatMap((s) => s?.onError ?? [])
    .filter((h) => h?.tag === tag);

const effectStep = (f, id, kind) =>
  hasStep(f, id, (s) => s?.op === "effect" && s?.kind === kind);

const throwStep = (f, id, tag, channel) =>
  hasStep(
    f,
    id,
    (s) => s?.op === "throw" && s?.tag === tag && s?.channel === channel,
  );

// A tag a node raises out of an EFFECT has two legal shapes, and the shape
// document sanctions both: "If the real effect throws, write an `effect` move
// with `raised`. If the real effect returns a failure value that an `if`
// inspects, write the `effect` with a `next` to that `if`, and let the `if`
// route to the `throw` step."
//
// So this asserts the tag rides the right channel out of the right node —
// either declared as a throw step, or raised by one of the node's effects in
// some walk on that channel. It does NOT accept the tag on `E` alone: a node
// that names a tag it never raises has not modelled the failure.
const raisesOnChannel = (f, id, tag, channel) => {
  if (!chanE(f, id).some((t) => new RegExp(tag).test(t))) return false;
  if (throwStep(f, id, tag, channel)) return true;
  const kinds = new Set(
    stepsWhere(f, id, (s) => s?.op === "effect").map((s) => s.kind),
  );
  return presets(f).some((p) =>
    movesWhere(
      p,
      (m) =>
        m?.k === "effect" &&
        kinds.has(m?.kind) &&
        m?.raised?.tag === tag &&
        m?.raised?.channel === channel,
    ).length > 0,
  );
};

const fileRowOk = (f, path, change, adds, dels) => {
  const r = fileRow(f, path);
  return !!r && r.change === change && r.adds === adds && r.dels === dels;
};

// ---------------------------------------------------------------- rubrics
// crit: the task states it and the program is a DIFFERENT program without it.
// det:  the task states it and getting it wrong is an inaccuracy.

const C = (what, fn) => ({ weight: "crit", what, fn });
const D = (what, fn) => ({ weight: "det", what, fn });

const RUBRIC = {
  // ------------------------------------------------------------------ t1
  t1: [
    C("entry is publishPost", (f) => f.entry === "publishPost"),
    C("all three nodes exist", (f) =>
      ["publishPost", "renderHtml", "uploadHtml"].every((n) => !!node(f, n)),
    ),
    C("publishPost reads the draft with a db.get effect", (f) =>
      effectStep(f, "publishPost", "db.get"),
    ),
    C("publishPost throws EmptyDraft on escape", (f) =>
      throwStep(f, "publishPost", "EmptyDraft", "escape"),
    ),
    C("publishPost calls renderHtml", (f) =>
      callTo(f, "publishPost", "renderHtml").length > 0,
    ),
    C("publishPost calls uploadHtml", (f) =>
      callTo(f, "publishPost", "uploadHtml").length > 0,
    ),
    C("publishPost catches BadMarkdown and jumps to a fallback step", (f) => {
      const h = catches(f, "publishPost", "BadMarkdown");
      if (!h.length) return false;
      const target = h[0].goto;
      return steps(f, "publishPost").some((s) => s?.label === target);
    }),
    C("renderHtml is pure: it runs no effect", (f) =>
      !hasStep(f, "renderHtml", (s) => s?.op === "effect"),
    ),
    C("renderHtml can raise BadMarkdown", (f) =>
      chanE(f, "renderHtml").some((t) => /BadMarkdown/.test(t)),
    ),
    C("renderHtml throws BadMarkdown on die", (f) =>
      throwStep(f, "renderHtml", "BadMarkdown", "die"),
    ),
    D("renderHtml has an if for the empty body", (f) =>
      hasStep(f, "renderHtml", (s) => s?.op === "if"),
    ),
    C("uploadHtml performs the s3.put effect", (f) =>
      effectStep(f, "uploadHtml", "s3.put"),
    ),
    C("enteredBy: publishPost and renderHtml only", (f) =>
      entered(f, "publishPost").length > 0 &&
      entered(f, "renderHtml").length > 0 &&
      entered(f, "uploadHtml").length === 0,
    ),
    D("the three file rows are exact", (f) =>
      fileRowOk(f, "src/publish.ts", "edit", 40, 6) &&
      fileRowOk(f, "src/render.ts", "new", 55, 0) &&
      fileRowOk(f, "src/upload.ts", "edit", 18, 2),
    ),
    C("two layers, production and tests", (f) =>
      !!layer(f, "production") && !!layer(f, "tests"),
    ),
    C("the tests layer swaps uploadHtml's S3 client for a fake bucket", (f) =>
      /fake bucket/i.test(renameOf(f, "tests", "uploadHtml")),
    ),
    C("exactly two presets", (f) => presets(f).length === 2),
    C("the happy walk uploads on the SECOND attempt", (f) => {
      const p = preset(f, /happy/i);
      if (!p) return false;
      const puts = movesWhere(p, (m) => m?.k === "effect" && m?.kind === "s3.put");
      // Either one move marked attempt 2, or a raised first put then a second.
      return (
        puts.some((m) => m.attempt === 2) ||
        (puts.length >= 2 && !!puts[0].raised && !puts[puts.length - 1].raised)
      );
    }),
    C("the happy walk never raises BadMarkdown and ends done", (f) => {
      const p = preset(f, /happy/i);
      if (!p) return false;
      const bad = moves(p).some((m) => /BadMarkdown/.test(JSON.stringify(m)));
      return !bad && lastMove(p)?.k === "done";
    }),
    C("the bad-markdown walk is handled and still ends done", (f) => {
      const p = preset(f, /bad ?markdown|fallback/i);
      if (!p) return false;
      const handled = movesWhere(p, (m) => m?.k === "handled");
      return handled.length > 0 && lastMove(p)?.k === "done";
    }),
    C("the bad-markdown walk still uploads", (f) => {
      const p = preset(f, /bad ?markdown|fallback/i);
      return (
        !!p && movesWhere(p, (m) => m?.k === "effect" && m?.kind === "s3.put").length > 0
      );
    }),
  ],

  // ------------------------------------------------------------------ t2
  t2: [
    C("entry is checkout", (f) => f.entry === "checkout"),
    C("all four nodes exist", (f) =>
      ["checkout", "loadCart", "priceCart", "charge"].every((n) => !!node(f, n)),
    ),
    C("loadCart performs db.get", (f) => effectStep(f, "loadCart", "db.get")),
    C("loadCart raises NoCart on the escape channel", (f) =>
      raisesOnChannel(f, "loadCart", "NoCart", "escape"),
    ),
    C("priceCart is pure: it runs no effect", (f) =>
      !hasStep(f, "priceCart", (s) => s?.op === "effect"),
    ),
    C("priceCart loops: a goto back to a label, and an if that leaves", (f) => {
      const gotos = stepsWhere(f, "priceCart", (s) => s?.op === "goto");
      const labels = steps(f, "priceCart")
        .map((s) => s?.label)
        .filter(Boolean);
      return (
        gotos.length > 0 &&
        gotos.some((g) => labels.includes(g.to)) &&
        hasStep(f, "priceCart", (s) => s?.op === "if")
      );
    }),
    C("charge performs stripe.charge", (f) =>
      effectStep(f, "charge", "stripe.charge"),
    ),
    C("charge can raise CardDeclined", (f) =>
      chanE(f, "charge").some((t) => /CardDeclined/.test(t)),
    ),
    C("checkout catches CardDeclined and jumps to a declined step", (f) => {
      const h = catches(f, "checkout", "CardDeclined");
      if (!h.length) return false;
      return steps(f, "checkout").some((s) => s?.label === h[0].goto);
    }),
    C("the declined path sends mail", (f) =>
      effectStep(f, "checkout", "mail.send"),
    ),
    C("checkout has an if for the zero total", (f) =>
      hasStep(f, "checkout", (s) => s?.op === "if"),
    ),
    C('checkout can return "nothing to buy"', (f) =>
      hasStep(
        f,
        "checkout",
        (s) => s?.op === "return" && /nothing to buy/i.test(s?.expr ?? ""),
      ),
    ),
    C("checkout calls loadCart, priceCart and charge", (f) =>
      ["loadCart", "priceCart", "charge"].every(
        (t) => callTo(f, "checkout", t).length > 0,
      ),
    ),
    C("enteredBy: checkout, loadCart, priceCart — never charge", (f) =>
      entered(f, "checkout").length > 0 &&
      entered(f, "loadCart").length > 0 &&
      entered(f, "priceCart").length > 0 &&
      entered(f, "charge").length === 0,
    ),
    D("priceCart's spec file is the pricing one", (f) =>
      entered(f, "priceCart").some((p) => /pricing\.test/.test(p)),
    ),
    D("the four file rows are exact", (f) =>
      fileRowOk(f, "src/checkout.ts", "edit", 62, 11) &&
      fileRowOk(f, "src/pricing.ts", "new", 38, 0) &&
      fileRowOk(f, "src/cart-store.ts", "edit", 9, 1) &&
      fileRowOk(f, "src/payments.ts", "edit", 27, 4),
    ),
    C("three layers: production, tests, smoke", (f) =>
      ["production", "tests", "smoke"].every((n) => !!layer(f, n)),
    ),
    C("tests swaps both the Stripe client and the cart table", (f) =>
      /stub|decline/i.test(renameOf(f, "tests", "charge")) &&
      /in-memory|map/i.test(renameOf(f, "tests", "loadCart")),
    ),
    C("smoke substitutes nothing and enters at checkout", (f) => {
      const l = layer(f, "smoke");
      if (!l) return false;
      const renames = Object.keys(l.nodes ?? {}).length;
      return l.entry === "checkout" && renames === 0;
    }),
    C("exactly two presets", (f) => presets(f).length === 2),
    C("the pricing loop runs at least twice in BOTH walks", (f) =>
      presets(f).length === 2 &&
      presets(f).every((p) => movesWhere(p, (m) => m?.k === "goto").length >= 2),
    ),
    C("the paid walk charges successfully and ends done", (f) => {
      const p = preset(f, /paid|success/i);
      if (!p) return false;
      const ch = movesWhere(
        p,
        (m) => m?.k === "effect" && m?.kind === "stripe.charge",
      );
      return ch.length > 0 && !ch.some((m) => m.raised) && lastMove(p)?.k === "done";
    }),
    D("the paid walk prices at 4500", (f) => {
      const p = preset(f, /paid|success/i);
      return !!p && /4500/.test(JSON.stringify(p));
    }),
    C("the declined walk raises CardDeclined and is handled", (f) => {
      const p = preset(f, /declin/i);
      if (!p) return false;
      const raised = movesWhere(
        p,
        (m) =>
          m?.k === "effect" &&
          m?.kind === "stripe.charge" &&
          /CardDeclined/.test(JSON.stringify(m?.raised ?? "")),
      );
      return raised.length > 0 && movesWhere(p, (m) => m?.k === "handled").length > 0;
    }),
    C("the declined walk mails and ends done", (f) => {
      const p = preset(f, /declin/i);
      if (!p) return false;
      const mail = movesWhere(
        p,
        (m) => m?.k === "effect" && m?.kind === "mail.send",
      );
      return mail.length > 0 && lastMove(p)?.k === "done";
    }),
  ],

  // ------------------------------------------------------------------ t3
  t3: [
    C("entry is importContacts", (f) => f.entry === "importContacts"),
    C("all five nodes exist", (f) =>
      ["importContacts", "fetchUpload", "parseRows", "saveContact", "normalise"].every(
        (n) => !!node(f, n),
      ),
    ),
    C("the graph is three deep: saveContact calls normalise", (f) =>
      callTo(f, "importContacts", "saveContact").length > 0 &&
      callTo(f, "saveContact", "normalise").length > 0,
    ),
    C("fetchUpload performs s3.get", (f) => effectStep(f, "fetchUpload", "s3.get")),
    C("fetchUpload raises NoUpload on the escape channel", (f) =>
      raisesOnChannel(f, "fetchUpload", "NoUpload", "escape"),
    ),
    C("parseRows is pure and throws BadCsv on die", (f) =>
      !hasStep(f, "parseRows", (s) => s?.op === "effect") &&
      throwStep(f, "parseRows", "BadCsv", "die"),
    ),
    C("saveContact performs db.insert", (f) =>
      effectStep(f, "saveContact", "db.insert"),
    ),
    C("saveContact can raise Duplicate", (f) =>
      chanE(f, "saveContact").some((t) => /Duplicate/.test(t)),
    ),
    C("importContacts loops: a label, an if that leaves, a goto back", (f) => {
      const gotos = stepsWhere(f, "importContacts", (s) => s?.op === "goto");
      const labels = steps(f, "importContacts")
        .map((s) => s?.label)
        .filter(Boolean);
      return (
        gotos.some((g) => labels.includes(g.to)) &&
        hasStep(f, "importContacts", (s) => s?.op === "if")
      );
    }),
    C("importContacts catches Duplicate and jumps to a skip step", (f) => {
      const h = catches(f, "importContacts", "Duplicate");
      if (!h.length) return false;
      return steps(f, "importContacts").some((s) => s?.label === h[0].goto);
    }),
    C("importContacts writes metrics at the end", (f) =>
      effectStep(f, "importContacts", "metrics.write"),
    ),
    C("BadCsv is caught nowhere", (f) =>
      Object.keys(nodesOf(f)).every((id) => catches(f, id, "BadCsv").length === 0),
    ),
    C("enteredBy: importContacts, parseRows, normalise — never fetchUpload or saveContact", (f) =>
      entered(f, "importContacts").length > 0 &&
      entered(f, "parseRows").length > 0 &&
      entered(f, "normalise").length > 0 &&
      entered(f, "fetchUpload").length === 0 &&
      entered(f, "saveContact").length === 0,
    ),
    D("normalise's spec file is its own", (f) =>
      entered(f, "normalise").some((p) => /normalise\.test/.test(p)),
    ),
    D("the five file rows are exact", (f) =>
      fileRowOk(f, "src/import/contacts.ts", "edit", 88, 12) &&
      fileRowOk(f, "src/import/parse.ts", "new", 41, 0) &&
      fileRowOk(f, "src/import/fetch.ts", "new", 19, 0) &&
      fileRowOk(f, "src/contacts/save.ts", "edit", 33, 7) &&
      fileRowOk(f, "src/contacts/normalise.ts", "edit", 14, 2),
    ),
    C("two layers, and tests enters at importContacts", (f) =>
      !!layer(f, "production") && layer(f, "tests")?.entry === "importContacts",
    ),
    C("tests swaps both the S3 client and the contacts table", (f) =>
      /fixture/i.test(renameOf(f, "tests", "fetchUpload")) &&
      /in-memory|list/i.test(renameOf(f, "tests", "saveContact")),
    ),
    C("exactly three presets", (f) => presets(f).length === 3),
    C("the duplicate walk loops twice and skips one row", (f) => {
      const p = preset(f, /duplicate|two rows/i);
      if (!p) return false;
      return (
        movesWhere(p, (m) => m?.k === "goto").length >= 2 &&
        movesWhere(p, (m) => m?.k === "handled").length > 0
      );
    }),
    C("the duplicate walk writes metrics and ends done", (f) => {
      const p = preset(f, /duplicate|two rows/i);
      if (!p) return false;
      return (
        movesWhere(p, (m) => m?.k === "effect" && m?.kind === "metrics.write").length >
          0 && lastMove(p)?.k === "done"
      );
    }),
    C("the bad-header walk ends uncaught with BadCsv", (f) => {
      const p = preset(f, /bad ?header|bad ?csv/i);
      const last = p && lastMove(p);
      return !!last && last.k === "uncaught" && /BadCsv/.test(last.tag ?? "");
    }),
    C("the no-upload walk raises NoUpload from the effect", (f) => {
      const p = preset(f, /no ?upload|missing/i);
      if (!p) return false;
      return movesWhere(
        p,
        (m) =>
          m?.k === "effect" &&
          m?.kind === "s3.get" &&
          /NoUpload/.test(JSON.stringify(m?.raised ?? "")),
      ).length > 0;
    }),
    C("the no-upload walk ends uncaught with NoUpload", (f) => {
      const p = preset(f, /no ?upload|missing/i);
      const last = p && lastMove(p);
      return !!last && last.k === "uncaught" && /NoUpload/.test(last.tag ?? "");
    }),
  ],
};

// ---------------------------------------------------------------- scoring

export function score(file, task) {
  const rubric = RUBRIC[task];
  if (!rubric) throw new Error(`no rubric for task ${task}`);
  const misses = [];
  for (const claim of rubric) {
    let ok = false;
    try {
      ok = !!claim.fn(file);
    } catch {
      ok = false;
    }
    if (!ok) misses.push(claim);
  }
  return {
    total: rubric.length,
    crit: rubric.filter((c) => c.weight === "crit").length,
    misses,
    critMisses: misses.filter((m) => m.weight === "crit"),
  };
}

const taskOf = (name) => {
  const m = name.match(/t([123])[-.]/) ?? name.match(/\bt([123])\b/);
  return m ? `t${m[1]}` : undefined;
};

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [target, taskArg] = args;
  if (!target) {
    console.error("usage: node fidelity.mjs <file.json|dir> [t1|t2|t3]");
    process.exit(2);
  }
  const detail = process.argv.includes("--detail");
  const isDir = statSync(target).isDirectory();
  const files = isDir
    ? readdirSync(target)
        .filter((n) => n.endsWith(".json"))
        .map((n) => join(target, n))
    : [target];

  let cleanCount = 0;
  const rows = [];
  for (const path of files) {
    const name = basename(path);
    const task = taskArg ?? taskOf(name) ?? taskOf(basename(target));
    if (!task) {
      rows.push([name, "?", "no task inferred", []]);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      rows.push([name, task, `unparseable: ${e.message}`, []]);
      continue;
    }
    const s = score(parsed, task);
    if (s.critMisses.length === 0) cleanCount++;
    rows.push([
      name,
      task,
      `${s.total - s.misses.length}/${s.total} claims, ${s.critMisses.length} critical miss${
        s.critMisses.length === 1 ? "" : "es"
      }`,
      s.misses,
    ]);
  }

  const w = Math.max(...rows.map((r) => r[0].length), 4);
  console.log(`${"FILE".padEnd(w)}  TASK  FIDELITY`);
  for (const [name, task, summary, misses] of rows) {
    console.log(`${name.padEnd(w)}  ${String(task).padEnd(4)}  ${summary}`);
    if (detail) {
      for (const m of misses) {
        console.log(`${" ".repeat(w + 8)}${m.weight === "crit" ? "!" : "·"} ${m.what}`);
      }
    }
  }
  console.log(
    `\n${cleanCount}/${rows.length} files carry zero critical fidelity misses`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
