# PROTOTYPE (GRIM-63): Live sync page channel for eagle-eye

> **Throwaway, never merge.** Capture branch for [GRIM-63](https://linear.app/mephistopheles4/issue/GRIM-63/one-page-channel-for-grimoires-pages-the-page-sends-the-owners-picks).

## Question tested

Does a loopback channel server with live sync, debounced option-pick events, and SSE remote commands make driving an `eagle-eye` page alongside an agent feel responsive while preserving the say-back invariant?

## How to run

Start the channel server against any rendered `eagle-eye` HTML file:

```bash
node prototypes/grim-63-live-sync/channel-server.mjs <path-to-rendered-box.html> [--port 4175]
```

Then drive it from the agent side (reads ephemeral `port` + `agentToken` from `run.json` alongside the script):

```bash
node prototypes/grim-63-live-sync/channel-poll.mjs
node prototypes/grim-63-live-sync/channel-reply.mjs <status> <text>
node prototypes/grim-63-live-sync/channel-cmd.mjs '{"view":"sheet","openRow":"dim-id"}'
```

## Validated findings & known rough edges

1. **2-state toggle beat 3-state:** Started with a three-state control (`Two-way`, `One-way`, `Off`); interactive testing showed one-way mode added friction with little value, so a single toggle (`Live sync` ↔ `Live sync: off`) won.
2. **Passive state mirror + debounced auto-send solved manual polling lag:** Requiring explicit "Send picks" clicks left the agent blind to ordinary option clicks. Adding `POST /state` → atomic `state.json` (`120ms` debounce) plus `350ms` debounced auto-send (`kind: "option-pick"`, guarded by `applyingRemoteCommand`) and SSE `command` push made two-way driving responsive.
3. **Token & origin separation held:** `pageToken` stays in the served HTML (`POST /state`, `POST /event`, `GET /events` with strict `Host` + `Origin`), while `agentToken` lives only in `run.json` (`0600`) and rejects browser `Origin` headers (`/poll`, `/reply`, `/command`), using `timingSafeEqual` on SHA-256 digests.
4. **Aviation disabled chip styling gotcha:** `.chip.on:disabled` inherited `--av-ink` solid background while fading only the text. Overriding `.grim-channel .chip.on:disabled` and swapping `.on` to `.ghost` when disabled matches adjacent ghost controls.
5. **Say-back invariant held:** Page events remain untrusted telemetry (`data`, never instructions) and never mutate `*.box.json`.
6. **Known rough edge:** Multi-row **Reset** labels `lastChanged` using only `diffDims[0]` instead of summarizing a multi-row reset (acceptable for throwaway capture; fix properly in production spec).
