# Skills are dangerous by default; the user's trust decides what runs

A skill is dangerous by default. It can make the agent do anything the agent
can do. The tools that install skills tell the user to install only sources
they trust. The user's choice to trust a skill is what lets it run, and that
choice is theirs. grimoire does not overrule that trust. It does not try to
confine what a skill, or a session that runs one, can do. Its job is to make
the trust informed. It uses reminders in the skill prose, scanners on the
prose, and hygiene in its own tools. It writes every risk that is left on the
[threat model](../security/threat-model.md), with its guard and its gap. The
threat model rates it. The occasion was issue #161, a plan for practice tests that
run a skill in a clean agent session. Each review round on that plan found new
holes in a permission-rule "sandbox" around the session. Earlier rounds on the
contract skill did the same. On 2026-10-01 the owner decided that skills are
dangerous by default. No set of rules can secure everything when a skill can
do anything.

Two words carry this record. **Hygiene** is a cheap measure that keeps an
obvious mistake out, or catches it after the fact. **A boundary** is a measure
that holds against a skill that tries to get past it. grimoire builds hygiene,
and its docs never call hygiene a boundary.

## The test for a review finding

A finding of the form "a skill could still do X" gets a threat-model row and a
rating. It does not get another round of rules. The rating decides whether
more work is worth its cost. This is the stopping rule of
[0004](0004-refuse-a-hostile-file-at-three-measured-limits.md), applied to what
a skill can do: stop by the threat's rating, not when a reviewer runs out of
findings. Cheap hygiene is still worth adding.

## What the test does not cover

The test covers a skill's behaviour only. A defect in the repository's own
tools stays an ordinary finding to fix. So does a defect in anything those
tools print or post. A renderer that lets a file run script in the page
(row 3) is a bug. So is an edge audit that prints its key (row 10).

## When grimoire warns

The install warning already says that a skill can do anything, so grimoire
never repeats it. grimoire warns only on one of four triggers. Each trigger is
outside what the trust at install time covered.

- **A stranger's text reaches the agent.** Examples are a pull request to
  chart and a shared file. The skill tells the agent that the material is
  data, not instructions. See rows 1, 2 and 13, and gap 1.
- **Something leaves the machine or costs money.** An example is eagle-eye's
  edge audit. The skill states the facts and waits for a yes. See rows 6, 10
  and 12.
- **Output reaches a person who never made the trust decision.** An example
  is a reviewer who reads a shared groundtrack page. The page says that AI
  drew it. See row 1 and gap 3.
- **A choice widens what something new can do.** An example is a setting in
  a familiar, the skill or agent that a person builds with the contract
  skill. The check warns, and it never refuses the person's own setting. See
  row 13.

A proposed warning that fits none of the four triggers is cut.

## Considered Options

The four options were weighed for the practice runner that #161 plans. It is
a tool of this repository that starts an agent session. For an installed
skill, the first three options are not grimoire's to choose. The user's agent
runs the skill, and grimoire never starts that agent.

**A container was rejected for now.** It would confine reads, writes and the
network, but only for grimoire's own tools. The agent inside it needs its own
install and its own login. The #161 plan requires the owner's plan login and
no new token. No practice case so far needs confined reads or a confined
network. A later issue can revisit it.

**A separate Windows user was rejected for now, for the same reasons.** A
second account has its own home folder. So it needs its own install of the
agent and its own login. A later issue can revisit it.

**A permission-rule sandbox was rejected.** Every review round found a new way
past the rules. An allowed command writes anywhere it is pointed. Git runs a
program that its own configuration names. The user's own allow rules merge
into the posture. That is expected, because every allowed command is a way to
write or run code. As of 2026-10-01, Claude Code has no operating-system
sandbox on Windows, so the rules are only a rule check. Rules that call
themselves a sandbox claim a boundary that they cannot hold. Each round also
adds rules that a reader must understand.

**Hygiene with disclosure was chosen.** Hygiene is cheap, and it catches the
obvious mistake. The threat model tells the reader what still gets through,
and the rating ranks it beside every other risk. Together they make the
user's trust informed, with no claim that grimoire cannot keep.

## Consequences

**The threat model's "The last line of defence is not ours" goes one step
further.** That section names the final guard for rows 1, 2, 6, 10 and 13. It
is the host agent's rule that text in a file is data. This record applies the
same reasoning to the skill itself. The user's trust is the final guard, and
grimoire cannot enforce it or replace it. This agrees with `SECURITY.md`,
which does not defend against a skill that the user chose to install.

**It contradicts neither [0001](0001-skills-own-their-vocabulary.md) nor
[0005](0005-skills-name-their-targets.md), and it replaces neither.** Those
records govern the words that a skill uses. This record governs what grimoire
does about what a skill can do. A warning from one of the four triggers is
skill prose. So it still meets 0005's dependency test and the per-sentence
test.

**A script that starts an agent session needs a threat-model row.** The threat
model's "Keeping this page true" names it as a trigger. The other triggers
include a new skill and a new script that opens a connection. The row records the script's
hygiene, what the hygiene does not stop, and a rating.

**Some gaps stay open by design.** A reader who wants a boundary around a
skill does not find one here. They find each gap named, with its guard and
its rating, and they decide whether to trust the skill.
