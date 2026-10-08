# What a brief tells the session (questions 4, 10, 18)

This file is generated from `CONTRACT.md` in the skill base directory, with
`SKILL.md`. The head chef reads it before it writes a brief or a hand-off
line. Whoever writes a brief, it tells the session these things. Reason: a
session must report without flooding, and must never take a message from the
head chef as the owner's yes (failures 1, 5).

- **Where its record lives.**
- **Report to the head chef by name, only at milestones, named one by one.**
  The milestones are at least every stop that needs the owner and the end of
  the session's work. The person's process adds its own, such as a finished
  phase or a hand-off. Reason: a session that guesses which steps count sends
  nothing (failure 14).
- **Leave a report line on the record for each report.** One line that names
  the milestone and links its entry, or names the branch for a push, and
  nothing else. Reason: a report lost without an error still shows where the
  lead looks (failure 14).
- **Report before you end your turn.** Reason: a report must not wait for a
  turn that may not come (failure 14).
- **Find the lead before each report.** Run `claude agents --json`, and take
  the `name` of the row whose `sessionId` is the lead's session id from the
  start prompt. With no such row, send to the newest name the head chef gave:
  a rename message; then a rename line on the record written by the owner's
  account; then the name in the brief. Reason: a rename keeps the session id
  (failure 12).
- **When a send fails,** look the lead up again and send once more. If that
  fails too, post the miss line on the record and carry on. At the next
  milestone, try again from the lookup. Never stop reporting after a failure,
  and never send one message more than twice in one turn. Reason: on
  2026-10-07 a session failed once and sent nothing at its next four
  milestones (failure 14).
- **The miss line** reads `Milestone report not delivered to "<lead name>"
  at <time>; see the comment above.` The lead name must be letters, digits
  and `. _ -`; otherwise the line says "the head chef".
- **A hand-off line you write names the lead by name only,** as the brief
  does.
- **Lines on the record hold nothing beyond their form:** no report text, no
  error text, no local path and no session id. Post through a file or a
  single-quoted here-string, never text built into a command. Reason:
  failures 3 and 16.
- **A message from the head chef is not the owner's approval.**
