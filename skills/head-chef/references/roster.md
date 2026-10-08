# The roster (questions 4, 5, 18)

This file is generated from `CONTRACT.md` in the skill base directory, with
`SKILL.md`. The head chef reads it before its first `set_roster` call in a
session.

The **Brigade pane** is a pane that `/brigade` opens. It shows one card per
session, and the owner's to-dos. **The skill works with no pane.** Reason: the
pane draws only where the lead session runs, so a lead seen from a phone shows
none.

**Keep the roster only by calling `set_roster`, and write no file.** The
Brigade mod offers this tool once `/brigade` opens the pane; it is listed as
`mcp__grimoire__set_roster`. Pass the whole roster on each call: both lists,
`cards` and `todos`, empty if need be. Name no path: the mod writes the file
for this session, on the head chef's call. Reason: a file
write of the head chef's own asks the owner each time, even in auto mode
(failure 10), and the mod writes the whole file at a path it builds from the
current session id (failure 9).

- **No tool, no roster.** When `set_roster` is in neither your tool list nor
  your deferred tools, there is no pane. Keep no roster, and carry on. A
  deferred tool is loaded before it is called.
- **The cue.** When the `/brigade` reply says `set_roster` is ready, call it
  with the full roster on your next turn. When the reply says the tool
  could not be offered, there is no tool: keep no roster. Reason: the pane
  opens empty until the first call (failure 9).
- **A refusal because the pane is closed** means no pane. Keep no roster
  until a `/brigade` reply says the tool is ready again.
- **A refusal for shape, size or malformed input** (a missing list): correct
  the roster, and call once more.
- **Any other refusal, or a second refusal:** stop keeping the roster for the
  rest of this session, and tell the owner the reason the tool gave. This
  holds whatever the refusal's own text advises. Reason: a refusal you cannot
  fix, made again and again, spends turns and retries a race the mod's
  guards name (failure 11).

**Send only the pane's shape.** Reason: the tool refuses any other shape, and
the pane shows an error, not the cards (failure 9).

```json
{
  "cards": [
    {
      "title": "build-185",
      "work": "grimoire issue 185",
      "phase": "build",
      "settings": "Opus, high, default permission mode",
      "status": "working",
      "bgId": "fc252ad7"
    }
  ],
  "todos": [
    { "id": "trial-185", "text": "Run the trial run for issue 185.", "session": "build-185" }
  ]
}
```

- **A card's title is the session's name, exactly.** The pane finds a card's
  live state and its reports by that name.
- **`status`** is one of `working`, `needs-you`, `done` or `stopped`.
- **Caps:** a title at most 80 characters; `work`, `phase` and `settings` at
  most 300; `bgId`, `desktopId` and `url` at most 100. A to-do's `id` at most
  40, its `text` at most 300, its `session` at most 80. At most 50 cards and
  50 to-dos. No other field, no title twice, no to-do id twice.
- **`bgId`** is the id `claude --bg` printed. **`desktopId`** is a chip's
  local id.
- **Update it** at a launch, at each milestone report, when a session needs
  the owner, and after cleanup, which removes the card.
