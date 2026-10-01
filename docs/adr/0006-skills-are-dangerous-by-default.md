# Skills are dangerous by default; the user's trust decides what runs

A skill is dangerous by default. It can make the agent do anything the agent
can do. Claude Code warns the user to install only sources they trust, and
`SECURITY.md` tells every reader to read a skill before they install it. The
user's choice to trust a skill is what lets it run, and that choice is theirs.
grimoire does not overrule that trust. It does not try to confine what a
skill, or a session that runs one, can do. Its job is to make the trust
informed. It uses reminders in the skill prose, scanners on the prose, and
hygiene in its own tools. It writes every risk that is left on the
[threat model](../security/threat-model.md), with its guard and its gap. The
threat model rates it. The occasion was issue #161, a plan for practice tests
that run a skill in a clean agent session. Each review round on that plan
found new holes in a permission-rule "sandbox" around the session. Earlier
rounds on the contract skill did the same. On 2026-10-01 the owner decided
that skills are dangerous by default. No set of rules can secure everything
when a skill can do anything.

Two words carry this record. **Hygiene** is a cheap measure that keeps an
obvious mistake out, or catches it after the fact. **A boundary** is a measure
that holds against a skill that tries to get past it. grimoire builds hygiene
around a skill, and its docs never call that hygiene a boundary.

## The test for a review finding

A finding of the form "a skill could still do X" gets a threat-model row and a
rating. It does not get another round of rules. The rating decides whether
more work is worth its cost. This applies the stopping rule of
[0004](0004-refuse-a-hostile-file-at-three-measured-limits.md) to what a skill
can do. Stop by the threat's rating, not when a reviewer has no findings left.
Cheap hygiene is still worth adding.

## What the test does not cover

The test covers what a skill can do. It does not cover a defect in this
repository's own files. Those files are everything that `SECURITY.md` puts in
scope. It lists the manifests, the skill prose, the renderers and page
templates, the edge audit, the check scripts and the CI workflows. A defect in
any of them stays an ordinary finding to fix. So does a defect in anything
they print or post. A grimoire skill has a defect when a sentence in it tells
the agent something wrong. It also has one when it leaves out a warning that
one of the four triggers below calls for. Three examples are a bug, not a
rating:

- a renderer that lets a file run script in the page (row 3);
- an edge audit that prints its key (row 10);
- skill prose that says a file may give the audit's standing yes (row 6).

## When grimoire warns

Claude Code's plugin warning and `SECURITY.md` already tell the user to trust
a skill before they install it, so grimoire never repeats that. grimoire warns
only on one of four triggers. Each trigger is outside what the trust at
install time covered.

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

The four options were weighed for the practice runner that #161 plans. The
runner is to be a script of this repository that starts an agent session. For
an installed skill, the first three options are not grimoire's to choose. The
user's agent runs the skill, and grimoire never starts that agent.

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
sandbox on native Windows, so the rules are only a rule check. Rules that call
themselves a sandbox claim a boundary that they cannot hold. Each round also
adds rules that a reader must understand.

**Hygiene with disclosure was chosen.** Hygiene is cheap, and it catches the
obvious mistake. The threat model tells the reader what still gets through,
and the rating ranks it beside every other risk. Together they make the
user's trust informed, with no claim that grimoire cannot keep.

## Consequences

**The threat model's "The last line of defence is not ours" now reaches the
skill itself.** That section names the final guard for rows 1, 2, 6, 10 and
13. It is the host agent's rule that text in a file is data. This record
applies the same reasoning to the skill. The user's trust is the final guard,
and grimoire cannot enforce it or replace it. This agrees with `SECURITY.md`,
which does not defend against a skill that the user chose to install.

**It contradicts neither [0001](0001-skills-own-their-vocabulary.md) nor
[0005](0005-skills-name-their-targets.md), and it replaces neither.** Those
records govern the words that a skill uses. This record governs what grimoire
does about what a skill can do. A warning from one of the four triggers is
skill prose. So it is still held to 0005's dependency test and the
per-sentence test.

**A script that starts an agent session needs a threat-model row.** The threat
model's "Keeping this page true" names it as a trigger. The other triggers
include a new skill and a new script that opens a connection. Such a row
records the script's hygiene, what the hygiene does not stop, and a rating.
The practice runner's row arrives with the runner.

**Some gaps stay open by design.** A reader who wants a boundary around a
skill does not find one here. They find each gap named, with its guard and
its rating, and they decide whether to trust the skill.
