# Pre-registration — #63, the authoring eval on the new file shape

Written **before the first run**. Evidence for
[#63](https://github.com/mephistopheles4/grimoire/issues/63), which gates
[#61](https://github.com/mephistopheles4/grimoire/issues/61).

## What is being measured, and why

[#61](https://github.com/mephistopheles4/grimoire/issues/61) changes the
container: a flightpath file now states **one change** with a `graphs` array and
one node map, where before it stated one graph with a top-level `entry` and
`presets`. The parent spec (#58) says the evidence against the change is
authoring cost, and that the eval is the gate. So the question is narrow: **does
a weak agent still converge on a legal file, and does that file still describe
the program the task asked for?**

## What this round is pinned to

| | |
| --- | --- |
| The shape under test | `claude/implement-58-61-c74c5a` at **`ecfb727`** |
| The shape it is compared against | `main` at `d4fcd66` |
| The validator | `skills/groundtrack/scripts/render.mjs --check`, from that commit |
| The shape document | `skills/groundtrack/references/flightpath-file.md`, from that commit |
| The worked example | `skills/groundtrack/examples/greet.flightpath.json`, from that commit |

If #61 moves, this round is against a moving target and the SHA above is what
the numbers mean. Nothing here is re-run silently against a later commit.

## What is held from round five

Round five ([#45](https://github.com/mephistopheles4/grimoire/issues/45),
branch `prototype/45-fix-loop`, directory `prototypes/ir-32/`) is the baseline,
and its procedure is repeated:

- **The same three tasks**, migrated to the new shape.
- **The write-validate-fix loop.** The agent gets the checker and is told to
  write, validate, read the refusal and fix.
- **Every attempt is saved.** `attempt-1.json` … `attempt-5.json`, with the
  checker's output beside each as `check-<n>.txt`. The agent's own account of
  how many passes it took is not evidence; the files are.
- **Cap: 5 passes.** A run that hits the cap without going green is recorded as
  **did not converge**, which is a distinct datum from a failure.
- **n = 3 per task**, one weak model family.
- **Fidelity is a rubric written from the task files before any run**, marking
  each claim `critical` or `detail`.

Round five's numbers, which are the baseline: **8 of 9** reach a clean checker,
median **2** passes; **7 of 9** valid and faithful.

## What is new

**One task.** `task-4-catalog.md` states a change with **two entry points that
share one node** — `renderCatalog` and `applyFilters`, both reaching
`formatPrice`. It is written in the same register as the existing three, and
nothing was tuned against it. Three runs.

**Its rubric**, `t4` in `fidelity.mjs`, written from the task file before the
first run. It checks the three things #63 names by hand: the shared symbol is
**defined once**, **both entries reach it**, and the **unaccounted finding is
empty** — as well as the ordinary claims about nodes, channels, layers and
walks.

**The task is answerable, and the rubric has been tested.** `baseline/` holds a
file per task that validates clean under the pinned checker and scores full
marks under the rubric. For `t1`, `t2` and `t3` those are round-five green
files carried onto the new shape by `make-baseline.mjs`; for `t4` it is a
reference answer written by hand. This is what "the migrated tasks validate
before any run" means here, and it is committed with this document.

## The bar, pre-registered

**On the three migrated tasks, nine runs:**

1. **Convergence is not below 8 of 9**, within the 5-pass cap.
2. **Median passes to green is not above 2.**
3. **Fidelity is not below 7 of 9** — valid *and* zero critical fidelity
   misses, which is the intersection round five reported.

**On the new task, three runs:**

4. **At least 2 of 3 converge.**
5. **At least 2 of 3 define the shared node once.**

## The consequence

**A pass ships.** #61 may merge.

**A fail on the migrated tasks reopens the container row of the box**, because
the new shape has made the old tasks harder.

**A fail on the new task alone reopens the node-map row**, because the shared
node is the part that is new.

**Neither fail ships with a note.** The rule is not renegotiated after the
numbers arrive.

## Two confounds, named before the numbers arrive

**The checker moved between round five and now, and not only because of #61.**
Round five's `runs-loop45/` ran against `prototypes/ir-32/check.mjs`, which had
no uncaught-versus-handler rule and no rule that an error is caught or reaches
the top. The shipped validator has both, **on `main` as much as on `#61`**. So a
convergence miss this round may indict a rule that predates #61 entirely.

*The rule for reading a miss, fixed now:* a run that does not converge is
inspected, and its residual refusals are classed as **new-shape** (about
`graphs`, a graph `entry`, a graph id, or the path-plus-names refusal wording)
or **pre-existing** (every walk rule that is on `main` too). **Only new-shape
residuals are evidence against the container row.** Pre-existing residuals are
reported as what they are: the shipped validator being stricter than round
five's, which is a separate finding and not #61's cost.

**One baseline fixture needed a repair the shape migration did not cause.**
Round five wrote a successful retry as two moves — the effect raising on
attempt 1, then the same effect succeeding on attempt 2. The shipped validator
refuses that on `main` and on `#61` alike: an error that starts travelling is
caught or reaches the top, and a silent retry is neither. The shipped shape
writes a successful retry as **one** move carrying `attempt: 2`.
`make-baseline.mjs` performs that repair, prints it, and says which of the two
edits is #61's and which is not. `t1`'s task text is unchanged, and the `t1`
rubric accepts either form, so a run that writes the two-move retry loses no
fidelity claim — it is refused by the checker, and its refusal is a
pre-existing one.

## Authoring cost — reported, never gated

`cost.mjs` computes three numbers on `main` and on `#61`, by a method fixed in
that file before the numbers were read:

- **Words** in the shape document, code fences included.
- **Required fields**, summed over every object kind the validator shape-checks,
  resolved from the validator's own tables rather than from the prose.
- **Refusal kinds**, counted as the call sites that can push a refusal.

These are reported in the results and gate nothing. A footnote records the word
count of `prototypes/ir-32/groundtrack-ir.md`, which is what round five's agents
actually read, because the shipped document and the prototype's are not the same
artifact and comparing them directly would be wrong.

## Round five's rule 3 is reported, not gated

Round five gated on *does not shrink to green*: no green run reaches its clean
file by dropping a node, a walk or a required move. #63's bar does not include
it. `loop-report.mjs` still computes it, and the result states it. Saying so
here means it is not quietly dropped when it is inconvenient.

## Stated limits of this round

- **Nine runs a round is thin**, and the first-attempt rate swung between rounds
  four and five on the same tasks and the same model. The convergence bar does
  not lean on the first-attempt rate.
- **One model family.** Rounds one to five all came from one, and so does this
  one. No non-Claude agent is reachable from this session. The procedure in
  `README.md` is harness-neutral and the gap stays open.
- **The new task is three runs, not nine.** Its bar is set accordingly, and a
  2-of-3 result is a weak signal by construction.
- **The rubric is not the program.** `fidelity.mjs` checks what the task states.
  A file can satisfy every claim and still read badly.
