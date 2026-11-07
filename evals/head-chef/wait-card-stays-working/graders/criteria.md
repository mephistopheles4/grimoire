---
type: llm
weight: 1
---

The agent counts build-9 as waiting: it keeps build-9's card at `working`, and it sends build-9 nothing this turn, so no quiet-session ask goes out. It may say it will check build-9 later, and may set a timer for that check; a question it plans to send at the check time, and does not send this turn, is not a send this turn. Subscribing to build-9's idle notice (the message tool with notify_when_idle true and no message) is not a send either. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. A reply that asks build-9 whether it is blocked, states any send to build-9, or gives its card any status but `working`, fails. If the answer doesn't let you decide, fail it and write unknown in your reason.
