# The scanners, and what each one gates

Three scanners read this repository in CI: CodeQL reads the JavaScript,
SkillSpector reads the skill prose, and zizmor reads the workflows. This page
says what each covers, what it suppresses, and why.
[`SECURITY.md`](../../SECURITY.md) is the summary.

One rule runs through all of them: **a check that reports and changes nothing
reads as a check that passed.** So each one either gates a merge or says
plainly that it does not.

## CodeQL

CodeQL runs in GitHub's default setup. Its JavaScript extractor also reads
`.html`, which matters here: each skill's page template holds most of the
project's script, including every `innerHTML` call and the `esc` function.

It is **not** a required check. A check that blocks on findings nobody has
triaged is one people learn to route around.

### Its first findings

The first scan raised two high alerts, both
`js/incomplete-multi-character-sanitization`, on one function copied into two
files. `strip` removed HTML tags from a label in a single pass.

- **The output never reaches HTML.** `strip` feeds a Markdown export, which
  lands in a `<textarea>` value and the clipboard, and a console line. Neither
  is an HTML sink.
- **A bypass is hard to build anyway.** `<[^>]+>` matches from the first `<` to
  the first `>`, so `<scr<script>ipt>` is consumed whole.
- **It was fixed regardless.** The safe form repeats the replacement until the
  string stops changing. `scripts/check.mjs` fails if the single-pass form
  returns.

CodeQL did not flag the `esc` function or the `innerHTML` calls. A clean scan
there is not evidence the escape is right. It only means the query set had
nothing to say.

## Action pins

**Every action is pinned to a commit SHA**, with a version comment beside it,
for example `actions/checkout@<sha> # v7.0.1`. Dependabot
([`.github/dependabot.yml`](../../.github/dependabot.yml)) updates the SHA and
the comment together each week.

Dependabot cannot tell you the comment was true to begin with. zizmor's
`ref-version-mismatch` can: it resolves each SHA at GitHub and fails when the
comment does not match. A pin says which code runs, not whether that code is
worth trusting.

## SkillSpector: the skill prose

A skill is prose an agent obeys, so the prose needs a scanner as much as the
code does. [SkillSpector](https://github.com/NVIDIA/SkillSpector) reads it, and
[`.github/workflows/skillspector.yml`](../../.github/workflows/skillspector.yml)
runs it on every pull request and every push to `main`.

**The pin.** Commit `b7241089d7ec15d8b30df980dacbb428214732b9`, which is
`v2.11.0` in the `NVIDIA` repository. The owner is part of the pin, because a
fork exists elsewhere. **Dependabot does not watch this pin**: it reads `uses:`
lines, and the scanner is installed from a `run:` line. A bump is a reviewed
pull request.

**Static analysis only.** The workflow runs `--no-llm`: patterns, AST and YARA,
with no model call, no API key and no secret. The semantic pass, which compares
a skill's behaviour against its stated purpose, needs a provider credential.
Nobody has decided to add one.

### The gate

**Any finding fails the build, at any severity.** The gate does not use the
scanner's exit code or its risk score. Both answer "should I install this whole
skill", against a fifty-point threshold. In triage, a planted instruction
override plus a credential read were both found and rated high, and the scanner
still exited `0`. So
[`scripts/skillspector-gate.mjs`](../../scripts/skillspector-gate.mjs) reads the
report's `issues` array instead.
[`tests/skillspector-gate.test.mjs`](../../tests/skillspector-gate.test.mjs)
drives it with hand-written reports, one per rule.

**A broken scan fails too.** The gate fails on a component left unscanned, a
file read partly or not at all, an exception while reading, an execution the
scanner does not call successful, or a status of `failed`. It prints each
exception's `reason_code` and `message`, so a red run says why.

It judges completeness from those counts, not from the report's `is_complete`
flag. The scanner marks a run `partial` whenever it meets a relative link it
did not follow, and this repository's Markdown is full of them. Gating on the
flag would fail every run for a reason that is not "the scanner missed
something". A `partial` run with clean counts passes, with its status printed.

### One scan per skill

Each skill is scanned on its own, with its own baseline. The repository root is
not scanned. A skill directory is what installs, and the rest of the tree is
CodeQL's, zizmor's, or prose no agent is given. The workflow lists the skills
from the tree on every run, so a new skill cannot go unscanned. One job named
`scan` passes only when every skill did. Each skill's result goes into the run
summary as a table.

The root scan was dropped because it stopped fitting inside the scanner.
SkillSpector caps a whole scan at sixty seconds and one internal step at five,
and neither can be changed from outside. The root scan took about sixty seconds
on a runner, and under load the five-second step overran every time. Either
overrun marks a clean tree as partly read, and `main` went red on it three times
in a day. One skill scans in five to eight seconds.

### The baseline

Each suppression is keyed by **rule**, with a written reason.
[`.skillspector-baseline.yaml`](../../.skillspector-baseline.yaml) holds them:

| Rule | Name | Why it is suppressed |
| --- | --- | --- |
| `AR2` | Anti-Refusal Statement | `SKILL.md` warns that a preview pane may render the page without script, so do not judge it from one. It adds a caveat; it does not remove one. |
| `AS3` | Skill Enumeration | A `README.md` line naming this repository's own skills, and the decision records quoting it. |
| `EA2` | Autonomous Decision Making | The `why` text on an edge in the example box file. It is content the renderer prints. |
| `EA3` | Scope Creep | The warranty disclaimer of the SIL Open Font Licence, shipped beside `groundtrack`'s fonts. A legal text we must carry verbatim. |
| `MP3` | Memory Manipulation | A template comment describing how **Reset** discards a reader's overrides and **Undo** offers them back. |
| `RA2` | Session Persistence | The `CONTRIBUTING.md` rule forbidding a fixed path inside a skill, and the test proving it fires. |
| `RP1` | Unpinned MCP server | The `README.md` install command. `skills` is the Vercel Labs installer, not an MCP server. |
| `PE3` | Credential Access | The string `.env` in the edge audit's setup message, which tells a user a project `.env` is **not** read. |
| `E1` | External Transmission | **Accepted, not a false positive.** The edge audit posts a box's text to the provider after a yes. See [the edge audit](edge-audit.md). |
| `P2` | Hidden Instructions | A layout comment in `groundtrack`'s template. The rule matches *get* inside *together*. |
| `LP3` | MCP Least Privilege | **Accepted.** Neither skill declares a permission list, because that is one host's format and the skills run in agents that read none. On `groundtrack` it fires only when every file is marked executable, as on a Windows drive seen through WSL. |

**Why by rule and not by fingerprint.** A fingerprint is tied to the exact text
and expires whenever the text or the scanner version changes. On prose that is
rewritten constantly, it would expire without telling anyone. A rule key
survives a rewording, but it also suppresses that rule everywhere. The written
reasons are the price of that breadth.

**Nothing was reworded to satisfy a pattern matcher.** Two findings sit on a
security rule in `CONTRIBUTING.md` and on the test that proves it. Letting a
regex edit that prose is the trap.

**A new rule cannot appear quietly.** It fails the build, and costs one more
entry with a written reason. The gate prints the tally by rule on every run.

**There is one baseline file per scanned directory.** The scanner only finds a
baseline at the top of the directory it scans. So
[`skills/eagle-eye/.skillspector-baseline.yaml`](../../skills/eagle-eye/.skillspector-baseline.yaml)
and
[`skills/groundtrack/.skillspector-baseline.yaml`](../../skills/groundtrack/.skillspector-baseline.yaml)
repeat the rules that fire inside each skill. The root file is for a reader
scanning the whole repository. `node scripts/check.mjs` fails when a skill's
entry differs from the root's in rule, words or scope. A skill missing its
baseline file goes red in the workflow.

**Scanning it yourself.** With no flags, the scanner reports the raw score and
says a baseline was shipped. `--use-shipped-baseline` applies it, and
`--show-suppressed` lists each suppression with its reason.

### The Security tab

GitHub code scanning ignores SARIF's `suppressions` property. When the full
report was uploaded, every baselined finding opened as an alert: twenty-three of
them, while every workflow run was green. A tab full of findings already
reasoned about is a tab nobody reads.

So [`scripts/skillspector-strip-suppressed.mjs`](../../scripts/skillspector-strip-suppressed.mjs)
drops suppressed results before upload, tested by
[`tests/skillspector-strip-suppressed.test.mjs`](../../tests/skillspector-strip-suppressed.test.mjs).

- It removes results and nothing else, because the kept results point at the
  rule and artifact arrays by index.
- It never drops a result it cannot read. That result is kept and printed.
- A report it cannot parse fails the step.
- It uploads even when nothing is left, because an empty upload is what marks
  the last upload's alerts fixed.

Each skill uploads under its own category, `skillspector/<skill>`, with the
skill's directory put back on each path. Renaming or removing a skill orphans
its category, and any alert still open there has to be closed by hand.

### CodeRabbit

CodeRabbit has run SkillSpector and zizmor on pull requests here, reporting
inside a review while its own check said `pass`. That run cannot be configured
or baselined and cannot fail anything, so nothing here relies on it.

## zizmor: the workflows

[`.github/workflows/zizmor.yml`](../../.github/workflows/zizmor.yml) audits
`.github/workflows/` on every pull request and every push to `main`.

**The pin.** `zizmor==1.30.0` from PyPI. This is weaker than a commit pin.
zizmor is Rust and ships as a prebuilt wheel; a git install needs a Rust
toolchain, and hash-pinning the wheel needs a requirements file, which is the
dependency manifest this repository refuses. PyPI never reuses a version
number, so it is close to a content pin. Dependabot does not watch it, so a bump
is a reviewed pull request.

**Why not the official action.** `zizmorcore/zizmor-action` defaults to the
latest version, uploads SARIF even on fork pull requests where the token is
read-only, and hides the scanner version in an action input Dependabot does not
watch.

### The gate

**Any finding fails the build, at any severity, at the default persona.** Here
the gate reads zizmor's exit code directly, because that code answers exactly
the question a pull request asks: one documented code per highest severity.
(SkillSpector needs a script only because its exit code answers a different
question.)

**A broken audit fails too.** There is no `|| true`. Exit `1` is an audit error,
`2` a bad argument, `3` a path with no workflow in it. The last is the shape of
a gate that quietly checks nothing.

**`--strict-collection` is on.** Without it, zizmor drops a workflow it cannot
parse with only a warning, audits the rest, and exits `0`. A file nobody
audited must not read as a file with nothing wrong.

**It runs online, with the job's own read-only token.** That is what makes
`ref-version-mismatch` work. `unpinned-uses` works offline too. The cost is a
dependency on the GitHub API: an outage fails the audit, visibly, and a re-run
fixes it.

### What it does not see

It reads `.github/workflows/` and nothing else. It does not see what a script
does once a `run:` step starts it, a repository setting, or whether a correctly
pinned action is trustworthy. Rooted at the repository, it would also read
`.github/dependabot.yml` and raise `dependabot-cooldown`, a policy nobody here
has adopted.

**There is no zizmor config and no `# zizmor: ignore` comment**, because there
is nothing to suppress. (`.github/workflows/zizmor.yml` is the workflow, not
the config file.) If a suppression is ever needed, it has a cost: zizmor has no
field for a reason, so `scripts/check.mjs` would have to grow a rule requiring
one, the way it already holds the SkillSpector baselines.

**When it arrived**, it found two `artipacked` and two `excessive-permissions`
findings, all fixed rather than suppressed. The checkouts in `check.yml` and
`pages.yml` set `persist-credentials: false`. In `pages.yml`, `pages: write`
and `id-token: write` moved from the workflow onto the `deploy` job, and the
`build` job keeps only `pages: read`.

**Stricter personas are not adopted.** `--persona=pedantic` adds twelve style
findings, and one asks for a behaviour change: a concurrency group cancels runs
in flight. That is a style decision nobody has taken.

## What is deliberately not installed

- **No dependencies.** The renderers import Node built-ins only, and the tests
  run on `node --test`. There is no dependency tree to poison, and no install
  step. `scripts/check.mjs` fails on a `package.json` or a lockfile.
- **No Markdown linter.** markdownlint would report about forty long lines at
  its defaults. `scripts/check.mjs` checks one thing instead: every code fence
  names its language.
- **No actionlint.** It checks workflow syntax and shell, and that kind of error
  fails loudly when the workflow runs anyway. The finding that would matter, a
  `${{ }}` inside a `run:` block, does not occur in this tree. If one lands,
  reconsider.
