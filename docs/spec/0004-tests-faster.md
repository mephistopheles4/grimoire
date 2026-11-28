# Tests: fewer process starts and copies, no fixed sleeps

Status: Draft — in force when the owner merges it.

Tier: Standard, non-sensitive route. Test files only, plus one optional
helper in `tests/`. No shipped file changes, so no version bump.

## S1. Objective and driver

The suite spends most of its time starting Node processes, copying files and
sleeping, not testing. Cut that cost while every claim keeps a test that can
still fail.

The two numbers that matter are the wall time of `athanor run check` and of
`athanor run fast`. Test files already run side by side, so a tier's wall
time is set by its slowest files and by how much CPU all of them use at once.
In a full run each file takes about twice as long as alone (#696).

**Driver.** `AGENTS.md` names no business driver, so open choices lean to what
is cheaper to reverse: change tests, never shipped code, and build an item
only where the baseline (S3) shows its cost.

## S2. Where the time goes now

Measured on `main` `22dcdd0b` in athanor, each file alone (S3 method):

| File | Alone, s | Issue item | In this spec |
| --- | --- | --- | --- |
| `groundtrack-render.test.mjs` | 18.6 | 4 | no (S7) |
| `check-skill-files.test.mjs` | 17.7 | 1, 2 | S8 |
| `practice.test.mjs` | 16.4 | 3 | no (S10) |
| `incantation-listen-live.test.mjs` | 14.0 | 5 | S5, S6 |
| `check-format.test.mjs` | 13.8 | 1, 2 | S8 |
| `check-baseline-rules.test.mjs` | 13.4 | 1, 2 | S8 |
| `incantation-listen.test.mjs` | 11.9 | 5, 6 | S4, S5, S6 |
| `check-allowances.test.mjs` | 11.0 | 1, 2 | S8 |
| `check-plugins.test.mjs` | 10.9 | 1, 2 | S8 |
| `check-agent-guard.test.mjs` | 10.4 | 1, 2 | S8 |

71 files, all passing. The sum is 224.9 s: 119.2 s in the 17 check files,
105.7 s in the other 54. The builder records the two tier wall times (S3,
step 1) before the first edit; they were not taken when this spec was
written.

What changed since the issue was written:

- GRIM-77 T3 (#695) already put stand-in renderers in `tree()`, so issue item 1's
  four renderer starts per check run are gone. What is left of item 1 is
  the one `check.mjs` start per `assertFails` or `assertPasses`, 259 of them.
- GRIM-77 T4 (#696) split `incantation-listen.test.mjs` into
  `incantation-listen.test.mjs` and `incantation-listen-live.test.mjs`. The
  issue's line numbers for item 5 are stale; S6 gives the current ones.

## S3. How to measure

Measure in athanor, on a local Docker engine (CONTRIBUTING.md, "Run the check
in a container"), with `git fetch origin` first. Record each number before
the first change, on the base commit, and again on the final head. Run each
pair back to back on the same machine.

1. **Tier wall time:** `athanor run check` and `athanor run fast`, wall time
   from start to exit, three runs each, median reported.
2. **Each file alone:** in one athanor run, run every `tests/*.test.mjs` on
   its own and print its wall time in milliseconds, slowest first:

   ```sh
   athanor run -- sh -c 'for f in tests/*.test.mjs; do s=$(date +%s%N); node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "$f" >/dev/null 2>&1; rc=$?; e=$(date +%s%N); echo "$(( (e-s)/1000000 )) $rc $f"; done | sort -rn'
   ```

   Every line's second field must be `0`. The sum of the first field is the
   CPU proxy. S2's table is this step's result on the base; the builder
   takes it again on the base anyway, in the same session as the final one,
   so both come from one machine state: with a clean, committed tree,
   `git switch --detach 22dcdd0b`, measure, then `git switch -` back (never
   the shared stash, never a new worktree). For C4, also time
   `incantation-listen-live.test.mjs` alone three times on each side and
   report the median.

Time a run with the shell's `time` (or PowerShell's `Measure-Command`).
athanor runs tracked files only: stage a new file, or pass `--untracked`.
3. **Test counts:** the `# tests`, `# pass`, `# skip` lines of
   `athanor run check`. They match before and after.

If athanor exits 124, 125 or 137, follow `AGENTS.md`, say so in the pull
request, and leave that number out of the before-and-after tables: host
timings are not comparable with container timings. A sha512 mismatch in the
image build means stop and tell the owner.

## S4. Item 6: the listener test reads only its own temp folder

`tests/incantation-listen.test.mjs`, the test "no file under the fixture home
or the temp folder holds audio or heard text after a turn" (now at about
line 361), lists the shared `tmpdir()` before and after a turn and reads
every new entry. Other test files run alongside it and write there, so it
reads their files while they change.

Change: for the length of that one test, point the process's temp folder at a
fresh folder of its own. Set `TMPDIR`, `TEMP` and `TMP` to a new
`mkdtempSync` folder before `rig()` is called (its `makeHome` calls
`tmpdir()`). In `t.after`, put each variable
back as it was (its old value, or `delete` it when it was unset: assigning
`undefined` stores the string `"undefined"`), then remove the folder. `os.tmpdir()` reads these variables on each call,
and the listener's child processes inherit them, so any temp file the
listener made would land there (today it makes none). The test then walks
that folder whole instead of diffing the shared one.

- Tests inside one file run one after another (the file sets no
  `concurrency`), so the change does not leak into another test. Keep it so:
  the builder checks the file has no `concurrency` option before relying on
  it.
- The claim it backs stays the same: no file the listener leaves in its temp
  folder holds the marker or `RIFF`.
- **It must still be able to fail:** before the final commit, make the fake
  engine write the marker to a file under `tmpdir()` during the turn, and see
  the test fail; then undo that.

## S5. Item 5a: timers that outlive the race

`tests/incantation-listen-live.test.mjs` has four
`Promise.race([wait(r.home), tick(2000).then(() => 'never')])` calls (about
lines 482, 503, 511, 516). The loser's 2 s timer is never cleared, so the file
can stay alive up to 2 s after its last test. Replace each with a helper in
`tests/incantation-listen-fixture.mjs` that clears its timer when the race
settles:

```js
export async function within(promise, ms, late) {
  let timer;
  const limit = new Promise(r => { timer = setTimeout(() => r(late), ms); });
  try { return await Promise.race([promise, limit]); } finally { clearTimeout(timer); }
}
```

The same holds for the other `Promise.race(..., tick(n))` calls in the
listener files (`incantation-listen.test.mjs` about lines 41, 332 and 479):
they use the same helper. So does the live file's own race helper, `raced`
(about line 21, used about six times): it becomes
`const raced = (p, ms = 300) => within(p, ms, 'still waiting')`. Their limits
do not change, since each one proves that something has not happened yet.

## S6. Item 5b: wait for a state, not for a time

The listener files sleep about 97 times through `tick(n)`, and the biggest
are now `incantation-listen-live.test.mjs` at about lines 546 and 550 (400 ms
each) and lines 193 and 391 (250 ms). Most of these wait for something to
become true: a status file, a removed click file, a voice state.

Add one helper to `tests/incantation-listen-fixture.mjs`:

```js
// Polls `check` every 10 ms until it returns a truthy value, and returns it.
// `check` may be async; `until` awaits it. A throw counts as not yet. On
// reaching `ms` milliseconds it calls `check` once more, and only if that is
// falsy too does it fail with `what` and the last error, if there was one.
// `ms` has no default.
export async function until(check, what, ms) { ... }
```

Then, for each `tick(n)` with `n >= 100`:

- **A wait for presence** (the next line asserts that something now holds):
  replace the tick with `until` on the same condition, with `ms` set to the
  old tick's `n`, then keep the assertion. The limit keeps the test's timing
  claim: a state that had to hold by 400 ms still has to. Example, the click
  file test:
  `await until(() => voiceOf(r.home) === 'muted' && !existsSync(click), 'the mute-voice click is read and removed', 400)`.
- **A wait for absence** (the next lines assert that something has not
  happened): keep the tick. A shorter wait can only prove less. Mark it with
  a short comment, `// proves absence: keep the wait`, if it has none.
- **A wait that orders two steps** (a comment such as "the ten words are made
  after ready"): replace it with `until` on the state that marks the first step
  done, when the test can read one; otherwise keep it.

The same rule covers one group of shorter ticks, because most of the file's
sleep is there: the claim 4 test in `incantation-listen-live.test.mjs`
(about lines 101 to 118, "within 100 ms") waits `tick(70)` about 50 times in
a loop, about 3.5 s. Each becomes `until(…, 70)` on the state the loop then
asserts. Leave every other `tick()` under 100 ms as it is.

`tests/agent-check-guard.test.mjs` about line 280 stays as it is. Its 1.5 s
`limitMs` is the behaviour under test (a hang ends at its limit), the fake
has to start and write `pid.txt` inside it, and the file is not among the
slow ones in S2.

## S7. Item 4: the renderers stay in their own processes

Not built in this change. `tests/groundtrack-render.test.mjs` starts
`skills/groundtrack/scripts/render.mjs` about 62 times. The renderer exports
`check`, `findings`, `text` and `page`, but it also runs
`main(process.argv)` at the end of the file with no guard, on purpose ("Run
unconditionally, so no path can reach the silent case"). Importing it from a
test would run `main` with the test runner's arguments. `tests/render.test.mjs`
has the same problem with `skills/eagle-eye/render.mjs`, which exports
nothing. Either route changes a shipped skill, so both are in S10.

## S8. Items 1 and 2: the check tier

`tests/check-*.test.mjs` run 259 `assertFails` and `assertPasses` calls, each
one a start of the copy's `scripts/check.mjs`, on 273 trees from `tree()`.
`check.mjs` finds the root from its own path, so each case needs a copy, and
running it in-process is not possible without changing `check.mjs` (#695's
notes reached the same conclusion).

**8a. Measure the copy first.** In one `athanor run check`, wrap `tree()`
with a timer that sums its milliseconds and prints, in an `after`, that total
and the file's own wall time (`process.uptime()`). Compare the sum of the
totals over all check files with the sum of their wall times in that run.
Build 8b only if `tree()` takes more than 15 % of it. Remove the timer before
committing; both numbers go in the S8 commit message, or in the pull request
when 8b is not built.

**8b. Hard links into a private base, when 8a says so.** `tree()` makes one
full copy per test process into `work/base` on first call, then builds each
case with hard links from that base (`linkSync` per file, `mkdirSync` per
folder) instead of copies.

A hard link shares its contents, so a test that writes into a linked file in
place would change the base and every later case. The plan guards that two
ways:

- Every write into a case goes through one fixture helper that removes the
  link first (`unlinkSync`, then write). The fixture's existing helpers
  (`writeJson`, `modFile`, `setVersion`, `fixtureSkill`) use it, and so does
  `tree()`'s own stand-in renderer write (about line 70): the base holds the
  real renderers, and a case gets its stand-ins through the helper. The
  direct `writeFileSync`, `appendFileSync`, `copyFileSync` and `cpSync` calls
  in `tests/check-*.test.mjs` (about 140) move to it or to a sibling
  `appendTo(path, text)`. `rmSync`, `renameSync` and `symlinkSync` act on the
  folder entry, not the file contents, and stay. `chmodSync`, `utimesSync`
  and `truncateSync` act on the shared file: none is used today, and none may
  be used on a linked file.
- Hash every file of `work/base` against the same file in the repository
  root, in an `after` hook that runs before `work` is removed (fold it into
  the existing removal hook). Any difference fails the test file with the
  path, so a write that got past the helper is loud. A missing or empty
  `work/base` fails too, when `tree()` was called.
- Before building, check that no file `tree()` copies is a symbolic link. One
  that is gets copied, not linked.

The base is in the test's temp folder, never the repository, so a missed
write can damage only that run. On Windows, `linkSync` works inside one
volume; the base and the cases are both under `work`, so they share one.

**8c. Fewer starts.** Merging several cases into one `check.mjs` run is not in
this change: each case asserts on its own run, and a merged run can pass a
claim for the wrong reason. Listed for the owner in S10.

## S9. Acceptance claims

Each claim names how it is checked. "Before" and "after" mean S3's numbers on
the base commit and on the final head.

- **C1.** The listener test of S4 lists and reads only a temp folder it made
  itself, and fails when the listener leaves the marker in its temp folder.
  Checked by reading the diff and by the planted failure in S4.
- **C2.** No `Promise.race` against a timer in the listener files leaves the
  timer pending once the race settles. Checked by grep: no
  `Promise.race(` remains in `tests/incantation-listen*.mjs` outside
  `within`, and every `until(` call there passes its limit.
- **C3.** Every `tick(n)` with `n >= 100` left in the listener files carries a
  comment saying why it stays (absence or an order with no readable state).
- **C4.** `incantation-listen-live.test.mjs` alone is faster after than
  before, by at least 3 s.
- **C5.** If S8b is built: the fixture's `after` hash check exists, and a
  planted in-place `writeFileSync` on a linked file in one check test makes it
  fail with that file's path (checked once, then undone). `tree()`'s summed
  time falls.
- **C6.** Test counts in `athanor run check` are the same before and after.
  A duplicate test the builder finds is listed for the owner in the pull
  request, with both test names, and not removed.
- **C7.** `athanor run check` passes on the final head, and its wall time and
  `athanor run fast`'s, before and after, are in the pull request with the S3
  per-file tables.
- **C8.** The build changes no file outside `tests/`. This spec merges in
  its own pull request, before the build.
- **C9.** Neither tier is slower after than before (median of three runs
  each), and every file whose wait or limit was shortened or replaced passes
  three `athanor run fast` runs in a row on the final head.
- **C10.** What the issue lists as already fine stays so: test files run side
  by side, every test repo has a committer identity, no `.ts` is started as a
  process, and Windows short folder names are handled, including in S4's temp
  folder and S8b's base. Checked by the C7 run (Linux), the S12 step 7 run
  (macOS) and the owner's Windows host run in S13.

## S10. Out of scope, listed for the owner

These go in the pull request as notes. None is filed as an issue unless the
owner picks it.

- **The renderers in-process** (issue item 4; `tests/groundtrack-render.test.mjs`,
  about 62 starts, and `tests/render.test.mjs`, about 56): needs
  `main` guarded in `skills/groundtrack/scripts/render.mjs` and an export in
  `skills/eagle-eye/render.mjs`, shipped changes with a version bump.
- **`check.mjs` with its root passed in, or its rules as importable
  functions:** would remove most of the check tier's 259 starts and all of
  the copies. It changes the contract script.
- **Merging check cases into fewer runs** (S8c).
- **`tests/practice.test.mjs`** (issue item 3, 130 `cli()` runs, each starting
  `practice.mjs` and the fake program with a `--version` probe): its cases test
  the runner end to end as a process, and `practice.mjs` launches its program
  by design, so the fake has to be a process too. It is the third slowest file
  (16.4 s alone). The build leaves it unchanged and reports its time. Cutting
  it means fewer cases or fewer turns per case, a choice about what the tests
  cover.

## S11. Trade-off points

- **Speed against a test that can fail.** A shorter or removed wait, or a direct
  call in place of a process, can make a test pass for the wrong reason.
  Side taken: the test that can fail. Each change keeps its assertion, waits
  for presence are replaced only by a wait on the same condition, waits for
  absence stay, and S4 and S8b each prove a failure once.
- **Speed against shipped code.** The biggest remaining costs sit behind
  `check.mjs` and the two renderers. Side taken: no shipped change in this
  spec (driver: cheaper to reverse); both are listed in S10.
- **Copy cost against a shared-file hazard** (S8b). Side taken: build the
  hard links only on a measured cost, with a write helper and an `after` hash
  check.

## S12. Build order

One pull request, one commit per item. Each commit message carries the
item's before and after for its own file; the pull request carries the S3
tables.

1. Baseline (S3), on the base commit, before any edit.
2. S4 (item 6).
3. S5 (item 5a).
4. S6 (item 5b).
5. S8a; S8b if 8a says so.
6. Final measurements (S3) and the pull request.
7. Start the `incantation-platforms` workflow by hand (`workflow_dispatch`)
   on the pull request's branch, so the listener tests also run on macOS, and
   link the run in the pull request. Its `plumbing` job must be green on both
   macOS runners: a red `plumbing` job sends the work back to Build. A red
   `runtime` job (large downloads, not touched here) is reported, not fixed.

## S13. Environments, and what is the owner's

The changed tests must run on Linux (athanor and CI), macOS (the listener
files, through `incantation-platforms`) and the owner's Windows host. S4's
temp variables and S8b's hard links behave differently on Windows, and no
automated run covers it: the agent guard refuses a host test run from the
builder while athanor works.

The owner's steps:

- **Before the merge:** run `node scripts/check.mjs` on the Windows host on
  the pull request's head.
- **The merge itself.**
- **S10's notes:** pick which, if any, become issues.

Rollback: revert the pull request. It changes only `tests/`.
