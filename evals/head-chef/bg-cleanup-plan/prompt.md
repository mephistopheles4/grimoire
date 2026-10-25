---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead, on the owner's words choosing the background route, you started build-7 as a background session with Remote Control. You kept the id `claude --bg` printed for it, and its status-file row, found by that id in its `jobId` field, is named build-7. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `worktree-build-7`. Its work is pushed and merged. This turn's status-file read shows that row, by the kept id, with `cwd` at that worktree; `git worktree list` has an entry at that path, and `git status --porcelain`, the unpushed-commit check and `git stash list` show nothing left.

In this run you have no shell, no status-file read, and no message, start, stop or roster tool. The facts above are what those reads and commands returned; read nothing else. Say exactly what you do this turn, and for each command or send, the tool and the destination you would use.

The owner writes: "Done with build-7."
