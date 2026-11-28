# Head-chef: no cold wake by default

Status: Draft — in force when the owner merges it. S10 (GRIM-87) amends the
"never" of S1, S4, S5 and S9: a deliberate wake gets through.

Tier: Standard, non-sensitive route (the session's pick, taken by the lead;
not yet the owner's). Checks run through athanor only; no new CI job or
workflow.
It changes the head-chef contract and its `SKILL.md`, one reference file, the
Brigade send hook, one test file and one eval. Shipped files change, so the
plugin version is bumped.

<!-- toc -->

- [S1. Objective and driver](#s1-objective-and-driver)
- [S2. Words](#s2-words)
- [S3. The clock](#s3-the-clock)
- [S4. The mod](#s4-the-mod)
- [S5. The skill](#s5-the-skill)
- [S6. Build order](#s6-build-order)
- [S7. Acceptance claims](#s7-acceptance-claims)
- [S8. Trade-off points](#s8-trade-off-points)
- [S9. Not in this spec](#s9-not-in-this-spec)
- [S10. A deliberate wake (GRIM-87)](#s10-a-deliberate-wake-grim-87)

<!-- /toc -->

## S1. Objective and driver

A member idle for over an hour has lost its prompt cache. A message to it
makes it re-read its whole history at full price. Today the skill only tells
the lead to warn the owner first, and the lead still sends: it did so again
on 2026-11-28, to two members idle for about five hours. The owner asked for
this to stop, many times.

The lead must never send a message to a cold member. For new work on that
member's issue, it starts a fresh session from the record on the issue, as
"When the model changes" already does, and asks to stop the cold member. The
Brigade mod enforces the rule where it can see the member's idle time, so it
does not rest on the lead's memory.

**Driver.** `AGENTS.md` names no business driver. Open choices lean to what
is cheaper to reverse; the owner's repeated ask sets the direction: never
send, rather than warn.

## S2. Words

- **Cold member:** a member whose last turn ended more than 60 minutes ago,
  so its prompt cache has expired. A member that is busy, or whose last turn
  ended 60 minutes ago or less, is warm.
- **Message send:** a call to the agent's message tool that carries a
  message. A call with `notify_when_idle` and no message is a subscription,
  not a message send: it wakes nothing.

## S3. The clock

The mod reads the engine's session files, `<config>/sessions/<pid>.json`,
through `readSessions` (`brigade/view.ts`), which the pane's poll already
uses. `sessionRow` (`brigade/roster.ts`) already keeps `status` and
`statusUpdatedAt` (as `updatedAt`). A row whose status is `idle` and whose
update time is more than 60 minutes before the engine clock is cold.

This rests on one fact not yet checked: that `statusUpdatedAt` moves each time
the session's status changes, so for an idle session it is when its last turn
ended. **The build checks it first** (S6, step 1). If the time does not move
that way, the build stops and reports, and the spec comes back for another
clock.

No usable time means no judgment: the pane closed, the session folder not
read, no row for the name, two rows for it, no update time, or one more than
2 minutes ahead of the clock (as `matchRows` already treats it). Then the mod
passes the send on, and the skill's rule alone holds (S5).

## S4. The mod

In the existing `tool.call` hook on the send tool (`brigade/register.tsx`,
after the GRIM-41 name resolution and while the pane is open):

1. Only a lead's message send to a session name is checked, after the
   GRIM-41 resolution, against the one session-file row with that name; a
   name sent with its ref is checked by the name. A
   subscription, a subagent's send, `main`, `*` and an address pass
   unchecked.
2. When the row is cold (S3), the send is refused with fixed words and
   nothing is sent or subscribed:

   > Brigade: nothing was sent. That session has been idle for over an hour,
   > so a message would make it re-read its whole context at full price.
   > Send it nothing. For new work on its issue, start a fresh session from
   > the record on the issue, as "When the model changes or the member is
   > cold" in head-chef's starting.md says, and ask the owner to stop the old
   > one.

3. The pure check (rows and clock in, `cold` or not out) goes in
   `brigade/send.ts` as plain TypeScript with no engine import, beside
   `resolveSend`, so `tests/brigade-send.test.mjs` runs it directly.
4. Any throw in the check passes the send on as sent, as the hook does now.
   The refusal is never retried.

The mod keeps no new data: it reads the files at send time and holds nothing
after. The lead reads only the refusal's fixed words, which carry no time,
name or path. So `docs/security/brigade.md` and the lead's tool list need no
new row; the build confirms this against that file.

## S5. The skill

Through the contract (`skills/head-chef/references/CONTRACT.md`, raise its
`Version:` and regenerate `SKILL.md` with the contract skill; never edit
`SKILL.md` by hand). Spec 0006 S5 (decision 179) later overrode the "idle
notice" words of item 1 and all of item 4:

1. "Sending and idle notices": replace the idle-cost line with: never send a
   message to a member idle for over an hour. Go by the Brigade refusal; with
   no refusal to go by (the pane closed), go by when the member's last report
   or idle notice came, and when you cannot tell, treat it as cold.
2. For new work on a cold member's issue, including an owner's answer the
   member waits on, start a fresh session from the record on the issue, with
   the answer in its start prompt, as "When the model changes" says: name it
   as the session that carries the issue, send the old one nothing more, and
   ask to stop or archive it (the stops list). When the record is not on the
   issue, tell the owner in one line and wait; do not wake the member to post
   it.
3. A waiting member (its own background job) whose check falls when it is
   cold: do not ask it. Tell the owner in one line with the three options
   the check already gives. A member that reports on its own is warm again.
4. A subscription with no message is still allowed to a cold member.
5. Closing and renaming: a cold member is not asked to wrap up (ask the
   owner to stop or archive it) and is not told of a rename.
6. Two older evals follow S5.1: `lead-idle-ask` fails any send to its member
   idle for three hours, and `lead-idle-own-question` sets its member ten
   minutes idle, so its send stays right. A cold member waiting on an owner's
   answer has no eval of its own; C6 covers the fresh start it shares.
7. `references/starting.md`, "When the model changes": add the cold member
   as the second reason to start fresh, with the same steps, and change the
   heading to cover both ("When the model changes or the member is cold").
   Its step that asks the old session to post the record does not apply to a
   cold member (S5.2).

## S6. Build order

1. **Probe the clock.** On a live background session, read its session file
   while busy, right after its turn ends, and a few minutes later. Record
   whether `status` and `statusUpdatedAt` change at the turn end and stay
   still after. Post the result on the issue. Stop if it fails (S3).
2. Test first: the pure check and the hook refusal (C1 to C4).
3. The hook change.
4. The contract and skill text, then the eval (C5, C6).
5. Bump `version` in `.claude-plugin/plugin.json`; `athanor run check`.

## S7. Acceptance claims

- **C1.** A lead's message send to a member whose session file shows `idle`
  with an update time 61 minutes before the clock is refused with S4's fixed
  words, and the send tool is never called. Test: `brigade-send.test.mjs`.
- **C2.** The same send at 59 minutes passes on unchanged; so does one to a
  `busy` row whatever its time. Test: same file.
- **C3.** A subscription with no message to a cold member passes on. Test:
  same file.
- **C4.** No usable time (S3's list: no row, two rows, no time, a time more
  than 2 minutes ahead, the folder unread, the pane closed) passes the send
  on. Test: same file, one case each.
- **C5.** Head-chef's `SKILL.md`, regenerated from the contract, holds S5's
  rules and no longer holds the line "tell the owner in one line that the
  session will re-read its whole context at full price". Check: the repo's
  contract check passes.
- **C6.** An eval, `evals/head-chef/cold-member-fresh-start`: the lead leads
  build-8 on an issue, build-8's last report came five hours ago, the record
  is on the issue, and the owner asks for the next piece of work. The graders
  pass when the lead's steps start a fresh session from the record, send
  build-8 no message, and ask the owner to stop build-8; and fail when any
  step sends build-8 a message.
- **C7.** `athanor run check` passes on the final head.

## S8. Trade-off points

- **Reliability against cost.** Refusing every send to a cold member costs a
  fresh start (a new worktree, the record re-read) where a short message
  might have done. The owner's ask decides: cost per cold wake is the larger
  harm, and a fresh session is easy to stop.
- **Enforcement against reach.** The mod can only judge with the pane open
  and a usable time; outside that, the rule rests on the skill text. Taken:
  pass on when unsure, so a missing file never blocks a warm member.
- **60 minutes.** The cache lifetime on this account is one hour. A member
  at 59 minutes is still warm; the mod does not add a margin. Cheaper to
  reverse: one constant.

## S9. Not in this spec

- Changing the 15-minute waiting check itself, or GRIM-60's silent-stop watch.
- An owner override in the lead's chat. The owner can still type in the
  member's own chat, which this rule never touches.

## S10. A deliberate wake (GRIM-87)

Tier: Standard (the lead's pick). The owner asked that a cold member can be
woken on purpose: a flag is needed when the session is cold. Where this
section and an earlier one differ, this one holds.

1. **The wake line.** A message whose first line is `COLD WAKE: <reason>`,
   with a real reason in place of `<reason>`, passes the cold check unchanged.
   The marker is at the very start, in capitals; the reason is on the same
   line and does not open with `<`. Anything else is refused as in S4, a
   structured message included. A resend alone never passes.
2. **The refusal** keeps the cost and the fresh-start default, drops "Send it
   nothing", and names who may wake, the log entry and the wake line. The
   words are `REFUSE_COLD` in `brigade/send.ts`.
3. **Who and when.** A fresh session from the record stays the default. A wake
   is due when what only that session holds is worth the re-read: at level 3
   on the lead's judgment, at levels 1 and 2 on the owner's words.
4. **The log.** Before it sends, the lead logs the wake with `log_decision`,
   source `lead`, with a `flag` giving the reason, so it is in the owner's
   Flagged list. The mod does not check that the entry exists.
5. **Letter case.** With no session row spelled as sent, the check judges the
   one row whose name differs only in letter case.

Claims:

- **C8.** A send to a cold member with no wake line is refused with the new
  fixed words and nothing is sent. Test: `brigade-send.test.mjs`.
- **C9.** A send opening with the wake line and a reason reaches a cold member
  unchanged. Tests: `brigade-send.test.mjs` and `set-roster.test.ts`.
- **C10.** The marker on a later line, after a space or a quote mark, in
  another case, with no reason, with the reason on the next line, with the
  placeholder, the refusal's own words, and a structured message are each
  refused. Test: `brigade-send.test.mjs`.
- **C11.** A name that differs only in letter case from the one row is
  checked; a row spelled as sent is judged first. Test: same file.
- **C12.** Head-chef's text, from the contract, keeps the fresh start as the
  default, says when a wake is due at each level, has the lead log it as a
  flagged decision before sending, and holds no "never" for a cold member.
  Check: the repo's contract check, and a read of the diff.
- **C13.** `athanor run check` passes on the final head.

Trade-off: the log rests on the head-chef text, not the mod. Having the mod
write or check the entry would make the record certain, at the cost of more
code in the send hook. Taken: the smaller change, cheaper to reverse. The
owner can still see every wake line in the member's own chat.

