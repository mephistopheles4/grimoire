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
| Green **and** faithful | 7 of 9 first-attempt | **7 of 9** |

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

7 of 9. `t3-haiku-1` is checker-clean and describes a different program: the
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

## Two things worth carrying

### A structural check the shape does not make, and could

`t3-haiku-1`'s green file **contradicts itself**. `importContacts` declares an
`onError` catching `BadCsv`, and the same file's bad-header walk ends:

```json
{"k":"uncaught","tag":"BadCsv","message":"CSV header is missing required fields","channel":"die"}
```

A tag cannot be both caught by a frame on the stack and uncaught in the same
walk. `check.mjs` accepts both, because it validates a `handled` move against
`onError` and never asks the reverse question of an `uncaught` one. This needs
no evaluator: at the moment of `uncaught`, walk the open frames and refuse if
any declares a handler for that tag. It would have caught this file.

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
