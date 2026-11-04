import type { Card } from './types'
import type { SessionRow } from './roster.ts'
import { oneLine } from './roster.ts'

// The stop tool's rules (issue 516; ADR 0016), as plain TypeScript with no
// engine import, so tests/brigade-stop.test.mjs runs them directly. Brigade
// removes nothing and runs no cleaner. It stops one background session, by
// its card's title, on the owner's words in the lead's chat.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const MAX_TITLE = 80

/** Whether a dispatch came from the engine itself, the model's own call,
 *  rather than from another plugin's `$` call. The engine's types name
 *  `next.origin` as `{ plugin, tier }`, reading `{ plugin: "engine", tier:
 *  "core" }` for the engine; ADR 0012's A4 measured another plugin's name
 *  there. */
export const fromEngine = (origin: unknown): boolean => isRecord(origin) && origin.plugin === 'engine' && origin.tier === 'core'

// The engine's own fields on a tool call, by name. Everything else is the
// model's input.
export const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']

/** The session files as one read of them came back: the rows, whether every
 *  file was read, and whether a file went between the listing and the read. */
export type Sessions = { rows: readonly SessionRow[]; complete: boolean; fileGone: boolean }

export type Stop = { jobId: string } | { why: string }

/** The one background session a title names: exactly one roster card draws as
 *  the title, it carries a job id and no Desktop id, and exactly one row of a
 *  complete read carries that job id under the same drawn name. Anything else
 *  is a fixed reason, with no id or path. */
export function stopTarget(title: string, cards: readonly Pick<Card, 'title' | 'desktopId' | 'bgId'>[], sessions: Sessions): Stop {
  const drawn = oneLine(title, MAX_TITLE)
  const named = cards.filter(c => oneLine(c.title, MAX_TITLE) === drawn)
  if (named.length === 0) return { why: 'session: no card on the roster has this title' }
  if (named.length > 1) return { why: 'session: more than one card has this title' }
  const card = named[0]
  if (card.bgId === undefined || card.desktopId !== undefined) return { why: 'session: the card is not a background session' }
  if (!sessions.complete || sessions.fileGone) return { why: 'session: the session files could not be read whole' }
  const own = sessions.rows.filter(r => r.jobId === card.bgId)
  if (own.length === 0) return { why: 'session: no session file carries its job id' }
  if (own.length > 1) return { why: 'session: two session files carry its job id' }
  if (oneLine(own[0].name, MAX_TITLE) !== drawn) return { why: 'session: its name is not the card title' }
  return { jobId: card.bgId }
}

/** The stop tool's answer, in fixed words whatever the run printed, exited
 *  with or rejected with: only an exit of 0 is a stop. */
export function stopAnswer(ran: unknown): string {
  if (isRecord(ran) && ran.exitCode === 0) return 'Stopped: claude stop ran and exited 0. Its worktree and branch stay.'
  return 'Not stopped: claude stop did not run, or did not exit 0. Tell the owner, who can stop it by hand.'
}
