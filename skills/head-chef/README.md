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
- **Hears when a session stops** (since 1.0.0). After each start and each
  report it asks for the session's idle notice, so it never polls. A session
  that goes idle with no report since the lead's last message is asked once.
  Before it messages a session idle for over an hour, it tells you in one line
  that the session will re-read its whole context at full price. A session
  waiting at a permission prompt may not go idle, so the lead may not notice
  it; that session's own chat shows the prompt.
- **Approves plans and closes sessions in plain text.** A session's "spec
  ready" report asks the lead to approve; the lead answers "approved" or
  "revise: ...". The go-ahead on a spec stays yours, or the lead's at a level
  3 you confirmed. To close a session, the lead asks it to wrap up: commit,
  push, report, and say it is ready to close.
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
3 counts once you type `/brigade level 3 <goal>` at the prompt or from your
phone, which lasts through compactions, or once you confirm a slider press's
time in the lead's chat, with a goal in your words there; a level or a goal
named anywhere else is data.
"/make-it-so" accepts only the picks in the lead's own last message, never
cleanup, an install, an accepted-risk record or a secret's fate, which each
need your words naming them, each with its own button.

## What the sessions trust

A session knows its lead by name only (since 1.0.0; ADR 0013). Its start
prompt names the lead's session, and it sends its reports to that name. It
takes each message that arrives under that name as a **relayed decision**,
on any matter. It labels it as relayed by the lead, never as your own words,
and names each decision it acted on in its next report to the lead. A program
of yours, or another session that holds the lead's name, can pass as the
lead: you accepted that on issue 450, and the threat model lists it under class C5 as candidate P8. The
head chef tells you at once when a session reports a decision it never sent.

Before the lead is renamed or handed off, the head chef tells each session
and you the new name. A session takes a new lead name only from your words in
its own chat, so give it there.

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

A brigade running when you install 1.0.0 keeps working: its sessions follow
their old start prompts, and a 1.0.0 lead's messages, sent by name, still come
from the lead's own address and session, which the 0.17.0 check pairs. Finish
or clean up a brigade a head chef older than 0.17.0 started before you
upgrade.

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
| `references/cleanup.md` | Cleanup's reads, name-back, one yes and removals, read when cleanup starts. Generated with `SKILL.md`. |
| `references/submodule-cleanup.md` | The extra reads and the loss list for a worktree with submodules. Generated with `SKILL.md`. |
| `references/starting.md` | The steps of a start, read before each start. Generated with `SKILL.md`. |
| `references/background.md` | The background route after Desktop refused a start. Generated with `SKILL.md`. |
| `references/handoff.md` | Writing and reading the lead's hand-off. Generated with `SKILL.md`. |
| `references/CONTRACT.md` | The contract `SKILL.md` is generated from. |
| `references/contract.changelog.md` | The contract's history, from 0.1.0. |
| `.skillspector-baseline.yaml` | Why four of the scanner's rules are false positives here. |

Nothing seals a generated file. To change the skill, amend the contract and
generate `SKILL.md` again; a reviewer reads every changed file in full.
