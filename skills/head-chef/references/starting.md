# Starting a session

Read this before each start. Start each session only when the owner's words in the lead's chat ask for the work.

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
3. **Start it as a Desktop session under the lead,** with Desktop's start
   tool. Set its model and effort with Desktop's setters. The model and effort
   come from the owner's words or the owner's own process; this skill sets no
   default of its own. Set no permission mode: the session takes the default
   unless the owner's words name one.
4. **Give it the start prompt** in "The start prompt" in `SKILL.md`, filled in. A
   hand-off is the same start, with the effort's context on the issue. Send
   later updates to the session as messages, by its name.
5. **Keep its Desktop id** from the start tool's result, in this chat only,
   for its card and the archive. Keep too what `references/cleanup.md` says
   to keep for cleanup when you start a session, read under its "The status
   files".
6. **Report the start in chat,** in the form of the example in `SKILL.md`'s "What a good
   report looks like": the session, its issue, how it runs, what the owner
   must do, and the 5-hour and weekly usage, read with Desktop's usage tool.
   Usage figures go in this chat only.
7. **Update the Brigade pane** in the same step, as "The Brigade pane" in `SKILL.md` says.
8. **Subscribe to its idle notice:** call the message tool with `to` set to
   the session's name, `notify_when_idle` set to true, and no message.

When Desktop's start tool refuses a start, such as one the owner typed from
the phone over Remote Control, say so in one line and offer a click in the
desktop app, or to start that session as a background session with Remote
Control instead. Start it that way only on the owner's words choosing that
route, as `references/background.md` says. Over Remote Control, auto mode
also blocks `claude --bg`: say so once, and if the owner wants the
background route, the owner changes your permission mode in the app. Pass no
mode to a start, and start nothing by another route.

Never rely on a card to start work the owner asked for. When the owner's
words ask for the work, start the session directly. When a start can only
happen through a card, such as an approval above the lead's settings or a
proposal you make on your own, say in one line that the card needs a tap in
the desktop app.
