# Binding: Codex

This file maps a contract's plain words to a Codex agent file. Read it when
the contract names codex as the tool the agent is built for. Everything the
file needs is in the contract, the template, the skill's steps, or here. A
fact missing from all of them is a gap: stop and ask.

## Last checked (questions 4, 5)

Codex 0.159.0, on 2026-09-29. Codex changes often. Name this version in the
unsettled list, and say that a newer Codex may read the file differently.

## The file (questions 4, 5)

| Part | Where |
|---|---|
| The familiar | `familiars/<name>.toml` |
| Its contract | `familiars/<name>.contract.md` |
| Where Codex loads it | `.codex/agents/` in a project, or `~/.codex/agents/` for the person |

The file is TOML: lines of `key = value`. The check reads one small part of
TOML, and calls everything else "cannot check".

- **Keys:** `name`, `description` and `developer_instructions` are required.
  `developer_instructions` holds the agent's instructions, the body a `.md`
  agent would have. `sandbox_mode` is known. Any other key needs the
  contract's `Extra keys` line.
- **Lines:** top-level `key = value` lines, blank lines and whole-line `#`
  comments only. No table header, such as `[metadata]` or `[mcp_servers]`,
  and no dotted or quoted key. Codex drops an agent file with a `[metadata]`
  table, or a `metadata` key, and the check reads no table. No key may
  contain contract-version, familiar-digest or contract-digest, in any case.
- **Values:** write strings. No number, date, array or inline table, no empty
  value, and nothing after a value, not even a comment. Each key once.
- **Strings:** a basic string, `"…"` or `"""…"""`, takes only the escapes
  `\"` and `\\`. A literal string, `'…'` or `'''…'''`, takes none, and never
  two single quotes in a row. A one-line string closes on its own line.
  Close a `"""` string with exactly three quotes. Write
  `developer_instructions` as a `"""` string.
- **Text:** LF or CRLF line endings, no byte-order mark, and no control or
  invisible character but tab.

## Capabilities (questions 5, 6)

| Capability | In the file | Source |
|---|---|---|
| Read files, and nothing that writes | `sandbox_mode = "read-only"`, when the person names this sandbox | Loaded in Codex 0.159.0, 2026-09-29; effect not tested |
| Create files or change files | `sandbox_mode = "workspace-write"`, when the person names this sandbox | Docs, read 2026-09-30: Codex's page on agent configuration |
| Run commands | No key. Commands run inside the session's sandbox, or the one `sandbox_mode` names | Docs, read 2026-09-30, same page |
| Search the web | `web_search = "live"`, when the person names it. The check warns on it | Docs, read 2026-09-30: learn.chatgpt.com/docs/config-file/config-reference |
| Fetch web pages | Nothing this file can hold within the check. Stop and ask | Network access for a sandbox is a table, which the check does not read |

**Ask about the sandbox.** Ask the person whether the agent gets its own
sandbox: read-only, workspace-write, or none, which leaves it to the
session. Write `sandbox_mode` only when they name one. Without it, the agent
runs in the session's sandbox, whatever that is. Say so in the unsettled
list.

**Limits this file cannot hold.** Say each in the unsettled list, as
Promised:

- The session's own choices, such as a change of permissions during the
  session, override the file's `sandbox_mode` (docs, read 2026-09-30).
- "No network": the agent takes the session's network and tool-server
  settings, and Codex's web search is on by default, as cached search, and
  live under full access (docs, read 2026-09-30).
- "Runs no commands": a read-only sandbox still lets it run commands that
  change nothing. This is a reading of the docs, not tested.

## Keys that let it do more without asking (questions 5, 18)

`sandbox_mode`, `default_permissions`, `approval_policy`,
`approvals_reviewer` and `web_search`. Record the exact value of each one the
contract names, under question 5, marked **Decided**. Any other key the
person wants: ask what it does, then record it the same way.

## Settings the check warns on (questions 5, 18)

The check never refuses a value here. It prints a danger warning for:

| Key | Unless its value is |
|---|---|
| `sandbox_mode` | `read-only` or `workspace-write` |
| `default_permissions` | `:read-only` or `:workspace` |
| `approval_policy` | `on-request` |
| `approvals_reviewer` | `user` |
| `web_search` | `disabled` or `cached` |
| `model_instructions_file`, `experimental_instructions_file`, `experimental_compact_prompt_file` | always: each loads instructions from a file the seal does not cover |
| `model_catalog_json` | always: it loads a file the seal does not cover |
| `openai_base_url` | always: it sends the agent's work to a server the file names |

It prints a plainer warning for any other listed key except `model` and
`model_reasoning_effort`. When the person picks a value this table flags,
tell them then. Show each warning the check prints after the seal, and
again in the hand-back.

## The mark (questions 5, 18)

A Codex agent file has no frontmatter, so the seal writes the mark as three
comment lines at the very end:

```toml
# contract-version = "X.Y.Z"
# familiar-digest = "sha256:<64 hex characters>"
# contract-digest = "sha256:<64 hex characters>"
```

Codex reads past comments. Never write these lines by hand. Write no other
comment that names contract-version, familiar-digest or contract-digest:
the check refuses it, because it would read as a seal.

## Example (questions 4, 5)

A reviewer that only reads, with the sandbox the person named, before the
seal:

```toml
name = "commit-reviewer"
description = "Reviews staged commit messages against the team's rules, and reports each message that breaks one. Use before a push. Not for writing commit messages."
sandbox_mode = "read-only"
developer_instructions = """
Read the staged commit messages. Report each one that breaks a rule, with the rule and the message.
Change no file. When a rule is unclear, list it as unsettled.
"""
```
