# Binding: Antigravity

This file maps a contract's plain words to an Antigravity agent file. Read
it when the contract names antigravity as the tool the agent is built for.
Everything the file needs is in the contract, the template, the skill's
steps, or here. A fact missing from all of them is a gap: stop and ask.

## Last checked (questions 4, 5)

agy 1.2.12, on 2026-09-29. Name this version in the unsettled list.

## The file (questions 4, 5)

| Part | Where |
|---|---|
| The familiar | `familiars/<name>.md` |
| Its contract | `familiars/<name>.contract.md` |
| Where agy loads it | `.agents/agents/` in a workspace (loaded; effect not tested) |

The file is YAML frontmatter, between two `---` lines, then the body: the
agent's instructions. The frontmatter follows the rules in the skill's
Step 5. The seal writes the mark under `metadata:` (loaded).

- **Keys it writes:** `name`, `description`, `tools`. Any other key: ask
  what it does, record it **Decided** with its value, list it on
  `Extra keys`, and carry on. No other key was checked.
- **Always write `tools:`** in flow form, such as
  `tools: [view_file, write_to_file]`, and list `tools` on `Extra keys`
  (loaded in that form).

## Capabilities (questions 5, 6)

| Capability | In the file | Source |
|---|---|---|
| Read files | `view_file` | Loaded |
| Create files | `write_to_file` | Loaded |
| Change files | `replace_file_content` | Tool list |
| Run commands | `run_command` | Tool list |
| Fetch web pages | `read_url_content` | Tool list |
| Search the web | `search_web` | Tool list |

Loaded means a sealed file with that name ran in agy 1.2.12; its effect was
not tested. Tool list means the agy 1.2.12 tool list, 2026-09-29, as the
tool reported it.

**Limits this file cannot hold.** Say each in the unsettled list, as
Promised:

- Granting `run_command` makes "writes only in the project folder" and "no
  network" Promised.

## Keys that let it do more without asking (questions 5, 18)

None checked.

## Settings the check warns on (questions 5, 18)

The check applies its `.md` settings to every `.md` file, so a key named in
the Claude Code binding's list warns here too; none is specific to
Antigravity. Any other listed key except `tools`, `model` and `effort` gets
the plainer warning. When the person picks a value that list flags, tell
them then. Show each warning the check prints after the seal, and again in
the hand-back.

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
tools: [view_file]
---

# commit-reviewer

Read the staged commit messages. Report each one that breaks a rule, with
the rule and the message. Change no file. When a rule is unclear, list it as
unsettled.
```
