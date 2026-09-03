/* groundtrack.js — the one module the page and the tests both run.
 *
 * It lives apart from the markup that calls it so that a test can reach it,
 * and render.mjs inlines it into the page. Two copies of the fold would be two
 * things to get right, and the second one would have no test.
 *
 * Nothing here evaluates an expression. There is no `new Function`, no `eval`,
 * no scope and no value compared. Every expression field in a flightpath file
 * is text this module hands to the page to print.
 */
const Groundtrack = (() => {
  /* -- author text ---------------------------------------------------------
   *
   * A flightpath file is a stranger's text, and the page shows a lot of it:
   * expressions, step remarks, effect descriptions, error messages, run
   * blurbs, layer tokens, file paths and reasons, and a node's location.
   *
   * This escapes & and < and nothing else. That is deliberate and it is
   * narrow: it is enough only while no author text reaches an HTML attribute,
   * where the double quote would end the value. The page keeps that bargain —
   * every interpolated attribute holds a node id, an index or a fixed class
   * name — and SECURITY.md states the pairing. tests/groundtrack-fold.test.mjs
   * pins both halves, the escaping and the passing through, so widening it is
   * a visible test change rather than a quiet one.
   */
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* A node id reaches an HTML attribute, so it is validated rather than
   * escaped. render.mjs refuses a file whose ids do not match this, which is
   * what makes an id a known-safe string by the time the page sees it. */
  const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

  /* -- reading the graph ---------------------------------------------------- */

  /** label -> step index, for one node. A label is a jump target and nothing else. */
  const labelsOf = node => {
    const m = {};
    (node.steps || []).forEach((s, i) => {
      if (s.label !== undefined) m[s.label] = i;
    });
    return m;
  };

  /** The call steps of one node, in order. A node called twice is two sites. */
  const callSites = node => {
    const out = [];
    (node.steps || []).forEach((s, i) => {
      if (s.op === 'call') out.push({ at: i, target: s.target, label: s.label, aside: s.aside });
    });
    return out;
  };

  /** Distinct callees, in first-call order. Used by the drawing, not the tree. */
  const calleesOf = (prog, id) => {
    const out = [];
    for (const s of prog.nodes[id].steps || []) {
      if (s.op === 'call' && prog.nodes[s.target] && !out.includes(s.target)) out.push(s.target);
    }
    return out;
  };

  const effectsOf = node => (node.steps || []).map((s, i) => ({ ...s, at: i })).filter(s => s.op === 'effect');

  /* -- the fold ------------------------------------------------------------
   *
   * The player may derive, never decide. This pushes a frame, pops a frame,
   * appends a ledger row and moves a cursor. Everything else on the page — the
   * step counter, what has been visited, which edges the walk took — is read
   * off the states this returns.
   *
   * It returns one immutable state per cursor position, so stepping backward
   * is an index lookup and returns exactly what stepping forward produced.
   * states[0] is the walk before its first move; states[i] is the walk after
   * move i - 1.
   */
  function fold(prog, walk) {
    const moves = (walk && walk.steps) || [];

    /* A walk begins in the entry node with the cursor at zero. No move says
     * so, so the seed state does. The entry frame's site is the root: it was
     * pushed by nothing, and the tree hangs its top row off this key. */
    let frames = [{ nodeId: prog.entry, pc: 0, callAt: undefined, site: '@entry' }];
    let ledger = [];
    let visited = [prog.entry];
    let edges = [];
    let errorPath = [];
    let sites = {}; /* site key -> { entered, returned, effects: { "node[at]": outcome } } */
    /* The same marks again, keyed by node rather than by call site. The tree
     * shows one row per call site and wants the first; the drawing shows one
     * box per node and wants the second. Without this the drawing loses a
     * node's effect marks the moment its frame returns, while the tree keeps
     * them — one graph seen two ways, disagreeing. */
    let nodeEffects = {};
    let ended = null;

    const clone = () => frames.map(f => ({ ...f }));
    const siteOf = f => f.site;
    const touch = key => (sites[key] = sites[key] || { entered: 0, returned: 0, effects: {} });

    touch('@entry').entered = 1;

    const states = [
      {
        i: -1,
        move: null,
        frames: clone(),
        ledger: [],
        visited: visited.slice(),
        edges: [],
        errorPath: [],
        sites: JSON.parse(JSON.stringify(sites)),
        nodeEffects: {},
        ended: null,
        moved: null,
      },
    ];

    moves.forEach((m, i) => {
      let moved = null;
      const top = frames[frames.length - 1];

      if (m.k === 'unwind') {
        const gone = frames.pop();
        if (gone) {
          moved = { from: gone.nodeId, to: frames.length ? frames[frames.length - 1].nodeId : null, dir: 'unwind' };
          errorPath = errorPath.concat([{ nodeId: gone.nodeId, how: 'passed through' }]);
        }
      } else if (m.k === 'done') {
        frames = [];
        ended = 'done';
      } else if (m.k === 'uncaught') {
        errorPath = errorPath.concat([{ nodeId: null, how: 'reached the top uncaught', tag: m.tag, message: m.message, channel: m.channel }]);
        frames = [];
        ended = 'uncaught';
      } else if (top) {

        switch (m.k) {
          case 'note':
          case 'let':
          case 'if':
          case 'goto':
            top.pc = m.next;
            break;
          case 'call': {
            top.pc = m.next;
            /* The call's own next is the caller's continuation, set before the
             * callee is pushed. callAt is the step whose onError guards this
             * call — it is what the uncaught check reads, and the cursor is
             * already past it by now. */
            top.callAt = m.at;
            const key = `${top.nodeId}#${m.at}`;
            touch(key).entered += 1;
            frames.push({ nodeId: m.to, pc: 0, callAt: undefined, site: key });
            if (!visited.includes(m.to)) visited.push(m.to);
            edges = edges.concat([`${top.nodeId}>${m.to}`]);
            moved = { from: top.nodeId, to: m.to, dir: 'call' };
            break;
          }
          case 'effect': {
            const outcome = m.raised !== undefined ? 'failed' : 'landed';
            touch(siteOf(top)).effects[`${top.nodeId}[${m.at}]`] = outcome;
            nodeEffects = { ...nodeEffects, [`${top.nodeId}[${m.at}]`]: outcome };
            ledger = ledger.concat([
              {
                nodeId: top.nodeId,
                at: m.at,
                kind: m.kind,
                desc: m.desc,
                outcome,
                result: m.result,
                attempt: m.attempt,
                raised: m.raised,
              },
            ]);
            if (m.raised !== undefined) {
              errorPath = [{ nodeId: top.nodeId, how: 'raised', tag: m.raised.tag, message: m.raised.message, channel: m.raised.channel }];
            } else {
              top.pc = m.next;
            }
            break;
          }
          case 'throw':
            errorPath = [{ nodeId: top.nodeId, how: 'thrown', tag: m.tag, message: m.message, channel: m.channel }];
            break;
          case 'handled':
            top.pc = m.next;
            errorPath = errorPath.concat([{ nodeId: top.nodeId, how: 'caught', goto: m.goto }]);
            break;
          case 'return': {
            const gone = frames.pop();
            if (gone) touch(siteOf(gone)).returned += 1;
            if (frames.length) {
              frames[frames.length - 1].callAt = undefined;
              moved = { from: gone.nodeId, to: frames[frames.length - 1].nodeId, dir: 'return' };
            }
            errorPath = [];
            break;
          }
          default:
            break;
        }
      }

      states.push({
        i,
        move: m,
        frames: clone(),
        ledger: ledger.slice(),
        visited: visited.slice(),
        edges: edges.slice(),
        errorPath: errorPath.slice(),
        sites: JSON.parse(JSON.stringify(sites)),
        nodeEffects,
        ended,
        moved,
      });
    });

    return states;
  }

  /** Stepping back over a call redraws it callee to caller, so unwinding reads
   *  as unwinding. The state itself is the one stepping forward produced. */
  function back(states, i) {
    const from = states[i];
    const to = states[Math.max(0, i - 1)];
    const m = from && from.moved;
    return { state: to, redraw: m ? { from: m.to, to: m.from, dir: m.dir === 'call' ? 'uncall' : 'unreturn' } : null };
  }

  /* -- the derived cut -----------------------------------------------------
   *
   * A layer renames a token, never a node, so the geometry never changes. A
   * rename may still cut a call edge, and nobody writes that down: if the
   * renamed token appears in a call step's args, that edge is cut under the
   * layer. Both arrow spellings are read, because the worked programs use one
   * and the shape document's example uses the other.
   */
  const renamedToken = r => String(r).split(/→|->/)[0].trim();

  function cutEdges(prog) {
    const cuts = [];
    for (const [ln, layer] of Object.entries(prog.layers || {})) {
      for (const [nid, ov] of Object.entries((layer && layer.nodes) || {})) {
        const tokens = ((ov && ov.R) || []).map(renamedToken).filter(Boolean);
        for (const [callerId, caller] of Object.entries(prog.nodes)) {
          (caller.steps || []).forEach((s, i) => {
            if (s.op !== 'call') return;
            const args = JSON.stringify(s.args || {});
            /* The rule is the argument list and nothing else. A prototype also
             * cut every call the renamed node itself makes, which cuts edges
             * the substitution never touched — it is a node rule wearing a
             * token rule's clothes, and a layer renames a token, never a
             * node. */
            for (const tok of tokens) {
              if (args.includes(tok)) cuts.push({ layer: ln, from: callerId, at: i, to: s.target, token: tok });
            }
          });
        }
      }
    }
    return cuts;
  }

  /* -- the drawing ---------------------------------------------------------
   *
   * Depth is the longest path from the entry, so a node called from two depths
   * draws below both of its callers. The call runs down the left of a pair and
   * the declared error return up its right: one corridor, two directions.
   */
  const W = 288, GAP_X = 48, GAP_Y = 96, PAD = 36;

  function layout(prog) {
    const ids = Object.keys(prog.nodes);
    const depth = Object.fromEntries(ids.map(i => [i, 0]));
    for (let k = 0; k < ids.length; k++) {
      for (const id of ids) for (const c of calleesOf(prog, id)) if (depth[c] < depth[id] + 1) depth[c] = depth[id] + 1;
    }

    const order = [], seen = new Set();
    (function dfs(id) {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      calleesOf(prog, id).forEach(dfs);
    })(prog.entry);
    ids.forEach(id => { if (!seen.has(id)) order.push(id); });

    const rows = {};
    for (const id of order) (rows[depth[id]] = rows[depth[id]] || []).push(id);

    /* The box: 12 + 12 padding, a 20 top row, a 24 name, an 18 location, a 66
     * channel block, and 21 for each effect row under it. */
    const H = Object.fromEntries(ids.map(id => [id, 152 + effectsOf(prog.nodes[id]).length * 21]));
    const widest = Math.max(...Object.values(rows).map(r => r.length));
    const sheetW = widest * W + (widest - 1) * GAP_X;

    /* A node sits under the nodes that call it. A caller centres its callees
     * beneath itself, in call order, so a node with one callee puts it straight
     * below and a node with four spreads them either side. A callee reached
     * from two callers takes the mean of what each asked for. Each row after
     * the first is then placed by one left-to-right sweep: a node gets the x
     * it asked for unless the node before it is in the way, in which case it
     * shifts right by exactly the gap. A node no placed node calls keeps the
     * row's right edge. This is one pass with no search, not a layout engine,
     * and the first row is centred on the sheet as before. */
    const pos = {};
    let y = PAD;
    let rightEdge = PAD;
    for (const d of Object.keys(rows).sort((a, b) => a - b)) {
      const row = rows[d];
      if (d === '0') {
        const rowW = row.length * W + (row.length - 1) * GAP_X;
        let x = PAD + (sheetW - rowW) / 2;
        for (const id of row) {
          pos[id] = { x, y, h: H[id] };
          x += W + GAP_X;
        }
      } else {
        const asks = Object.fromEntries(row.map(id => [id, []]));
        for (const c of ids) {
          if (!pos[c]) continue;
          const kids = calleesOf(prog, c).filter(k => asks[k]);
          kids.forEach((k, i) => asks[k].push(pos[c].x + (i - (kids.length - 1) / 2) * (W + GAP_X)));
        }
        const want = {};
        for (const id of row) want[id] = asks[id].length ? asks[id].reduce((s, v) => s + v, 0) / asks[id].length : Infinity;
        let x = PAD;
        for (const id of row.slice().sort((a, b) => want[a] - want[b] || row.indexOf(a) - row.indexOf(b))) {
          x = Math.max(want[id] === Infinity ? rightEdge + GAP_X : want[id], x);
          pos[id] = { x, y, h: H[id] };
          x += W + GAP_X;
        }
      }
      for (const id of row) rightEdge = Math.max(rightEdge, pos[id].x + W);
      y += Math.max(...row.map(id => H[id])) + GAP_Y;
    }
    const canvasW = Math.max(sheetW + PAD * 2, rightEdge + PAD);

    const edges = [];
    for (const from of ids) {
      for (const to of calleesOf(prog, from)) {
        const a = pos[from], b = pos[to];
        const sx = a.x + W / 2 - 10, sy = a.y + a.h;
        const ex = b.x + W / 2 - 10, ey = b.y;
        const my = (sy + ey) / 2 - 6;
        edges.push({
          from, to,
          call: `M${sx},${sy} L${sx},${my} L${ex},${my} L${ex},${ey}`,
          err: `M${ex + 20},${ey} L${ex + 20},${my + 12} L${sx + 20},${my + 12} L${sx + 20},${sy}`,
          hasE: ((prog.nodes[to].channels || {}).E || []).length > 0,
        });
      }
    }

    return { pos, edges, order, width: W, canvasW, canvasH: y - GAP_Y + PAD };
  }

  /* -- the tree ------------------------------------------------------------
   *
   * One row is a call site, not a node, so a node called twice appears twice
   * and the text matches the tree on the page. A repeated node is marked and
   * stopped, or a cycle never terminates.
   */
  function treeRows(prog, walk, layerName, atIndex, states) {
    const all = states || fold(prog, walk);
    const end = all[atIndex === undefined ? all.length - 1 : atIndex];
    const openSites = new Set(end.frames.map(f => f.site));
    const layer = (prog.layers || {})[layerName];
    const rows = [];

    const markOf = (siteKey, nodeId, at) => {
      const s = end.sites[siteKey];
      if (!s || !s.entered) return 'not reached';
      return s.effects[`${nodeId}[${at}]`] || 'not reached';
    };
    const stateOf = siteKey => {
      const s = end.sites[siteKey];
      if (!s || !s.entered) return 'not reached';
      if (openSites.has(siteKey)) return 'on stack';
      return 'returned';
    };

    (function walkNode(id, siteKey, depth, path, site) {
      const node = prog.nodes[id];
      if (!node) return;
      const repeat = path.includes(id);
      const ch = node.channels || {};
      const rename = layer && layer.nodes && layer.nodes[id] ? layer.nodes[id].R : null;
      rows.push({
        depth,
        id,
        name: node.name,
        role: node.role,
        A: ch.A,
        E: (ch.E || []).slice(),
        R: (ch.R || []).slice(),
        rename: rename ? rename.slice() : null,
        site: site ? { label: site.label, aside: site.aside } : null,
        state: stateOf(siteKey),
        effects: effectsOf(node).map(e => ({ kind: e.kind, desc: e.desc, mark: markOf(siteKey, id, e.at) })),
        repeat,
      });
      if (repeat) return;
      for (const s of callSites(node)) {
        if (!prog.nodes[s.target]) continue;
        walkNode(s.target, `${id}#${s.at}`, depth + 1, path.concat([id]), s);
      }
    })(prog.entry, '@entry', 0, [], null);

    return rows;
  }

  /** The longest walk. It is the only rule that names exactly one run in all
   *  three worked programs with no tie, so it is the one the text suggests. */
  function suggestRun(prog) {
    let best = 0;
    prog.presets.forEach((p, i) => {
      if (p.walk.steps.length > prog.presets[best].walk.steps.length) best = i;
    });
    return best;
  }

  return { esc, ID, labelsOf, callSites, calleesOf, effectsOf, fold, back, cutEdges, layout, treeRows, suggestRun, renamedToken };
})();
if (typeof module !== 'undefined') module.exports = Groundtrack;
