import { oneLine } from './roster.ts'
import type { Pair, UsageCategory, UsageLimit, UsageSnapshot } from './types'

// What the Brigade pane draws, worked out from plain values: the render hook
// in register.tsx only turns these results into elements. Plain TypeScript
// with erasable syntax only and no engine import, so `node --test` imports
// this file as it is.
//
// The to-dos: a tick that can be undone for a grace period, then moves the
// to-do to done.
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
      const had = Array.isArray(list) ? list : []
      const seen = new Set(had)
      return [...had, ...moved.filter(id => !seen.has(id))]
    })
  }
  return due
}

/** The count beside "Waiting on you": the cards that need the owner, plus the
 *  to-dos that are neither done nor ticking. */
export function waitingCount(needsYou: number, todos: readonly { id: string }[], done: unknown, ticking: unknown): number {
  const out = new Set([...(Array.isArray(done) ? done : []), ...ticksFrom(ticking).map(p => p.name)])
  return needsYou + todos.filter(t => !out.has(t.id)).length
}
