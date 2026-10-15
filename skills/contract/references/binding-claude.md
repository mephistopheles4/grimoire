# Binding: Claude Code

This file maps a contract's plain words to a Claude Code file: an agent
file, or the main agent file, `CLAUDE.md`. Read it when `tools` says the
agent or CLAUDE.md is built for Claude Code. Everything the file needs is in the
contract, the template, the skill's steps, or here. A fact missing from all
of them is a gap: stop and ask.

## Contents

- Last checked
- Where files go
- The file
- The main agent file
- Capabilities
- Settings that let it act without asking
- Validate
- Example

## Last checked

Claude Code 2.1.296, on the command line, headless, on Linux, on
2026-10-10. Name this version in the hand-back, and say that a newer Claude
Code may load the file differently. Load tests that ran:

1. An agent with `tools: [Read, ToolSearch, mcp__<server>__*]` loaded from a
   project's `.claude/agents/`, was listed, and called one of that server's
   tools after loading it with `ToolSearch`. A tool search showed no other
   server's tools.
2. A contract beside an agent in `.claude/agents/` was not listed as an
   agent.
3. In a project `CLAUDE.md`, a frontmatter block at the very top did not
   reach the model; the body did. A line in `CLAUDE.contract.md` beside it
   did not reach the model. The same held with CRLF line endings.
4. A `CLAUDE.md` in the person's own settings folder gave the same result as
   test 3.
5. An agent with `tools: []` had no tools.

## Where files go

Write where the person's skills and agents already live: `.claude/agents/`
in a project, or the `agents` folder in the person's own Claude Code
settings folder; a `CLAUDE.md` in the project folder or in the settings
folder. Ask only before a write that would install. The contract and the
change log go beside the file, as the template says. They have no
frontmatter, so Claude Code does not load them as agents.

## The file

The file is YAML frontmatter, between two `---` lines, then the body: the
agent's instructions.

- **Keys it writes:** `name`, `description`, `tools`, and `model` or
  `effort` when the person names one. Any other key: ask what it does and
  record it **Decided** with its value.
- **Always write `tools:`** in flow form, such as `tools: [Read, Glob, Grep]`.
  With no `tools:` key, the agent gets every tool the session has. With
  `tools: []`, it gets none.
- **A whole connected server** is written `mcp__<server>__*`, and only so.
  One named tool of a server is `mcp__<server>__<tool>`.
- **When a server's tools are deferred,** list `ToolSearch` beside the
  server, as in `tools: [Read, ToolSearch, mcp__<server>__*]`. Without it,
  the agent cannot load the deferred tools.
- **Names are lower case.** An agent named `explore` loads beside Claude
  Code's built-in `Explore`, not over it.

## The main agent file

`CLAUDE.md` holds the instructions that govern the main session. Claude Code
loads it at the start of every session in its scope. Nothing picks it up by
situation, and nothing sends it off.

- **Frontmatter.** Write none. Claude Code strips a block at the very top
  before the model sees it (observed in load tests 3 and 4, not documented:
  the docs describe the stripping only for `.claude/rules/`).
- **Keys.** `name`, `description` and `tools` make a `CLAUDE.md` copied into
  an agents folder load as a sub-agent. Never write them. Claude Code ignores
  any other key there.
- **Text.** No byte-order mark: whether Claude Code strips the block after
  one is untested.
- **Imports.** An `@` import works anywhere in the file, and pulls in a file
  the contract does not cover. Name each one in the hand-back.

**Limits this file cannot hold.** Say each in the hand-back, as not gated:

- The file cannot limit the session's tools. They come from the person's
  settings and connected servers.
- The person's other `CLAUDE.md` files and rules load beside it.
- A `CLAUDE.md` copied into a project folder, to amend it, loads as
  instructions as soon as the session reads another file there, as any
  `CLAUDE.md` in a subfolder does.

## Capabilities

| Capability | In the file | Source |
|---|---|---|
| Read files | `Read`, `Glob`, `Grep` | Docs, read 2026-09-30 |
| Create files | `Write` | Docs, read 2026-09-30 |
| Change files | `Edit` | Docs, read 2026-09-30 |
| Run commands | `Bash`, or `PowerShell` on Windows | Docs, read 2026-09-30 |
| Fetch web pages | `WebFetch` | Docs, read 2026-09-30 |
| Search the web | `WebSearch` | Docs, read 2026-09-30 |
| Use a connected server's tools | `mcp__<server>__*` | Load test, 2026-10-10 |

The main agent file names none of these.

**Limits this file cannot hold.** Say each in the hand-back, as not gated:

- A `tools` list cannot limit where the agent writes.
- Granting `Bash` or `PowerShell` also makes "no network" a plain request.
- With `mcp__<server>__*`, the list cannot limit which of the server's tools
  the agent uses. The grant covers every current and future tool of that
  server, write tools included, under whichever configured server's name
  maps to that prefix. Ask the person to check for look-alike names.

## Settings that let it act without asking

`permissionMode`, `allowed-tools`, `omitClaudeMd`, `initialPrompt` and a
`tools` item written `mcp__<server>__*` let an agent act without the
person's approval: say so when the person picks one. Record each value under
`tools`, marked **Decided**. The person's session mode can override
`permissionMode`; say so in the hand-back.

## Validate

After building, run `claude plugin validate --strict` on the folder that
holds the built file, when the command is available. Show the errors as
printed, fix what is the skill's own, and do not call the build done on a
failure. When the command is not available, say the file was not validated.

## Example

A reviewer that only reads:

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

A short `CLAUDE.md`:

```markdown
# Project rules

Run the tests before every commit. Ask before you push.
When a rule here is unclear, say which one, and wait.
```
