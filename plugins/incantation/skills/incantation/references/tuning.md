# When Incantation speaks: the settings to tune

This is the one file the speech policy is tuned in. Every value here is a
starting point, set before the first practice run. The person changes it by
editing the file; no session writes it during a run. It holds no heard text and
no stated preference.

It never holds the yes rules, the typed-yes list, the stop words, the
never-speak list, or any listener setting. Those stay fixed in `SKILL.md`.

## The speak gate

Each thing the session might say unasked is a candidate. Give it an urgency from
0 to 10 and, where it has one, a deadline. Its score is the urgency, plus 2 when
a deadline falls within the next 10 minutes, plus 2 when the person must decide
or approve something before work can go on. Speak only a candidate whose score is
over the gate.

- **Starting gate:** 6.
- **Kinds that may pass the gate:** a result that is ready and needed, a decision
  or permission the session needs, a real risk, a definite failure.
- **Kinds that never pass it:** finished work with nothing to decide, status,
  progress, a remark.

## The dial

The person turns the gate with their words, for that session only.

- "Quieter", "less", "only the important things": raise the gate by 2, to at
  most 9.
- "Tell me more", "keep me posted": lower the gate by 2, to at least 3.
- "Back to normal": return to the starting gate.

## Holding for a break

A candidate that passes waits for a natural break: a build or test ends, a commit
lands, or the person stops talking. It is never held past its deadline.

## How much

- **Default length:** one sentence, written fresh for speech. Keep a clause only
  if dropping it would lose something the person needs. Detail goes to chat.
- **"Just the gist":** a clause or two, for that session.
- **"Tell me everything":** as much as the person asked for, for that session.
  The never-speak list still holds.

## After a long quiet

- **Pause threshold:** 5 minutes with nothing heard and nothing said.
- **Growth:** add 2 minutes for each 5 minutes the session has worked on one task
  without the person speaking, to at most 15 minutes.
- **Wait for an answer to "are you there?":** 20 seconds.
- Check in only when something longer than a sentence is pending. With nothing
  pending, say nothing.

## Backchannels

These words, alone, while the session speaks or works, are not requests, not
interruptions and never a yes: "mhm", "uh huh", "okay", "ok", "right", "sure",
"yeah", "got it", "go on".

## Example phrases

Starting points for tone. Rewrite them in the moment; never read one out as a
template.

- A result: "The tests pass on your branch. Want the summary?"
- A decision: "I need a choice: merge now, or wait for the review?"
- A risk: "That command would delete the build folder. I need you to type the
  yes for it."
- A failure: "The build failed on the first step. The error is in chat."
- A check-in: "Hey, are you there? I have one thing waiting."
