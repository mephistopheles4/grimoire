# The cleanup gate keeps its window in module memory, and fails closed

Accepted, as built in 0.102.0 (issue 359, spec v5.2). The owner's typed
`/brigade done <titles>` opens a 15-minute window in the Brigade mod's module
memory for the bound cards it names. Desktop's archive tool passes only inside
it, and the head chef stops a background session with the mod's
`stop_background_session`, which runs `claude stop` as an argument list only
inside a window. A raw `claude stop` from a session's own shell stays open
until the-pact issue 439's deny rule is installed (the owner's word, q6 A). A
reload, a session start, a throw or a wrong shape leaves the window shut. No
shell text is read: the shell reader and the confirm code and press of the
earlier specs are gone, and worktree and branch removal moved to the-pact
issue 438's cleaner.

Ticket 1 wrote the Measured section: what a throwaway probe saw on the engine,
one line per assumption the spec rests on (S9). Ticket 1b, the second probe of
the spec's revision 4.1 (S9b), adds a second table there for the Confirm press
that replaced the code. Each line is in fixed words, counts and placeholders
such as `<config>`; none holds a tool input, command text, id, path or link.

## Result

A17 fails, and S9 makes that a stop: ticket 2 does not start, and the spec goes
back to Design. The single-use code of D3 rests on a command reply's `text`
staying out of every model's reach. On Desktop it does not. The session's own
model read the code in its transcript, and Desktop's turn-end notes carried the
code line, value and all, to the lead session's model.

A14 also fails as D7 states it, so D7 changes before any gate code. A9 could
not be measured as written, and A13 stays partial. Every other row passed, or
passed with the caveat its line gives.

## Result, ticket 1b

No row ticket 1b measured failed outright, so nothing in it stops the spec.
A20 and A24 pass: a press on the probe's own Confirm reaches its hook with
every field D3 checks, and a note appended from the press reaches the session,
though it starts no turn by itself. A25 is partial: every redraw after a press
came within a second, but one of the two after a timer came later. A14b passes
for the archive's keys and value, but the archive never ran, so what it removes
was not measured. A23 is partial: every Confirm handler run is accounted for
by the owner's own presses, another plugin took a press on the probe's Cancel,
and no forged press reached the probe's hook. A21, A22, A1b and A15b were not
measured.

On the owner's word, relayed, ticket 2 starts with its pure removal reader
only. Its hooks, the press and the window wait on H1, since no item on H1's
list is yet a control or the owner's accepted risk.

H7 holds for this record: after each new engine build, before the gate is
relied on, A1 (the archive tool), A2, A3, A4, A5, A8, A10, A11, A14 and A14b
are measured again, and a row that fails stops reliance on the gate until
Design answers it. A15b, whether another plugin's command run can carry an
origin it supplies, is not measured: until it is, the origin gate is not
relied on against another plugin.

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

### Ticket 1b

Desktop build 2.1.309, ticket 1's build, so ticket 1's rows that H7 names were
not measured again (S9b). The same two throwaway plugins, extended: the probe
draws its own pane with Confirm and Cancel as D3 draws them, and the second
plugin tries, as a plugin that means harm would, to pass for the probe's press
and to rewrite its pane. They ran in one throwaway Desktop session on Windows,
with a second throwaway session in a second worktree of the scratch repository
(H2c). This table reads the probe's own fixed-word results, which the owner
printed on Desktop just before the run ended, against the probe's source, with
the owner's account of the archive calls that came after the print. The second
plugin's results were not kept. Five presses reached the probe's hook, four on
Confirm and one on Cancel, and the owner's own steps account for each: A20's
press, A14b's press, and the three forge rounds' ends.

| # | Assumption | Observation | Result |
| --- | --- | --- | --- |
| A20 | A click on a Button the probe's pane draws reaches the probe's `ui.press` hook with its plugin name, the key, the pane's `requestId` and surface `desktop`; `onPress` runs; the pane reads listed and placed | Desktop: the hook saw a Confirm press under the probe's own name, from surface `desktop`, with the current key and the pane's `requestId`; the pane read listed and placed, and the button's `onPress` ran | pass |
| A21 | Over Remote Control, the pane draws on the phone, and a press there reaches the hook with surface `mobile`, listed and placed | Remote Control: the probe's command typed from the phone arrived as `bridge` (1 run). No press from surface `mobile` reached the hook | not measured: the owner decides on Remote Control (S9b) |
| A22 | Nothing but the owner's hand raises a press or types into the composer | Desktop: no press reached the hook beyond the five the owner's own steps account for. The Skill tool reached the hook 3 times, and 2 peer, 2 `sdk` and 1 task-notification prompts arrived; none ran the probe's command, which ran only from `composer` (7) and `bridge` (1). Which routes were tried, and the desktop-input routes, are not in the counts | not measured as a capability test: no route raised a press in this run |
| A23 | Another plugin cannot pass for the probe's press or what the pane shows | Desktop: three forge rounds ran, and the running count of forge hits stood at 0, 1 and 2 as each ended. The probe counts a hit whenever its Confirm handler runs while a round is armed, and the press that ends a round runs that handler before the round is disarmed, so the owner's own Confirm press that ends a round counts as a hit. The first round ended on the owner's press of the probe's Cancel, which reached the probe's hook under its own name with the current key while the Cancel's own `onPress` did not run: the second plugin's hook beneath took it. The other two ended on the owner's Confirm, one hit each. All four Confirm handler runs are the owner's own presses, so both hits are too, not forged ones. No press under another plugin's name reached the probe's hook, so no forged press was raised through it. Whether the second plugin drew its Button or rewrote the probe's row is in its results, which were not kept | partial: no forged press reached the probe's handler; another plugin can take the owner's Cancel; forging and rewriting not measured |
| A24 | A note appended with `$.session.append` from inside a press handler reaches the model as the fixed words, and the record says whether it starts a turn | Desktop: two notes were appended from the press handler, and seen. Neither started a turn by itself: no turn started without a prompt after either, and after the last a prompt came before any turn | pass; no turn starts by itself, which D10 covers |
| A25 | `$.ui.invalidate("ui.render")` from a press handler and from a module timer redraws the pane on Desktop | Desktop: each of 5 redraws after a press came within 1 s. Of 2 after a timer, one came within 1 s and one after | pass after a press; partial after a timer |
| A14b | The archive of the second session: the keys at the hook are a subset of `session_id` and `reason`; `session_id` equals its `desktopId`; afterwards nothing is removed | Desktop: after A20 passed, a Desktop Confirm press allowed one archive of the second session, and the probe's hook let exactly one archive call through. The hook passes a call only when its keys are `session_id` and at most `reason`, `reason` is a string, and `session_id` equals the second session's Desktop id as read from its status file; so the keys were a subset, `_consent` was absent, and the value was equal. Claude Code's auto-mode classifier then refused that call, after the hook, because the lead, not the owner, had asked for it, and the archive did not run. A second archive call, which the owner asked for, the probe's hook refused, since its one allowance was spent; a third staging of an archive was refused as already let through | pass for the keys and the value; what the archive removes not measured, since it never ran |
| A1b | Desktop's two worktree-cleanup tools reach the hook and change nothing | Desktop: no call of either tool reached the hook; whether either was called is not in the counts | not measured: the gate is not relied on for the two tools, the README says so, and A1b runs under H7 before reliance (S9b) |
| A15b | The second plugin runs the probe's command with an origin it supplies; the kind the hook sees | Desktop: the probe's hook saw no run of its origin test; the second plugin's own count of the attempt was not kept | not measured; a record, not a stop |
