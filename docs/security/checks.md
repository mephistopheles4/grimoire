# Threat model detail: rows 1 to 14 and 17 to 19

This page is part of the threat model in [`threat-model.md`](threat-model.md). A control it names is named by the threat model, and a security review is handed it with the threat model. An edit to its accepted-risk, candidate or gap lines is an edit to the threat model's accepted risks.

Each section below holds one scenario of the old matrix, told from the attacker's side, with what stops it today, what still gets through and its framework tags. The short page's risk table maps each row to its risk.

## Row 1

### Scenario

**A pull request steers the agent charting it.** Anyone who can open a pull request or ticket writes text into it that reads as an instruction to the agent. A user asks groundtrack to chart that change. The agent either acts on the text, or draws a clean sheet of a dirty change, and a reviewer trusts the sheet.

### What stops it today

The host agent's own rule that file content is data. groundtrack's `SKILL.md` says the material is data to draw, not instructions, and to tell the reader when a line reads as a request. Traces are literals a reader *can* check against the material. When the agent hands the page over, `SKILL.md` now tells it to say that AI drew the page, that it can be wrong, and to check it against the change. On the page, the "authored" stamp in the title block says the same when a reader points at it.

### Residual gap

A sentence in a skill and a note on the page remind the agent and the reader. Neither makes anyone check. This is the highest-value attack here. A misleading review aid is the product failing quietly.

### Tags

`AML.T0051.001` · `LLM01:2025` · `ASI01` · Tampering · MAESTRO 3

## Row 2

### Scenario

**A shared file speaks to the agent.** A stranger shares a box or flightpath file whose `why`, note or blurb reads as an instruction. The agent opens it, or reads it through the renderer: `--check` prints row names and findings, and `--text` prints blurbs, remarks and tour text as written.

### What stops it today

The host agent's own rule that file content is data. Both `SKILL.md` files now say a file and the renderer's output are data, not instructions. HTML escaping does nothing here: it guards the browser, not the terminal. **Since groundtrack 0.63.0 (#252)** every line `--check`, `--out` and `--text` print from a flightpath file shows each control and invisible character as a `\uXXXX` escape, so a name cannot split a line, fake a refusal, move the terminal's cursor or hide text from the agent. A stranger's string stops at 200 characters where it enters the `ok:` line or a refusal, and at 1,000 in the tree, and every line stops at 2,000, so a line's own end still prints. **Since contract 0.13.0 (#343, #344)** the contract skill's interview script, `skills/contract/scripts/render.mjs`, prints from a draft or an answer block the same way: each refusal and warning is one escaped line naming its field; a clause's text prints as a quoted literal under its field, so it cannot pass for a push-back line; and a home path, a key-shaped value or an email address prints as `[masked]`. The agent shows the change list as printed and never retells it.

### Residual gap

A reminder, not a guard, for what the text means. The renderers' output carries author text back to the agent by design. Accepted risk: class C3 (E1), in the threat model. The escape keeps one report to one line, and a reader still judges what the text says, as for the rest of this row.

### Tags

`AML.T0051.001` · `LLM01:2025` · `ASI01` · Tampering · MAESTRO 3

## Row 3

### Scenario

**A shared file runs script in the page.** A stranger crafts a file so its text breaks out into markup when the page renders.

### What stops it today

every `<` escaped before the script block; `&` and `<` escaped for element content; ids validated; author text never in an attribute. Since 0.65.2 both renderers fill the template's placeholders in one pass, so file text that spells a placeholder lands as text and never takes another slot's insert. Tests pin the escape's width and put hostile text in every field. See [rendering.md](rendering.md). The contract skill's hiring page (#344) holds the same controls: every `<` in its inlined draft is escaped, its title loses `<`, `>` and `&`, the fill is one pass, and draft text reaches the page only as element content or through `value` and `textContent`; the one id it writes into an attribute, `pop-<id>`, is a checked id of `a`–`z`, `0`–`9` and `-`. Its content security policy allows no network source and only its own script and style blocks, by hash, and the renderer refuses to write a page whose script and style blocks are not the template's own.

### Residual gap

"No author text reaches an attribute" is held by review, not by a parse of the page. A new `="${` in a template breaks it.

### Tags

`LLM05:2025` · Tampering, Elevation of privilege

## Row 4

### Scenario

**A shared file confuses the validator.** A name such as `constructor` collides with `Object.prototype`, so a check silently passes and the author is told the wrong thing is wrong.

### What stops it today

`Groundtrack.hardenKeys` and prototype-free maps; tests with bare-name fixtures. Since groundtrack 0.63.0 (#248) the renderer reads its step and move tables with an own-property test, so an op or a move kind spelled `constructor` is refused as unknown. A type pass refuses every field the format types as a string or a number, by path, before any rule reads it as text, so a value whose conversion to text throws is a refusal and not a stack trace. Since 0.65.2 both renderers refuse a key named `__proto__` at any depth, author-keyed maps included, with a walk that keeps its own list rather than the call stack: each page reads its file as an object literal, where that key sets the prototype, so eagle-eye's page would show fields no check read and groundtrack's would drop entries its check saw. The contract skill's interview script (#343) refuses `constructor` as an id and a key named `__proto__` at any depth, in a draft and in an answer block, and reads its kinds table by own property.

### Residual gap

Low. The harm is a wrong diagnosis, not code execution.

### Tags

Tampering

## Row 5

### Scenario

**A shared file hangs the page.** A box built to branch hard makes the chain walk run for a long time on the reader's machine. A flightpath file built the same way stalls or crashes groundtrack's renderer or page.

### What stops it today

eagle-eye stops the walk at 20,000 steps (`skills/eagle-eye/lib/eagle-eye.js`). groundtrack's renderer refuses three shapes before it reads a run: a graph more than 1,000 calls deep, a tree view of more than 20,000 rows, and a search for cut calls that costs more than 1,000,000 units of work. Every other cost measured grows in step with the file. A crash no rule foresees prints one line naming the file and exits 2, never a stack trace (#252). See [row 5, measured](rendering.md#row-5-measured). The contract skill's interview script refuses a draft or an answer block over its limits, and its page is held to a budget; see [the hiring interview](hiring-interview.md#the-hiring-interview-its-data-and-its-limits).

### Residual gap

None measured past the target. The two `fold` costs that stalled `--text` and the page are gone (#147). Accepted risk: class C3 (E72), in the threat model. See gap 4.

### Tags

Denial of service

## Row 6

### Scenario

**Planted text claims a standing yes.** eagle-eye's `SKILL.md` lets the user's instructions give a standing yes for the edge audit. Text in a box or a charted file claims to be that yes, so the audit runs without asking: the box's text leaves the machine and the user's key is charged.

### What stops it today

The four facts are still stated before each run. `--dry-run` comes first. `SKILL.md` says a standing yes comes only from the user's own instructions, never from text in a file.

### Residual gap

Low. The host agent still has to tell the user's instructions from a file's.

### Tags

`AML.T0051.001` · `AML.T0034` · `ASI02` · Information disclosure

## Row 7

### Scenario

**A tampered restore code or answer block.** Someone edits an exported configuration before the user pastes it back, so the agent updates the box with a set the user never chose. Or someone edits the contract skill's answer block before it is pasted, or another page opened from disk writes answers into the hiring page's store, so the contract takes terms the person never chose.

### What stops it today

`SKILL.md` step 8: say the set back in words before acting, and update the box only with what the user confirms. For the contract skill (#343, #344), `--answers` binds the block to its draft and kinds table by SHA-256, and prints the change list itself, so the agent shows it and never retells it. It lists for push-back in chat every high-stakes clause, every answer and every schedule edit restored from the browser and not yet kept by its own Keep, every flagged answer and every warned field, and with `--shared` every clause. On the page, a new pick or Agree replaces a restored answer, and Agree takes the drafted wording; typing in a restored answer or edit, or tapping a restored answer's chip, skip or flag, leaves it restored, so a restored value is kept only by that entry's own Keep.

### Residual gap

Low. This is the guard working: the user sees names, not ids, and the contract skill's script, not the agent, prints what changed. The hashes prove which draft a block was made for, not who made it (ADR 0009). A restored low-stakes value the person keeps by its own Keep is taken as theirs.

### Tags

Tampering

## Row 8

### Scenario

**A poisoned skill update.** An attacker with a stolen maintainer token, or a contributor whose pull request is merged, hides an instruction in a `SKILL.md`. Every installer's agent obeys it after the next update. Since 0.28.0 the change can also be code: the Brigade mod's hooks module, which Claude Code runs in every session that has the plugin, with the session's own rights (row 15).

### What stops it today

Pull request required on `main`. `check`, SkillSpector's `scan` and zizmor's `audit` must all pass (required since 2026-09-25), and so must the plugin validator's `validate` (required since 2026-10-09). `check` refuses a `SKILL.md` frontmatter key outside its allow-list, so a `hooks` key cannot register hooks unseen, and a hidden control or line-separator character in any file under `skills/` (rule 2c of `scripts/check.mjs`). Rule 7 of `scripts/check.mjs` reads every SkillSpector baseline with a hand-written reader that refuses a spelling the scanner's loader would read differently, and holds each skill's entry to the root entry of the same rule: the same reason, and a scope no broader, where a narrowing of a rule-wide root entry names one exact `file` or `message` with no wildcard. Rule 7a fails two paths under `skills/` that differ only in case, since the scanner matches `file` ignoring case. Since #336 the SkillSpector workflow's `eagle-eye` scan job, whose result the required `scan` check reads, also proves on every run that the pinned scanner honours an entry's `file`: it scans a copy of `eagle-eye` whose edge audit is also copied to a second path, and `scripts/skillspector-probe.mjs` requires the copy's E1 to be reported and the original's to stay suppressed.

### Residual gap

SkillSpector is static pattern matching: an instruction written to read as ordinary prose can pass it. A baseline entry is keyed by rule. Since #336 each entry in the shipped baselines of `eagle-eye`, `groundtrack` and `head-chef` also names the one file its rule fired on, as an exact path measured with SkillSpector v2.13.0 on 2026-10-17 (`groundtrack`'s LP3 excepted: it names `SKILL.md`, where the rule lands in `eagle-eye`, and was not measured where LP3 fires), so in a scan of that skill's own folder a finding of the rule in any other file is reported; `head-chef`'s TR2 keeps the root's `*SKILL.md` and its exact clause. Since 0.69.0 (#296) `head-chef` also has P2 on `SKILL.md` and EA2 on `SKILL.md` and `references/CONTRACT.md`, measured with SkillSpector v2.13.0 on 2026-10-21. No check refuses an entry that drops its `file` or `message` back to the root's rule-wide scope, or a `message` equal to the rule's own name; a test in `tests/check-baseline-rules.test.mjs` pins each shipped entry, so such an edit needs a test edit in the same diff, and review holds it. A named file is covered whole, so a new finding of the same rule inside it passes the scan, and review holds it: under `eagle-eye`'s E1 entry a second send in `audit.mjs` passes, where `tests/audit.test.mjs` also holds the hosts written as URLs to two, all `https`, and a host built at run time is left to review. `eagle-eye`'s AR2 and PE3 are also pinned to the exact words the scanner matched, so a new line in those files that uses the same words passes too. The root baseline stays rule-wide, for a scan of the whole repository, which is what the plugin route installs: a reader who applies it with `--use-shipped-baseline` has every finding of its ten rule-wide rules hidden in any file, the mod's included, and the gate never scans the mod, so there no SkillSpector run reports one; a plain scan reports them all. For E1 and PE3 that hides a send or a credential read. Accepted risk: class C2 (E2), in the threat model. Inside `skills/` CI's gate scans each skill with that skill's own baseline and still reports them; in the mod no SkillSpector run reports them, and review holds them. Narrowing the root would need a path prefix in rule 7 and touch every skill's entries (spec revision 5 on #336, T3). Accepted risk: class C2 (E3, E4), in the threat model. The `scan` job's probe proves only that the scanner honours `file`, not `message`, so a scanner that stopped honouring `message` would widen AR2 and PE3 to the whole of their files with the scan still green. The probe step runs only for a skill named `eagle-eye`, so if that skill were renamed or removed the step would be skipped rather than fail, and the proof would go with it while `scan` stayed green. Nothing fails when an entry names a file its skill no longer has: the scan stays green, and the header's claim that each entry names the file its rule fired on goes stale. Each needs a change that passes review, which row 8's attacker can still get merged, or a scanner dependency that resolves fresh on a run; review is the guard, and the probe catches only a scanner that stops honouring `file` on the installer's route. Accepted risk: class C2 (E5), in the threat model. A scanner pin bump is a reviewed pull request, and review is the guard there; a scanner dependency that resolves fresh on a run could bring the same drift with no change here, and nothing catches that. Since #343 the `contract` skill's baseline is narrowed too, each entry to the files its rule fired on, measured with SkillSpector v2.13.0 on 2026-10-18: EA2 on its three bindings, its change log and `references/CONTRACT.md`; P2 and LP3 on `SKILL.md`; RA2 on `references/binding-codex.md`; MP1 on its change log. A named file is covered whole, so an instruction hidden in `SKILL.md` in a comment, a link-reference comment or a base64 data link passes the scan there, and so does an instruction to persist on the machine in `references/binding-codex.md`; review holds those files, and rule 2c refuses invisible characters. `references/template.md` is named by no entry. Accepted risk: class C2 (E6, E7, E8, E9), in the threat model. The part fences and the ask-once cleanup phrase they were measured on are false positives, and review holds those files, as for the contract skill's entries of 2026-10-18. Accepted risk: class C2 (E9, E10), in the threat model. The scanner pin covers SkillSpector's own code, and fifteen of its dependencies are version ranges that resolve fresh on every run. There is no signing, and the SkillSpector job scans `skills/` only, not the mod: `scripts/check.mjs` holds the mod to its folders, the fixed-path and dependency rules and a version bump, and review does the rest. `npx skills add` copies `main` unless the user pins a commit, and the plugin updates when its version moves and the user updates, by hand or through background auto-update (off by default). A stolen admin account bypasses all of it.

### Tags

`AML.T0110.000` · `AML.T0115.002` · `AML.T0109` · `LLM03:2025` · `ASI04` · Tampering · MAESTRO 7

## Row 9

### Scenario

**A hijacked action or package in CI.** An action's tag is moved to malicious code, or a package CI fetches is replaced, and the code then tampers with the published site or steals the job's token.

### What stops it today

Every action pinned to a commit SHA; zizmor's `ref-version-mismatch` checks each SHA against its comment; `persist-credentials: false`; permissions scoped per job. The one package, Claude Code for the plugin validator, is pinned to an exact npm version and its reported version checked; it is fetched and unpacked, never installed, so no package script runs; its job holds no token or secret, has `contents: read`, and has no path into `pages`. See [scanners.md](scanners.md).

### Residual gap

A pin trusts whatever code it names. The npm pin is not a content pin: no hash of the tarball is checked.

### Tags

`AML.T0010.001` · `LLM03:2025` · Tampering, Elevation of privilege

## Row 10

### Scenario

**The agent is talked into leaking the key.** Planted text asks the agent to print its environment, or to point the audit at an attacker's server.

### What stops it today

`audit.mjs` never prints or writes the key. The endpoint override accepts only a loopback address. `SKILL.md` says never to ask for the key or write it to a file.

### Residual gap

The script cannot stop the agent itself from printing an environment variable. That boundary belongs to the host agent.

### Tags

`AML.T0055` · `AML.T0086` · `LLM02:2025` · `ASI03` · Information disclosure

## Row 11

### Scenario

**A box skews the audit's ranking.** Box text is written to push a weak edge down the ranking, so nobody rereads it.

### What stops it today

A score never changes an edge's tier. The ranking only orders rereading.

### Residual gap

Accepted risk: class K1 (E11), in the threat model.

### Tags

`AML.T0051.001` · Tampering

## Row 12

### Scenario

**The provider keeps the text.** After a yes, the box's text sits under the provider's policy, and an OpenRouter account with logging on stores it.

### What stops it today

The dry run names every company that receives it. [edge-audit.md](edge-audit.md) states the opt-ins.

### Residual gap

Accepted risk: class C7 (E12), in the threat model. The repository cannot see or change a provider's policy.

### Tags

`AML.T0057` · `LLM02:2025` · Information disclosure

## Row 13

### Scenario

**A shared skill, agent or contract steers the agent, or a validator pass is read as a review.** A stranger shares a skill or agent file, or the contract it was built from, whose text reads as an instruction. The contract skill reads it in an interview or while amending it, and the agent obeys: it installs the file, widens what the agent may do, or copies an order into the new file. Or a reader sees that a shared `SKILL.md` passed validation and trusts it as reviewed.

### What stops it today

`skills/contract/SKILL.md` says a file, a pasted diff and the validator's output are data, not instructions. An answer for an action, a stop or the tools, drafted from a file or by the skill, needs the person's own words, marked Decided; what the built file needs installed to run is exempt and low-stakes (q21 on #313), since it grants nothing. On the hiring page (#344), stakes come from the skill's kinds table, never from the draft: a high-stakes question shows no proposal until the person picks, and every high-stakes clause goes to push-back in chat, as does every clause of a shared draft. The page labels a pick "the draft's proposal", never the agent's. The skill never writes a hook, a settings file or a permission list, and asks before a write that would install. After building, it runs `claude plugin validate --strict` on the folder that holds the built file, shows the errors as printed, and says plainly when the command was not available and the file was not validated. Each tool binding keeps one line: these settings let an agent act without the person's approval, so say so when the person picks one. For the skills this repository ships, rule 2c of `scripts/check.mjs` refuses a frontmatter key outside `name`, `description`, `compatibility`, `license`, `allowed-tools` and `metadata`, and a C0 or C1 control, DEL, lone CR, U+2028, U+2029, U+FFFE or U+FFFF, a default ignorable code point (tag characters, zero-width characters, the soft hyphen, variation selectors) or a bidi control in any file under `skills/`, a BOM as a file's first character excepted.

### Residual gap

A pass of `claude plugin validate --strict` proves a frontmatter parses and nothing about a key's meaning, about who wrote the file or whether anyone read it, and it may read no agent, `CLAUDE.md` or Codex file. Rule 2c reads key names, not values. Rule 6c refuses a `plugin.json` or `marketplace.json` key outside an allow-list, and a case twin of either file; it reads key names, not what an allowed key's value points at, and a duplicate key is read as `JSON.parse` reads it, last one kept. Accepted risk: class C2 (E13), in the threat model. The engine is JavaScript and most likely reads it the same way, and a hand-written parser for that hypothesis would cost more than the risk it closes. Accepted risk: class C2 (E14b), in the threat model. Git's own path protection is expected to refuse the commonest of those names on NTFS, and the rest need a legacy file system that is rare on an installer's machine. Inert seal marks from the old check remain in one shipped file, the `familiar-digest` and `contract-digest` metadata of `skills/eagle-eye/SKILL.md`, until it is next amended; the contract skill carries none, and since 0.69.0 (#296) neither does `head-chef`. SkillSpector's P2 is off for the contract skill's whole `SKILL.md`, and EA2, RA2 and MP1 for the files row 8 names, so a comment, a link-reference comment or a base64 data link in its `SKILL.md` is reviewed by eye alone. Nothing seals a generated file, and nothing checks it against its contract: git history shows a hand edit, and a reviewer reads every changed file in full. A shipped or shared skill or agent, and its contract, are reviewed as prose. A stranger who writes both files can widen what the agent may do without asking, or point it at a server the file names, and the validator does not judge that: nothing warns on those keys, and the person reads them. The skill shows the validator's output as printed, which may repeat file paths and text from the file. The write scope is held by prose and by the person, and so is the data rule, as in row 2. A main agent file loads in every session in its scope, cannot limit the session's tools, and pulls in each `@` import; the same holds for any tampered `CLAUDE.md`. A whole-server grant lets an agent send that server's data through any current or future tool of it, write tools included, and the person checks for look-alike server names. A contract with frontmatter kept beside its agent in an agents folder loads as a second agent. Accepted risk: class C2 (E15), in the threat model.

### Tags

`AML.T0051.001` · `LLM01:2025` · `ASI01` · `ASI04` · Tampering, Elevation of privilege · MAESTRO 3

## Row 14

### Scenario

**A skill under test acts outside its practice run.** This is door 2 used on purpose. The practice runner, `scripts/practice.mjs`, starts an agent session that runs a skill under test. The skill, or a line a practice case plants, makes the session act outside its work folder: it changes the owner's live skills or settings, reads a secret, or reaches off the machine.

### What stops it today

The runner's posture, which is hygiene, not a boundary ([ADR 0006](../adr/0006-skills-are-dangerous-by-default.md)). The session runs in "don't ask" mode with hooks off. Its settings file denies edits to the copy of the skill under test, to the work folder's project settings, MCP config and instruction files, under `.git` and to `.gitattributes`. It denies reads of the credential file, the user settings files, the global state file, `.ssh`, `.aws`, `.git-credentials`, `.npmrc` and the run's backups. It denies every tool that reaches off the machine or schedules work, and the command line disallows them too. A case's tool rules take four shapes only: a script in the skill under test; one of four git commands: `status`, `diff`, `log` and `show`; a shell read of the home folder or of a test value; and a PowerShell append to the path a test value names inside the work folder. Each is written in every form the skill's own wording gives the command, quoted or bare, with either slash, never a wider one. The append's final wildcard is meant for the line: in #171's probes Claude Code denied every other thing tried there, namely a subexpression, a bracketed or array expression, an environment value, a pipe, an output redirect, and a second command after `;` or on a new line that no rule allows. A provider variable such as `${C:\x}` was not tried. The append path may not name an instruction file or a device. On `clean` and `owner-pact` the session's environment holds no secret by construction, so a read shows only a test value or the home folder. Before each turn the runner refuses a project settings file, an MCP config or an instruction file that setup did not put there, and a copy of the skill under test that changed since start. It backs up and hashes the owner's six live places at start, prints the manifest's hash, lists any change at report, and keeps the backups when one changed. The session's environment is built from a named list. Everything the runner prints or keeps from a session is cleaned and masked. The skill is the owner's own, and the tester writes the planted lines.

### Residual gap

**Allowed commands write anywhere they are pointed:** eagle-eye's renderer takes an output path, and git's `diff`, `log` and `show` take an output file. **Git config runs programs:** git can run a program named in its own configuration. **User settings merge:** on the variants that load user settings, the owner's own allow rules and extra directories merge into the posture, and the settings' environment values, provider keys among them, reach the session, so a case's fake key may be replaced by a real one there, and a read rule then shows the session that value; the report names each such collision, comparing names as the platform does. The owner's extra directories merge in too, and a relative append path follows the session's current folder, so after a `cd` the append can land there. Inside the work folder, #171's probe saw an append from the skill copy's folder under `.claude/` denied. On `full-account`, the user's MCP servers load too, with their own keys and headers. **Reads reach most of the home folder:** the read denies bind the agent's read tools only, not allowed commands, nor shell reads Claude Code does not recognise, such as `grep -r`, and they cover a few named files. A PowerShell provider variable such as `${C:\x}` in the append's wildcard was not tried, and if allowed it would copy a file's content into the work folder. **A secret read can reach a posted result:** masking catches known key shapes and the values the runner holds, of 8 or more characters and other than paths under ordinary names, nothing else. **The checks are evidence, not proof:** they cover only the listed folders, and the backups and start hashes sit where an allowed command could overwrite them, so undo works only if the backup survived. **The run directory holds a backup** of the owner's settings file, without its environment block. **The posture is only a rule check:** it rests on Claude Code's permission rules, and Claude Code has no operating-system sandbox on native Windows. **It also blocks more than a case may want:** Claude Code protects every write under `.claude/` in "don't ask" mode, whatever the allow rules say, so a session cannot edit a companion skill copied there. A case reads an attempted edit from the report's denials, and a case that needs the edit to land is not checkable on the runner.

### Tags

`ASI02` · `ASI04` · `LLM02:2025` · Tampering, Elevation of privilege, Information disclosure · MAESTRO 3

## Row 17

### Scenario

**A pull request ships a file no rule reads, or a person's home.** A pull-request author adds an ignore line matching a file already shipped, which reads in review as housekeeping, or force-adds a file an ignore line matches, so the file ships and the check never reads it for anything. Or a contributor, or an agent working for one, pastes a path from their own machine into a file the plugin ships: `C:\Users\<name>\`, `/Users/<name>/`, a Git Bash `/c/Users/<name>/`. Every installer gets the account name, and the path breaks on every other machine.

### What stops it today

**Rule 2b of `scripts/check.mjs`** compares what git tracks with what the check's own file walk read (the walk skips what `.gitignore` matches), and fails each tracked file the walk skipped, a submodule, a name that is not UTF-8 and a tracked file it cannot look at. In CI it fails when it cannot run. **Rule 2** fails a line in any file under `skills/`, `brigade/` or `hooks/` that holds a fixed home path: the config folder under a home, a Linux home, a Windows home after any drive letter with any number of backslashes, a forward slash or VS Code's encoded colon, a Mac home, the Git Bash, WSL and Cygwin forms, and a home root a name is joined to at run time, by `+` or by a template. **Printing:** every string a failure prints from the tree goes through one helper that masks the account segment after a home root, spaces included, and every other copy of it on the line, and escapes control characters and the marks that reorder or hide text. **Case checks:** a root `skills/`, `.claude-plugin/`, `brigade/` or `hooks/` spelled in another case fails, and a code file is read whatever the case of its suffix.

### Residual gap

**The rule reads text as written:** an escaped or line-continued string, JSON's escaped slash and a path computed at run time pass, as rule 6b's do on row 15; closing it needs a tokenizer. **Left out by decision:** lowercase `/users/<name>`, the common REST route; `~account/` and `/root/`; a markdown block-quote line; a UNC admin share, a WSL network share, a drive-less backslash path or one after a drive variable, a file link with a host or a dot segment, and a Mac home on a second volume, each of which needs a pattern loose enough to catch ordinary prose; and a text file under `brigade/` or `hooks/` that is not UTF-8. A home folder named in a markdown code span fails too, by the same decision; the fix is a placeholder or a block quote. **The mask sees only a name inside a home path:** a name joined to a home root from a separate string prints in the failure's excerpt. **A case alias inside the shipped folders** (`brigade/Index.ts` beside `./index.ts`) is not checked; every file there is read by every rule whatever its case, so it hides nothing. **What counts as shipped** is the three folders. Rule 6c refuses, in any case and read from the disk by name only, each root place in the plugin reference's standard layout as fetched on 2026-10-18; a default place the engine adds later passes until the list names it. Review reads the diff for all of these.

### Tags

Tampering, Information disclosure · MAESTRO 7

## Row 18

### Scenario

**An author's own page carries their user name.** An author, or an agent writing for one, puts a path from a home folder into a flightpath file: `C:\Users\<name>\…`, `/home/<name>/…`. The page prints it, and the author shares the page, or a CI log that printed the file.

### What stops it today

The format reference asks for paths relative to the repository root. **Since groundtrack 0.63.0 (#249)** `--check` and `--out` report an absolute path in a node's `loc`, `touches` and `enteredBy`, and in a file's `path`, as a finding that names the field and never the path. The two findings that print a changed file name the field instead when its path is absolute. groundtrack's `SKILL.md` says to fix an absolute path, and to keep one only on a page that stays on the author's machine.

### Residual gap

Accepted risk: class C7 (E69), in the threat model. A finding warns and does not block, so the page still carries the name when the author keeps the path: the owner prefers a warning to blocking a person's own file. The check reads only those four fields, so a home path in free text, such as a blurb or an aside, or in a captured trace's values, is not checked; the reference says so. An editor's own URL scheme, a `..` path and a drive letter with no slash are not reported either.

### Tags

Information disclosure · LINDDUN identifying

## Row 19

### Scenario

**A pull request runs code when an agent session opens on it, or the agent guard is read as a control.** The tracked `.claude/settings.json` registers one Claude Code hook, `scripts/agent-check-guard.mjs`, that runs before every Bash and PowerShell call an agent makes in any session opened on a folder the contributor trusts: a worktree under a trusted checkout, and `claude -p` and SDK sessions, show no trust dialog. A pull-request author who edits the script or the settings file, or adds a settings file below the root, runs code with the contributor's rights and environment before anyone has reviewed the branch; a Claude Desktop session runs whatever the main checkout holds. The guard starts one program, `athanor --version`, which inherits the session's environment, keys and tokens included, and finds the first `athanor` on `PATH`. And a reader, or an agent, takes the guard for a control against running a branch's code on the host.

### What stops it today

**Rule 6d of `scripts/check.mjs`** holds the root `.claude/settings.json` to the one guard entry, compared as parsed and as text, so a second hook, a permission, an environment variable or a status line fails; it also fails every settings file below the root, whatever it holds, a file or link named `.claude`, which the file walk cannot look through, and a case twin of the settings file or the script. **Rule 2c** holds both files to the hidden-character rule. The guard reads the hook input as data and writes nothing: its refusal is fixed text with nothing from the command in it, and everything else is silence, so it never answers with an explicit allow that would skip the owner's permission prompt, and an error is silent too. The probe runs from a fixed folder by absolute `cmd.exe` and `taskkill.exe` paths with the lookup in the current folder switched off, and on macOS and Linux it runs nothing when `PATH` has an empty or relative entry. `CONTRIBUTING.md` ("The agent guard") names the openings and tells a reader to read a branch's `.claude/` folder and `scripts/` before opening a session on it, or to start it with `--bare` or `--settings '{"disableAllHooks": true}'`. A run on 2026-10-24 showed the hook fires in a headless `claude -p` session from the exec-form entry, and that a copy of `node.exe` planted in the session folder was not run in its place.

### Residual gap

**The check runs after the hook has fired for a session opened on the branch**, so it protects the merge and not the reader; Claude Code runs hooks from a branch's settings file as soon as a session opens on it, and a worktree under a trusted checkout and a headless session show no dialog. **Hooks in a subagent's or a skill's frontmatter under `.claude/` are read by no rule.** **The guard is a nudge, not a control:** the flag that lets the host check through is typed by the agent, the deny message names it, and the command reader misses forms nobody listed (a computed path, a wrapper with options, a `bash -c` string). **The probe's environment:** a program first on `PATH` named `athanor` gets the session's environment before the owner's permission decision for that call; the reach is no wider than the agent's own `athanor run check`. **The hook's own `node`:** the planted-copy run was one headless session on Windows; other systems and an interactive session were not measured. **The Docker engine:** the guard sends every agent to `athanor run check`, which ships the tracked files with uncommitted edits to the engine athanor is set to use, and only `CONTRIBUTING.md` keeps that local; athanor's refusal of a non-local engine is issue 33 on the athanor repository, in progress, and this row stands until it lands. Accepted risk: class C9 (E70), in the threat model.

### Tags

Elevation of privilege, Tampering, Information disclosure · LINDDUN data disclosure
