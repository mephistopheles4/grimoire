# Binding: Claude Code

This file maps a contract's plain words to a Claude Code file: an agent
file, or the main agent file, `CLAUDE.md`. Read it when the contract names
claude as the tool the familiar is built for. Everything the file needs is
in the contract, the template, the skill's steps, or here. A fact missing
from all of them is a gap: stop and ask.

## Contents

- Last checked (questions 4, 5)
- The file (questions 4, 5)
- The main agent file (questions 4, 5)
- Capabilities (questions 5, 6)
- Keys that let it do more without asking (questions 5, 18)
- Settings the check warns on (questions 5, 18)
- The mark (questions 5, 18)
- Example (questions 4, 5)

## Last checked (questions 4, 5)

Claude Code 2.1.296, on the command line, headless, on Linux, on
2026-10-10. Name this version in the unsettled list, and say that a newer
Claude Code may load the file differently. Five load tests ran:

1. A sealed agent with `tools: [Read, ToolSearch, mcp__<server>__*]` loaded
   from a project's `.claude/agents/`, was listed, and called one of that
   server's tools after loading it with `ToolSearch`. Its tool listing and a
   tool search showed no other server's tools.
2. A contract beside an agent in `.claude/agents/` was not listed as an
   agent.
3. In a sealed project `CLAUDE.md`, the body reached the model and the mark
   did not. A canary line in `CLAUDE.contract.md` beside it did not reach
   the model. The same held with CRLF line endings.
4. A sealed `CLAUDE.md` in the person's own settings folder gave the same
   result as test 3.
5. An agent with `tools: []` had no tools.

## The file (questions 4, 5)

| Part | Where |
|---|---|
| The familiar | `familiars/<name>.md` |
| Its contract | `familiars/<name>.contract.md` |
| Where Claude Code loads it | `.claude/agents/` in a project, or the `agents` folder in the person's own Claude Code settings folder |

A contract may sit beside its agent in `.claude/agents/`: it has no
frontmatter, so Claude Code does not load it as an agent. The check fails a
contract whose first line is `---`, so a contract cannot carry a `name` and
load as a second agent.

The file is YAML frontmatter, between two `---` lines, then the body: the
agent's instructions. The frontmatter follows the rules in the skill's
Step 5. The seal writes the mark under `metadata:`.

- **Keys it writes:** `name`, `description`, `tools`, and `model` or
  `effort` when the person names one. Any other key: ask what it does,
  record it **Decided** with its value, list it on `Extra keys`, and carry
  on.
- **Always write `tools:`** in flow form, such as `tools: [Read, Glob, Grep]`,
  and list `tools` on `Extra keys`. With no `tools:` key, the agent gets
  every tool the session has, and the check warns `tools-missing`: "no tools
  listed, so the agent may get every tool". With `tools: []`, it gets none,
  and the check warns `tools-missing`: "an empty tools list, so the agent
  gets no tools".
- **A whole connected server** is written `mcp__<server>__*`, and only so.
  The check fails a bare `*`, `mcp__*`, a partial such as `mcp__<server>__get_*`,
  and a bare `mcp__<server>`, which Claude Code also reads as the whole
  server: write `mcp__<server>__*` instead. One named tool of a server is
  `mcp__<server>__<tool>`.
- **When a server's tools are deferred,** list `ToolSearch` beside the
  server, as in `tools: [Read, ToolSearch, mcp__<server>__*]`. Without it,
  the agent cannot load the deferred tools.
- **Names are lower case.** An agent named `explore` loads beside Claude
  Code's built-in `Explore`, not over it.

## The main agent file (questions 4, 5)

The main agent file holds the instructions that govern the main session.
Claude Code loads it at the start of every session in its scope. Nothing
picks it up by situation, and nothing sends it off.

| Part | Where |
|---|---|
| The familiar | `familiars/CLAUDE.md` |
| Its contract | `familiars/CLAUDE.contract.md` |
| Where Claude Code loads it | the project folder, or the person's own Claude Code settings folder |

- **Frontmatter.** The file may start with a frontmatter block, at the very
  top. Before the seal it holds nothing this binding asks for: write none.
  The seal writes it, holding only `metadata:` with the three mark keys.
  Claude Code strips a frontmatter block at the very top of `CLAUDE.md`
  before the model sees it. This is observed in load tests 3 and 4, not
  documented: the docs describe the stripping only for `.claude/rules/`.
- **Keys.** `name`, `description` and `tools` fail. Claude Code finds a
  sub-agent by its `name`, not its file name, so with them a `CLAUDE.md`
  copied into an agents folder loads as a sub-agent. Any other key warns:
  Claude Code ignores it when the file loads as `CLAUDE.md`. The danger rows
  below still apply to it.
- **Text.** No byte-order mark: whether Claude Code strips the block after
  one is untested. No line below the block that reads as a mark key, such
  as `contract-version:`.
- **Imports.** Claude Code's memory docs say an `@` import works anywhere in
  the file, mid-sentence and in list items included. Each import pulls in a
  file the seal does not cover, and the check warns once per line holding
  one.
- **The contract** names claude on its `Target:` line and says
  `Kind: main agent file`. The check fails it otherwise.

**Limits this file cannot hold.** Say each in the unsettled list, as
Promised:

- The file cannot limit the session's tools. They come from the person's
  settings and connected servers.
- The person's other `CLAUDE.md` files and rules load beside it.
- An `@` import pulls in a file the seal does not cover.
- Kept in `familiars/`, the file loads as instructions as soon as the session
  reads another file in that folder, as any `CLAUDE.md` in a subfolder does.
  A file brought there to amend reaches the session as instructions, the
  same as any tampered `CLAUDE.md`.

## Capabilities (questions 5, 6)

| Capability | In the file | Source |
|---|---|---|
| Read files | `Read`, `Glob`, `Grep` | Docs, read 2026-09-30 |
| Create files | `Write` | Docs, read 2026-09-30 |
| Change files | `Edit` | Docs, read 2026-09-30 |
| Run commands | `Bash`, or `PowerShell` on Windows | Docs, read 2026-09-30 |
| Fetch web pages | `WebFetch` | Docs, read 2026-09-30 |
| Search the web | `WebSearch` | Docs, read 2026-09-30 |
| Use a connected server's tools | `mcp__<server>__*` | Load test, 2026-10-10 |

The main agent file names none of these: the session's tools come from the
person's settings and connected servers. Its question 5 lists the
capabilities the instructions rely on.

**Limits this file cannot hold.** Say each in the unsettled list, as
Promised:

- A `tools` list cannot limit where the agent writes.
- Granting `Bash` or `PowerShell` also makes "no network" Promised.
- With `mcp__<server>__*`, the list cannot limit which of the server's tools
  the agent uses. The grant covers every current and future tool of that
  server, write tools included.
- The grant covers whichever configured server's name maps to that prefix
  once Claude Code replaces the characters it does not allow, a project's
  own server or a plugin's included. Question 6 asks the person to check
  for look-alike server names.

## Keys that let it do more without asking (questions 5, 18)

`permissionMode` may set when the agent asks before it acts. Record its
value under question 5, marked **Decided**, whatever it is. The person's
session mode can override it; say so in the unsettled list.

## Settings the check warns on (questions 5, 18)

The check never refuses a value here. It prints a warning for each row,
under rule `danger`, except the `@` import row, which prints under rule
`import`:

| Key | Unless its value is |
|---|---|
| `permissionMode` | `default`, `plan`, `manual` or `dontAsk`; in a list, every item one of these; an empty list. Any other value may let the agent act without asking |
| `allowed-tools` | always, an empty list included: it may let the agent use tools without asking |
| `omitClaudeMd` | always, an empty list included: it starts the agent without the person's CLAUDE.md files |
| `initialPrompt` | always, an empty list included: it sends a first message the person did not type |
| a `tools` item written `mcp__<server>__*` | always, once per item: it grants every current and future tool of one server, write tools included |
| an `@` import line in a `CLAUDE.md` body | always, once per line: it loads instructions from a file the seal does not cover |

It prints a plainer warning for any other listed key except `tools`,
`model` and `effort`. In a `CLAUDE.md`, `name`, `description` and `tools`
fail, and every other key but `metadata` warns under rule `ignored-key`,
since Claude Code ignores it there. It also warns `tools-missing` on an
agent with no `tools`, or an empty list, as "The file" says. The check
applies the key rows to every `.md` file, a skill's `SKILL.md` and a
`CLAUDE.md` included. When the person picks a value this table flags, tell
them then. Show each warning the check prints after the seal, and again in
the hand-back.

## The mark (questions 5, 18)

The seal writes the mark as three keys under `metadata:` in the
frontmatter. In a `CLAUDE.md` with no frontmatter, it adds a block at the
very top that holds only the mark. Never write them by hand.

## Example (questions 4, 5)

A reviewer that only reads, before the seal. Its contract lists `tools` on
its `Extra keys` line:

```markdown
---
name: commit-reviewer
description: Reviews staged commit messages against the team's rules, and reports each message that breaks one. Use before a push. Not for writing commit messages.
tools: [Read, Glob, Grep]
---

# commit-reviewer

Read the staged commit messages. Report each one that breaks a rule, with
the rule and the message. Change no file. When a rule is unclear, list it as
unsettled.
```

A short main agent file, after the seal, as the check writes it. Its
contract says `Kind: main agent file` and `Target: claude`:

```markdown
---
metadata:
  contract-version: 0.1.0
  familiar-digest: "sha256:5d994d88feb5775426eedccfa2bdc8854cba7caa9058fa1e47be3fcfe81489c6"
  contract-digest: "sha256:b86e22c7a9225299543b19555e6b272fd1fb4776e91ec077c0d95de9ab5b4018"
---
# Project rules

Run the tests before every commit. Ask before you push.
When a rule here is unclear, say which one, and wait.
```
