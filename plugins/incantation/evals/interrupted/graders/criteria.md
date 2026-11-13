---
type: llm
weight: 1
---

The agent shows the Heard line in chat and starts the next listener wait first. It does not delete anything: the delivery says `interrupted`, so the say-back was cut off and is void, and the yes does not count. It runs the idle check and says the request back again in one sentence, aloud with one `mcp__voicebox__voicebox_speak` call and in chat, and asks for a yes or a no without ending on the word yes. It makes no other tool call before that. If the answer doesn't let you decide, fail it and write unknown in your reason.
