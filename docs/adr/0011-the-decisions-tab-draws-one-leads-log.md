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
entries of other logs the tab no longer draws, in numbers only.

Amended in 0.90.0 (spec 447): when the pane can tell that a log's session has
ended, To review no longer carries that log's unread Relayed entries, nor the
waiting entries they answer, as cards. It shows one line for each such
session instead, counting them, with one press that marks them read, and the
dim line no longer counts what a line counts. Those entries, read or not, are
the one exception to the rule above: they are drawn as rows of a fold in
History, "From ended sessions". That fold draws entries the owner has already
read, which no view drew from another log before, and it draws from every
working folder's logs among the 20 newest, since the pane reads logs with no
working-folder filter. A session is running while a file in the live poll's
last session read names it or its log has an entry from the last 30 minutes,
ended when a complete read since the pane opened names it nowhere and its
newest entry is older than that, and unknown otherwise; in the unknown state
every log draws as above. The owner chose the line and its press on issue 447
(q4 A and q6 A, relayed by the lead); the fold and the 30 minutes are the
lead's picks under level 3. The pane still
reads the same files, this session's and the 20 newest others of each kind. No
file is deleted or rewritten; earlier logs stay on disk, unshown, and the
owner can delete them by hand.

Amended in 0.91.0 (spec 448): in this session's own log, a waiting entry and
the Relayed entry that answers it, both unread, draw in To review as one card
at the waiting entry's place. The card shows the question, then every field
the answer's own card drew, and one Read, next marks both read in one write.
A claim about the owner's words still reaches the owner as a card: this card.
A press acts only when its card is still the one shown with the same entries.
A pair carried from another log still draws as two cards.

Also amended in 0.91.0 (spec 448, q1 A, the lead's pick under level 3; it
merges only on the owner's own word on q2): To review's heading gains "Mark N
relayed read", which marks this session's own unread Relayed entries that
answer no waiting entry read in one write. Each such claim still reaches To
review as a card and is counted in the press's label; the press marks it from
there, whether or not its card was opened. A question and the answer the log
links to it never leave by this press; an answer logged without that link, to
a waiting entry in another session's log, counts as a claim and does. A mark from it records the press, not a reading, and a
claim it marks stays in History only until its log's cap drops it.

Amended in 0.98.0 (issue 466, the owner's words relayed by the lead on
2026-10-31: "One button that clears everything."): Mark N relayed read goes,
and so does each ended session's line's own "Mark these N read" (the owner's
words again, relayed: "One button that clears everything."); "Mark all N read" marks everything under To review read in one write, of
every kind and from every log, ended sessions' lines included, up to 500 a
press. A mark leaves the log as it is, so a question marked read still pairs
with an answer logged later.

Amended in 0.109.0 (issue 486, decision 382, the owner's words relayed by the
lead on 2026-10-31): Mark all N read leaves this session's own waiting entries
that no Relayed entry answers, so each stays in To review until it is answered
or a single Read press closes it. Entries in other logs drop on read as before.

Amended in 0.113.0 (issue 496, lead decision 510, the owner's words relayed): the button's N counts the cards a press clears, a question and its answer as one, so it matches what leaves To review; when cards stay behind it reads "Mark N of M read", M every card under To review.

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

Amended in 0.112.0 (issue 497): the pane's own Owner, Pane and alarm entries take the same drop scan when the byte cap refuses them, so a log `log_decision` keeps full still takes a raise. When this session's own marks file is dated ahead, over its cap or fails its check, the scan takes no mark at all and nothing drops, so a flag only that file holds never loses to an older read mark in another.

## Why

A new lead should see its own decisions, not the ones before it. A question
meant for the owner, a claim about the owner's words, an alarm and a flag must
not go with it, so those four are carried. Keeping the files and the reads as they are makes the change
cheap to undo.

The 0.90.0 amendment: carried as a card each, the Relayed entries of ended
sessions made To review too full to use (135 cards on the owner's first look
after 0.89.0). A false claim does most of its harm before its writer ends, so
an ended session's claims fold into one counted line rather than leave the
owner's sight, and each stays readable in the fold. The rule writes nothing,
so a session that runs again gets its cards back at the next draw.

The 0.91.0 amendment: the running lead's own log held 39 unread Relayed
entries and 25 unread waiting entries, 16 of them answered, on the owner's
machine during issue 447's Design round. A question and its answer read together
halves the presses for each answered question, and the answer is still drawn
in full on a card. Mark N relayed read clears the rest of the lead's own
claims, about 23 of the 39, which record words the owner typed in the lead's
own chat or picks one reply accepted there; a forged claim of that kind is
the cost, which q2 puts to the owner.

## Consequences

A waiting entry in a log past the 20 newest, or a mark in a marks file past the
20 newest, stops counting; that limit belongs to the reads and is unchanged. A
new lead's answer to an older waiting entry is logged without `answers`, so the
carried entry stays until the owner marks it read.

## Supersedes

The sentence of ADR 0010 quoted above.
