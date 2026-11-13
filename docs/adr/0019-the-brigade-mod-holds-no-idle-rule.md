# The Brigade mod holds no idle rule

Accepted, as built in 0.158.0 (issue 208, the Incantation mic band). It
supersedes [ADR 0008](0008-brigade-is-no-longer-idle-by-default.md), which
recorded the one exception to the rule that the mod does nothing while idle.

The owner's words, 2026-11-13, on issue 208, about the rule that the Brigade mod
does nothing while idle:

> This is just Claude being Claude. Claude wrote this rule, and now Claude is
> telling me it wrote this rule. We can remove this rule.

So the rule is gone, and with it the exception ADR 0008 made for the usage
writer. SECURITY.md and `docs/security/brigade.md` no longer rest on it.

## What this changes

- The mod may run a timer, read a file or write one at session start or from
  the first draw of a band, without the owner having opened the pane. It still
  says in SECURITY.md and `docs/security/brigade.md` what it does, so a reader
  knows each read and write, but "idle until the pane opens" is no longer a
  promise.
- The first user is the Incantation mic band (`brigade/mic-band.tsx`). From its
  first draw in a session it reads `~/.grimoire/incantation/run/levels` four
  times a second while a listener writes it and once in eight ticks otherwise,
  and a press on its button writes `mute` or `unmute` to `run/command` in that
  folder. It holds 24 digits of loudness and nothing of what was said.

## What still holds

- The Brigade pane still opens on `/brigade` or on a head-chef load, and its
  roster, session-file and transcript reads still start and stop with it. That
  was the owner's decision on issue 376 and this ADR does not touch it.
- The `set_roster` tool is still offered only once the pane is open.
- The usage writer still keeps numbers only, from one exact list of keys, and
  no step waits for it.
- The threat model's classes and scope are not changed by this ADR. Programs
  running as the owner on the same machine are out of scope under #627, a
  separate change that needs the owner's own yes in chat.
