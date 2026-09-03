# AGENTS.md

Before you patch anything, read [`CONTRIBUTING.md`](CONTRIBUTING.md) — it is the
contract for any patch.

## Two directories are called `scripts/`

`scripts/` at the repository root holds this repository's own checks — the one
command, the site build, and the table that says which renderer owns which
artifact. `skills/groundtrack/scripts/` holds that skill's renderer and the one
module it inlines into the page. The path always says which is which.

## Agent skills

### Issue tracker

GitHub issues on `mephistopheles4/grimoire`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. Neither exists yet. `/domain-modeling` writes them when a term or a decision actually lands, not before. See `docs/agents/domain.md`.

`docs/decisions/` holds kept eagle-eye box files. A box is a working surface, so most stay in scratch and never land here.
