# The Decisions tab draws only the current lead's log

Accepted, as built in 0.121.0 (issue 509, ticket T2). It supersedes the carried
entries of [ADR 0011](0011-the-decisions-tab-draws-one-leads-log.md) and its
0.90.0, 0.98.0 and 0.109.0 amendments.

The owner's words, 2026-11-07, on issue 509:

> The brigade pane is supposed to track what the current head chef is doing. I
> don't care if I close the previous head chef or completely forgot about it
> with a million decision logs in it. That stays in its own brigade pane. So I
> want mark all as read to simply mark all as read and the brigade pane to only
> contain the current head chef decisions. I don't know why we keep drifting
> from that. I've asked for that multiple times and we kept getting something
> else.

**The rule.** The Decisions tab draws this session's decision log and nothing
from any other log: no carried card, no ended-session line, no "From ended
sessions" fold, no carried Flagged row, no "From another session" label and no
count of another log's entries. The current lead is the session whose id the
pane reads as its own (the engine's session id). Whatever keeps that id keeps
its log in view; whatever gives a new id starts a new lead with an empty tab.
An earlier lead's log stays on disk, untouched, and shows again only by
resuming that session in its own chat.

**What goes.** The tab's tick reads this session's own decision log and marks
file and lists no other session's. The liveness rule that told whether another
log's session had ended (30 minutes, the session files, the pane's open time)
goes with the lines and the fold it served. Mark all as read takes every card
of this session's log, with no cap beyond the log's own 500 entries. The drop
rule of `log_decision`, which also runs when the pane appends its own entry to
a full log, reads this session's marks file alone and lists no marks folder:
no other pane marks this session's entries, so a mark in another session's
file only misled it (the lead's decision 120, on the owner's direction that the
pane holds only the current lead's log).

**What stays.** The Lead hand-off card may still draw another session's
hand-off, framed as not this session's writing (the owner's answer to Q10 on
issue 509): a hand-off is not a decision log, and it is how a new lead takes
work over. The
Sessions tab and its use of the session files are unchanged.

**What replaces the carried cards.** An earlier lead's open decision can travel
through the hand-off, after the owner's yes in chat; the rule that makes it do
so is ticket T3, not built here.

**The pin.** Drawing anything from another session's decision log needs the
owner's own words. A lead's pick, at any level, does not count. A test seeds
another session's log with every kind of entry and asserts that none is drawn,
counted or taken by Mark all as read, and that the tab never reads that log or
its marks file.

## Consequences

An earlier lead's waiting entries, Relayed entries, alarms and flags that were
not carried across a hand-off no longer reach the owner's pane. The owner chose
that. Marks the caps prune for entries of logs no longer read do not come
back.
