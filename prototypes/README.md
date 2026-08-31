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
| `callstack-debugger/index.html` | **D-00.** The first prototype: a self-contained stepping debugger over a JSON call-graph IR. Proved the engine. Retires with the map. |
| `callgraph-sheet/view.html` | **D-01, source.** The Drafting-styled sheet. Edit this one. |
| `callgraph-sheet/build.ps1` | Assembles `index.html` from `view.html`. |
| `callgraph-sheet/index.html` | **Generated — never hand-edit.** The deliverable: one file, no network references, open it by double-clicking. |
| `programs/*.json` | Three worked IR files, all drawn from real work. |

## The engine is lifted, not duplicated

`build.ps1` extracts the IR definitions and the `step()` VM out of D-00 by line
range and splices them into D-01. **One engine, two viewers** — which is the
property the whole effort rests on, and the reason both files are kept rather
than only the newer one. All eight of D-00's scenarios produce identical step
counts under D-01.

It also splices in `drafting.css` verbatim and inlines three IBM Plex Mono
weights as data URIs, so the built page has **zero network references**.
`eagle-eye` links Google Fonts instead; map ticket
[#33](https://github.com/mephistopheles4/grimoire/issues/33) decides which the
skill follows.

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
  changes with no runtime node.
- **`map-300-woodwork.json`** — [`stacks#300`](https://github.com/mephistopheles4/stacks/issues/300),
  a wayfinder map, drawn as a graph. Nodes are tickets, call edges are
  _blocked by_, effects are the artifacts a ticket deposits, and the error
  channel is how the **plan** fails rather than how code fails. Its five presets
  are histories: what happened, and the four things that map's own warnings say
  must not.

## Two findings worth keeping

**Stepping is what keeps a drawing honest.** Every edge is a construction
hairline until control actually crosses it. On the map's _budget of 1_ preset,
two branches the plan never reached stay unlit — the plan's untaken paths,
visible at a glance. This is the argument for ticket
[#28](https://github.com/mephistopheles4/grimoire/issues/28) answering "it
steps"; the counter-argument is that the engine is half the weight here.

**A drawn plan can lie, and running it catches that.** The map program's
recovery path for a pre-allocated gate number originally jumped straight to the
merge. Stepping it showed six pull requests and only two gate rows — the
treatment reaching `main` with two gates missing. The prose read fine; the run
did not.
