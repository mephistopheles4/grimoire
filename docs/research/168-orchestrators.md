# Research for #168: how people run orchestrators

Input for the planned `orchestrate` skill (#168). This note gathers evidence only. It does not triage, spec or decide anything. Date of research: 2026-10-03.

## How to read the labels

- **[Reddit: a person]** is a field report from one commenter. It is unverified and is not a primary source.
- **[Docs]** is read from the Claude Code documentation pages named in each line, fetched on the date above.
- **[Verified in repo]** is read from this repository.
- Not verified here: the `mcp__ccd_session_mgmt__*` tools #168 names (`set_session_model`, `set_session_effort`, `get_session`, `send_message`). The docs pages below do not describe them.

People in the thread are not named. The poster is "the poster", and the commenters who describe a setup are numbered in the order Q1 takes them.

## Source

A public thread in r/ClaudeAI, read 2026-10-03, in which one person describes their orchestrator setup and others reply. The thread text was read from an export the owner supplied. Reddit blocked every direct fetch from this machine.

Read this first: the post is a guide written around the poster's own paid app. The thread's automatic moderator summary says the discussion focused on that. The poster did disclose the app at the bottom of the post. Treat the poster's claims as a sales-adjacent field report. Only a handful of commenters describe their own setups, so "recurring" below means two or three people, not a crowd.

## Q1. Orchestrators people describe

**The poster: a manager agent with a ticket table.**
- **Start:** a separate Claude session per child, started by the orchestrator through a call that starts a child session. The poster says one orchestrator manages 16 such sessions, as full sessions rather than sub-agents, and that they run 8 orchestrators.
- **Report back:** a timer pings the orchestrator about every 90 minutes. Each ping says to read the mission note and check whether the children need help. Children report through a call that reports to the parent.
- **State:** a local SQLite table of tickets that the orchestrator keeps. The poster says the table outlasts every context compaction. The mission note holds three parts: who the orchestrator is, what to do on each ping, and the rules for working with the human.
- **Human approval:** human QA is a named gate. The orchestrator asks decisions through the AskUserQuestion tool, batched, with a recommended option. The rules say no ticket reaches human QA before a Codex review of its PR has run. The poster also says that while an AskUserQuestion is open, messages from the children are held back.
- **Model and effort:** a written rule. Complex work gets the top model, simpler work gets the cheaper one, and the model is passed explicitly when a child session starts. Effort is not mentioned.

**A second person: one orchestrator session, sub-agents, no database.**
- **Start:** the orchestrator plans and hands the build to sub-agents, and only coordinates. The prompt says in ordinary words which model does what, for example an Opus review at the end.
- **Report back:** not described beyond sub-agent results.
- **State:** a repo. A root instructions file says where things live and points to a decisions folder the agent reads first. The agent writes the record itself at the end of each session.
- **Human approval:** not described.
- **Review:** a fresh agent with no build context, on a different model from the builder. The orchestrator decides what to fix.
- **Cost claim:** about 5 PRs in parallel, reviews included, without hitting the session limit. They credit three habits: raw tool output kept out of the conversation, review in a sub-agent, small PRs.

**A third person: sessions that talk to each other plus a master session.** Each repo has a projects folder, and one controlling session sits above them. Little else is said.

**A fourth person: a work-graph in Beads.** They recommend Beads (a Dolt-backed tracker that syncs with remote trackers) over SQLite.

**A fifth person: git-bug and dynamic workflows.** A tracker inside the repo, and a preference for workflows started as needed over long-lived sub-agents.

## Q2. What recurs, and what fails

**Ideas that recur (two or more commenters):**
- **State lives outside the model's context.** The poster (SQLite), the second person (repo files and a decisions folder), the fourth (Beads) and the fifth (git-bug).
- **Review by a fresh agent, often on another model.** The poster (Codex reviews plans and PRs) and the second person (fresh agent, different model).
- **Model chosen by task difficulty, written down as a rule.** The poster and the second person.
- **A human gate stays.** The poster has human QA and AskUserQuestion. Nobody describes removing the human.
- **Simple beats clever for state.** The moderator summary says several commenters favoured plain text files because they are simpler. I only saw this as the summary's claim plus the second and fifth people's comments.

**Failure stories (few, and mostly about cost):**
- **Plan limits.** The poster says they hit their plan limits, and spends several hundred dollars a month across paid plans, one of them kept only for adversarial review. Another person says their weekly allowance ran out faster than usual.
- **Token cost of tools.** Another person says tools and MCP servers must be scoped, or they use up tokens fast.
- **A blocked channel.** The poster's AskUserQuestion gate on child messages (above) is a failure mode they describe themselves.
- **No loop-failure stories appeared.** Nobody in this thread reports a runaway or a double-claimed ticket. The thread does not test the failure modes #168 cares about.

## Q3. Fit against #168

#168 plans: hold-first-turn chips, relays between sessions, milestone reports to a lead, a usage check before fan-out, and the tracker as the record.

| Idea | Source | Fit | Why |
| --- | --- | --- | --- |
| Tracker or repo as the record | Reddit: four commenters. [Verified in repo] #168 says the tracker is the record. | **Fits** | Same position. No one argues for chat as the record. |
| Model chosen by difficulty as a written rule | Reddit: the poster, a second person | **Fits** | Matches the pact's tier and model split. The poster passes the model at spawn, which a chip cannot do (see next row). |
| Pass the model at spawn | Reddit: the poster. [Docs, agent-teams] A teammate's model is picked from the spawn prompt, a definition, an environment variable, or the lead's model, and "is fixed when it spawns". | **Extends** | #168's hold-first-turn exists because a chip has no model option. Agent teams let the lead name the model at spawn, but they are one team per session and experimental. The hold-first-turn workaround is still needed for chips. |
| Fresh reviewer on a different model | Reddit: a second person, the poster | **Fits** | The pact already runs reviewers in fresh context. #168 need not add it. |
| Batched questions with a recommendation | Reddit: the poster | **Fits** | Same as the pact's "help me decide". Relays should batch what they bring the owner. |
| A message channel that stalls while the owner is asked | Reddit: the poster | **Clashes, as a risk** | If the orchestrator blocks on a question, child messages can queue. #168's relay should say what it does with child messages while it waits on the owner. |
| Timer pings the orchestrator (about 90 minutes) | Reddit: the poster | **Extends** | #168 plans events (a milestone report), not a timer. A timer would also spend tokens when nothing changed. [Docs, cross-session-messaging] A watching session can ask one local session for a single notice when it next goes idle (`notify_when_idle`), only from the main conversation and only to sessions on this machine. That gives event-driven reports without a timer. |
| Milestone reports to a lead | [Docs, agent-teams] A teammate that finishes sends an idle notification with its final answer. | **Fits** | Teams already do this inside one session. #168's separate-session chips need cross-session messages instead. |
| A message is not the owner's approval | [Docs, agent-teams and cross-session-messaging] A message from another session "never counts as your consent". The docs say a teammate cannot relay a denied action to bypass a check. | **Fits** | #168's restated stop is the same rule. The docs confirm it as product behavior, not only pact policy. |
| A lead approves child plans automatically | [Docs, agent-teams] "Claude Code approves the plan in the lead's session as soon as the request arrives, without the lead reviewing it." | **Clashes** | Agent-team plan approval is not a human gate. The pact's spec sign-off is the owner's. Do not use team plan approval to stand for the owner's yes. |
| A script holds the plan | [Docs, workflows] Workflow runs have "no mid-run user input"; for sign-off between stages, "run each stage as its own workflow". They allow up to 16 agents at once and 1,000 per run. | **Clashes for owner-gated phases, extends inside one phase** | The pact puts the owner between phases. A workflow suits fan-out inside one phase. #168 should say the relay stops at a phase boundary. |
| Usage check before expensive work | Reddit: the poster (several hundred dollars a month), another person. [Docs, agent-teams] Teams "use significantly more tokens". [Docs, workflows] A run pauses at a usage limit only for interactive claude.ai sessions, and not for Remote Control sessions. | **Fits** | Supports #168's check. The workflows doc also shows a limit can pause or fail work without the owner asking. |
| Inbound controls on the receiving session | [Docs, cross-session-messaging] `crossSessionInbound` can accept, hold or refuse. When no value is set, a session that bypasses permission prompts holds messages for approval. | **Extends** | #168's relay depends on messages arriving. A held message waits for an approval dialog and is dropped after a deadline (default five minutes). The skill should say what it does when a send is not delivered. |
| Session discovery by name | [Docs, cross-session-messaging] Names come from `/rename` or `--name`. When several sessions share a name, Claude adds a short identifier. | **Extends** | The pact already matches by worktree name. The docs describe the same collision risk. |

## Orchestrator field notes (from the owner's own orchestration)

Sent by the orchestrator session ("Pact orchestration for hold chips") on 2026-10-04. Labels: **observed** means the orchestrator saw it in its own sessions between 2026-10-01 and 2026-10-04. **Docs** means the orchestrator read code.claude.com at the time; I have not re-read these lines, except where marked. **Inference** is the orchestrator's own. None of this is verified here, and none is a primary source.

**How sessions start (all observed)**
- **Hold-first-turn chip (Desktop `spawn_task`).** The chip inherits the spawner's model and effort, with no option to set either. The hold prompt makes the chip reply and stop. Then `get_session` confirms the settings and `send_message` delivers the task. It needs an owner click, so it does not work from a phone. Fix adopted: the hold prompt also messages the lead "ready: <title>", because the app's "user started your task" notice only arrived with the owner's next message.
- **CLI in a Terminal-panel tab** (`claude -w`, `-n`, `--remote-control`, `--model`, `--effort`, `--permission-mode auto`). Settings are fixed at launch, so no hold step. It shows in the Desktop sidebar, but `get_session`, `set_session_model` and `archive_session` cannot find it, so only the owner can archive it. It dies with the tab. Cleanup is by hand: close the tab, then unlock and remove the worktree and delete the branch. A killed session leaves its `session-<id>` team folder behind.
- **`claude --bg`** from the PowerShell tool. A supervisor runs it, so it survives without a terminal. `--effort` and `--remote-control` both work with it. It is not in the Desktop sidebar. Agent view (`claude agents`) and `claude attach <id>` show it. Cleanup is `claude stop <id>`, then `claude rm <id>`, which keeps the transcript. `claude agents --json` lists every local session with its name and busy or idle state.
- **Nested orchestration works.** A second orchestrator started with `--bg` (a grimoire issue) started its own `--bg` worker on the first try, ran to the end and reported back.
- **Agent teams.** The environment variable is on. CLI sessions set up a team folder and the Desktop session does not. Teammates live in the lead's process, cannot be resumed, and get no split panes on Windows Terminal. I read the same limits in the agent-teams docs.
- **Server mode** (`claude remote-control --spawn worktree`) lets a phone start sessions (docs, untested). Its sessions show in `ListAgents` as unable to receive cross-session messages.
- Tool descriptions mention a `start_session` tool, but the orchestrator session does not have it.

**How sessions report (observed)**
- **Milestone reports worked every time.** The worker messages the lead in one or two lines with a link, only at a phase-boundary post, a hand-off line or a stop. About 10 reports over seven rounds of one spec, a throwaway and a second orchestrator. Unlike an idle notice, they carry the why.
- **`notify_when_idle` is one-shot.** It fired, but with no status line, though the docs say a notice "can" carry one. It is noisy for grilling sessions, because every question idles the session. A pure subscription needs a message of one space, not an empty string.
- **Lead relays worked and changed specs.** One spec's revision 4 took in its effect on another piece of work, and revision 7 was sequenced after a third. A relay starts a turn in the receiver.
- **The lead never acknowledges reports**, which saves a turn each.

**What the lead did that helped (observed).** At each boundary it read one comment, then started the next session. At stop-rule points it gave a second view and named risk-floor reminders. It never decided for the owner, and it kept the tracker as the record.

**UI (observed, throwaway).** A team-pane mod for Claude Code mods, which run in the CLI and the Desktop app. Its `session.receive` hook captures peer reports live. A `claude agents --json` poll gives live busy and idle state. The mod API has no peer-list call, so the roster is a file the lead writes. Hot reload needs the owner's per-session consent.

**External (docs and press, per the orchestrator).** Agent teams have been experimental since February 2026 with no announced general availability. Agent view and background sessions are a research preview from 2026-05-11. Projects are in public beta: a coordinator conversation starts threads, in the cloud or local through Remote Control, with per-project model and effort, instructions and memory, and phone steering. Cloud threads read only the repo's `CLAUDE.md` and skills, not the home-directory config. Workflows take no input mid-run (I read this in the workflows docs too).

**Design recommendation (inference, the orchestrator's).** Keep `orchestrate` as a thin policy layer over swappable mechanics. The policy covers phases, settings, stops, what gets posted and the owner's decisions. The mechanics are chip, CLI, `--bg`, teammate or a Projects thread. The mechanics will change and the policy will not.

**How this bears on the Reddit findings.** These notes are first-hand evidence for the parts of #168 the thread does not touch: hold-first-turn, set-model and set-effort, and chips. They back the thread's pattern of pushing reports to a lead and keeping the tracker as the record. They also show the start mechanism changes what the skill can control. Only the chip needs a hold step, because the CLI and `--bg` take model and effort at launch.

## What I did not find

- **No outside evidence for hold-first-turn.** No Reddit commenter holds a first turn. The poster passes the model at spawn with their own tool. Only the orchestrator's field notes cover it.
- **No outside evidence on the set-model and set-effort tools.** Neither the thread nor the docs pages describe them, so #168's plan rests on the owner's own use of them.
- **No outside evidence on chips.** Neither the thread nor the docs pages cover the chip feature. Only the orchestrator's field notes do.
- **Loop failure modes.** The thread tells no story of two sessions claiming one ticket, which is the case the pact's rules were written for.

## Sources

- Reddit thread (field reports): a public r/ClaudeAI thread, read 2026-10-03 from an export the owner supplied.
- Claude Code docs: code.claude.com/docs/en/agent-teams, /workflows, /sub-agents and /cross-session-messaging
- #168 body, read with the GitHub CLI on 2026-10-03.
