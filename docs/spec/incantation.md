# Incantation: the spec

Draft 1.3, for issue #208, at Standard tier through 1.1 and Thorough from 1.2. It replaces `docs/spec/live.md` on
the dropped branch. Owner's scope: the issue's comments of 2026-11-12 (the
rescope onto VoiceMode, and the Incantation name and feel). Draft 0.4 holds the
fixes drafted after spec round 1, 0.5 adds the owner's proxy (S4.2), and 0.6
to 0.8 fold in the answers (Decisions taken), 0.9 holds the fixes drafted after
spec round 2, 1.0 folds in the lead's answers to them, and 1.1 holds the
fixes drafted after round 1 of the reopened spec stage. None of 1.1's fixes
is accepted yet. 1.2 folds in the four findings from the owner's live run of
the voice prototype (issue comment of 2026-11-12): the mic open during
speech, the round-trip delay, no sign of listening, and listening at all
times (S4.3). For the last, the owner chose an always-on listener of
Incantation's own, which reverses S3. 1.3 holds the fixes drafted after
round 1 of the stage reopened for it, at Thorough tier with the security
pair. None of 1.2's or 1.3's changes is accepted yet.

## S1. Objective

`/incantation` turns a Claude Code session into a voice pair-programming
partner. VoiceMode (mbailey/voicemode, MIT) does the speaking and the
speech engines. Incantation adds an always-on listener (S4.3) and the way
the session talks:

- it wakes up warm, says in one line what it is there for, and offers a first
  step;
- it summarizes rather than reads output aloud, then offers to drill in;
- it says each request back in its own words and acts only on a yes;
- it keeps turns casual: one thing per turn, plain words, no markdown aloud,
  details only when asked;
- it listens at all times while it runs, never to its own voice, and shows
  that it listens (S4.3).

Incantation is a separate plugin in the `mephistopheles4` marketplace, not part
of the grimoire plugin. It declares no dependency on VoiceMode. A guard checks
for VoiceMode, and for a local-only setup, each time `/incantation` runs. A
loopback proxy of its own stands in front of the speech engines (S4.2).

**Target environment: WSL 2 (O5, the owner's pick).** Claude Code, VoiceMode,
both speech engines and the proxy all run inside one WSL 2 distribution.
Native Windows is out of scope for now, and so is Claude Code on Windows
talking to VoiceMode inside WSL. The spec and the README both say so. The
end-to-end step: in the distribution, install VoiceMode, apply the README
settings, `launch.mjs` starts the engines on sockets, `/incantation` starts the
proxy, the guard prints `ok`, `Listening, always on.` is printed, the
greeting is heard, and one spoken request comes back as `Heard` and is said
back.

- **Networking.** WSL 2 in its default NAT mode. Mirrored mode is not
  supported yet.
- **Audio.** Audio inside the distribution, set up as VoiceMode's WSL 2
  guidance says. The README quotes that guidance, with its commit.
- **The host.** The repo's host check may run on Windows. There, the socket
  tests skip and say so; they run in the athanor container and in CI.

## S2. What `converse` leaves room for

Room for the style rules, with one conflict.

- `converse(message, wait_for_response, …)` takes any text, so what is said and
  how short it is stays with the session. VoiceMode's own prompt and skill
  already ask for short turns and one question at a time, which agrees with
  Incantation.
- **The conflict:** its tool description says to treat the reply "as the user's
  next message and act on it, including any skill it calls for." Incantation's
  hear-back rule overrides that: a reply is a request to say back, not an act.
- VoiceMode's plugin hooks only play sounds; none answers a permission request.

## S3. Scope

In: the plugin, `/incantation`, the guard and `guard.mjs`, the proxy and
`proxy.mjs`, the always-on listener and `listen.mjs` (S4.3), the README
setup, a marketplace entry, the repo controls widened to the new plugin (S5),
candidate threat-model entries (S8).

Out: a speech engine of our own (the proxy forwards, and holds no speech);
changes to VoiceMode; clearing VoiceMode's logs for the person; a hook of
any kind; running Incantation in a head-chef lead session (S4 step 7); echo
cancellation, and a live level meter (follow-up issues).

Reversed in 1.2: "any recorder of our own" was out. The owner chose to listen
at all times now (S4.3), and VoiceMode's release cannot, so the listener is
in.

This spec replaces the old tickets #593 and #594. The lead closes them as
replaced once the spec is approved.

## S4. What `/incantation` does

1. **Guard.** It runs in this order and stops at the first failure. Each
   failure prints the fix in chat and nothing is spoken.
   1. **VoiceMode present.** It looks for VoiceMode's `converse` tool under
      either name (`mcp__voicemode__converse` or the plugin's
      `mcp__plugin_voicemode_voicemode__converse`). If it is missing, it prints
      VoiceMode's install and service-setup lines, quoted in the README with
      the VoiceMode commit they were taken from.
   2. **Proxy.** If the proxy's `/health` does not answer, it starts
      `proxy.mjs` the same way, by its skill-base-directory path (S4.2).
   3. **Setup check.** If `node` is not on the path, it prints the README's
      Node line and stops. It runs `guard.mjs` by its path in the skill base
      directory, `<skill base>/scripts/guard.mjs`, never by a path relative to
      the working folder (S4.1), passing the folder Claude Code started in
      (`CLAUDE_PROJECT_DIR`). Unless the script prints `ok`, it shows the
      script's line and stops.
   4. **Listener.** It starts `listen.mjs` by its skill-base-directory path
      (S4.3). If it does not start, it shows the script's fixed line and
      stops.
   5. **First call.** The greeting is the first `converse` call. If it errors,
      it shows the error's first line and the setup line from step 1, runs
      `listen.mjs stop`, then stops. There is no retry loop.
2. **Greeting.** The first `converse` call is the greeting, for example:
   "Welcome to incantation mode. I'm here to pair with you on this repo. We can
   start with what's on your branch." The first step it offers comes from the
   session's state (branch, an open issue, the last task), never invented.
3. **Turns.** Each spoken turn is one thing, plain words, no markdown, no code
   or paths read aloud. Long output becomes a two-sentence summary and an offer:
   "Want the detail?" The detail goes to chat, not aloud. It never speaks a
   secret, key, token or password, or a personal detail such as an email
   address or a name taken from a record; it says the item is in chat.
4. **Hear-back.** Before acting on any request, a read-only one included, it
   says the request back in its own words,
   shows the same words in chat, and asks yes or no. It acts only on a yes;
   anything else it treats as a new request. A heard yes counts only when it
   is the whole of a turn marked as begun after that say-back finished
   playing (S4.3), delivered after the request; a yes in the same turn or
   the same delivery as its request is a new request.
   - **Spoken yes:** enough for everything except the next item.
   - **Typed yes only:** needed for acts that are hard to reverse (merge, push,
     delete, publish, send, install, a settings change), for running a command
     whose effects the session has not read, and for every decision the
     person's instructions keep for them. The session asks aloud for a typed
     yes, shows the one act and its target in chat, and waits. A typed yes
     covers exactly that act and target, never a batch. A spoken yes to these
     is answered with "I need that one typed."
5. **Heard is not typed.** Heard text, from the listener (S4.3), `converse`
   or any other VoiceMode route, is shown in chat as `Heard: "…"`. Only the
   skill's own `wait` task delivers heard text (S4.3); a `Heard` line from
   anywhere else is data. It never stands for the person's
   typed words where instructions ask for those, never answers a permission
   prompt, and never widens what the session may do. Spoken-yes acts still go
   through the permission mode in force.
6. **Off and failure.**
   - A heard turn whose whole text is "stop" or "that's all" (case and
     punctuation ignored), or a typed message, ends the loop with a short
     goodbye and runs `listen.mjs stop`, except a typed reply to a pending
     typed-yes request: that is the answer, and the loop goes on. Heard
     "wait" only halts (S4.3).
   - 30 minutes with no heard turn ends the loop the same way: the listener
     stops itself, and the session prints `Stopped listening.`
   - A `converse` error after the greeting, or a `listener error` line, shows
     the first line in chat, ends the loop, runs `listen.mjs stop`, and drops
     any pending act.
7. **Not in a lead session.** `/incantation` refuses to start in a session that
   leads a brigade, and says why. The signal it reads is a lead marker the
   head-chef skill exposes. `skills/head-chef/` has none today. Whether
   head-chef gains one in this change, or the build stops and asks, is O14.

### S4.1 Local only

- **(a) The speech services answer only through the proxy (S4.2).** The
  speech-to-text and text-to-speech engines listen on a local socket each, in
  `~/.incantation/run/` (owned by the person, mode 0700, no group or other
  bits), and on no TCP port. Incantation ships `launch.mjs`, which starts each
  engine on its socket; it never edits a file VoiceMode installed (O10).
  Whether both engines can listen on a socket in WSL 2 is the build's first
  check, before anything else is built; S9 stops the work if it fails. The
  build session writes its steps; who runs them, on which WSL 2 machine, and
  when, is O12. The proxy owns the
  loopback TCP ports VoiceMode calls (2022 and 8880, or the ports in the
  speech URLs) and forwards to the sockets. The README gives this as plain
  setup steps, with no word on why or on what the default is: turn off
  VoiceMode's own engine services, then start the engines with `launch.mjs`.
  It says a VoiceMode update may turn those services back on, and that the
  guard then fails until they are turned off again.
- **(b) Text-to-speech settings.** The README sets the text-to-speech
  engine's web player and its cross-origin access off, as plain setup steps.
- **(c) Speech stays local, and VoiceMode is set in one place.** The README
  sets `VOICEMODE_TTS_BASE_URLS` and `VOICEMODE_STT_BASE_URLS` to
  `http://127.0.0.1:<port>/v1` only, in `~/.voicemode/voicemode.env`. Every
  VoiceMode setting lives in that file: never in the MCP server's own
  environment, and never in a project-level VoiceMode settings file. It:
  - leaves `VOICEMODE_MCP_URL` and `VOICEMODE_MLX_AUDIO_BASE_URL` unset;
  - turns off the auto-start of a speech engine, and the services' enable on
    install (`VOICEMODE_SERVICE_AUTO_ENABLE=false`);
  - sets the default voice (`VOICEMODE_VOICES`) to plain engine voice names;
  - keeps streamed speech on (`VOICEMODE_STREAMING_ENABLED=true`), and sets
    the end-of-speech wait (`VOICEMODE_SILENCE_THRESHOLD_MS`), which the
    listener also reads, to 1000 or less (S4.3);
  - names the VoiceMode versions the guard was checked against;
  - needs no OpenAI key;
  - does not install VoiceMode's heard hook.
- **(d) `guard.mjs` checks all of it.** It is a Node script with no
  dependencies, in `plugins/incantation/skills/incantation/scripts/`. It runs
  these checks; each failure prints one fixed line:
  - **Settings, read as VoiceMode reads them.** It reads, in order:
    1. the process environment;
    2. `~/.voicemode/voicemode.env`, or `~/.voicemode/.voicemode.env` when
       that is missing, whatever `VOICEMODE_BASE_DIR` says;
    3. a project-level VoiceMode settings file, looked for from the folder
       Claude Code started in (passed by the skill) up to the filesystem
       root, skipping the global file.

    It parses values as VoiceMode does: the first source to set a key wins. It
    reads only the keys it needs. It also reads the key names, never the
    values, of the `env` block of every MCP server entry that provides the
    found `converse` tool: in the user, local and project MCP configs, and in
    VoiceMode's plugin manifest. It reads the key names of the `env` blocks of
    the user, project and local Claude Code settings too.
    - Any `VOICEMODE_` or `VOICE_MODE_` key in one of those `env` blocks, or
      `HOME` in a Claude Code settings `env` block, fails: `server env: move
      VoiceMode settings to the global file, see README step 4`.
    - A speech URL setting set anywhere but `~/.voicemode/voicemode.env`
      fails: `remote <setting>: move it to the global file, see README step
      4`. So the guard and the proxy read the same ports.
    - A project-level file fails: `project <file kind>: move VoiceMode settings
      to the global file, see README step 4`.
    - These fail with `remote <setting>: set it to the loopback URL only, see
      README step 4`:
      - either speech URL setting unset, unparseable, or with any entry that
        is not `http://127.0.0.1:<port>/…`;
      - `VOICEMODE_MCP_URL` set (tested for presence only);
      - `VOICEMODE_MLX_AUDIO_BASE_URL` set.
    - `VOICEMODE_AUTO_START_KOKORO` or `VOICE_MODE_AUTO_START_KOKORO` on, or
      `VOICEMODE_SERVICE_AUTO_ENABLE` not `false`, fails: `auto-start: turn it
      off, see README step 4`.
    - A first `VOICEMODE_VOICES` entry that is not a plain voice name (no
      path, no `/` or `:` form) fails: `voice: see README step 4`.
    - VoiceMode's installed version outside the README's range fails:
      `voicemode version: see README step 1`.
    - The heard hook in any of `~/.claude/settings.json`,
      `.claude/settings.json` or `.claude/settings.local.json` fails: `heard
      hook: remove it, see README step 4`.
  - **Ports.** The ports named in the resolved speech URLs, which the proxy
    binds (S4.2); plus the engines' service ports, `VOICEMODE_WHISPER_PORT`
    and `VOICEMODE_KOKORO_PORT` (default 2022 and 8880), and 8765.
  - **Reach.** For each non-internal IPv4 and IPv6 address in
    `os.networkInterfaces()` (skipping link-local), it tries a TCP connect to
    each port, all in parallel, with a 500 ms timeout. A connect that succeeds
    counts as exposed: `exposed <service> <port>: see README step 3`. Tests
    pass their own address list through an imported function; the command
    line reads no override.
  - **Only through the proxy.** On `127.0.0.1` at each port:
    - the listener must belong to the person's uid (read from `/proc`),
      and `GET /health?nonce=<fresh random>` must answer with the keyed hash
      of that nonce under the token in `~/.incantation/run/token`, else `no
      proxy <service> <port>: see README step 3`;
    - a request with a foreign `Host`, a request with a foreign `Origin`, and a
      request for a path outside the proxy's list must each be refused by the
      proxy, else `proxy open <service> <port>: see README step 3`;
    - nothing but the proxy answers on `[::1]` at that port, else `exposed
      <service> <port>: see README step 3`;
    - nothing answers on loopback at 8765, else `serve running: see README
      step 6`.

    Each engine's socket must exist, be a socket owned by the person, and
    accept a connection. It must sit in `~/.incantation/run/`, with mode 0700
    and the person as owner. Else: `socket <service>: see README step 3`. The proxy's status answer must name a socket upstream for
    both services, never a TCP one.
  - **Text-to-speech scope.** Through the proxy's socket upstream, a request
    for the web player's page must not succeed. Else: `tts scope: see README
    step 3`.
  - **What it cannot see.** An engine that someone also starts by hand on
    another TCP port. The README says to run the engines only through the
    service setup it gives.
  - **Output.** One line on stdout: `ok`, or the first failure. It catches
    every error and prints a fixed line for it, never the error's text. Nothing
    it prints, on stdout or stderr, holds an address, a path, or a setting's
    value. It exits 0 only on `ok`, and finishes within 2 s.
  - A connect from this machine to its own address skips the host firewall,
    so the guard refuses a service listening beyond loopback even when a
    firewall would block it. That is on purpose.
- **(e) Never `voicemode serve`.** Incantation calls `converse` over the stdio
  MCP server only, with no bridge to another server (the guard refuses
  `VOICEMODE_MCP_URL`). The skill passes `converse` only its message and
  listening options. The skill never starts, configures or connects to `voicemode
  serve` or port 8765, and the README says not to run it alongside Incantation.
  The guard refuses when port 8765 answers on loopback (O15).

### S4.2 The proxy

The owner's pick (2026-11-12): a loopback reverse proxy in front of both speech
engines. `proxy.mjs` is a Node script with no dependencies, in
`plugins/incantation/skills/incantation/scripts/`.

- **Listens** on `127.0.0.1` only, on the ports in the resolved speech URLs
  (S4.1 d). It never binds another address. It reads its ports and socket
  paths only from `~/.voicemode/voicemode.env` and `~/.incantation/`, never
  from the working folder or the environment.
- **Refuses**, with a 403 and a fixed body, before anything is forwarded:
  - a request whose `Host` is not exactly `127.0.0.1:<its port>` or
    `localhost:<its port>`;
  - a request whose `Origin` is set and is anything but `http://127.0.0.1:<its
    port>` or `http://localhost:<its port>` (`null` counts as foreign);
  - a method and path outside the speech API VoiceMode calls (the owner's
    pick, O9.1):
    - speech-to-text: `POST /v1/audio/transcriptions`, `GET /health`;
    - text-to-speech: `POST /v1/audio/speech`, `GET /v1/audio/voices`,
      `GET /v1/models`, `GET /health`;
  - a `POST` with no `Content-Length`, or with one over 25 MB; a body that
    runs past its `Content-Length` aborts the upstream request;
  - an `Upgrade` or `CONNECT` request, an absolute-form target, or a path
    with encoded characters, dot segments or doubled slashes;
  - a request whose `Sec-Fetch-Site` is `cross-site` or `same-site`.
- **Checks every request.** Each request on a kept-alive connection is parsed
  and checked on its own. The path is matched exactly, raw, and the target
  forwarded is the one checked.
- **Forwards** a request that passes to the engine's socket, with only these
  headers: `Content-Type`, `Content-Length`, `Accept`, `Accept-Encoding` and
  `User-Agent`. It streams the body and the response both ways, so audio is
  not held whole.
- **Answers** `GET /health` itself, as JSON with `nosniff`: each upstream's
  kind (socket or TCP), and for a `nonce` query value, the keyed hash of it
  under its start token. It never sends the token, a path or an address. It
  refuses to start with a TCP upstream.
- **Its token** is 32 bytes from a cryptographic random source, written to
  `~/.incantation/run/token` (mode 0600) fresh at each start, and deleted on
  stop.
- **Keeps nothing.** It logs no body, query, header value or address; a
  refusal is counted, not recorded.
- **Runs:**
  - `/incantation` starts it as a background process if `/health` does not
    answer, before the guard runs (the owner's pick, O9.2).
  - It detaches, outlives the session, and runs until `proxy.mjs stop` or a
    restart.
  - It writes its PID into `~/.incantation/run/`. `stop` signals that PID only
    after checking that it is a `proxy.mjs` owned by the person.
  - A second start finds the ports taken and exits with a fixed line.
  - With the proxy down, VoiceMode's local URLs answer nothing, and voice
    fails closed: the guard has refused every other route VoiceMode could
    take (S4.1 c, d).
  - VoiceMode used without Incantation needs the proxy running too, since
    the engines are on sockets. The README says so.

### S4.3 Listening and timing

The owner's live run of the voice prototype (2026-11-12) found four faults:
the mic open while the session spoke, a long round trip, no sign of
listening, and speech lost between turns. The owner then chose to listen at
all times now (2026-11-12, relayed by the lead): "Build it now". VoiceMode's
release v9.0.2 (2026-10-29) listens only inside a `converse` call and has no
echo cancellation, and its own always-open listener is unreleased. So this
change **reverses S3's "no recorder of our own"**: Incantation ships its own
listener, which mutes while anything plays. VoiceMode still does all the
speaking.

**The listener.** `listen.mjs`, a Node script with no dependencies, in
`plugins/incantation/skills/incantation/scripts/`.

- **Capture.** It runs `parec`, PulseAudio's recorder, against WSL 2's sound
  server, reading 16 kHz mono 16-bit audio from the server's default source
  on its stdout. It watches playback with `pactl`. Both come from
  `pulseaudio-utils` (README step 1).
- **The programs it runs.** Only `/usr/bin/parec` and `/usr/bin/pactl`, after
  resolving links, each owned by root and writable by no group or other
  account; otherwise it fails closed with a fixed line. Each runs by that
  path, with no shell, from `~/.incantation/run/`, with this environment and
  nothing else: `HOME`, `LANG=C`, and `PULSE_SERVER=unix:/mnt/wslg/PulseServer`.
- **Inputs.** Like the proxy, it reads its settings only from
  `~/.voicemode/voicemode.env` and fixed paths under `~/.incantation/`, read
  once at start, never from the working folder or the environment. Tests
  pass fake programs and paths through an exported start function; the
  command line reads no override.
- **Turns.** Voice is detected by energy on 30 ms frames. At start it
  measures the room's level over 1 s, and keeps that floor as a running
  value; a frame is voice when its level is at least 10 dB over the floor.
  A turn ends after the end-of-speech wait: `VOICEMODE_SILENCE_THRESHOLD_MS`,
  1000 ms when unset. A turn with under 0.25 s of voice is dropped, so a
  short "yes" or "stop" still gets through. A turn longer than 30 s is cut,
  and the rest goes on as the next turn.
- **Muted during playback (finding 1).**
  - At start it reads the playback streams once, then follows changes with
    `pactl subscribe`. While any stream that is playing (not corked) exists
    on WSL 2's sound server, and for the tail after the last one ends,
    frames are discarded, not kept. A turn that is open when playback starts
    is dropped.
  - The tail is 300 ms unless the build's first checks measure a longer
    delay from a stream ending to its sound ending; the tail is then set
    from that measure, at most 1500 ms.
  - Speech said over playback is not heard.
  - **Its limit:** sound played on the Windows side of WSL 2 (a browser, a
    call, media) is not seen by `pactl`, so it is not muted and is heard as
    speech. README step 6 and S8 say so.
  - When the mic has been muted for more than 30 s with no `converse` call
    running, `wait` returns a fixed `muted` line, and the session shows
    `Muted: something is playing.`
- **Fails closed.** If it cannot read the playback state (`pactl` missing,
  exiting, or the sound server not answering), it captures nothing and exits
  with a fixed line.
- **Transcription.** Each turn's audio goes, as a WAV held in memory, only to
  `http://127.0.0.1:<port>/v1/audio/transcriptions`, the port taken from the
  speech-to-text URL in `~/.voicemode/voicemode.env` at start; a URL whose
  host is not `127.0.0.1` fails closed with a fixed line. This is the proxy
  (S4.2), the same local route VoiceMode takes. No audio is written to disk.
  An empty or blank transcript is dropped. A turn the proxy does not answer
  is dropped and the waiter is told `stt-dropped`; three in a row end the
  listener with `listener error stt`.
- **Heard text** is held in memory, in order, until the waiter takes it.
  `listen.mjs` writes it to no file or log. At most 20 turns wait; beyond
  that the oldest is dropped. A turn waiting longer than 5 minutes is
  dropped. Drops are counted, and the next delivery prints `dropped <n>`.
- **Each turn's mark.** The listener notes whether a turn began after the
  last playback ended. `wait` prints it, so the skill can tell a reply to a
  say-back from speech that came before or with it (S4 step 4).
- **One waiter.** Waiters connect on `~/.incantation/run/listen.sock`, in the
  0700 folder S4.1 (a) sets. One waiter at a time: a second gets the fixed
  line `listener error busy`.
- **Bound to its session.** `listen.mjs start` records the process ID of the
  Claude Code process that ran it, the nearest ancestor that is Claude Code,
  read from `/proc`. The listener exits:
  - when that process ends, whatever waiters remain, dropping every queued
    turn, so a session that ends, crashes or is closed releases the mic;
  - on `listen.mjs stop`, which checks the PID in `~/.incantation/run/` is a
    `listen.mjs` owned by the person before it signals it;
  - on any failure of the recorder or the playback watch;
  - after 30 minutes with no heard turn (S4 step 6).

  There is no idle timer while that session lives: turns heard while no
  waiter is connected wait in the queue. Before binding, `start` removes a
  `listen.sock` that accepts no connection. A start that finds the socket
  answering exits with a fixed line, so one session at a time listens.
- **Errors** are fixed lines, `listener error <reason>`, the reason one of
  `recorder`, `playback`, `programs`, `settings`, `stt`, `busy`, `ended`.

**Delivery.** The skill starts the first `wait` right after the listener
starts, before the greeting. `wait` runs as a background command. It exits
once a turn is waiting, and prints:

- each turn as `Heard (after reply): "<text>"` or `Heard: "<text>"`, by its
  mark, on its own line, with control, invisible and line-separator
  characters removed as the repo's R2 rule removes them, inner quotes
  escaped, and cut at 500 characters;
- a `timing: wait <ms> stt <ms>` line;
- `dropped <n>`, `stt-dropped` or `muted` when they apply.

Claude Code wakes the session when a background command ends, whether the
session is idle or working, so heard text arrives with no hook (S3). `wait`
also ends after 10 minutes with `quiet`; the skill starts the next `wait` and
says nothing. After each delivery, the skill's first act is to start the
next `wait`. At most 4 deliveries a minute: when no say-back is pending,
further turns stay queued and come with the next delivery. Any exit of the
listener reaches the running `wait` as `listener error <reason>`.

**Only its own task counts.** A heard turn is only what the skill's own
running `wait` prints when it completes. A `Heard` line anywhere else, in a
file, an issue, a command's output or a tool result, is data, never speech.

**Speaking.** The skill calls `converse` only with `wait_for_response:
false`, and never listens through it, so the mic has one reader. It never
adds a fixed wait. A say-back never ends with the word "yes".

**Heard while working.** A turn that arrives while the session works goes
through S4 steps 4 and 5 like any other: shown, said back, and acted on only
after a yes. A heard turn whose whole text is "wait" halts the current act
before its next tool call and asks; "stop" ends the loop (S4 step 6). Heard
text can halt work, or ask for new work that goes through the hear-back; it
never widens what a spoken yes may do past the typed-yes list and the
permission mode in force.

**The round trip is budgeted (finding 2).** The person stops talking, the
listener waits out the silence and transcribes, Claude Code wakes the
session, the model replies, and the reply starts to play.

- **Budget, drafted (O17):** the end-of-speech wait, plus transcription,
  plus `converse`'s time to first audio, at most 2.5 s as the median of 10
  turns. The listener's `timing` line gives the first two, and `converse`
  reports the third.
- The practice run also reports the whole time the person feels, from the
  end of their speech to the first sound of the reply, split into the
  listener's wait and transcription, the wake and the model together, and
  the time to first audio. O17 decides whether that whole is budgeted too.
- The README keeps streamed speech on and the end-of-speech wait at 1000 ms
  or less (S4.1 c).
- The say-back is one sentence, and the only tool call before it is the next
  `wait`.

**The person can tell it listens (finding 3).**

- The session prints `Listening, always on.` when the listener starts, and
  `Stopped listening.` when it stops for any reason, a `listener error`
  included.
- While it listens, the running `wait` shows among Claude Code's background
  tasks.
- When the mic has been muted for more than 30 s, the session shows
  `Muted: something is playing.`
- A live level meter is not in this change; a follow-up issue holds it.

The prototype's two setup fixes, a temp folder on the system drive and the
`in#0` device tag in newer ffmpeg output, belong to its Windows listener.
Neither applies here, and neither is carried.

## S5. Files

- `plugins/incantation/.claude-plugin/plugin.json`, with its own `version`
- `plugins/incantation/skills/incantation/SKILL.md`, built through `contract`
- `plugins/incantation/skills/incantation/scripts/guard.mjs` (S4.1 d)
- `plugins/incantation/skills/incantation/scripts/proxy.mjs` (S4.2)
- `plugins/incantation/skills/incantation/scripts/launch.mjs` (S4.1 a): runs
  each engine's program from where VoiceMode installed it, listening on its
  socket in `~/.incantation/run/`. It edits no file VoiceMode installed.
  - **Inputs.** It reads only `~/.voicemode/voicemode.env` and fixed paths
    under the person's home, never the working folder or the environment. It
    refuses when a project-level VoiceMode settings file is found.
  - **Each engine.** It takes the engine's arguments and environment from
    VoiceMode's installed start script for it, with the host and port swapped
    for the socket. It runs the program by absolute path, with no shell, and
    with its working folder set to the engine's install folder.
  - **Stale sockets.** Before binding, it removes a socket of its own in
    `~/.incantation/run/` that accepts no connection.
  - **Restarts.** It restarts an engine that exits, at most three times a
    minute, then stops that engine and leaves the guard to report it. It writes its PIDs into `~/.incantation/run/`;
  `launch.mjs stop` signals each only after checking it is an engine it
  started, owned by the person. After a restart the person runs it again, and
  the guard's socket check says so.
- `plugins/incantation/skills/incantation/scripts/listen.mjs` (S4.3): the
  always-on listener, with `start`, `wait` and `stop`. It exports the
  program resolver and a start function that tests pass fake programs to.
- `tests/incantation-proxy.test.mjs`: fake engines on sockets, the proxy on
  free ports, Node's built-in test runner. It skips on win32 and says so.
- `tests/incantation-listen.test.mjs`: a fake recorder that plays synthetic
  frames (tones and silence, never recorded speech), a fake playback watcher
  that emits scripted events, and a fake speech-to-text engine behind the
  proxy. It skips on win32 and says so.
- `plugins/incantation/README.md`. It opens with the target: WSL 2, with
  everything inside one distribution; native Windows is not supported yet. Its
  steps, in order:
  1. install Node 20 or later and VoiceMode (the exact lines, with the commit
     they came from, and the VoiceMode versions the guard was checked
     against), set up audio in WSL 2, and install `pulseaudio-utils` for the
     listener's `parec` and `pactl`;
  2. run its service setup, quoting only lines that do not start VoiceMode's
     HTTP server;
  3. turn off VoiceMode's engine services, start the engines with
     `launch.mjs` (S4.1 a), and the S4.1 (b) settings;
  4. the S4.1 (c) settings;
  5. the proxy:
     - `/incantation` starts it, and it keeps running after the session;
     - `proxy.mjs stop` stops it;
     - VoiceMode used on its own needs it running;
  6. never run `voicemode serve`; use a headset; and approve `converse` in
     each session when asked, never through an allow rule in settings, and
     never allow-rule `listen.mjs start` or `stop` (O19 covers `wait`); the
     mic is muted while Linux-side audio plays, so talking over the session
     is not heard; sound from the Windows side (a browser, a call, media) is
     not muted and is heard as speech, so keep it off or use a headset;
  7. who hears: while Incantation runs, the mic is open at all times, so
     everything said within its reach, by anyone, reaches the model provider
     as chat, not only replies to the session, and with Remote Control on,
     claude.ai and every signed-in device. Tell people within the mic's
     reach that it is always listening. Say "stop" or type to end it; it
     also stops after 30 minutes with nothing heard. `listen.mjs` keeps no
     audio and no heard text, but Claude Code keeps every heard line in the
     session transcript (and its background-task output, if the build's
     first checks find it there). One plain line names where VoiceMode keeps
     what is heard and said on the machine.
- `tests/incantation-guard.test.mjs`: Node's built-in test runner, with fake
  servers on free ports, settings in a fixture home folder, and addresses
  passed through the guard's imported function.
- `tests/incantation-skill.test.mjs` (claim 13).
- the seven eval cases and their budget entry (S6.1)
- `.claude-plugin/marketplace.json`: a second entry, `incantation`, with source
  `./plugins/incantation` and no `version`.
- **Repo controls widened to every `plugins/<name>/`, in the same change:**
  - `scripts/check.mjs`:
    - rule 4: the entry named like the root plugin keeps source `./`; any other
      entry has source `./plugins/<its name>`, with a manifest there of the same
      name;
    - the shipped-file set (`isShipped`) and rules 2 and 2c;
    - rule 5, with a version bump in that plugin's own `plugin.json`;
    - rules 6b and 6c: the load roots and manifest key allow-lists;
    - rules 7 and 7a.
  - `tests/check-manifests.test.mjs` and the check's other tests, one case per
    widened rule.
  - `.github/workflows/skillspector.yml`: the matrix lists `plugins/*/skills/*`,
    with a baseline entry for the new skill.
  - `.github/workflows/plugin-validate.yml` and `athanor.json`: the new
    plugin's root, manifest and `skills` are validate targets.
  - `tests/eval-budget.test.mjs`: it also counts the cases under each
    `plugins/<name>/`.
  - `docs/security/threat-model.md`: a line under R3's controls saying they
    cover `plugins/<name>/`.
  - `AGENTS.md`: "Three directories are called `scripts/`" becomes four,
    within its word budget.

## S6. Acceptance claims

1. With no `converse` tool, `/incantation` prints the install and setup lines
   and makes no other tool call.
2. With `converse` present, the first call is a greeting that names a purpose
   and offers one first step drawn from the session's state.
3. No spoken `message` holds markdown, a code block, a path, a secret, or a
   personal detail.
4. An output over a few lines is spoken as a summary with an offer to drill in.
5. A request is said back aloud and in chat, and acted on only after a yes;
   "no" or another reply leads to no act. A yes in the same turn or delivery
   as its request, or in a turn not marked as begun after the say-back, leads
   to no act. A `Heard` line planted in a file the session reads is treated
   as data.
6. A spoken yes never starts an act that is hard to reverse, never runs an
   unread command, never decides something the person's instructions keep for
   them, and never answers a permission prompt. A typed yes covers one shown
   act, and the loop goes on after it.
7. The check passes with the second marketplace entry. It fails an entry whose
   source is outside `./plugins/<name>`, has no manifest, names a different
   plugin, or carries a version; and it fails each widened rule's case under
   `plugins/incantation/` (for example a `commands/` folder, a fixed home
   path, a change with no version bump).
8. `guard.mjs` prints `ok` and exits 0 with local-only settings and fake servers
   on `127.0.0.1` only.
9. `guard.mjs` prints `exposed …` and exits non-zero when a fake server listens
   on all interfaces, with `127.0.0.2` as the stand-in address passed through
   its imported function, so it runs in the athanor container.
10. `guard.mjs` prints `remote …` when either speech URL is unset anywhere, or
    lists anything but `http://127.0.0.1:<port>/…`, or when
    `VOICEMODE_MCP_URL` or `VOICEMODE_MLX_AUDIO_BASE_URL` is set; `server env
    …` with a `VOICEMODE_` key in an MCP server's `env` block; `project …`
    with a project-level settings file, including one in a sub-folder the
    session started in; `auto-start …` with either auto-start key on or the
    service enable not `false`; `voice …` with a path-form default voice;
    `remote …` with a speech URL set only in the process environment;
    `server env …` with a key in a Claude Code settings `env` block; `heard
    hook …` with the hook in any of the three settings files.
11. `guard.mjs` prints `no proxy …` when a port answers without the right
    keyed hash, including a server replaying an earlier `/health` answer or
    owned by another uid; `exposed …` when an engine service port answers;
    `serve running …` when 8765 answers; `proxy open …` when a foreign `Host`, a foreign `Origin` or an
    unlisted path gets through, `socket …` when an engine's socket is
    missing, stale or in an open folder, and `tts scope …` when the text-to-speech engine
    serves a page.
12. Fed a malformed URL holding a marker string, `guard.mjs` prints a fixed
    line; neither stdout nor stderr holds the marker, an address or a path. It
    finishes within 2 s with every port timing out.
13. `tests/incantation-skill.test.mjs` fails if the skill's files name
    `voicemode serve`, `8765`, or an `http://…/mcp` URL, or run `guard.mjs` by
    a path that is not under the skill base directory.
14. With the guard failing, `/incantation` makes no `converse` call. In a lead
    session it refuses to start.
15. `proxy.mjs` binds `127.0.0.1` only. It refuses each of these with a 403
    and a fixed body, forwarding nothing, including when the request is the
    second one on a kept-alive connection:
    - a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`;
    - an `Origin` that is set and not the same origin, `null` included;
    - an unlisted method or path, or an encoded or dot-segment path;
    - `Upgrade` or `CONNECT`;
    - a `POST` with no `Content-Length`, or with one over 25 MB.

    A body that runs past its `Content-Length` aborts the upstream request.
16. `proxy.mjs` forwards a listed request to the socket with only the listed
    headers, and streams the answer back unchanged. Its `/health` never holds
    the token, and `stop` deletes the token file. It
    refuses to start with a TCP upstream, or when its port is taken. It writes
    no body, header value, path or address to any output. `stop` signals only
    its own PID.
17. With the proxy stopped, its ports refuse a connection. Whether VoiceMode
    then tries nothing else is a practice-run step.
18. `launch.mjs`, run with fake engine programs, starts each with a socket in
    `~/.incantation/run/` and no TCP port, writes nothing outside
    `~/.incantation/`, and `stop` signals only the engines it started. It
    removes a stale socket of its own, restarts an engine that exits, and
    ignores a planted project settings file or module in the folder it was
    run from.
19. `listen.mjs`, with a fake recorder and a fake playback watcher:
    - discards every frame while a playing stream exists and for the tail
      after, including a stream that exists before start; a corked stream
      does not mute;
    - drops a turn that playback cuts; marks a turn begun after playback
      ended;
    - takes a frame 10 dB over the floor as voice and one just under as
      not;
    - ends a turn after the end-of-speech wait; delivers a 0.3 s "yes" and
      "stop" and drops a 0.2 s blip; cuts a turn at 30 s and goes on;
    - returns `muted` after 30 s of mute with no `converse` running.
20. `listen.mjs` captures nothing and exits with a fixed line when the
    playback watcher is missing, fails to start, or exits. It exits when the
    recorded Claude Code process ends, even with a waiter connected, and
    drops its queue; it does not exit while that process lives and no
    waiter is connected. It exits on `stop`, which signals only its own
    process, and after 30 minutes with no turn. A second start exits with a
    fixed line and leaves the first running; a second waiter gets `busy`; a
    stale socket is removed. One `stt` failure prints `stt-dropped` and goes
    on; three in a row end it.
21. `listen.mjs` sends a turn's audio only to `127.0.0.1` at the
    speech-to-text port from the global settings file, read once, and
    refuses a non-loopback URL there. It ignores the environment and the
    start folder. After a turn, no file under the fixture home or temp
    folder holds audio or heard text. `wait` prints each turn with control,
    invisible and line-separator characters removed, inner quotes escaped,
    and cut at 500 characters; it prints `dropped <n>` after a queue drop or
    a 5-minute age-out, and prints errors only as fixed lines.
22. The listener runs only `/usr/bin/parec` and `/usr/bin/pactl`, owned by
    root and not group- or other-writable after links are resolved, with
    only `HOME`, `LANG` and `PULSE_SERVER` in their environment; a fixture
    `parec` elsewhere, on PATH or in the start folder, is never run, and a
    writable or linked-away one fails closed.
23. The skill calls `converse` only with `wait_for_response: false`, starts
    the first `wait` before the greeting, prints `Listening, always on.`
    when the listener starts and `Stopped listening.` when it stops, starts
    the next `wait` as its first act after each delivery, says the request
    back before any other tool call, and never ends a say-back with "yes".

Claims 7 to 13, 15 to 22 are Node tests; the socket ones skip on win32. The ticket closes on the owner's
practice run. Once Test passes, the build session proposes its steps, each
with a pass or fail, in WSL 2, and the owner picks the time then. These steps
are fixed:

- the proxy's refusal count after a full turn must be 0;
- **own voice:** on speakers, not a headset, five turns in which the person
  stays silent; no heard text holds words from the session's own speech;
- **between turns:** a sentence said while the session works on an approved
  act is delivered, shown and said back;
- **long work:** the person speaks during a tool call that runs more than
  60 s, then speaks again; both turns are delivered, and the listener is
  still running;
- **halt:** heard "wait" during an approved act halts it before its next
  tool call;
- **own yes:** on speakers, the person silent, a say-back leads to no act;
- **Windows-side sound:** a video played on the Windows side, the person
  silent, leads to no act;
- **quiet room:** five minutes in a quiet room deliver no heard text;
- **mic released:** after the session is closed without "stop", the sound
  server lists no recording stream within 5 s, and no turn from before the
  close is delivered to a later session;
- **round trip:** ten turns, each with the listener's timings and
  `converse`'s; the median of the end-of-speech wait plus transcription plus
  time to first audio is within the budget (S4.3), and the whole felt time
  is reported, split as S4.3 says.

The practice record holds pass or fail, counts and timings, never heard
text.

### S6.1 The eval cases

Claims 1 to 6, 14 and 23 are eval cases, seven in all, one per row. The
`greeting` rubric also grades a warm, alive opening. The `spoken-style` rubric
also grades one thing per turn, and claim 23's `converse` and `Listening`
parts. The `hear-back` rubric also grades claim 23's order after a delivery.

| Case | Claim | `converse` |
|---|---|---|
| `no-converse` | 1 | absent |
| `guard-fails` | 14, first half | present; the guard fails |
| `greeting` | 2 | present |
| `spoken-style` | 3, 4, 23 | present |
| `hear-back` | 5, 23 | present |
| `typed-yes` | 6 | present |
| `lead-session` | 14, second half | present |

- **Budget.** The owner set Incantation's eval budget at $1 (2026-11-12): "We
  could use a $1 eval budget." In the repo's units, that is two things:
  - a cap of `--max-cost-usd 1` on every run (the owner's yes to seven cases
    is posted in the issue before the build, as CONTRIBUTING asks);
  - seven cases, the entry `incantation: 7` in `BUDGET` in
    `tests/eval-budget.test.mjs`.
- **The run:**

  ```bash
  claude plugin eval <repo>/plugins/incantation --model haiku --runs 1 --ablation none --no-publish --max-cost-usd 1
  ```

  It runs only when someone asks for a run, never as part of merging.
- **Estimate.** Head-chef's cases on Haiku, with a Haiku judge, cost under a
  cent each (its README, 2026-10-24). So seven cases are about $0.07 a run, and
  an Opus-judge calibration run about $0.21. Both fit inside $1. This is an
  estimate from another skill's cases; the first build run measures it.
- **Where the cases live, and `converse`.** Three things are not yet
  verified. The build checks them second, right after the socket check
  (S4.1 a):
  - **Where cases are read from.** The cases go wherever `claude plugin eval`
    reads them for a plugin that is not the repo root, and the budget test
    counts that folder.
  - **How the guard passes (O11).** The `present` cases need a passing guard
    with no bypass. The fixture runs the real `proxy.mjs`, in front of fake
    engines on sockets, under a fixture home folder that holds local-only
    settings. If that cannot run in the eval sandbox, claims 2 to 6 move to
    the practice run. Fixtures use invented heard lines only.
  - **How `converse` gets in.** A case gets `converse` from a test-only fake
    stdio MCP server in the case's fixture. The `absent` case runs without
    one.
  - **How heard lines get in.** The listener runs only `/usr/bin/parec` and
    `/usr/bin/pactl` and takes no override, so heard lines get in only where
    the eval sandbox lets the fixture install fake programs at those paths,
    owned by root, playing a scripted turn to a fake speech-to-text engine
    that answers with an invented heard line. Where it does not, the cases
    that need a heard line (`hear-back`, `typed-yes`, and claim 23's
    delivery parts) move to the practice run, which then gains a step for
    each.

  If any can't be done, the claim it backs moves to the practice run.
  The spec then records that.

## S7. Trade-offs

- **Spoken yes against safety.** Ordinary acts go on a spoken yes, which is the
  feel the owner asked for. Acts that are hard to reverse, unread commands, and
  decisions kept for the owner need a typed yes. Driver: cheaper to reverse.
- **Guard against dependency.** A guard keeps grimoire free of VoiceMode's
  install, at the cost of a check on each start. Owner's call, taken.
- **Listening at all times against new reach.** The owner chose an
  always-open mic now (S4.3), over waiting for VoiceMode's. It costs a
  recorder of our own, a long-running process holding the mic, everything
  said near the mic reaching the provider, and heard text arriving while the
  session works (S8). Every delivered turn also costs a model turn, so a TV
  or a talkative room spends usage; S4.3 caps deliveries at 4 a minute and
  ends listening after 30 minutes with nothing heard. Driver: the owner's
  pick.
- **Muting against talking over.** Muting the mic while anything plays keeps
  the session from hearing itself without echo cancellation, and loses
  speech said over playback. Driver: cheaper to reverse; echo cancellation
  is a follow-up.
- **A short end-of-speech wait against cutting the person off.** A shorter
  wait speeds the round trip and can end a turn in a pause. The README caps
  it at 1000 ms, VoiceMode's default; the round-trip practice step measures
  the rest.
- **Port 8765 probe: drafted back in (O15).** A10 skipped it as Hardening.
  Round 1 of the reopened stage found a web-page route through that port, so
  1.1 drafts the probe; keeping A10 instead is the lead's call.

## S8. Threat model

The lead recommends these entries, at level 3 (2026-11-12), with the proxy,
the socket-only engines and the 0.4 controls in place. They come into force
when the owner confirms the merge that adds them to
`docs/security/threat-model.md`, since AGENTS.md keeps that file's scope and
accepted risks for the owner.

The scope changes, each for the owner's word on its own. When the owner
gives it, before the build or at merge, is O13:

- grimoire now ships long-running local processes, the proxy, the engines
  `launch.mjs` starts, and the listener, which holds the mic open;
- new actors: a web page in the person's browser, anyone audible to the
  mic, and sound played aloud near it (a page, media or a call on the
  Windows side, which the mute does not cover);
- a new outward flow: heard text, bystanders' words included, reaches the
  model provider as chat; with the listener, that is everything said near
  the mic while Incantation runs.

**Two new accepted classes, pending (1.3).** Drafted for the threat model's
classes, one line each:

> Ambient speech into a working session: words from anyone audible or played
> aloud near the mic, heard by Incantation's always-on listener, reach a
> session at any time, including while it works, where they can halt work or
> ask for new acts, and a spoken yes from the same source can approve any
> act short of the typed-yes list and the permission mode in force.

> Ambient speech off the machine: everything audible to the mic while
> Incantation runs reaches the model provider, the session transcript, and
> with Remote Control on, claude.ai and the signed-in devices, as heard text.

Neither is in force. Adding a class is the owner's hard stop: each lands
only on a merge the owner confirms in their own chat (O18).

The entries:

- **Local speech services.** A local program, or another account, that reaches
  the proxy's ports or the engines' sockets can use the allowed speech calls.
  One that takes a speech port while the proxy is down fails the guard's
  owner and keyed-hash checks. Inside the entry: the allowed speech calls. Outside it: a web page,
  and any engine route outside the allow-list. Controls: the proxy (S4.2),
  engines on sockets only, the S4.1 settings, and the
  harness's approval of a project's MCP servers.
- **The microphone.** Heard text from anyone audible (people in the room, a
  call on speakers, played media) reaching acts short of the typed-yes list.
  Controls: the hear-back shown in chat, the typed-yes list, the permission
  mode in force, no lead sessions.
- **Bystanders at the provider.** Heard text, bystanders' words included,
  reaches the model provider, the session transcript, and with Remote
  Control on, claude.ai and the signed-in devices. Controls: README step 7,
  a headset, the 30-minute stop.
- **A microphone in every session.** VoiceMode's `converse` is available to
  every session, and any session of the person's can run `listen.mjs`, so a
  steered session could listen. Controls: the per-session approval of
  `converse` in README step 6, the permission prompt on `listen.mjs start`,
  one listener and one waiter at a time, and the listener bound to the
  session that started it. The route for `wait` is O19.
- **The listener's reach.** A program the listener runs, or text it hands
  the session. Controls: only root-owned `/usr/bin/parec` and
  `/usr/bin/pactl`, with a fixed environment (S4.3); the mic released, and
  the queue dropped, when the starting session ends; heard text held in
  memory only; transcription only to loopback through the proxy; a heard
  turn only from the skill's own `wait` task.
- **A risk row** for `guard.mjs`, `proxy.mjs`, `launch.mjs` and
  `listen.mjs`, shipped scripts that open and hold local connections, hold
  the mic, or start long-running processes, under "Keeping this page
  short".

The security pair runs on the diff at Test as well.

## S9. Rollback and stop

- **Rollback:**
  - Remove the marketplace entry and `plugins/incantation/`.
  - The widened check rules stay, since they hold with one plugin.
  - On the person's machine, `listen.mjs stop`, `launch.mjs stop` and
    `proxy.mjs stop`, then turn VoiceMode's engine services back on.
- **The build's first checks, with the socket check (S4.1 a):** in WSL 2:
  - VoiceMode's playback shows as a playing stream to `pactl`, and the
    stream is gone within 1 s of its sound ending; the delay from a stream
    ending to its sound ending is measured, and sets the mute's tail;
  - `/usr/bin/parec` records from the sound server at
    `/mnt/wslg/PulseServer`;
  - a background command that ends wakes a session that is working, not
    only an idle one;
  - where Claude Code keeps a background command's output, for README
    step 7.

  If a session that is working is not woken, heard text waits in the queue
  until its work ends (the listener stays up while the session lives), and
  a heard "wait" cannot halt work; the build stops and asks the owner before
  going on.
- **Stop if:** the build's first check (S4.1 a) finds an engine that cannot
  listen on a socket at all; or `pactl` cannot see VoiceMode's playback, or
  its stream outlives its sound by more than 1 s, since the mute then has
  nothing reliable to follow; or VoiceMode will not
  run on a target system; or the practice run
  shows a spoken yes starting a typed-yes act; or the guard cannot read the
  settings VoiceMode uses on a target system; or an engine cannot listen on a
  local socket on a target system, since the proxy then is not the only way
  in.

## Decisions taken

The lead took these under the owner's standing goal (2026-11-12):

- O1, a typed yes for hard-to-reverse and reserved acts;
- O2, `plugins/incantation/` here, with the check widened in the same change;
- O4, the security pair on the spec, next to the spec pair.

The lead also set the S4.1 local-only requirements and the README rule.

The owner chose the proxy in front of both speech engines (2026-11-12, in the
lead's chat): "Let's do the proxy then." S4.2 drafts it, with the S4.1
settings kept.

The owner then accepted these picks by typing `/make-it-so` in the lead's chat
(2026-11-12):

- O9.1, the proxy's path allow-list;
- O9.2, `/incantation` starts the proxy when `/health` does not answer;
- O5, the target is WSL 2, and native Windows is out of scope for now;
- O6, an eval budget of $1 (S6.1);
- the twelve round-1 security rows as drafted in 0.4: the repo controls on
  `plugins/<name>/`; the guard reading VoiceMode's settings; kept speech; the
  security pair at Test; the guard's pinned path; the read-back shown in chat;
  the mic candidate and no lead sessions; the typed-yes scope; fixed guard
  lines; no secrets spoken; heard text from any route; the ports from the
  speech URLs.

The lead, at level 3 under the owner's standing goal, then answered the rest
(2026-11-12):

- O7, the practice run's steps come from the build session once Test passes,
  and the owner picks the time then (S6);
- O8, the local-services acceptance is re-taken with the proxy, socket-only
  engines and the 0.4 controls in place, and all the S8 entries are added;
- A10, the port 8765 probe is skipped as Hardening and recorded as an
  accepted-risk candidate (S7, S8).

The lead, at level 3 under the owner's standing goal, then took every
round-2 row as drafted in 0.9 (2026-11-12, decision 168), and answered:

- O10, Incantation ships `launch.mjs`, which starts each engine on its socket
  and never edits a file VoiceMode installed, so S3 stands; if an engine
  cannot listen on a socket at all, S9 stops the work. Decision 170 keeps
  the auto-start check, runs `launch.mjs` as a README step, stops it by a
  checked PID, and adds claim 18;
- O11, the eval fixture runs the real proxy in front of fake engines, with no
  bypass, and falls back to the practice run (S6.1);
- the branch history: a squash merge with `--delete-branch`, and no
  force-push. Round 1 of the reopened stage found that a pull request keeps
  its commits public; 1.1 drafts opening it from a fresh branch cut from
  `main` with one commit of the final files, never from this branch, and
  then deleting this branch on origin (O16);
- #593 and #594: the lead closes them as replaced once the spec is approved.

The owner then narrowed D3 (2026-11-12, decision 169, relayed by the lead):
speech kept in logs on the person's own machine is out of scope, since the
machine itself is not something Incantation defends. The guard checks no log
setting, S8 has no kept-speech entry, and README step 7 names where VoiceMode
keeps speech, as information. A route from off the machine stays in scope;
S4.2 covers it. A risk wholly on the person's machine is out
of scope unless it touches auth, crypto or data migrations.

The lead, at level 3 under the owner's standing goal, took the live-run
drafts for the mic during speech, the round trip and the listening sign
(2026-11-12), with the budget left for the owner (O17). The owner then chose
to listen at all times now, in the lead's chat, relayed by the lead
(2026-11-12): "Build it now". The lead read it as our own always-on listener
that mutes while anything plays, over waiting for VoiceMode's. 1.2 drafts
that (S4.3), reverses S3's "no recorder of our own", and reopens the spec
stage.

One rule holds for every session on this work: no third-party weakness detail
goes in the spec, the README, the threat model, a commit, the pull request, a
test name or the review record. A finding that needs that detail stays out of
them.

## Open

- **O12.** Who runs the first socket check, on which WSL 2 machine, and
  when? Drafted: the owner, on their own distribution, from the build
  session's steps, before anything is built. It covers all of S9's first
  checks, the audio and wake checks included, which need a WSL 2 machine
  with a mic and speakers.
- **O13.** When does the owner rule on each S8 scope change? Drafted: before
  the build starts.
- **O14.** The lead-session signal: head-chef gains a readable lead marker in
  this change, or the build stops and asks?
- **O15.** The port 8765 probe, drafted back in against A10.
- **O16.** The pull request from a fresh branch, and deleting this branch on
  origin.
- **O17.** The round-trip budget (S4.3): drafted at 2.5 s, the median of 10
  turns, for the speech side only, and whether the whole felt time gets a
  budget too. The owner's number, given before the practice run; until then
  the draft stands.
- **O18.** The two ambient-speech classes (S8): pending. Asked of the owner
  before the build, with O13; each lands only on a merge the owner confirms
  in their own chat. On a no to either before the build, the build takes
  the turn-based design drafted at 0a8e7308 (listening only inside
  `converse`, no listener); on a no at merge, the change does not merge
  until the listener is taken out.
- **O19.** How `listen.mjs wait`, run once a turn, gets past Claude Code's
  permission prompt. Each prompt would stall every turn. Drafted: README
  step 6 adds one allow rule for exactly `node <skill base>/scripts/listen.mjs
  wait`, while `start` and `stop` stay prompted. The residual: while the
  listener runs, a steered session of the person's could run `wait` without
  a prompt, and gets `busy` only while the skill's own `wait` is connected.
  The owner's call.

Nothing is filed upstream, and any future report stays private.
