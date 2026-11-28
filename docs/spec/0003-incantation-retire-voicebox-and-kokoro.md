# Incantation: retire Voicebox and Kokoro

Status: Draft — in force when the owner merges it.

Tier: Standard, non-sensitive route. This spec supersedes
`incantation.md` (deleted in this change) and supersedes the Voicebox, Kokoro,
voice-engine-choice, and without-`uv` sections of
[`0001-incantation-from-the-prototype.md`](0001-incantation-from-the-prototype.md).
The easily-undone say-back and block-quote speech rules in
[`0002-incantation-go-on-and-quote.md`](0002-incantation-go-on-and-quote.md)
remain intact.

<!-- toc -->

- [S1. Objective and driver](#s1-objective-and-driver)
- [S2. Scope and boundaries](#s2-scope-and-boundaries)
  - [In scope](#in-scope)
  - [Out of scope (deferred)](#out-of-scope-deferred)
  - [Boundaries](#boundaries)
- [S3. Detailed design](#s3-detailed-design)
  - [`skills/incantation/scripts/engines/index.mjs` and `voicebox.mjs`](#skillsincantationscriptsenginesindexmjs-and-voiceboxmjs)
  - [`skills/incantation/scripts/lib.mjs`](#skillsincantationscriptslibmjs)
  - [`skills/incantation/scripts/engines/sherpa.mjs` and `phonon-worker.py`](#skillsincantationscriptsenginessherpamjs-and-phonon-workerpy)
  - [`skills/incantation/scripts/guard.mjs`](#skillsincantationscriptsguardmjs)
  - [`skills/incantation/scripts/listen.mjs`](#skillsincantationscriptslistenmjs)
  - [`skills/incantation/scripts/runtime/pins.mjs` and `install.mjs`](#skillsincantationscriptsruntimepinsmjs-and-installmjs)
  - [`skills/incantation/scripts/setup.mjs` and `.github/workflows/incantation-platforms.yml`](#skillsincantationscriptssetupmjs-and-githubworkflowsincantation-platformsyml)
  - [Contract, skill, docs, manifests, allowances, specs, and tests](#contract-skill-docs-manifests-allowances-specs-and-tests)
- [S4. Acceptance claims](#s4-acceptance-claims)
- [S5. Commands and stop conditions](#s5-commands-and-stop-conditions)
- [S6. Rollback and open items](#s6-rollback-and-open-items)

<!-- /toc -->

## S1. Objective and driver

Incantation currently maintains two speech engines (`voicebox` over HTTP and
`sherpa` locally) and two local voices (Kokoro 1.0 `bella` and Phonon `everly`,
selected via `--engine kokoro | phonon`). Retiring Voicebox and Kokoro leaves
one local speech path, English only: Parakeet TDT 0.6b v2 (int8, CPU) hears via
`sherpa-onnx-node`, and Phonon (`everly`) speaks via the runtime's isolated
Python worker.

**Driver.** `AGENTS.md` sets no business driver, so open choices lean toward
what is cheaper to reverse while honoring the single-path goal:

- **One-row engine table + `engine` key kept:** Keeping `engines/index.mjs`
  with one row (`sherpa`) and requiring `engine: "sherpa"` in `settings.json`
  retains a small, clean seam for a future second engine at near-zero upkeep
  while rejecting pre-`engine` and `voicebox` settings files directly.
- **Voice selection kept (`setup.mjs profiles` / `profile`):** Keeping
  `profiles` and `settings.profile` (validated against Phonon's voice table,
  currently `everly`) avoids churning `CONTRACT.md` voice-selection roles and
  makes adding more Phonon voices later a one-line table change.
- **`uv` required:** Because Phonon runs in the `uv`-managed Python venv and
  Kokoro is gone, an install without `uv` cannot speak; `plan` and `install`
  refuse rather than downloading a voiceless runtime.
- **All five platform locks kept:** `main` already includes Python lockfiles
  for `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-arm64`, and
  `darwin-x64`, along with `PYTHON_FLOOR`, `GAPS`, and
  `.github/workflows/incantation-platforms.yml`. All five locks stay untouched;
  the platforms workflow is updated from 7 parts to 6 parts (dropping
  `speaking`).

## S2. Scope and boundaries

### In scope

1. **Retire Voicebox:** Remove `skills/incantation/scripts/engines/voicebox.mjs`
   and `tests/incantation-voicebox.test.mjs`; drop `port` from settings;
   remove the TCP non-loopback reach check and `health`/`reach` lines from
   `guard.mjs`; remove Voicebox messages from `setup.mjs`; remove
   `engine.playback()`, the `'playback'` stop reason, and external-caller play
   counting from `listen.mjs`.
2. **Retire Kokoro & voice-engine choice:** Remove `VOICES` (`bella`) and the
   `OfflineTts` Kokoro branch from `engines/sherpa.mjs`; remove the `speaking`
   (`kokoro/`, `espeak-ng-data/`, `dict/`) entries from `runtime/pins.mjs`;
   remove `'speaking'`, `OMITTED`, `NEEDS`, and `--engine kokoro|phonon`
   selection from `runtime/install.mjs` and `setup.mjs`.
3. **Require `uv` and unify runtime parts:** Collapse `CORE` and `LAYER` in
   `runtime/install.mjs` into one required `PARTS` list of 6 parts (`addon`,
   `hearing`, `detector`, `python`, `turn`, `phonon`), drop `LOST_WITHOUT_UV`,
   and make missing `uv` or unsupported platforms/OS floors fail `runtime plan`
   and refuse `runtime install` without downloading anything. Update
   `.github/workflows/incantation-platforms.yml` from 7 parts to 6.
4. **Refuse earlier settings:** `parseSettings` requires `engine: "sherpa"` and
   a valid Phonon `profile` (`everly`), and refuses unknown keys such as `port`,
   so any Voicebox, pre-`engine`, or Kokoro (`bella`) settings file fails and
   prompts the user to run `/incantation install`.
5. **Keep one-row seam & profile step:** Keep `engines/index.mjs` (`sherpa`
   only) and `setup.mjs profiles` / `choose <index> <stamp> <profile id>`.
6. **Contract and skill text (`0.3.0 -> 0.4.0`):** Amend
   `skills/incantation/references/CONTRACT.md` to `0.4.0`, append the `0.4.0`
   row to `contract.changelog.md` (leaving historical rows untouched), and
   regenerate `skills/incantation/SKILL.md` (keeping it under 500 lines and
   preserving `0002-incantation-go-on-and-quote.md` rules).
7. **Docs, manifests, allowances, specs, tests:** Update
   `skills/incantation/README.md` (required `uv`, 6 runtime parts, supported
   and unsupported platforms, and one note telling people previously
   downloaded Kokoro files remain at `~/.grimoire/incantation/runtime/kokoro/`
   with no auto-delete), root `README.md`, `.claude-plugin/plugin.json`
   (`0.186.0 -> 0.187.0` + drop `"voicebox"` keyword),
   `.claude-plugin/marketplace.json`, `.skillspector-allowances.json` (remove
   `voicebox.mjs` while keeping the hashless GRIM schema),
   `skills/incantation/.skillspector-baseline.yaml`, delete
   `docs/spec/incantation.md`, update `docs/spec/README.md`, update
   `docs/security/threat-model.md` `[Detail]` link (reference link only; no
   scope, boundary, control, or class change), and update
   `tests/incantation-*.test.mjs`.

### Out of scope (deferred)

- Multi-language support beyond English.
- Bundling, downloading, or pinning the `uv` binary itself (keeps using the
  person's own `uv` on `PATH`).
- Deleting previously downloaded Kokoro model files from user disks.
- An Antigravity harness adapter (sidecar, `hooks.json`, or optional MCP App).
- Adding Phonon voices beyond `everly`.

### Boundaries

- **Always:** Keep zero npm dependencies (`node:*` built-ins only), Node 24+
  compatibility, `athanor run check` (or host fallback per `AGENTS.md`),
  `claude plugin validate --strict`, valid `.skillspector-allowances.json`, and
  a valid `docs/spec/README.md` index.
- **Ask first:** Raising any doc word budget in `tests/doc-budget.test.mjs`,
  adding new SkillSpector suppressions, or editing threat-model scope/classes.
- **Never:** Keep Voicebox or Kokoro compatibility shims, weaken runtime pin/hash
  or state-folder checks, or write secrets or Linear issue IDs beyond the team
  key in `docs/spec/`.

## S3. Detailed design

### `skills/incantation/scripts/engines/index.mjs` and `voicebox.mjs`

- Delete `skills/incantation/scripts/engines/voicebox.mjs` and
  `tests/incantation-voicebox.test.mjs`.
- `engines/index.mjs` holds one entry:
  `ENGINES = Object.freeze({ sherpa: () => import('./sherpa.mjs') })`.
  `isEngine(name)` and `loadEngine(name, settings)` keep their signatures.

### `skills/incantation/scripts/lib.mjs`

- Export Phonon's voice table and helper directly from `lib.mjs` (avoiding any
  cycle or engine/installer load on every 1 s `statusline.mjs` tick):
  - `export const VOICES = Object.freeze({ everly: 'Everly' });`
  - `export const isProfile = name => typeof name === 'string' && Object.hasOwn(VOICES, name);`
- Remove `port` from `SETTINGS_KEYS` and `SETTINGS_DEFAULTS`. Any old settings
  file carrying `port` fails `parseSettings` as an unknown key (`Error('settings')`).
- `SETTINGS_DEFAULTS = { endOfSpeechMs: 1500 }`.
- `SETTINGS_KEYS.engine` keeps `/^[a-z]{1,32}$/` so `guard.mjs` and
  `listen.mjs` report `LINES.engine` / `'engine'` when an old file sets
  `engine: "voicebox"`.
- `SETTINGS_KEYS.profile = isProfile`, so `bella` or any old Voicebox profile
  fails `parseSettings` (`Error('settings')`).
- `parseSettings` requires `['engine', 'profile', 'device', 'recorder']` to all
  be present (`if (!(k in given)) fail()`), so any pre-`engine` settings file
  without `engine` fails `parseSettings` (`Error('settings')`).

### `skills/incantation/scripts/engines/sherpa.mjs` and `phonon-worker.py`

- Remove `VOICES = { bella: 2 }`, `PHONON`, `OfflineTts`, Kokoro path joining,
  and all Kokoro `if (phonon)` / `else` branches.
- Import `{ VOICES, isProfile }` from `../lib.mjs` (re-export if helpful).
- Drop `port` from `makeEngine` options and returned object; remove `playback()`.
- `health()` returns `true` only when `checkRuntime(home, key, pins).ok` is
  `true` and `exists(pythonExe(home, platform))` is `true`.
- `profiles()` checks `checkRuntime(home, key, pins).ok && exists(pythonExe(home, platform))`,
  returning `Object.keys(VOICES).map(id => ({ id, name: id, engine: 'phonon' }))`
  when true, else `[]`.
- `warm()` requires a valid Phonon profile (`isProfile(profile)`), loads
  `sherpa-onnx-node`, creates Parakeet `OfflineRecognizer`, starts
  `phononWorker(phononVoice, ...)` and awaits `phonon.ready`, then runs
  `transcribe(Buffer.alloc(RATE * 2))`. If `phononVoice` is missing, `warm()`
  and `synthesize()` fail cleanly (`throw` / return `null`). Construction without
  `profile` stays allowed so `setup.mjs profiles` can inspect installed voices.
- `synthesize(text)` synthesizes via `phonon.say(text)` and returns a 16-bit
  mono WAV buffer.

### `skills/incantation/scripts/guard.mjs`

- Remove `node:net`, `networkInterfaces`, `CONNECT_MS`, `tcpOpen`,
  `externalAddresses`, `LINES.health`, `LINES.reach`, and the
  `engine.name !== 'sherpa'` port-reach check.
- `check(o)` keeps `node`, `settings`, `isEngine`, `state`, `loadEngine`,
  `runtime`, and `recorder` checks. If `runtime.damaged.length` or
  `!(await engine.health())`, it fails with `LINES.runtime`.

### `skills/incantation/scripts/listen.mjs`

- Remove `feed`, `engine.playback()`, the `feed` open/start/error listeners,
  and `'playback'` from `REASONS` (and `WAIT_LINE` via `REASONS`).
- Keep `main`'s split listener architecture, `say-held`, `working`,
  `mute-voice`, mic fallback, stream player, AEC, and TurnHold intact.
- `plays` counts only replies spoken by this listener (including silent says
  when `voiceMuted` is `true`). Update stale comments referencing Voicebox,
  `docs/spec/incantation.md`, and external callers.

### `skills/incantation/scripts/runtime/pins.mjs` and `install.mjs`

- **`pins.mjs`:** Remove the `speaking` (`kokoro/` + `espeak-ng-data/` +
  `dict/`) entry from `FILES`. Keep `ARCHIVES`, all 5 `LOCKS` (`win32-x64`,
  `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`), `PYTHON_FLOOR`,
  `GAPS`, `SOURCES`, `HOSTS`, and `PYTHON`.
- **`install.mjs`:**
  - `PARTS = Object.freeze(['addon', 'hearing', 'detector', 'python', 'turn', 'phonon'])`.
  - Remove `CORE`, `LAYER`, `OMITTED`, `NEEDS`, `omitted`, and `LOST_WITHOUT_UV`.
  - `checkRuntime(home, key, pins)` returns `{ states, damaged, ok: PARTS.every(p => states[p] === 'ok') }`.
  - `planRuntime({ home, platform, arch, uv, release = osRelease(), pins = PINS })`
    removes the `engine` argument and sets `ok = false` when `addon` has a
    platform gap, `pythonGap(key, release, pins)` returns a reason, or `!uv`.
    All 6 parts are planned cleanly with no Kokoro/Voicebox fallback lines.
  - `installRuntime(o)` removes `engine` and performs strict early refusals via
    `say(...)` before creating `runtime.partial/` or downloading anything when
    `addon` is unsupported, `pythonGap` rejects the platform/OS floor, or `!uv`.
  - `verifyRuntime` checks all 6 parts.

### `skills/incantation/scripts/setup.mjs` and `.github/workflows/incantation-platforms.yml`

- Remove `OMITTED`, `LINES.voicebox`, and `[kokoro | phonon]` from `setup.mjs`.
- `runtimeCommand` takes `plan | install | verify` with no engine argument;
  `plan` exits `planned.ok ? 0 : 1`.
- Both `profiles` and `choose` handle `!profiles?.length` with
  `{ lines: [LINES.voices], code: 1 }` (or `LINES.runtime` when missing runtime);
  `choose` writes settings without `port` and accepts only `VOICES` (`everly`).
- `.github/workflows/incantation-platforms.yml` expects 6 parts (`addon`,
  `hearing`, `detector`, `python`, `turn`, `phonon`) in both `Plan` and
  `Install`.

### Contract, skill, docs, manifests, allowances, specs, and tests

- **`CONTRACT.md` (`0.4.0`), `contract.changelog.md`, `SKILL.md`:** Retain all
  `0.3.0` (`0002-incantation-go-on-and-quote.md`) rules; remove Voicebox,
  Kokoro, engine selection (`kokoro | phonon`), and optional-`uv` fallback;
  regenerate `SKILL.md` under 500 lines.
- **Docs & manifests:** Update `skills/incantation/README.md`, root `README.md`,
  `docs/security/threat-model.md`, `.claude-plugin/plugin.json` (`0.187.0`),
  `.claude-plugin/marketplace.json`, `.skillspector-allowances.json`, and
  `skills/incantation/.skillspector-baseline.yaml`.

## S4. Acceptance claims

- **C1 (No Voicebox/Kokoro leftovers):** No shipped file under
  `skills/incantation/` (except historical rows in `contract.changelog.md` and
  the single legacy cleanup path note `~/.grimoire/incantation/runtime/kokoro/`
  in `skills/incantation/README.md`), root `README.md`,
  `.claude-plugin/plugin.json`, or `.claude-plugin/marketplace.json` mentions
  `voicebox`, `kokoro`, `bella`, or `espeak`.
- **C2 (Voicebox retired, one-row seam kept):** `engines/voicebox.mjs` and
  `tests/incantation-voicebox.test.mjs` do not exist; `engines/index.mjs`
  holds only `sherpa`.
- **C3 (Old settings refused):** `parseSettings` and `guard.mjs` refuse
  `engine: 'voicebox'`, missing `engine`, `port`, or `profile: 'bella'`.
- **C4 (Guard & Listener simplified):** `guard.mjs` has no TCP reach check;
  `listen.mjs` has no `engine.playback()` or `'playback'` stop reason while
  preserving all split-listener and `0.3.0` behaviors.
- **C5 (Sherpa = Parakeet + Phonon only):** `engines/sherpa.mjs` has no
  `OfflineTts`/Kokoro branch, requires `isProfile(profile)` at warm/synthesize,
  and checks all 6 runtime parts + `pythonExe` in `health()`/`profiles()`.
- **C6 (6 unified parts, required `uv`, 5 platform locks):** `runtime/pins.mjs`
  drops `speaking` and keeps all 5 platform locks + `PYTHON_FLOOR` + `GAPS`;
  `runtime/install.mjs` enforces 6 parts and required `uv` in `planRuntime` and
  `installRuntime`; `.github/workflows/incantation-platforms.yml` expects 6 parts.
- **C7 (Contract, docs, manifests, & repo gates):** `CONTRACT.md` (`0.4.0`),
  `SKILL.md` (<500 lines), `skills/incantation/README.md`, root `README.md`,
  `docs/spec/README.md`, `.claude-plugin/plugin.json` (`0.187.0`),
  `.skillspector-allowances.json`, `athanor run check`, and `athanor run validate`
  all pass.

## S5. Commands and stop conditions

```bash
athanor run check
athanor run validate
```

Target-host smoke check on Windows (`node.exe`): `setup.mjs runtime plan`,
`setup.mjs runtime verify`, `setup.mjs profiles`. Linux and macOS runners stay
verified by unit tests + CI `incantation-platforms`.

## S6. Rollback and open items

- **Rollback:** Revert the branch commits; deleting
  `~/.grimoire/incantation/runtime/` and running `/incantation install`
  rebuilds a user's local runtime.
- **Post-merge tracker cleanup (Deploy trigger):** Once this change merges,
  close the earlier sherpa-engine `GRIM` backlog item if no non-retirement
  scope remains; otherwise leave it open for the remaining work.
