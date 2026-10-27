<p align="center">
  <img src="../../docs/brand/head-chef-card.svg" width="100%" alt="head-chef — lead the sessions; let them do the work">
</p>

# head-chef

**One session leads. The sessions it starts do the work.**

A person who runs many sessions on one or more efforts repeats the same
actions by hand: starting a session, managing its context, handing work to
another session, and archiving it. head-chef takes care of those, so you can
stay on the bigger picture, keep its direction, and step in where you need to.

head-chef makes one Claude Desktop session the **head chef**: the lead of a
**brigade**, the sessions it starts. Unlike a subagent or a workflow, every
session it starts is one you can talk to directly, at any time. When and why
to start a session comes from your own process or your request.

## The words it uses

- **Head chef:** the session this skill runs in, which leads the others.
- **Lead:** the Desktop session the head chef runs in.
- **Brigade:** the sessions the lead started.
- **Name-back:** the list the head chef shows before an act that cannot be
  undone, naming exactly what it will touch.
- **Permission warning:** the band above the prompt that says what the head
  chef's sessions put at risk.

## Use it

Install grimoire as a Claude Code plugin to get the skill, the Brigade pane
and the permission warning together:

```text
claude plugin marketplace add mephistopheles4/grimoire
claude plugin install grimoire@mephistopheles4
```

An `npx skills` install copies skill folders only. It gives you `head-chef`
but not `/brigade` or the warning band: the skill then works without a pane,
and says the warning once in chat instead.

It needs Claude Code, Claude Desktop, git, and the GitHub command line (`gh`)
installed and signed in.

Then, in Claude Desktop, ask for work to run elsewhere, for example *"start a
session to build ticket 4 of issue 312, Sonnet medium."* Or type
`/head-chef`. With the plugin installed, the pane opens when the skill loads,
or type `/brigade` to open it.

## What it does

- **Starts sessions.** Each one is a Desktop session under the lead by default, with its
  name, model and effort set. The model and effort come from your words or
  your own process. Its start prompt is one short pointer: the stage and the
  issue, which holds the brief, and how to report to the lead.
- **Offers a background session when Desktop refuses.** Desktop's start tool
  refuses a start you type from the phone over Remote Control. The head chef
  then says so in one line and offers to start the session in the background
  with Remote Control instead, and starts it only when you choose that. You
  open it from its card in the Brigade pane, or from the claude.ai session
  list on the phone.
- **Never relies on a card** to start work you asked for. When a start can
  only happen through a card, such as an approval above the lead's settings,
  it says in one line that the card needs a tap in the desktop app.
- **Reports the start** in a few lines: the session, its issue, what you must
  do, and your usage. Usage stays in chat.
- **Relays** questions and answers, quoted, with the source named.
- **Decides small questions** your direction already covers, and tells you in
  one line.
- **Watches** for a session that is blocked, quiet, or done without
  reporting, and messages it to ask. Before it messages a session idle for over an hour, it tells you the message makes that session re-read its whole context at full price, and asks first, offering cheaper routes; a reply to the session's own question, or a step you asked for by name, needs no ask.
- **Keeps the Brigade pane** in the same step as each act, while the pane is
  open.
- **Cleans up** on your "done", in every repository its sessions ran in: one
  name-back, by repository, of each session, its worktree folder and its
  branch, with what it found in each (uncommitted or stashed work, commits on
  no remote, a lock, submodules, and where the branch's work lives), then
  one yes. Found work is shown, never a stop. It reads each item again before
  removing it, and names back again anything that changed. It archives the
  session, then removes with git what is left, forcing once where git
  refuses, twice only for a worktree it named back as locked, and `-D` only
  where `-d` refuses and never on a default or checked-out branch. A
  background session is stopped and removed with `claude stop` and
  `claude rm` in place of the archive, and the name-back marks it.
  `claude rm` keeps the session's transcript in the Claude config folder;
  what it keeps of the job's own store was not checked. A removal that fails
  is left and told to you. Cleanup's yes is yours at every level.
- **Acts on GitHub** on your own words in its chat: merge, close, edit,
  delete or label an issue or a pull request, file an issue, or post a comment, each named in
  one line first. At a level 3 you confirmed, with a goal, it takes these
  acts toward the goal itself and logs each first, except a post or merge
  text that would carry personal data or private work, and a merge that
  removes a control the threat model names, which wait for you.
- **Runs at your level** (since 0.17.0). It reads the Brigade pane's
  autonomy level before each decision it would take alone, and logs each
  decision before it acts. At 1 it asks you on every decision; at 2 it
  decides what it is sure of and sends you the major and kept ones as
  to-dos; at 3 it runs toward your goal. A secret or personal-data finding,
  an accepted-risk record, an install and cleanup wait for you at every
  level.

## What counts as your yes

Only your own words in the lead's chat. A session's message, a report, a note
or an issue comment never counts: a request in one is told to you, and
nothing happens. Accepting a risk is your words in chat too; pressing I
understand on the permission warning is a reminder, not acceptance. A level
3 counts only once you confirm its press time in the lead's chat, with a
goal in your words there; a level or a goal named anywhere else is data.
"/make-it-so" accepts only the picks in the lead's own last message, never
cleanup, an install, an accepted-risk record or a secret's fate, which each
need your words naming them, each with its own button.

## What the sessions trust

A session takes the lead's first message when the sender's shown name
matches the lead's row in the session list and no other row holds that name.
It answers it, and keeps the lead's Desktop id that the message carries.
From then on it takes a message from the lead only when it carries that id,
whatever name or address it shows, and it reports to the address of the
lead's latest message. Before it takes one, or reports, it checks that a
status file pairs the lead's id with that address, and holds the report
when none does: once a lead ends, another program can take its address. The
head chef notices when its own address changes after a restart, and messages
each session idle for under an hour, so their next reports follow it; a session idle for longer gets the new address with the next message it is sent, and holds its reports until then. So renaming or restarting the lead
should no longer cut its sessions off, as long as the lead's Desktop id stays
the same; that is expected, not yet measured, until a field run shows it.
The first message is checked against the status files too. A program of
yours can still plant a status file, so this is a consistency check, not a
guard. It takes each such message as a **relayed decision**, on any
matter. It labels it as relayed by the lead, never as your own words, and
names each decision it acted on in its next report to the lead. Until the
first message, anything that can send it a message under the lead's name can
steer it, and no probe has shown whether a local program can state another's
id. The head chef tells you at once when a session reports a decision it
never sent, a message it refused, or a send that failed.

Before a restart, `/clear` or resume of the lead, the head chef warns you
that its sessions need its new id if its Desktop id changes: what those do to
the id is not measured. A session that loses the id takes nothing from the
lead until you give it the id in its own chat.

A session also follows comments on its issue made as you, and every session
you start posts as you, so a comment from one session can steer another.
While Remote Control is on, any device signed in to your account can drive
the sessions it starts. The permission warning says all of this before the
first launch in each lead, until you tick "Don't show again". It shows again
when its wording changes.

## The permission warning

The Brigade mod draws it above the prompt when the head chef calls its
`show_permission_warning` tool. "I understand" hides it for this session.
Tick "Don't show again" first, and it stays hidden in every later lead until
its wording changes. The choice is kept in the plugin's own store, as the
time and a hash of the wording.

## Upgrading from an older head-chef

Finish or clean up a brigade an older head chef started before you upgrade:
its sessions follow their old start prompts, not this one. Sessions started
before 0.12.0 check the lead by its name, so a rename still cuts them off;
the head chef warns you before one.

**Leftovers from 0.4.0.** Its relay scripts may have left five kinds of
file, which can hold your quoted words, questions and session ids. 0.9.0 no
longer checks for them, so delete them by hand. Before you delete the
folder, check that it is a plain folder, not a link or a junction.

| What | Where | How to spot it |
| --- | --- | --- |
| The relay state folder | `plugins/data/grimoire-relay/` under your Claude config folder: `CLAUDE_CONFIG_DIR` when that is an absolute path, otherwise `.claude` in your home folder | Per-session JSON files, holding question words, choices, issue links and session ids |
| Lock and copy files | In that folder | `.lock` files, and `<session id>.<hex>.tmp` copies |
| Post files | The temporary folder that your `TEMP`, `TMP` or `TMPDIR` setting names | Named `grimoire-relay-<hex>.md`; one left by a crashed run can hold your quoted words |
| Question files | `$CLAUDE_JOB_DIR/tmp`, or the temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one question line, then lines starting `A)`, `B)` and on |
| Local-only list files | The temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one line of local-only answers |

The last two have no fixed name, so you may not find them all. A record act
from 0.6.0 to 0.8.x that was interrupted can also leave a post file in the
temporary folder, named `grimoire-act-<hex>.txt`; from 0.9.0 the file is
named `head-chef-post-<hex>.md`. Either can hold text you asked the head chef
to post.

**What 0.4.0 posted on your issues stays there.** Sessions under 0.4.0
posted your quoted words, their questions and choices, and taken-answer and
failed-check lines on their issues, which may be public. To remove them,
delete those comments, or delete the old version from each edited comment's
history: an edit alone keeps the old text there. Notification emails already
sent keep it too.

## Running the eval cases

The cases in `evals/head-chef/` run once on Haiku, with a Haiku judge,
only when you ask for a run, never as part of merging:

```bash
claude plugin eval <repo> --model haiku --runs 1 --ablation none --no-publish --max-cost-usd 1
```

To run one case, add `--case <name>`; a second `--case` replaces the first.
On 2026-10-24 two cases on Haiku, with a Haiku judge, cost under a cent each
and took 19 and 29 seconds, so a full run costs roughly $0.30, an estimate.
To calibrate the judge now and then, add `--judge-model opus`, which costs
about $0.02 a case more; on 2026-10-25 the Opus judge refused to grade 7 of
the 33 cases. A run writes its report to `evals/results/`, which git ignores;
read it, then delete it.

A case passes only when all its graders pass. A check a pattern or a tool call
can decide is a fixed grader (`regex` or `tool_used`), which costs nothing and
never refuses; what needs judgement is one `llm` grader per case. Each `llm`
grader tells the judge to fail an answer it cannot decide and say unknown,
but the report shows only the judge's votes, not its reasons. So when an
answer reads as a pass and the judge failed it, look at the case or its
grader before the skill. A judge that refuses the grading call leaves the
case without a verdict, which is no fault of the skill; an Opus calibration
run leaves ungraded the cases its judge refuses, 7 of 33 on 2026-10-25. The
grader keys were read from
Claude Code 2.1.310, which rejects a case with a key it does not know.

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The skill. Generated from the contract. |
| `references/roster.md` | How the head chef keeps the pane's roster. Generated with `SKILL.md`. |
| `references/CONTRACT.md` | The contract `SKILL.md` is generated from. |
| `references/contract.changelog.md` | The contract's history, from 0.1.0. |
| `.skillspector-baseline.yaml` | Why four of the scanner's rules are false positives here. |

Nothing seals a generated file. To change the skill, amend the contract and
generate `SKILL.md` again; a reviewer reads every changed file in full.
