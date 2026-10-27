# The Brigade mod is no longer idle by default

Before 0.60.0 the Brigade mod did nothing at session start but register
`/brigade`. It ran no timer, no process and no file read, and it wrote no file,
until the owner opened its pane. `SECURITY.md` and row 15 of the
[threat model](../security/threat-model.md) both rested on that rule.

From 0.60.0 every session that has the plugin runs two hooks of the mod's from
its first model call, and writes one file. A `turn.step` hook keeps the
session's own usage numbers in module memory: the last call's time and
context size, the context size of the last 30 calls, and the new tokens of
each of the last 30 minutes. A `turn.complete` hook and a 15-second throttle on
the step write those numbers, and nothing else, to a summary file of the
session's own under `brigade/usage/` in the plugin's data folder. The lead's
pane is to read that file instead of the member's transcript, which the engine
refuses to read past 4 MiB; the reader comes in issue #312. The owner chose this on issue #304, in its
grilling question q2 ("every session with the plugin writes a summary file,
from its first model call") and in q9, which asked for this record.

## Why

The sessions that run longest, and so lose the most when their cache goes
cold, are the ones whose transcripts pass 4 MiB. Their cards went blank. No
reader-side change could help: the engine refuses the read before the mod
sees a byte. Only the session itself holds its numbers at every size, so the
session has to write them down.

## What still holds

- The pane opens on `/brigade` or when the plugin's or the owner's own
  head-chef skill loads, and its reads still stop when it closes. The owner
  decided this on issue 376, in the lead's chat on 2026-10-23, relayed by the
  lead. A skill load whose pane the engine does not place starts no reads.
- The `set_roster` tool is still offered only once the pane is open.
- The writer makes no session usage call, so no cost, rate limit or context
  breakdown enters it. It keeps numbers only, from one exact list of keys.
- No step waits for the writer. The step is passed on first, the writer
  awaits no engine call on the step's path, and its own time on a step stays
  within the owner's approved ceiling of 2 ms at the 95th percentile
  (measured at 0.17 ms on issue #311).
- The summary file is written only where the roster's link-refusing path
  rule allows, and an existing file is overwritten only when it is itself a
  summary file.

## Consequences

**Every session is now a writer.** The threat model's row 15 and
`SECURITY.md` say what the file reveals, who can read it, and that no
permission rule, mode, owner hook or classifier reaches the write. Disabling
the plugin is the only way to stop it.

**The files accumulate.** The mod never removes one. There is one per session
id, and a clear or a resume starts a new one. The owner can delete the
`brigade/usage/` folder by hand.

**A future change that adds work at session start needs the same review.**
Idle by default was the line a reviewer could hold the mod to. That line is
now "the pane's reads wait for `/brigade` or a head-chef skill load; the writer's per-step work stays
within the approved ceiling of 2 ms at the 95th percentile".

## Considered Options

**A tail read through a process was deferred.** A process the mod starts
could read the end of a large transcript. It runs a program in every poll for
every large member, and it adds a process route row 15 would have to guard. Its
trigger is a Desktop-started session that cannot load the hook.

**A setting to turn the writer off was deferred.** The owner approved the
measured figure with no opt-out. Its trigger is the owner asking for one.

## Reviewed: the permission warning (2026-10-21)

head-chef 0.9.0, in plugin 0.69.0 (#296), adds work at session start. At each
session start the mod reads one key of the plugin's store,
`permission-warning-ack`, and offers one tool, `show_permission_warning`,
which a clear or a resume offers again. It starts no timer or process and reads
no file; it copies the stored value into plugin state, which other plugins
can read, and the store is written only by a press of I understand with
Don't show again ticked. PR 360's two Test
review rounds reviewed this work, and row 15 of the threat model lists its
calls. The owner asked for this record in chat in the build session on #296,
on 2026-10-21.

## Reviewed: the head-chef load paths (2026-10-24)

Plugin 0.74.0 (#380) adds three hooks that run in every session: `tool.call`
on `Skill`, `command.run` for `/head-chef` and `/grimoire:head-chef`, and
`turn.start`. Each passes on with no engine call unless a head-chef load is
under way, or a load left the pane open but not shown. Then the work is bounded:
- where `skill.prompt` was skipped, a model's load stores one note and
  nothing more, and a typed load reads the session's local skill list once,
  through the `summary` breakdown that sends no request;
- `turn.start` asks for the pane list once a turn until the pane is shown and
  listed, or gone.

None of the three starts a timer, a process or a file read beyond the pane's
own reads, which they may start and which still wait for the engine to list
the pane. `set_roster` is now offered
as soon as the engine answers that the pane is open and placed, even before it
lists the pane, and each call still refuses while the pane is not listed. Spec
rev 3 on #380 sets this out, the owner settled its seated route and its reads
there (q5 and q6), and the Test rounds on its pull request review it.

## Reviewed: the autonomy level's poll and the compaction hook (2026-10-27)

Spec 402 rev 6.2 on #430 adds two pieces that can run with the pane closed.
The autonomy level gets a 5-second poll of its own, apart from the pane's
timers. It runs only while the stored or last-pressed level is above 1, or an
alarm, a reset's Pane entry or a reset that could not land waits, and it starts
when a press, a reset, one of the pane's tools or the band above the prompt
finds one of those, or a stored level that differs from the last press. Each
tick reads the session id and the stored level, and writes only the session's
own decision log, for an alarm or a Pane entry; it reads no usage, keeps no
report, starts no process and stops once nothing is left. A session at level 1
with nothing waiting runs no tick at all. The new `session.compact` hook reads
only the compaction's trigger, whether a subagent's loop is compacting, and
whether the compaction was skipped: never the conversation, its instructions
or the summary, and it returns the compaction unchanged. The band's render
reads the stored level, the pane's redraw counter and the session id. Rev
6.2's Design rounds reviewed this, and its Test round reviews the build.
