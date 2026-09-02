# Prototypes — the call-graph sheet

**Throwaway, captured as evidence.** These are the working prototypes that
charted [map #25](https://github.com/mephistopheles4/grimoire/issues/25) —
_a skill that draws a change or a plan as a call graph_. They are **reference,
not a merge base.** Nothing here fast-forwards onto `main`, and the viewer is
expected to be rewritten to `eagle-eye`'s shape rather than ported.

Captured under [#30](https://github.com/mephistopheles4/grimoire/issues/30),
because until now they existed only as uncommitted files in a worktree of
another repository, one `git clean` from gone.

## What is here

| | |
| --- | --- |
| `callstack-debugger/index.html` | **D-00.** The first prototype: a self-contained stepping debugger over a JSON call-graph IR. Proved the engine, and still **owns** it — `record.mjs` runs this VM. Retires with the map. |
| `callgraph-sheet/view.html` | **D-01, source.** The Drafting-styled sheet. Edit this one. |
| `callgraph-sheet/record.mjs` | Runs D-00's VM offline and writes each program's **recorded walk** into its own file. |
| `callgraph-sheet/build.ps1` | Assembles `index.html` from `view.html`. |
| `callgraph-sheet/index.html` | **Generated — never hand-edit.** The deliverable: one file, no network references, open it by double-clicking. |
| `programs/*.json` | Three worked IR files, all drawn from real work, each carrying a recorded walk per preset. |

## The engine moved to record time

It used to be spliced. `build.ps1` lifted the IR definitions and the `step()` VM
out of D-00 by line range and put them in D-01 — one engine, two viewers.

[#28](https://github.com/mephistopheles4/grimoire/issues/28) was then amended to
_the artifact steps over a recorded walk, and there is still no engine_, and
[#43](https://github.com/mephistopheles4/grimoire/issues/43) carried that into
the build. **The VM did not die, it moved.** `record.mjs` lifts it out of D-00
by the same trick, runs every program × preset to completion once, and writes
the resulting tape into the IR file. D-01 plays that tape: it pushes frames,
pops frames and appends ledger rows, and it has no `step()`, no `evalExpr` and
no `new Function` at all.

So D-00 is still the single source of the VM, and `build.ps1` now **refuses** to
emit a page whose walks are stale (`node record.mjs --check`) rather than
drawing a sheet that steps over yesterday's graph.

`build.ps1` also splices in `drafting.css` verbatim and inlines three IBM Plex
Mono weights as data URIs, so the built page has **zero network references**.
`eagle-eye` links Google Fonts instead; map ticket
[#37](https://github.com/mephistopheles4/grimoire/issues/37) decides which the
skill follows.

## A walk is a claim, so it is checkable

The tape is **event-granular and literal**: every branch an `if` took, every
value an effect returned and every handler that caught is written down, so the
player never works anything out. The rule is *derive, never decide.*

```json
{ "k": "call", "at": 4, "to": "bindSheet" }
{ "k": "effect", "at": 0, "kind": "net.get", "status": "failed",
  "error": { "tag": "SheetMissing", "message": "404", "channel": "escape" } }
{ "k": "handled", "at": 2, "goto": "warn" }
```

`walkErrors()` in `view.html` holds a walk to the graph it claims to have
walked — a move naming a step index the node has not got, or a pop with no frame
open, is a broken claim and is refused before it is drawn.

**The walks here are `authored`, not `captured`.** Nothing executed `buildShelf`;
they came out of a model of it. The footer band stamps that on every sheet, in
amber, because an agent that writes both the graph and the walk has made a
longer claim rather than performed a check — which is the question
[#32](https://github.com/mephistopheles4/grimoire/issues/32) owns.

⚠️ **`build.ps1` reads a sibling checkout.** It expects
`mephistopheles4/aymandiab.com` at `$env:USERPROFILE\WebstormProjects\aymandiab.com`
for `design-system/drafting.css` and the vendored fonts. Without it the build
throws by design rather than emitting an unstyled page. The prettier step is
skipped out loud when no prettier is reachable — this repo is zero-dependency
and has none.

## The three programs are the valuable part

These encode real behaviour and were checked against their sources rather than
invented. Ticket [#32](https://github.com/mephistopheles4/grimoire/issues/32)
should treat them as the schema's acceptance set.

- **`pr-313-first-paint.json`** and **`pr-313-panel-apply.json`** — two graphs
  from [`stacks#313`](https://github.com/mephistopheles4/stacks/pull/313), a
  2109-line pull request, because its diff touches two entry points that never
  call each other. The first reproduces that pull request's own measured table
  of network requests exactly: two sheets on a default page, two under a
  different species, **one** under `flat`. It also carries the full 17-file
  diff, and reports that ten of those files are accounted for by no node — the
  honest limit of a call graph, since documentation and gate rows are real
  changes with no runtime node. It is also the one program that declares a
  **layer map** — see below.
- **`map-300-woodwork.json`** — [`stacks#300`](https://github.com/mephistopheles4/stacks/issues/300),
  a wayfinder map, drawn as a graph. Nodes are tickets, call edges are
  _blocked by_, effects are the artifacts a ticket deposits, and the error
  channel is how the **plan** fails rather than how code fails. Its five presets
  are histories: what happened, and the four things that map's own warnings say
  must not.

## The test layer substitutes a token, not a node

[#34](https://github.com/mephistopheles4/grimoire/issues/34) shipped the layer
swap in version one and left two readings open — **node for node**, the source
article's `UserRepo.findById → UserRepoMock`, or **token for token**, a rename
inside `R`. [#42](https://github.com/mephistopheles4/grimoire/issues/42) settled
it by writing one against real material rather than arguing: `#313`'s own test
files, read node by node.

**Token for token, and no node is ever replaced.** Across a 2109-line pull
request carrying two real doubles, `vi.mock` appears nowhere and no stand-in
module exists. A double goes in **at the call site**, through a parameter with a
real default:

| node | `R` in production | under `tests` | why |
| --- | --- | --- | --- |
| `resolveWoodwork`, `worldSpaceUvs` | none | unchanged | pure; the specs call them directly |
| `bindSheet` | `THREE.TextureLoader` | `fakeLoader()` | `load: SheetLoader = textureLoader()` — `woodwork.ts:783` |
| `applyWoodFibre` | `CanvasTexture` | `() => fibre` | `map = () => woodFibreMap() ?? null` — `woodwork.ts:1249` |
| `fibreMapFor` | `canvas 2d` | **unchanged** | `bakeFibre` reaches `document.createElement` directly; nothing substitutes it |
| `buildShelf` | `THREE`, `woodwork.ts` | **never entered** | no spec enters here at all |

⚠️ **`fibreMapFor` is the row worth having.** It is the node that still holds its
real dependency once the toggle is flipped, and it is the only one in the graph
no test reaches — the same fact twice. That is exactly the payoff #34 argued the
swap for, arriving on the first program anybody wrote one for.

**Two things this cost the framing.** *Token for token changes nothing
structural* is not quite true: production reaches `fibreMapFor` through
`applyWoodFibre`'s third argument, so substituting that token **severs the call
edge**, and the graph does change shape at that leaf. And a rename-only map
cannot say what a layer never **reaches** — `buildShelf` is the entry point in
production and is entered by nothing under `tests`, which no `R` token can
express. Both go to [#32](https://github.com/mephistopheles4/grimoire/issues/32)
as questions, not as schema.

## Two findings worth keeping

**Stepping is what keeps a drawing honest.** Every edge is a construction
hairline until control actually crosses it. On the map's _budget of 1_ preset,
two branches the plan never reached stay unlit — the plan's untaken paths,
visible at a glance. This is the argument for ticket
[#28](https://github.com/mephistopheles4/grimoire/issues/28) answering "it
steps". The counter-argument was that the engine is half the weight here — and
the amendment answers it: a recording buys the stepping without the engine.

**A drawn plan can lie, and running it catches that.** The map program's
recovery path for a pre-allocated gate number originally jumped straight to the
merge. Stepping it showed six pull requests and only two gate rows — the
treatment reaching `main` with two gates missing. The prose read fine; the run
did not.
