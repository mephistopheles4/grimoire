import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Card, Roster, Warmth } from './types'
import type { AgentRow } from './roster'
import {
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
} from './roster'

// The Brigade pane: one card per session a lead session started, with its
// work, phase, settings, live busy or idle state and latest report, and the
// owner's to-dos. The head chef writes the roster file; this pane only reads
// it, and reads it only while the pane is open.
//
// Idle by default. At session start it registers /brigade and nothing else: no
// timer, no process, no file read and no pane. The pane opens only on
// /brigade, and closing it stops every timer. A message from another session
// never opens it.

const PANE = 'brigade-native'
const TITLE = 'Brigade (native)'
const ROSTER_MS = 5000
const AGENTS_MS = 10000
const MAX_ROSTER_BYTES = 256 * 1024

// The values are the plugin's, so they sit under its manifest name.
const armed = atom({ plugin: 'brigade-native', key: 'armed' } as const, false)
const started = atom({ plugin: 'brigade-native', key: 'start' } as const, { sessionId: '', transcript: '' })
const files = atom({ plugin: 'brigade-native', key: 'files' } as const, { current: '', previous: '' })
const roster = atom({ plugin: 'brigade-native', key: 'roster' } as const, { cards: [], todos: [] })
const rosterError = atom({ plugin: 'brigade-native', key: 'rosterError' } as const, '')
const live = atom({ plugin: 'brigade-native', key: 'live' } as const, [])
const liveError = atom({ plugin: 'brigade-native', key: 'liveError' } as const, '')
const links = atom({ plugin: 'brigade-native', key: 'links' } as const, [])
const looked = atom({ plugin: 'brigade-native', key: 'looked' } as const, [])
const reports = atom({ plugin: 'brigade-native', key: 'reports' } as const, [])
const dismissed = atom({ plugin: 'brigade-native', key: 'dismissed' } as const, [])
const doneTodos = atom({ plugin: 'brigade-native', key: 'doneTodos' } as const, [])
// A ticked to-do stays, crossed out, for GRACE_MS so a mistaken tick can be
// undone with a second press; the roster timer then moves it to doneTodos.
const ticking = atom({ plugin: 'brigade-native', key: 'ticking' } as const, [])
const GRACE_MS = 30000

// Prototype: one fake session per warmth state, so each look can be seen.
const fake = (title: string, status: Card['status'], phase: string) =>
  ({ title, status, phase, work: '[fake] example card', settings: 'Opus, medium' }) as Card
const FAKE_SESSIONS: { card: Card; live: string; idleMin: number; tokens?: number }[] = [
  { card: fake('[fake] Busy build', 'working', 'building: running the tests'), live: 'busy', idleMin: 0, tokens: 140000 },
  { card: fake('[fake] Idle, cache warm', 'working', 'waiting on a background task'), live: 'idle', idleMin: 10, tokens: 80000 },
  { card: fake('[fake] Needs you, cache cooling', 'needs-you', 'spec posted, waiting for your sign-off'), live: 'idle', idleMin: 50, tokens: 180000 },
  { card: fake('[fake] Needs you, cold and large', 'needs-you', 'review report posted, waiting for your decision'), live: 'idle', idleMin: 80, tokens: 240000 },
  { card: fake('[fake] Needs you, cold but small', 'needs-you', 'asked one question'), live: 'idle', idleMin: 150, tokens: 40000 },
  { card: fake('[fake] Transcript too big to read', 'needs-you', 'waiting on you'), live: 'idle', idleMin: 30 },
]

const FAKE_TODOS = [
  { id: 'fake-1', text: '[fake] Review the lens dispositions table on issue 47.' },
  { id: 'fake-2', text: '[fake] Approve the install dry run for the QA pair; it lists 3 files to overwrite and none to delete.' },
  { id: 'fake-3', text: '[fake] Pick a tier for the docs-index work.' },
  { id: 'fake-4', text: '[fake] Reply to the prototype session about the usage colours.' },
]

// Prototype (#193): cache warmth per roster member. The cache lives for the
// window the last call wrote (1 h or 5 min) from that call, so warmth is the
// time since the transcript's last assistant row. Its usage gives the context
// size. A transcript is re-read only when its mtime moves; one over the
// 4 MiB read cap falls back to its mtime with no size.
const warmth = atom({ plugin: 'brigade-native', key: 'warmth' } as const, [])
const HOUR = 3600000
const LARGE = 100000
const seenMtime = new Map<string, number>()

function lastCall(text: string): { at: number; tokens: number; ttlMs: number } | undefined {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) continue
    try {
      const row = JSON.parse(line)
      const u = row?.message?.usage
      const at = Date.parse(row?.timestamp)
      if (u === undefined || Number.isNaN(at)) continue
      const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      const short = (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0 && (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) === 0
      return { at, tokens, ttlMs: short ? 300000 : HOUR }
    } catch {
      continue
    }
  }
  return undefined
}

async function readWarmth($: EngineInterface, config: string, rows: AgentRow[]) {
  const members = new Set((await read($, roster)).cards.map(c => c.title))
  for (const row of rows) {
    if (!members.has(row.name)) continue
    const file = transcriptFile(config, row)
    if (file === undefined) continue
    try {
      const stat = await $.fs.stat(file)
      if (seenMtime.get(row.name) === stat.mtimeMs) continue
      seenMtime.set(row.name, stat.mtimeMs)
      const call = stat.size <= 4 * 1024 * 1024 ? lastCall(String(await $.fs.read(file))) : undefined
      const w: Warmth = call === undefined ? { name: row.name, at: stat.mtimeMs, ttlMs: HOUR } : { name: row.name, ...call }
      await update($, warmth, list => [...list.filter(p => p.name !== row.name), w])
    } catch {
      // No transcript for this session kind: no warmth line.
    }
  }
}

async function sweepTicks($: EngineInterface) {
  const now = await $.clock.now()
  const due = (await read($, ticking)).filter(p => now - Number(p.value) >= GRACE_MS)
  if (due.length === 0) return
  const ids = new Set(due.map(p => p.name))
  await update($, doneTodos, list => [...list, ...ids])
  await update($, ticking, list => list.filter(p => !ids.has(p.name)))
}

// Colours are the app's own theme keys, so the pane follows the person's
// theme, light or dark, as the rest of Claude Code does.
//
// The live state: what `claude agents` says.
const liveState = (status: string | undefined) =>
  status === 'busy'
    ? { text: 'busy', color: 'success' }
    : status === 'idle'
      ? { text: 'idle', color: 'warning' }
      : { text: status ?? 'not running', color: 'inactive' }

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
  const plugin = 'grimoire-inline' // dev copy: read the real Brigade roster
  const data: string | undefined = '<CLAUDE_CONFIG>/plugins/data/grimoire-inline' // prototype: set to your Claude config folder's grimoire data folder
  if (data === undefined) {
    return {
      error: `Cannot find the plugin's data folder from where the plugin was loaded (${oneLine($.plugin.root, 200)}). The roster would be <Claude config folder>/plugins/data/${plugin}/brigade/${id}.json. Nothing was read.`,
    }
  }
  // Prototype: read the orchestrator's roster, read-only, for realistic cards.
  const rosterId = '<LEAD_SESSION_ID>' // prototype: the lead session whose roster to show
  return config === undefined ? { file: rosterFile(data, rosterId) } : { file: rosterFile(data, rosterId), config }
}

async function loadRoster($: EngineInterface) {
  const at = await where($)
  if ('error' in at) {
    await update($, rosterError, () => at.error)
    await update($, roster, () => ({ cards: [], todos: [] }))
    return
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
      return
    }
    const stat = await $.fs.stat(at.file)
    if (stat.size > MAX_ROSTER_BYTES) throw new Error(`the roster is over ${MAX_ROSTER_BYTES} bytes`)
    const checked = checkRoster(String(await $.fs.read(at.file)))
    if ('error' in checked) throw new Error(checked.error)
    // Prototype only: fake to-dos to try the tick and undo on. The roster
    // file itself is never written.
    const value: Roster = {
      cards: [...checked.value.cards, ...FAKE_SESSIONS.map(f => f.card)],
      todos: [...checked.value.todos, ...FAKE_TODOS],
    }
    await update($, roster, () => value)
    await update($, rosterError, () => '')
  } catch (err) {
    await update($, rosterError, () => `Roster not shown: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`)
  }
}

async function pollAgents($: EngineInterface) {
  // With no roster file to read there is no brigade to show, so no process
  // runs either; the pane already shows why.
  const at = await where($)
  if ('error' in at) return
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15000 })
    if (exitCode !== 0) throw new Error(oneLine(stderr, 200) || `exit ${exitCode}`)
    const rows = parseAgents(stdout)
    if ('error' in rows) throw new Error(rows.error)
    await update($, live, () => rows.value.map(r => ({ name: r.name, value: r.status })))
    await update($, liveError, () => '')

    // A Remote Control session's claude.ai link sits in its transcript, in a
    // row the engine writes. Read only a roster member's, by the id the engine
    // listed, once per session, and keep the misses too.
    if (at.config === undefined) return
    const config = at.config
    await readWarmth($, config, rows.value)
    const members = new Set((await read($, roster)).cards.filter(c => c.desktopId === undefined && c.url === undefined).map(c => c.title))
    const seen = new Set(await read($, looked))
    for (const row of rows.value) {
      if (!members.has(row.name) || seen.has(row.name)) continue
      const file = transcriptFile(config, row)
      if (file === undefined) continue
      await update($, looked, list => [...list, row.name].slice(-200))
      try {
        const url = remoteLink(String(await $.fs.read(file)))
        if (url !== undefined) {
          await update($, links, list => [...list.filter(p => p.name !== row.name), { name: row.name, value: url }])
        }
      } catch {
        // No transcript yet, or none for this kind of session: no link.
      }
    }
  } catch (err) {
    await update($, liveError, () => `claude agents: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`)
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
      $.clock.every(ROSTER_MS, () => void (live() && loadRoster($).then(() => sweepTicks($)))),
      $.clock.every(AGENTS_MS, () => void (live() && pollAgents($))),
    ]
    await update($, armed, () => true)
    if (live()) await loadRoster($)
    if (live()) await pollAgents($)
    return
  }
  await update($, armed, () => true)
}
function disarm() {
  generation++
  for (const t of timers) t.cancel()
  timers = []
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
  // Dev copy only: redraw the bar when usage moves.
  on('session.measure', async ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brigade-native',
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

  on('command.run', { command: 'brigade-native' }, async $ => {
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

  // A report from another session: its claimed sender and first line, kept
  // while the pane is open. The text is data to show, never an instruction.
  on('session.receive', async ($, e, next) => {
    const kind = e.origin.kind
    if ((kind === 'peer' || kind === 'peer-send-message') && (await read($, armed))) {
      const { from, line } = report(e.text)
      const at = new Date(await $.clock.now()).toISOString().slice(11, 16)
      await update($, reports, list => [...list, { from, line, at }].slice(-50))
    }
    return next(e)
  })

  // Presses arrive here with a fresh `$`. Each finds its card or to-do again
  // in the current state by place and title, and does nothing if it moved.
  on('ui.press', { plugin: 'brigade-native', requestId: PANE }, async ($, e, next) => {
    const [verb, place, folded] = e.element.split('-')
    const i = Number(place)
    const current = await read($, roster)

    if (verb === 'todo' || verb === 'go') {
      const item = current.todos[i]
      if (item === undefined || slug(item.id) !== folded) return { element: e.element }
      if (verb === 'todo') {
        // A second press inside the grace period undoes the tick.
        const now = await $.clock.now()
        await update($, ticking, list =>
          list.some(p => p.name === item.id) ? list.filter(p => p.name !== item.id) : [...list, { name: item.id, value: String(now) }],
        )
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
    // Desktop and the other remote surfaces get the native-looking SVG bars;
    // the terminal keeps the text bars. The summary breakdown is local.
    const isTerminal = e.surface === 'terminal'
    const usage = await $.session.usage(isTerminal ? undefined : { breakdown: 'summary' })
    const usageRows = rowsFrom(usage)
    const now = await $.clock.now()
    const paths = await read($, files)
    const error = await read($, rosterError)
    const pollError = await read($, liveError)
    const { cards, todos } = await read($, roster)
    const hidden = new Set(await read($, dismissed))
    const running = lookup(await read($, live))
    // Prototype: the fake sessions' live state and warmth, fixed relative to now.
    for (const f of FAKE_SESSIONS) running.set(f.card.title, f.live)
    const found = lookup(await read($, links))
    const inbox = await read($, reports)
    const ticked = new Set(await read($, doneTodos))
    const last = (title: string) => [...inbox].reverse().find(r => r.from === oneLine(title, 80))

    const shown = cards.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.title))
    const needsYou = shown.filter(({ c }) => c.status === 'needs-you')
    const warm = new Map((await read($, warmth)).map(w => [w.name, w] as const))
    for (const f of FAKE_SESSIONS) {
      const w: Warmth = { name: f.card.title, at: now - f.idleMin * 60000, ttlMs: HOUR }
      warm.set(f.card.title, f.tokens === undefined ? w : { ...w, tokens: f.tokens })
    }
    const crossed = new Set((await read($, ticking)).map(p => p.name))
    const open = todos.map((t, i) => ({ t, i })).filter(({ t }) => !ticked.has(t.id))
    const openCount = open.filter(({ t }) => !crossed.has(t.id)).length

    // One card, in a rounded box: the status mark, the title and its live
    // state on one line, then the work and settings, the phase and the latest
    // report, each cut to the pane's width rather than wrapped.
    const card = ({ c, i }: { c: Card; i: number }) => {
      const mark = MARK.get(c.status) ?? { mark: '?', color: 'inactive' }
      const state = liveState(running.get(c.title))
      const report = last(c.title)
      const closed = c.status === 'done' || c.status === 'stopped'
      const canOpen = appLink(c, found.get(c.title)) !== undefined
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={c.status === 'needs-you' ? 'warning' : 'inactive'}
          borderDimColor={c.status !== 'needs-you'}
          paddingX={1}
          marginBottom={1}
        >
          <Box flexDirection="row" columnGap={1}>
            <Text color={mark.color}>{mark.mark}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text bold wrap="truncate-end">
                {oneLine(c.title, 80)}
              </Text>
            </Box>
            <Text color={state.color}>{state.text}</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {warmthLine(warm.get(c.title), running.get(c.title), c, now, Box, Text)}
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

    // A section heading: bold name and a dim count, with room above it.
    const heading = (name: string, count?: number) => (
      <Box flexDirection="row" columnGap={1} marginTop={1} marginBottom={1}>
        <Text bold>{name}</Text>
        {count !== undefined && <Text dimColor>{count}</Text>}
      </Box>
    )
    const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor wrap="truncate-end">
          Roster · {paths.current === '' ? 'not named yet' : fileName(paths.current)}
          {paths.previous !== '' ? ` (before: ${fileName(paths.previous)})` : ''}
        </Text>
        {error !== '' && <Text color="error">{error}</Text>}
        {pollError !== '' && <Text color="error">{pollError}</Text>}

        {heading('Waiting on you', needsYou.length + openCount)}
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" borderDimColor paddingX={1} rowGap={1}>
          {/* Every row: a fixed two-cell gutter for its mark, top-aligned, so
              the marks line up and the text starts on one left edge. The text
              column may shrink (minWidth 0), so long lines wrap inside the box. */}
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
                  {oneLine(c.phase, 160)}
                </Text>
              </Box>
            </Box>
          ))}
          {open.map(({ t, i }) => (
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              {/* A full native button as the box: dim and empty-looking at
                  rest, a firm tick once pressed; pressing again undoes it. */}
              <Box flexShrink={0}>
                <Button key={keyFor('todo', i, t.id)} dimColor={!crossed.has(t.id)} onPress={noop}>
                  {crossed.has(t.id) ? '✓' : ' '}
                </Button>
              </Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text wrap="wrap" strikethrough={crossed.has(t.id)} dimColor={crossed.has(t.id)}>
                  {oneLine(t.text, 160)}
                </Text>
              </Box>
              {t.session !== undefined && cards.some(c => c.title === t.session && appLink(c, found.get(c.title)) !== undefined) && (
                <Button key={keyFor('go', i, t.id)} onPress={noop}>
                  Open
                </Button>
              )}
            </Box>
          ))}
          {needsYou.length + open.length === 0 && <Text dimColor>Nothing waits on you.</Text>}
        </Box>

        {heading('Sessions', shown.length)}
        {shown.map(card)}
        {shown.length === 0 && error === '' && <Text dimColor>No cards in the roster yet.</Text>}
        {inbox.length === 0 && <Text dimColor>No reports since the pane opened.</Text>}

        {isTerminal ? usageBar(usageRows, Box, Text) : usageSvg(usage, now, table)}
      </Box>
    )
  })
}


// Dev copy only: the usage and context bar at the bottom of the pane.
type UsageRow = { name: string; percent: number; note: string }
const BAR_WIDTH = 20
const LIMIT_LABEL: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend' }

function rowsFrom(usage: Awaited<ReturnType<EngineInterface['session']['usage']>>): UsageRow[] {
  const rows: UsageRow[] = []
  const ctx = usage.context
  if (ctx.percent !== undefined) {
    const note = ctx.tokens === undefined ? '' : `${Math.round(ctx.tokens / 1000)}K of ${Math.round(ctx.window / 1000)}K`
    rows.push({ name: 'Context', percent: ctx.percent, note })
  }
  for (const limit of usage.rateLimits) {
    const note = limit.resetsAt === undefined ? '' : `resets ${new Date(limit.resetsAt).toISOString().slice(11, 16)} UTC`
    rows.push({ name: LIMIT_LABEL[limit.kind] ?? limit.kind, percent: limit.percentUsed, note })
  }
  return rows
}

// Red from the owner's 90% pause line, yellow from 75%.
const barColor = (percent: number) => (percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'success')

function usageBar(rows: UsageRow[], Box: any, Text: any) {
  const cells = (percent: number) => {
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH)))
    return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Usage</Text>
      {rows.length === 0 && <Text dimColor>No reading yet: it arrives with the next reply.</Text>}
      {rows.map(r => (
        <Box flexDirection="row" columnGap={1}>
          <Text>{r.name.padEnd(7)}</Text>
          <Text color={barColor(r.percent)}>{cells(r.percent)}</Text>
          <Text>{`${r.percent}%`}</Text>
          <Text dimColor wrap="truncate-end">{r.note}</Text>
        </Box>
      ))}
    </Box>
  )
}

// Prototype (#193): one line of cache warmth, and a nudge when a large
// session has gone cold while it waits on the owner.
const mins = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`
}

function warmthLine(w: Warmth | undefined, status: string | undefined, c: Card, now: number, Box: any, Text: any) {
  if (w === undefined) return null
  const size = w.tokens === undefined ? 'size unknown' : `${kTokens(w.tokens)} context`
  if (status === 'busy') return <Text dimColor wrap="truncate-end">◆ cache warm (working) · {size}</Text>
  const idle = now - w.at
  const left = w.ttlMs - idle
  const cold = left <= 0
  const color = cold ? 'error' : left <= 15 * 60000 ? 'warning' : 'success'
  const text = cold ? `cache cold · idle ${mins(idle)} · ${size}` : `cache warm · idle ${mins(idle)} · cold in ${mins(left)} · ${size}`
  const large = (w.tokens ?? 0) >= LARGE
  return (
    <Box flexDirection="column">
      <Text color={color} wrap="truncate-end">◆ {text}</Text>
      {cold && large && c.status === 'needs-you' && (
        <Text color="warning" wrap="wrap">
          Replying re-reads about {kTokens(w.tokens ?? 0)} tokens at full price. Consider a hand-off through the issue to a fresh session.
        </Text>
      )}
      {!cold && large && c.status === 'needs-you' && left <= 15 * 60000 && (
        <Text color="warning" wrap="wrap">
          Reply within {mins(left)} to keep the cache.
        </Text>
      )}
    </Box>
  )
}

// Prototype: the Desktop look. The SVG is drawn as an isolated image, so it
// cannot read the app's CSS; it follows light and dark through its own
// prefers-color-scheme rule, which an image inherits from the page.
type Usage = Awaited<ReturnType<EngineInterface['session']['usage']>>
const W = 480
const FONT = `font-family:system-ui,-apple-system,'Segoe UI',sans-serif`

const STYLE = `
text{${FONT};font-size:12px;fill:#3d3d3a}
.muted{fill:#73726c}
.track{fill:#e8e6dc}
.ok{fill:#2c84db}.warn{fill:#c27c0e}.hot{fill:#c6413a}
.free{fill:#e8e6dc}.buffer{fill:#d6d3c8}
.c0{fill:#d97757}.c1{fill:#6a9bcc}.c2{fill:#788c5d}.c3{fill:#c46686}.c4{fill:#8b7fc7}.c5{fill:#c9a227}.c6{fill:#5fa8a0}
@media (prefers-color-scheme: dark){
text{fill:#e8e6e1}
.muted{fill:#9c9a92}
.track,.free{fill:#3a3935}.buffer{fill:#4a4944}
.ok{fill:#5aa2ef}.warn{fill:#e8a23a}.hot{fill:#ef6b62}
}`

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
const level = (p: number) => (p >= 90 ? 'hot' : p >= 75 ? 'warn' : 'ok')
const pct = (p: number) => `${Math.round(p)}%`
const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`)

function resetsIn(iso: string | undefined, now: number): string {
  if (iso === undefined) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const span = d > 0 ? `${d} d ${h} hr` : h > 0 ? `${h} hr ${m} min` : `${m} min`
  return `Resets in ${span} · `
}

const LIMIT_NAME: Record<string, string> = { five_hour: 'Current session', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }

// A label on the left, a note on the right, and a thin rounded bar beneath.
function barRow(y: number, label: string, right: string, percent: number): string {
  const fill = Math.max(0, Math.min(W, (percent / 100) * W))
  return (
    `<text x="0" y="${y + 12}">${esc(label)}</text>` +
    `<text class="muted" x="${W}" y="${y + 12}" text-anchor="end">${esc(right)}</text>` +
    `<rect class="track" x="0" y="${y + 20}" width="${W}" height="6" rx="3"/>` +
    (fill > 0 ? `<rect class="${level(percent)}" x="0" y="${y + 20}" width="${Math.max(6, fill)}" height="6" rx="3"/>` : '')
  )
}

function usageSvg(usage: Usage, now: number, table: any) {
  const { Box, Text, Svg } = table
  const parts: string[] = []
  const alt: string[] = []
  let y = 0

  for (const limit of usage.rateLimits) {
    const name = LIMIT_NAME[limit.kind] ?? limit.kind
    parts.push(barRow(y, name, `${resetsIn(limit.resetsAt, now)}${pct(limit.percentUsed)}`, limit.percentUsed))
    alt.push(`${name} ${pct(limit.percentUsed)}`)
    y += 38
  }

  const b = usage.context.breakdown
  if (b !== undefined) {
    const shown = b.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
    const total = Math.max(b.rawMaxTokens, shown.reduce((s, c) => s + c.tokens, 0))
    const used = shown.filter(c => c.kind === 'used')
    const cls = (c: (typeof shown)[number]) => (c.kind === 'free' ? 'free' : c.kind === 'buffer' ? 'buffer' : `c${used.indexOf(c) % 7}`)

    parts.push(`<text x="0" y="${y + 12}">Context</text>`)
    parts.push(`<text class="muted" x="${W}" y="${y + 12}" text-anchor="end">${esc(`${kTokens(b.totalTokens)} / ${kTokens(b.rawMaxTokens)} · ${pct(b.percentage)}`)}</text>`)
    parts.push(`<clipPath id="cb"><rect x="0" y="${y + 20}" width="${W}" height="8" rx="4"/></clipPath>`)
    parts.push(`<rect class="track" x="0" y="${y + 20}" width="${W}" height="8" rx="4"/>`)
    let x = 0
    const segs: string[] = []
    for (const c of shown) {
      const w = (c.tokens / total) * W
      // A hairline gap between used segments, as the app's segmented bar has.
      const gap = c.kind === 'used' && w > 2 ? 1 : 0
      segs.push(`<rect class="${cls(c)}" x="${x.toFixed(2)}" y="${y + 20}" width="${Math.max(0, w - gap).toFixed(2)}" height="8"/>`)
      x += w
    }
    parts.push(`<g clip-path="url(#cb)">${segs.join('')}</g>`)
    y += 40

    // The legend: two columns of dot, name and tokens.
    const col = W / 2
    shown.forEach((c, i) => {
      const cx = (i % 2) * col
      const cy = y + Math.floor(i / 2) * 18
      parts.push(`<circle class="${cls(c)}" cx="${cx + 4}" cy="${cy + 8}" r="4"/>`)
      parts.push(`<text x="${cx + 14}" y="${cy + 12}">${esc(c.name)}</text>`)
      parts.push(`<text class="muted" x="${cx + col - 10}" y="${cy + 12}" text-anchor="end">${esc(kTokens(c.tokens))}</text>`)
    })
    y += Math.ceil(shown.length / 2) * 18
    alt.push(`Context ${pct(b.percentage)}: ${shown.map(c => `${c.name} ${kTokens(c.tokens)}`).join(', ')}`)
  }

  if (y === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Usage</Text>
        <Text dimColor>No reading yet: it arrives with the next reply.</Text>
      </Box>
    )
  }

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><style>${STYLE}</style>${parts.join('')}</svg>`
  return (
    // Centred under the cards, the heading aligned with the drawing's left edge.
    <Box flexDirection="column" alignSelf="center" marginTop={2} marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold>Usage</Text>
      </Box>
      <Svg source={source} alt={alt.join('; ')} width={W} height={y} />
    </Box>
  )
}
