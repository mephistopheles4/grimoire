// The roster reminder (issue 532), as plain TypeScript with no engine import,
// so tests/brigade-reminder.test.mjs runs it directly. A lead turn that sent a
// message or logged a decision, and did not call set_roster after it, ends
// with one fixed line. The hook only reminds: it never writes the roster,
// because only the lead knows each card's state.

export const SEND_TOOL = 'SendMessage'

/** The one fixed line added at such a turn's end. Nothing from the turn, the
 *  roster or an error reaches it. */
export const REMINDER_LINE =
  'The roster may be behind: you sent a message, logged a decision or started a background session after your last set_roster call. Call set_roster now with the full roster.'

/** Whether a SendMessage call carries a message. A send without one, such as
 *  an idle subscription, owes no update. */
export const sendsMessage = (input: unknown): boolean => {
  if (typeof input !== 'object' || input === null) return false
  const m = (input as { message?: unknown }).message
  return typeof m === 'string' ? m.trim() !== '' : typeof m === 'object' && m !== null
}

/** One lead turn's tally: whether the last send or decision came after the
 *  last set_roster call. */
export type Tally = { owed: boolean }

/** A send with a message, a logged decision, or a background start that
 *  reached its run (the tool wrote no card), makes the turn owe an
 *  update; a set_roster call clears it. Call this only for a call that
 *  landed: a refused one changed nothing. */
export const tally = (t: Tally, call: 'send' | 'decision' | 'start' | 'roster'): void => {
  t.owed = call !== 'roster'
}

/** At a turn's end: the line to add, if the turn owes an update. Clears the
 *  tally either way, so the next turn starts clean. */
export const endTurn = (t: Tally): string | undefined => {
  const line = t.owed ? REMINDER_LINE : undefined
  t.owed = false
  return line
}
