# CI: fewer jobs on a pull request, rare platforms weekly

Status: Draft — in force when the owner merges it.

Tier: Standard. Not on the sensitive list (auth, crypto, data migrations), but
it narrows when a security scanner runs, so the security pair reads the spec
and the diff (S11).

## S1. Objective and driver

A pull request starts too many jobs. On an Incantation fix the count went from
18 (PR 675) to 22 (PR 679). Jobs past the account's limits queue, so grimoire
and pact pull requests opened together wait on each other.

Cut the jobs a pull request starts, and keep every bug class some job catches
today caught by a job that still runs: on the pull request, or on the weekly
run.

**Driver.** `AGENTS.md` names no business driver, so open choices lean to what
is cheaper to reverse. Every change here is a workflow edit that one revert
undoes, and no required status check changes its name.

## S2. The limits this work keeps

| Limit | Value | What it shapes here |
| --- | --- | --- |
| Concurrent jobs, whole account | 20 | the reason for the cut |
| Concurrent macOS jobs, whole account | 5 | Incantation keeps one Mac per pull request; the weekly run uses two |
| SkillSpector whole-scan deadline | 600 s since 2.11.1, `SKILLSPECTOR_MAX_WORKFLOW_SECONDS`; 60 s in 2.11.0 | one job per skill stays (S5). A single job scanning every skill hit the 60 s cap, and the owner asked to keep the split |
| `timeout-minutes` in the workflows | none set; GitHub's default is 360 min | folding plumbing into the runtime job adds a few minutes to a Mac job, far under it |
| Required status checks on `main` | `check`, `scan`, `audit`, `validate` | each keeps its job and its name |
| Intel Mac runners | GitHub is retiring them | Intel Mac moves to the weekly run |

## S3. What runs now

Per pull request, for an Incantation change that touches the runtime's pins:

| Workflow | Jobs | Required |
| --- | --- | --- |
| `incantation-platforms` | 6: `runtime` × 4 (macos-15, macos-15-intel, ubuntu-24.04, ubuntu-24.04-arm), `plumbing` × 2 (both Macs) | no |
| `skillspector` | 7: `list the skills`, one `scan skills/<name>` per skill (5), `scan` | `scan` |
| `plugin-validate` | 3: `validate`, `plugin-test` (Windows), `plugin-test-linux` | `validate` |
| `check` | 1 | `check` |
| `zizmor` | 1: `audit` | `audit` |
| CodeQL default setup | 4 checks: Analyze `actions`, `javascript-typescript`, `python`, and `CodeQL` | no |

That is 18 workflow jobs and 22 checks. The issue counted zizmor as two jobs;
it is one, `audit`. The second "scan" it saw is SkillSpector's `scan`.

## S4. Incantation: 6 jobs to 2 on a pull request

`.github/workflows/incantation-platforms.yml`:

1. **The plumbing steps move into `runtime`**, after its own steps, each with
   `if: ${{ !cancelled() && runner.os == 'macOS' }}`, so a runtime failure
   does not hide a plumbing result and the Linux jobs skip them. The
   `plumbing` job goes. The four steps (the listener's tests, `stopRecorder`,
   the ffmpeg install and the steady player) keep their names and commands.
   They now start after an install: `uv` is on the PATH and a runtime sits
   under the home folder. The listener's tests use their own homes, so this
   changes nothing they read.
2. **The matrix follows the event.** On `pull_request`: `macos-15` and
   `ubuntu-24.04`. On `schedule` and `workflow_dispatch`: all four.
3. **A weekly run:** `schedule`, once a week (Monday, 04:17 UTC). Its four
   jobs hold two Macs, under the five-Mac limit.
4. The pull-request `paths` filter stays as it is.
5. The header comment says what runs where and why, naming the limits it keeps.

What each bug class keeps:

| Bug class | Before | After |
| --- | --- | --- |
| Addon or wheels fail on Apple Silicon Mac; a silent voice there | PR | PR |
| Addon or wheels fail on Linux x64 | PR | PR |
| The same on Intel Mac or Linux ARM | PR | weekly, and by hand |
| Listener, recorder stop or player plumbing on Intel Mac | PR | weekly, and by hand |

## S5. SkillSpector: scan only the skills a change touched

`.github/workflows/skillspector.yml` keeps its three job kinds and their names:
`list the skills`, `scan skills/<name>`, `scan`.

1. **A new script, `scripts/skillspector-select.mjs`,** picks the skills to
   scan, and `tests/skillspector-select.test.mjs` covers it. The pick is a
   decision, and the repo keeps decisions out of shell where no test reaches
   (the comment above the gate step says so). Its pure part takes the event,
   the skills in the tree and the changed paths, and returns the skills to
   scan.
2. **Every skill is scanned** when any of these holds:
   - the event is `schedule` or `workflow_dispatch`;
   - the changed paths cannot be read (no base commit, a failed `git diff`);
   - a changed path is `.github/workflows/skillspector.yml`,
     `.skillspector-allowances.json`, a file under `scripts/` whose name
     starts `skillspector-`, a file under `scripts/lib/` whose name starts
     `skillspector-`, or a module those scripts import (today
     `scripts/lib/printable.mjs`). These are the scanner's pin, the
     allowances and the gate's code.
3. **Otherwise a skill is scanned when a changed path is inside its
   directory.** Its baseline sits there too, so a baseline change scans its
   skill. A change that touches no skill scans none. This holds because a
   skill's content is only the files under its directory, so the listing
   fails by name on any link under `skills/`: a linked skill folder, which
   the old listing followed, or a link inside a skill to content elsewhere.
   None exists today.
4. **The changed paths.** On `pull_request`, the checkout is the merge commit,
   so the paths are `git diff --name-only -z --no-renames HEAD^1 HEAD`. On
   `push`, the same diff from `<before>`, so a push of several commits or a
   merge commit is read whole. `-z` keeps a name git would quote as it is;
   `--no-renames` lists a moved file at the path it left too. A `before` that
   is not a commit id, is all zeros, or is not in the history falls back to
   every skill. The checkout's depth is
   `${{ github.event_name == 'pull_request' && 2 || 0 }}`: 0 is false in an
   expression, so it cannot come first.
5. **The listing keeps its guard:** no directory under `skills/` with a
   `SKILL.md` still fails by name. An empty pick is not an empty tree.
6. **`scan skills/<name>`** runs only when the pick is not empty
   (`if: needs.skills.outputs.count != '0'`), since a matrix with no rows is an
   error.
7. **`scan`** passes when the listing passed and either every scan passed, or
   the scans were skipped and the pick was empty. Anything else fails. The
   rule is `scanVerdict` in the same script, with tests, and the job runs it
   as `node scripts/skillspector-select.mjs verdict`.
8. **The baseline probe runs in every scan job.** It checks that the scanner
   honours a baseline entry's `file`, by scanning a copy of `eagle-eye`. It
   ran only in the `eagle-eye` row; with only touched skills scanned, that
   would skip it on most pull requests, while the scanner's unpinned
   dependencies can still drift. It takes seconds.
9. **A weekly run:** `schedule` (Monday, 04:47 UTC) and `workflow_dispatch`,
   both scanning every skill.
10. **SARIF uploads** on `push` and on `schedule`. A skill no push scanned keeps
   its last upload under its category, which is still its current state,
   because its directory did not change.

**The listing job stays a job.** The scan jobs' matrix is computed, so it
needs a job before it; a workflow-level path filter would leave the required
`scan` pending on a pull request it skipped. The listing cannot fold into the
first scan, because every scan is a row of the matrix it computes.

## S6. The mod's tests: run them when the mod can change

`plugin-test` (Windows) and `plugin-test-linux` stay two jobs. They cannot be
one: the junction case runs only on Windows, and the Linux job is the one that
runs the mod's paths as Linux spells them.

1. **Both move to a new workflow, `.github/workflows/plugin-test.yml`,** with
   the same job names and steps, and a `pull_request` `paths` filter:
   `brigade/**`, `.claude-plugin/**`, `hooks/**`,
   `.github/workflows/plugin-test.yml` and
   `.github/workflows/plugin-validate.yml`. It also runs on `push` to `main`
   with the same filter, and by hand.
2. **Neither job is a required check,** so a path filter cannot leave a
   required check pending.
3. `validate` stays in `plugin-validate.yml` and runs on every pull request.
4. **The Claude Code pin now lives in two workflow files.** The comment that
   lists the version strings moving together, `docs/security/scanners.md`'s
   bump steps and `CONTRIBUTING.md` name both files. The filter holds both
   files, so a bump made in only one still runs the mod's tests. Nothing
   checks that the two files carry the same version; that rule would be
   hardening, not built here. `tests/container/Dockerfile`'s comment still
   names `plugin-validate.yml` as the source of its Linux package, which stays
   true.

The brigade code imports nothing outside `brigade/`, so a change elsewhere
cannot break these tests.

## S7. The rest: unchanged

- `check`, `validate` and `audit` are required and run on every pull request.
  Each is one job already.
- **CodeQL default setup** is a repository setting no file can change. It runs
  three Analyze jobs per pull request. Dropping the `actions` language, which
  zizmor's `audit` already covers, would cut one; that is the owner's call
  (S12, Q2).

## S8. The weekly run's failure is visible

Each weekly run's state shows as a badge in the README's "Contributing"
section: `incantation-platforms` and `skillspector`, each through the
workflow's `badge.svg?event=schedule`. A failed weekly run turns its badge
red. GitHub also mails a failed scheduled run to whoever last changed its
`cron`. No token gains a write permission, and nothing posts to an issue.

**A limit on that.** GitHub turns off scheduled workflows in a public
repository after 60 days with no activity, and a badge then keeps its last
colour. This repository has commits most days. If it goes quiet, re-enable the
two workflows on the Actions tab, or start them by hand. A badge shows no
state until the first scheduled run after the merge.

## S9. Counts after

| Pull request | Workflow jobs before | after |
| --- | --- | --- |
| Incantation runtime change | 18 | 8: `runtime` × 2, `list the skills`, `scan skills/incantation`, `scan`, `check`, `validate`, `audit` |
| Incantation prose only | 12 | 6 |
| No skill, no mod, no runtime | 12 | 5 |
| A brigade change | 12 | 7 |
| This spec's own pull request | 18 | 14: all five scans run, since it changes `skillspector.yml`, and both mod tests, since it adds `plugin-test.yml` |

**The target is read as workflow jobs.** CodeQL's default setup adds its
three Analyze jobs and its `CodeQL` check to each row, so the owner, counting
checks as on PR 679, sees about 12 on an Incantation runtime change: 22 → 12.
Q2 would make it 11. Whether that meets "about 8" is the owner's call (Q4).

## S10. Acceptance claims

- **C1.** On a pull request, `incantation-platforms` runs two jobs, `runtime`
  on `macos-15` and on `ubuntu-24.04`, and the macOS one runs the four
  plumbing steps; the Linux one skips them.
- **C2.** A `workflow_dispatch` of `incantation-platforms` runs four `runtime`
  jobs, and both macOS ones run the four plumbing steps. The workflow has a weekly
  `schedule` that runs the same four.
- **C3.** `selectSkills` returns every skill for `schedule` and
  `workflow_dispatch`, for unreadable changed paths, and for a change to any
  scanner path in S5.2; otherwise the skills whose directory holds a changed
  path, and none when no skill is touched; a moved file picks the skill it
  left and a quoted name its own; a link under `skills/` fails the listing;
  and `scanVerdict` passes only as S5.7 says. Each case has a test that fails
  if the rule is broken.
- **C4.** On a pull request touching one skill, `skillspector` runs `list the
  skills`, one `scan skills/<name>` and `scan`; `scan` passes, and the row's
  log shows the baseline probe ran.
- **C5.** On a pull request touching no skill and no scanner path, the per-skill
  scan is skipped and `scan` passes; a failing or cancelled listing still makes
  `scan` fail.
- **C6.** `skillspector` has a weekly `schedule` and `workflow_dispatch`, each
  scanning every skill.
- **C7.** `plugin-test` and `plugin-test-linux` run from `plugin-test.yml`
  under S6's filter, with their names and steps unchanged, and not on a pull
  request outside it.
- **C8.** The required checks `check`, `scan`, `audit` and `validate` keep
  their names and run on every pull request.
- **C9.** zizmor's `audit` passes on the changed workflows, and `athanor run
  check` passes. zizmor runs only in CI, so the first lint of the workflows is
  on the pushed branch.
- **C10.** The README shows the two weekly badges, and the docs that describe
  these workflows (`docs/security/scanners.md`, `docs/security/checks.md`,
  `CONTRIBUTING.md`, `skills/incantation/README.md`'s platform table) match S4
  to S8.
- **C11.** A pull request touching only Incantation's runtime starts 8
  workflow jobs.

**How each is read.** The builder reads them before the pull request is marked
ready, except the last two lines below:

- C1, C7, C8 and C9: off this pull request's own runs.
- C2: a `workflow_dispatch` of `incantation-platforms` on the branch; `main`
  already has that trigger.
- C4 and C5: two draft pull requests whose base is this branch, so their diff
  is theirs alone. One adds a blank line to one skill's `README.md`, the other
  to `docs/layout.md`. The builder opens both, reads the runs, and closes them
  unmerged. C5's failure half is `scanVerdict`'s tests (C3).
- C3 and C10: the tests and the diff.
- C6: after the merge, the owner or the lead dispatches `skillspector` on
  `main` once, and reads the first Monday run of each workflow.
- C11: off the next Incantation pull request after the merge, counted by the
  session that opens it.

**Stop.** Revert this change if C1, C4 or C5 fails and the fix is not plain.
If the first weekly run is red on a platform alone, it is a finding about that
platform, not about this change. If GitHub removes `macos-15-intel`, drop it
from the matrix.

## S11. Trade-off points

- **Coverage against queue time.** Intel Mac and Linux ARM failures surface up
  to a week late. Taken: queue time, since the owner asked for it and GitHub
  is retiring Intel Macs. A pull request that needs them sooner runs the
  workflow by hand.
- **Scan breadth against job count.** A skill no change touched is not
  re-scanned on that pull request. A scanner, allowance or gate change scans
  every skill, and the weekly run catches a scanner rule that moved under an
  unchanged pin. Taken: job count. This narrows a security gate's timing, not
  its rule, which is why the security pair reads it.
- **Brigade tests per pull request against job count.** A change outside S6's
  paths skips the mod's tests. Taken: job count, since the mod imports
  nothing outside them.

## S12. Open questions for the owner

- **Q1.** Badges (S8) or an issue opened by the weekly run? Badges were taken
  because the tracker is Linear and no token here may write. Cheap to change.
- **Q2.** Drop `actions` from CodeQL's default setup languages (S7)? A
  repository setting; this change does not touch it. A yes removes a control
  the threat model names under "Code that runs"; zizmor's audits overlap
  CodeQL's Actions queries but are not the same set, so that line would change
  with it.
- **Q3.** SkillSpector now scans, on a pull request or a push, only the
  skills the change touched; every skill on scanner changes, by hand and
  weekly (S5). That weakens a control `docs/security/scanners.md` names ("on
  every pull request"), and the threat model counts a weakened control as the
  owner's decision. The owner's words approve the job count; this asks for a
  yes on the control. The rewrites of `docs/security/scanners.md` and
  `docs/security/checks.md` in this change are that control's narrowing, and
  a no reverts them with the rest. The mod's tests narrow the same way (S6);
  `scripts/check.mjs` rule 6b, required on every pull request, keeps the code
  the engine runs inside the filtered paths.
- **Q4.** Is about 12 checks, 8 of them workflow jobs, close enough to "about
  8" (S9)?

**A doc that disagrees with the ruleset.** `docs/security/threat-model.md`,
`SECURITY.md` and `docs/security/scanners.md` say `validate` is not a required
check; the ruleset on `main` requires it. That drift predates this change and
is not fixed here; it is noted for the owner.

## S13. Out of scope

Rewriting the tests themselves, CodeQL's setup, and any change to the
scanners' rules, pins or allowances.
