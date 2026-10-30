# How the pages handle a stranger's text

This page is part of the threat model in [`threat-model.md`](threat-model.md). A control it names is named by the threat model, and a security review is handed it with the threat model.

Both renderers turn a file somebody else may have written into an HTML page you
open. This is the main risk in the repository, so this page states exactly what
guards it and where that guard stops. [`SECURITY.md`](../../SECURITY.md) is the
summary.

## The escape, and why it is narrow on purpose

Both skills pair two guards.

- **Before the file's JSON goes into a `<script>` block, the renderer writes
  every `<` as `\u003c`.** A string that contains `</script>` cannot close
  the block, and one that contains `<!--` cannot open a comment that keeps the
  page's own `</script>` from closing it. See
  `skills/eagle-eye/render.mjs` and `skills/groundtrack/scripts/render.mjs`.
- **Before author text reaches `innerHTML`, the page escapes `&` and `<`, and
  not the double quote.** The function is `esc` in
  `skills/eagle-eye/lib/eagle-eye.js` and in
  `skills/groundtrack/scripts/groundtrack.js`. Each renderer inlines its module
  into the page, so the page and the tests run the same function.

The escape is enough only because **author text never reaches an HTML
attribute.** Every interpolated attribute holds an id, an index, a number, a
fixed class name, or a help string that carries no author text. Ids are
validated rather than escaped: eagle-eye accepts `^[a-z0-9][a-z0-9-]*$`,
groundtrack `^[A-Za-z0-9][A-Za-z0-9-]*$`.

One attribute on each page is built by the module rather than the template:

- **eagle-eye:** the tier name in `class="tier …"` on the *weakest edge*
  finding. The module reduces anything other than `measured`, `sourced` or
  `argued` to `argued` before writing it.
- **groundtrack:** the tour control's help string. The only thing it takes from
  the file is the number of stops.

eagle-eye's findings are built in the module, not the template, and go through
the same escape. The module lives apart from the markup that calls it for one
reason: a function inside the page template is a function no test can reach.

## Three rules for anyone changing a page

1. **Author text goes into element content, never into an attribute.**
2. **If an attribute must ever carry author text, the narrow escape does not
   cover it.** A URL wants percent-encoding, which is what
   `scripts/build-pages.mjs` uses for the one `href` it writes. Widening the
   shared escape to cover the double quote is a security change, and is
   reviewed as one. So is any new `="${` in a template.
3. **Nothing from a file is safe as an object key, ids included.** Use
   `Groundtrack.bare()` (`Object.create(null)`) for any map keyed by text from a
   flightpath file, and `Object.hasOwn` for a membership test.
   `Groundtrack.hardenKeys` rebuilds `nodes`, `env`, `layers`, a layer's
   `nodes` and a run's `input` without a prototype. The renderer and the page
   both call it before reading the file.

### Why rule 3 exists

"Ids are validated" is true, and it makes an id safe **in an attribute**. It
says nothing about keys. The id pattern admits `constructor`, `toString`,
`valueOf`, `hasOwnProperty` and `isPrototypeOf`. Labels, file paths, failure
tags, run names and layer tokens are not validated at all.

A plain `{}` inherits from `Object.prototype`, so a key nobody set still
answers. `t[k] || fallback` never falls back, and `t[k] === undefined` never
guards. Neither throws, so the damage shows up somewhere else.

The real example was a wrong diagnosis, not a crash. A `goto` naming a missing
label is refused as *"nowhere" is not a label*. Spell the same missing label
`constructor` and that check passes, and the file is refused for a missing edge
instead. The author is told their walk is wrong when their node is wrong.

The mistake recurred three times in one afternoon, once from someone who had
just read that ids were validated. That is why it is a rule and not only a fix.

## What the tests hold

- **The escape's width.** [`tests/esc.test.mjs`](../../tests/esc.test.mjs) and
  [`tests/groundtrack-fold.test.mjs`](../../tests/groundtrack-fold.test.mjs)
  assert that `&` and `<` are escaped **and** that the double quote passes
  through. Widening or narrowing the escape is then a visible test change.
- **The script block.** [`tests/render.test.mjs`](../../tests/render.test.mjs)
  renders a `why` carrying `</script><script>…</script>` and checks it closes
  no block. Both test files also render text holding `<!--<script>`, cut the
  page's script blocks the way the HTML tokenizer does, and check the data
  block still parses and gives the text back.
  [`tests/groundtrack-render.test.mjs`](../../tests/groundtrack-render.test.mjs)
  puts `<`, `&`, a double quote and a closing script tag into **every**
  author-written field the page shows. A field left out of that fixture is a
  field with no coverage.
- **eagle-eye's findings.** One box carries `<img …>` in every row name, option
  name and `why`, fires every finding, and checks none of them writes the tag.
  This runs at the module, because the findings are built in the browser.
- **Prototype keys.** The two groundtrack test files use fixtures whose field
  **is** the bare name, such as `constructor`. A decorated name like
  `constructor.ts` is an ordinary key and tests nothing.
- **Attributes, partly.** `tests/groundtrack-render.test.mjs` fails if an
  `esc(...)` call appears inside an attribute value in groundtrack's template.

**What the tests do not cover.** They check the escape and the text it
produces, not every `innerHTML` call that consumes it. Proving "no author text
reaches an attribute" needs a parse of the rendered page, and nothing here does
that. A reviewer still holds that claim.

## The pages make no network request

Every page, and the site index, is self-contained and loads nothing on its own.
The three IBM Plex Mono faces are vendored, unmodified, under the SIL Open Font
Licence, and inlined as `data:` URIs. Each skill carries its own copy; see
`skills/eagle-eye/assets/FONTS.md` and `skills/groundtrack/assets/FONTS.md`.

The pages used to link a Google Fonts stylesheet, which told Google each time a
page was opened. That is gone.

`tests/render.test.mjs`, `tests/groundtrack-render.test.mjs` and
`tests/build-pages.test.mjs` each assert **zero** external references. They
check `src` and `href` anywhere, CSS `@import` and `url()`, `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`. A link the reader
clicks is not a request the page makes: the index carries one to GitHub, named
in the test rather than exempted by a wildcard.

## Row 5, measured

**The renderer's three commands finish in under 1.5 s on every file measured,
up to 25 MB, that passes the three limits.** The target is 3 s for each of `--check`, `--out` and `--text`. The
page's first draw is not held to that target. A page of 20,000 separate boxes
takes about 6 s, and nearly all of it is the browser building the boxes.

All numbers were measured with `fold` sharing its tables between moves (#145).
Each file below is the worst one measured that passes every limit, for the
cost it drives.

| Cost it drives | Worst passing file | `--check` | `--out` | `--text` | Page, first draw |
| --- | --- | --- | --- | --- | --- |
| Call depth (limit 1,000 calls) | A chain of 1,001 nodes, 1,000 calls deep (0.25 MB) | 0.09 s | 0.12 s | 0.08 s | 0.41 s |
| Tree rows (limit 20,000) | An entry that calls 19,999 separate nodes, and a run that enters each one (6.5 MB) | 0.38 s | 0.41 s | 0.56 s | 6.4 s |
| Tree rows, long chains | A 999-node chain whose last node calls a leaf from 19,001 sites, ids of 16 characters (1.07 MB) | 0.11 s | 0.12 s | 0.40 s | 0.66 s |
| Search for cut calls (limit 1,000,000) | 11 layers that each rename `{`, `}` and `{}`, over 10,000 calls with no arguments: 990,000 units and 330,000 cuts (0.30 MB) | 0.74 s | 0.76 s | 0.25 s | 1.1 s |
| The error-tag finding | A chain of 20,000 nodes that no entry reaches, each declaring a tag (4.9 MB) | 0.27 s | 0.29 s | 0.23 s | 0.21 s |
| Tour stops and graphs | 30,000 graphs and 30,000 tour stops (7.4 MB) | 0.40 s | 0.43 s | 0.55 s | 0.61 s |
| Tour stops and runs | 30,000 runs and 30,000 tour stops (4.9 MB) | 0.37 s | 0.38 s | 0.40 s | 0.35 s |
| A call's args against its callee's params (no limit) | 28,300 calls into a node with 28,300 params (4.42 MB). Until #247 this was 20,000 calls into each of two callees, the second skipped for a params list ending in the number 0; the check now refuses that callee | 0.14 s | 0.24 s | 0.26 s | not run: the page does not compare them |
| Long param names (no limit) | One callee with 5,000 params of 20,000 characters that differ only at the end, and a call passing one (95 MB). V8 hashes a string that long by its length alone, so a plain Set of them took 13.5 s; names that long are held by their SHA-256 digest | 0.41 s | 0.65 s | 0.38 s | not run: the page does not compare them |
| Node id length (no limit) | The long-chain file above, with ids of 1,000 characters (22.7 MB) | 0.17 s | 0.23 s | 0.52 s | 0.87 s |
| For comparison | `docs/examples/realtime-shadows.flightpath.json` (7 graphs, 88 nodes) | 0.11 s | 0.11 s | 0.16 s | 0.12 s |

**What each limit leaves for `docs/examples/realtime-shadows.flightpath.json`.** Its
deepest graph is 14 calls deep, 71 times under the limit. Its largest tree
view is 304 rows, 66 times under. Its search for cut calls costs 77,415 units,
12.9 times under.

Accepted risk: class C3 (E71), in the threat model. Every refusal in a
walk repeats the run's name, and nothing caps how many refusals one run
makes. A 2.1 MB file with a 10,000-character run name and 10,000 return moves
that each carry a value out of a `void` node prints 99 MB of refusals in
3.1 s. The volume is the run name's length times the refusal count. It
predates the `void` refusal (#245), which adds one more way to reach it. The
list-field refusals (#247) add another: one refusal per entry that is not a
string, each repeating the node id or layer name, so the volume is that name's
length times the bad-entry count. The
renderer exits with the refusal, and nothing reads the file further. Weighed
against row 5's low rating under ADR 0004, no cap is added.

Accepted risk: class C3 (E71), in the threat model.
Since groundtrack 0.63.0 the count is still not bounded, but each refusal is:
a run's name stops at 200 characters where it enters a refusal, and the
whole line at 2,000. Escaping works the other way for one shape. A character
the renderer escapes prints as six, so a short name made only of hidden
characters prints up to six times the bytes it did. Measured over 10,000
refusals, before and after:

| Run name | Before | After |
| --- | --- | --- |
| 10,000 plain characters | 0.20 s, 101.8 M characters | 0.12 s, 4.0 M characters |
| 1,900 DEL characters | 0.11 s, 20.8 M characters | 0.23 s, 14.0 M characters |

Accepted risk: class C3 (E72), in the threat model. A value of any type, such as a call's `args`, nested deep
enough overflows the stack in a JSON conversion. The renderer catches it and
prints `<file>: the renderer stopped on this file (RangeError)`, then exits
2. A 0.4 MB file nested 200,000 deep stops `--check`, `--out` and `--text`
in 0.08 s each. No limit is added: the file is refused in effect, and fast.

**A long name drawn on many tree rows is cut where it enters the row.** A
node's display name has no length limit and prints on every row that draws
the node. With only the 2,000-character line cut, a 1,000,000-character name
on 19,999 rows ran `--text` for 6.2 s and then out of memory, a fatal abort
no guard catches. Cut to 1,000 where it enters each row, the same file
reads in 0.55 s. Before 0.63.0 the renderer stopped at once on it, with a
string-length error and a stack trace.

**A printed arg name is bounded.** The args finding prints a name past 200
characters as its first 200, its length and the start of its digest. Escaped
whole, a name of 90,000,000 DEL characters (86 MB) passed V8's string limit
and ended `--check` in a stack trace after 14.7 s. Bounded, it checks in
0.57 s. This bounds what is printed and refuses nothing.

**Node ids have no length limit.** Cost follows file size. Ids of 128, 1,000
and 10,000 characters on the long-chain file check in 0.12 s, 0.17 s and
0.68 s, at 3.5 MB, 22.7 MB and 221 MB.

**Two costs inside `fold` used to miss the target, and #147 removed both.**
The tree view and the call counts no longer read call-chain keys, and `fold`
no longer copies every open frame on each move. Before is 0.24.10, after
0.24.11, same machine. The page column is after only.

| Cost | File | `--check` | `--text` | Page, first draw (after) |
| --- | --- | --- | --- | --- |
| Call-chain keys longer than 16,383 characters | A 125-node chain of 128-character ids, whose last node calls a leaf from 19,000 sites, and a run that enters each one (6.7 MB) | 0.75 s → 0.44 s | 145 s → 0.64 s | 0.44 s |
| The same, through recursion | One node that recurses 900 frames deep in its run, then calls a leaf from 10,000 sites (1.4 MB) | 0.95 s → 0.25 s | 95 s → 0.39 s | 1.1 s |
| A copy of every open frame on each move | A run that walks a 999-node chain and then 19,001 sites at its foot (2.7 MB) | 4.2 s → 0.64 s | 181 s → 1.2 s | 0.73 s |

**One page cost grew, and is known.** `frames` is now built when a state is
read, not stored on it. The source tab's `ranPcs` reads every state's frames
on each redraw. On a row 5 file that redraw went from about 147–333 ms to
641–691 ms, while `fold` itself went from 1,585 ms to 220 ms.

Measured on an AMD Ryzen 9 9950X3D (16 cores), 64 GB of RAM, Windows 11 Pro for
Workstations, Node v24.14.1, and headless Chrome 154 for the page's first draw.
