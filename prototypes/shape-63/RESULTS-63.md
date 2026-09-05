# Results — #63, the authoring eval on the new file shape

Round six. The bar, the cap, the pinned commit and the confounds were fixed in
[PREREG-63.md](PREREG-63.md) before the first run, in commit `070e612`.
Evidence in `runs-loop63/`: every attempt, every checker output, and each
agent's own account of its run.

```powershell
node loop-report.mjs runs-loop63 --detail
```

## Read this first: the verdict moved on an instrument correction

**Round six passes every pre-registered rule — on a rubric reader that was
corrected after the runs.** On the reader as it ran, the migrated fidelity rule
fails at 6 of 9 against a bar of 7.

| | As run | Corrected |
| --- | --- | --- |
| migrated · convergence | PASS 9/9 | PASS 9/9 |
| migrated · median passes | PASS 2 | PASS 2 |
| **migrated · fidelity** | **FAIL 6/9** | **PASS 9/9** |
| new task · convergence | PASS 3/3 | PASS 3/3 |
| new task · shared node defined once | PASS 3/3 | PASS 3/3 |
| **Verdict** | **#61 does not merge** | **#61 may merge** |

Both reports are committed: [`report-as-run.txt`](report-as-run.txt) and
[`report-corrected.txt`](report-corrected.txt). The correction is commit
`48a7145`, one claim, one reader. **A maintainer who rejects that commit gets
the left-hand column, and should read the argument for it below before
deciding.** It is stated here and not in a footnote because a FAIL that becomes
a PASS is exactly the thing a pre-registration exists to stop being quiet.

### The correction, and why it is not moving the bar

The claim is `checkout can return "nothing to buy"`, marked **critical**. Its
reader looked only at a `return` step's `expr`.

All three `t2` runs wrote the value the way the task words it — *"jumps to a
labelled `empty` step and returns `"nothing to buy"`"* — like this:

```json
{ "op": "let", "label": "empty", "name": "result", "expr": "\"nothing to buy\"" },
{ "op": "return", "expr": "result" }
```

PREREG-63 defines a critical claim as one whose absence makes the file **a
different program**. Binding a literal one step before returning it is not a
different program. The reader was narrower than the claim it implements, and
the corrected reader accepts either form.

**Round five set this precedent in the same words**, when its shrink detector
fired on a raw count the pre-registered rule did not mention: *"The instrument
over-fired here and was corrected to the rule as written. Both are reported;
the verdict rests on the rule."*

**The cross-check that this is like-for-like.** All three of round five's own
`t2` green files score full marks under **both** readers. So the 7-of-9 round
five baseline is unchanged by the correction, and the two rounds are compared
on the same instrument.

## The numbers

| | Round five | Round six |
| --- | --- | --- |
| Valid on the first attempt | 1 of 9 | **4 of 9** |
| Converged within 5 passes | 8 of 9 | **9 of 9** |
| Passes to green | median 2, worst 3 | median 2, worst 5 |
| Valid **and** faithful | 7 of 9 | **9 of 9** (6 of 9 as run) |

Passes to green, per run: 1, 2, 2, 1, 1, 1, 3, 5, 4.

**The container change did not cost convergence.** Every migrated run reached a
clean checker, one more than round five did, and the median is unmoved. The
first-attempt rate went up, which is reported and leaned on for nothing: round
four read 4 of 9 and round five read 1 of 9 on the same tasks and the same
model, so nine runs is too thin for that number to mean much.

## The new two-entry task

| Run | Passes | Green | Shared node defined once | Both entries reach it | Unaccounted findings | Faithful |
| --- | --- | --- | --- | --- | --- | --- |
| `t4-haiku-1` | 2 | yes | yes | yes | 0 | no |
| `t4-haiku-2` | 1 | yes | yes | yes | 0 | **yes** |
| `t4-haiku-3` | 4 | yes | yes | yes | 0 | no |

**The part that is new is the part that worked.** Three of three converged,
three of three defined `formatPrice` once, three of three had both entries
reach it, and three of three left the change-wide unaccounted finding empty.
The pre-registered bar asked for two of three on the first two of those.

**The task is a real test of the change-wide finding**, and that was measured
rather than asserted. `discriminates.mjs` on the reference answer:

```text
per-graph reading, sheet "catalogue-page": src/filters/apply.ts, src/filters/parse.ts
per-graph reading, sheet "filter-panel":   src/catalog/render.ts, src/catalog/grid.ts
change-wide reading: nothing unaccounted
```

That is #58's argument in three lines. Read per graph, each sheet reports two
files the other sheet accounts for. Read across the change, nothing is
unaccounted.

### And the part that is not new is where it went wrong

**Fidelity on the new task is 1 of 3**, and this is not gated by the
pre-registered bar, which asks the new task only for convergence and the shared
node. It is the finding worth carrying, and both misses are the same claim:
`renderCatalog raises NoPage on the escape channel`. The task says *"When the
page is missing it throws `NoPage` on the `escape` channel."*

**Two residuals, and they are different kinds of thing.**

| Run | What it wrote | Did the checker say anything? |
| --- | --- | --- |
| `t4-haiku-1` | declares `NoPage` on `E`, gives the `db.query` step an `onError` catching it, and returns `null` | **No finding.** A declared handler counts as producing the tag, so the three-way rule is satisfied. |
| `t4-haiku-3` | declares `NoPage` on `E` and throws it nowhere | **The finding fired, naming the miss exactly.** |

`t4-haiku-1` is round five's `t3-haiku-1` pattern exactly: a declared-but-unused
handler is a perfectly legal path, it makes the file internally consistent, and
it describes a different program — the task says the failure *escapes* and the
file says it is *caught*. Round five predicted this residual and it is still
here. Nothing in #61 addresses it, and nothing in #61 was supposed to.

`t4-haiku-3` is the more useful one, and it is **procedural, not structural**:

```text
renderCatalog declares E tag "NoPage", and nothing beneath it produces that tag
ok: Price panel — two entry points — 5 node(s), 2 graph(s), 3 run(s), 1 finding(s)
```

The checker named the miss. The agent read it, called it *"1 expected finding"*
in its own account, and shipped. It was right to by the procedure it was given:
the run prompt says *"findings are not errors and do not need fixing"*, which
is what the shape document says a finding is.

**So the loop repairs what it is told to repair.** Round five's residual was
invisible to the checker. This one was visible and dismissed, which is a
cheaper problem: it needs no new rule, only a procedure that reads findings
before it stops. That is a note for the skill's procedure, not for #61, and it
is not raised as a blocker here.

## The confounds PREREG named, resolved

**The new-shape residual appeared, and it repaired.** Three first attempts were
written in the old one-graph shape. The two that met the pinned validator were
refused with the message naming `graphs`, and both fixed it within one pass:

```text
this is the old one-graph shape. A file now states one change and lists its
graphs: move "entry" and "presets" into an entry of a "graphs" array …
```

That is the refusal #61 added, doing the job it was added for. Measured cost:
one pass, on two runs in twelve.

**There is no pre-existing residual to report.** PREREG set out a rule for
classing a non-converging run's residual refusals as new-shape or pre-existing.
No valid run failed to converge, so the rule had nothing to class. The stricter
walk rules that predate #61 cost this round no run.

**The retry repair did not bite.** PREREG recorded that round five's two-move
retry is refused by the shipped validator on `main` as much as on `#61`. No
round six run wrote one.

**#61 moved under the round, and the round survived it.** PREREG pinned
`ecfb727` and said that if #61 moved, the numbers are against a moving target.
It moved: #59 and #60 landed on `main` as #64 and #65, and #61 was rebased onto
them, tip `2bca1a9`. Measured, not argued — the shape document is byte-identical
across the rebase, the only `render.mjs` change moves the unaccounted-files
computation behind a helper, and **all thirty attempt files give byte-identical
checker output under both commits**. See [`rebase-check.txt`](rebase-check.txt).

## Authoring cost — reported, gating nothing

Before is `main` at `a925af4`, which is what an author reads today with #59 and
#60 in it. After is #61. Method fixed in `cost.mjs` before the numbers were read.

| Measure | Before | After | Change |
| --- | --- | --- | --- |
| Words in the shape document | 2578 | 3148 | +570 (+22%) |
| Lines in the shape document | 318 | 390 | +72 (+23%) |
| Required fields, over every object kind | 97 | 98 | +1 (+1%) |
| Object kinds the validator shape-checks | 32 | 32 | +0 |
| Refusal kinds | 63 | 69 | +6 (+10%) |

**The document grew by a fifth and the thing an author fills in did not.** The
graph object adds five required fields and the top level loses `entry` and
`presets` for `graphs`, so the net is one field. The words bought the
explanation, not the form.

*Footnote, because the artifacts are not the same one.* Round five's agents read
`prototypes/ir-32/groundtrack-ir.md`, **1870 words** — a prototype document, not
the shipped one. Comparing it directly to either column would be wrong, and it
is recorded only so nobody reconstructs a false trend from three numbers.

## Shrink to green — reported, not gated

Round five gated on this; #63's bar does not, which PREREG said in advance.

**No green run lost a node, a graph, a run or a required move.** Three runs had
a raw count fall — `t1-haiku-2` lost a move, `t3-haiku-3` and `t4-haiku-3` lost
steps — and in all three the file still satisfies every claim its task states.
Restructuring is an ordinary fix, not a deletion.

## Limits

- **Nine runs a round is thin**, and three on the new task is thinner. The
  new-task result is a weak signal by construction.
- **One model family.** `claude-haiku-4-5-20251001`, one family, as in rounds one
  to five. No non-Claude agent was reachable from this session. `README.md`'s
  procedure is harness-neutral and the gap stays open.
- **The round was interrupted and restarted.** A session rate limit cut eleven
  of the first twelve runs mid-loop. A run stopped at pass two is not "did not
  converge", it is no data, so those directories were cleared and re-run as one
  uninterrupted loop each. `t2-haiku-1` completed before the interruption and is
  unmodified.
- **One run is void, and it is a harness hazard worth naming.** The eval runs in
  a git worktree of a repository whose main checkout holds the **old** validator
  on the same disk. `t1-haiku-1-void` resolved the script path against the wrong
  root, validated the old one-graph shape, and was told it was fine — its
  `check-4.txt` is byte-identical to what `main`'s `render.mjs` prints, and has
  no `graph(s)` in its ok line. That run measured `main`, not the shape under
  test, so it is not a run that failed to converge; it is not a run. It is kept
  in place, detected mechanically by that missing graph count, reported in its
  own section, and set aside before the bar is computed. The slot was re-run
  once, with a line in the prompt telling the agent to check its ok line names a
  graph count. **One in twelve drifted.** Anyone repeating this should run the
  eval somewhere the old validator is not on the same disk.
- **One run edited an attempt after checking it.** `t1-haiku-3`'s `attempt-1`
  scores clean under the pinned validator while its `check-1.txt` reports two
  refusals. The surviving file is not the artifact of that pass, so its passes
  are counted by the number of checker runs: **2, not 1**. The scorer flags this
  and no number silently absorbs it.
- **The rubric is not the program.** `fidelity.mjs` checks what the task states.
  A file can satisfy every claim and still read badly — and, as `t4-haiku-1`
  shows, a file can satisfy the checker and describe a different program.

## The consequence, as pre-registered

**A pass ships.** On the corrected instrument, every rule passes and **#61 may
merge**. Neither the container row nor the node-map row of the box is reopened.

The one thing this round found that is worth acting on is not a reason to hold
#61: the write-validate-fix procedure stops at a clean checker and steps over
findings, and on the new task a finding named a real fidelity miss that the
agent then dismissed. That belongs to the skill's procedure and has its own
issue to be written.
