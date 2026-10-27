# Security

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the "Report a vulnerability"
button under this repository's Security tab. It reaches the maintainer and
nobody else.

Do not open a public issue for a security problem. That includes anything that
would let a crafted file run script in a reader's browser, or change what an
agent does.

This is a personal project with one maintainer. There is no SLA and no bounty.
You will get an honest answer and, if the finding is real, a fix.

## Scope

**In scope:** everything in this repository. That means both manifests, every
`SKILL.md`, the renderers and page templates, the edge audit, the Brigade
mod in `brigade/` and `hooks/`, the check scripts, and the CI workflows.

**Out of scope:** Claude Code itself, your own box and flightpath files and what
you put in them, and wherever you host a page the renderer wrote.

## What this project is, in threat terms

grimoire is a set of agent skills and one Claude Code mod. A skill is prose an
agent follows, plus a renderer that turns a JSON file into one self-contained
HTML page. There is no server, no account and no database. Node runs the
renderer on your machine, and neither the renderer nor the page makes a network
request.

**The Brigade mod is code Claude Code runs in every session that has the
plugin.** It is a hooks module, `brigade/register.tsx`, named by
`hooks/hooks.json`, and it runs with the session's own rights. At session start
it registers `/brigade`, a `skill.prompt` hook, and the two hooks of its usage summary writer, below;
since 0.74.0 (#380) it also hooks the `Skill` tool's call, the typed `/head-chef` and `/grimoire:head-chef` commands, and each turn's start, and each of those passes on with no engine call unless a head-chef load is under way or a load left the pane waiting: where the security default skips `skill.prompt`, a model's head-chef load opens no pane and leaves one fixed note asking for `/brigade`, and a typed one that Claude Code itself answered opens the pane only after one read of the session's local skill list confirms the copy is grimoire's or the owner's; the notes are fixed rows added to the conversation, each starting "Brigade (plugin note):";
since 0.73.0 (#376) its `skill.prompt` hook reads each skill load's name, source and plugin name, acts only on a head-chef skill from a plugin named grimoire or from any user-level skill of that name, and on such a load opens the pane when it is closed, which starts the reads and the `gh` call below and offers `set_roster`, even when the model chose the load (when the engine does not place the pane, it starts none of that and shows a fixed toast naming `/brigade`), and appends one fixed line to that skill's text, never text from the event, the roster or an error;
since 0.69.0 it also reads one key, `permission-warning-ack`, from the
plugin's own store and offers a second tool, `show_permission_warning`, below;
and since 0.60.0 it is no longer idle by default
([ADR 0008](docs/adr/0008-brigade-is-no-longer-idle-by-default.md)). While its pane is open it reads
the engine's own session files, `<config>/sessions/<digits>.json`, for each
session's name, status, waiting reason, update time,
session id and folder, and its Desktop id and job id only to match a card to its
session, never kept. It never opens the key file
beside each by name; a hard link to it is not caught, as for transcripts, and
nothing is kept from a file that is not a session file. The files are the
engine's and undocumented, read as Claude Code 2.1.304 writes them (the background-session fields were measured on 2.1.302); when one
fails its checks the pane says it cannot read the session files. Since 0.67.0
it no longer runs `claude agents --json`, which made every running session do
work at once. It also reads the lead session's roster file from the plugin's
data folder, and reads other sessions' transcripts to find a session's link
and its model calls' usage, which gives each card its cache-warmth line and,
since 0.55.0, its context meter, and since 0.56.0, its burn rate and context
trend; of the model id it keeps only the window
size a fixed table gives the model's family.
To find a transcript that moved into a worktree folder, it lists the config
folder's `projects` folder at most once a minute, and reads a transcript only
where a resolving `stat` places it inside that folder.
For warmth and the context meter, a transcript is read again only when it
changes, and never when it is over 4 MiB. A working session's transcript is
read at most once a minute, and at most 5 of them a poll. For the link, a
transcript is read again only when its found path changes. It also reads this session's own usage, its rate limits and context, when the
pane opens and, while it stays open, each time the engine measures the
session, and once more for a typed head-chef load where the security default
skips `skill.prompt`, to read the skill list; it asks only for
the local summary estimate of the context breakdown, which sends no request.
On an Open in app press it reads three environment variables, `OS`,
`SystemRoot` and `windir`, only to tell whether each is set or `OS` is
`Windows_NT`; it never stores, shows or sends them.
It makes no network request of its own, apart from the `gh` call below; its
one tool call, below, goes to whatever connected server answers to the name
`ccd_window`. Besides each session's own usage summary, and since 0.81.0 the decision log and the owner's marks and since 0.83.0 the lead hand-off, all below, it writes one file, the lead session's roster,
through a tool the model calls, `set_roster`, which skips Claude Code's
permission prompt. So that write has no human and no classifier review; every
call is still recorded in the transcript as the tool's result. The tool exists
only once the owner runs `/brigade` or the head-chef skill loads, which offers it again when the pane is already open, or at the first turn that finds a pane the load left waiting shown, writes only while the pane is open, and
refuses a subagent's call, a deny verdict, an owner's ask rule, any input
outside the roster's shape and size, and any link on the way to the file. It
writes in every permission mode. It finds the Claude config folder from the install
location, else from the session-start record it keeps in plugin state, else from
Desktop's synced install folder. A deny rule for `mcp__grimoire__set_roster` removes it
from the session; the owner's own hooks do not stop it. The second tool,
`show_permission_warning`, is offered in every session from its start, so the
head chef can call it before its first launch with or without the pane. It
takes no input and writes no file: it draws the head chef's permission
warning above the prompt. It refuses a subagent's call, a deny verdict and an
owner's ask rule that names it. When the owner ticks "Don't show again" and
presses "I understand", it writes the time and a hash of the warning's
wording to the plugin's own store, under `permission-warning-ack`, and the
band stays hidden in later sessions until the wording changes. The band draws
that stored time only as a date. The store keeps it unencrypted until it is
removed, and the mod mirrors it in plugin state, which other plugins can read. When the owner presses
Open in app on a card with a Desktop id, it first calls the Claude Desktop
app's own tool, `open_session_in` on the server named `ccd_window`, sending
only that card's checked session id and the fixed target `split`, so the app
shows the session beside the lead. That call also skips the permission prompt,
and the owner's own hooks do not see it. It is made only where the Desktop app
draws the session, and only when the engine lists
`mcp__ccd_window__open_session_in` by that exact name and the engine's verdict
for it is not a deny or an ask naming a rule, so a deny or ask rule for that
tool stops it. An exact deny rule was seen to stop it on Desktop 2.1.289; a
rule for the whole server, `mcp__ccd_window`, rests on the engine matching it
the same way, which was not tried there. When that call is refused,
fails or takes over 5 seconds in all, or the card has no Desktop id, its one
other process, besides `gh`, is the host's opener, given a `claude://` link: `explorer.exe`
on Windows, as before, `/usr/bin/open` on macOS and `/usr/bin/xdg-open` on
Linux, the last two by absolute path. The absolute path pins only the opener:
on Linux it then starts its desktop helper, or a fallback browser, by name on
the inherited PATH. On a host it cannot identify it runs nothing.
**Since 0.64.0 the pane runs `gh`.** While its pane is open and a shown card
carries a pull request number, it runs `gh pr list` with one fixed argument
list, with at most one checked owner/name from a card's field passed as
`GH_REPO` in the run's environment, whose characters keep any host form out
(no host part such as `example.com/` can pass): once a minute per repository,
at most 6 runs a minute, the named repositories taking turns past five, with a
15-second limit and one run at a time. Since 0.85.0 a card may carry `repo`,
the owner/name of its pull request's repository when that is not the lead's
own; `set_roster` refuses any other value, and a roster file holding one fails
its read. The roster file keeps the field at rest with the rest of the card,
unencrypted, private repositories' names included, and the roster, `repo`
included, is also held in plugin state for the session, which other plugins
can read. For a named run, as for the base run, `gh` still chooses the host,
from `GH_HOST` or its own default; only github.com answers are drawn.
`gh` is the owner's own GitHub command line tool: the call sends the owner's
GitHub credential to GitHub, and it inherits the session's environment, keys
and tokens included. On Windows the engine was measured to run the real `gh`
from the system path, not a stub in the working folder. On macOS and Linux the
pane runs nothing when the inherited PATH has an empty or relative entry. The
environment and the working folder's git remotes choose the repository for
the cards that name none, and the pane pins the first answer's repository for
the session. A named repository's answer counts only when every pull request
in it names that repository, and its rows, up to 100, stay in module memory
and go once no card names it. A named card's pill and row name the
repository the card names, and link to its pull request only once `gh` has
answered for it. The titles and
repository names it gets, private ones included, are drawn on every surface;
its error text is never shown or stored.
Everything it reads is checked and drawn as text, in the usage image too.

**Since 0.60.0 every session that has the plugin writes its own usage
summary file**, whether or not it is in a brigade, from its first model call.
A per-call hook (`turn.step`) and a turn-end hook (`turn.complete`) keep the
session's own numbers in memory and write them, numbers only, to
`brigade/usage/<session id>.json` in the plugin's data folder: at most once
every 15 seconds while a turn runs, and at each turn end. The file holds one
exact list of keys: a format version, the time the numbers were taken (to
the end of that minute), the time of the last call and its context size, the context size of the last 30 calls, the new tokens of each of
the last 30 minutes, the model family's window size from the fixed table (the
one key a file may leave out, when the table has no row for the model), and
whether any call wrote or read cache. Never a model id, message id, text,
path, cost, rate limit or cache window; the writer makes no session usage call
at all. The write goes only where the roster's link-refusing path rule allows,
in a folder apart from the rosters, and overwrites only a file that is itself a
summary file, so a planted hard link to any file that is not a summary file is
refused; one to another summary file is not (below). The path rule
runs again after the write. On any refusal the writer stops until the plugin
reloads, a clear included, with one toast naming the kind of refusal in fixed
words. It asks no permission. What follows from it:
- **What the file reveals:** when each session last worked, its context size
  and its minute-by-minute burn, for every session the plugin ran in. The
  files are named by session id, so the folder is a lasting list of every
  session the plugin ran in, and the window size shows each one's model class. Any
  process running as the owner, other plugins, and anything that backs up or
  syncs the config folder can read it. It is not encrypted, like the
  transcripts beside it.
- **What does not reach the write:** no permission rule, mode, owner hook or
  classifier sees it, and it leaves no record in the transcript. Disabling the
  plugin is the only way to stop it.
- **What accumulates:** the mod never removes a summary file. There is one per
  session id, a clear or a resume starts a new one, and a file may outlast its
  transcript: Claude Code's own cleanup of old transcripts does not reach
  these files, and an uninstall that leaves the plugin's data folder leaves
  them too. The owner can delete the `brigade/usage/` folder by hand. A revert
  to an older version leaves sessions already running writing until they are
  restarted; delete the folder after that.
- **The race:** the check-and-write race the roster has now recurs in every
  session, with no hijacked lead needed, and a hard link between two
  summary-shaped files is not caught, as for rosters.
- **Since 0.61.0 the lead's pane reads the files** (issue #312): a summary
  file that passes its checks outranks the transcript at every size, with no
  check against it. A forged file from another process running as the owner can show any
  warmth, on members whose transcript is over 4 MiB too; row 15 names this gap,
  which the owner accepted. A step the transcript would not count restarts the
  hour, and a stopped writer leaves a card reading colder once the member is
  idle, with its meter and burn frozen, and it can draw a hand-off nudge on a
  warm cache. The 1-hour window's known limit, in the README, still applies.
  Four more gaps, each named in row 15:
  - other plugins can read and rewrite the pane's list of refused summary
    files, and so plant or hide a refusal line;
  - the summary read follows a link swapped in after the path check, as the
    transcript read does, and keeps only checked numbers;
  - a session named like a card, or holding its id, feeds that card from its own summary file,
    a session with no working folder included;
  - a writer whose files keep failing a check with fresh times freezes its
    card on the last good record with no line to say so, which the owner
    accepted.

**Since 0.81.0 a lead writes a decision log, and the pane writes the
owner's marks** (spec 402, ticket 1;
[ADR 0010](docs/adr/0010-the-mod-keeps-decision-text-in-plain-files.md)).
The mod offers a third tool, `log_decision`, wherever it offers `set_roster`.
It appends one entry per call to the lead session's own log,
`brigade/decisions/<session id>.json` in the plugin's data folder: the
entry's source (`lead` or `relayed`), whether it waits for the owner, its
work, question, options, pick, reason, how to undo it, when to revisit it and
which waiting entry it answers. The mod stamps the entry's id, its time from
the engine clock and the level in force (since 0.84.0, the level
`read_autonomy` would answer),
and refuses an input that carries any of them, a source other than `lead` or
`relayed`, or a field holding a control, hidden or direction-changing
character, text shaped like a session id, a Desktop id or a Remote Control
link, a value shaped like a known key, an email address or a home-folder
path; the refusal names the shape, never the value. Like `set_roster`
it skips the permission prompt in every mode, works only while the pane is
listed and placed with its reads running, and refuses a subagent's call, a
deny verdict, an owner's ask rule and an organisation ceiling below allow;
each refusal is fixed words naming the rule, never a path, a verdict's reason
or an engine message. A deny rule for `mcp__grimoire__log_decision` removes it.
Its writes take turns in one queue, a log keeps at most 500 entries and 256
KiB, and past a cap it drops only entries the owner marked read and did not
flag, oldest first; with nothing to drop it refuses and the file is
unchanged. To tell which entries are read it lists the `brigade/marks/`
folder and reads every marks file there. When the owner presses "✓ Read,
next", "⚑ Flag" or "⚑ Unflag" in the pane's Decisions tab, or Dismiss on its
picked Flagged rows (since 0.82.0, spec 402 ticket 2), the pane writes a mark
for each entry, the log's session id, the entry's id and time, the state
(read, flagged or unflagged) and the press time, in one write, to its own
session's marks file, `brigade/marks/<session id>.json`, at most 2,000 marks
and 64 KiB. Both files go only where the roster's link-refusing path rule
allows, overwrite only a file that passes the strict check of its own kind,
and are checked again after the write. While the pane is open, and only then,
it lists both folders on the roster's 5-second poll, reads this session's own
log and marks file and the 20 newest others of each by modification time,
re-reads a file only when its size or time changed, skips a file dated more
than two minutes ahead, reads no other file from a folder whose listing passes
5,000 entries, and draws each log's writer by the engine's session name for
its session id, or "an ended session". Nothing it reads enters plugin state
but the search text, which other plugins can read until the next open clears
it, and a redraw counter. The project digest comes from the mod's own unkeyed
SHA-256 in `brigade/decisions.ts`, tested against the NIST vectors and Node's
own hash; it protects nothing secret. What follows from it:
- **What the files reveal:** every decision a lead logged, its reason and the
  options it weighed, waiting entries that hold decisions the owner keeps,
  each entry's level, and which entries the owner read and when, and, since 0.82.0, which the owner flagged to revisit and when each was unflagged or dismissed. The files are
  named by session id, a mark names the session id of the log it marks, and
  each log holds a plain, unkeyed SHA-256 digest of the working folder's
  transcript-folder name, never the name, which a reader who can list the
  projects folder can match. Any process running as the owner, other plugins,
  and anything that backs up or syncs the config folder can read them. They
  are not encrypted; the owner accepted this on 2026-10-26 (q9 A on #402).
  Other local accounts that can read the profile's data folder can read them
  too, since the engine's write takes no file mode; the owner accepted this on
  2026-10-26 (q11 A on #402's ticket 411).
- **What does not reach the write:** no permission prompt, mode, owner hook or
  classifier sees `log_decision`'s write or a mark's; each call is recorded in
  the transcript as the tool's result, and a mark is not.
- **What accumulates:** the mod never removes a log or a marks file. There is
  one of each per session id, and they outlast transcript cleanup and an
  uninstall that leaves the plugin's data folder. The owner can delete the
  `brigade/decisions/` and `brigade/marks/` folders by hand.
- **The race and planted files:** the roster's check-and-write race recurs for
  both writers, and a hard link between two files of one kind passes the
  strict check. Anything that can write the data folder can plant a
  well-formed log or marks file, current-dated marks that hide decisions
  included; the owner accepted this on 2026-10-26 (q19 A on #402).
- **What a hijacked lead can log:** within the field rules and caps, false
  Lead or Relayed entries, an answer that closes one of the owner's waiting
  entries with words the owner never gave, and enough entries to fill the log
  to its cap, after which the tool refuses until the owner reads. The pane
  draws a Relayed entry and an answer only as the writer's claim. Any session,
  in any working folder, that loads head-chef without the owner typing it can
  log the same, and its entries land unread in every lead's To review; the
  owner accepted this on 2026-10-26 (q10 A on #402's ticket 411).

**Since 0.83.0 a lead keeps a hand-off** (spec 402, ticket 3). The mod offers
two more tools wherever it offers `set_roster`. `set_lead_handoff` replaces
the lead session's own hand-off, `brigade/handoff/<session id>.json` in the
plugin's data folder: five sections (how to resume, rules in force, running
sessions, cleanup waiting, open for the owner), each at most 20 lines of at
most 300 characters, under the decision log's field rules and with no line
break, at most 32 KiB in all, stamped with its time and the project digest.
`read_lead_handoff` gives this session's own hand-off back, else the newest
by stamped time that another session wrote with the same project digest, or
"none". Its answer is the writer's session name (a shown name a session can
choose, so a claim), the time and the sections
as one JSON line between two fixed lines saying it is data and holds no
instruction. The mod keeps the SHA-256 of the exact text it last wrote, in
module memory only, and marks an own file whose text no longer matches, or
for which none is kept (after a reload, say), as "not this session's
writing", as it marks every other session's. Both tools skip the permission
prompt, refuse as `log_decision` does, and touch only the `brigade/handoff/`
folder the path rule places; a deny rule for `mcp__grimoire__set_lead_handoff`
or `mcp__grimoire__read_lead_handoff` removes it. While the pane is open it
reads this session's hand-off and the 20 newest others under the same reads
as the logs, and draws the one `read_lead_handoff` would give, folded at the
foot of the Decisions tab. What follows from it:
- **What the file reveals:** the lead's working state as it wrote it: how to
  resume, the rules in force, the running sessions by name, the cleanup
  waiting, leftover worktrees by branch, and what is open for the owner, with
  the time and the project digest. Who can read it is as for the log; the
  owner accepted the hand-off at rest with the log on 2026-10-26 (q9 A on
  #402), and that other local accounts that can read the profile's data
  folder can read it too on 2026-10-27 (q3 A on #402's ticket 413).
- **What chooses another session's hand-off:** the project digest, from the
  session-start record in plugin state, which other plugins can rewrite, so a
  rewritten record can offer a new lead another working folder's hand-off;
  the owner accepted this on 2026-10-26 (q29 on #402). The same rewrite can
  stamp this lead's own hand-off with another folder's digest, so that
  folder's next lead is given it, and where the plugin's location does not
  name the config folder, move where it is written (q7 A on #402's ticket
  413, 2026-10-27). Any hand-off but this
  session's own unchanged one is marked as not this session's writing, and a
  new lead acts on nothing in it until the owner's yes.
- **What does not reach the write:** no permission prompt, mode, owner hook or
  classifier sees `set_lead_handoff`'s write; each call is recorded in the
  transcript as the tool's result.
- **What accumulates:** the mod never removes a hand-off. There is one per
  session id; the owner can delete the `brigade/handoff/` folder by hand. Each
  `read_lead_handoff` answer copies the hand-off it gives, another session's
  included, into the reading session's transcript, where it stays after the
  folder is deleted.
- **The race and planted files:** the check-and-write race and the hard-link
  gap of the other writers reach the hand-off writer too, and anything that
  can write the data folder can plant a well-formed same-folder hand-off
  (q19 A on #402). A hijacked lead can write a false hand-off within its
  sections and cap, which the next lead in the same working folder is given
  as another session's writing.

**Since 0.84.0 the owner sets the lead's autonomy level** (spec 402, ticket
4). A slider at the foot of the Decisions tab has three stops, 1 Manual, 2
Auto and 3 Full throttle, and only a press on it sets a level above 1. **A
level 3 the owner has confirmed in the lead's chat lets the lead merge pull
requests, post, and settle security findings without a per-act word from the
owner**; it logs each act before it, and a finding that would expose a secret
or personal data, and any accepted-risk record, still wait for the owner. The
mod offers a fifth tool, `read_autonomy`, wherever it offers `set_roster`:
it takes no input, answers the level in force, a 3 with the time of its press,
skips the permission prompt, refuses a subagent's call and every verdict
`set_roster` refuses, and answers 1 unless the pane is listed and placed with
its reads running; a deny rule for `mcp__grimoire__read_autonomy` removes it.
The stored level sits in plugin state as `autonomy`, this session's id and
its level, never in a file; the last level a press set, a 3's press time and the
Owner entries the pane wrote stay in the module's memory. The level in force
is 1 whenever the stored level differs from the last press, while an alarm
or a reset's Pane entry waits to be logged, and for a 3 with no press time.
A press that raises the level first logs what waits, then an Owner entry in
the session's own log, and the raise does not happen if that cannot be
written; a lowering always happens. Each new
lead session starts at 1; a showing that makes the pane shown and a reload of
the mod reset a level above 1 to 1 with a Pane entry; a session start or reload
that finds a stored level above 1 writes it even with the pane closed, the one
file a session start writes. A Pane entry that cannot be written keeps the
level at 1 and is tried again at the next poll, as an alarm is; an entry
written late carries the time it was written. A clear or a resume
forgets every other session's level and press time, writing no entry; an
alarm still waiting is logged once its session comes back. At each 5-second poll a
stored level that differs from the last press is set to 1 and logged as one
unread alarm, tried again at the next poll if it cannot be written; while an
alarm the pane wrote is unread, a repeat is counted in the pane, not logged,
unless the marks cannot be read. The pane
draws the level in force on every tab, level 3 in the warning colour. What
follows from it:
- **What the log reveals:** each entry's level, and the times of the owner's
  slider moves, of the resets and of the alarms, which show roughly when the
  owner let the lead run alone. Owner, Pane and alarm entries never drop.
- **Who can move it:** another plugin can read `autonomy`, and so learn when
  the owner let the lead run alone, and can rewrite it or press the
  slider, and so raise the level the lead reads; a rewrite reads as 1 and
  raises an alarm, and a press by another plugin is logged as the owner's.
  The owner accepted this on 2026-10-26, and again for level 3 (q2 and q32 A
  on #402). The head-chef skill's level rules (spec 402, ticket 6) are to
  have the lead ask the owner once in its own chat before it acts on a 3;
  until they land, the skill says nothing of levels, but `read_autonomy`'s
  own description asks the lead to read the level before each decision it
  would take itself. That description, and every answer that names a 3, say
  that a 3 counts only once the owner confirms that press in the lead's chat,
  never on a confirmation given for an earlier press time, and
  that at every level a finding that would expose a secret or personal data,
  and any accepted-risk record, wait for the owner.
- **Where the level is copied:** each answer of `read_autonomy`,
  `log_decision` and `set_lead_handoff` names the level in the lead's
  transcript, and `read_autonomy`'s names a 3's press time, where they stay
  after the log is deleted.
- **What does not reach it:** no permission prompt, mode, owner hook or
  classifier sees `read_autonomy`'s answer, the pane's Owner, Pane and alarm
  writes, or a press.

Review any change under
`brigade/` or `hooks/` as a change to code that runs on every installer's
machine: [row 15 of the threat model](docs/security/threat-model.md#the-matrix)
has the guards and the gaps.

**One skill tells the agent to start other agent sessions and to delete their
worktrees: head-chef.** The agent starts and archives Desktop sessions with
Claude Desktop's session tools, and runs `git worktree remove` and
`git branch -d` for cleanup, only on the owner's own words in chat. From
0.9.0 it starts no background session. A session takes any message from the
head chef that passes its sender check as a relayed decision, on any matter,
labelled as relayed and never as the owner's own words. The check compares
the sender's shown name with the session list, as text, so any session that
can send it a message under that name can speak for the lead, unless another
row holds the name too. The owner accepted the forged-sender risk of the
0.5.0 form on 2026-10-09, and the 0.9.0 form, a relayed decision bound to the
shown name alone, on 2026-10-21; row 16 of the threat model records both,
with the other risks of 0.9.0 the owner accepted. Before
its first launch in a lead, the Brigade mod's permission warning says so above
the prompt. Each turn the head chef reads the engine's own session files, in
the config folder's `sessions` folder beside each session's key file, for each
session's name, id and status, and its folder at cleanup: only digit-named `.json` files that are not links and at most 8 KiB, and never the key files.
The pane's own read of those files, with its stronger checks, is above. head-chef runs no script of its own. What leaves the session:
sessions post their own milestone content, signed, on records that may be
public, and the owner's own process, not the skill, sets what they post,
except that the start prompt bars a token or secret; on
the owner's own words in its chat, the head chef merges, closes, edits,
deletes or labels a record, files an issue or posts a comment; the head
chef's own questions and decisions go by message only; and Remote Control,
while it is on,
makes each session it starts, with its transcript, drivable and readable from
any device signed in to the owner's account.
[Row 16 of the threat model](docs/security/threat-model.md#the-matrix) has the
guards and the gaps.

One script can send data, and only when somebody runs it. eagle-eye's
optional edge audit sends to a provider: see
[What the edge audit sends](#what-the-edge-audit-sends).

No script in the tree rewrites a file a person hands it. The contract skill
validates what it builds with `claude plugin validate --strict`, the standard
tool, run on the folder that holds the built skill or agent. That command is
Claude Code's, not this repository's. Its pass says the frontmatter parses and a
manifest matches the schema; it reads no key's meaning, and it may read no agent,
CLAUDE.md or Codex file at all. It says nothing about who reviewed anything. When the command is not available, the skill says
the file was not validated. The skill shows the validator's output as printed,
which may repeat file paths and text from the file. Nothing seals a generated
file: git history shows a hand edit, and a reviewer reads every changed file in
full. Nothing warns any more on a setting that lets an agent act without the
person's approval, or sends the agent's work to a server the file names; the
person reads those keys.

The attacks worth planning for, scenario by scenario, with what stops each
one and what still gets through: [docs/security/threat-model.md](docs/security/threat-model.md).
It records the repository settings as they were read on 2026-09-25, and the
plugin validator's required check as confirmed on 2026-10-09. The
[platform table](#what-the-platform-is-relied-on-for) below lists what the
project relies on, which is not always what is switched on.

The realistic risks:

- **A file from a stranger.** Box and flightpath files are made to be shared. A
  file you did not write becomes a page you open, with its text in the page.
  This is the main risk here.
- **A skill is an instruction file an agent obeys.** Whoever can change a
  `SKILL.md` can change what an agent does on a reader's machine. Branch
  protection guards this. `scripts/check.mjs` also refuses a `SKILL.md`
  frontmatter key outside `name`, `description`, `compatibility`, `license`,
  `allowed-tools` and `metadata`, so a `hooks` key cannot merge unseen, and
  any file under `skills/`, the root `package.json`, `tests/container/`,
  `.claude/settings.json` or `scripts/agent-check-guard.mjs` that
  holds a control character other than tab,
  line feed and carriage return, a lone carriage return, DEL, U+2028, U+2029,
  U+FFFE, U+FFFF, a default ignorable code point (tag characters, zero-width
  characters, the soft hyphen, variation selectors) or a bidi control, which
  could make the reviewed diff differ from what the model reads. A BOM is
  allowed as a file's first character only.
- **The mod is code that runs in every session.** Whoever can change
  `brigade/` or `hooks/` changes what runs in every session of every
  installer. Branch protection and `scripts/check.mjs`, which holds the mod to
  its folders, guard this. The SkillSpector job scans `skills/` only, so it
  does not read the mod.
- **A dependency.** The renderers import Node built-in modules only, so there is
  no dependency tree to poison. That is true now, not a promise about later.
  `scripts/check.mjs` fails on a lockfile and on any `package.json` except a
  root one holding only an `athanor` key, which athanor reads to run the check
  in a container. That file carries no dependency, script or other key, and
  its build folder is held to `tests/container/` with no `inputs` and no
  symbolic link there, because the image build has network access. The check
  also refuses a root `binding.gyp`. That hold runs inside the check, after
  athanor has built the image from the branch, so it protects what merges and
  not a run on a branch nobody has read: there, reading `tests/container/` and
  the `athanor` key is the guard.
- **An API key in the environment.** The edge audit reads one and sends it as a
  bearer token. Review any change to `skills/eagle-eye/audit.mjs`, its
  endpoints, or how it picks a key as a change that could send a key elsewhere.

## Pages built from a stranger's text

**Author text is escaped for element content and never reaches an HTML
attribute.** Both pages escape `&` and `<`, and deliberately not the double
quote. That narrow escape is enough only because every attribute holds an id,
a number or a fixed string. Ids are validated against a strict pattern.

- **Adding an attribute that carries author text needs a different escape.**
  Treat any new `="${` in a template as a security change.
- **Nothing from a file is safe as an object key, ids included.** An id like
  `constructor` passes validation but collides with `Object.prototype`. Use
  maps with no prototype.
- **The pages make no network request.** Fonts are vendored and inlined, and
  tests assert zero external references on every page and the site index.
- **The escape lives in a module, not in the template**, because a function
  inside a template is a function no test can reach. Tests pin its exact width.

The details, the tests, and what they do not cover:
[`docs/security/rendering.md`](docs/security/rendering.md).

## What the edge audit sends

`skills/eagle-eye/audit.mjs` asks a model provider to rank a box's `argued`
edges for rereading. It is the only file here that opens a connection, and it
is opt-in twice: it needs a key in the environment, and the skill runs it only
after the user says yes.

- **What leaves the machine.** For each argued edge: the box's `problem`, the
  edge's `why`, and both options' labels, rows, `why`, `notes` and `src`.
  Nothing else from the disk. `--dry-run` prints a request and sends nothing.
- **Who receives it.** TypeSafe directly, or TypeSafe through OpenRouter. Never
  both, and never one as a fallback. What they do with the text is their
  policy. Do not audit a box whose text you would not send.
- **The key.** Read from `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` only. It is
  never printed or written, and a key in the wrong variable is refused before
  anything is sent.
- **What it never does.** It never writes the box, never changes an edge's
  tier, keeps no cache, and never runs in the tests or in CI.

The full account, including endpoints, provider logging opt-ins, exit codes and
the test override: [`docs/security/edge-audit.md`](docs/security/edge-audit.md).

## Scanners in CI

- **CodeQL** reads the JavaScript, including the page templates.
- **SkillSpector** reads each skill's prose and fails on any finding the
  baseline does not cover, and on any file it reads only in part. A partial
  read is the one exception, when someone has accepted it by name, with a
  reason, for one of two reason codes, and pinned it to the file's content so
  any edit to it shows in review. A finding that only reports a reference to
  such a file passes too, when its count matches. See
  [Partial reads](docs/security/scanners.md#partial-reads). Every suppression
  carries a written reason. In eagle-eye, groundtrack and head-chef each
  entry is narrowed to the file it fires on (head-chef's TR2 keeps the root's
  star), for a scan of the skill's own folder. The root file stays rule-wide, for a scan of the whole repository:
  there E1 and PE3 still hide a send or a credential read in any file, the
  mod's included. The contract skill keeps P2 and RA2 off for all of the
  skill, and MP1 for its change log only; head-chef keeps P2 off for all of its
  `SKILL.md`, and EA2 for its `SKILL.md` and `references/CONTRACT.md`. So an instruction hidden there in a comment, a
  link-reference comment or a base64 data link, or an instruction to persist
  on the machine (a scheduled job, a startup or profile file, a background
  process or a hidden folder), would pass the scan. Rule 2c refuses invisible
  characters. The scan does not hold which providers receive the box text and
  the key from the edge audit; review does, and a test holds the hosts written
  as URLs in its source to two, all https.
- **zizmor** audits the workflows and fails on any finding. There is no
  baseline, because there is nothing to suppress.
- **Every action is pinned to a commit SHA**, and zizmor checks each SHA
  matches its version comment.
- **Claude Code's plugin validator** checks the two manifests and `skills/`
  against the schema Claude Code loads, at a pinned version. It fails on any
  field it does not recognise in either manifest; its check of `skills/` is
  weaker. It is a schema check, not a security scanner.

A scan that errors or reads only part of the tree fails, rather than passing
quietly, unless the partial read is one accepted by name. What each scanner covers, what it suppresses, and why:
[`docs/security/scanners.md`](docs/security/scanners.md).

## What the platform is relied on for

Part of this project's defence is GitHub settings, not files. A clone cannot
read them, so this table says what the project **relies on**, not what is
switched on right now. If that matters to you, check the settings themselves.

| Setting | What it provides |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including the page templates |
| Private vulnerability reporting | the channel at the top of this file |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| SkillSpector's `scan` job as a required check | a SkillSpector finding blocks a merge |
| zizmor's `audit` job as a required check | a workflow finding blocks a merge |
| Plugin validator's `validate` job as a required check | a manifest or skill the schema rejects blocks a merge |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

[`.github/dependabot.yml`](.github/dependabot.yml) is in the tree and asks for
weekly `github-actions` updates. Those are version updates. Security updates
are the setting above.

## What is deliberately not defended against

- **A file you chose to open.** The renderer runs on your machine, on a file you
  pointed it at. Read a file from someone you do not trust first.
- **A skill you chose to install.** An agent reads a skill's prose and acts on
  it. That is the product working. Read a skill before you install it, here or
  anywhere.
- **What the provider does with a box you chose to audit.** After a yes, the
  text is under the provider's policy.
- **A malicious maintainer account.** Branch protection raises the cost of a
  bad commit. It does not survive a stolen admin account.
- **A skill, an agent and a contract from someone else.** A pass of
  `claude plugin validate --strict` says a frontmatter parses, not that anyone
  reviewed the file. Read the files first. The eagle-eye skill still
  carries seal marks from the old check, the `familiar-digest` and
  `contract-digest` lines in its `SKILL.md` metadata; they are inert and prove
  nothing, and go when it is next amended. The contract and head-chef skills
  carry none.
