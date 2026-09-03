# Pre-registration — #45, the write-validate-fix loop

Written **before the first run**, on the reproduced baseline. Evidence for
[#45](https://github.com/mephistopheles4/grimoire/issues/45).

## The baseline this is measured against

`node grade.mjs runs` on this branch, reproduced today, unchanged checker:

| Agent | First-attempt valid |
| --- | --- |
| weak | 4 of 9 |
| capable | 9 of 9 |

The weak failures are all one bucket, **Who makes the walk**, 78 errors across
5 files.

## The one change

Round four forbade the validator, to measure first-attempt authoring. This
round hands the agent `check.mjs` and tells it to write, validate, read the
refusal, and fix. Everything else is held: same three task files, same shape
document, same worked example, same weak model, same n = 3 per task.

Each attempt is saved. `attempt-1.json` … `attempt-5.json`, with the checker's
output beside each as `check-<n>.txt`. The agent's own account of how many
passes it took is not evidence; the files are.

**Cap: 5 passes.** A run that hits the cap without going green is recorded as
**did not converge**, which is a distinct datum from a failure.

## The second failure, and the instrument for it

The checker proves a walk is a *legal path*, never that it is *the* path. An
agent that fixes until green can land on a file that passes and describes the
wrong program. A pass rate cannot see this, and neither can `grade.mjs`, which
buckets refusals — a green file produces no bucket at all.

So `fidelity.mjs` is written **from the three task files alone**, before any run
of this round. It asserts what each task states: which nodes exist, which
channel a tag rides, which branch a walk takes, what an effect raised, whether a
walk ends `done` or `uncaught`, which layer renames which token, and the exact
file rows. Every claim is marked **critical** or **detail**.

- **critical** — the task states it and the program is a different program
  without it.
- **detail** — the task states it and getting it wrong is an inaccuracy, not a
  different program (an `adds` count, a preset's wording).

## The degenerate fix path

The cheapest way "fix until green" goes wrong is by **deleting**: dropping a
branch, shortening a walk, removing an effect until the checker stops
complaining. Measured directly — node count and total walk-move count at
attempt 1 against the final attempt. Shrinkage is the tell, and it is reported
per run whether or not the run went green.

## The verdict rule

**It closes** — and `walk-checked` stands with no caveat — only if all three
hold:

1. **Converges.** ≥ 8 of 9 weak runs reach a clean `check.mjs` within 5 passes.
2. **Stays honest.** ≥ 8 of 9 of those green files carry **zero critical
   fidelity misses**.
3. **Does not shrink to green.** No green run reaches its clean file by dropping
   a node, a walk or a required move that attempt 1 had.

**It does not close** if any one of the three fails, and #28's amendment
reopens against a recorder.

Anything landing between these is reported as it fell. The rule is not
renegotiated after the numbers arrive.

## Stated limits of this round

- **One model family.** Every run in rounds one to four came from one family,
  and so does this one. No non-Claude agent is reachable from this session. The
  README's procedure is harness-neutral and the gap stays open.
- **The rubric is not the program.** `fidelity.mjs` checks what the task states.
  A file can satisfy every claim and still read badly.
