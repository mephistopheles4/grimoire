# Incantation on Voicebox: the spec

Draft 2.2, for issue #208, Thorough tier on the sensitive route (heard speech
becomes input to a session with tools, so the security pair reviews it). It
replaces the VoiceMode spec (draft 1.7, PR #622) and the `live` spec (closed
PR #590). Under W13 it is built test-first to a draft pull request, which is
never marked ready and never merged (W12, W13). The owner reviews the spec
and the build together there. The steps that need the owner are skipped, and
S14 says what the build did in place of each one.

Draft 2.1 held the fixes drafted after spec round 1. Draft 2.2 adds those
drafted after round 2, the final round. None of them is accepted yet.

Every choice below carries the tag of the owner's words it comes from, `W1` to
`W13` (S1). A choice with no tag is the spec's own.

## S1. The owner's words

Quoted as relayed by the lead (backlog-headchef) or as posted on #208, all
2026-11-12. Where a line is the lead's summary and not the owner's own
sentence, it says so.

- **W1, decision 194 (15:19):** "Go back to Voicebox: VoiceMode hit the same
  problems and needed the same kind of wrapper."
- **W2, decision 199 (the lead's summary of the owner's picks on the Voicebox
  draft):** Windows 11 only; the owner runs a 15-minute prototype first.
  *Its Windows-only part is replaced by W3. The prototype stands.*
- **W3, decision 317:** "Voicebox also works on mac and linux btw, i dont think
  we need the ON WINDOWS ONLY part"
- **W4:** "we even added voicemode as a dep when i asked not to"
- **W5:** "it should be a wrapper ... so we just switch it with voicebox"
- **W6, the demo's speed findings, recorded on #208 (issue body, and the
  comment of the owner's live run):** the first call after Voicebox starts
  spends over 25 s loading the model; listening waited on a fixed guessed
  delay; a heavier engine with a different voice cost about 30 s. The lead's
  reading, which the owner set as targets: warm it up at start, end on the real
  end of playback, keep the default voice on the fast engine.
- **W7, the owner's live run (reported by voice, posted on #208):** the mic
  stays open while the session speaks; each round has a long delay; there is
  no sign the person is being listened to; the listener should listen at all
  times, so no speech is lost between rounds.
- **W8, decision 270:** "I don't want it to simply reply at every turn. I want
  it to only speak to the human when something requires the human's attention.
  And I also wanted to tune how much it speaks to how much the human wants to
  hear. I don't want the rules to be rigid, but I think in general, it should
  ask itself, is there an actionable item here from the human? How can I
  summarize it in an easy conversational way?"
- **W9, decision 271:** the observe log is the future eval set. Behind it, the
  owner on #208: "I feel like using system models wrong creates opportunities
  for AI drift ... I feel like starting small and keeping that as an idea for
  later."
- **W10, still standing from #208:** "I think I'll skip the dependency and rely
  on some kind of hook or guard that detects if the dependencies are present
  and tell the user what to do."
- **W11, still standing from #208:** "I will go with incantation. ... I want it
  to feel alive and warm. And again, it's more casual conversationing, kind of
  like pair programming with somebody. And if I want more details, I'd ask for
  them." And: "We could use a $1 eval budget."
- **W12, still standing:** "for 208 leave it as draft PR when its finished
  please"
- **W13, 2026-11-13, relayed by the lead from the owner's chat:** "for
  voicebox i want to push that till the PR is ready and ill review it tomorrow
  too please". The lead's reading: run the final spec round, build
  test-first, open a draft pull request that is never marked ready and never
  merged, and skip and list every step that needs the owner. *It changes W2
  the way W3 did: the prototype stands, and now runs after the build, against
  it.*

What the owner's words rule out, so no later section can drift back:

- no VoiceMode, anywhere: not as a dependency, an engine, a fallback, a setup
  step or a name in a shipped file (W1, W4);
- no WSL, no engine launcher, no `parec` or `pactl` (W1, W3; the lead's reuse
  list);
- no Windows-only rule: the code is platform-neutral, and a platform branch
  exists only where the platform forces it, in the places S3 names (W3);
- no fixed or guessed wait before listening (W6);
- no reply at every turn (W8);
- no merge of #208, and its pull request never marked ready (W12, W13).

## S2. Objective

`/incantation` turns a Claude Code session into a voice pair-programming
partner (W11). Voicebox speaks and transcribes, locally (W1). Incantation adds
an always-on listener that never hears its own voice (W7), and the way the
session talks (W8, W11):

- it wakes warm, says in one line what it is there for, and offers a first
  step drawn from the session's state (W11);
- it speaks only when something needs the person, sized to what they want to
  hear, as a short conversational summary (W8);
- it says each request back and acts only on a yes; acts that are hard to
  reverse need a typed yes (1.7's S4 step 4, kept in S7.5);
- it listens at all times while it runs, shows that it listens and when it
  stops, and is muted from the start of its own speech to the real end of
  playback (W6, W7).

Incantation is a separate plugin in the `mephistopheles4` marketplace, not part
of the grimoire plugin. It declares no dependency on Voicebox or on anything
else: a guard checks the setup at each start and says what to do (W10, W4).

**Business driver.** None is written in AGENTS.md or CLAUDE.md. This spec
leans to what is cheaper to reverse (flagged once; the owner decides).

## S3. Platforms: tested and claimed

The code is the same on every platform (W3). These places differ by
platform, each as a data row or a check that reads its platform, never as a
separate code path:

| Place | Windows | macOS and Linux |
|---|---|---|
| Capture input and device list | `dshow` row (S5.4) | `avfoundation`, `pulse` or `alsa` rows (S5.4) |
| Finding the recorder | fully qualified drive folders on the PATH (590's rule) | absolute PATH entries (S5.4) |
| The state folder's privacy | the profile folder's default access rules; mode bits do nothing | 0700 folders and 0600 files, refused when looser (S5.5) |
| The OS mic permission | Settings, Privacy, Microphone, "let desktop apps use it" | macOS: the terminal or app running Claude Code needs Microphone access; Linux: none beyond the sound server |

Nothing else reads the platform. Stopping the listener, binding it to its
session and finding a live listener all go through Node built-ins and the
listener's own loopback channel (S6), never through `/proc`, a process list
or a spawned system tool.

| Platform | Voicebox | Status |
|---|---|---|
| Windows 11 | MSI installer | **Tested now** with a real mic: the October prototype and the 590 listener. The 15-minute prototype (S9) and the practice run (S8) run here. |
| macOS | DMG (Apple Silicon and Intel) | **Claimed only.** No check runs on macOS. |
| Linux | built from source (no prebuilt binary yet) | **Claimed only.** CI and the athanor container run the unit tests on Linux with fakes; no real-mic run is planned. |

Where the tests run: CI and the athanor container on Linux, and the host
check on Windows. Each platform's rows are tested on every runner by passing
the platform in (claim 13). A platform moves to tested only on a recorded
real-mic run of the practice steps (S8). macOS and Linux need someone else's
run (O3). The README carries both tables.

## S4. Scope

In: the plugin and `/incantation`; the engine seam and its one engine,
Voicebox (S5); the capture adapter (S5.4); `setup.mjs` (S5.5); the always-on
listener (S6); `guard.mjs` (S5.6); the skill, `tuning.md` and `observe.mjs`
(S7); the eval cases; the README; a marketplace entry; the repo checks widened
to `plugins/<name>/`; candidate threat-model entries (S10).

Out: a second engine (the seam makes one possible, W5; none ships); changes to
Voicebox; clearing Voicebox's history for the person (the machine's own, 1.7's
decision 169); Incantation playing audio itself; echo cancellation and a live
level meter (follow-ups); a hook of any kind; running Incantation in a session
that leads a brigade.

Reuse (the lead's list). From PR #622 (`incantation-208`, head `6d7dec86`),
kept and made engine-neutral: the skill and `tuning.md`; the gate (mute during
playback, the tail, a single muted notice, the "after reply" mark); the heard
queue and its delivery cap; `observe.mjs` and its filtering; `lib.mjs`'s text
cleaning; the typed-yes list; the widened repo checks; the tests for all of
these. Dropped: `launch.mjs`, `proxy.mjs`, the guard's WSL, VoiceMode and
socket checks, `parec` and `pactl` capture, and `/proc` reading. From closed
PR #590 (`785904ed`): the Windows recorder resolution, `dshow` capture and
device listing, and the stamped device list, kept as the Windows row of the
capture adapter and in `setup.mjs`. Its clip on disk, its token passed as an
argument, and its fixed speaking-time wait are dropped (W6, W7). Main at the base holds no
Incantation plugin: everything comes from those branches, and S13 gives each
file from #622 its state (kept, rewritten or dropped).

**Dropping the proxy.** 1.7's proxy held one path: a web page in the
person's browser reaching the speech engine's loopback API. The lead's reuse
list drops it, and nothing in this change replaces it. S10 names that path as
open, for the owner (O7).

## S5. The engine seam

One module boundary, so a second engine is a new file and no other change
(W5). The skill and the listener reach the engine only through the seam;
neither names Voicebox outside it.

### S5.1 The interface

Engines sit in a fixed table in code, `scripts/engines/index.mjs`, which maps
a name to a shipped module. The only entry is `voicebox`. The settings name an
engine by that name; the listener, the guard and `setup.mjs` each refuse an
unlisted name before any import, mic or network call. Tests pass a fake
engine through an exported start function; no command line, environment
variable or file names an override.

An engine module exports:

| Export | Does | Voicebox's version |
|---|---|---|
| `speakTools` | the exact full MCP tool names the session may call to speak, and the argument names it passes | `mcp__voicebox__voicebox_speak` only, with `text` and `profile` (the profile id) |
| `mcpServer` | the server name the README registers, and the one form the guard accepts for it | `voicebox`, at user scope, `http` transport, URL `http://127.0.0.1:<port>/mcp` |
| `host`, `port` | where the engine answers | the literal `127.0.0.1`, never `localhost`; port 17493 unless the settings name another; nothing else changes either, and no proxy setting is read (S6) |
| `warm()` | loads the speech and transcription models, and resolves with the time it took | S5.3 |
| `transcribe(pcm)` | one turn's audio, held in memory, to text | `POST /transcribe`, multipart, a WAV `file` part, Voicebox's default model |
| `playback()` | an emitter of `start` and `end` for every utterance the engine plays, from any caller | S5.2 |
| `capture` | which capture adapter to use | the shared ffmpeg adapter (S5.4): Voicebox has no capture call |
| `health()` | whether the engine answers | `GET /health`, read and discarded |

**Where Voicebox's values come from, before the prototype runs (W13).** Each
value in the right-hand column is taken from Voicebox 0.5.0's own published
interface: its OpenAPI schema, served at `/openapi.json`, and its MCP tool
list as Claude Code shows it. The tool list names the speak tool
`mcp__voicebox__voicebox_speak`, with arguments `text`, `profile`, `engine`,
`language` and `personality`. The server's own instructions call it
`voicebox.speak`, which is its name inside the server, not a tool name a
session can call. None of these values has been watched working. They sit in
one table at the top of `engines/voicebox.mjs`, each marked unverified with
the prototype check that confirms it (S9), and the pull request lists them.
No value is guessed: one the schema does not give is left out, and the
module fails closed without it.

### S5.2 Playback ended: the real end, not a guess (W6, W7)

The listener mutes from each utterance's `start` until its `end`, plus the
tail. Nothing estimates a wait from text, word count or speech length; a
duration the engine itself reports may be used. The session speaks through
the speak tool, which the listener never sees, so `playback()` must learn of
every utterance from the engine's own feed, whoever started it. Voicebox
documents no playback-ended event, so the prototype (S9, F2) picks the route,
in this order:

- **Route A, Voicebox's speech events.** `GET /events/speak`, a server-sent
  event stream of speak-start and speak-end events (0.5.0's schema). If it
  reports every utterance's start at or before its first sound, and its end
  within 300 ms of its last sound, the engine follows it.
- **Route B, the generation queue.** `GET /generate/{id}/status`, a stream per
  generation. If it reports every generation, from any caller, with the moment
  it starts to play and its duration, `end` is that moment plus that duration.

The build ships route A only, read from the schema's event names, since it is
the one route that sees every caller without a generation id. Route B is
built only if F2 fails route A.

Route C of draft 2.0, Incantation playing the audio itself, is dropped: it
would put a spoken line into a command, and it would not see other callers.
With neither A nor B, the work stops and the owner says how to go on (S11).

- **Kept from the feed:** only each utterance's start and end times. Its text,
  voice and id are dropped as they arrive.
- **Fails closed:** if the feed stops answering, the listener captures
  nothing and exits with `listener error playback`.
- **Its limits,** stated as 1.7 stated its own: an utterance from another
  caller also mutes the mic and also sets the "after reply" mark (S6); a feed
  that answers but misses one utterance lets the mic hear it, and that turn
  is heard speech like any other (S10); sound from other programs is not on
  the feed at all.

### S5.3 Warm at start (W6)

- The listener calls `warm()` as soon as it starts (S7.1 step 4), in the
  background.
- `warm()` loads the transcription model with one second of silence. 0.5.0's
  schema also has `POST /models/load`, which loads a speech model and plays
  nothing, but its default size names a large model that need not be the
  profile's engine, so loading it could cost the time W6 wants saved. Until
  F1 shows a load that warms the profile's own engine, `warm()` does not call
  it, and the greeting is the speech warm.
- `wait` reports `ready <ms>` once `warm()` resolves, and the greeting waits
  for `ready`. The skill prints `Warming the voice…` before it. While the
  greeting is the speech warm, it is left out of the 2 s target.
- A warm that has not finished in 60 s ends the start with `listener error
  warm`. The engine gives the warm's own transcription that same limit, not
  the 15 s of an ordinary one, so a cold model load is not cut short.
- **Target, measured:** after the greeting, no spoken turn pays the model's
  load: the time from a speak call to its first sound is 2 s or less, as the
  median of 10 turns, on the default profile. The practice run records it; a
  miss is reported, not a pass gate.
- **Its limit:** a Voicebox restart in the middle of a session makes the next
  three transcriptions fail, which ends the listener (`listener error stt`);
  `/incantation` again warms again.

### S5.4 Capture: the platform rows (W3)

Voicebox has no capture call, so capture is a shared adapter,
`scripts/capture/ffmpeg.mjs`, that any engine may use. It runs ffmpeg with no
shell, with the state folder as its working folder, 16 kHz mono signed 16-bit
on stdout. Capture discards ffmpeg's stderr. A device listing reads both
stdout and stderr, since `-list_devices` prints to stderr and `-sources` to
stdout, and only in `setup.mjs` and the listener's stamp check, never into a
session. Its rows:

| Platform | Input | Device list | Device kept as | Recorder found by |
|---|---|---|---|---|
| Windows | `-f dshow -i audio=<id>` | `-list_devices true -f dshow -i dummy`, parsing both the `dshow` and the newer `in#0` tags (the owner's run) | the list index and its stamp | fully qualified drive folders on the PATH only; the real path must still be a drive path (590's rule) |
| macOS | `-f avfoundation -i :<index>` | `-list_devices true -f avfoundation -i ""`, audio section | the list index and its stamp | absolute PATH entries only |
| Linux, PulseAudio or PipeWire | `-f pulse -i <source>` | `-sources pulse` | the list index and its stamp | as macOS |
| Linux, no sound server | `-f alsa -i <card>` | `-sources alsa`, used when `-sources pulse` fails | the list index and its stamp | as macOS |

- **The stamp.** A hash of the device list, as 590 made it. At each start the
  listener lists the devices again; a changed stamp ends it with `listener
  error device`, and the README says to run setup again. No device name or id
  is kept in a file or printed to a session.
- **The recorder** is resolved once, at setup, and its real path is pinned in
  the settings. At start the listener resolves it again by the same rule and
  refuses a different real path (`listener error recorder`). On every
  platform a PATH entry that is relative, empty, the current folder, or inside
  the folder Claude Code started in, is skipped; settings, programs and test
  seams are never taken from the working folder or the environment. On macOS
  and Linux the recorder and every folder above it must also be owned by root
  or the person's account and be writable by neither group nor others, so no
  other account can swap it. Its limit: a recorder installed under another
  account (a shared Homebrew prefix, for one) is refused, and the README says
  so.
- **Test fixtures** for the device listings are made up: invented names and
  ids, no real device, no path. A listing copied from a real machine never
  lands in the repository.
- **A silent mic.** When the OS mic permission is off, capture can give only
  digital silence with no error. Frames that are all zero for the first 3 s
  end the start with `listener error mic`, and the README's permission step
  names the setting (S3).
- The macOS and Linux rows are written from ffmpeg's documentation and tested
  with a fake recorder only (S3).
- The owner's run needed a temp folder on the system drive for 590's clip on
  disk. No clip is written now, and nothing is played from a file, so that fix
  does not apply.

### S5.5 Settings and setup

One file, `~/.incantation/settings.json`. It is written only by
`setup.mjs`, which the person runs in their own terminal (README step 3),
never a session. No session reads it: the listener passes the skill what it
needs (S6, the `ready` line).

| Key | Type and range | Default |
|---|---|---|
| `engine` | a name from the engine table | `voicebox` |
| `port` | integer 1024 to 65535 | 17493 |
| `profile` | the engine's profile id, letters, digits and `-` only, 1 to 64 | the fast default (below) |
| `device` | `{ index: 0..999, stamp: 16 hex }` | none: setup asks |
| `recorder` | the pinned real path | none: setup resolves it |
| `endOfSpeechMs` | integer 300 to 2000 | 1000 |

- `setup.mjs devices` prints the stamp and each device as an index and a
  cleaned name, cut at 64 characters, and never a path. `setup.mjs profiles`
  prints Voicebox's profiles as id and cleaned name. `setup.mjs choose
  <index> <stamp> <profile id>` checks the device against a fresh list and
  the profile against Voicebox's list, resolves and pins the recorder, and
  writes the file. All three run in the person's own terminal, so device and
  profile names never reach a session.
- **The state folder** `~/.incantation/`, with `run/` and `observe/` inside,
  sits in the person's home. On macOS and Linux every folder is 0700 and every
  file 0600, made so before anything is written, and a looser mode found later
  fails closed. On Windows the profile folder's default access holds it, since
  mode bits do nothing there (590's finding). A link or junction in its place,
  or a real path outside home, fails closed on every platform.
- **The default voice stays on the fast engine (W6).** The README's setup step
  tells the person to choose a preset profile on the fastest engine. Until F3
  measures them, it names Kokoro, the engine the owner's demo found fast. When
  F3 has run, the README names the engine it found fastest under the 2 s
  first-sound target. A profile on a heavier engine is the person's own pick.
- Incantation's settings file and anything under `~/.incantation/` other
  than the observe inbox are on the typed-yes list (S7.5).

### S5.6 The guard (W10)

`guard.mjs`, a Node script with no dependencies, runs before the listener at
each start and prints one line: `ok`, or the first failure with the README
step that fixes it. It never prints an address, a path or a setting's value.
It checks:

1. Node 24 or later, the repo's floor;
2. the settings file parses, every key is in range, and the engine is in the
   table;
3. the engine's `health()` answers on `127.0.0.1` at the settings' port;
4. that port answers on no non-loopback address of this machine (1.7's reach
   check: each non-internal address, 500 ms, in parallel);
5. the engine's `mcpServer` has exactly one entry, at user scope in
   `~/.claude.json`, in the engine's one accepted form (for Voicebox, `http`
   at `http://127.0.0.1:<port>/mcp`, with no header but Voicebox's own
   `X-Voicebox-Client-Id`, whose value is never read); an entry under that name at local scope
   (any project in `~/.claude.json`) or in the working folder's `.mcp.json`
   fails, since it would outrank the user's own. The files are read for key
   names, transport and URL only, and never printed. Config sources the guard
   does not read (managed settings, a launch flag) are not checked, and the
   README says so;
6. the pinned recorder resolves by the platform's rule to the same real path;
7. the state folder's checks (S5.5).

It finishes within 2 s; the device list is not run here (the listener does
it, S6). One top-level handler in each script turns every error, a JSON
parse error included, into its fixed line, so no message that quotes file
content reaches a session.

The skill checks the speak tool itself: exactly one of the engine's
`speakTools` is present. None: it prints the README's Voicebox setup lines
and stops, with no other tool call. More than one: it says so and stops.

## S6. The listener

`scripts/listen.mjs`, Node, no dependencies, with `start`, `wait` and `stop`.
It is 1.7's listener (S4.3 there) with the engine seam in place of `parec`,
`pactl` and the proxy. Kept as 1.7 set them, each a starting point in one
`KNOBS` table: 30 ms frames; the room's level measured for 1 s, then a running
floor; voice at 10 dB over the floor; a turn ends after `endOfSpeechMs`; under
0.25 s of voice is dropped; a turn over 30 s is cut; at most 20 turns wait,
none longer than 5 minutes; deliveries held to 4 a minute, never holding a
whole turn of "stop", "that's all" or "wait", or the first turn marked "after
reply" after a playback.

- **Start.** The skill runs it only after the guard's `ok` (S7.1). It checks
  the engine against the table, the settings' ranges, the state folder, the
  pinned recorder and the device stamp, opens the playback feed and waits up
  to 5 s for it to answer (else `listener error playback`), then calls
  `warm()` and opens the mic, so no playback begins unseen.
- **One listener.** `start` sends `ping <token>` to the port `run/listen.json`
  names. A live listener answers the fixed line `alive`, never the token, and
  the probe holds no slot and takes no turn. On `alive`, `start` exits with
  `listener error busy` and leaves the live one running. A stale file (no
  answer) is replaced.
- **Always on (W7).** The mic stays open while the listener runs. Turns heard
  while no `wait` is connected wait in the queue.
- **Muted during playback (W7).** Frames are dropped from each utterance's
  `start` (S5.2) until its `end` plus the tail (300 ms unless the prototype
  measures more, at most 1500 ms). A turn open when playback starts is
  dropped. When the mic has been muted for more than 30 s at a stretch, `wait`
  returns `muted` once for that stretch.
- **The "after reply" mark,** as 1.7: a turn begun after a playback that
  started after the previous delivery and ended, tail included. Its limit:
  another caller's utterance in that window also sets it (S5.2).
- **Transcription** goes through the engine's `transcribe()`, in memory, only
  to `127.0.0.1`. Incantation writes no audio and no heard text to any file or
  log. An empty transcript is dropped; one failure prints `stt-dropped`; three
  in a row end the listener. What Voicebox itself keeps of a transcription is
  F7's question, and the README says what it finds.
- **The channel.** The listener binds `127.0.0.1` only, on a port the system
  picks, and writes the port and a 32-byte token from `crypto.randomBytes` to
  `run/listen.json`. A connection must send `wait <token>`, `stop <token>` or
  `ping <token>` within 2 s, compared in constant time, or it is closed;
  until then it holds no slot. One waiter at a time; a second gets `listener error busy`. `wait`
  and `stop` read the token from the file themselves; it is never an argument,
  never printed, and the file is deleted on every exit. Against a program of
  the same account the token is cooperation only: such a program can read it
  and forge a delivery (S10).
- **`wait` prints** `Heard (after reply): "<text>"` or `Heard: "<text>"`, with
  control, invisible and line-separator characters removed, inner quotes
  escaped, cut at 500 characters; then `timing: wait <ms> stt <ms>`; then
  `plays <n>`, the playbacks from any caller that began since the last
  delivery; then, when they apply, `ready <ms> voice <profile id>`,
  `dropped <n>`, `stt-dropped` or `muted`. After 10 minutes with nothing it
  prints `quiet`; a waiter connected when the person's stop comes gets
  `stopped`. `wait` prints only lines of this grammar and drops any other, so
  whatever answers on a stale port reaches the session with nothing. When no
  listener answers within 3 s (no `listen.json`, or the port refuses), `wait`
  prints `listener error ended`.
- **Stop.** `stop` sends `stop <token>` on the channel; the listener kills its
  recorder, waits for it to exit, answers `stopped`, and exits. `stop` prints
  `listener stopped` only on that answer, and `listener: not running` when
  nothing answered. No PID is signalled and no process is inspected. A
  listener that cannot be reached that way is gone or is not this account's.
- **No proxy.** The engine's HTTP calls go out with Node's own `http` module
  and an agent made per call, which reads no proxy setting from the
  environment, so heard audio reaches only `127.0.0.1` even with
  `NODE_USE_ENV_PROXY` and a proxy variable set.
- **Bound to its session.** `start` records its parent process, the shell
  Claude Code ran it in, and exits within 1 s of that process ending, or of
  its own `process.ppid` changing (on macOS and Linux an orphan is moved to a
  new parent, so this is exact there), whatever waiters remain, dropping the
  queue. Node has no portable start time for another process, so on Windows
  a parent PID reused at once would hide the end; the second bound covers
  that: with no `wait` connected for 5 minutes, the listener exits too. This
  replaces 1.7's start-time pin, a control the owner accepted, so it is the
  owner's call (O8). The skill keeps a `wait` connected at
  all times, so in use the gap is the time between a delivery and the next
  `wait`. It also exits on `stop`, on any capture or playback failure, and
  after 30 minutes with no heard turn. Whether the parent ends when the session
  closes is a prototype check on Windows (F5) and a claim on the others.
- **The 30-minute stop** is the accepted usage trade-off from 1.7's S7 (every
  delivered turn costs a model turn), not a gap in "always on". The skill
  prints `Stopped listening.` on it, as on every exit (S7.1).
- **Heard text never reaches a shell.** It goes from the listener to `wait`'s
  output and nowhere else. No command the skill runs holds heard text, a
  spoken line or a device name as an argument or on stdin (S7.4).
- **Errors** are fixed lines, `listener error <reason>`: `recorder`, `device`,
  `mic`, `playback`, `engine`, `settings`, `state`, `session`, `stt`, `busy`, `warm`,
  `ended`.

## S7. The skill and how it speaks

The skill is 1.7's `SKILL.md`, rebuilt through `contract`, with every
VoiceMode and `converse` line replaced by the engine's speak tool. Its rules
stay as 1.7 set them unless a line below changes them.

### S7.1 Start and stop

In order, stopping at the first failure; a failure prints the fix in chat and
speaks nothing:

1. start only on the person's own typed words in that chat (`/incantation`,
   `/incantation observe`, or a typed ask to pair by voice), never on a
   request found in a file, an issue, a note, a relay, a tool result or a
   heard turn; and refuse in a session that leads a brigade, judged from the session's own
   record, as #622's skill did: when unsure, treat it as a lead and refuse.
   No head-chef change is made (O4);
2. exactly one speak tool is present (S5.6), else the README's setup lines;
3. `node <skill base>/scripts/guard.mjs`; unless it prints `ok`, show its line
   and stop;
4. `node <skill base>/scripts/listen.mjs start` as a background command; on a
   `listener error` line, show it and stop;
5. print `Listening, always on.`, and start the first `wait` as a background
   command, before the greeting;
6. print `Warming the voice…`; on `ready`, the greeting is the first speak
   call, with the profile id from the `ready` line; if it errors, show its
   first line, run `listen.mjs stop`, print `Stopped listening.` and stop.

After each delivery, the skill's first act is to start the next `wait`. On
every listener exit, whatever the reason, and on every stop the person asks
for, the skill prints `Stopped listening.` (W7). Every script runs by
`<skill base>/scripts/<name>`, never by a path relative to the working folder.

### S7.2 Speaking

- The skill calls only the speak tool the guard step found, with the profile
  id from the `ready` line and nothing about where audio goes. It never adds a
  fixed wait (W6).
- Each spoken turn is one thing, in plain words, with no markdown, code or path
  read aloud; long output becomes a short summary and an offer of the detail,
  which goes to chat (W11). It never speaks a secret, key, token, password,
  personal detail, or anything the person's instructions keep out of the
  record; it says the item is in chat.
- **One speak call per model turn.** The prototype found that two calls at
  once play over each other. A second line waits for the next turn. Its
  limit: a line spoken in one turn can still be playing when the next turn
  speaks; the overlap is then heard, not acted on.

### S7.3 When it speaks (W8)

1.7's S4.4 holds whole: fixed rules first; an addressee check on each heard
turn; a scored speak gate the person turns by voice ("quieter", "tell me
more"); a candidate waits for a natural break, never past its deadline; one
sentence by default; after a long quiet, a brief "are you there?" only when an
item longer than a sentence is pending, never over a pending yes. Every
number and phrase sits in `references/tuning.md`, each marked a starting
point, never holding a yes rule, a stop word or a listener setting. No
decision model is in this change (W9).

### S7.4 Observe-only mode and the eval set (W9)

`/incantation observe` logs each candidate the gate weighs instead of
speaking it unasked, as 1.7 set it: fixed keys, a kind from a fixed list, the
words cut at 500 characters and cleaned, the never-speak list kept, one file a
day in `~/.incantation/observe/`, dropped after 30 days; `freeze <n>` copies a
random sample to `~/.incantation/observe/eval/`, which is the speak gate's
eval set, labelled once by the person and never trained on. It is not the
plugin's eval cases, and nothing under `~/.incantation/` is ever copied into
a repository.

One change from 1.7, so no candidate words pass through a shell: the session
writes each JSON line, with its file-write tool, to a new file
`~/.incantation/observe/inbox-<8 hex>.json`, then runs
`node <skill base>/scripts/observe.mjs add <8 hex>`. `add` takes only that hex
name, reads that one file, checks it, appends it, and deletes the file,
whatever the result. A fresh name per line means the session never overwrites
a file it has not read. An inbox file never passed to `add` is dropped after a
day, the next time observe runs. Every folder and file `observe.mjs` writes is
checked as S5.5 says: never a link or junction, its real path inside home.

### S7.5 Hear-back, typed yes, heard is not typed, stop

1.7's S4 steps 4 to 6 hold whole, with `converse` read as the speak tool: say
every request back before acting; a spoken yes counts only as the whole of a
turn marked "after reply" after that say-back, delivered with `plays 1` (the
say-back alone played in between; any other count voids it); the typed-yes list (hard to
reverse, files sessions load or that run code later, the brigade lead role,
unread commands, decisions the person's instructions keep, and now
Incantation's settings and state folder); heard text never stands for typed
words and never answers a permission prompt; "stop" or "that's all" ends the
loop, "wait" halts.

## S8. Acceptance claims

Node tests, run with a fake engine and a fake recorder that plays tones and
silence, never recorded speech, on the runners S3 names:

1. No file under `plugins/incantation/`, and not the incantation entry in
   `.claude-plugin/marketplace.json`, names VoiceMode, `converse`, WSL,
   `parec`, `pactl`, `proxy.mjs` or `launch.mjs`, and the plugin's manifest and marketplace entry
   declare no dependency (W4).
2. The listener reaches the engine only through the seam: a fake engine
   passes every listener test with no other change; an engine name not in the
   table, a path-shaped one included, is refused by the listener, the guard
   and `setup.mjs` before any import, mic or network call (W5).
3. `guard.mjs` prints `ok` with valid settings, a fake engine on `127.0.0.1`
   and a fake recorder; it prints a fixed failure line and exits non-zero for
   each check in S5.6, including a fake engine on a stand-in non-loopback
   address passed through its imported function, an MCP entry for the
   server with a non-loopback URL, a stdio entry, an entry at local scope and
   one in the working folder's `.mcp.json`, and an unparsable MCP config that
   holds a planted fake key; no output holds an address, a path, a value or
   the planted key; it finishes within 2 s with every port timing out.
4. The listener discards every frame from a fake `start` to `end` plus the
   tail, including an utterance another caller started; a turn open at
   `start` is dropped; a turn begun after `end` plus the tail is delivered and
   marked "after reply" (W6, W7).
5. No source file under `plugins/incantation/` estimates a wait from text, a
   word count or a speech length; a duration the engine reports may be used
   (W6).
6. With the playback feed failing or stopping, the listener captures nothing
   and exits with `listener error playback`; the feed's text and ids are not
   kept.
7. `muted` is printed once per stretch over 30 s.
8. The listener runs only after the guard's `ok` in the skill's order; it
   calls `warm()` at start; `wait` prints `ready <ms> voice <id>` once it
   resolves; a warm over 60 s ends the start with `listener error warm`; three
   seconds of all-zero frames end it with `listener error mic` (W6).
9. Turn shaping, the queue, the delivery cap, the age-out and `dropped <n>`
   behave as 1.7's claim 19 said.
10. The channel binds `127.0.0.1` only and refuses a connection on any other
    address; a connection with no token, a wrong one, or none within 2 s is
    closed and holds no slot; a second waiter gets `busy`; `ping` answers
    `alive`, never the token, and takes no queued turn; a second `start`
    with a live listener exits `busy` and leaves it running; `listen.json` is
    deleted on every exit. On POSIX the state folder and files must be 0700 and
    0600 and a looser mode is refused; on every platform a link (POSIX) or
    junction (Windows) in place of the folder, or a real path outside home,
    fails closed.
11. The listener exits within 1 s of its recorded parent ending, or of its
    `process.ppid` changing while the recorded parent still looks alive, with
    a waiter connected, and drops its queue; `wait` with no listener prints
    `listener error ended`; it exits after 5 minutes with no waiter,
    on `stop` (which reaches it only through the channel, and after which its
    recorder child has exited, asserted on win32 too), and after 30 minutes
    with no turn.
12. Incantation writes no audio and no heard text: after a turn, no file under
    the fixture home or temp folder holds either; `wait` prints each turn
    cleaned and cut as S6 says; errors are fixed lines, also for an
    unparsable `listen.json` or settings file.
13. The capture adapter picks each platform's row by a passed-in platform
    value, so every row runs on every runner; each row's device parser reads a
    made-up listing in that row's format, on the stream ffmpeg prints it to
    (the Windows one with both `dshow` and `in#0` tags, on stderr); a
    recorder in the current folder, in the folder Claude Code started in, or
    from a relative PATH entry is never run; on macOS and Linux a recorder in
    a group- or other-writable folder, or owned by another account, is
    refused; a changed stamp ends the start with `listener error device`; a
    pinned recorder whose real path changed is refused.
14. `observe.mjs add` takes only an 8-hex name, reads only that inbox file,
    appends one line, deletes the file on every result, and refuses an
    unlisted key, an unknown kind or an unparsable line with nothing written;
    1.7's claim 24 holds for the rest, with its mode assertions on POSIX only.
15. `tests/incantation-skill.test.mjs` fails if a skill file runs a script by a
    path not under the skill base, runs `setup.mjs`, builds a command holding
    heard text, a spoken line, a profile name or a device name, reads the
    settings file, or names an engine anywhere but through the speak-tool
    names and the README's setup lines.
16. `setup.mjs devices` prints only the stamp and index-and-name lines, never
    a path; `choose` refuses a stale stamp or an out-of-range index and writes
    a settings file whose every key is in range.
17. The widened repo checks pass with the second marketplace entry and fail
    each widened rule's case under `plugins/incantation/` (1.7's claim 7).
18. `engines/voicebox.mjs`, run against a fake server that speaks Voicebox
    0.5.0's published interface (made-up replies in the schema's shapes):
    `health()` reads `GET /health`; `transcribe()` sends one multipart `file`
    part holding a WAV of the turn and returns the reply's `text`; `warm()`
    transcribes one second of silence and loads no speech model;
    `playback()` turns speak-start and speak-end events into `start` and
    `end`, keeps no text or id, and errors when the stream ends, answers other
    than 200, or sends a line over 64 KB; every request goes to `127.0.0.1` at the
    settings' port, and with `NODE_USE_ENV_PROXY=1` and `HTTP_PROXY` set to a
    fake proxy, the proxy receives nothing. Its limit: the fake follows the
    schema, not a recorded exchange, so the prototype (S9) is what checks it
    against Voicebox itself.

Eval cases, seven, budget $1 (W11), as 1.7's S6.1 with `converse` read as the
speak tool: `no-speak-tool` (#622's `no-converse`, renamed), `guard-fails`, `greeting`, `spoken-style`,
`hear-back`, `typed-yes`, `lead-session`. `spoken-style` also grades `Listening,
always on.` at start and `Stopped listening.` on a listener error line. Their
tool-call parts move to the practice run, as 1.7 recorded.

**Practice run,** on Windows 11, by the owner, after Test passes. The record
holds pass or fail, counts and timings, never heard text, spoken turns,
device or profile names, or paths:

- **end to end:** Voicebox and ffmpeg installed, `setup.mjs` run, the guard
  prints `ok`, `Listening, always on.` shows, the greeting is heard, and one
  spoken request comes back as `Heard` and is said back;
- **own voice:** on speakers, five turns with the person silent: no heard
  text holds words from the session's own speech;
- **real end:** for ten lines, the mute starts at or before the first sound,
  and the mic reopens within the tail plus 300 ms of the last sound (W6);
- **warm:** first sound within 2 s of each speak call after the greeting, as
  a median of 10 (W6);
- **default voice:** the default profile is on the engine F3 measured fastest
  (W6);
- **mic permission:** with the Windows microphone setting off, the start ends
  with `listener error mic`;
- **mic released:** after the session is closed without "stop", Windows'
  microphone-in-use indicator clears within 5 s, and no turn from before the
  close is delivered to a later session;
- **between turns, long work, halt, own yes, quiet room, when it speaks, round
  trip:** as 1.7's practice steps, with the speak tool in place of `converse`
  and other programs' sound in place of Windows-side sound;
- **skill order:** as 1.7's, with the guard before the listener.

## S9. The 15-minute prototype, before the build (W2)

The owner runs it on Windows 11; a session prepares it as throwaway scripts
outside the repo. Under W13 it runs after the build, against it, before the
practice run. Each check has its outcome, and the value the build uses until
it runs:

| Check | Until run (the build) | Pass | Fail |
|---|---|---|---|
| **F1, silent warm:** a `POST /models/load` that loads the default profile's own engine plays nothing, and the next speak's first sound comes within 2 s | not called; the greeting is the speech warm, left out of the 2 s target (S5.3) | `warm()` calls that load, and the greeting joins the target | the greeting stays the speech warm |
| **F2, playback feed:** route A, then B, reports every utterance from any caller, its start at or before the first sound, its end within 300 ms of the last; the measured delay sets the tail | route A, from the schema's event names; tail 300 ms | that route is kept | route B is tried; with neither, stop; the owner says how to go on (O1) |
| **F3, the fast default:** time to first sound for each preset engine on a one-sentence line, warm | the README names Kokoro | the README names the fastest under 2 s | the README names the fastest, and the miss goes to the owner |
| **F4, capture:** ffmpeg records the chosen mic through `dshow`, and the list parses | built as S5.4, on made-up listings | kept | stop |
| **F5, mic released:** closing the session ends the listener's parent, and the mic-in-use indicator clears within 5 s | built as S6 on fakes | kept | stop; the owner says how to go on |
| **F6, wake while working:** a background command that ends wakes a working session, not only an idle one | built as S6 | kept | stop and ask, as 1.7 did: heard "wait" could not halt work |
| **F7, transcribe:** `POST /transcribe` with a WAV `file` part from memory answers; its time; the default model; whether it leaves anything in Voicebox's history or captures | as S5.1; the README says what Voicebox keeps is unchecked | the README says what Voicebox keeps | stop |
| **F8, names:** the speak tool's exact name and arguments as a session sees them, that `profile` takes an id, and whether a line can be kept out of Voicebox's history | `mcp__voicebox__voicebox_speak`, `text` and `profile` | kept; a history opt-out, if any, is used | the table is corrected, and so is the spec |
| **F9, task output:** where Claude Code keeps a background command's output, which holds heard text | the README says it is unknown | the README names the place | the README says it is unknown |

Results go on #208 as pass or fail and timings, with no device or profile
names and no paths; the prototype deletes its scratch audio.

## S10. Threat model

Heard speech is already on the "Text into a session" boundary. These entries
are recommended; they come into force only on a merge the owner confirms,
since AGENTS.md keeps the threat model's scope and classes for the owner. While
#208 is a draft pull request they stay candidates.

**Two accepted classes, carried word for word from 1.7,** which the owner
accepted for the build ("Accept both", relayed); each still lands only on a
merge the owner confirms in their own chat:

> Ambient speech into a working session: words from anyone audible or played
> aloud near the mic, heard by Incantation's always-on listener, reach a
> session at any time, including while it works, where they can halt work or
> ask for new acts, and a spoken yes from the same source can approve any
> act short of the typed-yes list and the permission mode in force.

> Ambient speech off the machine: everything audible to the mic while
> Incantation runs reaches the model provider, the session transcript, and
> with Remote Control on, claude.ai and the signed-in devices, as heard text.

**Scope lines, as 1.7 had them, less the processes this change no longer
ships** (the owner accepted 1.7's; this is shown again, O2): grimoire ships one
long-running local process, the listener, which holds the mic open; new actors
are a web page in the person's browser, anyone audible to the mic, and sound
played near it; heard text, bystanders' included, reaches the model provider
as chat.

**Entries:**

- **A web page and the speech engine.** A page in the person's browser
  reaching the engine's loopback API. 1.7's proxy held this; this change drops
  it, and no control in this change replaces it. It is open, for the owner
  (O7). How the engine treats such a page will be in a private note, from a
  private probe before O7 is decided (O9), kept out of this record. Its risk
  grows with what Incantation puts into the engine's store, so O7 is decided
  with F7's finding in hand, and the practice run waits for it. One effect is
  Incantation's own: the listener mutes on every utterance from any caller,
  so a page that made the engine speak would mute the mic and could hold it
  muted. A spoken "stop" is then lost; a typed one still works, and the README
  says so.
- **Another caller's speech after a say-back.** Any caller of the engine (a
  session, a page) can speak in the same voice between a say-back and the
  answer. Control: each delivery's `plays <n>`, and the skill counts a heard
  yes only on `plays 1` (S7.5).
- **Forged deliveries from the same account.** A program or session of the
  person's account can read the token and send `stop`, or put its own server
  behind a new `listen.json`, and so forge heard turns, a spoken yes included.
  No token in a file the account can read stops it, and neither candidate
  class covers it, since it is not speech near the mic: a residual for the
  owner. A stale port is narrower: `wait` prints only lines of its own
  grammar (S6).
- **Who starts the mic.** The skill starts only on the person's own typed
  words in that chat, never on a request found in a file, an issue, a relay,
  a tool result or a heard turn (S7.1). Its limit: a rule a steered session
  may not keep; the harness prompt on `listen.mjs start` holds it outside
  bypass mode, and the README asks for no allow rule there.
- **The engine's tools in every session.** The user-scope entry loads all of
  Voicebox's tools in every session, not only voice ones. The README offers
  deny rules for the ones Incantation never calls, as the person's own step.
- **The device id on ffmpeg's command line,** with the threat model's open
  question on endpoint telemetry of command lines; the README names it.
- **The speak tool.** Only the engine's exact speak-tool name counts, exactly
  one must be present, and the guard accepts only the user-scope entry in the
  README's form and refuses one at local or project scope under the same name
  (S5.6). Controls: those checks, and the harness's approval of a project's
  MCP servers. Its limit: config sources the guard does not read.
- **The microphone, bystanders, and a microphone in every session:** as 1.7's
  S8, with the speak tool in place of `converse`, the token channel in place
  of the socket, one listener at a time (S6), and the parent and `ppid` checks
  with the 5-minute no-waiter bound in place of 1.7's start-time pin (O8).
- **The listener's reach.** It runs only the recorder pinned at setup and
  resolved again by the platform rule, never from the working folder or the
  environment, and only engines from the fixed table, with no shell, from the
  state folder. The residual: on Windows and macOS ffmpeg sits in a folder the
  person's account can write, so a program of that account can replace it;
  that is the machine's own.
- **The observe log:** as 1.7, with per-line inbox files in place of stdin.
- **A risk row** for `guard.mjs`, `listen.mjs`, `setup.mjs`, `observe.mjs`
  and the engine and capture modules.

The security pair runs on the diff at Test as well.

## S11. Rollback and stop

- **Rollback:** the pull request is a draft and never merges, so main is
  untouched; closing it is the rollback. On the person's machine,
  `listen.mjs stop` first, then delete `~/.incantation/`, in that order, so
  no listener is left without its file. Voicebox is untouched, since
  Incantation changes none of its settings.
- **Stop if:** any prototype check whose Fail column says stop (S9); the
  practice run shows a spoken yes starting a typed-yes act, the session
  hearing its own voice, or the mute starting after the first sound; the mic
  stays in use after the session closes.

## S12. Trade-offs

- **One code path against per-platform care.** Neutral code with data rows per
  platform, against tuning each platform: two of the three are claimed, not
  tested (S3). Driver: the owner's words (W3).
- **Voicebox's feed against our own player.** Following Voicebox's feed keeps
  one player and no spoken line in a command; it depends on the feed being
  exact, which F2 measures. Driver: W6 and the rule that no spoken line goes
  through a shell.
- **TCP and a token against a socket.** One channel on every platform, against
  folder access as the only bar to other accounts. Driver: W3.
- **No start-time pin against a no-waiter bound.** A pin needs a per-platform
  process read; the bound needs none and caps a reused PID at 5 minutes.
  Driver: W3; cheaper to reverse.
- **Dropping the proxy against the web-page path.** One less long-running
  process, against a path with no control (O7). Driver: the lead's reuse list;
  the owner decides.
- **Always on against reach, muting against talking over, spoken yes against
  safety:** as 1.7's S7.

## S13. Files

Every file is new to main. The ones that start from #622 (`6d7dec86`):

| From #622 | State |
|---|---|
| the check widening: `scripts/check.mjs`, the two workflows, `athanor.json`, AGENTS.md's `scripts/` paragraph, `tests/check-plugins.test.mjs`, `tests/check-fixture.mjs`, `tests/check-manifests.test.mjs`, `tests/eval-budget.test.mjs`, `tests/registry.test.mjs` | kept |
| CONTRIBUTING.md's suite line | rewritten: the new test files, not #622's launch and proxy tests |
| `observe.mjs`, `tests/incantation-observe.test.mjs` | rewritten for the inbox file (S7.4) |
| `lib.mjs` | rewritten: the state folder, settings and text cleaning; the VoiceMode settings reader goes |
| `listen.mjs` | split: the gate and queue move to `gate.mjs` unchanged; the rest is rewritten for the seam and the channel |
| `guard.mjs`, `SKILL.md`, `README.md`, `plugin.json`, the marketplace entry, the eval cases, `tests/incantation-skill.test.mjs`, `tests/incantation-helpers.mjs` | rewritten; `evals/no-converse/` becomes `evals/no-speak-tool/` |
| `tuning.md` | kept |
| `launch.mjs`, `proxy.mjs`, `tests/incantation-launch.test.mjs`, `tests/incantation-proxy.test.mjs` | dropped |

The files:

- `plugins/incantation/.claude-plugin/plugin.json`, its own version, no
  dependencies
- `plugins/incantation/skills/incantation/SKILL.md`, through `contract`
- `.../references/tuning.md` (from #622)
- `.../scripts/listen.mjs`, `gate.mjs` (the gate and queue, from #622),
  `guard.mjs`, `setup.mjs`, `observe.mjs`, `lib.mjs`
- `.../scripts/engines/index.mjs` and `engines/voicebox.mjs`,
  `.../scripts/capture/ffmpeg.mjs`
- `plugins/incantation/README.md`: the platform tables (S3); install Voicebox
  and ffmpeg per platform, Linux from source; register Voicebox's MCP server
  under the name `voicebox`; run `setup.mjs` in your own terminal; the OS mic
  permission per platform; a headset; who hears (1.7's README step 7, naming
  what Voicebox keeps of what is said and heard, as F7 finds, and where Claude
  Code keeps task output, as F9 finds); the allow rules that stay the owner's
  step (`listen.mjs wait`, `observe.mjs add`, and the write of observe inbox
  files)
- tests: `tests/incantation-{gate,listen,guard,setup,capture,voicebox,observe,skill}.test.mjs`,
  a fake engine and a fake recorder, and #622's check-widening tests
- the seven eval cases, `BUDGET` entry `incantation: 7`
- `.claude-plugin/marketplace.json`, the second entry
- the widened repo checks from #622 (`scripts/check.mjs`, the workflows,
  `athanor.json`, AGENTS.md's `scripts/` paragraph)

## S14. What needs the owner

Under W13 the build went ahead without these. Each row says what the build did
in place of the owner's step, and when the step now comes.

| Item | Skipped; the build did instead | When now |
|---|---|---|
| Read this spec back, and say go or not | built it, with every pick below as a question in the pull request | the owner's review of the draft pull request |
| The 15-minute prototype on Windows 11 (S9, O6) | used each check's "until run" value, all listed in the pull request | after the review, before the practice run |
| O7, the web-page path left open by dropping the proxy | built no control and invented none; the pull request lists the path as open, with no detail | after F7, before the practice run |
| O9, the private probe of how the engine treats a browser page | not run; no note exists yet | before O7 is decided, its results kept private |
| O4, the lead-session signal | kept #622's rule: judged from the session's own record, refused when unsure; no head-chef change | at the review |
| O8, the parent and `ppid` checks and the 5-minute bound in place of 1.7's start-time pin | built them | at the review |
| O2, the scope lines as shown | left them as candidates | at the review |
| O10, the practice run while both ambient classes are only candidates | nothing; the run waits | the owner's own words in chat, before the run |
| O1, how to go on if F2 fails | nothing | only if it fails |
| O5, the round-trip number | 2.5 s stands | before the practice run |
| The practice run (S8) | skipped; there is no end-to-end evidence yet | after the prototype, O7 and O10 |
| Allow rules for `listen.mjs wait`, `observe.mjs add` and the inbox write | none added; the README gives the exact patterns | the owner's own step, any time |
| Sign-off on the files only the owner signs: `.github/workflows/`, `scripts/check.mjs`, `athanor.json`, AGENTS.md, the threat model | the draft changes the first four and leaves the threat model alone | at any merge; #208 itself is never merged or marked ready (W12, W13) |

At Test, the QA pair runs on every ticket, the security pair on the diff, and
the standards pair on the widened checks if the owner takes it as a third
pair. behaviour-lens waits for Test.

## Open

- **O1.** How to go on if neither route A nor B gives the end of playback
  (F2).
- **O2.** The scope lines as S10 shows them.
- **O3.** Who runs a real-mic practice run on macOS or Linux, if anyone;
  until then both stay claimed.
- **O4.** The lead-session signal (1.7's O14): keep the build's rule (the
  session's own record, refused when unsure), or head-chef gains a readable
  lead marker.
- **O5.** The round-trip target, 2.5 s for the speech side (1.7's O17): the
  owner's own number; 2.5 s stands until then.
- **O6.** The 15-minute prototype's time on the owner's machine (W2, W13).
- **O7.** The web-page path to the speech engine, open since the proxy is
  dropped (S4, S10).
- **O8.** The session binding: the parent and `ppid` checks and the 5-minute
  no-waiter bound, in place of 1.7's start-time pin (S6).
- **O9.** The private probe behind O7 (S10).
- **O10.** Whether the practice run goes ahead while the two ambient classes
  stay candidates, since #208 never merges (S10).

One rule holds for every session on this work: no third-party weakness detail
goes in the spec, the README, the threat model, a commit, the pull request, a
test name or the review record.
