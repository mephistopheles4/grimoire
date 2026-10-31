# AGENTS.md

Before you patch anything, read [`CONTRIBUTING.md`](CONTRIBUTING.md) — it is the
contract for any patch.

Read [Run the check in a container](CONTRIBUTING.md#run-the-check-in-a-container)
first, for how to install athanor and when it is safe to run, then run the
check with `athanor run check` by default.

A hook in `.claude/settings.json` enforces that order: while `athanor` works, it
refuses `node scripts/check.mjs` from you. When athanor is missing (a shim that
dangles counts as missing), run the host check as it is. When an athanor run
exits 124, 125 or 137, or you need the version-bump or allowance checks that
only a host run covers, add `--host-fallback=<reason>` to the host check, in your
own words with no path, token or pasted error text, and say in your report that
you used the fallback. A sha512 mismatch in the image build also exits 125; it
is not a Docker fault, so stop and tell the owner. Read
[The agent guard](CONTRIBUTING.md#the-agent-guard) for the rest.

## Three directories are called `scripts/`

`scripts/` at the repository root holds this repository's own checks — the one
command, the site build, and the table that says which renderer owns which
artifact — and the two scripts that draw each skill README's sheets, with the kit they
share in `scripts/lib/drafting.mjs`. `skills/groundtrack/scripts/` holds that skill's renderer and the one
module it inlines into the page. `skills/contract/scripts/` holds the contract
skill's interview script, the one module it shares with the hiring page, and
the kinds table both read. The path always says which is which.

## The Brigade pane and the head chef

A Brigade change that adds data the pane keeps says, in the same change,
whether the lead can read it through a tool; when it can, the same change
updates the head-chef contract and its `SKILL.md`, and its
`docs/security/brigade.md` row says where the tool's answer then flows.

## Threat model

This repository's threat model is [`docs/security/threat-model.md`](docs/security/threat-model.md), which `SECURITY.md` also links. Hand it to any security review. A change to its scope, its accepted risks (except one a level-3 lead takes under E80 as the owner accepted it on 2026-10-31) or this line is the owner's decision.

## Agent skills

### Issue tracker

GitHub issues on `mephistopheles4/grimoire`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. `CONTEXT.md` does not exist yet; `/domain-modeling` writes it when a term actually lands, not before. `docs/adr/` holds the decisions made so far. Read the ones that touch the code you are about to change: 0003 before changing groundtrack's `fold`, 0004 before adding or changing a size limit in its renderer. See `docs/agents/domain.md`.

`docs/decisions/` holds kept eagle-eye box files. A box is a working surface, so most stay in scratch and never land here.
