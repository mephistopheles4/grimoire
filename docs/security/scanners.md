# The scanners, and what each one gates

Three scanners read this repository in CI: CodeQL reads the JavaScript,
SkillSpector reads the skill prose, and zizmor reads the workflows. A fourth
check is a schema check rather than a security scanner: Claude Code's plugin
validator reads the manifests and the skills. This page says what each covers,
what it suppresses, and why.
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

**The pin.** Commit `091a509b3d6ba8ff5be528966e1f43c2e68cf214`, which is the
`v2.13.0` tag in the `NVIDIA` repository: a final release, not a pre-release,
with no published advisory on 2026-10-17, the day it was pinned. The owner is
part of the pin, because a fork exists elsewhere. **Dependabot does not watch
this pin**: it reads `uses:` lines, and the scanner is installed from a `run:`
line. A bump is a reviewed pull request.

**The pin covers SkillSpector's own code only.** Fifteen of its dependencies
are version ranges, which resolve fresh on every run. That was as true of
2.11.0, and the [threat model](threat-model.md) carries it as residual risk.

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

The gate judges completeness from those counts, not from the report's
`is_complete` flag. The scanner marks a run `partial` whenever it meets a
relative link it did not follow, and this repository's Markdown is full of
them. Gating on the flag would fail every run for a reason that is not "the
scanner missed something". A `partial` run with clean counts passes, with its
status printed.

**Except a partial read someone has accepted.** Two reason codes can be
accepted, file by file, in
[`.skillspector-allowances.json`](../../.skillspector-allowances.json), and no
others:

- **`static_parse_limit`:** the shell-aware destructive-command parser
  (`static_patterns_tool_misuse`) followed a command past its fixed span and
  stopped. Only that one check stops; every other check reads the file in full.
- **`obfuscated_instruction_text`:** the declared-marker pass, which undoes
  "remove the marker from this text" tricks, could not settle a directive. It
  runs on top of the plain scan, so every check still reads the plain text in
  full. It does not undo a marker trick where it gave up.

Both name a deeper pass that gave up while the plain scan read everything. A
deadline overrun, a missing reference, a file not read at all, or any other
code stays red, so the allowance cannot drift into "accept any partial read".

Each entry is keyed by skill, file, reason code and the exact list of checks,
and carries a reason. The rules that hold it:

- **The counts must match.** The short component count and the partial-file
  count must each equal the number of accepted files.
- **An AE1 finding is accepted only on an accepted file.** AE1 says a file
  refers to one the scanner read in part. It passes only when its target is an
  accepted file, and the number of findings from that file to that target
  equals the entry's `count`. A change in the number of references from one
  file to an accepted file therefore goes red. One reference swapped for
  another keeps the count and passes; the new text is still read in full by
  every plain check, and review is the guard.
- **An unused entry fails.** An entry the scan did not need turns the gate red
  until it is removed.
- **A count that disagrees fails.** It stays red until the entry's `count`, or
  the reference that changed it, is fixed.
- **The counts are matched, not the file names.** The report counts partly read
  files but names them only through its exceptions, so the gate checks that the
  number of partly read files equals the number of accepted ones. A file the
  scanner counted as partial with no exception recorded would be matched by
  count alone. No such report has been seen.
- **Every entry pins its file's content.** The scanner records a give-up once
  per file, reason and check, with no count and no place, so a second give-up
  inside an accepted file is invisible to the gate. Each entry carries the
  file's SHA-256 (line endings normalised to LF), and `node scripts/check.mjs`
  fails when it no longer matches. Any edit to an accepted file therefore puts
  the allowance in the same diff, where review sees it. The failure says what
  to review by hand, and never prints a new hash to paste. To compute the new
  value after that review, run
  `node --input-type=module -e "import {contentHash} from './scripts/lib/skillspector-allowances.mjs'; import {readFileSync} from 'node:fs'; console.log(contentHash(readFileSync(process.argv[1])))" skills/<skill>/<file>`
  from the repository root. A plain `sha256sum` on a Windows checkout with CRLF
  line endings gives a different value.
- **Every entry added, removed or re-hashed is named.** `node scripts/check.mjs`
  lists each one against `main`, in its log and, in CI, on the run's summary
  page and as a warning on the pull request, so a re-hash is hard to miss.
- **A re-hash needs a new dated reason.** The check fails when an entry's hash
  differs from `main` and its `reason` gains no new "Re-read on <date>: ..."
  sentence. A change in spacing or in other words does not count. The sentence
  says what the review found, so each re-hash leaves a record of someone
  looking. A renamed file does not escape this: a new entry that carries the
  reason of a removed entry of the same skill, on a different hash, fails the
  same way.
- **A `static_parse_limit` entry also hides a marker-pass give-up inside
  `static_patterns_tool_misuse`.** When both passes give up inside that one
  check, the scanner reports only the parse code. The other twelve checks
  report their own marker give-ups, which need their own entry. The content
  pin is the guard.

The allowance lives at the repository root, not in each skill. The gate reads
it, not SkillSpector, so a copy inside an installed skill would do nothing for
someone scanning it, and an entry change would touch the skill. The cost is
that a reader who scans an installed skill with 2.13.0 sees the partial reads
with no shipped explanation. This page is that explanation.


### One scan per skill

Each skill is scanned on its own, with its own baseline. The repository root is
not scanned. A skill directory is what installs, and the rest of the tree is
CodeQL's, zizmor's, or prose no agent is given. The workflow lists the skills
from the tree on every run, so a new skill cannot go unscanned. One job named
`scan` passes only when every skill did. Each skill's result goes into the run
summary as a table.

The root scan was dropped under 2.11.0, because it stopped fitting inside the
scanner. 2.11.0 capped a whole scan at sixty seconds and one internal step at
five, and neither could be changed from outside. The root scan took about sixty
seconds on a runner, and under load the five-second step overran every time.
Either overrun marked a clean tree as partly read, and `main` went red on it
three times in a day. One skill scans in five to eight seconds.

2.11.1 raised the whole-scan deadline to 600 seconds and made it configurable
through `SKILLSPECTOR_MAX_WORKFLOW_SECONDS`. The root scan stays dropped for the
first reason above: a skill directory is what installs.

### Partial reads

Under 2.13.0 the scanner reads some files in `eagle-eye`, `groundtrack`,
`head-chef` and `contract` only in part, and the gate accepts each one by
name. In plain words, the two reasons are:

- **The command parser gave up** (`static_parse_limit`). A long expression ran
  past the span the destructive-command check follows. Every other check read
  the file.
- **The marker pass gave up** (`obfuscated_instruction_text`). A removal verb
  followed by a quote, such as the git command `worktree remove` in a code span,
  read as the start of a "remove the marker"
  directive the pass could not settle. The plain scan read the file.

[`.skillspector-allowances.json`](../../.skillspector-allowances.json) lists
each accepted file with its reason. The reasons live there and nowhere else, so
nothing here drifts from them.

### The baseline

Each suppression is keyed by **rule**, with a written reason. In
`eagle-eye`, `groundtrack`, `head-chef` and `contract` the skill's own entry is also
narrowed to the **file** it fires on, for a scan of the skill's own folder; the
root's entries stay rule-wide, for a scan of the whole repository.
[`.skillspector-baseline.yaml`](../../.skillspector-baseline.yaml) holds them:

| Rule | Name | Why it is suppressed |
| --- | --- | --- |
| `AR2` | Anti-Refusal Statement | `SKILL.md` warns that a preview pane may render the page without script, so do not judge it from one. It adds a caveat; it does not remove one. |
| `AS3` | Skill Enumeration | A `README.md` line naming this repository's own skills, the decision records quoting it, and `head-chef`'s contract naming its own `SKILL.md`. **Root only since 2026-10-17.** From 2.12.0 it no longer fires when a skill is scanned on its own, so `eagle-eye` and `head-chef` dropped their entries; it still fires in a scan of the whole repository, on those two skills' contracts among other files. **Narrowed to path mentions** with `message: "skills/*/SKILL.md"`: every hit in a whole-repository scan is the text of a skill's own file path, which is the finding text the scanner matches. A line that tells an agent to enumerate or read other installed skills, without naming such a path, is no longer suppressed. A line that does name one still is. |
| `EA2` | Autonomous Decision Making | Texts that describe what an agent may do on its own and give no such instruction: the `why` text on an edge in `eagle-eye`'s example box file, which the renderer prints for a reader; in `contract`, the labels, headings and comments in the format check, the bindings and the README that name the settings the check warns on because they let an agent act without asking; the step that lists unconfirmed drafts as *Proposed* without asking about each one; and `eagle-eye`'s rule that when the person asks for the box by name, it builds the box without asking again, because the request is the go-ahead; and `head-chef`'s cleanup, which runs its checks again without asking again once the owner's one yes covers the whole name-back list. On `contract` its five entries name the three bindings, the change log and `references/CONTRACT.md`; `SKILL.md` and the template that seeds every file it generates are named by none. The owner accepted the whole-skill breadth on 2026-09-27 and narrowed it to those files on 2026-10-18; see below the table. On `head-chef` its two entries name `SKILL.md` and `references/CONTRACT.md`, added on 2026-10-21. |
| `EA3` | Scope Creep | The warranty disclaimer of the SIL Open Font Licence, shipped beside `groundtrack`'s fonts, and the same text in `contract`'s `assets/OFL.txt`, beside the hiring page's fonts. A legal text we must carry verbatim. On `contract` its entry names that one file, accepted on 2026-10-18. |
| `MP3` | Memory Manipulation | A template comment describing how **Reset** discards a reader's overrides and **Undo** offers them back. |
| `RA2` | Session Persistence | The `CONTRIBUTING.md` rule forbidding a fixed path inside a skill, and the test proving it fires. **Accepted, not a false positive:** `eagle-eye`'s usage log, after a yes in chat, and `contract`'s bindings naming the folders where a person's agents live, where a built agent loads in later sessions; the skill asks before any write that would install. Also accepted: `contract`'s `README.md`, which tells a person the hiring page keeps their answers in the browser until Reset, unencrypted, the accepted risk of 2026-10-18. On `contract` its entries name `references/binding-codex.md` and `README.md`, each whole; added on 2026-10-15 for the whole skill, narrowed to the binding on 2026-10-18, and the `README.md` entry accepted the same day. |
| `RP1` | Unpinned MCP server | The `README.md` install command. `skills` is the Vercel Labs installer, not an MCP server. |
| `PE3` | Credential Access | The string `.env` in the edge audit's setup message, which tells a user a project `.env` is **not** read. |
| `E1` | External Transmission | **Accepted, not a false positive.** The edge audit posts a box's text to the provider after a yes. See [the edge audit](edge-audit.md). |
| `P2` | Hidden Instructions | A layout comment in `groundtrack`'s template. The rule matches *get* inside *together*. And `contract`'s part fences: a begin and an end comment line around each generated part of its `SKILL.md`, naming the part. **On `contract` it is off for the whole of `SKILL.md`**, so an instruction hidden there in a comment, a link-reference comment or a base64 data link would pass the scan; rule 2c refuses invisible characters. Added on 2026-10-15 for the whole skill, narrowed to `SKILL.md` on 2026-10-18. `head-chef`'s `SKILL.md` carries the same fences since 0.9.0, and **on `head-chef` it is off for the whole of `SKILL.md`** too; added on 2026-10-21. |
| `MP1` | Persistent Context Injection | A row of `contract`'s change log that records why the skill was rebuilt: every earlier review finding had become *a permanent rule*. Its entry names that one file, so it still fires anywhere else; added on 2026-10-15. |
| `TR2` | Shadow Command Trigger | `head-chef`'s description, where *run* and *start* are verbs about sessions and the one slash command is the skill's own, `/head-chef`. The rule reads a common command word beside a slash command as a skill taking over that command. The rule reads only a skill's frontmatter, so a file glob alone would narrow nothing. The entry also carries a `message` value with no wildcard: the clause exactly as the scanner quotes it, which for a long sentence is a window of up to 120 characters either side of the slash command. TR2 still fires on any other clause, in any skill, and on this one once any word inside that window changes, an addition included. Words outside the window are not read by TR2 at all, and the match ignores case. Added on 2026-10-17. |
| `LP3` | MCP Least Privilege | **Accepted.** No skill declares a permission list, because that is one host's format and the skills run in agents that read none. On `groundtrack` it fires only when every file is marked executable, as on a Windows drive seen through WSL; its entry names `SKILL.md`, where the rule lands in `eagle-eye`, and that was not measured on such a mount. On `contract` it fires on `SKILL.md`, because the skill ships scripts, and its entry names that file; accepted on 2026-10-18. |

**Narrower suppression for one skill.** A skill's entry may be narrower than the
root's, for a scan of that skill's folder, and never broader. `eagle-eye`,
`groundtrack`, `head-chef` and `contract` do it: each entry, except
`head-chef`'s `TR2` and `contract`'s `MP1`, names the one file its rule fired
on, as an exact path with no wildcard, measured with SkillSpector v2.13.0 on
2026-10-17, `contract`'s on 2026-10-18, and `head-chef`'s `P2` and `EA2` on 2026-10-21. `TR2` keeps the root's
`*SKILL.md` and exact clause, and `MP1` the root's `*contract.changelog.md`. The scanner matches the path ignoring letter case, so a finding
of the same rule in any other file is reported and fails the build. The
entries assume v2.13.0's matcher: a scanner that matches `file` against another
path form suppresses nothing, and reports the accepted findings too. An entry
that names a file and no message covers every finding of its rule anywhere in
that file. `eagle-eye`'s `AR2` and `PE3` also carry an exact `message`, the
words the scanner matched, so a finding of either rule that matches other words
in those files is reported too. A new line that uses the same words passes the
scan, and review holds it. The rule for what a skill
entry may add is in `scripts/check.mjs`, rule 7: where the root names no `file`
or `message`, the skill may name an exact one; where the root names one, the
skill names the same.

The root's entries stay rule-wide, for a scan of the whole repository, which is
what the plugin route installs. There, `E1` and `PE3` still hide a send or a
credential read in any file, the mod's included. The scan does not hold which
providers receive a box's text and the key: a test in `tests/audit.test.mjs`
holds the hosts written as URLs in `audit.mjs`'s source to two, all `https`,
and review holds the rest.

The `contract` skill's `EA2`, `P2` and `RA2` entries were whole-skill until
2026-10-18, when the owner narrowed them to the files they fire on (#343). An
entry that names a file covers all of that file. With `P2` off for `SKILL.md`,
an instruction hidden there in a comment, a link-reference comment or a base64
data link would pass the scan; rule 2c refuses invisible characters. With
`RA2` off for `references/binding-codex.md`, so would an instruction there to
persist on the person's machine: a scheduled job, a startup or profile file, a
background process or a hidden folder. `RA2` also covers all of its
`README.md`, and `EA3` all of `assets/OFL.txt`. Review holds those files.
`references/template.md`, which seeds every file the skill builds, is named by
no entry. A whole-skill entry also held for `head-chef`'s `AS3`, added in
#206, until it was dropped on 2026-10-17. `contract`'s `MP1` entry names the
one file it fires on, `contract.changelog.md`, and it still fires anywhere else. `TR2` is not shared either. It reads only a skill's frontmatter, so a file
glob would narrow nothing, and its entry also carries a `message` with no
wildcard: the one clause of `head-chef`'s description it is about, exactly as
the scanner quotes it, case aside. The breadth is written in the skill's
baseline header.

**The scanner has to honour `file`, and CI proves it.** A scanner that ignored
`file` would apply every entry to the whole folder again while the gate stayed
green. On every run the `scan` job copies `eagle-eye` with its edge audit
copied to `lib/audit.mjs`, scans the copy with `--use-shipped-baseline`, and
`scripts/skillspector-probe.mjs` requires the copy's `E1` to be reported and
the original's to stay suppressed. A scanner pin bump that stops honouring
`file` goes red there. It proves the installer's route, `--use-shipped-baseline`;
the gate loads the same file with `--baseline`.

**Two paths under `skills/` never differ only in case.** The scanner lower-cases
both sides when it matches a `file`, so a new file spelled in another case would
keep the old suppression. `node scripts/check.mjs` fails on any such pair.

**The check reads an entry the way the scanner's YAML loader does, or refuses
it.** `node scripts/check.mjs` reads each baseline with a small hand-written
reader, so it refuses the spellings the two would read differently: an entry
value that is not double-quoted (a bare value ends at a ` #` comment in YAML,
and a bare `~` or `null` reads as no value), a `rule_id` holding `*`, `?` or `[`
(the scanner reads it as a pattern), two rule ids that differ only in letter case
(the scanner ignores case, so they are one rule), and a `file` or `message` made only of
wildcard characters (it reads as narrowing and narrows nothing). The scanner
also tests a `message` glob against the rule's own fixed name, such as
`Skill Enumeration`, and ignores letter case. A glob that matches that name
suppresses every finding of the rule, and the check does not catch it, so a
reviewer reads each `message` glob against the rule's name.

**A shared reason is held to one wording.** A change to a reason the root shares
with a skill's baseline forces the same change there.

**Why by rule and not by fingerprint.** A fingerprint is tied to the exact text
and expires whenever the text or the scanner version changes. On prose that is
rewritten constantly, it would expire without telling anyone. A rule key
survives a rewording, but at the root it also suppresses that rule everywhere. The written
reasons are the price of that breadth.

**Nothing was reworded to satisfy a pattern matcher.** Two findings sit on a
security rule in `CONTRIBUTING.md` and on the test that proves it. Letting a
regex edit that prose is the trap.

**A new rule cannot appear quietly.** It fails the build, and costs one more
entry with a written reason. The gate prints the tally by rule on every run.

**There is one baseline file per scanned directory.** The scanner only finds a
baseline at the top of the directory it scans. So
[`skills/eagle-eye/.skillspector-baseline.yaml`](../../skills/eagle-eye/.skillspector-baseline.yaml),
[`skills/groundtrack/.skillspector-baseline.yaml`](../../skills/groundtrack/.skillspector-baseline.yaml),
[`skills/head-chef/.skillspector-baseline.yaml`](../../skills/head-chef/.skillspector-baseline.yaml)
and
[`skills/contract/.skillspector-baseline.yaml`](../../skills/contract/.skillspector-baseline.yaml)
repeat the rules that fire inside each skill. The root file is for a reader
scanning the whole repository. `node scripts/check.mjs` fails when a skill's
entry gives a different reason from the root's, or is broader than it in scope. A skill missing its
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

- It removes results and renumbers nothing, because the kept results point at
  the rule and artifact arrays by index. A rule with no result left stays in its
  place, with its descriptor text set to its id, because the scanner can fill a
  descriptor with the message of the first finding under the rule, suppressed or
  not. A rule that keeps a result gets the same for a descriptor that quotes a
  dropped result's message. Measured on v2.13.0 (2026-10-17): a static rule's
  descriptor is the rule's fixed name, which quotes no finding, and a rule whose
  message is the matched clause, such as `TR2`, quotes the first finding's clause.
- It never drops a result it cannot read. That result is kept and printed.
- A report it cannot parse fails the step.
- It uploads even when nothing is left, because an empty upload is what marks
  the last upload's alerts fixed.
- It also drops the AE1 results the allowance accepts, by the gate's own rules
  and from the SARIF alone. The workflow scans twice, once per format, and each
  scan draws fresh finding ids, so the step never joins the two reports. A
  result it cannot read, and every result of a pair the gate would refuse, is
  kept.

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

**The pin.** `zizmor==1.30.1` from PyPI. This is weaker than a commit pin.
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

## The plugin validator: the manifests and the skills

[`.github/workflows/plugin-validate.yml`](../../.github/workflows/plugin-validate.yml)
runs `claude plugin validate --strict` on every pull request and every push to
`main`. `scripts/check.mjs` checks the rules that span files, such as the two
manifests agreeing. The validator checks each file against the schema Claude
Code itself loads, and `--strict` fails on an unknown field the runtime would
ignore in silence. Neither replaces the other.

**Three runs, named one by one.** The job validates `.`, then
`.claude-plugin/plugin.json`, then `skills`. It records each exit status and
fails at the end, so one red target cannot hide the next. What one run covers
depends on the version: on 2.1.289, `.` read only the marketplace manifest. On
2.1.296 it also reads the plugin manifest and `hooks/hooks.json`, and still not
`skills/`.

**The exit code is the gate.** On 2.1.296 a missing path, a mistyped path, an
empty folder and a file that is not JSON all exit `1`, so no output is parsed.

### What it catches, and what it does not

Measured on 2.1.296:

- **It catches** an unknown field in either manifest, a `SKILL.md` whose
  frontmatter does not parse, and a manifest that is not valid JSON. The
  unknown field fails only under `--strict`: without the flag it is a warning
  and the run exits `0`.
- **It does not catch** an unknown key in a `SKILL.md`'s frontmatter, or a
  skill folder with no `SKILL.md` at all. `skills/` is a weak check. Both are
  `scripts/check.mjs`'s to catch, and it does: it refuses a missing
  `SKILL.md`, and a frontmatter key outside its allow-list.
- **It does not check a skill's name or description** against Anthropic's
  skill rules: it passes a name holding "claude" and a description holding an
  XML tag. It does reject a reserved **plugin** name.

### The pin

**`@anthropic-ai/claude-code-linux-x64@2.1.296`**, set on 2026-10-09, written three times in the
workflow: the package in the fetch step, the tarball's file name below it, and
the string `2.1.296 (Claude Code)` the version step compares against. That step
fails on any other output, so a missing binary or a wrong version fails before
the gate can read as clean.

**Fetched, not installed.** `npm pack` downloads the platform package's tarball
and `tar` unpacks it outside the checkout. The package holds one executable and
no scripts. Nothing runs an install, so no package script can run and no
`package.json` or lockfile is written. The wrapper package,
`@anthropic-ai/claude-code`, would need its postinstall script to put the binary
in place. zizmor's `adhoc-packages` audit flags `npm install` as an install
outside a lockfile, and a lockfile is the manifest this repository refuses.

**As strong as zizmor's pin, and no stronger.** npm never re-publishes a version
number, so this is close to a content pin and is not one. Checking the
tarball's sha512 against a hash in the workflow would make it one. That is
deferred until the job gains a token, a secret or a write permission, or a
registry incident touches this package. Row 9 of the
[threat model](threat-model.md) records the gap.

**Dependabot does not watch it**: the CLI arrives through a `run:` line. A bump
is a reviewed pull request.

### Bumping it

**When.** When a Claude Code release note mentions plugins, marketplaces,
skills or `plugin validate`, or three months after the last bump, whichever
comes first. Without a trigger the pin drifts behind the version people run,
and the check validates against a stale schema.

**How.**

1. Change the version in all three places in the workflow together, and the
   date beside the pin above.
2. Open the pull request, and let CI read the probes. The bump commit itself
   must pass all three targets. Then push a commit that adds an unknown field
   to `.claude-plugin/plugin.json`, and one that adds it to
   `.claude-plugin/marketplace.json`: `validate` must go red on each. Revert
   both, and it must go green. Put the run links in the pull request.
3. Run `claude plugin validate --strict .` at the new version and read which
   files it says it validated. If that list changed, say so in the pull
   request.
4. Re-measure the list under "What it catches", and update every `2.1.296` in
   this section and in the workflow's comments.

### Reproducing a red run

Run `claude plugin validate --strict <target>` on the target that failed, with
your own Claude Code. Compare `claude --version` with the pin first: another
version can disagree with CI.

## What is deliberately not installed

- **No dependencies.** The renderers import Node built-ins only, and the tests
  run on `node --test`. There is no dependency tree to poison, and nothing in
  the repository's own code to install. `scripts/check.mjs` fails on a
  `package.json` or a lockfile. The one package CI fetches is Claude Code, for
  the plugin validator, and only on the runner.
- **No Markdown linter.** markdownlint would report about forty long lines at
  its defaults. `scripts/check.mjs` checks one thing instead: every code fence
  names its language.
- **No actionlint.** It checks workflow syntax and shell, and that kind of error
  fails loudly when the workflow runs anyway. The finding that would matter, a
  `${{ }}` inside a `run:` block, does not occur in this tree. If one lands,
  reconsider.
