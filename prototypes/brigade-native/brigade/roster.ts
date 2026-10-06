import type { Card, Pair, Roster, Status, Todo } from './types'

// What the Brigade pane reads from outside itself, checked before it is drawn
// or used: the roster file the head chef writes, the rows `claude agents
// --json` prints, the transcript paths the engine reports and the reports
// other sessions send. Every one is text another process wrote, so each is
// held to a shape, cut to a length and shown as text only. Nothing here runs,
// and nothing here builds a command or a path from roster text.

export const STATUSES: readonly Status[] = ['working', 'needs-you', 'done', 'stopped']

// The caps a roster is held to. A roster over them is refused with an error in
// the pane rather than drawn in part.
const MAX_CARDS = 50
const MAX_TODOS = 50
const MAX_TITLE = 80
const MAX_TEXT = 300
const MAX_ID = 100

// The engine's session ids, and so the roster files' names.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// C0 and C1 controls, and the characters that reorder or hide text: every
// default-ignorable code point (the zero-width ones, the variation selectors,
// the tag block, the soft hyphen and the rest), and the bidi marks,
// embeddings, overrides and isolates, some of which are not in that set.
const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu
const CONTROL_TEST = /[\u{0}-\u{1F}\u{7F}-\u{9F}]/u

/** Text made safe to draw on one line: controls become spaces, hidden
 *  characters go, runs of space fold, and it is cut to `max` with an ellipsis. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(CONTROL, ' ').replace(HIDDEN, '').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat
}

type Checked<T> = { value: T } | { error: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Own keys only, and only the ones named: a key the shape does not know is a
// typo or a field nobody reads, and either way the file is refused.
function fields(where: string, v: unknown, allowed: readonly string[]): Checked<Record<string, unknown>> {
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const extra = Object.keys(v).filter(k => !allowed.includes(k))
  if (extra.length > 0) return { error: `${where} has a field the roster does not use: ${oneLine(extra[0] ?? '', 40)}` }
  return { value: v }
}

function text(where: string, v: unknown, max: number, required: boolean): Checked<string | undefined> {
  if (v === undefined && !required) return { value: undefined }
  if (typeof v !== 'string') return { error: `${where} is not text` }
  if (required && v.trim() === '') return { error: `${where} is empty` }
  if ([...v].length > max) return { error: `${where} is over ${max} characters` }
  return { value: v }
}

function card(i: number, v: unknown): Checked<Card> {
  const where = `card ${i + 1}`
  const f = fields(where, v, ['title', 'work', 'phase', 'settings', 'status', 'desktopId', 'bgId', 'url'])
  if ('error' in f) return f
  const o = f.value
  const title = text(`${where} title`, o.title, MAX_TITLE, true)
  if ('error' in title) return title
  const out: Card = { title: title.value ?? '', work: '', phase: '', settings: '', status: 'working' }
  for (const k of ['work', 'phase', 'settings'] as const) {
    const t = text(`${where} ${k}`, o[k], MAX_TEXT, false)
    if ('error' in t) return t
    out[k] = t.value ?? ''
  }
  if (typeof o.status !== 'string' || !(STATUSES as readonly string[]).includes(o.status)) {
    return { error: `${where} status is not one of ${STATUSES.join(', ')}` }
  }
  out.status = o.status as Status
  for (const k of ['desktopId', 'bgId', 'url'] as const) {
    const t = text(`${where} ${k}`, o[k], MAX_ID, false)
    if ('error' in t) return t
    if (t.value !== undefined) out[k] = t.value
  }
  return { value: out }
}

function todo(i: number, v: unknown): Checked<Todo> {
  const where = `to-do ${i + 1}`
  const f = fields(where, v, ['id', 'text', 'session'])
  if ('error' in f) return f
  const id = text(`${where} id`, f.value.id, 40, true)
  if ('error' in id) return id
  const body = text(`${where} text`, f.value.text, MAX_TEXT, true)
  if ('error' in body) return body
  const session = text(`${where} session`, f.value.session, MAX_TITLE, false)
  if ('error' in session) return session
  const out: Todo = { id: id.value ?? '', text: body.value ?? '' }
  if (session.value !== undefined) out.session = session.value
  return { value: out }
}

/** The roster file's text, checked: `{ cards, todos }` with every field a
 *  string of its length, the status from the fixed set, and no title twice. */
export function checkRoster(raw: string): Checked<Roster> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the roster is not JSON' }
  }
  const f = fields('the roster', parsed, ['cards', 'todos'])
  if ('error' in f) return f
  const cards = f.value.cards ?? []
  const todos = f.value.todos ?? []
  if (!Array.isArray(cards)) return { error: 'the roster\'s "cards" is not a list' }
  if (!Array.isArray(todos)) return { error: 'the roster\'s "todos" is not a list' }
  if (cards.length > MAX_CARDS) return { error: `the roster has over ${MAX_CARDS} cards` }
  if (todos.length > MAX_TODOS) return { error: `the roster has over ${MAX_TODOS} to-dos` }
  const out: Roster = { cards: [], todos: [] }
  const titles = new Set<string>()
  for (const [i, v] of cards.entries()) {
    const c = card(i, v)
    if ('error' in c) return c
    // Compared as drawn, so two titles that differ only in a hidden
    // character cannot pose as one card.
    const drawn = oneLine(c.value.title, MAX_TITLE)
    if (drawn === '') return { error: `card ${i + 1} title is empty once hidden characters go` }
    if (titles.has(drawn)) return { error: `card ${i + 1} repeats the title of an earlier card` }
    titles.add(drawn)
    out.cards.push(c.value)
  }
  const ids = new Set<string>()
  for (const [i, v] of todos.entries()) {
    const t = todo(i, v)
    if ('error' in t) return t
    if (ids.has(t.value.id)) return { error: `to-do ${i + 1} repeats the id of an earlier to-do` }
    ids.add(t.value.id)
    out.todos.push(t.value)
  }
  return { value: out }
}

// The config folder and the marketplace from where the plugin was installed:
// the engine keeps an installed plugin under
// <config>/plugins/cache/<marketplace>/... or reads it from
// <config>/plugins/marketplaces/<marketplace>. The last such segment wins, so
// a config folder whose own path holds the words still resolves.
const INSTALLED = /^(.+)[\\/]plugins[\\/](?:cache|marketplaces)[\\/]([^\\/]+)(?:[\\/]|$)/

/** The config folder the plugin's own location names, or undefined. */
export function configFromRoot(root: string): string | undefined {
  return INSTALLED.exec(root)?.[1]
}

/** The marketplace the plugin's own location names, or undefined: a plugin
 *  loaded from a folder of its own (`--plugin-dir`) has none. */
export function marketplaceFromRoot(root: string): string | undefined {
  return INSTALLED.exec(root)?.[2]
}

/** The plugin's data folder id, by the plugin-manifest reference's rule: the
 *  identifier `<name>@<marketplace>`, or `<name>@inline` for a plugin loaded
 *  from a folder, with every character but a letter, digit, `_` or `-` made
 *  `-`. */
export function dataId(name: string, marketplace: string | undefined): string {
  return `${name}@${marketplace ?? 'inline'}`.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** The plugin's data folder under a config folder: what `${CLAUDE_PLUGIN_DATA}`
 *  names for the plugin's other parts. */
export function dataFolder(config: string, id: string): string {
  const sep = sepOf(config)
  return `${config}${sep}plugins${sep}data${sep}${id}`
}

/** `CLAUDE_PLUGIN_DATA` as the environment gives it, when it reads as a local
 *  absolute folder named for this plugin's own id. A mod's environment does
 *  not carry it on 2.1.289, so a value here was inherited from whatever
 *  started the session, such as another plugin's hook, and one naming
 *  another plugin's folder, a network share or a climb is not used. */
export function dataFromEnv(value: string | undefined, id: string): string | undefined {
  if (value === undefined || value.length > 1000 || CONTROL_TEST.test(value)) return undefined
  const trimmed = value.replace(/[\\/]+$/, '')
  if (/^[\\/]{2}/.test(trimmed) || !/^(?:[A-Za-z]:[\\/]|\/)/.test(trimmed)) return undefined
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(trimmed)) return undefined
  return trimmed.split(/[\\/]/).pop() === id ? trimmed : undefined
}

/** The config folder above the engine's transcript path for this session:
 *  <config>/projects/<folder>/<session id>.jsonl, or undefined. */
export function configFromTranscript(transcript: string, sessionId: string): string | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined
  const m = /^(.+)[\\/]projects[\\/][^\\/]+[\\/]([^\\/]+)\.jsonl$/.exec(transcript)
  return m !== null && m[2] === sessionId ? m[1] : undefined
}

const sepOf = (dir: string) => (dir.includes('\\') ? '\\' : '/')

/** The roster file of one lead session in the plugin's data folder, named by
 *  its checked session id. */
export function rosterFile(data: string, sessionId: string): string {
  const sep = sepOf(data)
  return `${data}${sep}brigade${sep}${sessionId}.json`
}

/** A row of `claude agents --json`, as far as the pane uses it. */
export type AgentRow = { name: string; status: string; sessionId?: string; cwd?: string }

/** The rows `claude agents --json` printed, each field checked; a row with
 *  no name is dropped, and a session id that is not the engine's shape too. */
export function parseAgents(stdout: string): Checked<AgentRow[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { error: 'claude agents printed no JSON' }
  }
  if (!Array.isArray(parsed)) return { error: 'claude agents printed no list' }
  const rows: AgentRow[] = []
  for (const r of parsed.slice(0, 500)) {
    if (!isRecord(r) || typeof r.name !== 'string' || r.name === '' || r.name.length > MAX_TEXT) continue
    const row: AgentRow = { name: r.name, status: typeof r.status === 'string' ? oneLine(r.status, 20) : '?' }
    if (typeof r.sessionId === 'string' && SESSION_ID.test(r.sessionId)) row.sessionId = r.sessionId
    if (typeof r.cwd === 'string' && r.cwd.length <= 1000) row.cwd = r.cwd
    rows.push(row)
  }
  return { value: rows }
}

/** The transcript of a session the engine listed: its folder is the working
 *  directory with every separator, colon and dot made a dash, which leaves no
 *  separator in it, and its name is the checked session id. */
export function transcriptFile(config: string, row: AgentRow): string | undefined {
  if (row.sessionId === undefined || row.cwd === undefined || !SESSION_ID.test(row.sessionId)) return undefined
  const sep = sepOf(config)
  return `${config}${sep}projects${sep}${row.cwd.replace(/[:\\/.]/g, '-')}${sep}${row.sessionId}.jsonl`
}

// A Remote Control session's link, whole.
const WEB_LINK = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]{1,80}$/

/** A Remote Control session's link from its transcript, or undefined: only
 *  from a row the engine itself writes when Remote Control starts, a system
 *  row of subtype `bridge_status` carrying `url`, the last one in the file.
 *  A link quoted in a prompt, a brief or a relayed message sits inside another
 *  row's text and is never read. */
export function remoteLink(transcript: string): string | undefined {
  let found: string | undefined
  for (const line of transcript.split('\n')) {
    if (!line.includes('"bridge_status"')) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (isRecord(row) && row.type === 'system' && row.subtype === 'bridge_status' && typeof row.url === 'string' && WEB_LINK.test(row.url)) {
      found = row.url
    }
  }
  return found
}

/** The app's own link to a card's session, of one of the two known shapes,
 *  or undefined: a Desktop session by its local id, or a Remote Control
 *  session by its claude.ai path under the app's scheme. */
export function appLink(c: Card, found: string | undefined): string | undefined {
  if (c.desktopId !== undefined && /^local_[0-9a-f-]{1,80}$/.test(c.desktopId)) {
    return `claude://claude.ai/epitaxy/${c.desktopId}`
  }
  const web = c.url ?? found
  return web !== undefined && WEB_LINK.test(web)
    ? `claude://claude.ai/code/${web.slice('https://claude.ai/code/'.length)}`
    : undefined
}

// The wrapper the engine puts round a message from another session. Only a
// wrapper that opens the delivery counts, so a body quoting one names nobody.
const WRAPPER = /^\s*<cross-session-message\s+from="([^"]{1,200})"[^>]*>/

/** A report's claimed sender and its first line of text, both made safe to
 *  draw. The sender is the wrapper's claim, never a credential. */
export function report(raw: string): { from: string; line: string } {
  const m = WRAPPER.exec(raw)
  const body = (m === null ? raw : raw.slice(m[0].length)).replace(/<\/cross-session-message>\s*$/, '')
  const line = body.split('\n').find(l => l.trim() !== '') ?? ''
  return { from: oneLine(m?.[1] ?? 'a session', MAX_TITLE), line: oneLine(line, 200) }
}

/** A lookup over pairs that never reaches a prototype: a Map, built per read. */
export const lookup = (pairs: readonly Pair[]) => new Map(pairs.map(p => [p.name, p.value]))
