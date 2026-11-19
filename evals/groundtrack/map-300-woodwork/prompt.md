---
max_turns: 60
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

Here is the plan for map #300, a set of tickets to ship a woodwork texture treatment on a 3D bookcase site. Draw the graph for the whole map (one entry point), validate it, and render the page to the scratch folder. The repo paths the tickets touch are listed under "Repo paths in play" below; nothing needs to be read from the repo itself, the plan is all here.

## Repo paths in play

- `packages/site/src/shelf/case.ts` (edit): the inset constants, so the gate computes the 46 pairs from the numbers the renderer builds from.
- `packages/site/src/shelf/woodwork.ts` (new): the sheet table, the UV rewrite, the per-member variation and the bind. Tickets 2 to 6 all land here, which is why they are a chain and not a fan-out.
- `packages/site/src/shelf/scene.ts` (edit): `buildShelf` and `applySettings` call the above and do no arithmetic of their own.
- `packages/site/src/shelf/shelf-settings.ts` (edit): the two materials keys, their defaults and their `resolveSettings` merge.
- `packages/site/src/shelf/shelf-url.ts` (edit): `woodSeed(params)` beside `soloBook`.
- `gates/coplanar-faces.test.ts` (new): G51.
- `gates/sheet-size.test.ts` (new): G52.
- `gates/one-sheet.test.ts` (new): G53.
- `gates/woodwork-readback.test.ts` (new): G54.
- `docs/adr/0080-the-woodwork-is-rosewood-and-its-relief-is-drawn.md` (new): the treatment. Numbers claimed at write time.
- `docs/adr/0081-the-woodwork-sheet-is-a-menu-and-the-shelf-says-what-it-resolved.md` (new): the four questions 0080 closed by naming.
- `docs/images/shelf.png` (edit): regenerated in place, because gate G13 pins that directory to exactly one file.
- `stryker.scopes.json`: must NOT be edited, and it is on this list for that reason. `packages/site/src/shelf/**/*.ts` is already a declared scope, and the mutate array derived from this file is hashed, so the drift an edit causes is caught by nothing.

---

# #300 Map: ship the woodwork treatment

Spec: `docs/spec/the-woodwork-reads-as-wood.md`. Parent map: #280.

**Goal.** A rendered bookcase on main whose woodwork reads as wood: rosewood, world-space UVs, a drawn fibre, a backboard with its own sheet, no two members alike, and a species menu that is lazy and honest about what it resolved.

**Inputs already settled.** Nine closed decision tickets, and three prototype branches that are reference only: nothing on them fast-forwards and none is a merge base. Two are `prototype/297-backboard-sheet` and `prototype/298-wood-seed`.

**Shape of the work.** Six implementation tickets in a linear chain, then the map's own destination ticket. Exactly one is takeable at a time. Each ticket is blocked by the one before it:

1. #301 the bookcase stops flickering (no blockers; PR #308)
2. #302 the woodwork is rosewood (blocked by #301; PR #309)
3. #303 a drawn fibre, and a knob to dial it (blocked by #302; PR #310)
4. #304 the backboard takes its own sheet (blocked by #303; PR #311)
5. #305 no two members alike (blocked by #304; PR #312)
6. #306 the species menu, lazy and honest (blocked by #305; PR #313)
7. #299 the merge, the screenshot and the ADR (blocked by #306; the map's own destination ticket)

Gate rows this map lands: G51, G52, G53, G54. Tickets #303, #304 and #305 land no row.

**What must not happen (the map's own warnings).**

- Do not run tickets 2 to 6 at the same time. They are one feature in one module: every one edits `buildShelf`, the materials block and `woodwork.ts`. Six sessions buy conflicts, not speed. Any attempt to fan them out is refused.
- Do not let tickets 2 to 6 reach a deploy ahead of ticket 1. A texture does not cause the depth-buffer tie, it reveals it. Ticket 1 shares no source file with the rest and fixes something broken on main today, so it lands first as its own PR. If the texture goes out first, every visitor between the two deploys sees 46 flickering pairs, and that cannot be undone afterwards.
- Do not trust the chosen sheet without checking what the render says it moves. Twice on map #280 a plausible premise died under a render (see History). If it dies again, the plan goes out to a prototype and comes back.
- Do not claim a gate number in advance. Row numbers are claimed against the register at the time the row lands. A number claimed in advance can be claimed twice by two branches and nothing notices. If that happens, the register is corrected and ticket #306 is done again, rather than going on to the merge, which would put the treatment on main with neither G53 nor G54.
- Do not edit `stryker.scopes.json`.

**Done when.** The six PRs are merged, ADR-0080 and ADR-0081 exist, `docs/images/shelf.png` is regenerated, #296 and #299 are closed, and map #280 carries the decisions line. The map's result is: on main, rows G51 to G54, PRs 308 to 313, ADRs 0080 and 0081.

---

# #301 The bookcase stops flickering

Blocked by: nothing. This is the first ticket in the chain, and the one slice that is safe to run alongside the others; it is also the only one whose fix is already needed on main.

Deposits:
- PR #308: the coplanar fix, applied to the whole class of coplanar faces, edits `packages/site/src/shelf/case.ts` (the inset constants).
- Gate row G51 `coplanar-faces` (`gates/coplanar-faces.test.ts`): 46 coplanar overlapping face pairs before the inset, 0 after. The count is computed from `SHELF`'s own constants rather than eyeballed, so the assertion survives a dimension change.

Notes: the tie was always there. Every woodwork face carrying the identical flat colour is the only reason 36 of the 46 pairs were invisible. Once any texture lands, all 46 show.

Fails if: it lands after the texture (see #302 and the History).

Hands back: G51.

# #302 The woodwork is rosewood

Blocked by: #301.

Deposits:
- PR #309: rosewood, world-space UVs, grain along each long axis. Creates `woodwork.ts`, edits `scene.ts`.
- Gate row G52 `sheet-size`: long-edge and byte caps under `public/wood/`. The existing G15 counts cover bytes only, so an 8192-square file would reach the deploy with nothing objecting.

Needs: a Poly Haven sheet, CC0 licence.

Can fail or be rejected two ways, both before any of the above is built:
- If #301 has not landed, the ticket is refused: all 46 pairs become visible at once.
- If the premise has not been settled and the render shows 94% of what the chosen sheet moved was the average colour, not the grain, the ticket is rejected and the premise is overturned. The recovery is a prototype (see History), after which this ticket is taken again with the premise settled.

Hands back: G52.

# #303 A drawn fibre, and a knob to dial it

Blocked by: #302.

Deposits:
- PR #310: a drawn fibre on the woodwork, with a `materials.woodFibre` setting. Edits `woodwork.ts`, `scene.ts`, `shelf-settings.ts`.

Needs: a 2D canvas to draw the fibre.

Notes: the sheet's own normal map measured 0.000% at every rung on two different sheets. The drawn fibre adds 0.742% of frame level. It is not an extra texture, it is a better use of one.

No gate row. The look is the owner's verdict, on a live build or on screenshots, never on a number.

Hands back: no row.

# #304 The backboard takes its own sheet

Blocked by: #303.

Deposits:
- PR #311: the backboard's sheet, and the fibre turned to run with its grain. Edits `woodwork.ts`, `scene.ts`. It is a constant, not a knob.

Needs: the `prototype/297-backboard-sheet` branch as reference. #297 measured all 41 veneers Poly Haven publishes; the darkness constraint leaves exactly one candidate, and the third-nearest is 24.8 luma away. That is why it is a constant.

No gate row.

Hands back: no row.

# #305 No two members alike

Blocked by: #304.

Deposits:
- PR #312: per-member variation, and a `?woodSeed` query parameter the render harness can force. Edits `woodwork.ts`, `shelf-url.ts` (`woodSeed(params)` beside `soloBook`) and `shelf-settings.ts`.

Notes: `?woodSeed` pins the root so the harness can force one; a fresh page draws a fresh root. The backboard's key must carry the root. Its absence renders correctly and only misreports, which is the sort of fault nothing else would catch.

No gate row.

Hands back: no row.

# #306 The species menu, lazy and honest

Blocked by: #305.

Deposits:
- PR #313: the sheet is a menu, and the shelf says what it resolved. Edits `woodwork.ts`, `scene.ts` and `debug-panel.ts`.
- Gate row G53 `one-sheet`: a default page resolves to exactly one woodwork sheet. It would have asserted nothing a day earlier: with one hard-coded sheet the guarantee is a tautology, and a tautology in that table reads as cover.
- Gate row G54 `woodwork-readback`: the resolved configuration is the reported one. This is the row the map earned three times over: #284's duplicated query parameter, #298's `Number(null)`, and #297's fibre at 90 degrees. All three are a query string treated as an assumption.

Can fail or be rejected: if gate numbers were claimed in advance (G53 or G54 reserved by another branch before the register was corrected), the ticket is refused for claiming a number twice. The register gets four corrections in `docs/gate-register.md` (cite slug and number together, never the number alone, because a row number is a fact about when something landed, not a name), and then #306 is done again.

Hands back: G53 and G54.

# #299 The merge, the screenshot and the ADR

The map's own destination ticket. Blocked by: #306 (so, by the whole chain). It is given the four gate rows, G51 to G54.

Deposits, in order:
- The six pull requests, #308 to #313, are merged to main.
- ADR-0080 and ADR-0081 are written to `docs/adr/`. Numbers are claimed against the directory's tip at write time, never in advance.
- `docs/images/shelf.png` is regenerated in place from the 50-book fixture vault. G13 pins that directory to exactly one file, so no widening is needed and the provenance claim still holds.
- Tracker: close #296 naming its gate row, and close #299.
- Tracker: append a Decisions-so-far line to map #280 and clear the knobs bullet. Re-fetch the map body immediately before editing, since concurrent sessions edit it and the copy loaded at session start is stale by now.

Hands back: the rows, the PRs and the ADR numbers.

---

# History

**What actually happened on this map.** Six PRs in a linear chain, #308 to #313, taken one at a time. #301 landed first with G51 at 46 pairs before and 0 after. #302 through #305 followed in order, #303 to #305 with no gate row. #306 landed G53 and G54. #299 merged the six PRs, wrote ADR-0080 and ADR-0081, regenerated the screenshot, closed #296 and #299, and updated map #280. No row numbers were claimed in advance, and nothing was run in parallel.

**What the map did not plan.** On map #280, #281 chose sapele on sound reasoning, and then the render said 94% of what that sheet moved was the average colour rather than the grain. Separately, #287's seed read from the books died on arithmetic. Both premises were plausible and both died under a render. The plan was not patched; instead it went off to a prototype nobody had planned: a render built to answer one question, "which sheet actually moves the grain, not the average colour". The prototype ran, a prototype ticket was opened off the map (parent #280), and the answer came back as "rosewood, not sapele". Its branch is reference only and never merges. With that settled, #302 was taken again and went through. The habit that caught both: build the arm nobody planned, and measure before concluding.

**The previous rollout's failure.** A gate number claimed in advance by two branches went unnoticed, and four register entries record the correction. This is why #306 and #299 claim numbers at the time of landing.

**Why the chain is linear.** Tickets 2 to 6 were first considered as separate sessions. They were rejected because they are one feature in one module. Only #301 shares no source file with the rest, and so only #301 could run beside them, which it did not need to, since it had to land first anyway.
