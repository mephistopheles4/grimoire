import { SESSION_ID, foldsCase, oneLine, pathKey, projectFolder, sepOf } from './roster.ts'
import type { AgentRow } from './roster.ts'
import type { Pair, Sample, UsageCategory, UsageLimit, UsageSnapshot, Warmth } from './types'

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
// The transcript finder: where a member's transcript is, from its working
// directory or, after it moved into a worktree, from the worktree folders of
// its launch folder, each checked to lie where its name says before a read.
//
// The usage section: this session's own rate limits and context fill, at the
// bottom of the pane. On the terminal it is rows of text bars. Everywhere else
// it is an SVG image, built here as a string. Every piece of text in that
// string goes through `svgText`, and every attribute value is a number or
// percentage this module worked out (`num`, `pct`), or a fixed name: a class
// from `STYLE`, a clip id (`cb` for the usage image, `st` for the status
// strip), `end`, the one gap transform. The test's attribute allowlist holds
// every image this module builds to those forms: the usage image, the status
// strip and the to-do bar.

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

/** One row of the terminal's text bars. `tone` is a theme colour key, for
 *  `bar`. `ahead` is drawn dim after it: the projection's ░ cells, then the
 *  blanks; the two together are always 20 cells, and with no projection
 *  `bar` is all 20 and `ahead` is empty. `noteTone` is a theme colour key for
 *  the note, or empty for a dim note. */
export type UsageRow = { name: string; bar: string; ahead: string; percent: string; note: string; tone: string; noteTone: string }

/** What the usage section draws: nothing yet, text bars, or an SVG image.
 *  The image has a fixed height and no width: it is placed in percentages,
 *  so it takes the width of the box it is drawn in. */
export type UsageView =
  | { kind: 'none' }
  | { kind: 'text'; rows: UsageRow[] }
  | { kind: 'svg'; source: string; alt: string; height: number }

const BAR_CELLS = 20

// The partial cells, one to seven eighths full.
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A terminal bar of `cells` cells: full blocks, one partial block to the
 *  nearest eighth of a cell, then blanks. The fraction is clamped to between
 *  0 and 1, and one that is not a finite number is 0. It never throws and
 *  always returns exactly `cells` characters, the end marks left to the
 *  caller; a cell count that is not a positive whole number gives an empty
 *  string. */
export function eighthBar(fraction: number, cells: number): string {
  const n = Number.isInteger(cells) && cells > 0 ? cells : 0
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const eighths = Math.round(f * n * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[(eighths % 8) - 1] ?? ''
  const drawn = '█'.repeat(full) + part
  return drawn + ' '.repeat(n - [...drawn].length)
}

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
 *  passes a smaller one to reach the fallback. `samples` is the stored
 *  sample buffer, checked again here, for the session limit's projection. */
export function usageView(stored: unknown, surface: string, now: number, max = SVG_MAX, samples: unknown = []): UsageView {
  const s = storedSnapshot(stored)
  if (s.limits.length === 0 && drawnCategories(s).length === 0 && s.context.percent === undefined) return { kind: 'none' }
  const kept = samplesFrom(samples)
  if (surface !== 'terminal') {
    const svg = usageSvg(s, now, kept)
    if (svg !== undefined && svg.source.length <= max) return svg
  }
  const rows = textRows(s, now, kept)
  return rows.length === 0 ? { kind: 'none' } : { kind: 'text', rows }
}

function textRows(s: UsageSnapshot, now: number, samples: readonly Sample[]): UsageRow[] {
  const rows: Omit<UsageRow, 'name'>[] = []
  const names: string[] = []
  const cells = (p: number) => eighthBar(p / 100, BAR_CELLS)
  const { percent, tokens: used, window } = s.context
  if (percent !== undefined && Number.isFinite(percent)) {
    names.push('Context')
    rows.push({
      bar: cells(percent),
      ahead: '',
      percent: percentText(percent),
      note: used !== undefined && window !== undefined ? `${tokens(used)} of ${tokens(window)}` : '',
      tone: TONE.get(level(percent)) ?? 'success',
      noteTone: '',
    })
  }
  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    names.push(limitName(limit.kind))
    const p = projection(limit, samples, now)
    rows.push({
      ...projectedCells(limit.percent, p),
      percent: percentText(limit.percent),
      note: p?.earlyMs !== undefined ? earlyText(p.earlyMs) : (resetsIn(limit.resetsAt, now) ?? ''),
      tone: TONE.get(level(limit.percent)) ?? 'success',
      noteTone: p?.earlyMs !== undefined ? 'error' : '',
    })
  }
  const width = Math.max(0, ...names.map(n => [...n].length))
  return rows.map((r, i) => ({ name: (names[i] ?? '').padEnd(width), ...r }))
}

// The image cannot read the app's theme, so it carries a palette of its own
// that only approximates the app's, with a dark-mode rule. The class names
// here are the only ones the SVG uses. Exported so the allowlist test can
// hold every image's style block to exactly this text.
export const STYLE = [
  "text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;fill:#3d3d3a}",
  '.muted{fill:#73726c}',
  '.track{fill:#e8e6dc}',
  '.ok{fill:#2c84db}.warn{fill:#c27c0e}.hot{fill:#c6413a}',
  // The usage projection: a faint form of ok's blue.
  '.proj{fill:#a9cdf0}',
  '.done{fill:#3f8f4f}.stopped{fill:#9c9a92}',
  '.free{fill:#e8e6dc}.buffer{fill:#d6d3c8}',
  '.c0{fill:#d97757}.c1{fill:#6a9bcc}.c2{fill:#788c5d}.c3{fill:#c46686}.c4{fill:#8b7fc7}.c5{fill:#c9a227}.c6{fill:#5fa8a0}',
  '@media (prefers-color-scheme: dark){text{fill:#e8e6e1}.muted{fill:#9c9a92}.track,.free{fill:#3a3935}.buffer{fill:#4a4944}.ok{fill:#5aa2ef}.proj{fill:#2f5f8f}.warn{fill:#e8a23a}.hot{fill:#ef6b62}.done{fill:#62b56f}.stopped{fill:#6b6a64}}',
].join('')

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

/** A number as a percentage attribute value: `num` up to 100, then `%`. */
export const pct = (v: number): string => `${num(v, 100)}%`

// A name on the left, a note on the right, and a thin rounded bar beneath,
// placed in percentages so the row spans the image's width. A projection is a
// faint bar from 0 to the projected percent, capped at 100%, drawn under the
// fill: the fill covers it up to the bar's end, so what shows is the part from
// the bar's end to the projected percent. An early note is red, else muted.
function barRow(y: number, name: string, right: string, percent: number, projected?: number, early = false): string {
  return (
    `<text x="0" y="${num(y + 12)}">${svgText(name, MAX_KIND)}</text>` +
    `<text class="${early ? 'hot' : 'muted'}" x="100%" y="${num(y + 12)}" text-anchor="end">${svgText(right, 80)}</text>` +
    `<rect class="track" x="0" y="${num(y + 20)}" width="100%" height="6" rx="3"/>` +
    (projected !== undefined ? `<rect class="proj" x="0" y="${num(y + 20)}" width="${pct(Math.min(100, projected))}" height="6" rx="3"/>` : '') +
    // A fill never narrower than 6 px: a pixel minimum cannot be written as
    // a percentage, so a fixed 6 px stub sits under the percentage fill, and
    // the two cover whichever is wider.
    (percent > 0
      ? `<rect class="${level(percent)}" x="0" y="${num(y + 20)}" width="6" height="6" rx="3"/>` +
        `<rect class="${level(percent)}" x="0" y="${num(y + 20)}" width="${pct(percent)}" height="6" rx="3"/>`
      : '')
  )
}

function usageSvg(s: UsageSnapshot, now: number, samples: readonly Sample[]): Extract<UsageView, { kind: 'svg' }> | undefined {
  const parts: string[] = []
  const alt: string[] = []
  let y = 0

  for (const limit of s.limits) {
    if (!Number.isFinite(limit.percent)) continue
    const name = limitName(limit.kind)
    const p = projection(limit, samples, now)
    const earlyNote = p?.earlyMs !== undefined ? earlyText(p.earlyMs) : undefined
    const when = earlyNote ?? resetsIn(limit.resetsAt, now)
    parts.push(barRow(y, name, when === undefined ? percentText(limit.percent) : `${when} · ${percentText(limit.percent)}`, limit.percent, p?.percent, earlyNote !== undefined))
    alt.push(
      `${name} ${percentText(limit.percent)}` +
        (p === undefined ? '' : `, on pace for ${percentText(p.percent)} at reset`) +
        (earlyNote === undefined ? '' : `, ${earlyNote}`),
    )
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
      `<text class="muted" x="100%" y="${num(y + 12)}" text-anchor="end">${svgText(`${tokens(usedTokens)} / ${tokens(windowTokens)} · ${percentText(usedPercent)}`, 80)}</text>`,
    )
    parts.push(`<clipPath id="cb"><rect x="0" y="${num(y + 20)}" width="100%" height="8" rx="4"/></clipPath>`)
    parts.push(`<rect class="track" x="0" y="${num(y + 20)}" width="100%" height="8" rx="4"/>`)
    const segments: string[] = []
    let x = 0
    for (const c of shown) {
      const w = total > 0 ? (c.tokens / total) * 100 : 0
      // A gap between used segments, as the app's segmented bar has. A gap
      // in pixels cannot be written in percentages, so the segment sits in a
      // nested <svg> and its rect moves 2 px left: the nested <svg> cuts off
      // what spills, leaving 2 px clear at its right edge at any width. `w`
      // is the segment's percentage of the bar; at 1% or less the 2 px gap
      // would eat most of it on a narrow pane, so it gets none.
      if (c.kind === 'used' && w > 1) {
        segments.push(
          `<svg x="${pct(x)}" y="${num(y + 20)}" width="${pct(w)}" height="8"><rect class="${cls(c)}" width="100%" height="8" transform="translate(-2 0)"/></svg>`,
        )
      } else {
        segments.push(`<rect class="${cls(c)}" x="${pct(x)}" y="${num(y + 20)}" width="${pct(w)}" height="8"/>`)
      }
      x += w
    }
    parts.push(`<g clip-path="url(#cb)">${segments.join('')}</g>`)
    y += 40

    // The legend: two columns of dot, name and tokens, at most LEGEND_MAX
    // rows. Each entry is a nested <svg> half the image wide, at 0 or 50%,
    // so its dot and name can sit a fixed number of pixels in; the right
    // column's entries sit 10 px further in, clear of the left column's
    // tokens.
    const legend = shown.slice(0, LEGEND_MAX)
    legend.forEach((c, i) => {
      const inset = (i % 2) * 10
      parts.push(
        `<svg x="${i % 2 === 0 ? '0' : '50%'}" y="${num(y + Math.floor(i / 2) * 18)}" width="50%" height="18">` +
          `<circle class="${cls(c)}" cx="${num(inset + 4)}" cy="8" r="4"/>` +
          `<text x="${num(inset + 14)}" y="12">${svgText(c.name, MAX_CATEGORY)}</text>` +
          `<text class="muted" x="100%" y="12" text-anchor="end">${svgText(tokens(c.tokens), 20)}</text>` +
          '</svg>',
      )
    })
    y += Math.ceil(legend.length / 2) * 18
    alt.push(`Context ${percentText(usedPercent)}: ${legend.map(c => `${oneLine(c.name, MAX_CATEGORY)} ${tokens(c.tokens)}`).join(', ')}`)
  }

  if (y === 0) return undefined
  // No viewBox: nothing is scaled, so text keeps its size, and the image
  // takes its box's width. Only the height is fixed.
  const height = num(y)
  const source = `<svg xmlns="${XMLNS}" width="100%" height="${height}">` + `<style>${STYLE}</style>${parts.join('')}</svg>`
  return { kind: 'svg', source, alt: oneLine(`Usage: ${alt.join('; ')}`, 2000), height: Number(height) }
}

// --- Usage projection --------------------------------------------------------
//
// Where the session limit and the weekly limit will be at reset if the
// current pace holds. Only `five_hour` and `seven_day` get one, each with a
// reset time `isoTime` reads; a kind a gateway names gets none. The session
// limit's pace is recent: the change across the samples the pane took of it
// in the last 30 minutes. The weekly limit's is its average since the week
// began, so it takes no samples. The samples are plugin state, which another
// plugin can rewrite, so every read goes through `samplesFrom`.

/** The least time between two samples of the session limit. */
export const SAMPLE_MS = 30000
/** The most samples kept: an hour at one every 30 s. */
export const MAX_SAMPLES = 120
const RECENT_MS = 30 * 60000
const MIN_SPAN_MS = 5 * 60000
const WEEK_MS = 7 * 24 * 3600000
const MIN_WEEK_MS = 3600000

/** The stored sample buffer, checked again: a list of at most 120 samples,
 *  each `at` a finite number and `percent` from 0 to 100, times increasing.
 *  A buffer that fails any check is treated as empty, whole: a buffer cut
 *  down to its good samples could hold a pace nobody measured. Each field is
 *  read once, and a read that throws counts as a failed check, so a value
 *  that changes or throws as it is read cannot pass or break it. */
export function samplesFrom(stored: unknown): Sample[] {
  try {
    if (!Array.isArray(stored)) return []
    // The length is read once and the list walked by position up to it,
    // never by its own walker, which could yield more than it reports.
    const length = stored.length
    if (typeof length !== 'number' || length > MAX_SAMPLES) return []
    const out: Sample[] = []
    for (let i = 0; i < length; i++) {
      const s: unknown = stored[i]
      if (!isRecord(s)) return []
      const at = s.at
      const percent = s.percent
      if (typeof at !== 'number' || !Number.isFinite(at) || !inRange(percent, 100)) return []
      const last = out[out.length - 1]
      if (last !== undefined && at <= last.at) return []
      out.push({ at, percent })
    }
    return out
  } catch {
    return []
  }
}

/** The buffer after a usage reading: the session limit's percent at `now`
 *  appended, at most one sample every 30 s and at most 120 kept. A percent
 *  lower than the last sample's means the window reset, and a last sample
 *  dated after `now` means the clock went back or the value was rewritten:
 *  either way the buffer starts over at this sample. A reading with no
 *  session limit, or one over 100%, which the check would refuse, adds
 *  nothing. */
export function addSample(stored: unknown, s: UsageSnapshot, now: number): Sample[] {
  const kept = samplesFrom(stored)
  const limit = s.limits.find(l => l.kind === 'five_hour')
  if (limit === undefined || !inRange(limit.percent, 100) || !Number.isFinite(now)) return kept
  const next = { at: now, percent: limit.percent }
  const last = kept[kept.length - 1]
  if (last === undefined || limit.percent < last.percent || now < last.at) return [next]
  if (now - last.at < SAMPLE_MS) return kept
  return [...kept, next].slice(-MAX_SAMPLES)
}

// Percent a millisecond, from the oldest sample in the last 30 minutes to the
// newest, or undefined when they are under 5 minutes apart. A sample dated
// after `now` is left out.
function recentPace(samples: readonly Sample[], now: number): number | undefined {
  const recent = samples.filter(x => x.at >= now - RECENT_MS && x.at <= now)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined || last.at - first.at < MIN_SPAN_MS) return undefined
  return (last.percent - first.percent) / (last.at - first.at)
}

/** A limit's projection: the percent it will be at reset at the current
 *  pace, and past 100% how many milliseconds before the reset it runs out. */
export type Projection = { percent: number; earlyMs?: number }

/** The projection for one limit, or undefined: for a kind other than
 *  `five_hour` and `seven_day`, for a limit already run out, with no reset
 *  time to read or none still ahead, with too little to measure a pace from
 *  (under 5 minutes between
 *  the session limit's samples, under an hour since the weekly limit's week
 *  began), or when the pace is 0 or less. */
export function projection(limit: UsageLimit, samples: readonly Sample[], now: number): Projection | undefined {
  if (limit.kind !== 'five_hour' && limit.kind !== 'seven_day') return undefined
  // A limit at or over 100%, as its row draws it rounded, has run out: no
  // projection, so its row keeps the reset time, when it comes back (owner
  // decision q1 A).
  if (Math.round(limit.percent) >= 100) return undefined
  const reset = limit.resetsAt === undefined ? undefined : isoTime(limit.resetsAt)
  if (reset === undefined || !Number.isFinite(now) || !Number.isFinite(limit.percent) || reset <= now) return undefined
  let pace: number | undefined
  if (limit.kind === 'five_hour') {
    pace = recentPace(samples, now)
  } else {
    const since = now - (reset - WEEK_MS)
    pace = since >= MIN_WEEK_MS ? limit.percent / since : undefined
  }
  if (pace === undefined || !Number.isFinite(pace) || pace <= 0) return undefined
  const percent = limit.percent + pace * (reset - now)
  if (!Number.isFinite(percent)) return undefined
  if (percent <= 100) return { percent }
  const earlyMs = reset - (now + (100 - limit.percent) / pace)
  return Number.isFinite(earlyMs) ? { percent, earlyMs } : { percent }
}

/** A span as the early note reads it: minutes under an hour, hours under a
 *  day, then days, each rounded, and never under 1 minute. A span that is not
 *  a finite number reads as 1 minute. */
export function roughTime(ms: number): string {
  const mins = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 60000)) : 1
  if (mins >= 1440) return `${Math.round(mins / 1440)} d`
  if (mins >= 60) return `${Math.round(mins / 60)} hr`
  return `${mins} min`
}

const earlyText = (ms: number) => `runs out about ${roughTime(ms)} early`

// A limit's terminal cells: its bar, then with a projection the ░ cells from
// the bar's end to the projected percent, capped at 20 cells, then blanks.
function projectedCells(percent: number, p: Projection | undefined): { bar: string; ahead: string } {
  const full = eighthBar(percent / 100, BAR_CELLS)
  if (p === undefined) return { bar: full, ahead: '' }
  const bar = full.trimEnd()
  const used = [...bar].length
  const to = Math.round((Math.min(100, Math.max(0, p.percent)) / 100) * BAR_CELLS)
  const cells = Math.max(0, to - used)
  return { bar, ahead: '░'.repeat(cells) + ' '.repeat(BAR_CELLS - used - cells) }
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

// --- Severity groups --------------------------------------------------------
//
// The cards sit in three groups by the status the head chef wrote: NEEDS YOU,
// WORKING, and DONE · STOPPED, which a press folds open and shut. The stored
// roster is drawn as stored, and another plugin can rewrite it, so a status is
// read only through the fixed Map below: one outside the four words, or one
// that names a prototype key, has no look and counts nowhere. No key, class or
// text is ever built from the status text.

/** How a status draws: its glyph, word, theme colour key, SVG class and
 *  group. Colour is never the only signal: the glyph and word go with it. */
export type StatusLook = {
  glyph: string
  word: string
  color: string
  cls: string
  group: 'needsYou' | 'working' | 'finished'
}

/** The four statuses, in display order: needs you, working, done, stopped. */
export const STATUS: ReadonlyMap<string, StatusLook> = new Map([
  ['needs-you', { glyph: '●', word: 'needs you', color: 'warning', cls: 'warn', group: 'needsYou' }],
  ['working', { glyph: '◐', word: 'working', color: 'suggestion', cls: 'ok', group: 'working' }],
  ['done', { glyph: '✓', word: 'done', color: 'success', cls: 'done', group: 'finished' }],
  ['stopped', { glyph: '–', word: 'stopped', color: 'inactive', cls: 'stopped', group: 'finished' }],
] as const)

/** A stored status's look, or undefined for anything but the four words. */
export const statusOf = (status: unknown): StatusLook | undefined =>
  typeof status === 'string' ? STATUS.get(status) : undefined

/** A card and its place in the roster. Every button a card draws keys on that
 *  place, never its place inside a group: the press handler finds a card by
 *  roster place and title slug, and the slug folds many titles to one. */
export type Placed<T> = { c: T; i: number }
export type Groups<T> = { needsYou: Placed<T>[]; working: Placed<T>[]; finished: Placed<T>[] }

/** The stored cards in their groups, each in roster order. A card whose title
 *  is in `hidden`, the dismissed ones, is in none, and so is a card that is
 *  not a record or has no look; cards that are not a list give three empty
 *  groups. */
export function groupCards<T>(cards: readonly T[], hidden: ReadonlySet<unknown>): Groups<T> {
  const out: Groups<T> = { needsYou: [], working: [], finished: [] }
  if (!Array.isArray(cards)) return out
  cards.forEach((c, i) => {
    const look = shownLook(c, hidden)
    if (look !== undefined) out[look.group].push({ c, i })
  })
  return out
}

/** A stored card's look when the pane shows it: a record, not dismissed, with
 *  one of the four statuses; else undefined. The groups, the heading and the
 *  status strip all count cards by this one rule. */
function shownLook(c: unknown, hidden: ReadonlySet<unknown>): StatusLook | undefined {
  return isRecord(c) && !hidden.has(c.title) ? statusOf(c.status) : undefined
}

/** The stored open state of DONE · STOPPED, open only when exactly true. */
export const isOpen = (v: unknown): boolean => v === true

/** The DONE · STOPPED toggle's label: ▸ closed or ▾ open, its card count, and
 *  the count of its cards' reports when there are any, so a report behind
 *  the fold stays in view. */
export function foldLabel(open: unknown, cards: number, reports: number): string {
  const count = reports > 0 ? ` · ${reports} ${reports === 1 ? 'report' : 'reports'}` : ''
  return `${isOpen(open) ? '▾' : '▸'} DONE · STOPPED  ${cards}${count}`
}

/** A card's title as drawn and as a report's sender is kept: cleaned and cut
 *  to 80. A report belongs to the card whose drawn title is its sender, both
 *  for the card's report line and for the toggle's count. */
export const drawnTitle = (title: string): string => oneLine(title, 80)

/** The reports since the pane opened whose sender is one of `titles`, matched
 *  by `drawnTitle`. Every report counts, not one per card. An inbox entry of the wrong shape
 *  counts nothing, and no shape throws. */
export function reportCount(titles: readonly string[], inbox: unknown): number {
  if (!Array.isArray(inbox)) return 0
  const drawn = new Set(titles.map(drawnTitle))
  return inbox.filter(r => isRecord(r) && typeof r.from === 'string' && drawn.has(r.from)).length
}

/** The count beside "Waiting on you": the cards that need the owner, plus the
 *  to-dos that are neither done nor ticking. */
export function waitingCount(needsYou: number, todos: readonly { id: string }[], done: unknown, ticking: unknown): number {
  const out = doneOrTicking(done, ticking)
  return needsYou + todos.filter(t => !out.has(t.id)).length
}

/** The to-do ids that count as done: those in the done list or ticking. The
 *  Waiting on you count and the to-do bar both read this one set. */
function doneOrTicking(done: unknown, ticking: unknown): Set<string> {
  return new Set([...idsFrom(done), ...ticksFrom(ticking).map(p => p.name)])
}

// --- The status strip and the to-do bar ---------------------------------------
//
// Under the Brigade heading: a strip with one segment per status, its legend,
// and a bar of the to-dos done. Both are drawn from counts alone. Each builder
// takes the stored roster and lists as they are, reads a card only through
// the status Map and a to-do only by its id, and writes only numbers, fixed
// words and fixed class names: no title, to-do text, report or usage text
// reaches either image or its alt.

/** The strip's cells on the terminal. */
export const STRIP_CELLS = 32
/** The to-do bar's cells on the terminal. */
export const TODO_CELLS = 20

const STRIP_HEIGHT = 8
const TODO_HEIGHT = 12

// A count as the drawing takes it: a finite number above 0, floored, else 0.
const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** One status's count among the shown cards. */
export type StatusCount = { look: StatusLook; count: number }

/** The shown cards' count per status, in the Map's order, with no entry for a
 *  status with no cards. Shown is as `groupCards` has it: a record, not
 *  dismissed, and one of the four statuses, by the rule groupCards uses, so
 *  the strip, its legend, the heading and the groups count the same cards. */
export function statusCounts(cards: unknown, hidden: ReadonlySet<unknown>): StatusCount[] {
  const counts = new Map<StatusLook, number>()
  if (Array.isArray(cards)) {
    for (const c of cards) {
      const look = shownLook(c, hidden)
      if (look !== undefined) counts.set(look, (counts.get(look) ?? 0) + 1)
    }
  }
  return [...STATUS.values()].flatMap(look => {
    const count = counts.get(look) ?? 0
    return count > 0 ? [{ look, count }] : []
  })
}

/** The terminal strip's run lengths, one per count, in the same order. The
 *  cells go by largest remainder of each count's share, a tie to the earlier
 *  count; then each count above 0 that got no cell takes one from the
 *  longest run, the earliest of equal ones. A count that is not a
 *  finite number above 0 is 0. The runs sum to exactly `cells` whenever a
 *  count is above 0; with none, or a cell count that is not a positive whole
 *  number, every run is 0 and there is nothing to draw. Never throws. */
export function stripRuns(counts: readonly unknown[], cells: number): number[] {
  const c = counts.map(whole)
  const total = c.reduce((s, n) => s + n, 0)
  const n = Number.isInteger(cells) && cells > 0 ? cells : 0
  if (total === 0 || n === 0) return c.map(() => 0)
  const quota = c.map(v => (v / total) * n)
  const runs = quota.map(Math.floor)
  const remainder = quota.map((q, i) => q - (runs[i] ?? 0))
  let left = n - runs.reduce((s, r) => s + r, 0)
  const byRemainder = remainder.map((_, i) => i).sort((a, b) => (remainder[b] ?? 0) - (remainder[a] ?? 0) || a - b)
  for (const i of byRemainder) {
    if (left <= 0) break
    runs[i] = (runs[i] ?? 0) + 1
    left -= 1
  }
  c.forEach((v, i) => {
    if (v === 0 || (runs[i] ?? 0) > 0) return
    const longest = runs.reduce((best, r, j) => (r > (runs[best] ?? 0) ? j : best), 0)
    // A run of one cell gives none away: with more counts than cells, the
    // later ones draw nothing rather than break the sum.
    if ((runs[longest] ?? 0) <= 1) return
    runs[longest] = (runs[longest] ?? 0) - 1
    runs[i] = 1
  })
  return runs
}

/** An SVG image of fixed words, numbers and class names, and its alt text. */
export type BarImage = { source: string; alt: string; height: number }

const svgOpen = (height: number) => `<svg xmlns="${XMLNS}" width="100%" height="${num(height)}"><style>${STYLE}</style>`

/** The strip as an SVG: one segment per count above 0, in the order given,
 *  each as wide as its share, under one rounded clip, id `st`. Each segment
 *  but the last sits in a nested <svg> with its rect moved 2 px left, so a
 *  2 px gap follows it at any width. A count that is not a finite number
 *  above 0 draws nothing. The alt text is the legend's words and numbers. */
export function stripSvg(entries: readonly StatusCount[]): BarImage {
  const shown = entries.map(e => ({ look: e.look, count: whole(e.count) })).filter(e => e.count > 0)
  const total = shown.reduce((s, e) => s + e.count, 0)
  const h = num(STRIP_HEIGHT)
  let x = 0
  const segments = shown.map((e, i) => {
    const w = (e.count / total) * 100
    const at = x
    x += w
    return i < shown.length - 1
      ? `<svg x="${pct(at)}" width="${pct(w)}" height="${h}"><rect class="${e.look.cls}" width="100%" height="${h}" transform="translate(-2 0)"/></svg>`
      : `<rect class="${e.look.cls}" x="${pct(at)}" y="0" width="${pct(w)}" height="${h}"/>`
  })
  const source =
    svgOpen(STRIP_HEIGHT) +
    `<clipPath id="st"><rect x="0" y="0" width="100%" height="${h}" rx="${num(STRIP_HEIGHT / 2)}"/></clipPath>` +
    `<g clip-path="url(#st)">${segments.join('')}</g></svg>`
  const alt = shown.length === 0 ? 'none' : shown.map(e => `${e.count} ${e.look.word}`).join(', ')
  return { source, alt: `Status: ${alt}`, height: STRIP_HEIGHT }
}

/** What the strip draws: the shown cards' total, the legend's entries, the
 *  terminal's runs of `█` in each status's theme colour, summing to 32, and
 *  the SVG. Undefined when no shown card has one of the four statuses. */
export type StripView = {
  total: number
  legend: { text: string; color: string }[]
  runs: { text: string; color: string }[]
  svg: BarImage
}

export function statusStrip(cards: unknown, hidden: ReadonlySet<unknown>): StripView | undefined {
  const counts = statusCounts(cards, hidden)
  const total = counts.reduce((s, e) => s + e.count, 0)
  if (total === 0) return undefined
  const runs = stripRuns(
    counts.map(e => e.count),
    STRIP_CELLS,
  )
  return {
    total,
    legend: counts.map(e => ({ text: `${e.look.glyph} ${e.count} ${e.look.word}`, color: e.look.color })),
    runs: counts.flatMap((e, i) => ((runs[i] ?? 0) > 0 ? [{ text: '█'.repeat(runs[i] ?? 0), color: e.look.color }] : [])),
    svg: stripSvg(counts),
  }
}

/** The roster's to-dos and how many of them are done: a to-do counts as done
 *  when its id is in the done list or ticking, once whichever holds it, so
 *  the bar agrees with the "Waiting on you" count. Lists of the wrong shape
 *  count as empty, and a to-do that is not a record with a text id counts
 *  nowhere. */
export function todoCounts(todos: unknown, done: unknown, ticking: unknown): { done: number; total: number } {
  const list = Array.isArray(todos) ? todos.filter((t): t is { id: string } => isRecord(t) && typeof t.id === 'string') : []
  const out = doneOrTicking(done, ticking)
  return { done: list.filter(t => out.has(t.id)).length, total: list.length }
}

/** The to-do bar as an SVG: a rounded track and a rounded green fill, class
 *  `done`, with no clip and no id. A count that is not a finite number above
 *  0 is 0, and done past the total is the total. The fill is never narrower
 *  than 6 px, as the usage bars' is. The alt text is `To-dos N of M done`. */
export function todoSvg(done: number, total: number): BarImage {
  const m = whole(total)
  const n = Math.min(whole(done), m)
  const fraction = m > 0 ? n / m : 0
  const rect = (cls: string, width: string) => `<rect class="${cls}" x="0" y="3" width="${width}" height="6" rx="3"/>`
  const source =
    svgOpen(TODO_HEIGHT) +
    rect('track', '100%') +
    (fraction > 0 ? rect('done', '6') + rect('done', pct(fraction * 100)) : '') +
    '</svg>'
  return { source, alt: `To-dos ${n} of ${m} done`, height: TODO_HEIGHT }
}

/** What the to-do bar draws: "N of M done", the terminal's 20 eighth-block
 *  cells, and the SVG. Undefined when the roster has no to-dos. */
export function todoBar(
  todos: unknown,
  done: unknown,
  ticking: unknown,
): { text: string; cells: string; svg: BarImage } | undefined {
  const c = todoCounts(todos, done, ticking)
  if (c.total === 0) return undefined
  return { text: `${c.done} of ${c.total} done`, cells: eighthBar(c.done / c.total, TODO_CELLS), svg: todoSvg(c.done, c.total) }
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

const KINDS_OF_WARMTH = new Set(['call', 'too-large', 'shared', 'unread', 'not-found'])
const OTHER_KINDS = new Map<string, 'too-large' | 'shared' | 'unread' | 'not-found'>([
  ['too-large', 'too-large'],
  ['shared', 'shared'],
  ['unread', 'unread'],
  ['not-found', 'not-found'],
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
 *  read unknown, and a transcript the finder found nowhere reads not found,
 *  whatever the live state. A working session is warm, with no
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
  if (w.kind === 'not-found') return { tone: 'dim', text: '◆ transcript not found' }
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

// --- The cache bar -----------------------------------------------------------
//
// A needs-you or working card draws its ◆ line as a bar that drains over the
// cache window, with short text beside it and a dim line under it. The bar is
// worked out here from the warmth record's numbers alone: no title, to-do,
// report or usage text reaches it, and its alt text is fixed words and numbers.

/** The terminal cache bar's width in cells. */
export const CACHE_CELLS = 16

/** A card's cache bar: how full it is, from 0 to 1, its theme colour key and
 *  SVG class, its short text, and the dim line under it, absent when the
 *  context size is unknown. */
export type CacheBar = {
  fraction: number
  tone: 'success' | 'warning' | 'error'
  cls: 'done' | 'warn' | 'hot'
  text: string
  detail?: string
}

// A fraction as a bar draws it: one that is not a finite number is 0, and any
// other is clamped to between 0 and 1.
const unit = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0)

/** One card's cache bar, or undefined for no bar. A working session is warm:
 *  a full green bar, whether its record is a call or not read yet, and
 *  whatever its window. Otherwise only a call with a known window has a bar:
 *  the time left over the window, green with more than 15 min left, amber at
 *  15 or less, and empty and red with none left, the same bands as
 *  `warmthLine`. A transcript too large to read, a name two sessions share,
 *  a transcript not found, an unknown window and no record have none. Idle
 *  time is floored at 0, so a call time ahead of the clock gives a full bar;
 *  an idle time that is not a finite number gives no bar. */
export function cacheBar(w: Warmth | undefined, state: string | undefined, now: number): CacheBar | undefined {
  if (w === undefined || w.kind === 'too-large' || w.kind === 'shared' || w.kind === 'not-found') return undefined
  const size = w.kind === 'call' ? `${tokens(w.tokens)} context` : undefined
  if (isWorking(state)) {
    const warm: CacheBar = { fraction: 1, tone: 'success', cls: 'done', text: 'warm (working)' }
    if (size !== undefined) warm.detail = size
    return warm
  }
  if (w.kind !== 'call' || w.windowMs === undefined) return undefined
  const idle = Math.max(0, now - w.at)
  if (!Number.isFinite(idle)) return undefined
  const left = w.windowMs - idle
  const detail = `idle ${span(Math.floor(idle / MIN_MS))} · ${size}`
  if (left <= 0) return { fraction: 0, tone: 'error', cls: 'hot', text: 'cold', detail }
  const text = `cold in ${span(Math.ceil(left / MIN_MS))}`
  const fraction = unit(left / w.windowMs)
  return left > AMBER_MS
    ? { fraction, tone: 'success', cls: 'done', text, detail }
    : { fraction, tone: 'warning', cls: 'warn', text, detail }
}

/** The terminal's cache bar: 16 eighth-block cells, the end marks left to
 *  the caller. A cold bar, empty, keeps a one-eighth cell at its start, as
 *  the image keeps its stub, so it still reads red. */
export function cacheCells(b: CacheBar): string {
  const cells = eighthBar(b.fraction, CACHE_CELLS)
  return b.cls === 'hot' && cells.trim() === '' ? `${EIGHTHS[0]}${' '.repeat(CACHE_CELLS - 1)}` : cells
}

// The three classes a cache bar's fill may take. Any other class it is handed
// draws no fill. `done` is the shared green: a done session's colour and a
// warm cache's.
const CACHE_CLASSES = new Set(['done', 'warn', 'hot'])
// The image's height, the bar's top, and the bar's thickness, which is also
// the stub's width.
const CACHE_HEIGHT = 16
const CACHE_Y = 5
const CACHE_THICKNESS = 6

/** The cache bar as an image for the surfaces with Svg, built from the bar's
 *  fraction and class alone. A rounded track the image's full width, a fixed
 *  6 px stub in the bar's class, and over it a rounded fill in percentages,
 *  so a sliver stays seen; at 0 the stub alone. A class other than the three
 *  tones' draws the track alone. No clipPath and no id, so many cache bars on
 *  one pane share none. The fraction is clamped here too. The alt text is
 *  "Cache" and the bar's text, cleaned to one line. */
export function cacheBarSvg(b: CacheBar): Extract<UsageView, { kind: 'svg' }> {
  const f = unit(b.fraction)
  const y = num(CACHE_Y)
  const h = num(CACHE_THICKNESS)
  const r = num(CACHE_THICKNESS / 2)
  // The stub is drawn at 0 too, so a cold bar, empty, still reads red.
  const fill = CACHE_CLASSES.has(b.cls)
    ? `<rect class="${b.cls}" x="0" y="${y}" width="${h}" height="${h}" rx="${r}"/>` +
      (f > 0 ? `<rect class="${b.cls}" x="0" y="${y}" width="${pct(f * 100)}" height="${h}" rx="${r}"/>` : '')
    : ''
  const source =
    `<svg xmlns="${XMLNS}" width="100%" height="${num(CACHE_HEIGHT)}"><style>${STYLE}</style>` +
    `<rect class="track" x="0" y="${y}" width="100%" height="${h}" rx="${r}"/>${fill}</svg>`
  return { kind: 'svg', source, alt: oneLine(`Cache ${b.text}`, 80), height: CACHE_HEIGHT }
}

/** What the agents poll remembers of each transcript it read, keyed by path:
 *  its modified time at that read and the last call parsed from it. */
export type ReadMemory = Map<string, { mtimeMs: number; call: LastCall | undefined }>

// --- The transcript finder ---------------------------------------------------
//
// A session that moved into a worktree after it started writes its transcript
// under the worktree's projects folder, not its launch folder's, while
// `claude agents` still names the launch folder. So the path from `cwd` is
// tried first, then the worktree folders of the launch folder, found by
// listing the projects folder at most once a minute. Every path either step
// gives is taken only when a resolving `stat` finds a regular file, not
// itself a link, whose real path is the expected file inside the real
// projects folder: a link at the file or at any folder above it inside
// `projects`, swapped in at any time, fails at the next check. The check and
// the read are two engine calls, and the read follows links, so a swap between
// them, or a hard link, is not caught: threat-model row 15 names that gap.
// Nothing found is never an error: a rejection counts as no hit and its
// message is dropped.

/** A listing of more entries than this is not looked at. */
export const MAX_LISTING = 5000
/** More candidate folders than this for one launch folder is not a brigade. */
export const MAX_CANDIDATES = 20
/** The projects folder is listed at most this often. */
export const LIST_EVERY_MS = 60000
// The longest folder name a candidate may have.
const MAX_FOLDER = 255
// What a worktree folder's projects name holds after its launch folder's:
// `<launch>\.claude\worktrees\<name>` made into a name.
const WORKTREES = '--claude-worktrees-'

/** A resolving `stat`'s answer, as far as the finder reads it. */
export type FoundStat = { kind: string; size: number; mtimeMs: number; isLink?: boolean; realPath?: string }

/** The file system and clock as the finder reaches them, and whether the
 *  pane is still open. `stat` resolves, so it gives a real path. `stat`,
 *  `list` and `now` may reject, and an engine with no `list` has none. */
export type FinderIo = {
  live: () => boolean
  now: () => Promise<number>
  stat: (path: string) => Promise<FoundStat>
  list?: (path: string) => Promise<unknown>
}

/** A transcript the finder placed: its path, and its size and modified time
 *  from the `stat` that placed it. */
export type Found = { path: string; size: number; mtimeMs: number }

/** What the finder keeps between polls, in module memory and never in plugin
 *  state, since it holds paths and listed names. */
export type Finder = {
  /** The real projects folder, asked once per poll; undefined when it does
   *  not resolve to a folder, and then nothing is found that poll. */
  real: string | undefined
  /** When the projects folder was last listed, on the engine's clock. */
  listedAt: number | undefined
  /** That listing's folder names, or undefined when it was rejected, over
   *  the cap or not a list. */
  names: string[] | undefined
  /** By session id, the worktree folder a search found, or undefined for a
   *  miss: kept until the next listing, so at most a minute. */
  remembered: Map<string, string | undefined>
  /** This poll's result by member name, for the link reads: the transcript
   *  found, or undefined when the finder found none. A name the finder did
   *  not look for this poll is absent. */
  byName: Map<string, Found | undefined>
}

/** A finder with nothing known yet. */
export const newFinder = (): Finder => ({ real: undefined, listedAt: undefined, names: undefined, remembered: new Map(), byName: new Map() })

/** Asks the real projects folder once for the poll, and keeps it in the
 *  finder: the resolving `stat`'s real path, when it finds a folder. */
export async function readProjects(config: string, io: FinderIo, finder: Finder): Promise<void> {
  const s = await io.stat(`${config}${sepOf(config)}projects`).catch(() => undefined)
  finder.real = isRecord(s) && s.kind === 'dir' && typeof s.realPath === 'string' && s.realPath !== '' ? s.realPath : undefined
}

// The place check: the file at <config>/projects/<folder>/<id>.jsonl, taken
// only when a resolving `stat` finds a regular file that is not itself a
// link, whose real path is the real projects folder, then the folder, then
// the file, compared as the roster path rule compares. Never rejects.
async function placed(config: string, folder: string, sessionId: string, io: FinderIo, real: string): Promise<Found | undefined> {
  const sep = sepOf(config)
  const path = `${config}${sep}projects${sep}${folder}${sep}${sessionId}.jsonl`
  const s = await io.stat(path).catch(() => undefined)
  if (!isRecord(s) || s.kind !== 'file' || s.isLink !== false || typeof s.realPath !== 'string') return undefined
  const fold = foldsCase(config)
  if (pathKey(s.realPath, fold) !== pathKey(`${real}/${folder}/${sessionId}.jsonl`, fold)) return undefined
  return { path, size: s.size, mtimeMs: s.mtimeMs }
}

// The projects folder's listing, as the folder names a worktree folder could
// have: folders that are not links, with a name of at most 255 characters,
// no separator and `--claude-worktrees-` in it. No other name is kept. A listing of more than 5,000 entries, one that is not a
// list, or a rejected one is no names at all.
async function listNames(config: string, io: FinderIo): Promise<string[] | undefined> {
  let entries: unknown
  try {
    if (io.list === undefined) return undefined
    entries = await io.list(`${config}${sepOf(config)}projects`)
  } catch {
    return undefined
  }
  if (!Array.isArray(entries) || entries.length > MAX_LISTING) return undefined
  const fold = foldsCase(config)
  const marker = pathKey(WORKTREES, fold)
  const names: string[] = []
  for (const e of entries) {
    if (!isRecord(e) || e.kind !== 'dir' || e.isLink !== false || typeof e.name !== 'string') continue
    if (e.name === '' || e.name.length > MAX_FOLDER || /[\\/]/.test(e.name) || !pathKey(e.name, fold).includes(marker)) continue
    names.push(e.name)
  }
  return names
}

/** A member's transcript, or undefined when none is found.
 *
 *  First the path from `cwd`. Else the worktree folders of the launch
 *  folder: the projects folder is listed at most once a minute, the last
 *  listing reused between, and a folder whose name starts with the launch
 *  folder's name and `--claude-worktrees-` is a candidate. Exactly one
 *  candidate holding the session's transcript is it; more than 20
 *  candidates, two hits or none give none. That result, hit or miss, is
 *  remembered by session id until the next listing, and a remembered hit
 *  passes the place check again before each use. Every path passes the
 *  place check. Call `readProjects` once per poll first. Never rejects. */
export async function findTranscript(config: string, row: AgentRow, io: FinderIo, finder: Finder): Promise<Found | undefined> {
  const { sessionId, cwd } = row
  const real = finder.real
  if (sessionId === undefined || cwd === undefined || !SESSION_ID.test(sessionId) || real === undefined) return undefined
  const home = projectFolder(cwd)
  if (home === '') return undefined
  const first = await placed(config, home, sessionId, io, real)
  if (first !== undefined || !io.live()) return first
  try {
    const now = await io.now()
    if (!io.live()) return undefined
    const last = finder.listedAt
    // A clock answer that is not a number lists nothing and is never kept:
    // the last listing and the memory stand until a real time comes.
    if (Number.isFinite(now) && (last === undefined || now < last || now - last >= LIST_EVERY_MS)) {
      finder.listedAt = now
      finder.remembered.clear()
      finder.names = await listNames(config, io)
      if (!io.live()) return undefined
    }
    if (finder.remembered.has(sessionId)) {
      const folder = finder.remembered.get(sessionId)
      return folder === undefined ? undefined : await placed(config, folder, sessionId, io, real)
    }
    const fold = foldsCase(config)
    const prefix = pathKey(`${home}${WORKTREES}`, fold)
    const candidates = (finder.names ?? []).filter(n => pathKey(n, fold).startsWith(prefix))
    let hit: { folder: string; found: Found } | undefined
    if (candidates.length <= MAX_CANDIDATES) {
      let hits = 0
      for (const folder of candidates) {
        const found = await placed(config, folder, sessionId, io, real)
        if (!io.live()) return undefined
        if (found === undefined) continue
        hits += 1
        hit = { folder, found }
      }
      if (hits !== 1) hit = undefined
    }
    finder.remembered.set(sessionId, hit?.folder)
    return hit?.found
  } catch {
    return undefined
  }
}

/** The agents poll's warmth reads, and the records they give, or undefined
 *  when the pane closed on the way, so nothing is stored.
 *
 *  Only a roster member is read, through the finder, which asks the real
 *  projects folder once for the poll and keeps each member's result in
 *  `finder.byName` for the link reads. A name on two rows is shared: neither
 *  transcript is looked for. A member the finder finds nowhere records "not
 *  found". Each found transcript has passed the finder's place check, and
 *  one over 4 MiB is not read and records "too large". A transcript is read
 *  only when its modified time differs from the one `memory` holds for its
 *  path, and never while its session is working (`busy`, `running` or
 *  `working`). `memory` gets an entry only after a read and a parse that
 *  succeeded, so a failed read is tried again at the next poll; the record
 *  is then the last good one. A working member with no known call records
 *  `unread`. Paths no member's transcript is found at leave `memory`, and
 *  session ids no member has leave the finder's memory. */
export async function readWarmth(
  rows: readonly AgentRow[],
  titles: readonly string[],
  config: string,
  memory: ReadMemory,
  io: WarmthIo,
  finder: Finder = newFinder(),
): Promise<Warmth[] | undefined> {
  const members = new Set(titles)
  const byName = new Map<string, AgentRow[]>()
  for (const r of rows) {
    if (members.has(r.name)) byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  }
  const out: Warmth[] = []
  const named = new Set<string>()
  const ids = new Set<string>()
  let asked = false
  finder.byName.clear()
  for (const [name, list] of byName) {
    const row = list[0]
    if (list.length > 1 || row === undefined) {
      out.push({ name, kind: 'shared' })
      continue
    }
    if (row.sessionId === undefined || row.cwd === undefined) continue
    ids.add(row.sessionId)
    if (!io.live()) return undefined
    if (!asked) {
      await readProjects(config, io, finder)
      asked = true
      if (!io.live()) return undefined
    }
    const found = await findTranscript(config, row, io, finder)
    if (!io.live()) return undefined
    finder.byName.set(name, found)
    if (found === undefined) {
      out.push({ name, kind: 'not-found' })
      continue
    }
    const path = found.path
    named.add(path)
    if (!Number.isFinite(found.mtimeMs)) continue
    if (!Number.isFinite(found.size) || found.size > MAX_TRANSCRIPT_BYTES) {
      out.push({ name, kind: 'too-large' })
      continue
    }
    if (!isWorking(row.status) && memory.get(path)?.mtimeMs !== found.mtimeMs) {
      const text = await io.read(path).catch(() => undefined)
      if (!io.live()) return undefined
      if (text !== undefined) memory.set(path, { mtimeMs: found.mtimeMs, call: lastCall(text, found.mtimeMs) })
    }
    const call = memory.get(path)?.call
    if (call !== undefined) out.push({ name, kind: 'call', ...call })
    // Working with no known call: never read, or read before its first model
    // call. No read runs while it works, so its card says it is working, with
    // no size.
    else if (isWorking(row.status)) out.push({ name, kind: 'unread' })
  }
  for (const path of [...memory.keys()]) if (!named.has(path)) memory.delete(path)
  for (const id of [...finder.remembered.keys()]) if (!ids.has(id)) finder.remembered.delete(id)
  return out
}

/** What the link read does for a member the finder looked for this poll,
 *  from the path it found (`found`), the path the link was last read from
 *  (`from`) and whether a link is stored for the member: `read` a found
 *  path the link was not read from, `skip` one it was, and with none found
 *  `drop` the stored link, even one whose path this module no longer holds,
 *  as after a reload; with no link either, `skip`. */
export function linkStep(found: string | undefined, from: string | undefined, stored: boolean): 'read' | 'drop' | 'skip' {
  if (found !== undefined) return found === from ? 'skip' : 'read'
  return from !== undefined || stored ? 'drop' : 'skip'
}

/** The file system as the poll reaches it, and whether the pane is still
 *  open: the finder's, and the read. `read` may reject. */
export type WarmthIo = FinderIo & { read: (path: string) => Promise<string> }
