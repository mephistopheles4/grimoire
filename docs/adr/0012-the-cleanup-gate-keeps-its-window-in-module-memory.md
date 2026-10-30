# The cleanup gate keeps its window in module memory, and fails closed

Proposed. Issue 359's spec v3 (D11) has this record say that the cleanup gate
keeps its window in the Brigade mod's module memory, fails closed on a reload
and on its own failure, refuses a command it cannot read, and allows inside a
window only cleanup's exact command shapes. That decision lands with ticket 2,
the gate code, and only if the probe below passes and the owner says go (H4).
Ticket 2 also waits on issue 446 (H1).

This ticket, ticket 1, writes the Measured section: what a throwaway probe saw
on the engine, one line per assumption the spec rests on (S9). Each line is in
fixed words, counts and placeholders such as `<config>`; none holds a tool
input, command text, id, path or link.

## Measured

The probe is two throwaway plugins outside this repository: a probe mod that
acts only in a session started in its own scratch worktree, and a second
plugin that makes one tool call through `$.tool.call` (A4). Rows marked
"runner" were measured under `claude plugin test` on the probe's own tests, on
Claude Code 2.1.314, which loads nothing into a session. Rows marked "disk"
were read from the install folders by a script. Every other row waits for the
probe to load in a throwaway Desktop session (H2 and H3), and records that
session's own build.

| # | Assumption | Observation | Result |
| --- | --- | --- | --- |
| A1 | A `tool.call` hook sees, and can refuse, the archive tool, both Desktop worktree tools, `ExitWorktree`, Bash, PowerShell and Monitor | runner: each of the seven reached the hook and the deny stopped it before the bottom ran; on Desktop, not yet measured | pending |
| A2 | Typed `/brigade` arrives as `composer`, over Remote Control as `bridge`, a peer's message as `peer` or `peer-send-message` | not yet measured | pending |
| A3 | A hot reload clears module variables | not yet measured | pending |
| A4 | A call made by a second plugin through `$.tool.call` reaches the hook, with `next.origin` naming that plugin | not yet measured | pending |
| A5 | A subagent's and a workflow agent's tool calls reach the hook with `agentId` | not yet measured | pending |
| A6 | A stopped, unarchived Desktop session still has a status file | not yet measured | pending |
| A7 | `git branch -d` from the main working tree deletes a squash-merged branch whose upstream on a local bare remote still exists | not yet measured | pending |
| A8 | The model's Skill tool cannot run the command with origin `composer` or `bridge` | not yet measured | pending |
| A9 | A transcript-link click arrives as `composer` | not yet measured | pending |
| A10 | One module instance serves one session | not yet measured | pending |
| A11 | Module memory survives a cleanup's span of 15 minutes | not yet measured | pending |
| A12 | A Desktop session's status-file `name` equals the title its roster card carries | not yet measured | pending |
| A13 | `configFromRoot ?? configFromSynced` on grimoire's installed root gives the config folder | disk: of 5 grimoire install folders under `<config>/plugins`, 4 derive `<config>` (1 cache, 1 marketplaces, 2 synced); 1 synced copy in a folder named by an id, not by `grimoire`, derives nothing. Which root Desktop loads is not yet measured | pending |
| A14 | The archive tool's input is `session_id` alone, taking the card's `desktopId` value, and the tool names are as D7 states | not yet measured | pending |
| A15 | The plugin test runner can raise `command.run` with origin `composer` or `bridge` | runner: `$.command.run` raised plainly reaches the hook with no `origin` at all; with `origin: { kind }` added to the call, the hook sees `composer` and `bridge` as given. The field is outside the call's declared type, so a test passes it with a cast | pass, with that note |
| A16 | What the archive removes from the worktree and the branch, and whether it refuses on unsaved work | not yet measured | pending |
| A17 | A command reply's `text` is not in what the model reads, now or later, and shows on the device the owner typed from | not yet measured | pending |
| A18 | A `tool.call` fallback's arguments carry the tool name and input | runner: a hook made to throw on a Bash call ran its `.catch`, which saw the tool name and the `command` field, and its deny stopped the call | pass on the runner; Desktop not yet measured |
| A19 | A mod has a random source the model cannot predict or read | runner: `crypto.getRandomValues` is present in the module's environment; two 6-character codes drawn from it differed, and neither was in the reply's `context` | pass on the runner |
