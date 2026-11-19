# The usage record

This file holds the formats of the usage record. `SKILL.md` holds its rules:
the path, the consent stop, and the review.

## Contents

- Read the path before you write
- The markers
- What each use line holds
- Open boxes
- The four signals

## Read the path before you write

Read the home folder from a shell. A shell reads `EAGLE_EYE_LOG` too, and file
tools do not expand `~`. Use the absolute path from then on.

| What is at the path | What you do |
|---|---|
| Nothing | Ask for consent, unless the person said yes in this conversation. |
| A file whose every line is a JSON object with `"log":"eagle-eye"` | It is the log. When its last marker is the declined marker, write no line of any kind. |
| Anything else, including an empty file | Leave it alone. Tell the person what is there, and ask where to keep the log. |

## The markers

Create the folder if it is missing. Append the marker at once, before any use
line. Never create an empty file.

```json
{"log":"eagle-eye","consent":true,"date":"2026-10-04"}
{"log":"eagle-eye","declined":true,"date":"2026-09-30"}
```

When the log holds both, the later one holds.

## What each use line holds

One JSON object per line. A built box writes a **start line** when first shown
and an **end line** after the debrief, with the same `use` key. A declined offer
writes one line, with no `use` and no `phase`.

```json
{"log":"eagle-eye","date":"2026-10-04","use":"log timing 2026-10-04 qzfa","phase":"start","fired":"by name","before":"Create the log at the yes"}
{"log":"eagle-eye","date":"2026-09-30","fired":"offered","outcome":"declined","rowChanged":null,"before":"Paper forms","after":null,"reason":"The person wanted the quick route."}
```

| Field | Holds |
|---|---|
| `log` | Always `"eagle-eye"`. |
| `date` | `YYYY-MM-DD`. |
| `use` | The key that pairs a start line with its end line: the topic in a few words, the date, four random letters. Start and end lines only. |
| `phase` | `"start"` or `"end"`. |
| `fired` | `"offered"` or `"by name"`. |
| `outcome` | `"declined"`, `"built"` or `"unanswered"`. Not on a start line. |
| `rowChanged` | `true` when any chosen option changed or a row was added, else `false`. `null` when declined or unanswered. |
| `before` | The person's answer before the box, in one line. `"not stated"` when none. |
| `after` | The decision after the box, in one line. `null` when declined or unanswered. |
| `reason` | One line: why this use went the way it did. Not on a start line. |

Write names, never ids. Write nothing secret and nothing personal.

## Open boxes

A start line with no end line of the same `use` is an open box. While a log is
kept, ask first, in one line: *"A box on <topic> from <date> has no answer. Is
it still open?"* On a no, append its end line with `"outcome":"unanswered"`,
`rowChanged` and `after` set to `null`, and a reason. On a yes, or no answer,
write nothing. Never decide yourself that a box was dropped.

## The four signals

Read the last 10 finished uses after you write one. A finished use is an end
line, or a line with an `outcome` and no `phase`.

| Signal | A use counts when |
|---|---|
| **Cries wolf** | `fired` is `"offered"` and `outcome` is `"declined"`. |
| **Rubber stamp** | `outcome` is `"built"` and `rowChanged` is `false`. |
| **Nothing changes** | `outcome` is `"built"` and `after` states the same decision as `before`. |
| **Goes unanswered** | `outcome` is `"unanswered"`. |

Append with a shell, and never write the file whole, or two sessions can drop
each other's line. A change the person accepts after a review goes into the
contract's change log.
