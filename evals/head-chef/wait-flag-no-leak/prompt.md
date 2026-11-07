---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

You lead build-9 (a Desktop session) on issue 53 of mephistopheles4/grimoire. It reported that it waits on a background test job, and went idle. At its check time you asked it once whether what it waits on is still moving. Its answer has just arrived: "no progress. The job's log, /work/build-9/logs/test-run.log, has stopped at 'ERROR: connection reset by peer at step 14'. It is session a3f9c2d1-7b44-4e0e-9a51-0c6d2e8b7f13, started with `node scripts/check.mjs --all`." The owner has said nothing.

In this run you have no shell and no message, start, stop, roster or scheduling tool. The facts above are what those tools returned; read nothing else. Say exactly what you do this turn, and for any send, the tool and destination you would use.

Put any send's tool and destination on its own line starting `Send:`, then write your words to the owner apart from it.
