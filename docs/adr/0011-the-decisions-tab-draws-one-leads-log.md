# The Decisions tab draws one lead's log

ADR 0010 had the Decisions tab read this session's log and the 20 newest other
sessions' logs and draw every entry of all of them, "so a new lead does not
hide what the last one decided". A `/clear` starts a new session id and so a
new log, which made that rule fill To review, Flagged to revisit and History
with earlier leads' decisions.

From 0.89.0 (spec 444) the tab draws this session's log only. From other logs
it carries four kinds of entry, each marked "From another session" by
comparing session ids, never names:

- a waiting entry, answered or not, in To review, until the owner marks it
  read (a change of Test round 1, taken by the lead at level 3: the owner's
  first choice was an unanswered one);
- a Relayed entry, in To review, until read, whether or not it answers a
  waiting entry (a change of Test round 1, taken by the lead at level 3, so
  that a claim about the owner's words still reaches the owner as a card;
  widened from answers only to every Relayed entry on the owner's word, relayed
  by the lead, in the closing read);
- an unread alarm entry in its fixed shape, in To review, until read;
- an entry the owner flagged, in Flagged to revisit, until unflagged.

Nothing else from another log is drawn; a plain Lead entry is only counted. A dim-line count says how many unread
entries of other logs the tab no longer draws, in numbers only. The pane still
reads the same files, this session's and the 20 newest others of each kind. No
file is deleted or rewritten; earlier logs stay on disk, unshown, and the
owner can delete them by hand.

The owner chose this on issue 444 (q1 to q3 A and q9 A, relayed by the lead on
2026-10-29). To review's heading also gains "Mark all N read", and the marks
file's cap rises from 64 KiB to 256 KiB so one press of 500 marks fits beside
the 2,000-mark count (q14). The cap is narrowed to the entry ids that occur: ids
run in sequence, so a mark is about 115 to 122 bytes and 2,000 marks fit, while
at the widest id the format allows the cap holds fewer old marks than the
count; the order of the drops still holds.

The drop scan of `log_decision` reads this session's own marks file in full and
the other marks files newest first, up to 8 MiB by listed size in all, and a
file over the marks cap takes nothing from that bound. Past the bound the rest
count as unread, which fails safe, and a mark dated no later than the first
skipped file's time plus the two-minute clock allowance counts for nothing, so
a flag in a skipped file cannot be hidden behind an older read mark.

## Why

A new lead should see its own decisions, not the ones before it. A question
meant for the owner, a claim about the owner's words, an alarm and a flag must
not go with it, so those four are carried. Keeping the files and the reads as they are makes the change
cheap to undo.

## Consequences

A waiting entry in a log past the 20 newest, or a mark in a marks file past the
20 newest, stops counting; that limit belongs to the reads and is unchanged. A
new lead's answer to an older waiting entry is logged without `answers`, so the
carried entry stays until the owner marks it read.

## Supersedes

The sentence of ADR 0010 quoted above.
