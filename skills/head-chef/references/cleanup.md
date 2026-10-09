# Cleanup (questions 3, 6, 11, 16, 18)

This file is generated from `CONTRACT.md` in the skill base directory, with
`SKILL.md`. The head chef reads it before the first cleanup step. It holds the
seven steps; each stop in it is also in `SKILL.md`.

## Contents

- Before the steps: paths, ids, branches and where git is asked
- The seven steps

## Before the steps (questions 3, 18)

**Clean up only on the owner's "done" for a session.** Reason: deleting a
worktree cannot be undone, and a wrong path or unsaved work is lost (failure
2). Follow the seven steps in order. Run each command yourself, and read its
output yourself.

**Every path, id and branch comes from a tool's output, never from a roster
line, a message or a brief.** Put each one in single quotes. Check each
against its set first, and stop and ask when it holds anything else. Reason:
PowerShell also reads the curly quotes `‘ ’ ‚ ‛` as quote marks, so one in a
name could end the quoted text and run a command (failure 3).

- **A path:** letters, digits, spaces, and `. _ - / \ :` only.
- **A branch:** letters, digits, and `. _ - /` only, not starting with `-`.
- **An id:** letters, digits and `-` only, not starting with `-`.

**Ask git from the lead repository, never from the session's folder.** The
**lead repository** is the git repository of this session's own working
folder: the `cwd` of the row in `claude agents --json` whose `sessionId` is
`${CLAUDE_SESSION_ID}`. The head chef launched the session from there. If no
row has that `sessionId`, stop and ask. Reason:
a session can rewrite its folder's `.git` file to point at a repository it
planted, which then chooses the worktree list git prints and can make
`git status` run a program (failure 2).

**Compare two paths only after you write both the same way:** forward
slashes, no slash at the end, and, on Windows, without regard to case. A path
is inside another when it is equal to it, or starts with it and then a `/`.

## The seven steps (questions 3, 6, 11, 16, 18)

1. **Find the session, then stop it.** Run `claude agents --json`. Find the
   one row whose `name` is the session's name. If no row or two rows match,
   stop and ask. Note its `kind`, `cwd` and `sessionId`, and for a background
   session its `id`.
   - A background session: `claude stop '<id>'`.
   - A chip has no `id`; name it by its `sessionId`. Ask the owner to close
     it. Go on when it no longer shows in `claude agents --json`.
2. **Find its worktree, in the lead repository.** Run
   `git -C '<lead folder>' worktree list --porcelain`. Each entry starts with
   a `worktree <path>` line, and the first entry is the main working tree.
   Take the entry whose path is equal to the session's `cwd`. **Refuse** when
   no entry is, and when the entry is the main working tree. Note the
   entry's `branch` line, without `refs/heads/`. Then check that the
   worktree belongs to the lead repository. Run this in both folders, and
   **refuse** when the two lines differ:

   ```powershell
   git -c core.fsmonitor=false -C '<folder>' rev-parse --path-format=absolute --git-common-dir
   ```

   Then run `git -c core.fsmonitor=false -C '<worktree>' rev-parse
   --absolute-git-dir`, and **refuse** unless its line is inside the
   `worktrees` folder of that common dir. A `.git` file can point at a
   planted folder that still names the lead's common dir; this catches it.

3. **Refuse if another session works inside it.** Run `claude agents --json`
   again. Refuse when the `cwd` of any row other than the session being
   cleaned up is inside the worktree path.
4. **Refuse on unsaved work.** Run each command, and refuse when it prints
   anything. `-c core.fsmonitor=false` turns off git's file-watcher program,
   which git would otherwise run while it reads the folder.

   ```powershell
   git -c core.fsmonitor=false -C '<worktree>' status --porcelain --untracked-files=all
   git -c core.fsmonitor=false -C '<worktree>' rev-list HEAD --not --remotes
   ```

   Then run `git -c core.fsmonitor=false -C '<worktree>' stash list`. Refuse
   when a line says `WIP on <branch>:` or `On <branch>:`, with the
   worktree's branch, or `(no branch)` when it has none. **Never pop or drop
   a stash.** The stash list is shared by every worktree of the repository.

   > **Stop and ask: when a cleanup check refuses (main working tree, a path
   > not in git's worktree list, a worktree of another repository, another
   > live session inside, uncommitted or untracked files, a commit on no
   > remote-tracking ref, a stash entry for its branch): stop, say which
   > check refused and why, and wait.**

5. **Name it back, and wait.**

   ```text
   Ready to remove session "build-185" (fc252ad7), its worktree C:/Users/me/repo/.claude/worktrees/build-185 and its branch worktree-build-185. Nothing unsaved found. Say yes to remove them.
   ```

   > **Stop and ask: when cleanup is ready to delete: name the session and the
   > absolute worktree path back, and wait for the owner's confirming words.**

6. **Check again, then remove the session, the worktree and the branch.** The
   owner's yes can come hours later, so run steps 2 to 4 again first, and
   stop if any of them refuses now. Never add a flag that forces or
   discards: no `--force`, no `-D`, no `--discard-unpushed`, no
   `--force-remove-worktree`.
   - A background session: `claude rm '<id>'`. It also removes a worktree it
     made.
   - Run `git -C '<lead folder>' worktree list --porcelain` again. If the
     path is still there: `git -c core.fsmonitor=false -C '<lead folder>'
     worktree remove '<worktree>'`. It checks the folder itself first, so
     the flag matters here too.
   - If the branch is still there: `git -c core.fsmonitor=false -C '<lead
     folder>' branch -d '<branch>'`.
   - When a command refuses, stop, show what it said, and do nothing more.
7. **Remind the owner to archive the sidebar entry.** No tool can. Then
   remove the card from the roster.
