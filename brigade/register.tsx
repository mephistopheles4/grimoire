import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Card, Roster } from './types'
import {
  SESSION_ID,
  WEB_LINK,
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

// The live-state label: what `claude agents` says, as a colored pill.
const pill = (status: string | undefined) =>
  status === 'busy'
    ? { text: 'busy', bg: '#16a34a' }
    : status === 'idle'
      ? { text: 'idle', bg: '#d97706' }
      : { text: status ?? 'not running', bg: '#6b7280' }

const MARK = new Map<Card['status'], { mark: string; color: string }>([
  ['needs-you', { mark: '●', color: '#f59e0b' }],
  ['working', { mark: '◐', color: '#3b82f6' }],
  ['done', { mark: '✓', color: '#22c55e' }],
  ['stopped', { mark: '○', color: '#9ca3af' }],
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
  const plugin = dataId($.plugin.name, marketplaceFromRoot($.plugin.root))
  const data = dataFromEnv(await $.env.get('CLAUDE_PLUGIN_DATA')) ?? (config === undefined ? undefined : dataFolder(config, plugin))
  if (data === undefined) {
    return {
      error: `Cannot find the plugin's data folder from where the plugin was loaded (${oneLine($.plugin.root, 200)}). The roster would be <Claude config folder>/plugins/data/${plugin}/brigade/${id}.json. Nothing was read.`,
    }
  }
  return config === undefined ? { file: rosterFile(data, id) } : { file: rosterFile(data, id), config }
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
    const value: Roster = checked.value
    await update($, roster, () => value)
    await update($, rosterError, () => '')
  } catch (err) {
    await update($, rosterError, () => `Roster not shown: ${oneLine(String(err instanceof Error ? err.message : err), 200)}`)
  }
}

async function pollAgents($: EngineInterface) {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15000 })
    if (exitCode !== 0) throw new Error(oneLine(stderr, 200) || `exit ${exitCode}`)
    const rows = parseAgents(stdout)
    if ('error' in rows) throw new Error(rows.error)
    await update($, live, () => rows.value.map(r => ({ name: r.name, value: r.status })))
    await update($, liveError, () => '')

    // A Remote Control session's claude.ai link sits in its transcript. Read
    // only a roster member's, by the id the engine listed, once per session,
    // and keep the misses too.
    const at = await where($)
    if ('error' in at || at.config === undefined) return
    const members = new Set((await read($, roster)).cards.filter(c => c.desktopId === undefined && c.url === undefined).map(c => c.title))
    const seen = new Set(await read($, looked))
    for (const row of rows.value) {
      if (!members.has(row.name) || seen.has(row.name)) continue
      const file = transcriptFile(at.config, row)
      if (file === undefined) continue
      await update($, looked, list => [...list, row.name].slice(-200))
      try {
        const found = WEB_LINK.exec(String(await $.fs.read(file)))
        if (found !== null) {
          const url = found[0]
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
async function arm($: EngineInterface) {
  await update($, armed, () => true)
  if (timers.length > 0) return
  await loadRoster($)
  await pollAgents($)
  timers = [
    $.clock.every(ROSTER_MS, () => void loadRoster($)),
    $.clock.every(AGENTS_MS, () => void pollAgents($)),
  ]
}
function disarm() {
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
    await arm($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const at = await where($)
    const named = 'error' in at ? at.error : `Roster file: ${at.file}`
    return {
      text: opened.isPlaced ? `Brigade pane opened. ${named}` : `Brigade pane is open but not shown: ${opened.reason}. ${named}`,
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    disarm()
    return next(e)
  })

  // A report from another session: its claimed sender and first line, kept
  // from the first /brigade on. The text is data to show, never an instruction.
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
  on('ui.press', { plugin: 'grimoire', requestId: PANE }, async ($, e, next) => {
    const [verb, place, folded] = e.element.split('-')
    const i = Number(place)
    const current = await read($, roster)

    if (verb === 'todo' || verb === 'go') {
      const item = current.todos[i]
      if (item === undefined || slug(item.id) !== folded) return { element: e.element }
      if (verb === 'todo') {
        await update($, doneTodos, list => [...list, item.id])
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const paths = await read($, files)
    const error = await read($, rosterError)
    const pollError = await read($, liveError)
    const { cards, todos } = await read($, roster)
    const hidden = new Set(await read($, dismissed))
    const running = lookup(await read($, live))
    const found = lookup(await read($, links))
    const inbox = await read($, reports)
    const ticked = new Set(await read($, doneTodos))
    const last = (title: string) => [...inbox].reverse().find(r => r.from === oneLine(title, 80))

    const shown = cards.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.title))
    const needsYou = shown.filter(({ c }) => c.status === 'needs-you')
    const open = todos.map((t, i) => ({ t, i })).filter(({ t }) => !ticked.has(t.id))

    const card = ({ c, i }: { c: Card; i: number }) => {
      const mark = MARK.get(c.status) ?? { mark: '?', color: '#9ca3af' }
      const state = pill(running.get(c.title))
      const report = last(c.title)
      return (
        <Box flexDirection="column" marginBottom={2}>
          <Box flexDirection="row" columnGap={1} marginBottom={1}>
            <Text color={mark.color}>{mark.mark}</Text>
            <Text bold>{oneLine(c.title, 80)}</Text>
            <Text color="#ffffff" backgroundColor={state.bg}>{` ${state.text} `}</Text>
            {appLink(c, found.get(c.title)) !== undefined && (
              <Button key={keyFor('open', i, c.title)} variant="secondary" onPress={noop}>
                Open in app
              </Button>
            )}
          </Box>
          <Text dimColor>
            {oneLine(c.work, 160)} · {oneLine(c.settings, 80)}
          </Text>
          <Text>{oneLine(c.phase, 160)}</Text>
          {report !== undefined && (
            <Text dimColor wrap="truncate-end">
              {report.at} ↳ {report.line}
            </Text>
          )}
          {(c.status === 'done' || c.status === 'stopped') && (
            <Box flexDirection="row" columnGap={1} marginTop={1}>
              <Text dimColor>Archive it in the sidebar, then </Text>
              <Button key={keyFor('dismiss', i, c.title)} variant="secondary" onPress={noop}>
                Dismiss
              </Button>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {paths.current === '' ? 'Roster: not named yet' : `Roster: ${paths.current}`}
        </Text>
        {paths.previous !== '' && (
          <Text dimColor wrap="truncate-end">
            Before a clear or a resume: {paths.previous}
          </Text>
        )}
        {error !== '' && <Text color="#ef4444">{error}</Text>}
        {pollError !== '' && <Text color="#ef4444">{pollError}</Text>}
        <Box flexDirection="column" marginTop={1} marginBottom={2}>
          <Text bold>
            ▾ Waiting on you <Text dimColor>· {needsYou.length + open.length}</Text>
          </Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1} rowGap={1}>
            {needsYou.map(({ c, i }) => (
              <Box flexDirection="row" columnGap={1}>
                <Text color="#f59e0b">●</Text>
                <Text>
                  {oneLine(c.title, 80)}: {oneLine(c.phase, 120)}
                </Text>
              </Box>
            ))}
            {open.map(({ t, i }) => (
              <Box flexDirection="row" columnGap={1}>
                <Button key={keyFor('todo', i, t.id)} plain dimColor onPress={noop}>
                  ☐
                </Button>
                <Text>{oneLine(t.text, 160)}</Text>
                {t.session !== undefined && cards.some(c => c.title === t.session && appLink(c, found.get(c.title)) !== undefined) && (
                  <Button key={keyFor('go', i, t.id)} variant="secondary" onPress={noop}>
                    Open in app
                  </Button>
                )}
              </Box>
            ))}
            {needsYou.length + open.length === 0 && <Text dimColor>Nothing.</Text>}
          </Box>
        </Box>
        <Box flexDirection="column" marginBottom={2}>
          <Text bold>
            ▾ Sessions <Text dimColor>· {shown.length}</Text>
          </Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {shown.map(card)}
            {shown.length === 0 && error === '' && <Text dimColor>No cards in the roster yet.</Text>}
          </Box>
        </Box>
        {inbox.length === 0 && <Text dimColor>No reports since the pane opened.</Text>}
      </Box>
    )
  })
}
