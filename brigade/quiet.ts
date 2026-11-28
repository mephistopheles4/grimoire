// The quiet-member watch (spec 0006), as plain TypeScript with no engine
// import, so tests/brigade-quiet.test.mjs runs it directly. A member whose
// card is `working`, whose session went idle or vanished, and which has sent
// the lead no report since the lead's last message to it, is noted to the lead
// once, after a grace period. The lead then subscribes to no idle notice.
//
// Everything here is module memory, keyed by card title: a reload starts
// every window again. Nothing reaches plugin state or a file, and no tool
// reads it: the lead sees it only as the note's text.

import {
  TITLE,
// @ts-expect-error TS5097: Node needs the extension.
} from './quick.ts'
import type { Card } from './types'
import type { SessionRow } from './roster.ts'

/** How long a member stays idle or gone with no report before it is noted. */
export const GRACE_MS = 120000
/** The least time between two notes. */
export const QUIET_GAP_MS = 60000
/** The most titles one note names. */
const MAX_TITLES = 10
/** The longest attribute value read from the wrapper. */
const MAX_ATTR = 200

/** The watch's state, in milliseconds on the engine clock, by card title. */
export type Watch = {
  /** The lead's last delivered message to the member. */
  sent: Map<string, number>
  /** The member's last report to the lead. */
  heard: Map<string, number>
  /** The first poll that saw an idle row with no update time. */
  idleSeen: Map<string, number>
  /** The cards that had one row at an earlier full read. */
  seen: Set<string>
  /** The first full read that found a seen card with no row. */
  goneSeen: Map<string, number>
  /** The window start a landed note named the card for. */
  noted: Map<string, number>
  /** The cards a note names while its submit has not resolved. */
  pending: Set<string>
  /** When the last note went. */
  lastNote?: number
}

export const newWatch = (): Watch => ({
  sent: new Map(),
  heard: new Map(),
  idleSeen: new Map(),
  seen: new Set(),
  goneSeen: new Map(),
  noted: new Map(),
  pending: new Set(),
})

/** A note the poll found: its text, and each card it names with the window
 *  start it names it for. The caller marks them with `landed` once the
 *  submit resolves with no drop. */
export type Quiet = { text: string; cards: readonly (readonly [string, number])[] }

// The engine's wrapper around a peer's message: its opening tag only.
const OPENING = /^\s*<cross-session-message\b([^>]*)>/
const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}="([^"]{1,${MAX_ATTR}})"`).exec(tag)
  return m?.[1]
}

/** The sender a delivery's wrapper claims: its session id and its name.
 *  Text with no wrapper at its start claims neither. */
export function sender(text: string): { session?: string; name?: string } {
  const m = OPENING.exec(text)
  if (m === null) return {}
  const session = attr(m[1], 'from-session')
  const name = attr(m[1], 'from-name')
  return { ...(session === undefined ? {} : { session }), ...(name === undefined ? {} : { name }) }
}

/** The titles of the cards whose one matched row passes `pick`. */
const cardsWhere = (cards: readonly Card[], matched: ReadonlyMap<string, readonly SessionRow[]>, pick: (row: SessionRow) => boolean): string[] =>
  cards.flatMap(c => {
    const rows = matched.get(c.title)
    return rows !== undefined && rows.length === 1 && pick(rows[0]) ? [c.title] : []
  })

/** A lead's delivered message: the `to` as the lead wrote it, its listing ref
 *  cut, moves the window of each card whose one row has that name. An
 *  address, an id or an object moves none. */
export function sentTo(w: Watch, cards: readonly Card[], matched: ReadonlyMap<string, readonly SessionRow[]>, to: unknown, now: number): void {
  if (typeof to !== 'string') return
  const name = to.trim().replace(/ \[[0-9a-f]+\]$/, '')
  if (name === '') return
  for (const title of cardsWhere(cards, matched, r => r.name === name)) w.sent.set(title, now)
}

/** A peer's delivery: a report from each card whose one row holds the claimed
 *  session id; with none, from each whose row has the claimed name. */
export function heardFrom(w: Watch, cards: readonly Card[], matched: ReadonlyMap<string, readonly SessionRow[]>, text: string, now: number): void {
  const { session, name } = sender(text)
  let titles = session === undefined ? [] : cardsWhere(cards, matched, r => r.sessionId === session || r.hostId === session)
  if (titles.length === 0 && name !== undefined) titles = cardsWhere(cards, matched, r => r.name === name)
  for (const title of titles) w.heard.set(title, now)
}

/** The note's text for these titles: those that pass the title check, at
 *  most ten, and a count for the rest. Nothing else from the roster or a
 *  session reaches it. */
export function quietNote(titles: readonly string[]): string {
  const shown = titles.filter(t => TITLE.test(t)).slice(0, MAX_TITLES)
  const rest = titles.length - shown.length
  const who =
    shown.length === 0
      ? `${rest} ${rest === 1 ? 'member' : 'members'}`
      : `${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
  return `Brigade (plugin note): ${who} went idle or stopped with no report since your last message. Ask each once, as head-chef's "Sending and idle notices" says.`
}

/** One full read's check: the note to submit, or undefined. It stamps the
 *  gap and holds the cards it names as pending, so no later poll names them
 *  while the submit waits; `landed` marks them noted, and `released` lets a
 *  dropped note's cards be found again after the gap. It drops every title
 *  not in `cards`. Call it only after a complete read of the session files: a
 *  card missing from a partial read is not gone. */
export function quietCheck(w: Watch, cards: readonly Card[], matched: ReadonlyMap<string, readonly SessionRow[]>, now: number): Quiet | undefined {
  const titles = new Set(cards.map(c => c.title))
  for (const map of [w.sent, w.heard, w.idleSeen, w.goneSeen, w.noted]) {
    for (const t of [...map.keys()]) if (!titles.has(t)) map.delete(t)
  }
  for (const set of [w.seen, w.pending]) for (const t of [...set]) if (!titles.has(t)) set.delete(t)
  if (!Number.isFinite(now)) return undefined
  const quiet: [string, number][] = []
  for (const c of cards) {
    const rows = matched.get(c.title) ?? []
    let from: number
    if (rows.length === 0 && w.seen.has(c.title)) {
      // The session is gone: it crashed, or ended with no report.
      w.idleSeen.delete(c.title)
      if (!w.goneSeen.has(c.title)) w.goneSeen.set(c.title, now)
      from = w.goneSeen.get(c.title) ?? now
    } else {
      w.goneSeen.delete(c.title)
      const row = rows.length === 1 ? rows[0] : undefined
      if (row !== undefined) w.seen.add(c.title)
      if (row === undefined || row.status !== 'idle') {
        w.idleSeen.delete(c.title)
        continue
      }
      if (row.updatedAt === undefined && !w.idleSeen.has(c.title)) w.idleSeen.set(c.title, now)
      from = row.updatedAt ?? w.idleSeen.get(c.title) ?? now
    }
    if (c.status !== 'working') continue
    const start = Math.max(w.sent.get(c.title) ?? -Infinity, c.since ?? -Infinity)
    const heard = w.heard.get(c.title)
    if (heard !== undefined && heard >= start) continue
    if (now - Math.max(start, from) < GRACE_MS) continue
    if (w.noted.get(c.title) === start || w.pending.has(c.title)) continue
    quiet.push([c.title, start])
  }
  if (quiet.length === 0) return undefined
  if (w.lastNote !== undefined && now - w.lastNote < QUIET_GAP_MS) return undefined
  w.lastNote = now
  for (const [title] of quiet) w.pending.add(title)
  return { text: quietNote(quiet.map(q => q[0])), cards: quiet }
}

/** A note's submit resolved with no drop: each card it named is noted for its
 *  window. */
export function landed(w: Watch, q: Quiet): void {
  for (const [title, start] of q.cards) {
    w.noted.set(title, start)
    w.pending.delete(title)
  }
}

/** A note's submit was dropped or rejected: its cards may be found again. */
export function released(w: Watch, q: Quiet): void {
  for (const [title] of q.cards) w.pending.delete(title)
}
