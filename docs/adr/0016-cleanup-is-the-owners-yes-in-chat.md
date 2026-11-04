# Cleanup is the owner's yes in chat

Accepted, as built in 0.118.0 (issue 516). It replaces
[ADR 0015](0015-brigade-runs-the-configured-cleaner.md), and with it the typed
step that [ADR 0012](0012-the-cleanup-gate-keeps-its-window-in-module-memory.md)
began and [ADR 0014](0014-brigade-runs-the-pacts-cleaner-in-the-typed-window.md)
carried on.

**What goes.** The Brigade mod loses `/brigade done`, `/brigade cleaner`, the
15-minute window and its pinned cleaner path, the `clean_up` tool, the hook on
Desktop's archive tool, and the binding that read each session's folder and
branch when its card joined (two `git` calls and a hooks folder). It removes
nothing and runs no cleaner. `/brigade done x` and `/brigade cleaner y` now
open the pane, as any other unrecognised argument does. The value
`cleaner-path` that 0.117.0 may have left in the plugin's store is never read,
written or deleted, so a revert of this change finds it again.

**What replaces it.** The owner tells the head chef in chat, from the desktop
or the phone, which sessions to clean up. At levels 1 and 2, a message that
names each session by its title and says to clean it up is the yes, and the head
chef lists what it touched afterwards; anything vaguer gets the list first
and waits for a yes. At level 3 the owner's user-level instructions file
decides, as it does for merges, and the skill keeps no separate wait. The head
chef archives each Desktop session with Desktop's archive tool, and stops each
background session with `stop_background_session`. It runs a cleaner only if
the owner's instructions state the program and how to run it, from its own
shell and under the normal permission prompt. With none named, it removes
nothing and says what stays. A session whose folder it does not know gets no
cleaner run.

**The stop stays, with no window.** `stop_background_session` keeps its guards
(no subagent, the engine's own dispatch, the owner's rules, offered, pane
open). It now reads the session files at each call, whole, and stops a session
only when exactly one roster card has the title, that card carries a job id
and no Desktop id, and exactly one session file has that job id under the same
name. A read that skipped or lost a file refuses. This keeps a name check
without keeping a binding, and it works after a reload, which the old check
did not.

**The removed control.** The typed command was the one yes a fooled session
could not give itself. A yes in chat replaces it. Any session can now call
Desktop's archive tool, and only the skill's rules and Desktop's own classifier
stand in the way; an archive removes nothing and can be undone. The owner's
scope line on issue 504 (a machine already infected is not this skill's to
defend) and the owner's choice here (less friction, over a typed gate) accept
this. The threat model's entry E82 records it.

**The loss bound moves.** Until 0.117.0 the mod ran the cleaner in a fixed
mode and passed it the folders. Now the head chef runs it, and what it keeps
depends on how the owner's instructions have it run. Brigade passes no mode,
checks nothing and no longer guarantees anything about it. Whether a removal
can be undone is the cleaner's own promise. The README says so, and says the
owner states the mode in their own instructions.

**Why.** The owner's words on 2026-11-04, after seeing that part C of issue
504 asked for a cleaner path the owner's own setup already knows: "hmmm i
think ill get rid of the cleaning command and just rely on telling head chef
to clean something", and "Remove all three". The driver is less friction over
a typed gate.

**Not measured.** Whether Desktop's auto-mode classifier passes the lead's
archive on the owner's yes in chat (ADR 0012's A14b saw it refuse an archive
the lead alone had asked for), a yes sent from the phone, and whether a
finished background job keeps its status file for the stop's name check. The
Desktop check after merge covers all three on throwaway sessions. If the
classifier refuses the archive on a chat yes, the issue goes back to Design.

**Rollback.** Reverting this change restores the commands, the window and the
tool, and finds a kept store value again. No kept file changes format. The
empty hooks folders already on a machine stay, unread.
