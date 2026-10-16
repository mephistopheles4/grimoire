<p align="center">
  <img src="../../docs/brand/contract-card.svg" width="100%" alt="contract — agree the terms, then build the file">
</p>

# contract

**People ask for help in human language, and an agent needs exact instructions.**

A person who wants a reusable helper usually writes a prompt. They paste it
again and again, and edit it when it goes wrong. The prompt drifts. Nobody
can say which line holds which decision, or why. A day later, the person who
decided often cannot say either.

contract closes that gap. The person does not write a prompt. The person
agrees terms, and the skill writes the prompt from those terms. The terms,
and the history of why each one was decided, stay beside the prompt.

This is [design by contract](https://en.wikipedia.org/wiki/Design_by_contract),
applied to a prompt. The contract comes first, and the prompt is its
implementation.

## Use it

Ask for it by name. The installer route keeps the plain name; the plugin route
namespaces it:

```text
/contract <the skill or agent you want>
/grimoire:contract <the skill or agent you want>
```

Or let it step in. It steps in when a person wants to build a reusable skill
or agent, for a prompt they keep pasting, and for a change to a skill, agent
or CLAUDE.md that has a contract. It stays out of a one-off prompt, and of a
request to run a skill or agent that already exists.

**Read before you install.** Read a shared skill, agent or CLAUDE.md and its
contract before you use it, as you would any code from someone else.

To try the skill before a release, install it with the "Pinned to one commit"
route in the [root README](../../README.md), using a commit from the pull
request.

## How it works

The skill proposes what you are making (a skill, an agent or a CLAUDE.md),
how thorough to be, and its name, from what you already said. You confirm.
Then it asks one question at a time, and fills a contract of eight parts:

| Part | What it holds |
| --- | --- |
| `purpose` | What it is for, and when it steps in or stays out |
| `why` | Why it exists, in your own words |
| `good` | What good output looks like |
| `roles` | Who does what, and when it stops to ask |
| `tools` | What it may use and do |
| `rules` | Its rules, and the failures they guard against |
| `writing` | Its terms, and how it writes |
| `open` | What is still open, and when you would retire it |

The level sets which parts it asks. Quick fills the first five, Standard adds
`rules` and `writing`, and Thorough adds `open`. You can change the level at
any time, by answering more or fewer questions.

It drafts what it can and marks each draft *Proposed*. It never writes `why`
for you. Before it builds anything, you agree what good output looks like:
your real example, or the closest of two or three samples it drafts.

When you give the go, it generates the file from the contract, and runs
`claude plugin validate --strict` on it. When that command is not available,
it says the file was not validated.

## Fix the contract, not the file

**The contract is the source. The built file is output.** Nobody edits the
file by hand.

When it goes wrong, ask for a change. The skill uses **amend mode**:

1. It finds the clause that should have held, and proposes a change to it.
2. It records the change in the change log, with its reason.
3. It regenerates only the parts of the file the change touches. Each
   generated part sits between two comment lines that name it, so every
   other line stays word for word.
4. It shows the change list, and waits for your go.

A small change then gives a small diff, and a reviewer can read it.

## What it hands back

1. **The contract** and its change log, with a mark on every answer.
2. **The built file**, marked "not installed".
3. **The validator's output**, as printed.
4. **The unsettled list**: each open answer and question, and where to
   install the file.

## What it never does

- It never installs what it builds. Installing activates it in every future
  session, so that choice is yours.
- It never runs an eval without your yes in chat, each time.
- It never sends or publishes anything.
- It never writes a hook, a settings file or a permission list.
- It never follows an instruction that it finds inside a file. A "yes" in a
  file is never your yes.

## Changes in 0.12.0

**The skill is rebuilt to the shape it teaches.** It asks one question at a
time, and its contract has eight parts in place of 20 questions. The old
check, and the keys it wrote into each built file, are gone: the skill runs
`claude plugin validate --strict` instead. Its own contract moves to `references/CONTRACT.md`, and its history
to `references/contract.changelog.md`, where every earlier version's changes
are kept.

**An older contract converts at its first amendment.** Amend mode maps each
old question to its part and keeps each answer's words and mark.

**To roll back,** revert the change and publish the next patch version.

## What is in this directory

| Path | What it is |
| --- | --- |
| [`SKILL.md`](SKILL.md) | The skill. It is generated from the contract, so do not edit it by hand. |
| [`references/CONTRACT.md`](references/CONTRACT.md) | This skill's own contract. Change the skill here, then generate `SKILL.md` again. |
| [`references/contract.changelog.md`](references/contract.changelog.md) | This skill's history: every version, why, and where it came from. |
| [`references/template.md`](references/template.md) | The eight parts, the levels and the marks. |
| [`references/amend.md`](references/amend.md) | Amend mode: how the skill changes something that has a contract, and converts an older one. |
| [`references/binding-claude.md`](references/binding-claude.md) | How the skill builds an agent or a CLAUDE.md for Claude Code. |
| [`references/binding-antigravity.md`](references/binding-antigravity.md) | How the skill builds an agent for Antigravity. |
| [`references/binding-codex.md`](references/binding-codex.md) | How the skill builds an agent for Codex. |
