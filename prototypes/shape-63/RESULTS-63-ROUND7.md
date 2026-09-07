# Results — #63, round seven of the authoring eval

Round seven. The bar, the cap, the pin and the confounds were fixed in
[PREREG-63-ROUND7.md](PREREG-63-ROUND7.md) before the first run, in commit
`02e8626`. One later commit, `37b33d3`, is also ahead of the first agent: it put
a `Set-Location` in the run prompt, which is shell mechanics and not the bar,
the procedure or the pin.

Round six's [PREREG-63.md](PREREG-63.md) and [RESULTS-63.md](RESULTS-63.md) are
untouched. They are the record of what round six was.

```powershell
node attest.mjs runs-loop63-r7      # 29 of 29 — every run met the shape under test
node loop-report.mjs runs-loop63-r7 --detail
node counting-r7.mjs               # the arithmetic under every counting
```

## Read this first: the verdict rests on the void rule, not only on the numbers

**Round seven passes all five pre-registered rules.** It passes them under a
void rule that round seven pre-registered and round six did not have. Under
round six's counting of the *same defect*, round seven fails rule 2.

| Counting | Convergence (≥ 8/9) | Median passes (≤ 2) | Verdict |
| --- | --- | --- | --- |
| **A. Void set aside, slot re-run** — what PREREG-63-ROUND7 pre-registered | PASS 9/9 | **PASS 2** | **PASS** |
| B. Void kept as the `t3` slot, replacement dropped — round six's counting | PASS 9/9 | **FAIL 3** | **FAIL** |
| C. Both kept, n = 10 migrated | PASS 10/10 | **FAIL 3** | **FAIL** |

Round six's equivalent table showed that *no* counting of its void changed its
verdict. **That is not true here**, and it is stated at the top rather than in a
footnote because a rule that decides a gate should be visible when the gate is
read. Rules 1, 3, 4 and 5 pass under every counting; only rule 2 moves.
Arithmetic in [`counting-r7.txt`](counting-r7.txt).

### What the voided run was, and why the rule is not a convenience

`t3-haiku-3` checked `attempt-2.json`, edited that same file, and checked it
again — twice. It left **two attempt files and four check files**. Two of the
four checked states no longer exist. The prompt forbade this in as many words
and [`attest.mjs`](attest.mjs) caught it before any number was computed.

The run was not voided for being bad. Re-scored, it is a perfectly good file:
green, 23 of 23 claims, no critical miss. It was voided because **it cannot be
counted**. `loop-report.mjs:185` reads `check-<n>.txt` for the attempt numbered
`n`, so with two attempts it never opens `check-3` or `check-4` and reports the
run at **two** passes when its checker ran **four** times and went green on the
fourth. `counting-r7.mjs` counts from the check files instead, which all
survive, which is why rows B and C above differ from what `loop-report.mjs`
prints for the same corpora.

### The cross-check, so the comparison is symmetric

Round six scored a run with this exact defect — its own `t1-haiku-3` — rather
than voiding it. So the fair question runs the other way too: **does round six
survive round seven's stricter rule?**

| | Migrated runs | Convergence | Median passes | Verdict |
| --- | --- | --- | --- | --- |
| Round six as reported | 9 | 9/9 | 2 | PASS |
| **Round six under round seven's void rule** | 8 | **8/8 PASS** | **2 PASS** | **PASS** |
| Round seven under round six's rule (row B above) | 9 | 9/9 PASS | **3 FAIL** | **FAIL** |

**Round six survives round seven's rule; round seven does not survive round
six's.** Both rounds sit at a median of 2 under their own counting and under the
strict rule. The asymmetry is not a difference in how fast the rounds converged
— it is **what each round's defective run cost**:

- Round six's `t1-haiku-3` went green in **2** checker runs, the same as the
  median. Keeping it or dropping it barely moves anything.
- Round seven's `t3-haiku-3` needed **4**. Swapping a 4 in for a 2 at n = 9
  moves the median from 2 to 3.

Round seven also has less room under its median than round six did — four runs
at 3 passes and one at 1, where round six's attested eight had four at 1. Same
median, thinner margin.

## The numbers

| | Round five | Round six | **Round seven** |
| --- | --- | --- | --- |
| Valid on the first attempt | 1 of 9 | 4 of 9 | **1 of 9** |
| Converged within 5 passes | 8 of 9 | 9 of 9 | **9 of 9** |
| Passes to green | median 2, worst 3 | median 2, worst 5 | **median 2, worst 3** |
| Valid **and** faithful | 7 of 9 | 9 of 9 | **7 of 9** |

Passes to green, per run: 2, 3, 2, 3, 1, 3, 2, 3, 2.

**Convergence held and the median held.** Every migrated run reached a clean
checker inside the cap, and no run needed more than three passes — round six's
worst was five. The container change is not costing convergence, three rounds
running.

**Fidelity fell from 9 of 9 to 7 of 9, landing exactly on the bar.** One run
either way flips rule 3. Both misses were verified by hand rather than taken
from the rubric's word, because round six had to publish two columns when one of
its readers turned out narrower than the claim it implemented.

## The two fidelity misses, verified by hand

**`t1-haiku-3` — two critical misses, both real.** The rubric says `renderHtml`
is pure and throws `BadMarkdown` on `die`. In the green file, `renderHtml`'s
steps are `note, if, return, effect, return`: it **runs an effect**, so it is not
pure, and it contains **no `throw` at all**. The run's own `result.json` claims
it wrote *"renderHtml raises BadMarkdown on the die channel"*. It did not. The
files are what count, and here the account and the file disagree.

**`t2-haiku-1` — one critical miss, real, and it was introduced by the fix
loop.** The rubric says the pricing loop runs at least twice in both walks,
which it reads as two or more `goto` moves per walk.

| | `a paid order` | `the card declines` |
| --- | --- | --- |
| attempt 1 (8 refusals, 25/25 claims) | 2 gotos | 2 gotos |
| attempt 2 (35 refusals) | 1 goto | 1 goto |
| attempt 3 (**green**, 24/25 claims) | 1 goto | 1 goto |

**The file was faithful before it was legal, and lost a claim becoming legal.**

## Shrink to green fired, and round five gated on it

`t2-haiku-1` is a green run that reached its clean file by dropping a required
move. **Round six had none.** #63's bar does not gate on this and PREREG said so
in advance, but round five *did* gate on it, so it belongs here and not in the
limits:

```text
SHRINK TO GREEN (reported; #63's bar does not gate on it)
  1 green run(s) lost a node, a graph, a run or a required move; 3 had a raw
  count fall while losing nothing required
```

**That summary line double-counts, and the detail lines are the accurate
reading.** Only **two** runs had a raw count fall while losing nothing required
— `t1-haiku-1` (moves 31→29) and `t3-haiku-3` (steps 32→31), both of which
satisfy every claim their task states. The third in that count of three is
`t2-haiku-1` itself, whose moves fell 48→40; `loop-report.mjs` builds the
`countFell` set without subtracting the `shrunk` set, so the one run that lost
something required is reported in both. Restructuring is an ordinary fix.
Losing a loop iteration is not, and only one run did it.

## The new two-entry task

| Run | Passes | Green | Shared node defined once | Both entries reach it | Unaccounted findings | Faithful |
| --- | --- | --- | --- | --- | --- | --- |
| `t4-haiku-1` | 3 | yes | yes | yes | 0 | **yes** |
| `t4-haiku-2` | 2 | yes | yes | yes | 0 | no |
| `t4-haiku-3` | 3 | yes | yes | yes | 0 | no |

**The part that is new is still the part that works.** Three of three converged,
defined `formatPrice` once, had both entries reach it, and left the change-wide
unaccounted finding empty. Both pre-registered new-task rules pass 3 of 3, and
the conjoined reading the ticket words passes too.

**Fidelity on the new task is 1 of 3 — the same as round six, on the same
claim**, `renderCatalog raises NoPage on the escape channel`. Three rounds have
now produced this residual. It is not gated, and nothing in #61 or #62 was meant
to address it.

## The one procedural departure: what the findings step cost and what it bought

PREREG-63-ROUND7 priced this before the numbers: the step can only make rules 1,
2 and 4 worse or equal, and can only improve rule 3 where a finding names a
critical claim. Both halves showed up.

**It fired exactly once all round, and it did not save the file.**
`t4-haiku-3`'s checker printed the `NoPage` finding. The agent read it, answered
it in writing, and kept it:

```json
{ "finding": "renderCatalog declares E tag \"NoPage\", and nothing beneath it produces that tag",
  "answer": "renderCatalog can throw NoPage when the page is missing (per the task spec), but we only show the happy path with a successful query, so the error is not demonstrated in the walks provided." }
```

That is a coherent answer and it is still the critical miss. **Round six's
complaint was a finding dismissed silently; round seven's is a finding dismissed
in writing.** The `answers` array is a real improvement in evidence — a reader
can now see the reasoning and disagree with it — and it changed no outcome.

**On the other t4 run the step cost a pass and removed what the task asked
for.** `t4-haiku-2` was **green on attempt 1** with the same `NoPage` finding.
It spent a second pass "fixing" it by **deleting the `NoPage` declaration**, and
recorded nothing in `answers`:

```text
check-1.txt: renderCatalog declares E tag "NoPage", and nothing beneath it produces that tag
             ok: … 5 node(s), 2 graph(s), 3 run(s), 1 finding(s)
check-2.txt: ok: … 5 node(s), 2 graph(s), 3 run(s), 0 finding(s)
```

The task says the page-missing failure escapes. The file now does not mention it
at all. **That is the step's cost paid and its benefit not received.**

**The pre-registration priced that cost too cautiously, and this is where it
shows.** It said the step could only make rules 1, 2 and 4 worse or equal,
because a findings fix is another pass against the cap. As the round is actually
instrumented it cannot make them worse at all: rules 1, 2 and 4 read
`passesToGreen`, which stops at the **first clean check**, so a pass spent after
green adds to the attempt count and not to the score. `t4-haiku-2` reads
`PASSES 2, GREEN 1`. So the step changed one run's attempt count and no gated
number, and the honest reading is that it was free on rules 1, 2 and 4 and
bought nothing on rule 3.

**Every migrated `answers` array is empty**: no finding fired on any of the nine
migrated runs. **So the findings step cannot explain the fidelity drop from 9 of
9 to 7 of 9.** That drop is either the shape document's two new lines or noise
on n = 9, and the honest answer is noise: the two misses are a malformed-JSON
first attempt and a dropped loop iteration, neither of which touches run names
or `--text`, which is all the two lines are about. Round six's own first-attempt
rate swung 4 of 9 against round five's 1 of 9 on identical tasks and model.

## Three instrument quirks, named rather than fixed mid-round

**`loop-report.mjs` undercounts a run with more check files than attempts.** It
maps `check-<n>.txt` to attempt `n`, so extra checks are invisible. It affects
no scored number in round seven — the scored corpus is fully attested, one check
per attempt — but it is why rows B and C are computed by `counting-r7.mjs`.

**The `INTRODUCED while fixing` label is wrong on `t1-haiku-3`.**
`loop-report.mjs` marks a critical miss pre-existing only when `fidFirst`
contains it; when `fidFirst` is `null` the optional chain yields `undefined` and
the miss falls through to "INTRODUCED". `t1-haiku-3`'s attempt 1 was
**unparseable JSON**, so there is no first program and nothing can be known about
whether the miss was introduced. The label is wrong; the count, 2 critical
misses in the green file, is right.

**The shrink-to-green summary line double-counts**, as the section above sets
out: `countFell` is not disjoint from `shrunk`.

None of the three was edited mid-round. All three affect a label or a summary
line, never a scored number.

## The confounds PREREG named, resolved

**The drift hazard was real and did not fire.** The main checkout at
`C:\Users\mephi\WebstormProjects\grimoire` sat on `d4fcd66`, the pre-#61
validator, on the same disk throughout. Absolute paths in the prompt plus
`attest.mjs` afterwards: **29 of 29 attempt files reproduce their saved checker
output under the pinned validator.** No run met the wrong validator.

**The in-place-edit hazard fired once**, was caught mechanically, and is the
subject of the section at the top.

**There is no pre-existing residual to report.** Every valid run converged, so
the rule for classing residuals as new-shape or pre-existing had nothing to
class.

**No run wrote the two-move retry** the shipped validator refuses on `main` as
much as on #61.

## Authoring cost — reported, gating nothing

Method unchanged, against the same `d4fcd66` comparand round six pinned. Round
six's after-column is kept so **#62's marginal cost** is visible on its own.

| Measure | `d4fcd66` (before #61) | Round six's after (#61) | **Round seven's pin `fd5c87e` (#61 + #62)** |
| --- | --- | --- | --- |
| Words in the shape document | 2510 | 3148 | **3171** |
| Lines in the shape document | 310 | 390 | **392** |
| Required fields, over every object kind | 97 | 98 | **98** |
| Object kinds the validator shape-checks | 32 | 32 | **32** |
| Refusal kinds | 63 | 69 | **70** |

**#62 cost the author 23 words and one refusal kind** — the two lines that
invalidated round six. The thing an author fills in did not move at all. The
whole re-run was bought by 0.7% more prose.

## Where this round departed from its own pre-registration

**Nowhere on the bar or the procedure.** The bar is round six's word for word.
The one procedural departure — the findings step — was declared in advance, at
the top of the pre-registration, with its effect on each rule priced before the
numbers arrived.

**The void rule was applied as written**, which is what a pre-registration is
for, and its verdict-deciding effect is reported at the top rather than
discovered by a reader.

**Two files were added after the runs**: `counting-r7.mjs`, which computes
arithmetic PREREG promised in advance, and this document. Neither changes a
score.

## Limits

- **Nine runs a round is thin**, and three on the new task is thinner. Rule 3
  passes by zero margin and rule 2 passes only under the pre-registered
  counting.
- **One model family.** `claude-haiku-4-5-20251001`, as in rounds one to six. No
  non-Claude agent was reachable from this session. `README.md`'s procedure is
  harness-neutral and the gap stays open.
- **This round is not a controlled comparison with round six.** The shape
  document moved by two lines and the procedure gained a step. The round
  measures the system that would ship, which is what #58 asks for, and it cannot
  attribute a difference to one or the other.
- **The rubric is not the program**, and `t4-haiku-3` shows again that a file can
  satisfy the checker and describe a different program.
- **The evidence lives on an unmerged branch.** `main` has no `prototypes/`
  directory. A ship gate whose record is only on a deletable branch is a real
  weakness. It is not this round's to fix.

## The consequence, as pre-registered

**A pass ships.** All five rules pass under the pre-registered counting, so
**#58 may close** on the rule as written. Neither the container row nor the
node-map row of the box is reopened.

`loop-report.mjs` prints *"#61 may merge"* and cites `PREREG-63.md`; both
strings are hardcoded from round six. The bar it scores is identical. #61 merged
long ago — the consequence this round carries is #58's.

**Read the pass with its margin.** Rule 3 passes at exactly 7 of 9. Rule 2
passes only under the void rule, and fails under the counting round six applied
to the same defect. One green run shrank to green, which round five gated on. A
maintainer entitled to weigh those has everything needed to, at the top of this
file rather than at the bottom.

## Does the round still stand at the shipping commit?

`ship-check.mjs` now pins `fd5c87e` and takes both rounds' attempt files plus the
voided run as its corpus — 62 files, twice round six's 31. Run against the
commit that would ship:

```text
round seven was pinned to  fd5c87e
checking it against      HEAD (34a7925)

1. THE SHAPE DOCUMENT — byte-identical. What an agent reads has not moved.

2. THE VALIDATOR'S RULES — same verdict on all 62 attempt files of the round.

VERDICT: round seven CARRIES to this commit.
```

It is green against `origin/main` too, and it is **green trivially**, because
round seven was pinned to `main` rather than to a branch that could move under
it. That is the gate reporting that nothing has moved since the round ran, not a
finding. It becomes informative again the moment anything lands on `main`.

The gate ran against `34a7925`, the commit carrying this document. The only
later commit on this branch adds the gate's own output, which touches neither
surface it measures. See [`ship-check-round7.txt`](ship-check-round7.txt) and
[`ship-check-round7-main.txt`](ship-check-round7-main.txt).
