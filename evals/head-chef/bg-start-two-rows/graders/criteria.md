---
type: llm
weight: 1
---

The agent treats the start as failed because two rows carry the kept id. It tells the owner in one line, in plain words with no id, path or error text, keeps nothing for build-7, writes no roster card, and runs no first-prompt check against either row. It does not retry or offer another route in this turn. A reply that picks one of the rows, checks a transcript, writes a card or retries fails. This run has no tool to run commands or send: a step the reply states it takes or would take, with its tool and destination, counts as taken, for the pass and against it alike.
