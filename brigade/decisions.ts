import { AHEAD_MS, SESSION_ID, oneLine } from './roster.ts'
import type { SessionRow } from './roster.ts'

// The decision log's rules (spec 402, S5.1 and S5.2): what a log_decision
// call may carry, what each file kind must hold, how an append is stamped and
// capped and which entries it may drop, how the owner's marks merge, and what
// the Decisions tab draws from them. The log, the marks and the tab's queue
// are text other processes can write, so each is held to a shape before use.
// Nothing here calls the engine: register.tsx reads and writes the files and
// hands the text over, and tests/brigade-decisions.test.mjs tests these
// rules as they are.

/** The sources an entry may carry. Only `lead` and `relayed` come from the
 *  tool; the pane writes the other three, for the autonomy slider. */
export type Source = 'owner' | 'pane' | 'alarm' | 'lead' | 'relayed'
const SOURCES: readonly string[] = ['owner', 'pane', 'alarm', 'lead', 'relayed']
// The tool's sources, and the only ones an append may drop.
const TOOL_SOURCES: readonly string[] = ['lead', 'relayed']

/** One decision, as the log keeps it (S5.2). `id`, `at` and `level` are the mod's. */
export type DecisionEntry = {
  id: string
  at: number
  level: 1 | 2 | 3
  source: Source
  waiting: boolean
  work: string
  question: string
  options: string[]
  pick: string
  why: string
  undo: string
  revisit: string
  answers: string
}

/** A session's decision log file. `next` only ever goes up, so an id is never reused. */
export type DecisionLog = { kind: 'decisions'; v: 1; next: number; project: string | null; entries: DecisionEntry[] }

/** A mark's state: read, flagged (and so read), or unflagged (read, not flagged). */
export type MarkState = 'read' | 'flagged' | 'unflagged'
/** One mark the owner made: which log's entry, by its id and its own time, and when. */
export type Mark = { log: string; id: string; entryAt: number; state: MarkState; at: number }
/** A session's marks file. */
export type MarksFile = { kind: 'marks'; v: 1; marks: Mark[] }

export const MAX_ENTRIES = 500
export const MAX_LOG_BYTES = 256 * 1024
export const MAX_MARKS = 2000
// 256 KiB since 0.89.0 (spec 444 q14): one Mark all read press adds up to 500
// marks, and the 2,000-mark count fits beside them for the entry ids that
// occur (ids run in sequence, so a mark is about 115 to 122 bytes). At the
// widest id the format allows, a mark is 133 bytes and the cap holds fewer old
// marks than the count; the order of the drops still holds.
export const MAX_MARKS_BYTES = 256 * 1024
/** History's page: the rows it draws before, and for each, "Show more". */
export const HISTORY_PAGE = 50
/** How many other sessions' files of each kind the pane reads, newest first. */
export const MAX_OTHER_FILES = 20
// The most one entry can take as JSON: 5,016 characters of text at four bytes
// each, with its keys. The dim line reads a log this close to the byte cap as
// one the cap rule may have dropped from.
const MAX_ENTRY_BYTES = 21 * 1024

type Checked<T> = { value: T } | { error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const bytes = (text: string) => new TextEncoder().encode(text).length

// --- the text rules (S5.2) ----------------------------------------------------
//
// Every field refuses a control character other than a line break, each
// hidden or direction-changing character the roster's HIDDEN set names, and
// text in the session-id and Desktop-id shapes. These copies carry no `g`
// flag: a global pattern's `test` keeps its place between calls.

const CONTROL = /[\u{0}-\u{9}\u{B}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/u
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
// A session id, a Desktop id as the roster takes one (`local_` and 1 to 80
// hex digits or dashes, ending there), and a Remote Control session's link.
const ID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|local_[0-9a-f-]{1,80}(?![0-9a-z_])|claude\.ai\/code\/session_[0-9a-z]/i
// Beyond S5.2, on the owner's word (q3 A, relayed by the lead, 2026-10-26):
// until the head-chef skill's data rule lands, the mod itself refuses a
// value shaped like a known key, an email address and a home-folder path.
// The key shapes are a copy of the masking the threat model's row 14 names,
// in scripts/practice.mjs, since the mod cannot import a repository script;
// tests/brigade-decisions.test.mjs holds the two copies equal. The home
// shapes are the check's own (scripts/check.mjs), from the config folder
// under a home to Git Bash's, WSL's and Cygwin's spelling of a Windows one,
// and one more: a Linux home spelled with backslashes, as Windows names a
// path inside a WSL distribution. A test holds them equal to the check's.
const START = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[nrtbf])|(?<=\\u[0-9A-Fa-f]{4}))`
export const KEY_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  new RegExp(`${START}sk-(?:or-|proj-)?[A-Za-z0-9_-]{20,}`, 'g'),
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  new RegExp(`${START}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g'),
  /AIza[0-9A-Za-z_-]{35}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /hf_[A-Za-z0-9]{30,}/g,
  new RegExp(`${START}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`, 'g'),
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]
// Copies without the `g` flag, whose `test` keeps no place between calls.
const KEYS = KEY_SHAPES.map(re => new RegExp(re.source, re.flags.replace('g', '')))
// Each part bounded, so a long run of text with no @ costs little to test.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,63}/
export const HOME_SHAPES = [
  /~\/\.claude/,
  /\/home\/[a-z$]/i,
  /(?<![A-Za-z])[A-Za-z](?::|%3A)(?:\\+|\/)Users(?!\w)/i,
  /(?<![\w.-])\/Users(?:\/[A-Za-z]|\/?(?=['"`$]|$))/,
  /(?<![\w.-])(?:\/mnt|\/cygdrive)?\/[A-Za-z]\/Users(?:\/[A-Za-z]|\/?(?=['"`$]|$))/,
  /\\home\\[a-z$]/i,
]
const ENTRY_ID = /^[1-9][0-9]{0,15}$/
const DIGEST = /^[0-9a-f]{64}$/

function text(where: string, v: unknown, min: number, max: number): Checked<string> {
  if (typeof v !== 'string') return { error: `${where} is not text` }
  if (min > 0 && v.trim() === '') return { error: `${where} is empty` }
  if ([...v].length > max) return { error: `${where} is over ${max} characters` }
  if (CONTROL.test(v)) return { error: `${where} holds a control character other than a line break` }
  if (HIDDEN.test(v)) return { error: `${where} holds a hidden or direction-changing character` }
  if (ID_SHAPED.test(v)) return { error: `${where} holds text shaped like a session id or Desktop id` }
  if (KEYS.some(re => re.test(v))) return { error: `${where} holds text shaped like a key` }
  if (EMAIL.test(v)) return { error: `${where} holds an email address` }
  if (HOME_SHAPES.some(re => re.test(v))) return { error: `${where} holds a home-folder path` }
  return { value: v }
}

/** An entry's fields other than the three the mod stamps. */
export type EntryInput = Omit<DecisionEntry, 'id' | 'at' | 'level'>

const INPUT_KEYS = ['source', 'waiting', 'work', 'question', 'options', 'pick', 'why', 'undo', 'revisit', 'answers']
const STAMPED = ['id', 'at', 'level'] as const

// The fields both checks share. `sources` is what this caller may write.
function fieldsOf(o: Record<string, unknown>, sources: readonly string[], required: boolean): Checked<EntryInput> {
  if (typeof o.source !== 'string' || !sources.includes(o.source)) {
    return { error: sources === TOOL_SOURCES ? 'source is not lead or relayed' : 'source is not one of the five sources' }
  }
  const source = o.source as Source
  if (o.waiting !== undefined && typeof o.waiting !== 'boolean') return { error: 'waiting is not true or false' }
  if (required && typeof o.waiting !== 'boolean') return { error: 'waiting is not true or false' }
  const waiting = o.waiting === true
  const out: EntryInput = { source, waiting, work: '', question: '', options: [], pick: '', why: '', undo: '', revisit: '', answers: '' }
  const limits = [
    ['work', 1, 300],
    ['question', 1, 1000],
    ['why', 1, 1000],
    ['undo', 1, 300],
    ['revisit', 0, 300],
  ] as const
  for (const [k, min, max] of limits) {
    const t = text(k, o[k] === undefined && !required && k === 'revisit' ? '' : o[k], min, max)
    if ('error' in t) return t
    out[k] = t.value
  }
  if (!Array.isArray(o.options) || o.options.length < 1 || o.options.length > 6) return { error: 'options is not a list of 1 to 6 items' }
  const folded = new Set<string>()
  for (const [i, v] of o.options.entries()) {
    const t = text(`option ${i + 1}`, v, 1, 300)
    if ('error' in t) return t
    // Full case folding: upper case first, so ß and SS meet.
    const f = t.value.toUpperCase().toLowerCase()
    if (folded.has(f)) return { error: `options repeat an option once case is folded (option ${i + 1})` }
    folded.add(f)
    out.options.push(t.value)
  }
  const pick = o.pick === undefined && waiting && !required ? '' : o.pick
  if (typeof pick !== 'string') return { error: 'pick is not text' }
  if (waiting) {
    if (pick !== '') return { error: 'pick: a waiting entry has no pick; send an empty pick' }
  } else if (!out.options.includes(pick)) {
    return { error: 'pick is not one of the options' }
  }
  out.pick = pick
  const answers = o.answers === undefined && !required ? '' : o.answers
  if (typeof answers !== 'string' || (answers !== '' && !ENTRY_ID.test(answers))) return { error: 'answers is not empty or an entry id' }
  if (answers !== '' && (source !== 'relayed' || waiting)) return { error: 'answers: only a relayed entry that is not waiting may answer one' }
  if (waiting && (source !== 'lead' || answers !== '')) return { error: 'waiting: only a lead entry that answers none may wait' }
  out.answers = answers
  return { value: out }
}

/** A log_decision call's input, checked: own keys only, of the shape S5.2
 *  sets, with no `id`, `at` or `level` and a source of `lead` or `relayed`.
 *  `waiting`, `revisit` and `answers` may be left out; a waiting entry may
 *  leave out its pick. */
export function checkInput(v: unknown): Checked<EntryInput> {
  if (!isRecord(v)) return { error: 'the entry is not an object' }
  for (const k of STAMPED) if (Object.hasOwn(v, k)) return { error: `${k} is stamped by the mod, not sent by the tool` }
  if (!Object.hasOwn(v, 'source') || !TOOL_SOURCES.includes(String(v.source))) return { error: 'source is not lead or relayed' }
  const extra = Object.keys(v).filter(k => !INPUT_KEYS.includes(k))
  if (extra.length > 0) return { error: `the entry has a field the decision log does not use: ${oneLine(extra[0] ?? '', 40)}` }
  return fieldsOf(v, TOOL_SOURCES, false)
}

// The pane's own fixed entries (ticket 4) take the same rules with any source.
function checkFixed(v: unknown): Checked<EntryInput> {
  if (!isRecord(v)) return { error: 'the entry is not an object' }
  return fieldsOf(v, SOURCES, false)
}

function checkEntry(i: number, v: unknown): Checked<DecisionEntry> {
  const where = `entry ${i + 1}`
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const keys = [...STAMPED, ...INPUT_KEYS]
  const extra = Object.keys(v).filter(k => !keys.includes(k))
  if (extra.length > 0) return { error: `${where} has a field the decision log does not use` }
  if (typeof v.id !== 'string' || !ENTRY_ID.test(v.id)) return { error: `${where} id is not an entry id` }
  if (!isWhole(v.at)) return { error: `${where} at is not a whole number` }
  if (v.level !== 1 && v.level !== 2 && v.level !== 3) return { error: `${where} level is not 1, 2 or 3` }
  const f = fieldsOf(v, SOURCES, true)
  if ('error' in f) return { error: `${where} ${f.error}` }
  return { value: { id: v.id, at: v.at, level: v.level, ...f.value } }
}

/** A log file's text, checked strictly, as the pane reads it and as the
 *  writer does before it overwrites one: exactly the five keys, kind
 *  `decisions`, version 1, every entry of its shape, ids rising and below
 *  `next`, and an `answers` that names an earlier entry, waiting if it is
 *  still there, and answered by no other. */
export function checkLog(raw: string): Checked<DecisionLog> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the decision log is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the decision log is not an object' }
  const keys = Object.keys(parsed)
  if (keys.length !== 5 || !['kind', 'v', 'next', 'project', 'entries'].every(k => keys.includes(k))) return { error: 'the decision log does not have exactly its five fields' }
  if (parsed.kind !== 'decisions' || parsed.v !== 1) return { error: 'the file is not a decision log of version 1' }
  if (!isWhole(parsed.next) || parsed.next < 1) return { error: 'the decision log\'s next is not a whole number from 1' }
  if (parsed.project !== null && (typeof parsed.project !== 'string' || !DIGEST.test(parsed.project))) return { error: 'the decision log\'s project is not a digest or null' }
  if (!Array.isArray(parsed.entries)) return { error: 'the decision log\'s entries is not a list' }
  const entries: DecisionEntry[] = []
  const byId = new Map<string, DecisionEntry>()
  const answered = new Set<string>()
  let last = 0
  for (const [i, v] of parsed.entries.entries()) {
    const e = checkEntry(i, v)
    if ('error' in e) return e
    const n = Number(e.value.id)
    if (n <= last || n >= parsed.next) return { error: `entry ${i + 1} id is out of order or not below next` }
    last = n
    const a = e.value.answers
    if (a !== '') {
      const target = byId.get(a)
      if (Number(a) >= n || (target !== undefined && !target.waiting) || answered.has(a)) return { error: `entry ${i + 1} answers no open waiting entry` }
      answered.add(a)
    }
    byId.set(e.value.id, e.value)
    entries.push(e.value)
  }
  return { value: { kind: 'decisions', v: 1, next: parsed.next, project: parsed.project as string | null, entries } }
}

/** A log with no entries yet. */
export const emptyLog = (project: string | null): DecisionLog => ({ kind: 'decisions', v: 1, next: 1, project, entries: [] })

/** A log as the text the writer saves, measured in UTF-8 bytes against the cap. */
export function serializeLog(log: DecisionLog): Checked<string> {
  const t = JSON.stringify(log)
  return bytes(t) > MAX_LOG_BYTES ? { error: 'the decision log is over its byte cap' } : { value: t }
}

// --- the append (S5.1's caps) ---------------------------------------------------

/** One entry's mark key: its log's session id, its id and its own time, so a
 *  mark never lands on another entry. */
export const markKey = (log: string, id: string, at: number) => `${log} ${id} ${at}`

const isRead = (s: MarkState | undefined) => s !== undefined

/** What an append needs from outside: the engine clock's time, the level in
 *  force, the merged marks (`read`, keyed by `markKey`) and this log's session
 *  id. `fixed` is the pane's own Owner, Pane and alarm entries: written past
 *  the entry cap, never past the byte cap, and with no drop. */
export type AppendOptions = { at: number; level: 1 | 2 | 3; read: ReadonlyMap<string, MarkState>; sid?: string; fixed?: boolean }

/** Appends one entry, stamping its id from `next`, its time and its level.
 *  Past 500 entries or 256 KiB, entries the owner has marked read and not
 *  flagged drop first, oldest first: never an unread or flagged one, a
 *  waiting one no entry answers, or an Owner, Pane or alarm one. With nothing
 *  left to drop it refuses, and the log given is never changed. */
export function appendEntry(log: DecisionLog, raw: unknown, o: AppendOptions): Checked<{ log: DecisionLog; entry: DecisionEntry }> {
  const c = o.fixed === true ? checkFixed(raw) : checkInput(raw)
  if ('error' in c) return c
  const f = c.value
  if (f.answers !== '') {
    if (!log.entries.some(e => e.id === f.answers && e.waiting)) return { error: 'answers no waiting entry in this log' }
    if (log.entries.some(e => e.answers === f.answers)) return { error: 'answers a waiting entry already answered' }
  }
  if (!isWhole(o.at)) return { error: 'clock: the engine clock gave no whole number of milliseconds' }
  if (!Number.isSafeInteger(log.next + 1)) return { error: 'the decision log has no id left' }
  const entry: DecisionEntry = {
    id: String(log.next),
    at: o.at,
    level: o.level,
    source: f.source,
    waiting: f.waiting,
    work: f.work,
    question: f.question,
    options: f.options,
    pick: f.pick,
    why: f.why,
    undo: f.undo,
    revisit: f.revisit,
    answers: f.answers,
  }
  const kept = [...log.entries, entry]
  // The text's size, kept up to date as entries drop: the frame, each entry,
  // and a comma between two.
  const frame = bytes(JSON.stringify({ ...log, next: log.next + 1, entries: [] }))
  const sizes = kept.map(e => bytes(JSON.stringify(e)))
  let total = frame + sizes.reduce((a, b) => a + b, 0) + Math.max(kept.length - 1, 0)
  const fits = () => (o.fixed === true || kept.length <= MAX_ENTRIES) && total <= MAX_LOG_BYTES
  if (!fits() && o.fixed !== true) {
    const answered = new Set(kept.map(e => e.answers).filter(a => a !== ''))
    const sid = o.sid ?? ''
    for (let i = 0; i < kept.length - 1 && !fits(); ) {
      const e = kept[i]
      const state = o.read.get(markKey(sid, e.id, e.at))
      // An answer stays while the waiting entry it answers does, so that
      // entry is never drawn as waiting again nor answered twice.
      const answering = e.answers !== '' && kept.some(x => x.id === e.answers)
      const drops = TOOL_SOURCES.includes(e.source) && (state === 'read' || state === 'unflagged') && (!e.waiting || answered.has(e.id)) && !answering
      if (!drops) {
        i++
        continue
      }
      total -= (sizes[i] ?? 0) + 1
      kept.splice(i, 1)
      sizes.splice(i, 1)
    }
  }
  if (!fits()) return { error: FULL }
  const next: DecisionLog = { ...log, next: log.next + 1, entries: kept }
  return 'error' in serializeLog(next) ? { error: FULL } : { value: { log: next, entry } }
}

/** An append's refusal when nothing can drop: fixed words the tool answers with. */
export const FULL = 'the decision log is full: no entry can drop'

/** The ids missing below `next` that the cap rule does not explain: none when
 *  the log sits at a cap, where drops happen; else every gap. */
export function missingIds(log: DecisionLog): number {
  const missing = log.next - 1 - log.entries.length
  if (missing <= 0) return 0
  const nearCap = log.entries.length >= MAX_ENTRIES || bytes(JSON.stringify(log)) > MAX_LOG_BYTES - MAX_ENTRY_BYTES
  return nearCap ? 0 : missing
}

// --- marks (S5.4) -----------------------------------------------------------------

function checkMark(i: number, v: unknown): Checked<Mark> {
  const where = `mark ${i + 1}`
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const keys = Object.keys(v)
  if (keys.length !== 5 || !['log', 'id', 'entryAt', 'state', 'at'].every(k => keys.includes(k))) return { error: `${where} does not have exactly its five fields` }
  if (typeof v.log !== 'string' || !SESSION_ID.test(v.log)) return { error: `${where} log is not a session id` }
  if (typeof v.id !== 'string' || !ENTRY_ID.test(v.id)) return { error: `${where} id is not an entry id` }
  if (!isWhole(v.entryAt) || !isWhole(v.at)) return { error: `${where} time is not a whole number` }
  if (v.state !== 'read' && v.state !== 'flagged' && v.state !== 'unflagged') return { error: `${where} state is not read, flagged or unflagged` }
  return { value: { log: v.log, id: v.id, entryAt: v.entryAt, state: v.state, at: v.at } }
}

/** A marks file's text, checked strictly: exactly its three keys, kind
 *  `marks`, version 1, at most 2,000 marks, each of its shape. */
export function checkMarks(raw: string): Checked<MarksFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the marks file is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the marks file is not an object' }
  const keys = Object.keys(parsed)
  if (keys.length !== 3 || !['kind', 'v', 'marks'].every(k => keys.includes(k))) return { error: 'the marks file does not have exactly its three fields' }
  if (parsed.kind !== 'marks' || parsed.v !== 1) return { error: 'the file is not a marks file of version 1' }
  if (!Array.isArray(parsed.marks) || parsed.marks.length > MAX_MARKS) return { error: `the marks file's marks is not a list of at most ${MAX_MARKS}` }
  const marks: Mark[] = []
  for (const [i, v] of parsed.marks.entries()) {
    const m = checkMark(i, v)
    if ('error' in m) return m
    marks.push(m.value)
  }
  return { value: { kind: 'marks', v: 1, marks } }
}

/** A marks file as the text the writer saves, measured against the byte cap. */
export function serializeMarks(file: MarksFile): Checked<string> {
  const t = JSON.stringify(file)
  return bytes(t) > MAX_MARKS_BYTES || file.marks.length > MAX_MARKS ? { error: 'the marks file is over its cap' } : { value: t }
}

/** Each entry's state, keyed by `markKey`: the latest mark for it by mark
 *  time across the files given. A mark dated more than two minutes ahead of
 *  the engine clock is ignored. An entry with no mark has none. */
export function mergeMarks(files: readonly MarksFile[], now: number): Map<string, MarkState> {
  const best = new Map<string, Mark>()
  for (const f of files) {
    for (const m of f.marks) {
      if (m.at > now + AHEAD_MS) continue
      const k = markKey(m.log, m.id, m.entryAt)
      const was = best.get(k)
      if (was === undefined || m.at > was.at) best.set(k, m)
    }
  }
  return new Map([...best].map(([k, m]) => [k, m.state]))
}

/** The file with one mark added. Past 2,000 marks or 256 KiB, marks drop in
 *  `addMarks`'s order. The new mark never drops. */
export const addMark = (file: MarksFile | undefined, mark: Mark, known: ReadonlySet<string>): MarksFile => addMarks(file, [mark], known)

/** The file with several marks added at once, as Dismiss and Mark all read
 *  write them. None of the new marks drops. Past the caps, the old marks drop
 *  one at a time in this order (spec 444 S4), until the file fits:
 *  1. a mark for an entry in no log the pane read (not in `known`);
 *  2. a mark a newer counted mark for the same entry supersedes, in this file
 *     or in `others`, the other marks files read;
 *  3. a mark whose entry's newest counted state is not flagged, unless it is
 *     its entry's newest counted mark while an older flag stays in `others`,
 *     since dropping it would bring that flag back;
 *  4. any mark left.
 *  Each step goes oldest first. "Counted" is as `mergeMarks` counts at `now`;
 *  the merge is worked out once for the write. */
export function addMarks(
  file: MarksFile | undefined,
  added: readonly Mark[],
  known: ReadonlySet<string>,
  others: readonly MarksFile[] = [],
  now = Number.POSITIVE_INFINITY,
): MarksFile {
  const marks = [...(file?.marks ?? []), ...added]
  const sizes = marks.map(m => bytes(JSON.stringify(m)))
  let total = bytes('{"kind":"marks","v":1,"marks":[]}') + sizes.reduce((a, b) => a + b, 0) + marks.length - 1
  const old = marks.length - added.length
  if (marks.length <= MAX_MARKS && total <= MAX_MARKS_BYTES) return { kind: 'marks', v: 1, marks }
  // The newest counted mark of each entry, this file first so a tie keeps the
  // mark the file holds; and the entries an older flag in another file covers.
  const counted = (m: Mark) => m.at <= now + AHEAD_MS
  const best = new Map<string, Mark>()
  for (const m of [...marks, ...others.flatMap(f => f.marks)]) {
    if (!counted(m)) continue
    const k = markKey(m.log, m.id, m.entryAt)
    const was = best.get(k)
    if (was === undefined || m.at > was.at) best.set(k, m)
  }
  const flaggedElsewhere = new Set<string>()
  for (const f of others) for (const m of f.marks) if (counted(m) && m.state === 'flagged') flaggedElsewhere.add(markKey(m.log, m.id, m.entryAt))
  const rank = (m: Mark): number => {
    const k = markKey(m.log, m.id, m.entryAt)
    if (!known.has(k)) return 1
    const b = best.get(k)
    if (b !== undefined && b !== m) return 2
    if (b?.state !== 'flagged' && !(b === m && flaggedElsewhere.has(k))) return 3
    return 4
  }
  const order = marks
    .slice(0, old)
    .map((m, i) => ({ i, at: m.at, r: rank(m) }))
    .sort((a, b) => a.r - b.r || a.at - b.at || a.i - b.i)
  const dropped = new Set<number>()
  for (const o of order) {
    if (marks.length - dropped.size <= MAX_MARKS && total <= MAX_MARKS_BYTES) break
    dropped.add(o.i)
    total -= (sizes[o.i] ?? 0) + 1
  }
  return { kind: 'marks', v: 1, marks: marks.filter((_, i) => !dropped.has(i)) }
}

/** Whether writing `after` in place of `before` changes the counted state of
 *  an entry in a log read (`known`) other than the entries the write marks
 *  (`marked`): that is, whether the caps pushed out a mark that was still its
 *  entry's newest counted state, so the entry would read as it did before
 *  that mark. Mark all read writes nothing when this holds (spec 447,
 *  Test round 1, q3 A), so a bulk press never undoes the owner's own reads. */
export function dropsLiveMark(
  before: MarksFile | undefined,
  after: MarksFile,
  others: readonly MarksFile[],
  known: ReadonlySet<string>,
  marked: ReadonlySet<string>,
  now: number,
): boolean {
  const was = mergeMarks([...(before === undefined ? [] : [before]), ...others], now)
  const is = mergeMarks([after, ...others], now)
  for (const k of known) if (!marked.has(k) && was.get(k) !== is.get(k)) return true
  return false
}

// --- what the tab draws (S5.4) --------------------------------------------------

/** One log as the pane read it: its session id, the writer's drawn name and the log. */
export type ReadLog = { sid: string; writer: string; log: DecisionLog }
/** One entry in the tab, with its log's session id and writer. */
export type Row = { sid: string; writer: string; entry: DecisionEntry }

/** The writer of a log: the engine's session name for that session id, from
 *  the session files the cards are matched against, or "an ended session". */
export function writerName(rows: readonly SessionRow[], sid: string): string {
  const row = rows.find(r => r.sessionId === sid)
  return row === undefined ? 'an ended session' : oneLine(row.name, 80)
}

/** A field's lines, each made safe to draw: its line breaks kept, and each
 *  line cleaned as the roster's one-line text is. */
export const cleanLines = (text: string): string[] => text.split(/\n/).map(l => oneLine(l, 1000))

/** The words of a search, folded: each must appear in an entry. */
export const searchWords = (query: string): string[] =>
  [...query].slice(0, 200).join('').toLowerCase().split(/\s+/).filter(w => w !== '')

/** Whether every word appears in the entry's writer name, id, work, question,
 *  options, pick, why, undo or revisit, in any case. */
export function matchesSearch(e: DecisionEntry, writer: string, words: readonly string[]): boolean {
  if (words.length === 0) return true
  const hay = [writer, e.id, e.work, e.question, ...e.options, e.pick, e.why, e.undo, e.revisit].join('\n').toLowerCase()
  return words.every(w => hay.includes(w))
}

const rowKey = (r: Row) => markKey(r.sid, r.entry.id, r.entry.at)
const rowsOf = (logs: readonly ReadLog[]): Row[] => logs.flatMap(l => l.log.entries.map(entry => ({ sid: l.sid, writer: l.writer, entry })))
const oldestFirst = (a: Row, b: Row) => a.entry.at - b.entry.at || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0) || Number(a.entry.id) - Number(b.entry.id)

/** To review: every unread entry across the logs read that matches the
 *  search, oldest first (Owner and Pane entries count as read by their
 *  source), and the one shown, the first not skipped in this pane's life, or
 *  the first again once all were skipped, with its place as "n of N". */
export function reviewQueue(logs: readonly ReadLog[], states: ReadonlyMap<string, MarkState>, skipped: ReadonlySet<string>, words: readonly string[]) {
  const order = rowsOf(logs)
    .filter(r => r.entry.source !== 'owner' && r.entry.source !== 'pane' && !isRead(states.get(rowKey(r))) && matchesSearch(r.entry, r.writer, words))
    .sort(oldestFirst)
  const at = order.findIndex(r => !skipped.has(rowKey(r)))
  const i = at < 0 ? 0 : at
  return { order, head: order[i] as Row | undefined, n: i + 1, total: order.length }
}

/** One card in To review: an entry alone, or, since spec 448, a waiting entry
 *  of this session's own log with the unread Relayed entry that answers it. */
export type ReviewCard = { row: Row; answer: Row | undefined }

/** To review as cards (spec 448 S4): `reviewQueue`'s unread entries, with an
 *  unread waiting entry of this session's own log (`sid`) and the unread
 *  Relayed entry that answers it on one card, at the waiting entry's place.
 *  A card shows when either of its entries matches the search, and then both
 *  are in `shown`, oldest first, which the presses that work from To review's
 *  order take. A pair counts as skipped when its waiting entry is. `head` and
 *  `answer` are the card shown, with its place as "n of N" in cards. */
export function reviewCards(logs: readonly ReadLog[], sid: string, states: ReadonlyMap<string, MarkState>, skipped: ReadonlySet<string>, words: readonly string[]) {
  const unread = reviewQueue(logs, states, new Set(), []).order
  const own = new Map(unread.filter(r => r.sid === sid && r.entry.waiting).map(r => [r.entry.id, r]))
  const answerOf = new Map<Row, Row>()
  for (const r of unread) {
    const w = r.sid === sid && r.entry.source === 'relayed' && r.entry.answers !== '' ? own.get(r.entry.answers) : undefined
    if (w !== undefined) answerOf.set(w, r)
  }
  const answers = new Set(answerOf.values())
  const cards: ReviewCard[] = unread
    .filter(r => !answers.has(r))
    .map(row => ({ row, answer: answerOf.get(row) }))
    .filter(c => matchesSearch(c.row.entry, c.row.writer, words) || (c.answer !== undefined && matchesSearch(c.answer.entry, c.answer.writer, words)))
  const shown = cards.flatMap(c => (c.answer === undefined ? [c.row] : [c.row, c.answer])).sort(oldestFirst)
  const at = cards.findIndex(c => !skipped.has(rowKey(c.row)))
  const i = at < 0 ? 0 : at
  const card = cards[i]
  return { cards, shown, head: card?.row, answer: card?.answer, n: i + 1, total: cards.length }
}

const PAIR_KEY = /^(dnext|dflag|dskip)-([1-9][0-9]{0,15})-([0-9]{1,16})-([1-9][0-9]{0,15})-([0-9]{1,16})$/
/** A pair card's Read, next, Flag or Skip key, matched whole: the verb, then
 *  the waiting entry's id and time, then its answer's (spec 448 S4). */
export function parsePairKey(key: string): { verb: string; id: string; at: number; answerId: string; answerAt: number } | undefined {
  const m = PAIR_KEY.exec(key)
  if (m === null) return undefined
  return { verb: m[1] as string, id: m[2] as string, at: Number(m[3]), answerId: m[4] as string, answerAt: Number(m[5]) }
}

/** Flagged to revisit: every entry across the logs read whose latest mark is
 *  flagged and that matches the search, oldest first, as To review is. */
export function flaggedRows(logs: readonly ReadLog[], states: ReadonlyMap<string, MarkState>, words: readonly string[]): Row[] {
  return rowsOf(logs)
    .filter(r => states.get(rowKey(r)) === 'flagged' && matchesSearch(r.entry, r.writer, words))
    .sort(oldestFirst)
}

/** History: every entry across the logs read that matches the search, newest
 *  first, 50 a page for the pages shown. */
export function historyRows(logs: readonly ReadLog[], words: readonly string[], pages: number) {
  const all = rowsOf(logs)
    .filter(r => matchesSearch(r.entry, r.writer, words))
    .sort((a, b) => oldestFirst(b, a))
  const rows = all.slice(0, Math.max(1, pages) * HISTORY_PAGE)
  return { rows, total: all.length, more: rows.length < all.length }
}

// --- whether another log's session has ended (spec 447 S3) ---------------------
//
// Worked out again at each draw from the live poll's last session read, the
// pane's open time, the engine clock and the entry times in the logs read,
// and never stored. Unknown draws every log as 0.89.0 drew it.

/** How long a log's newest entry keeps its session running (spec 447 S3.8). */
export const RECENT_MS = 30 * 60 * 1000
export type Liveness = 'running' | 'ended' | 'unknown'
/** The live poll's last read of the session files: the session ids its rows
 *  hold, whether it was complete, whether a file went after the listing, and
 *  when it began on the engine clock. */
export type SessionsSeen = { ids: readonly string[]; complete: boolean; fileGone: boolean; startedAt: number }
/** What the ended rule reads: the last session read since the pane opened,
 *  or none when it returned nothing; the pane's open time; the engine clock. */
export type LiveInput = { seen: SessionsSeen | undefined; openedAt: number | undefined; now: number }

/** Whether the pane can tell a session has ended: a complete read with no
 *  file gone after its listing, begun since the pane's current open, and a
 *  clock and an open time that are whole numbers. */
export function canTell(l: LiveInput): boolean {
  const s = l.seen
  return s !== undefined && s.complete && !s.fileGone && isWhole(l.now) && isWhole(l.openedAt) && isWhole(s.startedAt) && s.startedAt >= l.openedAt
}

/** Each log's state, by its session id. This session's own log is running. A
 *  log is running while a file in the last read holds its session id, or
 *  while its newest entry, as read, is dated within 30 minutes of the clock;
 *  ended when the pane can tell and neither holds; else unknown. */
export function sessionStates(logs: readonly ReadLog[], sid: string, l: LiveInput): Map<string, Liveness> {
  const tell = canTell(l)
  const out = new Map<string, Liveness>()
  for (const log of logs) {
    const newest = log.log.entries.reduce<number | undefined>((n, e) => (n === undefined || e.at > n ? e.at : n), undefined)
    const recent = isWhole(l.now) && newest !== undefined && newest >= l.now - RECENT_MS
    const filed = l.seen?.ids.includes(log.sid) === true
    out.set(log.sid, log.sid === sid || filed || recent ? 'running' : tell && newest !== undefined ? 'ended' : 'unknown')
  }
  return out
}

/** The writer drawn for an ended session's entries: its name went with its session file. */
export const ENDED_WRITER = 'an ended session'

// The entries an ended session's line takes, read or not: every Relayed entry,
// and every waiting entry that a Relayed entry in the same log answers.
function endedEntries(log: DecisionLog): DecisionEntry[] {
  const answered = new Set(log.entries.filter(e => e.source === 'relayed' && e.answers !== '').map(e => e.answers))
  return log.entries.filter(e => e.source === 'relayed' || (e.source === 'lead' && e.waiting && answered.has(e.id)))
}

/** The logs as each view of the tab draws them (spec 444 S3, with the change
 *  of Test round 1), for the pane's session id `sid`. This session's log is
 *  drawn whole in To review and Flagged, and alone in History. From every
 *  other log, To review draws, with no mark on the entry: a waiting entry,
 *  answered or not, until the owner reads it; every Relayed entry, whether or
 *  not it answers one; and an alarm entry in its fixed shape. Flagged draws any entry whose
 *  latest mark is flagged, which `flaggedRows` picks by state.
 *  Since spec 447, from a log `live` reads as ended, To review draws neither
 *  its Relayed entries nor the waiting entries they answer: `ended` holds
 *  those, read or not, for the block's lines and History's fold, with the
 *  writer "an ended session". `canTell` says whether any log could be ended.
 *  `unshown` counts the unread entries of other logs that To review does not
 *  draw and no line counts: a number only. An Owner or Pane entry counts as
 *  read by its source. */
export function drawnLogs(logs: readonly ReadLog[], sid: string, states: ReadonlyMap<string, MarkState>, live: ReadonlyMap<string, Liveness> = new Map(), tell = false) {
  const review: ReadLog[] = []
  const history: ReadLog[] = []
  const ended: ReadLog[] = []
  let unshown = 0
  for (const l of logs) {
    if (l.sid === sid) {
      review.push(l)
      history.push(l)
      continue
    }
    const unread = (e: DecisionEntry) => !isRead(states.get(markKey(l.sid, e.id, e.at)))
    const gone = tell && live.get(l.sid) === 'ended' ? endedEntries(l.log) : []
    const entries = l.log.entries.filter(e => {
      if (!unread(e) || gone.includes(e)) return false
      return (
        (e.source === 'lead' && e.waiting) ||
        e.source === 'relayed' ||
        (e.source === 'alarm' && inFixedShape(e))
      )
    })
    for (const e of l.log.entries) {
      if (e.source === 'owner' || e.source === 'pane' || isRead(states.get(markKey(l.sid, e.id, e.at))) || entries.includes(e) || gone.includes(e)) continue
      unshown++
    }
    review.push({ ...l, log: { ...l.log, entries } })
    if (gone.length > 0) ended.push({ ...l, writer: ENDED_WRITER, log: { ...l.log, entries: gone } })
  }
  return { review, flagged: [...logs], history, ended, canTell: tell, unshown }
}

/** The entries Mark all read takes (issue 466): everything under To review,
 *  its shown rows and every ended session's line, of every kind and log, the
 *  first 500 of them, so its key stays in range and a second press takes the
 *  rest. `hash` is the first 16 hex digits of SHA-256 over the set's mark keys,
 *  sorted and joined by line breaks: a staleness check on the press, not a
 *  secret. */
export function markAllSet(shown: readonly Row[], lines: readonly EndedLine[]) {
  const rows = [...shown, ...lines.flatMap(l => l.rows)].slice(0, MAX_ENTRIES)
  if (rows.length === 0) return { rows, n: 0, hash: '' }
  return { rows, n: rows.length, hash: setHash(rows) }
}

// A press's staleness check: the first 16 hex digits of SHA-256 over the
// set's mark keys, sorted and joined by line breaks.
const setHash = (rows: readonly Row[]) => sha256Hex(rows.map(rowKey).sort().join('\n')).slice(0, 16)

const MARK_ALL_KEY = /^dmarkall-([1-9][0-9]{0,2})-([0-9a-f]{16})$/
/** A Mark all read button's key, matched whole: its count (1 to 500) and hash. */
export function parseMarkAllKey(key: string): { n: number; hash: string } | undefined {
  const m = MARK_ALL_KEY.exec(key)
  const n = Number(m?.[1])
  return m === null || n > MAX_ENTRIES ? undefined : { n, hash: m[2] as string }
}

/** The most `work` values an ended session's line draws, and each one's length. */
const LINE_WORKS = 3
const LINE_WORK_CHARS = 40

/** One ended session's line in To review (spec 447 S4.2): its unread entries
 *  that match the search, newest first, their count, the newest
 *  one's time, and the distinct `work` values, newest first, at most 3 of
 *  them, each cleaned as a roster line is and cut to 40 characters, with how
 *  many more there are. It names no session. */
export type EndedLine = { rows: Row[]; n: number; at: number; works: string[]; more: number }

/** To review's block: one line for each ended log in `ended` with an unread
 *  entry that matches the search, the line with the newest such entry first.
 *  Mark all read takes every line's rows. */
export function endedLines(ended: readonly ReadLog[], states: ReadonlyMap<string, MarkState>, words: readonly string[]): EndedLine[] {
  const lines: (EndedLine & { sid: string })[] = []
  for (const l of ended) {
    const rows = rowsOf([l])
      .filter(r => !isRead(states.get(rowKey(r))) && matchesSearch(r.entry, r.writer, words))
      .sort((a, b) => oldestFirst(b, a))
    const first = rows[0]
    if (first === undefined) continue
    // Cleaned and cut first, so two values that draw alike count once.
    const works = [...new Set(rows.map(r => oneLine(r.entry.work, LINE_WORK_CHARS)))]
    lines.push({
      sid: l.sid,
      rows,
      n: rows.length,
      at: first.entry.at,
      works: works.slice(0, LINE_WORKS),
      more: Math.max(works.length - LINE_WORKS, 0),
    })
  }
  return lines
    .sort((a, b) => b.at - a.at || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0))
    .map(({ sid: _, ...line }) => line)
}

/** The source as the tab draws it. An Owner entry draws plain "Owner" only
 *  when `mine` says this pane wrote it in this module's life, by its id, time
 *  and pick; any other draws "as recorded". */
export function sourceLabel(e: DecisionEntry, writer: string, mine = false): string {
  if (e.source === 'lead') return 'Lead'
  if (e.source === 'relayed') return `Relayed by ${writer}`
  if (e.source === 'owner') return mine ? 'Owner' : 'Owner (as recorded)'
  if (e.source === 'pane') return 'Pane'
  return 'Not from a press'
}

// --- the autonomy level (S5.1, S5.2 and S5.4) ------------------------------------
//
// The level a lead reads, set only by a press on the Decisions tab's slider.
// register.tsx keeps the stored level in plugin state, which other plugins can
// rewrite, and the last level a press set, a 3's press time and a pending
// alarm in its own module memory; these rules read them. The pane's own log
// entries, Owner, Pane and alarm, each have one fixed shape, built and checked
// from the same words, so an entry in any other shape is skipped.

export type Level = 1 | 2 | 3
export const LEVEL_NAMES: Readonly<Record<Level, string>> = { 1: 'Manual', 2: 'Auto', 3: 'Full throttle' }
/** A level as an option of the pane's entries: "1 Manual", "2 Auto", "3 Full throttle". */
export const levelOption = (l: Level) => `${l} ${LEVEL_NAMES[l]}`
const LEVEL_OPTIONS = ([1, 2, 3] as const).map(levelOption)

/** A stored level: the number 1, 2 or 3, and 1 for anything else. */
export const levelFrom = (v: unknown): Level => (v === 2 || v === 3 ? v : 1)

/** This session's stored level from the plugin state's list of
 *  `{ session, level }`: 1 when the list or its entry is not of that shape. */
export function storedLevel(stored: unknown, sid: string): Level {
  if (!Array.isArray(stored)) return 1
  const own = stored.find(s => isRecord(s) && s.session === sid)
  return isRecord(own) ? levelFrom(own.level) : 1
}

/** Whether a clock answer is a time the band can name: a whole number of
 *  milliseconds inside the Date range (#430's C12, from Test round 1's q3g). Any other is no time. */
export const clockTime = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && Math.abs(t) <= 8.64e15

/** The level in force: 1 when the stored level differs from the last one a
 *  press set, while an alarm or a reset's Pane entry waits to be logged, and
 *  for a 3 with no live press time; else the stored level. */
export function levelInForce(o: { stored: Level; pressed: Level; pressAt: number | undefined; waiting: boolean }): Level {
  if (o.stored !== o.pressed || o.waiting) return 1
  if (o.stored === 3 && o.pressAt === undefined) return 1
  return o.stored
}

const SLIDER_WORK = 'Autonomy slider'
const SLIDER_QUESTION = 'Autonomy level'
const OWNER_WHY = 'Moved in the pane'
const OWNER_UNDO = 'Move the slider back'
const PANE_UNDO = 'Move the slider in the pane'
// "Shown again" is no longer written since 0.88.0 (spec 402 rev 6.2) but stays readable in older logs.
const PANE_WHYS = { shown: 'The pane was shown again', reload: 'The Brigade mod was reloaded', compact: "The lead's context was compacted" } as const
type PaneWhy = keyof typeof PANE_WHYS
const ALARM_WHY = 'Changed, not from a press'

const fixedEntry = (source: Source, pick: string, why: string, undo: string): EntryInput => ({
  source, waiting: false, work: SLIDER_WORK, question: SLIDER_QUESTION, options: [...LEVEL_OPTIONS], pick, why, undo, revisit: '', answers: '',
})
/** A slider press's Owner entry, with the new level as pick. */
export const ownerEntry = (l: Level) => fixedEntry('owner', levelOption(l), OWNER_WHY, OWNER_UNDO)
/** A reset's Pane entry: at a module reload or a compaction of the lead, or,
 *  in a log written before 0.88.0 (spec 402 rev 6.2), at a new showing of the pane. */
export const paneEntry = (why: PaneWhy) => fixedEntry('pane', levelOption(1), PANE_WHYS[why], PANE_UNDO)
/** An alarm's entry, with the level found as pick. */
export const alarmEntry = (found: Level) => fixedEntry('alarm', levelOption(found), ALARM_WHY, PANE_UNDO)

/** Whether this session's own log holds an alarm the pane wrote, in its
 *  fixed shape, that no mark covers. `wrote` keys each alarm the pane wrote
 *  by `markKey` of the log's session id, the entry's id and its time. While
 *  one sits unread, a repeat alarm is counted in the pane, not appended, so
 *  a level rewritten at every poll cannot fill the log; an alarm another
 *  writer planted holds nothing back. */
export function unreadOwnAlarm(log: DecisionLog, sid: string, wrote: ReadonlySet<string>, states: ReadonlyMap<string, MarkState>): boolean {
  return log.entries.some(e => {
    const key = markKey(sid, e.id, e.at)
    return e.source === 'alarm' && inFixedShape(e) && wrote.has(key) && !isRead(states.get(key))
  })
}

/** Whether an entry is in its source's fixed shape: always true for a Lead
 *  or Relayed entry, which the tool's own check holds. */
export function inFixedShape(e: DecisionEntry): boolean {
  if (e.source === 'lead' || e.source === 'relayed') return true
  const want =
    e.source === 'owner'
      ? ownerEntry(levelFrom(LEVEL_OPTIONS.indexOf(e.pick) + 1))
      : e.source === 'pane'
        ? paneEntry((Object.keys(PANE_WHYS) as PaneWhy[]).find(k => PANE_WHYS[k] === e.why) ?? 'shown')
        : alarmEntry(levelFrom(LEVEL_OPTIONS.indexOf(e.pick) + 1))
  return (
    LEVEL_OPTIONS.includes(e.pick) &&
    e.pick === want.pick &&
    // Only an Owner entry carries a level above 1; the pane writes Pane and alarm entries at 1.
    (e.source === 'owner' || e.level === 1) &&
    e.waiting === want.waiting &&
    e.work === want.work &&
    e.question === want.question &&
    e.options.length === want.options.length &&
    e.options.every((o, i) => o === want.options[i]) &&
    e.why === want.why &&
    e.undo === want.undo &&
    e.revisit === want.revisit &&
    e.answers === want.answers
  )
}

// --- the lead hand-off (S5.1 and S5.3) -------------------------------------------
//
// The lead's working state, one file per session, which set_lead_handoff
// replaces whole and read_lead_handoff reads back. Each section is a list of
// lines under the entry fields' text rules, and a line holds no line break.

/** The five sections, in the order the pane draws them. */
export const HANDOFF_SECTIONS = ['resume', 'rules', 'sessions', 'cleanup', 'owner'] as const
export type HandoffSections = { [K in (typeof HANDOFF_SECTIONS)[number]]: string[] }
/** A session's hand-off file. `at` and `project` are the mod's. */
export type Handoff = { kind: 'handoff'; v: 1; at: number; project: string | null; sections: HandoffSections }
export const MAX_HANDOFF_BYTES = 32 * 1024
const MAX_HANDOFF_LINES = 20

function checkSections(v: unknown, where: string): Checked<HandoffSections> {
  if (!isRecord(v)) return { error: `${where} is not an object` }
  const extra = Object.keys(v).filter(k => !(HANDOFF_SECTIONS as readonly string[]).includes(k))
  if (extra.length > 0) return { error: `${where} has a field it does not use: ${oneLine(extra[0] ?? '', 40)}` }
  const out = { resume: [], rules: [], sessions: [], cleanup: [], owner: [] } as HandoffSections
  for (const k of HANDOFF_SECTIONS) {
    const lines = v[k]
    if (!Array.isArray(lines) || lines.length > MAX_HANDOFF_LINES) return { error: `${k} is not a list of at most ${MAX_HANDOFF_LINES} lines` }
    for (const [i, line] of lines.entries()) {
      const where = `${k} line ${i + 1}`
      if (typeof line === 'string' && line.includes('\n')) return { error: `${where} holds a line break` }
      const t = text(where, line, 1, 300)
      if ('error' in t) return t
      out[k].push(t.value)
    }
  }
  return { value: out }
}

/** A set_lead_handoff call's input, checked: exactly the five sections, each
 *  a list of at most 20 lines of 1 to 300 characters, under the text rules. */
export const checkHandoffInput = (v: unknown): Checked<HandoffSections> => checkSections(v, 'the hand-off')

/** A hand-off file's text, checked strictly: exactly its five keys, kind
 *  `handoff`, version 1, a whole `at`, a digest or null, and the sections. */
export function checkHandoff(raw: string): Checked<Handoff> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'the hand-off is not JSON' }
  }
  if (!isRecord(parsed)) return { error: 'the hand-off is not an object' }
  const keys = Object.keys(parsed)
  if (keys.length !== 5 || !['kind', 'v', 'at', 'project', 'sections'].every(k => keys.includes(k))) return { error: 'the hand-off does not have exactly its five fields' }
  if (parsed.kind !== 'handoff' || parsed.v !== 1) return { error: 'the file is not a hand-off of version 1' }
  if (!isWhole(parsed.at)) return { error: 'the hand-off\'s at is not a whole number' }
  if (parsed.project !== null && (typeof parsed.project !== 'string' || !DIGEST.test(parsed.project))) return { error: 'the hand-off\'s project is not a digest or null' }
  const s = checkSections(parsed.sections, 'the hand-off\'s sections')
  if ('error' in s) return s
  return { value: { kind: 'handoff', v: 1, at: parsed.at, project: parsed.project as string | null, sections: s.value } }
}

/** A hand-off as the text the writer saves, measured in UTF-8 bytes against the cap. */
export function serializeHandoff(h: Handoff): Checked<string> {
  const t = JSON.stringify(h)
  return bytes(t) > MAX_HANDOFF_BYTES ? { error: 'the hand-off is over 32 KiB' } : { value: t }
}

/** One hand-off as read, with the session id of the file that held it. */
export type ReadHandoff = { sid: string; handoff: Handoff }

/** The hand-off read_lead_handoff gives, and the pane draws: this session's
 *  own when it has one, else the newest by stamped time among the others with
 *  the same non-null project digest. One dated more than two minutes ahead of
 *  the engine clock is never chosen. */
export function chooseHandoff(own: ReadHandoff | undefined, others: readonly ReadHandoff[], project: string | null, now: number): ReadHandoff | undefined {
  if (own !== undefined && own.handoff.at <= now + AHEAD_MS) return own
  if (project === null) return undefined
  let best: ReadHandoff | undefined
  for (const o of others) {
    const h = o.handoff
    if (h.project !== project || h.at > now + AHEAD_MS) continue
    if (best === undefined || h.at > best.handoff.at || (h.at === best.handoff.at && o.sid < best.sid)) best = o
  }
  return best
}

// --- the project digest (S5.1) -------------------------------------------------

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** The SHA-256 of a text's UTF-8 bytes, in hex: plain and unkeyed. */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input)
  const len = data.length
  const blocks = Math.ceil((len + 9) / 64)
  const buf = new Uint8Array(blocks * 64)
  buf.set(data)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(buf.length - 8, Math.floor(len / 0x20000000))
  view.setUint32(buf.length - 4, (len * 8) >>> 0)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(b * 64 + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0
      const c = w[i - 2] ?? 0
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }
    let [a, bb, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & bb) ^ (a & c) ^ (bb & c)
      const t2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = bb
      bb = a
      a = (t1 + t2) >>> 0
    }
    const add = [a, bb, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (add[i] ?? 0)) >>> 0
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('')
}

/** The project digest: the SHA-256 of the name of the folder that holds this
 *  session's transcript, from the session-start record the mod keeps, only
 *  when that record's session id is the current one; else null. The name is
 *  never stored. */
export function projectDigest(start: { sessionId: unknown; transcript: unknown }, sessionId: string): string | null {
  if (typeof start.sessionId !== 'string' || typeof start.transcript !== 'string' || start.sessionId !== sessionId || !SESSION_ID.test(sessionId)) return null
  const m = /^.+[\\/]projects[\\/]([^\\/]+)[\\/]([^\\/]+)\.jsonl$/.exec(start.transcript)
  return m !== null && m[2] === sessionId && m[1] !== undefined ? sha256Hex(m[1]) : null
}
