---
name: groundtrack
description: Use for a plan already made or work already done, when a reader needs to see its shape — what calls what, what each part hands back, where it breaks, and what it needs to work. Writes one call graph with recorded walks through it, renders a self-contained page, and prints the same graph as an indented tree on request. Not for a conversation with nothing durable behind it.
---

# groundtrack

A reader who did not write a change cannot see its shape. A change arrives as a
list of files. A plan arrives as a list of tickets. Neither says what calls
what.

groundtrack turns durable material into a call graph a reader can step through.
You read the material and write one file by hand. A renderer turns that file
into one self-contained page.

**Stance.** The drawing is a claim, and the material is what holds it. You draw
what the material says. You say so when the drawing goes past it.

## When to use

- A plan already made, or work already done, and a reader needs its shape.
- The reader asks what calls what, what a part returns, or where it can break.
- The reader asks by name.

**Do not use it on a conversation.** Nothing durable exists to check the graph
against, so the one property this skill rests on disappears.

## What it takes in

**The rule is a property, not a list.** groundtrack accepts durable material
you can read, plus a file set.

That admits a written change, an unbuilt plan, a named function or region, and
a bare path into a codebase.

The source usually states the file set. A change states it. A plan's file list
states it. **When the source states none, ask the reader for it.** Never invent
a bound the reader did not choose.

## The three channels

Every node carries three channels, and they are the point of the drawing.

- **A** — what flows out of the node.
- **E** — where it breaks: the failure tags it can raise. Each tag is a
  **retry**, an **escape** or a **die**.
- **R** — what it needs to work.

The three failure kinds are different facts. A blip that retries, an error that
escapes to a caller, and a fault that destroys the process are not one thing. A
process killed for running out of memory reaches no handler, so nothing logs
it, and the debugging session drops where the data was worth having. The E
channel is where a reader sees that in advance.

## Procedure

1. **Read the material.** Follow the calls. Do not draw from the file list.

2. **Cut it into graphs.** One graph per entry point, where an entry point is a
   changed symbol that no other changed symbol calls. Seventeen files do not
   fit on one graph.

   **This rule is argued, not measured.** It was derived from one real change,
   where it gives the right answer. Nobody has run it against a set of changes
   and compared the result to a hand-drawn one. So read your own cut before you
   show it: if a graph comes out with one node, or with everything in it, the
   rule has told you something you should say out loud rather than draw.

3. **List every graph you found, and let the reader pick.** Say the list before
   you draw anything, so the reader can disagree with the cut before the work
   rather than after it. **Rank nothing and suggest nothing.** No rule for
   ranking graphs has ever been measured, so a score here would put an
   undecided default in front of every reader. A run that is not told which
   graph to draw asks.

4. **Write the file.** Read
   [`references/flightpath-file.md`](references/flightpath-file.md) for the
   shape, and
   [`skills/groundtrack/examples/greet.flightpath.json`](examples/greet.flightpath.json)
   for a complete legal file. Write the graph first. Validate it. Then write
   the walks, one at a time.

5. **Validate, read the refusal, fix, repeat.** See
   [`references/writing-walks.md`](references/writing-walks.md) for the loop and
   for the two mistakes measurement says you will make.

6. **Render the page**, and say where it is.

7. **State the limit.** The validator proves the walk is a legal path. It
   cannot prove which branch an `if` took or what an effect returned. Those
   stay your claims. Say this when you hand the page over.

## Where the run writes

**Write the file and the page to a scratch directory.** Never beside the input.
A page dropped next to the file it was made from is an artifact nobody asked
for and nothing cleans up.

**Copy either one into the repository only when the reader asks.** The artifact
is disposable by default.

The renderer will not write a page without an output path, for the same reason.

## The command line

```bash
node <skill>/scripts/render.mjs <topic>.flightpath.json --check
node <skill>/scripts/render.mjs <topic>.flightpath.json --out <page>.html
node <skill>/scripts/render.mjs <topic>.flightpath.json --text ["<run>"]
```

`<skill>` is the base directory this skill was installed into. Ask the harness
for it. Never write a fixed path.

| Flag | What it does |
| --- | --- |
| `--check` | Validates. Refusals on standard error, exit 1. Findings on standard output, exit 0. |
| `--out <page>` | Writes one self-contained HTML file. |
| `--text ["<run>"]` | Prints the tree to standard output, for one run. |

## The page

The page draws the graph and steps a cursor over one recorded walk.

Nothing is computed while the reader watches. Every branch an `if` took, every
value an effect returned, and every catch is a literal in the file. That is
what makes the walk a list of checkable claims.

The reader steps forward and back, holds the walk on the next effect or the
next error, reads the call stack and the effects ledger, opens one node to see
its body, and flips between the drawing and a tree.

The cutaway follows the cursor. Each move opens the node the walk is in and
brings the step that ran into view. A node opened by hand stays open until the
cursor next moves.

The wheel scrolls the drawing. With ctrl held it zooms about the pointer.

The contract tab states one number per node: its cyclomatic complexity, as
drawn. One, plus one for each `if`, each error handler and each backward jump.
It measures the drawing, and the drawing is what you chose to draw.

The page makes no network request. Open it by double-clicking, or send it to
somebody else.

## Cutting a large change

Three things reach the page so a reader can audit the cut.

- **The scope rule the run applied**, so the reader can disagree with it.
- **Files in the change that no node accounts for**, by name. A
  documentation-only part of a change is not silently dropped.
- **Graphs found and not drawn**, each named with why it is worth a draw.

Those last two stay two separate statements. They are different failures, and
merging them loses which is which.

## Layers

A layer redraws the same graph under a different set of dependencies. The test
layer is the obvious one.

**A layer renames a token, never a node.** The geometry is untouched, so the
redraw computes nothing. A real double goes in at the call site, through a
parameter with a real default, so the requirement is renamed and the node
stays.

Flip the toggle. A node that still reaches the real network under the test
layer is a design defect you can see, rather than a sentence you have to trust.

A layer may state its own entry. Everything the call edges cannot reach from it
draws as unreached.

A file that declares no layer map disables the toggle and says why.

## The text output

**Print the tree only when the reader asks for text.** Print it into the reply,
in a plain text fence.

- **One row is a call site**, not a node. A node called twice appears twice.
- **A repeated node is marked and stopped**, or a cycle never terminates.
- **Suggest the longest walk.** It is the only rule that names exactly one run
  in every worked example, with no tie.
- **List every run you did not print**, by name, with the blurb its author
  wrote. The reader overrules your suggestion from that line alone.
- **Print one line of provenance above everything**, so the reader knows
  whether they read a claim or a recording.

## The honesty property, and its limit

The material is durable, so a sceptical reader can go and check the drawing
against it. That is the whole reason this skill prefers real material over a
tidy invented example.

The validator proves the walk is a legal path through the graph the file
declares. **It cannot prove which branch was taken or what an effect
returned.** Those stay the author's claims.

Say the limit. Do not let a page imply a check it did not make.
