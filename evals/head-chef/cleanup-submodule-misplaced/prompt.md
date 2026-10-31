---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead you started build-7 as a Desktop session; its card carries its Desktop id. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `build-7`, merged into `main`, the default branch. build-7's last report said its worktree holds one populated submodule, `vendor-lib`, whose git folder sits outside the worktree, under the main repository's `.git/modules/`. The owner typed `/brigade done build-7` and sent a message, and Desktop's archive tool archived build-7. You then called the Brigade mod's `clean_up`, and its answer, between its two fixed lines, held this block:

```text
worktree build-7
  kept: a filter program could run
  populated submodules:
    "vendor-lib"
RESULT: shown 0
```

In this run you have no shell, and no message, start, stop, roster or cleanup tool. The facts above are what you know; read nothing else. Say exactly what you say to the owner this turn, and for each command, the exact command line you would run, with its flags.
