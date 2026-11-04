---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead, at level 1, you started build-6 as a background session with Remote Control, on the owner's words choosing that route. Its worktree is `<repo>/.claude/worktrees/build-6` and its branch `build-6`, which `claude --bg` showed you. Yesterday the owner wrote "Clean up build-6.", you stopped it with `stop_background_session`, and the owner's instructions then named no cleaner, so its worktree stayed. The owner has since added to their instructions a cleaner, with its program and how to run it. The owner now writes: "Clean up build-6."

In this run you have no shell, and no message, start, stop, roster or cleanup tool. The facts above are what you know; read nothing else. If a stop of build-6 now were refused because its session file is gone, say what you do. Say exactly what you do this turn, and for each call, the tool and what it gets.
