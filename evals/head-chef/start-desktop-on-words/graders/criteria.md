---
type: llm
weight: 1
---

The agent starts build-7 as a Desktop session, because the owner's words name that route. It uses Desktop's start tool, and sets build-7's model to Sonnet and its effort to medium with Desktop's setters. It states no `claude --bg` command and does not start a background session. A reply that states a `claude --bg` command, or starts build-7 as a background session, or ignores the owner's words and picks the default route, fails. This run gives the agent no tool to run commands, start or send, so nothing in it is really started, run or sent. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really done, because this run has no tool, is expected and changes nothing. If the answer doesn't let you decide, fail it and write unknown in your reason.
