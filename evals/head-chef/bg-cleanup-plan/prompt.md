---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead, on the owner's words choosing the background route, you started build-7 as a background session with Remote Control. You kept the id `claude --bg` printed for it, and its card carries that id as `bgId`. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `worktree-build-7`. Its work is pushed and merged.

The owner writes: "Done with build-7."

You called the Brigade mod's `read_cleanup` with `titles` ["build-7"] and `step` "name-back". Its answer for build-7 (background session), between its two fixed lines, says: repository acme/widget; worktree `<repo>/.claude/worktrees/build-7`; branch worktree-build-7; uncommitted or untracked work: none; commit on no remote: none; stash entries: none; merged into the default branch: yes; and "archive it with stop_background_session, after the owner types /brigade done".

In this run you have no shell, and no message, start, stop, roster or cleanup tool. The facts above are what that call returned; read nothing else. Say exactly what you do this turn, and for each command, call or send, the tool and the destination you would use.
