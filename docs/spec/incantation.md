# Incantation: the spec

Draft 1.0, for issue #208 at Standard tier. It replaces `docs/spec/live.md` on
the dropped branch. Owner's scope: the issue's comments of 2026-11-12 (the
rescope onto VoiceMode, and the Incantation name and feel). Draft 0.4 holds the
fixes drafted after spec round 1, 0.5 adds the owner's proxy (S4.2), and 0.6
to 0.8 fold in the answers (Decisions taken), 0.9 holds the fixes drafted after
spec round 2, and 1.0 folds in the lead's answers to them.

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
for VoiceMode, and for a local-only setup, each time `/incantation` runs. A
loopback proxy of its own stands in front of the speech engines (S4.2).

**Target environment: WSL 2 (O5, the owner's pick).** Claude Code, VoiceMode,
both speech engines and the proxy all run inside one WSL 2 distribution.
Native Windows is out of scope for now, and so is Claude Code on Windows
talking to VoiceMode inside WSL. The spec and the README both say so. The
end-to-end step: in the distribution, install VoiceMode, apply the README
settings, `launch.mjs` starts the engines on sockets, `/incantation` starts the
proxy, the guard prints `ok`, the greeting is heard.

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
`proxy.mjs`, the README setup, a
marketplace entry, the repo controls widened to the new plugin (S5), candidate
threat-model entries (S8).

Out: any recorder or speech engine of our own (the proxy forwards, and holds
no speech); changes to VoiceMode;
clearing VoiceMode's logs for the person; a hook that runs on every session
start; running Incantation in a head-chef lead session (S4 step 7).

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
   3. **Setup check.** It runs `guard.mjs` by its path in the skill base
      directory, `<skill base>/scripts/guard.mjs`, never by a path relative to
      the working folder (S4.1). Unless the script prints `ok`, it shows the
      script's line and stops.
   4. **First call.** The greeting is the first `converse` call. If it errors,
      it shows the error's first line and the setup line from step 1, then
      stops. There is no retry loop.
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
   anything else it treats as a new request.
   - **Spoken yes:** enough for everything except the next item.
   - **Typed yes only:** needed for acts that are hard to reverse (merge, push,
     delete, publish, send, install, a settings change), for running a command
     whose effects the session has not read, and for every decision the
     person's instructions keep for them. The session asks aloud for a typed
     yes, shows the one act and its target in chat, and waits. A typed yes
     covers exactly that act and target, never a batch. A spoken yes to these
     is answered with "I need that one typed."
5. **Heard is not typed.** Heard text, from `converse` or any other VoiceMode
   route, is shown in chat as `Heard: "…"`. It never stands for the person's
   typed words where instructions ask for those, never answers a permission
   prompt, and never widens what the session may do. Spoken-yes acts still go
   through the permission mode in force.
6. **Off and failure.**
   - "Stop", "that's all" or a typed message ends the loop with a short
     goodbye, except a typed reply to a pending typed-yes request: that is the
     answer, and the loop goes on with the next `converse` call.
   - A `converse` error after the greeting shows the error's first line in
     chat, ends the loop, and drops any pending act.
7. **Not in a lead session.** `/incantation` refuses to start in a session that
   leads a brigade, and says why. The signal it reads is the head-chef
   skill's own lead marker, named at build from `skills/head-chef/`.

### S4.1 Local only

- **(a) The speech services answer only through the proxy (S4.2).** The
  speech-to-text and text-to-speech engines listen on a local socket each, in
  `~/.incantation/run/` (owned by the person, mode 0700, no group or other
  bits), and on no TCP port. Incantation ships `launch.mjs`, which starts each
  engine on its socket; it never edits a file VoiceMode installed (O10).
  Whether both engines can listen on a socket in WSL 2 is the build's first
  check, before anything else is built; S9 stops the work if it fails. The proxy owns the
  loopback TCP ports VoiceMode calls (2022 and 8880, or the ports in the
  speech URLs) and forwards to the sockets. The README gives this as plain
  setup steps, with no word on why or on what the default is: turn off
  VoiceMode's own engine services, then start the engines with `launch.mjs`.
  It says a VoiceMode update may turn those services back on, and that the
  guard then fails until they are turned off again.
- **(b) The text-to-speech service serves speech only.** As defence in depth
  behind the proxy, the README sets its web player and its cross-origin access
  off, as plain setup steps.
- **(c) Speech stays local, and VoiceMode is set in one place.** The README
  sets `VOICEMODE_TTS_BASE_URLS` and `VOICEMODE_STT_BASE_URLS` to
  `http://127.0.0.1:<port>/v1` only, in `~/.voicemode/voicemode.env`. Every
  VoiceMode setting lives in that file: never in the MCP server's own
  environment, and never in a project-level VoiceMode settings file. It:
  - leaves `VOICEMODE_MCP_URL` and `VOICEMODE_MLX_AUDIO_BASE_URL` unset;
  - turns off the auto-start of a speech engine;
  - needs no OpenAI key;
  - does not install VoiceMode's heard hook.
- **(d) `guard.mjs` checks all of it.** It is a Node script with no
  dependencies, in `plugins/incantation/skills/incantation/scripts/`. It runs
  these checks; each failure prints one fixed line:
  - **Settings, read as VoiceMode reads them.** It reads, in order:
    1. the process environment;
    2. `~/.voicemode/voicemode.env`, or `~/.voicemode/.voicemode.env` when
       that is missing, whatever `VOICEMODE_BASE_DIR` says;
    3. a project-level VoiceMode settings file, looked for from the project
       root up, skipping the global file.

    It parses values as VoiceMode does: the first source to set a key wins. It
    reads only the keys it needs. It also reads the key names, never the
    values, of the `env` block of every MCP server entry that provides the
    found `converse` tool: in the user, local and project MCP configs, and in
    VoiceMode's plugin manifest.
    - Any `VOICEMODE_` key in an MCP server's `env` block fails: `server env:
      move VoiceMode settings to the global file, see README step 4`.
    - A project-level file fails: `project <file kind>: move VoiceMode settings
      to the global file, see README step 4`.
    - These fail with `remote <setting>: set it to the loopback URL only, see
      README step 4`:
      - either speech URL setting unset, unparseable, or with any entry that
        is not `http://127.0.0.1:<port>/…`;
      - `VOICEMODE_MCP_URL` set (tested for presence only);
      - `VOICEMODE_MLX_AUDIO_BASE_URL` set.
    - `VOICEMODE_AUTO_START_KOKORO` on fails: `auto-start: turn it off, see
      README step 4`.
    - The heard hook in any of `~/.claude/settings.json`,
      `.claude/settings.json` or `.claude/settings.local.json` fails: `heard
      hook: remove it, see README step 4`.
  - **Ports.** The ports named in the resolved speech URLs. The proxy binds
    the same ports (S4.2), so the two always match.
  - **Reach.** For each non-internal IPv4 and IPv6 address in
    `os.networkInterfaces()` (skipping link-local), it tries a TCP connect to
    each port, all in parallel, with a 500 ms timeout. A connect that succeeds
    counts as exposed: `exposed <service> <port>: see README step 3`. Tests
    pass their own address list through an imported function; the command
    line reads no override.
  - **Only through the proxy.** On `127.0.0.1` at each port:
    - `GET /health` must return the token the proxy wrote into
      `~/.incantation/run/` when it started (a fresh random value, mode
      0600), else `no proxy <service> <port>: see README step 3`;
    - a request with a foreign `Host`, a request with a foreign `Origin`, and a
      request for a path outside the proxy's list must each be refused by the
      proxy, else `proxy open <service> <port>: see README step 3`;
    - nothing but the proxy answers on `[::1]` at that port, else `exposed
      <service> <port>: see README step 3`.

    Each engine's socket must exist and be a socket owned by the person. It
    must sit in `~/.incantation/run/`, with mode 0700 and the person as
    owner. Else: `socket <service>: see README step 3`. The proxy's status answer must name a socket upstream for
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
  `VOICEMODE_MCP_URL`), and never passes `voice` or `ref_text`. The skill never starts, configures or connects to `voicemode
  serve` or port 8765, and the README says not to run it alongside Incantation.
  Whether the guard also refuses when port 8765 answers is a trade-off (S7).

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
    with encoded characters, dot segments or doubled slashes.
- **Checks every request.** Each request on a kept-alive connection is parsed
  and checked on its own. The path is matched exactly, raw, and the target
  forwarded is the one checked.
- **Forwards** a request that passes to the engine's socket, without its
  `Authorization` and `Cookie` headers. It streams the body and the response
  both ways, so audio is not held whole.
- **Answers** `GET /health` itself, with its start token and each upstream's
  kind (socket or TCP), never a path or an address. It refuses to start with a
  TCP upstream.
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

## S5. Files

- `plugins/incantation/.claude-plugin/plugin.json`, with its own `version`
- `plugins/incantation/skills/incantation/SKILL.md`, built through `contract`
- `plugins/incantation/skills/incantation/scripts/guard.mjs` (S4.1 d)
- `plugins/incantation/skills/incantation/scripts/proxy.mjs` (S4.2)
- `plugins/incantation/skills/incantation/scripts/launch.mjs` (S4.1 a): runs
  each engine's program from where VoiceMode installed it, with its own
  arguments, listening on its socket in `~/.incantation/run/`. It edits no
  file VoiceMode installed. It writes its PIDs into `~/.incantation/run/`;
  `launch.mjs stop` signals each only after checking it is an engine it
  started, owned by the person. After a restart the person runs it again, and
  the guard's socket check says so.
- `tests/incantation-proxy.test.mjs`: fake engines on sockets, the proxy on
  free ports, Node's built-in test runner. It skips on win32 and says so.
- `plugins/incantation/README.md`. It opens with the target: WSL 2, with
  everything inside one distribution; native Windows is not supported yet. Its
  steps, in order:
  1. install VoiceMode (the exact lines, with the commit they came from), and
     set up audio in WSL 2;
  2. run its service setup;
  3. turn off VoiceMode's engine services, start the engines with
     `launch.mjs` (S4.1 a), and the S4.1 (b) settings;
  4. the S4.1 (c) settings;
  5. the proxy:
     - `/incantation` starts it, and it keeps running after the session;
     - `proxy.mjs stop` stops it;
     - VoiceMode used on its own needs it running;
  6. never run `voicemode serve`, and use a headset;
  7. who hears: people in the room are heard, and their words reach the model
     provider as chat. One plain line names where VoiceMode keeps what is
     heard and said on the machine.
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
   "no" or another reply leads to no act.
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
   on all interfaces, using an address list passed through its imported
   function, so it runs in the
   athanor container.
10. `guard.mjs` prints `remote …` when either speech URL is unset anywhere, or
    lists anything but `http://127.0.0.1:<port>/…`, or when
    `VOICEMODE_MCP_URL` or `VOICEMODE_MLX_AUDIO_BASE_URL` is set; `server env
    …` with a `VOICEMODE_` key in an MCP server's `env` block; `project …`
    with a project-level settings file; `auto-start …` with the engine
    auto-start on; `heard hook …` with the hook in any of the three settings
    files.
11. `guard.mjs` prints `no proxy …` when a port answers without the proxy's
    marker, `proxy open …` when a foreign `Host`, a foreign `Origin` or an
    unlisted path gets through, `socket …` when an engine's socket is missing
    or in an open folder, and `tts scope …` when the text-to-speech engine
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
16. `proxy.mjs` forwards a listed request to the socket, without
    `Authorization` or `Cookie`, and streams the answer back unchanged. It
    refuses to start with a TCP upstream, or when its port is taken. It writes
    no body, header value, path or address to any output. `stop` signals only
    its own PID.
17. With the proxy stopped, its ports refuse a connection. Whether VoiceMode
    then tries nothing else is a practice-run step.
18. `launch.mjs`, run with fake engine programs, starts each with a socket in
    `~/.incantation/run/` and no TCP port, writes nothing outside
    `~/.incantation/`, and `stop` signals only the engines it started.

Claims 7 to 13 and 15 to 18 are Node tests; the socket ones skip on win32. The ticket closes on the owner's
practice run. Once Test passes, the build session proposes its steps, each
with a pass or fail, in WSL 2, and the owner picks the time then.

### S6.1 The eval cases

Claims 1 to 6 and 14 are eval cases, seven in all, one per row. The
`greeting` rubric also grades a warm, alive opening. The `spoken-style` rubric
also grades one thing per turn.

| Case | Claim | `converse` |
|---|---|---|
| `no-converse` | 1 | absent |
| `guard-fails` | 14, first half | present; the guard fails |
| `greeting` | 2 | present |
| `spoken-style` | 3, 4 | present |
| `hear-back` | 5 | present |
| `typed-yes` | 6 | present |
| `lead-session` | 14, second half | present |

- **Budget.** The owner set Incantation's eval budget at $1 (2026-11-12): "We
  could use a $1 eval budget." In the repo's units, that is two things:
  - a cap of `--max-cost-usd 1` on every run;
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
- **Where the cases live, and `converse`.** Two things are not yet verified,
  and the build's first step is to check them:
  - **Where cases are read from.** The cases go wherever `claude plugin eval`
    reads them for a plugin that is not the repo root, and the budget test
    counts that folder.
  - **How the guard passes (O11).** The `present` cases need a passing guard
    with no bypass. The fixture runs the real `proxy.mjs`, in front of fake
    engines on sockets, under a fixture home folder that holds local-only
    settings. If that cannot run in the eval sandbox, claims 2 to 6 move to
    the practice run. Fixtures use invented heard lines only.
  - **How `converse` gets in.** A case gets `converse` from a test-only fake
    stdio MCP server in the case's fixture, which answers with a scripted
    heard line. The `absent` case runs without one.

  If either can't be done, the claim it backs moves to the practice run.
  The spec then records that.

## S7. Trade-offs

- **Spoken yes against safety.** Ordinary acts go on a spoken yes, which is the
  feel the owner asked for. Acts that are hard to reverse, unread commands, and
  decisions kept for the owner need a typed yes. Driver: cheaper to reverse.
- **Guard against dependency.** A guard keeps grimoire free of VoiceMode's
  install, at the cost of a check on each start. Owner's call, taken.
- **Port 8765 probe: skipped (A10).** The guard could also refuse when
  anything answers on 8765. It is Hardening at limit 0, so it is not built; it
  is recorded as an accepted-risk candidate in S8. The rule in S4.1 (e) stays:
  prose and a test of the skill's text.

## S8. Threat model

The lead recommends these entries, at level 3 (2026-11-12), with the proxy,
the socket-only engines and the 0.4 controls in place. They come into force
when the owner confirms the merge that adds them to
`docs/security/threat-model.md`, since AGENTS.md keeps that file's scope and
accepted risks for the owner.

The scope changes, each for the owner's word on its own:

- grimoire now ships a long-running local server, the proxy;
- new actors: a web page in the person's browser, and anyone audible to the
  mic.

The entries:

- **Local speech services.** A local program, or another account, that reaches
  the proxy's ports or the engines' sockets can use the allowed speech calls.
  One that takes a speech port while the proxy is down fails the guard's token
  check. Inside the entry: the allowed speech calls. Outside it: a web page,
  and any engine route outside the allow-list. Controls: the proxy (S4.2),
  engines on sockets only, the S4.1 settings as defence in depth, and the
  harness's approval of a project's MCP servers.
- **The microphone.** Heard text from anyone audible (people in the room, a
  call on speakers, played media) reaching acts short of the typed-yes list.
  Controls: the hear-back shown in chat, the typed-yes list, the permission
  mode in force, no lead sessions.
- **A risk row** for `guard.mjs` and `proxy.mjs`, shipped scripts that open
  and hold local connections, under "Keeping this page short".
- **Accepted-risk candidate: port 8765.** Nothing in Incantation starts or
  calls `voicemode serve`; the guard does not probe for it (S7).

The security pair runs on the diff at Test as well.

## S9. Rollback and stop

- **Rollback:**
  - Remove the marketplace entry and `plugins/incantation/`.
  - The widened check rules stay, since they hold with one plugin.
  - On the person's machine, `launch.mjs stop` and `proxy.mjs stop`, then
    turn VoiceMode's engine services back on.
- **Stop if:** the build's first check (S4.1 a) finds an engine that cannot
  listen on a socket at all; or VoiceMode will not
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
lead's chat): "Let's do the proxy then." S4.2 drafts it, keeping the S4.1
settings as defence in depth.

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
  cannot listen on a socket at all, S9 stops the work;
- O11, the eval fixture runs the real proxy in front of fake engines, with no
  bypass, and falls back to the practice run (S6.1);
- the branch history: a squash merge with `--delete-branch`, and no
  force-push;
- #593 and #594: the lead closes them as replaced once the spec is approved.

The owner then narrowed D3 (2026-11-12, decision 169, relayed by the lead):
speech kept in logs on the person's own machine is out of scope, since the
machine itself is not something Incantation defends. The guard checks no log
setting, S8 has no kept-speech entry, and README step 7 names where VoiceMode
keeps speech, as information. A web page's path to those files stays in
scope, and the proxy closes it. A risk wholly on the person's machine is out
of scope unless it touches auth, crypto or data migrations.

One rule holds for every session on this work: no third-party weakness detail
goes in the spec, the README, the threat model, a commit, the pull request, a
test name or the review record. A finding that needs that detail stays out of
them.

## Open

None. Nothing is filed upstream, and any future report stays private.
