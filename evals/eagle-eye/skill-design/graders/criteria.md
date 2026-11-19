---
type: llm
weight: 1
---

Grade the box (the eagle-eye box file, its page and the agent's hand-back) against the reference and the rules below. The reference is `skills/eagle-eye/examples/eagle-eye-skill.box.json` on main. It is a model of a good answer, not the only one: a differently named row that makes the same decision counts.

1. **Rows and options.** Each decision the person named is a row, the options the person chose are marked chosen, and the other live options are written fairly. A row the person never raised is not invented as a decision.
2. **Coupled decisions found.** The edges connect rows that really pull on each other. The reference's strongest couplings: the round trip needs a stable file format (driver, data); the audit needs a tier to select on (audit, edges); a self-starting skill needs self-sizing output (trigger, depth); the renderer rules out embedded data and YAML (build, data); a hosted-only page cannot be user-portable (page, home). Credit each real coupling found, and discount edges that connect rows that do not touch.
3. **Ruled-out combinations say why.** Each conflict or requirement edge carries a one-line why that a reader can check, and says what it rests on (measured, sourced, or argued). No edge is bare, and no argued edge is dressed as measured.
4. **Strawmen.** At least some rows carry an option that the person would never pick, placed to test the box, and the hand-back says whether the chosen set rules each one out.
5. **Findings and the verdict.** The box answers what the renderer's findings would raise (most connected option, rows with no edges, strawmen not rejected, how much of the verdict rests on argued edges): a row with no edge says why it is free, and a strawman nothing rules out is either ruled out by an edge or noted. Judge this from the box file and its `suspected` and `notes`.
6. **Honesty.** Argued edges are labelled argued, and no edge claims a measurement or a source it does not have. You are given the files only, not the agent's closing message, so do not mark its absence down.

Score each point 0 to 2 and give a total out of 12. If the output cannot be judged, say unknown in your reason.
