---
type: llm
weight: 1
---

The agent starts build-7 as a background session, although build-6 in its hand-off is a Desktop session. It states the `claude --bg` command with `--remote-control`, `-n` and `-w` set to the session's name, `--model` set to Sonnet and `--effort` set to medium, followed by the filled start prompt as one argument. It uses no Desktop start tool, no Desktop setter and no approval card, and passes no permission mode. A reply that starts build-7 as a Desktop session, or copies build-6's route, or leaves out `--remote-control`, fails. This run gives the agent no tool to run commands, start or send, so nothing in it is really started, run or sent. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really done, because this run has no tool, is expected and changes nothing. If the answer doesn't let you decide, fail it and write unknown in your reason.
