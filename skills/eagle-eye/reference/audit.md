# The edge audit

This file holds the detail of the optional edge audit. `SKILL.md` holds its
stop: the dry run, the four facts, and the wait for a yes in chat.

## Contents

- What the audit is
- The probe
- Who can say yes
- The run
- Dispositions
- The audit on one configuration

## What the audit is

`audit.mjs` sits next to `SKILL.md`. It ranks the `argued` edges, so you know
which edge to reread first. It compares each argued edge with controls that it
builds from the `sourced` and `measured` edges, and flags an edge that scores
among them. A box with too few such edges gets a ranking with no flags, and the
tool says so.

It is the one action of this skill that leaves the machine. It sends the box's
text to a model provider, and the provider charges the person's key.

## The probe

```bash
node <skill base directory>/audit.mjs --probe
```

The probe prints `yes` or `no`, and it sends nothing. Treat any other output as
`no`. With no `audit.mjs`, say nothing about the audit.

**On `no`,** tell the person once that an optional audit exists and needs their
own key from a model provider. When they ask for it, run it: it sends nothing,
and prints the steps to set a key. Give those steps to the person.

> **Warning: never ask for the key, and never write it into a file.** The
> person sets it in their own environment.

**On `yes`,** run `--dry-run` first. State the four facts, and wait for a yes
in chat. Never state a price. The provider sets it and can change it.

## Who can say yes

Offer the audit once in a conversation. One yes covers one run. The person's own
instructions can give a yes for every run. Even then, run the dry run and state
the four facts before each run. If the person said no earlier, do not offer it
again.

## The run

```bash
node <skill base directory>/audit.mjs <scratch>/<topic>.box.json
```

Give the person the last line on standard error: it says how many requests the
run sent. **Exit code 4 means the audit failed.** Tell the person in one line.
Then check the argued edges by hand against the eight weakness patterns. Do not
run the audit again in a loop.

## Dispositions

Give each flagged edge one disposition, and say it in chat:

- **Rewrite** the `why` so the link is explicit. A rewrite that adds a factual
  claim names a `src`, or the edge stays `argued`.
- **Suspect** it: move it to `suspected`, with the pattern named first.
- **Keep** it, and give the reason.

The audit stops when every flagged edge has a disposition, never on a score. Stop
after two rounds.

## The audit on one configuration

When a set does not hold, give the audit the same `--sel` the renderer got:

```bash
node <skill base directory>/audit.mjs <box.json> --sel "eagle-eye: opt-a, opt-b"
```

It scores only the argued edges that make the set fail. It lists a sourced or
measured edge and does not send it.
