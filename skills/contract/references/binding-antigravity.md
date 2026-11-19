# Binding: Antigravity

## Last checked

agy 1.2.13, on 2026-09-30.

## Where files go

`.agents/agents/` in a workspace (loaded; effect not tested).

## The file

The file is `<name>.md`: YAML frontmatter, between two `---` lines, then the
body: the agent's instructions.

- **Keys it writes:** `name`, `description`, `tools`. No other key was
  checked.
- **Always write `tools:`** in flow form, such as
  `tools: [view_file, write_to_file]` (loaded in that form).

## Capabilities

| Capability | In the file | Source |
|---|---|---|
| Read files | `view_file` | Loaded |
| Create files | `write_to_file` | Loaded |
| Change files | `replace_file_content` | Loaded |
| Run commands | `run_command` | Loaded |
| Fetch web pages | `read_url_content` | Loaded |
| Search the web | `search_web` | Loaded |

Loaded means a file listing that name ran in agy 1.2.13, on 2026-09-30; its
effect was not tested.

**Limits this file cannot hold:**

- A `tools` list cannot limit where the agent writes. Granting
  `write_to_file` or `replace_file_content` makes "writes only in the
  project folder" a plain request.
- Granting `run_command` makes "writes only in the project folder" and "no
  network" plain requests too.
- The list may not be every tool agy gives the agent. An agent listing only
  `view_file` reported `manage_task` as well in agy 1.2.13; that is its own
  report, not tested. So "only these tools" is not gated.

## Settings that let it act without asking

None checked.
