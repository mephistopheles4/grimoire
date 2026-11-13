# Incantation

A voice pair-programming partner for Claude Code. `/incantation` turns a session
into one you talk with: it greets you, speaks short plain turns, one fact at a
time, listens at all times, says a request back before it changes anything, and
speaks unasked only when something needs you. You can talk over it, and it
stops.

[Voicebox](https://voicebox.sh) does the speaking and the transcribing, on your
machine. Incantation adds a setup check (the guard), a setup script that
`/incantation install` runs for you, an always-on listener, and a skill with a
speak policy. It declares no dependency: the guard checks the setup at each
start and says what to do.

## Platforms

| Platform | Voicebox | Status |
|---|---|---|
| Windows 11 | MSI installer | Tested with a real mic and a headset: the owner's trial of the Voicebox build. |
| macOS | DMG (Apple Silicon and Intel) | Claimed only. No check runs on macOS. |
| Linux | built from source | Claimed only. Unit tests run on Linux with fakes; no real-mic run. |

The code is the same everywhere. These places differ by platform:

| Place | Windows | macOS and Linux |
|---|---|---|
| Capture input and device list | `dshow` | `avfoundation`, `pulse` or `alsa` |
| Finding ffmpeg | fully qualified drive folders on PATH | absolute PATH entries, owned by root or you, writable by no one else |
| The `~/.grimoire/incantation` folder's privacy | your profile folder's default access | 0700 folders and 0600 files, refused when looser |
| The OS mic permission | Settings, Privacy, Microphone, "Let desktop apps access your microphone" | macOS: give the terminal or app that runs Claude Code Microphone access; Linux: none beyond the sound server |

## 1. Install Node, Voicebox and ffmpeg

- Node 24 or later.
- Voicebox 0.5.0 or later, from its site (Linux: build it from source as its
  README says). Start it, and keep it on this machine only. At each start,
  Incantation's guard refuses to go on when Voicebox answers on any of the
  machine's other addresses at that moment; a network that comes up later is
  not checked until the next start.
- ffmpeg, on your PATH, with its `ffplay` beside it (step 2). On macOS and Linux it must sit in a folder owned by
  root or by you that no other account can write; a shared Homebrew prefix
  owned by another account is refused.

## 2. A player for the replies

Nothing is registered in Claude Code. The listener asks Voicebox for each reply as
audio (the stream route, which generates without playing) and plays it itself, so
it knows when a reply starts and ends and kills it the moment you talk over it.
Voicebox's own speaking is not used, and its MCP tools are not needed.

The player is `ffplay`, which comes with most ffmpeg builds, found in the same
folder as the ffmpeg that install pinned, never by searching PATH. When that
folder has no `ffplay`, the listener falls back to one system player: `afplay` on
macOS, `paplay` or `aplay` on Linux, Windows PowerShell's sound player on Windows.
These play from a file, so the listener writes one private file for the length of
a reply and deletes it when the reply ends or is cut. With none of them, the
first line fails with `say-no-player`: install an ffmpeg build that includes
`ffplay` and run `/incantation install` again. The player is started with no
shell, and the reply's text never reaches it: it gets audio only.

The session hands the listener each line in a small file it writes under
`~/.grimoire/incantation/observe/`, which the listener reads once and deletes, so
what the session says never passes through a command line.

## 3. Install, in a session

Type `/incantation install`. It runs the whole setup in the chat: it lists your
microphones and asks you to type the number of yours, lists Voicebox's voices
and asks you to type the id of the one you want (pick a preset on Kokoro: a
heavier engine costs seconds a line), saves them, checks the setup, and offers a
mic indicator for your status line.

Your microphone's and voice's names appear in the chat while it does this, so
they reach the model provider. The settings file, `~/.grimoire/incantation/settings.json`,
is written by Incantation's own script, and the session never reads it. If your
microphones change, run `/incantation install` again.

Earlier drafts kept their files in `~/.incantation/`. The first run of the guard,
setup or the listener moves that folder to `~/.grimoire/incantation/`, beside
eagle-eye's. A link in its place is never moved, and neither is a folder when the
new one already exists.

### The mic band (Claude Desktop and the terminal)

With the grimoire plugin installed, a row above the prompt shows the listener's
state, `mic: listening`, `hearing`, `thinking`, `speaking` or `muted`, in a colour
that eases from one state's to the next, with a wave of what the mic hears (two
rows of blocks as wide as the terminal; on the desktop an orb with the wave
flowing out of it and ripples while you talk, drawn as an image four times a
second), and a Mute or Unmute button. It draws nothing when no listener runs. It lives in
grimoire's own mod, beside Brigade, since a plugin cannot carry one here. It reads
`~/.grimoire/incantation/run/levels` four times a second while a listener writes
it, and a click writes `mute` or `unmute` to `run/command`, which the listener
reads once and removes. Nothing else in the run folder is read or written by it.

`levels` holds numbers only: a stamp, the state word and 24 digits, 0 to 8, one a
quarter second, the loudest frame of each. It holds no audio and no text, but it
does show when you were talking. The listener writes it at most four times a second
(about 0.1 ms each) and removes it when it stops. Anything that can write to your
`~/.grimoire/incantation/run/` folder can click for you, which it could already do by reading the
listener's channel token in the same folder.

### The mic indicator, for a terminal status line

Claude Desktop does not draw a status line; a terminal does. `/incantation install` offers a status line segment that reads `mic: listening`,
`mic: hearing`, `mic: thinking`, `mic: speaking` or `mic: muted`. It is the
script `skills/incantation/scripts/statusline.mjs`, which prints nothing when no
listener runs. To add it yourself, set this in your Claude Code user settings
file:

```json
{ "statusLine": { "type": "command", "command": "node <skill base>/scripts/statusline.mjs", "refreshInterval": 1 } }
```

If you already have a status line, add the script's output to yours instead.
`<skill base>` is the installed plugin's `skills/incantation` folder, which a
plugin update moves, so repeat the entry after an update.

## 4. Give the OS mic permission

As the platform table says. With the permission off, the mic gives only
silence, and the listener stops with `listener error mic`.

## 5. Start

Type `/incantation` in a session, the lead session of a brigade included. It
checks the setup, starts the listener, prints `Listening, always on.`, warms the
voice, and greets you. It prints `Stopped listening.` whenever it stops.

- **Use a headset.** The mic stays open while a reply plays, so the session can
  hear you talk over it, and the listener stops the reply it was playing. A mic that picks up
  the speakers will hear the session's own voice and answer it. Sound from other
  programs (a browser, a call, media) is heard as speech.
- **Barge-in stops the player.** The listener plays each reply itself, so it ends the
  player when you talk over it, drops the replies queued behind it and tells the
  session the reply was cut. How fast the sound stops on your machine is not
  measured.
- **Mute is yours alone.** Say "mute" or "unmute" as a whole turn, or type
  `/incantation mute` or `/incantation unmute`. The session never mutes you. While
  muted, the listener still transcribes on this machine, only to catch "unmute",
  and nothing reaches the session.
- **Noise.** A quiet headset can make breaths look like speech, and the transcriber
  turns them into words such as "you". The gate is loose on purpose and leaves
  the noise to your own cancelling (NVIDIA Broadcast, your headset's, the OS's): a
  frame counts as voice at 6 dB over the floor and at least -55 dBFS, and a turn
  holds 120 ms of voice, so a short "yes" is heard. More turns open than before, in
  a noisy room too. A turn that is only a filler word is dropped. Raise
  `voiceDb`, `minVoiceDbfs` and `minVoiceMs` in `gate.mjs` if your room needs it.
- **Long turns.** A turn ends after 1.5 s of quiet (`endOfSpeechMs` in the settings,
  300 to 3000), and one that stops mid-sentence is held 2 s and joined to the next.
- **Say yes aloud.** A request that changes anything is said back, and a spoken yes
  is enough: a turn that starts with "yes", "go ahead", "do it" or the like, with no
  "no", "not", "wait", "but" or "stop" in it. Rules of your own that name typed words still need them: heard text
  never stands in for what you type.
- You may add allow rules so turns don't stop on a prompt. Add them yourself;
  Incantation adds none:
  - exactly `node <skill base>/scripts/listen.mjs wait`, `node <skill base>/scripts/listen.mjs idle`,
    and `node <skill base>/scripts/listen.mjs say` followed by 8 hex digits, with a file
    write only to `~/.grimoire/incantation/observe/say-` followed by 8 hex digits and `.txt`;
  - in observe-only mode, exactly `node <skill base>/scripts/observe.mjs add`
    followed by 8 hex digits, and a file write only to
    `~/.grimoire/incantation/observe/inbox-` followed by 8 hex digits and `.json`.
    Never allow wider writes under `~/.grimoire/incantation/`: a session could then
    change your settings or the eval set without asking.
  Never add an allow rule for `listen.mjs start` or `stop`, or for `setup.mjs`.

## 6. Who hears

While Incantation runs, the mic is open at all times, muted or not. Everything said
within its reach, by anyone, reaches the model provider as chat, not only replies to
the session, and with Remote Control on, claude.ai and every signed-in device. A
muted mic sends nothing. **Tell people within the mic's reach that it is always
listening.**

Say "stop" or type to end it. It also stops after 30 minutes with nothing heard,
and when the Claude Code session it belongs to ends.

`listen.mjs` keeps no audio and no heard text. It writes one word, the listening
state, to `~/.grimoire/incantation/run/status`. It passes the microphone's
device id, which can name the hardware, to ffmpeg on its command line, so
anything that reads or reports this machine's command lines sees it. Claude Code keeps every heard line
in the session transcript, and in its background-task output; where that output
is kept is not yet checked. The listener asks Voicebox for each reply through its stream
route; one probe left no History entry, which is not checked on every version.
Whether Voicebox keeps what it transcribes is not yet checked. Clear
both from Voicebox's own History and Captures tabs.

In observe-only mode (`/incantation observe`), the session's unspoken candidates,
which can repeat what was said near the mic, go to `~/.grimoire/incantation/observe/`. Day
files are dropped after 30 days, and an inbox file never logged after a day,
the next time it runs. A frozen sample stays until
you delete it. Delete the folder to clear both.

## Stopping and removing it

`node <skill base>/scripts/listen.mjs stop` first, then delete `~/.grimoire/incantation/`,
in that order. Incantation changes none of Voicebox's settings.

## Tuning

How often it speaks unasked is set in
`skills/incantation/references/tuning.md`, a file of starting points. Edit it and
start a new session. The listener's own numbers are at the top of
`skills/incantation/scripts/gate.mjs`.
