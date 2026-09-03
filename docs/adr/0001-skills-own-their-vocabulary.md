# Skills own their vocabulary

A skill in this repository names no vocabulary the repository does not own — no
outside skill name, command name, or tool-specific noun — in its description,
its body, or its examples. The plugin ships to strangers, and every example
artifact also renders to GitHub Pages, so a borrowed proper noun reaches a
reader who cannot resolve it and sends them looking for something they cannot
install. The test is one question an author can run without knowing what they
are avoiding: *does this sentence stay true and checkable for a reader who has
only this repository?*

## Considered Options

The test is **per sentence, not per word**. Two narrower tests were rejected.

**Resolvability** — *does the word send the reader looking for something they
cannot get?* — is subsumed by the chosen test but too weak on its own. It misses
sentences assembled entirely from ordinary words that still assert a named
tool's behaviour. The instance that decided it: *"Brainstorming has the
clarifying questions answered and has not yet proposed approaches"* contains no
proper noun and is still a claim about one specific tool's phase sequence.

**Provenance** — *is the word the name of something outside this repository?* —
is the easiest to apply and over-cuts. It takes *a design review* and *during
brainstorming*, which are ordinary English that happens to collide with a name,
and which cost a reader nothing.

A **two-tier** rule was also rejected: a low repository-wide floor covering
description and body, with `groundtrack` keeping its stricter examples clause.
Instead `eagle-eye` rises to meet the strict version and the rule is single-tier.
A floor that every existing skill exceeds is an untested lower bound, and it
grants a future author permission the codebase has never exercised. The
alternative — relaxing `groundtrack`'s locked spec down to a floor written after
it — would invert which document is authoritative.

## Consequences

**Nothing enforces this mechanically, deliberately.** A denylist can only hold
names somebody already thought of, which is the inverse of the failure mode: the
rule exists for the *next* borrowed noun. A passing check would read as *this
file is clean* when it means *this file contains none of six words*, which is
worse than no check. This follows the precedent already set for the code-fence
rule — a hand-written rule and not a linter, on purpose.

**There is no exception mechanism.** No allowlist, no table of surviving
mentions with reasons. An allowlist with no entries invites the first one and
grows by precedent once it has one. A genuine exception is a patch to this
decision, argued in a pull request.

**Some provenance is lost, and that is accepted.** `eagle-eye`'s own boxed
design recorded three named tools as candidate host flows for its trigger. The
labels now say *another planning flow*. The argument survives in full — the row
states that a host flow may call the skill, and the edge states that hosts are
global while the skill is repo-level — so only the examples go.
