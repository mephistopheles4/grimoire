# The authoring eval on the new file shape

Evidence for [#63](https://github.com/mephistopheles4/grimoire/issues/63), which
gates [#61](https://github.com/mephistopheles4/grimoire/issues/61). Round six of
the authoring eval, on the same procedure as round five
([#45](https://github.com/mephistopheles4/grimoire/issues/45), directory
`prototypes/ir-32/` on branch `prototype/45-fix-loop`).

**The shape under test is the shipped one on this branch**, not a prototype.
There is no `check.mjs` and no `groundtrack-ir.md` here on purpose: an agent
that browsed this directory would otherwise find two shape documents that
disagree. What the agent reads is the skill's own
`references/flightpath-file.md`, the skill's own `examples/greet.flightpath.json`,
one task file, and `render.mjs --check`.

## What is here

| File | What it is |
| --- | --- |
| `PREREG-63.md` | The bar, the cap, the pinned commit and the confounds, fixed before the first run. |
| `task-1-retry.md`, `task-2-cart.md`, `task-3-import.md` | Round five's tasks, migrated to the new shape. |
| `task-4-catalog.md` | New: a change with two entry points that share one node. |
| `fidelity.mjs` | Does a green file describe the program the task asked for? Written from the task files. |
| `make-baseline.mjs` | Carries a round-five green file onto the new shape. Two edits, and it prints which is which. |
| `baseline/` | One file per task that validates clean and scores full marks. The rubric's own test. |
| `loop-report.mjs` | Scores a round of write-validate-fix runs against the pre-registered bar. |
| `discriminates.mjs` | Shows that the new task really does separate the per-graph and change-wide readings of the unaccounted finding. |
| `inspect.mjs` | Prints a file's returns, throws and E channels, for diagnosing a fidelity miss. |
| `cost.mjs` | The authoring-cost numbers, before and after. Reported, never gated. |
| `runs-loop63/` | Eval output. Every attempt and every checker output. |
| `report-as-run.txt`, `report-corrected.txt` | The round scored under the rubric reader that ran, and under the corrected one. The verdict differs; RESULTS says why. |
| `rebase-check.txt` | Every attempt file checked under the pinned commit and under #61's tip, after #61 was rebased mid-round. |
| `cost.txt` | The cost table as `cost.mjs` printed it. |
| `RESULTS-63.md` | What round six found. |

**`baseline/` files are `.json`, not `.flightpath.json`, and deliberately so.**
`scripts/build-pages.mjs` walks the whole tree for that suffix and publishes
every valid file it finds to the public site. These are internal eval fixtures,
so they carry a suffix the site build does not collect. CONTRIBUTING.md states
the rule: never commit an artifact as a fixture.

## Run it

```powershell
# the four baseline files, against the shipped validator
node ../../skills/groundtrack/scripts/render.mjs baseline/t1.json --check

# the rubric against those files: every one should be full marks
node fidelity.mjs baseline/t4.json t4 --detail

# the round, against the pre-registered bar
node loop-report.mjs runs-loop63 --detail

# what the new shape costs an author
node cost.mjs
```

## Run the eval on another agent

Nothing here is tied to one harness.

1. Give the agent three files to read and nothing else: the skill's
   `references/flightpath-file.md`, the skill's
   `examples/greet.flightpath.json`, and one task file.
2. Tell it to write the file the task asks for, then **validate and fix**:
   run `node skills/groundtrack/scripts/render.mjs <file> --check`, read the
   refusals, fix, and repeat. Cap at five passes.
3. Save each attempt as `runs-loop63/<task>-<agent>-<n>/attempt-<pass>.json`,
   and the checker's output beside it as `check-<pass>.txt`.
4. Save the agent's own account as `result.json`, so a mismatch with the files
   is visible.
5. Run `node loop-report.mjs runs-loop63`.

The scorer re-derives every number from the attempt files with the shipped
validator. It reads `result.json` only to report where the agent's account and
the files disagree.

**On this machine, redirect the checker.** `--check` exits non-zero when it
refuses, and a non-zero exit through the harness's shell tool returns no output
at all. `node … --check > check-1.txt 2>&1` then read the file, or a refused
file looks green.
