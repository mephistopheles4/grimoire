# Starting a session

Read this before each start. Start each session only when the owner's words in the lead's chat ask for the work.

A start whose route the owner's words did not name is a background session with Remote Control. It takes its model and effort on the command line, with no setter, approval card or approval prompt. Start a Desktop session only when the owner's words in the lead's chat name it, for example "as a Desktop session", and then read `references/desktop.md` in place of steps 3 to 7 below.

1. **Before your first launch in this lead,** call the Brigade mod's
   `mcp__grimoire__show_permission_warning` tool, loading it first if it is deferred. It
   draws the permission warning above the prompt, unless the owner chose
   Don't show again for its wording. It needs no answer: go on with the
   launch. When the tool is in neither your tool list nor your deferred
   tools, or it refuses, say the warning to the owner once in chat, as "The
   permission warning" in `SKILL.md` gives it, then go on.
2. **Name the session yourself,** from letters, digits and `. _ -`,
   starting with a letter or digit, never two alike. Never copy a name from
   an issue. You send to it by this name.
3. **Check the start.** When any of these holds, refuse it with one plain
   line, give the fix where one is named, and offer the Desktop start as the
   other route (a click in the desktop app, or the owner's words naming it):
   - your own name as the lead holds anything but letters, digits, spaces and
     `. _ -`. The fix: the owner renames your chat.
   - the model is not letters, digits and `. _ -` starting with a letter.
   - the effort is not one of `low`, `medium`, `high`, `xhigh` or `max`.
   - the issue number is not digits only.
   - the repository is not one `owner/name`, each part letters, digits and
     `. _ -`.
   - the filled start prompt is more than one line.
   - the owner's words name a permission mode that `claude --help` does not
     list for `--permission-mode`.
   - your shell is Windows PowerShell 5.1: it splits quoted arguments
     differently from the PowerShell 7 this form was measured on. The fix:
     PowerShell 7 or a POSIX shell.

   The model and effort come from the owner's words or the owner's own
   process; this skill sets no default of its own. When neither gives a model
   or an effort, ask the owner once, and start nothing until the owner answers.
4. **Start it** with `claude --bg --remote-control <name> -n <name> -w <name>
   --model <model> --effort <effort>`, followed by the start prompt in "The
   start prompt" in `SKILL.md`, filled in, as one argument, in a form in which
   your shell expands nothing. Without `-n`, the session's name is its
   prompt's text. Pass no permission mode unless the owner's words name one;
   then add `--permission-mode <mode>` before the prompt. A hand-off is the
   same start, with the effort's context on the issue. Send later updates to
   the session as messages, by its name.

   In a POSIX shell:

   ```text
   claude --bg --remote-control <name> -n <name> -w <name> --model <model> --effort <effort> [--permission-mode <mode>] "$(cat <<'HEAD_CHEF_PROMPT'
   <the filled start prompt>
   HEAD_CHEF_PROMPT
   )"
   ```

   In PowerShell, a single-quoted here-string, its closing `'@` at the start
   of its line:

   ```text
   claude --bg --remote-control <name> -n <name> -w <name> --model <model> --effort <effort> [--permission-mode <mode>] @'
   <the filled start prompt>
   '@
   ```

5. **Keep its id,** the second field of the first line `claude --bg` prints,
   in this chat only: its card and cleanup use it. Keep the folder and branch
   too, as `claude --bg` shows them, or "not known", in this chat only, for
   the list before cleanup. When it prints no id, it did not start: tell the
   owner in one line, and write no card.
6. **Report the start in chat,** in the form of the example in `SKILL.md`'s "What a good
   report looks like": the session, its issue, a background session with
   Remote Control, its model and effort plainly, where the owner opens it
   (its card in the Brigade pane, or the claude.ai session list on the
   phone), what the owner must do, and the 5-hour and weekly usage, read with
   Desktop's usage tool. Usage figures go in this chat only.
7. **Update the Brigade pane** in the same step, as "The Brigade pane" in
   `SKILL.md` says. Give the card the job id as `bgId`, and no `desktopId` or
   `url`.
8. **Subscribe to its idle notice:** call the message tool with `to` set to
   the session's name, `notify_when_idle` set to true, and no message. A
   background member with Remote Control lists twice under its name. When
   exactly two rows share the name, one on this machine and one a Remote
   Control row, send to and subscribe to the row on this machine by its ref,
   and never to the Remote Control row. Any other shape, send nothing and tell
   the owner, as "Sending and idle notices" in `SKILL.md` says. Take the ref
   from the listing in this turn, as that section says.

When the session shows as offline for Remote Control, it still runs: keep its
id and its card, and tell the owner to open it from `claude agents`. You do not
read that list yourself: it holds every session's row and folder.

## When a start is refused

- **`claude --bg` is refused,** by the auto-mode classifier or anything else:
  say so in one line in plain words. Offer the Desktop start as the other
  route: a click in the desktop app, or the owner's words naming it. Start it
  that way only on those words. Retry `claude --bg` in no other form, and
  start nothing by another route.
- **The folder is not trusted:** the engine refuses the start. Say so in one
  line, with the fix: the owner grants the folder in the desktop app, or
  opens `claude` there once and accepts the trust prompt. A `-w` start inside
  a trusted repository is expected to inherit that trust. Offer the Desktop
  start as the other route, as above.
- **A start from the phone over Remote Control,** while you run in auto mode:
  both routes are blocked. The classifier blocks `claude --bg`, and Desktop's
  start tool refuses a start on a Remote Control turn. Say so once. The
  start waits until the owner is at the desk, or until the owner changes your
  permission mode in the app. Pass no mode, and propose no route around the
  classifier.

Never rely on a card to start work the owner asked for. When the owner's
words ask for the work, start the session directly. When a start can only
happen through a card, such as an approval above the lead's settings or a
proposal you make on your own, say in one line that the card needs a tap in
the desktop app.
