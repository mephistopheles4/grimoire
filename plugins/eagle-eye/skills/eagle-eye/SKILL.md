---
name: eagle-eye
description: Use when a discussion holds three or more open decisions and one choice changes what is possible in another — during brainstorming, grilling, a design review, a wayfinder map — or when the user asks for an eagle-eye view, a morphological box, or invokes /eagle-eye. Not for two independent choices.
---

# Eagle-eye

A decision is made once it has been seen against the whole system. This skill
lays coupled decisions out as a **morphological box** (Zwicky): one row per
decision, one cell per option, and an **edge** between options that rule each
other out or require each other. A page reads any configuration back: what
fights, what is missing, and six findings that point at what you have not
looked at.

**Stance.** The user's thinking is the product; the box is the receipt. You
draw the box so they can see the system. You do not pick for them.

## When to use

- Three or more open decisions, and picking one changes what is possible in
  another. Two independent choices never earn a box.
- A grilling session is asking questions one at a time that a grid would ask
  at once.
- Brainstorming has the clarifying questions answered and has not yet proposed
  approaches.
- A wayfinder map's tickets are the rows.
- The user asks by name: `/eagle-eye <topic>`.

Say it before you build it: *"This has N coupled decisions. I will build a
box."* A wrong trigger costs one sentence.

## Depth follows the row count

| Rows | Output |
|---|---|
| 2–3 | A markdown table in chat, edges listed under it. No file, no page. |
| 4–14 | A box file and the rendered page. |
| 15+ | Split into clusters. One box each. |

## What earns a row

**A row is a dimension of the problem. It is not a list of the answers somebody
already proposed.** The cells of one row must combine with the cells of every
other row. That property is what makes this a box and not a table: the grid
produces configurations nobody wrote down, and one of them is often better than
every option that was offered.

Test each row before you write it: **can two of its cells be true at the same
time?** If yes, it is not a row. A row asserts that its cells exclude each
other, and the page enforces that assertion. Draw it anyway, and the box forbids
a combination that is available.

So **a whole position is a preset, not a cell.** *Option 1*, *option 2* and *do
nothing* from a ticket are three configurations of the real dimensions. Put them
in `presets`. The reader then clicks each one and sees what it costs.

One smell catches this late: a single option that rules out most of the other
rows. A cell that closes half the box is usually a position, not an option.

## Procedure

1. **Rows.** Name each decision and give it a **`problem`** — see
   [The problem statement](#the-problem-statement). Apply
   [What earns a row](#what-earns-a-row) first: a menu of positions is not a
   row. List the options that were actually on the table, each with a `src`
   (ticket, document, chat turn). Then add **strawmen**: for each row, ask
   *none / opposite / later / by hand*, and add the ones that are not absurd,
   flagged `strawman: true`. An option somebody proposed can still be the *none*
   or the *later* answer — flag it anyway and keep its `src`. The flag records
   coverage; `src` records who proposed it. The renderer warns on a row with no
   strawman and on a row with no `problem`.
2. **Edges.** For each option: what it rules out (`conf`), what it requires
   (`req`). Each edge carries one sentence of *why* and a **tier**:
   `measured` (somebody ran it), `sourced` (a document says so — name it),
   `argued` (your reasoning). No edge without a why. An edge inside a row is a
   swap, not an edge.
3. **Audit.** Check every `argued` edge against the eight weakness patterns
   (see `reference/writing-edges.md`). Rewrite it, or move it to `suspected`,
   where it is listed but colours nothing.
4. **Chosen set.** Mark one option per row as the current position. Say whose
   it is: the spec's, the owner's, or your recommendation.
5. **Presets.** Write at least two, and make at least one of them change an
   option. The renderer refuses a box without them. See [Presets](#presets).
6. **Render and read.** Write `<topic>.box.json` next to the project's decision
   records (`docs/decisions/`, `docs/adr/`, or where the project keeps them).
   Run the renderer. It sits next to this file, in the skill base directory
   the harness names when it loads the skill. Join that directory to
   `render.mjs`. Do not write a fixed path. Give the findings in chat:

   ```bash
   node <skill base directory>/render.mjs docs/decisions/<topic>.box.json
   ```

   Open the HTML it writes in the user's browser (`Start-Process <file>` on
   Windows, `open` on macOS, `xdg-open` on Linux). An in-app preview pane may
   show local files as static snapshots with no script; do not judge the page
   from one. Publish as an Artifact only when that tool is available; the file
   works without it. To read a configuration without a browser, use `--sel`.
7. **Round trip.** The page has **Export**. The user pastes the Markdown back.
   Read the restore code, re-argue the set, and update the box file only with
   what the user confirms. `--sel` reads a restore code from the command line:

   ```bash
   node <skill base directory>/render.mjs <box.json> --sel "eagle-eye: opt-a, opt-b"
   ```

## The six findings

The page and `--check` compute these for any configuration. In chat, give the
ones that apply.

| Finding | What it points at |
|---|---|
| row not opened | A row with edges to the rows you changed that you did not look at. |
| weakest edge | The lowest-tier edge the verdict depends on. Measure this one first. |
| most connected | The selected option with the most edges. Change it and the most moves. |
| row with no edges | Independent, or an edge is missing. |
| strawman not rejected | A strawman nothing rules out. Give the reason, or pick it. |
| cogency | *If every edge is true, can the set still be wrong?* Counts the argued edges. |

## When the box is finished

**Test it by acceptance.** Ask yourself: if the user takes the chosen set as it
stands, is the decision made? Any question you can still put to them is a row
you did not draw.

**Run that test at the moment the user agrees.** *"The chosen set is good"* ends
the session. If you answer it with more questions, the box did not hold the
whole problem, and those questions name what is missing. Rebuild the box before
you write anything else down.

The failure is quiet, because each new question looks like the next round of a
good conversation. It is not. A round moves outward from a settled row; a
question with no row is a hole. Ask where in the grid it would go. If the answer
is nowhere, add the row.

## The problem statement

**Every row carries a `problem`: what this decision is about, for a reader who
does not know the domain.** A row name is a handle, not an explanation —
*"Reachable by whom"* tells a newcomer nothing, and neither does a one-line
`question` that leans on a term they have not met. The page opens the **In
short** block with it, above the derived state.

This is the one part of a row nothing can derive. The renderer can count
options, name what requires what, and report the conflict — it cannot say why
anybody is choosing.

Two to five sentences, under the [Writing rules](#writing-rules). Cover:

- **The terms the row rests on.** Define the ones a stranger has not met.
- **Why the choice exists at all.** What forces it, and what is already fixed.
- **What turns on it.** What a reader gets wrong by picking carelessly.

Write the *problem*, not your answer. The options carry the answer, and the
edges carry the argument.

> *Reachable by whom.* The rule for a gate says a red build must have a remedy
> somebody can reach. It never says who that somebody is, and the answer
> changes everything. A maintainer can fix almost anything. A first-time
> contributor with a fresh clone cannot. This row names the person the standard
> is written for, because "reachable" without a reader decides nothing.

`question` stays what it was: the decision in one line, under the row name. The
`problem` explains it.

## Presets

**Every box carries at least two, and at least one of them changes an option.**
The renderer refuses a box that does not. A grid on its own shows the chosen set
and nothing else, so the reader never learns which *other* configuration is worth
opening. A preset is the author saying: look at this one, and here is why.

A preset is a title, a one-sentence `text`, and steps run in order from chips on
the page. A step sets options, opens a row, switches view, resets, or turns coach
mode on. The page prints the `text` above the steps.

Pick from these archetypes. The first is cheap; the rest are what earn the box.

| Archetype | What it shows | Steps |
|---|---|---|
| **As chosen** | The current position, row by row. | Open the two or three rows that carry the argument, then close the last one. |
| **The break test** | What the *most connected* option holds up. | Set that one option, open its row, read the cascade. |
| **The strawman run** | Whether a strawman really is absurd. It is often consistent, which is the finding. | Set the strawman, open the row it closes. |
| **The cheap route** | The lowest-cost configuration, and what it gives up. | Set each cheap option, read the requirements not met. |
| **The strict route** | The most conservative configuration, and what it forbids. | Set each strict option, read the ruled-out list. |
| **Coach** | Prediction before recognition, on one change. | `coach: true`, then one step with `predict: true`. |

**Do not write a Reset step.** The page resets when the reader picks the preset, so a first step that only
resets spends their first click on housekeeping. `reset` stays valid in the schema for a preset that returns
to the baseline part-way through; it is not how one starts.

**A step that only sets `view: 'findings'` does nothing**, because that is the view already. To send the
reader back from an open row, close the row in the same step: `{ open: null, view: 'findings' }`. Use `view`
on its own only for `'sheet'`.

**Title the configuration, not the verdict.** *The break test* and *Adopt
nothing* tell the reader what they are about to see. *Optimal* and *maintainable*
state the answer the box exists to test.

## Coach mode

Opt-in, on the page. After an override the grid stays uncoloured until the
user predicts which rows are affected, then reveals. Prediction before
recognition. Do not turn it on for them; name it once.

## Writing rules

All text in a box — labels, whys, notes — follows ASD-STE100's writing rules,
tested against ISO 24495-1. Active voice. Present tense. One instruction per
sentence. Twenty words or fewer. No idiom, no metaphor, no `-ing` verb forms.
Re-anchor a coined term when you reuse it. Full rules and the weakness
patterns: `reference/writing-edges.md`.

## Box file

Shape in `box.schema.json`; a complete example in
`examples/eagle-eye-skill.box.json` (the skill's own design, boxed). The
renderer validates: unique ids, exactly one `chosen` per row, edge targets
exist and sit in another row, tier in {measured, sourced, argued}, a
non-argued edge names its `src`, every edge has a why, and two or more presets
of which one changes an option. It warns on a row with no `problem` and on a
row with no strawman.

**What it does not check is the part that goes wrong.** No validator can tell a
dimension from a menu of positions, and none can tell you a row is missing. Both
tests are yours: [What earns a row](#what-earns-a-row) before you write the box,
[When the box is finished](#when-the-box-is-finished) after the user reads it.
One mechanical check would help and does not exist yet — warn when a single
option rules out options across most of the other rows, because that cell is
usually a position.

## Export format

What the page produces and what you read back. Change both together.

```
## eagle-eye · <title> · N changes · <verdict>
| # | Decision | Chosen | My choice |
...
### Conflicts / Requirements not met / Ruled out / Findings
Restore code: `eagle-eye: <opt-id>, <opt-id>`
```

The restore code is the full state: every option id that differs from chosen,
comma-separated. `none` means the chosen set. The page also keeps it in the URL
hash (`#sel=`), so a link is a configuration.

On the page the restore code and the **Load** field both stay open, and only the
Markdown folds behind a disclosure. Reading a configuration back is the frequent
move; the full Markdown is the rare one, so that is what hides. **That is layout,
not format** — the block above is unchanged, and Copy still copies all of it.

## Common mistakes

- **Drawing an edge you cannot say why for.** The grid colours on it as if it
  were measured. Write the why or drop the edge.
- **Marking an argued edge as sourced.** Sourced means a named document says
  it. Name it in `src` or it is argued.
- **No strawmen.** The *strawman not rejected* finding is the one that changes
  minds most. A row without one has nothing to test the chosen option against.
- **A row name written for the people already in the room.** *"Reachable by
  whom"* is a handle. Write the `problem` so a stranger can read the row.
- **A row that lists positions instead of dimensions.** *Build it / document it /
  do nothing* is three answers, not one decision. The grid then reproduces those
  three and generates nothing. See [What earns a row](#what-earns-a-row).
- **More questions after the user accepts the chosen set.** Each one is a row you
  did not draw. Rebuild the box; do not carry the missing rows in prose. See
  [When the box is finished](#when-the-box-is-finished).
- **Recommending in prose instead of drawing the box.** A paragraph that says
  "that would need a backend" is an edge nobody can click. The same fault
  appears as an answer you recommend that is not a cell anywhere.
- **A preference drawn as a constraint.** "The owner wants depth tuning" is not
  an edge. Put it in `notes`, or in `suspected`.
- **Presets that all walk the chosen set.** Four tours of the baseline teach the
  reader one configuration. Give at least one preset a `set` step.
- **Changing the export format in one place.** The page writes it; this file
  specifies it; you read it. All three, or none.
