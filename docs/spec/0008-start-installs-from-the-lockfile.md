# The background start installs from the lockfile

Status: Draft — in force when the owner merges it.

Tier: Standard. Flagged sensitive by the planning session (not on the owner's
list): the start now runs a repository's package manager, and so its code,
with no permission prompt. The security pair reviews this spec and the diff.

<!-- toc -->

- [S1. Objective, driver and trade-offs](#s1-objective-driver-and-trade-offs)
- [S2. Where it runs](#s2-where-it-runs)
- [S3. The steps](#s3-the-steps)
- [S4. The answer](#s4-the-answer)
- [S5. Text that changes with it](#s5-text-that-changes-with-it)
- [S6. Claims](#s6-claims)
- [S7. Out of scope](#s7-out-of-scope)

<!-- /toc -->

## S1. Objective, driver and trade-offs

A member started by `start_background_session` in a repository with a
lockfile gets its packages installed, in locked mode, by the start itself.
Its first commit then passes the repository's hooks with no install step from
anyone. A failed install never stops the start.

Facts this rests on:

- `claude --bg -w <name>` makes the worktree, and Claude Code runs no hook
  after it makes one (a `WorktreeCreate` hook replaces creation).
- The harness refuses `claude --bg` in a folder the owner has not trusted
  (`docs/security/brigade.md`, the start's reliance on folder trust).
- The engine has no budget on a `tool.call` hook for a tool its own plugin
  registered (the engine's `HookBudget` typing); ADR 0014 M3 measured at
  least 180 s with no cut.
- The engine's `$.process.run` and `$.process.spawn` set `env` over the
  host's own environment and cannot remove a variable, and `$.env` cannot
  list one. A child can: the install runs through a fixed Node wrapper
  (S3.6) that hands the package manager only named variables.
- `$.process.spawn` kills its child when its loop ends, so the call's
  signal can stop the install.

**Driver.** `AGENTS.md` names no business driver, so open choices lean to
what is cheaper to reverse: when anything is in doubt, install nothing and
start as today.

**Trade-offs.**

- *Security against Functional suitability.* Installing before the start
  would hold packages ready before the member's first turn, as the request
  asks, but would run repository code before the folder-trust check. The
  install runs after a start that succeeded, so trust is checked first.
- *Security against Functional suitability, the residual.* Repository code
  runs with no prompt. It is the commit Claude Code based the worktree on (by default origin's default branch, as fetched),
  which the owner may not have read, plus the
  lockfile's packages. What runs includes at least: root and dependency
  install scripts as the repository's own settings allow, and, whatever
  those settings say, pnpm's `.pnpmfile.cjs`, Yarn's `yarnPath` and plugins,
  a `packageManager` version download, a program a settings file names (such
  as npm's `git`), and the version manager's own reads of the worktree (on
  the owner's host the programs are mise shims, which read the worktree's
  `mise.toml` or `.tool-versions` and may download the version it names).
  Code that runs can read any file the owner's account reads (credential
  files in the home folder included) and send it anywhere; the variable list
  limits only the environment. It sends: the dependency list, the address and
  user agent, user-level registry tokens, and the allow-listed variables
  (S3.6), which a repository's `.npmrc` or `.yarnrc.yml` can expand into a
  request header, to registries and hosts the repository's settings and
  lockfile name, and to git hosts, which also get any SSH agent identity. The
  kept variables include the proxy variables, which may carry a proxy
  password, and the account name. The plain-http guard (S3.5a) covers the
  settings files and the lockfile; a script can still use http. The node
  launcher is started outside the worktree (S3.6) but with the lead's whole
  environment; only the manager gets the list. Environment-level settings
  the owner keeps (for example `npm_config_ignore_scripts`, `MISE_PARANOID`)
  do not reach the manager. The worktree is the commit Claude Code based it
  on plus any untracked files present when the install starts, the member's
  included. Yarn 1's `.yarnrc` and `yarn-path`, and pnpm's
  `pnpm-workspace.yaml` settings, run or apply as well. Every other
  variable of the lead's environment is held back from the manager. This
  needs the owner's sign-off (S5).
- *Functional suitability, the overlap.* The member's first turn may begin
  while the install runs. A member that commits within the install's time
  meets today's hook failure, or runs its own install beside it. Claim 12
  records how long the install took.
- *Reliability against Performance.* The start's answer waits for the
  install: at worst 60 s for the start, 30 s of the clock for the worktree
  (plus the one git run in progress, 5 s) and 250 s for the install, under
  six minutes. The engine meters no budget on this
  tool's own body, and ADR 0014 measured 180 s with no cut; nothing has
  measured longer. Other starts do not wait: the install runs after the
  start's queue turn ends.

## S2. Where it runs

`startRun` (`brigade/register.tsx`) is unchanged up to the start run. When
the start's answer begins `Started`, `startBackground` leaves the start's
queue turn (`startTurn`) and then runs the install, so a second start does
not wait on it. The rules are pure, in `brigade/start.ts`:

`installAfterStart(ports, input, platform): Promise<string>`, returning the
S4 sentence, with `ports`:

| Port | What it is |
| --- | --- |
| `aborted()` | whether the call's signal has aborted |
| `stat(path)` | the mod's `statPath`: missing, failed, or found with kind, link and real path |
| `run(argv, init)` | `$.process.run` |
| `spawn(argv, init, capMs)` | `$.process.spawn`, its output pulled and dropped, ended at `capMs` or on the signal; resolves the exit code, or `undefined` when it was ended, could not start or threw |
| `sleep(ms)` | `$.clock.sleep` |
| `now()` | `$.clock.now` |
| `read(path)` | the text of a file, `$.fs.read` |
| `program(name)` | `programPath` for that name: `{ value }` or `{ why }` |

The ports are eight. `git` comes from `program('git')`. Nothing runs through a shell.

## S3. The steps

**S3.1 Not started.** When the start's answer does not begin `Started`,
nothing below runs.

**S3.2 Abandoned.** `aborted()` before S3.3 and again before S3.6: install
nothing, reason `abandoned`. During S3.6 the signal ends the spawn, which
kills the wrapper; the package manager, its child, has its own cap in the
wrapper and may run on until that cap.

**S3.3 The worktree is ready.** The worktree folder is
`worktreeFolder(folder, name, platform)`. Up to 30 s by `now()`, a check once
a second: ready when a stat finds a directory that is not a link and whose
real path is the same path (`samePath`), and `git -C <worktree> status
--porcelain --untracked-files=no` (5 s) exits 0 with output not cut and
empty. A git run that rejects is a check that failed, not a throw. Not ready
in 30 s: reason `worktree`.

**S3.4 The worktree's files.** A stat of each of `pnpm-lock.yaml`,
`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `.yarnrc.yml` and
`node_modules` in the worktree. A lockfile name counts only as a regular
file that is not a link; anything else there, or a failed stat, gives reason
`read`. Anything at `node_modules` (Claude Code may link one in from
`worktree.symlinkDirectories`) gives reason `modules`.

| Files | Answer |
| --- | --- |
| no lockfile | install nothing; `No install: no lockfile.` |
| lockfiles of more than one manager (`package-lock.json` and `npm-shrinkwrap.json` are one) | reason `several` |
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `package-lock.json` or `npm-shrinkwrap.json` | `npm ci --no-audit --no-fund` |
| `yarn.lock` with `.yarnrc.yml` | `yarn install --immutable` |
| `yarn.lock` alone | `yarn install --frozen-lockfile` |

`.yarnrc.yml` with no `yarn.lock` is no lockfile. The argv is the program
and those words, and nothing else. No flag turns scripts on or off, so the
repository's own settings (`.npmrc` `ignore-scripts`, pnpm's build allow
list) decide which scripts run (the lead's decision 123).

**S3.5a The plain-http guard.** Before any program is looked up, the
worktree's `.npmrc`, `.yarnrc`, `.yarnrc.yml` (each, when present, a
regular file that is not a link, or reason `read`) and the chosen manager's lockfile files are
read with `read(path)`, each capped at 20 MB (bigger counts as http). When
any spells `http://` literally, in any case, nothing is installed: reason `http`. A
read that fails gives reason `read`.

**S3.5 The programs** `node` and the manager are found by `program`, as
`git` and `claude` are: an absolute path from PATH, never inside the folder,
and on Windows an `.exe`, never a `.cmd` shim. Not found: reason `program`,
naming the manager, or `node` when node is the one missing. On the owner's
Windows host node, pnpm and npm are mise `.exe` shims, found; yarn is not on
PATH and answers `program`; an npm that comes only with the Node installer
is `npm.cmd` and answers `program`.

**S3.6 The install** spawns `[<node>, '-e', INSTALL_WRAPPER, <worktree>,
<manager>, ...words]` with `cwd` the folder of the node program (outside the
repository by S3.5, so a version manager's shim for node does not start in the
worktree), no input, and a 250 s cap.
`INSTALL_WRAPPER` is a fixed constant in `start.ts`. It builds the child's
environment from its own, keeping only these names, compared without case:
`PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `SYSTEMDRIVE`, `HOME`,
`USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`,
`PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `TEMP`, `TMP`, `TMPDIR`,
`USERNAME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `OS`, `NUMBER_OF_PROCESSORS`,
`PROCESSOR_ARCHITECTURE`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`,
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `MISE_DATA_DIR`, `MISE_CONFIG_DIR`,
`MISE_CACHE_DIR`, `MISE_STATE_DIR`. It adds six fixed words:
`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `YARN_ENABLE_TELEMETRY=0`,
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `npm_config_update_notifier=false` and
`npm_config_fund=false`. It runs the manager with Node's `spawnSync` in the worktree, no
shell, standard streams ignored, hidden on Windows, killed at 240 s, and
exits with its status, or 124 when it was killed or could not start. Exit 0
is installed. Anything else, an ended spawn included: reason `install`.
Nothing of the output is read or shown. A grandchild the manager started
may outlive the kill. A failed install may leave a package manager's log in
the worktree. A private registry that needs a variable not on the list
fails, reason `install`.

**S3.7 A throw** anywhere in S3.2 to S3.6 gives reason `install`; it never
turns a `Started` answer into `Not started`.

## S4. The answer

The `Started` answer gains one sentence before `Write its card`:

`Started <name>: job <id>. Folder: <folder>. Branch: <branch>. <sentence> Write its card with set_roster; the tool wrote none.`

| Case | Sentence |
| --- | --- |
| installed | `Installed: <command>.` with the S3.4 words, the program by name only |
| no lockfile | `No install: no lockfile.` |
| `abandoned` | `Not installed: the call was interrupted.` |
| `worktree` | `Not installed: the worktree was not ready in time.` |
| `read` | `Not installed: the lockfile could not be read.` |
| `modules` | `Not installed: the worktree already holds node_modules.` |
| `several` | `Not installed: more than one kind of lockfile.` |
| `program` | `Not installed: <program> was not found as a program.` |
| `http` | `Not installed: the repository names a plain http address.` |
| `install` | `Not installed: <command> failed, was stopped or ran past four minutes.` |

Every `Not installed` sentence is followed by
`The member starts without its packages.` No sentence quotes a path, an
error, or the run's output. `Not started` and every refusal are unchanged.

## S5. Text that changes with it

- `DESCRIPTION` in `brigade/start.ts`: after a start, a repository with one
  lockfile gets its packages installed in locked mode.
- The head-chef contract's `references/starting.md: Starting a session`
  schedule, steps 5 and 6, and its copy in `references/starting.md`: the
  answer's extra sentence, and that the start report says whether it
  installed. Raise the contract's `Version:` and add a changelog line.
- `docs/security/brigade.md`: the start's no-prompt row names the install,
  the wrapper and the S1 residual; the start's reads name the worktree stats
  and the `git status` run; the answer's row names the extra sentence; a
  data-flow row names the install's sends (S1), approved by the S5 sign-off.
- `docs/security/threat-model.md`, marked for the owner's words and not
  settled by this change: the install under the "Code that runs" and "Data
  off the machine" crossings and under third parties; and the open issue
  "package-manager settings files nothing reads" split, so `.npmrc`,
  `.yarnrc.yml` and `.pnpmfile.cjs` become "read and run by the start's
  install" and the rest stay as they are.
- `.claude-plugin/plugin.json`: bump `version`.
- `docs/spec/README.md`: this spec's line.

**Sign-off.** The owner accepts, in words, the S1 residual: the start runs
repository code with no prompt, from the commit Claude Code based the worktree on (by default origin's default branch) and the
lockfile's packages, with the S3.6 variables (the proxy variables and the
account name among them), with no limit on the files that code reads in the
owner's account or where it sends them, with the node launcher started
outside the worktree under the lead's whole environment, with the owner's
environment-level settings not reaching the manager, and on a worktree that
holds the member's untracked files; it sends what S1 lists to the hosts it
lists, and a script may use plain http. Until then this spec stays a draft and the PR stays
unmerged.

**Rollback.** Reverting the change and its plugin version restores today's
start. Worktrees it installed into keep their packages; the cleaner removes
them as before.

## S6. Claims

1. `installAfterStart` on a ready worktree holding `pnpm-lock.yaml` runs
   `git status` in it, then spawns `[node, '-e', INSTALL_WRAPPER, <worktree>, pnpm,
   'install', '--frozen-lockfile']` with `cwd` the node program's folder and a 250 s cap,
   and returns `Installed: pnpm install --frozen-lockfile.`
2. Each S3.4 row maps to exactly its argv, and no argv holds a script flag.
3. No lockfile: no spawn, and `No install: no lockfile.`
4. Each `Not installed` case of S4 returns its own sentence and the fixed
   tail, and none quotes a path, an error or the run's output.
5. `aborted()` true before S3.3 or before S3.6 spawns nothing, and the
   signal ends a running spawn.
6. A worktree that is a link, is a file, resolves elsewhere, or is not clean
   in 30 s of the clock (a git run that rejects included), and a worktree
   holding anything at `node_modules`, spawns nothing.
7. A throw in any port gives reason `install`.
8. `startAnswer` with a sentence gives the S4 text; without one, today's.
9. `INSTALL_WRAPPER`, run by Node with a stand-in manager, hands it the
   allow-listed variables and the six fixed words and no other variable (a
   test sets one secret-looking variable and checks it is absent), and exits
   with the manager's status, and runs the manager in the worktree while the
   wrapper itself starts outside it.
10. The order test in `tests/brigade-stop.test.mjs` holds the start run
    unchanged and the install after the queue turn.
11. The check passes in athanor.
12. After merge, on the owner's Windows host, the lead starts one member in
    the pnpm repository GRIM-34's ask came from; the answer says
    `Installed:`, the member's first commit passes its pre-commit hook, and
    GRIM-34 records how long the install took and what mise did.
13. On that host a start in a folder the owner has not trusted answers `Not
    started` and installs nothing.

Claims 1 to 9 are tested in `tests/brigade-start.test.mjs`, on the pure rules
with stand-in ports and, for 9, by running Node; claim 10 on the source; 12
and 13 by hand.

## S7. Out of scope

- An install that keeps a variable off the list: trigger, the owner names
  one, for example a private registry's token.
- bun and other managers, and a lockfile below the worktree's root.
- A Desktop start: Desktop makes its own worktrees.
- A record of what the install ran: an accepted-risk candidate (Hardening
  limit 0).
- Whether the member's rules treat an install as a stop: the owner's rules
  at configuration `562c20d60205` say "these rules add no stop of their own",
  so nothing is filed against the-pact. A member after `Not installed` is
  where it is today.
