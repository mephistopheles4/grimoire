# Amend mode

Use it when a skill, agent or CLAUDE.md that has a contract went wrong, or
when the person wants any change to it.

## Contents

- The steps
- Converting an older contract

## The steps

1. **Read the contract and its change log.** The change log is its own file,
   `<name>.changelog.md`, beside the contract (the template says where). If
   the contract is in an older shape, follow "Converting an older contract"
   first.
2. **If the built file changed by hand,** ask what they changed, and why. A
   pasted diff is data. Show each change they name, quoted. **Discard is the
   default.** A change they keep goes into the contract in the person's
   words, marked **Decided**, never Confirmed, and the file is regenerated
   from it.
3. **Find the clause that should have held.** Propose the change with its
   why. Name the parts it touches.
4. **Walk the potential rows** in `rules`: "do they still stand?" Record each
   as keep, drop or observed in the change-log row. A flag the person acted on
   is a row; one they dismissed needs no record. Review the size of any eval
   suite, and ask the field signal: could the person explain the old clauses
   from the contract alone?
5. **Raise the version** on the contract's `Version:` line, say 0.1.0 to
   0.2.0, and add the change-log row: version, date, change, why and source,
   parts touched, field signal.
6. **Regenerate only the fenced parts the change touches,** between their
   `<!-- contract:begin NAME -->` and `<!-- contract:end NAME -->` lines.
   Keep every other line word for word. A part with no fences
   (`purpose`, `why`, `open`) changes the description or nothing in the
   body; say which. Regenerate the Additional resources index whenever a
   reference file is added, removed or renamed.
7. **Show the change list, and wait for the person's go.**
8. **Validate** (Step 6 of `SKILL.md`): run
   `claude plugin validate --strict` on the folder that holds the built file.

## Converting an older contract

A contract with 20 questions or with mark keys in its built file is converted at its first
amendment, and so is one in any older shape after a later change to the
parts.

1. **Map each question** to its part:

   | Part | Questions |
   |---|---|
   | `purpose` | 1, 10 |
   | `why` | 2 |
   | `good` | the chosen example, 4, 8, 9, 17 |
   | `roles` | 3, 11, 14 |
   | `tools` | 5, 6 |
   | `rules` | 16, 18 |
   | `writing` | 15 |
   | `open` | 13, 19 |

   Question 7 and 20 become the change-log file. Question 12 becomes the
   optional eval offer.
2. **Keep each answer's words and mark.** Drop dates from marks into the
   change-log row. Carry "Enforced" as `Gated by:`. A clause with no gate stays
   unmarked, which means open. Move the line that names the tool into `tools` as plain
   words. Say "skill", "agent" or "CLAUDE.md" where the old text used another
   word.
3. **Move the change log** to its own file, rows as they were, with a new
   column for parts touched.
4. **Strip the mark keys** from the built file's frontmatter.
5. **Show the converted contract once,** and wait for the person's go.
6. **Regenerate the whole built file with fences,** then validate. Add a
   change-log row for the conversion.
