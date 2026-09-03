# Results — #45, the write-validate-fix loop

Round five. The rule, the cap and the instrument were fixed in
[PREREG-45.md](PREREG-45.md) before the first run. Evidence in `runs-loop45/`:
every attempt, every checker output, and the agent's own account of its run.

```bash
node loop-report.mjs runs-loop45 --detail
```

## What changed from round four

One thing. The agent gets `check.mjs` and is told to write, validate, read the
refusal and fix, saving each attempt. Same three tasks, same shape document,
same worked example, same weak model, same n = 3 per task.

## The numbers

| | Round four (no validator) | Round five (write-validate-fix) |
| --- | --- | --- |
| Valid on the first attempt | 4 of 9 | 1 of 9 |
| Valid within 5 passes | — | **8 of 9** |
| Passes to green | — | median 2, worst 3 |
| Valid **and** faithful | **3 of 9** | **7 of 9** |

The last row is the intersection, and it is the one that matters. Round four had
four valid files, and one of those four (`t2-haiku-3`) never runs the pricing
loop twice, which both its walks are required to do. So the loop moved
valid-and-faithful from 3 of 9 to 7 of 9 — a real gain, and still a fail.

## The verdict

**It does not close.** Rule 1 passes, rule 3 passes, **rule 2 fails**.

The loop is very good at what the checker can see and does nothing at all about
what it cannot. Both halves are measured here, and the second is the answer.

### Rule 1 — converges. PASS

8 of 9 reached a clean checker, median 2 passes, worst 3. Refusals are
actionable: a run that started at 43 errors was clean on its second attempt, and
one that started at 37 took three.

### Rule 3 — does not shrink to green. PASS

No green run lost a node, a walk or a required move. Three runs had a raw count
fall — one lost a node-body step, one lost five walk moves — and in all three
the file still satisfied every claim its task states. Restructuring a node is
an ordinary fix, not a deletion.

*The instrument over-fired here and was corrected to the rule as written.* A
first cut flagged any decrease in any of four counts. The pre-registration says
"a node, a walk or a **required** move", and `fidelity.mjs` is what says which
moves are required. Both are reported; the verdict rests on the rule.

### Rule 2 — stays honest. FAIL, and this is the finding

7 of the 8 green files, so 7 of 9 runs against a bar of 8. `t3-haiku-1` is
checker-clean and describes a different program: the
task says `BadCsv` **is not handled anywhere** and reaches the top uncaught, and
the file gives `importContacts` an `onError` that catches it.

What makes it the answer rather than one bad file is **where the misses went**:

| Miss at attempt 1 | Also a structural error? | Survived to the green file? |
| --- | --- | --- |
| `renderHtml` runs an effect, and the task says it is pure | yes | no — fixed |
| `renderHtml` never throws `BadMarkdown` on `die` | yes | no — fixed |
| the duplicate walk does not loop twice | yes | no — fixed |
| **`BadCsv` is caught somewhere** | **no** | **yes** |

**The loop repaired every fidelity miss that was also a path error, and the one
that was not survived untouched.** Three of four fixed, and the fourth is
exactly the case the ticket warned about. A declared-but-unused `onError` is a
perfectly legal path, so no refusal ever mentioned it, and the agent had no
reason to look.

Nothing was introduced while fixing. Every miss in the green files was already
in attempt 1.

## The pre-registered consequence does not fit, and that is itself a finding

PREREG-45 said a fail reopens #28's amendment against a recorder. Held to the
evidence, it does not follow, because the two residual failures are different
kinds of thing and **a recorder addresses only one of them**.

| Residual | Kind | Would a recorder remove it? |
| --- | --- | --- |
| `t2-haiku-2` never converged — a spurious `unwind` | a **walk** error | **Yes**, by construction |
| `t3-haiku-1` is green and wrong — an `onError` the program has not got | a **graph** error | **No — it makes it worse** |

A recorder replays the graph it is given. Given `t3-haiku-1`'s graph it would
emit a `handled` move for `BadCsv`, because the handler is right there on the
step. The file would become internally consistent **and still describe the wrong
program** — it would then fail two fidelity claims instead of one. Nobody
hand-wrote that walk; the graph was already wrong, and no recorder reads the
task.

So the real shape of the residual is:

- the **walk** error is bought back by a recorder, at the cost of a VM at record
  time — or by a better refusal, at the cost of a string. Measured cost of
  leaving it: one run in nine.
- the **graph** error is touched by neither side of the ticket's dichotomy. The
  `uncaught`-versus-handler check below is what catches it.

## Two things worth carrying

### A structural check the shape does not make, and could

`t3-haiku-1`'s green file **contradicts itself**. `importContacts` declares an
`onError` catching `BadCsv`, and the same file's bad-header walk ends:

```json
{"k":"uncaught","tag":"BadCsv","message":"CSV header is missing required fields","channel":"die"}
```

A tag cannot be both caught by a frame on the stack and uncaught in the same
walk. `check.mjs` accepts both, because it validates a `handled` move against
`onError` and never asks the reverse question of an `uncaught` one.

This needs no evaluator: at the moment of `uncaught`, look at **the call step
each open frame is suspended at**, and refuse if that step declares a handler
for the tag.

Getting that sentence right took writing it. Two wrong versions first:

- *any step of the node* is too wide. `onError` is per-step, and a handler on
  some other call is not in this error's way.
- *the step the frame's cursor sits at* is simply wrong. A `call` sets the
  caller's cursor to `next` **before** pushing the child, so the cursor is
  already past the guard. On this file the cursor reads 3 and the handler is on
  2. The check has to remember the call step, not read the cursor.

**Measured, not argued.** Implemented on this branch as ten lines in
`check.mjs`, tracking `callAt` when a `call` pushes a frame:

```
csv-import-contacts / bad header [10] "BadCsv" is uncaught,
    but importContacts[2] declares onError for it
```

And it costs nothing elsewhere. Across the whole corpus — the three worked
programs, the example, all 52 corpus claims, and all 18 round-four runs — **not
one file changes verdict.** The round-four baseline is still 13 of 18. The only
files it refuses are the ones that were green and wrong.

#### It took two goes, and the second one is the interesting one

A first cut checked every frame *below* the top, reasoning that the top frame is
the one that threw. That is wrong whenever the walk emits an `unwind` before
`uncaught`: the throwing frame is popped, and the guilty caller **becomes** the
top frame. Two files with identical graphs behaved differently purely on that.

The rule that survives: a frame is in the error's way when it is **suspended at
a call**. Track `callAt` on `call`, clear it on the matching `return` — the
caller has resumed, so its handler is no longer in the way — and **keep it
through an `unwind`**, which is precisely the case where the error is still
travelling. The throwing frame never has one.

With that, the check refuses both green-and-wrong files, and finds **two**
errors in each rather than one: `NoUpload` is caught by `importContacts[1]` in
both, and the task says that reaches the top uncaught too. `fidelity.mjs` never
tested for that. The structural check found more than the rubric did.

### And the remedy works — measured, on three fresh runs

`runs-loop45b/` is three more `t3` runs against the patched checker. One of them
is the whole argument in miniature. `t3-haiku-1` went 22 → 11 → 2 → 0 errors,
and its own account of pass three reads:

> still had onError handlers for BadCsv and NoUpload, which the task specifies
> should NOT be caught

It removed them on pass four and finished green **and** faithful, 23 of 23. The
semantic error became a structural one, the checker named it, and the loop —
which repairs structural errors three times in four — repaired it.

The other two: one clean at 23 of 23 in two passes, and one that still carries
the miss, because it was run against the *narrow* first cut of the check. Under
the rule as it now stands its green file is refused with two errors, so it would
have had a refusal to act on.

This is three runs, not nine. It is a demonstration that the mechanism works
end to end, not a re-run of the round.

That does not make the shape sound — it moves one semantic error into the
structural half, where the loop demonstrably fixes things.

### A refusal that names the symptom, not the cause

`t2-haiku-2` is the run that did not converge: 34 → 36 → 36 → 36 → 36 across
five passes, then a final report blaming the checker for "a limitation not
evident from the specification".

The checker was right. The whole fault is one move:

```
move 4  {"k":"return","at":2,"value":…}      ← pops the loadCart frame
move 5  {"k":"unwind"}                        ← pops the entry frame too
move 6  {"k":"call","at":2,"to":"priceCart"}  ← "call with no frame"
```

A converged run on the same task is byte-comparable up to move 4 and simply has
no move 5. The refusal named move **6**, so the agent rewrote move 6 onward four
times while the extra `unwind` sat untouched at move 5. Its error count went
*up* on the second pass and then froze.

The shape document does state this — "every frame after the first is pushed by a
`call` and popped by a `return` or an `unwind`" — but the refusal points past
the fault. An error that named the move that emptied the stack, rather than the
first move to notice, is a cheap change with a measured cost of one run in nine.

## Limits

- **One model family.** Rounds one to five all came from one. No non-Claude
  agent was reachable from this session. `README.md`'s procedure is
  harness-neutral and the gap stays open.
- **The first-attempt rate moved a lot on its own.** 4 of 9 in round four, 1 of
  9 here, same model and same tasks. n = 9 per round is thin, and the round-four
  baseline should be read as noisy too. The convergence result (8 of 9) does not
  lean on it.
- **The rubric is not the program.** `fidelity.mjs` checks what the task states.
  A file can satisfy every claim and still read badly.
