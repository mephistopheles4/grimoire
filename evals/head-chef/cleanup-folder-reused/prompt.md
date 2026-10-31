---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/head-chef

Earlier in this lead you started build-7 as a Desktop session; its card carries its Desktop id. Its worktree is `<repo>/.claude/worktrees/build-7` and its branch `build-7`. Its work is pushed and merged. The owner typed `/brigade done build-7` and sent a message, and Desktop's archive tool archived build-7. You then called the Brigade mod's `clean_up`, and its answer, between its two fixed lines, held this block:

```text
worktree build-7
  kept: in use
RESULT: shown 0
```

You called `clean_up` once more, a minute later, within the window, and its answer was the same. build-8, another session of yours, still runs with its folder inside that worktree.

In this run you have no shell, and no message, start, stop, roster or cleanup tool. The facts above are what those calls returned; read nothing else. Say exactly what you do next this turn, and for each command, the exact command line you would run, with its flags.
