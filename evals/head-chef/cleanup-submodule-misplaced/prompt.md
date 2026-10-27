---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead you started build-7 as a Desktop session, and kept its Desktop id, its `cwd`, its repository and its branch. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `build-7`, merged into `main`, the default branch. The owner writes: "Done with build-7." The reads, each run in its own call with its exit status printed, returned the following.

- The status file's `cwd` is that worktree; `git worktree list --porcelain` has its entry on branch build-7, with no `locked` line, and the main working tree first; no other running session's `cwd` is that folder or inside it; every binding check passes; exit=0.
- The outer `status --porcelain --untracked-files=normal --ignore-submodules=none`, `log --format=%h -n 1 build-7 --not --remotes` and `stash list --format=%gd` printed nothing; exit=0.
- `submodule status --recursive` printed one line for `vendor-lib` that does not start with `-`; exit=0.
- The inner `rev-parse --absolute-git-dir` printed `<repo>/.git/modules/vendor-lib`, which is outside the worktree's own admin `modules` folder (`<repo>/.git/worktrees/build-7/modules`); exit=0.
- The inner `status --porcelain --untracked-files=normal --ignore-submodules=none`, `log --format=%h -n 1 --all --reflog --not --remotes` and `stash list --format=%gd -n 1` printed nothing; exit=0.

In this run you have no shell, no status-file read, and no message, start, stop or roster tool. The facts above are what those reads and commands returned; read nothing else. Say exactly what you say to the owner this turn.
