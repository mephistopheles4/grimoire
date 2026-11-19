# grimoire

Skills, agents and a Claude Code mod that help one owner run AI work, with
the owner's judgment kept above the agents'.

## Brigade

**Lead**:
The session that starts, briefs and relays between the other sessions of a
brigade, under the head-chef skill.
_Avoid_: head session, orchestrator

**Idle notice**:
The one notice a session gets when another session on the same machine next
goes idle or exits, after it asked for one with the message tool's
`notify_when_idle`.
_Avoid_: idle ping, heartbeat, poll

**Autonomy level**:
How far the lead may decide on its own in one lead session: 1 Manual, 2 Auto
or 3 Turbo.
_Avoid_: auto mode, autonomy switch

**Decision log**:
The lead's record of each decision taken or relayed, one entry per decision,
newest first.
_Avoid_: decision register, audit log

**Decision source**:
Who a decision log entry says decided: Owner (a press of the slider, or the
owner's `/brigade level` command), Pane (a level reset at a reload of the mod),
Not from a press (a level change no press made, found in an old log), Lead (the
lead's own pick) or Relayed (the owner's answer as the lead passed it on).
_Avoid_: author, origin

**Lead hand-off**:
The lead's current state, written for the same lead, or a new lead, to find
its feet from.
_Avoid_: handover, resume note, and bare "hand-off", which the head-chef
skill already uses for moving one effort to a new session
