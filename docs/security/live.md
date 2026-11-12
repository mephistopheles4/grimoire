# Live mode: probe record, controls and residuals

This page is part of the threat model in [`threat-model.md`](threat-model.md). A control it names is named by the threat model, and a security review is handed it with the threat model. An edit to its accepted-risk, candidate or gap lines is an edit to the threat model's accepted risks.

This page holds the detail behind the proposed risk R13: what the `live` skill's listener does with a microphone and a clip, what its speech tool was probed to do, and what each control stops and does not stop. Nothing here is accepted. The nine residual lines are candidates (P11) and wait for the owner. Sources: `skills/live/scripts/listen.mjs`, `skills/live/scripts/gate.mjs`, `docs/spec/live.md` (S5 to S8), issue 208.

Tags (ATLAS 2026.09, OWASP LLM 2025 and OWASP Agentic 2026; a newer release may renumber them): `AML.T0051` prompt injection; `LLM01:2025` prompt injection; `LLM02:2025` sensitive information disclosure; `ASI01` agent goal hijack. STRIDE: Spoofing applies here, unlike elsewhere in this project, because speech carries no identity. So do Tampering, Information disclosure and Elevation of privilege.

## What it moves

| Data | Where it sits | Who can read it | How long |
| --- | --- | --- | --- |
| The microphone's audio | In memory in the listener, from the recorder's pipe. Only the gate's one turn is kept. | The listener | Until the turn ends |
| The clip, `clip-<random>.wav` | `grimoire-live` in the per-user temp folder, unencrypted, mode 0600 where the system honours it | The person's account; on Windows, whoever the temp folder's access lets in; backup and sync of that folder | Until `clear`, `off`, `on` or the next `listen`, or until any later live command that runs five minutes or more after it was written. If no live command runs again, it stays. |
| `lock.json` | The same folder | The same | Until `off` or a take-over. It holds the token, the start time, the device's alternative id, the recorder's real path and the speech tool's name. |
| `heard`, `stop`, `listener.json` | The same folder | The same | Until `off` or the next `on` |
| The heard text, and every spoken line | The chat. From there: the model provider, the session transcript on disk, and every device Remote Control is on. | As those readers allow | As each keeps it |
| The same text, in the speech tool | Its history. See the probe, below. | Any process that can reach its port | Until someone deletes it |

The listener never transcribes and never speaks. The session does both, through the speech tool the person typed at turn-on.

## The probe (claim C24)

**What ran, and on what.** On 2026-11-11 (local time), against Voicebox, the speech tool the setup documents.

- **The person's own running install** answered only routes that return no history entry: its API description, `/health`, the two settings routes, and an aggregate count. Its history was not cleared, and no entry of it was read.
- **A throwaway second instance** was started from the same server program with a fresh data folder and its own port. It had an empty history. Every entry read on it was the probe's own one-word line, `Probe.`. It was stopped and its folder deleted afterwards.
- The history's shape below comes from the API description and from that one test entry. No entry of the person's is quoted or described.

**Versions.** The desktop app is 0.5.0. The speech server inside it reports API version 0.5.0. Its MCP server reports the name `voicebox`, version 3.2.4, and MCP protocol 2025-03-26.

| Question (spec S2) | Answer | How it was found |
| --- | --- | --- |
| Transport | HTTP. The MCP server is mounted at `/mcp` (a request to `/mcp` is redirected to `/mcp/`) and speaks the streamable-HTTP form. REST routes sit beside it on the same port. The app passes its server a port and no host: here, 17493. | Requests to both instances; the server's help text; the launch arguments |
| Bind | Loopback only, on both instances (`127.0.0.1`). The server has a `--host` option, and its help text says to use `0.0.0.0` for remote access. Whether the app has a setting that sets it was not probed. | `netstat` on both; `--help` |
| Credentials | None. The API description names no security scheme. `initialize`, `tools/list` and tool calls, and the REST routes tried, answered with no credential. A session id is handed to anyone who asks, so it is not one. | Requests with no header; the API description |
| Origin, REST | A fixed allow-list: `http://localhost:17493`, `http://127.0.0.1:17493`, `tauri://localhost`, `http://tauri.localhost` and `http://localhost:5173`. Any other origin's preflight gets 400 `Disallowed CORS origin`, and gets no allow-origin header on a plain request. The origin `null` and other ports on localhost are refused. A JSON body needs a JSON content type: `text/plain` to `/speak` gets 422, so no cross-site form post reaches it. | Preflight and plain requests with each origin, on `/transcribe`, `/speak` and `/health` |
| Origin, MCP | Not checked. `initialize` with the origin `https://evil.example` succeeded. The answer carries no allow-origin header, and a browser's JSON post would need the preflight above, which fails. | `initialize` with and without that header |
| Host | Not checked. `/health`, `/history` and `/events/speak` answered 200 to a request whose Host was `evil.example`. This is the condition DNS rebinding needs. Rebinding itself was not tried. | Requests with a changed Host |
| Can a browser page reach it | Not by a cross-site request, because of the two rows above. A page on a rebinding name could, because no route checks Host or credentials. This is inferred, not shown. | As above |
| What `speak` keeps | One history entry per line. Fields: id, profile id and name, `text`, language, `audio_path`, duration, seed, instruct, engine, model size, status, error, favourited, created time, versions (each with its own `audio_path`) and the active version. The audio is kept as a file in the data folder's `generations` folder. The test entry held the spoken text and a `.wav` path. | The API description; the test entry |
| What `transcribe` keeps | Nothing. A transcription through the MCP tool, with `audio_path`, left the history and the captures empty, and the answer is only text, duration, language and model (`base`). | The test instance, counts and lists before and after |
| What the app's own dictation keeps | A capture per dictation. Fields: id, `audio_path`, source, language, duration, `transcript_raw`, `transcript_refined`, the two model names, refinement flags and created time. The audio is served at `/captures/{id}/audio`. This is the app's own hotkey feature, not the skill. | The API description; the settings route (it shows the hotkey feature on) |
| Retention | None. Neither settings route has a retention or expiry field. Deletion is per entry (`DELETE /history/{id}`, `/captures/{id}`) and for failed generations (`DELETE /history/failed`). | The API description; both settings routes |
| What an unauthenticated client can do | List captures with their transcripts (`voicebox.list_captures`), list profiles, speak any text in any profile, transcribe any file the server can read (`audio_path` takes an absolute local path, for loopback callers), and stop the server (`POST /shutdown` is in the route list). `/events/speak` opens an event stream with no credential; its content was not read. On the throwaway instance only `list_profiles`, `speak` and `transcribe` were run. Listing captures and stopping the server are read from the tool and route lists, not run. | The tool list; the route list; the throwaway instance |
| Mapped drive's real path (T2's round 1) | A drive mapped to a share, `Z:` to `\\localhost\C$`, has the real path `\\localhost\C$\...`, not `Z:\...`, from `realpathSync.native`. T2's recorder check requires a drive-letter real path, so it refuses this. A `subst` drive resolves to its local folder and is accepted, which is right. | A mapped drive made for the probe and removed |

## The controls, as built

The numbers are the live spec's S7 (K1 to K9). They are not the threat model's accepted classes K1 and K2. Where the build and the spec differ, this table holds.

| # | Risk | What stops it | What it does not stop |
| --- | --- | --- | --- |
| K1 | Words from the room reach the session | The rules in the skill: heard text is never the person's typed words, and a read-back with no affirmative word covers acts that are hard to reverse and the decisions the session's instructions keep. The yes is tied to a task id. The chain limit, in the script, pauses `listen` after three heard returns. | The chain limit holds only while the agent keeps the rule that a reset needs a typed message. `reset`, `off` then `on`, and `on --take` each clear the count on the token alone, and the token is printed in every reminder line, so it sits in the transcript and on Remote Control devices. A spoken confirm from the room (K6) is accepted by the owner's word as a design choice and is a candidate here. |
| K2 | Heard text or a device name reaches a shell | No transcript is ever an argument. The device is chosen by a typed index against a stamped list. Every argument is range- or character-checked. There is no shell. | A device's friendly name is a text route into the agent. A USB maker or a paired Bluetooth device sets it, and it reaches the chat from `devices` and `on`. The script strips control characters and cuts it to 128 characters; nothing in the script frames it as data. The skill's prose shows names as data. |
| K3 | Two sessions speak or listen at once | The token lock, created exclusively. A take-over stops the old listener. | It is cooperation, not a security control. |
| K4 | Another account reads the clip | The per-user temp folder's access rules, checked by canonical path. A link or a junction is refused. Each clip is cleared after every transcribe. Every live command first removes clips older than five minutes. | The clip is unencrypted while it exists. If no live command runs again after a session ends without `off`, it stays. A fresh clip is kept on purpose, since the session may be about to read it. |
| K5 | The speech tool keeps text, and audio | The never-spoken list. The read-back speaks only the act and its target. The setup's loopback check. | Every spoken line is kept, with its audio, with no expiry (probe). |
| K6 | A spoken confirm comes from the room | The owner allowed a spoken yes. | Nothing stops it. A candidate. |
| K7 | Another program runs as the recorder | Only fully qualified drive folders on PATH are searched. The first match is followed to its real path, which must be a drive path. The path is pinned at `on` and compared again at each `listen`. The folder is shown to the person. There is no config file. | The recorder is trusted for being on a local drive, not for who can write its folder. A drive-root folder, or a folder that a sync program fills, passes. The pin checks the path, not the content, so a replaced file at the same path runs. An existing PATH folder that another account can write, and a missing one that another account can create, both come before the real recorder's. Another account on a shared host is the attacker; a planted PATH or environment is C11. |
| K8 | Audio or text leaves through a cloud engine | The setup's text. The skill speaks only through the tool pinned at turn-on. | The skill cannot check the setup. |
| K9 | A stale or planted clip | A fresh clip name per listen. The skill transcribes only the path its own listen printed. | A same-user watcher, or a program on the speech tool's port (the probe shows the port takes any caller). |

## Residuals, by S8's nine lines

Each line is a candidate in [P11](threat-model.md#candidates-for-the-owners-word). None is accepted.

1. **The new actor: anyone or anything audible while a listener runs.** It reaches the session's next messages, up to the chain limit, and every act a spoken confirm can approve. It hears every spoken line. The room supplies both the request and the confirm. The limit can be reset as K1 says.
2. **Speech has no speaker identity.** The gate hears energy, not a person. This widens C4 and C5.
3. **Forged transcripts, and a program on the speech tool's port.** The port needs no credential, so a program that answers on it while the tool is down can forge text and also receives the spoken lines and each clip. A swapped clip does the same. This touches C4, C7 and C11. `lock.json` is listed with them: a same-user program can rewrite it.
4. **The speech tool's history.** Any process on this machine that can reach the port can read it: no route needs a credential. It binds loopback by default, so the LAN cannot, unless the server is started with another host. A browser page cannot by a cross-site request; a DNS-rebinding page could (inferred). It holds each spoken line's text and audio, with no expiry. A transcription through the tool leaves nothing.
5. **The clip at rest.** Unencrypted in the per-user temp folder until it is cleared, or until any later live command runs five minutes or more after it was written. If no live command ever runs again, it stays.
6. **Bystander speech.** It reaches the provider, the transcript, Remote Control and local decision records. This widens C6, C7, C12 and P6.
7. **Identifiers.** The clip path in `LIVE heard` and the recorder folder in `on` carry the Windows account name into the chat, the provider, the transcript and Remote Control. The session needs the clip's absolute path, so it stays. A device's name may name a person.
8. **Unverifiable setup.** The skill cannot check that the speech engine is local (K8).
9. **A planted PATH.** Another account on a shared host can create a missing PATH folder that comes before the recorder's, or write to an existing one that does. The recorder's own folder can be writable by others too (K7). This is a new class, outside C11.

**Needs the owner's word, and is not a risk line.** Decision 66 accepted prompt injection as a threat class for this skill, and spec D17 relies on it. Since issue 584 (E88), C1 accepts the steering of a working session by text it reads, but it leaves outside it "a change that adds a route by which outside text reaches a session". Heard speech is such a route, and C1's list of text (issues, comments, pull requests, files, notes, hand-offs, reports, tool output) does not name it. So no class covers decision 66 today. Until the owner names one, or widens C1 to take it, D17's read-back and its typed-words rule are controls with no accepted class behind them.

**Offered as accepted-risk candidates, none built** (Hardening, limit 0): a random salt for the device stamp, so it is not a stable fingerprint of the audio hardware; a sweep of leftover `*.tmp` files at `off`; a recheck of the heard count just before a clip is written, for two listens that overlap; a content hash of the recorder at `on` and `listen`; a trigger that removes the clip outside any live command.
