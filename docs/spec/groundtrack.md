# groundtrack — the locked spec

**This file is canonical.** Where a ticket and this file disagree, the ticket
is the record of the argument and this file is the instruction. Where this
file is silent, the ticket resolution stands.

**A session that changes the skill's behaviour amends the section that
described the old behaviour, in place**, rather than appending a correction at
the end. The current shape of `skills/groundtrack/` is what this file states;
where a decision below has since changed, it reads as the change already made.

This document collects what [the map, #25](https://github.com/mephistopheles4/grimoire/issues/25)
and its sixteen tickets decided, in one place.

---

## Problem Statement

A reader who did not write a change cannot see its shape.

A pull request arrives as a list of files. A plan arrives as a list of tickets.
Neither says what calls what, what each part hands back, where it can break, or
what it needs in order to work. The reader opens files one at a time and holds
the graph in their head, and the parts they never load are the parts they
cannot ask about.

Four things go missing in particular:

- **Where a thing breaks, and how badly.** An expected failure a caller catches
  and a defect that destroys the process are two different facts, and a file
  list carries neither. The second is invisible to tooling as well as to the
  reader: a process killed for running out of memory reaches no error handler,
  so nothing logs it.
- **What a part actually needs.** A node's dependencies are the thing a reader
  most wants to know and the thing source code says least clearly.
- **Whether a drawing is true.** A hand-drawn diagram is a claim about a system
  with nothing holding it to the system. It is drawn once, goes stale
  immediately, and a wrong one raises no error.
- **Which part of a large change to look at at all.** A reader with no map of
  the change cannot choose a starting point, and a tool that picks for them and
  picks wrong draws a true picture of nothing interesting.

## Solution

**groundtrack** turns durable material into a call graph a reader can step
through. The reader points it at something that already exists — a diff, a
plan, a named function, a bare path into a codebase. The agent reads the
material and hand-writes one file, `<topic>.flightpath.json`, which states one
change: one node map, and one or more graphs, each an entry point and the
recorded traces from it. A zero-dependency renderer turns that file into a
single self-contained HTML page.

Every node carries three channels, in the framing the skill borrows from
Effect: **success** (what flows out), **error** (the tags it can throw as a
fail — a die is a defect and never appears here), and **requirements** (what it
needs to work). The page draws the graph and steps a cursor over a recorded
trace. Nothing is computed at read time: every branch an `if` took, every value
an effect returned, and every catch, is a literal in the file. That is what
makes the trace a list of checkable claims rather than a program a reader has
to believe.

A **layer** redraws the same graph under a different set of dependencies — the
test layer being the obvious one. Flip the toggle and a node that still reaches
the real network under test is a design defect you can see rather than a
sentence you have to trust.

**The honesty property is the point of the whole thing, and it has a stated
limit.** The material is durable, so a sceptical reader can go and check the
drawing against it. The validator proves the trace is a legal path through the
graph the file declares. It cannot prove which branch was taken or what an
effect returned; those stay the author's claims. The skill says so rather than
hiding it.

---

## User Stories

The map argued sixty-eight stories across nine groups, in issues #26–#45:
reading a change, reading a plan, stepping the trace, reading one node, reading
without the drawing, layers, writing the file, running the skill, and
maintaining the repository. Each is satisfied by the shipped skill; `SKILL.md`
and `references/` state what a reader gets today, in the present tense, and are
the document to read to find out whether a story still holds. Two are worth
naming here because the rest of this file leans on them:

- A reviewer of a large pull request wants the change cut into more than one
  graph, wants the list of graphs before any drawing, and wants the cut's rule
  stated on the page — so a wrong cut is visible and disagreeable before the
  work, not after it.
- An agent writing the file wants a validator that refuses an unknown key and a
  refusal that names the file, the graph, the run and the move — so a typo
  cannot silently change what the file means, and a fix does not require
  guessing.

## Implementation Decisions

### The skill, and what it is called

**The skill is `groundtrack`.** One word, no hyphen. Directory
`skills/groundtrack/`, invoked as `/groundtrack`, and `/grimoire:groundtrack`
under the plugin. `eagle-eye` — the sibling skill this document calls *the
incumbent* below — has a hyphen, which is incidental, not a convention.

**Its artifact is `<topic>.flightpath.json`.** The two words are placed by
where they are read: the skill name is taught once and used deliberately, so it
can afford precision; the filename is met cold in a directory listing by
somebody who has never heard of the skill, so it trades on recall. A ground
track is the path actually traced; a flight path is commonly the intended one,
which is the distinction the skill exists to draw.

**The skill names no other skill, and no vocabulary this repository does not
own.** Not in its description, its body, or its examples — [ADR
0001](../adr/0001-skills-own-their-vocabulary.md) states the repository-wide
rule and the test; this skill is the reason the rule is single-tier rather than
a floor with `groundtrack` held to something stricter.

**Where a word in the file format or on the page comes from (#90).** C# and
Java runtime words first; JavaScript's word when the two disagree; plain
English when neither has one. The contract's three channels are named
`success`, `error` and `requirements`. Breaking the file format to rename
something already shipped is allowed: nothing reads the old shape after the
break, and no compatibility shim ships alongside the new one.

**Evocative on the door, plain language inside.** The name is a metaphor. The
prose is not: page and reference text follow the same controlled-English rules
`eagle-eye` uses, tested against ISO 24495-1. Drafting vocabulary — *sheet*,
*plan*, *cutaway*, *title block* — is available to the page as long as each
word names exactly one thing. `groundtrack` and `flightpath` are reserved out
of the page's notation, so neither also names a region or a line style.

### What it takes in

**The admission rule is a property, not a list:** groundtrack accepts durable
material an agent can read, plus a file set. That admits a written change, an
unbuilt plan, a named function or region, and a bare module path.

**The source usually states the file set.** A diff states it, a plan's file
list states it. **When the source states none, the reader states it**, and the
skill asks rather than inventing a bound.

**The agent hand-writes the file.** It reads the source the way it reads any
other material and writes the JSON. There is no parser, no static analysis and
no dependency. Static analysis buys completeness, and this artifact never
claims completeness, so it never needs the promise.

### How a large change is cut

**One graph per entry point**, where an entry point is a changed symbol that no
other changed symbol calls — the roots of the changed-call graph. **This rule
is argued, not measured** (see [Further Notes](#further-notes)).

**The skill lists every graph it found and the reader picks which to draw.**
Asking is the default and is a setting. **Nothing ranks the graphs, and nothing
suggests one.** This is stated because the opposite is an easy thing to
assume — the *text* output does suggest, but it suggests one **run** within one
graph, on a rule that names exactly one run in all three worked programs. No
rule was ever measured for ranking graphs against each other, so inventing a
score here would put an undecided default in front of every reader.

Three things reach the page so a reader can audit the cut: the scope rule the
run applied, the files in the diff that no node accounts for (by name), and the
graphs found and not drawn (each named with why it is worth a draw). *Files
with no node* and *graphs not drawn* stay two separate statements — they are
different failures and merging them loses which is which.

### The flightpath file

[`references/flightpath-file.md`](../../skills/groundtrack/references/flightpath-file.md)
is the current shape document, held to the validator by the test suite. The
decisions below are the reasons behind that shape, not a second copy of it.

- **One name, one meaning; an unknown key is an error; nothing runs; every part
  of the core is required.** The four rules the shape obeys. An empty optional
  list is refused and an absent one is not, because an empty list claims a
  change that touched nothing — a different statement from *this file says
  nothing about the topic*.
- **A file states one change, not one graph.** Node ids are unique across the
  change and a node belongs to no graph, so a symbol two graphs reach is
  defined once. Nobody argued for one graph per file; the record shows it came
  from the prototype. The evidence for one file: measured duplication — two
  programs for one pull request defined two of the same nodes, and each file
  repeated the change facts — and a finding, *a file in the change that no node
  accounts for*, that was true of one graph and silent about the rest.
- **The remark on a step and the `comment` op are two different things.** The
  prototype called both `note`; one field name meaning two things is what rule
  one rules out.
- **No step carries a result.** The prototype gave an effect a result, a
  failure condition, a failing attempt and a failure value, so its interpreter
  knew what to return. Nothing runs now, so all four are gone: what an effect
  returned is a fact in the trace, not a rule in the program.
- **A failing effect is one move, not two, and `raise` is not a move kind.**
  The prototype had a separate raise move, and it died when the shape locked:
  an effect with both a status field and a separate raise gave a file two ways
  to say one thing.
- **Traces live in the file.** They cost about a quarter of a program file — a
  kilobyte or two per run, roughly sixty bytes a move — which is cheap enough
  that storing them elsewhere is not a question.
- **No recorder ships, and this is measured rather than argued.** A structural
  path check with no evaluator at all ran 560 moves with zero errors and caught
  nine of eleven deliberate corruptions, a wrong branch included, and a capable
  agent hand-wrote a legal trace nine times out of nine. A recorder would also
  make one of the two measured residual failures *worse*, because it replays
  the graph it is given and would render a wrong graph internally consistent.
- **A layer renames a token, never a node.** The geometry is untouched, so a
  redraw computes nothing. Settled by writing a real one: across a 2109-line
  pull request with two genuine doubles there is no mocking library and no
  stand-in module — a double goes in at the call site, through a parameter with
  a real default, so the requirement is renamed and the node stays. A cut edge
  is derived from a renamed token appearing in a call step's arguments, never
  declared.
- **A node id is letters, digits and hyphens**, not lowercase-only — the
  pattern shipped is `^[A-Za-z0-9][A-Za-z0-9-]*$`, because all three worked
  programs use camel case and the id is checked against the symbol it names.
  The property the pattern exists for holds regardless: an id reaching an HTML
  attribute is a known-safe string.
- **Two structural findings, not refusals, ship beside the validator's
  refusals:** one file edited by several nodes, and an `error` list declaring a
  tag nothing beneath it can produce. Neither is a graph-versus-trace
  contradiction, so refusing a file for either would refuse a file that says
  exactly what its author meant. The second reads the file's traces as well as
  its steps — a node produces a tag if it throws it, if a step declares a
  handler for it, or if one of its effects threw it in a trace the file
  carries — which is what takes the shipped example from one false finding to
  none.
- **A tag claimed uncaught is refused when a frame in its way declares a
  handler for it.** A frame is in the way when it is *suspended at a call* —
  track the call step when a call pushes a frame, clear it on the matching
  return, and keep it through a propagate. Two earlier formulations were wrong:
  *any step of the node* is too wide, and *the step the frame's cursor sits
  at* is simply wrong, because a call advances the caller's cursor past the
  guard before pushing the child. This check costs nothing across the whole
  corpus — not one existing file changes verdict — and it refuses exactly the
  files that were green and wrong, finding two errors in each where the
  fidelity rubric found one.
- **A refusal names the move that emptied the frame stack**, not the first move
  to notice. One measured run went 34 → 36 → 36 → 36 → 36 errors and finished
  blaming the checker, when the whole fault was a spurious propagate one move
  earlier than the refusal pointed.
- **An `uncaught` may arrive with frames still open.** It pops them, recording
  each as propagated, innermost first. `done` arrives only after the last frame
  has gone; the asymmetry is deliberate. The uncaught check reads those open
  frames for a handler that should have caught the tag. It would have nothing
  to read if the move required none.

### The validator is the schema

**The hand-rolled validator is the definition of the format, and no
machine-readable schema file ships.** `eagle-eye` ships one, held to its
validator by nothing, and six divergences already exist between them. A second
artifact that can silently disagree with the first is not worth having. A
prose shape document ships instead, and the test suite is what binds the two.

**The limit is stated, not hidden.** Structure is checkable and values are not.
An authored trace may claim any effect result and nothing contradicts it. The
skill says this where a reader will see it.

### The page

**The placement rule is tempo.** Every region is defined by how fast what it
holds changes, and each control sits with what it acts on.

| Region | Holds | Tempo |
| --- | --- | --- |
| Head | the sheet picker, the run picker, the step controls | drives the run |
| Tools, the rail's header | zoom, layer, view, and the holds | changes how the sheet is **read**, and where a run stops; never moves the cursor |
| Rail, right | call stack, arguments, error path, effects ledger | reads the trace; moves on every step |
| Cutaway, below | one node — source, files, contract | changes when a different node is opened |
| Footer band | title-block cells, sheet facts, the trace band | states the sheet; only the trace band moves |

**The sheet picker sits in the head, to the left of the run picker, because a
sheet changes slower than a run and changes everything beneath it.** A one-graph
file shows no picker at all, since a control that does nothing is worse than no
control.

Settled placements:

- **The tools are the rail's header, not a block.** One row per tool with a
  fixed key column, carrying no frame of their own and no rules between
  buttons. The layer row is built from the file, so its width is data; a row
  too long for the rail wraps under its first control.
- **No tool sits on the plan pane.** The drawing and the tree own all of it.
  The rail takes the tools at no cost to the drawing, because the fit is
  height-bound (below); the rail pays instead, with a sticky header.
- **The view toggle switches the plan between the drawing and a tree.** The
  tree is the text format rendered from the same file and the same trace, on
  paper. Stepping works in tree mode; only the animation goes.
- **The files tab shows three groups around the open node: what it changes,
  what the other nodes on this sheet change, and every file in the change, not
  only the ones no node accounts for.** The first two groups leave each other's
  files out, so without the third, a reader could not see where one node's
  file sits in the whole change; see
  [`SKILL.md`](../../skills/groundtrack/SKILL.md) for the current wording. The
  grouping is a pure function in the shared module, because the tab is built
  at runtime and the rendered page as a string cannot show what it draws.
- **The tree marks the error path, row by row, with a stripe, a glyph and a
  word, never a hue alone.** Rows are matched by call site, never by node, so a
  node called from several places is marked only where the error went. See
  [ADR 0002](../adr/0002-the-sheet-asks-for-a-role.md) for the stripe/glyph/word
  mechanism itself, and why it reads off the row's filtered path rather than
  the fold's raw entries.
- **The tree tells the frame the trace is in from the frames waiting under
  it.** The row states are `not called`, `running`, `waiting`, `returned` and
  `threw`. `threw` says this frame left by throwing; it says nothing about
  whether a caller caught the error, which is the error path's job — a frame
  whose error a caller caught still reads `threw`, and the caller that caught
  it and then returned reads `returned`. The word is read from the call site's
  own counts, never from the error path, which is empty once a caught error
  has been run past. Neither state takes a hue: a position on the stack is not
  a condition, and [ADR
  0002](../adr/0002-the-sheet-asks-for-a-role.md) states which two conditions
  do get one, and why colour by node role was declined.
- **The arguments block is read-only**, showing the run's whole input block
  including any injected fault. A field that looks editable and is not is worse
  than a value that never looked editable.
- **The provenance stamp goes in the footer band**, costing nothing there
  against a second line in whichever title-block cell would otherwise hold it.
  Authored draws as a bordered caution stamp, captured as a nominal one.
- **The cutaway opens at 12rem** — measured as the knee: the smallest cut that
  still shows a small node's whole tape. Ten clips a five-step node, and the
  tape is where the trace is read.
- **A help note hangs under the thing it describes**, centred, with its leader
  on the thing's middle, going above when there is no room below and staying on
  the thing when clamped inside the window. Hanging from a thing's left edge and
  then clamping led to nothing the reader was pointing at.

Measured facts that govern the layout:

- **The fit is height-bound in every configuration.** Deleting the whole side
  rail changes the drawing's scale by 0%, so the rail is free.
- **The scale block speaks in ratios, never percentages.**
- **Pan and zoom are load-bearing.** The drawing does not fit at 1:1 in any
  arrangement.
- **A call site's remark is the only shrinkable element on its row.** One
  remark once overflowed a row by 600 pixels on its own.

**The player may derive, never decide.** It pushes a frame, pops a frame,
appends a ledger row and moves a cursor. It evaluates nothing — the page
contains no dynamic code evaluation at all. Everything else is derived by the
fold, and held to the graph before drawing: a move naming a step the node has
not got, or a pop with no frame open, is refused rather than drawn.

**A file stating several graphs is one page with several sheets.** Each sheet
draws its own entry's reachable set — not the whole map with the rest cold —
and keeps its own run, cursor, layer, view and open node. The picker is
rendered into the page rather than built by its script, on the same bargain
the files tab makes: it is the one control counting *one per graph, or none*
depends on, and no test could count a control built at runtime.

**Author text on the page follows this repository's rendering security
policy.** [`docs/security/rendering.md`](../security/rendering.md) states the
escape and why it is narrow. It also states the rule this skill added for a
field the incumbent has not got. That field is a node's location, a path or a
URL. A URL is the thing most likely to be reached for as an attribute. Author
text goes into element content, never an attribute; an id reaching an
attribute is validated rather than escaped.

### The text output

[`SKILL.md`](../../skills/groundtrack/SKILL.md#the-text-output) states the
current behaviour. Two decisions behind it:

- **One shared fold drives the page and the text**, so the two produce the
  same row list — the half of *the same graph seen two ways* that can be held
  to code. The other half narrows: the page moves a cursor and the text has
  none.
- **The skill suggests the longest trace.** It is the only rule that names
  exactly one run in all three worked programs with no tie. *The run that
  fails* names none where nothing throws; *the widest run* ties six ways. End
  marks are not decoration: without them, all sixteen runs across the three
  worked programs print byte-identical text within their file.

### Where the files live

```text
skills/groundtrack/
  SKILL.md
  scripts/      the renderer, and the shared module it inlines
  references/   the shape document, and the trace-authoring rules
  assets/       the page template, and the vendored font faces
  examples/     the worked programs
```

The three named directories are the documented convention for a published
skill: executable code, documents loaded into context as needed, files
consumed to produce output. `examples/` is a fourth the convention neither
names nor forbids.

**This overrides `eagle-eye`'s tree shape and nothing else.** The constraints
the mould carries stand: zero dependencies, self-contained under the skill
directory, and no fixed path anywhere.

**The shared module lives in the skill's `scripts/`.** Not fixed by a
ticket — the four directories are, the module's home is not. It goes there
because it is code: the renderer requires it and inlines it into the template,
so the page and the tests run the same function, the arrangement `eagle-eye`
already uses.

### The artifact is disposable

**A run writes its file and its page to scratch, never beside its input.** A
copy in the repository happens only when the reader asks for one. This closes a
measured accident on the incumbent: a plain render drops a page beside its
input, the ignore rules do not cover it, and one working tree carried four
untracked pages because of it. **The renderer therefore requires an output path
to write a page**; `--check` and the text output write nothing.

### Wiring into the repository

**Both root scripts read one registry: a table of artifact glob to renderer
path**, keyed on repository-relative path rather than basename — publishing a
second artifact type is what made a basename collision reachable. See
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the page-naming rule this
keying exists to satisfy: two artifacts sharing a basename in different
directories both publish, and two paths that flatten to the same page name are
refused before anything renders.

**One worked example renders into the published site.** *Disposable by
default* governs what a reader's run leaves behind, not whether the repository
shows what the skill produces.

**Fonts are vendored, inlined, and licensed for it.** Six IBM Plex Mono
subsets ship — `Latin1` and `Pi`, for each of three weights, about 94 KB before
encoding — declared under the `unicode-range` IBM publishes for each. Latin1
carries the text; Pi carries the one arrow the tree and the source view draw.
The licence names `Plex` as a Reserved Font Name and defines a hand-cut subset
as a Modified Version, which may not use the reserved name; IBM's own
per-script subsets are original versions and may. The full licence ships beside
them as `OFL.txt`. The page makes no network request at all: a CDN link is a
dependency on somebody else's uptime, some hosts will not load one, and a
drawing whose monospace silently degrades is a worse drawing.

**The skill's prose is scanned, and the scan gates the merge.** groundtrack is
mostly prose an agent obeys, which is exactly what the scanner reads. See
[`docs/security/scanners.md`](../security/scanners.md) for the baseline rules
this repository holds every skill to; nothing here is scanned differently.

---

## Testing Decisions

**Test what a reader or an agent can observe, at the surface they actually
use.** For this repository that is a process: arguments in, stdout, stderr and
an exit code out, plus whatever landed on disk. A test that reaches inside the
renderer to assert on an intermediate is a test that has to be rewritten every
time the renderer is tidied, and it proves nothing about the thing anybody
runs. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) states the repository-wide
rules this suite follows — no committed artifact fixture, no reaching inside a
seam — so only what is specific to groundtrack follows here.

**One new seam, and two existing ones reused.**

- **Seam 1 — the renderer's command line.** New, and the only new one:
  `node scripts/render.mjs <file> [--check|--out <page>|--text [<run>] [--graph <id>]]`.
  Everything the skill does is observable here, and the contract matches what
  the root check already speaks — refusals on stderr with a non-zero exit, the
  answer on stdout — or the registry could not drive it without a special case.
- **Seam 2 — the shared module**, required by Node and inlined into the
  template. This is what makes the trace fold testable: the repository takes no
  dependency, so there is no headless browser and there never will be, and the
  fold has to be reachable from Node with no DOM.
- **Seam 3 — the two root scripts, through their own command lines.** Existing
  and already covered: each test copies the parts of the tree the script reads
  into a temporary directory, breaks exactly one thing, and asserts the script
  says so.

**Author text is tested per field, not once.** One fixture carries `<`, `&`, a
double quote and a closing script tag, in every author-written field the page
shows — an expression, a step remark, an effect description, an error message,
a run blurb, a layer token, a file path and its reason, and a node's location.
One field left out of that fixture is one field with no coverage, which is how
the incumbent shipped a row name that reached the page as markup.

---

## Out of Scope

- **The annotation layer's contrast, and a second colour beyond amber and
  green.** Ruled a design-system decision rather than this sheet's; see [ADR
  0002](../adr/0002-the-sheet-asks-for-a-role.md).
- **A second viewer.** The stepper prototype proved the engine and retires. One
  page ships, with the tree as a rendering behind a toggle rather than a second
  viewer.
- **The live conversation as an input.** Nothing durable exists to check the
  graph against, so the honesty property the skill rests on disappears.
- **A recorder.** No offline runner ships; see [the flightpath
  file](#the-flightpath-file) for the measurement.
- **Any change to `eagle-eye`.** Not its layout, not its schema file, not its
  divergences. Two unrelated skills making different calls is independence,
  not divergence.
- **Another skill calling groundtrack, or groundtrack calling another.** This
  repository's skills couple to no vocabulary they do not own; see [ADR
  0001](../adr/0001-skills-own-their-vocabulary.md).
- **A machine-readable schema file.** Stated here because the incumbent ships
  one and the obvious move is to copy it. The validator is the schema.

## Further Notes

**The entry-point rule is argued, not measured, and still is.** *An entry
point is a changed symbol that no other changed symbol calls* was derived from
one real pull request, where it gives the right answer. Nobody has run it
against a set of changes and compared the result to a hand-drawn one — measuring
it is a design activity rather than an implementation one, and it did not
happen during the build.

**A weak agent is unreliable at first-attempt authoring, and the validate-fix
loop only half closes the gap.** With the validator in hand, eight runs in nine
reach a clean checker in a median of two passes, and valid-and-faithful moves
from three in nine to seven in nine. The residual is precise: the loop repairs
every fidelity miss that is also a path error, and does not touch one that is
not — a declared-but-unused handler is a perfectly legal path, so no refusal
ever mentions it. Read the eval numbers as noisy: nine runs a round, and the
first-attempt rate swung from four in nine to one in nine across two rounds on
the same tasks with the same model. All five rounds came from one model
family; no other agent was reachable, and the procedure is written to be
harness-neutral so somebody can close that gap.

**A synthetic worked example is available but never the primary.** It can be
sized perfectly and tuned to show off a channel, and it gives up the property
the skill rests on: durable material a sceptical reader can go and check. The
three shipped — `greet`, `map-300-woodwork`, `pr-313` — are all real.
