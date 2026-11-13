# Incantation on Voicebox: the spec

Draft 2.0, for issue #208, Thorough tier on the sensitive route (heard speech
becomes input to a session with tools, so the security pair reviews it). It
replaces the VoiceMode spec (draft 1.7, PR #622) and the `live` spec (closed
PR #590). Nothing here is built. The owner reads it back before any build.

Every choice below carries the tag of the owner's words it comes from, `W1` to
`W12` (S1). A choice with no tag is the spec's own and says so.

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

What the owner's words rule out, so no later section can drift back:

- no VoiceMode, anywhere: not as a dependency, an engine, a fallback, a setup
  step or a name in a shipped file (W1, W4);
- no WSL, no proxy, no engine launcher, no `parec` or `pactl` (W1, W3; the
  lead's reuse list);
- no Windows-only rule: the code is platform-neutral, and a platform branch
  exists only where the platform forces it, inside the capture adapter (W3);
- no fixed or guessed wait before listening (W6);
- no reply at every turn (W8).

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
  reverse need a typed yes (carried from 1.7, S5);
- it listens at all times while it runs, shows that it listens, and is muted
  from the start of its own speech to the real end of playback (W6, W7).

Incantation is a separate plugin in the `mephistopheles4` marketplace, not part
of the grimoire plugin. It declares no dependency on Voicebox or on anything
else: a guard checks the setup at each start and says what to do (W10, W4).

**Business driver.** None is written in AGENTS.md or CLAUDE.md. This spec
leans to what is cheaper to reverse (flagged once; the owner decides).

## S3. Platforms: tested and claimed

The code is the same on every platform (W3). Two places differ by platform,
both inside the capture adapter (S5.4), and both are data tables, not code
paths: the recorder's input format and its device-list parser, and the rule
for finding the recorder on the PATH.

| Platform | Voicebox | Status |
|---|---|---|
| Windows 11 | MSI installer | **Tested now** with a real mic: the October prototype and the 590 listener. The 15-minute prototype (S9) and the practice run (S8) run here. |
| macOS | DMG (Apple Silicon and Intel) | **Claimed only.** Unit tests run on every platform with fakes; no real-mic run is planned in this change. |
| Linux | built from source (no prebuilt binary yet) | **Claimed only.** CI and the athanor container are Linux, so the unit tests run there with fakes; no real-mic run is planned. |

The README carries this table. A platform moves to tested only on a recorded
real-mic run of the practice steps (S8). The owner's machine is Windows 11, so
macOS and Linux need someone else's run (O3).

## S4. Scope

In: the plugin and `/incantation`; the engine seam and its one engine,
Voicebox (S5); the capture adapter (S5.4); the always-on listener (S6);
`guard.mjs` (S5.6); the skill, `tuning.md` and `observe.mjs` (S7); the eval
cases; the README; a marketplace entry; the repo checks widened to
`plugins/<name>/`; candidate threat-model entries (S10).

Out: a second engine (the seam makes one possible, W5; none ships); changes
to Voicebox; clearing Voicebox's history for the person (the machine's own,
1.7's decision 169); echo cancellation and a live level meter (follow-ups);
a hook of any kind; running Incantation in a session that leads a brigade.

Reuse (the lead's list). From PR #622 (`incantation-208`), kept and made
engine-neutral: the skill and `tuning.md`; the gate (mute during playback, the
tail, a single muted notice, the "after reply" mark); the heard queue and its
delivery cap; `observe.mjs` and its filtering; the typed-yes list; the
widened repo checks; the tests for all of these. Dropped: `launch.mjs`,
`proxy.mjs`, the guard's WSL, VoiceMode and socket checks, and `parec` and
`pactl` capture. From closed PR #590 (`785904ed`): the Windows listener's
recorder resolution, `dshow` capture and device listing, kept as the Windows
row of the capture adapter. Its clip-on-disk, token lock and fixed
speaking-time wait are dropped (W6, W7).

## S5. The engine seam

One module boundary, so a second engine is a new file and no other change
(W5). The skill and the listener call only the seam; neither names Voicebox
in its logic.

### S5.1 The interface

An engine is a module in `scripts/engines/<name>.mjs` that exports:

| Export | Does | Voicebox's version |
|---|---|---|
| `speakTool` | the MCP tool name suffix the session calls to speak, and the fixed arguments it passes | `voicebox_speak`, with `profile` and `voice_engine` from settings, passed as its `profile` and `engine` |
| `warm()` | loads the speech and transcription models with no sound, and resolves with the time it took | S5.3 |
| `transcribe(pcm)` | one turn's audio, held in memory, to text | `POST /transcribe` on `127.0.0.1` |
| `playback()` | an emitter of `start` and `end` for every utterance the engine plays, from any caller | S5.2 |
| `capture` | which capture adapter to use, or the engine's own capture | the shared ffmpeg adapter (S5.4): Voicebox has no capture call |
| `health()` | whether the engine answers on loopback | `GET /health` on `127.0.0.1` |

The settings file names the engine: `"engine": "voicebox"`. An unknown name
fails the guard. Tests ship a fake engine module that the test suite loads
through an exported start function; the command line reads no override.

### S5.2 Playback ended: the real end, not a guess (W6, W7)

The listener mutes from each utterance's `start` to its `end`, plus the tail,
and never uses a wait computed from word count. Voicebox documents no
playback-ended event, so the route is chosen by the prototype (S9, F2), in
this order:

- **Route A, Voicebox's own events.** Voicebox's app shows a speaking pill for
  the full duration of each agent-initiated speak, and serves an event stream
  for speech. If that stream marks the end of playback within 300 ms of the
  sound's end, the engine follows it.
- **Route B, status and duration.** If a generation's status gives the moment
  playback starts and the audio's duration, `end` is start plus duration.
- **Route C, Incantation plays the audio.** The engine asks Voicebox to
  generate without playing, and plays the clip itself through `ffplay`, which
  ships with ffmpeg on all three platforms; `end` is the player's exit. This
  changes who plays the sound, so it is the owner's pick if A and B both fail
  (O1).

With none of the three, the work stops (S11). Whatever the route, `playback()`
also reports an utterance from another caller of the same Voicebox, so the
listener stays muted for it too. If the playback source stops answering, the
listener captures nothing and exits with a fixed line (fails closed).

### S5.3 Warm at start (W6)

- `/incantation` starts the listener before the guard's slow checks finish,
  and the listener calls `warm()` at once, in the background.
- `warm()` loads the transcription model with one second of silence, and the
  speech model with a silent generation of one word on the default profile,
  if the prototype (F1) shows a generation that plays nothing. If none is
  silent, the greeting itself is the warm call.
- The skill prints `Warming the voice…` in chat, and speaks the greeting once
  the listener's `wait` reports `ready <ms>`. A warm that has not finished in
  60 s ends the start with `listener error warm`.
- **Target, measured:** after the greeting, no spoken turn pays the model's
  load: the time from a speak call to its first sound is 2 s or less, as the
  median of 10 turns, on the default profile. The practice run records it; a
  miss is reported, not a merge gate.

### S5.4 Capture: the one platform table (W3)

Voicebox has no capture call, so capture is a shared adapter,
`scripts/capture/ffmpeg.mjs`, that any engine may use. It runs ffmpeg with no
shell, 16 kHz mono signed 16-bit on stdout. Only these rows differ by
platform:

| Platform | Input | Device list | Recorder found by |
|---|---|---|---|
| Windows | `-f dshow -i audio=<id>` | `-list_devices true -f dshow`, parsing both the `dshow` and newer `in#0` tags (the owner's run) | 590's rule: only fully qualified drive folders on the PATH, never the current folder; the real path must still be a drive path |
| macOS | `-f avfoundation -i :<index>` | `-list_devices true -f avfoundation -i ""` | PATH entries that are absolute, never the current folder or a relative entry |
| Linux | `-f pulse -i <source>`, or `-f alsa` when no PulseAudio or PipeWire server answers | ffmpeg's own `-sources pulse` | as macOS |

- The device is chosen once, at setup, by its index in a stamped list, and
  kept in the settings file by id. A device name is never put in a command
  line by the session (590's rule); the adapter passes it as one argument.
- The macOS and Linux rows are written from ffmpeg's documentation and tested
  with a fake recorder only (S3).

### S5.5 Settings

One file, `~/.incantation/settings.json`, written by the person or by the
setup step the README gives, never by a session during a run. It holds
`engine` (the seam's engine, `voicebox`), `profile` and `voice_engine` (the
voice and the speech engine Voicebox uses for it), `device`, and the
end-of-speech wait. The state folder `~/.incantation/` sits in the person's
home; on Windows that is the profile folder, whose access the account's
default rules hold, since a 0700 mode does nothing there (590's finding). A
link or junction in its place, or a real path outside home, fails closed.

**The default voice stays on the fast engine (W6).** The default `profile`
is a preset on the fastest engine the prototype measures (F3) under the 2 s
first-sound target; Kokoro is the expected pick. A profile on a heavier engine
is the person's own edit; the skill then says once, at start, in chat, how
long a line takes on it.

### S5.6 The guard (W10)

`guard.mjs`, a Node script with no dependencies, runs at each start and
prints one line: `ok`, or the first failure with the README step that fixes
it. It never prints an address, a path or a setting's value. It checks:

1. Node 20 or later;
2. the settings file parses and names a known engine and a device;
3. the engine's `health()` answers on `127.0.0.1`;
4. the engine's port answers on no non-loopback address of this machine (the
   1.7 reach check, kept: each non-internal address, 500 ms, in parallel);
5. the recorder resolves by the platform's rule (S5.4) and lists the chosen
   device;
6. it finishes within 2 s.

The skill checks one more thing itself: a tool whose name ends in the
engine's `speakTool` is present. If it is not, the skill prints the README's
Voicebox setup lines and stops, with no other tool call.

## S6. The listener

`scripts/listen.mjs`, Node, no dependencies, with `start`, `wait` and `stop`.
It is 1.7's listener (S4.3 there) with the engine seam in place of `parec`,
`pactl` and the proxy. Kept as 1.7 set them, each a starting point in one
`KNOBS` table: 30 ms frames; the room's level measured for 1 s, then a running
floor; voice at 10 dB over the floor; a turn ends after the end-of-speech
wait (1000 ms unless settings say less); under 0.25 s of voice is dropped; a
turn over 30 s is cut; at most 20 turns wait, none longer than 5 minutes;
deliveries held to 4 a minute, never holding a whole turn of "stop", "that's
all" or "wait", or the first turn marked "after reply" after a playback.

- **Always on (W7).** The mic opens at `start` and stays open while the
  listener runs. Turns heard while no `wait` is connected wait in the queue.
- **Muted during playback (W7).** Frames are dropped from each utterance's
  `start` (S5.2) until its `end` plus the tail (300 ms unless the prototype
  measures more, at most 1500 ms). A turn open when playback starts is
  dropped. When the mic has been muted for more than 30 s at a stretch, `wait`
  returns `muted` once for that stretch.
- **Its limit:** sound from other programs (a browser, a call, media) is not
  seen by `playback()`, so it is heard. The README says to use a headset.
- **The "after reply" mark,** as 1.7: a turn begun after a playback that
  started after the previous delivery and ended, tail included.
- **Transcription** goes through the engine's `transcribe()`, in memory, only
  to `127.0.0.1`. No audio and no heard text is written to any file or log. An
  empty transcript is dropped; one failure prints `stt-dropped`; three in a
  row end the listener.
- **Delivery.** The waiter connects on loopback TCP, on a port the listener
  picks at start, and must send a 32-byte random token the listener writes,
  with the port, to `~/.incantation/run/listen.json` (S5.5's folder rules).
  One waiter at a time; a second gets `listener error busy`. This replaces
  1.7's Unix socket, which Node does not offer the same way on Windows. The
  token keeps other accounts out by the folder's access; against a program of
  the same account it is cooperation only.
- **`wait` prints** `Heard (after reply): "<text>"` or `Heard: "<text>"`, with
  control, invisible and line-separator characters removed, inner quotes
  escaped, cut at 500 characters; then `timing: wait <ms> stt <ms>`; then
  `ready <ms>`, `dropped <n>`, `stt-dropped` or `muted` when they apply. After
  10 minutes with nothing it prints `quiet`.
- **Bound to its session.** `start` records its parent process, the shell
  Claude Code ran it in, and exits within 1 s of that process ending, whatever
  waiters remain, dropping the queue. It also exits on `stop` (which signals
  only a PID it wrote, after checking that process is a `listen.mjs` of the
  same account), on any capture or playback failure, and after 30 minutes with
  no heard turn. Whether the parent ends when the session closes is a
  prototype check on Windows (F5) and a claim on the others.
- **Heard text never reaches a shell.** It goes from the listener to `wait`'s
  output and nowhere else. No command the skill runs holds heard text, a
  spoken line or a device name as an argument or on stdin (S7.4).
- **Errors** are fixed lines, `listener error <reason>`: `recorder`,
  `playback`, `engine`, `settings`, `session`, `stt`, `busy`, `warm`,
  `ended`.

## S7. The skill and how it speaks

The skill is 1.7's `SKILL.md`, rebuilt through `contract`, with every
VoiceMode and `converse` line replaced by the engine's speak tool. Its rules
stay as 1.7 set them unless a line below changes them.

### S7.1 Start

In order, stopping at the first failure; a failure prints the fix in chat and
speaks nothing:

1. refuse in a session that leads a brigade (O4);
2. the speak tool is present (S5.6), else the README's setup lines;
3. `node <skill base>/scripts/listen.mjs start` as a background command, then
   `node <skill base>/scripts/guard.mjs`; unless the guard prints `ok`, show
   its line, run `listen.mjs stop`, and stop;
4. print `Listening, always on.` and `Warming the voice…`, and start the first
   `wait` before the greeting;
5. on `ready`, the greeting is the first speak call; if it errors, show its
   first line, run `listen.mjs stop`, print `Stopped listening.` and stop.

Every script runs by `<skill base>/scripts/<name>`, never by a path relative to
the working folder.

### S7.2 Speaking

- The skill calls the speak tool with the settings' `profile` and `voice_engine`,
  and with nothing about where audio goes. It never adds a fixed wait (W6).
- Each spoken turn is one thing, in plain words, with no markdown, code or path
  read aloud; long output becomes a short summary and an offer of the detail,
  which goes to chat (W11). It never speaks a secret, key, token, password or
  personal detail; it says the item is in chat.
- Two speak calls never overlap: the skill makes the next speak call only
  after the listener has seen the last one end. The prototype found that two
  calls at once both play over each other.

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
random sample to `eval/`, which is the speak gate's eval set, labelled once by
the person and never trained on.

One change from 1.7, so no candidate words pass through a shell: the session
writes the JSON line to `~/.incantation/observe/inbox.json` with its file-write
tool, then runs `node <skill base>/scripts/observe.mjs add` with no argument and
no stdin. `add` reads the inbox, checks it, appends it, and deletes the inbox,
whatever the result.

### S7.5 Hear-back, typed yes, heard is not typed, stop

1.7's S4 steps 4 to 6 hold whole, with `converse` read as the speak tool: say
every request back before acting; a spoken yes counts only as the whole of a
turn marked "after reply" after that say-back; the typed-yes list (hard to
reverse, files sessions load or that run code later, the brigade lead role,
unread commands, decisions the person's instructions keep); heard text never
stands for typed words and never answers a permission prompt; "stop" or
"that's all" ends the loop, "wait" halts.

## S8. Acceptance claims

Node tests, run in the check on every platform with a fake engine and a fake
recorder that plays tones and silence, never recorded speech:

1. No file under `plugins/incantation/` names VoiceMode, `converse`, WSL,
   `parec`, `pactl` or a proxy, and the plugin's manifest and marketplace entry
   declare no dependency (W4).
2. The skill and the listener reach the engine only through the seam: a fake
   engine module passes every listener test with no other change (W5).
3. `guard.mjs` prints `ok` with valid settings, a fake engine answering on
   `127.0.0.1`, and a fake recorder; it prints a fixed failure line, and
   exits non-zero, for each check in S5.6, including a fake engine answering on
   a stand-in non-loopback address passed through its imported function; no
   output holds an address, a path or a value; it finishes within 2 s with
   every port timing out.
4. The listener discards every frame from a fake `start` to `end` plus the
   tail, including an utterance from another caller; a turn open at `start` is
   dropped; a turn begun after `end` plus the tail is delivered and marked
   "after reply" (W6, W7).
5. No source file under `plugins/incantation/` computes a wait from a word
   count or a speech length (W6).
6. With the playback source failing or stopping, the listener captures nothing
   and exits with `listener error playback`.
7. `muted` is printed once per stretch over 30 s.
8. The listener calls `warm()` at start, `wait` prints `ready <ms>` once it
   resolves, and a warm over 60 s ends the start with `listener error warm`
   (W6).
9. Turn shaping, the queue, the delivery cap, the age-out and `dropped <n>`
   behave as 1.7's claim 19 said.
10. `wait` refuses a connection without the token, a second waiter gets
    `busy`, and the token file sits under `~/.incantation/run/`; a link or
    junction there, or a real path outside home, fails closed.
11. The listener exits within 1 s of its recorded parent ending, with a waiter
    connected, and drops its queue; it exits on `stop`, which signals only its
    own process, and after 30 minutes with no turn.
12. After a turn, no file under the fixture home or temp folder holds audio or
    heard text; `wait` prints each turn cleaned and cut as S6 says; errors are
    fixed lines.
13. The capture adapter picks each platform's row by a passed-in platform
    value, so all three rows run in the check on any host; each row's device
    parser reads a recorded listing (the Windows one with both `dshow` and
    `in#0` tags); a recorder in the current folder or a relative PATH entry is
    never run.
14. `observe.mjs add` reads only the inbox file, appends one line, deletes the
    inbox on every result, and refuses an unlisted key, an unknown kind or an
    unparsable line with nothing written; 1.7's claim 24 holds for the rest.
15. `tests/incantation-skill.test.mjs` fails if a skill file runs a script by a
    path not under the skill base, or builds a command holding heard text, a
    spoken line or a device name.
16. The widened repo checks pass with the second marketplace entry and fail
    each widened rule's case under `plugins/incantation/` (1.7's claim 7).

Eval cases, seven, budget $1 (W11), as 1.7's S6.1 with `converse` read as the
speak tool: `no-speak-tool`, `guard-fails`, `greeting`, `spoken-style`,
`hear-back`, `typed-yes`, `lead-session`. Their tool-call parts move to the
practice run, as 1.7 recorded.

Practice run, on Windows 11, by the owner, after Test passes; pass or fail,
counts and timings only, never heard text or spoken turns:

- **own voice:** on speakers, five turns with the person silent: no heard
  text holds words from the session's own speech;
- **real end:** the gap from a line's last sound to the mic reopening, ten
  lines: each under the tail plus 300 ms (W6);
- **warm:** first sound within 2 s of each speak call after the greeting, as
  a median of 10 (W6);
- **default voice:** the default profile's engine is the one F3 measured
  fastest (W6);
- **between turns, long work, halt, own yes, quiet room, mic released, skill
  order, when it speaks, round trip:** as 1.7's practice steps, with the
  speak tool in place of `converse`.

## S9. The 15-minute prototype, before the build (W2)

The owner runs it on Windows 11; a session prepares it as throwaway scripts
outside the repo, and the build waits for its results. It answers:

- **F1, silent warm:** does a Voicebox generation that does not play exist,
  and does it load the model so the next speak's first sound comes within 2 s?
- **F2, playback ended:** which of routes A, B or C (S5.2) gives the end of
  playback within 300 ms of the sound's end; the measured delay sets the tail.
- **F3, the fast default:** the time to first sound for each preset engine on
  a one-sentence line, warm; the fastest under 2 s is the default.
- **F4, capture:** ffmpeg records the chosen mic through `dshow` on the
  installed ffmpeg, and the device list parses.
- **F5, mic released:** closing the session ends the listener's parent, and
  the mic is free within 5 s.
- **F6, wake while working:** a background command that ends wakes a session
  that is working, not only an idle one.
- **F7, transcribe in memory:** `POST /transcribe` with a WAV body from memory
  answers, and how long it takes.

Results go on #208 as pass or fail and timings, never audio or heard text.

## S10. Threat model

Heard speech is already on the "Text into a session" boundary. These entries
are recommended; they come into force only on a merge the owner confirms,
since AGENTS.md keeps the threat model's scope and classes for the owner.

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

**Scope lines, narrowed from 1.7** (the owner accepted 1.7's; these are
smaller, so they are shown again, O2): grimoire ships one long-running local
process, the listener, which holds the mic open; new actors are anyone
audible to the mic and sound played near it; heard text, bystanders'
included, reaches the model provider as chat.

**Entries:**

- **The speech engine.** Incantation sends audio only to the engine on
  `127.0.0.1`, and the guard refuses an engine answering beyond loopback.
  Incantation relies on no other control of Voicebox's. What Voicebox itself
  exposes to other programs on the machine is reviewed in a private note and
  kept out of this record; it is the machine's own (1.7's decision 169), and
  Incantation adds no route to it.
- **The microphone, bystanders, and a microphone in every session:** as 1.7's
  S8, with the speak tool in place of `converse`, and the waiter token in place
  of the socket.
- **The listener's reach.** It runs only the recorder the platform rule finds
  (S5.4) and the engine module named in settings, with no shell. Its residual:
  on Windows and macOS ffmpeg sits in a folder the person's account can write,
  so a program of the same account can replace it; that is the machine's own.
  A PATH folder another account can write, ahead of the real one, is 590's K7
  residual, carried as a candidate.
- **The observe log:** as 1.7, with the inbox file in place of stdin.
- **A risk row** for `guard.mjs`, `listen.mjs`, `observe.mjs` and the engine
  and capture modules.

## S11. Rollback and stop

- **Rollback:** remove the marketplace entry and `plugins/incantation/`; the
  widened checks stay. On the person's machine, `listen.mjs stop`. Voicebox is
  untouched, since Incantation changes none of its settings.
- **Stop if:** none of routes A to C gives the end of playback (F2); ffmpeg
  cannot capture on Windows (F4); the mic is not released when the session
  closes (F5); the practice run shows a spoken yes starting a typed-yes act,
  or the session hearing its own voice.

## S12. Trade-offs

- **One code path against per-platform care.** Neutral code with two data
  rows per platform, against tuning each platform: two of the three are
  claimed, not tested (S3). Driver: the owner's words (W3).
- **Voicebox's events against our own player.** Following Voicebox's playback
  keeps one player and its history; playing it ourselves (route C) gives an
  exact end. The prototype picks; C needs the owner (O1). Driver: cheaper to
  reverse.
- **TCP and a token against a socket.** One channel on every platform, against
  folder access as the only bar to other accounts. Driver: W3.
- **Always on against reach, muting against talking over, spoken yes against
  safety:** as 1.7's S7.

## S13. Files

- `plugins/incantation/.claude-plugin/plugin.json`, its own version, no
  dependencies
- `plugins/incantation/skills/incantation/SKILL.md`, through `contract`
- `.../references/tuning.md` (from #622)
- `.../scripts/listen.mjs`, `gate.mjs` (the gate and queue, from #622),
  `guard.mjs`, `observe.mjs`, `lib.mjs`
- `.../scripts/engines/voicebox.mjs`, `.../scripts/capture/ffmpeg.mjs`
- `plugins/incantation/README.md`: the platform table (S3), Voicebox and
  ffmpeg install per platform, the settings step with the device list, a
  headset, who hears (1.7's README step 7, with Voicebox named as keeping what
  is said), the allow rules that stay the owner's step (for `listen.mjs wait`
  and `observe.mjs add`)
- tests: `tests/incantation-{gate,listen,guard,capture,observe,skill}.test.mjs`,
  a fake engine and a fake recorder, and #622's check-widening tests
- the seven eval cases, `BUDGET` entry `incantation: 7`
- `.claude-plugin/marketplace.json`, the second entry
- the widened repo checks from #622 (`scripts/check.mjs`, the workflows,
  `athanor.json`, AGENTS.md's `scripts/` paragraph)

## Open

- **O1.** Route C (Incantation plays the audio) if routes A and B both fail:
  the owner's pick.
- **O2.** The narrowed scope lines (S10): shown to the owner again.
- **O3.** Who runs a real-mic practice run on macOS or Linux, if anyone;
  until then both stay claimed.
- **O4.** The lead-session signal (1.7's O14): head-chef gains a readable lead
  marker, or the build stops and asks.
- **O5.** The round-trip target, 2.5 s for the speech side (1.7's O17): the
  owner's own number.
- **O6.** The 15-minute prototype's time on the owner's machine (W2).

One rule holds for every session on this work: no third-party weakness detail
goes in the spec, the README, the threat model, a commit, the pull request, a
test name or the review record.
