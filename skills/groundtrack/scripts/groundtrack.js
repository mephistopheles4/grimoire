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
   * what makes an id a known-safe string by the time the page sees it.
   *
   * That is a claim about attributes and about nothing else. See `bare` below:
   * as an object key an id is as dangerous as any other author string, and
   * this pattern is no defence at all. */
  const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

  /** An object with no prototype, for any map keyed by text out of the file.
   *
   * **Nothing out of the file is safe as a key, ids included.** A plain `{}`
   * inherits from `Object.prototype`, so a key nobody set still answers: the
   * ID pattern above admits `constructor`, `toString`, `valueOf`,
   * `hasOwnProperty` and `isPrototypeOf`, and tags, labels, paths, run names
   * and layer tokens are not validated at all. Only `__proto__` is excluded,
   * and only over its underscore.
   *
   * Read `t[k] || fallback` on such a table and the fallback never fires; read
   * `t[k] === undefined` and the guard never fires. Neither throws where it
   * happens, so the failure surfaces somewhere else — as a crash, or worse as a
   * refusal naming the wrong thing. SECURITY.md carries the rule.
   */
  const bare = () => Object.create(null);

  /** `bare()` seeded from entries, for the tables built in one go. */
  const bareFrom = entries => Object.assign(bare(), Object.fromEntries(entries));

  /** Rebuild a parsed file's author-keyed maps with no prototype.
   *
   * The tables this module builds are `bare()` by construction. **The biggest
   * author-keyed map is not built here at all** — `JSON.parse` builds it, and
   * it builds a plain object. So `prog.nodes.constructor` answers with a
   * function for a node the file never declared, and every membership test
   * over the node map reads true for five names the author never wrote.
   *
   * The damage is not a crash. `render.mjs` refuses a call whose target is not
   * a node with `if (!prog.nodes[s.target])`, and that guard silently stops
   * firing: a file calling a node that does not exist validates clean and
   * exits zero. A validator that accepts a file contradicting its own graph is
   * the one thing this validator exists to prevent.
   *
   * Hardening once at the boundary fixes every reader at the same time,
   * including the ones nobody has audited. The maps are the five the shape
   * document calls author-keyed: `nodes`, `env`, `layers`, a layer's `nodes`,
   * and a run's `input`. A copy rather than a mutation, so the caller's parsed
   * object is left as it found it.
   */
  function hardenKeys(prog) {
    if (!prog || typeof prog !== 'object' || Array.isArray(prog)) return prog;
    const isMap = o => o !== null && typeof o === 'object' && !Array.isArray(o);
    const rebuild = o => (isMap(o) ? Object.assign(bare(), o) : o);
    const out = { ...prog };
    if (prog.nodes !== undefined) out.nodes = rebuild(prog.nodes);
    if (prog.env !== undefined) out.env = rebuild(prog.env);
    if (isMap(prog.layers)) {
      out.layers = rebuild(prog.layers);
      for (const name of Object.keys(out.layers)) {
        const layer = out.layers[name];
        if (isMap(layer) && layer.nodes !== undefined) out.layers[name] = { ...layer, nodes: rebuild(layer.nodes) };
      }
    }
    const hardenRuns = runs =>
      runs.map(p => (isMap(p) && p.input !== undefined ? { ...p, input: rebuild(p.input) } : p));
    if (Array.isArray(prog.presets)) out.presets = hardenRuns(prog.presets);
    if (Array.isArray(prog.graphs)) {
      out.graphs = prog.graphs.map(g => (isMap(g) && Array.isArray(g.presets) ? { ...g, presets: hardenRuns(g.presets) } : g));
    }
    return out;
  }

  /* -- one change, several graphs ------------------------------------------
   *
   * A file states one change: its facts, one node map, and a list of graphs. A
   * graph is an entry point and the runs from it. Everything below this reads
   * one graph at a time, so everything below this reads a *view*: the change's
   * node map with one graph's entry and runs laid on top.
   *
   * The view exists so that the fold, the tree and the page did not have to
   * learn about the container. A node belongs to no graph — two graphs reach
   * the same node by both reaching it — so there is nothing to slice out of
   * `nodes`, and a view is a rename rather than a copy of the graph.
   *
   * **A file-wide reader must go through `graphs`, never through `presets`.**
   * `presets` on a view is one graph's runs, and on the file itself it does
   * not exist at all — so a rule that wants every walk in the file and reads
   * `prog.presets` is silently one graph's answer in the first case and
   * silently nothing in the second. Neither throws and neither is visible in a
   * one-graph file, which is every example that ships today. The view carries
   * `graphs` through untouched for exactly this reason: write
   * `prog.graphs.flatMap(g => g.presets)` and the reader is right whether it
   * was handed the file or a view. `findings` and `text` in render.mjs both
   * do. Per-graph readers — the fold, the tree, the drawing — take the view
   * and read `presets`, which is what a view is for.
   */
  const graphView = (prog, i) => {
    const graph = prog.graphs[i || 0];
    return Object.assign({}, prog, { entry: graph.entry, presets: graph.presets, graph });
  };

  /** Everything one sheet remembers, seeded for a graph the reader has not
   *  opened yet.
   *
   *  A page with several sheets keeps one of these per graph and swaps between
   *  them, so a reader who leaves a sheet and comes back finds their run, their
   *  cursor, their layer, their view and their open node where they left them.
   *  It is here rather than in the template because a state that a reader can
   *  lose by clicking twice is worth a test, and a test needs it without a DOM.
   *
   *  The layer is one of the five, so it is the sheet's like the rest: a sheet
   *  opened for the first time starts on the file's first layer, whatever
   *  layer the sheet the reader came from is on. What belongs to the change is
   *  the layer *map* — every sheet is offered the same buttons, because a
   *  layer renames a token wherever that token is. Which of them is lit is a
   *  question about this sheet. */
  function sheetState(prog, i) {
    const view = graphView(prog, i);
    const layerNames = Object.keys(prog.layers || {});
    return {
      view,
      layout: layout(view),
      run: 0,
      at: 0,
      states: fold(view, view.presets[0].walk),
      layer: layerNames.length ? layerNames[0] : null,
      open: view.entry,
      tab: 'source',
      tree: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      playing: null,
      /* The edge the last step moved along, kept until the next step so the
         animation on it runs the whole time the cursor rests there. */
      redraw: null,
    };
  }

  /** The sheet picker, as markup, or nothing at all for a one-graph file.
   *
   *  Rendered into the page rather than built by its script, for the same
   *  reason `filesMarkup` is here: a control the script creates is in no
   *  rendered page as a string, so no test can count one per graph. The run
   *  picker is built at runtime and cannot be checked that way; this one can.
   *
   *  A title is author text and goes through `esc` into element content. An id
   *  reaches an attribute, so it is validated rather than escaped — and a file
   *  the validator has not seen carries none, which is why the pattern is
   *  tested here too and not only in `render.mjs`.
   *
   *  The option's value is the index, because that is what the page indexes
   *  its sheets by. `data-graph` carries the id beside it, and no script reads
   *  it: it is there so the id a reader needs for `--text --graph <id>` is in
   *  the page they are looking at, rather than only in the file. */
  function sheetPickerMarkup(prog) {
    const graphs = (prog && prog.graphs) || [];
    if (graphs.length < 2) return '';
    const options = graphs
      .map((g, i) =>
        '<option value="' + i + '"' + (ID.test(String(g.id)) ? ' data-graph="' + g.id + '"' : '') +
        '>' + esc(g.title) + '</option>')
      .join('');
    return (
      '<label class="dw-label" for="sheet">sheet</label>' +
      '<select id="sheet" data-help="Which graph of this change to draw. One change, one file: each entry point is a sheet, and each sheet keeps its own run, cursor, layer, view and open node.">' +
      options +
      '</select>'
    );
  }

  /** What one entry reaches through call edges. That set is what a graph draws. */
  function reachable(prog, entry) {
    const seen = new Set();
    (function go(id) {
      if (seen.has(id) || !prog.nodes[id]) return;
      seen.add(id);
      for (const s of prog.nodes[id].steps || []) if (s.op === 'call') go(s.target);
    })(entry);
    return seen;
  }

  /* -- reading the graph ---------------------------------------------------- */

  /** label -> step index, for one node. A label is a jump target and nothing else. */
  const labelsOf = node => {
    const m = bare();
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

  /* -- the failure kind ----------------------------------------------------
   *
   * The three kinds a failure can be, in the order they print. A retry is a
   * blip, a die is a crash, and an escape is between them, so a tag carrying
   * two reads worst-last.
   */
  const KINDS = ['retry', 'escape', 'die'];

  /** tag -> the kinds the file gives it, in KINDS order.
   *
   * Two sources, and only two: a `throw` step in the node map, and an effect
   * move that `raised` in a walk. Both name a channel, and between them they
   * are every place the file says what kind of failure a tag is. A tag named
   * nowhere but an E channel is absent from this table, and prints bare — the
   * page does not invent a kind the file never stated.
   *
   * An `onError` handler is not a source. It names the tag it catches and no
   * channel: it says where a failure stops, never what kind it was. Nor is a
   * walk's `throw` move, which repeats the channel of the step it ran — one
   * fact, written once, read from the step.
   *
   * It is derived rather than declared for the same reason a cut edge is: a
   * second place to write the kind is a second place for it to be wrong.
   */
  function failureKinds(prog) {
    const seen = bare();
    const add = (tag, channel) => {
      if (tag === undefined || !KINDS.includes(channel)) return;
      (seen[tag] = seen[tag] || new Set()).add(channel);
    };
    /* `nodes` and `graphs` are core fields the validator requires, so neither
     * is guarded here. A guard could never fire on a file this module is given
     * today, and would earn its keep only by hiding the day one of them stops
     * being where it is — returning a table missing every kind that a `raised`
     * move supplies, with no error and nothing to notice. Let that throw.
     *
     * The kind is file-wide, so the walks are read through `graphs` rather
     * than through `presets`. A view carries `graphs` untouched, so this is
     * right whether it is handed the file or one graph's view — and reading
     * `presets` would be wrong both ways: one graph's walks on a view, and
     * nothing at all on the file, where the field does not exist. A tag that
     * only another graph's walk raises would have printed bare. */
    for (const node of Object.values(prog.nodes)) {
      for (const s of node.steps || []) if (s.op === 'throw') add(s.tag, s.channel);
    }
    for (const p of prog.graphs.flatMap(g => g.presets)) {
      for (const m of (p.walk && p.walk.steps) || []) {
        if (m.k === 'effect' && m.raised) add(m.raised.tag, m.raised.channel);
      }
    }
    const out = bare();
    for (const tag of Object.keys(seen)) out[tag] = KINDS.filter(k => seen[tag].has(k));
    return out;
  }

  /** What one node does with one tag: throws it, catches it, both, or neither.
   *  Neither means the tag passes up from beneath, which is the third thing
   *  the contract tab has to be able to say. */
  const tagFate = (node, tag) => ({
    throws: (node.steps || []).some(s => s.op === 'throw' && s.tag === tag),
    catches: (node.steps || []).some(s => (s.onError || []).some(h => h.tag === tag)),
  });

  /* Cyclomatic complexity of one node, as drawn: one, plus one for each place
   * the path forks. An `if` forks. Each onError handler forks, since the call
   * or effect it guards can go on or be caught. A jump backward — a goto, or
   * an if branch, that lands at or before its own step — closes a loop, and a
   * loop is one more independent path.
   *
   * It is the complexity of the drawing and not of the code. The author chose
   * which branches to draw, and a node whose steps are one note has a value
   * of one however the real function reads. Cognitive complexity is not
   * computed, on purpose: it weights nesting depth, and a flat step list with
   * labels does not carry nesting, so any number would be a guess.
   */
  function complexityOf(node) {
    const L = labelsOf(node);
    let ifs = 0, handlers = 0, loops = 0;
    (node.steps || []).forEach((s, i) => {
      if (s.op === 'if') {
        ifs += 1;
        for (const k of ['then', 'else']) if (L[s[k]] !== undefined && L[s[k]] <= i) loops += 1;
      }
      if (s.op === 'goto' && L[s.to] !== undefined && L[s.to] <= i) loops += 1;
      handlers += (s.onError || []).length;
    });
    return { value: 1 + ifs + handlers + loops, ifs, handlers, loops };
  }

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

  /* A sheet draws one graph, and one graph is what its entry reaches. So the
   * drawing places the reachable set and not the node map: on a change with
   * two entries the other entry's nodes belong to the other sheet, not to this
   * one greyed out. Takes a view, because only a view has an entry.
   *
   * Every shipped example reports no unreached node, so no one-graph drawing
   * moves by a pixel — which is the promise, and the reason this could be
   * settled here rather than argued from a screenshot.
   *
   * Loud on a file, for the reason `filesOf` is: `reachable(prog, undefined)`
   * is the empty set, so a drawing with no boxes in it is what a caller that
   * passed the file rather than the view would get, with nothing said. */
  function layout(prog) {
    if (!prog.entry) {
      throw new Error('layout needs a graph view: a file lists graphs and has no entry of its own');
    }
    const ids = [...reachable(prog, prog.entry)];
    const depth = bareFrom(ids.map(i => [i, 0]));
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

    const rows = {};
    for (const id of order) (rows[depth[id]] = rows[depth[id]] || []).push(id);

    /* The box, measured on the page at 1:1: 12 + 12 padding, a 21 top row —
     * 23 when it carries a state chip, which is the height taken here so no
     * wire starts inside a box — a 24 name, a 19 location, a 71 channel
     * block, and 22 for each effect row under it. The two small type sizes
     * moved up one step, and these moved with them. */
    const H = Object.fromEntries(ids.map(id => [id, 163 + effectsOf(prog.nodes[id]).length * 22]));
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
    const pos = bare();
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
        const asks = bareFrom(row.map(id => [id, []]));
        for (const c of ids) {
          if (!pos[c]) continue;
          const kids = calleesOf(prog, c).filter(k => asks[k]);
          kids.forEach((k, i) => asks[k].push(pos[c].x + (i - (kids.length - 1) / 2) * (W + GAP_X)));
        }
        const want = bare();
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
    /* One table for the whole file, computed once here and carried on every
     * row, so the tree on the page and the tree in a reply read the same tag
     * the same way. */
    const kinds = failureKinds(prog);
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
        kinds: (ch.E || []).reduce((m, t) => (kinds[t] ? ((m[t] = kinds[t].slice()), m) : m), bare()),
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

  /** Files in the change that no node touches, in the order the change states
   *  them. A question about the whole file, not about one node, and this is
   *  the change-wide answer: `--check` reports it as a finding, so a file one
   *  graph covers is not reported because another does not.
   *
   *  The files tab asks a narrower question with the same words — see
   *  `filesOf`. Read `ids` to choose which: every node of the change here, one
   *  sheet's nodes there. */
  function unaccountedFiles(prog, ids) {
    const nodes = ids || Object.keys(prog.nodes);
    const touched = new Set();
    for (const id of nodes) for (const p of prog.nodes[id].touches || []) touched.add(p);
    return (prog.files || []).filter(f => !touched.has(f.path)).map(f => f.path);
  }

  /** The three groups the files tab shows around one open node: what it
   *  changes, what the other nodes *on this sheet* change, and what the change
   *  touches that no node *of this sheet* accounts for. A file two nodes touch
   *  is listed against both.
   *
   *  **All three are the sheet's**, which is what makes them a partition: every
   *  file the change states lands in exactly one of them, and a reader on this
   *  sheet is never left wondering where a path went. Narrow the second group
   *  without narrowing the third and they stop covering: a file only the other
   *  sheet's nodes touch is in neither, and no group's label says so.
   *
   *  That is the spec's own pairing rather than a choice made here. Its story
   *  28 wants this group *labelled as this sheet's, so that I do not take a
   *  per-sheet list for the change-wide one*, and its story 29 wants the
   *  change-wide one from `--check`. Two questions, two answers, and both
   *  printed — the tab's here, the check's from `unaccountedFiles` with no
   *  `ids`. On a one-graph file they are the same set, which is why the three
   *  shipped examples read exactly as they did.
   *
   *  Which means this takes the **view**, not the file. Handed the file,
   *  `prog.entry` is undefined, the reachable set is empty, and the tab would
   *  put every file in the third group under a label saying no node touches
   *  them. It throws instead. */
  function filesOf(prog, id) {
    if (!prog.entry) {
      throw new Error('filesOf needs a graph view: a file lists graphs and has no entry of its own');
    }
    /* No guard on the node itself. `id` is the open node, which starts at the
       entry and only ever moves to a node the walk is in, and the validator
       requires both to be in the map. A guard here could not fire today, and
       the day it could is the day an empty first group would be a wrong answer
       printed in place of a crash. `touches` is optional, so that one stays. */
    const onSheet = [...reachable(prog, prog.entry)];
    const mine = [...new Set(prog.nodes[id].touches || [])];
    const others = [];
    const seen = new Set();
    for (const k of onSheet) {
      if (k === id) continue;
      for (const p of prog.nodes[k].touches || []) if (!seen.has(p)) { seen.add(p); others.push(p); }
    }
    return { mine, others, unaccounted: unaccountedFiles(prog, onSheet) };
  }

  /** Paths as a shallow directory tree, flattened to rows the caller indents.
   *
   *  A row is a directory when it carries no `path` and a file when it does.
   *  `label` is what prints; joined to the labels of its ancestors it is the
   *  path again, which is the invariant that keeps a collapsed row honest.
   *
   *  A directory with one thing under it says nothing its child does not say,
   *  so it collapses into the line below. Order is first appearance, because
   *  the author ordered the change's files and a tree should keep what of that
   *  order it can. */
  function fileTree(paths) {
    const root = { kids: new Map(), file: null };
    for (const p of paths || []) {
      const path = String(p);
      let at = root;
      for (const seg of path.split('/')) {
        if (!at.kids.has(seg)) at.kids.set(seg, { kids: new Map(), file: null });
        at = at.kids.get(seg);
      }
      at.file = path;
    }
    const rows = [];
    (function walk(node, depth) {
      for (const [seg, kid] of node.kids) {
        const parts = [seg];
        let cur = kid;
        while (!cur.file && cur.kids.size === 1) {
          const [s, k] = cur.kids.entries().next().value;
          parts.push(s);
          cur = k;
        }
        const label = parts.join('/');
        rows.push(cur.file ? { depth, label, path: cur.file } : { depth, label });
        if (cur.kids.size) walk(cur, depth + 1);
      }
    })(root, 0);
    return rows;
  }

  /** The files tab, as markup.
   *
   *  Everything else here returns data and leaves the markup to the page. This
   *  one does not, and the reason is the seam. The tab is written into the
   *  cutaway with `innerHTML` when a reader clicks it, so it is in no rendered
   *  page as a string: markup left in the template is markup no test can reach,
   *  and three of the strings below carry author text through `esc`. Put it
   *  here and the page and the test run the same function, which is the same
   *  bargain the fold makes.
   *
   *  The marks are a closed vocabulary the validator already refuses anything
   *  outside of. Nothing else on a row is. */
  const MARK = Object.freeze({ new: 'N', edit: 'E', delete: 'D', forbidden: 'F' });
  function filesMarkup(prog, id) {
    const { mine, others, unaccounted } = filesOf(prog, id);
    /* Keyed by author text, so it does not read through to Object's own
       properties: a path called "constructor" would otherwise find a function
       and print it. */
    const byPath = Object.create(null);
    for (const f of prog.files || []) byPath[f.path] = f;
    /* A path a node touches that the change does not state has no entry to
       read, so it prints as an edit of no stated size rather than not at all. */
    const fileRow = row => {
      const f = byPath[row.path] || { change: 'edit', why: '', adds: 0, dels: 0 };
      return (
        '<div class="frow"><span class="fchange">' + (Object.hasOwn(MARK, f.change) ? MARK[f.change] : '?') + '</span>' +
        '<span class="fpath">' + esc(row.label) +
        (f.why ? ' <span class="fwhy">&mdash; ' + esc(f.why) + '</span>' : '') + '</span>' +
        '<span class="fnum">+' + esc(f.adds) + ' &minus;' + esc(f.dels) + '</span></div>'
      );
    };
    const tree = paths => {
      let out = '';
      let depth = 0;
      for (const row of fileTree(paths)) {
        while (depth > row.depth) { out += '</div>'; depth--; }
        while (depth < row.depth) { out += '<div class="ftree">'; depth++; }
        out += row.path ? fileRow(row) : '<div class="fdir">' + esc(row.label) + '/</div>';
      }
      while (depth > 0) { out += '</div>'; depth--; }
      return out;
    };
    const group = (label, paths) =>
      '<div class="fgroup"><span class="dw-label">' + label + '</span>' +
      (paths.length ? tree(paths) : '<div class="dw-annot">none</div>') + '</div>';
    /* A file that states no changed files has no change to account for, so
       the third group says that rather than drawing an empty tree. */
    const third = prog.files
      ? group('in the change, on no node of this sheet', unaccounted)
      : '<div class="fgroup"><span class="dw-label">changed files</span><div class="dw-annot">not stated by this file</div></div>';
    return group('this node', mine) + group('other nodes on this sheet', others) + third;
  }

  /** The band under the drawing, as markup.
   *
   *  Here rather than in the page for the reason `filesMarkup` is: it is
   *  written into the footer with `innerHTML`, so it is in no rendered page as
   *  a string and no test could otherwise read a word of it. It carries four
   *  author strings through `esc`, and it is where the cut is audited — which
   *  makes it exactly the wrong thing to leave untested.
   *
   *  Three of the four facts are the change's and are stated once, at the
   *  level the cut was made. `graphsNotDrawn` means *found, and in no sheet of
   *  this file*, so a sibling sheet is never listed there — a graph the file
   *  carries is drawn. The fourth is the sheet's: the graph's own blurb, which
   *  is what this entry point does, and the only place a graph's `blurb` is
   *  printed at all. */
  function sheetFactsMarkup(prog) {
    const bits = ['<span><b>blurb</b> ' + esc(prog.blurb) + '</span>'];
    const graph = prog.graph || {};
    if (graph.blurb) bits.push('<span><b>this sheet</b> ' + esc(graph.blurb) + '</span>');
    const sheet = prog.sheet || {};
    if (sheet.scopeRule) bits.push('<span><b>scope rule</b> ' + esc(sheet.scopeRule) + '</span>');
    if ((sheet.graphsNotDrawn || []).length) {
      bits.push('<span><b>not drawn</b> ' + esc(sheet.graphsNotDrawn.join(', ')) + '</span>');
    }
    return bits.join('');
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

  return { esc, ID, bare, hardenKeys, KINDS, graphView, sheetState, sheetPickerMarkup, sheetFactsMarkup, reachable, labelsOf, callSites, calleesOf, effectsOf, failureKinds, tagFate, complexityOf, fold, back, cutEdges, layout, treeRows, unaccountedFiles, filesOf, fileTree, filesMarkup, suggestRun, renamedToken };
})();
if (typeof module !== 'undefined') module.exports = Groundtrack;
