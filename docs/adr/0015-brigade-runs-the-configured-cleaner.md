# Brigade runs the cleaner the owner configured

Accepted, as built in 0.117.0 (issue 504, part C). It replaces
[ADR 0014](0014-brigade-runs-the-pacts-cleaner-in-the-typed-window.md), which
ran a cleaner at a fixed path inside another package's folder. Nothing else
of 0014 changes: the owner's typed `/brigade done` is still the only yes, the
window is still ADR 0012's, in module memory for 15 minutes, and `clean_up`
still runs `show --recoverable` and then `remove --recoverable` with the tags
`show` printed, for exactly the window's folders, as an argument list with no
shell.

**What changes.** Brigade names no cleaner of its own and sets no default. The
owner types `/brigade cleaner <absolute path>` at the desktop prompt, `/brigade
cleaner none` to unset it, and a bare `/brigade cleaner` to show it. Everything
after `cleaner ` is the path, spaces included, with no quoting. A path holding
a quote or a control character, a relative path and a path that is not a
regular file (not a link, landing where it is named) are refused. The command
works only from the desktop composer, never from the phone, because it names a
program to run, and only as the engine's own dispatch, as `/brigade done` does.

**Where it lives.** The plugin's lasting store, the one the permission
warning's acknowledgement uses, so one command holds across sessions. No tool
reads it: the lead sees the path only in the replies to the typed commands,
with the home folder drawn as `~` (the file's name alone when no home folder
reads), and that is the one place a reply names a path.

**Pinned per window.** `/brigade done` copies the path into its window and
names it in its reply; `clean_up` runs that copy only. Rewriting the store
mid-window changes nothing. A second `/brigade done` in an open window repins
every open entry, and its reply says so. A reload, a clear, a resume and
`/brigade done none` empty the window and its copy.

**With none set,** the window still opens, archiving and stopping go ahead, and
`clean_up` runs nothing: it says no cleaner is configured, so no worktree or
branch is removed, and how to set one. When the pinned file is gone or fails
its check at run time, nothing runs and the answer says so.

**Recoverability is the cleaner's own promise.** Brigade passes `--recoverable`
and cannot check what a cleaner does with it. ADR 0014's bound, that a worktree
goes only when nothing in it would be lost, now holds only as far as the
configured program keeps it. The interface a cleaner must meet is in the root
README: `node <file>` with `NODE_OPTIONS` empty, the two subcommands and their
arguments, a last `RESULT:` line, exit 0 or 1, 60 and 90 second limits, and a
`the cleaner stopped part way` line for a run that did not finish. A `show` with any other exit, last line or time reads as "did not run", and
a `remove` with any other reads as "did not finish", with its output left out. What a cleaner prints is shown
as data between two fixed lines, and a line with a control character or past
300 characters is left out and counted; its output is no longer held to one
program's shape.

**Why.** The owner's scope decision on issue 504: malicious software on the
machine, another plugin included, is out of scope, and the plugin is not an
antivirus. A fixed path into another package's folder was a built-in remover
Brigade would have to keep in step with that package. The owner chose that
Brigade run whichever cleaner is configured and remove nothing when none is.

**What stays.** The engine-origin check (`fromEngine`) stays on the typed
commands and on the model's own `clean_up` call. Whether the model's own run
can carry the typed stamp is not measured, so the check may still stop a
fooled session.

**Not measured.** Whether Desktop's environment finds a bare `node` as the
terminal's does (ADR 0014's M1 was measured in a CLI session only); the Desktop
check of issue 504 covers setting a cleaner, starting a new session,
`/brigade done` and `clean_up` on a throwaway worktree.

**Rollback.** Reverting this change restores the fixed path, and a kept store
value is ignored. No kept file's format changes, so no migration.
