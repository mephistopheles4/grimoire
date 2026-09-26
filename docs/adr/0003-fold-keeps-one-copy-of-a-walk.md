# fold keeps one copy of a walk, and each state reads its view from it

`fold` in `skills/groundtrack/scripts/groundtrack.js` replays a recorded run
into one state per cursor position. The page steps through those states, and
`--text` and `--check` read them. Each state used to carry its own copy of the
ledger, the nodes visited, the edges taken, the error path and three tables.
So a move cost as much as every move before it. A long run folded in time that
grew with the square of its length, a run of 80,000 moves ran out of memory,
and a crafted file could stall the renderer for minutes (#144, #145).

Now each of those is kept once, in a form a later move can only add to, and a
state builds its view of each when something reads it. Output did not change
by a byte.

## The rules a change must keep

- **Append only.** A list grows at its end, and a state remembers how long it
  was. A table's values are histories: each value is stamped with the state
  that wrote it, and a state reads the last value stamped at or before it. A
  later move adds entries an earlier state's read skips, so it can never
  change what an earlier state says. The open frames do not grow at one end,
  because a return drops a frame. They keep the same promise another way: a
  state holds its top cell, and no cell changes after a state can see it.
- **A frame's chain is frozen and shared.** A chain is frozen when its frame
  is pushed. Every state and every error path entry shares it. A call builds
  its callee a new chain; nothing changes one in place.
- **Open frames are a shared stack.** A move that changes the top frame puts
  a new cell in its place with `setTop`. It never changes a cell that an
  earlier state can see.
- **`frames` copies each frame on read.** The cells are shared, so a reader
  who writes into a frame must reach a copy.
- **`siteTree` is a read seam outside the printed output.** It lists a
  state's call sites parent first, each with its `parent` and its `link`. It
  must stay non-enumerable, so JSON and a deep comparison skip it. A spread
  or a `structuredClone` of a state drops it too.
- **No reader builds or splits a site key.** Readers walk `siteTree`. Only
  the printed `sites` table joins a path into a key, in `keyOf`.
- **The rule for a repeated node lives once, in `treeWalk`.** The tree view
  and the renderer's row limit both read their rows from it.
- **Views are built on read, and only the last one is kept.** Keeping every
  state's view once read put the copies back: a page stepped through a long
  run held every state's ledger at once, and grew past 12 GB. Each view is
  built fresh for the state that asked, so a write into one reaches no other
  state. Nothing in the module writes into a view.
- **The output's shape is fixed.** Every state has the same fields in the same
  order, because the order is what JSON prints. A table lists its keys in the
  order moves first entered them, and is built on `bare()`, because its keys
  are a stranger's strings (see [rendering.md](../security/rendering.md)).
- **Byte-identical is the bar.** A change to `fold` shows that every state of
  every example and of `docs/examples/pr-382.flightpath.json`, `--text` for
  every run, and `--check`, print exactly what they printed before.

## What guards the rules

The tests in `tests/groundtrack-fold.test.mjs`:

- A golden file, `tests/golden/greet-no-such-user.states.json`, compared as
  text, so field order and key order are pinned.
- "every state prints exactly what a walk stopped at that state prints".
- "a table lists its keys in the order moves first entered them".
- "no reader can change a frame's chain, in any state or on any error path
  entry".
- "writing into one state's views reaches no other state".
- "a node is listed as visited once, however many times the walk enters it".

Fourteen deliberate breakages of the sharing each failed at least one test
when these were written. A change that passes them all and still alters output
means a test is missing: add it before merging.

## Considered Options

**Copying each state, as before, was rejected.** It was the simplest code, and
it made cost and memory grow with the square of a run's length.

**Capping moves and nesting instead was rejected.** A cap tight enough to bound
the copying refused real files before it bounded hostile ones:
`docs/examples/pr-382.flightpath.json` alone has 8,155 moves across its runs.

**Keeping every view once built was rejected.** It was the first version, and
it made the page's memory grow with the square of how far a reader stepped.

**A persistent-collection library was not an option.** The renderer imports
Node built-ins only, and the page is one self-contained file.

## Consequences

`fold` is harder to read than a loop that copies. The rules above and the
tests that guard them are what make it safe to change. `fold` keeps only the
last view it built for each field, so reading another state replaces it, and
a state read again after that returns a fresh object. A caller that kept the
earlier view still holds it, writes and all, but the state's next read does
not see those writes. No reader relies on either.

`fold` no longer copies the open frames on each move (#147). A state holds
the top cell of the shared stack, and the tree view reads `fold`'s call
sites directly through `siteTree`. Building `frames` on read costs the page
more when it reads every state's frames in turn; see the threat model's
"Row 5, measured".
