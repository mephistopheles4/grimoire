# Writing edges

An edge is a reason. A reason can be wrong in eight ways. An edge colours the
grid, so a wrong edge is worse than no edge.

## Contents

- Tiers
- What an edge can say
- The eight weakness patterns
- Chains
- The suspected list
- Strawmen

## Tiers

| Tier | Means | `src` |
|---|---|---|
| `measured` | Somebody ran it and saw the result. | Required: what was run, when, the number. |
| `sourced` | A named document states it. | Required: the document, section, or ticket. |
| `argued` | Your reasoning. Nobody checked it. | Optional. |

A tier is a claim about evidence, not about confidence. An argued edge you are
sure of is still argued.

## What an edge can say

- `conf`: if both options are selected, the set does not hold.
- `req`: if this option is selected and the target is not, the set is
  incomplete.
- Several `req` edges from one option are **all required** (AND). To say
  *"needs A or B"*, draw `conf` edges to every option in that row that is not
  A or B.
- An edge is one-directional. The page removes the reverse when you draw both.
- A target in the same row is not allowed.

## The eight weakness patterns

Check every argued edge against these patterns. Name the pattern when you
reject an edge.

| Pattern | The edge… | Fix |
|---|---|---|
| **wrong** | states something false. | Drop it, or measure it. |
| **weakly connected** | is true but does not produce the conflict or requirement it claims. | Rewrite the why so the link is explicit, or drop it. |
| **disconnected from context** | would hold in general but not in this system. | Add the context to the why, or drop it. |
| **biased** | exists because the author prefers one option. | State the preference in `notes`. Not an edge. |
| **opinionated** | asserts a judgement as a fact. *"X is the right way"*. | Rewrite as the observable consequence. |
| **disrespectful** | dismisses an option rather than describing its cost. | Describe the cost. |
| **insufficient** | needs a second reason to hold, and the second reason is not written. | Write it, as its own edge if it has its own target. |
| **vague** | could mean two things. | Pick one. |

An edge that fails and cannot be fixed goes to `suspected`: a plain string
that the page lists but that colours nothing.

## Chains

A chain is two reasons in a row. **Only a `req` first edge composes.**

| First | Second | Composes | What the pair derives |
|---|---|---|---|
| `req` | `req` | yes | The source **requires** the far option. |
| `req` | `conf` | yes | The source **rules out** the far option. |
| `conf` | anything | no | The source leaves the set. The target's own edges never fire. |

The renderer walks the chains. You answer two questions:

- **Is the derived relation true?** If not, one edge on the path is wrong.
- **Does the box say it?** A relation nobody wrote is a hidden constraint. Add
  the edge, or say in `notes` why the path is enough.

**A cycle is its own finding.** Option A requires B, and B requires A. Either
the rows in the loop are one decision, or one direction is redundant. Say
which, in `notes`.

## The suspected list

**Name the pattern first, so the debrief can count it.** Then the edge, then
the reason, then `Why:` and the rejected `why` word for word, in quotes:

```text
weakly connected: coh-step req deb-chat — a manual check does not force a manual record. Why: "The check is manual, so the record is manual too."
```

The box file keeps this after the session ends. A later test of the audit
needs the original sentence.

## Strawmen

For every row, before edges, ask four questions:

- **none** — do not do this at all.
- **opposite** — the reverse of the chosen option.
- **later** — defer it.
- **by hand** — a person does it instead of the system.

Add the ones that are not absurd, flagged `strawman: true`. Give each a why
like any option. A strawman nothing rules out is the finding the box exists
for.
