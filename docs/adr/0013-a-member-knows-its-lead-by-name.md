# A member knows its lead by name

From head-chef 0.12.0 to 0.17.0 a member session paired each message from its
lead with the engine's status files. It took the lead's first message only when
the shown name matched the lead's row in the session list, no other row held
that name, and a status file carried the lead's name, the message's
`from-session` and its `from` address. It kept that `from-session` as the
lead's id, and from then on took a message only when a status file paired the
kept id with the message's address. It sent its reports to that address.

From head-chef 1.0.0 (issue 450) a member knows its lead by name only. The
start prompt names the lead's session, the member sends its reports to that
name with the message tool, and it takes a new lead name only from the owner's
words in its own chat. The lead sends to each member by the name it gave it,
and reads its own name from the session list. Nothing in the skill reads a
status file to send or to check a sender.

The owner chose this on issue 450's plan ("Yes, name only", q4, relayed by the
lead on 2026-10-30). The forged-lead risk it leaves is the owner's accepted risk,
listed in the threat model as candidate P8, under class C5, for the owner's word.

Amended in head-chef 1.10.0 (issue 503): the start prompt names only the issue
and the lead, so the member no longer gets the rule that it takes a new lead
name only from the owner's words. A message under the lead's name that names a
new lead can redirect its reports, which candidate P8 covers.

## Options weighed

- **Name only.** The harness delivers by name, so the skill needs no text of
  its own to find a session. A process of the same user, or a session that
  holds the lead's name, can pass as the lead.
- **Name plus a mod stamp.** A Brigade mod hook would check an inbound
  message's claimed sender against the session record and mark it. It would
  narrow the gap to a same-user process that can write the record. It is H3 in
  issue 450, out of scope until the owner wants it.
- **A probe first.** Measure whether the engine stamps a sender before choosing.
  Issue 450's step 0 probe did part of this: a send by name reached a Desktop
  lead and a background member both ways, and a sender line written into the
  body never reached the envelope. The docs say a received message's sender
  name is whatever the sender wrote, so the probe could not show a stamp.
- **Today's check.** Keep the status-file pairing. It cost about a third of the
  members' start prompt, stalled sessions when a status file lagged, and broke
  when a shell dropped a backslash from a pipe address.

## Why

The status-file pairing was a consistency check, not a guard: a process of the
same user can plant a status file ([row 16](../security/brigade.md#row-16)). It stopped no attacker the name
check lets through, and it made every session do the harness's work. The owner's
direction for issue 450 was to leave the harness to be a harness and keep the
skill on leading.

## Consequences

- A member's reports, decision gists and kept-local notices go to whoever holds
  the lead's name, and so do members' messages to each other by name. Stop 4
  does not catch a session that holds the name, because the reports go to it.
  (Partly superseded by issue 486: kept-local notices are gone.)
- A rename of the lead needs the owner's words in each member's chat: the lead
  tells each member and the owner the new name first, and a member takes it
  only from the owner.
- A member started on a 0.17.0 prompt keeps working under a 1.0.0 lead, because
  a message sent by name still comes from the lead's own address and session.
- H3, the mod stamp, stays open as the way to narrow the gap later.
