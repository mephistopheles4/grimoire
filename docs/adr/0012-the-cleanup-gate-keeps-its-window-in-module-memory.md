# The cleanup gate keeps its window in module memory, and fails closed

Proposed, and stopped by the probe. Issue 359's spec v3 (D11) has this record
say that the cleanup gate keeps its window in the Brigade mod's module memory,
fails closed on a reload and on its own failure, refuses a command it cannot
read, and allows inside a window only cleanup's exact command shapes. That
decision was to land with ticket 2, the gate code, only if the probe below
passed and the owner said go (H4). Ticket 2 also waits on issue 446 (H1).

This ticket, ticket 1, writes the Measured section: what a throwaway probe saw
on the engine, one line per assumption the spec rests on (S9). Each line is in
fixed words, counts and placeholders such as `<config>`; none holds a tool
input, command text, id, path or link.

## Result

A17 fails, and S9 makes that a stop: ticket 2 does not start, and the spec goes
back to Design. The single-use code of D3 rests on a command reply's `text`
staying out of every model's reach. On Desktop it does not. The session's own
model read the code in its transcript, and Desktop's turn-end notes carried the
code line, value and all, to the lead session's model.

A14 also fails as D7 states it, so D7 changes before any gate code. A9 could
not be measured as written, and A13 stays partial. Every other row passed, or
passed with the caveat its line gives.

## Measured

The probe is two throwaway plugins outside this repository: a probe mod that
acts only in a session started in its own scratch worktree, and a second
plugin that makes one tool call through `$.tool.call` (A4). They loaded as
session mods, with hot reload, in one throwaway Desktop session on Windows
(Claude Code 2.1.309, the spec's build), on the owner's yes (H2). Rows marked
"runner" were measured under `claude plugin test` on the probe's own tests, on
Claude Code 2.1.314, which loads nothing into a session. Rows marked "disk"
were read from the install folders by a script.

| # | Assumption | Observation | Result |
| --- | --- | --- | --- |
| A1 | A `tool.call` hook sees, and can refuse, the archive tool, both Desktop worktree tools, `ExitWorktree`, Bash, PowerShell and Monitor | Desktop: one call each of the archive tool, `ExitWorktree` remove, Bash, PowerShell and Monitor reached the hook from the main loop, and its deny stopped each one; neither marked output file was written. Desktop's two worktree-cleanup tools were not called live, since their reach is not limited to the scratch worktree (the lead's pick at H2); runner: each reached the hook and the deny stopped it | pass, in part for the two worktree-cleanup tools |
| A2 | Typed `/brigade` arrives as `composer`, over Remote Control as `bridge`, a peer's message as `peer` or `peer-send-message` | Desktop: the probe's command typed at the Desktop prompt arrived as `composer` (5 runs), and typed over Remote Control from the phone as `bridge` (2 runs). A peer message whose whole text was the command never ran it: no run was counted | pass; a peer opens nothing |
| A3 | A hot reload clears module variables | Desktop: a value set before an edit to the probe's file read as unset after the reload, and every count started over | pass |
| A4 | A call made by a second plugin through `$.tool.call` reaches the hook, with `next.origin` naming that plugin | Desktop: the second plugin's call reached the hook with `next.origin` naming it, and the deny stopped it | pass |
| A5 | A subagent's and a workflow agent's tool calls reach the hook with `agentId` | Desktop: a subagent's Bash call reached the hook with an `agentId` that `$.agent.list()` names, and a workflow agent's with an `agentId` it does not name; the deny stopped both | pass |
| A6 | A stopped, unarchived Desktop session still has a status file | Desktop: a watch read the session's status file every 5 seconds through the owner's stop, the minute's wait and the resume. The file stayed present throughout, and left only when the session was archived. Whether Desktop's stop ended the session's process was not measured | pass, with that caveat |
| A7 | `git branch -d` from the main working tree deletes a squash-merged branch whose upstream on a local bare remote still exists | scratch repository: deleted. Git warned that the branch was merged to its upstream but not to `HEAD`, and deleted it on the upstream's strength. With the upstream gone, git would refuse | pass, while the upstream exists |
| A8 | The model's Skill tool cannot run the command with origin `composer` or `bridge` | Desktop: the Skill tool would not run the probe's command at all, answering that it is a command, not a skill; no run was counted | pass |
| A9 | A transcript-link click arrives as `composer` | Desktop: the command's reply drew its link text as plain text, with nothing to click | not measurable as written |
| A10 | One module instance serves one session | Desktop: one session id over each module's life, before and after the reload | pass |
| A11 | Module memory survives a cleanup's span of 15 minutes | Desktop: a value set, then the run's calls over 17 minutes, then read: still set | pass |
| A12 | A Desktop session's status-file `name` equals the title its roster card carries | Desktop: the lead's roster card for the throwaway session names one status file by its `desktopId`, and that file's `name` equals the card's title. A second card with the same title prefix, in another roster, names no live status file | pass |
| A13 | `configFromRoot ?? configFromSynced` on grimoire's installed root gives the config folder | disk: of 5 grimoire install folders under `<config>/plugins`, 4 derive `<config>` (1 cache, 1 marketplaces, 2 synced); 1 synced copy in a folder named by an id, not by `grimoire`, derives nothing. Desktop: the probe, loading after grimoire, never saw grimoire's module join, so which root Desktop loads stays unmeasured | partial |
| A14 | The archive tool's input is `session_id` alone, taking the card's `desktopId` value, and the tool names are as D7 states | Desktop: the tool name is as D7 states. Its schema lists `session_id` (required), `reason` and `_consent` (set by the app). The model passed `session_id` and `reason`, with `session_id` as the literal `self` | fail: D7's "no other key" refuses ordinary archives. Whether `session_id` takes the `desktopId` value was not measured: the probe's count of it ended with the archived session |
| A15 | The plugin test runner can raise `command.run` with origin `composer` or `bridge` | runner: `$.command.run` raised plainly reaches the hook with no `origin` at all; with `origin: { kind }` added to the call, the hook sees `composer` and `bridge` as given. The field is outside the call's declared type, so a test passes it with a cast | pass, with that note |
| A16 | What the archive removes from the worktree and the branch, and whether it refuses on unsaved work | Desktop: the session archived itself through the archive tool, the one call the probe let through, with a tracked file changed and an untracked file in its worktree. Afterwards the worktree folder, both unsaved changes, the worktree's registration and its branch were all still there. The archive did not refuse | pass: it removes nothing |
| A17 | A command reply's `text` is not in what the model reads, now or later, and shows on the device the owner typed from | Desktop: the code line showed on Desktop and on the phone. The session's own model, asked, said a code appeared in its transcript, and Desktop's turn-end notes quoted the code line, value and all, to the lead session's model | fail: stop, back to Design |
| A18 | A `tool.call` fallback's arguments carry the tool name and input | Desktop: a hook made to throw on a Bash call ran its `.catch`, which saw the tool name and the `command` field, and its deny stopped the call; runner: the same | pass |
| A19 | A mod has a random source the model cannot predict or read | runner and Desktop: `crypto.getRandomValues` is present in the module's environment; runner: two 6-character codes drawn from it differed, and neither was in the reply's `context`. A17 shows the code still reached models through `text` | pass for the source; A17 for its secrecy |
