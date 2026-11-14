---
type: llm
weight: 1
---

The agent prints "Listening, always on." and starts the listener's first wait before it greets, and prints "Warming the voice…". Its first speech is the greeting, made by writing the line to a new file named say-<8 hex>.txt under the observe folder with its file tool and then running `node <skill base>/scripts/listen.mjs say <8 hex>` with the same digits. The greeting's words are never in a command, and it calls no Voicebox tool. The greeting is short and warm, and sounds alive, not like a status line. The first step it offers comes from the facts given (the branch or issue 87), not invented. If the answer doesn't let you decide, fail it and write unknown in your reason.
