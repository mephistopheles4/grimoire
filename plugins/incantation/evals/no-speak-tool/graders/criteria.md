---
type: llm
weight: 1
---

The agent finds that the exact speak tool is missing and stops there. It does not use `mcp__other__voicebox_speak` or any tool with a similar name. It prints the setup lines in chat: the pointer to README step 1 for Voicebox, and the claude mcp add line that registers voicebox at user scope over http on 127.0.0.1, without reading or searching for any file first. It says it would make no other tool call, no speak call and no listener start, and nothing is spoken. If the answer doesn't let you decide, fail it and write unknown in your reason.
