---
name: eagle-eye
description: Steps in when a discussion holds three or more open decisions and at least two of them are coupled, so that one choice changes what is possible in another, or when someone asks for it by name (/eagle-eye, an eagle-eye view, or a morphological box). Stays out when the person insists on the quick route, and for two independent choices.
compatibility: Needs Node.js 24 or later to run render.mjs and audit.mjs. No install and no other dependencies.
metadata:
  contract-version: 0.3.0
---

# Eagle-eye

A problem-solving technique for whenever you want to solve a problem, by
judging your options and seeing the trade-offs between those options.

It lays coupled decisions out as a **morphological box** (Zwicky). The box has
one row per decision and one cell per option. An **edge** joins options that
rule each other out or require each other. A page reads any configuration back.
It shows what conflicts, what is missing, and seven findings that point at what
you have not looked at.

**Stance.** The person's thinking is the product. The box is the receipt. You
draw the box so they can see the system. You do not pick for them.

## How it fires

- **By name:** build the box without asking whether to. First take the
  person's current leaning, from the discussion. When the discussion does not
  show it, ask in one line and wait. Show no box, table or recommendation
  before the answer. When they state none, record "not stated".
- **On its own:** ask first. Say how many decisions are coupled. Build nothing,
  and open no page, until the person says yes. A chat table counts as building.
- **The person is in a hurry:** do not fire, and do not mention eagle-eye.
  A hurry is explicit. You judge it from what they say.

A request by name removes only the question "may I build a box?". When you are
unsure, decide and show it: mark whose choice each chosen option is, and the
tier of each edge.

## Depth

| Decisions | Output |
|---|---|
| 2–3 | A markdown table in chat, with its edges listed under it. No file, no page, no audit. |
| 4 or more | A box file and the rendered page. |

## What earns a row

**A row is a dimension of the problem. It is not a list of the answers
somebody already proposed.** Each cell of a row must combine with the cells of
every other row. The grid then produces configurations nobody wrote down.

**Test each row: can two of its cells be true at the same time? If yes, it is
not a row.** A whole position is a preset, not a cell. *Plan A*, *plan B* and
*leave it as it is* are three configurations of the real dimensions. Put them
in `presets`. A single option that rules out most of the other rows is usually
a position.

No validator can tell a dimension from a menu of positions, or find a missing
row. Both tests are yours.

## Procedure

You need the discussion or plan that holds the decisions, and each option's
source. With no problem you can state, stop. For an option with no source, a
row with no strawman, or an edge with no reason, name the gap. Do not fill it
with a guess.

1. **Brief.** Write the box's `problem` first. See [The brief](#the-brief).
2. **Rows.** Name each decision, give it a `problem`, and list the options
   that were on the table, each with a `src`. Add strawmen (*none / opposite /
   later / by hand*), flagged `strawman: true`. An option somebody proposed can
   still be a strawman. Keep its `src`.
3. **Edges.** An option rules out (`conf`) or requires (`req`) other options.
   **Every edge carries one sentence of why and a tier.** A non-argued edge
   names its source. The tiers are `measured`, `sourced` and `argued`. An edge
   inside a row is a swap, not an edge. Draw a recommendation as a cell with
   its edges, not as prose. A preference is not an edge: put it in `notes`.
   See `reference/writing-edges.md`.
4. **Audit.** Check each argued edge against the eight weakness patterns, and
   offer the audit. Flag each edge that fails. A flag says which edge to
   reread first. It is not a verdict. Read the chain and cycle findings, and
   say whether the box states the relation they derive.
5. **Chosen set and presets.** Mark one option per row as the current
   position, and say whose it is. Write at least two [presets](#presets).
6. **Render and read.** For 4 or more decisions, write `<topic>.box.json` to a
   scratch directory. Run the renderer by its path in the skill base directory:

   ```bash
   node <skill base directory>/render.mjs <scratch>/<topic>.box.json
   ```

   Lead the findings in chat with the problem, in your own words, then give the
   findings that apply. Open the HTML in the person's browser. A preview pane
   may show local files with no script; do not judge the page from one. Without
   a browser, use `--sel`.
7. **Round trip.** The page has **Export**, and the person pastes the Markdown
   back. `render.mjs <box.json> --sel "<restore code>"` reads a restore code.
   Before you change a set that does not hold, check the edges behind each
   conflict. A wrong edge makes a good set look broken. Give each weak edge one
   disposition (`reference/audit.md`).
8. **Debrief.** When the person accepts a set, say in three or four sentences
   which weakness patterns appeared (read `suspected`). Say which row changed
   most, and which pattern to watch next time. When no usage record is kept,
   also state the person's answer before the box beside the decision after it.
9. **Usage record.** Write the end line for this use.

**Keep the "evidence for the verdict" finding in what you report.** It asks:
if every edge is true, can the set still be wrong?

## When the box is finished

**Test it by acceptance.** If the person takes the chosen set as it stands, is
the decision made? Ask yourself at the moment they agree. Any question you can
still put to them is a row you did not draw.

**A question left after the person accepts a set becomes a row, not prose.**
Adding a row or two is normal work. Render again before you write anything
else down.

## The audit

`audit.mjs` ranks the argued edges for rereading. It needs a box file. Its
`--probe` says whether a key is set, and sends nothing. Details are in
`reference/audit.md`.

> **Warning: the audit sends the box's text to a model provider, and the
> person's key pays.** Run `--dry-run` first. State the four facts: it is
> available; what it sends and to whom; how many requests of what size; the
> person's key pays. Then wait for a yes in chat. Each run is a new charge, so
> a second round or a run on one configuration needs its own dry run and yes.
> Never ask for the key, and never write it into a file.

**A score never changes a tier, and never goes into the box.**

## The brief

**Every box carries a `problem`: what the whole set decides, for a reader who
does not know the domain.** Write it first. It is the test for each row: a row
that serves no part of it does not belong. Write it for a stranger, in two to
five sentences, under the [writing rules](#writing-rules). Cover:

- **The decision, and what forces it now.** Name the terms a stranger does not
  know.
- **The fixed constraints.** Name what the rows must not move.
- **The cost of no decision.** Say what goes wrong while the question stays open.

Write the problem, not your answer. The chosen set carries the answer. Two
optional fields follow it: **`who`** names the people the decision affects, and
**`when`** names the date for the decision. *"Not known"* is a valid `when`.
An example brief, and a row that challenges the premise, are in
`reference/box-file.md`.

## Presets

**Every box carries at least two, and at least one of them changes an
option.** A preset is the author saying: look at this configuration, and here
is why. Pick from these archetypes. The first is cheap; the rest earn the box.

| Archetype | What it shows |
|---|---|
| **As chosen** | The current position, row by row. |
| **The break test** | What the *most connected* option holds up. Set it, open its row, read the cascade. |
| **The strawman run** | Whether a strawman really is absurd. It is often consistent, which is the finding. |
| **The cheap route** | The lowest-cost configuration, and what it gives up. |
| **The strict route** | The most conservative configuration, and what it forbids. |
| **Coach** | Prediction before recognition, on one change (`coach: true`). |

**Title the configuration, not the verdict.** *The break test* tells the reader
what they will see. *Optimal* states the answer the box exists to test. The
`reframe` and the step rules are in `reference/box-file.md`.

## The tour

A box may carry a tour that walks a first-time reader through the page, one
region per stop. Show the page before the argument: the brief, the index and
the verdict as chosen. Then change one option with the break test, and show
the verdict move. End on the controls. In `now`, write what this box puts in
the region, not what the region is. The renderer refuses a stop whose state
does not show its region. The schema lists the regions.

## Where a box lives

Scratch by default. Keep it in the project's decision records
(`docs/decisions/`, `docs/adr/`) only when the person asks. After step 6, say
where the box is, and that you will keep it on request.

## Names in chat

**Say row names and short names in chat, never ids.** An id is machine state.
It belongs in the box file and in the restore code. This applies to findings,
recommendations, questions and the debrief. Say *"Where the debrief lands: In
chat"*, never *"deb-chat"*.

## Usage record

Eagle-eye keeps one record per use, so that the person can check that it fires
when needed and can tell when to retire it. The formats are in
`reference/usage-record.md`.

- **Where.** The file in `EAGLE_EYE_LOG`, else `~/.grimoire/eagle-eye/log.jsonl`
  (get the home folder from the shell, since file tools do not expand `~`).
  Never in the skill's folder. Never read, move or delete `~/.eagle-eye/log.jsonl`.
- **Read the path before you write.** A file whose every line is an eagle-eye
  line is the log. When no file exists, ask. Any other file: leave it alone,
  tell the person what is there, and ask where to keep the log.
- **Consent is the person's yes in chat.** Ask once, at the first build or when
  the person declines the offer. Name the path and `EAGLE_EYE_LOG`, which most
  people do not know. Say why: to check that it fires when needed, and to say
  when it should be retired. On a yes, append a consent marker at once. On a
  no, append one declined marker, never ask again, and write no line of any
  kind. A path in `EAGLE_EYE_LOG` is not a yes. The later of two markers holds.
- **Lines.** A box writes a start line when first shown and an end line after
  the debrief. A declined offer writes one line. Append with a shell and never
  replace the file. At a use's start, ask whether each open box (a start line
  with no end line) is still open. On a no, append its end line as "unanswered".
- **Review.** Count the four signals in `reference/usage-record.md` over the
  last 10 finished uses. When one reaches 5, ask the person for a review. At 10
  uses, and every 10 after, report the counts. The record proposes. Never cut
  or edit the skill because of a count.

## Writing rules

All text in a box, the findings in chat and the debrief follow ASD-STE100:
active voice, present tense, one instruction per sentence, twenty words or
fewer. **No idiom, no metaphor, no analogy.** An idiom in a `why` makes the
reader guess what the edge claims. Test (ISO 24495-1): can the reader find it,
understand it, and use it?

## Box file

The shape is in `box.schema.json`, and a complete example is in
`examples/eagle-eye-skill.box.json`. The renderer says what it refuses and warns on.

## Export format

**Change the page, this file and the reader together.** The page writes it,
this file specifies it, and you read it back. All three, or none.

```markdown
## eagle-eye · <title> · N changes · <verdict>

**Problem.** <the box's problem statement>

| # | Decision | Chosen | My choice |
...
### Conflicts / Requirements not met / Ruled out / Findings
Restore code: `eagle-eye: <opt-id>, <opt-id>`
```

The **Problem** line carries the brief into the paste. The restore code is the
full state: every option id that differs from chosen, comma-separated. `none`
means the chosen set. The page also keeps it in the URL hash (`#sel=`), so a
link is a configuration.

On the page only the Markdown folds behind a disclosure. The restore code and
the **Load** field stay open. **That is layout, not format.** Copy still copies
all of it.
