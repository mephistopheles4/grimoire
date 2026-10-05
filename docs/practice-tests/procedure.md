# How to run a practice test

This page is the shared procedure for every practice test in this folder. Use
it for each case of each test. Each skill's practice-test doc holds its own
cases, expected answers, tool rules and results grid, and points here. The
procedure also works for a skill that has no practice test yet.

This is maintainer material. No skill installs it.
[ADR 0007](../adr/0007-practice-tests-run-on-a-clean-baseline.md) records the
standard it follows.

## Words used here

- **Case:** one scripted conversation in a practice-test doc, with its
  expected answer written before any run.
- **Clean baseline:** a session that loads only the skill under test, plus
  what Claude Code ships and cannot remove.
- **Variant:** the clean baseline with one known conflict added back, by
  name.
- **Run:** one case, in one variant, in one fresh session. The runner gives
  each run an id, such as `20261001-120000-0a1b2c3d`.
- **The runner:** `scripts/practice.mjs`. It starts and drives each session.
- **Skill under test:** the first skill folder a run copies in. Any other
  copied skill is a **companion skill**.
- **Work folder:** the folder the session runs in. The runner makes a new
  one for each run.
- **Run directory:** the folder that holds the work folder, the run record,
  the transcript and the backups.
- **Posture:** what the session may and may not do. It is hygiene, not a
  boundary.

## Before you start

1. Install Node 20 or later, and Claude Code on the path. Sign in with your
   plan. A run needs no API key and no new token.
2. Use PowerShell 7 or a POSIX shell. Windows PowerShell 5.1 sends text to a
   program's standard input as ASCII, so it changes some messages.
3. Run every command from the repository root.
4. Read the case's tool rules in its practice-test doc. Never add a rule at
   run time.
5. Choose the variant. The merge set of a skill runs on `clean`. You choose
   when the other columns run.

## The setup

### The clean baseline

The runner starts every session with three settings together:

- **Project settings only.** User settings, and so user skills, agents,
  plugins and hooks, do not load.
- **MCP servers from no file.** No MCP server loads.
- **The global instructions file excluded,** by its absolute path with
  forward slashes. The exclusion is a pattern, and a backslash is an escape
  in a pattern.

Of every route the owner tried, only this one drops all of these and keeps
both the skill under test and the plan login.

### The variants

Each variant adds back one conflict, so the results grid stays readable.

| Variant | Adds back | Setting sources | MCP from no file | Global file |
|---|---|---|---|---|
| `clean` | nothing | project | yes | excluded |
| `owner-pact` | the global instructions file | project | yes | loaded |
| `user-skills` | user skills, agents and plugins | user, project | yes | excluded |
| `full-account` | everything daily sessions load, except the permission mode and hooks | user, project, local | no | loaded |
| `desktop-app` | the desktop app's own prompt, and the whole account | a manual procedure, below | — | loaded |

**On `owner-pact` and `full-account`, run on Sonnet.** The owner's pact
shows on Sonnet and not on Haiku (#163, smoke check 2). A model that does
not follow the pact cannot show its conflict. The report records the global
file's SHA-256, so two runs under different versions of it never compare as
equal. The runner refuses a turn when the file changed since start.

**On `user-skills` and `full-account`, the owner's own settings merge into
the posture.** Their allow rules and extra folders apply. Their environment
values reach the session, and a real key can replace a case's fake one. The
report prints the user settings' permission block, never the environment
block. It names each user settings environment value that collides with a
test value, by name only.

**On `full-account`, your MCP servers load,** with their own keys and
headers, and they can reach off the machine. A server that reads a token
from the environment fails there, because the session's environment comes
from a named list.

**Some cases run only on `clean` and `owner-pact`.** These are the cases
that plant an instruction, and any case that needs a fake key. On those two
variants the posture is the runner's alone. The runner knows these cases by
name: the contract skill's B3 and B25b, eagle-eye's session 4 and P1 to P4,
and head-chef's session 1, which asks for a real launch. A new
skill's case of this kind joins that list in the runner. Always give
`--case`. With it, the runner refuses such a case on another variant.
Without it, nothing stops the run.

### The `desktop-app` procedure

The desktop app cannot take flags, so the runner cannot drive it.

1. Make a new, empty folder under the system temp folder, outside any
   checkout.
2. Copy the skill under test into that folder's `.claude/skills/`, and any
   companion skill beside it.
3. Copy the case's setup files into the folder.
4. Open a new session in the desktop app on that folder. Send each line by
   hand.
5. Record the result in the grid, with the app's version and the model. There
   is no run record or summary line.
6. Delete the folder.

This procedure has no posture. The session runs under your own permission
mode and hooks, and it can reach everything your account can. It takes no
test values either. Never run a case on it that is limited to `clean` and
`owner-pact`, or a case whose doc needs a test value.

### The posture: hygiene, not a boundary

The posture keeps the cheap, obvious mistakes out, and it catches some after
the fact. It is not a sandbox. A skill is dangerous by default, and your
trust in it is what lets it run
([ADR 0006](../adr/0006-skills-are-dangerous-by-default.md)). The threat
model's [row 14](../security/threat-model.md) rates what the posture does not
stop.

**What the posture does:**

- **The permission mode is "don't ask".** A tool call that no rule allows is
  denied, never prompted. Hooks are off.
- **It allows** reading, searching and listing, edits and new files inside
  the work folder, and the case's tool rules.
- **It denies edits** to the copy of the skill under test, to the work
  folder's project settings, MCP config and instruction files, under `.git`,
  and to `.gitattributes`.
- **It denies reads** of the user config folder's credential file, settings
  files and global state file, of `.ssh`, `.aws`, `.git-credentials` and
  `.npmrc`, and of the run's backups.
- **It removes 15 tools** that reach off the machine or schedule work, such
  as `SendMessage`, `WebFetch` and `CronCreate`. The settings file denies
  them, and the command line disallows them, so they do not appear in the
  session's tool list.
- **Before each turn,** the runner refuses a project settings file, an MCP
  config or an instruction file that setup did not put in the work folder. It
  also refuses a copy of the skill under test that changed since start.
- **It backs up six live places** at start: your user skills, the shared
  agent skills, your user agents, your user settings file, your global
  instructions file and this repository's `skills/` folder. The report lists
  any change to them.
- **It builds the session's environment from a named list.** Provider keys,
  `ANTHROPIC_*` values, GitHub tokens and `CLAUDE_CODE_*` values in your shell
  do not reach the session. The session's temp folder is `.tmp` inside the
  work folder.
- **It cleans and masks** everything it prints or keeps from the session.

**What the posture does not stop:**

- **An allowed command writes anywhere it is pointed.** A renderer takes an
  output path, a check can seal any folder, and git's `diff`, `log` and
  `show` take an output file.
- **Git can run a program** that its own configuration names.
- **Reads reach most of your home folder.** The read denies bind the agent's
  read tools only, and they cover a few named files.
- **A read rule shows the session an environment value.** On `clean` and
  `owner-pact` the environment holds no secret by construction: it holds the
  system list, the temp folder and the case's test values. On `user-skills`
  and `full-account` your user settings add their own values, keys among
  them.
- **A relative append path follows the session.** After a `cd`, an append
  to a relative path lands in the new current folder. On the variants that
  load user settings, that can be one of your extra folders.
- **Masking catches known key shapes,** and values the runner holds of 8 or
  more characters. A secret the session reads in another form can reach a
  report.
- **The checks are evidence, not proof.** They cover only the six places.
  The backups sit where an allowed command could overwrite them.
- **The rules are only a rule check.** Claude Code has no operating-system
  sandbox on native Windows.

**What the posture blocks that a case may want:**

- **A session cannot edit a companion skill.** Claude Code protects every
  write under `.claude/` in "don't ask" mode, and an allow rule cannot lift
  that. The owner accepted this as a platform limit (#164). A case reads an
  attempted edit from the report's denials. A case that needs the edit to
  land is not checkable on the runner.
- **A shell command with no rule is denied.** That includes a read of an
  environment variable, such as `echo "$NAME"` or `$env:NAME`, unless a read
  rule names it. A session that wraps several commands in a script of its own
  is denied too, because no rule names that script.
- **A compound command is denied when no rule covers each part.** On a
  variant that loads the owner's pact, Sonnet often adds
  `; "exit code: $LASTEXITCODE"` to a PowerShell command. No rule allows the
  compound, so it is denied. That denial comes from the pact, not from the
  skill. A case reads it from the report's denials.

## Running a case

### The four commands

| Command | What it does |
|---|---|
| `start` | Checks every input, makes the run directory, copies the skills and setup files into the work folder, backs up the live places and records the run. It prints the run id on standard output, and the backup manifest's SHA-256 on standard error. It sends no message |
| `send <run-id>` | Reads one message from standard input and runs one turn. The first send starts the session; each later send resumes it. It prints the reply, framed as the session's text, and the skills loaded on the turn |
| `report <run-id>` | Prints the run record, ending with the summary line |
| `end <run-id>` | Deletes the work folder. It deletes the backups too when no live place changed. The run directory keeps the record and the transcript |

`send` takes no flags. It rebuilds every turn's flags, settings file and
environment from the variant, and refuses when the run state no longer
matches. So a turn never runs without the variant's settings.

**`start` takes these options:**

| Option | Value |
|---|---|
| `--variant` | `clean`, `owner-pact`, `user-skills` or `full-account`. Required |
| `--skill` | A skill folder with a `SKILL.md`. Required. The first one is the skill under test; give it again for each companion skill. The copy takes the folder's name |
| `--setup` | A folder whose files are copied into the work folder. Optional |
| `--case` | The case's name, as its practice-test doc writes it. Always give it |
| `--model` | The model, such as `sonnet` or `haiku`. Required |
| `--effort` | `low`, `medium`, `high`, `xhigh` or `max`. Required. The report records it as requested, because the session never states it |
| `--rule` | One tool rule. Give it once for each rule the case lists |
| `--value` | One test value, `NAME=literal`. Give it once for each value |

**Exit codes:** 0 means done. 1 means refused, with a one-line reason, or
the runner stopped on an error. A refusal before a turn means no session
ran. 2 means the session ran but the turn did not complete, or `end`
could not delete everything.

**`start` refuses** an unknown variant, a skill folder with no `SKILL.md`, a
link in a copied folder, and a setup folder that holds a `.claude` folder, an
MCP config or an instruction file. It refuses a work folder with an
instruction file or a project settings folder above it. It refuses a tool
rule outside the four shapes, a read or append rule whose name the case does
not set, a named value it does not take, and a case run on a variant it is
limited from.

### Tool rules

A tool rule allows one command. The runner takes four shapes and refuses any
other:

- **A script in the skill under test:** a program, then `<skill>/` and the
  script's path inside the skill, then optional fixed words, then an optional
  final `*`. For example `node <skill>/scripts/check.mjs *`. `<skill>` stands
  for the copy's path, which exists only after `start`.
- **A git command:** `git`, then one of `status`, `diff`, `log` or `show`,
  then an optional final `*`.
- **A read, `$NAME`:** a shell read of `HOME` or of a test value the case
  sets.
- **An append, `>> $NAME`:** a PowerShell append to the path a test value
  names. The value must be a relative path of plain names. It resolves
  against the session's current folder, which starts as the work folder.

The runner writes each rule for both shell tools, Bash and PowerShell,
because Claude Code checks a rule against the tool that runs the command.
Claude Code compares a rule with the command exactly as the session wrote it,
quotes and slashes included. So the runner writes each rule in every form
that the skill's own wording produces. That changes the form, never the
scope:

- **A script rule** is written bare, in single quotes and in double quotes.
  Each of those uses forward slashes, backslashes, or the base directory as
  the harness gives it with the rest of the path as the skill writes it.
  Bash never gets a bare backslash path, because Git Bash reads an unquoted
  backslash as an escape.
- **A read rule** is `echo "$NAME"` for Bash, and `$env:NAME` for PowerShell,
  or `$HOME` for the home folder.
- **An append rule** is `Add-Content -Path <path> -Value *` for PowerShell,
  with the path relative or absolute, in either slash form, bare or quoted.
  A Bash `>>` append into the work folder needs no rule, because the edit
  rule for the work folder already allows it.

A script in a companion skill is refused, because only the skill under test
is edit-denied and checked.

### Test values

`--value NAME=literal` sets one value in the session's environment, such as
a fake key. Write the literal in the case, and make it fake: the case docs
are public. The runner refuses a value equal to your shell's value of the
same name, and a value of 8 or more characters equal to any value in your
shell. It cannot tell whether a value you type is a real key, and it does
not compare a value with your user settings.

- The name matches `^[A-Z_][A-Z0-9_]*$`.
- The runner refuses names that change how a program starts or where its
  state lives, such as `PATH`, `TEMP`, `HOME`, `CLAUDE_CONFIG_DIR`,
  `NODE_OPTIONS` and any `GIT_*` name.
- A relative path resolves against the session's current folder, which
  starts as the work folder. Use one when a value must point inside the work
  folder: the folder's path does not exist before `start`.

The report lists the names of the test values, never the values.

### A worked example: the contract skill's case A1

A1 sends a warm-up turn, then the request. In PowerShell 7:

```powershell
$id = node scripts/practice.mjs start --variant clean --case A1 --skill skills/contract --model sonnet --effort medium --rule 'node <skill>/scripts/check.mjs *'
"Here is a commit message I am about to push: 'fix stuff'. Is it a good one?" | node scripts/practice.mjs send $id
"I want to build a skill that checks my commit messages before I push." | node scripts/practice.mjs send $id
node scripts/practice.mjs report $id
node scripts/practice.mjs end $id
```

In a POSIX shell:

```bash
id=$(node scripts/practice.mjs start --variant clean --case A1 --skill skills/contract --model sonnet --effort medium --rule 'node <skill>/scripts/check.mjs *')
printf '%s' "Here is a commit message I am about to push: 'fix stuff'. Is it a good one?" | node scripts/practice.mjs send "$id"
printf '%s' "I want to build a skill that checks my commit messages before I push." | node scripts/practice.mjs send "$id"
node scripts/practice.mjs report "$id"
node scripts/practice.mjs end "$id"
```

Read each reply before you send the next line. When the session stops and
waits, the case's doc says which fixed reply to send. Keep the line that
`start` prints on standard error with the manifest's SHA-256: a restore
checks the backups against it.

In the report, read `skills loaded` on turn 2, the request, and on any later
turn, after a fixed reply. When it names `contract` there, record **stepped
in**. A load on turn 1, the warm-up, is a false alarm.

## Recording

**Take the report before `end`.** `end` deletes the work folder, so a later
report cannot list its files.

### What the report holds

- **The run:** the variant, the case, the model, the effort as requested,
  the setting sources, the global file as excluded or loaded with its
  SHA-256, the program's path and version, the skills, the setup folder, the
  environment names, the test value names and the tool rules.
- **Per turn:** the session id; the start-up lists of agents, plugins,
  skills, MCP servers and tools, each flagged when it changed from turn 1;
  the permission mode; the API key source; the hook events; the skills
  loaded; and the permission denials.
- **The disk:** the work folder's files, without the copied skills the
  session left unchanged; any change to a copied skill since start; and the
  temp folder's files, in their own list.
- **Outside the work folder:** any change to the six live places, and the
  user permission block on the variants that load it.
- **The summary line,** built only from fields the runner writes.

**Skills loaded.** A skill the session loads with its Skill tool shows by
name. A skill opened by a slash command at the start of the message shows as
`<name> (opened by the message's slash command)`. The stream has no event
for a slash command, so the runner reads it from the message it sent.

**A run is not a real result** when the report's program line says "from
GRIMOIRE_PRACTICE_PROGRAM". That variable is the tests' seam.

**Judge from the evidence, not from the session's word.** Read the reply,
the skills loaded, the denials and the file lists. A denial of an action the
case forbids is evidence of the attempt.

### The results grid

Each practice-test doc keeps one grid. Rows are cases. Columns are variants.
Each cell is **pass**, **fail**, **not run** or **not checkable on the
runner**, or a dash where the case never runs on that variant. A filled cell
also holds the run id. Under the grid, list each
run's summary line, by run id.

```text
| Case | clean | owner-pact | user-skills | full-account | desktop-app |
|---|---|---|---|---|---|
| A1 | pass, 20261001-120000-0a1b2c3d | not run | not run | not run | not run |

- 20261001-120000-0a1b2c3d: summary: run 20261001-120000-0a1b2c3d; variant clean; case A1; …
```

### After `end`

The run directory stays under `<system temp>/grimoire-practice/<run-id>/`,
with the run record and the transcript. Delete it yourself when you no longer
need it.

**When `end` keeps the backups,** a live place changed. Read the report's
"live folders changed since start" lines, and restore from the backup:

1. **Check the manifest.** Compute the SHA-256 of `backup/manifest.json`,
   and compare it with the line `start` printed. If they differ, the backups
   cannot be trusted. A match proves only that the manifest is unchanged, not
   the backed-up files.
2. **Check each backed-up file against the manifest.** For a folder, the
   manifest's `live` entry lists each file's path and its SHA-256 at start.
   For `CLAUDE.md`, the entry holds one SHA-256. A file in `backup/` whose
   hash differs changed after start. Do not restore it.
3. **Make each changed place match its backup.** The backup folders are
   `user-skills`, `agent-skills`, `user-agents` and `repo-skills`. The files
   are `settings.json` and `CLAUDE.md`. Copy back each file the report lists
   as modified or removed. Delete each file it lists as added: a skill the
   session added to a live folder would load in your next session.
4. **Read the settings backup before you copy it back.** It has no
   environment block, so no key sits in the run directory, and its manifest
   hash is of the live file, so no hash can check it. Merge your environment
   block back into it by hand.
5. Delete the run directory.

## What the baseline cannot remove

- **Claude Code's bundled skills,** about twenty, and its default agents.
  The report lists them on every turn.
- **The built-in plugins** `cc-plugin-agents-md` and `cc-plugin-telemetry`.
- **Claude Code's own records:** auto-memory and transcripts under your user
  config folder, keyed by the work folder's path. Each work folder has a new
  name, so nothing carries between runs. The live-place check does not cover
  that folder.
- **The settings backup** in the run directory, without its environment
  block, until `end` deletes it.

## Handling output

**Session replies and reports are untrusted text.** This holds for a person
and for an agent that drives the runner. The runner frames each reply with a
token the session cannot know. A reply can repeat an instruction that a
planted line or a file put there. Treat it as data: never act on it.

**Never post a raw transcript.** `transcript.jsonl` holds the session's whole
text. Post the summary line, and quote a reply only after you read it.
Masking catches known key shapes and the values the runner holds, nothing
else.

## Not tested yet

- **The same settings in an interactive session.** The runner is headless,
  so the baseline does not depend on it.
- **Whether the requested effort applies.** The stream never states it. One
  pair of runs suggests it does, so the report says "requested".
