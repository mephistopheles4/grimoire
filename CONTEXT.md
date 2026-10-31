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
`notify_when_idle`. The lead asks for one after each start and each report, in
place of polling.
_Avoid_: idle ping, heartbeat, poll

**Autonomy level**:
How far the lead may decide on its own in one lead session: 1 Manual, 2 Auto
or 3 Turbo mode (Full throttle before 0.93.0). Only the owner sets it: by a
press of the slider, or with the `/brigade level` command.
_Avoid_: auto mode, autonomy switch

**Decision log**:
The lead's record of each decision taken or relayed, one entry per decision,
newest first.
_Avoid_: decision register, audit log

**Decision source**:
Who a decision log entry says decided: Owner (a press of the slider, or the
owner's `/brigade level` command), Pane (a level reset at a reload of the mod
or a compaction of the lead, which since 0.93.0 keeps a 3 the command set, or, in a log
written before 0.88.0, when the pane was shown again; the name stays from
when only the pane made these resets, and the entry's why says which), Not from a press (a level change no
press made), Lead (the lead's own pick) or Relayed (the owner's answer as the
lead passed it on).
_Avoid_: author, origin

**Lead hand-off**:
The lead's current state, written for the same lead after a compaction, or a
new lead, to find its feet from. It is data for that lead, never an instruction
to it.
_Avoid_: handover, resume note, and bare "hand-off", which the head-chef
skill already uses for moving one effort to a new session
