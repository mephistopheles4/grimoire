# The locked shape, and the eval that tests it

Evidence for [#32](https://github.com/mephistopheles4/grimoire/issues/32). Not a
merge base: the skill does not exist yet, and this directory is the argument for
what its file should be.

## What is here

| File | What it is |
| --- | --- |
| `groundtrack-ir.md` | The shape document. What an agent reads before it writes. |
| `check.mjs` | The hand-rolled validator. Shape, links, and the path check. |
| `corpus.mjs` | The case list that binds the document to the validator. |
| `example.flightpath.json` | One complete valid file, hand-written. |
| `migrate.mjs` | Carries the three prototype programs onto this shape. |
| `programs/` | Those three programs, migrated. All three pass. |
| `task-1-retry.md`, `task-2-cart.md` | The eval tasks. |
| `grade.mjs` | Scores a directory of eval runs and buckets each failure to a box row. |
| `runs/` | Eval output. |

## Run it

```bash
node check.mjs programs          # the three real programs
node check.mjs example.flightpath.json
node corpus.mjs                  # 32 claims, document against validator
node grade.mjs runs              # score the eval
node grade.mjs runs --detail     # with every error
```

## Run the eval on another agent

The eval is four files and a directory. Nothing is tied to one harness.

1. Give the agent `groundtrack-ir.md`, `example.flightpath.json` and one of the
   two task files.
2. Tell it to write the file the task asks for, and **not** to run any
   validator. This measures first-attempt authoring; a validated answer measures
   the checker, not the shape.
3. Save its output as `runs/<task>-<agent>-<n>.json`.
4. Run `node grade.mjs runs`.

The grader takes any directory of JSON files, so runs from different agents sit
side by side and score the same way.

## Why the failures are bucketed

A pass rate teaches nothing about which cell to pick. `grade.mjs` attributes
every error to the decision in the #32 box it indicts, so the eval discriminates
between options:

| Bucket | The decision it indicts |
| --- | --- |
| An unknown key | Does refusal catch real agent error, or only annoy? |
| What a file must carry | Does *every part required* help a weak author or drown one? |
| Who makes the walk | Can an agent author a legal path at all? If not, a recorder must ship. |
| One name, two meanings | Which renames earned their place. |
| The node category | Does the starter list anchor the word an agent picks? |
| What a layer may say | Does a per-layer entry survive an author who has never seen one? |
