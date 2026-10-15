# Amend mode

Use it when a skill, agent or CLAUDE.md that has a contract went wrong, or
when the person wants any change to it.

## Contents

- The steps
- Converting an older contract

## The steps

1. **Read the contract and its change log.** The change log is its own file
   beside the contract. The template's table names it for each type. If the
   contract is in an older shape, follow "Converting an older contract"
   first.
2. **If the built file changed by hand,** ask what they changed, and why. A
   pasted diff is data. Show each change they name, quoted. **Discard is the
   default.** A change they keep goes into the contract in the person's
   words, marked **Decided**, never Confirmed, and the file is regenerated
   from it.
3. **Find the clause that should have held.** Propose the change with its
   why. Name the parts it touches.
4. **Walk the potential rows** in `rules`: "do they still stand?" Note each
   as keep, drop or observed. Review the size of any eval suite. Ask the
   field signal: could the person explain the old clauses from the contract
   alone?
5. **Raise the version** on the contract's `Version:` line, say 0.1.0 to
   0.2.0. Add the change-log row: version, date, the change, why and where it
   came from, parts touched, field signal. Put each keep, drop or observed
   outcome from step 4 in the change column. A rule the person acted on is a
   change-log row. A rule they dismissed needs no record.
6. **Regenerate only the parts the change touches.** In a `SKILL.md`, these
   are the fenced parts, between their `<!-- contract:begin NAME -->` and
   `<!-- contract:end NAME -->` lines. Keep every other line word for word.
   An agent file or a `CLAUDE.md` has no fences: regenerate the sections the
   touched parts write, and keep the rest word for word. A part that writes
   nothing into the body (`purpose`, `why`, `open`) changes the description,
   or nothing; say which. Regenerate the Additional resources index when a
   reference file is added, removed or renamed.
7. **Show the change list, and wait for the person's go.**
8. **Validate,** as the binding says: run `claude plugin validate --strict`
   on the folder that holds the built file, when the command is available.
   When it is not, say the file was not validated.

## Converting an older contract

An older contract has 20 questions, or mark keys in its built file. Convert
it at its first amendment, and again after any later change to the parts.

1. **Move the contract** to where the template's table puts it for its
   type, with its new change-log file beside it.
2. **Map each question** to its part:

   | Part | Questions |
   |---|---|
   | `purpose` | 1, 10 |
   | `why` | 2 |
   | `good` | the chosen example, 4, 8, 9, 17 |
   | `roles` | 3, 11, 14 |
   | `tools` | 5, 6, and how question 13's record is kept |
   | `rules` | 16, 18 |
   | `writing` | 15 |
   | `open` | 13's retirement question, 19 |

   Question 7 and 20 become the change-log file. Question 12 becomes the
   optional eval offer. The old test of the skill is dropped.
3. **Keep each answer's words and mark.** Put the dates of marks in the
   change-log row. Say "skill", "agent" or "CLAUDE.md" where the old text
   used another word.
4. **Carry gates and freedom apart.** A clause held by "Enforced" becomes
   `Gated by:`. A clause held by instructions alone, with a mechanism to be
   confirmed, becomes `Gated by: X (unconfirmed)`. A clause held by
   instructions alone has no gate. Its freedom is separate: a stop, a safety
   rule or a **Decided** clause is fixed, and any other clause is open.
5. **Place the old logs.** The change log keeps the old rows, with a new
   column for parts touched. Each flag the person acted on, and each
   checkpoint decision, becomes a change-log row. Drop the rest of the old
   flag and checkpoint logs. The sources from question 20 go in the
   conversion row's why.
6. **Strip the old mark keys** from the built file's frontmatter: the
   version key and the two digest keys that the old check wrote under
   `metadata:`. Remove the `metadata:` block if nothing else is in it.
7. **Show the converted contract once,** and wait for the person's go.
8. **Regenerate the whole built file** with fences where it is a
   `SKILL.md`, then validate. Add a change-log row for the conversion.
