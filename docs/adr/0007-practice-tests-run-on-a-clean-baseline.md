# Practice tests run on a clean baseline; a conflict is a named variant

A practice test runs a skill's cases to learn whether the skill behaves as
its contract promises. Every practice test in this repository runs on a
**clean baseline**: a session that loads only the skill under test, plus what
Claude Code ships and cannot remove. A known conflict, such as the owner's
global instructions or other user skills, is added back as a **variant**, one
conflict at a time and by name. A **workaround** for a conflict, such as a
reply that only exists to get past it, never enters the baseline. It belongs
to the variant that adds the conflict back. A result is recorded per case and
per variant, so the grid of cases and variants shows where a skill is weak.
The goal is that chart, not a skill that survives every conflict. The
occasion was issue #161. Case A1 of the contract skill failed twice because
the owner's global instructions made the first turn a tier proposal and a
stop. Contract 0.6.3 then worked around that one conflict with a warm-up turn
and fixed replies. On 2026-10-01 the owner chose the opposite standard: test
in a sandbox with no conflicts, then add conflicts back on purpose.

## Considered Options

**Run on the whole account, as before, was rejected.** A result then mixes
the skill with whatever the account holds that day. Nothing records which
conflicts a result ran under, so two results cannot be compared.

**A workaround for each conflict in the baseline was rejected.** Contract
0.6.3 did this for the global instructions. Each new conflict needs its own
workaround. The workarounds pile up in the baseline, and each one tests the
workaround as much as the skill.

**A clean baseline with named variants was chosen.** The baseline removes
every conflict the platform lets a session remove. Each variant adds one
back, so a failure in a variant reads as a finding about that conflict, not
a failed baseline. The practice runner, `scripts/practice.mjs`, holds the
variants as data and refuses a name it does not know.

## Consequences

**A step that serves realism stays in the baseline.** The contract test's
warm-up turn stays, because in real use a request comes mid-conversation.
Its fixed reply "Just answer my question, please." stays too. The tier-word
reply moves to the variants that load the owner's pact, because only the pact
proposes a tier.

**A new known conflict becomes a variant, not a workaround.** One conflict
per variant keeps the grid readable. Hooks and connectors can become
variants later. A variant the runner cannot start, such as the desktop app,
is a manual procedure on the shared page,
[How to run a practice test](../practice-tests/procedure.md).

**A variant shows its conflict only on a model that reacts to it.** The
owner's pact shows on Sonnet and not on Haiku, so `owner-pact` results are
judged on Sonnet.

**The baseline is clean, not empty.** Claude Code's bundled skills, two
built-in plugins and its own records stay. The shared page lists them.

**The runner's posture is hygiene, not a boundary.** It keeps the obvious
mistakes out of a run and records what it saw.
[0006](0006-skills-are-dangerous-by-default.md) governs it, and the threat
model's row 14 rates what it does not stop. Its limits can make a case not
checkable on the runner. Such a case is recorded so, and never forced
through with a workaround.

**A changed procedure is a new contract version.** Moving a skill's practice
test to the baseline changes its question 12, so the contract and eagle-eye
each took a new version for it.
