// A send to a name that lists twice (GRIM-41), as plain TypeScript with no
// engine import, so tests/brigade-send.test.mjs runs it directly. A background
// session with Remote Control is listed on this machine and as a Remote Control
// row, under one name. This reads the message tool's own structured listing and
// readdresses a send to the one row on this machine; a shared shape it can see
// that is not that twin is refused with fixed words. A plugin's listing may
// hold no Remote Control row at all (the lead's own Remote Control off), so a
// lone local row is addressed by its ref too, and a row the listing does not
// hold cannot be refused.

/** A row's `type` for a session on this machine, as the engine's own session
 *  files spell its kind, and for a Remote Control row. */
const LOCAL: ReadonlySet<string> = new Set(['interactive', 'bg', 'daemon', 'daemon-worker'])
const REMOTE = 'remote_control'
const AWAY: ReadonlySet<string> = new Set([REMOTE, 'cloud'])

/** A ref as it can stand between the brackets of `name [ref]`. */
const REF = /^[A-Za-z0-9_-]{1,80}$/

/** The most pages of one listing read for a send. */
export const MAX_PAGES = 10

const refusal = (why: string) =>
  `Brigade: nothing was sent and nothing subscribed. ${why} Send nothing to that name by a ref; tell the owner which name it is, so they can stop or rename the extra session, then send again.`

export const REFUSE_TWO_LOCAL = refusal('Two sessions on this machine have that name.')
export const REFUSE_MANY = refusal('Three or more rows have that name.')
export const REFUSE_NO_LOCAL = refusal('More than one row has that name and none is on this machine.')
export const REFUSE_UNKNOWN = refusal('Two rows have that name and they are not one session on this machine with its Remote Control row.')
export const REFUSE_PARTIAL =
  'Brigade: nothing was sent and nothing subscribed. Two rows have that name and the session list could not be read in full. Send nothing to that name by a ref; send again shortly, and if it is refused again, tell the owner the session list is incomplete.'

/** Whether `to` is a bare session name: no ref, no address, not a fixed word. */
export const needsListing = (to: unknown): to is string =>
  typeof to === 'string' && to !== '' && to !== 'main' && to !== '*' && !/^(uds|bridge):|\[[^\]]*\]$/.test(to)

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(record) : [])

/** The next page's cursor, from the listing's own footer line. The line starts
 *  the line it is on; a row's line is indented, so a session's name cannot
 *  pose as it. A footer that only says to call again later is not followed:
 *  the engine repeats it, with no further rows, while a source is failing. */
export const listedCursor = (result: unknown): string | undefined => {
  const listing = record(result).listing
  if (typeof listing !== 'string') return undefined
  return /^\([^\n]*call again with [^\n]*?cursor="([0-9a-f]{1,64})" for the next page/m.exec(listing)?.[1]
}

export type Resolved = { to?: string; deny?: string }

/** What to do with a send to `name`, given every page of the listing read for
 *  it and whether pages were left unread: `to` readdresses it, `deny` refuses
 *  it, and neither passes it on as sent, for the engine to judge. */
export const resolveSend = (name: string, pages: readonly unknown[], unread: boolean): Resolved => {
  const rows: Record<string, unknown>[] = []
  let partial = unread
  for (const page of pages) {
    const p = record(page)
    const sections = list(p.sections)
    for (const s of [p, ...sections]) {
      // Only rows on this machine matter here: a cut-short account list
      // (`list_truncated`) leaves the local row as it was.
      if (list(s.notes).some(n => n.kind === 'local_list_failed')) partial = true
    }
    for (const s of sections) {
      const named = list(s.rows).filter(r => r.name === name)
      // The engine gives a bare name to this session's own subagent or teammate.
      if (named.length > 0 && (s.kind === 'subagents' || s.kind === 'teammates')) return {}
      rows.push(...named)
    }
  }
  const isLocal = (r: Record<string, unknown>) => typeof r.type === 'string' && LOCAL.has(r.type)
  const byRef = (r: Record<string, unknown> | undefined): string | undefined =>
    typeof r?.ref === 'string' && REF.test(r.ref) ? `${name} [${r.ref}]` : undefined
  if (rows.length < 2) {
    const to = !partial && rows[0] !== undefined && isLocal(rows[0]) ? byRef(rows[0]) : undefined
    return to === undefined ? {} : { to }
  }
  if (rows.length > 2) return { deny: REFUSE_MANY }
  const local = rows.filter(isLocal)
  if (local.length === 2) return { deny: REFUSE_TWO_LOCAL }
  if (rows.every(r => typeof r.type === 'string' && AWAY.has(r.type))) return { deny: REFUSE_NO_LOCAL }
  const to = byRef(local[0])
  if (local.length !== 1 || !rows.some(r => r.type === REMOTE) || to === undefined) return { deny: REFUSE_UNKNOWN }
  if (partial) return { deny: REFUSE_PARTIAL }
  return { to }
}

/** What to do with a send to `name`, from the listing read page by page.
 *  `listed` makes one ListAgents call. A first page that throws throws here;
 *  a later one, or a cursor left at the cap, leaves pages unread. */
export const resolveListed = async (name: string, listed: (cursor?: string) => Promise<unknown>): Promise<Resolved> => {
  const pages = [await listed()]
  let cursor = listedCursor(pages[0])
  while (cursor !== undefined && pages.length < MAX_PAGES) {
    const page = await listed(cursor).catch(() => undefined)
    if (page === undefined) break
    pages.push(page)
    cursor = listedCursor(page)
  }
  return resolveSend(name, pages, cursor !== undefined)
}
