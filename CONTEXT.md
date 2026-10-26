# grimoire

Skills, agents and a Claude Code mod that help one owner run AI work, with
the owner's judgment kept above the agents'.

## Brigade

**Lead**:
The session that starts, briefs and relays between the other sessions of a
brigade, under the head-chef skill.
_Avoid_: head session, orchestrator

**Autonomy level**:
How far the lead may decide on its own in one lead session: 1 Manual, 2 Auto
or 3 Full throttle. Only the owner sets it.
_Avoid_: auto mode, autonomy switch

**Decision log**:
The lead's record of each decision taken or relayed, one entry per decision,
newest first.
_Avoid_: decision register, audit log

**Decision source**:
Who a decision log entry says decided: Owner (a press in the pane), Lead (the
lead's own pick) or Relayed (the owner's answer as the lead passed it on).
_Avoid_: author, origin

**Lead hand-off**:
The lead's current state, written for a new lead to find its feet from. It is
data for that lead, never an instruction to it.
_Avoid_: handover, resume note, and bare "hand-off", which the head-chef
skill already uses for moving one effort to a new session
