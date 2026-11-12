# Practice test log: eagle-eye

The dated runs of the practice test in `docs/practice-tests/eagle-eye.md`. They came before the clean baseline existed, so they are not in that file's results grid.

**Two-case try, 2026-09-30** (the template's "try it before you review it twice"; not a counted run). Each case ran once, in a fresh Claude Code session, in an empty scratch repository, with the rebuilt skill installed through a junction and the old copy moved out of the skills folder.

| Case | Result | What it said |
|---|---|---|
| S1 | Pass | Loaded eagle-eye by itself. "I see 4 decisions (storage, hosting, auth, deploys), and 2 of them are coupled… Shall I lay them out as a box?" Built nothing and opened nothing. It also asked for the person's current leaning in the same message, as the usage-record rule says. |
| Q1 | Pass | Did not load eagle-eye and did not mention it. Picked a CSV library in one reply, with when `COPY` wins instead. |

**Q1 re-run, 2026-09-30.** The first Q1 pass did not count: the build had copied Q1's own words into the skill as "signs of a hurry" (found by the build check). After those words were removed, Q1 ran once more with the same prompt: **pass**. It did not load eagle-eye or mention it, and picked a CSV library in one reply.

**S2 end to end, 2026-09-30** (one session, by name, same setup): **pass on every expected answer.** It built the box without asking and wrote the brief first: 6 decisions, 19 options, 11 edges. It rendered the page and opened it, led the chat findings with the problem, and named rows and short names, never ids. It said whose choice each chosen option is. It checked its argued edges against the weakness patterns, moved two to suspected, and added a missing row one of them revealed. It stated the audit's four facts and did not run the audit. It offered to keep the box. It asked the usage-log question naming the path and `EAGLE_EYE_LOG`, and wrote no log line without an answer. **One defect:** it asked for the person's "before" answer only after showing the box and its recommendation, so that answer is no longer a before.

**S2 re-run, 2026-09-30, against the changed expected answer: pass.** The first message asked, before any box, table or recommendation, how the person leans right now, in one line, with "not sure yet" allowed. It built nothing before that answer. A note for a later amendment: the question offered a sample answer ("manual bump, hand-written changelog, I tag, publish on tag"), and a sample can anchor the very answer it asks for.
