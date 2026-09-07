# The run prompt — round seven

The exact text every round-seven agent receives. Only `{{TASK_FILE}}` and
`{{OUT_DIR}}` are substituted, once per run. Committed before the first run,
because round six's prompt was not saved and its results had to quote fragments
of it.

Every path is absolute and deliberately so. The eval executes in a git worktree
of a repository whose main checkout holds an older validator on the same disk,
and round six lost a run to an agent that resolved a relative path against the
wrong root.

---

You are writing one flightpath file, then validating and fixing it in a loop.

## Read exactly these three files, and nothing else

1. `C:\Users\mephi\WebstormProjects\grimoire\.claude\worktrees\shape-eval-63\skills\groundtrack\references\flightpath-file.md` — the shape document.
2. `C:\Users\mephi\WebstormProjects\grimoire\.claude\worktrees\shape-eval-63\skills\groundtrack\examples\greet.flightpath.json` — a worked example.
3. `{{TASK_FILE}}` — the task.

Do not read any other file in the repository. In particular, do not look at
`baseline/`, at any other run's output, or at the validator's source. You have
what you need.

## Write the file

Write the flightpath file the task asks for, to:

`{{OUT_DIR}}\attempt-1.json`

## Then validate and fix, capped at five passes

For pass `N`, from the directory `{{OUT_DIR}}`:

```powershell
node C:\Users\mephi\WebstormProjects\grimoire\.claude\worktrees\shape-eval-63\skills\groundtrack\scripts\render.mjs attempt-N.json --check > check-N.txt 2>&1
```

**The redirect is required.** `--check` exits non-zero when it refuses, and a
non-zero exit through this harness's shell tool returns no output at all. Run
the command exactly as written, then read `check-N.txt`. Without the redirect a
refused file looks green.

**Check that the ok line names a graph count.** A clean run prints a line like
`ok: <title> — N node(s), N graph(s), N run(s)`. If your ok line has no
`graph(s)` in it, you have run the wrong validator — stop and say so. Use the
absolute path above.

Then:

- If `check-N.txt` reports refusals, read them, and write a **new file**
  `attempt-<N+1>.json` with the fixes. Check that one as `check-<N+1>.txt`.
- **Never edit an attempt file after you have checked it.** Each
  `attempt-N.json` must remain exactly the file that produced `check-N.txt`.
  A fix is always a new numbered file. This is checked mechanically afterwards,
  and a run whose saved file does not reproduce its saved output is discarded.
- **Stop at five passes.** If `attempt-5.json` still refuses, stop there and
  say so. That is a real result, not a failure to follow instructions.

## Once the checker is clean, read every finding

A clean checker can still print **findings**. A finding is not a refusal — it
never blocks — and it is not automatically wrong. But it is the checker telling
you something about your file, and you do not stop until you have read each one
and answered it.

For each finding, do one of two things:

- **Fix it.** That is another pass: write the next numbered attempt file, check
  it, and it counts against the five-pass cap like any other.
- **Keep it**, and say in one line why the finding is what you meant.

## Save your account

Write `{{OUT_DIR}}\result.json`:

```json
{
  "task": "t<N>",
  "attempts": <how many attempt files you wrote>,
  "green": <true if a checker run came back clean, false if you hit the cap>,
  "account": "<a few sentences on what you wrote and what you had to fix>",
  "answers": [
    { "finding": "<the line the checker printed, verbatim>", "answer": "<fixed, or why it is what I meant>" }
  ]
}
```

`answers` is empty if the checker printed no findings. A kept finding and an
ignored one leave the same attempt file behind, so this array is the only
evidence you read them.

## What is graded

The files, not your account. Every `attempt-N.json` and every `check-N.txt` is
re-scored afterwards with the same validator. Write what you actually did.
