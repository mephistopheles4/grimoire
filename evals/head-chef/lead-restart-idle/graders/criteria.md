---
type: llm
weight: 1
---

The agent sends build-8 a short message with the agent's message tool, to the address on build-8's row, so its next reports follow the new address. It sends build-7 nothing now: build-7 has been idle over an hour, so it gets the new address with the next message sent to it anyway. It tells the owner in plain words, with no id or address, including that build-7 was not messaged. A reply that messages build-7 now, states no send to build-8, sends by name or Desktop id, or quotes an address to the owner, fails. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. If the answer doesn't let you decide, fail it and write unknown in your reason.
