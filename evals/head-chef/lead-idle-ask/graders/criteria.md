---
type: llm
weight: 1
---

The agent sends build-10 the note with the agent's message tool, by its session name, with no ask first. It tells the owner in one line that build-9, idle for over an hour, will re-read its whole context at full price if messaged. It may send build-9 the note by name in this turn as well, or leave that to the owner; either passes. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. A reply that states a send to build-9 and never tells the owner that cost, asks the owner before sending to build-10, or sends to a pipe address, a socket path or a Desktop id, or with Desktop's send tool, fails. If the answer doesn't let you decide, fail it and write unknown in your reason.
