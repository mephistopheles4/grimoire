#!/usr/bin/env node
// groundtrack renderer. Zero dependencies. One flightpath file in, one
// self-contained HTML page out.
//
//   node render.mjs <topic>.flightpath.json
//     --check          validate; refusals on stderr, exit 1; findings on stdout
//     --out <page>     write one self-contained HTML file
//     --text [<run>]   print the tree to stdout
//
// The validator below IS the format. No machine-readable schema file ships,
// because a second artifact that can silently disagree with the first is not
// worth having. references/flightpath-file.md states the same shape in prose,
// and tests/groundtrack-render.test.mjs is what binds the two.
//
// Nothing here evaluates an expression. Every expression field is text the
// page prints.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Groundtrack = require(resolve(here, 'groundtrack.js'));

/* -- the shape, exactly as references/flightpath-file.md states it ---------- */

const CORE = ['id', 'title', 'blurb', 'entry', 'env', 'nodes', 'presets'];
const OPTIONAL = ['files', 'layers', 'sheet'];
const NODE = ['name', 'role', 'loc', 'params', 'channels', 'steps', 'touches', 'enteredBy'];
const FILE = ['path', 'change', 'why', 'adds', 'dels'];
const PRESET = ['name', 'blurb', 'input', 'walk'];
const CHANGE = ['new', 'edit', 'delete', 'forbidden'];
const CHANNEL = ['retry', 'escape', 'die'];

const STEP = {
  note: { req: ['note'], opt: [] },
  let: { req: ['name', 'expr'], opt: [] },
  if: { req: ['cond', 'then', 'else'], opt: [] },
  goto: { req: ['to'], opt: [] },
  call: { req: ['target'], opt: ['args', 'bind', 'onError'] },
  effect: { req: ['kind', 'desc'], opt: ['args', 'bind', 'onError'] },
  throw: { req: ['tag', 'message', 'channel'], opt: [] },
  return: { req: ['expr'], opt: [] },
};

/* The move kind is the op that ran. These eight names are the eight ops, and
 * four more move a frame rather than run a step. */
const MOVE = {
  note: { req: ['at', 'next'], opt: [] },
  let: { req: ['at', 'next'], opt: [] },
  if: { req: ['at', 'next'], opt: [] },
  goto: { req: ['at', 'next'], opt: [] },
  call: { req: ['at', 'to', 'next'], opt: [] },
  effect: { req: ['at', 'kind', 'desc'], opt: ['next', 'raised', 'result', 'attempt'] },
  throw: { req: ['at', 'tag', 'message', 'channel'], opt: [] },
  return: { req: ['at'], opt: ['value'] },
  handled: { req: ['at', 'goto', 'next'], opt: [] },
  unwind: { req: [], opt: [] },
  done: { req: [], opt: ['result'] },
  uncaught: { req: ['tag', 'message', 'channel'], opt: [] },
};

/** The moves that name an op. `handled` is not one: it runs no step of its own. */
const OP_MOVES = new Set(['note', 'let', 'if', 'goto', 'call', 'effect', 'throw', 'return']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* -- refusals -------------------------------------------------------------
 *
 * A refusal names the file and a reason, always. It names the run and the move
 * as well when the fault is in a walk, which is what makes it actionable
 * there. A fault in the file's shape has no run and no move to name — a
 * top-level unknown key and an empty optional list are both refused before a
 * walk is read — so those locate to a path into the document instead.
 */
function refusals(fileLabel) {
  const list = [];
  return {
    list,
    /** A fault in the document's shape: a path into the file, and a reason. */
    shape: (path, why) => list.push(`${fileLabel}: ${path}: ${why}`),
    /** A fault in a walk: the run, the move that caused it, and a reason. */
    walk: (run, move, why) => list.push(`${fileLabel} / ${run} [${move}] ${why}`),
  };
}

/** An unknown key is an error. Author-keyed maps never reach here. */
function keys(r, where, obj, req, opt = []) {
  if (!isObj(obj)) return r.shape(where, 'expected an object');
  const named = new Set([...req, ...opt]);
  for (const k of req) if (obj[k] === undefined) r.shape(where, `missing required key "${k}"`);
  for (const k of Object.keys(obj)) if (!named.has(k)) r.shape(where, `unknown key "${k}"`);
}

/* -- pass 1 and 2: shape and links ----------------------------------------- */

function shape(prog, r) {
  keys(r, 'file', prog, CORE, OPTIONAL);
  if (!isObj(prog.nodes)) return;
  if (!Object.keys(prog.nodes).length) r.shape('nodes', 'state at least one node');

  /* An id reaches an HTML attribute on the page, so it is validated rather
   * than escaped. A name carries the real symbol, which is where a reader
   * looks anyway. */
  if (typeof prog.id !== 'string' || !Groundtrack.ID.test(prog.id)) {
    r.shape('id', `"${prog.id}" is not a plain letters-digits-and-hyphens id`);
  }

  if (prog.files !== undefined) {
    if (!Array.isArray(prog.files)) r.shape('files', 'expected an array');
    else if (!prog.files.length)
      r.shape('files', 'state the changed files, or leave the key out. An empty list claims a change that touched nothing, which is a different statement from saying nothing about changed files.');
    else
      prog.files.forEach((f, i) => {
        keys(r, `files[${i}]`, f, FILE);
        if (isObj(f) && !CHANGE.includes(f.change)) r.shape(`files[${i}]`, `change "${f.change}" is not one of ${CHANGE.join(', ')}`);
      });
  }

  /* `sheet` is one of the three optional fields, and the empty-list rule is
   * about those three. An empty graphsNotDrawn is not the same mistake: it
   * says the run found no other graph worth a draw, which is an ordinary thing
   * for a small change to say. */
  if (prog.sheet !== undefined) keys(r, 'sheet', prog.sheet, ['scopeRule', 'graphsNotDrawn']);

  if (prog.layers !== undefined) {
    if (!isObj(prog.layers)) r.shape('layers', 'expected an object');
    else if (!Object.keys(prog.layers).length) r.shape('layers', 'state at least one layer, or leave the key out');
    else
      for (const [ln, layer] of Object.entries(prog.layers)) {
        keys(r, `layers.${ln}`, layer, ['nodes'], ['entry']);
        if (!isObj(layer)) continue;
        if (layer.entry !== undefined && !prog.nodes[layer.entry]) r.shape(`layers.${ln}.entry`, `"${layer.entry}" is not a node`);
        if (isObj(layer.nodes))
          for (const [nid, ov] of Object.entries(layer.nodes)) {
            if (!prog.nodes[nid]) r.shape(`layers.${ln}.nodes.${nid}`, 'is not a node');
            keys(r, `layers.${ln}.nodes.${nid}`, ov, ['R']);
            if (isObj(ov) && Array.isArray(ov.R) && !ov.R.length)
              r.shape(`layers.${ln}.nodes.${nid}.R`, 'state the renamed tokens, or leave the node out of this layer');
          }
      }
  }

  if (!prog.nodes[prog.entry]) r.shape('entry', `"${prog.entry}" is not a node`);

  for (const [id, n] of Object.entries(prog.nodes)) {
    if (!Groundtrack.ID.test(id)) r.shape(`nodes.${id}`, 'a node id must be plain letters, digits and hyphens — it reaches the page as an attribute');
    keys(r, `nodes.${id}`, n, NODE);
    if (!isObj(n)) continue;
    if (typeof n.role === 'string' && !n.role.trim()) r.shape(`nodes.${id}.role`, 'is blank — role is an open word, and the page prints it');
    if (n.channels !== undefined) {
      keys(r, `nodes.${id}.channels`, n.channels, ['A', 'E', 'R']);
      if (isObj(n.channels)) {
        if (n.channels.E !== undefined && !Array.isArray(n.channels.E)) r.shape(`nodes.${id}.channels.E`, 'expected an array of failure tags');
        if (n.channels.R !== undefined && !Array.isArray(n.channels.R)) r.shape(`nodes.${id}.channels.R`, 'expected an array of tokens');
        if (n.channels.A !== undefined && typeof n.channels.A !== 'string') r.shape(`nodes.${id}.channels.A`, 'expected a string');
      }
    }
    if (!Array.isArray(n.steps)) {
      r.shape(`nodes.${id}.steps`, 'expected an array');
      continue;
    }

    const L = Groundtrack.labelsOf(n);
    n.steps.forEach((s, i) => {
      const w = `nodes.${id}.steps[${i}]`;
      if (!isObj(s) || !STEP[s.op]) return r.shape(w, `op "${s && s.op}" is not one of ${Object.keys(STEP).join(', ')}`);
      const { req, opt } = STEP[s.op];
      keys(r, `${w} (${s.op})`, s, ['op', ...req], ['label', 'aside', ...opt]);
      for (const k of ['then', 'else', 'to']) {
        if (s[k] !== undefined && L[s[k]] === undefined) r.shape(w, `${k} "${s[k]}" is not a label in ${id}`);
      }
      if (s.op === 'call' && !prog.nodes[s.target]) r.shape(w, `target "${s.target}" is not a node`);
      if (s.op === 'throw' && !CHANNEL.includes(s.channel)) r.shape(w, `channel "${s.channel}" is not one of ${CHANNEL.join(', ')}`);
      if (s.onError !== undefined && !Array.isArray(s.onError)) r.shape(w, 'onError expected an array of { tag, goto }');
      for (const h of Array.isArray(s.onError) ? s.onError : []) {
        keys(r, `${w}.onError`, h, ['tag', 'goto'], ['bind']);
        if (isObj(h) && L[h.goto] === undefined) r.shape(w, `onError goto "${h.goto}" is not a label in ${id}`);
      }
    });
  }

  if (!Array.isArray(prog.presets)) return r.shape('presets', 'expected an array');
  if (!prog.presets.length) return r.shape('presets', 'state at least one run');
  prog.presets.forEach((p, i) => {
    keys(r, `presets[${i}]`, p, PRESET);
    if (!isObj(p) || !isObj(p.walk)) return;
    keys(r, `presets[${i}].walk`, p.walk, ['provenance', 'steps']);
    if (!['authored', 'captured'].includes(p.walk.provenance))
      r.shape(`presets[${i}].walk.provenance`, `"${p.walk.provenance}" is not authored or captured`);
    if (!Array.isArray(p.walk.steps)) return r.shape(`presets[${i}].walk.steps`, 'expected an array');
    if (!p.walk.steps.length) r.shape(`presets[${i}].walk.steps`, 'a walk with no moves shows nothing');
    p.walk.steps.forEach((m, j) => {
      const w = `presets[${i}].walk.steps[${j}]`;
      if (!isObj(m) || !MOVE[m.k]) return r.shape(w, `k "${m && m.k}" is not a move kind`);
      keys(r, `${w} (${m.k})`, m, ['k', ...MOVE[m.k].req], MOVE[m.k].opt);
    });
  });
}

/* -- pass 3: is the walk a legal path? -------------------------------------
 *
 * This proves the walk is a legal path through the graph the file declares. It
 * evaluates nothing: which branch an `if` took and what an effect returned are
 * the author's claims, and the skill says so rather than hiding it.
 */
function path(prog, walk, runName, r) {
  const labels = {};
  for (const [id, n] of Object.entries(prog.nodes)) labels[id] = Groundtrack.labelsOf(n);
  const frames = [];
  const bad = (i, m) => r.walk(runName, i, m);

  /* A walk begins in the entry node with the cursor at zero. No move says so. */
  frames.push({ nodeId: prog.entry, pc: 0 });

  /* The move that emptied the frame stack, not the first move to notice. One
   * measured run went 34 -> 36 -> 36 -> 36 errors and finished blaming the
   * checker, when the whole fault was a spurious unwind one move earlier than
   * the refusal pointed at. */
  let emptiedAt = null;
  let emptiedBy = null;
  const noteEmpty = (i, kind) => {
    if (!frames.length) {
      emptiedAt = i;
      emptiedBy = kind;
    }
  };
  const blameEmpty = (i, m) => {
    if (emptiedAt === null) return bad(i, `${m.k} with no frame open`);
    return bad(emptiedAt, `${emptiedBy} emptied the frame stack, and move ${i} (${m.k}) then ran with none open`);
  };

  walk.steps.forEach((m, i) => {
    if (m.k === 'unwind') {
      if (!frames.length) return blameEmpty(i, m);
      frames.pop();
      noteEmpty(i, 'unwind');
      return;
    }
    if (m.k === 'done') {
      if (frames.length) bad(i, `done arrived with ${frames.length} frame(s) still open`);
      frames.length = 0;
      return;
    }
    /* A tag cannot be uncaught while a frame it is passing through declares a
     * handler for it. Nothing is evaluated: this reads the call step each open
     * frame is suspended at, which is the step whose onError guards that call.
     * Not the frame's cursor — a call advances the caller to next before
     * pushing, so the cursor sits past the guard. Not any step of the node
     * either — onError is per step, and a handler on some other call is not in
     * this error's way. */
    if (m.k === 'uncaught') {
      for (const fr of frames) {
        if (fr.callAt === undefined) continue;
        const guard = ((prog.nodes[fr.nodeId] || {}).steps || [])[fr.callAt];
        for (const h of (guard && guard.onError) || []) {
          if (h.tag === m.tag) bad(i, `"${m.tag}" is uncaught, but ${fr.nodeId}[${fr.callAt}] declares onError for it`);
        }
      }
      frames.length = 0;
      return;
    }

    const f = frames[frames.length - 1];
    if (!f) return blameEmpty(i, m);
    const node = prog.nodes[f.nodeId];
    const L = labels[f.nodeId];
    if (typeof m.at !== 'number' || !node.steps[m.at]) return bad(i, `${m.k} at ${m.at} is not a step of ${f.nodeId}`);
    const st = node.steps[m.at];

    /* `at` is always the step that ran, so it is always the cursor. A handled
     * catch is the one move that arrives after an unwind, so its `at` names
     * the step in this frame whose onError caught, not the cursor. */
    if (m.k !== 'handled' && m.at !== f.pc) bad(i, `${m.k} ran step ${m.at}, but the cursor sits at ${f.pc}`);

    /* `next` is always where the cursor goes, and it is never worked out. */
    if (m.next !== undefined && !node.steps[m.next]) bad(i, `next ${m.next} is not a step of ${f.nodeId}`);

    /* The move's name is the step's op, enforced in one place. */
    if (OP_MOVES.has(m.k) && st.op !== m.k) bad(i, `a "${m.k}" move ran step ${m.at}, which is a "${st.op}"`);

    switch (m.k) {
      case 'note':
      case 'let':
      case 'if':
      case 'goto': {
        let ok = false;
        if (st.op === 'if') ok = m.next === L[st.then] || m.next === L[st.else];
        else if (st.op === 'goto') ok = m.next === L[st.to];
        else ok = m.next === m.at + 1;
        if (!ok) bad(i, `no edge from ${m.at} (${st.op}) to ${m.next}`);
        f.pc = m.next;
        break;
      }
      case 'call':
        if (st.op === 'call' && m.to !== st.target) bad(i, `call to "${m.to}", but step ${m.at} targets "${st.target}"`);
        f.pc = m.next;
        f.callAt = m.at;
        if (prog.nodes[m.to]) frames.push({ nodeId: m.to, pc: 0 });
        else bad(i, `call to unknown node "${m.to}"`);
        break;
      case 'effect':
        if (st.op === 'effect' && m.kind !== st.kind) bad(i, `effect kind "${m.kind}" does not match step kind "${st.kind}"`);
        if (m.next !== undefined && m.raised !== undefined) bad(i, 'an effect carries next or raised, never both');
        else if (m.next !== undefined) f.pc = m.next;
        else if (m.raised === undefined) bad(i, 'an effect carries next when it went on, or raised when it threw');
        else {
          keys(r, `${runName} [${i}] raised`, m.raised, ['tag', 'message', 'channel']);
          if (isObj(m.raised) && !CHANNEL.includes(m.raised.channel))
            bad(i, `raised channel "${m.raised.channel}" is not one of ${CHANNEL.join(', ')}`);
        }
        break;
      case 'throw':
        if (st.op === 'throw' && m.tag !== st.tag) bad(i, `throw tag "${m.tag}" does not match step tag "${st.tag}"`);
        break;
      case 'handled': {
        if (!((st.onError || []).some(h => h.goto === m.goto))) bad(i, `handled at ${m.at} (${st.op}): its onError does not name "${m.goto}"`);
        if (L[m.goto] === undefined) bad(i, `handled goto "${m.goto}" is not a label in ${f.nodeId}`);
        else if (m.next !== L[m.goto]) bad(i, `handled lands at ${m.next}, but "${m.goto}" is step ${L[m.goto]}`);
        f.pc = m.next;
        break;
      }
      case 'return':
        frames.pop();
        noteEmpty(i, 'return');
        /* The caller resumed, so its call's onError is no longer in any
         * error's way. An unwind does not clear this: there the error is still
         * travelling through the frame. */
        if (frames.length) frames[frames.length - 1].callAt = undefined;
        break;
      default:
        break;
    }
  });

  if (frames.length) bad(walk.steps.length, `the walk ended with ${frames.length} frame(s) still open`);
}

export function check(prog, fileLabel) {
  const r = refusals(fileLabel);
  shape(prog, r);
  if (r.list.length) return r.list; /* links are unreliable once the shape is wrong */
  for (const p of prog.presets) path(prog, p.walk, p.name, r);
  return r.list;
}

/* -- findings -------------------------------------------------------------
 *
 * A finding is not a refusal. Each one is computed from the file alone with no
 * run, each one is a thing a reader may have meant, and none of them makes the
 * file illegal. The two the spec left unplaced are here rather than in the
 * validator for that reason: neither is a graph-versus-walk contradiction, and
 * refusing a file for one would refuse a file that says exactly what its
 * author meant.
 */
export function findings(prog) {
  const out = [];

  /* One file edited by several nodes. Legal, and worth seeing: it is the shape
   * a change takes when one file carries two concerns. */
  const editors = {};
  for (const [id, n] of Object.entries(prog.nodes)) {
    for (const p of n.touches || []) (editors[p] = editors[p] || []).push(id);
  }
  for (const [p, ids] of Object.entries(editors)) {
    if (ids.length > 1) out.push(`several nodes edit ${p}: ${ids.join(', ')}`);
  }

  /* An E channel declaring a tag nothing beneath it can produce.
   *
   * A node produces a tag three ways: it throws it, a step of it declares a
   * handler for it, or one of its effects raised it in a walk this file
   * carries. The third source is why this reads the walks. A step gives an
   * effect no failure set — the shape has no field for one, on purpose — so a
   * rule that read the steps alone would report every effect that can fail,
   * which is most of them, and the finding would mean nothing.
   */
  const raisedInWalks = {};
  for (const p of prog.presets || []) {
    const states = Groundtrack.fold(prog, p.walk);
    for (const l of states[states.length - 1].ledger) {
      if (l.raised) (raisedInWalks[l.nodeId] = raisedInWalks[l.nodeId] || new Set()).add(l.raised.tag);
    }
  }

  const tagsOf = (id, seen = new Set()) => {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const set = new Set(raisedInWalks[id] || []);
    for (const s of prog.nodes[id].steps || []) {
      if (s.op === 'throw') set.add(s.tag);
      for (const h of s.onError || []) set.add(h.tag);
      if (s.op === 'call' && prog.nodes[s.target]) for (const t of tagsOf(s.target, seen)) set.add(t);
    }
    return set;
  };
  for (const [id, n] of Object.entries(prog.nodes)) {
    const can = tagsOf(id);
    for (const tag of (n.channels || {}).E || []) {
      if (!can.has(tag)) out.push(`${id} declares E tag "${tag}", and nothing beneath it produces that tag`);
    }
  }

  /* Files in the change that no node accounts for, by name. A
   * documentation-only or config-only part of a change is not silently
   * dropped. */
  const touched = new Set();
  for (const n of Object.values(prog.nodes)) for (const p of n.touches || []) touched.add(p);
  for (const f of prog.files || []) {
    if (!touched.has(f.path)) out.push(`no node accounts for ${f.path}`);
  }

  /* A cut edge is derived, never declared. */
  for (const c of Groundtrack.cutEdges(prog)) {
    out.push(`layer "${c.layer}" cuts ${c.from}[${c.at}] -> ${c.to} (token "${c.token}")`);
  }

  return out;
}

/* -- the text output ------------------------------------------------------
 *
 * One shared walk drives the page and the text, so the two produce the same
 * row list. One row is a call site, not a node, so a node called twice appears
 * twice. Without the run's end marks every run in a file prints the same text,
 * which would make the reader's choice of run change nothing.
 */
export function text(prog, runIndex) {
  const i = runIndex === undefined ? Groundtrack.suggestRun(prog) : runIndex;
  const run = prog.presets[i];
  const rows = Groundtrack.treeRows(prog, run.walk);
  const L = [];

  const kinds = [...new Set(prog.presets.map(p => p.walk.provenance))];
  L.push(
    kinds.length === 1 && kinds[0] === 'captured'
      ? 'The walks in this file were captured from a real run.'
      : kinds.length === 1
        ? 'The walks in this file were written by hand. They are claims about the program, not recordings of it.'
        : 'The walks in this file are mixed: some were captured from a real run, some were written by hand.',
  );
  L.push('');
  L.push(`${prog.title}`);
  L.push(`run "${run.name}" — ${run.blurb}`);
  L.push('');

  for (const row of rows) {
    const pad = '  '.repeat(row.depth);
    const arrow = row.depth ? '-> ' : '';
    L.push(`${pad}${arrow}${row.name}  [${row.role}]  ${row.state}${row.repeat ? '  (seen above — stopped)' : ''}`);
    const E = row.E.length ? row.E.join(' · ') : 'never';
    const R = row.R.length ? row.R.join(', ') : 'none';
    L.push(`${pad}   A ${row.A || '—'}   E ${E}   R ${R}`);
    if (row.site && (row.site.label || row.site.aside)) {
      if (row.site.label) L.push(`${pad}   at "${row.site.label}"`);
      if (row.site.aside) L.push(`${pad}   ${row.site.aside}`);
    }
    for (const [ln, layer] of Object.entries(prog.layers || {})) {
      const ov = layer.nodes && layer.nodes[row.id];
      if (ov && ov.R && ov.R.length) L.push(`${pad}   R under ${ln}: ${ov.R.join(', ')}`);
    }
    for (const fx of row.effects) L.push(`${pad}   · ${fx.kind}  ${fx.desc} — ${fx.mark}`);
  }

  const others = prog.presets.filter((_, j) => j !== i);
  if (others.length) {
    L.push('');
    L.push('other runs in this file:');
    for (const p of others) L.push(`  "${p.name}" — ${p.blurb}`);
  }
  return L.join('\n');
}

/* -- the page -------------------------------------------------------------- */

const FONTS = [
  ['400', 'ibm-plex-mono-400.woff2'],
  ['500', 'ibm-plex-mono-500.woff2'],
  ['600', 'ibm-plex-mono-600.woff2'],
];

export function page(prog) {
  const template = readFileSync(resolve(here, '..', 'assets', 'template.html'), 'utf8');
  const moduleSource = readFileSync(resolve(here, 'groundtrack.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');

  /* The faces are vendored and inlined, so the page makes no network request
   * at all. A font CDN is a dependency on somebody else's uptime, some hosts
   * will not load one, and a drawing whose monospace silently degrades is a
   * worse drawing. */
  const faces = FONTS.map(([weight, file]) => {
    const b64 = readFileSync(resolve(here, '..', 'assets', file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join('\n');

  /* JSON inside a script block: the closing-tag sequence is escaped so no
   * author string can close it. */
  const data = JSON.stringify(prog).replace(/<\//g, '<\\/');

  /* Function replacements, and this is load-bearing rather than style. A
   * string replacement is interpreted: $&, $` and $' stand for the match and
   * the text on either side of it, so author text carrying one of those
   * splices a slab of the template into the middle of the page — including the
   * template's own real closing script tag, which the escape above cannot help
   * with because that tag never passed through the file. A function
   * replacement is inserted literally and has no patterns at all. */
  return template
    .replace('/*TITLE*/', () => String(prog.title).replace(/[<>&]/g, ''))
    .replace('/*FONTS*/', () => faces)
    .replace('/*DATA*/', () => data)
    .replace('/*MODULE*/', () => moduleSource);
}

/* -- the command line ------------------------------------------------------ */

const USAGE =
  'usage: node render.mjs <topic>.flightpath.json [--check] [--out page.html] [--text [run]]\n' +
  '  --check        validate; refusals on stderr, exit 1; findings on stdout\n' +
  '  --out <page>   write one self-contained HTML file\n' +
  '  --text [run]   print the tree to stdout for one run, by name or index';

function main(argv) {
  const args = argv.slice(2);
  const usage = () => {
    console.error(USAGE);
    process.exit(2);
  };

  const has = n => args.includes(n);
  /* Each argument is judged at its own index. Looking the index up by value
   * finds the first occurrence rather than the position being examined, so a
   * repeated value makes the guard read the wrong neighbour. */
  const valueOf = n => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const VALUED = ['--out', '--text'];
  /* A flag that takes a value has two ways to arrive without one: last on the
   * line, or followed by another flag. --text's value is optional, so only
   * --out is refused for a missing one. */
  const missingValue = n => args.some((a, i) => a === n && (args[i + 1] === undefined || args[i + 1].startsWith('--')));
  if (missingValue('--out')) usage();

  const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  if (positional.length !== 1) usage();
  const file = positional[0];

  const outPath = has('--out') ? valueOf('--out') : undefined;
  const wantText = has('--text');
  const runArg = wantText && valueOf('--text') !== undefined && !valueOf('--text').startsWith('--') ? valueOf('--text') : undefined;

  let prog;
  try {
    prog = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }

  const errs = check(prog, file);
  if (errs.length) {
    for (const e of errs) console.error(e);
    console.error(`${file}: ${errs.length} refusal(s)`);
    process.exit(1);
  }

  const notes = findings(prog);

  if (has('--check')) {
    for (const n of notes) console.log(n);
    console.error(`ok: ${prog.title} — ${Object.keys(prog.nodes).length} node(s), ${prog.presets.length} run(s), ${notes.length} finding(s)`);
    process.exit(0);
  }

  if (wantText) {
    let index;
    if (runArg !== undefined) {
      index = prog.presets.findIndex(p => p.name === runArg);
      if (index < 0 && /^\d+$/.test(runArg)) index = Number(runArg);
      if (index < 0 || !prog.presets[index]) {
        console.error(`${file}: no run called "${runArg}". This file has: ${prog.presets.map(p => `"${p.name}"`).join(', ')}`);
        process.exit(1);
      }
    }
    console.log(text(prog, index));
    process.exit(0);
  }

  /* A run writes its file and its page to scratch, never beside its input, so
   * a working tree does not collect untracked pages. The renderer therefore
   * requires an output path rather than choosing one. */
  if (!outPath) {
    console.error(
      `${file}: name the page to write with --out. This renderer writes no page beside its input, because a page dropped next to the file it was made from is an artifact nobody asked for and nothing cleans up.`,
    );
    console.error(USAGE);
    process.exit(2);
  }

  writeFileSync(resolve(outPath), page(prog));
  console.error(`wrote ${resolve(outPath)}`);
  for (const n of notes) console.log(n);
  process.exit(0);
}

// Run only when this file is what node was pointed at. Matched on the resolved
// path rather than on the file name: the other skill in this repository also
// ships a `render.mjs`, so a name test would run this main() inside that one.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
