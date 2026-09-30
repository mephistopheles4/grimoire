# The usage record

This file holds the detail of the usage record. `SKILL.md` holds its stop:
ask once, name the path and `EAGLE_EYE_LOG`, say why, and write no use line
until the person says yes in chat. Nothing in this file removes that stop.

## Find the path (questions 5, 13)

1. Read the variable with a shell: `echo "$EAGLE_EYE_LOG"` in a POSIX shell,
   or `$env:EAGLE_EYE_LOG` in PowerShell.
2. When it is empty, read the home folder with a shell (`echo "$HOME"`, or
   `$HOME` in PowerShell). Join it to `.eagle-eye/log.jsonl`.
3. Use the absolute path from then on. File tools do not expand `~`.

## Read it before you write (question 13)

Read the path with your file tool, or with a shell (`test -f <path>`, or
`Test-Path <path>` in PowerShell). A "not found" error means no file.

| What is at the path | What you do |
|---|---|
| Nothing | Ask the fourth stop's question, unless the person said yes in this conversation. Then the file does not exist yet; the first use line creates it. |
| A file whose every line is a JSON object with `"log":"eagle-eye"` | It is the log. Add use lines to it. |
| The same, with a declined marker in it | Never ask again. Write no use line. State the before and after in the debrief. |
| Anything else, including an empty file | Leave it alone. Tell the person what is there, and ask where to keep the log. |

The variable is not a yes. A path with no file there still needs the
question.

## The declined marker (question 13)

On a no, create the folder if it is missing, and write this one line at the
path:

```json
{"log":"eagle-eye","declined":true,"date":"2026-09-30"}
```

Write nothing else there, then or later.

## What each use line holds (question 13)

One JSON object per line (JSON Lines). After a yes, do not create an empty
file: an empty file reads as another file (see the table above). Create the
folder and the file when you write the first use line. Write one line for
each use:

- when the person declines the offer to build a box; or
- when the person accepts a set, after the debrief.

```json
{"log":"eagle-eye","date":"2026-09-30","fired":"offered","outcome":"built","rowChanged":true,"before":"Paper forms, kept in the office","after":"Online forms, kept in the office","reason":"The storage row changed after its edge to the audit row was checked."}
```

| Field | Holds |
|---|---|
| `log` | Always `"eagle-eye"`. It marks the line as this skill's. |
| `date` | The date of the use, `YYYY-MM-DD`. |
| `fired` | `"offered"` when eagle-eye fired on its own. `"by name"` when the person asked for it. |
| `outcome` | `"declined"` or `"built"`. |
| `rowChanged` | `true` when any row's chosen option changed between the first box and the accepted set, or a row was added. `false` when not. `null` when declined. |
| `before` | The person's answer before the box, in one line. `"not stated"` when they gave none. |
| `after` | The decision after the box, in one line. `null` when declined. |
| `reason` | One line that says why this use went the way it did. |

Write names, never ids, in `before`, `after` and `reason`. Write nothing
secret and nothing personal into a line: the file outlives the conversation.

## Add a line and keep the others (question 13)

A plain file write replaces the whole file, and the review needs every
earlier line. Use one of these:

- **Read, then write back.** Read the whole file, add the new line at the
  end, and write the whole text back.
- **Append with a shell.** For example `printf '%s\n' '<line>' >> <path>`, or
  `Add-Content -Path <path> -Value '<line>'` in PowerShell. Quote the line so
  the shell does not change it.

After the write, read the last line back, and check that the earlier lines
are still there.

## The three signals (question 13)

Read the last 10 use lines after you write one. With fewer than 10, read all
of them. Count each signal on its own:

| Signal | A line counts when |
|---|---|
| **Cries wolf** | `fired` is `"offered"` and `outcome` is `"declined"`. The person turned down the offer. |
| **Rubber stamp** | `outcome` is `"built"` and `rowChanged` is `false`. The person accepted the set without changing a row. |
| **Nothing changes** | `outcome` is `"built"` and `after` states the same decision as `before`. |

## Review (questions 7, 13)

**When any one signal reaches 5 of the last 10 uses,** tell the person which
signal, show the lines that count, and ask for a review.

**At 10 use lines, and at every 10 after,** report the three counts to the
person in one short table, even when no signal reached 5.

The record proposes. It changes nothing by itself. Only the person's review
can cut or retune the skill. A count is not a verdict: unchanged acceptance
and an unchanged decision are also what good advice produces. A change the
person accepts goes into the contract's change log (question 7), and the
skill is generated again from the contract.
