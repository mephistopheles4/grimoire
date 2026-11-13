# Incantation

Voice pair-programming for Claude Code. You talk, it talks back, and it says
every request back to you before it acts.

Incantation targets **WSL 2, with everything inside one distribution**: Claude
Code, VoiceMode, both speech engines, the proxy and the listener. Native Windows
is not supported yet, and neither is Claude Code on Windows talking to VoiceMode
inside WSL. WSL 2 must be in its default NAT networking mode; mirrored mode is not
supported yet.

VoiceMode does the speaking. Incantation adds a setup check (the guard), a
loopback proxy, an engine launcher, an always-on listener and a skill with a
speech policy. Run the steps in order.

## 1. Install Node, VoiceMode and the audio tools

You run each line yourself. Nothing here is run for you.

Install Node 20 or later, and the audio tools the listener uses:

```bash
sudo apt update
sudo apt install -y pulseaudio-utils libasound2-plugins
```

Audio inside WSL 2 comes through WSLg's sound server, at `/mnt/wslg/PulseServer`.
In Windows, turn on Settings, Privacy & security, Microphone, "Let desktop apps
access your microphone". Check that the sound server answers:

```bash
PULSE_SERVER=unix:/mnt/wslg/PulseServer pactl info
```

Install VoiceMode. These lines are VoiceMode's own, from its getting-started page
at commit `c825f2a062d55fc2c42655d74a97df458211a494` (release v9.0.2), with the
version pinned and its launcher used in place of a fresh download on each start:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install voice-mode==9.0.2
claude mcp add --scope user voicemode -- voicemode-mcp-launcher
```

The guard was checked against VoiceMode **9.0.2** only. Any other version fails
the guard until the guard is checked against it.

## 2. Install the speech engines

Run VoiceMode's service setup. It downloads the engines (Whisper for speech to
text, Kokoro for text to speech) and their models:

```bash
voicemode service install whisper
voicemode service install kokoro
```

Do not start VoiceMode's HTTP server. Incantation never uses it.

## 3. Turn off VoiceMode's engine services and start the engines on sockets

Stop VoiceMode's own engine services, and turn off their start at boot:

```bash
voicemode service stop whisper
voicemode service disable whisper
voicemode service stop kokoro
voicemode service disable kokoro
```

Start the engines with the launcher. Each listens on a socket in
`~/.incantation/run/` and on no TCP port. The launcher edits nothing VoiceMode
installed, and it sets the text-to-speech engine's web player and its cross-origin
access off:

```bash
node <skill base>/scripts/launch.mjs start
```

`<skill base>` is the skill's base directory: the "Base directory for this skill"
line a session prints when `/incantation` runs. `node <skill base>/scripts/launch.mjs
stop` stops the engines. A VoiceMode update may turn its engine services back on;
the guard then fails until you turn them off again.

## 4. VoiceMode's settings

Every VoiceMode setting lives in one file, `~/.voicemode/voicemode.env`. Never put
one in the MCP server's own environment, and never in a project-level VoiceMode
settings file. Set exactly these:

```text
VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:8880/v1
VOICEMODE_STT_BASE_URLS=http://127.0.0.1:2022/v1
VOICEMODE_SERVICE_AUTO_ENABLE=false
VOICEMODE_AUTO_START_KOKORO=false
VOICEMODE_VOICES=af_sky
VOICEMODE_STREAMING_ENABLED=true
VOICEMODE_SILENCE_THRESHOLD_MS=1000
```

- Leave `VOICEMODE_MCP_URL` and `VOICEMODE_MLX_AUDIO_BASE_URL` unset.
- The end-of-speech wait, `VOICEMODE_SILENCE_THRESHOLD_MS`, is also read by the
  listener. Keep it at 1000 or less.
- No OpenAI key is needed. Do not install VoiceMode's heard hook.

## 5. The proxy

The proxy stands in front of both engines. It owns the ports VoiceMode calls
(2022 and 8880) and forwards to the sockets.

- `/incantation` starts it, and it keeps running after the session.
- `node <skill base>/scripts/proxy.mjs stop` stops it.
- VoiceMode used on its own needs it running, since the engines are on sockets.

## 6. Using it

- Never run VoiceMode's HTTP server alongside Incantation.
- Use a headset.
- Approve `converse` in each session when asked. Do not allow it through a rule in
  settings. Never add an allow rule for `listen.mjs start` or `stop`.
- To keep each turn from stopping on a prompt, you may add one allow rule for
  exactly `node <skill base>/scripts/listen.mjs wait`. It lets a session read heard
  text without a prompt while the listener runs. In observe-only mode you may add
  one more, for exactly `node <skill base>/scripts/observe.mjs add`, which lets a
  session append lines to the observe log without a prompt. `freeze` stays
  prompted. Adding a rule is your step; Incantation adds none.
- The mic is muted while Linux-side audio plays, so talking over the session is not
  heard. Sound from the Windows side (a browser, a call, media) is not muted and is
  heard as speech. Keep it off, or use a headset.

## 7. Who hears

While Incantation runs, the mic is open at all times. Everything said within its
reach, by anyone, reaches the model provider as chat, not only replies to the
session, and with Remote Control on, claude.ai and every signed-in device. **Tell
people within the mic's reach that it is always listening.**

Say "stop" or type to end it. It also stops after 30 minutes with nothing heard,
and when the Claude Code session it belongs to ends.

`listen.mjs` keeps no audio and no heard text. Claude Code keeps every heard line in
the session transcript, and may keep it in its background-task output. VoiceMode keeps what it
hears and says on this machine under `~/.voicemode/`.

In observe-only mode (`/incantation observe`), the session's unspoken candidates,
which can repeat what was said near the mic, go to `~/.incantation/observe/`. Day
files are dropped after 30 days, the next time it runs. A frozen sample stays until
you delete it. Delete the folder to clear both.

## Tuning

How often it speaks unasked is set in
`skills/incantation/references/tuning.md`, a file of starting points. Edit it and
start a new session. The listener's own numbers are at the top of
`skills/incantation/scripts/listen.mjs`.
