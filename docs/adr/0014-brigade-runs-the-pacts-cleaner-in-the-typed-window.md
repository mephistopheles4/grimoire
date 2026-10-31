# Brigade runs the pact's cleaner in the typed window

Accepted, as built in 0.110.0 (issue 484, spec revision 4). Until then,
cleanup took two owner acts. The owner typed `/brigade done <titles>` for the
archive, and then gave the pact's cleaner its own yes for the worktrees and
branches. Meanwhile the Brigade mod's `read_cleanup` still handed the lead
`git worktree remove --force`, `git branch -D` and `claude rm` lines, so a
wrong card, after a yes, could lose work.

From 0.110.0 the owner's typed `/brigade done all`, or `/brigade done
<titles>`, is the only yes. Inside the window it opens (ADR 0012's window, in
module memory, unchanged), the lead archives each Desktop card, stops each
background card with `claude stop`, and calls the mod's `clean_up`. That tool
runs the pact's cleaner itself, as `show --recoverable` and then
`remove --recoverable` with the tags `show` printed, for exactly the window's
folders. Nothing else in Brigade removes a worktree or a branch, and nothing
runs `claude rm`. Without the pact's cleaner installed, nothing is removed.

The bound is what `--recoverable` keeps (the-pact issue 446). A worktree goes
only when nothing in it would be lost: no changed, untracked or ignored
files, no program a session could have set in local config, no submodule
the cleaner can't see into, no hidden edits, and a branch whose commits are
all on a remote or another branch. Anything else stays and is listed with
what it holds. An archived Desktop session can be unarchived, and a stopped
one attached again, so a wrong card costs a click and a `git worktree add`.

The owner chose one act, in their words: "avoid the double yes at cleanup,
and make it less flaky if mistakes happen" (q1 A, decision 367, relayed by
the lead). The spec go was the lead's own pick under level 3 (decision 422),
and so was this ADR's number (decision 362). The risks it leaves are accepted
in the threat models of both repositories: the list comes after the yes, the
limits of what "recoverable" can see, and the mod's run of the cleaner file
with no prompt. The owner accepted them in decision 451, relayed by the lead
and confirmed in the build session's own chat on 2026-10-31.

## Measured

Ticket 0 measured the engine on Windows with Claude Code 2.1.314, in a
headless CLI session (decision 430), and recorded the results on issue 484.

| # | Assumption | Result |
| --- | --- | --- |
| M1 | A bare `node` with `clean_up`'s options runs the `node` on `PATH`, not a decoy in the working folder | pass, in a CLI session; Desktop's environment was not measured |
| M2 | `$.process.run`'s `env` merges with the session's | merge: `clean_up` sets `NODE_OPTIONS` empty |
| M3 | A mod tool call's time budget, and whether a run's timeout kills its child | at least 180 seconds; the timeout kills the child. `show` gets 60 seconds and `remove` 90 |
| M4 | A background session's status file goes within a minute of `claude stop` | pass: 0.4 and 8.1 seconds |
| M5 | `/brigade done` sent from the phone reaches the mod with its titles | not measured; the lead's field fact says it arrives bare, so the yes is typed at the desktop (decision 434) |
