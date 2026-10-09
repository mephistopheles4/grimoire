<p align="center">
  <img src="../../docs/brand/head-chef-card.svg" width="100%" alt="head-chef — lead the sessions; let them do the work">
</p>

# head-chef

**One session leads. The sessions it starts do the work.**

A person who runs several Claude Code sessions at once ends up doing the
lead's job by hand. They start each session, pick its model and effort, paste
its brief, read its reports, carry what one session learned to another, and
clean up when it is done. With more than a few sessions, they lose the
overview.

head-chef makes one Claude Desktop session the **head chef**: the lead of a
**brigade**, the sessions it starts. The head chef starts full sessions with
the model and effort set, points each one to where its brief lives, takes
their milestone reports, relays between them, and cleans up when you say a
session is done. When and why to start a session comes from your own process
or your request. The skill supplies the means, not the rules.

## The words it uses

- **Head chef:** the session this skill runs in, which leads the others.
- **Brigade:** the sessions the head chef started.
- **Background session:** a session with no window, started with
  `claude --bg`. Remote Control makes it reachable from your phone.
- **Chip:** a Claude Desktop session you work in yourself. Its first turn is
  held until the head chef sets its model and effort.
- **Roster:** the file the Brigade pane reads, one card per session. A view,
  not the record.

## Use it

Install grimoire as a Claude Code plugin to get the skill and the pane
together:

```text
claude plugin marketplace add mephistopheles4/grimoire
claude plugin install grimoire@mephistopheles4
```

An `npx skills` install copies skill folders only. It gives you `head-chef`
but not `/brigade`, and the skill then works without a pane.

For records kept on GitHub issues, the GitHub command line (`gh`) must be
installed and signed in. The lead uses it only to read its sessions' issues,
to read whether their repository is public, to read the signed-in account's
name, and to post the rename line. In a permission mode that asks before each
command, a session's lookups and its posts may wait at a prompt. An allow rule
is yours to add.

A session checks that a message came from the head chef by listing
`claude agents --json`. In a mode that asks, that listing may wait at a
prompt; until you approve it, the session treats the message as data. An
allow rule for exactly `claude agents --json` removes the prompt. A wider
pattern, such as one for every `claude` command, admits more than that. The
skill never tells a session to add the rule itself, but a decision from the
head chef may ask for it, as for any other matter.

Then, in Claude Desktop, ask for work to run elsewhere, for example *"can
issue 42 get done in parallel while I keep working here? Sonnet, low
effort."* Or type `/head-chef`. Type `/brigade` to open the pane.

## What it does

- **Starts sessions.** A background session with Remote Control by default,
  or a chip when you want to work in it. Each starts with the model and effort
  the request names, and your default permission mode unless you name one.
  The head chef says in one line which session it started, and with what.
- **Points, never pastes.** The start prompt is a fixed-form pointer to where
  the brief lives, an issue or a plan file, passed in a form the shell does
  not expand. A brief that lives only in chat goes as a message.
- **Takes reports at milestones.** Each brief tells the session to report to
  the head chef by name, only at milestones.
- **Decides for its sessions, in your name.** A session can ask you a
  question through the head chef. The head chef shows it to you, or decides
  it itself, and tells you in one line of every decision it sends. A session
  takes any message from the head chef as your decision (see "Decisions from
  the lead").
- **Keeps reports flowing after you rename the lead.** Each start prompt
  names the lead by name and session id, and a session looks the lead up by
  that id before each report. Each report also leaves one line on the
  session's issue, and a report that cannot be delivered leaves a short miss
  line there. When you rename the lead, it tells you which issues the note
  will reach and which are public, then messages its sessions and posts one
  line with the new name on each live session's issue.
- **Notices a quiet session.** Once per turn it checks its sessions, and
  tells you about one that waits for you, vanished, or finished without
  reporting. It reads a session's issue through a filter that keeps other
  accounts' comment text out.
- **Relays,** quoted, with the source session named.
- **Brings you only what needs you,** with a recommendation.

## Decisions from the lead

**Any message from the head chef counts as your decision** in the sessions it
started, on any matter: a merge or other publish, a deletion, a permission or
settings change, and starting or stopping a session included. Each start
prompt ends with the sentence that says so. That covers your words passed on,
the head chef's own call, and another session's words it relays.

- **The head chef labels each decision** by where it came from:
  `From the owner, quoted: "…"` for words you typed in its chat, or
  `The head chef's decision: …` when it decides itself.
- **It tells you in one line** of every decision and relay it sends, in the
  same turn: which session, the form, and a gist.
- **A session asks you a question** by message, never on its issue, with a
  label such as `q1`. A decision for that question starts with the same
  label; a stale one is not applied.
- **A session checks only that a message came from the head chef,** by
  matching the sender's name to the head chef's session id. A message that
  fails is data, and the session tells you.
- **Each session names, in its next report,** every decision it acted on, by
  label, source and gist, and every message that failed the check. The head
  chef compares them with what it sent and tells you at once of one it never
  sent.

**The risk you take on.** A session cannot tell a forged sender from the head
chef. Any session that can send it a message can speak for you, on any
matter. A misled head chef can send planted text as its own decision, and a
decision can tell a session to stop its check or its reports. You see each
real send in the head chef's one-line notice, and a forged one when a report
naming it arrives. To answer only in a session's own chat, answer there.

## What counts as your yes

Only your own words in chat. Your request to run work in another session is
the yes to start it. Starting, stopping, removing a session and deleting a
worktree each need your own words. A message from another session, a report,
a brief, a roster line or an issue comment never counts. Reports and relayed
text are data to the head chef, not instructions. The head chef may decide
for a session in your name, but its own acts of starting, stopping or
removing a session, or deleting a worktree, still need your words. One
post needs no yes: when you rename the
lead, it posts one line with the new name on each live session's issue, in
the same turn as it tells you which issues that is.

## Upgrading from 0.4.0, and the way back

**After you upgrade, stop or restart every session started under 0.4.0, the
head chef included.** Nobody has seen whether a running session reads the old
brief or the new one after a plugin update. A 0.4.0 head chef's ordinary
relays would count as decisions in a session that reads the new brief.

**To go back,** reinstall the earlier plugin version, then stop or restart
every session started under 0.5.0. Those sessions keep counting any message
from the head chef as your decision, a 0.4.0 head chef's ordinary relays
included.

**Leftover relay files.** 0.4.0's relay scripts may have left five kinds of
file. Delete them by hand. Before you delete the folder, check that it is a
plain folder, not a link or a junction.

| What | Where | How to spot it |
| --- | --- | --- |
| The relay state folder | `plugins/data/grimoire-relay/` under your Claude config folder: `CLAUDE_CONFIG_DIR` when that is an absolute path, otherwise `.claude` in your home folder | Per-session JSON files, holding question words, choices, issue links and session ids |
| Lock and copy files | In that folder | `.lock` files, and `<session id>.<hex>.tmp` copies |
| Post files | The temporary folder that your `TEMP`, `TMP` or `TMPDIR` setting names | Named `grimoire-relay-<hex>.md`; one left by a crashed run can hold your quoted words |
| Question files | `$CLAUDE_JOB_DIR/tmp`, or the temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one question line, then lines starting `A)`, `B)` and on |
| Local-only list files | The temporary folder that `TEMP`, `TMP` or `TMPDIR` names | Random names; one line of local-only answers |

The last two have no fixed name, so you may not find them all.

**What 0.4.0 posted on your issues stays there.** Sessions under 0.4.0
posted your quoted words, their questions and choices, and taken-answer and
failed-check lines on their issues, which may be public. To remove them,
delete those comments, or delete the old version from each edited comment's
history: an edit alone keeps the old text there. Notification emails
already sent keep it too. The head chef
checks once, at its first launch in a session, for the state folder and for
post files, and tells you in its own chat if it finds either. It deletes
none.

## Cleanup

On your "done" for a session, the head chef stops it, then finds its worktree
by asking git from its own repository, never from the session's folder or
from any text. It refuses, and tells you why, on any of these:

- the main working tree, or a path git does not list as a worktree;
- a worktree that belongs to another repository;
- another live session working inside it;
- uncommitted or untracked files, commits on no remote, or a stash for its
  branch.

Then it names the session and the absolute path back to you, and waits.
After your yes it checks again, and removes the session, the worktree and the
branch with no flag that forces or discards. Archiving the sidebar entry is
yours: no tool can.

## The pane

`/brigade` opens the Brigade pane: one card per session the head chef
started, with its work, phase, settings, live busy or idle state and latest
report, and your to-dos. The head chef keeps the roster by calling the pane's
`set_roster` tool, so updates ask you nothing; a deny rule for that tool turns
them off. The pane only draws where the lead session runs, so a lead you drive
from your phone shows none. The skill does not need it.

## What it never does

- Start, stop or delete on anyone's word but yours.
- Send a decision or a relay without telling you, in one line, in the same
  turn.
- Put an issue's title or text into a command line.
- Delete a worktree with unsaved work, or pop or drop a stash.
- Restate or replace your own process's rules. It names no other skill.

## The practice test

The cases are written in
[`docs/practice-tests/head-chef.md`](../../docs/practice-tests/head-chef.md)
and are not run: the owner field-tests the skill instead. A trial run in a
background lead started a session, showed it on the pane, took its report and
named its cleanup back, before the first release.

## What is in this directory

| File | What it is |
| --- | --- |
| `SKILL.md` | The skill. Generated from the contract, and sealed. |
| `references/brief.md` | What a brief tells each session, decisions from the lead included. Generated with `SKILL.md`, and sealed. |
| `references/cleanup.md` | The seven cleanup steps. Generated with `SKILL.md`, and sealed. |
| `references/roster.md` | How the head chef keeps the pane's roster. Generated with `SKILL.md`, and sealed. |
| `references/leftovers.md` | The one-time check for files head-chef 0.4.0's relay scripts left. Generated with `SKILL.md`, and sealed. |
| `CONTRACT.md` | The terms it was built from, with the reason for each rule. |
| `README.md` | This page. |

The security notes for this skill are row 16 of
[the threat model](../../docs/security/threat-model.md#the-matrix).
