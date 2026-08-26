#!/usr/bin/env node
// eagle-eye renderer. Zero dependencies. Box file in, one self-contained HTML page out.
//
//   node render.mjs <box.json> [--out <page.html>] [--check] [--sel <restore code>]
//
//   --check   validate and print the findings for the chosen set; write nothing
//   --sel     print the findings for a configuration ("eagle-eye: opt-id, opt-id"), write nothing
//
// Validation is hand-rolled (no ajv): the checks below ARE the schema. box.schema.json documents the same shape.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EagleEye = require(resolve(here, 'lib/eagle-eye.js'));

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? true) : undefined; };
const boxPath = args.find(a => !a.startsWith('--') && !['--out', '--sel'].includes(args[args.indexOf(a) - 1]));
if (!boxPath) { console.error('usage: node render.mjs <box.json> [--out page.html] [--check] [--sel "eagle-eye: ids"]'); process.exit(2); }

const TIERS = new Set(['measured', 'sourced', 'argued']);
const KINDS = new Set(['conf', 'req']);
const ID = /^[a-z0-9][a-z0-9-]*$/;

function validate(box) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (!box || typeof box !== 'object') return { errors: ['box is not an object'], warnings };
  if (typeof box.title !== 'string' || !box.title.trim()) err('title: required, non-empty string');
  if (!Array.isArray(box.dims) || !box.dims.length) err('dims: required, non-empty array');
  if (!box.rel || typeof box.rel !== 'object') err('rel: required object keyed by option id');
  if (errors.length) return { errors, warnings };

  const dimIds = new Set(), optIds = new Map();
  box.dims.forEach((d, i) => {
    const at = `dims[${i}]`;
    if (!ID.test(d.id || '')) err(`${at}.id: must match ${ID}`);
    if (dimIds.has(d.id)) err(`${at}.id "${d.id}": duplicate`); dimIds.add(d.id);
    if (typeof d.name !== 'string' || !d.name.trim()) err(`${at}.name: required`);
    // A row name is a handle, not an explanation: "Reachable by whom" tells a newcomer nothing.
    // `problem` is the only part of a row no derivation can supply, so its absence is warned, loudly.
    if (d.problem !== undefined && (typeof d.problem !== 'string' || !d.problem.trim())) err(`${at}.problem: must be a non-empty string`);
    else if (!d.problem) warn(`${at} "${d.name}": no problem — say in plain words what this row decides, for a reader outside the domain.`);
    else if (d.problem.split(/\s+/).length < 25) warn(`${at} "${d.name}": problem is ${d.problem.split(/\s+/).length} words. Two to five sentences give a newcomer the stakes.`);
    if (!Array.isArray(d.opts) || d.opts.length < 2) err(`${at}.opts: at least two options`);
    else {
      const chosen = d.opts.filter(o => o.chosen);
      if (chosen.length !== 1) err(`${at} "${d.name}": exactly one option must be chosen (found ${chosen.length})`);
      d.opts.forEach((o, j) => {
        const oat = `${at}.opts[${j}]`;
        if (!ID.test(o.id || '')) err(`${oat}.id: must match ${ID}`);
        if (optIds.has(o.id)) err(`${oat}.id "${o.id}": duplicate`); optIds.set(o.id, d.id);
        if (typeof o.label !== 'string' || !o.label.trim()) err(`${oat}.label: required`);
        if (o.short && o.short.length > 28) warn(`${oat}.short "${o.short}": longer than 28 chars; the sheet cell will wrap`);
        if (!o.short && o.label.length > 28) warn(`${oat} "${o.id}": no short label and label is ${o.label.length} chars; add "short" for the sheet`);
        if (o.strawman && o.chosen) err(`${oat} "${o.id}": a strawman cannot be the chosen option`);
        if (!o.strawman && !o.src) warn(`${oat} "${o.id}": no src — where was this option proposed?`);
      });
      if (!d.opts.some(o => o.strawman)) warn(`${at} "${d.name}": no strawman. Did you ask: none / opposite / later / by hand?`);
    }
  });

  let edgeCount = 0, argued = 0;
  Object.entries(box.rel).forEach(([id, r]) => {
    if (!optIds.has(id)) { err(`rel["${id}"]: no such option`); return; }
    if (typeof r.why !== 'string' || !r.why.trim()) err(`rel["${id}"].why: required — what this option is and why it was on the table`);
    if (r.notes && !Array.isArray(r.notes)) err(`rel["${id}"].notes: must be an array of strings`);
    (r.rel || []).forEach((e, k) => {
      const at = `rel["${id}"].rel[${k}]`;
      if (!Array.isArray(e) || e.length < 3) { err(`${at}: must be [targetId, "conf"|"req", why, tier?, src?]`); return; }
      const [to, kind, why, tier = 'argued', src] = e;
      if (!optIds.has(to)) err(`${at}: target "${to}" is not an option`);
      else if (optIds.get(to) === optIds.get(id)) err(`${at}: target "${to}" is in the same row — a swap, not an edge`);
      if (!KINDS.has(kind)) err(`${at}: kind "${kind}" must be conf or req`);
      if (typeof why !== 'string' || !why.trim()) err(`${at}: why is required — an edge without a reason colours the grid on nothing`);
      else if (why.split(/\s+/).length > 25) warn(`${at}: why is ${why.split(/\s+/).length} words; STE asks for 20`);
      if (!TIERS.has(tier)) err(`${at}: tier "${tier}" must be measured, sourced or argued`);
      if (tier !== 'argued' && !src) err(`${at}: a ${tier} edge must name its src (what was measured, which document)`);
      edgeCount++; if (tier === 'argued') argued++;
    });
  });
  optIds.forEach((dimId, id) => { if (!box.rel[id]) warn(`option "${id}": no rel entry — no why, no edges`); });
  if (box.suspected && !Array.isArray(box.suspected)) err('suspected: must be an array of strings');

  // Presets are required. A box nobody can walk is a grid nobody reads: the reader opens the page,
  // sees the chosen set, and has no idea which other configuration is worth looking at. At least one
  // preset must *change* an option, so the reader meets a second configuration rather than one tour
  // of the baseline. See SKILL.md, "Presets".
  if (!Array.isArray(box.presets)) err('presets: required — at least two, and at least one must change an option (see SKILL.md, "Presets")');
  else {
    if (box.presets.length < 2) err(`presets: at least two required (found ${box.presets.length}). Suggested set: a baseline walk, then a stress preset — the break test, the strawman run, the cheap route or the strict route. See SKILL.md, "Presets".`);
    box.presets.forEach((p, i) => {
      if (!p.title) err(`presets[${i}].title: required`);
      if (!Array.isArray(p.steps) || !p.steps.length) err(`presets[${i}].steps: required`);
      else p.steps.forEach((s, j) => {
        if (!s.label) err(`presets[${i}].steps[${j}].label: required`);
        if (s.set) Object.entries(s.set).forEach(([d, o]) => { if (!dimIds.has(d)) err(`presets[${i}].steps[${j}].set: no dim "${d}"`); else if (optIds.get(o) !== d) err(`presets[${i}].steps[${j}].set: "${o}" is not an option of "${d}"`); });
        if (s.open && !dimIds.has(s.open)) err(`presets[${i}].steps[${j}].open: no dim "${s.open}"`);
      });
      if (!p.text) warn(`presets[${i}] "${p.title}": no text — say in one sentence what this configuration shows.`);
    });
    if (!box.presets.some(p => (p.steps || []).some(s => s.set && Object.keys(s.set).length)))
      err('presets: every preset only walks the chosen set. At least one must carry a "set" step, so the reader meets a configuration that is not the baseline.');
  }
  return { errors, warnings, stats: { dims: box.dims.length, opts: optIds.size, edges: edgeCount, argued, strawmen: box.dims.reduce((n, d) => n + d.opts.filter(o => o.strawman).length, 0) } };
}

function findings(box, code) {
  const { chosenOf, optById } = EagleEye.index(box);
  const sel = { ...chosenOf }, touched = new Set();
  if (code) code.replace(/^\s*eagle-eye:\s*/i, '').split(',').map(s => s.trim()).filter(s => s && s !== 'none').forEach(id => {
    if (!optById[id]) throw new Error(`--sel: unknown option "${id}"`);
    sel[optById[id].dim.id] = id; touched.add(optById[id].dim.id);
  });
  const r = EagleEye.analyse(box, sel, touched), strip = s => s.replace(/<[^>]+>/g, '');
  const L = [`verdict: ${r.verdict}` + (r.overrides.length ? ` (${r.overrides.length} change${r.overrides.length === 1 ? '' : 's'}; active edges ${r.basis.map(([t, n]) => `${n} ${t}`).join(', ')})` : '')];
  r.conflicts.forEach(e => L.push(`  conflict: ${optById[e.from].dim.name}: ${optById[e.from].short || optById[e.from].label} vs ${optById[e.to].dim.name}: ${optById[e.to].short || optById[e.to].label} — ${e.why} [${e.tier}]`));
  r.unmet.forEach(e => L.push(`  not met: ${optById[e.from].dim.name} requires ${optById[e.to].dim.name}: ${optById[e.to].short || optById[e.to].label} — ${e.why} [${e.tier}]`));
  // "row not opened" measures a reader clicking rows on the page. The command line has no such act:
  // `touched` here only ever holds the rows --sel changed, so the finding fires on every configuration
  // and tells you to do a thing this surface cannot do. Drop it here; the page still reports it.
  r.moves.filter(m => m.kind !== 'row not opened').forEach(m => L.push(`  ${m.kind}: ${strip(m.text)}`));
  return L.join('\n');
}

// ---- main ----
let box;
try { box = JSON.parse(readFileSync(boxPath, 'utf8')); } catch (e) { console.error(`cannot read ${boxPath}: ${e.message}`); process.exit(2); }
const { errors, warnings, stats } = validate(box);
warnings.forEach(w => console.error(`warning: ${w}`));
if (errors.length) { errors.forEach(e => console.error(`error: ${e}`)); process.exit(1); }
console.error(`ok: ${box.title} — ${stats.dims} decisions, ${stats.opts} options, ${stats.edges} edges (${stats.argued} argued), ${stats.strawmen} strawmen`);

if (flag('--check') || flag('--sel') !== undefined) {
  console.log(findings(box, flag('--sel')));
  process.exit(0);
}

const template = readFileSync(resolve(here, 'lib/template.html'), 'utf8');
const module = readFileSync(resolve(here, 'lib/eagle-eye.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
// JSON inside <script>: escape "</" so a why containing "</script>" cannot close the block
const data = JSON.stringify(box).replace(/<\//g, '<\\/');
const html = template.replace('/*TITLE*/', box.title.replace(/[<>&]/g, '')).replace('/*DATA*/', data).replace('/*MODULE*/', module);
const out = flag('--out') && flag('--out') !== true ? resolve(flag('--out')) : resolve(dirname(resolve(boxPath)), basename(boxPath).replace(/\.box\.json$|\.json$/, '') + '.html');
writeFileSync(out, html);
console.error(`wrote ${out}`);
console.log(findings(box));
