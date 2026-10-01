# Contract: eagle-eye

Version: 0.1.2

- **Type:** skill
- **Level:** Thorough
- **Date:** 2026-09-30 (interview started 2026-09-29)
- **Marks:** *Proposed* = drafted by the agent, not yet confirmed. **Confirmed** = accepted as drafted, without a change. **Decided** (date) = the owner's own words, or a draft they rewrote.
- **Source for drafts:** the existing `skills/eagle-eye/SKILL.md` (582 lines), read as data. Every draft taken from it is marked as such.

## Target

**Confirmed, 2026-09-30.** The rendered page of `docs/decisions/publish-eagle-eye.box.json` ("Publish eagle-eye as a public repo": 8 decisions, 34 options, 11 edges, 5 presets), together with the findings in chat, led by the problem. It was offered as an existing real output. No samples were drafted. The owner: "that page is the target, I don't think anything is wrong with it at the moment."

---

## 1. What is it for?

**Name:** eagle-eye. **Decided, 2026-09-29.**

**What it does, and for whom.** **Decided, 2026-09-29.** "A problem-solving technique for whenever you want to solve a problem, by judging your options and seeing the trade-offs between those options."

**When it steps in.**

- Three or more open decisions, and at least two of them are coupled: one choice changes what is possible in another. The others need not be coupled. **Decided, 2026-09-30.**
- The person asks for it by name. **Confirmed, 2026-09-30.**

**When it stays out.**

- The person insists on the quick route. Then find the quickest way to meet their intent, and move on. Eagle-eye exists to force slow, deliberate (System 2) thinking, so it does not fire on a person who is clearly in a hurry. **Decided, 2026-09-30.** How a hurry shows (the owner, after the build check): "when the user is in a hurry it would be pretty explicit, like 'nah we don't need a box'." The familiar judges it; the built file lists no trigger phrases. **Decided, 2026-09-30.**
- Two independent choices. *Proposed* (follows from "three or more open decisions" above and the depth rule in question 3; added after the build check, finding F3).

**How these lines build the description.** *Proposed.* The built file's description takes its triggers from "when it steps in" and "when it stays out" only. The owner chose the narrow trigger over "any problem" at checkpoint 1, so the purpose sentence above goes in the body, not the description.

**The nearest situation where it would be wrong.** *Proposed* — left open by the owner at checkpoint 1 (hardest to defend). Draft: a person racing to ship, with one decision that has a few options.

## 2. What does it notice that nothing else does?

**Decided, 2026-09-29.** "How options link together, and evaluating trade-offs."

## 3. Who does what?

**The familiar**

| Clause | Held by | Mark |
|---|---|---|
| Writes the brief, the rows, options with a source, strawmen, and edges with a reason and a tier. | Promised | **Confirmed** |
| Picks the depth by the number of decisions: 2–3 get a table in chat, 4 or more a box and the page. | Promised | **Confirmed** (see question 19: the chat table is open). The "15 or more are split" part was cut at checkpoint 3, **Decided, 2026-09-30**. |
| Keeps the box in scratch, unless the person asks to keep it. | Promised | **Confirmed** |

**Automatic checks**

| Clause | Held by | Mark |
|---|---|---|
| The renderer refuses a box with no problem, fewer than two presets (one of them changing an option), a missing short name, an edge with no reason, or a non-argued edge with no source. | Enforced — `render.mjs` refuses; its tests run in the root `node scripts/check.mjs`. Confirmed by the owner, 2026-09-30. | **Confirmed** |

**You (the person)**

| Clause | Held by | Mark |
|---|---|---|
| Pick and accept the chosen set; decide whether to keep the box; decide whether to pay for the audit. You also keep three abilities the familiar never takes away: to check the work yourself, to explain why it is right, and to know when to stop. | — | **Confirmed** |

**Stop and ask**

| Clause | Held by | Mark |
|---|---|---|
| When eagle-eye fires on its own, not by name: say how many coupled decisions it sees, and ask before it builds a box or opens a page. Build nothing until the person says yes. | Promised | **Decided, 2026-09-30** (replaces the baseline's "say it, then build") |
| When the model audit could run: run a dry run, state the four facts (it is available; what it sends and to whom; how many requests of what size; the person's key pays), then wait for a yes in chat. | Promised | **Confirmed** |
| When the person pastes a restore code from the page: say the set back in words, and change the box only with what they confirm. | Promised | **Confirmed** |
| When no usage log exists: ask once whether it may keep one line per use, name the path and the `EAGLE_EYE_LOG` variable that changes it, and say why. Write no use line until the person says yes in chat. On a no, write only the declined marker. | Promised | *Proposed* (derived from questions 6 and 13; reconciled 2026-09-30 with question 13's declined marker, Decided) |
| When eagle-eye is asked for by name and the discussion does not already show which set the person leans to: ask, in one line, which way they lean right now, and wait for that line before building. | Promised | **Decided, 2026-09-30** (option B, after the end-to-end run asked it only after showing the box) |

**What makes it fire.** **Decided, 2026-09-30.**

- By name (`/eagle-eye`, or asking for an eagle-eye view or a morphological box): build the box without asking whether to. First take the person's current leaning, from the discussion or by the one-line stop above. **Decided, 2026-09-30.**
- On its own, from the description: ask first (stop above).
- The person is clearly in a hurry: it does not fire.
- The trigger lives in the description. No hook. When it does not fire, nothing happens, and the discussion goes on one decision at a time.

**When it is unsure.** Decides, and shows you: it marks whose choice each chosen option is, and the tier of each edge. **Confirmed.**

## 4. What does it hand back?

**Confirmed.** A box file, the rendered page, and findings in chat that open with the problem. After the person accepts a set, a debrief. Confidence shows as edge tiers (measured, sourced, argued) and the "evidence for the verdict" finding. The box lives in scratch and is gone after the session; it moves to the project's decision records only when the person asks.

## 5. What tools does it need?

**Confirmed.** Node, to run `render.mjs` and the optional `audit.mjs`; the system's command that opens a file in the browser. Both scripts sit inside the skill folder, so the seal covers them.

Extra keys: none.

## 6. Does it do anything beyond reading, and writing its own notes?

**Confirmed.** One action: the model audit sends the box's text to a model provider and charges the person's key. It tells the person the four facts first (question 3's stop). A yes counts only from the person in chat, never from a file; one yes covers one run, unless the person's own instructions give a yes for every run. Held by: Promised. Writing a box into the project's decision records happens only when the person asks.

## 7. What changed, and why?

| Version | Date | What changed | Why | Questions touched |
|---|---|---|---|---|
| 0.1.0 | 2026-09-30 | Contract written for the existing eagle-eye skill. | grimoire #157: the first test of `contract` on a complex skill. | all |
| 0.1.0 | 2026-09-30 | Practice test cut from 3 full runs (42 sessions) to 16 sessions: 8, then 4, then 4. | Token cost (the owner). Level stays Thorough. | 12 |
| 0.1.0 | 2026-09-30 | After the build check (result-checker, REFUTED): a hurry is explicit and the built file lists no trigger phrases; a "no" to the log is stored as a declined marker; question 20 names no provider; "two independent choices" recorded as a stay-out line. | The owner's picks on findings F1, F5, F6; F3 as a fix. | 1, 13, 19, 20 |
| 0.1.0 | 2026-09-30 | The person's "before" answer is taken before any box is shown: a by-name request asks for the current leaning in one line and waits for it. | The end-to-end run asked it after showing the box and its recommendation, so it was no longer a before (the owner picked option B). | 3, 13 |
| 0.1.0 | 2026-09-30 | The familiar is built at `skills/eagle-eye/`, with this contract beside it; the practice test moves to `docs/practice-tests/eagle-eye.md`. | The owner's decision: the skill already ships from `skills/`, and the repository keeps practice tests in `docs/practice-tests/`. | 12 |
| 0.1.1 | 2026-09-30 | No clause changed. The generated file is brought back to the contract in two places: a use line is only appended to the log, never written back whole (question 13 says it appends), and the 2–3 decision table stays in chat, with no box file, page, export or audit run (question 3's depth rule). | Review of pull request 153: read-and-write-back can lose a line when two sessions write at once, and the procedure sent the chat-table route through the file steps. | 3, 13 |
| 0.1.2 | 2026-10-01 | No clause changed. The practice test runs on the clean baseline: each session in its own run through the repository's practice runner, which loads only the skill under test and what the tool ships. Its setup drops the steps that moved the installed copies out and switched off MCP servers and plugins. `EAGLE_EYE_LOG` points inside the run's work folder, the audit endpoint points at a closed loopback port, and session 4 uses a literal fake key and runs only on the `clean` and `owner-pact` variants. The test lists its tool rules and the denials it expects, and marks P4 not checkable on the runner, because a session there cannot read a variable with a shell (*Proposed*: the build's default, waiting for the owner's ruling). No expected answer changes. No section of `SKILL.md` changes: question 12 here is this skill's own test. | The owner: a practice test runs in a sandbox with no possible conflicts, and conflicts are added back on purpose, one named variant at a time (issue 161, ADR 0007). A changed procedure is a new version. | 12 |

---

## 8. How alike should its answers be?

**Confirmed, 2026-09-30.** **Same shape** each run: a brief, rows with a problem, options with a source and strawmen, edges with a reason and a tier, at least two presets, then findings led by the problem. The content changes. Given up: the same box twice from the same chat; two runs may cut the rows differently.

**Against its neighbours:** it lays all coupled decisions out at once and shows how they constrain each other. A grilling or brainstorming skill asks one question at a time.

## 9. A real example of it at its best

**Decided, 2026-09-30.** `docs/decisions/publish-eagle-eye.box.json` (the target). A real decision, from the owner's own work, kept on purpose. The owner has made much bigger and more complex boxes (in the-pact) that may be better examples, "but I don't think the optimization here really matters." At checkpoint 3 the owner pointed to their latest box, `pact-12.local.html`, in a the-pact session's scratch folder, and to more boxes in earlier scratch folders. Scratch folders are temporary, so those may not last.

## 10. What does it need to start?

**Confirmed, 2026-09-30.** The discussion or plan that holds the decisions, and each option's source (a ticket, a document, a chat turn).

- **Refuse:** no problem it can state (the renderer refuses a box with no `problem`).
- **Point out:** an option with no source (it stays argued), a row with no strawman, an edge with no reason. It names the gap; it does not fill it with a guess.

## 11. Where does a person decide?

**Confirmed, 2026-09-30.** The person accepts a chosen set; eagle-eye's debrief closes the loop in chat. A decision the project keeps goes into its own decision records (`docs/decisions/`, `docs/adr/`), never the box by default. A pasted restore code is said back in words before it acts (question 3's stop).

## 12. Practice test

**Confirmed, 2026-09-30** (the 16-session plan, at checkpoint 2). In its own file, outside the skill's folder: `docs/practice-tests/eagle-eye.md`. 3 step-in cases, 3 stay-quiet cases, 4 cases for the Promised stops, 1 problem and 1 decoy. Run 1: all 8 sessions. Runs 2 and 3: only the 4 sessions where luck matters most. 16 sessions in all. Any false alarm fails the run. Written before any run. Not sealed. Each session runs on the clean baseline, through the repository's practice runner (`docs/practice-tests/procedure.md`), since 0.1.2.

**Deviation from Thorough.** The template asks for 3 full runs. The owner cut it for token cost ("42 sessions is a lot… this is definitely gonna hurt my limits"). Two problem cases were dropped because the renderer already flags them (hidden chain, missing strawman); two look-alike quiet cases were merged.

## 14. How hard should it think?

**Confirmed, 2026-09-30.** It runs on the model already in use. The optional audit calls other models; they only rank argued edges for rereading. A score never changes a tier and never goes into the box file.

## 15. How does it write?

**Confirmed, 2026-09-30** (option C, picked after checkpoint 2). Follow ASD-STE100, and keep sentences short. One rule stays by name: no idiom, no metaphor, no analogy. Reason (the owner): the rule was written when an older model filled text with idioms such as "load-bearing" and "foot-gun"; Opus 5.5 does this far less, so the other nine rules become the standard's detail, not a checklist. Test: ISO 24495-1 — can the reader find it, understand it, and use it?

Row names and short names in chat, never ids; ids only in the box file and the restore code. **Confirmed.**

---

## 13. When would you retire it?

**Confirmed, 2026-09-30** (option B, picked at checkpoint 2; it replaces the owner's earlier Decided rule "any of the three in 5 of 10 → cut or retune", after the research sweep). Count each signal on its own, each with a one-line reason. When any one reaches 5 of the last 10 uses, it asks the person for a review. Only the review can cut or retune it.

- **Cries wolf:** the person turns down its offer to build a box.
- **Rubber stamp:** the person accepts the chosen set without changing a row.
- **Nothing changes:** the decision after the box is the one the person held before it.

Why a review and not a cut: in the clinical-alert evidence, the share of appropriate overrides ranged from 12% to 92% by alert, and unchanged acceptance and an unchanged decision are also what good advice produces (`157-sweep-self-improving-skills.md`, implications 1–2).

**How its record is kept.** **Confirmed, 2026-09-30** (the owner: "your recommendation looks good").

- **What it records:** one line per use: whether the box was offered or invoked by name, declined or built, whether any row changed, and the person's answer before the box beside the decision after it.
- **Where:** the path in the `EAGLE_EYE_LOG` environment variable; otherwise a default in the person's home folder. Never inside the skill's folder, because the seal covers that folder.
- **Consent:** when no log exists, it asks once, and says why: to check that it fires when needed and to tell the person when it should be retired. On a no, it writes one "declined" marker at the log path and never asks again, and records no use. **Decided, 2026-09-30** (picked after the build check, finding F5). It appends only to a file that already holds eagle-eye lines; any other file at the path is left alone, and it asks.
- **When it cannot keep a record** (a declined marker, or a place that will not last, such as a temporary cloud session): it writes no use line, and the debrief states the before and after in chat.
- **Review:** at 10 recorded uses, and every 10 after, it reports the three counts to the person. It proposes; it changes nothing by itself. Each proposal becomes a change-log row. *Proposed.*

**Confirmed, 2026-09-30:** the offer names the default path **and** the variable that changes it, because the owner expects few people to know the variable exists ("They probably won't know it exists").

This changes question 6: writing the log is a second action beyond its own notes, taken only after the person's yes in chat. **Confirmed, 2026-09-30.**

---

## 16. How does it go wrong?

The owner's answer, given before any draft (**Decided, 2026-09-30**): "The biggest failures I see are when the edges are wrong… I would get the box that I want with options that don't hold because something was missed." The paid audit helped; it is not yet tested for robustness. False confidence in the wrong solution is "much more psychological and bigger than Eagle Eye itself"; not handled here. "The whole point on Eagle Eye is how the options connect", and that is top priority.

| # | How it goes wrong | What it looks like | How serious | Mark |
|---|---|---|---|---|
| 1 | Wrong edges | The wanted set looks held, but its options don't hold: an edge is missing, argued but marked sourced, a preference drawn as a constraint, or a chain not read. | High — top priority | **Decided** |
| 2 | False confidence in the wrong solution | The person trusts a set because the grid looks complete. | High, but out of scope for eagle-eye | **Decided** |
| 3 | A missing row carried in prose | Questions keep coming after the person accepts a set, and they are answered in chat instead of added as rows. Adding a row or two is normal work, not a failure (the owner: "that happens like all the time… I think that's normal"). | Low | **Decided** (reclassified by the owner) |
| 4 | Too many rows | The box outgrows one reading. The owner has never reached 20 and thinks 20 is too much. | Medium | **Decided, 2026-09-30:** the baseline's "split at 15 rows" rule is cut; no rule holds this (question 19) |
| 5 | Positions drawn as rows | "Option 1, option 2, do nothing" as one row; the grid reproduces the offered answers. | Medium | **Confirmed** (its rule kept at checkpoint 3) |
| 6 | An audit score treated as a verdict | A score changes a tier, or goes into the box. | Medium | **Confirmed** (its rule kept at checkpoint 3) |
| 7 | Ids in chat, or a restore code acted on without saying it back | The person hears names they did not write, or a misread becomes the record. | Low | **Confirmed** (its rule kept at checkpoint 3) |

## 17. Good versus so-so

*Proposed.* No samples were drafted (the target was a real box), so there are no losers to fill "so-so"; these come from the baseline's common mistakes.

| Part | So-so | Good | What protects it |
|---|---|---|---|
| Box file | Rows that are positions; edges with no why; no strawmen | Dimensions whose cells combine; every edge has a why and a tier; a strawman per row | The row test; the renderer's refusals and warnings |
| Page | Only the chosen set shown | At least two presets, one changing an option; the brief first | The renderer refuses fewer than two presets |
| Findings in chat | Findings listed by id, no problem stated | Opens with the problem in plain words; names rows and short names | Writing rule (question 15) |
| Debrief | Skipped, or a summary of the box | Which weakness patterns appeared, what got stronger, one thing to watch | Promised (untested) |
| Usage record | — | One line per use with a reason (question 13) | untested |

## 18. Every rule has a reason

**Confirmed, 2026-09-30** (checkpoint 3: all 11 rules below kept, ranked by the owner in this order of use against wrong edges; "split at 15 rows" cut). Stops from question 3 go into the file word for word, with "when it is unsure: decides and shows you".

| Rule in the instructions | Reason | Held by |
|---|---|---|
| Every edge carries one sentence of why and a tier; a non-argued edge names its source. | Failure 1 (wrong edges) | Enforced — `render.mjs` refuses; tests in `node scripts/check.mjs` |
| Check each argued edge against the eight weakness patterns; offer the audit. | Failure 1 | Promised |
| Before changing a set that does not hold, check the edges behind each conflict. | Failure 1 | Promised |
| Read the chain and cycle findings, and say whether the box states the derived relation. | Failure 1 | Promised |
| A score never changes a tier and never goes into the box. | Failure 6 | Promised |
| A question left after the person accepts a set becomes a row, not prose. | Failure 3 | Promised |
| A row passes "can two of its cells be true at once? then it is not a row"; whole positions are presets. | Failure 5 | Promised |
| Say row names and short names in chat; say a restore code back in words first. | Failure 7 | Promised (the stop in question 3) |
| Keep the "evidence for the verdict" finding and the acceptance test. | Failure 1 (not failure 2, which is out of scope): both check whether the edges hold the set | Enforced (the finding: computed by `render.mjs`); Promised (the acceptance test) |
| When fired on its own, ask before building; when invoked by name, build. | The owner's firing rule (question 3) | Promised |
| Export format: change the page, this file and the reader together. | A format it must keep | Promised |

## 19. Open questions

*Proposed.*

| # | Question | Why it is still open | Settled when |
|---|---|---|---|
| 1 | The nearest situation where eagle-eye would be wrong. | Ranked hardest to defend at checkpoint 1. | A real misfire is seen. |
| 2 | What "clearly in a hurry" looks like to the familiar. | The owner: it is explicit ("nah we don't need a box"); the familiar judges it, with no listed phrases. | The quiet case passes on wording that is not in the skill. |
| 3 | Whether the 2–3 decision chat table invites acceptance. | The owner's worry. | Three chat tables are used and their outcomes logged. |
| 4 | Where the log lives in places that do not last (cloud, Codespaces, CI). | A stored yes or no is lost there too. | The first cloud use. |
| 5 | Whether the audit is robust. | Improvements seen, not tested. | A measured run on boxes with known wrong edges. |
| 7 | Whether a box needs a row limit. | The owner cut the 15-row split but thinks 20 rows is too much. | A real box passes 15 rows. |
| 6 | Tool files outside the skill folder. | None: `render.mjs`, `audit.mjs` and `lib/` sit inside, so the seal covers them. | — |

## 20. Where do the ideas come from?

*Proposed.*

- Zwicky's morphological box (general morphological analysis).
- ASD-STE100 and ISO 24495-1 (question 15).
- The owner's own use of eagle-eye on real decisions (e.g. `docs/decisions/`).
- The audit's controls method, run through the audit's model provider, the owner's own design.
- The research sweeps for this contract: `s2-sweep-library.md`, `s2-sweep-web.md`, `157-sweep-self-improving-skills.md` (agentic-sdlc, private).

---

## Flag log (self-checks, not a review)

| # | Question | Flag | Outcome |
|---|---|---|---|
| 1 | 1 | The owner's first "steps in" ("whenever you want to solve a problem") would fire on almost any task; the baseline fires on three or more coupled decisions. | Acted on: the owner chose three or more decisions with at least two coupled. |
| 2 | 3 | The baseline announces a box and builds it; the owner wants a yes first when it fired on its own. | Acted on: new stop, Decided. |
| 3 | 1, 3 | "Clearly in a hurry" names no signal the familiar can see. It is wording a familiar could talk itself past, in either direction. | Acted on: the owner says a hurry is explicit ("nah we don't need a box"); the built file lists no phrases. |
| 4 | 1 | The nearest wrong situation was ranked hardest to defend. | Open (*Proposed*). |
| 5 | 3 | The 2–3 decision chat table may invite acceptance (the owner's worry). | Open — question 19. |
| 6 | 13 | "Nothing changes" needs the person's answer before the box; today nothing asks for it. | Acted on: the record rule asks it. |
| 7 | 13, 6 | The record rule adds a write outside scratch, so question 6 must change. | Open — at checkpoint 2. |
| 8 | 13 | A research sweep on self-improving skills (`157-sweep-self-improving-skills.md` in agentic-sdlc) found count-based retirement unreliable. | Acted on: the owner picked "a count triggers a review". |
| 9 | 13 | In cloud sessions, Codespaces and CI the home folder does not last, so a stored yes or no is lost and "ask once" becomes "ask each session". | Partly acted on: a no is now stored as a marker; in places that do not last it is still lost. Open — question 19. |
| 10 | 15 | The writing rule was written against idioms of an older model ("load-bearing", "foot-gun"); the owner thinks it may be looser now. | Acted on: option C. |

## Checkpoint log

- **Checkpoint 1 (after question 7), 2026-09-30.** The owner ranked 14 drafts by how easily they could defend each, in an interactive list. None flagged for change. The hardest (the nearest wrong situation) stays *Proposed*; the other 13 are **Confirmed**. Level: Thorough, kept. Review: offered after question 20.
- **Checkpoint 2 (after question 15), 2026-09-30.** One pick (the retire rule: B) and nine drafts, each shown with its question. Seven accepted as written → **Confirmed** (questions 8, 10, 11, 12's 16-session plan, 13's log rule, 6's log action, 14). Two flagged: question 9 (kept, with the owner's note → Decided) and question 15 (open). Level: Thorough, kept.
- **Checkpoint 3 (after question 20), 2026-09-30.** The owner ranked the 12 rules of question 18 by use against wrong edges, and cut one (split at 15 rows). The other 11 are **Confirmed**; the edge rules ranked 1–4. Look back: "Is the target still the right one?" — "Yes, still the target." (flag logged: none). Question 16 was answered in the owner's words before any draft. Questions 17, 19 and 20 were drafted and not asked; they stay *Proposed*.
