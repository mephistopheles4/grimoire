# PROTOTYPE (GRIM-64): Local Clef adapter bridge for eagle-eye edge audit

> **Throwaway, never merge.** Capture branch for [GRIM-64](https://linear.app/mephistopheles4/issue/GRIM-64/add-a-second-local-clef-adapter-for-eagle-eyes-paid-edge-audit).

## Question tested

Can `skills/eagle-eye/audit.mjs` run unchanged against the local pact Clef server (`/v1/systemone`) through a loopback adapter, and does `Clef-Flash` give useful signal on argued edges at `$0` with zero external calls?

## How to run

```bash
node prototypes/clef-audit-adapter/clef-audit.prototype.mjs <path-to-box.json> [--audit <path>] [--clef <path>] [--run <path>]
```

Defaults resolve `--audit` to `skills/eagle-eye/audit.mjs` relative to the repo root and `--clef` / `--run` to `~/.claude/pact/tools/clef.mjs` and `~/.claude/pact-clef/run.json` (overridable via `EAGLE_EYE_AUDIT_PATH`, `CLEF_TOOL_PATH`, `CLEF_RUN_PATH`).

## Findings

1. **Response envelope mismatch:** Local Clef (`/v1/systemone`) returns bare `{ "<id>": { "noul": n } }` (stripping `model`, `answers`, `type`, `confidence`, `usage`), whereas `skills/eagle-eye/audit.mjs` (`scoresFrom`) expects `{ model, answers: { "<id>": { type: "noul", noul: n } } }`. Wrapping Clef's response back into `{ model, answers }` allowed unmodified `audit.mjs` to score cleanly.
2. **Question schema fallback:** If Clef rejects `criteria` on `noul` questions (`400`/`502`), folding `criteria` entries into `instructions` recovers (direct forwarding succeeded in our test run).
3. **Windows Job Object constraint:** Starting `clef.mjs ensure` in a separate short-lived command lets Windows reap the detached supervisor before a second command runs. Calling `clef.mjs ensure --wait 45` inside the same process tree and calling `clef.mjs stop` on exit kept Clef alive for the entire audit.
4. **Local Vulkan run (`Clef-Flash-Q4_K_M`):** `9` local loopback requests, `$0`, `0` external network calls. Shuffled calibration controls scored `0.60–0.69` on `weakly connected` (threshold `0.60`). Across `5` argued edges in a real 6-row box, `1` edge was flagged (`weakly connected 0.66`, `insufficient 0.55`) and the other `4` scored `0.45–0.51` (unflagged).
