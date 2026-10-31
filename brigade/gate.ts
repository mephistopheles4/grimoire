import type { Card } from './types'
import type { Target } from './cleanup.ts'
import { cardId } from './cleanup.ts'
import { oneLine } from './roster.ts'

// The cleanup gate (issue 359, spec v5.2): the owner's typed `/brigade done`
// opens a short window in module memory, and only inside it does Desktop's
// archive tool pass, or `stop_background_session` stop a background session.
// Plain TypeScript with no engine import, so tests/brigade-gate.test.mjs runs
// these rules directly. No shell text is read anywhere here.

/** Desktop's archive tool, by the name ADR 0012 measured (A14). */
export const ARCHIVE_TOOL = 'mcp__ccd_session_mgmt__archive_session'

/** How long a window stays open: ADR 0012 measured module memory lasting 17 minutes (A11). */
export const WINDOW_MS = 15 * 60 * 1000

const MAX_TITLES = 20
// As the roster draws a title.
const MAX_TITLE = 80

/** One open window: a session's id, by kind, and when it opened. */
export type Entry = { kind: 'desktop' | 'bg'; id: string; openedAt: number }
export type Window = Map<string, Entry>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const keyOf = (kind: string, id: string) => `${kind}:${id}`

/** Whether a `/brigade` command's args are the done command. */
export const isDoneCommand = (args: unknown): args is string => typeof args === 'string' && /^\s*done(?:\s|$)/.test(args)

export const DONE_REPLIES = {
  notTyped: 'Nothing opened: /brigade done counts only when the owner types it at the prompt or sends it from the phone.',
  usage: 'Nothing opened: type /brigade done <title>, <title>, ... with 1 to 20 card titles.',
  failed: 'Nothing opened: the done command failed.',
} as const

/** The titles after `done`, each as the roster draws it, or undefined for the usage reply. */
export function parseDone(args: string): string[] | undefined {
  const titles = args.replace(/^\s*done/, '').split(',').map(t => oneLine(t, MAX_TITLE))
  if (titles.length > MAX_TITLES || titles.some(t => t === '')) return undefined
  return titles
}

export type Resolved = { title: string; open: { kind: 'desktop' | 'bg'; id: string } } | { title: string; why: string }

/** Each title to the one card it names, bound to its session, whose session
 *  carried that same name when the card joined; else a fixed reason. */
export function resolveTitles(
  titles: readonly string[],
  cards: readonly Pick<Card, 'title' | 'desktopId' | 'bgId'>[],
  targets: ReadonlyMap<string, Pick<Target, 'kind' | 'name'>>,
): Resolved[] {
  return titles.map(title => {
    const named = cards.filter(c => oneLine(c.title, MAX_TITLE) === title)
    if (named.length === 0) return { title, why: 'no card has this title' }
    if (named.length > 1) return { title, why: 'more than one card has this title' }
    const own = cardId(named[0])
    const t = own === undefined ? undefined : targets.get(own.id)
    if (own === undefined || t === undefined || t.kind !== own.kind) return { title, why: 'not bound to its session' }
    if (t.name !== title) return { title, why: 'changed since it joined' }
    return { title, open: own }
  })
}

/** The command's reply: fixed words and the cleaned titles, never an id or a path. */
export function doneReply(resolved: readonly Resolved[]): string {
  const opened = resolved.filter(r => 'open' in r).map(r => r.title)
  const lines = [`Opened ${opened.length} of ${resolved.length} for 15 minutes${opened.length > 0 ? `: ${opened.join(', ')}` : ''}.`]
  for (const r of resolved) if ('why' in r) lines.push(`Not opened: ${r.title}: ${r.why}.`)
  if (opened.length > 0) lines.push('Now send any message, so this session acts on them.')
  return lines.join('\n')
}

/** Opens one entry for each resolved title, each with a new 15 minutes. */
export function openWindow(window: Window, resolved: readonly Resolved[], now: number): void {
  for (const r of resolved) if ('open' in r) window.set(keyOf(r.open.kind, r.open.id), { ...r.open, openedAt: now })
}

/** Takes an open entry: true, and the entry closes, only when it is open and
 *  under 15 minutes old. An entry past its time closes too. */
export function takeEntry(window: Window, kind: 'desktop' | 'bg', id: string, now: number): boolean {
  const k = keyOf(kind, id)
  const e = window.get(k)
  if (e === undefined) return false
  window.delete(k)
  return now >= e.openedAt && now - e.openedAt < WINDOW_MS
}

/** Whether a dispatch came from the engine itself, the model's own call,
 *  rather than from another plugin's `$` call. The engine's types name
 *  `next.origin` as `{ plugin, tier }`, reading `{ plugin: "engine", tier:
 *  "core" }` for the engine; ADR 0012's A4 measured another plugin's name
 *  there. The model's own call is measured at the field test (H1). */
export const fromEngine = (origin: unknown): boolean => isRecord(origin) && origin.plugin === 'engine' && origin.tier === 'core'

// The engine's own fields on a tool call, as brigade/scan.ts lists them.
// Everything else is the model's input.
const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']

/** Whether an archive call passes: the model's own call on the main loop,
 *  with `session_id` and at most a string `reason`, for an open Desktop
 *  entry, which it closes. It reads only those facts and keeps nothing. */
export function archivePasses(e: Record<string, unknown>, origin: unknown, window: Window, now: number): boolean {
  if (e.agentId !== undefined || !fromEngine(origin)) return false
  const keys = Object.keys(e).filter(k => !ENVELOPE.includes(k))
  if (keys.some(k => k !== 'session_id' && k !== 'reason')) return false
  if (e.reason !== undefined && typeof e.reason !== 'string') return false
  const id = e.session_id
  if (typeof id !== 'string' || id === 'self') return false
  return takeEntry(window, 'desktop', id, now)
}

/** The stop tool's answer, in fixed words whatever the run printed, exited
 *  with or rejected with: only an exit of 0 is a stop. */
export function stopAnswer(ran: unknown): string {
  if (isRecord(ran) && ran.exitCode === 0) return "Stopped: claude stop ran and exited 0. The worktree and branch stay for read_cleanup's re-read."
  return 'Not stopped: claude stop did not run, or did not exit 0. The window for it is used; the owner types /brigade done again, or stops it by hand.'
}

/** The archive hook's one refusal: no id, reason or key. */
export const ARCHIVE_REFUSAL = "Archive refused: no /brigade done window is open for this session. The owner types /brigade done <title> to open one, or archives it by hand in Desktop."
