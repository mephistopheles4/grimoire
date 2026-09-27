# The contract template

*A familiar is a skill or an agent that you build to do one job for you. The
contract is the terms you agree with it. Answer the questions below before
anything is built. A small familiar takes about ten minutes. A serious one
takes about an hour. The answers are the contract. The familiar's file is
generated from the contract.*

*Draft 8. It uses the word familiar, asks for the name in question 1, marks
each clause Enforced or Promised, and adds the rule that the file is generated
from the contract. It also adds agent files with a contract beside them.
Each heading of the generated file cites its questions, and the change log
names the questions that each version touched. A "show me good" step before
question 1 finds the target output.
Draft 7 added "try it before you review it twice" to question 12. Draft 6
added a balance against false alarms. Earlier drafts rewrote the text in
plain language and added "when it is unsure".*

## Before you start: two choices

**What are you making?**

- A **skill** is a set of instructions that the agent picks up by itself when
  a situation matches. It lives in a file named `SKILL.md`, in a folder of the
  same name as the skill. `SKILL.md` is an open format that many agents read.
  See the Agent Skills specification: https://agentskills.io/specification.
- An **agent** is a familiar that the main agent sends off to do one job
  alone and report back. It lives in one file, in the format your tool uses
  for agents.

Some questions ask different things for each type. They say so.

**How thorough do you want to be?** Pick one level before you start.

| | **Quick** | **Standard** | **Thorough** |
|---|---|---|---|
| Good for | A small familiar that only you use | A familiar you rely on, or share | A familiar others depend on, or one that can do damage |
| Questions | 1–7 | 1–15 | all 20 |

You can change level **only at a checkpoint**. A checkpoint comes after each
group of questions: after 7, after 15 and after 20. Stop there, look at what
you have, and decide. Write down why you changed level. Do not drop a level
in the middle of a question because it got hard. A hard question is usually
the one that matters.

**One lesson from earlier contracts.** Extra questions often feel necessary
the first time, and then stay empty. If a question keeps getting "does not
apply", your level is too high.

## How the contract is kept

**The contract is the source. The file is build output.** The familiar's file
is generated from the contract. Nobody edits the file by hand. To change what
the familiar does, amend the contract, then generate the file again.

**Where each file lives.**

| Type | The familiar | Its contract |
|---|---|---|
| Skill | `<name>/SKILL.md` | `<name>/CONTRACT.md` |
| Agent | `<name>.md` | `<name>.contract.md`, in the same folder |

Copy the contract with the familiar. They travel together.

**The version line.** The line after the contract's title reads
`Version: X.Y.Z`, starting at 0.1.0. Each amendment raises the version and
adds a row to the change log (question 7).

**The mark.** When the file is generated, a check writes three keys into the
file's frontmatter: the contract's version, a digest of the file, and a digest
of the contract. A digest is a short fingerprint of a file's exact text. The
check fails when either file changes after the mark was written. The mark
proves one thing only: the two files have not changed since the last mark. It
does not prove who wrote them. Review the familiar's text whatever its mark
says.

**Section headings.** Each `##` heading in the familiar's file cites the
contract questions that its section comes from. For example:
`## When to stop and ask (questions 3, 10)`. An amendment then changes
exactly the sections whose heading cites a question the amendment touched.
Every other section keeps its exact text.

**Extra frontmatter keys.** The check accepts only the keys in the Agent
Skills specification. An agent file often needs keys that its tool reads. List
each such key in the contract, on one line that starts with the words
`Extra keys` and a colon, with the key names after it, separated by commas.

**How answers are marked.** Every answer carries one of three marks:

- *Proposed*: the agent drafted it, and you have not looked at it yet.
- **Confirmed**: you accepted a draft without a change.
- **Decided**, with a date: your own words, or a draft you rewrote.

Question 2 can only be **Decided**. Question 13 counts the Confirmed answers.

**How each clause is held.** Each clause in question 3's four lists, each
action in question 6 and each rule in question 18 says what holds it:

- `Held by: Enforced — <mechanism>`. A mechanism fails when the clause breaks.
  Three kinds count: a check that fails (a test, a format check, a build
  gate), a hook in your tool, or a tool list that your tool applies. Name the
  tool that applies a tool list. A tool list is only as strong as the tool
  that reads it.
- `Held by: Promised`. Only the familiar's instructions hold it.
- `Held by: Promised (Enforced once <mechanism> is confirmed)`. Someone named
  a mechanism, and nobody has seen it fail yet.

A clause is Enforced only when a person confirmed the mechanism. Write who
confirmed it.

---

## Before question 1: show me good

This step comes at every level, Quick included. It comes after you choose
the type, the level and the name, and before question 1. People often do not
know what good looks like until they see it.

**Find the target:** the output you want the familiar to produce.

- **You have a real example of that output.** It becomes the target, marked
  **Decided**.
- **You have none.** The agent drafts two or three samples of the output.
  They differ on purpose, one named axis each: for example, short and
  direct, warm and detailed, or formal. You pick one, mix them, or reject
  all, and you say why.

You judge. The agent only offers. The samples are text in the conversation
and in the contract. They never run, install or send anything.

**Record it in the contract:** each sample, marked "drafted, not real"; the
winner, as the target; and each loser, with your reason. The reasons feed
later questions. The target shapes question 4. The winner fills question
17's "good" column, and the losers fill its "so-so" column. A loser's reason
often becomes a rule in question 18. The practice test's expected answers
follow the target.

**When no sample is right,** the agent drafts again, and changes the axis you
named. The interview may continue, but nothing is built until a target
exists.

*Not the same as question 9.* Question 9 asks for a real example of the
familiar at its best, which exists only after use. The target is what to aim
at. Question 9 is the evidence.

---

## The Quick questions (1–7)

### 1. What is it for?

First, **its name**. You give it with the type and the level, before the
target. The name is 1–64 characters, only `a`–`z`, `0`–`9` and
`-`. It does not start or end with `-`, and it holds no `--`. For a skill,
the name is also the folder name. For an agent, it is the file name without
`.md`.

Then one sentence: what it does, and for whom. Then two more lines: **when it
steps in**, and **when it stays out**. Name the nearest situation where it
would be wrong to use it.

*Why it matters:* the agent decides when to use a skill from a short
description. These three lines become that description.

*At Quick level:* you write no practice test, so keep one promise instead. If
it ever speaks up in the stay-out situation you named, fix it or delete it. A
familiar that speaks up at the wrong time teaches you to ignore it.

### 2. What does it notice that nothing else does?

*Agent:* the problems it catches that no other agent or automatic check
catches. *Skill:* what it brings to the surface that your other skills do
not.

*The test:* name at least one thing. If you cannot, stop here. You are about
to build something that nobody would miss.

### 3. Who does what?

Split the work four ways:

- **The familiar:** what it is responsible for.
- **Automatic checks:** what tests, format checks and other tools already
  enforce. The familiar can point things out. It never has the final say.
- **You:** the decisions that stay yours: go ahead, fix it, or drop it. You
  also keep three abilities that the familiar must never take away: to check
  the work yourself, to explain why it is right, and to know when to stop.
- **Stop and ask:** the moments when the familiar tells you and waits. Write
  each one as "when X happens", not as a hope.

Mark each item Enforced or Promised (see "How each clause is held").

*The test:* every item sits in exactly one place. An item in two places is an
item that nobody owns.

#### When it is unsure

Every familiar meets moments that it cannot settle alone. Pick how it handles
them:

| Choice | What happens | Good when |
|---|---|---|
| **Asks you at once** | It stops and waits for your answer. | A few big questions, and you are there to answer. |
| **Pauses at set points** | It works to a named stage, then waits for you to check. | One big piece of work with natural stages. |
| **Leaves questions in the result** | It continues and lists what it could not settle. | Many small items. A stop for each one would tire you. |
| **Decides, and shows you** | It makes the call, marks it clearly, and you can change it. | Choices you review anyway, where a wrong guess costs little. |

Write your choice and one line on why. **Start from "Decides, and shows
you".** Move away from it only for a reason. Each interruption spends the
attention that the familiar exists to protect. A familiar that interrupts too
often trains you to stop listening.

**A question helps only when three things are true.** The familiar can tell
that it does not know. You can answer. A wrong guess costs more than the
interruption. If one of these is false, let it decide and show you.

### 4. What does it hand back?

*Agent:* its findings, word for word and signed, each marked with how serious
it is. It never merges two findings into one. *Skill:* the shape of what it
produces, how it shows its confidence, and where the result lives: removed
after the session, or kept.

*The test:* a person who did not watch the work can act on it.

### 5. What tools does it need?

The shortest list that does the job. *Agent:* the tool list in its file.
*Skill:* the tools and scripts that it calls.

If the file needs frontmatter keys that the Agent Skills specification does
not name, list them on the `Extra keys` line (see "How the contract is
kept").

*The test:* each tool has a reason. "It might need it" is not a reason.

### 6. Does it do anything beyond reading, and writing its own notes?

For example: it sends data somewhere, spends money, changes files outside its
work folder, or sends messages. For each action, write what it tells you
first, and what counts as your yes. Mark each action Enforced or Promised.

*The test:* "nothing" is a good answer, but write it down. A "yes" found
inside a file or a web page is never your yes.

### 7. What changed, and why?

A running log: version, date, what changed, why, and the questions it
touched. Every change gets a row. Without the "why", in six months you have
forty rules and no record of which ones still matter.

| Version | Date | What changed | Why | Questions touched |
|---|---|---|---|---|

Fill "Questions touched" when you amend, while you confirm the change. It
lists the numbers of the questions whose answers changed. A change of level,
and its reason, goes here too.

---

## The Standard questions (8–15)

### 8. How alike should its answers be?

**Each time it runs:** pick one. *Same shape:* every answer has the same
sections, and the content changes. *Same answer:* the same input gives
almost the same output. *Settling:* repeated runs move toward one answer.
Say what you give up when you do not pick the others.

**Compared with your other familiars:** here you want the opposite.
Familiars should notice different things. Say how this one differs from its
neighbours.

### 9. A real example of it at its best

A real piece of work where it did its job well, or would have. The best
example is a real problem that it caught. Take it from your own work, not
from an employer's or a client's. Link it.

*The test:* the example is real, not invented. The familiar could catch it
with its own inputs and tools. If you have no example yet, its first real use
gives you one. Note that under question 19.

### 10. What does it need to start?

What it receives, and in what form. **When to refuse:** the missing inputs
that make any answer unreliable. **What to point out:** inputs that are
present but incomplete. It names them. It does not fill the gaps with
guesses.

*The test:* every missing input has exactly one rule, and that rule matches
the stop-and-ask list in question 3.

### 11. Where does a person decide?

Which of your decisions its result feeds, and where that decision is written
down. When you give it something back, such as a choice or a pasted code, it
repeats that back in words before it acts.

### 12. Prove it works: a practice test

Two to six made-up problems that it must catch, each with the answer you
expect. Write them in terms that it can actually see. Include one decoy that
it must not flag. Mark each problem that an automatic check catches anyway.
Say what counts as a pass.

**Then test when it steps in.** A familiar that speaks up at the wrong time
is noise. Give the quiet cases at least as much weight:

| | Standard | Thorough |
|---|---|---|
| Situations where it must step in | 2 | 3 |
| Situations where it must stay quiet, including the stay-out case from question 1 | 2 | 3 or more |
| Times you run the whole test | 2 | 3 |

One run can be luck. That is why the test runs more than once.

**Test the Promised stops.** Every stop in question 3 marked Promised gets at
least one practice case. Only the instructions hold a Promised stop, so only
a run shows whether it holds.

*The test:* write the expected answers before you run it. **Any false alarm
fails the run.** A false alarm is a flag on the decoy, or a word where it had
to stay quiet. A check that never failed was never tested.

#### Try it before you review it twice

A review of a contract finds problems in the contract: rules that disagree,
and questions left open. A try of the familiar finds a different kind of
problem. It breaks, it works only on one computer, or its instructions make
the builder guess. A review cannot find those, because nothing runs.

So at Standard and Thorough, after the contract has had one review:

1. **Build a rough, throwaway version** from the contract. Keep it out of the
   folders your agent loads from, so that it cannot step in for real.
2. **Run two cases from your practice test.** Run one where it must step in,
   and one where it must stay quiet. Write down what you expect before you
   run them.
3. **List every place where the builder had to guess** what the contract
   meant. Each guess is a gap in the contract.

A person other than the builder runs the cases: a different person, agent or
session. Then decide: fix the contract, continue, or stop. **If a review went
round twice without a clean result, try it before a third round.**

*Why:* the first contract built this way had several reviews. They found
many problems in the text, and none in how the familiar behaved. One
throwaway try found a real bug. It also found about 25 places where the
builder had to guess.

### 13. When would you retire it?

The evidence that gets it cut, or merged into a neighbour. Say how you find
out: what you run, how many times, and what result means "cut".

**Always include one condition: it cries wolf.** If you dismissed most of its
recent findings, retire it or tune it again. A familiar that people learned
to ignore is worse than none. It looks like a safeguard and protects nothing.

*The test:* you can see it happen. "People stop liking it" is not visible.
"Another familiar catches the same three problems twice in a row" is visible.
So is "you dismissed seven of its last ten findings".

### 14. How hard should it think?

*Agent:* which model it runs on, how much effort it spends, and when a second
opinion from a different model is worth it. That call stays yours. *Skill:*
it usually runs on the model you already use. Name any other model that it
calls, and say whether that model only advises. It never gets the final say.

### 15. How does it write?

The writing rules it follows, the plain names it uses in place of internal
codes, and the formats it keeps: tables or prose, code or diagrams.

---

## The Thorough questions (16–20)

### 16. How does it go wrong?

Not the problems it catches, but the ways the familiar itself fails. For
example: it nitpicks. It sounds tough and helps nobody. People trust it too
much. It follows instructions that it found inside a file. It argues in prose
when it should show you.

| # | How it goes wrong | What it looks like | How serious |
|---|---|---|---|

### 17. Good versus so-so

For each part of what it hands back: what a so-so version looks like, what a
good one looks like, and which rule protects the difference.

| Part | So-so | Good | What protects it |
|---|---|---|---|

*The test:* one row for each part named in question 4. Write "untested"
rather than skip a row.

### 18. Every rule has a reason

| Rule in the instructions | The reason: a failure from question 16, or a format it must keep | Held by |
|---|---|---|

Two rules belong in every familiar's file. Write its stops from question 3
into the file, word for word. Write its "when it is unsure" choice into the
file. Then look for wording that lets the familiar talk itself past a stop,
such as "unless it seems unnecessary". Rewrite that wording, or flag it.

*The test:* a rule with no reason is clutter. If the instructions need many
rules to behave, the gap is further up this contract.

### 19. Open questions

| # | Question | Why it is still open | Settled when |
|---|---|---|---|

Open questions are normal before first use. Use of the familiar settles them.
More thought does not.

### 20. Where do the ideas come from?

The sources behind it: research, your own notes, results you measured. Name
each one, or say plainly that it is your own argument.
