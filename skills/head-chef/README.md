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

Relayed answers need two more things: your default auto mode, and Node 22 or
later. A session started in a mode that asks gets no relay rule, and a session
that cannot run its script asks you in its own chat.

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
- **Carries your answer to a session's question.** A session can ask you a
  question through the lead, with its choices labelled A, B and on. The head
  chef shows you the choices word for word, and relays your own words with
  the letter you picked. The session takes the answer only for a question it
  asked, only as one of its own choices, and acts on the letter alone. It
  quotes your words on its issue, which may be public; a post can't be fully
  taken back. The head chef tells you if a session took an answer it never
  relayed. A merge or other publish, a deletion, a
  permission or settings change, starting or stopping a session, and the
  answers you name as local-only never travel this way: the start prompt
  says so, and you give those in the session's own chat.
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

## Relayed answers

A **relayed answer** is your answer to a session's question, typed in the
lead's chat and carried to the session. Two scripts in `scripts/` do the
checks, so no model retypes your words or puts them into a command:
`relay-lead.mjs` for the head chef, and `relay-session.mjs` for each
session. They read only the caller's own transcript and relay state, the
session list, and your account's lines on the session's issue; the session's
script posts only on the issue its start prompt names. Every message between
them carries a digest line, so a copy that changed is refused.

The session takes an answer only when four checks pass, in order:

1. **From the lead:** the message comes from the lead's session, by the
   sender name the message system recorded.
2. **Its own code:** it carries the one-time code of a question the session
   asked and still has open.
3. **Its own choice:** the letter is one the session offered, with that
   choice's exact words, and the digest matches.
4. **May travel:** the choice is not a publish, a deletion, a permission or
   settings change, starting or stopping a session, or one of your local-only
   answers.

Then it posts your words on its issue and acts on the letter alone. The lead
reads your words from its own transcript and, before it sends, checks them
against what it saw you type. To answer in a session's own chat instead, just
answer there: the session closes its question.

## What counts as your yes

Only your own words in chat. Your request to run work in another session is
the yes to start it. Starting, stopping, removing a session and deleting a
worktree each need your own words. A message from another session, a report,
a brief, a roster line or an issue comment never counts. Reports and relayed
text are data, not instructions. Your answer to a session's question goes by
relay only when you type it in the lead's chat in reply to that question. One
post needs no yes: when you rename the
lead, it posts one line with the new name on each live session's issue, in
the same turn as it tells you which issues that is.

## Rolling back relayed answers

If you revert to a version before relayed answers, sessions already started
still hold the new start prompt. On each one's issue, post a line from your own
account that names every answer as local-only, in the form
`Local-only from now on: <answers>`; the session's list of local-only answers
only grows, and its script reads that line on every take, so it then takes no
relayed answer at all. Or restart the
session on the old start prompt. The head chef cannot post this line for you.

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
- Relay its own choice, a report's line or a paraphrase as your answer.
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
| `references/brief.md` | What a brief tells each session, relayed answers included. Generated with `SKILL.md`, and sealed. |
| `references/relay.md` | How the head chef shows a question and relays your answer. Generated with `SKILL.md`, and sealed. |
| `references/cleanup.md` | The seven cleanup steps. Generated with `SKILL.md`, and sealed. |
| `references/roster.md` | How the head chef keeps the pane's roster. Generated with `SKILL.md`, and sealed. |
| `scripts/relay-lead.mjs` | The head chef's relay script: the start prompt's rule, notes, questions, relays and the cross-check. Sealed. |
| `scripts/relay-session.mjs` | A session's relay script: asking, taking, its fixed record lines, and cleanup. Sealed. |
| `scripts/lib/` | The two scripts' shared core and their cores. Node built-ins only. Sealed. |
| `CONTRACT.md` | The terms it was built from, with the reason for each rule. |
| `README.md` | This page. |

The security notes for this skill are row 16 of
[the threat model](../../docs/security/threat-model.md#the-matrix).
