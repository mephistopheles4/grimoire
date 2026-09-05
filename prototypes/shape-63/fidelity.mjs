#!/usr/bin/env node
// fidelity.mjs — does a green file describe the program the task asked for?
//
// The validator proves a walk is a legal path. It cannot prove it is THE path.
// This asserts what the four task files state, and nothing else.
//
// Round five's rubric, carried onto the #61 shape. The t1, t2 and t3 claims say
// what they said in round five; only the readers underneath them changed, because
// `entry` and `presets` moved into `graphs`. The t4 rubric is new and was written
// from `task-4-catalog.md` before any run of this round. See PREREG-63.md.
//
//   node fidelity.mjs <file.json> <t1|t2|t3|t4>
//   node fidelity.mjs <dir>                     (infers the task from the name)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- helpers

const nodesOf = (f) => f?.nodes ?? {};
const node = (f, id) => nodesOf(f)[id];
const steps = (f, id) => node(f, id)?.steps ?? [];
const stepsWhere = (f, id, fn) => steps(f, id).filter(fn);
const hasStep = (f, id, fn) => stepsWhere(f, id, fn).length > 0;

/* The one migration under every claim below. A change's runs are no longer at
 * the top level; they hang off the graphs. `presets` still means "every run in
 * this file", so a claim about a run reads the same as it did in round five,
 * and `graphs` is what a claim about a sheet reads. */
const graphs = (f) => f?.graphs ?? [];
const presets = (f) => graphs(f).flatMap((g) => g?.presets ?? []);
const graphAt = (f, entry) => graphs(f).find((g) => g?.entry === entry);
const entries = (f) => graphs(f).map((g) => g?.entry);

const preset = (f, re) => presets(f).find((p) => re.test(p?.name ?? ""));
const presetIn = (g, re) => (g?.presets ?? []).find((p) => re.test(p?.name ?? ""));
const moves = (p) => p?.walk?.steps ?? [];
const movesWhere = (p, fn) => moves(p).filter(fn);
const lastMove = (p) => moves(p)[moves(p).length - 1];

const fileRow = (f, path) => (f?.files ?? []).find((r) => r?.path === path);
const layer = (f, name) => f?.layers?.[name];
const renameOf = (f, layerName, id) =>
  (layer(f, layerName)?.nodes?.[id]?.R ?? []).join(" | ");

const entered = (f, id) => node(f, id)?.enteredBy ?? [];
const chanE = (f, id) => node(f, id)?.channels?.E ?? [];

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

/* "The node can return this value."
 *
 * CORRECTED AFTER THE ROUND RAN, and the correction is to the claim's own
 * words rather than to the bar. See RESULTS-63.md, which prints the score
 * under both readers.
 *
 * The first cut read only a `return` step's `expr`. All three t2 runs wrote
 * the value the way the task words it — "jumps to a labelled `empty` step and
 * returns" — as a `let` on the labelled step binding the literal, and a
 * `return` of that name. A critical claim is defined at the head of the rubric
 * section below — "the task states it and the program is a DIFFERENT program
 * without it", carried from round five — and `let result = "nothing to buy";
 * return result` is not a different program from `return "nothing to buy"`.
 * The reader was narrower than the claim it implements.
 *
 * So: the value may be returned directly, or bound by a `let` whose name a
 * `return` then returns. Round five's precedent is the same move — an
 * instrument corrected to the rule as written, with both numbers reported. */
const returnsValue = (f, id, re) => {
  if (hasStep(f, id, (s) => s?.op === "return" && re.test(s?.expr ?? ""))) return true;
  const bound = stepsWhere(
    f,
    id,
    (s) => s?.op === "let" && re.test(s?.expr ?? ""),
  ).map((s) => s.name);
  return bound.some((n) =>
    hasStep(f, id, (s) => s?.op === "return" && (s?.expr ?? "").trim() === n),
  );
};

/* A loop, as t2, t3 and t4 all word it: a labelled step at the top, a goto back
 * to that label, and an if that leaves. */
const loopsBack = (f, id) => {
  const gotos = stepsWhere(f, id, (s) => s?.op === "goto");
  const labels = steps(f, id)
    .map((s) => s?.label)
    .filter(Boolean);
  return (
    gotos.some((g) => labels.includes(g.to)) &&
    hasStep(f, id, (s) => s?.op === "if")
  );
};

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
  return presets(f).some(
    (p) =>
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

/* Reachability through call edges, the same relation the page draws a sheet
 * from. Written here rather than imported so the rubric can score a file the
 * validator has already refused. */
export function reachable(f, entry) {
  const seen = new Set();
  const walk = (id) => {
    if (!id || seen.has(id) || !node(f, id)) return;
    seen.add(id);
    for (const s of steps(f, id)) if (s?.op === "call") walk(s.target);
  };
  walk(entry);
  return seen;
}

/* Every node id whose node touches `path`. The change-wide reading: a file one
 * graph covers is covered, whatever the other graphs do. */
const touchers = (f, path) =>
  Object.entries(nodesOf(f))
    .filter(([, n]) => (n?.touches ?? []).includes(path))
    .map(([id]) => id);

// ---------------------------------------------------------------- rubrics
// crit: the task states it and the program is a DIFFERENT program without it.
// det:  the task states it and getting it wrong is an inaccuracy.

const C = (what, fn) => ({ weight: "crit", what, fn });
const D = (what, fn) => ({ weight: "det", what, fn });

const RUBRIC = {
  // ------------------------------------------------------------------ t1
  t1: [
    C("one graph, entered at publishPost", (f) =>
      graphs(f).length === 1 && entries(f)[0] === "publishPost",
    ),
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
        !!p &&
        movesWhere(p, (m) => m?.k === "effect" && m?.kind === "s3.put").length > 0
      );
    }),
  ],

  // ------------------------------------------------------------------ t2
  t2: [
    C("one graph, entered at checkout", (f) =>
      graphs(f).length === 1 && entries(f)[0] === "checkout",
    ),
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
    C("priceCart loops: a goto back to a label, and an if that leaves", (f) =>
      loopsBack(f, "priceCart"),
    ),
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
    C("the declined path sends mail", (f) => effectStep(f, "checkout", "mail.send")),
    C("checkout has an if for the zero total", (f) =>
      hasStep(f, "checkout", (s) => s?.op === "if"),
    ),
    C('checkout can return "nothing to buy"', (f) =>
      returnsValue(f, "checkout", /nothing to buy/i),
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
      const mail = movesWhere(p, (m) => m?.k === "effect" && m?.kind === "mail.send");
      return mail.length > 0 && lastMove(p)?.k === "done";
    }),
  ],

  // ------------------------------------------------------------------ t3
  t3: [
    C("one graph, entered at importContacts", (f) =>
      graphs(f).length === 1 && entries(f)[0] === "importContacts",
    ),
    C("all five nodes exist", (f) =>
      [
        "importContacts",
        "fetchUpload",
        "parseRows",
        "saveContact",
        "normalise",
      ].every((n) => !!node(f, n)),
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
    C("importContacts loops: a label, an if that leaves, a goto back", (f) =>
      loopsBack(f, "importContacts"),
    ),
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
    C(
      "enteredBy: importContacts, parseRows, normalise — never fetchUpload or saveContact",
      (f) =>
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
        movesWhere(p, (m) => m?.k === "effect" && m?.kind === "metrics.write")
          .length > 0 && lastMove(p)?.k === "done"
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
      return (
        movesWhere(
          p,
          (m) =>
            m?.k === "effect" &&
            m?.kind === "s3.get" &&
            /NoUpload/.test(JSON.stringify(m?.raised ?? "")),
        ).length > 0
      );
    }),
    C("the no-upload walk ends uncaught with NoUpload", (f) => {
      const p = preset(f, /no ?upload|missing/i);
      const last = p && lastMove(p);
      return !!last && last.k === "uncaught" && /NoUpload/.test(last.tag ?? "");
    }),
  ],

  // ------------------------------------------------------------------ t4
  //
  // New this round, and written from `task-4-catalog.md` before the first run.
  // Three of these claims are the ones #63 names by hand: the shared symbol is
  // defined once, both entries reach it, and no file goes unaccounted. They are
  // also computed separately in `loop-report.mjs`, from the shipped validator's
  // own findings, so the answer does not rest on this file alone.
  t4: [
    C("exactly two graphs", (f) => graphs(f).length === 2),
    C("one graph enters at renderCatalog and one at applyFilters", (f) =>
      !!graphAt(f, "renderCatalog") && !!graphAt(f, "applyFilters"),
    ),
    C("all five nodes exist", (f) =>
      [
        "renderCatalog",
        "renderGrid",
        "applyFilters",
        "parseQuery",
        "formatPrice",
      ].every((n) => !!node(f, n)),
    ),
    C("formatPrice is ONE node — no per-graph copy of it", (f) => {
      const money = Object.entries(nodesOf(f)).filter(
        ([id, n]) =>
          /format.?price/i.test(id) || /format.?price/i.test(n?.name ?? ""),
      );
      return money.length === 1;
    }),
    C("both entries reach formatPrice through call edges", (f) =>
      reachable(f, "renderCatalog").has("formatPrice") &&
      reachable(f, "applyFilters").has("formatPrice"),
    ),
    C("formatPrice is pure: it runs no effect", (f) =>
      !hasStep(f, "formatPrice", (s) => s?.op === "effect"),
    ),
    C("renderCatalog performs db.query", (f) =>
      effectStep(f, "renderCatalog", "db.query"),
    ),
    C("renderCatalog raises NoPage on the escape channel", (f) =>
      raisesOnChannel(f, "renderCatalog", "NoPage", "escape"),
    ),
    C("renderCatalog loops: a label, an if that leaves, a goto back", (f) =>
      loopsBack(f, "renderCatalog"),
    ),
    C("renderCatalog calls renderGrid", (f) =>
      callTo(f, "renderCatalog", "renderGrid").length > 0,
    ),
    C("renderGrid is pure: it runs no effect", (f) =>
      !hasStep(f, "renderGrid", (s) => s?.op === "effect"),
    ),
    C("applyFilters calls parseQuery", (f) =>
      callTo(f, "applyFilters", "parseQuery").length > 0,
    ),
    C("parseQuery is pure and throws BadQuery on die", (f) =>
      !hasStep(f, "parseQuery", (s) => s?.op === "effect") &&
      throwStep(f, "parseQuery", "BadQuery", "die"),
    ),
    C("applyFilters performs api.get", (f) => effectStep(f, "applyFilters", "api.get")),
    C("applyFilters catches Timeout and jumps to a stale step", (f) => {
      const h = catches(f, "applyFilters", "Timeout");
      if (!h.length) return false;
      return steps(f, "applyFilters").some((s) => s?.label === h[0].goto);
    }),
    C("applyFilters loops: a label, an if that leaves, a goto back", (f) =>
      loopsBack(f, "applyFilters"),
    ),
    C("applyFilters performs dom.patch", (f) =>
      effectStep(f, "applyFilters", "dom.patch"),
    ),
    C("BadQuery is caught nowhere", (f) =>
      Object.keys(nodesOf(f)).every((id) => catches(f, id, "BadQuery").length === 0),
    ),
    C("every file in the change is touched by some node", (f) =>
      (f?.files ?? []).length > 0 &&
      (f?.files ?? []).every((r) => touchers(f, r.path).length > 0),
    ),
    C("the filter-only files are touched only by filter-side nodes", (f) => {
      /* The discriminator. Read per graph, `src/filters/parse.ts` is
       * unaccounted on the catalogue sheet; read across the change it is
       * accounted for. This claim pins the arrangement that makes the two
       * readings differ. */
      const catalogSide = reachable(f, "renderCatalog");
      const t = touchers(f, "src/filters/parse.ts");
      return t.length > 0 && t.every((id) => !catalogSide.has(id));
    }),
    C("formatPrice's file is touched by formatPrice", (f) =>
      touchers(f, "src/money/format.ts").includes("formatPrice"),
    ),
    C(
      "enteredBy: renderCatalog, parseQuery, formatPrice — never renderGrid or applyFilters",
      (f) =>
        entered(f, "renderCatalog").length > 0 &&
        entered(f, "parseQuery").length > 0 &&
        entered(f, "formatPrice").length > 0 &&
        entered(f, "renderGrid").length === 0 &&
        entered(f, "applyFilters").length === 0,
    ),
    D("the five file rows are exact", (f) =>
      fileRowOk(f, "src/catalog/render.ts", "edit", 47, 8) &&
      fileRowOk(f, "src/catalog/grid.ts", "new", 31, 0) &&
      fileRowOk(f, "src/filters/apply.ts", "edit", 52, 15) &&
      fileRowOk(f, "src/filters/parse.ts", "new", 24, 0) &&
      fileRowOk(f, "src/money/format.ts", "new", 18, 0),
    ),
    C("two layers, production and tests", (f) =>
      !!layer(f, "production") && !!layer(f, "tests"),
    ),
    C("tests swaps both the products table and the search API", (f) =>
      /seeded|fixture/i.test(renameOf(f, "tests", "renderCatalog")) &&
      /canned|response/i.test(renameOf(f, "tests", "applyFilters")),
    ),
    C("three presets in all: one on the catalogue graph, two on the filter one", (f) =>
      (graphAt(f, "renderCatalog")?.presets ?? []).length === 1 &&
      (graphAt(f, "applyFilters")?.presets ?? []).length === 2,
    ),
    C("both graphs carry a run called the happy path", (f) =>
      !!presetIn(graphAt(f, "renderCatalog"), /happy/i) &&
      !!presetIn(graphAt(f, "applyFilters"), /happy/i),
    ),
    C("the catalogue walk formats two prices and ends done", (f) => {
      const p = presetIn(graphAt(f, "renderCatalog"), /happy/i);
      if (!p) return false;
      const calls = movesWhere(p, (m) => m?.k === "call" && m?.to === "formatPrice");
      return calls.length >= 2 && lastMove(p)?.k === "done";
    }),
    C("the filter happy walk formats two prices, patches the DOM and ends done", (f) => {
      const p = presetIn(graphAt(f, "applyFilters"), /happy/i);
      if (!p) return false;
      const calls = movesWhere(p, (m) => m?.k === "call" && m?.to === "formatPrice");
      const patch = movesWhere(
        p,
        (m) => m?.k === "effect" && m?.kind === "dom.patch",
      );
      return calls.length >= 2 && patch.length > 0 && lastMove(p)?.k === "done";
    }),
    C("the bad-query walk ends uncaught with BadQuery", (f) => {
      const p = presetIn(graphAt(f, "applyFilters"), /bad ?query/i);
      const last = p && lastMove(p);
      return !!last && last.k === "uncaught" && /BadQuery/.test(last.tag ?? "");
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

export const taskOf = (name) => {
  const m = name.match(/t([1-4])[-.]/) ?? name.match(/\bt([1-4])\b/);
  return m ? `t${m[1]}` : undefined;
};

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [target, taskArg] = args;
  if (!target) {
    console.error("usage: node fidelity.mjs <file.json|dir> [t1|t2|t3|t4]");
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
      `${s.total - s.misses.length}/${s.total} claims, ${
        s.critMisses.length
      } critical miss${s.critMisses.length === 1 ? "" : "es"}`,
      s.misses,
    ]);
  }

  const w = Math.max(...rows.map((r) => r[0].length), 4);
  console.log(`${"FILE".padEnd(w)}  TASK  FIDELITY`);
  for (const [name, task, summary, misses] of rows) {
    console.log(`${name.padEnd(w)}  ${String(task).padEnd(4)}  ${summary}`);
    if (detail) {
      for (const m of misses) {
        console.log(
          `${" ".repeat(w + 8)}${m.weight === "crit" ? "!" : "·"} ${m.what}`,
        );
      }
    }
  }
  console.log(
    `\n${cleanCount}/${rows.length} files carry zero critical fidelity misses`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
