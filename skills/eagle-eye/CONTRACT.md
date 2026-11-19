# Contract: eagle-eye

Version: 0.3.0

- **Type:** skill
- **Level:** Thorough
- **Marks:** *Proposed* = drafted by the agent, not yet confirmed. **Confirmed** = accepted as drafted, without a change. **Decided** = the owner's own words, or a draft they rewrote.

## Target

**Confirmed.** The rendered page of `docs/decisions/publish-eagle-eye.box.json`, with the findings in chat, led by the problem. It is also the real example of the skill at its best.

---

## 1. What is it for?

**Name:** eagle-eye. **Decided**

**What it does, and for whom.** **Decided.** A problem-solving technique for whenever you want to solve a problem, by judging your options and seeing the trade-offs between those options.

**When it steps in.**

- Three or more open decisions, and at least two of them are coupled: one choice changes what is possible in another. The others need not be coupled. **Decided**
- The person asks for it by name. **Confirmed**

**When it stays out.**

- The person insists on the quick route. Then find the quickest way to meet their intent, and move on. Eagle-eye forces slow, deliberate thinking, so it does not fire on a person in a hurry. A hurry is explicit, and the familiar judges it. The built file lists no trigger phrases. **Decided**
- Two independent choices. *Proposed*

**The nearest situation where it would be wrong.** *Proposed.* A person racing to ship, with one decision that has a few options.

## 2. What does it notice that nothing else does?

**Decided.** How options link together, and evaluating trade-offs.

## 3. Who does what?

**The familiar** writes the brief, the rows, options with a source, strawmen, and edges with a reason and a tier. It picks the depth by the number of decisions: 2–3 get a table in chat, 4 or more a box and the page. It keeps the box in scratch, unless the person asks to keep it. **Confirmed**

**The renderer** refuses a box that breaks its checks. Enforced by `render.mjs`; its tests run in `node scripts/check.mjs`. **Confirmed**

**The person** picks and accepts the chosen set, decides whether to keep the box, and decides whether to pay for the audit. The person keeps three abilities: to check the work, to explain why it is right, and to know when to stop. **Confirmed**

**Stop and ask.** Each is Promised.

- **Firing on its own, not by name.** Say how many coupled decisions it sees, and ask before it builds a box or opens a page. **Decided**
- **Asked for by name, with no leaning shown.** Ask in one line which set the person leans to, and wait for the answer before building. By name, it builds without asking whether to. **Decided**
- **The model audit.** Run a dry run, state the four facts (it is available; what it sends and to whom; how many requests of what size; the person's key pays), then wait for a yes in chat. Each run is a new charge. A second round or a run on one configuration needs its own yes, unless the person's own instructions give a yes for every run. **Confirmed**
- **The usage log.** Write nothing until the person says yes in chat (question 13). **Decided**

**When it is unsure.** It decides, and shows you: it marks whose choice each chosen option is, and the tier of each edge. **Confirmed**

## 4. What does it hand back?

**Confirmed.** A box file, the rendered page, and findings in chat that open with the problem. After the person accepts a set, a debrief. Confidence shows as edge tiers and the "evidence for the verdict" finding. The box lives in scratch. It moves to the project's decision records only when the person asks.

## 5. What tools does it need?

**Decided.** Node.js 24 or later, to run `render.mjs` and the optional `audit.mjs`; the system's command that opens a file in the browser. No extra keys.

## 6. Does it do anything beyond reading, and writing its own notes?

**Confirmed.** Two actions, each after the person's yes in chat: the model audit, which sends the box's text to a model provider and charges the person's key, and the usage log, which writes outside the skill's folder.

## 7. What changed, and why?

The history is in `contract.changelog.md` beside this file.

## 10. What does it need to start?

**Confirmed.** The discussion or plan that holds the decisions, and each option's source. It names a gap (an option with no source, a row with no strawman, an edge with no reason) and does not fill it with a guess.

## 12. Practice test

**Confirmed.** `docs/practice-tests/eagle-eye.md`: 16 sessions on the clean baseline. Any false alarm fails the run.

## 13. When would you retire it?

**Confirmed.** It counts four signals over the last 10 uses. When any one reaches 5, it asks the person for a review. Only the review can cut or retune it. At 10 recorded uses, and every 10 after, it reports the counts.

- **Cries wolf:** the person turns down its offer to build a box.
- **Rubber stamp:** the person accepts the chosen set without changing a row.
- **Nothing changes:** the decision after the box is the one the person held before it.
- **Goes unanswered:** the person asked for a box, or accepted the offer, and never answered it. **Decided**

**Its record.** **Decided.** One finished use per box, in the file named by `EAGLE_EYE_LOG`, else `.grimoire/eagle-eye/log.jsonl` in the person's home folder. Never inside the skill's folder.

- **Consent is the person's yes in chat.** When no log exists, it asks once, names the path and the variable, and says why. On a yes, it writes a consent marker at once. On a no, it writes one declined marker, never asks again, and records no use. The later of two markers holds.
- **A box writes a start line and an end line** with one key. A declined offer writes one line. At the next use, it asks whether each open box is still open, and on a no it ends the box as "unanswered".
- **With no record** (a declined log, or a place that will not last), it writes no line of any kind. The debrief states the before and after in chat.

## 14. How hard should it think?

**Confirmed.** It runs on the model already in use. The optional audit calls other models. They only rank argued edges for rereading. A score never changes a tier and never goes into the box file.

## 15. How does it write?

**Confirmed.** Follow ASD-STE100, and keep sentences short. One rule stays by name: no idiom, no metaphor, no analogy. Test: ISO 24495-1. Can the reader find it, understand it, and use it? Row names and short names in chat, never ids.

## 16. How does it go wrong?

| # | How it goes wrong | What it looks like | Seriousness |
|---|---|---|---|
| 1 | Wrong edges | The wanted set looks held, but its options do not hold: an edge is missing, argued but marked sourced, a preference drawn as a constraint, or a chain not read. | High, top priority |
| 3 | A missing row carried in prose | Questions keep coming after the person accepts a set, and chat answers them instead of rows. | Low |
| 5 | Positions drawn as rows | "Option 1, option 2, do nothing" as one row. | Medium |
| 6 | An audit score treated as a verdict | A score changes a tier, or goes into the box. | Medium |
| 7 | Ids in chat | The person hears names they did not write. | Low |

## 18. Every rule has a reason

| Rule in the instructions | Reason | Held by |
|---|---|---|
| Every edge carries one sentence of why and a tier; a non-argued edge names its source. | Failure 1 | Enforced by `render.mjs` |
| Check each argued edge against the eight weakness patterns; offer the audit. | Failure 1 | Promised |
| Before changing a set that does not hold, check the edges behind each conflict. | Failure 1 | Promised |
| Read the chain and cycle findings, and say whether the box states the derived relation. | Failure 1 | Promised |
| A score never changes a tier and never goes into the box. | Failure 6 | Promised |
| A question left after the person accepts a set becomes a row, not prose. | Failure 3 | Promised |
| A row passes "can two of its cells be true at once? then it is not a row"; whole positions are presets. | Failure 5 | Promised |
| Say row names and short names in chat. | Failure 7 | Promised |
| Keep the "evidence for the verdict" finding and the acceptance test. | Failure 1 | Enforced (the finding); Promised (the test) |

## 19. Open questions

*Proposed.*

| # | Question | Settled when |
|---|---|---|
| 3 | Whether the 2–3 decision chat table invites acceptance. | Three chat tables are used and their outcomes logged. |
| 4 | Where the log lives in places that do not last. | The first cloud use. |
| 5 | Whether the audit is robust. | A measured run on boxes with known wrong edges. |
| 7 | Whether a box needs a row limit. | A real box passes 15 rows. |
