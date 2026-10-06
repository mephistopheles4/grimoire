# brigade-native: throwaway prototype for #198 and #193

This branch is never merged. It keeps a renamed copy of the Brigade pane (`/brigade-native`), so a build session can diff it against `brigade/` on `main`.

It was approved on 2026-10-06. The findings live on the issues:

- [#198](https://github.com/mephistopheles4/grimoire/issues/198): a Desktop-native usage section (`Svg`, with terminal text bars as the fallback), boxed session cards, aligned to-dos, and a tick with a 30 s undo.
- [#193](https://github.com/mephistopheles4/grimoire/issues/193): a cache-warmth line on each card, read from the member's transcript, and the cold-and-large nudge.

## What not to carry over

- **The hardcoded data folder.** `where()` reads a fixed `<CLAUDE_CONFIG>/plugins/data/grimoire-inline` instead of resolving it.
- **The fixed roster.** `rosterId` reads one lead session's roster instead of this session's.
- **The fake data.** `FAKE_SESSIONS` and `FAKE_TODOS` (marked `[fake]`) were there to show every state.
- **The `brigade-native` names:** the plugin, the command, the pane id and the state keys.

## Running it

Copy the folder into a dev-mods folder, which the `plugin-authoring` skill names. Set the two placeholders in `brigade/register.tsx`, then type `/brigade-native`.
