import type { Card } from './types'
import type { Target } from './cleanup.ts'
import { NO_NAME, cardId, commandPath, lastName } from './cleanup.ts'
import { foldsCase, oneLine, pathKey } from './roster.ts'

// The cleanup gate (issue 359, spec v5.2; issue 484): the owner's typed
// `/brigade done` opens a short window in module memory, and only inside it
// does Desktop's archive tool pass, `stop_background_session` stop a
// background session, or `clean_up` run the pact's cleaner. That typed
// command is the owner's only yes. Plain TypeScript with no engine import, so
// tests/brigade-gate.test.mjs runs these rules directly. No shell text is read
// anywhere here.

/** Desktop's archive tool, by the name ADR 0012 measured (A14). */
export const ARCHIVE_TOOL = 'mcp__ccd_session_mgmt__archive_session'

/** How long a window stays open: ADR 0012 measured module memory lasting 17 minutes (A11). */
export const WINDOW_MS = 15 * 60 * 1000

const MAX_TITLES = 20
// As the roster draws a title.
const MAX_TITLE = 80

/** One open window: a session's id, by kind, and when it opened. A `clean`
 *  entry lets `clean_up` run for that card's folder. */
export type Entry = { kind: 'desktop' | 'bg' | 'clean'; id: string; openedAt: number }
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

/** `all` or `none` when it is the whole argument after `done`, trimmed;
 *  inside a comma list each is a title. */
export function doneWord(args: string): 'all' | 'none' | undefined {
  const rest = args.replace(/^\s*done/, '').trim()
  return rest === 'all' || rest === 'none' ? rest : undefined
}

export const NOTHING_DONE = 'Nothing opened: no card is done.'
export const NONE_REPLY = 'Closed: no window is open.'

export type Resolved = { title: string; open: { kind: 'desktop' | 'bg'; id: string } } | { title: string; why: string }

/** `done all`: every card the pane shows with status `done`, dismissed cards
 *  left out, each title through resolveTitles as a typed one is; a done card
 *  titled `all` or `none` is not opened this way. Past 20 done cards,
 *  undefined, for the usage reply. */
export function resolveAll(
  cards: readonly Pick<Card, 'title' | 'status' | 'desktopId' | 'bgId'>[],
  dismissed: readonly string[],
  targets: ReadonlyMap<string, Pick<Target, 'kind' | 'name'>>,
): Resolved[] | undefined {
  const shown = cards.filter(c => c.status === 'done' && !dismissed.includes(c.title))
  if (shown.length > MAX_TITLES) return undefined
  return shown.map(c => {
    const title = oneLine(c.title, MAX_TITLE)
    if (title === 'all' || title === 'none') return { title, why: 'its title is a command word' }
    return resolveTitles([title], cards, targets)[0]
  })
}

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

/** The cleaner's folder-name rule: letters, digits, `.`, `_` and `-`, not
 *  starting with `.` or `-`. */
const FOLDER = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/** The repository and folder the pact's cleaner may be run for: the target's
 *  repository folder ends in `.git`, its parent `<main>` passes commandPath,
 *  and the target's folder sits directly under `<main>/.claude/worktrees`,
 *  by the roster's path rule, with a name inside the cleaner's rule. */
export function cleanFolder(t: Pick<Target, 'cwd' | 'repo'>): { main: string; folder: string } | undefined {
  const repo = /^(.*)[\\/]\.git[\\/]*$/.exec(t.repo)
  if (repo === null || !commandPath(repo[1])) return undefined
  const main = repo[1]
  const cwd = t.cwd.replace(/[\\/]+$/, '')
  const cut = Math.max(cwd.lastIndexOf('/'), cwd.lastIndexOf('\\'))
  const folder = cwd.slice(cut + 1)
  const fold = foldsCase(main)
  if (cut < 0 || !FOLDER.test(folder) || pathKey(cwd.slice(0, cut), fold) !== pathKey(`${main}/.claude/worktrees`, fold)) return undefined
  return { main, folder }
}

/** A name in quotes, as the pact's cleaner prints one: a backslash doubled,
 *  a quote escaped, and any control, separator or format character but the
 *  space as \u{hex}. */
export function quoted(s: string): string {
  return `"${s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\\"]/gu, ch => (ch === ' ' ? ' ' : ch === '\\' ? '\\\\' : ch === '"' ? '\\"' : `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`))}"`
}

export const CLEAN_LINES = [
  'Folders and branches are as they were when each session joined.',
  'Each worktree and branch goes only if the cleaner finds everything in it recoverable; anything else stays and is listed after.',
] as const
export const UNDO_LINE = "The lead may act on this at its next turn, which a member's message can start. To take it back, type /brigade done none now."
export const PANE_CLOSED_LINE = 'The Brigade pane is closed, so the stop and the cleanup will be refused: send /brigade to open it, then any message.'

/** One opened card's line: its title in quotes, then labelled fields read from
 *  the target bound when it joined. No id, no path. */
function cardLine(title: string, t: Pick<Target, 'kind' | 'cwd' | 'repo' | 'branch'> | undefined): string {
  if (t === undefined) return `${quoted(title)}: not bound to its session`
  const name = lastName(t.repo)
  const where = cleanFolder(t)
  return [
    `${quoted(title)}: ${t.kind === 'desktop' ? 'Desktop' : 'background'}`,
    name === NO_NAME ? name : `repository ${quoted(name)}`,
    where === undefined ? 'no folder the cleaner can remove' : `folder ${where.folder}`,
    t.branch === undefined ? 'no branch' : `branch ${oneLine(t.branch, 200)}`,
  ].join(', ')
}

/** The command's reply: fixed words, the cleaned titles in quotes and each
 *  opened card's labelled fields, never an id or a path. */
export function doneReply(
  resolved: readonly Resolved[],
  targets: ReadonlyMap<string, Pick<Target, 'kind' | 'cwd' | 'repo' | 'branch'>>,
  paneOpen: boolean,
): string {
  const opened = resolved.filter(r => 'open' in r)
  const lines = [`Opened ${opened.length} of ${resolved.length} for 15 minutes${opened.length > 0 ? ':' : '.'}`]
  for (const r of opened) lines.push(cardLine(r.title, targets.get(r.open.id)))
  for (const r of resolved) if ('why' in r) lines.push(`Not opened: ${quoted(r.title)}: ${r.why}.`)
  if (opened.length > 0) {
    // The pane line comes before the undo line, which stays the reply's last.
    lines.push(...CLEAN_LINES, 'Now send any message, so this session acts on them.', ...(paneOpen ? [] : [PANE_CLOSED_LINE]), UNDO_LINE)
  }
  return lines.join('\n')
}

/** Opens two entries for each resolved title, each with a new 15 minutes:
 *  its archive or stop entry, and its `clean` entry. */
export function openWindow(window: Window, resolved: readonly Resolved[], now: number): void {
  for (const r of resolved) {
    if (!('open' in r)) continue
    window.set(keyOf(r.open.kind, r.open.id), { ...r.open, openedAt: now })
    window.set(keyOf('clean', r.open.id), { kind: 'clean', id: r.open.id, openedAt: now })
  }
}

/** Whether an entry is open and under 15 minutes old. An open entry stays
 *  open; one past its time is deleted. */
export function entryOpen(window: Window, kind: Entry['kind'], id: string, now: number): boolean {
  const k = keyOf(kind, id)
  const e = window.get(k)
  if (e === undefined) return false
  if (now >= e.openedAt && now - e.openedAt < WINDOW_MS) return true
  window.delete(k)
  return false
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

// The engine's own fields on a tool call, by name. Everything else is the
// model's input.
export const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']

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
  if (isRecord(ran) && ran.exitCode === 0) return 'Stopped: claude stop ran and exited 0. Its worktree and branch stay until clean_up runs.'
  return 'Not stopped: claude stop did not run, or did not exit 0. The window for it is used; the owner types /brigade done again, or stops it by hand.'
}

/** The archive hook's one refusal: no id, reason or key. */
export const ARCHIVE_REFUSAL = "Archive refused: no /brigade done window is open for this session. The owner types /brigade done <title> to open one, or archives it by hand in Desktop."
