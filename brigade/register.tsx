import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Card, Roster } from './types'
import {
  MAX_TEXT,
  SESSION_ID,
  appLink,
  checkRoster,
  configFromRoot,
  configFromTranscript,
  dataFolder,
  dataFromEnv,
  dataId,
  lookup,
  marketplaceFromRoot,
  oneLine,
  parseAgents,
  remoteLink,
  report,
  rosterFile,
  transcriptFile,
} from './roster.ts'
import {
  EMPTY_USAGE,
  idsFrom,
  liveState,
  readWarmth,
  settleTicks,
  snapshotFrom,
  ticksFrom,
  toggleTick,
  usageView,
  waitingCount,
  warmthFrom,
  warmthLine,
} from './view.ts'
import type { ReadMemory } from './view.ts'

// The Brigade pane: one card per session a lead session started, each in a
// rounded box with its work, phase, settings, live busy or idle state, cache
// warmth and latest report; the owner's to-dos in one box, each ticked with a press that
// a second press undoes; and at the bottom this session's own rate limits and
// context. The head chef writes the roster file; this pane only reads it, and
// reads it only while the pane is open. The usage section is worked out in
// view.ts, as plain values; this file reads and stores the reading and turns
// the view's result into elements.
//
// Idle by default. At session start it registers /brigade and nothing else: no
// timer, no process, no file read and no pane. The pane opens only on
// /brigade, and closing it stops every timer. A message from another session
// never opens it.

const PANE = 'brigade'
const TITLE = 'Brigade'
const ROSTER_MS = 5000
const AGENTS_MS = 10000
const MAX_ROSTER_BYTES = 256 * 1024

// The values are the plugin's, so they sit under its manifest name.
const armed = atom({ plugin: 'grimoire', key: 'armed' } as const, false)
const started = atom({ plugin: 'grimoire', key: 'start' } as const, { sessionId: '', transcript: '' })
const files = atom({ plugin: 'grimoire', key: 'files' } as const, { current: '', previous: '' })
const roster = atom({ plugin: 'grimoire', key: 'roster' } as const, { cards: [], todos: [] })
const rosterError = atom({ plugin: 'grimoire', key: 'rosterError' } as const, '')
const live = atom({ plugin: 'grimoire', key: 'live' } as const, [])
const liveError = atom({ plugin: 'grimoire', key: 'liveError' } as const, '')
const links = atom({ plugin: 'grimoire', key: 'links' } as const, [])
const looked = atom({ plugin: 'grimoire', key: 'looked' } as const, [])
const reports = atom({ plugin: 'grimoire', key: 'reports' } as const, [])
const dismissed = atom({ plugin: 'grimoire', key: 'dismissed' } as const, [])
const doneTodos = atom({ plugin: 'grimoire', key: 'doneTodos' } as const, [])
const ticking = atom({ plugin: 'grimoire', key: 'ticking' } as const, [])
const usage = atom({ plugin: 'grimoire', key: 'usage' } as const, EMPTY_USAGE)
const warmth = atom({ plugin: 'grimoire', key: 'warmth' } as const, [])

// Colours are the app's own theme keys, so the pane follows the person's
// theme, light or dark, as the rest of Claude Code does. The live state's
// colours are in view.ts.
//
// The status the head chef wrote on the card.
const MARK = new Map<Card['status'], { mark: string; color: string }>([
  ['needs-you', { mark: '●', color: 'warning' }],
  ['working', { mark: '◐', color: 'suggestion' }],
  ['done', { mark: '✓', color: 'success' }],
  ['stopped', { mark: '○', color: 'inactive' }],
])

// A button's key: the verb, the card's place, and its title folded to letters
// and digits, so a press finds the card it was drawn for or nothing.
const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40)
const keyFor = (verb: string, i: number, title: string) => `${verb}-${i}-${slug(title)}`
// A Button must carry onPress. The ui.press hook below answers every press
// itself, so this bottom of the chain never runs.
const noop = () => {}
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
// roster lives in the plugin's data folder, which the plugin's skill reaches
// as ${CLAUDE_PLUGIN_DATA}. A mod's environment does not carry that variable
// on 2.1.289, so it is read first and the folder is otherwise built by the
// plugin-manifest reference's rule: <config>/plugins/data/<id>. The config
// folder comes from where the plugin was installed, else from the transcript
// path the engine reported at this session's start; with neither, nothing is
// read. The config folder also locates other sessions' transcripts.
async function where($: EngineInterface): Promise<{ file: string; config?: string } | { error: string }> {
  const id = await $.session.id()
  if (!SESSION_ID.test(id)) return { error: 'the session id is not the engine\'s shape, so no roster file is named. Nothing was read.' }
  const start = await read($, started)
  const config =
    configFromRoot($.plugin.root) ??
    (start.sessionId === id ? configFromTranscript(start.transcript, id) : undefined)
  const plugin = dataId($.plugin.name, marketplaceFromRoot($.plugin.root))
  const data = dataFromEnv(await $.env.get('CLAUDE_PLUGIN_DATA'), plugin) ?? (config === undefined ? undefined : dataFolder(config, plugin))
  if (data === undefined) {
    return {
      error: `Cannot find the plugin's data folder from where the plugin was loaded (${oneLine($.plugin.root, 200)}). The roster would be <Claude config folder>/plugins/data/${plugin}/brigade/${id}.json. Nothing was read.`,
    }
  }
  return config === undefined ? { file: rosterFile(data, id) } : { file: rosterFile(data, id), config }
}

// Resolves the to-do ids of the roster it loaded, or undefined when it loaded
// none: no file named, no file, or a file that failed its check.
async function loadRoster($: EngineInterface): Promise<string[] | undefined> {
  const at = await where($)
  if ('error' in at) {
    await update($, rosterError, () => at.error)
    await update($, roster, () => ({ cards: [], todos: [] }))
    return undefined
  }
  // After a clear or a resume the session id changes, and so does the file:
  // name the new one and the one before it.
  await update($, files, f =>
    f.current === at.file ? f : { current: at.file, previous: f.current },
  )
  try {
    if (!(await $.fs.exists(at.file))) {
      await update($, roster, () => ({ cards: [], todos: [] }))
      await update($, rosterError, () => '')
      return undefined
    }
    const stat = await $.fs.stat(at.file)
    if (stat.size > MAX_ROSTER_BYTES) throw new Error(`the roster is over ${MAX_ROSTER_BYTES} bytes`)
    const checked = checkRoster(String(await $.fs.read(at.file)))
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
let polling = false

async function pollAgents($: EngineInterface, open: () => boolean) {
  // One poll at a time: `claude agents` may take up to 15 s and the
  // transcript reads add to that, so a tick that finds the last poll still
  // running does nothing.
  if (polling) return
  polling = true
  try {
    // With no roster file to read there is no brigade to show, so no process
    // runs either; the pane already shows why.
    const at = await where($)
    if ('error' in at) return
    try {
      const { exitCode, stdout, stderr } = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15000 })
      if (!open()) return
      if (exitCode !== 0) throw new Error(oneLine(stderr, 200) || `exit ${exitCode}`)
      const rows = parseAgents(stdout)
      if ('error' in rows) throw new Error(rows.error)
      await update($, live, () => rows.value.map(r => ({ name: r.name, value: r.status })))
      await update($, liveError, () => '')

      // Transcripts are found under the config folder: with none, no card
      // gets a warmth line or a link.
      if (at.config === undefined) {
        if (open()) await update($, warmth, () => [])
        return
      }
      const config = at.config
      const cards = (await read($, roster)).cards

      // Each roster member's cache warmth, from its transcript's last model
      // call. The rules for what is read, and when, are in view.ts.
      const found = await readWarmth(rows.value, cards.map(c => c.title), config, memory, {
        live: open,
        stat: path => $.fs.stat(path),
        read: async path => String(await $.fs.read(path)),
      })
      if (found === undefined || !open()) return
      await update($, warmth, () => found)

      // A Remote Control session's claude.ai link sits in its transcript, in a
      // row the engine writes. Read only a roster member's, by the id the engine
      // listed, once per session, and keep the misses too. The read comes
      // first and is kept only if the pane is still open, so a close during
      // it records nothing and the next open tries again.
      const members = new Set(cards.filter(c => c.desktopId === undefined && c.url === undefined).map(c => c.title))
      const seen = new Set(await read($, looked))
      for (const row of rows.value) {
        if (!members.has(row.name) || seen.has(row.name)) continue
        const file = transcriptFile(config, row)
        if (file === undefined) continue
        if (!open()) return
        // No transcript yet, or none for this kind of session: no link.
        const url = await $.fs.read(file).then(t => remoteLink(String(t)), () => undefined)
        if (!open()) return
        await update($, looked, list => [...list, row.name].slice(-200))
        if (url !== undefined && open()) {
          await update($, links, list => [...list.filter(p => p.name !== row.name), { name: row.name, value: url }])
        }
      }
    } catch (err) {
      await update($, liveError, () => `claude agents: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`)
    }
  } finally {
    polling = false
  }
}

// This session's own usage, for the section at the bottom of the pane. The
// plain reading costs nothing. The context breakdown is asked for only when
// the session draws somewhere other than the terminal, the one place the
// image shows its rows, and only as the local summary estimate, which sends
// no request. Only the fields the section draws are stored. A failed reading
// keeps the last one, and a reading that started before the pane closed is
// dropped, so it cannot land over a fresh one after a reopen.
async function readUsage($: EngineInterface) {
  const mine = generation
  try {
    const image = (await $.session.surfaces()).some(s => s !== 'terminal')
    const reading = await $.session.usage(image ? { breakdown: 'summary' } : undefined)
    if (generation === mine) await update($, usage, () => snapshotFrom(reading))
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
// queued run after the pane closed.
let generation = 0
async function arm($: EngineInterface) {
  if (timers.length === 0) {
    const mine = ++generation
    const live = () => generation === mine
    timers = [
      $.clock.every(ROSTER_MS, () => void (live() && rosterTick($, live))),
      $.clock.every(AGENTS_MS, () => void (live() && pollAgents($, live))),
    ]
    await update($, armed, () => true)
    if (live()) await readUsage($)
    if (live()) await loadRoster($)
    if (live()) await pollAgents($, live)
    return
  }
  await update($, armed, () => true)
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
    const listed = (await $.ui.panes()).some(p => p.id === PANE)
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

// The pane's Link takes https only, so the app link goes to Windows' own
// handler for claude://. Only a link of the two known shapes goes, built
// from a checked id, as one argument with no shell.
async function openInApp($: EngineInterface, c: Card) {
  const app = appLink(c, lookup(await read($, links)).get(c.title))
  if (app === undefined) return
  const { exitCode } = await $.process.run(['explorer.exe', app])
  // explorer.exe exits 1 even when it hands the link on, so say what was sent.
  $.ui.toast(`Opening ${oneLine(c.title, 40)} in the app (${exitCode})`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brigade',
      description: 'Show the Brigade pane: the sessions this lead session started',
    })
    // A reload of the module while the pane stays up finds it in the engine's
    // record. Only then do the reads start again; a fresh session has no pane.
    if ((await $.ui.panes()).some(p => p.id === PANE)) await arm($)
    return next(e)
  })

  // The engine's own record of this session: its id and transcript path, the
  // one place the config folder can be read from when the plugin's location
  // does not name it. A clear or a resume fires this again with the new id.
  on('classic.SessionStart', async ($, e, next) => {
    if (SESSION_ID.test(e.session_id) && typeof e.transcript_path === 'string') {
      await update($, started, () => ({ sessionId: e.session_id, transcript: e.transcript_path }))
    }
    return next(e)
  })

  on('command.run', { command: 'brigade' }, async $ => {
    // Open first, and start the reads only once the engine lists the pane: a
    // pane another plugin refuses or answers for starts no reads.
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if ((await $.ui.panes()).some(p => p.id === PANE)) await arm($)
    const at = await where($)
    const named = 'error' in at ? at.error : `Roster file: ${at.file}`
    return {
      text: opened.isPlaced ? `Brigade pane opened. ${named}` : `Brigade pane is open but not shown: ${opened.reason}. ${named}`,
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    disarm()
    await update($, armed, () => false)
    return next(e)
  })

  // The engine measured the session and a figure moved. Idle by default: this
  // does nothing unless this module armed the pane, which it reads from its
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
  on('ui.press', { plugin: 'grimoire', requestId: PANE }, async ($, e, next) => {
    const [verb, place, folded] = e.element.split('-')
    const i = Number(place)
    const current = await read($, roster)

    if (verb === 'todo' || verb === 'go') {
      const item = current.todos[i]
      if (item === undefined || slug(item.id) !== folded) return { element: e.element }
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
    if (c === undefined || slug(c.title) !== folded) return { element: e.element }
    if (verb === 'open') await openInApp($, c)
    if (verb === 'dismiss') await update($, dismissed, list => [...list, c.title])
    return { element: e.element }
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The terminal's table has no Svg, and a surface without one gets the
    // text bars too. The render only reads the stored reading: it fetches none.
    const Svg = 'Svg' in table ? table.Svg : undefined
    // The clock moves the warmth line too: the roster timer's redraws every
    // 5 s move its countdown.
    const now = await $.clock.now()
    const metered = usageView(await read($, usage), Svg === undefined ? 'terminal' : e.surface, now)
    const paths = await read($, files)
    const error = await read($, rosterError)
    const pollError = await read($, liveError)
    const { cards, todos } = await read($, roster)
    const hidden = new Set(await read($, dismissed))
    const running = lookup(await read($, live))
    const found = lookup(await read($, links))
    const warm = new Map(warmthFrom(await read($, warmth)).map(w => [w.name, w]))
    const inbox = await read($, reports)
    const done = idsFrom(await read($, doneTodos))
    const ticked = new Set(done)
    const ticks = await read($, ticking)
    const crossed = new Set(ticksFrom(ticks).map(p => p.name))
    const last = (title: string) => [...inbox].reverse().find(r => r.from === oneLine(title, 80))

    const shown = cards.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.title))
    const needsYou = shown.filter(({ c }) => c.status === 'needs-you')
    // A ticked to-do stays in the list, crossed out, until the sweep moves it.
    const open = todos.map((t, i) => ({ t, i })).filter(({ t }) => !ticked.has(t.id))
    const waiting = waitingCount(needsYou.length, todos, done, ticks)

    // One card, in a rounded box: amber when it needs the owner, dim
    // otherwise. The status mark, the title and its live state on one line,
    // the title cut first so the state stays in view. Then the ◆ warmth line
    // and its nudge, which wraps, the phase, the work, the settings and the
    // latest report, each on its own line and cut to the pane's width, and
    // the buttons on their own row.
    const card = ({ c, i }: { c: Card; i: number }) => {
      const mark = MARK.get(c.status) ?? { mark: '?', color: 'inactive' }
      const state = liveState(running.get(c.title))
      const warmLine = warmthLine(warm.get(c.title), running.get(c.title), c.status, now)
      const report = last(c.title)
      const closed = c.status === 'done' || c.status === 'stopped'
      const needs = c.status === 'needs-you'
      const canOpen = appLink(c, found.get(c.title)) !== undefined
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={needs ? 'warning' : 'inactive'}
          borderDimColor={!needs}
          paddingX={1}
          marginBottom={1}
        >
          <Box flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>
              <Text color={mark.color}>{mark.mark}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">
                {oneLine(c.title, 80)}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={state.color}>{state.text}</Text>
            </Box>
          </Box>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {warmLine !== undefined && (
              <Text {...(warmLine.tone === 'dim' ? { dimColor: true } : { color: warmLine.tone })} wrap="truncate-end">
                {warmLine.text}
              </Text>
            )}
            {warmLine?.nudge !== undefined && (
              <Text color="warning" wrap="wrap">
                {warmLine.nudge}
              </Text>
            )}
            <Text wrap="truncate-end">{oneLine(c.phase, 160)}</Text>
            <Text dimColor wrap="truncate-end">
              {oneLine(c.work, 160)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {oneLine(c.settings, 80)}
            </Text>
            {report !== undefined && (
              <Text dimColor wrap="truncate-end">
                {report.at} ↳ {report.line}
              </Text>
            )}
            {(canOpen || closed) && (
              <Box flexDirection="row" columnGap={2} marginTop={1}>
                {canOpen && (
                  <Button key={keyFor('open', i, c.title)} onPress={noop}>
                    Open in app
                  </Button>
                )}
                {closed && (
                  <Button key={keyFor('dismiss', i, c.title)} dimColor onPress={noop}>
                    Dismiss
                  </Button>
                )}
              </Box>
            )}
            {closed && <Text dimColor>Archive it in the sidebar when you are done with it.</Text>}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Roster</Text>
          <Text dimColor wrap="wrap">
            {paths.current === '' ? 'not named yet' : paths.current}
          </Text>
        </Box>
        {paths.previous !== '' && (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>Before</Text>
            <Text dimColor wrap="wrap">
              {paths.previous}
            </Text>
          </Box>
        )}
        {error !== '' && <Text color="error">{error}</Text>}
        {pollError !== '' && <Text color="error">{pollError}</Text>}
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Box marginBottom={1}>
            <Text bold>
              Waiting on you <Text dimColor>{waiting}</Text>
            </Text>
          </Box>
          {/* One rounded box, a line between rows. A card that needs the
              owner has a fixed two-cell gutter for its mark, top-aligned; a
              to-do has its checkbox there, a full button. The text may shrink,
              so a long line wraps inside the box. */}
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" borderDimColor paddingX={1} rowGap={1}>
            {needsYou.map(({ c }) => (
              <Box flexDirection="row" alignItems="flex-start">
                <Box width={2} flexShrink={0}>
                  <Text color="warning">●</Text>
                </Box>
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text bold wrap="truncate-end">
                    {oneLine(c.title, 80)}
                  </Text>
                  <Text dimColor wrap="wrap">
                    {oneLine(c.phase, MAX_TEXT)}
                  </Text>
                </Box>
              </Box>
            ))}
            {open.map(({ t, i }) => {
              const isTicked = crossed.has(t.id)
              return (
                <Box flexDirection="row" alignItems="flex-start" columnGap={1}>
                  {/* Blank and dim at rest, a tick once pressed; a second
                      press inside the grace period undoes it. The blank is
                      as wide as the tick, and the slot fixed, so neither the
                      box nor the text moves when it is ticked. */}
                  <Box width={CHECK_CELLS} flexShrink={0}>
                    <Button key={keyFor('todo', i, t.id)} dimColor={!isTicked} onPress={noop}>
                      {isTicked ? '✓' : e.surface === 'terminal' ? UNTICKED_TERMINAL : UNTICKED}
                    </Button>
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
            })}
            {needsYou.length + open.length === 0 && <Text dimColor>Nothing waits on you.</Text>}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>
              Sessions <Text dimColor>{shown.length}</Text>
            </Text>
          </Box>
          {shown.map(card)}
          {shown.length === 0 && error === '' && <Text dimColor>No cards in the roster yet.</Text>}
        </Box>
        {inbox.length === 0 && <Text dimColor>No reports since the pane opened.</Text>}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Usage</Text>
          {metered.kind === 'none' && <Text dimColor>No reading yet: it arrives with the next reply.</Text>}
          {metered.kind === 'text' &&
            metered.rows.map(r => (
              <Box flexDirection="row" columnGap={1}>
                <Text>{r.name}</Text>
                <Text color={r.tone}>{r.bar}</Text>
                <Text>{r.percent}</Text>
                <Text dimColor wrap="truncate-end">
                  {r.note}
                </Text>
              </Box>
            ))}
          {metered.kind === 'svg' && Svg !== undefined && (
            <Box flexDirection="column" alignItems="center">
              <Svg source={metered.source} alt={metered.alt} width={metered.width} height={metered.height} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
