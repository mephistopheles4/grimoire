---
type: llm
weight: 1
---

Grade the box (the eagle-eye box file, its page and the agent's hand-back). There is no reference box for this input; judge against the person's text and the couplings below, which a careful reader of that text would find.

1. **Rows and options.** The five decisions the person named (branching, cadence, feature gating, store rollout, hotfixes) are rows, and every option the person listed is present. Store review time, the one QA person, the payments sign-off, users on old versions and the zero budget appear as constraints on edges and not as made-up rows.
2. **Coupled decisions found.** The edges connect rows that really pull on each other. Credit each of these, and discount edges that connect rows that do not touch:
   - trunk-based branching with a fixed train ships unfinished work unless something gates it, so it needs flags;
   - no budget for paid services rules out the remote flag service;
   - build-time flags cannot be turned off after a build ships, so they cannot serve as a kill switch, and a kill switch needs some remote configuration;
   - one QA person signing off the payments screen on every store build pulls against a weekly train and against release on demand;
   - one-to-two-day store review pulls against fixing an urgent bug with a new build (roll forward or cherry-pick), and toward a kill switch;
   - cherry-picking a fix needs a branch for the release that shipped, so it pulls on branching;
   - users staying on old versions for weeks means a fix in a new build does not reach them, and a kill switch must already be in the old builds;
   - a staged rollout lets a bad build be halted before it reaches everyone, which eases the hotfix row.
3. **Ruled-out combinations say why.** Each conflict or requirement edge carries a one-line why that a reader can check, and says what it rests on (measured, sourced, or argued). No edge is bare, and no argued edge is dressed as measured or sourced.
4. **Strawmen.** Rows carry an option that tests the box (for example git-flow, no flags, or a full release to everyone), and the hand-back says whether the chosen set rules each one out.
5. **Findings and the verdict.** The box answers what the renderer's findings would raise (most connected option, rows with no edges, strawmen not rejected, how much of the verdict rests on argued edges): a row with no edge says why it is free, and a strawman nothing rules out is either ruled out by an edge or noted. The person asked "which combinations actually hold": the preset or chosen set shows one that holds. Judge this from the box file and its `suspected`, `notes` and `presets`; where `handover.md` exists, read it too.
6. **Honesty.** Argued edges are labelled argued, and no edge claims a measurement or a source it does not have. You are given the files only (and `handover.md` where it exists), so do not mark a missing closing message down.

Score each point 0 to 2 and give a total out of 12. If the output cannot be judged, say unknown in your reason.
