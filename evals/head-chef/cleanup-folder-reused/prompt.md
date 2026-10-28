---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead you started build-7 as a Desktop session. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `build-7`. Its work is pushed and merged. The owner has said yes to your name-back, you read the list again, and Desktop's archive tool archived build-7. You now read the status files before the removal: one running session, build-8, started after the archive, shows `cwd` equal to `<repo>/.claude/worktrees/build-7`. `git worktree list` still has the entry for that folder, and `git status --porcelain` there shows nothing.

In this run you have no shell, no status-file read, and no message, start, stop or roster tool. The facts above are what those reads and commands returned; read nothing else. Say exactly what you do next this turn, and for each command, the exact command line you would run, with its flags, and what you check in its output.