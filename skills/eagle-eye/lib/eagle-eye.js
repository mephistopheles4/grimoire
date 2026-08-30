
const EagleEye = (() => {
  const TIER_RANK = { measured: 3, sourced: 2, argued: 1 };

  function index(box){
    const optById = {}, chosenOf = {};
    box.dims.forEach(d => { d.opts.forEach(o => { optById[o.id] = { ...o, dim: d }; }); chosenOf[d.id] = d.opts.find(o => o.chosen).id; });
    return { optById, chosenOf };
  }

  // sel: {dimId: optId}. touched: Set of dimIds the user has clicked in. Returns everything the panel needs.
  function analyse(box, sel, touched = new Set()){
    const { optById, chosenOf } = index(box);
    const selected = new Set(Object.values(sel));
    const overrides = box.dims.filter(d => sel[d.id] !== chosenOf[d.id]).map(d => sel[d.id]);
    const conflicts = [], unmet = [], met = [], closed = new Map(), pulled = new Map();
    const edgesOf = id => (box.rel[id]?.rel || []).map(([tid, kind, why, tier, src]) => ({ from: id, to: tid, kind, why, tier: tier || 'argued', src }));

    selected.forEach(id => edgesOf(id).forEach(e => {
      if (optById[e.to].dim.id === optById[id].dim.id) return; // same row: a swap, not a relation
      const tSel = selected.has(e.to);
      if (e.kind === 'conf') { if (tSel) { if (!conflicts.some(c => c.from === e.to && c.to === e.from)) conflicts.push(e); } else closed.set(e.to, (closed.get(e.to) || []).concat(e)); }
      else { if (tSel) met.push(e); else { unmet.push(e); pulled.set(e.to, (pulled.get(e.to) || []).concat(e)); } }
    }));

    // A chosen set can be broken. Test the edges before the change count, or "as chosen" hides
    // the conflict the author wrote into the baseline — the one state nobody clicks to discover.
    const verdict = conflicts.length ? 'does not hold' : unmet.length ? 'incomplete' : !overrides.length ? 'as chosen' : 'consistent';
    const active = conflicts.concat(unmet, met);
    const basis = active.length ? Object.entries(active.reduce((m, e) => (m[e.tier] = (m[e.tier] || 0) + 1, m), {})) : [];

    // ---- the six moves ----
    const moves = [];

    // 1. untouched row: bound to the most overridden rows, never clicked.
    const overriddenDims = new Set(overrides.map(id => optById[id].dim.id));
    const bindCount = {};
    box.dims.forEach(d => { if (overriddenDims.has(d.id) || touched.has(d.id)) return;
      let n = 0; d.opts.forEach(o => edgesOf(o.id).forEach(e => { if (overriddenDims.has(optById[e.to].dim.id)) n++; }));
      overrides.forEach(id => edgesOf(id).forEach(e => { if (optById[e.to].dim.id === d.id) n++; }));
      if (n) bindCount[d.id] = n; });
    // Report the whole backlog, not just its head. Naming one row at a time reads as though opening
    // it did nothing: the reader clicks, the finding returns naming the next row, and the fix looks broken.
    const ranked = Object.entries(bindCount).sort((a, b) => b[1] - a[1]);
    const untouched = ranked[0];
    if (untouched) {
      const rest = ranked.length - 1;
      moves.push({ kind: 'row not opened', text: `<b>${box.dims.find(d => d.id === untouched[0]).name}</b> has ${untouched[1]} edge${untouched[1] > 1 ? 's' : ''} to the rows you changed. You did not open it. Open it.${rest ? ` ${rest} more row${rest > 1 ? 's are' : ' is'} still unopened.` : ''}` });
    }

    // 2. weakest edge under the verdict
    const weakest = active.slice().sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])[0];
    if (weakest && overrides.length) moves.push({ kind: 'weakest edge', text: `The verdict depends on the edge <b>${optById[weakest.from].dim.name} ${weakest.kind === 'conf' ? 'vs' : 'needs'} ${optById[weakest.to].dim.name}</b>. This edge is <span class="tier ${weakest.tier}">${weakest.tier}</span>. “${weakest.why}” ${weakest.tier === 'argued' ? 'Nobody measured it. Measure this edge first.' : weakest.tier === 'sourced' ? 'A document says so. Read the source.' : ''}` });

    // 3. load-bearing option: the selected cell with the most edges to other selected cells (either direction)
    const degree = {};
    selected.forEach(id => { degree[id] = 0; });
    selected.forEach(id => edgesOf(id).forEach(e => { if (optById[e.to].dim.id === optById[id].dim.id) return;
      degree[id]++; if (selected.has(e.to)) degree[e.to]++; }));
    const lb = Object.entries(degree).sort((a, b) => b[1] - a[1])[0];
    if (lb && lb[1]) moves.push({ kind: 'most connected', text: `<b>${optById[lb[0]].dim.name}: ${optById[lb[0]].short || optById[lb[0]].label}</b> has ${lb[1]} edge${lb[1] === 1 ? '' : 's'} to the other selected options. If you change this option, the most options change with it.` });

    // 4. free rows: no edges in or out, any option
    const inbound = new Set(); box.dims.forEach(d => d.opts.forEach(o => edgesOf(o.id).forEach(e => inbound.add(optById[e.to].dim.id))));
    const free = box.dims.filter(d => !inbound.has(d.id) && d.opts.every(o => edgesOf(o.id).length === 0));
    if (free.length) moves.push({ kind: 'row with no edges', text: `<b>${free.map(d => d.name).join(', ')}</b> ${free.length > 1 ? 'have' : 'has'} no edges. Decide ${free.length > 1 ? 'these rows' : 'this row'} alone, or add the edge that is missing.` });

    // 5. survived strawmen: strawman options not ruled out by the selection, whose own conflicts are not selected
    const survived = [];
    box.dims.forEach(d => d.opts.filter(o => o.strawman).forEach(o => {
      if (selected.has(o.id)) return;
      const ruledOut = closed.has(o.id);
      const wouldConflict = edgesOf(o.id).some(e => e.kind === 'conf' && selected.has(e.to) && optById[e.to].dim.id !== d.id);
      // a selected option that requires a *different* option in this row excludes the strawman just as surely as a conflict
      const pulledAway = [...selected].some(sid => optById[sid].dim.id !== d.id && edgesOf(sid).some(e => e.kind === 'req' && optById[e.to].dim.id === d.id && e.to !== o.id));
      if (!ruledOut && !wouldConflict && !pulledAway) survived.push(optById[o.id]);
    }));
    if (survived.length) moves.push({ kind: 'strawman not rejected', text: `${survived.map(o => `<b>${o.dim.name}: ${o.short || o.label}</b>`).join('; ')}. No selected option rules ${survived.length > 1 ? 'these strawmen' : 'this strawman'} out. Give the reason to reject ${survived.length > 1 ? 'them' : 'it'}, or pick ${survived.length > 1 ? 'one' : 'it'}.` });

    // 6. cogency
    const argued = active.filter(e => e.tier === 'argued').length;
    // Branch on the edges, not on the change count. A set with no overrides can still carry
    // conflicts, and a set with overrides can still touch no edge. Both read as tested when
    // the count decides, and both are untested.
    // "Nobody measured them" is only true of the argued edges. A set whose active edges are all
    // measured or sourced is the strong case, and saying it is untested inverts the finding.
    const evidenced = active.filter(e => e.tier !== 'argued');
    moves.push({ kind: 'cogency', text: !active.length
      ? `No edge reaches this set, so nothing in the box tested it. Add the edge that is missing, or change an option to see which edges hold.`
      : argued
        ? `${argued} of ${active.length} active edge${active.length === 1 ? '' : 's'} ${argued === 1 ? 'is' : 'are'} argued. Nobody measured ${argued === 1 ? 'that one' : 'those'}. If all the edges are true, the verdict is “${verdict}”. If one argued edge is false, the verdict can change.`
        : `Every active edge carries evidence: ${evidenced.filter(e => e.tier === 'measured').length} measured, ${evidenced.filter(e => e.tier === 'sourced').length} sourced. If all the edges are true, the verdict is “${verdict}”.` });

    // affected rows for coach mode: rows whose cells changed colour because of the overrides
    // only edges that involve an override count — what the chosen set rules out on its own is the baseline, not a change
    const affected = new Set();
    const viaOverride = e => overriddenDims.has(optById[e.from].dim.id) || overriddenDims.has(optById[e.to].dim.id);
    conflicts.filter(viaOverride).forEach(e => { affected.add(optById[e.from].dim.id); affected.add(optById[e.to].dim.id); });
    unmet.filter(viaOverride).forEach(e => affected.add(optById[e.to].dim.id));
    closed.forEach((es, tid) => { if (es.some(viaOverride)) affected.add(optById[tid].dim.id); });
    overriddenDims.forEach(d => affected.delete(d));

    return { optById, chosenOf, selected, overrides, conflicts, unmet, met, closed, pulled, verdict, basis, moves, affected, suspected: box.suspected || [] };
  }

  return { analyse, index };
})();
if (typeof module !== 'undefined') module.exports = EagleEye;
