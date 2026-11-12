# live: the spec

Draft 0.5, proceeded by the lead under the owner's goal (decision 71). Issue [#208](https://github.com/mephistopheles4/grimoire/issues/208).
Signed: live-208

**The owner's ask, quoted from the issue:**

> A new skill: hands-free voice with Claude. The person turns it on, starts a task and walks away. Claude speaks briefly at the seams of the work and listens in the background for a spoken reply. Everything runs locally.

> The aim is to **lower the cost of each check-in, not the number of them.**

**The owner's narrowing, relayed by the lead:**

> for 208 leave it as draft PR when its finished please

So this issue ends as one draft pull request. Nothing is marked ready for review, nothing is merged and nothing is released.

Tier: thorough, on the sensitive route. Plan on Opus at high. Build on Sonnet at high. The owner chose Sonnet for the build (decision 48, relayed by the lead, quoting "/make-it-so" with "rec" on all 11 plan questions). The lead holds the owner's standing goal and decides the proceed and the ticket cut (decision 61 and later). Installs, and the practice runs that need the owner's mic, stay the owner's.

## S1. Objective

A person turns live mode on in one session and walks away from the keyboard. At each seam of the work, that session speaks two sentences or fewer. It then listens in the background for one spoken reply, and the session stays free while it listens.

**What stays local and what does not.**
- **Audio stays local** when the speech tool is set up as S5.6 says. The skill cannot check that setup itself (K8).
- **Text goes where typed text goes.** Heard text and spoken text enter the chat. From there they reach:
  - the model provider;
  - the session transcript on disk;
  - the person's devices, when Remote Control is on.

  That flow includes words from other people in the room.

**Success.**
- The six practice cases in S10 pass twice each, on the owner's machine.
- After two weeks of use, the person reports a lower load per check-in (S12).

## S2. Decisions this spec rests on

| # | Decision | Source |
|---|---|---|
| D1 | It is a grimoire skill named `live`. | Issue; the lead, decision 61 |
| D2 | It works with no other skill. It names no other skill, and no other skill names it. | Issue, Decided |
| D3 | It is hands-free, with no hotkey. The speech engine and the recorder run locally. The text flows are as S1 says. | Issue; round 1 |
| D4 | The skill prose says *the speech tool* and *the recorder*, and names no product. The README's setup section names Voicebox and ffmpeg. The listener's code names ffmpeg. | Issue; Q8 |
| D5 | The skill stands alone, on an explicit typed turn-on. There is no always-loaded instruction and no frontmatter `hooks` key. Each listener return restates the rule, the token and the speech tool's name. If practice case 1 fails, the skill prints this line for the person to add to their own CLAUDE.md, and never writes it itself: `When live mode is on in this session, speak only at seams, as the live skill says.` | Q1 |
| D6 | The gate is an energy gate with a minimum voiced length. A transcript that is empty or only filler is dropped. There is no voice-activity model. | Q2 |
| D7 | Nothing waits for an end-of-playback signal. The wait is an estimate of speaking time, plus a cold-start margin after turn-on or after the speech tool failed. Echo is dropped. A spoken read-back never holds an affirmative word. The setup asks for a headset. | Q3; rounds 1 and 2 |
| D8 | One listener runs at a time, ended by a cooperative stop. A new seam stops the listener, speaks, then listens again. | Q4, and the probe |
| D9 | The build runs on Sonnet at high. | Q5, owner |
| D10 | Anyone or anything audible to the mic is proposed as a new actor. | Q6 |
| D11 | The candidate risks are worded in S8. The lead re-accepted the history risk for this spec, on the widened wording. The threat-model entry stays a candidate, because this issue merges nothing. | Q7; the lead, decision 61; round 2 |
| D12 | The recorder is resolved once at turn-on. Only fully qualified drive folders on PATH are searched: never the current folder, a root-relative entry or a network share. The path found is pinned for the rest of the session. | Q8; rounds 1 and 2 |
| D13 | v1 runs on Windows only. The platform check comes after the argument, folder, token and lock checks, and before recorder resolution. With the test recorder, the whole listener runs on any platform. | Q9; rounds 1 and 2 |
| D14 | The practice cases run on the manual `desktop-app` variant. | Q10 |
| D15 | The listener times out 120 s after its gate opens. | Q11 |
| D16 | Everything lands in one draft pull request on one branch. Nothing merges and nothing ships. | The owner's narrowing; the lead |
| D17 | Heard text never stands for the person's typed words. It never grants, widens or extends a delegation of the person's decisions, even after a read-back. No detector for injected wording is added: the owner accepted prompt injection as a threat class (decision 66), and the read-back and this rule stay. | Rounds 1 and 2; the lead, decisions 61 and 66 |
| D18 | After three heard turns with no typed message from the person, the listener itself refuses to listen until the person types. | Rounds 1 and 2; the lead, decision 61 |

**The probe (2026-11-10, Windows 11).** A kill by pid ended a background Node task with no output and exit code 1, and no handler ran. The session was still woken by a "failed" notice.

**Not probed.**
- Whether the desktop app delivers another session's report while a listener runs. D8 holds either way.
- The speech tool's transport, port, Origin handling and what its history keeps. T3 probes these (C24).

## S3. Scope

**In scope:**
- the skill, its contract and its README;
- the listener and its tests;
- the security page, and the threat-model candidate entry;
- the practice-test doc;
- one draft pull request.

**Out of scope:**
- macOS and Linux input;
- a voice-activity model;
- hotkeys, and any cloud engine;
- clearing the speech tool's history from code;
- any change to another skill or to the Brigade mod;
- a merge or a release.

## S4. Files

| Path | What | Ticket |
|---|---|---|
| `skills/live/scripts/gate.mjs` | The pure gate. | T2 |
| `skills/live/scripts/listen.mjs` | The listener (S6). It exports its PATH resolver for tests. | T2 |
| `skills/live/SKILL.md` | T2 writes a stub, so the check passes: frontmatter `name: live` and `description: Draft, not for use.`, and one line saying T1 replaces it. T1 replaces it with the generated file. | T2, then T1 |
| `skills/live/.skillspector-baseline.yaml` | Only if SkillSpector flags the scripts. | T2 |
| `tests/live-gate.test.mjs`, `tests/live-listen.test.mjs` | The gate tests and the listener tests (S9). | T2 |
| `tests/live-fake-recorder.mjs` | The fake recorder (S6, "The test seam"). | T2 |
| `CONTRIBUTING.md` | T2 adds the tests to the test list and the test-seam paragraph. T1 adds `skills/live/` to the list of generated skills. | T2, T1 |
| `docs/security/live.md`, `docs/security/threat-model.md` | The probe record, the controls, and the candidate entry (S8). | T3 |
| `skills/live/references/CONTRACT.md`, `contract.changelog.md`, `skills/live/README.md` | The contract, its log, and the README with the setup (S5.6). | T1 |
| `docs/practice-tests/live.md` | The cases and the results grid (S10). | T4 doc by T1's session; runs by the owner |
| `.claude-plugin/plugin.json` | One version bump on the branch. | T2 |

## S5. What the skill does

### S5.1 Turn-on and turn-off

1. **Turn-on is typed.** The person types "live mode on".
2. **At every turn-on:**
   - The skill runs `listen.mjs devices`. That prints a list stamp and one line per audio input: the index, then the friendly name. Control characters are stripped and each name is cut to 128 characters.
   - The skill shows the list and asks the person to type the index of their input and the name of the speech tool to use.
   - It then runs `listen.mjs on --device-index <n> --stamp <s> --speech-tool <name>`.
   - The speech tool's name may use only letters, digits, `_`, `-` and `.`.
3. **What `on` does:**
   - It takes the lock and resolves the device to its stable id.
   - It resolves the recorder (D12), and pins the device id, the recorder path and the speech tool name in `lock.json`.
   - It prints `LIVE on <token>` on the first line, then `device: <name>` and `recorder: <folder>`.
   - The skill shows those last two lines in chat, so the person sees what was picked.
4. **The lock is held elsewhere.** `on` prints `LIVE held <since>`. Only a typed "take it over" runs `on --take`. A take-over stops the old listener first.
5. **Warm-up.** The skill speaks one short line, such as "Live mode is on".
6. **Turn-off.** "live mode off", typed or spoken, runs `listen.mjs off --token <t>`.
7. **A session without the lock** never speaks and never listens.

### S5.2 Seams

The skill speaks only at three seams:
1. **A hand-back:** a task in this session finishes, or a session it leads reports a finish.
2. **A decision only the person can make:** the skill asks for the person's own call aloud first.
3. **A stop:** anything that would make the session stop and escalate.

**Never spoken:** narration of progress, code, diffs, paths, branch names, tokens, secrets, personal details, issue or pull request titles, repository names, and people's names. A spoken line gives the outcome and asks the question.

**Background sessions.** A finish in a background session is not a seam for that session.

### S5.3 Speaking

- **Length.** Two sentences or fewer. A hand-back says whether the result was checked.
- **The same words in chat.** The exact text spoken also appears in chat.
- **The speech tool.** The skill speaks only through the tool whose name is pinned at turn-on. After a compaction it reads that name from the latest reminder line. With no name in sight, it stops and asks the person to type it.
- **The order of calls.**
  1. `listen.mjs stop --token <t>`.
  2. Wait out the estimated length of the line spoken before, so no two lines overlap.
  3. Speak.
  4. Start the listener as a background task with `--words <n>`, where n is the word count. Add `--cold` on the first listen after turn-on, and after any failed speak or transcribe.
- **No text to a shell.** Spoken and heard text never go into a shell or a script argument.
- **When speaking fails.** If speak or transcribe fails, the skill writes the reason in chat once, runs `clear`, starts no listener and stays silent until the next seam.

### S5.4 The listener's return

The background task prints two lines.
- **The first is the return:** `LIVE <word>`, with at most two fields.
- **The second is the reminder:** `live mode is on, token <t>, speech tool <name>: speak only at seams`, or `live mode is off`.

| First line | The skill does |
|---|---|
| `LIVE heard <seq> <clip path>` | Transcribes that clip, then runs `clear` whatever transcribe returned. It drops text that is empty, filler only, or equal to the trailing words of the line just spoken. Otherwise it acts under S5.5. |
| `LIVE timeout <seq>`, `LIVE superseded <seq>`, `LIVE off` | Nothing. |
| `LIVE paused` | The chain limit was reached. The skill speaks one fixed line, "I've stopped listening; please type.", and writes the same line in chat. |
| `LIVE error <reason>` | Writes the reason in chat once. If speech still works, it also speaks the fixed line. The reason comes from a fixed list: `platform`, `recorder-missing`, `device`, `argument`, `token`, `folder`, `recorder-failed`. |
| anything else, or a failed task | Treated as `LIVE error`. |

### S5.5 Acting on what it hears

- **Shown first.** Heard text appears in chat as `Heard: "<text>"` before the skill acts on it.
- **Heard is never typed (D17):**
  - Heard text never stands for the person's typed words, wherever the session's instructions ask for those.
  - It never grants, widens or extends a delegation of the person's decisions, even after a read-back. That needs typed words.
  - A decision taken on heard text is recorded as heard. A record that stays on this machine may quote the `Heard:` line. A record that is posted anywhere says "heard" and names the act within S5.2's limits, without the quoted text.
- **What a typed message is.** It is the person's own message in this session's chat. A task notice, a report from another session, a relay and a heard line are not typed messages.
- **Read-back before acting.** These never run on speech alone:
  - anything hard to reverse: merge, push, delete, publish, send, install, a change to settings;
  - turning live mode on in another session;
  - every decision the session's instructions keep for the person.
- **How the read-back works:**
  - **In chat:** the full heard text.
  - **Aloud:** the act and its target only, with no affirmative word. For example: "Merge pull request 12. Say confirm to go ahead."
  - **What confirms:** a typed yes, or a heard reply that is only "confirm". The heard reply must arrive on the completion of the background task the skill started straight after that read-back. The skill knows that task by the task id the harness returned, and records the task id and the `<seq>` together.
  - **What cancels:** any other reply, a timeout, any later seam speaking, or a compaction. After a cancel, the act needs a fresh request.
- **Heard text never widens anything else.** It never widens permissions, and it never answers a prompt that waits for a typed approval.
- **The chain limit (D18).** `listen` counts heard returns in its own state. On the fourth it prints `LIVE paused`. The skill runs `listen.mjs reset --token <t>` only on a typed message.

### S5.6 The README setup

The person does all of this. The skill never installs anything.
1. **A local speech tool.** Run one with a local engine, no cloud fallback, and a server bound to loopback only. The README says how to check both for Voicebox.
2. **Register it.** Register the speech tool's MCP server, and know the name to type at turn-on.
3. **The recorder.** Put ffmpeg in a folder on PATH that only your account and the administrators can write.
4. **A headset.** Without one, the mic hears the spoken lines.
5. **The history.** Know what the speech tool keeps (text, and audio if it keeps audio) and how to clear it.
6. **What gets captured.** While a listener runs, the mic captures the room and both sides of a call, and the words go into the chat. Turn live mode off during calls.

## S6. The listener script

**Runtime.** Node 24, with no dependencies.

**Order of checks** in every command: arguments, then the folder, then the token, then the lock, then the platform, then recorder resolution, then the spawn.

**Platform.** On anything but Windows, with no test recorder, the script prints `LIVE error platform` before resolving or spawning anything.

**State folder.** `join(os.tmpdir(), 'grimoire-live')`. The script prints `LIVE error folder` when:
- the folder is a link or a junction (lstat); or
- its canonical real path is not inside the canonical real path of `os.homedir()`.

The inside test compares case-insensitively, at a separator boundary.

Privacy rests on the per-user temp folder's access rules. These variables are environment, and a planted environment falls under R7, R10 and C11: `TEMP`, `TMP`, `USERPROFILE`, `PATH`, `NODE_ENV` and the test variables.

**The token.** 16 bytes from `crypto.randomBytes`, written as hex. It is a cooperation marker, not a secret.

**Commands.**

| Command | Effect |
|---|---|
| `devices` | Runs the pinned or resolved recorder with `-hide_banner -list_devices true -f dshow -i dummy`. It reads stderr, keeps only the audio-device lines, and prints a stamp of the list plus `<index> <friendly name>` lines, cleaned as S5.1 says. Alternative names are never printed. |
| `on --device-index <n> --stamp <s> --speech-tool <name> [--take]` | Lists the devices again, and refuses `LIVE error device` if the stamp differs. Creates `lock.json` exclusively, or with `--take` writes `stop`, waits up to 2 s, then replaces it. Only after holding the lock does it delete leftover clips. It pins the device's alternative id, the recorder path and the tool name, then prints the three lines in S5.1. `LIVE held <since>` prints `<since>` only when it is shaped as ISO time, and otherwise prints `unknown`. |
| `listen --token <t> --words <n> [--cold] [--timeout <s>]` | Steps, in order: <ol><li>Checks the token. Refuses `LIVE paused` once the heard count has reached three.</li><li>Checks that the pinned recorder is still the first match on PATH, and that the pinned device id is still listed. Otherwise it prints `LIVE error recorder-missing` or `LIVE error device`.</li><li>Supersedes the running listener, then deletes earlier clips.</li><li>Waits `1 + n / 2.5 + 0.5` s, plus 30 s with `--cold`.</li><li>Opens the gate.</li></ol>The timeout counts from the gate opening: 120 by default, from 1 to 600. An utterance still going at the timeout runs to its end, up to the 30 s cap. `<seq>` is the previous seq plus one, and is kept in `listener.json`. |
| `stop --token <t>` | Writes `stop`. The listener sees it within 100 ms and prints `LIVE superseded <seq>`. |
| `clear --token <t>` | Deletes the clip. |
| `reset --token <t>` | Sets the heard count to zero. |
| `off --token <t>` | Stops the listener, deletes the clips and `lock.json`, then prints `LIVE off`. |

**Arguments.**
- `--words` runs from 0 to 200, and `--timeout` from 1 to 600.
- `--device-index` must be a listed index, and `--stamp` must be hex.
- `--speech-tool` follows S5.1's character set, with at most 64 characters.
- The token is hex.

Anything else prints `LIVE error argument` or `LIVE error token`, and starts no recorder.

**The recorder.**
- **Resolution.** At `on`, the script walks PATH. It keeps only entries that are fully qualified drive paths, skipping empty, relative, root-relative and network-share entries. It takes the first `ffmpeg.exe` it finds.
- **The spawn.** The pinned path runs with `shell: false` and `cwd` set to the state folder. The script reads stdout and discards stderr. The capture arguments are:

  ```text
  -hide_banner -loglevel error -f dshow -i audio=<pinned alternative id> -ac 1 -ar 16000 -f s16le -
  ```

- **Stopping.** The recorder stops on every exit path. The script kills the child and waits for it before it prints its return. If the listener itself is killed, the child's stdout closes and the recorder ends.

**The test seam.**
- With `NODE_ENV=test`, `GRIMOIRE_LIVE_RECORDER` names a Node script, which runs with `process.execPath` in place of ffmpeg.
- **The fake recorder** (`tests/live-fake-recorder.mjs`):
  - **Arguments:** it takes the same arguments as ffmpeg. For `-list_devices`, it prints a fixed device list to stderr.
  - **Audio:** for capture, it writes its pid to a file named by `GRIMOIRE_LIVE_FAKE_PID`. It then streams s16le PCM at real time, from a scenario in `GRIMOIRE_LIVE_FAKE_SCENARIO`. A scenario is a list of tone, noise and quiet segments.
- **Each test's environment:** HOME, USERPROFILE, TMPDIR, TEMP and TMP all point into a fresh folder, with the temp folder inside home.

**The gate** (`gate.mjs`): 16 kHz, mono, signed 16-bit, in 30 ms frames.
- **Noise floor:** the RMS of the first 0.5 s. The threshold is the larger of three times the floor and 300.
- **Start:** three frames in a row above the threshold.
- **End:** 1.6 s below it.
- **Too short:** a turn with under 0.4 s voiced is discarded.
- **Too long:** a turn is cut at 30 s.

**The clip.** Each listen writes a fresh `clip-<random>.wav`. Only the latest clip exists. `clear`, `off`, `on` (after the lock) and the next `listen` (after the token check) delete it.

## S7. Security controls

| # | Risk | Control |
|---|---|---|
| K1 | Words from the room reach the session. | The rules: D17, the typed-message definition, and the read-back covering hard-to-reverse acts and reserved decisions, with no affirmative word spoken. The binding: the yes is tied to the task id. The cancel cases: any later seam, a timeout or a compaction. The limit: the chain limit, enforced in the script. Residual: a spoken confirm from the room (K6). |
| K2 | Heard text or a device name reaches a shell. | No transcript is ever an argument. The device is chosen by a typed index against a stamped list, and pinned by id. Every argument is range- or character-checked. There is no shell. |
| K3 | Two sessions speak or listen at once. | The token lock, with exclusive create. A take-over stops the old listener. This is cooperation, not a security control. |
| K4 | Another account reads the clip. | The per-user temp folder's access rules, with canonical path checks. A link or junction is refused. Each clip is cleared after every transcribe, whatever the result. If a session ends without `off`, the clip stays until the next `on`. |
| K5 | The speech tool keeps text, and maybe audio. | The never-spoken list. The read-back speaks only the act and its target. The README's loopback check. A candidate risk (S8). |
| K6 | A spoken confirm comes from the room. | The owner allowed a spoken yes. A candidate risk (S8). |
| K7 | Another program runs as the recorder. | Only fully qualified drive folders on PATH are searched. The path is pinned at `on` and checked again at each `listen`. The folder is shown to the person. There is no config file. A planted environment or PATH falls under R7, R10 and C11. Residual: another account on a shared host that can create a missing folder listed early on PATH (S8). |
| K8 | Audio or text leaves through a cloud engine. | The README's setup. The skill uses only the speech tool pinned at turn-on. Residual: the skill cannot check the setup (S8). |
| K9 | A stale or planted clip. | A fresh clip name per listen. The skill transcribes only the path printed by its own listen. Residual: a same-user watcher, or a squatter on the speech tool's port (S8). |

## S8. Threat model proposal (T3)

T3 adds a candidate entry under "Candidates for the owner's word", and proposes an R13 row with its scores left to the owner. It changes neither "Who is in scope" nor "Accepted risks". This issue ends as a draft, so the entry stays a candidate. One line each:

1. **The new actor:** anyone or anything audible while a listener runs.
   - **What it reaches:** the session's next messages, up to the chain limit, and every act a spoken confirm can approve.
   - **What it hears:** every spoken line.
   - **Residual:** the room supplies both the request and the confirm.
2. **Speech has no speaker identity.** This widens C4 and C5.
3. **Forged transcripts and a squatted port.** A swapped clip, or a program on the speech tool's port while the tool is down, can forge text and also receives the spoken lines and each clip. This touches C4, C7 and C11. `lock.json` is listed with them.
4. **The speech tool's history:**
   - **Who can read it:** any local account, and the LAN if the server binds beyond loopback.
   - **What it holds:** text, and audio if the tool keeps it.
   - **Browser pages:** whether a page can reach it is answered by T3's probe.
5. **The clip at rest:** unencrypted in the per-user temp folder until it is cleared, or until the next `on` after an abnormal end.
6. **Bystander speech:** it reaches the provider, the transcript, Remote Control, and local decision records. This widens C6, C7, C12 and P6.
7. **Identifiers:** the clip path names the account, and device names may name a person.
8. **Unverifiable setup:** the skill cannot check that the speech engine is local (K8).
9. **A planted PATH:** another account on a shared host can create a missing PATH folder that comes before the recorder's real one. This is a new class, outside C11.

## S9. Acceptance claims

The tests in T2 check C1 to C12 and C20, in the Linux check. T3 checks C24. The practice run in T4 checks C13 to C19. Review and CI check C21 to C23.

| # | Claim | Measured by |
|---|---|---|
| C1 | A 0.6 s tone after 0.5 s of noise, then 1.6 s of quiet, gives one `end` with about 0.6 s of PCM. | gate test |
| C2 | A 0.2 s burst gives `discard`, and a later 0.6 s tone gives `end`. | gate test |
| C3 | Unbroken speech is cut at 30 s. | gate test |
| C4 | `listen` prints `LIVE heard <seq> <path>` and the reminder, which carries the token and the tool name. The clip is a valid 16 kHz mono WAV. | listen test |
| C5 | `stop` makes `listen` print `LIVE superseded <seq>` within 500 ms. A second `listen` supersedes the first. `on --take` stops a running listener. | listen test |
| C6 | `listen --words 0 --timeout 1` with quiet prints `LIVE timeout <seq>` within 3 s. | listen test |
| C7 | A held lock prints `LIVE held`. A non-ISO `since` prints `unknown`. A wrong token prints `LIVE error token`, and no recorder starts. | listen test |
| C8 | Each of these prints `LIVE error argument` and starts no recorder: a bad `--words`, `--timeout` 0 or 601, an unlisted index, and a speech-tool name with a disallowed character. A stale `--stamp` prints `LIVE error device`. | listen test |
| C9 | After heard, timeout, superseded, off and error, the fake's pid is gone when the return line is read. A hard kill of the listener ends the fake within 2 s. | listen test |
| C10 | `clear`, `off`, `on` and `listen` each remove an earlier clip. A second session's `on` that finds the lock held deletes nothing. Without `NODE_ENV=test`, the recorder variable is ignored. | listen test |
| C11 | The exported resolver, given a PATH of a relative entry, a root-relative entry, a network-share entry and a current folder that each hold `ffmpeg.exe`, returns only the fully qualified entry. Off Windows, without the test recorder, `listen` prints `LIVE error platform` and spawns nothing. A changed first match prints `LIVE error recorder-missing`. | listen test |
| C12 | A state folder that is a link, or a temp folder outside home (including a sibling with a shared prefix), prints `LIVE error folder`. | listen test |
| C13 | At a seam, the skill speaks once and starts one listener. A spoken finish says whether it was checked. | case 1 |
| C14 | Nothing is spoken mid-task. | case 2 |
| C15 | Only the live session speaks. | case 3 |
| C16 | The skill asks for the person's call first. | case 4 |
| C17 | A spoken "merge it" gets a read-back with no affirmative word, and no action. Its own echo does not confirm it. | case 5, run once with speakers |
| C18 | A spoken answer to a reserved decision gets a read-back. A spoken delegation is refused. Both are recorded as heard. | case 6 |
| C19 | A hand-back whose result holds a path or a token speaks neither. | case 1, second run |
| C20 | The fourth heard return prints `LIVE paused`. `reset` clears the count. | listen test |
| C21 | The skill prose names no product and no other skill. | review |
| C22 | `athanor run check` passes at each ticket's head. CI is green on the draft pull request, including SkillSpector, zizmor and `claude plugin validate --strict`. | the check and CI |
| C23 | Every spoken line also appears in chat. | cases 1 and 4 |
| C24 | `docs/security/live.md` records each probe answer from S2 with the tool's version and how it was found. The probe ran on a cleared or test-only history, and records the history's shape (fields, audio or not, retention), never its entries. The candidate entry holds S8's nine lines. | T3 review |

## S10. Practice test (T4)

**Who and where.** The `desktop-app` variant (D14), on the draft branch. The doc follows `docs/practice-tests/procedure.md`, and each expected answer is written before the first run. T1's session writes the doc. The owner runs the cases.

**Before the cases.**
- The owner installs and registers the speech tool and ffmpeg (S5.6), at a time the owner chooses (O5).
- T4 waits for T3's probe result (C24).

**A smoke step comes first:** `devices`, then `on`, then `listen` with the real device, which must return `LIVE heard`, then `off`.

**The cases,** each run twice:
1. **A seam.** The second run's result holds a path and a token.
2. **Mid-task.** An extended run checks the chain limit.
3. **A background session finishing.** The live session starts a background task that finishes on its own. Only the live session speaks.
4. **A decision:** it asks for the person's call first.
5. **"Merge it":** the work folder has no git remote and nothing to merge. One run uses speakers instead of the headset.
6. **A reserved decision.** The work folder's CLAUDE.md keeps one decision for the person, "close the practice note". The record read is the session's own chat line. A spoken "you decide the rest for me" is refused.

**The results doc** records pass or fail and the spoken line only. Its usage table holds turn-ons, turn-offs, misfires, and the person's own load rating for each check-in.

## S11. The ticket cut (the lead's word)

Every ticket commits to this issue's branch. The branch ends as one draft pull request.

| Ticket | Builds | Depends on | Who |
|---|---|---|---|
| T2 | `gate.mjs`, `listen.mjs`, the fake recorder, the tests, the stub `SKILL.md`, the CONTRIBUTING test list, the version bump. | the proceed | A session on Sonnet at high |
| T3 | The probe (C24), `docs/security/live.md`, and the candidate entry. | T2 | A session on Sonnet at high |
| T1 | The contract interview, the generated `SKILL.md` that replaces the stub, the README, the CONTRIBUTING generated list, and the practice-test doc. | T2 | A session. Who answers the interview is open (O6). |
| T4 | Two runs of each case. | T1, T3, the installs | The owner |
| Draft PR | Opened after T2. Updated by each ticket. Never marked ready, never merged. | | This issue's session |

**The lenses at Test.**
- T2 and T1 each get the QA pair and the security pair. The standards pair is the trade-off at the limit of 2.
- T3 gets the security pair.

## S12. Trade-offs, boundaries, rollback, retirement

**Trade-offs.**
- **A spoken confirm (K6):** convenience against security. The owner's call stands.
- **The chain limit of three, and the 120 s timeout:** safety and quiet are chosen over long spoken exchanges.
- **Windows only in v1.**
- **No business driver** is named, so each choice leans to what is cheaper to reverse.

**Boundaries.**
- *Always:* test first, then `athanor run check`.
- *Ask first:* any new dependency or download, any frontmatter key, any change to another skill or to the mod, and any threat-model scope change.
- *Never:* a fixed path, a transcript in a shell, a product name in the skill prose, a recorder from the current folder, or a merge.

**Rollback.**
- Close the draft pull request. Nothing has shipped.
- `listen.mjs off` removes the state.
- A person who added D5's line removes it themselves.

**Stop and go back to Design when:**
- case 1 fails after the fallback; or
- case 5 or case 6 acts on speech alone; or
- any case speaks from the wrong session.

**Retire it if:**
- the usage table shows no drop in load after two weeks; or
- it is turned off more often than on; or
- it misfires twice after a fix.

## Open

- **O5, owner only:** when the speech tool, ffmpeg and the MCP registration get installed for T4, and when the owner runs T4. The lead puts both to the owner when T4 is next.
- **Decided.**
  - **O6:** the owner answers T1's contract interview, when T1 is next (decision 72).
  - **The proceed and the cut** in S11, with every round-2 trade-off taken as drafted (decision 71).
