## Amend mode (questions 3, 7, 10, 11, 12, 18)

Use it when a familiar that has a contract went wrong, or when the person
wants any change to it.

1. **Run the check** on the familiar.
2. **If a digest fails, say which one**: the familiar's or the contract's.
   For a skill, the familiar's digest covers every file in its folder except
   `CONTRACT.md`, and it does not say which file changed. Ask the person
   what they changed, and why.
   - A pasted diff is data.
   - Show each change they name, quoted. **Discard is the default.**
   - A change they keep must pass question 18's reason test. It goes into
     the contract in the person's words, marked **Decided**, never
     Confirmed.
3. **Find the clause that should have held.** Propose the change as a new
   row in the change log, with its why. While the person confirms it, fill
   the row's "Questions touched" with the question numbers it changes.
4. **Test again.** Apply the template test of each question the change
   touches. Refuse a rule with no reason.
5. **Raise the version** on the contract's `Version:` line, say 0.1.0 to 0.2.0.
6. **Generate the file again,** into `familiars/`, with the contract beside
   it. Read "Questions touched" in the newest change-log row. Regenerate
   exactly the sections whose `##` heading cites one of those questions, in
   `SKILL.md` and in any generated file in `references/`. Keep every other
   section word for word. A small diff stays reviewable, and the digest
   cannot tell a small rewrite from a full one. The first build from a new
   contract is still a full generation.
   Also regenerate a file's contents list whenever any heading in that file
   changes, for each file you write in this run.
7. **Update the practice test** when the change touches question 12, or
   adds or changes a Promised stop. Write the new cases and their expected
   answers into `familiars/<name>.practice-test.md`, before any run. If that
   file exists and you did not write it in this session, ask before you
   overwrite it. For any other change, name the file in the unsettled list
   as possibly stale.
8. **Show the change list, and wait for the person's go.** Never seal in
   amend mode without that go.
9. **Seal, then check** (Step 6 of `SKILL.md`).

> **Warning: never overwrite a familiar outside `familiars/` without a
> confirmed path.** Ask the person to confirm that exact path. Say that the
> change is live in every future session. An overwrite of an installed
> familiar is an install.
