/* check.mjs — the hand-rolled validator for a groundtrack flightpath file.
 *
 * Zero dependencies. Nothing here evaluates an expression: no `new Function`,
 * no scope, no value compared. Three passes:
 *
 *   1. shape   every required field present, every key named by the document
 *   2. links   every label, target and node id resolves
 *   3. path    every walk is a legal path through the graph
 *
 * The document this enforces is groundtrack-ir.md. corpus.mjs asserts the two
 * agree.
 *
 *   node check.mjs <file|dir>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* -- the shape, exactly as groundtrack-ir.md states it --------------------- */

const TOP = ['id', 'title', 'blurb', 'entry', 'env', 'files', 'layers', 'nodes', 'presets', 'sheet'];
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

/* Rule 1: `k` is the op that ran. These eight names are the eight ops. */
const MOVE = {
  note: { req: ['at', 'next'], opt: [] },
  let: { req: ['at', 'next'], opt: [] },
  if: { req: ['at', 'next'], opt: [] },
  goto: { req: ['at', 'next'], opt: [] },
  call: { req: ['at', 'to', 'next'], opt: [] },
  effect: { req: ['at', 'kind', 'desc'], opt: ['next', 'raised', 'result', 'attempt'] },
  throw: { req: ['at', 'tag', 'message', 'channel'], opt: [] },
  return: { req: ['at'], opt: ['value'] },
  /* and the five that move a frame rather than run a step */
  enter: { req: ['node'], opt: [] },
  handled: { req: ['at', 'goto', 'next'], opt: [] },
  unwind: { req: [], opt: [] },
  done: { req: [], opt: ['result'] },
  uncaught: { req: ['tag', 'message', 'channel'], opt: [] },
};

/** The moves that name an op. `handled` is not one: it runs no step. */
const OP_MOVES = new Set(['note', 'let', 'if', 'goto', 'call', 'effect', 'throw', 'return']);

/* -- helpers -------------------------------------------------------------- */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Rule 2: an unknown key is an error. Author-keyed maps never reach here. */
function keys(errs, where, obj, req, opt = []) {
  if (!isObj(obj)) return errs.push(`${where}: expected an object`);
  const named = new Set([...req, ...opt]);
  for (const k of req) if (obj[k] === undefined) errs.push(`${where}: missing required key "${k}"`);
  for (const k of Object.keys(obj)) if (!named.has(k)) errs.push(`${where}: unknown key "${k}"`);
}

const labelMap = (node) => {
  const m = {};
  node.steps.forEach((s, i) => { if (s.label !== undefined) m[s.label] = i; });
  return m;
};

/* -- pass 1 and 2: shape and links ---------------------------------------- */

function shape(prog, errs) {
  keys(errs, 'file', prog, TOP);
  if (!isObj(prog.nodes)) return;

  if (!Array.isArray(prog.files)) errs.push('files: expected an array');
  else prog.files.forEach((f, i) => {
    keys(errs, `files[${i}]`, f, FILE);
    if (f && !CHANGE.includes(f.change)) errs.push(`files[${i}]: change "${f.change}" is not one of ${CHANGE.join(', ')}`);
  });

  if (isObj(prog.sheet)) keys(errs, 'sheet', prog.sheet, ['scopeRule', 'graphsNotDrawn']);

  if (isObj(prog.layers)) {
    if (!Object.keys(prog.layers).length) errs.push('layers: state at least one layer');
    for (const [ln, layer] of Object.entries(prog.layers)) {
      keys(errs, `layers.${ln}`, layer, ['nodes'], ['entry']);
      if (layer && layer.entry !== undefined && !prog.nodes[layer.entry])
        errs.push(`layers.${ln}: entry "${layer.entry}" is not a node`);
      if (isObj(layer && layer.nodes)) for (const [nid, ov] of Object.entries(layer.nodes)) {
        if (!prog.nodes[nid]) errs.push(`layers.${ln}.nodes: "${nid}" is not a node`);
        keys(errs, `layers.${ln}.nodes.${nid}`, ov, ['R']);
      }
    }
  }

  if (!prog.nodes[prog.entry]) errs.push(`entry: "${prog.entry}" is not a node`);

  for (const [id, n] of Object.entries(prog.nodes)) {
    keys(errs, `nodes.${id}`, n, NODE);
    if (!isObj(n)) continue;
    if (isObj(n.channels)) keys(errs, `nodes.${id}.channels`, n.channels, ['A', 'E', 'R']);
    if (typeof n.role === 'string' && !n.role.trim()) errs.push(`nodes.${id}: role is blank`);
    if (!Array.isArray(n.steps)) { errs.push(`nodes.${id}.steps: expected an array`); continue; }

    const L = labelMap(n);
    n.steps.forEach((s, i) => {
      const w = `nodes.${id}.steps[${i}]`;
      if (!isObj(s) || !STEP[s.op]) return errs.push(`${w}: op "${s && s.op}" is not one of ${Object.keys(STEP).join(', ')}`);
      const { req, opt } = STEP[s.op];
      keys(errs, `${w} (${s.op})`, s, ['op', ...req], ['label', 'aside', ...opt]);
      for (const k of ['then', 'else', 'to']) if (s[k] !== undefined && L[s[k]] === undefined)
        errs.push(`${w}: ${k} "${s[k]}" is not a label in ${id}`);
      if (s.op === 'call' && !prog.nodes[s.target]) errs.push(`${w}: target "${s.target}" is not a node`);
      if (s.op === 'throw' && !CHANNEL.includes(s.channel)) errs.push(`${w}: channel "${s.channel}" is not one of ${CHANNEL.join(', ')}`);
      for (const h of s.onError || []) {
        keys(errs, `${w}.onError`, h, ['tag', 'goto'], ['bind']);
        if (h && L[h.goto] === undefined) errs.push(`${w}: onError goto "${h.goto}" is not a label in ${id}`);
      }
    });
  }

  if (!Array.isArray(prog.presets)) return errs.push('presets: expected an array');
  if (!prog.presets.length) errs.push('presets: state at least one');
  prog.presets.forEach((p, i) => {
    keys(errs, `presets[${i}]`, p, PRESET);
    if (!isObj(p) || !isObj(p.walk)) return;
    keys(errs, `presets[${i}].walk`, p.walk, ['provenance', 'steps']);
    if (!['authored', 'captured'].includes(p.walk.provenance))
      errs.push(`presets[${i}].walk: provenance "${p.walk.provenance}" is not authored or captured`);
    if (!Array.isArray(p.walk.steps)) return errs.push(`presets[${i}].walk.steps: expected an array`);
    p.walk.steps.forEach((m, j) => {
      const w = `presets[${i}].walk.steps[${j}]`;
      if (!isObj(m) || !MOVE[m.k]) return errs.push(`${w}: k "${m && m.k}" is not a move kind`);
      keys(errs, `${w} (${m.k})`, m, ['k', ...MOVE[m.k].req], MOVE[m.k].opt);
    });
  });
}

/* -- pass 3: is the walk a legal path? ------------------------------------ */

function path(prog, walk, where, errs) {
  const labels = {};
  for (const [id, n] of Object.entries(prog.nodes)) labels[id] = labelMap(n);
  const frames = [];
  const top = () => frames[frames.length - 1];
  const bad = (i, m) => errs.push(`${where} [${i}] ${m}`);

  walk.steps.forEach((m, i) => {
    if (m.k === 'enter') {
      if (frames.length) return bad(i, 'enter inside a live frame');
      if (!prog.nodes[m.node]) return bad(i, `enter unknown node "${m.node}"`);
      if (m.node !== prog.entry) bad(i, `enter "${m.node}" is not the entry "${prog.entry}"`);
      return void frames.push({ nodeId: m.node, pc: 0 });
    }
    if (m.k === 'unwind') { if (!frames.length) return bad(i, 'unwind with no frame'); return void frames.pop(); }
    if (m.k === 'done') { if (frames.length) bad(i, `done with ${frames.length} frame(s) open`); return void (frames.length = 0); }
    if (m.k === 'uncaught') return void (frames.length = 0);

    const f = top();
    if (!f) return bad(i, `${m.k} with no frame`);
    const node = prog.nodes[f.nodeId];
    const L = labels[f.nodeId];
    if (typeof m.at !== 'number' || !node.steps[m.at]) return bad(i, `${m.k} at ${m.at} is not a step of ${f.nodeId}`);
    const st = node.steps[m.at];

    /* Rule 1: `at` is always the step that ran, so it is always the cursor.
     * A `handled` is the one move that arrives after an unwind, so its `at`
     * names the step in THIS frame whose onError caught, not the cursor. */
    if (m.k !== 'handled' && m.at !== f.pc) bad(i, `${m.k} ran step ${m.at}, but the cursor sits at ${f.pc}`);

    /* Rule 2: `next` is always where the cursor goes, and it is never worked
     * out. Validate it once, here, for every move that carries one. */
    if (m.next !== undefined && !node.steps[m.next])
      bad(i, `next ${m.next} is not a step of ${f.nodeId}`);

    /* Rule 1, enforced in one place: the move's name is the step's op. */
    if (OP_MOVES.has(m.k) && st.op !== m.k)
      bad(i, `a "${m.k}" move ran step ${m.at}, which is a "${st.op}"`);

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
        if (st.op === 'call' && m.to !== st.target) bad(i, `call to "${m.to}", step targets "${st.target}"`);
        f.pc = m.next;
        if (prog.nodes[m.to]) frames.push({ nodeId: m.to, pc: 0 });
        else bad(i, `call to unknown node "${m.to}"`);
        break;
      case 'effect':
        if (st.op === 'effect' && m.kind !== st.kind) bad(i, `effect kind "${m.kind}" != step kind "${st.kind}"`);
        if (m.next !== undefined && m.raised !== undefined) bad(i, 'an effect carries next or raised, never both');
        else if (m.next !== undefined) f.pc = m.next;
        else if (m.raised === undefined) bad(i, 'an effect carries next when it went on, or raised when it threw');
        else keys(errs, `${where} [${i}] raised`, m.raised, ['tag', 'message', 'channel']);
        break;
      case 'throw':
        if (st.op === 'throw' && m.tag !== st.tag) bad(i, `throw tag "${m.tag}" != step tag "${st.tag}"`);
        break;
      case 'handled': {
        if (!(st.onError || []).some((h) => h.goto === m.goto))
          bad(i, `handled at ${m.at} (${st.op}): its onError does not name "${m.goto}"`);
        if (L[m.goto] === undefined) bad(i, `handled goto "${m.goto}" is not a label in ${f.nodeId}`);
        else if (m.next !== L[m.goto]) bad(i, `handled lands at ${m.next}, but "${m.goto}" is step ${L[m.goto]}`);
        f.pc = m.next;
        break;
      }
      case 'return':
        frames.pop();
        break;
    }
  });
  if (frames.length) bad(walk.steps.length, `${frames.length} frame(s) still open`);
}

/* -- the derived cut ------------------------------------------------------ */

/** A renamed token that appears in a call step's args cuts that edge under the
 *  layer. Nobody declares this; it is read off the rename. */
export function cutEdges(prog) {
  const cuts = [];
  for (const [ln, layer] of Object.entries(prog.layers || {})) {
    for (const [nid, ov] of Object.entries((layer && layer.nodes) || {})) {
      const renamed = (ov.R || []).map((r) => String(r).split('→')[0].trim()).filter(Boolean);
      for (const [callerId, caller] of Object.entries(prog.nodes)) {
        caller.steps.forEach((s, i) => {
          if (s.op !== 'call') return;
          const args = JSON.stringify(s.args || {});
          for (const tok of renamed)
            if (nid === callerId || args.includes(tok)) cuts.push(`${ln}: ${callerId}[${i}] → ${s.target} (token "${tok}")`);
        });
      }
    }
  }
  return cuts;
}

/* -- entry ---------------------------------------------------------------- */

export function check(prog) {
  const errs = [];
  shape(prog, errs);
  if (errs.length) return errs; // links are unreliable once the shape is wrong
  for (const p of prog.presets) path(prog, p.walk, `${prog.id} / ${p.name}`, errs);
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || process.argv[1]?.endsWith('check.mjs')) {
  const target = process.argv[2];
  if (!target) { console.error('usage: node check.mjs <file|dir>'); process.exit(2); }
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f))
    : [target];
  let bad = 0;
  for (const f of files) {
    let prog;
    try { prog = JSON.parse(readFileSync(f, 'utf8')); }
    catch (e) { console.log(`${f}\n    not JSON: ${e.message}`); bad++; continue; }
    const errs = check(prog);
    console.log(`${f.split(/[\\/]/).pop().padEnd(30)} ${errs.length ? errs.length + ' ERRORS' : 'ok'}`);
    for (const e of errs.slice(0, 15)) console.log('    ' + e);
    if (errs.length > 15) console.log(`    … ${errs.length - 15} more`);
    if (errs.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
