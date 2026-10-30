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

   In a POSIX shell:

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
   in this chat only: its card and cleanup use it. Keep too what
   `references/cleanup.md` says to keep for cleanup when you start a
   session, read under its "The status files". When it prints no id, it did not start: tell the owner in one
   line, and write no card.
3. **Report the start** as for any session, saying "a background session
   with Remote Control" in place of "a Desktop session", and that it opens
   from its card in the Brigade pane or from the claude.ai session list on
   the phone.
4. **Give its card** its job id as `bgId`, and no `desktopId` or `url`.
5. **Subscribe to its idle notice** by its name, as for any session.

When the owner says it shows as offline for Remote Control, it still runs:
keep its id and its card, and tell the owner to open it from
`claude agents`.
