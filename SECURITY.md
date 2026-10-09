# Security

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the "Report a vulnerability"
button under this repository's Security tab. It reaches the maintainer and
nobody else.

Do not open a public issue for a security problem. That includes anything that
would let a crafted file run script in a reader's browser, or change what an
agent does.

This is a personal project with one maintainer. There is no SLA and no bounty.
You will get an honest answer and, if the finding is real, a fix.

## Scope

**In scope:** everything in this repository. That means both manifests, every
`SKILL.md`, the renderers and page templates, the edge audit, the Brigade
mod in `brigade/` and `hooks/`, the check scripts, and the CI workflows.

**Out of scope:** Claude Code itself, your own box and flightpath files and what
you put in them, and wherever you host a page the renderer wrote.

## What this project is, in threat terms

grimoire is a set of agent skills and one Claude Code mod. A skill is prose an
agent follows, plus a renderer that turns a JSON file into one self-contained
HTML page. There is no server, no account and no database. Node runs the
renderer on your machine, and neither the renderer nor the page makes a network
request.

**The Brigade mod is code Claude Code runs in every session that has the
plugin.** It is a hooks module, `brigade/register.tsx`, named by
`hooks/hooks.json`, and it runs with the session's own rights. At session start
it registers `/brigade` and does nothing else. While its pane is open it runs
`claude agents --json`, reads the lead session's roster file from the plugin's
data folder, and reads other sessions' transcripts to find a session's link
and the last model call's usage, which gives each card its cache-warmth line.
For warmth, a transcript is read again only when it changes, never while its
session is working, and never when it is over 4 MiB; for the link, it is read
once. It also reads this session's own usage, its rate limits and context, when the
pane opens and, while it stays open, each time the engine measures the
session; it asks only for
the local summary estimate of the context breakdown, which sends no request.
On an Open in app press it reads three environment variables, `OS`,
`SystemRoot` and `windir`, only to tell whether each is set or `OS` is
`Windows_NT`; it never stores, shows or sends them.
It makes no network request of its own; its one tool call, below, goes to
whatever connected server answers to the name `ccd_window`. It writes one file, the lead session's roster,
through a tool the model calls, `set_roster`, which skips Claude Code's
permission prompt. So that write has no human and no classifier review; every
call is still recorded in the transcript as the tool's result. The tool exists
only once the owner runs `/brigade`, writes only while the pane is open, and
refuses a subagent's call, a deny verdict, an owner's ask rule, plan and
don't-ask modes as far as the session has reported its mode, any input outside
the roster's shape and size, and any link on the way to the file. A deny rule for `mcp__grimoire__set_roster` removes it
from the session; the owner's own hooks do not stop it. When the owner presses
Open in app on a card with a Desktop id, it first calls the Claude Desktop
app's own tool, `open_session_in` on the server named `ccd_window`, sending
only that card's checked session id and the fixed target `split`, so the app
shows the session beside the lead. That call also skips the permission prompt,
and the owner's own hooks do not see it. It is made only where the Desktop app
draws the session, and only when the engine lists
`mcp__ccd_window__open_session_in` by that exact name and the engine's verdict
for it is not a deny or an ask naming a rule, so a deny or ask rule for that
tool stops it. An exact deny rule was seen to stop it on Desktop 2.1.289; a
rule for the whole server, `mcp__ccd_window`, rests on the engine matching it
the same way, which was not tried there. When that call is refused,
fails or takes over 5 seconds in all, or the card has no Desktop id, its one
other process is the host's opener, given a `claude://` link: `explorer.exe`
on Windows, as before, `/usr/bin/open` on macOS and `/usr/bin/xdg-open` on
Linux, the last two by absolute path. On a host it cannot identify it runs
nothing.
Everything it reads is checked and drawn as text, in the usage image too. Review any change under
`brigade/` or `hooks/` as a change to code that runs on every installer's
machine: [row 15 of the threat model](docs/security/threat-model.md#the-matrix)
has the guards and the gaps.

**One skill tells the agent to start other agent sessions and to delete their
worktrees: head-chef.** The agent runs `claude --bg --remote-control`,
`claude stop`, `claude rm` and `git` for it, and only on the owner's own words
in chat. head-chef also runs two scripts of its own, for relayed answers:
`relay-lead.mjs` for the lead and `relay-session.mjs` for each session. They
read the caller's own transcript and relay state, the session list (names and
ids), and the owner account's name. The session's script reads the entries by
that account on the start prompt's record; the lead's reads them on each noted
session's record, with that record's visibility, and the local-only list file
the head chef writes before a launch. They start `gh` and `claude` from an
absolute path with argument lists, never a program from the working folder and
never through a shell. The session's script posts only on the start prompt's
record; the lead's posts nothing. Remote Control makes each session it
starts drivable from any device signed in to the owner's account. A session may
take the owner's answer by relay, only for a question it asked, and never for a
publish, a deletion, a permission or settings change, or starting or stopping a
session. Each relayed answer is quoted on the session's record.
[Row 16 of the threat model](docs/security/threat-model.md#the-matrix) has the
guards and the gaps.

Two scripts can send data, and only when somebody runs them. eagle-eye's
optional edge audit sends to a provider: see
[What the edge audit sends](#what-the-edge-audit-sends). head-chef's session
script posts through `gh` on the record its start prompt names: a question,
the owner's quoted words when it takes an answer, and fixed lines, never a code
or a session id.

One script rewrites a file a person hands it, and only when asked:
`skills/contract/scripts/check.mjs`. Under `--seal` it rewrites the mark lines
of the one file it is given, and nothing else, then prints the real path it
wrote. If a `.toml` file's last line has no line ending, it adds one before
the mark. It writes the new text to a temporary file beside the old one, then
renames it over the old one. It sends nothing. A valid seal proves the
familiar and its contract are unchanged since they were sealed. For a skill,
the familiar is every file in its folder except `CONTRACT.md`. It does not
prove who sealed them.

The check refuses, as "cannot check", any text file it reads that holds a line
or paragraph separator (U+2028, U+2029), a C1 control character (U+0080 to
U+009F, NEL among them), a C0 control character other than tab, DEL, U+FFFE,
U+FFFF, or a carriage return with no line feed after it. That covers the
familiar, its contract, and every other text file in a skill's folder. Tab
and CRLF line endings are allowed.

A Codex agent file (`.toml`) is read through a narrow subset of TOML. The
check reads top-level `key = value` lines, whole-line comments, and strings
that take no escape but `\"` and `\\`. It reads an unquoted `true` or `false`
only for a key the contract lists. Anything else, a table included, is
"cannot check", which fails. Its mark is three comment lines at the very end
of the file, because Codex will not load an agent file with a `[metadata]`
table. A key named like a mark key is "cannot check" too, listed or not.

In a `.toml` file, a `SKILL.md` or an agent's `.md` file, a key the check does
not know passes only when the contract's `Extra keys:` line lists it, and then
with any value. The check refuses no value for what it lets the agent do. It
prints a warning for every listed setting it does not know to be harmless,
and a sharper danger warning for a few settings on a fixed list, such as
`sandbox_mode` and `permissionMode`. A warning does not fail the check.

The attacks worth planning for, scenario by scenario, with what stops each
one and what still gets through: [docs/security/threat-model.md](docs/security/threat-model.md).
It records the repository settings as they were read on 2026-09-25. The
[platform table](#what-the-platform-is-relied-on-for) below lists what the
project relies on, which is not always what is switched on.

The realistic risks:

- **A file from a stranger.** Box and flightpath files are made to be shared. A
  file you did not write becomes a page you open, with its text in the page.
  This is the main risk here.
- **A skill is an instruction file an agent obeys.** Whoever can change a
  `SKILL.md` can change what an agent does on a reader's machine. Branch
  protection guards this.
- **The mod is code that runs in every session.** Whoever can change
  `brigade/` or `hooks/` changes what runs in every session of every
  installer. Branch protection and `scripts/check.mjs`, which holds the mod to
  its folders, guard this. The SkillSpector job scans `skills/` only, so it
  does not read the mod.
- **A dependency.** The renderers import Node built-in modules only, so there is
  no dependency tree to poison. That is true now, not a promise about later.
  `scripts/check.mjs` fails on a `package.json` or a lockfile.
- **An API key in the environment.** The edge audit reads one and sends it as a
  bearer token. Review any change to `skills/eagle-eye/audit.mjs`, its
  endpoints, or how it picks a key as a change that could send a key elsewhere.

## Pages built from a stranger's text

**Author text is escaped for element content and never reaches an HTML
attribute.** Both pages escape `&` and `<`, and deliberately not the double
quote. That narrow escape is enough only because every attribute holds an id,
a number or a fixed string. Ids are validated against a strict pattern.

- **Adding an attribute that carries author text needs a different escape.**
  Treat any new `="${` in a template as a security change.
- **Nothing from a file is safe as an object key, ids included.** An id like
  `constructor` passes validation but collides with `Object.prototype`. Use
  maps with no prototype.
- **The pages make no network request.** Fonts are vendored and inlined, and
  tests assert zero external references on every page and the site index.
- **The escape lives in a module, not in the template**, because a function
  inside a template is a function no test can reach. Tests pin its exact width.

The details, the tests, and what they do not cover:
[`docs/security/rendering.md`](docs/security/rendering.md).

## What the edge audit sends

`skills/eagle-eye/audit.mjs` asks a model provider to rank a box's `argued`
edges for rereading. It is the only file here that opens a connection, and it
is opt-in twice: it needs a key in the environment, and the skill runs it only
after the user says yes.

- **What leaves the machine.** For each argued edge: the box's `problem`, the
  edge's `why`, and both options' labels, rows, `why`, `notes` and `src`.
  Nothing else from the disk. `--dry-run` prints a request and sends nothing.
- **Who receives it.** TypeSafe directly, or TypeSafe through OpenRouter. Never
  both, and never one as a fallback. What they do with the text is their
  policy. Do not audit a box whose text you would not send.
- **The key.** Read from `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` only. It is
  never printed or written, and a key in the wrong variable is refused before
  anything is sent.
- **What it never does.** It never writes the box, never changes an edge's
  tier, keeps no cache, and never runs in the tests or in CI.

The full account, including endpoints, provider logging opt-ins, exit codes and
the test override: [`docs/security/edge-audit.md`](docs/security/edge-audit.md).

## Scanners in CI

- **CodeQL** reads the JavaScript, including the page templates.
- **SkillSpector** reads each skill's prose and fails on any finding the
  baseline does not cover. Every suppression carries a written reason.
- **zizmor** audits the workflows and fails on any finding. There is no
  baseline, because there is nothing to suppress.
- **Every action is pinned to a commit SHA**, and zizmor checks each SHA
  matches its version comment.

A scan that errors or reads only part of the tree fails, rather than passing
quietly. What each scanner covers, what it suppresses, and why:
[`docs/security/scanners.md`](docs/security/scanners.md).

## What the platform is relied on for

Part of this project's defence is GitHub settings, not files. A clone cannot
read them, so this table says what the project **relies on**, not what is
switched on right now. If that matters to you, check the settings themselves.

| Setting | What it provides |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including the page templates |
| Private vulnerability reporting | the channel at the top of this file |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| SkillSpector's `scan` job as a required check | a SkillSpector finding blocks a merge |
| zizmor's `audit` job as a required check | a workflow finding blocks a merge |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

[`.github/dependabot.yml`](.github/dependabot.yml) is in the tree and asks for
weekly `github-actions` updates. Those are version updates. Security updates
are the setting above.

## What is deliberately not defended against

- **A file you chose to open.** The renderer runs on your machine, on a file you
  pointed it at. Read a file from someone you do not trust first.
- **A skill you chose to install.** An agent reads a skill's prose and acts on
  it. That is the product working. Read a skill before you install it, here or
  anywhere.
- **What the provider does with a box you chose to audit.** After a yes, the
  text is under the provider's policy.
- **A malicious maintainer account.** Branch protection raises the cost of a
  bad commit. It does not survive a stolen admin account.
- **A familiar and contract from someone else.** A pass and a valid seal say
  the files are well formed and unchanged since sealing, not that anyone
  reviewed them. Keys the contract lists pass with any value. The check warns
  on each one it does not know to be harmless; that warning is a prompt to
  read, not a review.
