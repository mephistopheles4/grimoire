# Incantation: the spec

Draft 0.2, for issue #208 at Standard tier. It replaces `docs/spec/live.md` on
the dropped branch. Owner's scope: the issue's comments of 2026-11-12 (the
rescope onto VoiceMode, and the Incantation name and feel).

## S1. Objective

`/incantation` turns a Claude Code session into a voice pair-programming
partner. VoiceMode (mbailey/voicemode, MIT) does the speaking and listening.
Incantation only adds the way the session talks:

- it wakes up warm, says in one line what it is there for, and offers a first
  step;
- it summarizes rather than reads output aloud, then offers to drill in;
- it says each request back in its own words and acts only on a yes;
- it keeps turns casual: one thing per turn, plain words, no markdown aloud,
  details only when asked.

Incantation is a separate plugin in the `mephistopheles4` marketplace, not part
of the grimoire plugin. It declares no dependency on VoiceMode. A guard checks
for VoiceMode when `/incantation` runs.

## S2. What the VoiceMode check found

A read-only source check at VoiceMode `da1b969` (2026-11-09), its Kokoro fork
`ai-cora/Kokoro-FastAPI` master, whisper.cpp master and fastmcp 3.4.11. Nothing
was installed or run. Windows was not probed.

| Port | Server | Binds | Checks Host | Checks Origin | Notes |
|---|---|---|---|---|---|
| 2022 | whisper.cpp `whisper-server`, started by VoiceMode's script | `0.0.0.0` | no | no; sends `Access-Control-Allow-Origin: *` | Also `POST /load`, which swaps the model from a file path. |
| 8880 | Kokoro-FastAPI (fork), started by its own start scripts | `0.0.0.0` | no | no; CORS on, origins `*` by default | Also `/debug/*` (system and storage info), `/dev/*`, `/v1/download/{filename}`. |
| 8765 | `voicemode serve` (HTTP MCP) | `127.0.0.1` | no, by default | no, by default | fastmcp's Host/Origin guard defaults to off. The IP allowlist passes loopback, so it does not stop DNS rebinding. No token unless `--token`. **Not running by default:** the Claude Code install uses stdio. |

What that means:

- **2022 and 8880 answer anyone on the network and any web page.** A form POST
  is a simple CORS request, so a page in the person's browser can send audio to
  transcribe or text to speak, and read the answer. Neither server keeps the
  person's speech. The reach is compute, a model swap on 2022 that breaks or
  skews transcription, and system details from Kokoro's `/debug`. Whether
  Kokoro's temp files hold past speech was not probed.
- **8765 is the serious one, when it runs.** A rebinding page could call
  `converse`, which speaks and then records the mic. Incantation never needs
  it: it works over stdio.
- **No converse call path leaves the machine** when VoiceMode points at its
  local servers. Heard text still reaches the provider as chat, as with any
  session.

Two more facts from the same read:

- **VoiceMode offers no setting for the bind host of 2022 or 8880.** `--host
  0.0.0.0` is written into whisper's start script
  (`templates/scripts/start-whisper-server.sh`, and the fallback in
  `tools/service.py`) and into each Kokoro start script (`start-*.sh`,
  `start-*.ps1`). The only way is to edit those files, and a VoiceMode
  reinstall or update writes them again. `VOICEMODE_SERVE_HOST` exists, but it
  is for 8765 only.
- **The default speech URLs fail over to OpenAI.** `VOICEMODE_TTS_BASE_URLS` and
  `VOICEMODE_STT_BASE_URLS` default to the local server, then
  `https://api.openai.com/v1`. With an OpenAI key set, a stopped local server
  sends the audio or text off the machine.

S4.1 turns this into requirements. The upstream fix is O3.

### Does `converse` leave room for the style rules?

Yes, with one conflict.

- `converse(message, wait_for_response, …)` takes any text, so what is said and
  how short it is stays with the session. VoiceMode's own prompt and skill
  already ask for short turns and one question at a time, which agrees with
  Incantation.
- **The conflict:** its tool description says to treat the reply "as the user's
  next message and act on it, including any skill it calls for." Incantation's
  hear-back rule overrides that: a reply is a request to say back, not an act.
- VoiceMode's plugin hooks only play sounds; none answers a permission request.

## S3. Scope

In: the plugin, `/incantation`, the guard and `guard.mjs`, the README setup, a marketplace
entry, the check change it needs (S5), a candidate threat-model entry (S8).

Out: any listener, recorder or speech server of our own; changes to VoiceMode;
clearing VoiceMode's logs; a hook that runs on every session start.

## S4. What `/incantation` does

1. **Guard.** It runs in this order and stops at the first failure. Each
   failure prints the fix in chat and nothing is spoken.
   1. **VoiceMode present.** It looks for VoiceMode's `converse` tool under
      either name (`mcp__voicemode__converse` or the plugin's
      `mcp__plugin_voicemode_voicemode__converse`). If it is missing, it says
      what to install (`claude plugin install` or the `claude mcp add` line from
      VoiceMode's README) and which setup to run (`voicemode service install
      whisper` and `kokoro`).
   2. **Exposure check.** It runs `node scripts/guard.mjs`, from the plugin's
      root (S4.1). Unless the script prints `ok`, it shows the script's fix
      line and stops.
   3. **First call.** The greeting is the first `converse` call. If it errors,
      it shows the error's first line and the setup line from step 1, then
      stops. There is no retry loop.

### S4.1 Local only: the binding requirement and the exposure check

- **(a) Bind both services to `127.0.0.1`.** VoiceMode has no setting for this
  (S2). The README tells the person to change `--host 0.0.0.0` to `--host
  127.0.0.1` in two places: whisper's start script under
  `~/.voicemode/services/whisper/`, and the Kokoro start script VoiceMode runs
  under `~/.voicemode/services/kokoro/` (`start-gpu.sh`, `start-cpu.sh`,
  `start-gpu_mac.sh`, or `start-*.ps1` on Windows). Then they restart with
  `voicemode service restart whisper` and `kokoro`. The README also says that
  an update rewrites these files, which is why the guard checks on every
  start.
- **Speech stays local.** The README sets `VOICEMODE_TTS_BASE_URLS` and
  `VOICEMODE_STT_BASE_URLS` to the loopback URLs only, in
  `~/.voicemode/voicemode.env`.
- **(b) `guard.mjs` refuses an exposed service.** It is a Node script with no
  dependencies. It does three things:
  - **Ports.** It reads the ports from `VOICEMODE_WHISPER_PORT` and
    `VOICEMODE_KOKORO_PORT`, in the environment or in
    `~/.voicemode/voicemode.env`, and defaults to 2022 and 8880.
  - **Exposure.** For each non-internal IPv4 and IPv6 address in
    `os.networkInterfaces()`, it tries a TCP connect to each port, with a
    500 ms timeout. A connect that succeeds on any of those addresses counts
    as exposed.
  - **Speech URLs.** It reads both base-URL settings the same way. Any entry
    whose host is not loopback counts as a failure.

  It prints one line:
  - `ok`;
  - `exposed <service> <port>: bind it to 127.0.0.1, see README step 3`;
  - or `remote <setting>: set it to the loopback URL only, see README step 4`.

  It never prints an address or a path. It exits 0 only on `ok`.
  - A connect from this machine to its own LAN address skips the host
    firewall. So the guard refuses a bind to all interfaces even when the
    firewall would block the LAN. That is on purpose: the bind is what the
    guard checks.
- **(c) Never `voicemode serve`.** Incantation calls `converse` over the stdio
  MCP server only. The skill never starts, configures or connects to `voicemode
  serve` or port 8765. The README says not to run it alongside Incantation, so
  the rebinding path in S2 stays closed.
- **What binding does not close.** A page in the person's own browser can
  still reach `127.0.0.1:2022` and `:8880`: both answer every origin, and
  neither checks Host. Its reach is compute, whisper's `/load` swapping or
  breaking the model (which skews or blocks transcription), and Kokoro's
  `/debug` details. No mic audio and no session text is in reach. This is S8's
  residual.
2. **Greeting.** The first `converse` call is the greeting, for example:
   "Welcome to incantation mode. I'm here to pair with you on this repo. We can
   start with what's on your branch." The first step it offers comes from the
   session's state (branch, an open issue, the last task), never invented.
3. **Turns.** Each spoken turn is one thing, plain words, no markdown, no code
   or paths read aloud. Long output becomes a two-sentence summary and an offer:
   "Want the detail?" The detail goes to chat, not aloud.
4. **Hear-back.** Before an act, it says the request back in its own words and
   asks yes or no. It acts only on a yes; anything else it treats as a new
   request.
   - **Spoken yes:** enough for everything except the next item.
   - **Typed yes only:** needed for acts that are hard to reverse (merge, push,
     delete, publish, send, install, a settings change) and for every decision
     the person's instructions keep for them. The session asks aloud for a
     typed yes, shows the act and its target in chat, and waits. A spoken yes
     to these is answered with "I need that one typed."
5. **Heard is not typed.** Heard text is shown in chat as `Heard: "…"`. It never
   stands for the person's typed words where instructions ask for those, never
   answers a permission prompt, and never widens what the session may do.
6. **Off.** "Stop", "that's all" or a typed message ends the loop with a short
   goodbye.

## S5. Files

- `plugins/incantation/.claude-plugin/plugin.json`
- `plugins/incantation/skills/incantation/SKILL.md`, built through `contract`
- `plugins/incantation/scripts/guard.mjs` (S4.1 b)
- `tests/incantation-guard.test.mjs`: Node's built-in test runner, with fake
  servers on free ports and the ports passed through the environment
- `plugins/incantation/README.md`. Its steps, in order:
  1. install VoiceMode;
  2. run its service setup;
  3. bind both services to loopback (S4.1 a);
  4. set the speech URLs to local only;
  5. never run `voicemode serve`;
  6. use a headset;
  7. know that people in the room are heard and their words reach the
     provider as chat.
- `.claude-plugin/marketplace.json`: a second entry, `incantation`, with source
  `./plugins/incantation`
- `scripts/check.mjs` and `tests/check-manifests.test.mjs`. Today the check
  fails any entry whose source is not `./` ("this repo is one plugin"). The
  same change widens it:
  - the entry named like the root plugin keeps source `./`;
  - any other entry must have a source of `./plugins/<its name>`, a
    `.claude-plugin/plugin.json` there with the same name, and no version.

## S6. Acceptance claims

1. With no `converse` tool, `/incantation` prints the install and setup lines
   and makes no other tool call.
2. With `converse` present, the first call is a greeting that names a purpose
   and offers one first step drawn from the session's state.
3. No spoken `message` holds markdown, a code block, or a path.
4. An output over a few lines is spoken as a summary with an offer to drill in.
5. A request is said back and acted on only after a yes; "no" or another reply
   leads to no act.
6. A spoken yes never starts an act that is hard to reverse, never decides
   something the person's instructions keep for them, and never answers a
   permission prompt. A typed yes does.
7. The check passes with the second marketplace entry. It fails an entry
   whose source is outside `./plugins/<name>`, has no manifest, names a
   different plugin, or carries a version.
8. `guard.mjs` prints `ok` and exits 0 when the fake servers listen on
   `127.0.0.1` only.
9. `guard.mjs` prints `exposed whisper <port>…` or `exposed kokoro <port>…`
   and exits non-zero when a fake server listens on all interfaces. The test
   skips when the machine has no non-internal address, and says so.
10. `guard.mjs` prints `remote <setting>…` and exits non-zero when either base
    URL lists a non-loopback host.
11. `guard.mjs` output never holds an address or a path.
12. With the guard failing, `/incantation` makes no `converse` call.
13. The skill names no `voicemode serve`, no port 8765, and no HTTP MCP URL.

Claims 1 to 6 and 12 are eval cases under `evals/incantation/`, with a budget.
Claims 7 to 11 are Node tests. Claim 13 is a check test. The ticket closes on
a practice run the owner does with a real mic.

## S7. Trade-offs

- **Spoken yes against safety.** Ordinary acts go on a spoken yes, which is the
  feel the owner asked for. Acts that are hard to reverse, and decisions kept
  for the owner, need a typed yes (O1). Driver: cheaper to reverse.
- **Guard against dependency.** A guard keeps grimoire free of VoiceMode's
  install, at the cost of a check on each start. Owner's call, taken.

## S8. Threat model

A candidate entry for the owner's word:

- **What it covers.** VoiceMode's speech servers on loopback still answer any
  web page in the person's browser. Within reach: compute, whisper's model
  swap, and Kokoro's debug details.
- **Controls.** The S4.1 guard closes the LAN path. S4.1 (c) closes 8765.
- **The residual.** A page can skew or block transcription. A skewed
  transcript only becomes an act through the hear-back, and a typed yes is
  still needed for what is hard to reverse.

Changing the threat model's scope is the owner's call.

## Decisions taken

The lead took these under the owner's standing goal (2026-11-12):

- O1, a typed yes for hard-to-reverse and reserved acts;
- O2, `plugins/incantation/` here, with the check widened in the same change;
- O4, the security pair on the spec, next to the spec pair.

The lead also set the S4.1 (a) to (c) requirements.

## Open

- **O3.** Should the binding and Host/Origin issues be filed upstream? That is
  for the owner, and the lead is asking them. Nothing gets filed until then.
