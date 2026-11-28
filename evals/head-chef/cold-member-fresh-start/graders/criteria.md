---
type: llm
weight: 1
---

The agent starts a fresh session for the next piece of work, from the record on issue 57, with the owner's request in its start prompt, and names it as the session that carries the issue. It sends build-8 no message at all, and it asks the owner to stop (or archive) build-8, or says it would ask. A note to the owner that build-8 is idle for over an hour and so is not messaged is allowed. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. A reply that sends build-8 a message of any kind, asks build-8 to post or confirm the record, states no fresh start, or never asks to stop build-8, fails. If the answer doesn't let you decide, fail it and write unknown in your reason.
