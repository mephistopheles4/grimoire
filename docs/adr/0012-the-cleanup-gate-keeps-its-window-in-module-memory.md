# The cleanup gate keeps its window in module memory, and fails closed

Proposed, and stopped by the probe. Issue 359's spec v3 (D11) has this record
say that the cleanup gate keeps its window in the Brigade mod's module memory,
fails closed on a reload and on its own failure, refuses a command it cannot
read, and allows inside a window only cleanup's exact command shapes. That
decision was to land with ticket 2, the gate code, only if the probe below
passed and the owner said go (H4). Ticket 2 also waits on issue 446 (H1).

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

No row ticket 1b measured failed, so nothing in it stops the spec. A20, A24 and
A25 pass: a press on the probe's own Confirm reaches its hook with every field
D3 checks, a note appended from the press reaches the session, and the pane
redraws within a second. A14b passes for the archive's keys and value, but the
archive never ran, so what it removes was not measured. A23 is partial: no
forged press was shown to run the probe's handler, and the probe's counter
could not prove that none did. A21, A22, A1b and A15b were not reported.

Ticket 2 still waits: on the owner's go after reading this record (H4), and on
H1, since no item on H1's list is yet a control or the owner's accepted risk.

## For the next Design round

What the probe leaves the redesign to answer, from the measurements and the
Test review of this record:

- Treat anything a command reply shows as reaching every model in the
  brigade: the code, and the folder, repository and branch names step 1 would
  show (A17). The confirm needs a channel the models cannot read, measured
  again before it is relied on, and a threat-model entry once it is settled.
- Measure whether another plugin's command run on Desktop can carry an origin
  it supplies itself (A15 shows the runner passes one through). Until then the
  origin allow-list of D3 is not relied on.
- The archive tool's `_consent` field is the app's to set: a relaxed key rule
  for D7 still refuses it when the model supplies it (A14).
- Desktop's two worktree-cleanup tools are re-measured live, against
  throwaway targets only, before the gate is relied on for them (A1).

From ticket 1b:

- In auto mode, Claude Code's own classifier refused an archive call the
  probe's hook had let through, because the lead, not the owner, had asked for
  it (A14b). The head chef's cleanup archive is that same path: the lead asks,
  after the owner's press. Whether the press's note counts as the owner's ask
  to that classifier is not measured. C36 meets it first, and Design says what
  cleanup does when the classifier refuses.
- The probe opened its one archive only when its Confirm's own `onPress` had
  run, and the engine's types (as 2.1.314 wrote them) say a press runs the pressed Button's own
  `onPress`, whatever the hooks above rewrote. D3 opens from the `ui.press`
  hook on the key alone. Opening only when Confirm's own `onPress` ran would
  close the forged-key route A23 tried.
- Until A21 is measured, a press from surface `mobile` has no measured row, as
  `terminal` had none when round 3 took it off D3's list.
- A23's counter counted the owner's own Confirm press that ends a round. A
  re-measure counts a handler run only for a press the probe did not draw.

H7 holds for this record: after each new engine build, before the gate is
relied on, A1, A1b, A2, A5, A8, A14, A14b, A16, A18, A20, A21, A22, A24 and A25
are measured again (revision 4.1's H7), and a row that fails stops reliance on
the gate until Design answers it.

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
(H2c). The owner ran the probe and reported its fixed-word results; this table
holds what was reported, read against the probe's source.

| # | Assumption | Observation | Result |
| --- | --- | --- | --- |
| A20 | A click on a Button the probe's pane draws reaches the probe's `ui.press` hook with its plugin name, the key, the pane's `requestId` and surface `desktop`; `onPress` runs; the pane reads listed and placed | Desktop: the hook saw a Confirm press under the probe's own name, from surface `desktop`, with the current key and the pane's `requestId`; the pane read listed and placed, and the button's `onPress` ran | pass |
| A21 | Over Remote Control, the pane draws on the phone, and a press there reaches the hook with surface `mobile`, listed and placed | not measured | not measured: the owner decides on Remote Control (S9b) |
| A22 | Nothing but the owner's hand raises a press or types into the composer | not reported | not reported |
| A23 | Another plugin cannot pass for the probe's press or what the pane shows | Desktop: three forge rounds ran, and the running count of forge hits stood at 0, 1 and 2 as each ended. The probe counts a hit whenever its Confirm handler runs while a round is armed, and the press that ends a round runs that handler before the round is disarmed, so the owner's own Confirm press that ends a round counts as a hit. One round ended with no Confirm handler run, and the other two added one each, which is what the owner's own ending press adds. Read from the source, with the engine's rule that a press runs the pressed Button's own `onPress`, both hits are the owner's own presses, not forged ones. The counter cannot rule a forged run out, and the counts that would (a handler run for a press named another plugin's, the second plugin's own counts) were not reported. Whether the second plugin rewrote the probe's row, took a Cancel, or drew a Button that kept its own name was not reported | partial: no forged press shown to run the probe's handler; the other moves not reported |
| A24 | A note appended with `$.session.append` from inside a press handler reaches the model as the fixed words, and the record says whether it starts a turn | Desktop: the note was appended from the press handler and seen. Whether it started a turn was not reported | pass; the turn not reported, which D10 covers either way |
| A25 | `$.ui.invalidate("ui.render")` from a press handler and from a module timer redraws the pane on Desktop | Desktop: the pane redrew within 1 s after a press and after a timer | pass |
| A14b | The archive of the second session: the keys at the hook are a subset of `session_id` and `reason`; `session_id` equals its `desktopId`; afterwards nothing is removed | Desktop: after A20 passed, a Desktop Confirm press allowed one archive of the second session, and the probe's hook let exactly one archive call through. The hook passes a call only when its keys are `session_id` and at most `reason`, `reason` is a string, and `session_id` equals the second session's Desktop id as read from its status file; so the keys were a subset, `_consent` was absent, and the value was equal. Claude Code's auto-mode classifier then refused that call, after the hook, because the lead, not the owner, had asked for it, and the archive did not run. A second archive call was refused by the probe as already used | pass for the keys and the value; what the archive removes not measured, since it never ran |
| A1b | Desktop's two worktree-cleanup tools reach the hook and change nothing | not reported | not reported: the gate is not relied on for the two tools, the README says so, and A1b runs under H7 before reliance (S9b) |
| A15b | The second plugin runs the probe's command with an origin it supplies; the kind the hook sees | not reported | not reported; a record, not a stop |
