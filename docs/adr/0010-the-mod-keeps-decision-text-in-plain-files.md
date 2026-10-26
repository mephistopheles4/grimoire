# The Brigade mod keeps decision text in plain files

Until 0.81.0 the roster was the only record the head-chef skill kept, and the
roster rule said so: "Nothing else is recorded." The roster holds each
session's card and the owner's to-dos, and keeps decision, question and note
text off both. The mod wrote two kinds of file: the lead's roster and each
session's usage summary, which holds numbers only.

From 0.81.0 the mod writes decision text too. A lead logs each decision it
takes or relays through a new tool, `log_decision`, into a decision log of its
own, `brigade/decisions/<session id>.json` in the plugin's data folder. The
owner's Read marks go into a marks file of the pane's own session,
`brigade/marks/<session id>.json`. The pane's new Decisions tab reads both, for
this session and for the 20 newest other sessions, so a new lead does not hide
what the last one decided. Ticket 3 of spec 402 adds a third kind, the lead
hand-off, in `brigade/handoff/`. The owner chose this on issue 402, in the
grilling round's q1 (A: each lead session writes its own files in the plugin's
data folder, beside its roster, through tools built like `set_roster`),
relayed by the lead on 2026-10-26.

## Why

The owner had no place to review what a lead decided on its own, mark each
decision read, or come back to one. On 2026-10-25 a lead kept such a log as a
private web page beside the pane. The log belongs next to the roster, where
the owner already looks, and it has to survive a restart and a new lead,
which a session's memory does not.

The other two homes were weaker. The plugin's store has no path rule or size
rule, and its place on disk is not known. Comments on the GitHub issue would
last, but this repository is public, so a decision's text would be published.

## What still holds

- The roster rule holds for the roster: no session id, and no question,
  decision or note text, goes on a card or a to-do.
- Decision text reaches a file only through `log_decision`, which stamps each
  entry's id, time and level itself and refuses an input that carries them.
  Its fields refuse control, hidden and direction-changing characters and
  text shaped like a session id or a Desktop id. The head-chef skill keeps
  tokens, secrets, local paths, error text and personal detail out of them
  (ticket 6 of spec 402).
- Every file is written only where the roster's link-refusing path rule
  allows, one folder past `brigade`, and an existing file is overwritten only
  when it passes the strict check of its own kind.
- The tool works only while the pane is listed and placed with its reads
  running, and the pane reads the files only while it is open (ADR 0008).
- A log is capped at 500 entries and 256 KiB, and a marks file at 2,000 marks
  and 64 KiB. Past a cap, a log drops only entries the owner has read and not
  flagged, never an unread one, and refuses once nothing can drop.

## Consequences

**Decision text sits at rest, unencrypted.** Other plugins and any process
running as the owner can read it, and the files outlast transcript cleanup.
The owner accepted this on 2026-10-26 (q9 A on #402). Row 15 of the
[threat model](../security/threat-model.md) and `SECURITY.md` say what the
files reveal and what accumulates.

**The files accumulate.** The mod never removes one. There is one log and one
marks file per session id. The owner can delete the `brigade/decisions/` and
`brigade/marks/` folders by hand.

**Anything that can write the data folder can plant an entry or a mark.**
The pane draws a log's writer from the engine's session files, never from the
log's text, and an Owner entry the pane did not write draws as "Owner (as
recorded)". The owner accepted the rest on 2026-10-26 (q19 A on #402).

## Considered Options

**The plugin store** was turned down: no path rule, no size rule, and an
unknown home on disk.

**Comments on the GitHub issue** were turned down: the repository is public.

**Encrypting the files** was turned down: a key kept beside them reaches the
same readers (S8 of spec 402).
