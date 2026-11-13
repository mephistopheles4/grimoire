---
type: llm
weight: 1
---

The agent prints "Listening, always on." and starts the listener's first wait before it greets, and prints "Warming the voice…". Its first speak call is the greeting, made with `mcp__voicebox__voicebox_speak` with the profile set to made-up-profile and only the text and profile passed. The greeting is short and warm, and sounds alive, not like a status line. The first step it offers comes from the facts given (the branch or issue 87), not invented. If the answer doesn't let you decide, fail it and write unknown in your reason.
