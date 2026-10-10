import type { Card, Pair, Roster, Status, Todo } from './types'

// What the Brigade pane reads from outside itself, checked before it is drawn
// or used: the roster, the rows `claude agents --json` prints, the transcript
// paths the engine reports and the reports other sessions send. Every one is
// text another process wrote, so each is held to a shape, cut to a length and
// shown as text only. Nothing here runs, and nothing here builds a command or
// a path from roster text.
//
// The roster has two users, and both take their rules from here so the two
// cannot drift: the pane, which reads the file, and the set_roster tool, which
// writes it. The shape check, the byte cap and the decision whether a roster
// path may be read or written are each one function below.

export const STATUSES: readonly Status[] = ['working', 'needs-you', 'done', 'stopped']

// The caps a roster is held to. A roster over them is refused with an error in
// the pane rather than drawn in part.
const MAX_CARDS = 50
const MAX_TODOS = 50
const MAX_TITLE = 80
/** The cap on a card's or to-do's text field; the pane draws a wrapped field
 *  whole up to it. */
export const MAX_TEXT = 300
const MAX_ID = 100

// The engine's session ids, and so the roster files' names.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// C0 and C1 controls, and the characters that reorder or hide text: every
// default-ignorable code point (the zero-width ones, the variation selectors,
// the tag block, the soft hyphen and the rest), and the bidi marks,
// embeddings, overrides and isolates, some of which are not in that set.
const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu

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

/** The roster's text, checked: `{ cards, todos }` with every field a string
 *  of its length, the status from the fixed set, no title twice and no to-do
 *  id twice. The pane reads a missing list as empty. `strict` requires both
 *  lists, as the writer does of a file it would overwrite: `{}` is then no
 *  roster, so a hard link to some other JSON file is not taken for one. */
export function checkRoster(raw: string, strict = false): Checked<Roster> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the roster is not JSON' }
  }
  const f = fields('the roster', parsed, ['cards', 'todos'])
  if ('error' in f) return f
  if (strict) {
    for (const k of ['cards', 'todos'] as const) {
      if (!Object.hasOwn(f.value, k)) return { error: `the roster has no "${k}" list` }
    }
  }
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

/** The cap on a roster file, in bytes: the pane reads no larger file, and the
 *  writer saves none. */
export const MAX_ROSTER_BYTES = 256 * 1024

/** A checked roster as the text the writer saves, measured in UTF-8 bytes
 *  against the cap: what is measured is what is written. */
export function serialize(roster: Roster): Checked<string> {
  const text = JSON.stringify(roster)
  const bytes = new TextEncoder().encode(text).length
  return bytes > MAX_ROSTER_BYTES ? { error: `the roster is ${bytes} bytes, over the cap of ${MAX_ROSTER_BYTES}` } : { value: text }
}

// --- the roster path ---------------------------------------------------------
//
// Whether a roster path may be read or written, decided from `stat` answers
// alone. The engine offers no write that refuses a link, and a write follows
// one: through a broken file link it creates the link's target, and through a
// hard link it replaces the other file's text. So before each write, and each
// read, every folder from the config folder down is looked at, then the file.
//
// The answers come from the caller, so the rule runs the same against the
// engine and against recorded answers in a test. A `stat` the engine rejects
// reaches a mod as a message alone, with no error code: a missing path's ends
// "failed: ENOENT" (measured on 2.1.292), and only that one means missing.

/** What `$.fs.stat(path, { resolve: true })` answered, as far as the rule
 *  reads it. `isLink` is the path's own; `kind` and `realPath` are where it
 *  leads, `realPath` absent when it leads nowhere. */
export type StatFound = { kind: 'file' | 'dir' | 'other'; size: number; isLink: boolean; realPath?: string }

/** One `stat`: found, missing, or refused for any other reason. */
export type StatAnswer = { found: StatFound } | { missing: true } | { failed: string }

/** A rejected `stat`'s message, sorted: missing only for ENOENT. */
export function statRejection(message: string): StatAnswer {
  return /(?:^|[\s:])ENOENT$/.test(message.trim()) ? { missing: true } : { failed: oneLine(message, 200) }
}

/** Where the roster may go: `existing` is the file there now, which a writer
 *  must still find to be a roster before it overwrites it. */
export type Placed = { file: string; existing?: { size: number } } | { refused: string }

// The folders below the config folder, in order. `plugins` is the engine's
// own and must be there; the mod may create the rest.
const FOLDERS = (plugin: string) => ['plugins', 'data', plugin, 'brigade']

// A path as the real-path compare reads it: one separator, no trailing one,
// and case folded where the file system ignores it.
const norm = (path: string, fold: boolean) => {
  const flat = path.replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1')
  return fold ? flat.toLowerCase() : flat
}

/** Whether the file system under this path ignores case: Windows' and,
 *  by its default home and volumes, macOS'. Elsewhere the compare is exact,
 *  which can only refuse more. */
export function foldsCase(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(path) || /^\/(?:Users|Volumes)\//.test(path)
}

/** Decides whether this session's roster file under the config folder may be
 *  read or written, asking `stat` (resolving) of each folder on the way and
 *  then of the file.
 *
 *  Refused: a session id or data id not of their shape; a config folder that
 *  does not resolve; `plugins` missing; any folder that is a link, broken or
 *  not, or is not a folder; any `stat` that fails other than as missing, or
 *  finds a path with no real path; any folder whose real path is not the
 *  config folder's real path joined with the same names, which is the
 *  decisive control, since only junctions and file links were measured for
 *  `isLink`; and a file that is a link, is not a plain file, or lands
 *  anywhere but in the checked folder. A missing folder below `plugins` ends
 *  the walk: the write creates it and everything below it. */
export async function placeRoster(
  config: string,
  plugin: string,
  sessionId: string,
  stat: (path: string) => Promise<StatAnswer>,
): Promise<Placed> {
  if (!SESSION_ID.test(sessionId)) return { refused: 'path: the session id is not the engine\'s shape' }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(plugin)) return { refused: 'path: the plugin\'s data id is not of its shape' }
  const sep = sepOf(config)
  const fold = foldsCase(config)
  const top = await stat(config)
  if (!('found' in top) || top.found.kind !== 'dir' || top.found.realPath === undefined) {
    return { refused: 'path: the config folder does not resolve to a folder' }
  }
  const real = norm(top.found.realPath, fold)
  let at = config
  let expected = real
  for (const name of FOLDERS(plugin)) {
    at = `${at}${sep}${name}`
    expected = `${expected}/${fold ? name.toLowerCase() : name}`
    const s = await stat(at)
    if ('missing' in s) {
      if (name === 'plugins') return { refused: 'path: the config folder has no plugins folder' }
      return { file: `${config}${sep}${FOLDERS(plugin).join(sep)}${sep}${sessionId}.json` }
    }
    if ('failed' in s) return { refused: `path: ${name} could not be read (${s.failed})` }
    if (s.found.isLink) return { refused: `link: ${name} is a link` }
    if (s.found.kind !== 'dir') return { refused: `path: ${name} is not a folder` }
    if (s.found.realPath === undefined || norm(s.found.realPath, fold) !== expected) {
      return { refused: `link: ${name} does not lead where its name says` }
    }
  }
  const file = `${at}${sep}${sessionId}.json`
  const s = await stat(file)
  if ('missing' in s) return { file }
  if ('failed' in s) return { refused: `path: the roster file could not be read (${s.failed})` }
  if (s.found.isLink) return { refused: 'link: the roster file is a link' }
  if (s.found.kind !== 'file') return { refused: 'path: the roster path is not a plain file' }
  if (s.found.realPath === undefined || norm(s.found.realPath, fold) !== `${expected}/${fold ? `${sessionId}.json`.toLowerCase() : `${sessionId}.json`}`) {
    return { refused: 'link: the roster file does not lead where its name says' }
  }
  return { file, existing: { size: s.found.size } }
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

/** The plugin's data folder under a config folder, built from the config
 *  folder alone: `CLAUDE_PLUGIN_DATA` is not read, since a mod's environment
 *  usually lacks it and another plugin can set it. */
export function dataFolder(config: string, id: string): string {
  const sep = sepOf(config)
  return `${config}${sep}plugins${sep}data${sep}${id}`
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

/** A row of `claude agents --json`, as far as the pane uses it. `status` is
 *  the live state: an interactive row's `status`, else a background row's
 *  `state`. */
export type AgentRow = { name: string; status: string; sessionId?: string; cwd?: string }

/** The rows `claude agents --json` printed, each field checked; a row with
 *  no name is dropped, and a session id that is not the engine's shape too.
 *  An interactive row says its live state in `status` (`busy`, `idle`), a
 *  background row in `state` (`blocked`, for one). */
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
    const state = typeof r.status === 'string' ? r.status : typeof r.state === 'string' ? r.state : undefined
    const row: AgentRow = { name: r.name, status: state === undefined ? '?' : oneLine(state, 20) }
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

// A Desktop session's local id, whole: the one shape both routes of Open in
// app take from a card.
const DESKTOP_ID = /^local_[0-9a-f-]{1,80}$/

/** The app's own link to a card's session, of one of the two known shapes,
 *  or undefined: a Desktop session by its local id, or a Remote Control
 *  session by its claude.ai path under the app's scheme. */
export function appLink(c: Card, found: string | undefined): string | undefined {
  if (c.desktopId !== undefined && DESKTOP_ID.test(c.desktopId)) {
    return `claude://claude.ai/epitaxy/${c.desktopId}`
  }
  const web = c.url ?? found
  return web !== undefined && WEB_LINK.test(web)
    ? `claude://claude.ai/code/${web.slice('https://claude.ai/code/'.length)}`
    : undefined
}

/** The host systems the link route has an opener for. */
export type HostOs = 'windows' | 'macos' | 'linux'

// The link route's programs. Windows' is looked up by name, as measured in the
// threat model's row 15. The other two are absolute, root-owned on a normal
// install, so neither the user's PATH nor the project folder can supply a
// stand-in for the opener itself. On Linux the opener then starts its desktop
// helper, or a fallback browser, by name on the inherited PATH, from the
// session's working folder.
export const EXPLORER = 'explorer.exe'
export const MAC_OPEN = '/usr/bin/open'
export const XDG_OPEN = '/usr/bin/xdg-open'

/** The command the link route runs on a host: its program and the link, as
 *  one argument with no shell. The link is always one of `appLink`'s two
 *  shapes, so it never starts with `-`. */
export function openerArgv(os: HostOs, link: string): string[] {
  return [os === 'windows' ? EXPLORER : os === 'macos' ? MAC_OPEN : XDG_OPEN, link]
}

/** Whether a probe's real path, exactly as the engine returned it, is a Unix
 *  one: one `/`, then a character that is not a separator, and no `\`
 *  anywhere. A Windows real path carries a drive letter or a share root
 *  (`\\server\…`), so it fails. Never pass it through a separator helper
 *  first: one that folds `\\server` to `//server` would let a share pass. */
export function unixRealPath(path: string): boolean {
  return /^\/[^\\/]/.test(path) && !path.includes('\\')
}

// Open in app through the Desktop app's own tool, which shows a session this
// lead started beside it. The tool, its server and the target are constants:
// no roster text names any of them, and only a checked Desktop id is sent.
export const OPEN_TOOL = 'mcp__ccd_window__open_session_in'
export const OPEN_SERVER = 'ccd_window'
export const OPEN_NAME = 'open_session_in'
export const OPEN_TARGET = 'split'
export const OPEN_WAIT_MS = 5000
export const OPENED = 'Opened in the app.'
export const NOT_OPENED = 'The app did not open it: '

/** The session id a press asks the Desktop app's tool to show, or undefined
 *  when the card takes the link route alone: only a Desktop id of the checked
 *  shape. A background card, a Remote Control link or any other text in the
 *  card never reaches the tool. */
export function toolSession(c: Card): string | undefined {
  return c.desktopId !== undefined && DESKTOP_ID.test(c.desktopId) ? c.desktopId : undefined
}

/** Whether the engine lists the Desktop app's tool by exactly its name. The
 *  owner's rules are matched on that name, so the press asks about no other;
 *  the terminal lists none. The list is read as untrusted. */
export function listsOpenTool(tools: unknown): boolean {
  return Array.isArray(tools) && tools.some(t => isRecord(t) && t.name === OPEN_TOOL)
}

/** Whether the owner's rules let a press call the tool, from the engine's
 *  verdict, read as untrusted: `allow`, or an `ask` that names no rule, which
 *  is a mode's; and an organisation's ceiling, where the engine reports one, of
 *  `allow`. A `deny`, an `ask` naming a rule, a lower ceiling or anything else
 *  keeps the press on the link route. */
export function rulesAllowTool(verdict: unknown): boolean {
  if (!isRecord(verdict)) return false
  if (verdict.ceiling !== undefined && verdict.ceiling !== 'allow') return false
  if (verdict.decision === 'allow') return true
  return verdict.decision === 'ask' && verdict.rule === undefined
}

// The first line of a text block, made safe to draw and cut to the pane's
// one-line length. The line is taken before cleaning, which folds breaks.
const firstLine = (text: string) => oneLine(text.split(/\r\n|[\n\r\u{2028}\u{2029}]/u)[0] ?? '', 200)

/** What the Desktop app's answer means, read as untrusted, since another
 *  plugin can answer in the app's place. Exactly one of three outcomes:
 *  opened with the answer's first line to show; opened with no text, shown as
 *  a fixed line; or not opened, with the app's own reason when it gave one as
 *  text. Nothing in it throws. */
export function readOpenAnswer(answer: unknown): { opened: true; toast: string } | { opened: false; reason?: string } {
  try {
    if (!isRecord(answer) || !Array.isArray(answer.content) || typeof answer.isError !== 'boolean') return { opened: false }
    const first: unknown = answer.content[0]
    const text = isRecord(first) && first.type === 'text' && typeof first.text === 'string' ? firstLine(first.text) : ''
    if (answer.isError === false) return { opened: true, toast: text === '' ? OPENED : text }
    return text === '' ? { opened: false } : { opened: false, reason: `${NOT_OPENED}${text}` }
  } catch {
    // A field that throws when read is not an answer.
    return { opened: false }
  }
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
