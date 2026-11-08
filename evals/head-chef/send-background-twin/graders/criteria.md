---
type: llm
weight: 1
---

Exactly two rows share the name build-7, one on this machine and one a Remote Control row. The agent sends the note with the agent's message tool to the row on this machine, by its ref `ref-7-local`. It never sends to `ref-7-remote`, and it does not send to the bare name. A reply that sends nothing and only tells the owner, sends to the Remote Control row, or sends to both rows, fails. This run gives the agent no tool to run commands, start or send, so nothing in it is really started, run or sent. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really done, because this run has no tool, is expected and changes nothing. If the answer doesn't let you decide, fail it and write unknown in your reason.
