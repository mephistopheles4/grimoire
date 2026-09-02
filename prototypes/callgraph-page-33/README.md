# The page refinement set — ticket #33

**Throwaway boards, kept as a primary source.** These answered
[#33](https://github.com/mephistopheles4/grimoire/issues/33) — _what the page
shows, and the rule for where each thing goes_. They are **not a viewer and not
a merge base.** The thing they refine is
[`../callgraph-sheet/view.html`](../callgraph-sheet/view.html); accepted deltas
fold into that, under [#43](https://github.com/mephistopheles4/grimoire/issues/43).

Published as a design canvas:
https://claude.ai/code/artifact/ef18ca8e-9a39-41ca-9ed5-56a8daafe7f0

## The base is view.html, not a redrawing of it

Every artboard is built from `view.html`'s own values and its own code. That is
the whole discipline here, and the first two attempts at this set failed it —
they were built from `../README.md` and a grep, and read as a different product
to the person who wrote the original.

| | |
| --- | --- |
| `_sheet.css` | `view.html`'s CSS, values **copied** not re-derived, with the source line ranges noted. Classes added for the proposals are marked `PROPOSED`. |
| `gen-plan.mjs` | Re-runs `view.html`'s `layout()` and `renderPlan()` over the real IR — same `W` / `GAP_X` / `GAP_Y` / `PAD`, same depth rows, same call-left/error-right corridors, same 2px / 1.5px / 1px edge weights. Emits `_plan.html`. |
| `gen-tree.mjs` | The tree rendering, in [#35](https://github.com/mephistopheles4/grimoire/issues/35)'s `→` format, from the same IR and the same walk. Emits `_tree.html`. |
| `measure.mjs` | Re-runs `fit()` and the `NOTICES` computation. **Every number in the captions comes from here.** Nothing is estimated. |
| `build.mjs` | Assembles the eight `.dc.html` artboards from the above. |
| `canvas.json` | Artboard layout and the annotations that carry each delta's reason and its cost. |

Regenerate the whole set:

```bash
node gen-plan.mjs && node gen-tree.mjs && node build.mjs
```

All four scripts read `../programs/pr-313-first-paint.json` directly, so the
boards move when the IR does.

**The seeded canvas payload is not committed.** Publishing bakes the whole
Claude Design editor into one 2.7 MB file; the artboards and `canvas.json` here
are the source, the published canvas is the rendering, and `.gitignore` keeps
the payload out.

## The walk is authored, not captured

Nothing executed `buildShelf`. The drawn state — preset _"the sheet 404s"_,
stopped just after `bindSheet`'s fetch failed and the warn landed — was written
by hand.

That is not a shortcut, it is the effort's sharpest open question showing up in
its own evidence. [#28](https://github.com/mephistopheles4/grimoire/issues/28)'s
amendment argues stepping keeps a drawing honest, and that argument rests on the
run being real. An authored walk is a longer claim, not a check. `DetailScope`
draws the provenance mark that exists to stop a reader mistaking one for the
other, and #32 owns the decision.

## What the boards could not settle

Fit and clipping here are arithmetic, not observation — the canvas was never
rendered while these were built. Whether the vertical tool block occludes the
drawing at real zoom, where the splitter actually wants to sit, and whether the
tree's channels crowd at real width all wait on #43.
