# Incantation: the spec

Draft 0.3, for issue #208 at Standard tier. It replaces `docs/spec/live.md` on
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

### S4.1 Local only

- **(a) Both speech services listen on loopback only.** The speech-to-text and
  text-to-speech services answer on `127.0.0.1` and on no other address. The
  README gives the steps to set this for each service on the person's platform,
  and to restart the service after. It also says an update to VoiceMode may
  undo the setting, which is why the guard checks on every start.
- **Speech stays local.** The README sets `VOICEMODE_TTS_BASE_URLS` and
  `VOICEMODE_STT_BASE_URLS` to the loopback URLs only, in
  `~/.voicemode/voicemode.env`.
- **(b) `guard.mjs` refuses a service reachable off loopback.** It is a Node
  script with no dependencies. It does three things:
  - **Ports.** It reads the ports from `VOICEMODE_WHISPER_PORT` and
    `VOICEMODE_KOKORO_PORT`, in the environment or in
    `~/.voicemode/voicemode.env`, and defaults to 2022 and 8880.
  - **Reach.** For each non-internal IPv4 and IPv6 address in
    `os.networkInterfaces()`, it tries a TCP connect to each port, with a
    500 ms timeout. A connect that succeeds on any of those addresses counts
    as exposed.
  - **Speech URLs.** It reads both base-URL settings the same way. Any entry
    whose host is not loopback counts as a failure.

  It prints one line:
  - `ok`;
  - `exposed <service> <port>: make it listen on 127.0.0.1 only, see README step 3`;
  - or `remote <setting>: set it to the loopback URL only, see README step 4`.

  It never prints an address or a path. It exits 0 only on `ok`.
  - A connect from this machine to its own address skips the host firewall,
    so the guard refuses a service listening beyond loopback even when a
    firewall would block it. That is on purpose: where the service listens is
    what the guard checks.
- **(c) Never `voicemode serve`.** Incantation calls `converse` over the stdio
  MCP server only. The skill never starts, configures or connects to `voicemode
  serve` or port 8765, and the README says not to run it alongside Incantation.
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
  for the owner, need a typed yes. Driver: cheaper to reverse.
- **Guard against dependency.** A guard keeps grimoire free of VoiceMode's
  install, at the cost of a check on each start. Owner's call, taken.

## S8. Threat model

The owner judged the risks of VoiceMode's local services acceptable with the
S4.1 controls (2026-11-12). The candidate entry for the threat model:

- **What it covers.** Local speech services that Incantation relies on but
  does not control.
- **Controls.** The S4.1 guard: loopback only, local speech URLs, and no
  `voicemode serve`. The hear-back, and a typed yes for what is hard to
  reverse.

Changing the threat model's scope is the owner's call.

## Decisions taken

The lead took these under the owner's standing goal (2026-11-12):

- O1, a typed yes for hard-to-reverse and reserved acts;
- O2, `plugins/incantation/` here, with the check widened in the same change;
- O4, the security pair on the spec, next to the spec pair.

The lead also set the S4.1 (a) to (c) requirements, and the owner accepted
the residual risk of VoiceMode's local services with them.

## Open

None. Nothing is filed upstream.
