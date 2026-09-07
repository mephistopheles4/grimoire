# Pre-registration — #63, round seven of the authoring eval

Written **before the first run of round seven**. Evidence for
[#63](https://github.com/mephistopheles4/grimoire/issues/63), which is now the
last open child of [#58](https://github.com/mephistopheles4/grimoire/issues/58)
and gates its ship.

**This file does not replace [PREREG-63.md](PREREG-63.md).** That document is
the record of what round six was, and [RESULTS-63.md](RESULTS-63.md) reads
against it. Neither is edited here. This is a second pre-registration, for a
second round, with its own pin.

## Why the round is being re-run

Round six passed. It also pinned itself to `ecfb727` and shipped
[`ship-check.mjs`](ship-check.mjs), a gate that asks whether the round still
stands at the commit that would ship. That gate now says it does not:

```text
round six was pinned to  ecfb727
checking it against      origin/main (150954f)

1. THE SHAPE DOCUMENT — CHANGED. What an agent reads is not what the round measured.
   3148 words -> 3171 words

2. THE VALIDATOR'S RULES — same verdict on all 31 attempt files of the round.

VERDICT: round six DOES NOT CARRY. A surface it measured has moved, so its numbers
         describe a shape that is no longer the one shipping. Re-run the round.
```

**What moved is two lines of the shape document**, added by #62's branch:

```diff
 - **Run names are unique per graph**, so two graphs may each have a happy path.
+  A repeat within one graph is refused: `--text <run>` resolves by name and
+  takes the first match, so the second would be unreachable.
```

**What did not move is the validator's rules.** The second surface was compared
by behaviour over all 31 attempt files of round six, and every one gets a
byte-identical verdict under `ecfb727` and under `150954f`.

So the honest reading is that the invalidation is small and the re-run is
cheap insurance rather than a suspicion of the result. That reading is written
here, before the numbers, so it cannot be read back onto them afterwards.
**It is not a reason to relax anything.** `ship-check.mjs` was written to
refuse to guess, and a round it refuses is re-run, not argued with.

## What this round is pinned to

| | |
| --- | --- |
| The shape under test | `prototype/63-shape-eval` at **`fd5c87e`**, rebased onto `origin/main` at `150954f` |
| The shape document | `skills/groundtrack/references/flightpath-file.md`, from that commit |
| The validator | `skills/groundtrack/scripts/render.mjs --check`, from that commit |
| The worked example | `skills/groundtrack/examples/greet.flightpath.json`, from that commit |
| The cost comparand | `d4fcd66`, `main` before #61 — the same comparand round six pinned |

`fd5c87e` changes nothing outside `prototypes/`, so its `skills/` tree is
byte-identical to `origin/main` at `150954f`. Pinning the branch tip and
pinning `main` say the same thing about the shape; the branch tip is named
because it is the tree the runs execute against.

**#61 and #62 are merged.** Round six ran against a branch that could move
under it, and recorded that it did. Round seven runs against `main`, and the
only thing that can move under it is a new merge to `main`. `ship-check.mjs`
is the instrument for that, and step 5 of this round runs it.

## What is repeated from round six, verbatim

**The bar is repeated word for word**, from [PREREG-63.md](PREREG-63.md) § *The
bar, pre-registered*. It is not restated in different words, it is the same
words:

**On the three migrated tasks, nine runs:**

1. **Convergence is not below 8 of 9**, within the 5-pass cap.
2. **Median passes to green is not above 2.**
3. **Fidelity is not below 7 of 9** — valid *and* zero critical fidelity
   misses, which is the intersection round five reported.

**On the new task, three runs:**

4. **At least 2 of 3 converge.**
5. **At least 2 of 3 define the shared node once.**

**The procedure is repeated**, and the same things are held that round six held
from round five:

- **The same four tasks**, unchanged files: `task-1-retry.md`,
  `task-2-cart.md`, `task-3-import.md`, `task-4-catalog.md`.
- **The write-validate-fix loop.** The agent gets the checker and is told to
  write, validate, read the refusal and fix.
- **Every attempt is saved.** `attempt-1.json` … `attempt-5.json`, with the
  checker's output beside each as `check-<n>.txt`. The agent's own account of
  how many passes it took is not evidence; the files are.
- **Cap: 5 passes.** A run that hits the cap without going green is recorded as
  **did not converge**, which is a distinct datum from a failure.
- **n = 3 per task**, one weak model family — `claude-haiku-4-5-20251001`, the
  same family round six used, as the `runs-loop63/` directory names record.
- **The fidelity rubric is unchanged.** `fidelity.mjs` at `fd5c87e`, which is
  round six's corrected reader. No claim is added, removed or re-marked for
  round seven.
- **The scorer is unchanged.** `loop-report.mjs` at `fd5c87e`.
- **The consequence is unchanged.** A pass ships. A fail on the migrated tasks
  reopens the container row of the box; a fail on the new task alone reopens
  the node-map row. Neither fail ships with a note. The rule is not
  renegotiated after the numbers arrive.

## The one departure, stated before the numbers, not in a footnote

**The run prompt gains one step that round six did not have**, and this round
is therefore not a controlled re-run of round six. It is a run of the current
skill under the current procedure.

Round six ended on a residual the checker had already named: `t4-haiku-3`
declared the `E` tag `NoPage`, threw it nowhere, read the finding that said so,
and shipped. That belonged to the procedure, not to #61, and it became
[#69](https://github.com/mephistopheles4/grimoire/issues/69), which is closed.
The skill's own procedure now carries the step, `README.md` § *Run the eval on
another agent* carries it as step 3, and commit `0db4f8f` — now `fd5c87e` after
the rebase — says in as many words that *"the next round then measures the
procedure as written rather than the one it replaced."*

**So round seven's agents are told to read every finding once the checker is
clean, and answer each one**: fix the file, or say in one line why the finding
is what they meant. A fix there is another pass and counts against the cap.

**What this costs, priced before the numbers arrive.** The step is not a free
improvement, and its effect on the five gated rules is asymmetric:

| Rule | Which way the new step can move it |
| --- | --- |
| 1. Convergence ≥ 8/9 | **Worse or equal only.** A findings fix is another pass against the same 5-pass cap. |
| 2. Median passes ≤ 2 | **Worse or equal only**, for the same reason. |
| 3. Fidelity ≥ 7/9 | **Better or equal**, but only where the checker prints a finding that names a claim the rubric marks critical. |
| 4. New task ≥ 2/3 converge | **Worse or equal only.** |
| 5. New task ≥ 2/3 shared node once | Unaffected — the shared-node reading does not depend on findings. |

Two of the three migrated rules can only degrade. The one that can improve,
rule 3, had no headroom in round six: migrated fidelity was 9 of 9 on the
corrected reader. **So a pass on the migrated tasks is not bought by the new
step**, and a fail on rules 1, 2 or 4 must be read as possibly the step's cost
rather than the shape's. That classing is fixed here, before the numbers.

Where the step can genuinely change the picture is `t4` fidelity, which round
six read at 1 of 3 and which **the bar does not gate**. That is reported, not
gated, exactly as it was.

**The `answers` array makes the step auditable.** `result.json` gains an
`answers` array beside `account`, one
`{ "finding": …, "answer": … }` per finding the checker printed. A kept finding
and an ignored one leave the same attempt file, so this array is the only
evidence the step ran. The scorer does not read it; a reader does.

## What round six had to write after the fact, and is written here before

Round six's results named three departures from its own pre-registration. Two
of them were rules invented after the runs. Those rules are stated here in
advance instead.

**Round seven's attempts live in `runs-loop63-r7/`.** Round six's
`runs-loop63/` is not written to, added to, or cleared. `RESULTS-63.md` points
at it, and a corpus that mixes two rounds serves neither.

**The void rule is pre-registered, not post-hoc.** A run whose checker output
came from a validator other than the pinned one **is not a run**. It is not a
run that failed to converge, and it is not counted in the denominator. The
hazard is concrete and it fired once in round six: this eval executes in a git
worktree of a repository whose **main checkout, at `C:\Users\mephi\WebstormProjects\grimoire`,
is presently on `d4fcd66` — the shape before #61** — on the same disk. An agent
that resolves the script path against the wrong root validates the old shape
and is told it is fine.

*The tell, which is objective and in the files:* the pinned validator's ok line
always names a graph count, and the old one cannot, because the old shape had
no graphs. `loop-report.mjs:164` already detects it — that detector is round
six's, committed, and is not written for this round.

*Two mechanical guards, fixed now:*

1. **The run prompt gives absolute paths** for the validator, the shape
   document, the worked example, the task file and the output directory. No
   agent resolves a relative path against a root it chose.
2. **After every run, before any number is computed**, the pinned validator is
   re-run on each `attempt-<n>.json` and its output byte-compared to the saved
   `check-<n>.txt`. A mismatch is one of two things and both are pre-declared
   **not a run**: the checker output came from elsewhere, or the attempt file
   was edited after it was checked. Round six hit the second of these too, in
   `t1-haiku-3`, and could only flag it afterwards.

**A voided slot is re-run once, and both the void and the replacement are
kept.** The arithmetic under every counting — void set aside, void kept and
replacement dropped, both kept at n = 10 — is reported, as round six reported
it, so no counting is hidden.

**The prompt is a committed artifact.** [`prompt-round7.md`](prompt-round7.md)
is the exact text every agent receives, with only the task name and the output
directory substituted. Round six's prompt was not saved and its results had to
quote fragments of it.

## What is reported and gates nothing

- **Authoring cost.** `cost.mjs`, method unchanged, against the same `d4fcd66`
  comparand round six pinned. Both #61 and #62 are now in the "after" column,
  where round six's after column held #61 alone.
- **Round five's *does not shrink to green* rule**, which #63's bar does not
  include and `loop-report.mjs` still computes.
- **First-attempt rate**, which nothing leans on: round four read 4 of 9 and
  round five read 1 of 9 on the same tasks and the same model.

## Stated limits of this round

- **Nine runs a round is thin**, and three on the new task is thinner. The
  new-task result is a weak signal by construction.
- **One model family.** `claude-haiku-4-5-20251001`, as in rounds one to six.
  No non-Claude agent is reachable from this session. `README.md`'s procedure
  is harness-neutral and the gap stays open.
- **This round is not a controlled comparison with round six.** The shape
  document moved by two lines and the procedure gained a step. Any difference
  in the numbers is attributable to either, and the round cannot separate them.
  It measures the system that would ship, which is what #58 asks for.
- **The rubric is not the program.** `fidelity.mjs` checks what the task
  states. A file can satisfy every claim and still read badly.
- **The evidence lives on an unmerged branch.** `main` has no `prototypes/`
  directory. A ship gate whose record is only on a deletable branch is a real
  weakness, and it is named here rather than discovered later. It is not this
  round's to fix.
