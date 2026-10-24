import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Card, Roster } from './types'
import type { Moves } from './view.ts'
import {
  GH_ARGV,
  MAX_ROSTER_BYTES,
  PR_NUMBER,
  PR_STATES,
  MAX_TEXT,
  OPEN_NAME,
  OPEN_SERVER,
  OPEN_TARGET,
  OPEN_TOOL,
  OPEN_WAIT_MS,
  SESSION_ID,
  STATUSES,
  HOST_PROBES,
  appLink,
  checkRoster,
  dataFolder,
  dataPlace,
  listsOpenTool,
  liveWord,
  lookup,
  matchRows,
  oneLine,
  openerArgv,
  parsePrList,
  placeRoster,
  readOpenAnswer,
  remoteLink,
  report,
  rosterFile,
  rulesAllowTool,
  serialize,
  stampSince,
  statRejection,
  toolSession,
  probeHost,
  windowsEnv,
  rowMove,
} from './roster.ts'
import type { GhPr, HostOs, StatAnswer } from './roster.ts'
import {
  CACHE_CELLS,
  EMPTY_USAGE,
  GROUP_HINTS,
  GROUP_KEYS,
  GROUP_NAMES,
  linksOnRoster,
  MAX_NAME,
  MAX_PICKED,
  MAX_TRANSCRIPT_BYTES,
  SESSIONS_UNREAD,
  SVG_MAX,
  VIEW_LABELS,
  ageText,
  addSample,
  burnRate,
  cacheBar,
  cacheBarSvg,
  cacheCells,
  cardViews,
  chooseTab,
  chosenView,
  contextCells,
  contextMeter,
  contextMeterSvg,
  compactSettings,
  contextTrend,
  drawnTitle,
  foldedFrom,
  groupCards,
  liveFrom,
  movedLook,
  movesFrom,
  hairlineSvg,
  idsFrom,
  isReason,
  linkStep,
  liveState,
  metersFrom,
  newFinder,
  newSummaryMemory,
  pickedFrom,
  pillColor,
  pillSvg,
  pillState,
  prNumber,
  prRows,
  readCalls,
  readSessions,
  refusalLines,
  reportCount,
  reportNote,
  settleTicks,
  sizeText,
  snapshotFrom,
  sparkRuns,
  sparkSvg,
  statusOf,
  statusStrip,
  ticksFrom,
  todoBar,
  toggleTick,
  usageView,
  viewFrom,
  viewOf,
  waitingCount,
  warmthFrom,
  warmthLine,
  withoutSize,
} from './view.ts'
import type { Finder, PrRow, ReadMemory, Spark, SummaryMemory } from './view.ts'
import { registerWriter, writerEpoch, writerSession } from './writer.ts'
import { DESCRIPTION as WARNING_DESCRIPTION, SCHEMA as WARNING_SCHEMA, STORE_KEY as WARNING_KEY, TOOL as WARNING_TOOL, ackFrom, registerWarning } from './warning.tsx'

// The Brigade pane: one compact row per session a lead session started, in
// three foldable groups (Waiting on you, Working, Done · stopped) behind a
// switch to a Pull requests view. A row shows its status dot, title, phase,
// live busy or idle state, age, PR pill and latest report, and on a needs-you
// or working row the cache warmth, context meter and the burn and trend views;
// the owner's to-dos sit under Waiting on you, each ticked with a press that a
// second press undoes; at the foot are the selection bar and this session's
// own rate limits and context. The pane reads the roster file while it is
// open, and asks `gh` for the PR details once a minute. The head chef fills
// the roster through the set_roster tool below, which writes the file for it
// with no permission prompt; the head chef writes no file itself. The usage
// section is worked out in view.ts, as plain values; this file reads and
// stores the reading and turns the view's result into elements.
//
// The pane waits for /brigade or the head-chef skill's load. At session start
// it registers /brigade, the skill hook and the usage summary writer
// (writer.ts), reads the engine clock and the session id once for the writer,
// and nothing else: no timer, no process, no file read, no tool and no pane.
// The writer's hooks record each step and write this session's own summary
// file; ADR 0008 records why the mod is no longer idle by default. The pane
// opens only on /brigade or when the plugin's own or the owner's own
// head-chef skill loads with the pane closed, and closing it stops every
// timer. A message from another session never opens it directly.

const PANE = 'brigade'
const TITLE = 'Brigade'
const ROSTER_MS = 5000
// The live poll reads the engine's session files this often (#347).
const LIVE_MS = 10000
const GH_MS = 60000
const TOOL = 'set_roster'

// The values are the plugin's, so they sit under its manifest name.
const armed = atom({ plugin: 'grimoire', key: 'armed' } as const, false)
// The engine's record of a session's start, the last one raised; writer.ts reads the same key.
const started = atom({ plugin: 'grimoire', key: 'start' } as const, { sessionId: '', transcript: '' })
const files = atom({ plugin: 'grimoire', key: 'files' } as const, { current: '', previous: '' })
const roster = atom({ plugin: 'grimoire', key: 'roster' } as const, { cards: [], todos: [] })
const rosterError = atom({ plugin: 'grimoire', key: 'rosterError' } as const, '')
const live = atom({ plugin: 'grimoire', key: 'live' } as const, [])
const liveError = atom({ plugin: 'grimoire', key: 'liveError' } as const, '')
const links = atom({ plugin: 'grimoire', key: 'links' } as const, [])
const reports = atom({ plugin: 'grimoire', key: 'reports' } as const, [])
const dismissed = atom({ plugin: 'grimoire', key: 'dismissed' } as const, [])
const doneTodos = atom({ plugin: 'grimoire', key: 'doneTodos' } as const, [])
const ticking = atom({ plugin: 'grimoire', key: 'ticking' } as const, [])
const usage = atom({ plugin: 'grimoire', key: 'usage' } as const, EMPTY_USAGE)
const samples = atom({ plugin: 'grimoire', key: 'samples' } as const, [])
const warmth = atom({ plugin: 'grimoire', key: 'warmth' } as const, [])
const meters = atom({ plugin: 'grimoire', key: 'meters' } as const, [])
const refusals = atom({ plugin: 'grimoire', key: 'refusals' } as const, [])
const tabs = atom({ plugin: 'grimoire', key: 'tabs' } as const, [])
// The chosen view, the selected cards and the folded groups. Each is read
// again through its fixed set or shape before use (view.ts).
const viewAtom = atom({ plugin: 'grimoire', key: 'view' } as const, 'sessions')
const picked = atom({ plugin: 'grimoire', key: 'picked' } as const, [])
const folded = atom({ plugin: 'grimoire', key: 'folded' } as const, [])
// The group that starts folded each time the pane opens.
const STARTS_FOLDED = ['finished']

// Text and status colours are the app's own theme keys, so they follow the
// person's theme, light or dark, as the rest of Claude Code does; the fills
// are the fixed colours below. The status the head chef wrote on a card, and
// the live state, take theirs from view.ts.

// The cells of the cache block's label column, the width of "◆ context", so
// the cache bar and the context meter start at the same place.
const LABEL_CELLS = 9

// A button's key: the verb, the card's place, and its title folded to letters
// and digits, so a press finds the card it was drawn for or nothing.
const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40)
const keyFor = (verb: string, i: number, title: string) => `${verb}-${i}-${slug(title)}`
// A Button must carry onPress. The ui.press hook below answers every press
// itself, so this bottom of the chain never runs.
const noop = () => {}
// The prototype's fills, read off Desktop's dark theme, for every surface that
// draws images: fixed values, never from file data. No theme key draws them,
// and the engine names none for the pane's background, so the pane takes
// them and reads poorly in a light theme (the owner's decision at the
// rebuild's visual check). A round border in a fill's own colour rounds it;
// one in the pane's colour is unseen at rest, so a hover rounds a card.
const DARK_FILLS = {
  pane: '#1a1a19',
  bar: '#2b2b2a',
  hover: '#262625',
  tip: '#3a3a38',
} as const
// The icon of each card view, with its name in the tooltip. A Button carries
// no `label`: a desktop draws the label in place of the Button's text.
const VIEW_ICONS: ReadonlyMap<string, string> = new Map([
  ['cache', '◆'],
  ['burn', '↯'],
  ['trend', '∿'],
])
// A to-do's checkbox. A desktop draws a native button as wide as its label,
// and folds a plain space away, so the blank at rest there is an en space and
// a four-per-em space: 0.75 em, the width of the ✓ (0.749 em, measured in
// Segoe UI's fallback), so the box keeps its size when ticked. The terminal
// draws every one of them a cell wide, so it keeps one plain space. The slot
// is as wide as the terminal's `[ ✓ ]`.
const UNTICKED = '\u{2002}\u{2005}'
const UNTICKED_TERMINAL = ' '
const CHECK_CELLS = 5

// The module's own timers. A reload starts the module over and the engine
// drops the old timers with it.
let timers: Timer[] = []

// Where this lead session's roster file is, or why it cannot be named. The
// roster lives in the plugin's data folder, built by the plugin-manifest
// reference's rule from the config folder alone: <config>/plugins/data/<id>.
// `CLAUDE_PLUGIN_DATA` is never read: a mod's environment usually lacks it,
// and another plugin can set it. The config folder comes from where the plugin
// was installed, else from the transcript path the engine reported at a
// session's start, else from Desktop's synced install folder (`dataPlace`,
// which the usage summary writer shares); with none, nothing is read or
// written. The config folder also locates other
// sessions' transcripts.
type Where = { file: string; config: string; plugin: string; id: string }
async function where($: EngineInterface): Promise<Where | { error: string }> {
  const id = await $.session.id()
  if (!SESSION_ID.test(id)) return { error: 'the session id is not the engine\'s shape, so no roster file is named. Nothing was read.' }
  const { config, plugin } = dataPlace($.plugin.root, $.plugin.name, await read($, started))
  if (config === undefined) {
    return {
      error: `Cannot find the Claude config folder from where the plugin was loaded. The roster would be <Claude config folder>/plugins/data/${plugin}/brigade/${id}.json. Nothing was read.`,
    }
  }
  return { file: rosterFile(dataFolder(config, plugin), id), config, plugin, id }
}

// One `stat` for the path rule in roster.ts: resolving, and a rejection
// sorted into missing or failed by its message.
function statPath($: EngineInterface, path: string): Promise<StatAnswer> {
  return $.fs.stat(path, { resolve: true }).then(
    found => ({ found }),
    err => statRejection(String(err instanceof Error ? err.message : err)),
  )
}
// Resolves the to-do ids of the roster it loaded, or undefined when it loaded
// none: no file named, no file, or a file that failed its check. The file is
// read only where the path rule allows it, so the pane follows no link either.
async function loadRoster($: EngineInterface): Promise<string[] | undefined> {
  const at = await where($)
  if ('error' in at) {
    await update($, rosterError, () => at.error)
    await update($, roster, () => ({ cards: [], todos: [] }))
    return undefined
  }
  // After a clear or a resume the session id changes, and so does the file:
  // keep the new one and the one before it. Nothing draws them since #339.
  await update($, files, f =>
    f.current === at.file ? f : { current: at.file, previous: f.current },
  )
  try {
    const placed = await placeRoster(at.config, at.plugin, at.id, (path: string) => statPath($, path))
    if ('refused' in placed) {
      throw new Error(placed.refused.startsWith('link:') ? `${placed.refused}; the roster path must not pass through a link or junction` : placed.refused)
    }
    if (placed.existing === undefined) {
      await update($, roster, () => ({ cards: [], todos: [] }))
      await update($, rosterError, () => '')
      return undefined
    }
    if (placed.existing.size > MAX_ROSTER_BYTES) throw new Error(`the roster is over ${MAX_ROSTER_BYTES} bytes`)
    const checked = checkRoster(String(await $.fs.read(placed.file)))
    if ('error' in checked) throw new Error(checked.error)
    const value: Roster = checked.value
    await update($, roster, () => value)
    await update($, rosterError, () => '')
    return value.todos.map(t => t.id)
  } catch (err) {
    await update($, rosterError, () => `Roster not shown: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`)
    return undefined
  }
}

// After each roster load: move the ticks past their grace period to done, and
// drop a tick whose to-do left the roster. The rules are in view.ts; a load
// that read no roster changes no tick.
async function sweepTodos($: EngineInterface, todoIds: string[] | undefined) {
  try {
    await settleTicks(
      fn => update($, ticking, fn),
      fn => update($, doneTodos, fn),
      await $.clock.now(),
      todoIds,
    )
  } catch {
    // The next roster tick sweeps again.
  }
}

// What the warmth reads remember of each transcript, keyed by its path. A
// reload starts it over, which costs one read per member.
const memory: ReadMemory = new Map()
// What the transcript finder remembers between polls: its last listing of
// the projects folder, its searches and this poll's found transcripts. It
// holds paths and listed names, so it stays here and never enters plugin
// state. A reload starts it over, which costs one listing.
const finder: Finder = newFinder()
// What the summary reads keep between polls, by session id: each member's
// last summary that passed its checks, and the file that last failed one. A
// reload starts it over, which costs a refused file one more poll.
const summaries: SummaryMemory = newSummaryMemory()
// By member name, the transcript path its Remote Control link was last read
// from, so the link is read again when the found path changes.
const linkFrom = new Map<string, string>()
let polling = false

async function pollLive($: EngineInterface, open: () => boolean) {
  // One poll at a time: the transcript reads can take a while, so a tick
  // that finds the last poll still running does nothing.
  if (polling) return
  polling = true
  try {
    // With no roster file to read there is no brigade to show, so nothing is
    // read either; the pane already shows why.
    const at = await where($)
    if ('error' in at) return
    // The stat resolves, so the place checks and the summary's path rule get
    // a real path. An engine with no listing makes the transcript finder's
    // listing reject, quietly, and the session-file read draw the fixed line.
    const io = {
      live: open,
      now: () => $.clock.now(),
      stat: (path: string) => $.fs.stat(path, { resolve: true }),
      list: async (path: string) => $.fs.list(path),
      read: async (path: string) => String(await $.fs.read(path)),
    }
    // The live state, from the engine's session files every poll. The pane
    // runs no `claude agents --json`, which makes every running session do
    // work at once (#347). A file that fails its check draws no row, and it,
    // or a folder that cannot be read, draws the one fixed line.
    const files = await readSessions(at.config, io)
    if (!open()) return
    const rows = files?.rows ?? []
    // Each roster card finds its session by id (a title only when it has no
    // id, or when no session file carries a Desktop id), and only the cards'
    // entries are kept: the live word, the session's own name and the group
    // the card moves to. No id is stored. A card two sessions share keeps an
    // entry per session and no move.
    const cards = (await read($, roster)).cards
    const now = await Promise.resolve($.clock.now()).catch(() => Number.NaN)
    const matched = matchRows(cards, rows, now)
    await update($, live, () =>
      cards.flatMap(c => {
        const own = matched.get(c.title) ?? []
        const row = own[0]
        if (row === undefined) return []
        // One entry per card: a card two sessions share draws the first one's word, and no move.
        const move = own.length === 1 ? rowMove(c.status, row) : undefined
        return [{ name: c.title, value: liveWord(row), shown: oneLine(row.name, MAX_NAME), ...(move === undefined ? {} : { move }) }]
      }),
    )
    await update($, liveError, () => (files?.complete === true ? '' : SESSIONS_UNREAD))
    // With no session read at all, the cards keep the cache and meter values
    // they had: no rows would only redraw every card as not found.
    if (files === undefined) return
    try {
      // Transcripts are found under the config folder.
      const config = at.config

      // Each roster member's cache warmth and meters: from its summary file
      // in this plugin's data folder when one passes its checks, else from
      // its transcript's call series, found by the transcript finder. The
      // rules for what is found and read, and when, are in view.ts.
      // The matched rows are handed over under their card's title.
      const retitled = cards.flatMap(c => (matched.get(c.title) ?? []).map(row => ({ ...row, name: c.title })))
      const found = await readCalls(retitled, cards.map(c => c.title), config, memory, io, finder, { plugin: at.plugin, held: summaries })
      if (found === undefined || !open()) return
      await update($, warmth, () => found.warmth)
      await update($, meters, () => found.meters)
      await update($, refusals, () => found.refusals)

      // A Remote Control session's claude.ai link sits in its transcript, in a
      // row the engine writes. Read only a roster member's, through the
      // finder's result for this poll, which passed the place check: again
      // whenever the found path changes, the misses kept too, and nothing
      // over the read cap: a transcript past 4 MiB keeps the link read while
      // it was smaller, a reload and a moved path included (#308). A link
      // from a path the finder dropped, or from one it moved off at 4 MiB or
      // less, goes, and so does a stored link when nothing is found, even
      // after a reload has emptied `linkFrom`. A name the finder did not look
      // for, one with no row or one two rows share, is left as it was. The
      // read comes first and is kept only if the pane is still open, so a
      // close during it records nothing and the next poll tries again.
      const members = new Set(cards.filter(c => c.desktopId === undefined && c.url === undefined).map(c => c.title))
      const stored = new Set((await read($, links)).map(p => p.name))
      for (const [name, at] of finder.byName) {
        const step = linkStep(at?.path, linkFrom.get(name), stored.has(name), at?.size)
        if (!members.has(name) || step === 'skip') continue
        if (step === 'keep' && at !== undefined) {
          linkFrom.set(name, at.path)
          continue
        }
        if (!open()) return
        // No transcript, one too large, or none for this kind of session: no link.
        const url =
          at === undefined || step === 'drop' || !(at.size <= MAX_TRANSCRIPT_BYTES)
            ? undefined
            : await $.fs.read(at.path).then(t => remoteLink(String(t)), () => undefined)
        if (!open()) return
        if (at === undefined) linkFrom.delete(name)
        else linkFrom.set(name, at.path)
        await update($, links, list => [...list.filter(p => p.name !== name), ...(url === undefined ? [] : [{ name, value: url }])])
      }
      // A link whose card left the roster goes with it, and so does the path
      // it was read from: a card that returns reads its link again (#281).
      if (!open()) return
      const titles = cards.map(c => c.title)
      for (const name of [...linkFrom.keys()]) if (!titles.includes(name)) linkFrom.delete(name)
      await update($, links, list => linksOnRoster(list, titles))
    } catch {
      // The reads are tried again at the next poll.
    }
  } finally {
    polling = false
  }
}

// The groups the last poll moved cards to, by card title, read through the
// checked live entries.
async function movesOf($: EngineInterface): Promise<Moves> {
  return movesFrom(liveFrom(await read($, live)))
}

// --- the PR details --------------------------------------------------------
//
// While the pane is open and a shown card carries a PR number, the pane runs one
// fixed `gh pr list` a minute. The argument list is a constant: no roster text,
// number or title reaches the command. The answers, and the numbers known to be
// merged, stay in the module for the session and never enter plugin state;
// a reload starts them over. `gh`'s error text is never read, shown or stored.

// By PR number, the last good answers.
let ghAnswers: ReadonlyMap<number, GhPr> = new Map()
// The numbers `gh` said are merged. The call stops once every shown PR is in here.
const ghMerged = new Set<number>()
// Whether the last call failed: the Pull requests view says so in fixed words.
let ghDown = false
// The owner/name the first good answer named. `gh` answers for the repository the
// environment and the working folder's git config choose, which a member session
// can change; an answer naming another repository counts as no answer.
let ghRepo: string | undefined
// When the last call started, on the engine clock.
let ghAt: number | undefined
let asking = false

// The numbers of the PRs the shown cards carry, as numbers.
const shownPrs = (cards: readonly Card[], hidden: ReadonlySet<unknown>, moves: Moves): number[] => {
  const g = groupCards(cards, hidden, moves)
  return [...g.needsYou, ...g.working, ...g.finished].flatMap(({ c }) => {
    const n = prNumber(c)
    return n === undefined ? [] : [Number(n)]
  })
}

// On macOS and Linux `gh` is found by name on the inherited PATH, so a PATH with
// an empty or relative entry could let a file in the project folder run in its
// place, with the session's environment. Such a host runs nothing then. Windows
// is measured: the engine runs the real `gh` there (threat model, row 15).
//
// The host is worked out on each call, here and at Open in app, or is none.
// The engine gives a mod no platform field. Windows is known first, by its
// environment; then each probe in turn, as `probeHost` judges it. A read that
// fails means no host, never unset. Each name is spelled at its call, so
// `claude plugin validate` lists what the pane reads, and the reads stay in
// these two callers because the directory's checker refuses `$` passed to a
// helper that reads the host.
async function ghFindable($: EngineInterface): Promise<boolean> {
  try {
    if (windowsEnv('OS', await $.env.get('OS')) || windowsEnv('SystemRoot', await $.env.get('SystemRoot')) || windowsEnv('windir', await $.env.get('windir'))) return true
    let os: HostOs | 'next' | undefined = 'next'
    for (const [probe, file] of HOST_PROBES) {
      os = probeHost(probe, await statPath($, file))
      if (os !== 'next') break
    }
    if (os === 'next' || os === undefined) return false
    const path = await $.env.get('PATH')
    return typeof path === 'string' && path !== '' && path.split(':').every(entry => entry.startsWith('/'))
  } catch {
    return false
  }
}

// `tick` is the timer's own call, which always runs; the call at arm waits out
// a minute since the last one, so a quick reopen asks once.
async function askGh($: EngineInterface, open: () => boolean, tick: boolean) {
  if (asking) return
  asking = true
  try {
    const [{ cards }, hid, moves] = await Promise.all([read($, roster), read($, dismissed), movesOf($)])
    const wanted = shownPrs(cards, new Set(hid), moves)
    if (wanted.length === 0 || wanted.every(n => ghMerged.has(n))) return
    const now = await $.clock.now()
    if (!tick && ghAt !== undefined && now - ghAt < GH_MS) return
    ghAt = now
    if (!(await ghFindable($))) {
      if (open()) ghDown = true
      return
    }
    let found: ReadonlyMap<number, GhPr> | undefined
    try {
      const ran = await $.process.run([...GH_ARGV], { timeoutMs: 15000 })
      if (!open()) return
      if (ran.exitCode === 0 && ran.isStdoutTruncated === false && typeof ran.stdout === 'string') {
        const parsed = parsePrList(ran.stdout)
        if ('value' in parsed) found = parsed.value
      }
    } catch {
      // A failure to start counts as no answer.
    }
    if (!open()) return
    if (found === undefined) {
      ghDown = true
      return
    }
    // The first good answer pins the repository; another one is no answer.
    const answered = [...found.values()]
    if (ghRepo === undefined) ghRepo = answered[0]?.repo
    if (ghRepo !== undefined && answered.some(a => a.repo !== ghRepo)) {
      ghDown = true
      return
    }
    // A merged PR is kept even when a later answer no longer lists it.
    const next = new Map<number, GhPr>()
    for (const [n, a] of ghAnswers) if (ghMerged.has(n)) next.set(n, a)
    for (const [n, a] of found) {
      next.set(n, a)
      if (a.state === 'merged') ghMerged.add(n)
    }
    ghAnswers = next
    // A call that answered for none of the shown numbers (another host, say) says so too.
    ghDown = wanted.every(n => !next.has(n))
  } finally {
    asking = false
  }
}

// This session's own usage, for the section at the bottom of the pane. The
// plain reading costs nothing. The context breakdown is asked for only when
// the session draws somewhere other than the terminal, the one place the
// image shows its rows, and only as the local summary estimate, which sends
// no request. Only the fields the section draws are stored. Each reading also
// samples the session limit for its projection, by view.ts's rules. A failed
// reading keeps the last one, and a reading that started before the pane
// closed is dropped, so it cannot land over a fresh one after a reopen.
async function readUsage($: EngineInterface) {
  const mine = generation
  try {
    const surfaces = await $.session.surfaces()
    const image = surfaces.some(s => s !== 'terminal')
    const reading = await $.session.usage(image ? { breakdown: 'summary' } : undefined)
    if (generation !== mine) return
    const snapshot = snapshotFrom(reading)
    await update($, usage, () => snapshot)
    const now = await $.clock.now()
    if (generation === mine) await update($, samples, list => addSample(list, snapshot, now))
  } catch {
    // No reading this time: the section keeps what it showed.
  }
}

// The measure hook's reads, one at a time. A measurement that comes while one
// runs asks for one more after it, so a burst folds into one trailing read,
// an older reading never lands after a newer one, and a reading that hung
// holds at most one waiting behind it. A close ends the run.
let measuring = -1
let again = false
async function measureUsage($: EngineInterface) {
  const mine = generation
  if (measuring === mine) {
    again = true
    return
  }
  measuring = mine
  try {
    do {
      again = false
      await readUsage($)
    } while (again && generation === mine)
  } finally {
    if (measuring === mine) measuring = -1
  }
}

// Start the reads, once: a second /brigade while they run starts nothing.
// The timers are taken before the first await, so two arms that overlap
// cannot both pass the check. Each arm carries its generation, and a close
// moves the generation on, so neither its first reads nor a tick already
// queued run after the pane closed. STARTS_FOLDED says which groups start folded at each arm.
let generation = 0
async function arm($: EngineInterface) {
  if (timers.length === 0) {
    const mine = ++generation
    const live = () => generation === mine
    timers = [
      $.clock.every(ROSTER_MS, () => void (live() && rosterTick($, live))),
      $.clock.every(LIVE_MS, () => void (live() && pollLive($, live))),
      $.clock.every(GH_MS, () => void (live() && askGh($, live, true))),
    ]
    await update($, armed, () => true)
    await update($, folded, () => STARTS_FOLDED)
    if (live()) await readUsage($)
    if (live()) await loadRoster($)
    if (live()) await pollLive($, live)
    // Not awaited: a slow gh must not hold up the /brigade reply, the skill's text or the tool's offer.
    if (live()) void askGh($, live, false)
    return
  }
  await update($, armed, () => true)
  await update($, folded, () => STARTS_FOLDED)
}
function disarm() {
  generation++
  for (const t of timers) t.cancel()
  timers = []
}

// The roster timer's tick. The engine drops a pane whose drawing threw
// without telling its close hook, so each tick first checks that the pane is
// still listed, and stops every read when it is not: the timers, the measure
// hook's reads and the report keeping all end with it.
async function rosterTick($: EngineInterface, live: () => boolean) {
  try {
    const panes = await $.ui.panes()
    const listed = panes.some(p => p.id === PANE)
    // A close or a fresh arm while the answer was on its way: act on nothing.
    if (!live()) return
    if (!listed) {
      disarm()
      await update($, armed, () => false)
      return
    }
  } catch {
    // No answer this time: the next tick asks again.
    return
  }
  const ids = await loadRoster($)
  if (live()) await sweepTodos($, ids)
}

// The Desktop ids whose press is in its tool route now. A second press for
// one of them is ignored until the route ends, so a press inside the wait
// sends no second call and cannot run the link route twice. The card's button
// and its to-do's share the mark, since both name the same id.
const opening = new Set<string>()

// Open in app, first through the Desktop app's own tool, which shows a session
// this lead started in a split beside it. The tool is called only where the
// Desktop app draws the session, when the engine lists the tool by its exact
// name and the owner's rules allow it, and its
// answer is read as untrusted. No permission prompt sees this call, so those
// checks stand in for one. Any refusal, rejection, throw or a wait past 5 s
// on the engine's clock, from the tool list to the answer, ends the route, and
// the press goes on to the link. Resolves true when the app said it opened
// the session.
async function viaTool($: EngineInterface, session: string): Promise<boolean> {
  let over = false
  let timer: Timer | undefined
  const waited = new Promise<false>(res => {
    timer = $.clock.after(OPEN_WAIT_MS, () => {
      over = true
      res(false)
    })
  })
  const route = askTool($, session, () => over)
  // A route that ends or fails after the wait is dropped here, unread.
  route.catch(() => undefined)
  try {
    return await Promise.race([route, waited])
  } finally {
    timer?.cancel()
  }
}

// The tool route itself. After the wait is over it makes no call and shows
// nothing; a call already made may still show the split after the link route
// ran.
async function askTool($: EngineInterface, session: string, over: () => boolean): Promise<boolean> {
  // Only where the Desktop app draws this session: elsewhere its server is
  // absent, and a server of the same name would be the only one to answer.
  const surfaces = await $.session.surfaces()
  if (!surfaces.includes('desktop')) return false
  if (!listsOpenTool(await $.tool.list())) return false
  const args = { session_id: session, target: OPEN_TARGET }
  if (!rulesAllowTool(await $.tool.check({ tool: OPEN_TOOL, input: args }))) return false
  if (over()) return false
  const outcome = readOpenAnswer(await $.mcp.call(OPEN_SERVER, OPEN_NAME, args))
  if (over()) return false
  if (outcome.opened) {
    $.ui.toast(outcome.toast)
    return true
  }
  if (outcome.reason !== undefined) $.ui.toast(outcome.reason)
  return false
}

// The links with a link-route press in progress, from host detection through
// the opener's run. Any press on one of them, a Desktop card's included, does
// nothing until that press ends, whether its run succeeds or fails, as
// `opening` does for the tool route.
const linking = new Set<string>()

// The pane's Link takes https only, so the app link goes to the host's own
// handler for claude://, through the host's opener: explorer.exe on Windows,
// /usr/bin/open on macOS, /usr/bin/xdg-open on Linux, and none on a host the
// pane cannot prove. Only a link of the two known shapes goes, built from a
// checked id, as one argument with no shell, one press per link at a time,
// for at most 15 s. A card with a Desktop id tries the app's own tool first,
// one press at a time.
async function openInApp($: EngineInterface, c: Card) {
  const app = appLink(c, lookup(await read($, links)).get(c.title))
  if (app === undefined || linking.has(app)) return
  const session = toolSession(c)
  if (session !== undefined) {
    if (opening.has(session)) return
    opening.add(session)
    try {
      if (await viaTool($, session).catch(() => false)) return
    } finally {
      opening.delete(session)
    }
  }
  if (linking.has(app)) return
  linking.add(app)
  try {
    let os: HostOs | 'next' | undefined = 'next'
    try {
      if (windowsEnv('OS', await $.env.get('OS')) || windowsEnv('SystemRoot', await $.env.get('SystemRoot')) || windowsEnv('windir', await $.env.get('windir'))) os = 'windows'
      else for (const [probe, file] of HOST_PROBES) {
        os = probeHost(probe, await statPath($, file))
        if (os !== 'next') break
      }
    } catch {
      os = undefined
    }
    if (os === 'next' || os === undefined) {
      $.ui.toast('Open in app has no opener on this system.')
      return
    }
    const argv = openerArgv(os, app)
    const ran = await $.process.run(argv, { timeoutMs: 15000 }).catch(() => undefined)
    // The rejection's own text is never shown: name the program instead.
    if (ran === undefined) {
      $.ui.toast(`Could not open ${oneLine(c.title, 40)} with ${argv[0]}.`)
      return
    }
    // explorer.exe exits 1 even when it hands the link on, so on every host the
    // toast reports the exit code rather than judging it.
    $.ui.toast(`Opening ${oneLine(c.title, 40)} in the app (${ran.exitCode})`)
  } finally {
    linking.delete(app)
  }
}

// --- set_roster ---------------------------------------------------------------
//
// The tool the head chef keeps the roster with. A file write of its own into
// the plugin's data folder asks the owner every time, in every mode, because
// Claude Code protects that folder; this tool writes the same file with no
// prompt. So it is guarded here instead: it is offered only once the owner
// opens the pane, writes only while the engine lists the pane open, refuses a
// subagent's call, a deny verdict and an owner's ask rule, takes only a roster
// that passes the shared check and cap, writes only the one file the path rule
// in roster.ts allows, and never names a path from its input.

const TOOL_NAME = 'mcp__grimoire__set_roster'

const DESCRIPTION =
  "Keeps the Brigade pane's roster for this lead session. Pass the whole roster every time, every card and every to-do; it replaces the last one. Both lists are required; two empty lists are an empty roster. A card may carry its session's pull request: `pr` (its number as text, 1 to 7 digits) and `prState` (`open`, `merged` or `closed`, the last state known). Send no `since`: the pane stamps how long each card has been in its status and phase from its own clock. It works only while the Brigade pane is open, which the owner opens with /brigade or a load of the head-chef skill opens, and refuses otherwise. A refusal names the rule that failed."

const field = (max: number) => ({ type: 'string', maxLength: max })
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards', 'todos'],
  properties: {
    cards: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'status'],
        properties: {
          title: field(80),
          work: field(MAX_TEXT),
          phase: field(MAX_TEXT),
          settings: field(MAX_TEXT),
          status: { type: 'string', enum: [...STATUSES] },
          desktopId: field(100),
          bgId: field(100),
          url: field(100),
          pr: { type: 'string', pattern: PR_NUMBER.source },
          prState: { type: 'string', enum: [...PR_STATES] },
        },
      },
    },
    todos: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: { id: field(40), text: field(MAX_TEXT), session: field(80) },
      },
    },
  },
}

// The engine's own fields on a tool call. Everything else is the model's
// input and goes to the shared check whole, so an unknown key is refused.
const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'consent']

const refuse = (rule: string) => ({ deny: `set_roster refused: ${rule}. The roster file is unchanged.` })
// Once the write has started, a failure cannot say the file is unchanged.
const failedAfterWrite = (why: string) => ({
  deny: `set_roster failed after the write began: ${why}. The roster may or may not have been kept; stop keeping the roster and tell the owner.`,
})

async function paneOpen($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  return panes.some(p => p.id === PANE)
}

async function offerTool($: EngineInterface) {
  await $.tool.register({ name: TOOL, description: DESCRIPTION, inputSchema: SCHEMA })
}

// Opens the pane for /brigade and for a head-chef skill load. Each open
// starts on Sessions, with the dismissed cards back and nothing selected, and
// reports count from the open. The open comes first, and the reads start and
// the tool is offered only once the engine lists the pane: a pane another
// plugin refuses or answers for starts neither. `wait` says whether to wait
// for the first reads: /brigade does, and the skill hook does not, so the
// skill's text is never held up by a slow read. `reached.open` is set once
// the engine has answered the open, for a caller whose later step throws.
// `needPlaced` is for the skill hook: a pane the engine answers is not placed
// starts no reads and offers no tool, so nothing runs while it waits unseen.
type Offer = 'offered' | 'not listed' | 'not placed' | { why: string }
async function openPane($: EngineInterface, wait: boolean, reached: { open: boolean } = { open: false }, needPlaced = false) {
  await update($, viewAtom, () => 'sessions')
  await update($, dismissed, () => [])
  await update($, picked, () => [])
  await update($, reports, () => [])
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  reached.open = true
  let offer: Offer = 'not listed'
  if (needPlaced && !opened.isPlaced) return { opened, offer: 'not placed' as const }
  if (await paneOpen($)) {
    // Not awaited when the caller does not wait: arm takes its timers before
    // its first await, so a second arm still starts nothing.
    if (wait) await arm($)
    else arm($).catch(() => undefined)
    try {
      await offerTool($)
      offer = 'offered'
    } catch (err) {
      offer = { why: oneLine(String(err instanceof Error ? err.message : err), 200) }
    }
  }
  return { opened, offer }
}

// The two lines the skill hook may append. Fixed text: nothing from the event,
// the roster or an error reaches the model's prompt through them.
const READY_LINE = `The Brigade pane is open. \`${TOOL}\` is ready: call it with the full roster on your next turn.`
// Shown when the engine opens the pane but does not place it: no reads start
// and no tool is offered, and /brigade shows the pane and starts them.
const NOT_SHOWN_TOAST = 'The Brigade pane opened but is not shown, so its reads did not start. Type /brigade to show it.'
const NOT_OFFERED_LINE = `The Brigade pane is open, but \`${TOOL}\` could not be offered; keep no roster.`

// Whether a skill load is the head-chef skill from the plugin's own copy or the
// owner's own skills folder (any user-level skill of that name), read from the event alone. The engine's documents
// do not say which spelling a plugin skill's name takes, so both are matched.
const isOurHeadChef = (e: { skill: string; source: string; pluginName?: string }) =>
  (e.skill === 'head-chef' || (e.skill === 'grimoire:head-chef' && e.source === 'plugin')) &&
  ((e.source === 'plugin' && e.pluginName === 'grimoire') || e.source === 'userSettings')

// Writes run one after another, so two calls in one turn cannot interleave
// their checks and writes. A call whose dispatch was abandoned while it
// waited, because it ran out of time or the owner interrupted it, writes
// nothing when its turn comes. A write that never returns holds the queue
// until the module reloads; row 15 names it.
let writing: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = writing.then(work, work)
  writing = run.catch(() => undefined)
  return run
}

// What a call has done so far, so a failure says the right thing about the file.
type Progress = { written: boolean }

async function setRoster($: EngineInterface, e: Record<string, unknown>, signal: AbortSignal, progress: Progress) {
  if (e.agentId !== undefined) return refuse("subagent: only the lead session's own turns keep the roster")
  if (!(await paneOpen($))) return refuse('pane closed; roster not kept')

  // Own entries copied into a fresh object, so no key reaches a prototype.
  const input = Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE.includes(k)))

  const verdict = await $.tool.check({ tool: TOOL_NAME, input })
  if (verdict.decision === 'deny') return refuse(`deny verdict: ${oneLine(verdict.reason ?? 'a rule denies this tool', 200)}`)
  if (verdict.decision === 'ask' && verdict.rule !== undefined) {
    return refuse(`ask rule: the owner's rule ${oneLine(verdict.rule, 120)} covers this tool`)
  }
  // An organisation's ceiling below allow: the tool may never run unasked.
  if (verdict.ceiling !== undefined && verdict.ceiling !== 'allow') return refuse(`organisation ceiling: ${verdict.ceiling}`)

  for (const k of ['cards', 'todos']) {
    if (!Object.hasOwn(input, k)) return refuse(`malformed input: "${k}" is missing; pass both lists, empty if need be`)
  }
  const checked = checkRoster(JSON.stringify(input), true, 'tool')
  if ('error' in checked) return refuse(`shape: ${checked.error}`)
  const at = await where($)
  if ('error' in at) return refuse(`path: ${at.error}`)

  return oneAtATime(async () => {
    if (signal.aborted) return refuse('abandoned: the call ran out of time or was interrupted before its turn')
    if (!(await paneOpen($))) return refuse('pane closed; roster not kept')
    const placed = await placeRoster(at.config, at.plugin, at.id, (path: string) => statPath($, path))
    if ('refused' in placed) return refuse(placed.refused)
    // A file already there is overwritten only if it is a roster, both lists
    // and all. What it holds otherwise is never echoed. Its cards are the
    // ages' source.
    let previous: Roster | undefined
    if (placed.existing !== undefined) {
      const was = placed.existing.size <= MAX_ROSTER_BYTES ? checkRoster(String(await $.fs.read(placed.file)), true) : undefined
      if (was === undefined || 'error' in was) {
        return refuse(`not a roster: ${placed.file} holds something other than a roster, so it is not overwritten. Ask the owner to delete that file`)
      }
      previous = was.value
    }
    // The ages: stamped here, in the queue, from the file just read and the
    // engine clock, so two calls in one turn stamp in order. The model sent no
    // time; the tool's check refused one.
    const stamped = stampSince(previous, checked.value.cards, await $.clock.now())
    if ('error' in stamped) return refuse(stamped.error)
    const value: Roster = { cards: stamped.value, todos: checked.value.todos }
    const text = serialize(value)
    if ('error' in text) return refuse(`size: ${text.error}`)
    const again = checkRoster(text.value, true, 'file')
    if ('error' in again) return refuse(`shape: ${again.error}`)
    if (signal.aborted) return refuse('abandoned: the call ran out of time or was interrupted before its write')
    progress.written = true
    await $.fs.write(placed.file, text.value)
    // A link swapped in between the check and the write, at the file or at
    // any folder above it, is caught here by the same path rule, after the
    // fact, and said loudly. A hard link is not.
    const after = await placeRoster(at.config, at.plugin, at.id, (path: string) => statPath($, path)).catch(err => ({
      refused: `the check failed (${oneLine(String(err instanceof Error ? err.message : err), 200)})`,
    }))
    const why = 'refused' in after ? after.refused : after.existing === undefined ? 'the file is not there' : undefined
    if (why !== undefined) {
      const warning = `Brigade: after the roster write, the roster path failed its check: ${why}. Something changed it between the check and the write; check ${placed.file} and where it leads.`
      await update($, rosterError, () => warning)
      $.ui.toast(warning, { timeoutMs: 15000 })
      return failedAfterWrite(`the path then failed its check (${why}); the owner has been told`)
    }
    // Only now does the pane change: it redraws at once, and the 5 s poll
    // stays the reader for changes made elsewhere.
    await update($, roster, () => value)
    await update($, rosterError, () => '')
    return { result: `Roster kept: ${value.cards.length} card(s), ${value.todos.length} to-do(s).` }
  })
}

// The owner's "Don't show again", read from the store at each start. The
// band in warning.tsx reads the same key.
const warningAck = atom({ plugin: 'grimoire', key: 'warningAck' } as const, null)

async function offerWarning($: EngineInterface) {
  await $.tool.register({ name: WARNING_TOOL, description: WARNING_DESCRIPTION, inputSchema: WARNING_SCHEMA })
}

/** At each session start: read the owner's "Don't show again" back from the
 *  store, and offer the permission warning's tool. A failure leaves no tool,
 *  and the skill then says the warning in chat. */
async function warningStart($: EngineInterface) {
  try {
    let kept: ReturnType<typeof ackFrom> = null
    try {
      kept = ackFrom(await $.store.get(WARNING_KEY))
    } catch {
      // An unreadable store is no acknowledgement.
    }
    await update($, warningAck, () => kept)
    await offerWarning($)
  } catch {
    // No warning tool this time.
  }
}

/** At each classic.SessionStart, a startup, a clear or a resume: offer the
 *  tool again, since a clear or a resume does not fire session.start, and
 *  registering a name again replaces it. */
async function warningOfferAgain($: EngineInterface) {
  try {
    await offerWarning($)
  } catch {
    // As above.
  }
}

export const register: Register = on => {
  // Every session's own usage summary, written from its steps and turn ends.
  registerWriter(on)
  // The head chef's permission warning, above the prompt in a lead session.
  registerWarning(on)

  on('session.start', async ($, e, next) => {
    // The usage summary writer's clock and session: the engine's epoch and
    // this session's id, read once here and never awaited. Only numbers and
    // text cross into writer.ts.
    const perf = performance.now()
    $.clock.now().then(t => writerEpoch(t, perf), () => undefined)
    $.session.id().then(id => writerSession(id), () => undefined)
    await $.command.register({
      name: 'brigade',
      description: 'Show the Brigade pane: the sessions this lead session started',
    })
    // The permission warning's tool, offered in every session: the head chef
    // calls it before its first launch, with or without the pane.
    await warningStart($)
    // A reload of the module while the pane stays up finds it in the engine's
    // record. Only then do the reads start again, and the tool is offered
    // again; a fresh session has no pane and no tool.
    if (await paneOpen($)) {
      await arm($)
      await offerTool($)
    }
    return next(e)
  })

  // The engine's own record of a session: its id and transcript path, one
  // place the config folder can be read from when the plugin's location does
  // not name it (else Desktop's synced install folder). A clear or a resume fires this again with the new id,
  // and session.start does not, so the tool is offered again here while the
  // pane is open; registering a name again replaces it.
  on('classic.SessionStart', async ($, e, next) => {
    writerSession(e.session_id)
    if (SESSION_ID.test(e.session_id) && typeof e.transcript_path === 'string') {
      await update($, started, () => ({ sessionId: e.session_id, transcript: e.transcript_path }))
    }
    try {
      if (await paneOpen($)) await offerTool($)
    } catch {
      // No tool this time: the next /brigade offers it again.
    }
    await warningOfferAgain($)
    return next(e)
  })

  on('command.run', { command: 'brigade' }, async $ => {
    const { opened, offer } = await openPane($, true)
    let ready = ''
    if (offer === 'offered') ready = ` \`${TOOL}\` is ready: call it with the full roster.`
    else if (offer !== 'not listed' && offer !== 'not placed') ready = ` \`${TOOL}\` could not be offered (${offer.why}); keep no roster.`
    // The reply names no roster path: no skill reads one, and the pane no
    // longer draws one. When no file can be named, the pane keeps the full
    // reason.
    const at = await where($)
    const named = 'error' in at ? ' The pane cannot find the roster file; the pane says why.' : ''
    return {
      text: `${opened.isPlaced ? 'Brigade pane opened.' : `Brigade pane is open but not shown: ${opened.reason}.`}${named}${ready}`,
    }
  })

  // The head-chef skill's load opens the pane, when it is closed, and appends
  // one fixed line to the skill's text. Every other load passes on untouched,
  // with no engine call. A throw returns the text as it came; one after the
  // open answered also says so in a toast.
  on('skill.prompt', async ($, e, next) => {
    if (!isOurHeadChef(e)) return next(e)
    const answered = await next(e)
    const reached = { open: false }
    try {
      if (await paneOpen($)) return answered
      const { offer } = await openPane($, false, reached, true)
      if (offer === 'not placed') {
        $.ui.toast(NOT_SHOWN_TOAST)
        return answered
      }
      if (offer === 'not listed') return answered
      return { text: `${answered.text}\n\n${offer === 'offered' ? READY_LINE : NOT_OFFERED_LINE}` }
    } catch {
      if (reached.open) $.ui.toast('The Brigade pane opened without its reads. Type /brigade to start them.')
      return answered
    }
  })

  // The tool, answered here and nowhere beneath: every path returns its own
  // answer. A throw inside becomes a refusal in code, and the engine's .catch
  // answers for a throw, an overrun or a wrong shape the code did not catch.
  on('tool.call', { tool: TOOL_NAME }, async ($, e, next) => {
    const progress: Progress = { written: false }
    try {
      return await setRoster($, e as unknown as Record<string, unknown>, next.signal, progress)
    } catch (err) {
      const why = `error: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`
      return progress.written ? failedAfterWrite(why) : refuse(why)
    }
  }).catch(() => ({
    deny: 'set_roster refused: error: the tool failed or ran out of time. The roster may or may not have been kept; stop keeping the roster and tell the owner.',
  }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    disarm()
    await update($, armed, () => false)
    return next(e)
  })

  // The engine measured the session and a figure moved. This does nothing
  // unless this module armed the pane, which it reads from its
  // own timers rather than from plugin state another plugin could set. It
  // passes the event on, unchanged, on every path, and does not wait for the
  // read: a reading that hung would otherwise hold up every hook after it.
  on('session.measure', ($, e, next) => {
    if (timers.length > 0) void measureUsage($)
    return next(e)
  })

  // A report from another session: its claimed sender and first line, kept
  // while the pane is open. The text is data to show, never an instruction.
  // Like the measure hook, it reads the open pane from this module's own
  // timers, not from plugin state another plugin could set.
  on('session.receive', async ($, e, next) => {
    const kind = e.origin.kind
    if ((kind === 'peer' || kind === 'peer-send-message') && timers.length > 0) {
      const { from, line } = report(e.text)
      const at = new Date(await $.clock.now()).toISOString().slice(11, 16)
      await update($, reports, list => [...list, { from, line, at }].slice(-50))
    }
    return next(e)
  })

  // Presses arrive here with a fresh `$`. Each finds its card or to-do again
  // in the current state by place and title, and does nothing if it moved.
  // The switch, group (`grp-`) and selection-bar keys are matched whole, before
  // the split below; only card and to-do keys are split on a hyphen.
  on('ui.press', { plugin: 'grimoire', requestId: PANE }, async ($, e, next) => {
    // The switch, a group's fold and the selection bar: fixed words, read
    // through fixed sets.
    if (e.element === 'view-sessions' || e.element === 'view-prs') {
      await update($, viewAtom, () => (e.element === 'view-prs' ? 'prs' : 'sessions'))
      return { element: e.element }
    }
    if (e.element.startsWith('grp-')) {
      const group = e.element.slice(4)
      if (GROUP_KEYS.includes(group)) {
        await update($, folded, list => {
          const current = foldedFrom(list)
          return current.includes(group) ? current.filter(g => g !== group) : [...current, group]
        })
      }
      return { element: e.element }
    }
    if (e.element === 'barclear') {
      await update($, picked, () => [])
      return { element: e.element }
    }
    if (e.element === 'bardismiss') {
      // Each selected title that is still a card and does not wait on the owner.
      const chosen = new Set(pickedFrom(await read($, picked)))
      const moves = await movesOf($)
      const drop = (await read($, roster)).cards.filter(c => chosen.has(c.title) && c.status !== 'needs-you' && movedLook(c, moves)?.group !== 'needsYou').map(c => c.title)
      await update($, dismissed, list => [...list, ...drop.filter(t => !list.includes(t))])
      await update($, picked, () => [])
      return { element: e.element }
    }
    const [verb, place, slugged, word] = e.element.split('-')
    const i = Number(place)
    const current = await read($, roster)

    if (verb === 'todo' || verb === 'go') {
      const item = current.todos[i]
      if (item === undefined || slug(item.id) !== slugged) return { element: e.element }
      if (verb === 'todo') {
        // A tick, or a second press inside the grace period that undoes it.
        const now = await $.clock.now()
        await update($, ticking, list => toggleTick(list, item.id, now))
        return { element: e.element }
      }
      const who = current.cards.find(c => c.title === item.session)
      if (who !== undefined) await openInApp($, who)
      return { element: e.element }
    }

    const c = current.cards[i]
    if (c === undefined || slug(c.title) !== slugged) return { element: e.element }
    if (verb === 'open') await openInApp($, c)
    // A card that waits on the owner has no Dismiss, and a press cannot add one.
    if (verb === 'dismiss' && c.status !== 'needs-you' && movedLook(c, await movesOf($))?.group !== 'needsYou') {
      await update($, dismissed, list => (list.includes(c.title) ? list : [...list, c.title]))
      // A dismissed card leaves the selection too.
      await update($, picked, list => pickedFrom(list).filter(t => t !== c.title))
    }
    // A card's checkbox: selects it, at most 50 at once.
    if (verb === 'pick') {
      await update($, picked, list => {
        const current = pickedFrom(list)
        return current.includes(c.title) ? current.filter(t => t !== c.title) : current.length < MAX_PICKED ? [...current, c.title] : current
      })
    }
    // A tab: the view word is read through the fixed set, never as a key,
    // and the choice is kept under this card's own title.
    if (verb === 'tab') {
      const tab = viewOf(word)
      if (tab !== undefined) await update($, tabs, list => chooseTab(list, c.title, tab))
    }
    return { element: e.element }
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The render only reads the stored reading: it fetches none.
    const Svg = 'Svg' in table ? table.Svg : undefined
    // The clock moves the warmth line and the ages too: the roster timer's
    // redraws every 5 s move their countdowns.
    const now = await $.clock.now()
    // Where images draw: any surface with an Svg but the terminal. The usage
    // section reads this too, and falls back to text bars when its image is
    // over the engine's cap; the strip, the to-do bar and the hairline are a
    // few rects each and need no fallback.
    const surface = Svg === undefined ? 'terminal' : e.surface
    const terminal = surface === 'terminal'
    const Image = terminal ? undefined : Svg
    // A pointer hovers only on Desktop; the editor, mobile and the terminal show what a hover would.
    const pointer = surface === 'desktop'
    // Where a small margin draws as a step: the editor draws it as nothing.
    const stepped = surface === 'desktop' || surface === 'mobile'
    const metered = usageView(await read($, usage), surface, now, SVG_MAX, await read($, samples))
    const error = await read($, rosterError)
    const pollError = await read($, liveError)
    const { cards, todos } = await read($, roster)
    const hidden = new Set(await read($, dismissed))
    const liveList = liveFrom(await read($, live))
    const running = lookup(liveList)
    const sessionName = new Map(liveList.flatMap(l => (l.shown === undefined ? [] : [[l.name, l.shown] as const])))
    const moves = movesFrom(liveList)
    const found = lookup(await read($, links))
    const warm = new Map(warmthFrom(await read($, warmth)).map(w => [w.name, w]))
    const meterOf = new Map(metersFrom(await read($, meters)).map(m => [m.name, m]))
    // Read once, only through the two kind words, by card title.
    const refused = refusalLines(await read($, refusals))
    // As stored: read through the fixed set of view words by chosenView.
    const tabChoices = await read($, tabs)
    const inbox = await read($, reports)
    const done = idsFrom(await read($, doneTodos))
    const ticked = new Set(done)
    const ticks = await read($, ticking)
    const crossed = new Set(ticksFrom(ticks).map(p => p.name))
    // A report's sender is the card's title or, for a matched card, its session's own name.
    const senders = (title: string) => [title, sessionName.get(title) ?? title]
    const last = (title: string) => {
      const names = new Set(senders(title).map(drawnTitle))
      return [...inbox].reverse().find(r => names.has(r.from))
    }
    // The chosen view, the selection and the folds, each checked again.
    const view = viewFrom(await read($, viewAtom))
    const picks = new Set(pickedFrom(await read($, picked)))
    const folds = new Set(foldedFrom(await read($, folded)))

    // The cards in their groups, each with its place in the roster, which every
    // button key keeps. A status outside the four words draws in no group.
    const { needsYou, working, finished } = groupCards(cards, hidden, moves)
    // The bar counts only picks a checkbox shows: a card that waits on the
    // owner has none, and a title no shown card holds is no pick.
    const pickable = new Set([...working, ...finished].map(({ c }) => c.title))
    const selected = [...picks].filter(t => pickable.has(t)).length
    // A ticked to-do stays in the list, crossed out, until the sweep moves it.
    const open = todos.map((t, i) => ({ t, i })).filter(({ t }) => !ticked.has(t.id))
    const waiting = waitingCount(needsYou.length, todos, done, ticks)
    // The count on the left of the top row, the status strip and the to-do bar:
    // numbers only, from the statuses and the to-do, done and ticking lists.
    const shown = needsYou.length + working.length + finished.length
    const strip = statusStrip(cards, hidden, moves)
    const progress = todoBar(todos, done, ticks)
    const sessionsCount =
      shown > 0 || progress !== undefined
        ? `${shown} ${shown === 1 ? 'session' : 'sessions'}`
        : error === ''
          ? 'No cards in the roster yet.'
          : undefined
    const prs = prRows(cards, hidden, ghAnswers, now, moves)
    const prCount = prs.open.length + prs.merged.length + prs.closed.length

    // A pointer over a scope lights every element drawn with it. Desktop only:
    // the terminal has no pointer. At rest a round border in the pane's own
    // grey, unseen; on hover the border and the fill take the hover grey, so
    // the lit row is rounded.
    const hoverFill = (scope: string) =>
      !pointer
        ? {}
        : {
            borderStyle: 'round' as const,
            borderColor: DARK_FILLS.pane,
            hover: { scope, borderColor: DARK_FILLS.hover, backgroundColor: DARK_FILLS.hover },
          }
    // A section bar's rounded fill: a round border in the fill's own colour.
    const roundFill = { borderStyle: 'round', borderColor: DARK_FILLS.bar, backgroundColor: DARK_FILLS.bar } as const
    // A tooltip: a hidden Box shown while the pointer is on its anchor's scope.
    // The terminal has none, and shows the text inline where it carries news.
    const tip = (key: string, anchorEl: JSX.Element, text: string) =>
      !pointer ? (
        anchorEl
      ) : (
        <Box position="relative" hover={{ scope: `tip-${key}` }}>
          {anchorEl}
          <Box position="absolute" top={1} left={0} display="none" hover={{ scope: `tip-${key}`, display: 'flex' }} backgroundColor={DARK_FILLS.tip} paddingX="sm">
            <Text>{text}</Text>
          </Box>
        </Box>
      )
    // The PR pill, in Desktop's own form: where images draw, a small image of
    // a rounded tint with the state's mark and the number (view.ts), its
    // height fixed, which a Box with a border cannot be. The terminal draws
    // the number in the state's colour. A state the Maps do not hold draws
    // the number uncoloured, with no tint and no mark.
    const pill = (n: string, state: string) => {
      const color = pillColor(state)
      const image = Image === undefined ? undefined : pillSvg(n, state)
      if (Image !== undefined && image !== undefined) return <Image source={image.source} alt={image.alt} width={image.width} height={image.height} />
      return color === undefined ? <Text>{`#${n}`}</Text> : <Text color={color}>{`#${n}`}</Text>
    }
    const hint = (key: string) => (
      <Box paddingX={3} paddingY={1}>
        <Text dimColor>{GROUP_HINTS.get(key) ?? ''}</Text>
      </Box>
    )
    // A group's section bar: a fold arrow, the name and the count. A rounded
    // filled bar where the pane draws images, its count brightening while the
    // pointer is on the bar, as Desktop's own section headers do; bold text in
    // the terminal.
    const groupHead = (key: string, count: number, note = '') => {
      const arrow = folds.has(key) ? '▸' : '▾'
      const name = GROUP_NAMES.get(key) ?? ''
      const scope = `bar-${key}`
      return terminal ? (
        <Box marginTop={1}>
          <Button key={`grp-${key}`} plain onPress={noop}>
            <Text bold>{`${arrow} ${name}`}</Text>
            <Text dimColor>{` ${count}${note}`}</Text>
          </Button>
        </Box>
      ) : (
        <Box paddingX="sm" marginTop="md" marginBottom="xs" {...roundFill} {...(pointer ? { hover: { scope } } : {})}>
          <Button key={`grp-${key}`} plain onPress={noop}>
            <Text dimColor>{`${arrow} `}</Text>
            <Text weight="medium">{name}</Text>
            {pointer ? (
              <Text color="inactive" hover={{ scope, color: 'text' }}>
                {` ${count}${note}`}
              </Text>
            ) : (
              <Text dimColor>{` ${count}${note}`}</Text>
            )}
          </Button>
        </Box>
      )
    }
    // The hairline between two rows: an image where images draw, a blank row in
    // the terminal. Where images draw, only Working and Done · stopped take it;
    // Waiting on you parts its rows with a row gap and Pull requests with a
    // small margin, as the prototype does.
    const between = (key: string) => {
      if (Image === undefined) return <Text>{' '}</Text>
      const line = hairlineSvg()
      return (
        <Box key={`div-${key}`} flexDirection="row" marginX="md">
          <Box flexDirection="column" flexGrow={1} minWidth={8}>
            <Image source={line.source} alt={line.alt} height={line.height} />
          </Box>
        </Box>
      )
    }
    const rows = (list: JSX.Element[], key: string) => list.flatMap((row, k) => (k === 0 ? [row] : [between(`${key}-${k}`), row]))

    // A sparkline row: on Desktop the image in a column Box that grows, on
    // the terminal its cells between dim end marks, each run in its colour;
    // then its text, which does not shrink.
    const sparkRow = (s: Spark) => {
      const image = Image !== undefined ? sparkSvg(s) : undefined
      return (
        <Box flexDirection="row" columnGap={1}>
          {Image !== undefined && image !== undefined ? (
            <Box flexDirection="column" flexGrow={1} minWidth={8}>
              <Image source={image.source} alt={image.alt} height={image.height} />
            </Box>
          ) : (
            <Box flexShrink={0}>
              <Text>
                <Text dimColor>▕</Text>
                {sparkRuns(s).map(r => (
                  <Text color={r.tone}>{r.text}</Text>
                ))}
                <Text dimColor>▏</Text>
              </Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Text>{s.text}</Text>
          </Box>
        </Box>
      )
    }

    // One card, a compact row: its checkbox (none on a card that waits on the
    // owner, whose dot is full size and title bold); the status dot, title, hover
    // actions (always shown in the terminal), PR pill, live state and age;
    // the phase with the settings in short on its right (the full line under
    // it in the terminal); and the latest report since the pane opened. Then,
    // on a needs-you or working card, the view icons (words in the terminal)
    // and the chosen view: the ◆ cache bar with its short text and the dim
    // line under it, or the ◆ warmth line, dim, when there is no bar; the ◆
    // context meter, in the cache bar's form, when the card's model has a
    // known window; and the nudge, which wraps. Burn rate: its sparkline and
    // rate, or the cache line's reason when the transcript is too large,
    // shared or not found. Context trend: its sparkline and the context now.
    // The nudge shows under whichever view is chosen, so a sticky choice never
    // hides it. A done or stopped card draws no views, ◆ line, bar, meter,
    // sparkline or nudge: a finished session's cache and context mean nothing.
    const card = ({ c, i }: { c: Card; i: number }) => {
      const look = statusOf(c.status)
      if (look === undefined) return null
      const state = liveState(running.get(c.title))
      // The look of the group the card draws in; its dot and word stay the head chef's.
      const group = movedLook(c, moves)?.group ?? look.group
      const isFinished = group === 'finished'
      const views = isFinished ? [] : cardViews(warm.get(c.title), meterOf.get(c.title))
      const chosen = isFinished ? undefined : chosenView(tabChoices, c.title, views)
      const warmLine = isFinished ? undefined : warmthLine(warm.get(c.title), running.get(c.title), c.status, now)
      const bar = chosen === 'cache' ? cacheBar(warm.get(c.title), running.get(c.title), now) : undefined
      const image = bar !== undefined && Image !== undefined ? cacheBarSvg(bar) : undefined
      const meter = chosen === 'cache' ? contextMeter(meterOf.get(c.title)) : undefined
      const meterImage = meter !== undefined && Image !== undefined ? contextMeterSvg(meter) : undefined
      const reason = chosen === 'burn' && isReason(warm.get(c.title)) ? warmLine?.text : undefined
      const burn = chosen === 'burn' && reason === undefined ? burnRate(meterOf.get(c.title), now) : undefined
      const trend = chosen === 'trend' ? contextTrend(meterOf.get(c.title)) : undefined
      const refusal = isFinished ? undefined : refused.get(c.title)
      // The cache block's value column: as wide as its longest text, so the
      // cache bar and the context meter end at the same place. Each value
      // starts at the column's left edge, one gap after its bar, as each bar
      // sits one gap after its label.
      const record = warm.get(c.title)
      const sizeOnly = bar !== undefined && meter === undefined && record?.kind === 'call' ? sizeText(record.tokens) : undefined
      const valueCells = Math.max(bar?.text.length ?? 0, meter?.text.length ?? 0, sizeOnly?.length ?? 0)
      // Where images draw, the text is proportional and narrower than its
      // cell count, so a fixed column leaves room after each value: there
      // each value takes its own width and its bar grows to meet it. The
      // width is left out, not handed undefined, as a precaution: the plugin
      // test harness drops undefined props, so no test can tell the two apart.
      const valueWidth = Image === undefined ? { width: valueCells } : {}
      const report = last(c.title)
      const needs = group === 'needsYou'
      const canOpen = appLink(c, found.get(c.title)) !== undefined
      const isPicked = picks.has(c.title)
      const scope = `row-${i}-${slug(c.title)}`
      const short = compactSettings(c.settings)
      const age = ageText(c.since, now)
      const number = prNumber(c)
      const answer = number === undefined ? undefined : ghAnswers.get(Number(number))
      // The actions: on Desktop hidden until the pointer is on the row, in the
      // terminal always shown. A card that waits on the owner has no Dismiss.
      const actions =
        canOpen || !needs ? (
          <Box flexShrink={0} flexDirection="row" columnGap={1} {...(!pointer ? {} : { display: 'none' as const, hover: { scope, display: 'flex' as const } })}>
            {canOpen && (
              <Button key={keyFor('open', i, c.title)} plain dimColor onPress={noop}>
                Open
              </Button>
            )}
            {!needs && (
              <Button key={keyFor('dismiss', i, c.title)} plain dimColor onPress={noop}>
                Dismiss
              </Button>
            )}
          </Box>
        ) : null
      return (
        <Box flexDirection="column" paddingX={terminal ? 0 : 'md'} paddingY={terminal ? 0 : 'sm'} {...hoverFill(scope)}>
          <Box flexDirection="row" columnGap={1} alignItems="center">
            {/* The checkbox: its own key and its own word, so a press on it
                is never a to-do's tick. A card that waits on the owner has
                none: the bar's one action, Dismiss, never takes it. */}
            {!needs && (
              <Box flexShrink={0}>
                {isPicked ? (
                  <Button key={keyFor('pick', i, c.title)} onPress={noop}>
                    ✓
                  </Button>
                ) : (
                  <Button key={keyFor('pick', i, c.title)} dimColor onPress={noop}>
                    {terminal ? UNTICKED_TERMINAL : UNTICKED}
                  </Button>
                )}
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Box flexDirection="row" columnGap={1} alignItems="center">
                {/* The status dot in the status colour: small on a card, full
                    size on one that waits on the owner, whose title is bold.
                    The terminal draws the status glyph, which reads without
                    colour. */}
                <Box flexShrink={0}>
                  {terminal ? (
                    <Text color={look.color}>{look.glyph}</Text>
                  ) : needs ? (
                    <Text color={look.color}>●</Text>
                  ) : (
                    <Text color={look.color} size="caption">
                      ●
                    </Text>
                  )}
                </Box>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text weight={needs ? 'bold' : 'semibold'} wrap="truncate-end">
                    {oneLine(sessionName.get(c.title) ?? c.title, 80)}
                  </Text>
                </Box>
                {actions}
                {number !== undefined && (
                  <Box flexShrink={0}>
                    {answer === undefined ? pill(number, pillState(undefined, c.prState)) : tip(`pill-${i}`, pill(number, pillState(answer.state, c.prState)), answer.repo)}
                  </Box>
                )}
                <Box flexShrink={0}>
                  {/* Idle on a working card is bold as well as amber: the flip
                      from busy is the owner's cue (owner decision q1 A on #287). */}
                  {c.status === 'working' && state.text === 'idle' ? (
                    <Text bold color={state.color}>
                      {state.text}
                    </Text>
                  ) : (
                    <Text color={state.color}>{state.text}</Text>
                  )}
                </Box>
                {age !== undefined && (
                  <Box flexShrink={0}>
                    <Text dimColor tabular>
                      {age}
                    </Text>
                  </Box>
                )}
              </Box>
              <Box flexDirection="row" columnGap={1}>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text dimColor size="footnote" wrap="truncate-end">
                    {oneLine(c.phase, 160)}
                  </Text>
                </Box>
                {pointer && <Box flexShrink={0}>{tip(`set-${i}`, <Text dimColor mono>{short.text}</Text>, short.full)}</Box>}
              </Box>
              {!pointer && (
                <Text dimColor wrap="truncate-end">
                  {short.full}
                </Text>
              )}
              {report !== undefined && (
                <Text dimColor size="footnote" wrap="truncate-end">
                  {report.at} → {report.line}
                </Text>
              )}
            </Box>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {/* The views: icons with tooltips on Desktop, words in the
                terminal, the chosen one primary and the others dim. Two
                branches, never a prop handed false: Desktop refuses
                plain={false} and skips the whole render. */}
            {views.length >= 2 && (
              <Box flexDirection="row" columnGap={1} marginBottom={1} alignItems="center">
                {views.map(v =>
                  tip(
                    `tab-${i}-${v}`,
                    v === chosen ? (
                      <Button key={`${keyFor('tab', i, c.title)}-${v}`} variant="primary" onPress={noop}>
                        {pointer ? (VIEW_ICONS.get(v) ?? '?') : `● ${VIEW_LABELS.get(v) ?? ''}`}
                      </Button>
                    ) : (
                      <Button key={`${keyFor('tab', i, c.title)}-${v}`} dimColor onPress={noop}>
                        {pointer ? (VIEW_ICONS.get(v) ?? '?') : (VIEW_LABELS.get(v) ?? '')}
                      </Button>
                    ),
                    VIEW_LABELS.get(v) ?? '',
                  ),
                )}
              </Box>
            )}
            {/* The burn rate or the context trend, or the burn view's reason
                line, then the nudge, which shows under every view (owner
                decision q1 B on #272), then one row before the next. */}
            {chosen !== undefined && chosen !== 'cache' && (reason !== undefined || burn !== undefined || trend !== undefined || warmLine?.nudge !== undefined) && (
              <Box flexDirection="column" marginBottom={1}>
                {reason !== undefined && (
                  <Text dimColor wrap="truncate-end">
                    {reason}
                  </Text>
                )}
                {burn !== undefined && sparkRow(burn)}
                {trend !== undefined && sparkRow(trend)}
                {warmLine?.nudge !== undefined && (
                  <Text color="warning" wrap="wrap">
                    {warmLine.nudge}
                  </Text>
                )}
              </Box>
            )}
            {/* The cache block. Where images draw, the image takes the room
                between the label and its text, which do not shrink, so on a
                narrow pane the bar shrinks to its minimum, not the text; the
                image, placed in percentages, spans a column Box that grows.
                The terminal's 16 cells keep their width. */}
            {chosen === 'cache' && (bar !== undefined || warmLine !== undefined || meter !== undefined) && (
              <Box flexDirection="column" marginBottom={1}>
                {bar !== undefined && (
                  <Box flexDirection="row" columnGap={1}>
                    <Box flexShrink={0} width={LABEL_CELLS}>
                      <Text dimColor>◆ cache</Text>
                    </Box>
                    {Image !== undefined && image !== undefined ? (
                      <Box flexDirection="column" flexGrow={1} minWidth={8}>
                        <Image source={image.source} alt={image.alt} height={image.height} />
                      </Box>
                    ) : (
                      <Box flexShrink={0}>
                        <Text>
                          <Text dimColor>▕</Text>
                          <Text color={bar.tone}>{cacheCells(bar)}</Text>
                          <Text dimColor>▏</Text>
                        </Text>
                      </Box>
                    )}
                    <Box flexShrink={0} {...valueWidth} justifyContent="flex-start">
                      <Text color={bar.tone}>{bar.text}</Text>
                    </Box>
                  </Box>
                )}

                {bar === undefined && warmLine !== undefined && (
                  <Text dimColor wrap="truncate-end">
                    {meter !== undefined ? withoutSize(warmLine.text) : warmLine.text}
                  </Text>
                )}
                {meter !== undefined && (
                  <Box flexDirection="row" columnGap={1}>
                    <Box flexShrink={0} width={LABEL_CELLS}>
                      <Text dimColor>◆ context</Text>
                    </Box>
                    {Image !== undefined && meterImage !== undefined ? (
                      <Box flexDirection="column" flexGrow={1} minWidth={8}>
                        <Image source={meterImage.source} alt={meterImage.alt} height={meterImage.height} />
                      </Box>
                    ) : (
                      <Box flexShrink={0}>
                        <Text>
                          <Text dimColor>▕</Text>
                          <Text color={meter.tone}>{contextCells(meter)}</Text>
                          <Text dimColor>▏</Text>
                        </Text>
                      </Box>
                    )}
                    <Box flexShrink={0} {...valueWidth} justifyContent="flex-start">
                      {meter.cls === 'done' ? <Text>{meter.text}</Text> : <Text color={meter.tone}>{meter.text}</Text>}
                    </Box>
                  </Box>
                )}
                {/* No known window, so no meter: the context row keeps its
                    size, with the bar's room left empty (#287). */}
                {bar !== undefined && meter === undefined && sizeOnly !== undefined && (
                  <Box flexDirection="row" columnGap={1}>
                    <Box flexShrink={0} width={LABEL_CELLS}>
                      <Text dimColor>◆ context</Text>
                    </Box>
                    {Image !== undefined ? (
                      <Box flexGrow={1} minWidth={8} />
                    ) : (
                      <Box flexShrink={0}>
                        <Text>{' '.repeat(CACHE_CELLS + 2)}</Text>
                      </Box>
                    )}
                    <Box flexShrink={0} {...valueWidth} justifyContent="flex-start">
                      <Text>{sizeOnly}</Text>
                    </Box>
                  </Box>
                )}
                {warmLine?.nudge !== undefined && (
                  <Text color="warning" wrap="wrap">
                    {warmLine.nudge}
                  </Text>
                )}
              </Box>
            )}
            {/* The member's summary file refused, under every view: the card
                above comes from its transcript. */}
            {refusal !== undefined && (
              <Box marginBottom={1}>
                <Text dimColor wrap="truncate-end">
                  {refusal}
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    // A to-do: its checkbox (its own key), its text and, for one that names a
    // session the pane can open, Open.
    const todoRow = ({ t, i }: { t: (typeof todos)[number]; i: number }) => {
      const isTicked = crossed.has(t.id)
      return (
        <Box flexDirection="row" alignItems="flex-start" columnGap={1} paddingX={terminal ? 0 : 'md'}>
          {/* Blank and dim at rest, a tick once pressed; a second press inside
              the grace period undoes it. The blank is as wide as the tick, and
              the slot fixed, so neither the box nor the text moves when it is
              ticked. */}
          <Box width={CHECK_CELLS} flexShrink={0}>
            {isTicked ? (
              <Button key={keyFor('todo', i, t.id)} onPress={noop}>
                ✓
              </Button>
            ) : (
              <Button key={keyFor('todo', i, t.id)} dimColor onPress={noop}>
                {terminal ? UNTICKED_TERMINAL : UNTICKED}
              </Button>
            )}
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="wrap" strikethrough={isTicked} dimColor={isTicked}>
              {oneLine(t.text, MAX_TEXT)}
            </Text>
          </Box>
          {t.session !== undefined && cards.some(c => c.title === t.session && appLink(c, found.get(c.title)) !== undefined) && (
            <Box flexShrink={0}>
              <Button key={keyFor('go', i, t.id)} onPress={noop}>
                Open
              </Button>
            </Box>
          )}
        </Box>
      )
    }

    // A pull request row: on its first line the pill and the PR's title (the
    // card's own with no answer from `gh`); under both, on a dim line, the
    // card's title, the counts, the repository and the age. On Desktop and
    // mobile rows sit a small step apart with no hairline; the editor, where
    // that step is nothing, and the terminal part them as `rows` does.
    const prRow = (r: PrRow) => (
      <Box flexDirection="column" paddingX={terminal ? 0 : 'md'} paddingY={terminal ? 0 : 'sm'} marginBottom={stepped ? 'xs' : 0} {...hoverFill(`pr-${r.i}-${slug(r.number)}`)}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexShrink={0}>{pill(r.number, r.state)}</Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text weight="semibold" wrap="truncate-end">
              {r.title}
            </Text>
          </Box>
        </Box>
        <Text dimColor size="footnote" wrap="truncate-end">
          {[r.detail.cardTitle, r.detail.counts, r.detail.repo, r.detail.age].filter(x => x !== undefined).join(' · ')}
        </Text>
      </Box>
    )

    // The switch: an icon button with a tooltip on Desktop, the word in the
    // terminal; the chosen one primary. The tooltip names the view and may add
    // a count.
    const switchButton = (id: 'sessions' | 'prs', icon: string, word: string, tipText: string) =>
      tip(
        `switch-${id}`,
        view === id ? (
          <Button key={`view-${id}`} variant="primary" onPress={noop}>
            {pointer ? icon : word}
          </Button>
        ) : (
          <Button key={`view-${id}`} dimColor onPress={noop}>
            {pointer ? icon : word}
          </Button>
        ),
        tipText,
      )

    return (
      <Box flexDirection="column" flexGrow={1} minHeight={e.props.placement === 'dock' ? e.props.scroll.bodyRows : undefined}>
        {/* The top row: what the chosen view holds, on the left; the switch on
            the right. The pane's own title names the pane, and the roster's
            file is not named here. */}
        <Box flexDirection="row" columnGap={1} marginBottom={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text weight="medium" wrap="truncate-end">
              {view === 'prs' ? `${prCount} ${prCount === 1 ? 'pull request' : 'pull requests'}` : (sessionsCount ?? '')}
            </Text>
          </Box>
          {switchButton('sessions', '◫', 'Sessions', 'Sessions')}
          {switchButton('prs', '⎇', 'Pull requests', `Pull requests ${prCount}`)}
        </Box>
        {error !== '' && <Text color="error">{error}</Text>}
        {pollError !== '' && <Text color="error">{pollError}</Text>}
        {view === 'prs' ? (
          <Box flexDirection="column">
            {needsYou.length > 0 && <Text dimColor>{`${needsYou.length} waiting on you`}</Text>}
            {(
              [
                ['pr-open', prs.open],
                ['pr-merged', prs.merged],
                ['pr-closed', prs.closed],
              ] as const
            ).map(([key, list]) => (
              <Box flexDirection="column">
                {groupHead(key, list.length)}
                {!folds.has(key) && (list.length > 0 ? (stepped ? list.map(prRow) : rows(list.map(prRow), key)) : hint(key))}
              </Box>
            ))}
            {ghDown && (
              <Box marginTop={1}>
                <Text dimColor>PR details unavailable</Text>
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            {/* The status strip with its legend line, and the to-do bar. Each
                bar spans the pane: on Desktop an image in a column Box that
                grows, its text in a Box that does not shrink; on the terminal,
                cells of text. */}
            {strip !== undefined && (
              <Box flexDirection="column" marginTop={1}>
                {Image !== undefined ? (
                  <Box flexDirection="column" flexGrow={1}>
                    <Image source={strip.svg.source} alt={strip.svg.alt} height={strip.svg.height} />
                  </Box>
                ) : (
                  <Text>
                    {strip.runs.map(r => (
                      <Text color={r.color}>{r.text}</Text>
                    ))}
                  </Text>
                )}
                <Text wrap="wrap">
                  {strip.legend.map((l, i) => (
                    <Text color={l.color}>{i > 0 ? `  ${l.text}` : l.text}</Text>
                  ))}
                </Text>
              </Box>
            )}
            {progress !== undefined && (
              <Box flexDirection="row" columnGap={1} marginTop={1} alignItems="center">
                <Box flexShrink={0}>
                  <Text>To-dos</Text>
                </Box>
                {Image !== undefined ? (
                  <Box flexDirection="column" flexGrow={1} minWidth={8}>
                    <Image source={progress.svg.source} alt={progress.svg.alt} height={progress.svg.height} />
                  </Box>
                ) : (
                  <Box flexShrink={0}>
                    <Text>
                      <Text dimColor>▕</Text>
                      <Text color="success">{progress.cells}</Text>
                      <Text dimColor>▏</Text>
                    </Text>
                  </Box>
                )}
                <Box flexShrink={0}>
                  <Text dimColor>{progress.text}</Text>
                </Box>
              </Box>
            )}
            {/* The groups: a section bar with its fold arrow, name and count,
                then its cards, or a quiet hint when it is empty. Waiting on you
                holds the cards that need the owner, then the open to-dos, a
                row apart with no hairline and a row below its bar, as the
                prototype draws them. Each bar counts the reports its
                cards sent, so a fold never hides one without a sign. */}
            {groupHead('waiting', waiting, reportNote(reportCount(needsYou.flatMap(({ c }) => senders(c.title)), inbox)))}
            {!folds.has('waiting') &&
              (needsYou.length + open.length > 0 ? (
                terminal ? (
                  <Box flexDirection="column">{rows([...needsYou.map(card), ...open.map(todoRow)], 'waiting')}</Box>
                ) : (
                  <Box flexDirection="column" rowGap={1} marginTop={1}>
                    {needsYou.map(card)}
                    {open.map(todoRow)}
                  </Box>
                )
              ) : (
                hint('waiting')
              ))}
            {groupHead('working', working.length, reportNote(reportCount(working.flatMap(({ c }) => senders(c.title)), inbox)))}
            {!folds.has('working') && (working.length > 0 ? rows(working.map(card), 'working') : hint('working'))}
            {groupHead('finished', finished.length, reportNote(reportCount(finished.flatMap(({ c }) => senders(c.title)), inbox)))}
            {!folds.has('finished') && (finished.length > 0 ? rows(finished.map(card), 'finished') : hint('finished'))}
            {inbox.length === 0 && (
              <Box marginTop={1}>
                <Text dimColor>No reports since the pane opened.</Text>
              </Box>
            )}
          </Box>
        )}
        {/* A spacer takes the room left in a docked pane, so the selection bar
            and Usage sit at its foot. */}
        <Box flexGrow={1} />
        {selected > 0 && (
          <Box flexDirection="row" justifyContent="center" marginTop="md" marginBottom="sm">
            <Box flexDirection="row" alignItems="center" columnGap="md" paddingX="md" {...(terminal ? { borderStyle: 'round', borderColor: 'inactive', backgroundColor: 'subtle' } : { borderStyle: 'round', borderColor: DARK_FILLS.tip, backgroundColor: DARK_FILLS.hover })}>
              <Text>{`${selected} selected`}</Text>
              <Button key="bardismiss" plain onPress={noop}>
                ✓ Dismiss
              </Button>
              <Button key="barclear" plain dimColor onPress={noop}>
                ✕
              </Button>
            </Box>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Usage</Text>
          {metered.kind === 'none' && <Text dimColor>No reading yet: it arrives with the next reply.</Text>}
          {metered.kind === 'text' &&
            metered.rows.map(r => (
              <Box flexDirection="row" columnGap={1}>
                <Text>{r.name}</Text>
                <Text>
                  <Text dimColor>▕</Text>
                  <Text color={r.tone}>{r.bar}</Text>
                  {/* The projection's ░ cells and the blanks after them. */}
                  {r.ahead !== '' && <Text dimColor>{r.ahead}</Text>}
                  <Text dimColor>▏</Text>
                </Text>
                <Text>{r.percent}</Text>
                {/* Two branches, never dimColor={false}: Desktop refuses
                    plain={false}, so no boolean prop is passed as false. */}
                {r.noteTone === '' ? (
                  <Text dimColor wrap="truncate-end">
                    {r.note}
                  </Text>
                ) : (
                  <Text color={r.noteTone} wrap="truncate-end">
                    {r.note}
                  </Text>
                )}
              </Box>
            ))}
          {/* The image is placed in percentages: with no width prop, inside a
              column Box that grows, it spans the pane. */}
          {metered.kind === 'svg' && Svg !== undefined && (
            <Box flexDirection="column" flexGrow={1}>
              <Svg source={metered.source} alt={metered.alt} height={metered.height} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
