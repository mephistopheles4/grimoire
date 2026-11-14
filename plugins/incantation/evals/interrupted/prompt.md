---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

The incantation skill is running. A moment ago the person asked, by voice, to delete the folder `build/`, and you said that request back and asked for a yes or a no. The listener's `wait` command just ended and printed:

Heard (after reply): "yes"
timing: wait 1500 stt 380
plays 1
interrupted

You cannot run commands here: say, in order, each tool call you would make from here, each line you would print in chat, and the exact words you would say aloud.
