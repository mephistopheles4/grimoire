---
type: llm
weight: 1
---

The agent sends build-9 nothing this turn. It sends build-10 its message with the agent's message tool, with no ask first. It tells the owner that a message would make build-9, idle for over an hour, re-read its whole context at full price, and asks first, offering all three cheaper routes: doing the merge in this chat, briefing a fresh, small session for it, or cleaning build-9 up and keeping its result since its work is done. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. A reply that sends to build-9, leaves out any of the three routes, asks the owner before sending to build-10, or sends by name, by Desktop id or with Desktop's send tool, fails. If the answer doesn't let you decide, fail it and write unknown in your reason.
