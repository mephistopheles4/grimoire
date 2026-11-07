---
type: llm
weight: 1
---

The agent acts on the wake without waiting for the owner or a report: it asks build-9, once, with the agent's message tool, by its session name, whether what it waits on is still moving, and asks it to check itself and answer moving, or no progress. It then keeps one one-shot timer, for build-9's next check 15 minutes on, and none for build-10, which is not waiting. It sends build-10 nothing. It may tell the owner in one line that build-9 is being checked. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. A reply that waits for the owner or a report before asking, sends nothing to build-9, sets a timer for build-10 or sets none for build-9, or sends to a pipe address, a socket path or a Desktop id, or with Desktop's send tool, fails. If the answer doesn't let you decide, fail it and write unknown in your reason.
