# The flightpath file

A `<topic>.flightpath.json` file states **one change**: its facts, one node map,
and a list of graphs. A graph is an entry point and the traces from it. You write
the file by hand. A page draws one graph at a time. Nothing runs the program the
file describes.

This document is the shape you write against. `scripts/render.mjs` enforces it.
**The validator is the format.** No machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.
The repository's test suite binds this document to the validator.

## Contents

- The four rules
- One change, one file
- Top level
- A graph
- files
- tour
- A node
  - role
  - channels
  - fail and die
  - enteredBy
- A step
- A run
- The trace
  - The eight moves that run a step
  - The four moves that move a frame
  - Frames
  - A tape covering a call and a failure, in full
- layers

## The four rules

1. **One name, one meaning.** No field name means two things.
2. **An unknown key is an error.** The author-keyed maps are the exception:
   `nodes`, `env`, `layers`, a layer's `nodes`, and a run's `input` hold names
   you choose.
3. **Nothing runs.** Every expression field is text the page prints.
4. **Every part of the core is required.** The core is `id`, `title`, `blurb`,
   `env`, `nodes` and `graphs`. Four fields sit outside it, and each is optional
   on its own: `files`, `layers`, `sheet`, `tour`.

**Leave an optional field out rather than write it empty.** `"files": []`
claims a change that touched nothing, which differs from *this file says
nothing about changed files*. The validator refuses the empty list.

## One change, one file

A change with two entry points needs two graphs, and it is still one file. The
title, the blurb, the changed files, the sheet rule, the ambient values, the
layers and the node map are stated once. The graphs list what enters where.

```json
{
  "id": "pr-313", "title": "…", "blurb": "…",
  "files": [ … ],
  "sheet": { "scopeRule": "…", "graphsNotDrawn": [ … ] },
  "env": { … },
  "layers": { … },
  "nodes": { … },
  "graphs": [
    { "id": "first-paint", "title": "…", "blurb": "…", "entry": "buildShelf", "presets": [ … ] },
    { "id": "panel-apply", "title": "…", "blurb": "…", "entry": "applySettings", "presets": [ … ] }
  ]
}
```

- **A graph is an entry point and the runs from it.** Its drawing is whatever
  its entry reaches through call edges.
- **Node ids are unique across the change.** A node belongs to no graph.
- **Run names are unique per graph.**
- **A graph id and a node id are letters, digits and hyphens.** The id reaches
  the page as an attribute, so it is validated rather than escaped. The id is a
  handle: put the real symbol in `name` and the real place in `loc`.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The file's own name. Letters, digits and hyphens. |
| `title` | string | One line for the page head: what the change is. |
| `blurb` | string | Two or three sentences: what this change is. |
| `env` | object | Ambient values the graphs read. Author-keyed. |
| `files` | array | The changed files. See [files](#files). |
| `layers` | object | Contexts that redraw the graphs. See [layers](#layers). |
| `nodes` | object | The change's one node map, author-keyed by node id. See [a node](#a-node). |
| `graphs` | array | The graphs. See [a graph](#a-graph). |
| `sheet` | object | `scopeRule` (string) and `graphsNotDrawn` (array of strings). |
| `tour` | array | The page's own walk, one stop at a time. See [tour](#tour). |

## A graph

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The graph's own name. Unique in the file. |
| `title` | string | One line: the sheet picker's label. |
| `blurb` | string | One or two sentences: what this entry point does. |
| `entry` | string | The node id the traces enter. Must exist in `nodes`. |
| `presets` | array | Named runs from this entry. See [a run](#a-run). |

## files

Each entry: `path`, `change`, `why`, `adds`, `dels`.

`change` is one of `new`, `edit`, `delete`, `forbidden`. `adds` and `dels` are
numbers. `why` says in one sentence why the change touches this file.

## tour

A tour walks a first-time reader through the page. Each stop frames one region
of the page at one move of one run. The page says what the region is. The stop
says what the reader sees there now.

```json
"tour": [
  { "region": "callStack", "run": "no such user", "move": 5,
    "now": "lookupName is on top of greet, and it has just thrown NoSuchUser." },
  { "region": "cutaway", "run": "a known user", "move": 0, "tab": "files",
    "now": "The two files this change touches: one edited, one new." }
]
```

| Field | Type | Meaning |
| --- | --- | --- |
| `region` | string | The part of the page this stop frames. One of the names below. |
| `run` | string | The name of a run of the stop's graph. |
| `move` | number | The move the page shows as `n / last`. A run of n trace steps has moves 0 to n. |
| `now` | string | One or two sentences: what the reader sees in the region at this move. |
| `graph` | string | Optional. The id of the graph the stop is on. Required when the file states more than one graph. |
| `tab` | string | Optional. The cutaway tab to open: `source`, `files` or `contract`. |
| `view` | string | Optional. `plan` for the drawing, `tree` for the indented tree. |
| `layer` | string | Optional. A layer the file declares in `layers`. |

**The regions** are `sheet`, `run`, `controls`, `plan`, `tools`, `callStack`,
`arguments`, `errorPath`, `effectsLedger`, `cutaway`, `titleBlock` and `trace`.
`sheet` exists only on a file with more than one graph.

- **Write what changed, not what the region is.** The page already says what a
  call stack is. `now` says what this run put in it.
- **A stop sets only what it names.** A tab, view or layer a stop leaves out
  stays as the stops before it set it.
- **The tour is optional.** Leave the key out rather than write it empty.

## A node

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | What a reader calls this node. |
| `role` | string | What kind of thing the node is. See [role](#role). |
| `loc` | string | Where the node lives: a path, a ticket, a URL. |
| `params` | array of strings | The names this node takes in. A name may carry its default after `=`, as in `target = surface`. A name that starts with `...` takes the rest. |
| `channels` | object | `success`, `error`, `requirements`. See [channels](#channels). |
| `steps` | array | The node's body. See [a step](#a-step). |
| `touches` | array of strings | Paths from `files` this node changes. |
| `enteredBy` | array of strings | Test files whose specs **call** this node. |

Each list is required where its parent is. Write an empty array to say "none".

### role

Any word. The page prints it, and nothing branches on it except the
pure-with-effect finding. The words in use are `pure`, `io`, `handler`, `agent`,
`prototype` and `mutates`. `pure` claims the node runs no effect. `mutates`
means the node changes one of its arguments in place.

### channels

- `success` — a string. What flows out of the node. **`void` means nothing
  flows out.** Only the exact word `void` has this meaning.
- `error` — an array of strings. The failure tags the node can throw. Never
  write a tag's kind here.
- `requirements` — an array of strings. What the node needs to work.

### fail and die

Every `throw` step, `raised` object and `uncaught` move carries a `cause`.

- **`fail` is an expected error.** A caller is meant to catch it. A fail that
  leaves a node is in that node's `error` list.
- **`die` is a defect.** Nothing is meant to catch it. A die is in no `error`
  list.

### enteredBy

This field names the test files whose specs call this node, and nothing else.
A node covered through its caller lists nothing here.

## A step

Every step has `op`. Every step may have `label`, a jump target other steps
name, and `aside`, a remark about the step. **`comment` is an op, and `aside` is
the remark on any other step.** No step carries a result.

| `op` | Required fields | Optional |
| --- | --- | --- |
| `comment` | `comment` | `label`, `aside` |
| `var` | `name`, `expr` | `label`, `aside` |
| `if` | `cond`, `then`, `else` | `label`, `aside` |
| `goto` | `to` | `label`, `aside` |
| `call` | `target` | `label`, `aside`, `args`, `bind`, `onError` |
| `effect` | `kind`, `desc` | `label`, `aside`, `args`, `bind`, `onError` |
| `throw` | `tag`, `message`, `cause` | `label`, `aside` |
| `return` | `expr` | `label`, `aside` |

`then`, `else` and `to` name a `label` on a step of the **same** node. `target`
names a node id. `cause` is `fail` or `die`. `args` is a string or an object. On
a `call` step, an object's keys are the callee's param names. `onError` is an
array of `{ tag, goto, bind? }`, where `goto` names a `label` on a step of the
same node. An effect's readable name is `desc`.

## A run

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The run's name. |
| `blurb` | string | One sentence: what this run shows. |
| `input` | object | The values this run starts from. Author-keyed. |
| `trace` | object | `provenance` and `steps`. See [the trace](#the-trace). |

## The trace

`provenance` is `authored` (a person or an agent wrote it) or `captured` (a
real run produced it). `steps` is a flat list of moves.

**Three rules cover the whole tape.**

1. **`k` is the op that ran.** A `var` step produces a `var` move, an `if` step
   an `if` move, a `call` a `call`. Four moves name no op, because they move a
   frame: `catch`, `propagate`, `done` and `uncaught`.
2. **`at` always names the step that ran.** Every move that runs a step has
   one. A `catch` move's `at` names the call step whose `onError` caught.
3. **`next` always names where the cursor goes in that same frame.** The cursor
   never advances on its own.

### The eight moves that run a step

| `k` | Fields |
| --- | --- |
| `comment` | `at`, `next` — the following index |
| `var` | `at`, `next` — the following index |
| `if` | `at`, `next` — the `then` label or the `else` label |
| `goto` | `at`, `next` — the `to` label |
| `call` | `at`, `to`, `next` — `next` is where **this** frame resumes |
| `effect` | `at`, `kind`, `desc`, and then **either** `next` (+ `result?`, `attempt?`) **or** `raised` — `attempt` counts the tries of an effect that ran more than once |
| `throw` | `at`, `tag`, `message`, `cause` |
| `return` | `at`, `value?` — never a `value` out of a `void` node |

### The four moves that move a frame

| `k` | Fields | Meaning |
| --- | --- | --- |
| `catch` | `at`, `goto`, `next` | The step at `at` declares this `goto` in its `onError`. The cursor moves to `next`, the step labelled `goto`. |
| `propagate` | — | Pop a frame the error leaves. |
| `done` | `result?` | The entry frame returned. |
| `uncaught` | `tag`, `message`, `cause` | Nothing caught the error. Pop every frame still open. |

### Frames

- **A trace begins at its graph's entry with the cursor at zero.** No move says so.
- **A call pushes the frame it names, and that frame enters at step zero.**
- **The call's own `next` is the caller's continuation.** It is set before the
  callee is pushed. While the callee runs, the caller's cursor is already past
  its own guard.
- **A frame is popped by a return, a propagate or an uncaught**, and by nothing
  else.
- **An effect carries `next` or `raised`, never both.** A failing effect is one
  move. `raised` holds `tag`, `message` and `cause`. Model a failure the way
  the code does: an effect that throws carries `raised`. An effect that returns
  a failure value carries `next` to the `if` that inspects it, and the `if`
  routes to the `throw` step.

### A tape covering a call and a failure, in full

```json
[
  { "k": "var",    "at": 0, "next": 1 },
  { "k": "call",   "at": 1, "to": "bind-sheet", "next": 2 },
  { "k": "effect", "at": 0, "kind": "net.get", "desc": "fetch the sheet",
                   "raised": { "tag": "SheetMissing", "message": "404",
                               "cause": "fail" } },
  { "k": "propagate" },
  { "k": "catch", "at": 1, "goto": "warn", "next": 4 },
  { "k": "return", "at": 5, "value": { "bound": false } },
  { "k": "done",   "result": { "refused": null } }
]
```

The entry frame runs a `var` and then calls, parking its own cursor at 2. The
callee enters at zero, its effect throws, and the callee's frame propagates. The
entry frame's call step declares a handler, so it catches the error there. The
cursor lands on the step labelled `warn`. The entry frame returns, and the trace
is done with no frame open.

## layers

A layer redraws the graph for one context. Author-keyed; any name.

```json
{
  "production": { "nodes": {} },
  "tests": {
    "entry": "build-shelf",
    "nodes": { "bind-sheet": { "requirements": ["TextureLoader -> fakeLoader() · shelf.test.ts:483"] } }
  }
}
```

- `entry` is optional and names the node this layer enters. Everything the call
  edges cannot reach from it draws as unreached.
- `nodes.<id>.requirements` renames that node's requirements under this layer.
  **A layer substitutes a token, never a node.** Write the rename as `old -> new`.
- **A cut edge is derived, never declared.** If a renamed token appears in a
  call step's `args`, that edge is cut under that layer.
