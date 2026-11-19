# The box file in detail

This file holds the detail behind the brief, the rows and the presets.
`SKILL.md` holds the steps and the stops.

## Contents

- An example brief
- Challenge the premise with a row
- The problem statement
- Presets in detail
- What the renderer checks

## An example brief

> **problem.** The gate blocks a merge when a build is red. Nobody has said who
> must be able to clear it. A maintainer can fix almost anything, and a
> first-time contributor with a fresh clone cannot. This box decides the reader
> the standard is written for, the remedy it promises them, and who reviews the
> promise.
> **who.** Every contributor who opens a pull request, and the two maintainers
> who answer them.
> **when.** Before the next release, because the release note repeats the
> promise.

## Challenge the premise with a row

The brief says why the box exists. Nothing in the box tests that statement.
Every row carries a strawman, so a reader can attack its options. The reason for
the whole box carries none.

**Draw the premise as an ordinary row.** Its cells are *solve it*, *defer it*
and *do it by hand*. They exclude each other, and each one combines with the
cells of every other row. The renderer does not enforce this row. Draw it when
the premise deserves a test.

## The problem statement

This section is about a **row**. For the box, see "The brief" in `SKILL.md`.

**Every row carries a `problem`: what this decision is about, for a reader who
does not know the domain.** A row name is a handle, not an explanation. The page
opens the **In short** block with it. Nothing can derive it. Write two to five
sentences that cover:

- **The terms the row uses.** Define the ones a stranger has not met.
- **Why the choice exists at all.** What forces it, and what is already fixed.
- **What turns on it.** What a reader gets wrong by picking carelessly.

Write the problem, not your answer. The options carry the answer, and the edges
carry the argument. `question` stays the decision in one line.

> *Reachable by whom.* The rule for a gate says a red build must have a remedy
> somebody can reach. It never says who that somebody is, and the answer
> changes everything. This row names the person the standard is written for,
> because "reachable" without a reader decides nothing.

## Presets in detail

A preset's `reframe` is optional, and it is not the `text`. The `text` says
what the reader sees. The `reframe` says what the box now decides. The page
prints it in the brief, while that preset still describes the grid.

> *The strawman run.* **text:** Set the strawman and open the row it closes.
> **reframe:** The problem becomes whether anything in the box rules the weak
> answers out.

**Do not write a Reset step.** The page resets when the reader picks the
preset. **A step that only sets `view: 'findings'` does nothing.** To send the
reader back from an open row, close the row in the same step:
`{ open: null, view: 'findings' }`. Give at least one preset a `set` step, so
the reader meets a configuration that is not the chosen set.

**A strawman can be the chosen option.** Keep the flag set, and say in `notes`
why it survived. The flag records coverage, never quality.

## What the renderer checks

The renderer validates: a box-level `problem`, unique ids, exactly one
`chosen` per row, a `short` on every option, edge targets that exist and sit
in another row, a tier in {measured, sourced, argued}, a `src` on every
non-argued edge, a why on every edge, and two or more presets of which one
changes an option. `who`, `when` and a preset's `reframe` are optional, and a
present one must not be blank. A `tour` is optional too. Each stop names a
region the page has and a `now`, and its state must show its region.

It warns on a row with no `problem`, on a row with no strawman, and on a
strawman that is the chosen option.

**The box's `problem` and a row's `problem` are two fields.** The renderer
refuses a box that has no `problem`. It warns about a row that has none. The
two messages name different places: `problem:` for the box, `dims[i]` for a
row.

**A strawman can be the chosen option.** The *strawman not rejected* finding
says: give the reason to reject it, or pick it. Picking it is the second
answer, and it is the interesting one: the weak option survived the whole
grid. Keep the flag set and say in `notes` why it survived. The flag records
coverage, never quality.

No validator can tell a dimension from a menu of positions, and none can tell
you a row is missing. One mechanical check would help and does not exist yet:
warn when a single option rules out options across most of the other rows,
because that cell is usually a position.
