# Background sessions

Read this when Desktop refused a start and the owner's words in the lead's chat chose the background route. A background session is otherwise a session like any other: the same start prompt, reports, card and cleanup.

## Starting one

1. **Start it** with `claude --bg --remote-control <name> -n <name> -w <name>
   --model <model> --effort <effort>`, followed by the filled start prompt as
   one argument, in a form in which your shell expands nothing. Without `-n`,
   the session's name is its prompt's text. Set no permission mode; Desktop's
   setters do not apply. Refuse the start, and tell the owner, when your own
   name as the lead holds anything but letters, digits, spaces and `. _ -`,
   when the model is not letters, digits and `. _ -` starting with a letter,
   when the effort is not one of `low`, `medium`, `high`, `xhigh` or `max`,
   or when your shell is Windows PowerShell 5.1: it splits quoted arguments
   differently from the PowerShell 7 this form was measured on.

   In Git Bash:

   ```text
   claude --bg --remote-control <name> -n <name> -w <name> --model <model> --effort <effort> "$(cat <<'HEAD_CHEF_PROMPT'
   <the filled start prompt>
   HEAD_CHEF_PROMPT
   )"
   ```

   In PowerShell, a single-quoted here-string, its closing `'@` at the start
   of its line:

   ```text
   claude --bg --remote-control <name> -n <name> -w <name> --model <model> --effort <effort> @'
   <the filled start prompt>
   '@
   ```

2. **Keep its id,** the second field of the first line `claude --bg` prints,
   in this chat only, and its session id from the status-file row whose
   `jobId` equals that id. When it prints no id, when no row carries that
   id by your next turn after the start report, or when two rows carry it,
   it did not start: tell the owner in one line, the failure notice, keep
   nothing, write no card, and retry by no other route. Make no offer to
   retry by any route, command or session you name, the background route
   included. With two rows, the session may still run: after the failure
   notice, tell the owner it may need removing by hand, and you may name
   `claude stop` and `claude rm` for the owner to run, with no id, path or
   error text. Never take up either row later; a new start needs the owner's
   words again.
3. **Check its first prompt.** Read only the transcript named by that row's
   session id, in the `projects` folder of the Claude config folder, up to
   its first user entry. The session id must be a UUID, and the file must
   sit in the `projects` folder by its real path, be a regular file and not a
   link, and be at most 4 MiB. Compare that entry with the filled start
   prompt inside the one command, and print only "match", or "no match" on
   any other outcome, an error included. On "no match", stop: tell the
   owner, and send it nothing.
4. **Report the start** as for any session, saying "a background session
   with Remote Control" in place of "a Desktop session", and that it opens
   from its card in the Brigade pane or from the claude.ai session list on
   the phone.
5. **Give its card** its job id as `bgId`, and no `desktopId` or `url`.

When the owner says it shows as offline for Remote Control, it still runs:
keep its id and its card, and tell the owner to open it from
`claude agents`.
