/* Artboards for ticket #33, on #28's amended answer: the artifact steps over a
   RECORDED WALK and there is still no engine.
   Base is prototypes/callgraph-sheet/view.html — _sheet.css holds its CSS with
   values copied, _plan.html comes from gen-plan.mjs re-running its layout() and
   its renderPlan() weights over pr-313-first-paint.json, preset "the sheet
   404s". Captions carry measure.mjs numbers. Run: node build.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./_sheet.css', import.meta.url), 'utf8');
const PLAN = readFileSync(new URL('./_plan.html', import.meta.url), 'utf8');
const TREE = readFileSync(new URL('./_tree.html', import.meta.url), 'utf8');

/* PROPOSED — the tool block: every control that changes how the sheet is READ.
   Zoom was already here; layer and diagram type join it. Zoom greys out in tree
   mode, which is the .btn[disabled] treatment view.html already defines. */
const toolblock = (scaleLabel, kind = 'drawing') => `        <div class="toolblock">
          <div class="grp">
            <span class="grp-k">Zoom</span>
            <button ${kind === 'tree' ? 'disabled' : ''} title="Zoom out">−</button>
            <span class="now">${kind === 'tree' ? '—' : scaleLabel}</span>
            <button ${kind === 'tree' ? 'disabled' : ''} title="Zoom in">+</button>
            <button ${kind === 'tree' ? 'disabled' : ''}>Fit</button>
          </div>
          <div class="grp">
            <span class="grp-k">Layer</span>
            <button class="{{ prodOn }}" onClick="{{ pickProd }}">Production</button>
            <button class="{{ testOn }}" onClick="{{ pickTest }}">Tests</button>
          </div>
          <div class="grp">
            <span class="grp-k">View</span>
            <button class="${kind === 'drawing' ? 'on' : ''}">Drawing</button>
            <button class="${kind === 'tree' ? 'on' : ''}">Tree</button>
          </div>
        </div>`;

/* view.html fit() over the 1368 x 783 drawing; applyView() writes the label.
   Height-bound in every configuration — the 22rem rail costs no scale at all. */
const K_BASE = 0.5926; // cut-h 15rem + rail + trace -> "1:1.69"
const K_SHORT = 0.6948; // cut-h 10rem                -> "1:1.44", +17%
const tx = (planW, K) => Math.round((planW - 1368 * K) / 2);

const LOGIC = `class Component extends DCLogic {
  renderVals() {
    const tests = this.state && this.state.layer === 'tests';
    return {
      prodClass: tests ? 'btn' : 'btn btn--run',
      testClass: tests ? 'btn btn--run' : 'btn',
      prodOn: tests ? '' : 'on',
      testOn: tests ? 'on' : '',
      chipText: tests ? 'substituted' : '',
      r_bindSheet: tests ? 'TextureLoader → stub' : 'THREE.TextureLoader',
      r_fibreMapFor: tests ? 'canvas 2d → node-canvas' : 'canvas 2d',
      pickProd: () => this.setState({ layer: 'production' }),
      pickTest: () => this.setState({ layer: 'tests' }),
    };
  }
}`;

/* -- regions --------------------------------------------------------------- */

const STEPPERS = `          <button class="btn">Restart</button>
          <button class="btn">← Back</button>
          <button class="btn">Step ↓</button>
          <button class="btn">Over</button>
          <button class="btn">Out ↑</button>
          <button class="btn btn--run">Run</button>
          <button class="btn">Auto</button>
          <button class="btn">IR</button>`;

/* As built plus #34's layer toggle, which has nowhere of its own to go. */
const headFull = () => `      <header class="head">
        <div class="head-id">
          <span class="dw-label">D-01</span>
          <span class="dw-h3" style="font-size: var(--dw-t-lead)">Call graph</span>
        </div>

        <select aria-label="Scenario"><option>PR #313 · first paint · the sheet 404s</option></select>


        <span class="toggle">Layer</span>
        <button class="{{ prodClass }}" onClick="{{ pickProd }}">Production</button>
        <button class="{{ testClass }}" onClick="{{ pickTest }}">Tests</button>

        <div class="btn-group">
${STEPPERS}
        </div>
      </header>`;

/* DELTA 3 / 5 — every read-time control moves into the diagram area, so the
   head carries only what drives the walk. */
const headSplit = () => `      <header class="head">
        <div class="head-id">
          <span class="dw-label">D-01</span>
          <span class="dw-h3" style="font-size: var(--dw-t-lead)">Call graph</span>
        </div>

        <select aria-label="Scenario"><option>PR #313 · first paint · the sheet 404s</option></select>


        <div class="btn-group">
${STEPPERS}
        </div>
      </header>`;

const plan = (K, planW, scaleLabel, tools = null) => `      <div class="plan dw-grid">
${tools
    ? toolblock(scaleLabel, tools)
    : `        <div class="scaleblock">
          <button title="Zoom out">−</button>
          <span id="scaleNow">${scaleLabel}</span>
          <button title="Zoom in">+</button>
          <button>1:1</button>
          <button>Fit</button>
        </div>`}
${tools === 'tree'
    ? `        <div class="tree">
${TREE.trimEnd()}
        </div>`
    : `        <div id="canvas" style="transform: translate(${tx(planW, K)}px, 12px) scale(${K}); width: 1368px; height: 783px">
${PLAN.trimEnd()}
        </div>`}
      </div>

      <div class="vsp"></div>
      <div class="hsp"></div>`;

/* The tape, with the recorded walk's position marked by .tp--here. */
const TAPE = [
  ['past', '', 'note', '<span class="dim">The sheet is bound where the material is made, so a roster of any size costs a default page one sheet.</span>'],
  ['past', '', 'call', '<span class="kw">resolveWoodwork</span>(requested: settings.materials.woodSpecies) → resolved'],
  ['past', '', 'call', '<span class="kw">worldSpaceUvs</span>(lay: resolved.lay) → uvs'],
  ['past', '', 'if', 'resolved.sheet === null ? <span class="kw">flat</span> : <span class="kw">bind</span>'],
  ['here', 'bind', 'call', '<span class="kw">bindSheet</span>(url: resolved.sheet.url) → sheet'],
  ['', '', 'goto', 'fibre'],
  ['', 'flat', 'note', '<span class="dim">flat binds no map at all — nothing on the wire for the woodwork</span>'],
  ['', 'fibre', 'call', '<span class="kw">applyWoodFibre</span>(scale: settings.materials.woodFibre, lay: resolved.lay) → fibreInForce'],
  ['', '', 'call', '<span class="kw">bindSheet</span>(url: $env.backboard.url) → backSheet<div class="dim">— a constant, not a knob: #297 measured all 41 veneers and the darkness constraint leaves one</div>'],
  ['', '', 'return', '({ species: resolved.species, fibre: fibreInForce, refused: resolved.refused })'],
];

const cut = () => `      <section class="cut">
        <div class="cut-head">
          <span class="dw-label">Section A-A</span>
          <span style="font-weight: 600">buildShelf</span>
          <span class="dw-annot">packages/site/src/shelf/scene.ts:1664</span>
          <span class="dw-annot">pc 4</span>
          <span class="tabs">
            <button class="tab tab--on">Source</button>
            <button class="tab">Files</button>
            <button class="tab">Contract</button>
          </span>
        </div>
        <div class="tape">
${TAPE.map(([state, label, op, src], i) => `          <div class="tp ${state === 'here' ? 'tp--here' : state === 'past' ? 'tp--past' : ''}"><button class="bp"></button><span class="tp-n dw-num">${i}</span><span class="tp-lbl">${label}</span><span class="tp-src">${src}</span></div>`).join('\n')}
        </div>
      </section>`;

/* The rail, as built — every block reads the recorded walk. Scope is the one
   that changes: its inputs forked the trace, and forking needs a reducer. */
const railWalk = (scopeReadOnly = false) => `      <aside class="side">
        <div class="blk holds">
          <label class="toggle"><input type="checkbox" /> hold on effect</label>
          <label class="toggle"><input type="checkbox" checked /> hold on error</label>
        </div>
        <div class="blk">
          <span class="dw-label">Call stack</span>
          <button class="frame">buildShelf <span class="dw-annot">pc 4</span></button>
          <button class="frame frame--top">bindSheet <span class="dw-annot">pc 0</span></button>
        </div>
        <div class="blk">
          <span class="dw-label">Scope${scopeReadOnly ? '' : ' — editable, forks the trace'}</span>
${scopeReadOnly
    ? `          <div class="var"><span class="var-k">url</span><span class="row-v">"/wood/rosewood-diff-1024.jpg"</span></div>
          <div class="var"><span class="var-k">rowCount</span><span class="row-v dw-num">5</span></div>
          <div class="var"><span class="var-k">species</span><span class="row-v">"rosewood"</span></div>
          <div class="var"><span class="var-k">woodFibre</span><span class="row-v dw-num">0.5</span></div>`
    : `          <div class="var"><span class="var-k">url</span><input value="&quot;/wood/rosewood-diff-1024.jpg&quot;" /></div>
          <div class="var"><span class="var-k">rowCount</span><input value="5" /></div>
          <div class="var"><span class="var-k">species</span><input value="&quot;rosewood&quot;" /></div>
          <div class="var"><span class="var-k">woodFibre</span><input value="0.5" /></div>`}
        </div>
        <div class="blk">
          <span class="dw-label">Error path</span>
          <div class="row"><span class="row-k caut">SheetMissing</span><span class="row-v">404</span></div>
          <div class="row"><span class="row-k">↳ caught</span><span class="row-v">bindSheet → warn</span></div>
        </div>
        <div class="blk" style="border-bottom: 0">
          <span class="dw-label">Effects ledger</span>
          <div class="led"><span class="led-seq dw-num">1</span><span class="led-body"><div class="caut">net.get — failed</div><div class="dim">/wood/rosewood-diff-1024.jpg</div></span></div>
          <div class="led"><span class="led-seq dw-num">2</span><span class="led-body"><div class="ok">console.warn — landed</div><div class="dim">did not load; the surface keeps its flat colour</div></span></div>
        </div>
      </aside>`;

const cell = (k, v) => `          <div class="dw-titleblock-cell">
            <span class="dw-titleblock-key">${k}</span>
            <span class="dw-titleblock-val">${v}</span>
          </div>`;

const TRACE = `            <div class="dw-dimension" style="flex: 1">
              <span class="dw-dimension-value">0</span>
              <span class="dw-dimension-tick"></span>
              <span class="trace-span">
                <span class="trace-rule"></span>
                <span class="trace-fill" style="width: 52%"></span>
                <span class="trace-tick" style="left: 52%"></span>
              </span>
              <span class="dw-dimension-tick"></span>
              <span class="dw-dimension-value">27</span>
            </div>`;

/* DELTA 4 — #31's two remaining per-graph facts as a footer band. They share
   the .trace row rather than taking one of their own, so the drawing loses no
   height: the fit is height-bound, and a new band would have cost it 9%. */
const SHEETFACTS = `            <div class="sheetfacts">
              <span><b class="dw-num">10/17</b> files on no node</span>
              <span><b class="dw-num">1</b> graph not drawn — panel apply</span>
              <span>scope: one graph per entry point</span>
            </div>`;

const block = (sheetFacts = false) => `      <footer class="block">
        <div class="dw-titleblock">
${cell('Program', 'PR #313 · first paint')}
${cell('Condition', 'the sheet 404s')}
${cell('Step', '<span class="dw-num">14 / 27</span>')}
${cell('Status', '<span class="dw-label">holding</span>')}
${cell('Notices', '<span class="dw-state dw-state--caution dw-num">2</span>')}
${cell('Sheet', 'D-01')}
          <div class="trace">
            <div class="traceband">
${sheetFacts ? SHEETFACTS + '\n' : ''}${TRACE}
            </div>
          </div>
        </div>
      </footer>`;

const sheet = ({ K = K_BASE, planW = 1086, scale = '1:1.69', cutH = '15rem',
                 head = headFull, rail = railWalk, tools = null, sheetFacts = false }) =>
  `    <div class="sheet-root" style="--cut-h: ${cutH}">
${head()}

${plan(K, planW, scale, tools)}

${cut()}

${rail()}

${block(sheetFacts)}
    </div>`;

/* -- boards ---------------------------------------------------------------- */

const boards = [
  {
    file: 'Main.dc.html', w: 1440, h: 900, css: '',
    body: sheet({}),
    logic: LOGIC,
  },
  {
    file: 'Contrast.dc.html', w: 1440, h: 900,
    css: `
    /* DELTA 1 — the annotation layer from ink-55 (3.53:1) to ink at 0.64
       (4.60:1), the lowest alpha clearing 4.5:1 against paper. Hairlines, the
       grid and the effect dot keep their alphas: drawn, not read. */
    :root { --dw-ink-64: rgb(34 38 43 / 0.64); }
    .dw-label, .nd-loc, .nd-ch, .fx, .fchange, .fnum, .fdir, .fwhy, .tab, .tp-lbl,
    .row-k, .dim, .dw-titleblock-key, .scaleblock button, #scaleNow, .toggle,
    .dw-annot, .var-k, .dw-dimension-value { color: var(--dw-ink-64); }
    .none { color: var(--dw-ink-55); }`,
    body: sheet({}),
    logic: LOGIC,
  },
  {
    file: 'Cutaway.dc.html', w: 1440, h: 900, css: '',
    // DELTA 2 — --cut-h 15rem to 10rem. One variable; the tape keeps its own
    // overflow: auto, so the cost shows as a scrollbar.
    body: sheet({ K: K_SHORT, scale: '1:1.44', cutH: '10rem' }),
    logic: LOGIC,
  },
  {
    file: 'Tools.dc.html', w: 1440, h: 900, css: '',
    // DELTA 3 — the scale block becomes a tool block: zoom, layer, view.
    body: sheet({ head: headSplit, tools: 'drawing' }),
    logic: LOGIC,
  },
  {
    file: 'Tree.dc.html', w: 1440, h: 900, css: '',
    // DELTA 5 — the same sheet with View set to Tree: #35's `→` format, the
    // same IR and the same recorded walk, no animation and nothing to pan.
    body: sheet({ head: headSplit, tools: 'tree' }),
    logic: LOGIC,
  },
  {
    file: 'SheetFacts.dc.html', w: 1440, h: 900, css: '',
    // DELTA 4 — #31's two remaining facts as a footer band, sharing the trace row.
    body: sheet({ sheetFacts: true }),
    logic: LOGIC,
  },
  {
    file: 'DetailScope.dc.html', w: 1120, h: 860,
    css: `
    .detail { width: 1120px; min-height: 860px; padding: var(--dw-s4);
      display: flex; flex-direction: column; gap: var(--dw-s3); }
    .part { border-top: var(--dw-rule-hair) solid var(--dw-ink-30); padding-top: var(--dw-s2);
      display: flex; flex-direction: column; gap: var(--dw-s2); }
    .bay { display: flex; gap: var(--dw-s4); align-items: flex-start; flex-wrap: wrap; }
    .bay > figure { margin: 0; display: flex; flex-direction: column; gap: var(--dw-s1); width: 22rem; }
    .bay .side { border: var(--dw-rule-thin) solid var(--dw-ink-30); background: var(--dw-paper); }
    .spec { display: grid; grid-template-columns: 8rem 1fr; gap: 3px var(--dw-s2);
      font-size: var(--dw-t-annot); color: var(--dw-ink-80); max-width: 76ch; }
    .spec .k { color: var(--dw-ink-55); }
    .stamp { border: var(--dw-rule-thin) solid var(--dw-caution); color: var(--dw-caution);
      padding: 2px 10px; font-size: var(--dw-t-micro); text-transform: uppercase;
      letter-spacing: var(--dw-track-label); font-weight: 600; }`,
    body: `    <div class="detail dw-grid">
      <header>
        <span class="dw-label">Detail A · scale 1:1 · the 22rem rail</span>
        <h1 class="dw-h3" style="margin-top: var(--dw-s1)">Scope, now that nothing forks</h1>
      </header>

      <section class="part">
        <div class="spec">
          <span class="k">What changed</span><span>#28's amendment keeps the walk and drops the reducer. Scope survives — the owner named seeing a system's inputs as the valuable part — but its <b>&lt;input&gt;</b> fields drove <b>forking</b>, and forking computes a state nothing recorded.</span>
          <span class="k">The problem</span><span>a field that looks editable and is not is worse than a value that never looked editable. <b>.var input</b> carries an ink-12 border and a text cursor; it promises a thing the sheet can no longer do.</span>
        </div>
        <div class="bay">
          <figure>
            <div class="side"><div class="blk" style="border-bottom: 0">
              <span class="dw-label">Scope — editable, forks the trace</span>
              <div class="var"><span class="var-k">url</span><input value="&quot;/wood/rosewood-diff-1024.jpg&quot;" /></div>
              <div class="var"><span class="var-k">rowCount</span><input value="5" /></div>
              <div class="var"><span class="var-k">species</span><input value="&quot;rosewood&quot;" /></div>
              <div class="var"><span class="var-k">woodFibre</span><input value="0.5" /></div>
            </div></div>
            <figcaption class="dw-annot">As built. Four fields and a promise the amendment withdraws.</figcaption>
          </figure>
          <figure>
            <div class="side"><div class="blk" style="border-bottom: 0">
              <span class="dw-label">Scope</span>
              <div class="var"><span class="var-k">url</span><span class="row-v">"/wood/rosewood-diff-1024.jpg"</span></div>
              <div class="var"><span class="var-k">rowCount</span><span class="row-v dw-num">5</span></div>
              <div class="var"><span class="var-k">species</span><span class="row-v">"rosewood"</span></div>
              <div class="var"><span class="var-k">woodFibre</span><span class="row-v dw-num">0.5</span></div>
            </div></div>
            <figcaption class="dw-annot">Read-only: the border and the cursor go, the right-aligned <b>.var-k</b> key stays. It now reads like the <b>.row</b> pairs in the blocks above it, which is what it is.</figcaption>
          </figure>
          <figure>
            <div class="side"><div class="blk" style="border-bottom: 0">
              <span class="dw-label">Inputs — the condition this walk was recorded under</span>
              <div class="var"><span class="var-k">species</span><span class="row-v">"rosewood"</span></div>
              <div class="var"><span class="var-k">woodFibre</span><span class="row-v dw-num">0.5</span></div>
              <div class="var"><span class="var-k">rowCount</span><span class="row-v dw-num">5</span></div>
              <div class="var"><span class="var-k">sheetMissing</span><span class="row-v caut">"/wood/rosewood-diff-1024.jpg"</span></div>
            </div></div>
            <figcaption class="dw-annot">Renamed to what it now is: the preset's <b>input</b> block, whole, including the fault that was injected. Scope-at-a-frame becomes inputs-for-the-walk, which is the thing worth seeing.</figcaption>
          </figure>
        </div>
      </section>

      <section class="part">
        <span class="dw-label">Provenance — the question #28's amendment hands to #32, drawn here</span>
        <div class="spec">
          <span class="k">Why it is a page question</span><span>if the agent writes both the graph and the walk, the recording is a longer claim, not a check. Whatever #32 decides, a reader must be able to tell a captured walk from an authored one without leaving the page.</span>
          <span class="k">Where</span><span>the title block already states what the sheet is. A seventh cell, or a stamp beside <b>Condition</b>.</span>
          <span class="k">Note</span><span>the walk drawn on every board in this set is <b>authored</b>. Nothing executed <code>buildShelf</code>. That is exactly the failure mode the stamp exists to prevent, so the boards carry it.</span>
        </div>
        <div class="bay">
          <figure style="width: 30rem">
            <div class="dw-titleblock" style="border: var(--dw-rule-bold) solid var(--dw-ink)">
              <div class="dw-titleblock-cell"><span class="dw-titleblock-key">Condition</span><span class="dw-titleblock-val">the sheet 404s</span></div>
              <div class="dw-titleblock-cell"><span class="dw-titleblock-key">Walk</span><span class="dw-titleblock-val"><span class="stamp">authored</span></span></div>
            </div>
            <figcaption class="dw-annot">A cell of its own. Amber, because an authored walk is the case the reader must not miss — and amber on a bordered stamp is a rule, not 11px text, so 3.05:1 is not in play.</figcaption>
          </figure>
          <figure style="width: 30rem">
            <div class="dw-titleblock" style="border: var(--dw-rule-bold) solid var(--dw-ink)">
              <div class="dw-titleblock-cell"><span class="dw-titleblock-key">Condition</span><span class="dw-titleblock-val">the sheet 404s <span class="dw-state dw-state--normal">captured</span></span></div>
              <div class="dw-titleblock-cell"><span class="dw-titleblock-key">Step</span><span class="dw-titleblock-val dw-num">14 / 27</span></div>
            </div>
            <figcaption class="dw-annot">Folded into Condition instead, freeing a cell. Green here is honest — a captured walk is the nominal case — and it is one of the few places green earns a use.</figcaption>
          </figure>
        </div>
      </section>
    </div>`,
    logic: 'class Component extends DCLogic {}',
  },
  {
    file: 'Components.dc.html', w: 1100, h: 1000,
    css: `
    .detail { width: 1100px; min-height: 1000px; padding: var(--dw-s4);
      display: flex; flex-direction: column; gap: var(--dw-s3); }
    .detail .nd { position: static; }
    .part { border-top: var(--dw-rule-hair) solid var(--dw-ink-30); padding-top: var(--dw-s2);
      display: flex; flex-direction: column; gap: var(--dw-s2); }
    .bay { display: flex; gap: var(--dw-s4); align-items: flex-start; flex-wrap: wrap; }
    .spec { display: grid; grid-template-columns: 9rem 1fr; gap: 3px var(--dw-s2);
      font-size: var(--dw-t-annot); color: var(--dw-ink-80); max-width: 74ch; }
    .spec .k { color: var(--dw-ink-55); }
    .swatch { display: flex; align-items: baseline; gap: var(--dw-s2); font-size: var(--dw-t-annot); }
    .swatch i { width: 44px; height: 16px; display: block; flex: none; }`,
    body: `    <div class="detail dw-grid">
      <header>
        <span class="dw-label">Component sheet · every number behind the deltas</span>
        <h1 class="dw-h3" style="margin-top: var(--dw-s1)">Measured, on the amended answer</h1>
      </header>

      <section class="part">
        <span class="dw-label">Contrast — composited against paper #fafaf7</span>
        <div style="display: flex; flex-direction: column; gap: 3px">
          <div class="swatch"><i style="background: #22262b"></i><span><b>ink</b> · 14.55:1 — body, <b>.nd-name</b></span></div>
          <div class="swatch"><i style="background: rgb(34 38 43 / 0.8)"></i><span><b>ink-80</b> · 7.71:1</span></div>
          <div class="swatch"><i style="background: rgb(34 38 43 / 0.55)"></i><span><b>ink-55</b> · <span style="color: var(--dw-caution)">3.53:1</span> — <b>.dw-label .nd-loc .nd-ch .fx .fchange .fnum .fdir .fwhy .tab .tp-lbl .row-k .var-k .dim .dw-titleblock-key .dw-dimension-value</b></span></div>
          <div class="swatch"><i style="background: rgb(34 38 43 / 0.3)"></i><span><b>ink-30</b> · <span style="color: var(--dw-caution)">1.85:1</span> — <b>.none .tp-n .led-seq</b>, every hairline</span></div>
          <div class="swatch"><i style="background: #d97706"></i><span><b>caution</b> · <span style="color: var(--dw-caution)">3.05:1</span> — under the floor as text: <b>.fired .frow--shared .caut</b>, and the error-path row</span></div>
          <div class="swatch"><i style="background: #15803d"></i><span><b>normal</b> · 4.80:1 — <b>.fx--ok</b>, the <b>returned</b> chip, <b>.ok</b> in the ledger. Spent again, now that effects land.</span></div>
        </div>
        <div class="spec">
          <span class="k">Delta 1</span><span>ink at <b>0.64</b> gives <b>4.60:1</b>. Rules keep their alphas, so one ink on one paper still holds and Drafting rule 4 is untouched.</span>
          <span class="k">Not fixed by it</span><span>amber as text stays at 3.05:1, and it now carries more than before: the error-path row, the failed effect in the ledger, <b>.frow--shared</b>. Amber on a border or a 6px dot is a rule and is fine; amber as an 11px word is not.</span>
        </div>
      </section>

      <section class="part">
        <span class="dw-label">Fit — the drawing is 1368 × 783; view.html's fit() picks the scale</span>
        <div class="spec">
          <span class="k">As built</span><span>plan 1086 × 488 → <b>K = 0.5926</b>, which <b>applyView()</b> writes as <b>1:1.69</b>. The scale block speaks in ratios, never percentages.</span>
          <span class="k">Height-bound</span><span>in every configuration measured. Deleting the whole 22rem rail moves the scale by <b>0%</b> — width was never the binding constraint, so the rail is free and the argument for what goes in it is never about the drawing.</span>
          <span class="k">Delta 2</span><span><b>--cut-h</b> is the only throttle. 15rem → 12rem gives 1:1.53 (+10%); → 10rem gives <b>1:1.44, +17%</b>. Cost: the tape scrolls sooner, and the tape is where the walk is read.</span>
        </div>
      </section>

      <section class="part">
        <span class="dw-label">What #28's amendment restored, and what it did not</span>
        <div class="bay">
          <div class="spec" style="max-width: 46ch">
            <span class="k">Back</span><span><b>.nd--cold</b> as <em>not reached yet</em> — two nodes on this walk; edge weights 2px on-stack / 1.5px walked / 1px construction; <b>.fired</b>; <b>.fx--ok</b> and <b>.fx--fail</b>; the <b>returned</b> and <b>on stack</b> chips; <b>.bp</b>; <b>.tp--here</b> and <b>.tp--past</b>; the <b>.trace</b> dimension row; all four rail blocks; <b>tracer()</b>.</span>
            <span class="k">Still gone</span><span>editable scope and forking; time travel off the recorded walk; a breakpoint on a step the walk never reached.</span>
            <span class="k">Consequence</span><span>my earlier claim that <b>green is spent on nothing</b> was true only of the drawing-only answer. It has three uses again.</span>
          </div>
          <div class="spec" style="max-width: 46ch">
            <span class="k">Unchanged by it</span><span>the contrast finding. <b>ink-55</b> carried the annotation layer under both answers, and carries more of it now that the rail is full again.</span>
            <span class="k">Also unchanged</span><span><b>filesView()</b> already groups the diff into <em>this node</em>, <em>other nodes on this sheet</em> and <em>in the diff, on no node</em>, and appends the computed <b>NOTICES</b>. #31's first deliverable shipped before this ticket opened, which is why Delta 4 places only its other two.</span>
            <span class="k">New</span><span>the walk drawn on these boards is <b>authored</b>, not captured. See Detail A — the provenance stamp exists because this set is itself an instance of the problem.</span>
          </div>
        </div>
      </section>
    </div>`,
    logic: 'class Component extends DCLogic {}',
  },
];

const tpl = ({ w, h, css, body, logic }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">
  <style>
${CSS.trimEnd()}${css}
  </style>
</helmet>

${body}
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
${logic}
</script>
</body>
</html>
`;

for (const b of boards) {
  writeFileSync(new URL(`./${b.file}`, import.meta.url), tpl(b));
  console.log(`wrote ${b.file} (${b.w}x${b.h})`);
}
