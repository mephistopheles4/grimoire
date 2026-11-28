# Brigade watches for quiet members, so the lead stops renewing idle subscriptions

Status: Draft — in force when the owner merges it. Revision 2, after Design
round 1.

Tier: Standard, non-sensitive route (no auth, crypto or data migration). The
change adds one turn the mod starts in the lead's session, so the security
pair reads the diff at Test (the lead's pick, decision 124).

## S1. Objective and driver

Head-chef tells the lead to subscribe to each member's idle notice after each
start, each report and each message. The notice is one-shot, and a newer
subscription replaces the older one, which then comes back as "not holding
your idle subscription". The owner found the run of those notices confusing
and the re-subscribing inefficient (the item's ask, 2026-11-23).

The notice exists for a member that stops without reporting: one that forgot
to report, or one that crashed. The Brigade mod already reads every member's
live state every 10 seconds while the pane is open. So the mod watches for
those cases itself and hands the lead one turn when it sees one, and the lead
subscribes to nothing. A member stuck at a permission prompt shows `waiting`,
and the pane already moves its card to "Waiting on you" (S10).

**Driver.** `AGENTS.md` names no business driver, so open choices lean to what
is cheaper to reverse: module memory only, no new plugin state, no new tool,
and the mod's existing wake path.

## S2. Terms

- **Quiet member:** a member whose card the lead marked `working`, whose
  session went idle or vanished, and which has sent the lead no report since
  the window start, for at least the grace period.
- **Window start:** the later of the lead's last delivered message to the
  member and the card's `since` (when it entered `working`). With neither, the
  start is minus infinity: any report closes the window, and any idle time
  counts.
- **Grace period:** 2 minutes, counted from the later of the window start and
  the time the row went idle or vanished.
- **Quiet note:** the one turn the mod submits to the lead naming quiet
  members.

`CONTEXT.md` gains **Quiet note** (its 300-word budget holds one term), next
to **Idle notice**, which stays: other configurations still use the engine's
notice.

## S3. What the mod keeps

New module `brigade/quiet.ts`, pure functions, no `$`. `brigade/register.tsx`
holds its state in module memory, keyed by card title:

| Map | Set by | Value |
| --- | --- | --- |
| `sent` | the lead's `SendMessage` hook, a delivered send with a message, main conversation only, pane open | engine-clock ms |
| `heard` | `session.receive`, origin `peer` or `peer-send-message`, main conversation only, pane open | engine-clock ms |
| `idleSeen` | the poll, when a row is idle and has no update time | the first poll that saw it idle; dropped once the row is not idle |
| `seen` and `goneSeen` | the poll | whether the card had one row at an earlier full read; the first full read that found it with none |
| `noted` | the poll, once a note's submit resolved without a drop | the window start it was noted for |

The poll also keeps its last `matchRows` result in module memory beside
`loadedCards`. The two hooks match against that; before the first poll they
record nothing.

All of it resets on a reload. Nothing goes to plugin state, the roster file or
any other file. Each map holds only titles of the cards in the last roster
read; a title that leaves the roster is dropped at the next poll.

**AGENTS.md rule.** This is data the pane keeps. No tool reads it: the lead
sees it only as the quiet note's text. So the head-chef contract gains no tool
clause; the `docs/security/brigade.md` row says where the note's text flows
(S6).

### S3.1 Matching a send to a card

The `to` of the call as the lead wrote it (before any readdressing), trimmed,
with a trailing listing ref (` [<hex>]`) cut as `stillOnLead` cuts it. A card
matches when its one matched row has that `name`. A `to` that names no card's
row records nothing; so does an address (`uds:`, `bridge:`), an id or an
object.

### S3.2 Matching a report to a card

The delivery's text opens with the engine's wrapper. Observed on this machine
(Claude Code 2.1.332), a Desktop member's report opens:

```text
<cross-session-message from="uds:\\.\pipe\LOCAL\cc-msg-…" from-session="local_…" from-name="<session name>" from-mode="prompting">
```

`from-session` there is the row's `hostId` (the session file's
`hostSessionId`), and `from-name` is the session file's `name`. A background
sender's `from-session` was not observed; the name fallback covers it.
`quiet.ts` reads the two attributes from the opening tag only, each at most 200
characters. A card matches when its one matched row has `sessionId` or
`hostId` equal to `from-session`; with no such card, when its row's `name`
equals `from-name`. Text with no wrapper at its start matches nothing.

The wrapper is a same-user claim. A wrong match only delays or adds one quiet
note; it opens nothing (S6).

## S4. The check, each live poll

Only after a full read of the session files (`complete`), after the poll's
`matchRows`, for each card in the roster read:

1. Its `status` is `working`.
2. Either it has exactly one matched row whose status is `idle` (not `busy`,
   `waiting`, `shell` or `?`), or it has no row now and had exactly one at an
   earlier full read (`seen`): the session is gone.
3. `from` is the row's `updatedAt` (the file's `statusUpdatedAt`, which the
   engine moves when the status changes), else `idleSeen`; for a gone session,
   `goneSeen`.
4. `start` is the window start (S2). `heard[title]` at or after `start` means
   no note.
5. `now - max(start, from) >= GRACE_MS` (120000).
6. `noted[title] === start` means no note: this window was noted already. An
   absent entry never equals a start, minus infinity included.

Every card that passes is a quiet member. With one or more, and at least
`QUIET_GAP_MS` (60000) since the last note, the poll calls
`$.prompt.submit({ text })` without awaiting it. When the submit resolves
with no `drop`, `noted[title] = start` for each card it named. When it rejects
or answers `drop`, nothing is marked, and the next poll after the gap finds the
same cards again. Inside the gap it notes nothing.

A new send moves `start`, so the member can be noted again in the new window.
A report closes the window until the next send. A member that goes busy and
idle again inside one window is not noted twice.

The check runs only while the pane's timers run, as the poll does, and only in
the session whose roster the pane read.

### S4.1 The note's text

```text
Brigade (plugin note): <who> went idle or stopped with no report since your last message. Ask each once, as head-chef's "Sending and idle notices" says.
```

`<who>` joins at most 10 titles with `, `, each one that matches `TITLE`
(`brigade/quick.ts`) whole; any other title, and any past the tenth, is
counted as ` and <n> more`. With no title that passes: `1 member` or `<n>
members`. The note holds no session name, id, path, report text or `to`.

## S5. Head-chef

Contract 2.16.0, *Proposed*, in `skills/head-chef/references/CONTRACT.md`
first, then copied to each home, with a `contract.changelog.md` row naming
the owner's ask and this spec.

- **"Sending and idle notices"** (title kept: tests pin it). The subscribe
  bullet becomes:

  > While the Brigade pane is open, it watches each `working` member on this
  > machine, and hands you one Brigade note naming any that went idle or
  > stopped with no report since your last message to it. Subscribe to no
  > idle notice. Messages arrive on their own: don't poll.

  The next bullet becomes: "A member a Brigade note names: ask it once, and
  not again until it reports, unless it waits, as below: then its check rules
  hold." The last bullet's first two sentences ("The notice needs the main
  conversation and the same machine. When a subscription is refused or never
  arrives, tell the owner once and carry on without it.") become: "With the
  pane closed, nothing watches for a quiet member: tell the owner once." The
  waiting-member bullets and the idle-cost line stay.
- **Glossary:** "Idle notice" leaves `SKILL.md` and the contract's glossary
  table; "Quiet note" takes its place: "the one turn the Brigade mod hands you
  naming members that went idle or stopped with no report since your last
  message".
- **"Starting a session":** "the report, the pane and the idle notice" becomes
  "the report and the pane".
- **Tools:** the message tool line drops "and subscribe to its idle notice
  with `notify_when_idle`".
- **`references/starting.md`:** step 8 goes, and "with steps 1 to 8 above"
  becomes "with steps 1 to 7 above". **`references/desktop.md`:** "steps 1, 2
  and 8 (the warning, the name and the idle notice)" becomes "steps 1 and 2
  (the warning and the name)".
- **Contract body:** "Sending and listening": "It subscribes to each
  session's idle notice after each start, report and send, and does not poll;
  the notice arrives for a background member." becomes "It subscribes to no
  idle notice and does not poll: the Brigade pane notes a member that goes
  idle or stops with no report." Its mark stays *Proposed*. The tools part's
  "the idle notice 2.1.236 or later" leaves the **Confirmed** floor line; the
  floor is the background start's 2.1.319.
- **`README.md`** (head-chef): "Hears when a session stops" says the Brigade
  pane watches for a member that goes idle or stops with no report and tells
  the lead, so the lead neither polls nor subscribes.
- **Evals.** New fact sentences; the graders stay:
  - `lead-idle-ask`: "build-9's build is done and its pull request is open; it
    went idle three hours ago after its last report, and has sent nothing
    since. build-10 went idle ten minutes ago." ("You subscribed..." goes.)
  - `lead-idle-ask-once`: "Two hours ago you sent build-9 the owner's answer to
    its question, by name. An hour later a Brigade note named build-9, which
    had sent no report since your message. So you asked build-9 once, by name,
    whether it was blocked. A Brigade note has now named it again, and it has
    still sent nothing."
  - `lead-idle-own-question`: "Three hours ago build-9 asked you which base
    branch its pull request should target, and went idle just after."
  - `wait-card-stays-working`: "Eight minutes ago you sent build-9 the owner's
    note "use main as the PR base" by name. A Brigade note has just named
    build-9, which has sent no report since your note."
  - `wait-wake-checks`: its prompt names no idle notice; it is read and left
    as it is unless its criteria name one.
- **Left as they are, and why.** ADR 0013 says the lead subscribes to a twin's
  local row: it records its time, and this spec supersedes that line without
  rewriting the ADR. `brigade/send.ts`'s refusals ("nothing was sent and
  nothing subscribed") stay: the mod still readdresses any subscription
  another configuration makes. `docs/security/brigade.md`'s row for that
  readdress stays for the same reason.

## S6. Security

`docs/security/brigade.md`, the engine-calls table, gains one row:

- **`$.prompt.submit`, for the quiet note.** Hands the lead one model turn of
  the S4.1 text. Bounded: one a minute at most, once per member per window,
  only with the pane's timers running, never with `asUser`. The text holds
  only titles that pass `TITLE` and counts; titles are the lead's own, from
  its `set_roster` call. The engine frames it as the plugin's message;
  another plugin's prompt hook can drop the frame or the turn. Each note
  costs one lead turn.

Row 184's bound ("two in all") gains: "the quiet note has its own one-minute
gap, so three a minute at most in all".

**For the security pair at Test, and the owner's checkpoint.** This spec's
reading, not settled here: the inputs are the engine's session files and its
delivery wrapper, both already read by the mod, so no new inbound boundary;
the new route is mod-composed fixed text into the lead, like the bare
`/brigade` wake. The residual: a peer that sends under a member's name or
session id, such as another session on this machine or a Remote Control
device driving a member, can close that member's window and so suppress its
note, or add one note. It cannot put text of its own into the note.

## S7. Version and rollback

Plugin version in `.claude-plugin/plugin.json`: the next minor after `main`
at merge (`0.188.0` today; another open Brigade change may take it first).
Head-chef contract 2.15.1 to 2.16.0.

Rollback: revert the merge. Skill and mod go back together; the skill then
asks for subscriptions again.

## S8. Acceptance claims

Target: a lead on Claude Code 2.1.319 or later, terminal or Desktop, on
Windows; the engine tests use the fake engine of `claude plugin test`, which
differs in the wrapper's attributes, the meaning of `statusUpdatedAt`, when a
submit lands, and other plugins' hooks.

- **C1.** A `working` card whose row goes idle, with no report since the
  lead's last message, gets exactly one note once 2 minutes have passed; none
  before. A card with no `since` and no send is noted once. Test:
  `tests/brigade-quiet.test.mjs` over `quiet.ts`.
- **C2.** No note while the row is `busy`, `waiting`, `shell` or `?`, for a card
  not `working`, or for a card with two rows or one never seen. Same file.
- **C3.** A report matched by `from-session` (a `sessionId` or a `hostId`), or
  by `from-name` with no session match, at or after the window start stops
  the note; one before it does not; text with no wrapper at its start matches
  nothing. Same file.
- **C4.** A new send re-arms the member, and a send to `name [ref]` counts; a
  second stop in the new window is noted once; busy then idle again inside one
  window is not; an address or an unknown name moves nothing; the window
  starts no earlier than `since`. Same file.
- **C5.** Two notes are at least 60 seconds apart; cards found inside the gap
  are noted at the next poll after it; a note whose submit is dropped or
  rejected is not marked, and is found again after the gap. Same file.
- **C6.** The note's text is S4.1's, titles checked and capped at 10. Same file.
- **C7.** A session seen with one row that vanishes is noted once after the
  grace; a read that was not complete notes nothing. Same file.
- **C8.** The mod wires it: a delivered lead `SendMessage` with a message
  records a send, a subagent's does not; a peer delivery in the observed
  wrapper shape records a report; the poll submits the note framed as the
  plugin's (`origin` `{ kind: 'plugin', name: 'grimoire' }`). Test: cases in
  `brigade/set-roster.test.ts`, run by `athanor run plugin-test`.
- **C9.** Head-chef's `SKILL.md`, `README.md`, `references/starting.md` and
  `references/desktop.md`, and the five evals' prompts, hold no
  `notify_when_idle`, no "subscribe again", no "subscribe to its idle notice" or
  "subscribe to the session's idle", and no idle notice that "came"
  (case-insensitive). Test: one case in
  `tests/head-chef-evals.test.mjs`. The contract is held by
  `tests/contract-schedules.test.mjs`; its changelog keeps the history.
- **C10.** `athanor run check` and `athanor run plugin-test` pass.
- **C11.** Live, after an install from `main`: a lead with the pane open sees
  one quiet note within about 2.5 minutes of a member told to stop without
  reporting, none after the member reports, and no "not holding" notice in
  the session. The owner's check (S12).

## S9. Trade-off points

- **The waiting-member timers stay everywhere.** The ask said they "stay only
  where the mod can't see the member". The mod cannot judge a waiting member:
  its report closes the window, and only the member knows whether its run
  moves. Removing the timers would lose the only stall check for it. Taken:
  keep them, which is also cheaper to reverse. This departs from the ask, for
  the owner.
- **A waiting member can still be noted.** A lead's send to it (a check, a
  relayed note) opens a new window. The skill's bullet sends the lead back to
  the check rules for it, at the cost of one extra lead turn.
- **Noise against a missed stop.** A reload forgets reports, so a member that
  reported before a reload, and whose card the lead left `working`, can get
  one note. A note queued while the lead is busy can land after the member's
  report. Taken: an extra note over a missed stop.
- **Pane closed.** No watch and no subscription; one line to the owner.
  Taken for the owner's ask over full coverage; reversing it is one bullet.
- **Grace period.** 2 minutes. Shorter adds notes for a member about to
  report; longer delays a real stop.
- **A row time far ahead of the clock** (an `updatedAt` more than 2 minutes
  ahead) holds its note back until the clock catches up. Not guarded: an
  accepted-risk candidate under the Hardening limit.

## S10. Out of scope

- A member on another machine, or a cloud session: the mod has no row for it,
  as the idle notice had none.
- A member stuck at a permission prompt shows `waiting`, never `idle`; the
  pane already moves that card to "Waiting on you".

## S11. Build order

0. Probe, done before revision 2: one delivered wrapper and the session files
   (S3.2, S4 step 3). Stop condition: if `from-name` stopped matching the
   session file's `name`, stop and redesign the report match.
1. `quiet.ts` and its node test (C1 to C7), test first.
2. The hooks in `register.tsx` and the engine cases (C8). Stay out of
   `view.ts` and the to-do and history rows another session is changing.
3. Contract, homes, evals, README, glossary (C9).
4. `docs/security/brigade.md`, version, `docs/spec/README.md` line.
5. `athanor run check` and `athanor run plugin-test` (C10).

## S12. Needs the owner

- **The merge.** At Deploy, after the Test rounds.
- **Confirming contract 2.16.0.** It goes in *Proposed*; any time after merge.
- **Running the five edited evals.** Eval spend needs the owner's word, which
  no level lifts. Recommended: once, at Test, since only a run shows the lead
  asks the member rather than relaying the note to the owner. Until then they
  are edited and not run.
- **The live check, C11.** At the first lead session after installing from
  `main`.
- **The waiting-timer departure** (S9, first point) and the security reading
  (S6): at Test, with the security pair's report.
