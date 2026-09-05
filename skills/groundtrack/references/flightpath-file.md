# The flightpath file

A `<topic>.flightpath.json` file states one call graph and one or more walks
through it. You write the file by hand. A page draws it. Nothing runs the
program the file describes.

This document is the shape you write against. `scripts/render.mjs` enforces it.
**The validator is the format.** No machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.
The repository's test suite is what binds this document to the validator.

## The four rules

1. **One name, one meaning.** No field name means two things.
2. **An unknown key is an error.** The author-keyed maps are the exception:
   `nodes`, `env`, `layers`, a layer's `nodes`, and a run's `input` hold names
   you choose.
3. **Nothing runs.** Every expression field is text the page prints. No program
   evaluates it, so it may say anything a reader understands.
4. **Every part of the core is required.** Three fields sit outside the core,
   and each is optional on its own.

**Leave an optional field out rather than write it empty.** `"files": []`
claims a change that touched nothing, which is a different statement from *this
file says nothing about changed files*. The validator refuses the empty list
for that reason.

## The core and the three optional fields

groundtrack draws two kinds of thing. A **change** is work already done: a
written change, a branch, a set of edits. A **plan** is work not yet done: a
map of tickets, a design still being argued. Both are graphs of nodes, and both
are walked.

**The core is every file's:** `id`, `title`, `blurb`, `entry`, `env`, `nodes`,
`presets`.

**Three fields are optional, and each stands alone:** `files`, `layers`,
`sheet`.

They do not divide plans from changes. A plan can touch files. A change can
need no test layer.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The file's own name. Letters, digits and hyphens. |
| `title` | string | One line for the page head. |
| `blurb` | string | Two or three sentences: what this graph shows. |
| `entry` | string | The node id the walk enters. Must exist in `nodes`. |
| `env` | object | Ambient values the graph reads. Author-keyed. |
| `files` | array | The changed files. See [files](#files). |
| `layers` | object | Contexts that redraw the graph. See [layers](#layers). |
| `nodes` | object | The graph. Author-keyed by node id. See [a node](#a-node). |
| `presets` | array | Named runs. See [a run](#a-run). |
| `sheet` | object | `scopeRule` (string) and `graphsNotDrawn` (array of strings). |

**A node id is letters, digits and hyphens, and nothing else.** The id reaches
the page as an HTML attribute, so it is validated rather than escaped. Every
other author string on the page goes into element content and is escaped there.
The id is a handle: put the real symbol in `name` and the real place in `loc`.

## files

Each entry: `path`, `change`, `why`, `adds`, `dels`.

`change` is one of `new`, `edit`, `delete`, `forbidden`. `adds` and `dels` are
numbers. `why` says in one sentence why the change touches this file.

## A node

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | What a reader calls this node. |
| `role` | string | What kind of thing the node is. See [role](#role). |
| `loc` | string | Where the node lives: a path, a ticket, a URL. |
| `params` | array of strings | The names this node takes in. |
| `channels` | object | `A`, `E`, `R`. See [channels](#channels). |
| `steps` | array | The node's body. See [a step](#a-step). |
| `touches` | array of strings | Paths from `files` this node changes. |
| `enteredBy` | array of strings | Test files whose specs **call** this node. |

### role

Any word. The page prints it and nothing branches on it. The words in use are
`pure`, `io`, `handler`, `agent` and `prototype`. Add one when none fits.

### channels

- `A` — a string. What flows out of the node.
- `E` — an array of strings. The failure tags the node can raise.
- `R` — an array of strings. What the node needs to work.

**Never write a tag's kind here.** The `E` channel is a list of tags, and
nothing more.

The tree, the text output and the contract tab each print `retry`, `escape` or
`die` beside a tag. The kind is derived file-wide, from the `throw` steps and
the `raised` moves. A tag found in neither prints bare. A tag found with two
kinds prints both, retry before escape before die.

### enteredBy

**This field names the test files whose specs call this node, and nothing
else.** A node whose concern is covered through its caller lists nothing here.
Coverage of a lower node follows from the call edges, so no field states it.

## A step

Every step has `op`. Every step may have `label`, a jump target other steps
name, and `aside`, a remark about the step.

**`note` is an op, and `aside` is the remark on any other step.** Two different
things, two different names.

**No step carries a result.** What an effect returned is a fact in the walk,
not a rule in the program.

| `op` | Required fields | Optional |
| --- | --- | --- |
| `note` | `note` | `label`, `aside` |
| `let` | `name`, `expr` | `label`, `aside` |
| `if` | `cond`, `then`, `else` | `label`, `aside` |
| `goto` | `to` | `label`, `aside` |
| `call` | `target` | `label`, `aside`, `args`, `bind`, `onError` |
| `effect` | `kind`, `desc` | `label`, `aside`, `args`, `bind`, `onError` |
| `throw` | `tag`, `message`, `channel` | `label`, `aside` |
| `return` | `expr` | `label`, `aside` |

`then`, `else` and `to` name a `label` on a step of the **same** node. `target`
names a node id. `channel` is one of `retry`, `escape`, `die`.

`onError` is an array of `{ tag, goto, bind? }`. `goto` names a `label` on a
step of the same node.

**`label` is a jump target and only a jump target.** An effect's readable name
is `desc`. A walk move's readable name is `desc`.

## A run

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The run's name. |
| `blurb` | string | One sentence: what this run shows. |
| `input` | object | The values this run starts from. Author-keyed. |
| `walk` | object | `provenance` and `steps`. See [the walk](#the-walk). |

## The walk

`provenance` is `authored` (a person or an agent wrote it) or `captured` (a
real run produced it). `steps` is a flat list of moves.

**Three rules cover the whole tape.**

1. **`k` is the op that ran.** A `let` step produces a `let` move, an `if` step
   an `if` move, a `call` a `call`. There is no mapping to learn. Four moves
   name no op, because they move a frame rather than run a step: `handled`,
   `unwind`, `done` and `uncaught`.
2. **`at` always names the step that ran.** Every move that runs a step has
   one. Three of the four frame moves run no step and carry none.

   **`handled` is the exception, and it is not a second rule.** A handled catch
   carries `at`, and that `at` names the call step whose `onError` caught —
   the step this frame is suspended at, not a step that just ran. It is the
   one move that arrives after an unwind, so its `at` is the only way to say
   which guard did the catching.
3. **`next` always names where the cursor goes in that same frame.** Every move
   that leaves a live cursor behind has one. The cursor never advances on its
   own, so a reader works nothing out.

The qualifiers on rules 2 and 3 carry weight. Read without them, both rules
demand a field of moves that cannot have it.

### The eight moves that run a step

| `k` | Fields |
| --- | --- |
| `note` | `at`, `next` — the following index |
| `let` | `at`, `next` — the following index |
| `if` | `at`, `next` — the `then` label or the `else` label |
| `goto` | `at`, `next` — the `to` label |
| `call` | `at`, `to`, `next` — `next` is where **this** frame resumes |
| `effect` | `at`, `kind`, `desc`, and then **either** `next` (+ `result?`, `attempt?`) **or** `raised` |
| `throw` | `at`, `tag`, `message`, `channel` |
| `return` | `at`, `value?` |

### The four moves that move a frame

| `k` | Fields | Meaning |
| --- | --- | --- |
| `handled` | `at`, `goto`, `next` | The step at `at` declares this `goto` in its `onError`. The cursor landed at `next`, the step labelled `goto`. |
| `unwind` | — | Pop a frame the error passed through. |
| `done` | `result?` | The entry frame returned. |
| `uncaught` | `tag`, `message`, `channel` | Nothing caught the error. |

### Frames

- **A walk begins in the entry node with the cursor at zero.** No move says so.
- **A call pushes the frame it names, and that frame enters at step zero.**
  Nothing else pushes a frame.
- **The call's own `next` is the caller's continuation** — where the caller
  resumes when the callee returns. It is set when the call is made, *before*
  the callee is pushed, which is why a caller's cursor is already past its own
  guard while the callee runs.
- **A frame is popped by a return or an unwind**, and by nothing else.
- **The two terminal moves are stack-free.** They arrive after the last frame
  has gone.

### An effect carries `next` or `raised`, never both

**A failing effect is one move, not two.** The effect move carries `raised`
instead of `next`, and the ledger row is derived from that one move. There is
no separate raise move, and `raise` is not a move kind. `raised` holds `tag`,
`message` and `channel`.

**Model a failure the way the code does.** If the real effect throws, write an
`effect` move with `raised`. If the real effect returns a failure value that an
`if` inspects, write the `effect` with a `next` to that `if`, and let the `if`
route to the `throw` step. Both are ordinary, and the tape tells them apart.

### A tape covering a call and a failure, in full

```json
[
  { "k": "let",    "at": 0, "next": 1 },
  { "k": "call",   "at": 1, "to": "bind-sheet", "next": 2 },
  { "k": "effect", "at": 0, "kind": "net.get", "desc": "fetch the sheet",
                   "raised": { "tag": "SheetMissing", "message": "404",
                               "channel": "escape" } },
  { "k": "unwind" },
  { "k": "handled", "at": 1, "goto": "warn", "next": 4 },
  { "k": "return", "at": 5, "value": { "bound": false } },
  { "k": "done",   "result": { "refused": null } }
]
```

Read it as: the entry frame runs a `let` and then calls, parking its own cursor
at 2. The callee enters at zero, its effect raises, and the callee's frame
unwinds. The entry frame's call step declared a handler, so the error is caught
there and the cursor lands on the step labelled `warn`. The entry frame returns,
and the walk is done with no frame open.

## What the validator proves

It proves the walk is a **legal path**, and it evaluates nothing.

- Every `at` indexes a real step of the frame's node, and equals the cursor.
- Every `next` indexes a real step of the same node.
- Every move that names an op ran a step of that op.
- `next` lands somewhere the step can reach.
- A call's `to` matches that step's `target`; an effect's `kind` matches that
  step's `kind`.
- A handled catch names a step whose `onError` declares that `goto`, and lands
  on it.
- Frames push and pop in order, and the terminal move arrives with none open.
- **A tag claimed uncaught is refused when a frame in its way declares a
  handler for it.** A frame is in the way when it is suspended at a call.
- **A refusal names the move that emptied the frame stack**, not the first move
  to notice.
- **The three exceptional moves need an error to be travelling.** A throw and a
  raising effect start one; an unwind keeps it; a handled catch and an uncaught
  end it. So an `unwind` with nothing raised is refused, a `handled` that
  catches nothing is refused, and an `uncaught` whose tag is not the one
  travelling is refused. A `handled` is also refused when the `onError` entry
  it names was declared for some other tag.
- **While an error is travelling, only the moves that carry it may run.** A
  `return` that discards the error, and a `done` that arrives while it is
  still moving, are both refused. **An error is caught, or it reaches the
  top.** There is no third ending.

**What it cannot prove.** Which branch an `if` took, and what an effect
returned. Both are claims you make. In practice a wrong branch is often caught
anyway, because the moves after it no longer fit the graph.

**Say this limit out loud when you hand the page over.** The material is
durable, so a sceptical reader can check the drawing against it. The walk's
structure is checked. Its values are not.

## layers

A layer redraws the graph for one context. Author-keyed; any name.

```json
{
  "production": { "nodes": {} },
  "tests": {
    "entry": "build-shelf",
    "nodes": { "bind-sheet": { "R": ["TextureLoader -> fakeLoader() · shelf.test.ts:483"] } }
  }
}
```

- `entry` is optional and names the node this layer enters. Everything the call
  edges cannot reach from it draws as unreached.
- `nodes.<id>.R` renames that node's requirements under this layer. **A layer
  substitutes a token, never a node.** The geometry is untouched, so a redraw
  computes nothing.
- **A cut edge is derived, never declared.** If a renamed token appears in a
  call step's `args`, that edge is cut under that layer. Nobody writes it down;
  the validator finds it. Write the rename as `old -> new`; the arrow may be
  either `->` or a single arrow character.
- **The layer set is open.** The page renders one control per layer the file
  declares. A file that declares no layer map disables the toggle and says why.

## Findings

A finding is not a refusal. `--check` prints these on standard output and still
exits zero. Each one is a thing you may have meant.

- **Several nodes edit one file.** Legal, and worth seeing: it is the shape a
  change takes when one file carries two concerns.
- **An `E` channel declaring a tag nothing beneath it can produce.** A node
  produces a tag three ways: it throws it, a step of it declares a handler for
  it, or one of its effects raised it in a walk this file carries.
- **A file in the change that no node accounts for**, by name.
- **A call edge a layer cuts.**
