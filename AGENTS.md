# AGENTS.md

Before you patch anything, read [`CONTRIBUTING.md`](CONTRIBUTING.md) — it is the
contract for any patch.

## Two directories are called `scripts/`

`scripts/` at the repository root holds this repository's own checks — the one
command, the site build, and the table that says which renderer owns which
artifact — and the two scripts that draw each skill README's sheets, with the kit they
share in `scripts/lib/drafting.mjs`. `skills/groundtrack/scripts/` holds that skill's renderer and the one
module it inlines into the page. The path always says which is which.

## Agent skills

### Issue tracker

GitHub issues on `mephistopheles4/grimoire`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. `CONTEXT.md` does not exist yet; `/domain-modeling` writes it when a term actually lands, not before. `docs/adr/` holds the decisions made so far. Read the ones that touch the code you are about to change: 0003 before changing groundtrack's `fold`, 0004 before adding or changing a size limit in its renderer. See `docs/agents/domain.md`.

`docs/decisions/` holds kept eagle-eye box files. A box is a working surface, so most stay in scratch and never land here.
