import { oneLine, transcriptFile } from './roster.ts'
import type { AgentRow } from './roster.ts'
import type { Pair, UsageCategory, UsageLimit, UsageSnapshot, Warmth } from './types'

// What the Brigade pane draws, worked out from plain values: the render hook
// in register.tsx only turns these results into elements. Plain TypeScript
// with erasable syntax only and no engine import, so `node --test` imports
// this file as it is.
//
// The to-dos: a tick that can be undone for a grace period, then moves the
// to-do to done.
//
// The cache warmth: each card's ◆ line, read from the last real model call in
// its session's transcript, and which transcripts the agents poll reads.
//
// The usage section: this session's own rate limits and context fill, at the
// bottom of the pane. On the terminal it is rows of text bars. Everywhere else
// it is an SVG image, built here as a string. Every piece of text in that
// string goes through `svgText`, and every attribute value is a number this
// module worked out or a name from the fixed set in `STYLE`.

/** A snapshot before the first reading: what the pane holds until one comes. */
export const EMPTY_USAGE: UsageSnapshot = { limits: [], context: {} }

// What a stored snapshot may hold. A reading comes from the engine, and a
// rate limit's kind may come from a gateway, so each field is checked and cut
// here as well as where it is drawn. Plugin state is readable by other
// plugins, so only the fields the view draws are kept.
const MAX_LIMITS = 20
const MAX_CATEGORIES = 50
const MAX_STORED_TEXT = 200
const MAX_PERCENT = 100000
const MAX_TOKENS = 1e10

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const inRange = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const storedText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_STORED_TEXT

// One rate limit, one context and one list of breakdown rows, each checked.
// A reading names a limit's percent `percentUsed`; a stored snapshot, `percent`.
function limitsFrom(rows: unknown, percentKey: 'percentUsed' | 'percent'): UsageLimit[] {
  const out: UsageLimit[] = []
  if (!Array.isArray(rows)) return out
  for (const r of rows.slice(0, MAX_LIMITS)) {
    if (!isRecord(r) || !storedText(r.kind) || !inRange(r[percentKey], MAX_PERCENT)) continue
    const limit: UsageLimit = { kind: r.kind, percent: r[percentKey] as number }
    if (typeof r.resetsAt === 'string' && r.resetsAt.length <= 40) limit.resetsAt = r.resetsAt
    out.push(limit)
  }
  return out
}

function contextFrom(ctx: unknown): UsageSnapshot['context'] {
  const out: UsageSnapshot['context'] = {}
  if (!isRecord(ctx)) return out
  if (inRange(ctx.percent, MAX_PERCENT)) out.percent = ctx.percent
  if (inRange(ctx.tokens, MAX_TOKENS)) out.tokens = ctx.tokens
  if (inRange(ctx.window, MAX_TOKENS)) out.window = ctx.window
  return out
}

function categoriesFrom(rows: unknown[]): UsageCategory[] {
  const out: UsageCategory[] = []
  for (const c of rows.slice(0, MAX_CATEGORIES)) {
    if (!isRecord(c) || !storedText(c.name) || typeof c.kind !== 'string' || !KINDS.has(c.kind) || !inRange(c.tokens, MAX_TOKENS)) continue
    out.push({ name: c.name, kind: c.kind, tokens: c.tokens })
  }
  return out
}

/** The fields the view draws from a `$.session.usage()` reading, each checked:
 *  per rate limit its kind, percent and reset time; the context's percent,
 *  tokens and window; per breakdown row its name, kind and tokens. A field
 *  that fails its check is left out, and a row whose kind or number fails is
 *  dropped. */
export function snapshotFrom(reading: unknown): UsageSnapshot {
  if (!isRecord(reading)) return { limits: [], context: {} }
  const out: UsageSnapshot = { limits: limitsFrom(reading.rateLimits, 'percentUsed'), context: contextFrom(reading.context) }
  const b = isRecord(reading.context) ? reading.context.breakdown : undefined
  if (isRecord(b) && Array.isArray(b.categories)) out.categories = categoriesFrom(b.categories)
  return out
}

/** A stored snapshot checked again before it is drawn, by the same rules.
 *  Only `snapshotFrom` writes it, but plugin state is the engine's, and the
 *  engine lets another plugin rewrite a value as it is set: a value of the
 *  wrong shape draws as far as it checks, and never throws. */
export function storedSnapshot(stored: unknown): UsageSnapshot {
  if (!isRecord(stored)) return { limits: [], context: {} }
  const out: UsageSnapshot = { limits: limitsFrom(stored.limits, 'percent'), context: contextFrom(stored.context) }
  if (Array.isArray(stored.categories)) out.categories = categoriesFrom(stored.categories)
  return out
}
const KINDS = new Set(['used', 'free', 'buffer', 'deferred'])

// The names the app gives its own windows. Looked up in a Map, never a plain
// object: a kind is free text, and on a plain object `constructor` or
// `toString` would answer with a function.
const LIMIT_NAMES = new Map([
  ['five_hour', 'Current session'],
  ['seven_day', 'Weekly limit'],
  ['spend_limit', 'Spend limit'],
])
const MAX_KIND = 30
const MAX_CATEGORY = 60

/** A rate limit's name as drawn: the app's own for a window it knows, else
 *  its kind made safe to draw on one line and cut to 30 characters. */
export const limitName = (kind: string): string => LIMIT_NAMES.get(kind) ?? oneLine(kind, MAX_KIND)

// An ISO 8601 time with seconds and either Z or an offset, read by hand so
// every engine reads it alike.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

function isoTime(text: string): number | undefined {
  const m = ISO.exec(text)
  if (m === null) return undefined
  const [, y, mo, d, h, mi, s, frac, zone] = m
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3))
  let at = Date.UTC(Number(y), month - 1, day, hour, minute, second, ms)
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const zh = Number(zone.slice(1, 3))
    const zm = Number(zone.slice(4, 6))
    if (zh > 23 || zm > 59) return undefined
    at -= sign * (zh * 60 + zm) * 60000
  }
  // Date.UTC rolls 31 April over to 1 May; a day that rolled is refused.
  return new Date(Date.UTC(Number(y), month - 1, day)).getUTCDate() === day && Number.isFinite(at) ? at : undefined
}

/** "Resets in N d N hr", "Resets in N hr N min" or "Resets in N min", or
 *  undefined when the time is missing or not a valid ISO time. A time in the
 *  past reads as 0 min. */
export function resetsIn(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const at = isoTime(iso)
  if (at === undefined || !Number.isFinite(now)) return undefined
  const mins = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return `Resets in ${d > 0 ? `${d} d ${h} hr` : h > 0 ? `${h} hr ${m} min` : `${m} min`}`
}

/** A token count as the pane draws it: "Nk" from 10,000, "N.Nk" from 1,000,
 *  and "N" below that. */
export function tokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`
  return `${Math.round(n)}`
}

const percentText = (p: number) => `${Math.round(p)}%`

// From 75% a bar is amber, from 90% red.
const level = (p: number) => (p >= 90 ? 'hot' : p >= 75 ? 'warn' : 'ok')
const TONE = new Map([
  ['ok', 'success'],
  ['warn', 'warning'],
  ['hot', 'error'],
])

/** One row of the terminal's text bars. `tone` is a theme colour key. */
export type UsageRow = { name: string; bar: string; percent: string; note: string; tone: string }

/** What the usage section draws: nothing yet, text bars, or an SVG image. */
export type UsageView =
  | { kind: 'none' }
  | { kind: 'text'; rows: UsageRow[] }
  | { kind: 'svg'; source: string; alt: string; width: number; height: number }

const BAR_CELLS = 20

/** The engine's cap on an SVG's source. */
export const SVG_MAX = 131072
/** The most breakdown rows the legend lists. */
export const LEGEND_MAX = 12

/** The breakdown rows the context bar draws: not the tools loaded on demand,
 *  which sit outside the window, and not a row with no tokens. */
const drawnCategories = (s: UsageSnapshot) =>
  (s.categories ?? []).filter(c => c.kind !== 'deferred' && Number.isFinite(c.tokens) && c.tokens > 0)

/** The usage section for one surface at one moment, from the stored snapshot,
 *  checked again here. With no rate limit, no breakdown and no context reading
 *  it is nothing yet, on every surface. The terminal gets text bars: a Context
 *  row from the context's percent and tokens, then a row per rate limit. Every
 *  other surface gets the SVG, or the text bars when there is no rate limit
 *  and no breakdown to draw or the SVG would pass the engine's cap. max is
 *  that cap; the stored caps keep a real snapshot far below it, so a test
 *  passes a smaller one to reach the fallback. */
export function usageView(stored: unknown, surface: string, now: number, max = SVG_MAX): UsageView {
  const s = storedSnapshot(stored)
  if (s.limits.length === 0 && drawnCategories(s).length === 0 && s.context.percent === undefined) return { kind: 'none' }
  if (surface !== 'terminal') {
    const svg = usageSvg(s, now)
    if (svg !== undefined && svg.source.length <= max) return svg
  }
  const rows = textRows(s, now)
  return rows.length === 0 ? { kind: 'none' } : { kind: 'text', rows }
}

function textRows(s: UsageSnapshot, now: number): UsageRow[] {
  const rows: Omit<UsageRow, 'name'>[] = []
  const names: string[] = []
  const cells = (p: number) => {
    const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((p / 100) * BAR_CELLS)))
    return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
  }
  const { percent, tokens: used, window } = s.context
  if (percent !== undefined && Number.isFinite(percent)) {
    names.push('Context')
    rows.push({
      bar: cells(percent),
      percent: percentText(percent),
      note: used !== undefined && window !== undefined ? `${tokens(used)} of ${tokens(window)}` : '',
      tone: TONE.get(level(percent)) ?? 'success',
    })
  }
  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    names.push(limitName(limit.kind))
    rows.push({
      bar: cells(limit.percent),
      percent: percentText(limit.percent),
      note: resetsIn(limit.resetsAt, now) ?? '',
      tone: TONE.get(level(limit.percent)) ?? 'success',
    })
  }
  const width = Math.max(0, ...names.map(n => [...n].length))
  return rows.map((r, i) => ({ name: (names[i] ?? '').padEnd(width), ...r }))
}

// The image cannot read the app's theme, so it carries a palette of its own
// that only approximates the app's, with a dark-mode rule. The class names
// here are the only ones the SVG uses.
const STYLE = [
  "text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;fill:#3d3d3a}",
  '.muted{fill:#73726c}',
  '.track{fill:#e8e6dc}',
  '.ok{fill:#2c84db}.warn{fill:#c27c0e}.hot{fill:#c6413a}',
  '.free{fill:#e8e6dc}.buffer{fill:#d6d3c8}',
  '.c0{fill:#d97757}.c1{fill:#6a9bcc}.c2{fill:#788c5d}.c3{fill:#c46686}.c4{fill:#8b7fc7}.c5{fill:#c9a227}.c6{fill:#5fa8a0}',
  '@media (prefers-color-scheme: dark){text{fill:#e8e6e1}.muted{fill:#9c9a92}.track,.free{fill:#3a3935}.buffer{fill:#4a4944}.ok{fill:#5aa2ef}.warn{fill:#e8a23a}.hot{fill:#ef6b62}}',
].join('')

const W = 480
const XMLNS = 'http://www.w3.org/2000/svg'

// Code points XML forbids even escaped: a lone surrogate, U+FFFE and U+FFFF.
// One of them makes the whole image fail to draw. The controls XML forbids
// are gone already: the one-line cleaner makes them spaces.
const XML_INVALID = /[\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu
const XML_ESCAPE = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

/** Text made safe for the SVG's element content: the one-line cleaner, cut to
 *  `max`, then the code points XML forbids removed, then the XML escape. */
export function svgText(text: string, max: number): string {
  return oneLine(text, max)
    .replace(XML_INVALID, '')
    .replace(/[&<>"']/g, ch => XML_ESCAPE.get(ch) ?? '')
}

/** A number as an attribute value: finite, clamped to the drawing's range and
 *  rounded to two places, so no NaN or Infinity is ever written. */
export function num(v: number, max = 100000): string {
  const n = Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0
  return String(Math.round(n * 100) / 100)
}

// A name on the left, a note on the right, and a thin rounded bar beneath.
function barRow(y: number, name: string, right: string, percent: number): string {
  const fill = (Math.max(0, Math.min(100, percent)) / 100) * W
  return (
    `<text x="0" y="${num(y + 12)}">${svgText(name, MAX_KIND)}</text>` +
    `<text class="muted" x="${num(W)}" y="${num(y + 12)}" text-anchor="end">${svgText(right, 80)}</text>` +
    `<rect class="track" x="0" y="${num(y + 20)}" width="${num(W)}" height="6" rx="3"/>` +
    (fill > 0 ? `<rect class="${level(percent)}" x="0" y="${num(y + 20)}" width="${num(Math.max(6, fill))}" height="6" rx="3"/>` : '')
  )
}

function usageSvg(s: UsageSnapshot, now: number): Extract<UsageView, { kind: 'svg' }> | undefined {
  const parts: string[] = []
  const alt: string[] = []
  let y = 0

  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    const name = limitName(limit.kind)
    const when = resetsIn(limit.resetsAt, now)
    parts.push(barRow(y, name, when === undefined ? percentText(limit.percent) : `${when} · ${percentText(limit.percent)}`, limit.percent))
    alt.push(`${name} ${percentText(limit.percent)}`)
    y += 38
  }

  const shown = drawnCategories(s)
  if (shown.length > 0) {
    // The bar's segments are the breakdown's rows, free space and buffer
    // included. The figures beside it are the engine's own context reading,
    // the ones the terminal's Context row shows, so one reading shows one
    // figure everywhere; only without that reading are they summed from the
    // rows: used is the rows of kind `used`, the window every row drawn.
    const total = shown.reduce((sum, c) => sum + c.tokens, 0)
    const used = shown.filter(c => c.kind === 'used')
    const { percent: ctxPercent, tokens: ctxTokens, window: ctxWindow } = s.context
    const engine = ctxPercent !== undefined && ctxTokens !== undefined && ctxWindow !== undefined
    const usedTokens = engine ? ctxTokens : used.reduce((sum, c) => sum + c.tokens, 0)
    const windowTokens = engine ? ctxWindow : total
    const usedPercent = engine ? ctxPercent : total > 0 ? (usedTokens / total) * 100 : 0
    const cls = (c: UsageCategory) => (c.kind === 'free' ? 'free' : c.kind === 'buffer' ? 'buffer' : `c${Math.max(0, used.indexOf(c)) % 7}`)

    parts.push(`<text x="0" y="${num(y + 12)}">${svgText('Context', MAX_KIND)}</text>`)
    parts.push(
      `<text class="muted" x="${num(W)}" y="${num(y + 12)}" text-anchor="end">${svgText(`${tokens(usedTokens)} / ${tokens(windowTokens)} · ${percentText(usedPercent)}`, 80)}</text>`,
    )
    parts.push(`<clipPath id="cb"><rect x="0" y="${num(y + 20)}" width="${num(W)}" height="8" rx="4"/></clipPath>`)
    parts.push(`<rect class="track" x="0" y="${num(y + 20)}" width="${num(W)}" height="8" rx="4"/>`)
    const segments: string[] = []
    let x = 0
    for (const c of shown) {
      const w = total > 0 ? (c.tokens / total) * W : 0
      // A hairline gap between used segments, as the app's segmented bar has.
      const gap = c.kind === 'used' && w > 2 ? 1 : 0
      segments.push(`<rect class="${cls(c)}" x="${num(x)}" y="${num(y + 20)}" width="${num(w - gap)}" height="8"/>`)
      x += w
    }
    parts.push(`<g clip-path="url(#cb)">${segments.join('')}</g>`)
    y += 40

    // The legend: two columns of dot, name and tokens, at most LEGEND_MAX rows.
    const legend = shown.slice(0, LEGEND_MAX)
    const col = W / 2
    legend.forEach((c, i) => {
      const cx = (i % 2) * col
      const cy = y + Math.floor(i / 2) * 18
      parts.push(`<circle class="${cls(c)}" cx="${num(cx + 4)}" cy="${num(cy + 8)}" r="4"/>`)
      parts.push(`<text x="${num(cx + 14)}" y="${num(cy + 12)}">${svgText(c.name, MAX_CATEGORY)}</text>`)
      parts.push(`<text class="muted" x="${num(cx + col - 10)}" y="${num(cy + 12)}" text-anchor="end">${svgText(tokens(c.tokens), 20)}</text>`)
    })
    y += Math.ceil(legend.length / 2) * 18
    alt.push(`Context ${percentText(usedPercent)}: ${legend.map(c => `${oneLine(c.name, MAX_CATEGORY)} ${tokens(c.tokens)}`).join(', ')}`)
  }

  if (y === 0) return undefined
  const height = num(y)
  const source =
    `<svg xmlns="${XMLNS}" width="${num(W)}" height="${height}" viewBox="0 0 ${num(W)} ${height}">` +
    `<style>${STYLE}</style>${parts.join('')}</svg>`
  return { kind: 'svg', source, alt: oneLine(`Usage: ${alt.join('; ')}`, 2000), width: W, height: Number(height) }
}

// --- Tick and undo ---------------------------------------------------------
//
// A press on a to-do's box ticks it: the to-do stays, crossed out, for the
// grace period, and a second press inside it undoes the tick. The roster
// timer's sweep then moves it to done. `ticking` holds pairs of to-do id and
// tick time, in epoch ms as text.

/** How long a ticked to-do stays, crossed out, before the sweep moves it. */
export const GRACE_MS = 30000
const MAX_TICKS = 50

/** The stored ticks, checked again: a list of pairs whose name is text within
 *  the stored cap, the first of a repeated name kept, at most 50. A value
 *  that is not text is kept as an empty value, which the sweep counts as due.
 *  Plugin state is the engine's, and another plugin may rewrite it. */
export function ticksFrom(stored: unknown): Pair[] {
  const out: Pair[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const p of stored) {
    if (out.length >= MAX_TICKS) break
    if (!isRecord(p) || typeof p.name !== 'string' || p.name === '' || p.name.length > MAX_STORED_TEXT || names.has(p.name)) continue
    names.add(p.name)
    out.push({ name: p.name, value: typeof p.value === 'string' ? p.value : '' })
  }
  return out
}

/** The stored done list, checked again: the text entries of a list, and
 *  nothing from any other shape, so a value another plugin wrote cannot make
 *  the render throw. */
export function idsFrom(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
}

/** A press: tick the to-do with the press time, or undo its tick. */
export function toggleTick(stored: unknown, id: string, now: number): Pair[] {
  const ticking = ticksFrom(stored)
  return ticking.some(p => p.name === id) ? ticking.filter(p => p.name !== id) : [...ticking, { name: id, value: String(now) }]
}

// Due: the grace period has passed, the time is not a number, or the time is
// more than a grace period ahead of the clock, so a planted far-future time
// cannot keep a to-do crossed out for good.
const isDue = (p: Pair, now: number) => {
  const age = now - Number(p.value)
  return !Number.isFinite(age) || age >= GRACE_MS || age <= -GRACE_MS
}

/** The sweep: a tick whose to-do is no longer in the roster is dropped, a due
 *  one moves to `done`, and the rest stay. `todoIds` is undefined when the
 *  roster load failed or found no file: then every tick stays, due ones too,
 *  so a brief miss cannot silently undo a tick. */
export function sweepTicks(stored: unknown, now: number, todoIds: readonly string[] | undefined): { ticking: Pair[]; done: string[] } {
  const ticking = ticksFrom(stored)
  if (todoIds === undefined) return { ticking, done: [] }
  const present = new Set(todoIds)
  const kept: Pair[] = []
  const done: string[] = []
  for (const p of ticking) {
    if (!present.has(p.name)) continue
    if (isDue(p, now)) done.push(p.name)
    else kept.push(p)
  }
  return { ticking: kept, done }
}

/** One write to a stored value, as the engine's `update` makes it: the
 *  function may run more than once, and the last run's result is written. */
export type Updater<T> = (fn: (value: T) => T) => Promise<unknown>

/** The roster timer's sweep, carried out. The due ids are worked out inside
 *  the `ticking` update, from the value that update writes over, so an undo
 *  that lands between a read and a write cannot be lost to a stale read. Then
 *  those ids, and no others, are added to `doneTodos`, each once. With no
 *  roster load to go by (`todoIds` undefined) nothing is written. Resolves the
 *  ids it moved. */
export async function settleTicks(
  ticking: Updater<Pair[]>,
  doneTodos: Updater<string[]>,
  now: number,
  todoIds: readonly string[] | undefined,
): Promise<string[]> {
  if (todoIds === undefined) return []
  let due: string[] = []
  await ticking(list => {
    const swept = sweepTicks(list, now, todoIds)
    due = swept.done
    return swept.ticking
  })
  if (due.length > 0) {
    const moved = due
    await doneTodos(list => {
      const had = idsFrom(list)
      const seen = new Set(had)
      return [...had, ...moved.filter(id => !seen.has(id))]
    })
  }
  return due
}

/** The count beside "Waiting on you": the cards that need the owner, plus the
 *  to-dos that are neither done nor ticking. */
export function waitingCount(needsYou: number, todos: readonly { id: string }[], done: unknown, ticking: unknown): number {
  const out = new Set([...idsFrom(done), ...ticksFrom(ticking).map(p => p.name)])
  return needsYou + todos.filter(t => !out.has(t.id)).length
}

// --- Cache warmth ----------------------------------------------------------
//
// A session's prompt cache lasts for the window its last cache write asked
// for, one hour or five minutes, from its last model call. The ◆ line says
// how long the session has been idle, when it goes cold, and how big its
// context is. All of it comes from the session's own transcript, text another
// session wrote, so every row is checked for shape and size before it counts.

/** The engine refuses to read a file over 4 MiB, so the pane does not try. */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024
/** From this many context tokens a cold cache costs enough to nudge about. */
export const NUDGE_TOKENS = 100000

const MIN_MS = 60000
const HOUR_MS = 60 * MIN_MS
const SHORT_MS = 5 * MIN_MS
const AMBER_MS = 15 * MIN_MS
// A row may claim a time up to this much past the file's modified time, for
// the clock's slack; a later one claims to be newer than the file it is in.
const SLACK_MS = 2 * MIN_MS
const MAX_COUNT = 10000000
const MAX_WARMTH = 50
const MAX_NAME = 300

/** The last real model call in a transcript: its time, its context tokens,
 *  and its cache window when a call that wrote cache says it. */
export type LastCall = { at: number; tokens: number; windowMs?: number }

// The time Claude Code writes, ISO in UTC: an offset is refused.
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

// A token count as a row may give it: absent counts as 0, else a whole
// number from 0 to 10,000,000. Anything else spoils the row.
const count = (v: unknown): number | undefined =>
  v === undefined ? 0 : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : undefined

// One transcript line as a model call, or undefined when it is not a real one
// or fails a check: a `<synthetic>` row, an API error, a sidechain, an offset
// or unreadable time, a time past `latest`, a count out of range, or no
// context at all. Claude Code writes an assistant-shaped row with zero usage
// when a turn ends on an error, and taking it would show a cold session warm.
function callRow(line: string, latest: number): LastCall | undefined {
  let r: unknown
  try {
    r = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(r) || r.type !== 'assistant' || typeof r.timestamp !== 'string') return undefined
  if (r.isApiErrorMessage === true || r.isSidechain === true) return undefined
  const m = r.message
  if (!isRecord(m) || !isRecord(m.usage) || m.model === '<synthetic>') return undefined
  if (!UTC.test(r.timestamp)) return undefined
  const at = isoTime(r.timestamp)
  if (at === undefined || at > latest) return undefined
  const u = m.usage
  const input = count(u.input_tokens)
  const made = count(u.cache_creation_input_tokens)
  const cached = count(u.cache_read_input_tokens)
  if (input === undefined || made === undefined || cached === undefined) return undefined
  let short: number | undefined = 0
  let long: number | undefined = 0
  if (u.cache_creation !== undefined) {
    if (!isRecord(u.cache_creation)) return undefined
    short = count(u.cache_creation.ephemeral_5m_input_tokens)
    long = count(u.cache_creation.ephemeral_1h_input_tokens)
    if (short === undefined || long === undefined) return undefined
  }
  const tokens = input + made + cached
  if (tokens === 0) return undefined
  const call: LastCall = { at, tokens }
  if (long > 0) call.windowMs = HOUR_MS
  else if (short > 0) call.windowMs = SHORT_MS
  return call
}

/** The last real model call in a transcript's text, or undefined. Scans from
 *  the end for the first row that passes every check, then on back, in the
 *  same scan, for the last row that wrote cache, whose window it takes: a
 *  call that only read the cache does not say its window. With no such row
 *  the window is unknown. `mtimeMs` is the file's modified time, used only to
 *  refuse a row that claims a time more than 2 minutes after it, never as
 *  the call's time. */
export function lastCall(text: string, mtimeMs: number): LastCall | undefined {
  if (!Number.isFinite(mtimeMs)) return undefined
  const latest = mtimeMs + SLACK_MS
  const lines = text.split('\n')
  let found: LastCall | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.includes('"assistant"')) continue
    const call = callRow(line, latest)
    if (call === undefined) continue
    found ??= { at: call.at, tokens: call.tokens }
    if (call.windowMs !== undefined) {
      found.windowMs = call.windowMs
      break
    }
  }
  return found
}

/** A live state that means the session is working: its cache is warm. */
// A background row with no `status` says it in `state`, which reads `working`
// while it works.
export const isWorking = (state: string | undefined) => state === 'busy' || state === 'running' || state === 'working'

/** A live state as the card draws it, with its theme colour: `busy`,
 *  `running` and `working` success, `idle` and `blocked` warning, anything
 *  else inactive. */
export function liveState(state: string | undefined): { text: string; color: string } {
  if (state === undefined) return { text: 'not running', color: 'inactive' }
  return { text: state, color: isWorking(state) ? 'success' : state === 'idle' || state === 'blocked' ? 'warning' : 'inactive' }
}

const KINDS_OF_WARMTH = new Set(['call', 'too-large', 'shared', 'unread'])
const OTHER_KINDS = new Map<string, 'too-large' | 'shared' | 'unread'>([
  ['too-large', 'too-large'],
  ['shared', 'shared'],
  ['unread', 'unread'],
])
const WINDOWS = new Set([SHORT_MS, HOUR_MS])

/** The stored warmth records, checked again: plugin state is the engine's,
 *  and another plugin may rewrite it. A record of the wrong shape goes, a
 *  repeated name keeps the first, and at most 50 stay. */
export function warmthFrom(stored: unknown): Warmth[] {
  const out: Warmth[] = []
  if (!Array.isArray(stored)) return out
  const names = new Set<string>()
  for (const w of stored) {
    if (out.length >= MAX_WARMTH) break
    if (!isRecord(w) || typeof w.name !== 'string' || w.name === '' || w.name.length > MAX_NAME || names.has(w.name)) continue
    if (typeof w.kind !== 'string' || !KINDS_OF_WARMTH.has(w.kind)) continue
    if (w.kind === 'call') {
      if (typeof w.at !== 'number' || !Number.isFinite(w.at)) continue
      if (typeof w.tokens !== 'number' || !Number.isInteger(w.tokens) || w.tokens < 0 || w.tokens > 3 * MAX_COUNT) continue
      if (w.windowMs !== undefined && (typeof w.windowMs !== 'number' || !WINDOWS.has(w.windowMs))) continue
      const call: Warmth = { name: w.name, kind: 'call', at: w.at, tokens: w.tokens }
      if (w.windowMs !== undefined) call.windowMs = w.windowMs
      out.push(call)
    } else {
      const kind = OTHER_KINDS.get(w.kind)
      if (kind === undefined) continue
      out.push({ name: w.name, kind })
    }
    names.add(w.name)
  }
  return out
}

// "N min" under an hour, "N hr N min" from an hour.
const span = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`)

/** One card's ◆ line: its tone (`dim` or a theme colour), its text, and a
 *  nudge for a large card that waits on the owner, or undefined with no
 *  record. A transcript too large to read and a name two sessions share
 *  read unknown, whatever the live state. A working session is warm, with no
 *  size when its transcript has not been read yet. Else
 *  the idle time sets the band: more than 15 min left green, 15 min or less
 *  amber, none left red; with no known window, no countdown. The nudge needs
 *  status `needs-you`, 100,000 or more tokens, a known window and a session
 *  that is not working. */
export function warmthLine(
  w: Warmth | undefined,
  state: string | undefined,
  status: string,
  now: number,
): { tone: 'dim' | 'success' | 'warning' | 'error'; text: string; nudge?: string } | undefined {
  if (w === undefined) return undefined
  if (w.kind === 'too-large') return { tone: 'dim', text: '◆ cache unknown · transcript too large to read' }
  if (w.kind === 'shared') return { tone: 'dim', text: '◆ cache unknown · two sessions share this name' }
  if (w.kind === 'unread') return isWorking(state) ? { tone: 'dim', text: '◆ cache warm (working)' } : undefined
  const size = `${tokens(w.tokens)} context`
  if (isWorking(state)) return { tone: 'dim', text: `◆ cache warm (working) · ${size}` }
  const idle = Math.max(0, now - w.at)
  const idleText = span(Math.floor(idle / MIN_MS))
  if (w.windowMs === undefined) return { tone: 'dim', text: `◆ cache window unknown · idle ${idleText} · ${size}` }
  const left = w.windowMs - idle
  const large = status === 'needs-you' && w.tokens >= NUDGE_TOKENS
  if (left <= 0) {
    const cold = { tone: 'error' as const, text: `◆ cache cold · idle ${idleText} · ${size}` }
    return large
      ? { ...cold, nudge: `Replying re-reads about ${tokens(w.tokens)} tokens at full price. Consider a hand-off through the issue to a fresh session.` }
      : cold
  }
  const leftText = span(Math.ceil(left / MIN_MS))
  const text = `◆ cache warm · idle ${idleText} · cold in ${leftText} · ${size}`
  if (left > AMBER_MS) return { tone: 'success', text }
  return large ? { tone: 'warning', text, nudge: `Reply within ${leftText} to keep the cache.` } : { tone: 'warning', text }
}

/** What the agents poll remembers of each transcript it read, keyed by path:
 *  its modified time at that read and the last call parsed from it. */
export type ReadMemory = Map<string, { mtimeMs: number; call: LastCall | undefined }>

/** The file system as the poll reaches it, and whether the pane is still
 *  open. `stat` and `read` may reject. */
export type WarmthIo = {
  live: () => boolean
  stat: (path: string) => Promise<{ kind: string; size: number; mtimeMs: number; isLink?: boolean }>
  read: (path: string) => Promise<string>
}

/** The agents poll's warmth reads, and the records they give, or undefined
 *  when the pane closed on the way, so nothing is stored.
 *
 *  Only a roster member is read, by the transcript path its one row names. A
 *  name on two rows is shared: neither transcript is read. Each path must
 *  stat as a regular file, the file itself not a link. One over 4 MiB is not
 *  read and records "too large". A transcript is read only when its modified
 *  time differs from the one `memory` holds for its path, and never while
 *  its session is working (`busy`, `running` or `working`). `memory` gets an
 *  entry only after a read and a parse that succeeded, so a failed read is
 *  tried again at the next poll; the record is then the last good one. A
 *  working member with no known call records `unread`. Paths no member
 *  names leave it. */
export async function readWarmth(
  rows: readonly AgentRow[],
  titles: readonly string[],
  config: string,
  memory: ReadMemory,
  io: WarmthIo,
): Promise<Warmth[] | undefined> {
  const members = new Set(titles)
  const byName = new Map<string, AgentRow[]>()
  for (const r of rows) {
    if (members.has(r.name)) byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  }
  const out: Warmth[] = []
  const named = new Set<string>()
  for (const [name, list] of byName) {
    const row = list[0]
    if (list.length > 1 || row === undefined) {
      out.push({ name, kind: 'shared' })
      continue
    }
    const path = transcriptFile(config, row)
    if (path === undefined) continue
    named.add(path)
    if (!io.live()) return undefined
    const stat = await io.stat(path).catch(() => undefined)
    if (!io.live()) return undefined
    if (stat === undefined || stat.kind !== 'file' || stat.isLink === true || !Number.isFinite(stat.mtimeMs)) continue
    if (!Number.isFinite(stat.size) || stat.size > MAX_TRANSCRIPT_BYTES) {
      out.push({ name, kind: 'too-large' })
      continue
    }
    if (!isWorking(row.status) && memory.get(path)?.mtimeMs !== stat.mtimeMs) {
      const text = await io.read(path).catch(() => undefined)
      if (!io.live()) return undefined
      if (text !== undefined) memory.set(path, { mtimeMs: stat.mtimeMs, call: lastCall(text, stat.mtimeMs) })
    }
    const call = memory.get(path)?.call
    if (call !== undefined) out.push({ name, kind: 'call', ...call })
    // Working with no known call: never read, or read before its first model
    // call. No read runs while it works, so its card says it is working, with
    // no size.
    else if (isWorking(row.status)) out.push({ name, kind: 'unread' })
  }
  for (const path of [...memory.keys()]) if (!named.has(path)) memory.delete(path)
  return out
}