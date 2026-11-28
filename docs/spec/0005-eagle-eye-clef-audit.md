# eagle-eye: a local Clef route for the edge audit

Status: Draft. It is in force when the owner merges it.

Tier: Standard, not the sensitive route. The security pair runs at Test,
because this change runs a script from the home folder and changes where the
audit's text goes (the lead's pick).

## S1. Objective and driver

Today `skills/eagle-eye/audit.mjs` can send a box only to a paid, hosted
provider. A machine that runs the pact's Clef tool already has a local
decision model with the same question types. This spec adds Clef as a second
route. A run on it costs nothing, and the box's text stays on the machine.

**Driver.** `AGENTS.md` names no business driver. So open choices lean to
what is cheaper to reverse: one opt-in route, one new environment variable,
and no change to the paid routes.

## S2. What exists

- `audit.mjs` picks a route from the key: `TYPESAFE_API_KEY`, then
  `OPENROUTER_API_KEY`. A run never falls back from one route to the other.
  `EAGLE_EYE_AUDIT_ENDPOINT` is a loopback-only override, for tests.
- Clef's caller contract (V1, the pact's `docs/clef.md`, "How a caller uses
  it"): `node ~/.pact/tools/clef.mjs ensure [--wait n]` starts the supervisor
  if none runs and prints one JSON line,
  `{"url":"http://127.0.0.1:<port>","state":"ready"}`. The other states are
  `starting`, `not-set-up` and `failed`. `POST <url>/v1/systemone` takes
  `{state, questions}`, with no token. It needs `Host: 127.0.0.1:<port>` and
  no `Origin` header. It answers with the bare map `{"<id>": {"noul": n}}`
  and names no model. Every server error is `502 {"error":"no-answer"}`.
  `ensure` never downloads anything.
- The throwaway prototype (on its own branch,
  never merged) ran an unchanged `audit.mjs` through a loopback bridge, on
  Clef-Flash with Vulkan: 9 requests, no external call. Two of its findings
  hold here. The answer needs an adapter (S5). On Windows, a supervisor that
  a separate, short agent command starts is ended with that command, so the
  audit must run `ensure` in its own process tree (S4).

## S3. Choosing the route

- A new environment variable, `EAGLE_EYE_AUDIT_PROVIDER`. The value `clef`
  (case and spaces ignored) selects the Clef route. When it is set, it wins
  over any key, and the keys are never read for the run. Any other value
  that is not empty is not a route: `--probe` prints `no`, `--provider`
  prints `none`, and a run exits 3 with a message that names the one
  accepted value.
- The Clef route is never chosen without that variable, even when a key is
  absent and Clef is running. A run never falls back between Clef and a paid
  route.
- `--probe` prints `yes` on the Clef route. It opens no connection and runs
  nothing, as today. `--provider` prints `Clef`.
- An unknown value exits 3 before the box is read, for a run and a dry run
  alike.
- The misplaced-key refusal (an OpenRouter key in `TYPESAFE_API_KEY`) still
  applies when no provider is selected. On the Clef route it does not apply,
  because no key is read.

## S4. Reaching Clef

- On the Clef route, after the box is read and only for a real run (never
  for `--probe`, `--provider` or `--dry-run`), `audit.mjs` runs
  `<node> <home>/.pact/tools/clef.mjs ensure --wait 60` with no shell.
  `<node>` is `process.execPath`, and `<home>` is `os.homedir()`. No
  flag, file or variable of the audit names another script; `HOME` and
  `USERPROFILE` still choose `<home>` (S9). The child's working folder is
  the caller's, so Clef's own check on a Claude home folder inside a project
  still judges it, and its refusal reads as "no answer". Its environment is
  this process's, minus `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY` and the two
  `EAGLE_EYE_AUDIT_*` variables, matched in any case: neither audit key
  reaches a script outside the skill folder. Its standard
  error is discarded.
- It reads the last line of standard output as JSON, whatever the child's
  exit code (`ensure` exits 3 for `not-set-up` and 4 for `failed`, with its
  JSON line printed). While the state is `starting`, it runs `ensure --wait
  60` again, three calls at most: Clef allows a start up to 180 seconds, and
  on Windows most agent runs start Clef cold. Only `state: "ready"` with a
  `url` goes on. The URL is checked on its parsed fields: protocol `http:`,
  host `127.0.0.1`, a port, path `/`, and no user, password, query or hash,
  or the run stops. `audit.mjs` holds no plain-http URL literal, in code or
  comments: its source test allows two https hosts only, and stays unchanged.
- The run exits 3 and sends nothing when the script is missing, when its
  output is not that JSON, or when the state is anything but `ready`. Each
  message names the state word only. It never prints the script's output,
  which can hold a local path; a `REFUSED` line reads as "no answer". For
  `not-set-up`, the message says that the person runs Clef's setup
  themselves, and that it downloads several GB (about 7 GB for Clef-Flash,
  22 GB for full Clef). With the reason `pin-changed`, it says to stop Clef
  first. The audit never runs setup.
- `audit.mjs` never runs `stop`. Another tool can share the supervisor, and
  the supervisor stops itself after 30 idle minutes. On Windows, a supervisor
  that the audit started ends when the agent's command ends, so the next run
  starts it again.
- `EAGLE_EYE_AUDIT_ENDPOINT` keeps its loopback check, run first, as today.
  On the Clef route the override is not used: the URL comes from `ensure`.

## S5. The request and the answer

- The request is `POST <url>/v1/systemone` with `Content-Type:
  application/json` and the body `{state, questions}`. The state and the
  eight questions are the same as on the paid routes. There is no `model`
  field and no `Authorization` header.
- One retry on a network error or a 5xx, as today. A `503` (`not-ready` or
  `stopping`) counts as a 5xx.
- The answer is checked, then mapped to the shape `scoresFrom` reads. It
  must be an object that holds exactly the eight pattern ids. Each value must
  be an object whose only key is `noul`, with a number from 0 to 1. Anything
  else is refused with exit 4, as a wrong shape is today. The mapped answer
  is `{model: "clef-local", answers: {<id>: {type: "noul", noul: n}}}`.
- The prompt cap: Clef takes a prompt of up to 8,192 tokens, which its page
  puts at about 30,000 characters of state. A longer one gets `502` twice and
  exits 4. The dry run warns about it (S6).
- The model name is fixed, because Clef names none. It covers Clef-Flash and
  full Clef alike. `reference/audit.md` says so, and says that the
  prototype's numbers are Clef-Flash's. The one-model rule
  (issue #104) still runs and cannot fail on this route. That is acceptable:
  one supervisor serves one model, and Clef's setup refuses to change the
  model while the supervisor runs.

## S6. What the person reads

- **The dry run** on the Clef route says: "A real run sends N requests to
  Clef, a model on this machine, at 127.0.0.1: A argued edges and C controls.
  Nothing leaves this machine, and no key is charged. It starts Clef if it is
  not running. That is about T input tokens, estimated at 3 characters a
  token. Nothing was sent." When the largest request holds more than 30,000
  characters of state, it adds that Clef refuses such a state, so a real run
  would fail with exit 4. The paid routes' text is unchanged.
- **The closing line** says "Sent N requests to Clef on this machine. No key
  was charged. Answered by clef-local."
- **The no-key message** (exit 3, the setup guide) gains one paragraph: on a
  machine with the pact's Clef tool set up, set
  `EAGLE_EYE_AUDIT_PROVIDER=clef` to run the audit on it, at no charge and
  with nothing sent off the machine.
- **The header comment** of `audit.mjs` documents the route, the variable
  and the exit-3 cases.

## S7. The skill's text

`SKILL.md` is generated from `CONTRACT.md`, so the contract changes first.
Prose names no provider, as today (ADR 0001): it says "a model provider" or
"a model on this machine". Only `audit.mjs` names Clef.

- `CONTRACT.md`, *Proposed* marks on each changed clause:
  - The audit stop's four facts become: it is available; what it sends and to
    whom; how many requests of what size; who pays, which is the person's key
    or, on a local route, nobody.
  - Question 5's tools line adds the optional local route, which runs a
    model already set up on the machine. Open question 6's row says that this
    route runs a script outside the skill folder.
  - Question 6 says the audit sends the box's text to a model provider, or,
    on a local route, to a model on the same machine. The confirmation stays
    for both routes.
  - `Version:` goes to 0.4.0.
  - The owner confirms the *Proposed* marks at PR review. Their words then
    replace the marks in the same PR, before the merge.
- `contract.changelog.md`: one 0.4.0 row. It says that the confirmation's
  wording changed for the local route and that the confirmation itself stays.
  This row is for the owner to read (the lead's pick).
- `SKILL.md`: the stop line, the "Actions beyond its own notes" paragraph and
  `contract-version`, regenerated from the contract.
- `reference/audit.md`: "What the audit is", the probe and the four facts say
  that a local route exists, sends nothing off the machine and charges no
  key. Its robustness is not measured (S9).
- `.claude-plugin/plugin.json`: a minor version bump, after `git fetch
  origin`.
- `SKILL.md` is brought to the contract by hand, in the lines named above,
  because this contract has no schedules part. `athanor run validate` checks
  it.

The security pages change in the same PR, because they name the controls
this change alters, and the threat model counts a weakened control as a
removed one:

- `SECURITY.md`, "What the edge audit sends": the local route, its one
  recipient (Clef on 127.0.0.1), no key, and the script it runs.
- `docs/security/edge-audit.md`: when it runs (a key, or the variable), who
  receives the text, and the script run outside the skill folder, with its
  fixed path and filtered environment.
- `docs/security/threat-model.md`: the audit's row and its boundaries name
  the local route and the home-folder script.
- `docs/security/checks.md` and `scanners.md`, where they describe the
  audit's recipients.
- The SkillSpector scan stays green. A new finding in `audit.mjs` gets a
  baseline entry that names `audit.mjs` exactly, with its `scanners.md` row,
  or the code changes.

## S8. Acceptance claims

Each claim has a test in `tests/audit.test.mjs`, run through athanor. The
tests use a fake `clef.mjs` in a temporary home folder (`HOME` and
`USERPROFILE`) and a fake loopback service. `runAudit` clears
`EAGLE_EYE_AUDIT_PROVIDER`, so a developer's shell never sends an existing
test to the real Clef. C11 is the one claim held on the real Clef.

- **C1.** With `EAGLE_EYE_AUDIT_PROVIDER=clef` and a fake Clef that is ready,
  a run ranks the box, exits 0, and sends every request to the URL that
  `ensure` printed.
- **C2.** On that route no request carries an `Authorization` or `Origin`
  header or a `model` field, even with both keys set. Its `Host` is
  `127.0.0.1:<port>`. The keys never appear in any output, and never in the
  environment the fake `clef.mjs` sees.
- **C3.** `--probe` prints `yes` and `--provider` prints `Clef` on that route,
  and neither runs the fake `clef.mjs`. An unknown value gives `no` and
  `none`, and a run or a dry run with it exits 3 and sends nothing.
- **C4.** `--dry-run` on that route prints the Clef wording, never runs the
  fake `clef.mjs`, and sends nothing.
- **C5.** The fake `clef.mjs` is run with exactly `ensure --wait 60`, from the
  caller's folder, and never with `stop`. While it prints `starting`, it is run
  again, three times at most: `starting`, `starting`, `ready` ranks.
- **C6.** Exit 3, nothing sent, and only the state word printed, for each of
  these: no `clef.mjs`; `not-set-up`; `failed`; `starting` three times; a
  `REFUSED` line; output that is not JSON; and a URL that is not a port on
  127.0.0.1 over plain http.
- **C7.** An answer that lacks a pattern, adds a key, or holds a number
  outside 0 to 1 gives exit 4 and no ranking.
- **C8.** The closing line names Clef and says no key was charged. The
  `--json` sidecar's `model` is `clef-local`.
- **C9.** With the variable unset, every existing test passes unchanged: the
  paid routes behave as before. That includes the test that allows only two
  https hosts in the source.
- **C10.** A Clef dry run warns when the largest request holds more than
  30,000 characters of state, and only then.
- **C11.** On a Windows machine where Clef is already set up, a real run on a
  kept decisions box exits 0, says "Answered by clef-local", and makes no
  connection off the machine. It is run once before the PR is marked ready,
  after a dry run. It downloads and sets up nothing. Its exit code and closing
  line go in the PR.

## S8a. Needs the owner

- The *Proposed* contract marks, at PR review (S7).
- The merge.
- C11 needs no yes from the owner. It is the builder's own check: it costs
  nothing, sends nothing off the machine, and uses a Clef that is already set
  up. It is logged as a checkpoint. If the owner wants it run only on their
  word, the next run waits for it.

**Rollback:** unset the variable, or revert the PR. **Stop:** if C11 cannot
reach `ready` in one session, park the PR as a draft and report to the owner.

## S9. Trade-offs

- **Cost and privacy against signal.** In the prototype, Clef-Flash separated
  less than the paid model. Controls scored 0.60 to 0.69 on "weakly
  connected", and four of five argued edges scored 0.45 to 0.51. Side taken:
  ship the route, and say in `reference/audit.md` that its robustness is not
  measured. Contract open question 5 already says that about the audit as a
  whole. Driver: cheaper to reverse. The route is opt-in and removable.
- **Explicit opt-in against convenience.** Auto-detecting a running Clef
  would save one variable, but it would change which model scores a box from
  one session to the next with nothing the person set. Side taken: explicit.
- **A script outside the skill folder.** The contract says that both scripts
  sit inside the skill folder, so the seal covers them. `clef.mjs` does not.
  Side taken: run it only from the pact's fixed install path, only on the
  opt-in route, with no shell. No variable of the audit's names its path.
  The home folder still comes from `HOME` or `USERPROFILE`, which a trusted
  project's settings can set, as they can for any node command. Reading the
  account record instead (as Clef does) would remove the tests' fake-home
  seam. Side taken: the docs say so, and the residual is the owner's call.
- **No time limit on the `ensure` child.** `ensure --wait 60` bounds itself,
  so a hang needs a broken `clef.mjs`. A kill timer guards a path that is not
  a security finding, so under the Hardening limit (0) it is an accepted-risk
  candidate for the owner, and it is not built.

## S10. Out of scope

- Any download, setup or stop of Clef.
- A cache of answers (issue #107).
- Calibrating Clef against boxes with known wrong edges (contract open
  question 5).
