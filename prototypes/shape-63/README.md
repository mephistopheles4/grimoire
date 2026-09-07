# The authoring eval on the new file shape

Evidence for [#63](https://github.com/mephistopheles4/grimoire/issues/63), which
gated [#61](https://github.com/mephistopheles4/grimoire/issues/61) and now gates
[#58](https://github.com/mephistopheles4/grimoire/issues/58) shipping. Rounds six
and seven of the authoring eval, on the same procedure as round five
([#45](https://github.com/mephistopheles4/grimoire/issues/45), directory
`prototypes/ir-32/` on branch `prototype/45-fix-loop`).

**Two rounds live here, and neither overwrites the other.** Round six was pinned
to `ecfb727`, #61's branch. `ship-check.mjs` then refused it at `main`, because
#62 added two lines to the shape document, so round seven re-ran the same bar
against `main`. Round six's `PREREG-63.md`, `RESULTS-63.md` and `runs-loop63/`
are its record and are not edited; round seven's carry a `ROUND7` or `-r7`
suffix.

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
| `ship-check.mjs` | **Run this before #58 ships.** Does the latest round still stand at the shipping commit, or must it be re-run? |
| `cost.mjs` | The authoring-cost numbers, before and after. Reported, never gated. |
| `runs-loop63/` | Round six's output. Every attempt and every checker output. |
| `report-as-run.txt`, `report-corrected.txt` | Round six scored under the rubric reader that ran, and under the corrected one. The verdict differs; RESULTS-63 says why. |
| `rebase-check.txt` | Every round-six attempt file checked under the pinned commit and under #61's tip, after #61 was rebased mid-round. |
| `cost.txt` | Round six's cost table as `cost.mjs` printed it. |
| `RESULTS-63.md` | What round six found. |

Round seven adds:

| File | What it is |
| --- | --- |
| `PREREG-63-ROUND7.md` | Round seven's own pre-registration. The same bar word for word, one procedural departure, its own pin. |
| `prompt-round7.md` | The exact text every round-seven agent received, committed before the first run. |
| `attest.mjs` | Does each saved attempt still reproduce its saved checker output under the pinned validator? The void rule, enforced mechanically, before any number is computed. |
| `counting-r7.mjs` | The arithmetic under every counting of the voided run, and round six scored under round seven's rule. **Read this: rule 2 passes only under the pre-registered counting.** |
| `runs-loop63-r7/` | Round seven's scored corpus. |
| `voided-r7/` | The one run the attestation excluded, kept in full. |
| `attest-r6.txt`, `attest-r7.txt`, `attest-r7-voided.txt` | The attestations as `attest.mjs` printed them. |
| `report-r7.txt`, `report-r7-void-counted.txt`, `report-r7-n10.txt` | Round seven scored, and the two alternative countings as `loop-report.mjs` prints them — see `counting-r7.txt` for why its pass counts differ. |
| `counting-r7.txt`, `cost-r7.txt`, `ship-check-round7.txt` | The countings, the cost table and the ship gate as they printed. |
| `ship-check-round6-at-150954f.txt` | The gate refusing round six at `main`. Why round seven exists. |
| `RESULTS-63-ROUND7.md` | What round seven found. |

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

# the latest round, against the pre-registered bar
node loop-report.mjs runs-loop63-r7 --detail

# every run measured the shape under test, and no file was edited after checking
node attest.mjs runs-loop63-r7

# the arithmetic under every counting of the voided run
node counting-r7.mjs

# what the new shape costs an author
node cost.mjs d4fcd66 fd5c87e

# before #58 ships: does the round still stand at the shipping commit?
node ship-check.mjs origin/main
```

## Before #58 ships

#63 gated #61, and that is done. #58 asks for something wider — *"The eval is
re-run, on the same procedure, before this ships"* — and #58 did not ship until
#62 landed as well. Between the round and the ship, the thing the round measured
can move.

**It moved once, and the round was re-run.** #62 added two lines to the shape
document, `ship-check.mjs` refused round six at `main`, and round seven ran the
same bar against `main`. That is the loop this section describes, having
actually run: [`ship-check-round6-at-150954f.txt`](ship-check-round6-at-150954f.txt)
is the refusal, [`RESULTS-63-ROUND7.md`](RESULTS-63-ROUND7.md) is what followed.

**A second nine-run round is only owed if it did move.** The round measured two
surfaces and nothing else: the shape document, which is what an agent reads, and
the validator's rules, which are what it fixes against. A change that leaves
both alone cannot have changed how hard the file is to author.

`ship-check.mjs` decides which, and refuses to guess:

```powershell
node ship-check.mjs <the-commit-that-would-ship>
```

Exit zero means the round carries and its numbers still describe the shape that
is shipping. Non-zero means re-run it.

The validator is compared by **behaviour, not by diff**, because a diff cannot
tell a rule change from a refactor. Round six's own rebase moved `render.mjs` by
thirteen lines and changed no verdict on any of the round's attempt files; a
diff would have called that a change. Both validators are run over every attempt
file of the round instead, which is the widest corpus of wrong files available.

## Run the eval on another agent

Nothing here is tied to one harness.

1. Give the agent three files to read and nothing else: the skill's
   `references/flightpath-file.md`, the skill's
   `examples/greet.flightpath.json`, and one task file.
2. Tell it to write the file the task asks for, then **validate and fix**:
   run `node skills/groundtrack/scripts/render.mjs <file> --check`, read the
   refusals, fix, and repeat. Cap at five passes.
3. Tell it to **read every finding once the checker is clean, and answer each
   one**: fix the file, or say in one line why the finding is what it meant.
   A finding never refuses, so the loop above never fixed one. A fix here is
   another pass, and it counts against the cap.
4. Save each attempt as `runs-loop63/<task>-<agent>-<n>/attempt-<pass>.json`,
   and the checker's output beside it as `check-<pass>.txt`.
5. Save the agent's own account as `result.json`, so a mismatch with the files
   is visible. Add an `answers` array beside `account`, one
   `{ "finding": "<the line the checker printed>", "answer": "<fixed | why it
   is what I meant>" }` per finding. **A kept finding and an ignored one leave
   the same attempt file**, so this array is the only evidence step 3 ran. The
   scorer does not read it; a reader does.
6. Run `node loop-report.mjs runs-loop63`.

The scorer re-derives every number from the attempt files with the shipped
validator. It reads `result.json` only to report where the agent's account and
the files disagree.

**On this machine, redirect the checker.** `--check` exits non-zero when it
refuses, and a non-zero exit through the harness's shell tool returns no output
at all. `node … --check > check-1.txt 2>&1` then read the file, or a refused
file looks green.
