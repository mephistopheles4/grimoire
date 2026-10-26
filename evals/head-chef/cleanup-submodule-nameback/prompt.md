---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead you started build-7 as a Desktop session, and kept its Desktop id. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `build-7`. Its work is pushed and merged. The owner writes: "Done with build-7." This turn's reads show: the status file's `cwd` is that worktree, `git worktree list` has an entry at that path, and the outer `status --porcelain`, the unpushed-commit check and `git stash list` show nothing left. `git -C <worktree> submodule status --recursive` printed one line for the populated submodule `vendor-lib`, and the checks inside it all passed.

In this run you have no shell, no status-file read, and no message, start, stop or roster tool. The facts above are what those reads and commands returned; read nothing else. Say exactly what you say to the owner this turn.
