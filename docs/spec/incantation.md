# Incantation: the spec

Draft 0.1, for issue #208 at Standard tier. It replaces `docs/spec/live.md` on
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

Recommendation: the README tells the person to bind both servers to
`127.0.0.1` by editing `--host` in their start scripts (VoiceMode has no
setting for it that this check found), and not to run `voicemode serve` unless they set
`FASTMCP_HTTP_HOST_ORIGIN_PROTECTION=true` and `--token`. The fix belongs
upstream; filing it there is O3.

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

In: the plugin, `/incantation`, the guard, the README setup, a marketplace
entry, the check change it needs (S5), a candidate threat-model entry (S8).

Out: any listener, recorder or speech server of our own; changes to VoiceMode;
clearing VoiceMode's logs; a hook that runs on every session start.

## S4. What `/incantation` does

1. **Guard.** It looks for VoiceMode's `converse` tool under either name
   (`mcp__voicemode__converse` or the plugin's
   `mcp__plugin_voicemode_voicemode__converse`). It is missing, or the first
   call errors: say in chat what to install (`claude plugin install` or the
   `claude mcp add` line from VoiceMode's README) and which setup to run
   (`voicemode service install whisper` and `kokoro`), then stop. No retry
   loop.
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
5. **Heard is not typed.** Heard text is shown in chat as `Heard: "…"`. It never
   stands for the person's typed words where instructions ask for those, never
   answers a permission prompt, and never widens what the session may do.
6. **Off.** "Stop", "that's all" or a typed message ends the loop with a short
   goodbye.

## S5. Files

- `plugins/incantation/.claude-plugin/plugin.json`
- `plugins/incantation/skills/incantation/SKILL.md`, built through `contract`
- `plugins/incantation/README.md`: install, setup, the S2 binding advice, a
  headset note, and a line that people in the room are heard and their words
  reach the provider
- `.claude-plugin/marketplace.json`: a second entry
- `scripts/check.mjs` and `tests/check-manifests.test.mjs`: today the check
  fails any entry whose source is not `./` ("this repo is one plugin"). It must
  allow entries under `plugins/` (O2).

## S6. Acceptance claims

1. With no `converse` tool, `/incantation` prints the install and setup lines
   and makes no other tool call.
2. With `converse` present, the first call is a greeting that names a purpose
   and offers one first step drawn from the session's state.
3. No spoken `message` holds markdown, a code block, or a path.
4. An output over a few lines is spoken as a summary with an offer to drill in.
5. A request is said back and acted on only after a yes; "no" or another reply
   leads to no act.
6. A heard yes never answers a permission prompt or a decision the person's
   instructions keep for typed words.
7. The check passes with the second marketplace entry, and fails an entry
   outside `plugins/` or one without a manifest.

Claims 1 to 6 are eval cases under `evals/incantation/`. Claim 7 is a check
test. A practice run with a real mic, by the owner, closes the ticket.

## S7. Trade-offs

- **Spoken yes against safety.** Ordinary acts go on a spoken yes, which is the
  feel the owner asked for. Acts that are hard to reverse, and decisions kept
  for the owner, need a typed yes (O1). Driver: cheaper to reverse.
- **Guard against dependency.** A guard keeps grimoire free of VoiceMode's
  install, at the cost of a check on each start. Owner's call, taken.

## S8. Threat model

A candidate entry for the owner's word: Incantation relies on third-party local
servers that accept requests from the LAN and any web page (S2). Accepted with
the README's binding advice, or blocked until upstream binds to loopback. The
scope change to the threat model is the owner's.

## Open

- **O1.** Does a spoken yes suffice for acts that are hard to reverse (merge,
  push, delete, publish, install)? Recommended: no, those need a typed yes.
- **O2.** Where Incantation lives: `plugins/incantation/` here with the check
  widened (recommended), or its own repository with a GitHub source entry.
- **O3.** File the binding and Host/Origin issues upstream on mbailey/voicemode
  and the Kokoro fork? Publishing is the owner's.
- **O4.** Security pair on this spec? Recommended: yes, since it touches local
  network servers and mic access, though none of the listed sensitive areas.
