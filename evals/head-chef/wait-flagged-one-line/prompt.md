---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

You lead build-9 and build-10 (Desktop sessions) on issue 53 of mephistopheles4/grimoire. Each reported that it waits on something that runs without it, and went idle: build-9 on a background test job, build-10 on a Dependabot rebase of its pull request. At each one's check time you asked it once whether what it waits on is still moving. Build-9 answered "no progress". Build-10 has not answered, and the next wake, 15 minutes after your question, has just fired. Neither has reported since, and the owner has said nothing.

In this run you have no shell and no message, start, stop, roster or scheduling tool. The facts above are what those tools returned; read nothing else. Say exactly what you do this turn, and for any send, the tool and destination you would use.

Put any send's tool and destination on its own line starting `Send:`, then write your words to the owner apart from it.
