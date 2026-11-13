# Incantation

A voice pair-programming partner for Claude Code. `/incantation` turns a session
into one you talk with: it greets you, speaks short plain turns, listens at all
times, says each request back before acting, and speaks unasked only when
something needs you.

[Voicebox](https://voicebox.sh) does the speaking and the transcribing, on your
machine. Incantation adds a setup check (the guard), a setup script, an
always-on listener that never hears its own voice, and a skill with a speak
policy. It declares no dependency: the guard checks the setup at each start and
says what to do.

## Platforms

| Platform | Voicebox | Status |
|---|---|---|
| Windows 11 | MSI installer | Tested with a real mic: the earlier prototype and listener. This build is not yet run against a real Voicebox. |
| macOS | DMG (Apple Silicon and Intel) | Claimed only. No check runs on macOS. |
| Linux | built from source | Claimed only. Unit tests run on Linux with fakes; no real-mic run. |

The code is the same everywhere. These places differ by platform:

| Place | Windows | macOS and Linux |
|---|---|---|
| Capture input and device list | `dshow` | `avfoundation`, `pulse` or `alsa` |
| Finding ffmpeg | fully qualified drive folders on PATH | absolute PATH entries, owned by root or you, writable by no one else |
| The `~/.incantation` folder's privacy | your profile folder's default access | 0700 folders and 0600 files, refused when looser |
| The OS mic permission | Settings, Privacy, Microphone, "Let desktop apps access your microphone" | macOS: give the terminal or app that runs Claude Code Microphone access; Linux: none beyond the sound server |

## 1. Install Node, Voicebox and ffmpeg

- Node 24 or later.
- Voicebox 0.5.0 or later, from its site (Linux: build it from source as its
  README says). Start it, and keep it on this machine only. At each start,
  Incantation's guard refuses to go on when Voicebox answers on any of the
  machine's other addresses at that moment; a network that comes up later is
  not checked until the next start.
- ffmpeg, on your PATH. On macOS and Linux it must sit in a folder owned by
  root or by you that no other account can write; a shared Homebrew prefix
  owned by another account is refused.

## 2. Register Voicebox's MCP server

Once, at user scope, in this one form:

```text
claude mcp add --scope user --transport http voicebox http://127.0.0.1:17493/mcp
```

If it says an entry named `voicebox` already exists, and the guard later
refuses it, remove that one first with
`claude mcp remove --scope user voicebox`, then add it again.

The guard accepts only that entry, with at most Voicebox's own
`X-Voicebox-Client-Id` header, whose value it never reads. It refuses an entry
named `voicebox` at local scope or in a project's `.mcp.json`, since either
would take the place of yours. Config sources the guard does not read, such as
managed settings or a launch flag, are not checked.

At user scope, Voicebox's tools load in every Claude Code session on this
machine, not only voice ones, and Incantation calls only the speak tool. If you
want other sessions kept away from what Voicebox stores, add deny rules
yourself for `mcp__voicebox__voicebox_transcribe`,
`mcp__voicebox__voicebox_list_captures` and
`mcp__voicebox__voicebox_list_profiles`.

## 3. Run setup, in your own terminal

Not in a session: device and voice names stay in your terminal.

`<skill base>` is the installed plugin's `skills/incantation` folder, inside
the plugins folder of your Claude Code config folder. To find it, search that
plugins folder for a `setup.mjs` under an `incantation` folder, or ask any
session where the incantation skill is installed: a session can tell you its
base directory, though it never runs setup itself.

```text
node <skill base>/scripts/setup.mjs devices
node <skill base>/scripts/setup.mjs profiles
node <skill base>/scripts/setup.mjs choose <index> <stamp> <profile id>
```

`devices` prints a stamp and your microphones by index. `profiles` prints
Voicebox's voice profiles by id, with the engine each runs on. Pick a preset
profile on the fastest engine, Kokoro until measured otherwise: a heavier engine
costs seconds a line. `choose` checks all three, pins the ffmpeg it found, and
writes `~/.incantation/settings.json`. If your microphones change, run
`devices` and `choose` again.

## 4. Give the OS mic permission

As the platform table says. With the permission off, the mic gives only
silence, and the listener stops with `listener error mic`.

## 5. Start

Type `/incantation` in a session. It checks the setup, starts the listener,
prints `Listening, always on.`, warms the voice, and greets you. It prints
`Stopped listening.` whenever it stops.

- Use a headset. The mic is muted while Voicebox plays anything, from any
  caller, so talking over the session is not heard. Sound from other programs
  (a browser, a call, media) is not muted and is heard as speech.
- You may add allow rules so turns don't stop on a prompt. Add them yourself;
  Incantation adds none:
  - exactly `node <skill base>/scripts/listen.mjs wait`;
  - in observe-only mode, exactly `node <skill base>/scripts/observe.mjs add`
    followed by 8 hex digits, and a file write only to
    `~/.incantation/observe/inbox-` followed by 8 hex digits and `.json`.
    Never allow wider writes under `~/.incantation/`: a session could then
    change your settings or the eval set without asking.
  Never add an allow rule for `listen.mjs start` or `stop`, or for `setup.mjs`.

## 6. Who hears

While Incantation runs, the mic is open at all times. Everything said within its
reach, by anyone, reaches the model provider as chat, not only replies to the
session, and with Remote Control on, claude.ai and every signed-in device. **Tell
people within the mic's reach that it is always listening.**

Say "stop" or type to end it. It also stops after 30 minutes with nothing heard,
and when the Claude Code session it belongs to ends.

`listen.mjs` keeps no audio and no heard text. It passes the microphone's
device id, which can name the hardware, to ffmpeg on its command line, so
anything that reads or reports this machine's command lines sees it. Claude Code keeps every heard line
in the session transcript, and in its background-task output; where that output
is kept is not yet checked. Voicebox saves what it says to its Captures and
History. Whether it also keeps what it transcribes is not yet checked. Clear
both from Voicebox's own History and Captures tabs.

In observe-only mode (`/incantation observe`), the session's unspoken candidates,
which can repeat what was said near the mic, go to `~/.incantation/observe/`. Day
files are dropped after 30 days, and an inbox file never logged after a day,
the next time it runs. A frozen sample stays until
you delete it. Delete the folder to clear both.

## Stopping and removing it

`node <skill base>/scripts/listen.mjs stop` first, then delete `~/.incantation/`,
in that order. Incantation changes none of Voicebox's settings.

## Tuning

How often it speaks unasked is set in
`skills/incantation/references/tuning.md`, a file of starting points. Edit it and
start a new session. The listener's own numbers are at the top of
`skills/incantation/scripts/gate.mjs`.
