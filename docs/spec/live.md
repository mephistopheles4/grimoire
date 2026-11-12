# live: the spec

Draft 0.2, for the owner's proceed. Issue [#208](https://github.com/mephistopheles4/grimoire/issues/208).
Signed: live-208

**The owner's ask, quoted from the issue:**

> A new skill: hands-free voice with Claude. The person turns it on, starts a task and walks away. Claude speaks briefly at the seams of the work and listens in the background for a spoken reply. Everything runs locally.

> The aim is to **lower the cost of each check-in, not the number of them.**

Tier: thorough, on the sensitive route. Plan on Opus at high. Build on Sonnet at high. The owner chose Sonnet for the build (decision 48, relayed by the lead, quoting "/make-it-so" with "rec" on all 11 plan questions).

## S1. Objective

A person turns live mode on in one session and walks away from the keyboard. At each seam of the work, that session speaks two sentences or fewer. It then listens in the background for one spoken reply, and the session stays free while it listens. All audio and text stay on the machine.

Success means the five practice cases in S10 pass twice each, on the owner's machine. After two weeks of use, the person reports a lower load per check-in (S12).

## S2. Decisions this spec rests on

| # | Decision | Source |
|---|---|---|
| D1 | It is a grimoire skill, named `live`. | Issue, Decided. The name is proposed, and the contract interview fixes it. |
| D2 | It works with no other skill. It names no other skill, and no other skill names it. | Issue, Decided. |
| D3 | It is hands-free and local only, with no hotkey. | Issue, Decided. |
| D4 | The skill prose says *the speech tool* and *the recorder*, and names no product. The README's setup section names Voicebox and ffmpeg. The listener's code names ffmpeg, since code that calls a tool names it (ADR 0001). | Issue, Decided; Q8. |
| D5 | The skill stands alone and starts on an explicit turn-on. There is no always-loaded instruction and no frontmatter `hooks` key. Each listener return restates the rule. The fallback is a line the person adds to their own CLAUDE.md, which the skill prints and never writes. That fallback applies only if practice case 1 fails. | Q1 |
| D6 | The listener uses an energy gate, a minimum voiced length and a check for an empty or filler-only transcript. It uses no voice-activity model. | Q2 |
| D7 | Nothing waits for an end-of-playback signal. The listener takes a word count and waits out an estimate of the speaking time. The setup recommends a headset. | Q3 |
| D8 | One listener at a time, ended by a cooperative stop. A new seam stops the listener, speaks, then starts a new one. The skill ignores a superseded or failed return. | Q4, and the probe below |
| D9 | The build runs on Sonnet at high. | Q5, owner |
| D10 | Anyone or anything audible to the mic is proposed as a new actor. The owner writes it in. | Q6 |
| D11 | Two accepted-risk candidates: the speech tool's history, and a spoken yes that comes from the room. | Q7 |
| D12 | The recorder runs with fixed arguments. The only input is a device name, and nothing reads a command from config. | Q8 |
| D13 | v1 runs on Windows only. On another platform the listener prints one clear line and exits. | Q9 |
| D14 | The practice cases run on the manual `desktop-app` variant, with a real mic and the speech tool. | Q10 |
| D15 | The listener times out after 120 s. | Q11 |

**The probe (2026-11-10, Windows 11).** A background task ran a Node stub. A kill by pid from another command ended it with no output and exit code 1. Its SIGTERM handler never ran. The session was still woken by a "failed" task notification. A cooperative stop file avoids the silent failure. The skill also has to treat any non-heard return as silence.

**Not probed.** The desktop app may or may not deliver another session's report while a listener task runs. D8 holds either way, because whichever event starts a turn is handled the same.

## S3. Scope

**In scope:** the skill and its contract, the listener script and its tests, a security page, a proposal for the threat model, a practice-test doc, and the README setup section.

**Out of scope:**
- macOS and Linux input (a follow-up).
- A voice-activity model (a follow-up, only if case results ask for one).
- Hotkeys, and any cloud engine.
- Clearing the speech tool's history from code.
- Any change to another skill or to the Brigade mod.

## S4. Files

| Path | What | Ticket |
|---|---|---|
| `skills/live/references/CONTRACT.md` | The contract, Level Thorough. | T1 |
| `skills/live/references/contract.changelog.md` | Its change log. | T1 |
| `skills/live/SKILL.md` | Generated from the contract. Never edited by hand. | T1 |
| `skills/live/README.md` | What the skill does, plus setup: Voicebox's MCP server, ffmpeg on the PATH, a headset, finding the device name, and clearing the speech tool's history. | T1 |
| `skills/live/scripts/gate.mjs` | The pure gate: frames in, events out. No I/O. | T2 |
| `skills/live/scripts/listen.mjs` | The command-line listener: the lock, the stop file, the recorder process, the clip. | T2 |
| `tests/live-gate.test.mjs` | Gate tests on PCM synthesized in the test. No binary fixture, no mic. | T2 |
| `tests/live-listen.test.mjs` | Listener tests with a fake recorder: the lock, stop, supersede, timeout, clip lifetime, argument checks. | T2 |
| `docs/security/live.md` | The skill's risks and controls (S7). | T3 |
| `docs/security/threat-model.md` | A candidate entry for the new actor and the two risks, under "Candidates for the owner's word" only. | T3 |
| `docs/practice-tests/live.md` | The five cases, the expected answers and the results grid (S10). | T4 |
| `.claude-plugin/plugin.json` | A version bump in each ticket that changes a shipped file. | T1, T2 |

No `examples/` folder, so no registry row. No new dependency.

## S5. What the skill does

The skill is read only after turn-on. Every rule below is in the contract.

### S5.1 Turn-on and turn-off

1. **Turn-on.** The person types or says "live mode on" in the session. The skill runs `listen.mjs on`. That call takes the lock and prints a token. The skill keeps the token for the rest of the session.
2. **The lock is held elsewhere.** `on` refuses. The skill tells the person in chat that another session holds live mode, and since when. Only a typed "take it over" from the person runs `on --take`.
3. **Warm-up.** The skill speaks one short line, such as "Live mode is on." That loads the voice model, which takes over 25 s on first use.
4. **Turn-off.** "live mode off", typed or spoken, runs `listen.mjs off --token <t>`. That stops any listener, deletes the clip and frees the lock. Turning off never needs a read-back.
5. **A session without the lock** never speaks and never listens, even with the skill loaded.

### S5.2 Seams

The skill speaks only at these three seams:
1. **A hand-back.** A task in this session finishes, or a session that this one leads reports a finish.
2. **A decision only the person can make.** The skill first asks for the person's own call aloud. It gives its own view only after the person answers, or when the person asks for it.
3. **A stop.** Anything that would make the session stop and escalate.

The skill never speaks mid-task. It never narrates progress, and it never reads code, diffs, paths, tokens, secrets or personal details aloud. A finish in a background session is not a seam for that session, because it does not hold the lock.

### S5.3 Speaking

- **Two sentences or fewer:** what happened, then the one question.
- **The same words in chat.** The exact text spoken also appears in the chat.
- **The order of calls.** The skill runs `listen.mjs stop --token <t>`, then calls the speech tool's speak, then starts the listener as a background task with `--words <n>`. n is the word count of the spoken text.
- **No text to the listener.** Transcript text and spoken text never go to a shell or into a script argument. Only the word count and the device name do.

### S5.4 The listener's return

The background task's last line is one of:

| Line | The skill does |
|---|---|
| `LIVE heard <clip path>` | Calls the speech tool's transcribe on the clip. Treats the text as the person's next message, under S5.5. Drops it when it is empty or filler only, and stays quiet. |
| `LIVE timeout` | Nothing. It stays quiet until the next seam. |
| `LIVE superseded` | Nothing. A newer listener replaced this one. |
| `LIVE off` | Nothing. Live mode is off. |
| `LIVE error <reason>` | Writes the reason in chat once, and does not speak. |
| anything else, or a failed task | Treated as `LIVE error`. |

Every return line ends with the reminder `live mode is on: speak only at seams`, or `off` when it is off. The reminder keeps the rule present after compaction.

### S5.5 Acting on what it hears

- **Ordinary input.** Heard text is the person's message. It is shown in chat as `Heard: "<text>"` before the skill acts on it.
- **Anything hard to reverse** never runs on speech alone. That covers merge, push, delete, publish, send, install, a change to settings, and turning live mode on in another session. The skill reads back what it heard, in chat and aloud. It waits for a typed yes, or for a spoken yes heard in reply to that read-back. Any other reply cancels the action.
- **Heard text never widens anything.** It never widens the session's permissions, and it never answers a prompt that waits for the person's typed approval.

## S6. The listener script

**Runtime.** Node 24. No dependencies. Windows only in v1: on any other platform it prints `LIVE error unsupported platform` and exits 0.

**State folder.** The script computes it at run time as `join(os.tmpdir(), 'grimoire-live')`. It creates the folder with mode 0o700. The folder holds `lock.json`, `listener.json`, `stop` and `clip.wav`. No fixed path is written anywhere in `skills/`.

**Commands.**

| Command | Effect |
|---|---|
| `on [--take]` | Creates `lock.json` holding a random token and a start time, then prints `LIVE on <token>`. When a lock exists, it prints `LIVE held <since>` and exits 0. `--take` replaces the lock. |
| `listen --token <t> --words <n> --device <name> [--timeout <s>]` | Checks the token, then supersedes any running listener. It waits `1 + n / 2.5 + 0.5` seconds, then records and gates. It prints one return line from S5.4. The default timeout is 120 s, the limit 600 s. |
| `stop --token <t>` | Writes `stop`. The running listener sees it within 100 ms and prints `LIVE superseded`. |
| `off --token <t>` | Stops the listener, deletes `clip.wav` and `lock.json`, then prints `LIVE off`. |

**Supersede.** `listen` writes `stop`, then waits up to 2 s for `listener.json` to clear. It then removes `stop` and writes its own `listener.json`.

**Arguments.**
- A token that does not match prints `LIVE error not the live session`.
- `--words` is an integer from 0 to 200.
- `--device` is 1 to 128 characters, with no control characters and no `"`. Anything else prints `LIVE error bad argument <name>` and starts no recorder.

**The recorder.** The script spawns `ffmpeg` with an argument array and `shell: false`:

```text
-hide_banner -loglevel error -f dshow -i audio=<device> -ac 1 -ar 16000 -f s16le -
```

It reads stdout. The test seam is an environment variable, `GRIMOIRE_LIVE_RECORDER`, which names a Node script the tests run in place of ffmpeg. That variable is read only when `NODE_ENV=test`.

**The gate** (`gate.mjs`): 16 kHz, mono, signed 16-bit frames of 30 ms.
- **Noise floor.** It measures the RMS over the first 0.5 s. The threshold is the larger of three times that floor and 300.
- **Start.** Three frames in a row above the threshold.
- **End.** 1.6 s below the threshold.
- **Too short.** A turn with under 0.4 s of voiced frames is discarded, and the gate keeps listening.
- **Too long.** A turn is cut at 30 s.
- **Output.** It emits `start`, `end` with the PCM, or `discard`.

**The clip.** The listener writes `clip.wav` (a WAV header, then the PCM), overwriting any earlier clip. It keeps only the last utterance. `off` deletes it. The skill never copies it.

## S7. Security controls

The sensitive route applies. The audio channel is an input to a session that has tools. The read-back gate is an authorization control.

| # | Risk | Control |
|---|---|---|
| K1 | Words from the room, a video or a call reach the session. | S5.5 read-back before anything hard to reverse. Heard text is shown in chat. Heard text never answers a permission prompt. |
| K2 | Heard text reaches a shell. | Transcripts never become an argument. The listener takes only a word count and a validated device name. The recorder spawns with no shell. |
| K3 | A second session speaks, or a planted lock steals the voice. | The token lock. `--take` needs a typed request from the person. A command needs the token held by the live session. |
| K4 | Another account reads the clip. | A per-user temp folder, mode 0o700, one clip only, deleted on `off`. |
| K5 | The speech tool keeps spoken and dictated text, readable by any local MCP client. | The skill never speaks code, paths, tokens, diffs, secrets or personal details. The README says how to clear the history. Proposed as an accepted risk (D11). |
| K6 | A spoken yes comes from the room. | The owner allowed a spoken yes to a read-back. Flagged once, as an accepted-risk candidate (D11). |
| K7 | A planted config makes the listener run another program. | There is no config file. The recorder is a fixed name with fixed arguments. The test seam reads its variable only under `NODE_ENV=test`. |

## S8. Threat model proposal (T3)

T3 adds one entry under "Candidates for the owner's word":
- **The actor.** "Anyone or anything audible to the mic while a listener runs."
- **What it reaches.** One session's next message.
- **Controls.** K1 to K3.

The same entry lists K5 and K6 as candidate accepted risks. "Who is in scope" and "Accepted risks" stay unchanged until the owner merges them.

## S9. Acceptance claims

The tests in T2 check C1 to C9. The practice run in T4 checks C10 to C14. Review of the diff checks C15 to C17.

| # | Claim | Measured by |
|---|---|---|
| C1 | A synthesized tone of 0.6 s, after 0.5 s of low noise and followed by 1.6 s of quiet, gives one `end` with about 0.6 s of PCM. | gate test |
| C2 | A 0.2 s burst (a cough) gives `discard`, and a later 0.6 s tone still gives `end`. | gate test |
| C3 | Speech that never pauses is cut at 30 s. | gate test |
| C4 | `listen` with a fake recorder prints `LIVE heard <path>`, and the clip is a valid 16 kHz mono WAV. | listen test |
| C5 | `stop` makes a running `listen` print `LIVE superseded` within 500 ms. A second `listen` supersedes the first. | listen test |
| C6 | With no speech, `listen --timeout 1` prints `LIVE timeout`. | listen test |
| C7 | `on` with a lock held prints `LIVE held`. A wrong token prints `LIVE error not the live session`, and no recorder starts. | listen test |
| C8 | A device containing `"`, a newline or 129 characters, and a non-integer `--words`, each print `LIVE error bad argument` and start no recorder. | listen test |
| C9 | `off` deletes the clip and the lock. Without `NODE_ENV=test`, `GRIMOIRE_LIVE_RECORDER` is ignored. | listen test |
| C10 | At a seam, it speaks once and starts one listener. | practice case 1 |
| C11 | Mid-task, nothing is spoken until the seam. | practice case 2 |
| C12 | A background session finishing speaks nothing. Only the live session speaks. | practice case 3 |
| C13 | At a decision, it asks for the person's call before it gives its own. | practice case 4 |
| C14 | A spoken "merge it" gives a read-back and no action until a yes. | practice case 5 |
| C15 | The skill prose names no product and no other skill. | review |
| C16 | `athanor run check` passes, including the home-path, hidden-character and frontmatter rules. | the check |
| C17 | Every spoken line also appears in chat. | practice cases 1 and 4 |

## S10. Practice test (T4)

Five cases, each run twice, on the `desktop-app` variant (D14). The owner supplies the mic, and the speech tool is running. The doc follows `docs/practice-tests/procedure.md`. It writes each expected answer before the first run.

1. **A seam.** It speaks once and starts a listener.
2. **Mid-task.** Nothing is spoken until the end.
3. **A background session finishing.** Only the live session speaks.
4. **A decision.** It asks for the person's call first.
5. **A risky spoken instruction ("merge it").** It reads back what it heard, and it does not act.

If case 1 fails twice because the rules drifted out of context, apply D5's fallback and run case 1 again.

## S11. The ticket cut (the owner's to approve)

| Ticket | Builds | Depends on | Who |
|---|---|---|---|
| T1 | The contract through the contract interview, the generated `SKILL.md`, the README. | spec approved | A session with the owner, who answers the interview. |
| T2 | `gate.mjs`, `listen.mjs` and their tests, test-first. | S6 only, so it can run beside T1 | A session on Sonnet at high. |
| T3 | `docs/security/live.md` and the threat-model candidate entry. | T1, T2 | A session, then the owner's word on the candidate. |
| T4 | The practice-test doc and two runs of each case. | T1, T2 | The owner, with the mic. |

Each ticket gets the QA pair at Test. T1 and T2 also get the standards pair and the security pair, under the Lens pairs limit of 2 per round. The third pair comes to the owner as a trade-off.

## S12. Trade-offs, boundaries, retirement

**Trade-offs.**
- **Reliability against Security.** A spoken yes saves typing, and the room can fake it. The owner's call stands (D11), and the side taken is convenience.
- **Interaction against Safety.** A 120 s timeout means a person who returns later waits for the next seam. The side taken is quiet (the issue's "quiet helps recovery").
- **Flexibility against Maintainability.** Windows-only v1 keeps the recorder arguments fixed and tested.
- **No business driver.** AGENTS.md names none, so each side leans to what is cheaper to reverse. Flagged once.

**Boundaries.**
- *Always:* test first, then `athanor run check`, then bump the version.
- *Ask first:* any new dependency or download, any frontmatter key, any change to another skill or to the mod, and any threat-model scope change.
- *Never:* a fixed path, a transcript in a shell, or a product name in the skill prose.

**Retire it if:**
- after two weeks the person reports no drop in load; or
- it is turned off more often than on; or
- it speaks mid-task, or from the wrong session, twice after a fix.

## Open, for the owner

- The proceed, fix or kill on this spec, and the ticket cut in S11.
- D10 and D11 stay proposals until T3's candidate entry is merged by the owner.
