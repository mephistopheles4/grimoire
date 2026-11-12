# live: the spec

Draft 0.3, after spec round 1, for the proceed. Issue [#208](https://github.com/mephistopheles4/grimoire/issues/208).
Signed: live-208

**The owner's ask, quoted from the issue:**

> A new skill: hands-free voice with Claude. The person turns it on, starts a task and walks away. Claude speaks briefly at the seams of the work and listens in the background for a spoken reply. Everything runs locally.

> The aim is to **lower the cost of each check-in, not the number of them.**

Tier: thorough, on the sensitive route. Plan on Opus at high. Build on Sonnet at high. The owner chose Sonnet for the build (decision 48, relayed by the lead, quoting "/make-it-so" with "rec" on all 11 plan questions). The lead holds the owner's standing goal and decides the proceed and the ticket cut. Installs, and the practice runs that need the owner's mic, stay the owner's.

## S1. Objective

A person turns live mode on in one session and walks away from the keyboard. At each seam of the work, that session speaks two sentences or fewer. It then listens in the background for one spoken reply, and the session stays free while it listens.

**What stays local and what does not.**
- **Audio stays local.** Neither the mic audio nor the spoken audio leaves the machine.
- **Text goes where typed text goes.** Heard text and spoken text both enter the chat. From there they go wherever a typed message goes: the model provider, the session transcript on disk, and the person's devices when Remote Control is on. That flow includes words from other people in the room. The words of "Everything runs locally" are kept for the speech engine and the recorder.

**Success.**
- The six practice cases in S10 pass twice each, on the owner's machine.
- After two weeks of use, the person reports a lower load per check-in (S12).

## S2. Decisions this spec rests on

| # | Decision | Source |
|---|---|---|
| D1 | It is a grimoire skill, named `live`. The name is fixed by this spec, not left to the contract interview, so that T2 can build `skills/live/` first. | Issue, Decided. The name is for the lead's word (open item O1). |
| D2 | It works with no other skill. It names no other skill, and no other skill names it. | Issue, Decided |
| D3 | Hands-free, with no hotkey. The speech engine and the recorder run locally. The text-flow wording in S1 applies. | Issue, Decided; data round 1 |
| D4 | The skill prose says *the speech tool* and *the recorder*, and names no product. The README's setup section names Voicebox and ffmpeg. The listener's code names ffmpeg, since code that calls a tool names it (ADR 0001). | Issue; Q8 |
| D5 | The skill stands alone, on an explicit, typed turn-on. There is no always-loaded instruction and no frontmatter `hooks` key. Each listener return restates the rule and the token. If practice case 1 fails, the fallback is this one line, which the skill prints for the person to add to their own CLAUDE.md and never writes itself: `When live mode is on in this session, speak only at seams, as the live skill says.` | Q1 |
| D6 | The listener uses an energy gate, a minimum voiced length and a check for an empty or filler-only transcript. It uses no voice-activity model. | Q2 |
| D7 | Nothing waits for an end-of-playback signal. The wait is an estimate of the speaking time from the word count. The first listen after turn-on adds a cold-start margin. Heard text that repeats the line just spoken is dropped. The setup asks for a headset. | Q3; round 1 |
| D8 | One listener at a time, ended by a cooperative stop. A new seam stops the listener, speaks, then listens again. The skill ignores a superseded or failed return. | Q4, and the probe |
| D9 | The build runs on Sonnet at high. | Q5, owner |
| D10 | Anyone or anything audible to the mic is proposed as a new actor. The owner writes it in. | Q6 |
| D11 | Candidate accepted risks, worded in S8. | Q7; round 1 widened the wording |
| D12 | The recorder is resolved from PATH's absolute entries only, never from the current folder, and runs with fixed arguments. Nothing reads a command from config. | Q8; adversarial round 1 |
| D13 | v1 runs on Windows only. The platform check sits just before the real recorder would start. With the test recorder, the whole listener runs on any platform, so the Linux check can run its tests. | Q9; executability round 1 |
| D14 | The practice cases run on the manual `desktop-app` variant, with a real mic and the speech tool. | Q10 |
| D15 | The listener times out 120 s after its gate opens. | Q11 |
| D16 | The first release to users is T1's merge. It comes only after T2 has merged, T3's candidates have the owner's word, and T4's cases have run against T1's branch. | Executability round 1; for the lead's word (O2) |
| D17 | Heard text never stands for the person's own typed words. | Adversarial round 1; for the lead's word (O3) |
| D18 | After three heard turns in a row with no typed message between them, no listener starts until the person types. | Adversarial round 1; the number is for the lead's word (O4) |

**The probe (2026-11-10, Windows 11).** A background task ran a Node stub. A kill by pid from another command ended it with no output and exit code 1. Its SIGTERM handler never ran. The session was still woken by a "failed" task notification.

**Not probed.**
- Whether the desktop app delivers another session's report while a listener task runs. D8 holds either way.
- The speech tool's transport, port, Origin handling, and what its history keeps. T3 probes these once the tool is running (S8).

## S3. Scope

**In scope:**
- the skill, its contract and its README;
- the listener script and its tests;
- the security page and the threat-model proposal;
- the practice-test doc.

**Out of scope:**
- macOS and Linux input (a follow-up);
- a voice-activity model (a follow-up, only if case results ask for one);
- hotkeys and any cloud engine;
- any change to another skill or to the Brigade mod.

Clearing the speech tool's history from code is out of scope too. The README says how to clear it by hand. D16 makes the owner's word on that risk a condition of the first release.

## S4. Files

| Path | What | Ticket |
|---|---|---|
| `skills/live/scripts/gate.mjs` | The pure gate: frames in, events out. No I/O. | T2 |
| `skills/live/scripts/listen.mjs` | The command-line listener (S6). | T2 |
| `skills/live/.skillspector-baseline.yaml` | Only if SkillSpector flags the scripts. Each entry gives its reason. | T2 |
| `tests/live-gate.test.mjs` | Gate tests on PCM synthesized in the test. No binary fixture, no mic. | T2 |
| `tests/live-listen.test.mjs` | Listener tests with a fake recorder (S9). | T2 |
| `CONTRIBUTING.md` | The test list and the test-seam paragraph name the two new test files. | T2 |
| `docs/security/threat-model.md` | The candidate entry and a proposed R13 row (S8). | T3 |
| `docs/security/live.md` | The skill's risks and controls (S7). | T3 |
| `skills/live/references/CONTRACT.md` | The contract, Level Thorough. | T1 |
| `skills/live/references/contract.changelog.md` | Its change log. | T1 |
| `skills/live/SKILL.md` | Generated from the contract. Never edited by hand. | T1 |
| `skills/live/README.md` | What it does, and the setup steps (S5.6). | T1 |
| `docs/practice-tests/live.md` | The cases, expected answers, results grid and usage table (S10). | T4, on T1's branch |
| `.claude-plugin/plugin.json` | A version bump in T2 and in T1. | T2, T1 |

There is no `examples/` folder, so no registry row, and no new dependency.

## S5. What the skill does

### S5.1 Turn-on and turn-off

1. **Turn-on is typed.** The person types "live mode on". A spoken turn-on cannot happen, because nothing listens before it.
2. **The device.** On the first turn-on the skill runs `listen.mjs devices`, which lists the audio inputs with an index. The person types the index. The skill runs `listen.mjs on --device-index <n>`. The script resolves the index to the device name and keeps it in `lock.json`. The model never writes a device name into a command.
3. **The token.** `on` takes the lock and prints `LIVE on <token>`.
4. **The lock is held elsewhere.** `on` prints `LIVE held <since>`. The skill tells the person in chat. Only a typed "take it over" runs `on --take`.
5. **Warm-up.** The skill speaks one short line, such as "Live mode is on", to load the voice model.
6. **Turn-off.** "live mode off", typed or spoken, runs `listen.mjs off --token <t>`. A spoken off is accepted on purpose, because it fails safe.
7. **A session without the lock** never speaks and never listens.

### S5.2 Seams

The skill speaks only at three seams:
1. **A hand-back.** A task in this session finishes, or a session this one leads reports a finish.
2. **A decision only the person can make.** The skill asks for the person's own call aloud first. It gives its own view only after the person answers, or when the person asks for it.
3. **A stop.** Anything that would make the session stop and escalate.

**What is never spoken.** The skill never speaks mid-task and never narrates progress. A spoken line never holds:
- code, diffs, paths, branch names or tokens;
- secrets or personal details;
- issue or pull request titles, repository names, or people's names.

It says the outcome and asks the question. The chat copy carries the detail.

**Background sessions.** A finish in a background session is not a seam for it, because it does not hold the lock.

### S5.3 Speaking

- **Two sentences or fewer:** what happened, then the one question.
- **Checked or not.** A hand-back always says whether the result was checked, for example "done, tests pass" against "done, not yet checked". A spoken finish is a summary, never a verification.
- **The same words in chat.** The exact spoken text also appears in chat.
- **The order of calls.** The skill runs `listen.mjs stop --token <t>`, then calls speak on the speech tool named at setup, then starts the listener as a background task with `--words <n>`. On the first listen after turn-on it also passes `--cold`.
- **No text to a shell.** Spoken and heard text never go into a shell or a script argument. Only the token, the word count and the flags do.
- **A failed speak.** If speak or transcribe fails, the skill writes the reason in chat once, starts no listener and stays silent until the next seam.

### S5.4 The listener's return

The background task prints exactly two lines. The first is the return, `LIVE <word>` with at most one field. The second is the reminder.

| First line | The skill does |
|---|---|
| `LIVE heard <seq> <clip path>` | Transcribes that clip only, then runs `listen.mjs clear --token <t>`. It drops the text if it is empty, filler only, or repeats the line just spoken. Otherwise it acts under S5.5. |
| `LIVE timeout <seq>` | Nothing. It stays quiet until the next seam. |
| `LIVE superseded <seq>` | Nothing. |
| `LIVE off` | Nothing. |
| `LIVE error <reason>` | Writes the reason in chat once. `<reason>` is one word from a fixed list: `platform`, `recorder-missing`, `device`, `argument`, `token`, `folder`, `recorder-failed`. |
| anything else, or a failed task | Treated as `LIVE error`. |

The reminder line reads `live mode is on, token <t>: speak only at seams`, or `live mode is off`. It restores the rule and the token after compaction. The token is a cooperation marker between sessions, not a secret (S6).

### S5.5 Acting on what it hears

- **Shown first.** Heard text appears in chat as `Heard: "<text>"` before the skill acts on it.
- **Heard is never typed (D17).** Heard text never stands for the person's own typed words, wherever the session's instructions ask for those. A decision taken on heard text is always recorded as heard, quoting the `Heard:` line. It is never recorded as the person's typed word.
- **Read-back before acting.** These never run on speech alone:
  - anything hard to reverse: merge, push, delete, publish, send, install, a change to settings;
  - turning live mode on in another session;
  - every decision the session's instructions keep for the person.
- **How the read-back works:**
  - **Chat** shows the full heard text.
  - **Aloud,** the skill names only the act and its target in the limits of S5.2, for example "Merge pull request 12, yes?".
  - **A yes** is a typed yes, or a spoken reply that is only an affirmative word. It must come from the listener started straight after that read-back, with that listener's `<seq>`.
  - **Cancelled by:** any other reply, a timeout, or any later seam speaking. The act then needs a fresh request.
- **Heard text never widens anything.** It never widens the session's permissions, and it never answers a prompt waiting for a typed approval.
- **The chain limit (D18).** After three heard turns in a row with no typed message, the skill starts no more listeners. It says once in chat that it waits for the person to type.

### S5.6 The README setup

The README holds these setup steps. They are the person's own install, never done by the skill:
1. Run a speech tool with a local engine and no cloud fallback. Its server must bind to loopback only. The README says how to check both for Voicebox.
2. Register the speech tool's MCP server, and name it to the skill at setup. The skill uses only that tool, and stops if none is named.
3. Put ffmpeg on the PATH.
4. Wear a headset. Without one, the mic hears the spoken lines.
5. Know what the speech tool keeps (text, and audio if it keeps audio), and how to clear it.
6. Know what is captured. While a listener runs, the mic captures the room and either side of a call, and the words go into the chat. Turn live mode off during calls.

## S6. The listener script

**Runtime.** Node 24, with no dependencies.

**Platform.** The platform check sits just before the real recorder would start. On anything but Windows, `listen` prints `LIVE error platform` and starts nothing. Everything before that point runs on any platform.

**State folder.** The script computes it at run time as `join(os.tmpdir(), 'grimoire-live')`. The script prints `LIVE error folder` and stops when either:
- the folder is a link or a junction (checked with lstat); or
- `os.tmpdir()` lies outside `os.homedir()`.

Its privacy rests on the per-user temp folder's access rules. The mode 0o700 is kept for later platforms, and does nothing on Windows.

**The token.** 16 bytes from `crypto.randomBytes`, as hex. It keeps sessions from stepping on each other by accident, and it is not a secret.

**Commands.**

| Command | Effect |
|---|---|
| `devices` | Lists the audio inputs as `<index> <name>`. Uses the real recorder, or the test recorder in tests. |
| `on --device-index <n> [--take]` | Deletes any leftover clips. Creates `lock.json` exclusively, holding the token, the start time and the device name. Prints `LIVE on <token>`. If a lock exists, prints `LIVE held <since>`, where `<since>` is printed only in ISO time shape and otherwise as `unknown`. `--take` replaces the lock. |
| `listen --token <t> --words <n> [--cold] [--timeout <s>]` | Checks the token, deletes earlier clips, supersedes any running listener, then waits. The wait is `1 + n / 2.5 + 0.5` s, plus 30 s with `--cold`. It then opens the gate. The timeout counts from the gate opening, defaults to 120 and runs from 1 to 600. An utterance in progress at the timeout runs to its end, up to the 30 s cap, and returns `heard`. |
| `stop --token <t>` | Writes `stop`. The running listener sees it within 100 ms and prints `LIVE superseded <seq>`. |
| `clear --token <t>` | Deletes the clip. |
| `off --token <t>` | Stops the listener, deletes the clips and `lock.json`, then prints `LIVE off`. |

**The rest of the listener's behaviour:**
- **Supersede.** `listen` writes `stop` and waits up to 2 s for `listener.json` to clear. It then removes `stop` and creates its own `listener.json`, holding a new `<seq>`.
- **Arguments.** Each must be in range and well formed: `--words` from 0 to 200, `--timeout` from 1 to 600, `--device-index` a listed index, and the token in hex. Anything else prints `LIVE error argument` or `LIVE error token`, and no recorder starts.
- **The recorder.** The script finds `ffmpeg.exe` by walking the absolute entries of PATH only, skipping empty and relative ones and never the current folder. It spawns that absolute path with `shell: false` and `cwd` set to the state folder, using these arguments. It reads stdout and discards stderr.

  ```text
  -hide_banner -loglevel error -f dshow -i audio=<device from lock.json> -ac 1 -ar 16000 -f s16le -
  ```

- **The recorder stops on every exit path:** heard, timeout, superseded, off, error, and the 30 s cap. The script kills the child and waits for it to exit before it prints its return. The recorder also ends when its stdout closes, so killing the listener cannot keep the mic open.
- **The test seam.** With `NODE_ENV=test`, `GRIMOIRE_LIVE_RECORDER` names a Node script, which runs with `process.execPath` in place of ffmpeg. Both are environment variables. A planted environment is outside this control and falls under the threat model's planted-state risk (R7).
- **The gate** (`gate.mjs`). Its input is 16 kHz, mono, signed 16-bit frames of 30 ms.
  - **Noise floor:** the RMS over the first 0.5 s. The threshold is the larger of three times that floor and 300.
  - **Start:** three frames in a row above the threshold.
  - **End:** 1.6 s below it.
  - **Too short:** under 0.4 s voiced is discarded, and the gate keeps listening.
  - **Too long:** a turn is cut at 30 s.
  - **Output:** `start`, `end` with the PCM, or `discard`.
- **The clip.** Each listen writes a fresh random name, `clip-<random>.wav` (a WAV header, then the PCM). Only the latest clip exists. `clear`, `off`, `on` and the next `listen` delete it.

## S7. Security controls

| # | Risk | Control |
|---|---|---|
| K1 | Words from the room, a video or a call reach the session. | **D17:** heard text is never typed words. **The read-back:** it covers hard-to-reverse acts and decisions reserved to the person. The yes is bound to the next listener's `<seq>`, and any later seam cancels it. Heard text is shown in chat. **D18:** the chain limit. Residual: with a spoken yes, the room supplies both halves (K6). |
| K2 | Heard text or a device name reaches a shell. | No transcript is ever an argument. The device comes by typed index and is read from `lock.json`. Every argument is range-checked. The recorder spawns with no shell. |
| K3 | Two sessions speak or listen at once. | The token lock, with exclusive create. This is cooperation between sessions, **not a security control**: any same-user process can read the token, and speech has no speaker identity. |
| K4 | Another account reads the clip. | The per-user temp folder's access rules. The script refuses a link, a junction, or a temp folder outside the profile. There is one clip at a time, deleted right after transcribing. |
| K5 | The speech tool keeps spoken and heard text, and maybe audio. | The never-spoken list (S5.2). The read-back speaks only the act and its target. The README asks for loopback only and says how to clear the history. Candidate accepted risk (S8). |
| K6 | A spoken yes comes from the room. | The owner allowed it. Candidate accepted risk (S8). |
| K7 | Another program runs as the recorder. | The recorder is resolved from PATH's absolute entries only, with `cwd` in the state folder. There is no config file. A planted environment or PATH falls under R7. |
| K8 | Audio or text leaves through a cloud speech engine. | The README requires a local engine with no cloud fallback. The skill uses only the speech tool named at setup. |
| K9 | A forged transcript: the clip is swapped, or another program serves the speech tool's port. | A fresh clip name per listen. The skill transcribes only the path its own listen printed. The README says to stop using live mode while the speech tool is down. Candidate residual (S8). |

## S8. Threat model proposal (T3)

T3 adds a candidate entry under "Candidates for the owner's word", and proposes an R13 row with its scores left to the owner. It changes neither "Who is in scope" nor "Accepted risks". The entry states, in one line each:

1. **The new actor:** anyone or anything audible to the mic while a listener runs.
   - **What it reaches:** one session's next messages, up to the chain limit, and every decision a spoken yes can confirm.
   - **What it hears:** every spoken line.
   - **Residual:** with a spoken yes allowed, the room supplies both the request and the yes for every act the read-back covers.
2. **Speech has no speaker identity.** A steered session, another plugin, or any process able to use the speech tool can ask a question in the same voice. It is proposed as a widening of C4 and C5.
3. **Forged transcripts:** a swapped clip, or a program on the speech tool's port while the tool is down. This is K9's residual, under C4, C7 and C11.
4. **The speech tool's history:**
   - **Who can read it:** any local process of any account, and the LAN if the server binds beyond loopback.
   - **What it holds:** spoken and heard text, plus audio if the tool keeps it.
   - **Browser pages:** whether a page can reach the server is probed in T3, before the owner is asked.
5. **The clip at rest:** the last clip, unencrypted in the per-user temp folder, until it is cleared.
6. **Bystander speech:** other people's words go to the model provider, to the transcript and to Remote Control devices, as a widening of C7, C12 and P6.
7. **The clip path names the account,** and it enters the transcript on each heard turn.

## S9. Acceptance claims

The tests in T2 check C1 to C12. They run in the Linux check. The practice run in T4 checks C13 to C20. Review and CI check C21 to C23.

| # | Claim | Measured by |
|---|---|---|
| C1 | A 0.6 s tone, after 0.5 s of low noise and followed by 1.6 s of quiet, gives one `end` with about 0.6 s of PCM. | gate test |
| C2 | A 0.2 s burst gives `discard`, and a later 0.6 s tone still gives `end`. | gate test |
| C3 | Speech that never pauses is cut at 30 s. | gate test |
| C4 | `listen` with the fake recorder prints `LIVE heard <seq> <path>` and the reminder line. The clip is a valid 16 kHz mono WAV. | listen test |
| C5 | `stop` makes a running `listen` print `LIVE superseded <seq>` within 500 ms. A second `listen` supersedes the first. | listen test |
| C6 | With no speech, `listen --words 0 --timeout 1` prints `LIVE timeout <seq>` within 1.5 + 1 + 0.5 s. | listen test |
| C7 | `on` with a lock held prints `LIVE held`. A planted `since` that is not ISO time prints `unknown`. A wrong token prints `LIVE error token`, and no recorder starts. | listen test |
| C8 | Each of these prints `LIVE error argument` and starts no recorder: a non-integer `--words`, `--timeout 0`, `--timeout 601`, and an unlisted `--device-index`. | listen test |
| C9 | After each of heard, timeout, superseded, off and error, the fake recorder has recorded its own exit before the return line is printed. | listen test |
| C10 | `clear`, `off`, `on` and the next `listen` each remove an earlier clip. Without `NODE_ENV=test`, `GRIMOIRE_LIVE_RECORDER` is ignored. | listen test |
| C11 | With an executable named like the recorder in the current folder, and not on PATH, the listener does not run it. Off Windows without the test recorder, `listen` prints `LIVE error platform` and spawns nothing. | listen test |
| C12 | A state folder that is a link or junction prints `LIVE error folder`. | listen test |
| C13 | At a seam, the skill speaks once and starts one listener. A spoken finish says whether it was checked. | case 1 |
| C14 | Mid-task, nothing is spoken until the seam. | case 2 |
| C15 | A background session finishing speaks nothing. Only the live session speaks. | case 3 |
| C16 | At a decision, the skill asks for the person's call before it gives its own. | case 4 |
| C17 | A spoken "merge it" gets a read-back that speaks only the act and its target. Nothing happens before a yes. | case 5 |
| C18 | A spoken answer to a decision the instructions keep for the person gets a read-back, and is recorded as heard. | case 6 |
| C19 | A hand-back whose result holds a path or a token speaks neither. The chat copy shows exactly the spoken line. | case 1, second run |
| C20 | The chain limit: after three heard turns, no listener starts until a typed message. | case 2, extended |
| C21 | The skill prose names no product and no other skill. | review |
| C22 | `athanor run check` passes. CI is green, including SkillSpector, zizmor, and `claude plugin validate --strict` on `skills`. | the check and CI |
| C23 | Every spoken line also appears in chat. | cases 1 and 4 |

## S10. Practice test (T4)

**Who and where.** It runs on the `desktop-app` variant (D14), using T1's branch. The owner supplies the mic, the headset and the speech tool. The doc follows `docs/practice-tests/procedure.md`, and each expected answer is written before the first run.

**Before the cases, the owner installs and registers** the speech tool and ffmpeg (S5.6). When that happens is the owner's call (open item O5).

**A smoke step comes first.** `listen.mjs devices`, then `on`, then `listen` with the real device, must return `LIVE heard`.

**The cases,** each run twice:
1. **A seam:** it speaks once and starts a listener. The second run's result holds a path and a token.
2. **Mid-task:** nothing is spoken until the end. The extended run checks the chain limit.
3. **A background session finishing:** only the live session speaks. The setup is two sessions, one leading the other, with live mode on in the lead only.
4. **A decision:** it asks for the person's call first.
5. **"Merge it" spoken:** it gives a read-back and does not act. The setup is a work folder with no git remote and nothing to merge.
6. **A spoken answer to a reserved decision:** it gives a read-back, and the record says "heard".

**What the results doc records.**
- **The results grid:** pass or fail, and the spoken line only. Never transcripts, device names or paths.
- **A usage table** that the person fills over two weeks: turn-ons, turn-offs, misfires.

## S11. The ticket cut (the lead's word)

| Ticket | Builds | Depends on | Who |
|---|---|---|---|
| T2 | `gate.mjs`, `listen.mjs` and their tests, test-first. CONTRIBUTING's test list. It ships inert, with no `SKILL.md`. | proceed | A session on Sonnet at high |
| T3 | `docs/security/live.md` and the threat-model candidate entry, after probing the speech tool (S8 item 4). | T2 merged | A session. Then the owner's word on the candidates. |
| T1 | The contract through the contract interview, the generated `SKILL.md`, the README. | T2 merged | A session with the interview answered by the lead or the owner |
| T4 | The practice-test doc, and two runs of each case, on T1's branch. | T1 branch, owner's installs | The owner, with the mic |
| Release | T1 merges, which ships the skill. | T2 merged, T3's owner word, T4 pass | The lead's sign-off |

**The lenses at Test.**
- T2 and T1 each get the QA pair and the security pair. The standards pair is the trade-off at the Lens pairs limit of 2.
- T3 gets the security pair.

## S12. Trade-offs, boundaries, rollback, retirement

**Trade-offs.**
- **Reliability against Security.** A spoken yes saves typing, and the room can fake it. The owner's call stands (K6).
- **Interaction against Safety.** The chain limit of three ends a long spoken exchange with the person away. The side taken is safety (D18).
- **Interaction against Safety.** The 120 s timeout. The side taken is quiet (the issue's "quiet helps recovery").
- **Flexibility against Maintainability.** Windows-only v1.
- **No business driver.** AGENTS.md names none, so each side leans to what is cheaper to reverse.

**Boundaries.**
- *Always:* test first, then `athanor run check`, then bump the version.
- *Ask first:*
  - any new dependency or download, and any frontmatter key;
  - any change to another skill or to the mod;
  - any threat-model scope change.
- *Never:*
  - a fixed path;
  - a transcript in a shell;
  - a product name in the skill prose;
  - a recorder from the current folder.

**Rollback and stop.**
- **Pull a shipped version.** Revert T1's merge and bump the version. The scripts stay inert without `SKILL.md`.
- **Clean up after use.** `listen.mjs off` removes the state. A person who added D5's fallback line removes it themselves.
- **Stop the build and go back to Design when:**
  - case 1 still fails after the fallback; or
  - case 5 or case 6 acts on speech alone; or
  - any case speaks from the wrong session.

**Retire it if:**
- after two weeks the usage table shows no drop in load; or
- it is turned off more often than on; or
- it misfires twice after a fix.

## Open, for the lead

- **O1.** The name `live`, fixed now (D1).
- **O2.** The release order (D16, S11).
- **O3.** D17: heard text is never typed words, and reserved decisions get the read-back.
- **O4.** D18: the chain limit's number (three proposed).
- **O5.** The owner's installs for T4, and when they happen.
- **The rest.** The proceed, fix or kill on this spec. The ticket cut in S11. The security dispositions in the round record.
