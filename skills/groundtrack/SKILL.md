---
name: groundtrack
description: Use for a plan already made or work already done, when a reader needs to see its shape — what calls what, what each part hands back, where it breaks, and what it needs to work. Writes one call graph with recorded traces through it, renders a self-contained page, and prints the same graph as an indented tree on request. Not for a conversation with nothing durable behind it.
compatibility: Needs Node.js 24 or later to run render.mjs. No install and no other dependencies.
---

# groundtrack

A reader who did not write a change cannot see its shape. A change arrives as a
list of files, and a plan arrives as a list of tickets. Neither says what calls
what.

groundtrack turns durable material into a call graph a reader can step through.
You read the material and write one file by hand. A renderer turns that file
into one self-contained page.

**Stance.** The drawing is a claim, and the material is what holds it. You draw
what the material says. You say so when the drawing goes past it.

## What it takes in

Durable material you can read, plus a file set. The material can be a written
change, an unbuilt plan, a named function or region, or a bare path into a
codebase. The source usually states the file set. **When it states none, ask the
reader.** Never invent a bound the reader did not choose.

## The three channels

Every node carries three channels. They are the point of the drawing.

- **success** — what flows out of the node.
- **error** — where it breaks: the tags it can throw as a **fail**. A **die**
  never appears in this list.
- **requirements** — what it needs to work.

A fail is an expected error, and a caller is meant to catch it. A die is a
defect, and nothing is meant to catch it. The `error` list shows a reader in
advance where a failure is part of the contract.

## Procedure

1. **Read the material and follow the calls.** Do not draw from the file list.
2. **Cut it into graphs.** Draw one graph per entry point. An entry point is a
   changed symbol that no other changed symbol calls. This rule is argued, not
   measured. When a graph comes out with one node, or with everything in it,
   say so rather than draw it.
3. **List every graph you found before you draw, and let the reader pick.** Rank
   nothing and suggest nothing. A run that is not told which graph to draw asks.
   State the scope rule you applied, and each graph you did not draw, in `sheet`.
4. **Write one file for the change.** One file states the change: its title,
   its blurb, its changed files, its sheet rule, one node map, and a list of
   graphs. A graph is an entry point and the runs from it, so a second graph is
   an entry named rather than a second file. A symbol two graphs reach is
   defined once.

   Read [`references/flightpath-file.md`](references/flightpath-file.md) for
   the shape, and
   [`examples/greet.flightpath.json`](examples/greet.flightpath.json)
   for a complete legal file. Write the nodes and the graphs first. Validate.
   Then write the traces, one at a time.
   The loop and the two mistakes you will make are in
   [`references/writing-traces.md`](references/writing-traces.md).
5. **Answer every finding.** `--check` exits zero and still prints findings,
   because a finding never refuses. Fix the file, or write one line saying why
   the finding is what you meant. **Give the reader the findings you kept**,
   each with its line. A reader who never sees a finding cannot disagree.
6. **Write the tour.** Pick the run that shows the most, usually one that
   fails. Stop where something happens: the call that can fail, the throw, the
   catch, the effects. In `now`, say what the reader sees, not what the region
   is. See the `tour` section of the file reference. Validate again.
7. **Render the page, and say where it is.** Tell the reader that AI drew it.
   Say that it can be wrong, and that the reader must check it against the change.
8. **State the limit.** The validator proves the trace is a legal path. It
   cannot prove which branch an `if` took or what an effect returned. Those
   stay your claims. Say so when you hand the page over.

**Write the file and the page to a scratch directory,** never beside the input.
Copy either into the repository only when the reader asks.

## Cutting a large change

Three things reach the page so a reader can audit the cut.

- **The scope rule the run applied**, so the reader can disagree with it.
- **Files in the change that no node accounts for**, by name. A
  documentation-only part of a change is not silently dropped. It reads every
  node of the change, so a file one graph covers is not reported because
  another does not.
- **Graphs found and not drawn**, each named with why it is worth a draw. Found
  and in no sheet of this file: a graph the file carries is drawn, so it is
  never listed here.

Those last two stay two separate statements. They are different failures, and
merging them loses which is which.

## The command line

`<skill>` is the base directory the harness gives you. Never write a fixed path.

```bash
node <skill>/scripts/render.mjs <topic>.flightpath.json --check
node <skill>/scripts/render.mjs <topic>.flightpath.json --out <page>.html
node <skill>/scripts/render.mjs <topic>.flightpath.json --text ["<run>"] [--graph <id>]
```

`--check` prints refusals on standard error (exit 1) and findings on standard
output (exit 0). `--out` needs a path. A file with several graphs needs `--graph`
for `--text`; without it the renderer lists the graphs and stops.

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

**Print the tree only when the reader asks for text,** into the reply, in a
plain text fence. Name the graph when the file states more than one. The
renderer prints the provenance line, the other runs with their blurbs, and the
tour. Do not retype them. Suggest the longest trace as the run to print, and
name it, so the reader can overrule you from the list of other runs.
