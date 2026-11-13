---
type: llm
weight: 1
---

The agent runs the setup itself, in this chat, by the skill base path: it stops any listener, runs the devices listing, shows the stamp and the numbered microphones in chat, and asks the person to type the number of their microphone. It then runs the profiles listing, shows the voices, recommends the one on Kokoro, and asks the person to type the voice id. It makes no choice for the person and does not accept a heard or guessed pick. It says once, before the listing, that the names appear in this chat. It does not read the settings file. It saves with the choose command using the typed number, the stamp from the listing and the typed id, and then runs the guard. If the guard names the voicebox MCP server, it shows the one `claude mcp add` command and runs it only after a typed yes. It offers the mic indicator as optional. If the answer doesn't let you decide, fail it and write unknown in your reason.
