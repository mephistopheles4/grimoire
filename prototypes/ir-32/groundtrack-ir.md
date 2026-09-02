# The groundtrack file

A `<topic>.flightpath.json` file states one call graph and one or more walks
through it. An agent writes the file by hand. A page draws it. Nothing in this
repository runs the program the file describes.

This document is the shape an agent writes against. `check.mjs` enforces it,
and `corpus.mjs` asserts that this document and `check.mjs` agree.

## The four rules

1. **One name, one meaning.** No field name means two things. Where the
   prototype overloaded a name, this shape renames one side.
2. **An unknown key is an error.** `check.mjs` refuses a file that carries a key
   this document does not name. The three author-keyed maps are the exception:
   `nodes`, `env`, `layers`, `layers.<name>.nodes` and `presets[].input` hold
   names the author chooses.
3. **Nothing runs.** Every expression field is text the page prints. No program
   evaluates it, so it may say anything a reader understands.
4. **Every part is required.** A file that omits a named field is refused.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The file's own name. Lowercase, hyphens. |
| `title` | string | One line for the page head. |
| `blurb` | string | Two or three sentences: what this graph shows. |
| `entry` | string | The node id the walk enters. Must exist in `nodes`. |
| `env` | object | Ambient values the graph reads. Author-keyed. |
| `files` | array | The changed files. See [files](#files). |
| `layers` | object | Contexts that redraw the graph. See [layers](#layers). |
| `nodes` | object | The graph. Author-keyed by node id. See [a node](#a-node). |
| `presets` | array | Named runs. See [a preset](#a-preset). |
| `sheet` | object | `scopeRule` (string) and `graphsNotDrawn` (array of strings). |

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

- `A` — a string. What the node returns.
- `E` — an array of strings. The failure tags the node can raise.
- `R` — an array of strings. What the node needs to work.

### enteredBy

**This field names the test files whose specs call this node, and nothing
else.** A node whose concern is covered through its caller lists nothing here.
Coverage of a lower node follows from the call edges, so no field states it.

## A step

Every step has `op`. Every step may have `label`, a jump target other steps name,
and `aside`, a remark about the step.

**`note` is an op, and `aside` is the remark on any other step.** The prototype
used `note` for both. Rule 1 renames the annotation.

**No step carries a result.** The prototype gave an effect a `result`, a
`failIf`, a `failOnAttempt` and a `failWith`, so the interpreter knew what to
return. Nothing runs now, so all four are gone. What an effect returned is a
fact in the walk, not a rule in the program.

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
is `desc`. A walk move's readable name is `desc`. Nothing else is called
`label`.

## A preset

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The run's name. |
| `blurb` | string | One sentence: what this run shows. |
| `input` | object | The values this run starts from. Author-keyed. |
| `walk` | object | `provenance` and `steps`. See [the walk](#the-walk). |

## The walk

`provenance` is `authored` (a person or an agent wrote it) or `captured` (a real
run produced it). `steps` is a flat list of moves.

**`at` always names the step that ran.** A `move` states where the cursor landed
in `next`. No other move carries `next`.

| `k` | Fields | Meaning |
| --- | --- | --- |
| `enter` | `node` | Push the entry frame. |
| `move` | `at`, `next` | The step at `at` ran and the cursor landed at `next`. Only `note`, `let`, `if` and `goto` produce a move. |
| `call` | `at`, `to` | The call at `at` ran and pushed node `to`. |
| `effect` | `at`, `kind`, `desc`, `status`, `result?`, `error?`, `attempt?` | The effect at `at` ran. `status` is `ok` or `failed`. |
| `raise` | `at`, `tag`, `message`, `channel` | The step at `at` raised. |
| `handled` | `at`, `goto` | A handler caught it and the cursor landed at `at`, which is the step labelled `goto`. |
| `unwind` | — | Pop a frame the error passed through. |
| `return` | `at`, `value?` | The return at `at` ran and popped the frame. |
| `done` | `result?` | The entry frame returned. |
| `uncaught` | `tag`, `message`, `channel` | Nothing caught the error. |

### What a walk must satisfy

`check.mjs` proves the walk is a **legal path**. It evaluates nothing.

- Every `at` indexes a real step of the frame's node.
- A `move` lands somewhere the step at `at` can reach: the next index for a
  `note` or a `let`, the `then` or `else` label for an `if`, the `to` label for
  a `goto`.
- A `call` runs a `call` step, and `to` matches that step's `target`.
- An `effect` runs an `effect` step, and `kind` matches that step's `kind`.
- A `return` runs a `return` step.
- A `handled` names a `goto` some `onError` in that node declares, and lands on
  the step that carries it.
- Frames push and pop in order, and `done` arrives with none open.

**What it cannot prove.** Which branch an `if` took, and what an effect
returned. Both are claims the author makes. In practice a wrong branch is often
caught anyway, because the moves after it no longer fit the graph.

## layers

A layer redraws the graph for one context. Author-keyed; any name.

```json
"layers": {
  "production": { "nodes": {} },
  "tests": {
    "entry": "buildShelf",
    "nodes": { "bindSheet": { "R": ["THREE.TextureLoader → fakeLoader() · woodwork.test.ts:483"] } }
  }
}
```

- `entry` is optional and names the node this layer enters. Everything the call
  edges cannot reach from it draws as unreached.
- `nodes.<id>.R` renames that node's requirements under this layer. A layer
  substitutes a **token**, never a node.
- **A rename may cut a call edge.** Nobody declares that. `check.mjs` finds it:
  if a renamed token appears in a call step's `args`, the edge is cut under that
  layer.
