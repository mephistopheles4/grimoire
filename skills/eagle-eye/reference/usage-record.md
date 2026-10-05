# The usage record

This file holds the detail of the usage record. `SKILL.md` holds its stop:
ask once, name the path and `EAGLE_EYE_LOG`, say why, and write nothing to the
log until the person says yes in chat. Nothing in this file removes that stop.

## Find the path (questions 5, 13)

1. Read the variable with a shell: `echo "$EAGLE_EYE_LOG"` in a POSIX shell,
   or `$env:EAGLE_EYE_LOG` in PowerShell. It names a file.
2. When it is empty, read the home folder with a shell (`echo "$HOME"`, or
   `$HOME` in PowerShell). Join it to `.grimoire/eagle-eye/log.jsonl`.
3. Use the absolute path from then on. File tools do not expand `~`.

A log at the earlier default, `.eagle-eye/log.jsonl` in the home folder, is not
this log. Never read, move or delete it.

## Read it before you write (question 13)

Read the path with your file tool, or with a shell (`test -f <path>`, or
`Test-Path <path>` in PowerShell). A "not found" error means no file.

| What is at the path | What you do |
|---|---|
| Nothing | Ask the fourth stop's question, unless the person said yes in this conversation. |
| A file whose every line is a JSON object with `"log":"eagle-eye"` | It is the log. Read its markers, then its open boxes (below). |
| The same, where the last marker is the declined marker | Never ask again. Write no line of any kind, start lines included. State the before and after in the debrief. |
| Anything else, including an empty file | Leave it alone. Tell the person what is there, and ask where to keep the log. |

The variable is not a yes. A path with no file there still needs the
question.

## The markers (question 13)

A marker records the person's answer to the fourth stop. Create the folder if
it is missing, and append the marker at the path at once.

On a yes:

```json
{"log":"eagle-eye","consent":true,"date":"2026-10-04"}
```

On a no:

```json
{"log":"eagle-eye","declined":true,"date":"2026-09-30"}
```

The consent marker is written the moment the person says yes, before any use
line. A session that starts later then reads the yes, and does not ask again.
After a yes, never create an empty file: an empty file reads as another file
(see the table above).

**When the log holds both markers.** Two sessions can ask before either gets
an answer, and the person can answer yes in one and no in the other. Read the
markers in file order. The last one holds. While the declined marker is the
last one, write no line of any kind.

## What each use line holds (question 13)

One JSON object per line (JSON Lines). A use is one box or chat table.

**A built box writes two lines with one key.**

- **The start line,** right after the box or chat table is first shown:

  ```json
  {"log":"eagle-eye","date":"2026-10-04","use":"log timing 2026-10-04 qzfa","phase":"start","fired":"by name","before":"Create the log at the yes"}
  ```

- **The end line,** after the debrief. It holds the fields of a finished use,
  with the same `use` and `"phase":"end"`.

**A declined offer writes one line,** with no `use` and no `phase`:

```json
{"log":"eagle-eye","date":"2026-09-30","fired":"offered","outcome":"declined","rowChanged":null,"before":"Paper forms","after":null,"reason":"The person wanted the quick route."}
```

| Field | Holds |
|---|---|
| `log` | Always `"eagle-eye"`. It marks the line as this skill's. |
| `date` | The date of the line, `YYYY-MM-DD`. |
| `use` | The key that pairs a start line with its end line: the box's topic in a few words, then the date, then four letters you pick at random. It needs no clock. Only start and end lines carry it. |
| `phase` | `"start"` or `"end"`. A line with no `phase` and an `outcome` is a finished use, from a decline or from before start lines existed. |
| `fired` | `"offered"` when eagle-eye fired on its own. `"by name"` when the person asked for it. |
| `outcome` | `"declined"`, `"built"` or `"unanswered"`. Not on a start line. |
| `rowChanged` | `true` when any row's chosen option changed between the first box and the accepted set, or a row was added. `false` when not. `null` when declined or unanswered. |
| `before` | The person's answer before the box, in one line. `"not stated"` when they gave none. |
| `after` | The decision after the box, in one line. `null` when declined or unanswered. |
| `reason` | One line that says why this use went the way it did. Not on a start line. |

Write names, never ids, in `before`, `after` and `reason`. Write nothing
secret and nothing personal into a line: the file outlives the conversation.

## Open boxes (question 13)

A start line with no end line of the same `use` is an open box. The person
may have dropped it, or it may still be open in another session.

When you read the log at the start of a use, find the open boxes. Ask about
them first, before the person's leaning and before any box. For each one, ask
the person in one line:

> A box on <topic> from <date> has no answer. Is it still open?

- **No:** append its end line, with `"outcome":"unanswered"`, `rowChanged` and
  `after` set to `null`, and a reason.
- **Yes, or no answer:** write nothing. The question can come again at a later
  use.

Never decide by yourself that an open box was dropped.

## Add a line and keep the others (question 13)

A plain file write replaces the whole file, and the review needs every
earlier line. So append the new line, and never write the file whole: two
sessions that each read the file and write it back can drop each other's
line.

Append with a shell. For example `printf '%s\n' '<line>' >> <path>`, or
`Add-Content -Path <path> -Value '<line>'` in PowerShell. Quote the line so the
shell does not change it.

After the write, read the last line back, and check that the earlier lines
are still there.

## The four signals (question 13)

A finished use is an end line, or a line with an `outcome` and no `phase`.
Start lines and markers are not uses. Read the last 10 finished uses after you
write one. With fewer than 10, read all of them. Count each signal on its own:

| Signal | A use counts when |
|---|---|
| **Cries wolf** | `fired` is `"offered"` and `outcome` is `"declined"`. The person turned down the offer. |
| **Rubber stamp** | `outcome` is `"built"` and `rowChanged` is `false`. The person accepted the set without changing a row. |
| **Nothing changes** | `outcome` is `"built"` and `after` states the same decision as `before`. |
| **Goes unanswered** | `outcome` is `"unanswered"`. The person said the box is no longer open, and it never got an answer. |

## Review (questions 7, 13)

**When any one signal reaches 5 of the last 10 uses,** tell the person which
signal, show the lines that count, and ask for a review.

**At 10 finished uses, and at every 10 after,** report the four counts to the
person in one short table, even when no signal reached 5.

The record proposes. It changes nothing by itself. Only the person's review
can cut or retune the skill. A count is not a verdict: unchanged acceptance
and an unchanged decision are also what good advice produces. A change the
person accepts goes into the contract's change log (question 7), and the
skill is generated again from the contract.
