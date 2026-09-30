# Binding: Claude Code

This file maps a contract's plain words to a Claude Code agent file. Read it
when the contract names claude as the tool the agent is built for.
Everything the file needs is in the contract, the template, the skill's
steps, or here. A fact missing from all of them is a gap: stop and ask.

## Last checked (questions 4, 5)

Claude Code's sub-agents page, code.claude.com/docs/en/sub-agents, read on
2026-09-30. No agent file was loaded to check it. Name this in the unsettled
list.

## The file (questions 4, 5)

| Part | Where |
|---|---|
| The familiar | `familiars/<name>.md` |
| Its contract | `familiars/<name>.contract.md` |
| Where Claude Code loads it | `.claude/agents/` in a project, or the `agents` folder in the person's own Claude Code settings folder |

The file is YAML frontmatter, between two `---` lines, then the body: the
agent's instructions. The frontmatter follows the rules in the skill's
Step 5. The seal writes the mark under `metadata:`.

- **Keys it writes:** `name`, `description`, `tools`, and `model` or
  `effort` when the person names one. Any other key: ask what it does,
  record it **Decided** with its value, list it on `Extra keys`, and carry
  on.
- **Always write `tools:`** in flow form, such as `tools: [Read, Glob, Grep]`,
  and list `tools` on `Extra keys`. Without it, the agent gets every tool.

## Capabilities (questions 5, 6)

| Capability | In the file | Source |
|---|---|---|
| Read files | `Read`, `Glob`, `Grep` | Docs, read 2026-09-30 |
| Create files | `Write` | Docs, read 2026-09-30 |
| Change files | `Edit` | Docs, read 2026-09-30 |
| Run commands | `Bash`, or `PowerShell` on Windows | Docs, read 2026-09-30 |
| Fetch web pages | `WebFetch` | Docs, read 2026-09-30 |
| Search the web | `WebSearch` | Docs, read 2026-09-30 |

**Limits this file cannot hold.** Say each in the unsettled list, as
Promised:

- A `tools` list cannot limit where the agent writes.
- Granting `Bash` or `PowerShell` also makes "no network" Promised.

## Keys that let it do more without asking (questions 5, 18)

`permissionMode` may set when the agent asks before it acts. Record its
value under question 5, marked **Decided**, whatever it is. The person's
session mode can override it; say so in the unsettled list.

## Settings the check warns on (questions 5, 18)

The check never refuses a value here. It prints a danger warning for:

| Key | Unless its value is |
|---|---|
| `permissionMode` | `default`, `plan`, `manual` or `dontAsk`; in a list, every item one of these; an empty list |
| `allowed-tools` | always, an empty list included: it may let the agent use tools without asking |
| `omitClaudeMd` | always, an empty list included: it starts the agent without the person's CLAUDE.md files |
| `initialPrompt` | always, an empty list included: it sends a first message the person did not type |

It prints a plainer warning for any other listed key except `tools`,
`model` and `effort`. The check applies these settings to every `.md` file,
a skill's `SKILL.md` included. When the person picks a value this table
flags, tell them then. Show each warning the check prints after the seal,
and again in the hand-back.

## The mark (questions 5, 18)

The seal writes the mark as three keys under `metadata:` in the
frontmatter. Never write them by hand.

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
