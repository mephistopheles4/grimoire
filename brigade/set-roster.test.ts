// The set_roster tool, driven the way the model calls it, under the engine's
// own plugin test runner:
//
//   claude plugin test .
//
// That runner gives a plugin no file system: every `$.fs` call the mod makes
// is answered by the hooks below, which hold a small file system in memory.
// Its answers about links are not guessed. Each one is built from
// recorded-stats.ts, what the real engine answered about real junctions,
// links and hard links (scripts/record-brigade-stats.mjs records it). The
// config folder is a made-up one, reached through the transcript path the
// session start reports, as in a session; nothing here touches a real one.
//
// Each test checks what the owner and the pane would see: the file's text
// after the call, and the text the call returns.
//
// The last section presses the pane's Open in app buttons, with the engine's
// tool list, verdict, Desktop tool, processes, environment and host probes
// answered by the hooks below.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { RECORDED } from './recorded-stats.ts'

const TOOL = 'mcp__grimoire__set_roster'
const OPEN_TOOL = 'mcp__ccd_window__open_session_in'
const SID = '11111111-2222-3333-4444-555555555555'
const CONFIG = 'C:\\cfg\\.claude'
const TRANSCRIPT = `${CONFIG}\\projects\\C--work\\${SID}.jsonl`
// The data id of a plugin loaded from a folder of its own: grimoire@inline.
const DATA = `${CONFIG}\\plugins\\data\\grimoire-inline`
const BRIGADE = `${DATA}\\brigade`
const FILE = `${BRIGADE}\\${SID}.json`
const ELSEWHERE = 'C:\\elsewhere'

// --- the file system in memory ------------------------------------------------

type Node =
  | { type: 'dir' }
  | { type: 'file'; data: { text: string; mtimeMs?: number } }
  | { type: 'link'; kind: 'junction' | 'dir-symlink' | 'file-symlink'; target: string }

const spelled = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '')
const key = (p: string) => spelled(p).toLowerCase()
const parts = (p: string) => p.replace(/\//g, '\\').split('\\').filter(Boolean)

function makeFs() {
  const nodes = new Map<string, Node>()
  // Each path as it was first spelled, for a listing's names: the keys are
  // folded, as Windows folds a path.
  const spellings = new Map<string, string>()
  const log: string[] = []
  const put = (p: string, n: Node) => {
    if (!spellings.has(key(p))) spellings.set(key(p), spelled(p))
    nodes.set(key(p), n)
  }
  const dirs = (p: string) => {
    const ps = parts(p)
    for (let i = 1; i <= ps.length; i++) {
      const at = ps.slice(0, i).join('\\')
      if (!nodes.has(key(at))) put(at, { type: 'dir' })
    }
  }
  // Walks a path as the OS would: every link before the last part is
  // followed, and the last one only when asked. A missing part, or a file
  // where a folder should be, is missing (ENOENT, as recorded on Windows).
  const walk = (p: string, followLast: boolean, depth = 0): { real: string; node: Node } | undefined => {
    if (depth > 20) return undefined
    const ps = parts(p)
    let real = ps[0] ?? ''
    let node: Node = { type: 'dir' }
    for (let i = 1; i < ps.length; i++) {
      if (node.type !== 'dir') return undefined
      const next = `${real}\\${ps[i]}`
      const found = nodes.get(key(next))
      if (found === undefined) return undefined
      if (found.type === 'link' && (i < ps.length - 1 || followLast)) {
        const to = walk(found.target, true, depth + 1)
        if (to === undefined) return undefined
        real = to.real
        node = to.node
      } else {
        real = next
        node = found
      }
    }
    return { real, node }
  }
  const sizeOf = (n: Node) => (n.type === 'file' ? new TextEncoder().encode(n.data.text).length : 0)
  const mtimeOf = (n: Node) => (n.type === 'file' ? n.data.mtimeMs ?? 0 : 0)
  // What the engine answers, built from the recording.
  const stat = (p: string) => {
    const own = walk(p, false)
    if (own === undefined) return undefined
    if (own.node.type === 'link') {
      const to = walk(p, true)
      const shape = RECORDED.stats[to === undefined ? (own.node.kind === 'file-symlink' ? 'broken-file-symlink' : 'broken-junction') : own.node.kind]
      return {
        kind: shape.kind,
        size: to === undefined ? 0 : sizeOf(to.node),
        mtimeMs: to === undefined ? 0 : mtimeOf(to.node),
        isLink: shape.isLink,
        ...(shape.realPath === 'target' && to !== undefined ? { realPath: to.real } : {}),
      }
    }
    const shape = RECORDED.stats[own.node.type === 'dir' ? 'folder' : 'file']
    return { kind: shape.kind, size: sizeOf(own.node), mtimeMs: mtimeOf(own.node), isLink: shape.isLink, realPath: own.real }
  }
  // A folder's listing as the engine answers it: each entry by the name it
  // was spelled with, its kind and isLink as recorded for that kind of entry.
  const list = (p: string) => {
    const at = walk(p, true)
    if (at === undefined || at.node.type !== 'dir') return undefined
    const parent = key(at.real)
    const out: { name: string; kind: string; isLink: boolean; size: number; mtimeMs: number }[] = []
    for (const [k, n] of nodes) {
      const i = k.lastIndexOf('\\')
      if (i < 0 || k.slice(0, i) !== parent) continue
      const shape = RECORDED.list.entries[n.type === 'dir' ? 'folder' : n.type === 'file' ? 'file' : n.kind]
      out.push({ name: (spellings.get(k) ?? k).slice(i + 1), kind: shape.kind, isLink: shape.isLink, size: sizeOf(n), mtimeMs: mtimeOf(n) })
    }
    return out
  }
  // A write as the engine's: folders made as needed, and a link at the end
  // followed, a broken one creating its target.
  const write = (p: string, text: string) => {
    const ps = parts(p)
    const parent = walk(ps.slice(0, -1).join('\\'), true)
    let folder = parent?.real
    if (folder === undefined) {
      dirs(ps.slice(0, -1).join('\\'))
      folder = walk(ps.slice(0, -1).join('\\'), true)?.real ?? ps.slice(0, -1).join('\\')
    }
    const at = `${folder}\\${ps[ps.length - 1]}`
    const there = nodes.get(key(at))
    if (there?.type === 'link') return write(there.target, text)
    if (there?.type === 'file') there.data.text = text
    else put(at, { type: 'file', data: { text } })
    log.push(`write ${at} ${text.slice(0, 200)}`)
  }
  const text = (p: string) => {
    const n = walk(p, true)?.node
    return n?.type === 'file' ? n.data.text : undefined
  }
  // A file removed, as a session that ended removes its own.
  const drop = (p: string) => nodes.delete(key(p))
  return { nodes, log, put, dirs, walk, stat, list, write, text, drop }
}

const ENOENT = RECORDED.rejections.missing.replace(/^.*\) /, '')

// --- the host -----------------------------------------------------------------
//
// Spec v4 on #220, decision 1. The pane works out the host from three
// environment variables and two probe files. A world is Windows unless a test
// says otherwise, so every test above the host tests keeps its meaning.

const WINDOWS = { OS: 'Windows_NT', SystemRoot: 'C:\\Windows', windir: 'C:\\Windows' }
const MAC_PROBE = '/System/Library/CoreServices/SystemVersion.plist'
const LINUX_PROBE = '/usr/bin/xdg-open'
const PROBES = [MAC_PROBE, LINUX_PROBE]
const asProbe = (path: string) => PROBES.find(p => p === path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'))
const OPENERS = ['explorer.exe', '/usr/bin/open', '/usr/bin/xdg-open']
// A probe's answer: a stat as the engine gives it, or a rejection's message.
type Probe = { kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean; realPath?: string } | { reject: string }
const fileAt = (realPath?: string): Probe => ({ kind: 'file', size: 1, mtimeMs: 0, isLink: false, ...(realPath === undefined ? {} : { realPath }) })

type World = ReturnType<typeof makeFs> & {
  open: boolean
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }
  registered: string[]
  roster: unknown[]
  toasts: string[]
  existsCalls: string[]
  failCheck: boolean
  failRegister: boolean
  /** While the pane is open, `ui.panes` rejects. */
  failPanes: boolean
  /** While the pane is closed, `ui.panes` rejects. */
  failPanesClosed: boolean
  /** The open answers, but the engine never lists the pane. */
  unlisted: boolean
  /** The open answers that the pane is not placed. */
  unplaced: boolean
  /** How many times the pane list was asked. */
  panesCalls: number
  holdWrite: boolean
  release: () => void
  errors: string[]
  files: string[]
  clock: ReturnType<typeof mock.clock>
  sid: string
  checks: string[]
  checkInputs: unknown[]
  stall: '' | 'tool list' | 'verdict'
  surfaces: string[]
  tools: unknown
  failList: boolean
  lists: number
  mcp: (args: Record<string, unknown>) => unknown
  mcpCalls: { server: string; tool: string; args: Record<string, unknown> }[]
  procs: string[][]
  env: Record<string, string>
  failEnv: boolean
  probes: Record<string, Probe>
  probed: string[]
  inits: unknown[]
  failRun: boolean
  holdRun: boolean
  releaseRun: () => void
  order: string[]
  usage: unknown
  /** Another plugin that rewrites the pane's state as it is set, as row 15 names. */
  plant?: (key: string, value: any) => any
  /** Every value the pane set, by key, as JSON. */
  states: [string, string][]
  /** How many times the pane listed a folder other than the sessions folder,
   *  and a message to refuse those listings with. */
  listings: number
  listDeny: string
  /** Whether the pane is the shown tab, as `$.ui.panes()` says. */
  shown: boolean
  /** The usage the bottom of `turn.step` answers with, and how many session
   *  usage calls the plugins made. */
  stepUsage: unknown
  usageCalls: number
  /** A message the bottom of `turn.step` fails with after its first chunk, or ''. */
  stepFail: string
  /** While true, every `stat` waits for `releaseStat`, which lets them all go. */
  holdStat: boolean
  releaseStat: () => void
  /** The next `session.id` call is answered with the id it found, but only when `releaseId` runs. */
  holdNextId: boolean
  releaseId: () => void
  /** The next this many `session.id` calls are rejected. */
  rejectIds: number
  /** What the fake `gh` answers: its output, exit code, error text, whether
   *  the engine cut the output short, and a message to fail to start with. */
  ghOut: string
  ghExit: number
  ghErr: string
  ghCut: boolean
  ghDeny: string
  /** Every `gh` start, its argv, and what it was started with. */
  ghCalls: string[][]
  ghInits: unknown[]
  /** While true, a `gh` run waits for `releaseGh`. */
  holdGh: boolean
  releaseGh: () => void
  /** The text of every row a plugin appended to the conversation. */
  notes: string[]
  /** Where the security default is seated: a skill load raises no `skill.prompt`
   *  a user plugin sees. */
  seated: boolean
  /** How the engine answers a Skill call: run, refused, failed, or answered unsuccessful. */
  skillAnswer: 'ran' | 'deny' | 'error' | 'unsuccessful'
  /** What a head-chef load raises its `skill.prompt` with (source and plugin name). */
  loadedAs: Record<string, unknown>
  /** The test's own `$`, which raises the skill's `skill.prompt` inside a load. */
  top: any
}

// The engine beneath the plugin: the file system, the pane record, the
// session id, the verdict, and the record of what the plugin registered and
// set. Registered before the test's first call on `$`.
function world(on: On, setup: (w: World) => void = w => w.dirs(`${CONFIG}\\plugins`)): World {
  const w: World = Object.assign(makeFs(), {
    open: false,
    verdict: { decision: 'ask' as const },
    registered: [] as string[],
    roster: [] as unknown[],
    toasts: [] as string[],
    existsCalls: [] as string[],
    failCheck: false,
    failRegister: false,
    failPanes: false,
    failPanesClosed: false,
    unlisted: false,
    unplaced: false,
    panesCalls: 0,
    holdWrite: false,
    release: () => {},
    errors: [] as string[],
    files: [] as string[],
    clock: undefined as unknown as ReturnType<typeof mock.clock>,
    sid: SID,
    checks: [] as string[],
    checkInputs: [] as unknown[],
    stall: '' as World['stall'],
    surfaces: ['desktop'],
    tools: [{ name: OPEN_TOOL, description: 'Open a session', mcp: true }] as unknown,
    failList: false,
    lists: 0,
    mcp: (() => ({ value: { content: [{ type: 'text', text: 'Opened session in a split pane (pane 1) beside this one.' }], isError: false } })) as World['mcp'],
    mcpCalls: [] as World['mcpCalls'],
    procs: [] as string[][],
    env: { ...WINDOWS } as Record<string, string>,
    failEnv: false,
    probes: {} as Record<string, Probe>,
    probed: [] as string[],
    inits: [] as unknown[],
    failRun: false,
    holdRun: false,
    releaseRun: () => {},
    order: [] as string[],
    usage: undefined as unknown,
    states: [] as [string, string][],
    listings: 0,
    shown: true,
    listDeny: '',
    stepUsage: null as unknown,
    usageCalls: 0,
    stepFail: '',
    holdStat: false,
    releaseStat: () => {},
    holdNextId: false,
    releaseId: () => {},
    rejectIds: 0,
    ghOut: '[]',
    ghExit: 0,
    ghErr: '',
    ghCut: false,
    ghDeny: '',
    ghCalls: [] as string[][],
    ghInits: [] as unknown[],
    holdGh: false,
    releaseGh: () => {},
    notes: [] as string[],
    seated: false,
    skillAnswer: 'ran' as World['skillAnswer'],
    loadedAs: { source: 'plugin', pluginName: 'grimoire' } as Record<string, unknown>,
    top: undefined as any,
  })
  // The engine keeps a sessions folder; a test plants the files in it.
  w.dirs(`${CONFIG}\\sessions`)
  w.dirs(CONFIG)
  setup(w)
  w.clock = mock.clock(on)
  on('fs.stat', async ($, e: any) => {
    if (w.holdStat) await new Promise<void>(res => { const before = w.releaseStat; w.releaseStat = () => { before(); res() } })
    // The host probes are answered from `w.probes`, with the real path exactly
    // as written, before the Windows-shaped file system. On Windows the engine
    // hands the hook an absolute Unix path resolved under the current drive's
    // root (`C:\System\…`), so a probe is known by its path with the drive
    // letter dropped and its separators made `/`.
    const probe = asProbe(e.path)
    if (probe !== undefined) {
      w.probed.push(probe)
      const p = w.probes[probe]
      if (p === undefined) return { deny: ENOENT }
      if ('reject' in p) return { deny: p.reject }
      // As the engine: a real path only when the caller asked to resolve.
      return { value: e.resolve ? p : { ...p, realPath: undefined } }
    }
    w.log.push(`stat ${e.path}`)
    const s = w.stat(e.path)
    return s === undefined ? { deny: ENOENT } : { value: e.resolve ? s : { ...s, realPath: undefined } }
  })
  on('fs.write', async ($, e: any) => {
    if (w.holdWrite) await new Promise<void>(res => (w.release = res))
    w.write(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e: any) => {
    w.log.push(`read ${e.path}`)
    const t = w.text(e.path)
    return t === undefined ? { deny: ENOENT } : { value: t }
  })
  on('fs.list', ($, e: any) => {
    const sessions = String(e.path).endsWith('\\sessions')
    if (!sessions) w.listings++
    w.log.push(`list ${e.path}`)
    if (w.listDeny !== '' && !sessions) return { deny: w.listDeny }
    const l = w.list(e.path)
    return l === undefined ? { deny: ENOENT } : { value: l }
  })
  on('fs.exists', ($, e: any) => {
    w.existsCalls.push(e.path)
    return { deny: 'the mod must not ask exists' }
  })
  on('ui.open', () => {
    w.open = true
    return { value: w.unplaced ? { isPlaced: false, reason: 'the pane is too narrow' } : { isPlaced: true } }
  })
  on('ui.panes', () => {
    w.panesCalls++
    return (w.open ? w.failPanes : w.failPanesClosed)
      ? { deny: 'forced panes failure' }
      : { value: w.open && !w.unlisted ? [{ id: 'brigade', title: 'Brigade', isShown: w.shown, isFocused: false, isPlaced: !w.unplaced }] : [] }
  })
  on('ui.toast', ($, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.id', async () => {
    if (w.rejectIds > 0) {
      w.rejectIds--
      return { deny: 'forced session.id rejection' }
    }
    const found = w.sid
    if (w.holdNextId) {
      w.holdNextId = false
      await new Promise<void>(res => (w.releaseId = res))
    }
    return { value: found }
  })
  on('tool.check', ($, e: any) => {
    // The Skill tool's own permission: the owner allows it, unless a test refuses the load.
    if (e.tool === 'Skill') return { decision: 'allow' }
    w.checks.push(String(e.tool))
    w.checkInputs.push(e.input)
    if (w.stall === 'verdict') return new Promise<never>(() => {})
    if (w.failCheck) throw new Error('forced')
    return w.verdict
  })
  on('tool.register', ($, e: any) => {
    if (w.failRegister) return { deny: 'forced register failure' }
    w.registered.push(e.name)
    return { value: { tool: `mcp__grimoire__${e.name}` } }
  })
  on('state.set', ($, e: any, next: any) => {
    if (w.plant !== undefined) e = { ...e, value: w.plant(e.key, e.value) }
    w.states.push([String(e.key), JSON.stringify(e.value) ?? ''])
    if (e.key === 'roster') {
      w.roster.push(e.value)
      w.log.push(`roster ${JSON.stringify(e.value)}`)
    }
    if (e.key === 'rosterError') w.errors.push(String(e.value))
    if (e.key === 'ticking') w.log.push(`state ticking ${JSON.stringify(e.value)}`)
    if (e.key === 'files') w.files.push(String(e.value?.current ?? ''))
    return next(e)
  })
  on('classic.SessionStart', () => ({}))
  // A reload the test raises: the session's own answers for session.start and
  // the command it registers again.
  on('session.start', ($, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($, e: any) => ({ value: { command: e.name } }))
  on('classic.UserPromptSubmit', () => ({}))
  // A skill's own text is the bottom of the chain: the engine hands it on whole.
  on('skill.prompt', ($, e: any) => ({ text: e.text }))
  // A row a plugin appends: kept as the engine keeps it, its text recorded.
  on('session.append', ($, e: any, next: any) => {
    for (const block of e.message?.content ?? []) w.notes.push(String(block.text))
    return next(e)
  })
  // A skill loaded by the model's Skill call or by its typed command: the skill
  // expands inside the call, raising `skill.prompt`, unless the security
  // default is seated; a refused or failed call expands nothing.
  const expand = async (_$: any, name: string) => {
    if (w.seated) return
    await w.top.skill.prompt({ skill: name, text: SKILL_TEXT, frontmatter: {}, path: 'C:\\skills\\head-chef\\SKILL.md', ...w.loadedAs })
  }
  on('tool.call', { tool: 'Skill' }, async ($: any, e: any) => {
    if (w.skillAnswer === 'deny') return { deny: 'the owner refused the skill' }
    if (w.skillAnswer === 'error') return { ref: 'r', result: 'no such skill', text: 'no such skill', isError: true }
    if (w.skillAnswer === 'unsuccessful') return { ref: 'r', result: { success: false, commandName: e.skill }, text: 'not loaded' }
    await expand($, e.skill)
    return { ref: 'r', result: { success: true }, text: `Launching skill: ${e.skill}` }
  })
  on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
  for (const command of ['head-chef', 'grimoire:head-chef']) {
    on('command.run', { command }, async ($: any) => {
      await expand($, command)
      return { text: '' }
    })
  }
  // Where the session is drawn: the Desktop app, unless a test says otherwise.
  on('session.surfaces', () => ({ value: w.surfaces }))
  // This session's usage reading, when a test gives one; else the kit's own.
  on('session.usage', ($, e: any, next: any) => {
    w.usageCalls++
    if (w.usage === 'fail') return { deny: 'forced usage failure' }
    return w.usage === undefined ? next(e) : { value: w.usage }
  })
  // The model's side of a step and a turn end: one text block, then a stop
  // carrying `w.stepUsage`, as the engine streams it.
  on('turn.step', async function* (_$: any, e: any) {
    const usage = w.stepUsage as any
    yield { kind: 'text', index: 0, text: 'hi' }
    if (w.stepFail !== '') throw new Error(w.stepFail)
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer, usage: undefined }))
  on('tool.list', () => {
    w.lists++
    if (w.stall === 'tool list') return new Promise<never>(() => {})
    return w.failList ? { deny: 'forced list failure' } : { value: w.tools }
  })
  on('env.get', ($, e: any) => {
    if (w.failEnv) return { deny: 'forced env failure' }
    return { value: Object.hasOwn(w.env, e.name) ? w.env[e.name] : undefined }
  })
  on('mcp.call', ($, e: any) => {
    w.order.push('mcp')
    w.mcpCalls.push({ server: e.server, tool: e.tool, args: e.args })
    return w.mcp(e.args) as any
  })
  // Every process, an opener among them, is recorded, with what it was started with. An opener can be made to fail
  // to start, or to run until released.
  on('process.run', async ($, e: any) => {
    w.procs.push([...e.argv])
    w.inits.push(e.init)
    if (e.argv[0] === 'gh') {
      w.ghCalls.push([...e.argv])
      w.ghInits.push(e.init)
      if (w.holdGh) await new Promise<void>(res => { const before = w.releaseGh; w.releaseGh = () => { before(); res() } })
      if (w.ghDeny !== '') return { deny: w.ghDeny }
      return { value: { exitCode: w.ghExit, stdout: w.ghOut, stderr: w.ghErr, isStdoutTruncated: w.ghCut, isStderrTruncated: false } }
    }
    if (OPENERS.includes(e.argv[0])) {
      w.order.push(`run ${e.argv[0]}`)
      if (w.failRun) return { deny: 'spawn failed: SECRET_TOKEN=abc123' }
      // One release lets every held opener go.
      if (w.holdRun) await new Promise<void>(res => { const before = w.releaseRun; w.releaseRun = () => { before(); res() } })
    }
    return { value: { exitCode: e.argv[0] === 'explorer.exe' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

// Every tool offered, in order, but the permission warning's: every session
// offers that one at each start, and warning.test.tsx tests it. Any other
// tool offered still shows here.
const rosterOffers = (w: { registered: string[] }) => w.registered.filter(name => name !== 'show_permission_warning')
const start = ($: any) => $.classic.SessionStart({ source: 'startup', session_id: SID, transcript_path: TRANSCRIPT })
const brigade = ($: any) => $.command.run({ command: 'brigade', args: '' })
const call = async ($: any, input: Record<string, unknown>): Promise<{ ok: boolean; text: string }> => {
  const r = await $.tool.call({ tool: TOOL, ...input })
  if (typeof r.deny === 'string') return { ok: false, text: r.deny }
  if (r.isError) return { ok: false, text: String(r.text ?? r.result) }
  return { ok: true, text: String(r.text ?? r.result) }
}

// The live sessions, as the engine keeps them: one file each in the config
// folder's sessions folder, which the pane reads every poll (#347). Each file
// also holds the kinds of field the pane never reads; earlier files go.
const SESSIONS = `${CONFIG}\\sessions`
const liveRows = (w: World, rows: Record<string, unknown>[]) => {
  w.dirs(SESSIONS)
  for (const e of w.list(SESSIONS) ?? []) w.drop(`${SESSIONS}\\${e.name}`)
  rows.forEach((r, i) => {
    const text = JSON.stringify({ pid: 100 + i, kind: 'interactive', messagingSocketPath: '\\\\.\\pipe\\cc-msg-x', bridgeSessionId: 'session_X', ...r })
    w.put(`${SESSIONS}\\${100 + i}.json`, { type: 'file', data: { text } })
    w.put(`${SESSIONS}\\${100 + i}.0123abcd.key`, { type: 'file', data: { text: 'KEY' } })
  })
}

const card = (title: string, over: Record<string, unknown> = {}) => ({ title, work: 'w', phase: 'p', settings: 's', status: 'working', ...over })
// What the file holds after a call: every card stamped with the clock's answer
// at the call (0 on a clock that has not moved).
const stamped = (r: { cards: any[]; todos: unknown[] }, since = 0) => ({ ...r, cards: r.cards.map(c => ({ ...c, since })) })
const GOOD = { cards: [card('alpha'), card('beta', { status: 'needs-you' })], todos: [{ id: 't1', text: 'look' }] }

// --- writes -------------------------------------------------------------------

test('a good roster is written whole to the session-id file, and the result names the counts', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const r = await call($, GOOD)
  expect(r.ok).toBe(true)
  expect(r.text).toContain('2 card(s), 1 to-do(s)')
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(stamped(GOOD))
  expect(w.existsCalls).toEqual([])
})

test('the pane state changes only after the write', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const from = w.log.length
  await call($, GOOD)
  const after = w.log.slice(from)
  const wrote = after.findIndex(l => l.startsWith('write '))
  const shown = after.findIndex(l => l.startsWith('roster ') && l.includes('alpha'))
  expect(wrote).toBeGreaterThan(-1)
  expect(shown).toBeGreaterThan(wrote)
})

test('two calls made at once both complete, one after the other, and the file holds a whole roster', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const from = w.log.length
  const second = { cards: [card('gamma')], todos: [] }
  const [a, b] = await Promise.all([call($, GOOD), call($, second)])
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
  const after = w.log.slice(from)
  const firstWrite = after.findIndex(l => l.startsWith('write '))
  // One walk from the config folder before the first write: the second
  // call's checks wait for it.
  expect(after.slice(0, firstWrite).filter(l => l === `stat ${CONFIG}`).length).toBe(1)
  expect(after.filter(l => l.startsWith('write ')).length).toBe(2)
  expect([stamped(GOOD), stamped(second)]).toContainEqual(JSON.parse(w.text(FILE) ?? 'null'))
})

// --- the pane's lifecycle -----------------------------------------------------

test('no tool before /brigade, and the tool after it; the reply names the tool and no roster path', async ($, on) => {
  const w = world(on)
  await start($)
  expect(rosterOffers(w)).toEqual([])
  const reply = await brigade($)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  // The expected value changed in #213 (spec v3 decision 3 on #212): the
  // reply used to carry "Roster file: <path>". No skill reads that line from
  // head-chef 0.2.0 on, Desktop rendered its path without the backslash
  // before .claude. (The pane's top line showed the path until #339.)
  expect(reply.text).toBe('Brigade pane opened. `set_roster` is ready: call it with the full roster.')
  expect(reply.text).not.toContain('Roster file:')
  expect(reply.text).not.toContain(SID)
  // The pane keeps the file it was given in its `files` state; since #339 it
  // draws no path.
  await w.clock.settle()
  expect(w.files.at(-1)).toBe(FILE)
})

test('when the config folder cannot be found, the reply names no path and the pane keeps the full reason', async ($, on) => {
  const w = world(on)
  // No session start, so no transcript path names the config folder.
  const reply = await brigade($)
  await w.clock.settle()
  expect(reply.text).toBe('Brigade pane opened. The pane cannot find the roster file; the pane says why. `set_roster` is ready: call it with the full roster.')
  expect(reply.text).not.toContain('Roster file:')
  expect(reply.text).not.toContain('Cannot find')
  expect(reply.text).not.toContain('\\')
  expect(reply.text).not.toContain('plugins/data')
  const full = `Cannot find the Claude config folder from where the plugin was loaded. The roster would be <Claude config folder>/plugins/data/grimoire-inline/brigade/${SID}.json. Nothing was read.`
  expect(w.errors).toContain(full)
  // set_roster refuses with the same text after `path: `.
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toBe(`set_roster refused: path: ${full}. The roster file is unchanged.`)
})

test('when the tool cannot be offered, the reply says to keep no roster', async ($, on) => {
  const w = world(on)
  w.failRegister = true
  await start($)
  const reply = await brigade($)
  expect(reply.text).toMatch(/^Brigade pane opened\. `set_roster` could not be offered \(.+\); keep no roster\.$/)
  // The brackets carry the engine's own reason, here the forced one.
  expect(reply.text).toMatch(/could not be offered \([^)]*forced register failure\); keep no roster\.$/)
})

test('a /clear or a resume offers the tool again while the pane is open, and not while it is closed', async ($, on) => {
  const w = world(on)
  await start($)
  await $.classic.SessionStart({ source: 'clear', session_id: SID, transcript_path: TRANSCRIPT })
  expect(rosterOffers(w)).toEqual([])
  await brigade($)
  await $.classic.SessionStart({ source: 'clear', session_id: SID, transcript_path: TRANSCRIPT })
  expect(rosterOffers(w)).toEqual(['set_roster', 'set_roster'])
})

test('a call after the pane closes is refused, and nothing is written', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.open = false
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toContain('pane closed; roster not kept')
  expect(w.text(FILE)).toBeUndefined()
})

// --- input refusals -----------------------------------------------------------

const refusals: [string, Record<string, unknown>, RegExp][] = [
  ['an unknown top-level key', { ...GOOD, extra: 1 }, /shape: the roster has a field the roster does not use: extra/],
  ['an unknown card key', { cards: [{ ...card('a'), colour: 'red' }], todos: [] }, /shape: card 1 has a field/],
  ['constructor at the top level', { ...GOOD, constructor: { a: 1 } }, /shape: .*constructor/],
  ['constructor nested', { cards: [{ ...card('a'), constructor: 1 }], todos: [] }, /shape: card 1 .*constructor/],
  ['a fifth status', { cards: [card('a', { status: 'paused' })], todos: [] }, /shape: card 1 status/],
  ['a repeated title', { cards: [card('a'), card('a')], todos: [] }, /shape: card 2 repeats the title/],
  ['over 50 cards', { cards: Array.from({ length: 51 }, (_, i) => card(`c${i}`)), todos: [] }, /shape: the roster has over 50 cards/],
  ['a missing cards', { todos: [] }, /malformed input: "cards" is missing/],
  ['a missing todos', { cards: [] }, /malformed input: "todos" is missing/],
]
for (const [name, input, rule] of refusals) {
  test(`${name} is refused, the file unchanged, the rule named`, async ($, on) => {
    const w = world(on)
    await start($)
    await brigade($)
    await call($, GOOD)
    const before = w.text(FILE)
    const r = await call($, input)
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(rule)
    expect(w.text(FILE)).toBe(before)
  })
}

test('__proto__ at the top level and nested never reaches a prototype or the file', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  // Measured: on 2.1.292 the engine drops a __proto__ key, at the top level and
  // nested, before the call reaches the mod, so the call writes what is left.
  // On 2.1.302 the key reaches the mod, and the shared check refuses it by name
  // (tests/brigade-roster-rules.test.mjs holds that on the raw text). Either
  // way the key must never reach the file or a prototype, so each call is
  // judged on that and not on which of the two the engine does.
  const attempt = async (input: string, kept: string, file: unknown) => {
    const before = w.text(FILE)
    const r = await call($, JSON.parse(input))
    const after = w.text(FILE)
    if (r.ok) {
      expect(r.text).toBe(kept)
      expect(JSON.parse(after ?? 'null')).toEqual(file)
    } else {
      expect(r.text).toMatch(/has a field the roster does not use: __proto__\. The roster file is unchanged\.$/)
      expect(after).toBe(before)
    }
    // Neither the text of the file nor the objects it parses to carry the key.
    expect(after ?? '').not.toContain('__proto__')
    expect(after ?? '').not.toContain('polluted')
    return r
  }
  await attempt('{"cards":[],"todos":[],"__proto__":{"polluted":1}}', 'Roster kept: 0 card(s), 0 to-do(s).', { cards: [], todos: [] })
  await attempt('{"cards":[{"title":"a","status":"working","__proto__":{"polluted":1}}],"todos":[]}', 'Roster kept: 1 card(s), 0 to-do(s).', { cards: [{ title: 'a', work: '', phase: '', settings: '', status: 'working' }], todos: [] })
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

test('a roster over the byte cap is refused by size, the file unchanged', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  // 50 cards and 50 to-dos with every field at its cap, in four-byte
  // characters, pass the shape check and come to over 256 KiB.
  const wide = (n: number) => '\u{1F600}'.repeat(n)
  const big = {
    cards: Array.from({ length: 50 }, (_, i) =>
      card(`${i}${wide(78)}`, { work: wide(300), phase: wide(300), settings: wide(300), desktopId: wide(100), bgId: wide(100), url: wide(100) }),
    ),
    todos: Array.from({ length: 50 }, (_, i) => ({ id: `${i}${wide(38)}`, text: wide(300), session: wide(80) })),
  }
  const r = await call($, big)
  expect(r.ok).toBe(false)
  expect(r.text).toMatch(/size: the roster is \d+ bytes, over the cap/)
  expect(w.text(FILE)).toBeUndefined()
})

// --- the caller and the owner's rules -----------------------------------------

test("a subagent's call is refused, and nothing is written", async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const r = await call($, { ...GOOD, agentId: 'a-subagent' })
  expect(r.ok).toBe(false)
  expect(r.text).toContain('subagent: ')
  expect(w.text(FILE)).toBeUndefined()
})

test('a deny verdict is refused with its reason, and nothing is written', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.verdict = { decision: 'deny', reason: 'managed policy says no' }
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toContain('deny verdict: managed policy says no')
  expect(w.text(FILE)).toBeUndefined()
})

test("an ask verdict that names a rule is refused; one that names none is a mode's and passes", async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.verdict = { decision: 'ask', rule: TOOL }
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toContain(`ask rule: the owner's rule ${TOOL} covers this tool`)
  expect(w.text(FILE)).toBeUndefined()
  w.verdict = { decision: 'ask' }
  expect((await call($, GOOD)).ok).toBe(true)
})

test("set_roster keeps the roster in every permission mode: plan mode's ask naming no rule, and after a prompt that reported don't-ask", async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  // As plan mode gives it: an ask that names no rule, its reason naming the mode.
  w.verdict = { decision: 'ask', reason: 'plan mode asks before this tool' }
  const plan = await call($, GOOD)
  expect(plan.ok).toBe(true)
  expect(plan.text).toMatch(/^Roster kept: /)
  expect(w.text(FILE)).toBeDefined()
  w.verdict = { decision: 'allow' }
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'dontAsk' } as any)
  const other = { cards: [card('gamma')], todos: [] }
  const r = await call($, other)
  expect(r.ok).toBe(true)
  expect(r.text).toMatch(/^Roster kept: 1 card\(s\)/)
  expect(w.text(FILE)).toContain('gamma')
})

test('a forced error inside the tool comes back as a refusal, and nothing is written', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.failCheck = true
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  // The code's own catch names the failing call; the engine's .catch could not.
  expect(r.text).toMatch(/^set_roster refused: error: .*tool\.check/)
  expect(w.text(FILE)).toBeUndefined()
})

test("a call that outlasts the hook's budget is answered by the engine's .catch, and writes nothing when its turn comes", { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.holdWrite = true
  // The first call's write is held, so the second waits in the queue until
  // its budget runs out and the engine's .catch answers it.
  const first = call($, GOOD)
  const r = await call($, { cards: [card('gamma')], todos: [] })
  expect(r.ok).toBe(false)
  expect(r.text).toBe('set_roster refused: error: the tool failed or ran out of time. The roster may or may not have been kept; stop keeping the roster and tell the owner.')
  expect(r.text).not.toContain('once more')
  // Then the first write goes through, the queue moves on, and the abandoned
  // second call writes nothing.
  w.holdWrite = false
  w.release()
  await first
  await w.clock.settle()
  expect(w.log.filter(l => l.startsWith('write ') && l.includes('gamma'))).toEqual([])
})

// --- the path guard -----------------------------------------------------------

const linkCases: [string, (w: World) => void, string][] = [
  ['a junction at plugins', w => { w.dirs(`${ELSEWHERE}\\plugins`); w.put(`${CONFIG}\\plugins`, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\plugins` }) }, 'link: plugins is a link'],
  ['a junction at data', w => { w.dirs(`${CONFIG}\\plugins`); w.dirs(`${ELSEWHERE}\\data`); w.put(`${CONFIG}\\plugins\\data`, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\data` }) }, 'link: data is a link'],
  ['a junction at the data id', w => { w.dirs(`${CONFIG}\\plugins\\data`); w.dirs(`${ELSEWHERE}\\id`); w.put(DATA, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\id` }) }, 'link: grimoire-inline is a link'],
  ['a junction at brigade', w => { w.dirs(DATA); w.dirs(`${ELSEWHERE}\\b`); w.put(BRIGADE, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\b` }) }, 'link: brigade is a link'],
  ['a broken junction at brigade', w => { w.dirs(DATA); w.put(BRIGADE, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\gone` }) }, 'link: brigade is a link'],
  ['a directory symlink at brigade', w => { w.dirs(DATA); w.dirs(`${ELSEWHERE}\\b`); w.put(BRIGADE, { type: 'link', kind: 'dir-symlink', target: `${ELSEWHERE}\\b` }) }, 'link: brigade is a link'],
  ['a symlink at the roster file', w => { w.dirs(BRIGADE); w.dirs(ELSEWHERE); w.put(`${ELSEWHERE}\\settings.json`, { type: 'file', data: { text: '{"permissions":{}}' } }); w.put(FILE, { type: 'link', kind: 'file-symlink', target: `${ELSEWHERE}\\settings.json` }) }, 'link: the roster file is a link'],
  ['a broken symlink at the roster file', w => { w.dirs(BRIGADE); w.dirs(ELSEWHERE); w.put(FILE, { type: 'link', kind: 'file-symlink', target: `${ELSEWHERE}\\made.json` }) }, 'link: the roster file is a link'],
  ['a file where the brigade folder should be', w => { w.dirs(DATA); w.put(BRIGADE, { type: 'file', data: { text: 'x' } }) }, 'path: brigade is not a folder'],
  ['a folder where the roster file should be', w => { w.dirs(FILE) }, 'path: the roster path is not a plain file'],
]
for (const [name, setup, rule] of linkCases) {
  test(`${name} is refused, and nothing is created at any link target`, async ($, on) => {
    const w = world(on, setup)
    await start($)
    await brigade($)
    const before = [...w.nodes.keys()].sort()
    const r = await call($, GOOD)
    expect(r.ok).toBe(false)
    expect(r.text).toContain(rule)
    expect([...w.nodes.keys()].sort()).toEqual(before)
    expect(w.log.filter(l => l.startsWith('write '))).toEqual([])
    expect(w.text(`${ELSEWHERE}\\settings.json`) ?? '{"permissions":{}}').toBe('{"permissions":{}}')
  })
}

for (const [name, text] of [
  ['a file that is not a roster', 'not json at all, a secret'],
  ['a file holding {} (a hard link to another file)', '{}'],
  // Valid JSON whose check error would quote its key, if the refusal echoed it.
  ['a JSON file with a key of its own', '{"cards":[],"todos":[],"secret":"the owner\'s note"}'],
] as const) {
  test(`${name} at the roster path is refused, left unchanged, and not echoed`, async ($, on) => {
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text } })
    })
    await start($)
    await brigade($)
    const r = await call($, GOOD)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('not a roster: ')
    expect(r.text).toContain('Ask the owner to delete that file')
    expect(r.text).not.toContain('secret')
    expect(w.text(FILE)).toBe(text)
  })
}

test('an existing roster is overwritten', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: '{"cards":[],"todos":[]}' } })
  })
  await start($)
  await brigade($)
  expect((await call($, GOOD)).ok).toBe(true)
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(stamped(GOOD))
})

// The write lands, then the file or a folder above it is swapped for a link
// before the check after it.
for (const [name, swap, rule] of [
  ['the file', (w: World) => { w.dirs(ELSEWHERE); w.put(FILE, { type: 'link', kind: 'file-symlink', target: `${ELSEWHERE}\\x.json` }) }, 'link: the roster file is a link'],
  ['the brigade folder', (w: World) => { w.dirs(`${ELSEWHERE}\\b`); w.put(BRIGADE, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\b` }) }, 'link: brigade is a link'],
] as const) {
  test(`${name} becoming a link after the write is told to the owner loudly`, async ($, on) => {
    const w = world(on)
    await start($)
    await brigade($)
    const write = w.write
    w.write = (p, t) => {
      write(p, t)
      swap(w)
    }
    const r = await call($, GOOD)
    expect(r.ok).toBe(false)
    expect(r.text).toContain(`set_roster failed after the write began: the path then failed its check (${rule})`)
    expect(r.text).toContain('may or may not have been kept')
    expect(w.toasts.some(t => t.includes(rule))).toBe(true)
    expect(w.errors.some(e => e.includes(rule))).toBe(true)
  })
}

test("the pane's own read refuses a roster path through a link, and says so", async ($, on) => {
  const w = world(on, w => {
    w.dirs(DATA)
    w.dirs(`${ELSEWHERE}\\b`)
    w.put(`${ELSEWHERE}\\b\\${SID}.json`, { type: 'file', data: { text: JSON.stringify(GOOD) } })
    w.put(BRIGADE, { type: 'link', kind: 'junction', target: `${ELSEWHERE}\\b` })
  })
  await start($)
  await brigade($)
  expect(w.errors.some(e => e.includes('link: brigade is a link; the roster path must not pass through a link or junction'))).toBe(true)
  // Nothing was read through the link into the pane.
  expect(w.roster.some(r => JSON.stringify(r).includes('alpha'))).toBe(false)
})

test('a reload with the pane open offers the tool again; one with the pane closed does not', async ($, on) => {
  const w = world(on)
  await start($)
  await ($ as any).session.start({ cwd: 'C:\\work', surface: null, isInteractive: false })
  expect(rosterOffers(w)).toEqual([])
  await brigade($)
  await ($ as any).session.start({ cwd: 'C:\\work', surface: null, isInteractive: false })
  expect(rosterOffers(w)).toEqual(['set_roster', 'set_roster'])
})

test('a session id outside the engine\'s shape is refused', async ($, on) => {
  const w = world(on, w => {
    w.dirs(`${CONFIG}\\plugins`)
    w.sid = 'not-an-id'
  })
  await start($)
  await brigade($)
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toMatch(/path: .*session id/)
  expect(w.log.filter(l => l.startsWith('write '))).toEqual([])
})

// --- data folders -------------------------------------------------------------

test('with data absent the first write creates the missing folders and brigade', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  expect((await call($, GOOD)).ok).toBe(true)
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(stamped(GOOD))
})

test('with the data id absent the first write creates it and brigade', async ($, on) => {
  const w = world(on, w => w.dirs(`${CONFIG}\\plugins\\data`))
  await start($)
  await brigade($)
  expect((await call($, GOOD)).ok).toBe(true)
  expect(w.text(FILE)).toBeDefined()
})

test('with plugins absent the call is refused', async ($, on) => {
  const w = world(on, () => {})
  await start($)
  await brigade($)
  const r = await call($, GOOD)
  expect(r.ok).toBe(false)
  expect(r.text).toContain('path: the config folder has no plugins folder')
  expect(w.log.filter(l => l.startsWith('write '))).toEqual([])
})

// --- Open in app --------------------------------------------------------------
//
// Spec v3 on #212, decision 5. A press is raised as the engine raises it, on
// the pane's button key: `open-<index>-<slug>` for a card, `go-<index>-<slug>`
// for a to-do's Open. The pane loads the seeded roster on /brigade. The
// pane runs no process of its own, so every process these tests see is an
// opener. The world is Windows, so the opener is
// explorer.exe; the host tests at the end change the host.

const DESKTOP = 'local_0123abcd-4567-89ab-cdef-0123456789ab'
const SEEDED = {
  cards: [
    card('alpha', { desktopId: DESKTOP }),
    card('beta', { url: 'https://claude.ai/code/session_ABC123' }),
    card('gamma', { bgId: 'ab12cd34' }),
    card('delta', { desktopId: 'local_NOT-HEX' }),
  ],
  todos: [{ id: 't1', text: 'look', session: 'alpha' }],
}
const LINK = `claude://claude.ai/epitaxy/${DESKTOP}`

// The pane drawn on the desktop, so a press reaches a Button it drew.
const PANE_PROPS = { title: 'Brigade', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} }
let mounted: any
async function pane(on: On, $: any, surface: 'terminal' | 'desktop' = 'desktop', setup: (w: World) => void = () => {}) {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(SEEDED) } })
    setup(w)
  })
  await start($)
  await brigade($)
  await w.clock.settle()
  mounted = await $.ui.mount({ plugin: 'grimoire', surface, component: 'Pane', requestId: 'brigade', props: PANE_PROPS })
  return w
}
const press = (_$: any, key: string) => mounted.press({ key })
const explorer = (w: World) => w.procs.filter(p => p[0] === 'explorer.exe')
const answer = (text: unknown, isError: unknown = false, type = 'text') => ({ value: { content: [{ type, text }], isError } })

test('a press on a Desktop card asks the app to show it in a split, with that id and nothing else, and runs no explorer.exe', async ($, on) => {
  const w = await pane(on, $)
  w.mcp = () => answer('Opened session local_x in a split pane (pane 1) beside this one.\nSecond line.')
  await press($, 'open-0-alpha')
  expect(w.mcpCalls).toEqual([{ server: 'ccd_window', tool: 'open_session_in', args: { session_id: DESKTOP, target: 'split' } }])
  expect(w.checks).toEqual([OPEN_TOOL])
  // The verdict is asked about the call as it will be made.
  expect(w.checkInputs).toEqual([{ session_id: DESKTOP, target: 'split' }])
  expect(explorer(w)).toEqual([])
  expect(w.toasts.at(-1)).toBe('Opened session local_x in a split pane (pane 1) beside this one.')
})

test("a to-do's Open takes the same route as its card", async ($, on) => {
  const w = await pane(on, $)
  await press($, 'go-0-t1')
  expect(w.mcpCalls.map(c => c.args)).toEqual([{ session_id: DESKTOP, target: 'split' }])
  expect(explorer(w)).toEqual([])
  w.mcp = () => answer('was not started from this session', true)
  await press($, 'go-0-t1')
  expect(explorer(w)).toEqual([['explorer.exe', LINK]])
})

for (const [name, tools] of [
  ['no tool at all, as in the terminal', []],
  ['a near name', [{ name: 'mcp__ccd_window__open_session_in_v2', description: '', mcp: true }]],
  ['the name with a space for the underscore', [{ name: 'mcp__ccd window__open_session_in', description: '', mcp: true }]],
  ['a list that is not a list', { name: OPEN_TOOL }],
] as const) {
  test(`a tool list with ${name} asks no verdict, makes no call and takes the link route`, async ($, on) => {
    const w = await pane(on, $)
    w.tools = tools
    await press($, 'open-0-alpha')
    expect(w.checks).toEqual([])
    expect(w.mcpCalls).toEqual([])
    expect(explorer(w)).toEqual([['explorer.exe', LINK]])
    expect(w.toasts.at(-1)).toBe('Opening alpha in the app (1)')
  })
}

test('a rejected tool list, verdict or call each takes the link route, and none throws out of the press', async ($, on) => {
  const w = await pane(on, $)
  w.failList = true
  await press($, 'open-0-alpha')
  expect(w.checks).toEqual([])
  w.failList = false
  w.failCheck = true
  await press($, 'open-0-alpha')
  expect(w.checks).toEqual([OPEN_TOOL])
  expect(w.mcpCalls).toEqual([])
  w.failCheck = false
  w.mcp = () => ({ deny: 'no such server' })
  await press($, 'open-0-alpha')
  expect(w.mcpCalls.length).toBe(1)
  expect(explorer(w)).toEqual([['explorer.exe', LINK], ['explorer.exe', LINK], ['explorer.exe', LINK]])
})

test("a deny and an ask naming a rule each skip the call; an ask naming none is a mode's and calls", async ($, on) => {
  const w = await pane(on, $)
  w.verdict = { decision: 'deny', reason: 'the owner denies it' }
  await press($, 'open-0-alpha')
  w.verdict = { decision: 'ask', rule: 'mcp__ccd_window' }
  await press($, 'open-0-alpha')
  expect(w.mcpCalls).toEqual([])
  expect(explorer(w).length).toBe(2)
  w.verdict = { decision: 'ask' }
  await press($, 'open-0-alpha')
  expect(w.mcpCalls.length).toBe(1)
  expect(explorer(w).length).toBe(2)
})

test("the app's refusal takes the link route, and the toast says the app did not open it, in its words, cleaned", async ($, on) => {
  const w = await pane(on, $)
  w.mcp = () => answer('local_x was not started from this session\u{202E}, and this tool only arranges this session.\nMore.', true)
  await press($, 'open-0-alpha')
  expect(explorer(w)).toEqual([['explorer.exe', LINK]])
  expect(w.toasts.slice(-2)).toEqual([
    'The app did not open it: local_x was not started from this session, and this tool only arranges this session.',
    'Opening alpha in the app (1)',
  ])
})

// Spec v3, Testing Decisions: one expected outcome for each untrusted answer.
for (const [name, value, outcome] of [
  ['isError absent', { content: [{ type: 'text', text: 'ok' }] }, 'link'],
  ['isError a string', { content: [{ type: 'text', text: 'ok' }], isError: 'false' }, 'link'],
  ['content not a list', { content: 'ok', isError: false }, 'link'],
  ['isError false with an empty list', { content: [], isError: false }, 'fixed'],
  ['isError false with a first block not of type text', { content: [{ type: 'image', data: '', mimeType: 'image/png' }], isError: false }, 'fixed'],
  ['isError false with a text block whose text is not a string', { content: [{ type: 'text', text: 7 }], isError: false }, 'fixed'],
  ['isError true with no text block', { content: [], isError: true }, 'link'],
] as const) {
  test(`an answer with ${name} ${outcome === 'link' ? 'takes the link route' : 'toasts the fixed line'}, and nothing throws`, async ($, on) => {
    const w = await pane(on, $)
    w.mcp = () => ({ value })
    await press($, 'open-0-alpha')
    if (outcome === 'link') {
      expect(explorer(w)).toEqual([['explorer.exe', LINK]])
      expect(w.toasts.some(t => t.startsWith('The app did not open it'))).toBe(false)
    } else {
      expect(explorer(w)).toEqual([])
      expect(w.toasts.at(-1)).toBe('Opened in the app.')
    }
  })
}

test('tool text with controls, bidi marks or a long line reaches the toast cleaned and cut to 200 characters', async ($, on) => {
  const w = await pane(on, $)
  w.mcp = () => answer(`\u{1B}[31mOpened\u{7}\u{200B} \u{2066}split\u{2069}\t${'x'.repeat(400)}`)
  await press($, 'open-0-alpha')
  const shown = w.toasts.at(-1) ?? ''
  expect(shown.startsWith('[31mOpened split xxx')).toBe(true)
  expect([...shown].length).toBe(200)
  expect(shown.endsWith('…')).toBe(true)
  expect(/[\u{0}-\u{1F}\u{7F}-\u{9F}\u{200B}\u{2066}\u{2069}]/u.test(shown)).toBe(false)
})

test('a call not answered within 5 seconds of the engine clock takes the link route', async ($, on) => {
  const w = await pane(on, $)
  let answerLate: (v: unknown) => void = () => {}
  w.mcp = () => new Promise(res => (answerLate = res))
  const pressed = press($, 'open-0-alpha')
  await w.clock.advance(4999)
  expect(explorer(w)).toEqual([])
  await w.clock.advance(1)
  await pressed
  expect(explorer(w)).toEqual([['explorer.exe', LINK]])
  // The answer that comes after the fallback is dropped, unread.
  answerLate(answer('Opened late'))
  await w.clock.settle()
  expect(w.toasts.includes('Opened late')).toBe(false)
})

test('a second press on the same card while the first waits makes no second call; after it ends, a press calls again', async ($, on) => {
  const w = await pane(on, $)
  let release: (v: unknown) => void = () => {}
  w.mcp = () => new Promise(res => (release = res))
  const first = press($, 'open-0-alpha')
  await w.clock.settle()
  await press($, 'open-0-alpha')
  await press($, 'go-0-t1')
  expect(w.mcpCalls.length).toBe(1)
  expect(explorer(w)).toEqual([])
  release(answer('Opened'))
  await first
  w.mcp = () => answer('Opened again')
  await press($, 'open-0-alpha')
  expect(w.mcpCalls.length).toBe(2)
  expect(w.toasts.at(-1)).toBe('Opened again')
})

test('a to-do tick still works while an Open in app press waits for the app', async ($, on) => {
  const w = await pane(on, $)
  let release: (v: unknown) => void = () => {}
  w.mcp = () => new Promise(res => (release = res))
  const first = press($, 'open-0-alpha')
  await w.clock.settle()
  await press($, 'todo-0-t1')
  // The tick lands on the to-do pressed, while the first press still waits.
  expect(w.log.filter(l => l.startsWith('state ticking')).at(-1)).toContain('"t1"')
  expect(w.mcpCalls.length).toBe(1)
  expect(explorer(w)).toEqual([])
  release(answer('Opened'))
  await first
})

test('a card with only a url, or only a background id, makes no tool list and no call', async ($, on) => {
  // The background card's Remote Control link comes from its transcript, as
  // the pane's poll finds it, so its button is drawn too.
  const BG = '99999999-8888-7777-6666-555555555555'
  const w = await pane(on, $)
  liveRows(w, [{ name: 'gamma', status: 'idle', sessionId: BG, cwd: 'C:\\work', jobId: 'ab12cd34' }])
  w.put(`${CONFIG}\\projects\\C--work\\${BG}.jsonl`, {
    type: 'file',
    data: { text: JSON.stringify({ type: 'system', subtype: 'bridge_status', url: 'https://claude.ai/code/session_BG1' }) },
  })
  w.dirs(`${CONFIG}\\projects\\C--work`)
  await w.clock.advance(10000)
  await press($, 'open-1-beta')
  await press($, 'open-2-gamma')
  expect(w.lists).toBe(0)
  expect(w.mcpCalls).toEqual([])
  expect(explorer(w)).toEqual([
    ['explorer.exe', 'claude://claude.ai/code/session_ABC123'],
    ['explorer.exe', 'claude://claude.ai/code/session_BG1'],
  ])
})

// No press can reach either call for such a card, since its button is never
// drawn; the shape rule itself is held in tests/brigade-roster-rules.test.mjs.
test('a Desktop id outside the local_ shape draws no Open in app', async ($, on) => {
  await pane(on, $)
  expect(await mounted.find({ key: 'open-0-alpha' })).toBeDefined()
  expect(await mounted.find({ key: 'open-3-delta' })).toBeUndefined()
})
// The 5-second wait covers the whole tool route, the tool list and the
// verdict included, so a question that never comes back cannot hold the
// one-press mark.
for (const stalled of ['tool list', 'verdict'] as const) {
  test(`a ${stalled} that never answers takes the link route at 5 seconds, and the next press tries again`, async ($, on) => {
    const w = await pane(on, $)
    w.stall = stalled
    const pressed = press($, 'open-0-alpha')
    await w.clock.advance(4999)
    expect(explorer(w)).toEqual([])
    await w.clock.advance(1)
    await pressed
    expect(explorer(w)).toEqual([['explorer.exe', LINK]])
    expect(w.mcpCalls).toEqual([])
    const before = w.lists
    const again = press($, 'open-0-alpha')
    await w.clock.advance(5000)
    await again
    expect(w.lists).toBe(before + 1)
    expect(explorer(w).length).toBe(2)
  })
}
// Only where the Desktop app draws the session: in the terminal its server is
// absent, so a server of the same name would be the only one to answer.
for (const surfaces of [['terminal'], ['terminal', 'mobile'], []]) {
  test(`a session drawn on ${JSON.stringify(surfaces)} asks no tool list, makes no call and takes the link route`, async ($, on) => {
    const w = await pane(on, $)
    w.surfaces = surfaces
    w.verdict = { decision: 'allow' }
    await press($, 'open-0-alpha')
    expect(w.lists).toBe(0)
    expect(w.checks).toEqual([])
    expect(w.mcpCalls).toEqual([])
    expect(explorer(w)).toEqual([['explorer.exe', LINK]])
  })
}
// --- Open in app by host ------------------------------------------------------
//
// Spec v4 on #220, decisions 1, 6 and 9. The link route's program follows the
// host the pane works out on each press; a host it cannot prove runs nothing.

const BG_ID = '99999999-8888-7777-6666-555555555555'
const BG_LINK = 'claude://claude.ai/code/session_BG1'
const NO_OPENER = 'Open in app has no opener on this system.'
const openers = (w: World) => w.procs.filter(p => OPENERS.includes(p[0]))

// The pane, with a background card whose Remote Control link the pane's poll
// finds in its transcript, as a head chef's `claude --bg` session has.
async function background(on: On, $: any) {
  const w = await pane(on, $)
  liveRows(w, [{ name: 'gamma', status: 'idle', sessionId: BG_ID, cwd: 'C:\\work', jobId: 'ab12cd34' }])
  w.put(`${CONFIG}\\projects\\C--work\\${BG_ID}.jsonl`, {
    type: 'file',
    data: { text: JSON.stringify({ type: 'system', subtype: 'bridge_status', url: 'https://claude.ai/code/session_BG1' }) },
  })
  w.dirs(`${CONFIG}\\projects\\C--work`)
  await w.clock.advance(10000)
  return w
}
const macos = (w: World) => {
  w.env = {}
  w.probes = { [MAC_PROBE]: fileAt(MAC_PROBE) }
}
// The macOS probe file is missing, so it rejects with ENOENT.
const linux = (w: World) => {
  w.env = {}
  w.probes = { [LINUX_PROBE]: fileAt(LINUX_PROBE) }
}

test('on macOS, a press on a background card with a Remote Control link runs /usr/bin/open with that link and nothing else', async ($, on) => {
  const w = await background(on, $)
  macos(w)
  await press($, 'open-2-gamma')
  expect(openers(w)).toEqual([['/usr/bin/open', BG_LINK]])
  // Nothing else: the pane runs no other process.
  expect(w.procs).toEqual([['/usr/bin/open', BG_LINK]])
  expect(w.probed).toEqual([MAC_PROBE])
  expect(w.toasts.at(-1)).toBe('Opening gamma in the app (0)')
})

test('on Linux, the macOS probe is missing (ENOENT), the Linux probe runs, and the press runs /usr/bin/xdg-open', async ($, on) => {
  const w = await background(on, $)
  linux(w)
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([MAC_PROBE, LINUX_PROBE])
  expect(openers(w)).toEqual([['/usr/bin/xdg-open', BG_LINK]])
  expect(w.toasts.at(-1)).toBe('Opening gamma in the app (0)')
})

test('on a system the pane cannot identify, a press runs nothing and says there is no opener', async ($, on) => {
  const w = await background(on, $)
  w.env = {}
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([MAC_PROBE, LINUX_PROBE])
  expect(openers(w)).toEqual([])
  expect(w.toasts.at(-1)).toBe(NO_OPENER)
})

test('on Windows, planted probe files are never looked at, and the press runs explorer.exe', async ($, on) => {
  const w = await background(on, $)
  w.probes = { [MAC_PROBE]: fileAt(MAC_PROBE), [LINUX_PROBE]: fileAt(LINUX_PROBE) }
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([])
  expect(openers(w)).toEqual([['explorer.exe', BG_LINK]])
})

for (const env of [{ SystemRoot: 'C:\\Windows' }, { windir: 'C:\\Windows' }, { OS: 'Windows_NT' }]) {
  test(`Windows is known from ${Object.keys(env)[0]} alone, before any probe`, async ($, on) => {
    const w = await background(on, $)
    w.env = env
    w.probes = { [MAC_PROBE]: fileAt(MAC_PROBE) }
    await press($, 'open-2-gamma')
    expect(w.probed).toEqual([])
    expect(openers(w)).toEqual([['explorer.exe', BG_LINK]])
  })
}

// All three variables unset on Windows: the probes resolve under the drive's
// root, where anyone can plant them, so their real paths are not Unix ones.
for (const [name, mac, lin] of [
  ['drive-letter', 'C:\\System\\Library\\CoreServices\\SystemVersion.plist', 'C:\\usr\\bin\\xdg-open'],
  ['drive-letter with forward slashes', 'C:/System/Library/CoreServices/SystemVersion.plist', 'C:/usr/bin/xdg-open'],
  ['backslash share-rooted', '\\\\server\\share\\System\\Library\\CoreServices\\SystemVersion.plist', '\\\\server\\share\\usr\\bin\\xdg-open'],
  ['forward-slash share-rooted', '//server/share/System/Library/CoreServices/SystemVersion.plist', '//server/share/usr/bin/xdg-open'],
] as const) {
  test(`probe files with ${name} real paths and no Windows variable run nothing and say there is no opener`, async ($, on) => {
    const w = await background(on, $)
    w.env = {}
    w.probes = { [MAC_PROBE]: fileAt(mac), [LINUX_PROBE]: fileAt(lin) }
    await press($, 'open-2-gamma')
    expect(openers(w)).toEqual([])
    expect(w.toasts.at(-1)).toBe(NO_OPENER)
  })
}

test('a planted macOS probe with a bad real path stops there: the Linux probe is not asked', async ($, on) => {
  const w = await background(on, $)
  w.env = {}
  w.probes = { [MAC_PROBE]: fileAt('C:\\System\\Library\\CoreServices\\SystemVersion.plist'), [LINUX_PROBE]: fileAt(LINUX_PROBE) }
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([MAC_PROBE])
  expect(openers(w)).toEqual([])
})

test('an environment read that rejects means no host: no probe, no process, and the no-opener toast', async ($, on) => {
  const w = await background(on, $)
  w.failEnv = true
  w.probes = { [MAC_PROBE]: fileAt(MAC_PROBE) }
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([])
  expect(openers(w)).toEqual([])
  expect(w.toasts.at(-1)).toBe(NO_OPENER)
})

test('a probe that rejects other than as missing means no host, and the next probe is not asked', async ($, on) => {
  const w = await background(on, $)
  w.env = {}
  w.probes = { [MAC_PROBE]: { reject: 'EACCES: permission denied' }, [LINUX_PROBE]: fileAt(LINUX_PROBE) }
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([MAC_PROBE])
  expect(openers(w)).toEqual([])
  expect(w.toasts.at(-1)).toBe(NO_OPENER)
})

for (const [name, probe] of [
  ['no real path', fileAt()],
  ['a folder', { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: MAC_PROBE }],
  ['something other than a file', { kind: 'other', size: 0, mtimeMs: 0, isLink: false, realPath: MAC_PROBE }],
] as const) {
  test(`a probe that answers with ${name} means no host`, async ($, on) => {
    const w = await background(on, $)
    w.env = {}
    w.probes = { [MAC_PROBE]: probe, [LINUX_PROBE]: fileAt(LINUX_PROBE) }
    await press($, 'open-2-gamma')
    expect(w.probed).toEqual([MAC_PROBE])
    expect(openers(w)).toEqual([])
    expect(w.toasts.at(-1)).toBe(NO_OPENER)
  })
}

test('on macOS, a Desktop card tries the tool route first, and runs /usr/bin/open only after it ends', async ($, on) => {
  const w = await pane(on, $)
  macos(w)
  w.mcp = () => answer('was not started from this session', true)
  await press($, 'open-0-alpha')
  expect(w.order).toEqual(['mcp', 'run /usr/bin/open'])
  expect(openers(w)).toEqual([['/usr/bin/open', LINK]])
})

test('on macOS, a Desktop card the app opens runs no opener and reads no host', async ($, on) => {
  const w = await pane(on, $)
  macos(w)
  await press($, 'open-0-alpha')
  expect(w.order).toEqual(['mcp'])
  expect(w.probed).toEqual([])
})

test('an opener that cannot start shows the could-not-open toast naming the program, never the rejection, and the press does not throw', async ($, on) => {
  const w = await background(on, $)
  macos(w)
  w.failRun = true
  await press($, 'open-2-gamma')
  expect(openers(w)).toEqual([['/usr/bin/open', BG_LINK]])
  expect(w.toasts.at(-1)).toBe('Could not open gamma with /usr/bin/open.')
  expect(w.toasts.some(t => t.includes('SECRET_TOKEN') || t.includes('spawn failed'))).toBe(false)
})

test('the opener runs with a 15-second limit, and a second press on a link in flight starts nothing until it settles', async ($, on) => {
  const w = await background(on, $)
  linux(w)
  w.holdRun = true
  const first = press($, 'open-2-gamma')
  await w.clock.settle()
  expect(openers(w)).toEqual([['/usr/bin/xdg-open', BG_LINK]])
  expect(w.inits[w.procs.findIndex(p => p[0] === '/usr/bin/xdg-open')]).toEqual({ timeoutMs: 15000 })
  await press($, 'open-2-gamma')
  expect(openers(w).length).toBe(1)
  w.releaseRun()
  await first
  w.holdRun = false
  await press($, 'open-2-gamma')
  expect(openers(w).length).toBe(2)
})

test('a press on another link runs while one link is in flight', async ($, on) => {
  const w = await background(on, $)
  macos(w)
  w.holdRun = true
  const first = press($, 'open-2-gamma')
  await w.clock.settle()
  const second = press($, 'open-1-beta')
  await w.clock.settle()
  expect(openers(w)).toEqual([['/usr/bin/open', BG_LINK], ['/usr/bin/open', 'claude://claude.ai/code/session_ABC123']])
  w.releaseRun()
  await Promise.all([first, second])
})

// Spec v4, decision 1: the Linux probe is held to the same checks as the
// macOS one, reached when the macOS probe file is missing.
for (const [name, probe] of [
  ['a drive-letter real path', fileAt('C:\\usr\\bin\\xdg-open')],
  ['a backslash share-rooted real path', fileAt('\\\\server\\share\\usr\\bin\\xdg-open')],
  ['a forward-slash share-rooted real path', fileAt('//server/share/usr/bin/xdg-open')],
  ['no real path', fileAt()],
  ['a folder', { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: LINUX_PROBE }],
  ['a rejection other than missing', { reject: 'EACCES: permission denied' }],
] as const) {
  test(`with the macOS probe missing, a Linux probe that answers with ${name} means no host`, async ($, on) => {
    const w = await background(on, $)
    w.env = {}
    w.probes = { [LINUX_PROBE]: probe }
    await press($, 'open-2-gamma')
    expect(w.probed).toEqual([MAC_PROBE, LINUX_PROBE])
    expect(openers(w)).toEqual([])
    expect(w.toasts.at(-1)).toBe(NO_OPENER)
  })
}

test('an OS variable that is not Windows_NT is not Windows: the probes run', async ($, on) => {
  const w = await background(on, $)
  macos(w)
  w.env = { OS: 'Darwin' }
  await press($, 'open-2-gamma')
  expect(w.probed).toEqual([MAC_PROBE])
  expect(openers(w)).toEqual([['/usr/bin/open', BG_LINK]])
})

test('a Desktop card pressed again while its opener runs asks the app nothing and starts nothing', async ($, on) => {
  const w = await pane(on, $)
  macos(w)
  w.mcp = () => answer('was not started from this session', true)
  w.holdRun = true
  const first = press($, 'open-0-alpha')
  await w.clock.settle()
  expect(w.mcpCalls.length).toBe(1)
  await press($, 'open-0-alpha')
  expect(w.mcpCalls.length).toBe(1)
  expect(openers(w)).toEqual([['/usr/bin/open', LINK]])
  w.releaseRun()
  await first
})
// --- the usage image ----------------------------------------------------------

// A usage reading with rate limits and a breakdown, so the desktop draws the
// image: a pane with no reading draws "No reading yet" and no Svg at all.
const READING = {
  rateLimits: [
    { kind: 'five_hour', percentUsed: 64 },
    { kind: 'seven_day', percentUsed: 12 },
  ],
  context: {
    percent: 23,
    tokens: 46000,
    window: 200000,
    breakdown: {
      categories: [
        { name: 'System prompt', kind: 'used', tokens: 3100 },
        { name: 'Messages', kind: 'used', tokens: 40000 },
        { name: 'Free space', kind: 'free', tokens: 120000 },
        { name: 'Autocompact buffer', kind: 'buffer', tokens: 36900 },
      ],
    },
  },
}

// A roster holding every status, so a surface that refused any card's tree
// would fail the mount.
const EVERY_STATUS = {
  cards: [card('alpha', { status: 'needs-you' }), card('beta'), card('gamma', { status: 'done' }), card('delta', { status: 'stopped' })],
  todos: [{ id: 't1', text: 'look', session: 'alpha' }],
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane mounts on ${surface} with a usage reading, and the surface refuses no part of the tree`, async ($, on) => {
    await pane(on, $, surface, w => {
      w.put(FILE, { type: 'file', data: { text: JSON.stringify(EVERY_STATUS) } })
      w.usage = READING
      w.surfaces = [surface]
    })
    // A tree the surface refuses skips the plugin's render, and the mount
    // above then rejects, naming the refusal (a Button given plain={false}
    // was seen to fail both surfaces this way); drawn() reads the tree drawn.
    expect(await mounted.drawn()).toBeDefined()
    // The pane draws the status strip and the to-do bar as images too (#256),
    // so the usage image is found by its alt, which starts "Usage:".
    const images = await mounted.findAll({ type: 'Svg' })
    const isUsage = (n: any) => n?.type === 'Svg' && String(n.props.alt).startsWith('Usage:')
    const image = images.find(isUsage)
    if (surface === 'desktop') {
      // Full width: no width prop, a fixed height, the markup in percentages,
      // and a column Box that grows around it.
      expect(image).toBeDefined()
      expect(image.props.width).toBeUndefined()
      expect(image.props.height).toBeGreaterThan(0)
      expect(image.props.source).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" height="\d+">/)
      const boxes = await mounted.findAll({ type: 'Box' })
      const around = boxes.filter((b: any) => b.children.some(isUsage))
      expect(around.length).toBe(1)
      expect(around[0].props.flexGrow).toBe(1)
      expect(around[0].props.flexDirection).toBe('column')
      expect(around[0].props.alignItems).toBeUndefined()
    } else {
      // The terminal draws text rows: 20 eighth-block cells between dim marks.
      expect(images.length).toBe(0)
      // Three usage rows, Context and two rate limits, with two end marks
      // each. The to-do bar, drawn above them (#256), adds two marks and a
      // row of 20 cells; its one to-do is not done, so the row is blank.
      const marks = await mounted.findAll({ type: 'Text', text: /^[▕▏]$/ })
      expect(marks.length).toBe(8)
      for (const m of marks) expect(m.props.dimColor).toBe(true)
      const bars = await mounted.findAll({ type: 'Text', text: /^[█▏▎▍▌▋▊▉ ]{20}$/ })
      expect(bars.map((b: any) => b.text)).toEqual([' '.repeat(20), `████▋${' '.repeat(15)}`, `████████████▊${' '.repeat(7)}`, `██▍${' '.repeat(17)}`])
    }
  })
}

// --- the usage projection -------------------------------------------------------
//
// Spec revision 3 on #251, S10; ticket #275. The reading's reset times are set
// from the engine clock when the reading is asked for, so the projection
// draws. The test kit's clock does not move 30 s between the pane's readings,
// so the pane stores only one sample of its own; the session limit's samples
// are planted as another plugin would write them.

const MIN_MS = 60000
const projectedReading = (now: number) => ({
  rateLimits: [
    // 64% now, at 1% a minute from the planted samples: 100% in 36 minutes,
    // two hours before the reset in 156.
    { kind: 'five_hour', percentUsed: 64, resetsAt: new Date(now + 156 * MIN_MS).toISOString() },
    // 12% in the 4 days since the week began: 21% at the reset in 3 days.
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(now + 3 * 1440 * MIN_MS).toISOString() },
    { kind: 'gateway_hour', percentUsed: 50, resetsAt: new Date(now + 30 * MIN_MS).toISOString() },
  ],
  context: READING.context,
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane mounts with a projection past 100%, a ░ or proj extension and a red "runs out about 2 hr early"`, async ($, on) => {
    const written: unknown[] = []
    const w = await pane(on, $, surface, w => {
      w.put(FILE, { type: 'file', data: { text: JSON.stringify(EVERY_STATUS) } })
      w.surfaces = [surface]
      Object.defineProperty(w, 'usage', { get: () => projectedReading(w.clock.now()) })
      w.plant = (key, value) => {
        if (key !== 'samples') return value
        written.push(value)
        const now = w.clock.now()
        return [{ at: now - 20 * MIN_MS, percent: 44 }, { at: now, percent: 64 }]
      }
    })
    expect(await mounted.drawn()).toBeDefined()
    // The pane's own reading wrote one sample of the session limit, at the clock.
    expect(written.length).toBeGreaterThan(0)
    const first = written[0] as { at: unknown; percent: unknown }[]
    expect(first.length).toBe(1)
    expect(first[0].percent).toBe(64)
    expect(typeof first[0].at).toBe('number')
    await mounted.redraw(PANE_PROPS)
    if (surface === 'desktop') {
      const image = (await mounted.findAll({ type: 'Svg' })).find((n: any) => String(n.props.alt).startsWith('Usage:'))
      expect(image).toBeDefined()
      const source = String(image.props.source)
      expect(source).toContain('<rect class="proj" x="0" y="20" width="100%" height="6" rx="3"/>')
      expect(source).toContain('<text class="hot" x="100%" y="12" text-anchor="end">runs out about 2 hr early · 64%</text>')
      expect(source).toContain('<rect class="proj" x="0" y="58" width="21%" height="6" rx="3"/>')
      // The gateway's limit draws its bar and no projection.
      expect(source.match(/class="proj"/g)?.length).toBe(2)
      expect(String(image.props.alt)).toContain('Current session 64%, on pace for 220% at reset, runs out about 2 hr early')
    } else {
      // 64% is twelve full cells and one at six eighths; the projection fills
      // the rest, dim. 12% is two full cells and one at three eighths; 21% is
      // 4.2 cells, so one ░ cell, then 16 blanks.
      const ahead = await mounted.findAll({ type: 'Text', text: /^░+ *$/ })
      expect(ahead.map((t: any) => t.text)).toEqual(['░'.repeat(7), `░${' '.repeat(16)}`])
      for (const t of ahead) expect(t.props.dimColor).toBe(true)
      const late = await mounted.findAll({ type: 'Text', text: /^runs out about 2 hr early$/ })
      expect(late.length).toBe(1)
      expect(late[0].props.color).toBe('error')
      expect(late[0].props.dimColor).toBeUndefined()
      // The weekly limit and the gateway's keep their reset times, dim.
      const resets = await mounted.findAll({ type: 'Text', text: /^Resets in / })
      expect(resets.map((t: any) => t.props.dimColor)).toEqual([true, true])
    }
  })
}

// Samples another plugin rewrote into shapes the buffer check refuses. Each
// but the text is recent and rising, at least 5 minutes from oldest to newest,
// so it would draw a session-limit projection if the check let it through.
// One mount per test, so each shape is its own test.
const REFUSED_SAMPLES: [string, (now: number) => unknown][] = [
  ['text', () => 'x'],
  ['a time that is a numeric string', now => [{ at: now - 20 * MIN_MS, percent: 44 }, { at: String(now), percent: 64 }]],
  ['a percent over 100', now => [{ at: now - 20 * MIN_MS, percent: 44 }, { at: now, percent: 500 }]],
  ['121 samples', now => Array.from({ length: 121 }, (_, i) => ({ at: now - 20 * MIN_MS + i * 10000, percent: 44 + i * 0.1 }))],
  ['times going back', now => [{ at: now - 20 * MIN_MS, percent: 44 }, { at: now - 10 * MIN_MS, percent: 54 }, { at: now - 15 * MIN_MS, percent: 50 }, { at: now, percent: 64 }]],
]
for (const surface of ['terminal', 'desktop'] as const) {
  for (const [name, planted] of REFUSED_SAMPLES) {
    test(`${surface}: samples rewritten as ${name} draw no session-limit projection and throw nothing`, async ($, on) => {
      await pane(on, $, surface, w => {
        w.put(FILE, { type: 'file', data: { text: JSON.stringify(EVERY_STATUS) } })
        w.surfaces = [surface]
        Object.defineProperty(w, 'usage', { get: () => projectedReading(w.clock.now()) })
        w.plant = (key, value) => (key === 'samples' ? planted(w.clock.now()) : value)
      })
      expect(await mounted.drawn()).toBeDefined()
      if (surface === 'desktop') {
        const image = (await mounted.findAll({ type: 'Svg' })).find((n: any) => String(n.props.alt).startsWith('Usage:'))
        // The weekly projection only: the session limit's needs samples.
        expect(String(image.props.source).match(/class="proj"/g)?.length).toBe(1)
        expect(String(image.props.source)).not.toContain('runs out')
      } else {
        expect((await mounted.findAll({ type: 'Text', text: /runs out/ })).length).toBe(0)
        expect((await mounted.findAll({ type: 'Text', text: /^░+ *$/ })).length).toBe(1)
      }
    })
  }
}

// --- the groups and their folds --------------------------------
//
// Spec revision 3 on #250, S5 and S10; ticket #254. Each test runs on both
// surfaces. A tree a surface refuses comes back from the mount, never in the
// transcript, so every mount here is read for its drawn text as well.

const SURFACES = ['terminal', 'desktop'] as const
const D1 = 'local_11111111-1111-1111-1111-111111111111'
const D2 = 'local_22222222-2222-2222-2222-222222222222'
const D3 = 'local_33333333-3333-3333-3333-333333333333'
// Every status, out of group order, so the groups have to sort them.
const ALL = {
  cards: [
    card('done-one', { status: 'done' }),
    card('work-one', { status: 'working' }),
    card('need-one', { status: 'needs-you' }),
    card('stop-one', { status: 'stopped' }),
    card('need-two', { status: 'needs-you' }),
  ],
  todos: [],
}
// Three titles that fold to one slug, `ab`, one in NEEDS YOU and two in
// DONE · STOPPED: a group-local index would give the first done or stopped card
// index 0, which is the needs-you card's place in the roster.
const SAME_SLUG = {
  cards: [
    card('A-b', { status: 'needs-you', desktopId: D1 }),
    card('a b', { status: 'done', desktopId: D2 }),
    card('AB!', { status: 'stopped', desktopId: D3 }),
  ],
  todos: [],
}

async function grouped(on: On, $: any, roster: unknown, plant?: (key: string, value: any) => any) {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(roster) } })
  })
  w.plant = plant
  // A report from another session reaches the bottom of the chain here.
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  return w
}
// One mount per test: a second mount of the same pane is refused, so a test
// redraws the one it holds after a press, and reads it again.
const mountOn = ($: any, surface: string) =>
  $.ui.mount({ plugin: 'grimoire', surface, component: 'Pane', requestId: 'brigade', props: PANE_PROPS })
const textOf = async (m: any): Promise<string> => {
  await m.redraw(PANE_PROPS)
  return String((await m.findAll({}))[0]?.text ?? '')
}
// The drawn text from the first section bar on.
const groupsOf = async (m: any): Promise<string> => {
  const text = await textOf(m)
  return text.slice(Math.max(0, text.search(/[▾▸] Waiting on you/)))
}
for (const surface of SURFACES) {
  test(`${surface}: cards sit under Waiting on you, Working, then a folded Done · stopped bar, in roster order`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    const text = await groupsOf(m)
    // The tree was drawn, not refused: its section bars are there, in order.
    const at = (s: string) => text.indexOf(s)
    expect(text.startsWith('▾ Waiting on you 2')).toBe(true)
    expect(at('▾ Waiting on you 2')).toBeLessThan(at('need-one'))
    expect(at('need-one')).toBeLessThan(at('need-two'))
    expect(at('need-two')).toBeLessThan(at('▾ Working 1'))
    expect(at('▾ Working 1')).toBeLessThan(at('work-one'))
    expect(at('work-one')).toBeLessThan(at('▸ Done · stopped 2'))
    // Closed on open: the done and stopped cards are not drawn.
    expect(text.includes('done-one')).toBe(false)
    expect(text.includes('stop-one')).toBe(false)
    // No Brigade heading, and no roster path.
    expect((await textOf(m)).includes('Brigade')).toBe(false)
    expect((await textOf(m)).includes('plugins')).toBe(false)
    expect(await m.find({ key: 'grp-finished' })).toBeDefined()
    // Colour comes from the status Map: the terminal draws the status glyph
    // in its key, Desktop a dot or circle in its key.
    const drawn = (await m.findAll({})) as { type: string; props: Record<string, unknown>; text?: string }[]
    expect(drawn.filter(n => n.type === 'Text' && n.text === '●' && n.props.color === 'warning').length).toBe(2)
    const working = surface === 'terminal' ? '◐' : '○'
    expect(drawn.find(n => n.type === 'Text' && n.text === working && n.props.color !== 'warning')?.props.color).toBe('suggestion')
    const bar = boxAround(drawn, (c: any) => c?.props?.key === 'grp-finished')
    const title = (t: string) => drawn.find(n => n.type === 'Text' && n.text === t)
    if (surface === 'desktop') {
      // A rounded fill: a round border in the fill's own grey.
      expect([bar?.props.borderStyle, bar?.props.borderColor, bar?.props.backgroundColor]).toEqual(['round', '#2b2b2a', '#2b2b2a'])
      // A waiting card's dot is full size; a working card's is its checkbox,
      // a circle in the status colour, since #396. A waiting title is bold.
      for (const dot of drawn.filter(n => n.type === 'Text' && n.text === '●' && n.props.color === 'warning')) expect(dot.props.size).toBeUndefined()
      expect(drawn.some(n => n.type === 'Text' && n.text === '○' && n.props.color === 'suggestion')).toBe(true)
      expect(drawn.some(n => n.type === 'Button' && String(n.props.key).startsWith('pick-') && n.props.label === '○')).toBe(true)
      expect(title('need-one')?.props.weight).toBe('bold')
      expect(title('work-one')?.props.weight).toBe('semibold')
    } else {
      expect(bar?.props.backgroundColor).toBeUndefined()
    }
  })

  test(`${surface}: an empty group shows its quiet hint`, async ($, on) => {
    await grouped(on, $, { cards: [card('only', { status: 'done' })], todos: [] })
    const m = await mountOn($, surface)
    const text = await textOf(m)
    expect(text.includes('▸ Done · stopped 1')).toBe(true)
    expect(text.includes('Decisions, reviews, and permission requests.')).toBe(true)
    expect(text.includes('No session is working.')).toBe(true)
    expect(text.includes('No cards in the roster yet.')).toBe(false)
    // A folded group shows no hint: its cards stay out of sight.
    expect(text.includes('Sessions the owner closed.')).toBe(false)
  })

  test(`${surface}: a roster with no cards says there are none, and each group shows its hint`, async ($, on) => {
    await grouped(on, $, { cards: [], todos: [] })
    const text = await textOf(await mountOn($, surface))
    expect(text.includes('No cards in the roster yet.')).toBe(true)
    for (const hint of ['Decisions, reviews, and permission requests.', 'No session is working.']) expect(text.includes(hint)).toBe(true)
  })

  test(`${surface}: a press on the Done · stopped bar opens it, and a second press folds it`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const opened = await groupsOf(m)
    expect(opened.includes('▾ Done · stopped 2')).toBe(true)
    expect(opened.indexOf('▾ Done · stopped')).toBeLessThan(opened.indexOf('done-one'))
    expect(opened.indexOf('done-one')).toBeLessThan(opened.indexOf('stop-one'))
    if (surface === 'terminal') {
      expect(opened.includes('○')).toBe(false)
      expect(opened.includes('✓')).toBe(true)
      expect(opened.includes('–')).toBe(true)
    } else {
      // Desktop: a circle, the card's checkbox, in each finished status's
      // own colour.
      const drawn = (await m.findAll({ type: 'Text', text: '○' })) as { props: Record<string, unknown> }[]
      const colors = drawn.map(n => n.props.color)
      expect(colors.includes('success')).toBe(true)
      expect(colors.includes('inactive')).toBe(true)
    }
    await m.press({ key: 'grp-finished' })
    const closed = await groupsOf(m)
    expect(closed.includes('▸ Done · stopped 2')).toBe(true)
    expect(closed.includes('done-one')).toBe(false)
  })

  test(`${surface}: any group folds on a press of its bar, and the others stay`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-working' })
    const text = await groupsOf(m)
    expect(text.includes('▸ Working 1')).toBe(true)
    expect(text.includes('work-one')).toBe(false)
    expect(text.includes('need-one')).toBe(true)
    await m.press({ key: 'grp-waiting' })
    const both = await groupsOf(m)
    expect(both.includes('▸ Waiting on you 2')).toBe(true)
    expect(both.includes('need-one')).toBe(false)
  })

  test(`${surface}: Done · stopped starts folded each time the pane opens`, async ($, on) => {
    const w = await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    await m.press({ key: 'grp-working' })
    expect((await groupsOf(m)).includes('▾ Done · stopped')).toBe(true)
    // The pane goes from the engine's list; the next roster tick sees it and
    // stops every read. Then the owner opens it again.
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    const text = await groupsOf(m)
    expect(text.includes('▸ Done · stopped 2')).toBe(true)
    expect(text.includes('▾ Working 1')).toBe(true)
  })

  test(`${surface}: a second /brigade while the pane is open folds Done · stopped too`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    expect((await groupsOf(m)).includes('▾ Done · stopped')).toBe(true)
    await brigade($)
    expect((await groupsOf(m)).includes('▸ Done · stopped 2')).toBe(true)
  })

  for (const planted of [['__proto__', 'constructor', 'toString'], 'finished', 5, [5, null, {}, 'Finished']] as const) {
    test(`${surface}: a stored folds value of ${JSON.stringify(planted)} folds nothing, and the pane still draws`, async ($, on) => {
      await grouped(on, $, ALL, (key, value) => (key === 'folded' ? planted : value))
      const m = await mountOn($, surface)
      const text = await groupsOf(m)
      expect(text.includes('▾ Done · stopped 2')).toBe(true)
      expect(text.includes('done-one')).toBe(true)
      expect(text.includes('need-one')).toBe(true)
    })
  }

  test(`${surface}: the Done · stopped bar counts the reports of its cards, and an open card's report line uses →`, async ($, on) => {
    await grouped(on, $, ALL)
    const send = (from: string, text: string) =>
      $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="${from}">\n${text}\n</cross-session-message>` })
    await send('done-one', 'finished the slice')
    await send('stop-one', 'stopped at a gate')
    await send('done-one', 'one more thing')
    await send('work-one', 'still going')
    const m = await mountOn($, surface)
    expect((await groupsOf(m)).includes('▸ Done · stopped 2 · 3 reports')).toBe(true)
    await m.press({ key: 'grp-finished' })
    const text = await groupsOf(m)
    expect(text.includes('→ one more thing')).toBe(true)
    // The line carries the report's time.
    expect(/\d\d:\d\d → one more thing/.test(text)).toBe(true)
    expect(text.includes('→ still going')).toBe(true)
    expect(text.includes('↳')).toBe(false)
  })

  test(`${surface}: titles that fold to one slug in different groups keep their roster index, so each press acts on its own card`, async ($, on) => {
    const w = await grouped(on, $, SAME_SLUG)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    await m.redraw(PANE_PROPS)
    expect(await m.find({ key: 'dismiss-1-ab' })).toBeDefined()
    expect(await m.find({ key: 'dismiss-2-ab' })).toBeDefined()
    // The group-local place of the first done or stopped card is 0: never a key.
    expect(await m.find({ key: 'dismiss-0-ab' })).toBeUndefined()
    // The card that waits on the owner has Open but no Dismiss.
    expect(await m.find({ key: 'open-0-ab' })).toBeDefined()
    // No working card: the Working bar shows its hint.
    expect((await groupsOf(m)).includes('No session is working.')).toBe(true)
    await m.press({ key: 'open-1-ab' })
    await m.press({ key: 'open-0-ab' })
    expect(w.mcpCalls.map(c => c.args.session_id)).toEqual([D2, D1])
    await m.press({ key: 'dismiss-1-ab' })
    const after = await groupsOf(m)
    expect(after.includes('a b')).toBe(false)
    expect(after.includes('A-b')).toBe(true)
    expect(after.includes('AB!')).toBe(true)
    await m.press({ key: 'dismiss-2-ab' })
    const last = await groupsOf(m)
    expect(last.includes('AB!')).toBe(false)
    expect(last.includes('A-b')).toBe(true)
  })

  test(`${surface}: a stored card with a hostile or unknown status draws in no group, and the pane still draws`, async ($, on) => {
    const bad = ['__proto__', 'constructor', 'paused', 5, null, { done: true }]
    const w = await grouped(on, $, ALL, (key, value) =>
      key === 'roster'
        ? { ...value, cards: [...(value?.cards ?? []), ...bad.map((status, i) => ({ ...card(`odd-${i}`), status }))] }
        : value,
    )
    // The plant reached the stored roster: five good cards and six odd ones.
    expect((w.roster.at(-1) as any).cards.length).toBe(11)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const text = await textOf(m)
    expect(text.includes('▾ Waiting on you 2')).toBe(true)
    expect(text.includes('▾ Done · stopped 2')).toBe(true)
    expect(text.includes('odd-')).toBe(false)
    expect(text.includes('__proto__')).toBe(false)
    expect(text.includes('paused')).toBe(false)
  })
}
// --- the cache bar ---------------------------------------------------------------
//
// Spec revision 3 on #250, S6 and S8; ticket #257. The warmth records and live
// states are planted as the live poll stores them: the poll runs again on
// its 10 s timer after the clock is read, so each record's time is set from
// the clock the render reads. Each test runs on both surfaces.

const MINUTE = 60000
// Cards for every row of S6's table, and a done and a stopped card whose
// records would draw a bar if they were drawn.
const CACHED = {
  cards: [
    card('need-cold', { status: 'needs-you' }),
    card('need-amber', { status: 'needs-you' }),
    card('work-busy', { status: 'working' }),
    card('work-unknown', { status: 'working' }),
    card('done-one', { status: 'done' }),
    card('stop-one', { status: 'stopped' }),
  ],
  todos: [],
}
const LIVE: Record<string, string> = { 'need-cold': 'idle', 'need-amber': 'idle', 'work-busy': 'busy', 'work-unknown': 'idle', 'done-one': 'idle', 'stop-one': 'idle' }
const HOSTILE_TITLE = 'a<b>&amp;"q"\'s\'</svg><script>x</script>z'

// Plants the live states and warmth records once the clock is known, then
// runs one more poll so they are stored. Resolves the render's clock.
async function cached(on: On, $: any, roster: unknown, records: (now: number) => unknown[], live: Record<string, string> = LIVE, rosterPlant?: (value: any) => any) {
  let now: number | undefined
  const w = await grouped(on, $, roster, (key, value) => {
    if (key === 'roster' && rosterPlant !== undefined) return rosterPlant(value)
    if (now === undefined) return value
    if (key === 'warmth') return records(now)
    if (key === 'live') return Object.entries(live).map(([name, v]) => ({ name, value: v }))
    return value
  })
  now = w.clock.now() + 10000
  await w.clock.advance(10000)
  await w.clock.settle()
  return w
}
const warmCall = (name: string, idleMs: number, now: number, tokens = 150000, windowMs: number | null = 60 * MINUTE) =>
  windowMs === null ? { name, kind: 'call', at: now - idleMs, tokens } : { name, kind: 'call', at: now - idleMs, tokens, windowMs }
const RECORDS = (now: number) => [
  warmCall('need-cold', 70 * MINUTE, now, 182400),
  warmCall('need-amber', 48 * MINUTE, now),
  warmCall('work-busy', 10 * MINUTE, now),
  warmCall('work-unknown', 10 * MINUTE, now, 150000, null),
  warmCall('done-one', 70 * MINUTE, now, 182400),
  warmCall('stop-one', 48 * MINUTE, now),
]
const nodes = async (m: any): Promise<Drawn[]> => {
  await m.redraw(PANE_PROPS)
  return (await m.findAll({})) as Drawn[]
}
const texts = (all: Drawn[], text: string) => all.filter(n => n.type === 'Text' && n.text === text)

for (const surface of SURFACES) {
  test(`${surface}: needs-you and working cards draw ◆ cache, a bar and its short text with the time left, the size on a bare context row, and the nudges unchanged`, async ($, on) => {
    await cached(on, $, CACHED, RECORDS)
    const m = await mountOn($, surface)
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    // Three bars: cold, amber and working. The card with no known window
    // keeps warmthLine's text, dim.
    expect(texts(all, '◆ cache').length).toBe(3)
    // The short text holds only the time left, where a working card reads
    // "warm (working)": the header already says idle (owner, from chat,
    // reversing q2 on #287). The dim line under the bar is gone.
    for (const [short, tone] of [['cold', 'error'], ['cold in 12 min', 'warning'], ['warm (working)', 'success']] as const) {
      const found = texts(all, short)
      expect(found.length).toBe(1)
      expect(found[0]?.props.color).toBe(tone)
    }
    for (const gone of ['idle 1 hr 10 min · 182k context', 'idle 48 min · 150k context', '150k context']) {
      expect(texts(all, gone).length).toBe(0)
    }
    // These records give no model window, so no meter: each bar's card keeps
    // a ◆ context row with the size alone, uncoloured (head chef's decision
    // on #287).
    expect(texts(all, '◆ context').length).toBe(3)
    // The bare context row keeps the bar's room, so its size stays in the
    // value column: a growing Box on desktop, 18 cells of space on the
    // terminal.
    const bare = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'row' && spoken(b.children[0]) === '◆ context' && b.children.length === 3 && !b.children[1].children?.some((c: any) => c?.type === 'Svg') && !/[▕▏]/.test(spoken(b.children[1])))
    expect(bare.length).toBeGreaterThan(0)
    for (const row of bare) {
      const room = row.children[1]
      if (surface === 'desktop') expect([room.props.flexGrow, room.props.minWidth]).toEqual([1, 8])
      else expect(spoken(room)).toBe(' '.repeat(18))
      // The size starts one gap after the bar's room, as the values above do.
      expect(row.children[2].props.justifyContent).toBe('flex-start')
      // On desktop it takes its own width, as the values above do.
      if (surface === 'desktop') expect('width' in row.children[2].props).toBe(false)
    }
    // On the terminal the size's width is its block's widest value text.
    const isBare = (r: any) => r?.type === 'Box' && r.props.flexDirection === 'row' && spoken(r.children[0]) === '◆ context' && r.children.length === 3 && !/[▕▏]/.test(spoken(r.children[1]))
    const bareBlocks = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'column' && b.children?.some(isBare))
    expect(bareBlocks.length).toBe(bare.length)
    for (const block of bareBlocks) {
      const rows = block.children.filter((r: any) => r?.type === 'Box' && r.props.flexDirection === 'row')
      const widest = Math.max(...rows.map((r: any) => spoken(r.children.at(-1)).length))
      const size = rows.find(isBare).children[2]
      if (surface === 'desktop') expect('width' in size.props).toBe(false)
      else expect(size.props.width).toBe(widest)
    }
    for (const [size, n] of [['182k', 1], ['150k', 2]] as const) {
      const found = texts(all, size)
      expect(found.length).toBe(n)
      for (const f of found) expect(f.props.color).toBeUndefined()
    }
    const unknown = texts(all, '◆ cache window unknown · idle 10 min · 150k context')
    expect(unknown.length).toBe(1)
    expect(unknown[0]?.props.dimColor).toBe(true)
    // One row after the cache block, before the phase: the bar row, its
    // detail line and the nudge, or the dim line alone, sit in a column Box
    // with a bottom margin of one row.
    const said = (n: any): string => (typeof n === 'string' ? n : n?.text ?? (n?.children ?? []).map(said).join(''))
    const blocks = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'column' && b.props.marginBottom === 1)
    const firsts = blocks.map(b => b.children[0])
    expect(firsts.filter((f: any) => f?.type === 'Box' && said(f).startsWith('◆ cache')).length).toBe(3)
    expect(firsts.filter((f: any) => f?.type === 'Text' && said(f) === '◆ cache window unknown · idle 10 min · 150k context').length).toBe(1)
    // Each block holds its lines and nothing else, and the phase comes
    // straight after it.
    const COLD_NUDGE = 'Replying re-reads about 182k tokens at full price. Consider a hand-off through the issue to a fresh session.'
    const AMBER_NUDGE = 'Reply within 12 min to keep the cache.'
    const cacheBlocks = blocks.filter(b => said(b.children[0]).startsWith('◆ cache'))
    // The terminal's bare row pads the bar's room with spaces; drop them.
    expect(cacheBlocks.map(b => b.children.slice(1).map((c: any) => said(c).replace(/ {2,}/g, ''))).sort()).toEqual(
      [
        [],
        ['◆ context150k'],
        ['◆ context182k', COLD_NUDGE],
        ['◆ context150k', AMBER_NUDGE],
      ].sort(),
    )
    // The cache block sits under the card's row, which holds the phase.
    // Each of the four shown cards draws its phase before its cache block.
    const phaseAt = all.flatMap((n, k) => (n.type === 'Text' && n.text === 'p' ? [k] : []))
    const cacheAt = all.flatMap((n, k) => (n.type === 'Text' && n.text === '◆ cache' ? [k] : []))
    expect(phaseAt.length).toBe(4)
    expect(cacheAt.length).toBe(3)
    for (const c of cacheAt) expect(phaseAt.filter(k => k < c).length).toBeGreaterThan(0)
    expect(phaseAt[0]).toBeLessThan(cacheAt[0] as number)
    // The old one-line ◆ text is gone where a bar draws.
    expect(text.includes('◆ cache cold ·')).toBe(false)
    expect(text.includes('◆ cache warm ·')).toBe(false)
    // The nudges are warmthLine's, unchanged.
    for (const nudge of [COLD_NUDGE, AMBER_NUDGE]) {
      const found = texts(all, nudge)
      expect(found.length).toBe(1)
      expect(found[0]?.props.color).toBe('warning')
    }
    const images = all.filter(n => n.type === 'Svg' && String(n.props.alt).startsWith('Cache'))
    if (surface === 'desktop') {
      expect(images.map(n => n.props.alt).sort()).toEqual(['Cache cold', 'Cache cold in 12 min', 'Cache warm (working)'])
      for (const image of images) {
        // Full width: no width prop, a fixed height, the markup in
        // percentages, no clip and no id.
        expect(image.props.width).toBeUndefined()
        expect(image.props.height).toBeGreaterThan(0)
        expect(image.props.source).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" height="\d+">/)
        expect(image.props.source.includes('clip')).toBe(false)
        expect(image.props.source.includes(' id=')).toBe(false)
      }
      // Each image sits in a column Box that grows, with a minimum width,
      // between the label and the text, which do not shrink.
      const around = all.filter(b => b.type === 'Box' && b.children.some((c: any) => c?.type === 'Svg' && String(c.props.alt).startsWith('Cache')))
      expect(around.length).toBe(3)
      for (const b of around) {
        expect(b.props.flexDirection).toBe('column')
        expect(b.props.flexGrow).toBe(1)
        expect(b.props.minWidth).toBe(8)
      }
      const holdsBar = (c: any) => c?.type === 'Box' && (c.children ?? []).some((cc: any) => cc?.type === 'Svg' && String(cc.props.alt).startsWith('Cache'))
      const rows = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'row' && b.children.some(holdsBar))
      expect(rows.length).toBe(3)
      for (const row of rows) {
        const [label, , short] = row.children as Drawn[]
        expect(label?.props.flexShrink).toBe(0)
        expect(short?.props.flexShrink).toBe(0)
      }
    } else {
      expect(images.length).toBe(0)
      // 16 eighth-block cells in the tone's colour, between dim end marks.
      const bars = (await m.findAll({ type: 'Text', text: /^[█▏▎▍▌▋▊▉ ]{16}$/ })) as Drawn[]
      expect(bars.map(b => [b.text, b.props.color])).toEqual([
        [`▏${' '.repeat(15)}`, 'error'],
        [`███▎${' '.repeat(12)}`, 'warning'],
        ['█'.repeat(16), 'success'],
      ])
    }
  })

  test(`${surface}: done and stopped cards draw no ◆ line, bar or nudge`, async ($, on) => {
    await cached(on, $, CACHED, RECORDS)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    // The group is open: its cards are drawn.
    expect(text.includes('done-one')).toBe(true)
    expect(text.includes('stop-one')).toBe(true)
    // Still three bars and one unknown line, all from the needs-you and
    // working cards; the 182k nudge only once, from need-cold.
    expect(texts(all, '◆ cache').length).toBe(3)
    // Three bars, each with its bare ◆ context row, and one unknown line.
    expect(text.split('◆').length - 1).toBe(7)
    expect(text.split('Replying re-reads').length - 1).toBe(1)
    expect(text.split('Reply within').length - 1).toBe(1)
    const from = text.indexOf('▾ Done · stopped')
    expect(from).toBeGreaterThan(-1)
    const finished = text.slice(from)
    expect(finished.includes('◆')).toBe(false)
    expect(finished.includes('context')).toBe(false)
    expect(all.filter(n => n.type === 'Svg' && String(n.props.alt).startsWith('Cache')).length).toBe(surface === 'desktop' ? 3 : 0)
  })

  test(`${surface}: a hostile card title never reaches a cache bar's source or alt, and the pane still draws`, async ($, on) => {
    await cached(
      on,
      $,
      { cards: [card('plain', { status: 'needs-you' })], todos: [] },
      now => [warmCall(HOSTILE_TITLE, 48 * MINUTE, now), warmCall('plain', 10 * MINUTE, now)],
      { [HOSTILE_TITLE]: 'idle', plain: 'idle' },
      value => ({ ...value, cards: [...(value?.cards ?? []), card(HOSTILE_TITLE, { status: 'needs-you' })] }),
    )
    const m = await mountOn($, surface)
    const all = await nodes(m)
    expect(texts(all, '◆ cache').length).toBe(2)
    const images = all.filter(n => n.type === 'Svg' && String(n.props.alt).startsWith('Cache'))
    expect(images.length).toBe(surface === 'desktop' ? 2 : 0)
    for (const image of images) {
      for (const out of [String(image.props.source), String(image.props.alt)]) {
        for (const piece of ['script', '<b>', '&amp;amp;', 'plain', 'q"']) expect(out.includes(piece)).toBe(false)
      }
    }
  })

  test(`${surface}: "idle" on a working card is bold and amber; on a needs-you card amber alone, and "busy" unchanged (owner decision q1 A on #287)`, async ($, on) => {
    await cached(on, $, CACHED, RECORDS)
    const m = await mountOn($, surface)
    const all = await nodes(m)
    // work-unknown is a working card gone idle; need-cold and need-amber are
    // idle needs-you cards; the finished group is closed.
    const idle = texts(all, 'idle')
    expect(idle.length).toBe(3)
    for (const t of idle) expect(t.props.color).toBe('warning')
    expect(idle.filter(t => t.props.bold === true).length).toBe(1)
    const title = all.findIndex(n => n.type === 'Text' && n.text === 'work-unknown')
    const bold = all.findIndex(n => n.type === 'Text' && n.text === 'idle' && n.props.bold === true)
    expect(bold).toBeGreaterThan(title)
    expect(all.findIndex((n, k) => k > title && n.type === 'Text' && n.text === 'idle')).toBe(bold)
    const busy = texts(all, 'busy')
    expect(busy.map(t => [t.props.color, t.props.bold])).toEqual([['success', undefined]])
  })
}

// --- the top row, the status strip and the to-do bar --------------------
//
// Spec revision 3 on #250, S2, S3, S4 and S8; ticket #256. Each test runs on
// both surfaces: Desktop draws the strip and the bar as images, the terminal
// as cells of text.

type Drawn = { type: string; props: Record<string, any>; text?: string; children: any[] }
const drawnOf = async (m: any): Promise<Drawn[]> => {
  await m.redraw(PANE_PROPS)
  return (await m.findAll({})) as Drawn[]
}
const imagesOf = (nodes: Drawn[]) => nodes.filter(n => n.type === 'Svg')
const imageBy = (nodes: Drawn[], alt: RegExp) => imagesOf(nodes).find(n => alt.test(String(n.props.alt)))
// The Box that holds a node as a direct child.
const boxAround = (nodes: Drawn[], child: (c: any) => boolean) => nodes.find(n => n.type === 'Box' && n.children.some(child))
// The terminal strip: its runs, each a Text of `█` in a status's colour.
const runsOf = (nodes: Drawn[]) => nodes.filter(n => n.type === 'Text' && typeof n.props.color === 'string' && /^█+$/.test(n.text ?? ''))
const TODOS = [
  { id: 't1', text: 'first' },
  { id: 't2', text: 'second' },
  { id: 't3', text: 'third' },
]
const LEGEND = '● 2 needs you  ◐ 1 working  ✓ 1 done  – 1 stopped'

for (const surface of SURFACES) {
  test(`${surface}: the top row counts the shown cards, then the strip, its legend and the to-do bar, above Waiting on you`, async ($, on) => {
    await grouped(on, $, { ...ALL, todos: TODOS })
    const m = await mountOn($, surface)
    const nodes = await drawnOf(m)
    const text = await textOf(m)
    // No Brigade heading: the pane's own title names it. The count is the top row's.
    expect(text.includes('Brigade')).toBe(false)
    const count = nodes.find(n => n.type === 'Text' && n.text === '5 sessions')
    // The count is the top row's, in the prototype's medium weight (it was dim under the old heading).
    expect(count?.props.weight).toBe('medium')
    // The legend: each status with its glyph, count and word, in its colour,
    // in the Map's order.
    const legend = nodes.find(n => n.type === 'Text' && n.text === LEGEND)
    expect(legend).toBeDefined()
    // The line's own Text holds the entries, each a Text in its colour.
    const colours = nodes.filter(n => n.type === 'Text' && n.text !== LEGEND && /^ *[●◐✓–] \d+ /.test(n.text ?? '')).map(n => n.props.color)
    expect(colours).toEqual(['warning', 'suggestion', 'success', 'inactive'])
    expect(text.indexOf('5 sessions')).toBeLessThan(text.indexOf(LEGEND))
    expect(text.indexOf(LEGEND)).toBeLessThan(text.indexOf('To-dos'))
    expect(text.indexOf('0 of 3 done')).toBeLessThan(text.indexOf('Waiting on you'))
    const done = nodes.find(n => n.type === 'Text' && n.text === '0 of 3 done')
    expect(done?.props.dimColor).toBe(true)
    // The text beside the bar sits in a Box that does not shrink.
    // A Box's children are the raw tree: a Text holds its text in children.
    expect(boxAround(nodes, c => c?.type === 'Text' && c.children?.[0] === '0 of 3 done')?.props.flexShrink).toBe(0)
    if (surface === 'desktop') {
      const strip = imageBy(nodes, /^Status:/)
      const bar = imageBy(nodes, /^To-dos/)
      expect(strip?.props.alt).toBe('Status: 2 needs you, 1 working, 1 done, 1 stopped')
      expect(bar?.props.alt).toBe('To-dos 0 of 3 done')
      for (const image of [strip, bar]) {
        // Full width: no width prop, a fixed height, the markup in percentages,
        // in a column Box that grows.
        expect(image?.props.width).toBeUndefined()
        expect(image?.props.height).toBeGreaterThan(0)
        expect(image?.props.source).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" height="\d+">/)
        const around = boxAround(nodes, c => c?.type === 'Svg' && c.props?.alt === image?.props.alt)
        expect(around?.props.flexGrow).toBe(1)
        expect(around?.props.flexDirection).toBe('column')
      }
      // The bar's Box keeps a stub at the narrowest pane.
      expect(boxAround(nodes, c => c?.type === 'Svg' && c.props?.alt === bar?.props.alt)?.props.minWidth).toBe(8)
      expect(runsOf(nodes).length).toBe(0)
    } else {
      expect(imagesOf(nodes).length).toBe(0)
      // 32 cells: two needs-you cards in five take 13, the rest 7, 6 and 6.
      expect(runsOf(nodes).map(r => [r.props.color, [...(r.text ?? '')].length])).toEqual([
        ['warning', 13],
        ['suggestion', 7],
        ['success', 6],
        ['inactive', 6],
      ])
      const cells = nodes.find(n => n.type === 'Text' && n.props.color === 'success' && /^[█▏▎▍▌▋▊▉ ]{20}$/.test(n.text ?? ''))
      expect(cells?.text).toBe(' '.repeat(20))
    }
  })

  test(`${surface}: a ticked to-do counts as done in the bar at once, and Waiting on you agrees`, async ($, on) => {
    const w = await grouped(on, $, { ...ALL, todos: TODOS })
    const m = await mountOn($, surface)
    expect((await textOf(m)).includes('Waiting on you 5')).toBe(true)
    await m.press({ key: 'todo-0-t1' })
    let nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === '1 of 3 done')).toBe(true)
    expect((await textOf(m)).includes('Waiting on you 4')).toBe(true)
    if (surface === 'desktop') expect(imageBy(nodes, /^To-dos/)?.props.alt).toBe('To-dos 1 of 3 done')
    else expect(nodes.some(n => n.type === 'Text' && n.props.color === 'success' && n.text === `██████▋${' '.repeat(13)}`)).toBe(true)
    // Past the grace period the sweep moves it to done: still one of three.
    await w.clock.advance(35000)
    await w.clock.settle()
    nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === '1 of 3 done')).toBe(true)
    expect((await textOf(m)).includes('Waiting on you 4')).toBe(true)
  })

  test(`${surface}: with no cards and no to-dos the heading says so, and there is no strip or bar`, async ($, on) => {
    await grouped(on, $, { cards: [], todos: [] })
    const m = await mountOn($, surface)
    const nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === 'No cards in the roster yet.')).toBe(true)
    expect(imagesOf(nodes).filter(n => !String(n.props.alt).startsWith('Usage:')).length).toBe(0)
    expect(runsOf(nodes).length).toBe(0)
    expect((await textOf(m)).includes('To-dos')).toBe(false)
    expect((await textOf(m)).includes('sessions')).toBe(false)
  })

  test(`${surface}: cards that are stored but none shown read as no cards: all dismissed, or none with a known status`, async ($, on) => {
    // Every card dismissed: one done card, pressed away.
    await grouped(on, $, { cards: [card('only', { status: 'done' })], todos: [] })
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    await m.press({ key: 'dismiss-0-only' })
    const nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === 'No cards in the roster yet.')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && /sessions?$/.test(n.text ?? ''))).toBe(false)
    expect(imageBy(nodes, /^Status:/)).toBeUndefined()
    expect(runsOf(nodes).length).toBe(0)
  })

  test(`${surface}: a roster whose only cards have unknown statuses reads as no cards`, async ($, on) => {
    const w = await grouped(on, $, { cards: [card('one')], todos: [] }, (key, value) =>
      key === 'roster' ? { ...value, cards: [{ ...card('odd'), status: 'paused' }, { ...card('proto'), status: '__proto__' }] } : value,
    )
    expect((w.roster.at(-1) as any).cards.length).toBe(2)
    const nodes = await drawnOf(await mountOn($, surface))
    expect(nodes.some(n => n.type === 'Text' && n.text === 'No cards in the roster yet.')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && /sessions?$/.test(n.text ?? ''))).toBe(false)
    expect(imageBy(nodes, /^Status:/)).toBeUndefined()
    expect(runsOf(nodes).length).toBe(0)
  })
  test(`${surface}: to-dos with no cards draw the bar and "0 sessions", with no strip`, async ($, on) => {
    await grouped(on, $, { cards: [], todos: TODOS })
    const m = await mountOn($, surface)
    const nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === '0 sessions')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.text === '0 of 3 done')).toBe(true)
    expect((await textOf(m)).includes('No cards in the roster yet.')).toBe(false)
    expect(imageBy(nodes, /^Status:/)).toBeUndefined()
    expect(runsOf(nodes).length).toBe(0)
  })

  test(`${surface}: a dismissed card leaves the heading, the strip and the legend`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    await m.press({ key: 'dismiss-0-doneone' })
    const nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === '4 sessions')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.text === '● 2 needs you  ◐ 1 working  – 1 stopped')).toBe(true)
    if (surface === 'desktop') expect(imageBy(nodes, /^Status:/)?.props.alt).toBe('Status: 2 needs you, 1 working, 1 stopped')
    else expect(runsOf(nodes).reduce((s, r) => s + [...(r.text ?? '')].length, 0)).toBe(32)
  })

  test(`${surface}: titles, to-do texts and a report holding hostile text draw, and none of it reaches the strip or the to-do bar`, async ($, on) => {
    const mark = 'zqmark'
    // No double quote: a report's sender is read from the wrapper's quoted
    // attribute, and this text must reach the pane as a card's sender.
    const hostile = `${mark}<b>&'</svg><script>x</script>\u{202E}rtl${mark}`
    const roster = {
      cards: ['needs-you', 'working', 'done', 'stopped'].map((status, i) => card(`${hostile}${i}`, { status, work: hostile, phase: hostile, settings: hostile })),
      todos: [{ id: 't1', text: hostile, session: `${hostile}0` }, { id: 't2', text: hostile }],
    }
    await grouped(on, $, roster)
    await $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="${hostile}2">\n${hostile}\n</cross-session-message>` })
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const nodes = await drawnOf(m)
    // The roster loaded, and the report is in the pane: the toggle counts it.
    expect(nodes.some(n => n.type === 'Text' && n.text === '4 sessions')).toBe(true)
    expect((await textOf(m)).includes('· 1 report')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.text === '● 1 needs you  ◐ 1 working  ✓ 1 done  – 1 stopped')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.text === '0 of 2 done')).toBe(true)
    if (surface === 'desktop') {
      const strip = imageBy(nodes, /^Status:/)
      const bar = imageBy(nodes, /^To-dos/)
      expect(strip?.props.alt).toBe('Status: 1 needs you, 1 working, 1 done, 1 stopped')
      expect(bar?.props.alt).toBe('To-dos 0 of 2 done')
      for (const image of [strip, bar]) {
        const body = String(image?.props.source).replace(/<style>.*?<\/style>/, '')
        for (const part of [mark, 'script', 'rtl', '&amp;', '&lt;', '\u{202E}']) {
          expect(body.includes(part)).toBe(false)
          expect(String(image?.props.alt).includes(part)).toBe(false)
        }
        expect(body.includes('<text')).toBe(false)
      }
    } else {
      expect(runsOf(nodes).reduce((s, r) => s + [...(r.text ?? '')].length, 0)).toBe(32)
      // The to-do bar's cells are blank eighth-block cells: none of its to-dos
      // is done, and no text reaches them.
      const cells = nodes.find(n => n.type === 'Text' && n.props.color === 'success' && [...(n.text ?? '')].length === 20)
      expect(cells?.text).toBe(' '.repeat(20))
    }
  })

  test(`${surface}: stored cards with hostile and unknown statuses count nowhere, and the strip still draws 32 cells`, async ($, on) => {
    const bad = ['__proto__', 'constructor', 'paused', 5, null, { done: true }]
    const w = await grouped(on, $, ALL, (key, value) =>
      key === 'roster'
        ? { ...value, cards: [...(value?.cards ?? []), ...bad.map((status, i) => ({ ...card(`odd-${i}`), status }))] }
        : value,
    )
    // The plant reached the stored roster: five good cards and six odd ones.
    expect((w.roster.at(-1) as any).cards.length).toBe(11)
    const m = await mountOn($, surface)
    const nodes = await drawnOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === '5 sessions')).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.text === LEGEND)).toBe(true)
    if (surface === 'desktop') expect(imageBy(nodes, /^Status:/)?.props.alt).toBe('Status: 2 needs you, 1 working, 1 done, 1 stopped')
    else expect(runsOf(nodes).reduce((s, r) => s + [...(r.text ?? '')].length, 0)).toBe(32)
  })
}

// --- finding a member's transcript ------------------------------------------------
//
// Spec revision 3 on #251, S3 and S16 criteria 1 and 2; ticket #270. A session
// that moved into a worktree after it started writes its transcript under the
// worktree's projects folder, while its session file may still name its
// launch folder. The folder names are made up, as the config folder is. Each listing
// the pane asks is answered from the file system in memory, in the shape the
// engine listed each kind of entry (recorded-stats.ts).

const MID = '55555555-6666-4777-8888-999999999999'
const LAUNCH = `${CONFIG}\\projects\\C--work`
const WORKTREE = `${CONFIG}\\projects\\C--work--claude-worktrees-build-9`
const SECOND = `${CONFIG}\\projects\\C--work--claude-worktrees-build-8`
// Each call row carries its own message id, as Claude Code writes them; since
// #271 a row without one is not counted.
let calls = 0
const callAt = (at: number) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    isSidechain: false,
    message: {
      id: `msg_${(calls += 1)}`,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 6, cache_creation_input_tokens: 1000, cache_read_input_tokens: 150000, output_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } },
    },
  })
const bridge = (id: string) => JSON.stringify({ type: 'system', subtype: 'bridge_status', url: `https://claude.ai/code/session_${id}` })
// A transcript in a folder under projects, written now, with a Remote Control
// link and a model call a minute ago.
const plantIn = (w: World, folder: string, link: string) => {
  w.dirs(folder)
  w.put(`${folder}\\${MID}.jsonl`, { type: 'file', data: { text: `${bridge(link)}\n${callAt(w.clock.now() - MINUTE)}\n`, mtimeMs: w.clock.now() } })
}
// The pane with one needs-you card, `gamma`, whose session file names the
// launch folder, and a poll after `setup` plants its files.
async function moved(on: On, $: any, setup: (w: World) => void) {
  const w = await grouped(on, $, { cards: [card('gamma', { status: 'needs-you' })], todos: [] })
  liveRows(w, [{ name: 'gamma', status: 'idle', sessionId: MID, cwd: 'C:\\work' }])
  w.dirs(LAUNCH)
  setup(w)
  await w.clock.advance(10000)
  await w.clock.settle()
  return w
}
// No found path, listed name or listing message in any value the pane set.
const holdsNoPath = (w: World, ...more: string[]) => {
  for (const [k, v] of w.states) {
    for (const piece of ['claude-worktrees', `${MID}.jsonl`, ...more]) expect(`${k} ${v}`.includes(piece)).toBe(false)
  }
}

for (const surface of SURFACES) {
  test(`${surface}: a member whose transcript sits only under a worktree folder of its launch folder gets its cache line and its Remote Control link`, async ($, on) => {
    const w = await moved(on, $, w => plantIn(w, WORKTREE, 'WT1'))
    const m = await mountOn($, surface)
    const all = await nodes(m)
    expect(texts(all, '◆ cache').length).toBe(1)
    expect(texts(all, 'cold in 59 min').length).toBe(1)
    expect(texts(all, '◆ transcript not found').length).toBe(0)
    expect(w.listings).toBe(1)
    expect(await m.find({ key: 'open-0-gamma' })).toBeDefined()
    await m.press({ key: 'open-0-gamma' })
    expect(explorer(w)).toEqual([['explorer.exe', 'claude://claude.ai/code/session_WT1']])
    holdsNoPath(w)
  })

  test(`${surface}: a needs-you or working card whose transcript is found nowhere says so, dim, and a finished card says nothing`, async ($, on) => {
    const SIDS = ['66666666-7777-4888-8999-aaaaaaaaaaaa', '77777777-8888-4999-8aaa-bbbbbbbbbbbb', '88888888-9999-4aaa-8bbb-cccccccccccc']
    const w = await grouped(on, $, { cards: [card('need-x', { status: 'needs-you' }), card('work-x'), card('done-x', { status: 'done' })], todos: [] })
    liveRows(w, ['need-x', 'work-x', 'done-x'].map((name, i) => ({ name, status: i === 1 ? 'busy' : 'idle', sessionId: SIDS[i], cwd: 'C:\\work' })))
    w.dirs(LAUNCH)
    await w.clock.advance(10000)
    await w.clock.settle()
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    expect(text.includes('done-x')).toBe(true)
    const lines = texts(all, '◆ transcript not found')
    expect(lines.length).toBe(2)
    for (const l of lines) expect(l.props.dimColor).toBe(true)
    expect(text.slice(text.indexOf('▾ Done · stopped')).includes('◆')).toBe(false)
    expect(texts(all, '◆ cache').length).toBe(0)
  })
}

test('a rejected listing counts as no hit: the card says not found, and its message is shown and kept nowhere', async ($, on) => {
  const w = await moved(on, $, w => {
    plantIn(w, WORKTREE, 'WT1')
    w.listDeny = `EACCES: ${WORKTREE} token=abc123`
  })
  expect(w.listings).toBe(1)
  const m = await mountOn($, 'desktop')
  const all = await nodes(m)
  expect(texts(all, '◆ transcript not found').length).toBe(1)
  const text = await textOf(m)
  for (const piece of ['abc123', 'EACCES', 'claude-worktrees']) expect(text.includes(piece)).toBe(false)
  expect(w.states.filter(([k]) => k === 'liveError').every(([, v]) => v === '""')).toBe(true)
  holdsNoPath(w, 'abc123', 'EACCES')
})

test('the projects folder is listed at most once a minute, and a second hit planted later drops the found transcript and its link at the next listing', async ($, on) => {
  const w = await moved(on, $, w => plantIn(w, WORKTREE, 'WT1'))
  const m = await mountOn($, 'desktop')
  expect(w.listings).toBe(1)
  expect(await m.find({ key: 'open-0-gamma' })).toBeDefined()
  plantIn(w, SECOND, 'WT2')
  // Five more polls inside the minute: no listing, and the found one stands.
  await w.clock.advance(50000)
  await w.clock.settle()
  expect(w.listings).toBe(1)
  expect(texts(await nodes(m), '◆ cache').length).toBe(1)
  // A minute after the first listing: listed again, two hits, none found.
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(w.listings).toBe(2)
  const all = await nodes(m)
  expect(texts(all, '◆ transcript not found').length).toBe(1)
  expect(await m.find({ key: 'open-0-gamma' })).toBeUndefined()
  holdsNoPath(w)
})

test('the Remote Control link is read again when the found path changes, and goes when the path is dropped', async ($, on) => {
  const w = await moved(on, $, w => plantIn(w, WORKTREE, 'WT1'))
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'open-0-gamma' })
  // The transcript now sits at the path from cwd: found there, and its link read.
  plantIn(w, LAUNCH, 'HOME1')
  await w.clock.advance(10000)
  await w.clock.settle()
  await m.redraw(PANE_PROPS)
  await m.press({ key: 'open-0-gamma' })
  // Both gone: nothing found, and no link left to open.
  w.nodes.delete(key(`${LAUNCH}\\${MID}.jsonl`))
  w.nodes.delete(key(`${WORKTREE}\\${MID}.jsonl`))
  await w.clock.advance(10000)
  await w.clock.settle()
  const all = await nodes(m)
  expect(texts(all, '◆ transcript not found').length).toBe(1)
  expect(await m.find({ key: 'open-0-gamma' })).toBeUndefined()
  expect(explorer(w)).toEqual([
    ['explorer.exe', 'claude://claude.ai/code/session_WT1'],
    ['explorer.exe', 'claude://claude.ai/code/session_HOME1'],
  ])
  holdsNoPath(w)
})

test('a card dropped by set_roster leaves no stored link, and when it returns its link is read again (#281)', async ($, on) => {
  const w = await moved(on, $, w => plantIn(w, LAUNCH, 'HOME1'))
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'open-0-gamma' })
  expect(explorer(w)).toEqual([['explorer.exe', 'claude://claude.ai/code/session_HOME1']])
  const stored = () => w.states.filter(([k]) => k === 'links').map(([, v]) => v).at(-1) ?? ''
  expect(stored().includes('HOME1')).toBe(true)
  // The roster now has no gamma: the next poll leaves no link for it.
  await call($, { cards: [card('delta', { status: 'needs-you' })], todos: [] })
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(stored().includes('HOME1')).toBe(false)
  // Gamma returns with the transcript where it was: its link is read again.
  await call($, { cards: [card('gamma', { status: 'needs-you' })], todos: [] })
  await w.clock.advance(10000)
  await w.clock.settle()
  await m.redraw(PANE_PROPS)
  await m.press({ key: 'open-0-gamma' })
  expect(explorer(w)).toEqual([
    ['explorer.exe', 'claude://claude.ai/code/session_HOME1'],
    ['explorer.exe', 'claude://claude.ai/code/session_HOME1'],
  ])
})

test('a link read at 4 MiB or less is kept when the member is found at a new path past 4 MiB (#308)', async ($, on) => {
  const w = await moved(on, $, w => plantIn(w, LAUNCH, 'HOME1'))
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'open-0-gamma' })
  // The member moves into a worktree, where its transcript is past 4 MiB:
  // the engine would refuse the read, and the link it had stays.
  w.nodes.delete(key(`${LAUNCH}\\${MID}.jsonl`))
  w.dirs(WORKTREE)
  const pad = ' '.repeat(4 * 1024 * 1024)
  w.put(`${WORKTREE}\\${MID}.jsonl`, { type: 'file', data: { text: `${bridge('WT1')}\n${pad}\n${callAt(w.clock.now() - MINUTE)}\n`, mtimeMs: w.clock.now() } })
  await w.clock.advance(60000)
  await w.clock.settle()
  await m.redraw(PANE_PROPS)
  await m.press({ key: 'open-0-gamma' })
  expect(explorer(w)).toEqual([
    ['explorer.exe', 'claude://claude.ai/code/session_HOME1'],
    ['explorer.exe', 'claude://claude.ai/code/session_HOME1'],
  ])
  // The engine would refuse it, so the pane never asks: no read of the
  // transcript past 4 MiB, for the link or for the card.
  expect(w.log.filter(l => l.toLowerCase() === `read ${WORKTREE}\\${MID}.jsonl`.toLowerCase())).toEqual([])
  holdsNoPath(w)
})
// --- the context meter -----------------------------------------------------------
//
// Spec revision 3 on #251, S5 and S6; ticket #271. The meters are planted as
// the agents poll stores them, beside the warmth records, as the cache bar's
// tests plant theirs. Each test runs on both surfaces.

const METERED = {
  cards: [
    card('need-low', { status: 'needs-you' }),
    card('need-over', { status: 'needs-you' }),
    card('work-amber', { status: 'working' }),
    card('work-unknown', { status: 'working' }),
    card('done-full', { status: 'done' }),
  ],
  todos: [],
}
const METER_LIVE: Record<string, string> = { 'need-low': 'idle', 'need-over': 'idle', 'work-amber': 'busy', 'work-unknown': 'busy', 'done-full': 'idle' }
const thirty = () => Array.from({ length: 30 }, () => 0)
const meterRec = (name: string, at: number, tokens: number, window: number | null = 1000000) =>
  window === null ? { name, at, burn: thirty(), context: [5000, tokens] } : { name, at, window, burn: thirty(), context: [5000, tokens] }
const METERS = (now: number) => [
  meterRec('need-low', now, 412000),
  meterRec('need-over', now, 1300000),
  meterRec('work-amber', now, 750000),
  meterRec('work-unknown', now, 750000, null),
  meterRec('done-full', now, 950000),
]

// Plants the live states, warmth records and meters once the clock is known,
// then runs one more poll so they are stored.
async function metered(on: On, $: any, roster: { cards: { title: string }[] }, meters: (now: number) => unknown, live: Record<string, string> = METER_LIVE, rosterPlant?: (value: any) => any) {
  let now: number | undefined
  const w = await grouped(on, $, roster, (key, value) => {
    if (key === 'roster' && rosterPlant !== undefined) return rosterPlant(value)
    if (now === undefined) return value
    if (key === 'meters') return meters(now)
    if (key === 'warmth') return Object.keys(live).map(name => warmCall(name, 10 * MINUTE, now as number))
    if (key === 'live') return Object.entries(live).map(([name, v]) => ({ name, value: v }))
    return value
  })
  now = w.clock.now() + 10000
  await w.clock.advance(10000)
  await w.clock.settle()
  return w
}
const spoken = (n: any): string => (typeof n === 'string' ? n : n?.text ?? (n?.children ?? []).map(spoken).join(''))
// The meter rows: a row Box whose first child holds the `◆ context` label.
const meterRows = (all: Drawn[]) => all.filter(b => b.type === 'Box' && b.props.flexDirection === 'row' && spoken(b.children[0]) === '◆ context')

for (const surface of SURFACES) {
  test(`${surface}: needs-you and working cards draw ◆ context, a bar and its text in the meter's tone, red and full past the window; none for an unknown model or a finished card`, async ($, on) => {
    await metered(on, $, METERED, METERS)
    const m = await mountOn($, surface)
    expect(await m.drawn()).toBeDefined()
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    expect(text.includes('done-full')).toBe(true)
    // Three meters, and work-unknown's bare row with its size alone (head
    // chef's decision on #287).
    expect(texts(all, '◆ context').length).toBe(4)
    expect(texts(all, '150k').length).toBe(1)
    // Under 70% the figure is neutral, with no colour (#287 item 4).
    for (const [short, tone] of [['412k of 1M', undefined], ['1.3M · over 1M', 'error'], ['750k of 1M', 'warning']] as const) {
      const found = texts(all, short)
      expect(found.length).toBe(1)
      expect(found[0]?.props.color).toBe(tone)
    }
    // The finished card and the unknown model draw no meter.
    expect(text.slice(text.indexOf('▾ Done · stopped')).includes('◆')).toBe(false)
    expect(text.includes('950k')).toBe(false)
    // The meter sits in the cache block, under the cache bar.
    const rows = meterRows(all).filter(r => !spoken(r).endsWith('150k'))
    expect(rows.length).toBe(3)
    for (const row of rows) {
      const [label, , short] = row.children as Drawn[]
      expect(label?.props.flexShrink).toBe(0)
      expect(short?.props.flexShrink).toBe(0)
    }
    const blocks = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'column' && b.props.marginBottom === 1)
    const holding = blocks.filter(b => b.children.some((c: any) => c?.type === 'Box' && spoken(c.children?.[0]) === '◆ context'))
    expect(holding.length).toBe(4)
    for (const b of holding) {
      const at = b.children.findIndex((c: any) => c?.type === 'Box' && spoken(c.children?.[0]) === '◆ context')
      expect(at).toBeGreaterThan(0)
      expect(spoken(b.children[0]).startsWith('◆ cache')).toBe(true)
    }
    const images = all.filter(n => n.type === 'Svg' && String(n.props.alt).startsWith('Context'))
    if (surface === 'desktop') {
      expect(images.map(n => n.props.alt).sort()).toEqual(['Context 1.3M, over 1M', 'Context 412k of 1M', 'Context 750k of 1M'])
      for (const image of images) {
        expect(image.props.width).toBeUndefined()
        expect(image.props.height).toBeGreaterThan(0)
        expect(image.props.source).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" height="\d+">/)
        expect(image.props.source.includes('clip')).toBe(false)
        expect(image.props.source.includes(' id=')).toBe(false)
      }
      const over = images.find(n => n.props.alt === 'Context 1.3M, over 1M')
      expect(String(over?.props.source)).toMatch(/<rect class="hot" x="0" y="\d+" width="100%"/)
      const around = all.filter(b => b.type === 'Box' && b.children.some((c: any) => c?.type === 'Svg' && String(c.props.alt).startsWith('Context')))
      expect(around.length).toBe(3)
      for (const b of around) {
        expect(b.props.flexDirection).toBe('column')
        expect(b.props.flexGrow).toBe(1)
        expect(b.props.minWidth).toBe(8)
      }
    } else {
      expect(images.length).toBe(0)
      // 16 eighth-block cells between dim end marks.
      expect(rows.map(r => spoken(r.children[1]))).toEqual([
        `▕██████▋${' '.repeat(9)}▏`,
        `▕${'█'.repeat(16)}▏`,
        `▕${'█'.repeat(12)}${' '.repeat(4)}▏`,
      ])
    }
  })

  test(`${surface}: a rewritten meters value never throws or draws past full, and a hostile title never reaches a meter`, async ($, on) => {
    await metered(
      on,
      $,
      { cards: [card('need-low', { status: 'needs-you' }), card('need-over', { status: 'needs-you' }), card('work-amber', { status: 'working' })], todos: [] },
      now => [
        meterRec('need-low', now, 1e12),
        { ...meterRec('need-over', now, 1), context: Array.from({ length: 31 }, () => 1) },
        { ...meterRec('work-amber', now, 1), at: 'soon' },
        5,
        null,
        { name: '__proto__', at: now, window: 1000000, context: [1] },
        meterRec(HOSTILE_TITLE, now, 30000000),
      ],
      { 'need-low': 'idle', 'need-over': 'idle', 'work-amber': 'busy', [HOSTILE_TITLE]: 'idle' },
      value => ({ ...value, cards: [...(value?.cards ?? []), card(HOSTILE_TITLE, { status: 'needs-you' })] }),
    )
    const m = await mountOn($, surface)
    expect(await m.drawn()).toBeDefined()
    const all = await nodes(m)
    // Only the hostile title's meter is well formed: 30M past a 1M window,
    // a full bar, never past it. The three others keep a bare row with their
    // size alone (#287).
    expect(texts(all, '◆ context').length).toBe(4)
    expect(texts(all, '30M · over 1M').length).toBe(1)
    const images = all.filter(n => n.type === 'Svg' && String(n.props.alt).startsWith('Context'))
    expect(images.length).toBe(surface === 'desktop' ? 1 : 0)
    for (const image of images) {
      expect(String(image.props.source)).toMatch(/width="100%" height="6" rx="3"\/><\/svg>$/)
      for (const out of [String(image.props.source), String(image.props.alt)]) {
        for (const piece of ['script', '<b>', '&amp;amp;', 'q"']) expect(out.includes(piece)).toBe(false)
      }
    }
  })
}

// A transcript whose rows pass every check while their id, model and every
// other string field hold text shaped like a path or a secret.
const leaky = (at: number, n: number) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    isSidechain: false,
    uuid: 'D:\\vault\\someone\\.claude\\secret',
    parentUuid: '/srv/someone/.ssh/id_rsa',
    sessionId: 'sk-ant-api03-SECRET',
    cwd: 'D:\\vault\\someone\\work',
    gitBranch: 'tok_abc',
    requestId: 'req_sk-ant-SECRET',
    message: {
      id: `C--Users-someone-sk-ant-api03-SECRET-tok_${n}`,
      role: 'assistant',
      model: 'claude-opus-5-c--users-someone-sk-ant-secret',
      stop_reason: 'D:\\vault\\someone\\secret.txt',
      content: [{ type: 'text', text: 'sk-ant-api03-SECRET D:\\vault\\someone\\.claude\\projects\\x.jsonl' }],
      usage: { input_tokens: 6, cache_creation_input_tokens: 1000, cache_read_input_tokens: 150000, output_tokens: 300, service_tier: 'id_rsa', cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } },
    },
  })

test('no folder path, transcript text, model text or message id reaches any value the pane sets, and the meter still draws', async ($, on) => {
  const w = await moved(on, $, w => {
    const now = w.clock.now()
    w.put(`${LAUNCH}\\${MID}.jsonl`, { type: 'file', data: { text: `${leaky(now - 3 * MINUTE, 1)}\n${leaky(now - 2 * MINUTE, 2)}\n${leaky(now - MINUTE, 3)}\n`, mtimeMs: now } })
  })
  const m = await mountOn($, 'desktop')
  const all = await nodes(m)
  expect(texts(all, '151k of 1M').length).toBe(1)
  expect(all.some(n => n.type === 'Svg' && n.props.alt === 'Context 151k of 1M')).toBe(true)
  expect(w.states.some(([k]) => k === 'meters')).toBe(true)
  // The lead's own transcript path, which the pane keeps from its start, is
  // the one path in its values; no piece of the member's transcript is.
  holdsNoPath(w, 'someone', 'sk-ant', 'SECRET', 'secret', 'tok_', 'id_rsa', 'opus-5-c', 'msg_')
})

// --- burn rate, the context trend and card tabs -------------------------------
//
// Spec revision 3 on #251, S7 and S11; ticket #272. The meters and warmth
// records are planted as the live poll stores them. Each test runs on both
// surfaces.

const TABBED = {
  cards: [
    card('need-tabs', { status: 'needs-you' }),
    card('work-one', { status: 'working' }),
    card('work-none', { status: 'working' }),
    card('need-large', { status: 'needs-you' }),
    card('done-full', { status: 'done' }),
  ],
  todos: [],
}
const TAB_LIVE: Record<string, string> = { 'need-tabs': 'idle', 'work-one': 'busy', 'work-none': 'busy', 'need-large': 'idle', 'done-full': 'idle' }
// 360,000 new tokens in the last two minutes: 12k a minute over 30.
const burnOf = () => Object.assign(thirty(), { 28: 60000, 29: 300000 })
const TAB_METERS = (now: number) => [
  { name: 'need-tabs', at: now, window: 1000000, burn: burnOf(), context: [900000, 5000, 412000] },
  { name: 'work-one', at: now, window: 1000000, burn: burnOf(), context: [412000] },
  { name: 'done-full', at: now, window: 1000000, burn: burnOf(), context: [900000, 5000, 412000] },
]
const TAB_WARMTH = (now: number) => [
  warmCall('need-tabs', 10 * MINUTE, now),
  warmCall('work-one', 10 * MINUTE, now),
  { name: 'work-none', kind: 'unread' },
  { name: 'need-large', kind: 'too-large' },
  warmCall('done-full', 10 * MINUTE, now),
]

// Plants the live states, warmth records and meters once the clock is known,
// then runs one more poll so they are stored. `tabsPlant` rewrites the tab
// choices as they are set.
async function tabbed(
  on: On,
  $: any,
  roster: unknown = TABBED,
  meters: (now: number) => unknown = TAB_METERS,
  warmth: (now: number) => unknown = TAB_WARMTH,
  live: Record<string, string> = TAB_LIVE,
  tabsPlant?: (value: any) => any,
) {
  let now: number | undefined
  const w = await grouped(on, $, roster, (key, value) => {
    if (key === 'tabs' && tabsPlant !== undefined) return tabsPlant(value)
    if (now === undefined) return value
    if (key === 'meters') return meters(now)
    if (key === 'warmth') return warmth(now)
    if (key === 'live') return Object.entries(live).map(([name, v]) => ({ name, value: v }))
    return value
  })
  now = w.clock.now() + 10000
  await w.clock.advance(10000)
  await w.clock.settle()
  return w
}
const tabKeys = (i: number, slug: string, views: string[]) => views.map(v => `tab-${i}-${slug}-${v}`)
// A view button as drawn: its words in the terminal, its icon on Desktop,
// where the chosen one is the primary button, marked here with a trailing ●.
const ICONS: Record<string, string> = { cache: '◆', burn: '↯', trend: '∿' }
const WORDS: Record<string, string> = { cache: 'Cache · context', burn: 'Burn rate', trend: 'Context trend' }
const chosenLabel = (surface: string, view: string) => (surface === 'desktop' ? `${ICONS[view]} ●` : `● ${WORDS[view]}`)
const otherLabel = (surface: string, view: string) => (surface === 'desktop' ? ICONS[view] : WORDS[view])
const labelOf = async (m: any, key: string) => {
  const b = await m.find({ key })
  return b.props.variant === 'primary' && spoken(b) === ICONS[key.split('-').at(-1) ?? ''] ? `${spoken(b)} ●` : spoken(b)
}

for (const surface of SURFACES) {
  test(`${surface}: tabs show only with two or more views, the default selected and marked ●, plain passed only as plain`, async ($, on) => {
    const w = await tabbed(on, $)
    const m = await mountOn($, surface)
    expect(await m.drawn()).toBeDefined()
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    // need-tabs: three views; work-one: one call, so no trend; need-large:
    // too large, so the burn tab for its reason line.
    for (const key of [...tabKeys(0, 'needtabs', ['cache', 'burn', 'trend']), ...tabKeys(1, 'workone', ['cache', 'burn']), ...tabKeys(3, 'needlarge', ['cache', 'burn'])]) {
      expect(await m.find({ key })).toBeDefined()
    }
    for (const key of ['tab-1-workone-trend', 'tab-3-needlarge-trend', ...tabKeys(2, 'worknone', ['cache', 'burn', 'trend']), ...tabKeys(4, 'donefull', ['cache', 'burn', 'trend'])]) {
      expect(await m.find({ key })).toBeUndefined()
    }
    expect(await labelOf(m, 'tab-0-needtabs-cache')).toBe(chosenLabel(surface, 'cache'))
    expect(await labelOf(m, 'tab-0-needtabs-burn')).toBe(otherLabel(surface, 'burn'))
    expect(await labelOf(m, 'tab-0-needtabs-trend')).toBe(otherLabel(surface, 'trend'))
    // The selected tab is a primary button; the others are buttons too, drawn
    // dim, so each shows its outline and reads as pressable (#287 item 5,
    // which replaced plain unselected tabs). No button anywhere is handed
    // plain={false}.
    const chosen = (await m.find({ key: 'tab-0-needtabs-cache' })).props
    const other = (await m.find({ key: 'tab-0-needtabs-burn' })).props
    expect([chosen.plain, chosen.variant, chosen.dimColor]).toEqual([undefined, 'primary', undefined])
    expect([other.plain, other.variant, other.dimColor]).toEqual([undefined, undefined, true])
    expect(all.some(n => n.props?.plain === false || n.props?.dimColor === false)).toBe(false)
    // The default view is today's: the cache bar on the cards that have one,
    // work-none's included, and the context meter.
    expect(texts(all, '◆ cache').length).toBe(3)
    expect(texts(all, '◆ context').length).toBe(2)
    expect(texts(all, '12k/min · last 30 min').length).toBe(0)
    // The tab row sits under the header line, inside the card, above the
    // cache block: in drawing order, the title, the tabs, then ◆ cache.
    const title = all.findIndex(n => n.type === 'Text' && n.text === 'need-tabs')
    const tab = all.findIndex(n => n.type !== 'Box' && spoken(n) === (surface === 'desktop' ? '◆' : '● Cache · context'))
    const cache = all.findIndex((n, k) => k > tab && n.type === 'Text' && n.text === '◆ cache')
    expect(title).toBeGreaterThan(-1)
    expect(tab).toBeGreaterThan(title)
    expect(cache).toBeGreaterThan(tab)
    expect(all.findIndex((n, k) => k > tab && k < cache && n.type === 'Text' && n.text === 'work-one')).toBe(-1)
    expect(w.states.some(([k]) => k === 'tabs')).toBe(false)
  })

  test(`${surface}: the cache block's labels and values sit in fixed columns, and context under 70% is neutral (#287; the card's body inset left with the redesign)`, async ($, on) => {
    await tabbed(on, $)
    const m = await mountOn($, surface)
    const all = await nodes(m)
    // Item 3: each label sits in a Box of one fixed width, and each value
    // starts at the left of its Box, one gap after its bar, as each bar sits
    // one gap after its label. On the terminal each value Box has one width
    // per card, so both bars end at the same place. On desktop it has no
    // width: a cell count is wider than the proportional text it holds, so
    // each value takes its own width and its bar grows to meet it.
    const said = (n: any): string => (typeof n === 'string' ? n : n?.text ?? (n?.children ?? []).map(said).join(''))
    const around = (words: string[]) => all.filter(b => b.type === 'Box' && b.props.flexShrink === 0 && words.includes(said(b)))
    const labels = around(['◆ cache', '◆ context'])
    expect(labels.length).toBe(5)
    expect(new Set(labels.map(b => b.props.width))).toEqual(new Set([9]))
    const blocks = all.filter(b => b.type === 'Box' && b.props.flexDirection === 'column' && b.props.marginBottom === 1 && said(b.children[0]).startsWith('◆ cache'))
    const paired = blocks.map(b => b.children.filter((c: any) => c?.type === 'Box' && c.props.flexDirection === 'row').map((r: any) => r.children.at(-1)))
    expect(paired.filter(values => values.length === 2).length).toBeGreaterThan(0)
    for (const values of paired) {
      const widest = Math.max(...values.map((v: any) => said(v).length))
      for (const v of values) {
        if (surface === 'desktop') expect('width' in v.props).toBe(false)
        else expect(v.props.width).toBe(widest)
        expect(v.props.justifyContent).toBe('flex-start')
      }
    }
    // Item 4: the cache keeps its green; the context figure under 70% has no
    // colour of its own.
    expect(texts(all, 'warm (working)')[0]?.props.color).toBe('success')
    for (const t of texts(all, '412k of 1M')) expect(t.props.color).toBeUndefined()
  })

  test(`${surface}: a card with a meter but no cache window keeps its dim line without the size (#287)`, async ($, on) => {
    let now: number | undefined
    const w = await grouped(on, $, { cards: [card('work-nowin', { status: 'working' })], todos: [] }, (key, value) => {
      if (now === undefined) return value
      if (key === 'meters') return [meterRec('work-nowin', now, 150000)]
      if (key === 'warmth') return [warmCall('work-nowin', 10 * MINUTE, now, 150000, null)]
      if (key === 'live') return [{ name: 'work-nowin', value: 'idle' }]
      return value
    })
    now = w.clock.now() + 10000
    await w.clock.advance(10000)
    await w.clock.settle()
    const m = await mountOn($, surface)
    const all = await nodes(m)
    expect(texts(all, '◆ cache window unknown · idle 10 min').length).toBe(1)
    expect(texts(all, '150k of 1M').length).toBe(1)
    expect(String(all[0]?.text ?? '').includes('150k context')).toBe(false)
  })

  test(`${surface}: a context text wider than the cache text sets the value column (#287)`, async ($, on) => {
    await metered(on, $, { cards: [card('work-wide', { status: 'working' })], todos: [] }, now => [meterRec('work-wide', now, 1300000, 200000)], { 'work-wide': 'busy' })
    const m = await mountOn($, surface)
    const all = await nodes(m)
    expect(texts(all, '1.3M · over 200k').length).toBe(1)
    const values = all.filter(b => b.type === 'Box' && b.props.justifyContent === 'flex-start' && ['warm (working)', '1.3M · over 200k'].includes(spoken(b)))
    if (surface === 'desktop') expect(values.map(b => 'width' in b.props)).toEqual([false, false])
    else expect(values.map(b => b.props.width)).toEqual([16, 16])
  })

  test(`${surface}: a tab press switches its card's view: burn rate, then the context trend, then back`, async ($, on) => {
    const w = await tabbed(on, $)
    const m = await mountOn($, surface)
    await m.press({ key: 'tab-0-needtabs-burn' })
    let all = await nodes(m)
    expect(await labelOf(m, 'tab-0-needtabs-burn')).toBe(chosenLabel(surface, 'burn'))
    expect(await labelOf(m, 'tab-0-needtabs-cache')).toBe(otherLabel(surface, 'cache'))
    expect(texts(all, '12k/min · last 30 min').length).toBe(1)
    // Its cache bar and meter go; the other cards keep theirs.
    expect(texts(all, '◆ cache').length).toBe(2)
    expect(texts(all, '◆ context').length).toBe(1)
    expect(JSON.parse(w.states.filter(([k]) => k === 'tabs').at(-1)?.[1] ?? '[]')).toEqual([{ name: 'need-tabs', value: 'burn' }])
    const burnImage = all.find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Burn rate'))
    if (surface === 'desktop') {
      expect(burnImage?.props.alt).toBe('Burn rate 12k tokens per minute over the last 30 min')
      expect(String(burnImage?.props.source).match(/<rect /g)?.length).toBe(30)
      expect(burnImage?.props.width).toBeUndefined()
      const around = boxAround(all, (c: any) => c?.type === 'Svg' && String(c.props.alt).startsWith('Burn rate'))
      expect([around?.props.flexDirection, around?.props.flexGrow, around?.props.minWidth]).toEqual(['column', 1, 8])
    } else {
      expect(burnImage).toBeUndefined()
      // The sparkline's run, not the status strip's, which is all █.
      const cells = all.filter(n => n.type === 'Text' && n.props.color === 'suggestion' && /^ +[▁▂▃▄▅▆▇█]+$/.test(n.text ?? ''))
      expect(cells.map(n => n.text).join('')).toBe(`${' '.repeat(28)}▂█`)
    }

    await m.press({ key: 'tab-0-needtabs-trend' })
    all = await nodes(m)
    expect(await labelOf(m, 'tab-0-needtabs-trend')).toBe(chosenLabel(surface, 'trend'))
    expect(texts(all, '412k now · 1 compaction').length).toBe(1)
    expect(texts(all, '12k/min · last 30 min').length).toBe(0)
    const trendImage = all.find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Context trend'))
    if (surface === 'desktop') {
      expect(trendImage?.props.alt).toBe('Context trend 412k now, 1 compaction in the last 3 calls')
      expect(String(trendImage?.props.source).match(/class="warn"/g)?.length).toBe(1)
    } else {
      expect(trendImage).toBeUndefined()
      expect(all.some(n => n.type === 'Text' && n.props.color === 'warning' && n.text === '▁')).toBe(true)
    }

    await m.press({ key: 'tab-0-needtabs-cache' })
    all = await nodes(m)
    expect(texts(all, '◆ cache').length).toBe(3)
    expect(texts(all, '412k now · 1 compaction').length).toBe(0)
  })

  test(`${surface}: the burn rate tab of a member too large to read shows the cache line's reason`, async ($, on) => {
    await tabbed(on, $)
    const m = await mountOn($, surface)
    const before = await nodes(m)
    const reason = '◆ cache unknown · transcript too large to read'
    expect(texts(before, reason).length).toBe(1)
    await m.press({ key: 'tab-3-needlarge-burn' })
    const all = await nodes(m)
    expect(await labelOf(m, 'tab-3-needlarge-burn')).toBe(chosenLabel(surface, 'burn'))
    const shown = texts(all, reason)
    expect(shown.length).toBe(1)
    expect(shown[0]?.props.dimColor).toBe(true)
  })

  test(`${surface}: two cards whose titles share a slug, in different groups: a tab press acts on its own card only`, async ($, on) => {
    const roster = { cards: [card('A-b', { status: 'needs-you' }), card('a b', { status: 'working' })], todos: [] }
    const meters = (now: number) => [
      { name: 'A-b', at: now, window: 1000000, burn: burnOf(), context: [900000, 5000, 412000] },
      { name: 'a b', at: now, window: 1000000, burn: Object.assign(thirty(), { 29: 30000 }), context: [100000, 200000] },
    ]
    const warmth = (now: number) => [warmCall('A-b', 10 * MINUTE, now), warmCall('a b', 10 * MINUTE, now)]
    const w = await tabbed(on, $, roster, meters, warmth, { 'A-b': 'idle', 'a b': 'busy' })
    const m = await mountOn($, surface)
    await m.press({ key: 'tab-0-ab-burn' })
    let all = await nodes(m)
    expect(await labelOf(m, 'tab-0-ab-burn')).toBe(chosenLabel(surface, 'burn'))
    expect(await labelOf(m, 'tab-1-ab-cache')).toBe(chosenLabel(surface, 'cache'))
    expect(texts(all, '12k/min · last 30 min').length).toBe(1)
    expect(texts(all, '1.0k/min · last 30 min').length).toBe(0)
    await m.press({ key: 'tab-1-ab-trend' })
    all = await nodes(m)
    expect(await labelOf(m, 'tab-0-ab-burn')).toBe(chosenLabel(surface, 'burn'))
    expect(await labelOf(m, 'tab-1-ab-trend')).toBe(chosenLabel(surface, 'trend'))
    expect(texts(all, '200k now · 0 compactions').length).toBe(1)
    expect(texts(all, '12k/min · last 30 min').length).toBe(1)
    // Each choice is kept under its own card's title. The engine presses only
    // a drawn key, so a key whose place, slug or view word matches no card
    // cannot be pressed here; the view module's tests hold the word check.
    expect(JSON.parse(w.states.filter(([k]) => k === 'tabs').at(-1)?.[1] ?? '[]')).toEqual([
      { name: 'A-b', value: 'burn' },
      { name: 'a b', value: 'trend' },
    ])
  })

  test(`${surface}: a needs-you card's reply nudge shows under whichever tab is chosen (owner decision q1 B)`, async ($, on) => {
    // 48 min idle in a 1 hr window: 12 min left, amber, with 150k context.
    const roster = { cards: [card('need-nudge', { status: 'needs-you' })], todos: [] }
    const meters = (now: number) => [{ name: 'need-nudge', at: now, window: 1000000, burn: burnOf(), context: [900000, 5000, 412000] }]
    await tabbed(on, $, roster, meters, now => [warmCall('need-nudge', 48 * MINUTE, now)], { 'need-nudge': 'idle' })
    const m = await mountOn($, surface)
    const nudge = 'Reply within 12 min to keep the cache.'
    for (const [view, shown] of [
      ['cache', '◆ cache'],
      ['burn', '12k/min · last 30 min'],
      ['trend', '412k now · 1 compaction'],
    ] as const) {
      await m.press({ key: `tab-0-neednudge-${view}` })
      const all = await nodes(m)
      expect(texts(all, shown).length).toBe(1)
      const found = texts(all, nudge)
      expect(found.length).toBe(1)
      expect(found[0]?.props.color).toBe('warning')
      // Under the view, not above it.
      expect(all.indexOf(found[0] as Drawn)).toBeGreaterThan(all.indexOf(texts(all, shown)[0] as Drawn))
    }
  })

  test(`${surface}: the choice is kept when the pane closes and opens again`, async ($, on) => {
    const w = await tabbed(on, $)
    const m = await mountOn($, surface)
    await m.press({ key: 'tab-0-needtabs-trend' })
    expect(await labelOf(m, 'tab-0-needtabs-trend')).toBe(chosenLabel(surface, 'trend'))
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    expect(await labelOf(m, 'tab-0-needtabs-trend')).toBe(chosenLabel(surface, 'trend'))
    expect(texts(await nodes(m), '412k now · 1 compaction').length).toBe(1)
  })

  test(`${surface}: an idle record drawn 30 minutes after its read reads 0/min with a flat baseline`, async ($, on) => {
    await tabbed(on, $, TABBED, now => TAB_METERS(now).map(r => ({ ...r, at: now - 30 * MINUTE })))
    const m = await mountOn($, surface)
    await m.press({ key: 'tab-0-needtabs-burn' })
    const all = await nodes(m)
    expect(texts(all, '0/min · last 30 min').length).toBe(1)
    const image = all.find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Burn rate'))
    if (surface === 'desktop') {
      expect(image?.props.alt).toBe('Burn rate 0 tokens per minute over the last 30 min')
      expect(new Set([...String(image?.props.source).matchAll(/height="([0-9.]+)"\/>/g)].map(x => x[1])).size).toBe(1)
    } else {
      expect(image).toBeUndefined()
    }
  })

  for (const [label, planted] of [
    ['an unknown word', [{ name: 'need-tabs', value: 'constructor' }]],
    ['a prototype key as the word', [{ name: 'need-tabs', value: '__proto__' }]],
    ['a word where a list belongs', 'burn'],
    ['a number', 5],
    ['null', null],
    ['pairs of the wrong shape', [{ name: 'need-tabs' }, 7, { value: 'burn' }]],
  ] as const) {
    test(`${surface}: a rewritten tabs value never throws and reads as the default: ${label}`, async ($, on) => {
      const w = await tabbed(on, $, TABBED, TAB_METERS, TAB_WARMTH, TAB_LIVE, () => planted)
      const m = await mountOn($, surface)
      await m.press({ key: 'tab-0-needtabs-burn' })
      expect(w.states.filter(([k]) => k === 'tabs').at(-1)?.[1]).toBe(JSON.stringify(planted))
      expect(await m.drawn()).toBeDefined()
      expect(await labelOf(m, 'tab-0-needtabs-cache')).toBe(chosenLabel(surface, 'cache'))
      expect(texts(await nodes(m), '12k/min · last 30 min').length).toBe(0)
    })
  }

  test(`${surface}: a hostile title never reaches a sparkline, and its tab keys hold only its slug`, async ($, on) => {
    const roster = { cards: [card(HOSTILE_TITLE, { status: 'needs-you' })], todos: [] }
    const meters = (now: number) => [{ name: HOSTILE_TITLE, at: now, window: 1000000, burn: burnOf(), context: [900000, 5000, 412000] }]
    await tabbed(on, $, roster, meters, now => [warmCall(HOSTILE_TITLE, 10 * MINUTE, now)], { [HOSTILE_TITLE]: 'idle' })
    const m = await mountOn($, surface)
    const slugged = 'abampqssvgscriptxscriptz'
    expect(await m.find({ key: `tab-0-${slugged}-burn` })).toBeDefined()
    const HOSTILE_PIECES = ['script', '<b>', '&amp;amp;', 'q"']
    for (const [view, alt, text] of [
      ['burn', 'Burn rate', '12k/min · last 30 min'],
      ['trend', 'Context trend', '412k now · 1 compaction'],
    ] as const) {
      await m.press({ key: `tab-0-${slugged}-${view}` })
      const all = await nodes(m)
      // The view is drawn: its text, and its sparkline as an image on
      // Desktop or as cells on the terminal. Then none of the title is in it.
      const beside = texts(all, text)
      expect(beside.length).toBe(1)
      const drawn: string[] = [text]
      if (surface === 'desktop') {
        const image = all.find(n => n.type === 'Svg' && String(n.props.alt).startsWith(alt))
        expect(image).toBeDefined()
        drawn.push(String(image?.props.source), String(image?.props.alt))
      } else {
        const cells = all.filter(n => n.type === 'Text' && (n.props.color === 'suggestion' || n.props.color === 'warning') && /^[ ▁▂▃▄▅▆▇█]+$/.test(n.text ?? '') && / /.test(n.text ?? ''))
        expect(cells.length).toBeGreaterThan(0)
        drawn.push(...cells.map(n => String(n.text)))
      }
      for (const out of drawn) for (const piece of HOSTILE_PIECES) expect(out.includes(piece)).toBe(false)
    }
  })
}
// --- the usage summary writer (#311) -----------------------------------------
//
// Spec revision 5 on #304, S4 "The writer": every session with the plugin
// keeps its own usage numbers from its `turn.step` hook and writes them,
// numbers only, to brigade/usage/<session id>.json in the plugin's data
// folder, at most every 15 s and at every turn end. No pane, no /brigade and
// no tool is needed. The decisions are view.ts's, under its own tests; these
// drive the hook the way the engine does.

const USAGE_DIR = `${BRIGADE}\\usage`
const USAGE = `${USAGE_DIR}\\${SID}.json`
const SUMMARY_KEYS = ['version', 'at', 'window', 'burn', 'context', 'lastAt', 'lastTokens', 'cache']
const STEP_USAGE = { input_tokens: 6, cache_creation_input_tokens: 1000, cache_read_input_tokens: 150000, output_tokens: 300, model: 'claude-opus-5-5' }

let stepIndex = 0
// One step through the plugins: every chunk they pass on, and the result.
async function raiseStep($: any, over: Record<string, unknown> = {}) {
  const s = $.turn.step({ turnId: 'turn-1', index: stepIndex++, model: 'claude-opus-5-5', messageCount: 1, ...over })
  const chunks: unknown[] = []
  let x = await s.next()
  while (!x.done) {
    chunks.push(x.value)
    x = await s.next()
  }
  return { chunks, result: x.value }
}
const turnEnd = ($: any, over: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer', ...over })
// A session start: the transcript path that names the config folder, and
// the module's start, which reads the engine clock's epoch once.
async function begin($: any, w: World) {
  await start($)
  await $.session.start({ cwd: 'C:\\work' })
  await w.clock.settle()
}
const usageWrites = (w: World) => w.log.filter(l => l.toLowerCase().startsWith(`write ${USAGE_DIR.toLowerCase()}`))
const writerToasts = (w: World) => w.toasts.filter(t => t.includes('usage summary'))

test('every session writes its usage summary at the turn end, numbers only, with no pane and no session usage call', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  const text = w.text(USAGE)
  expect(text).toBeDefined()
  const s = JSON.parse(text ?? '{}')
  expect(Object.keys(s)).toEqual(SUMMARY_KEYS)
  expect(s.lastTokens).toBe(151006)
  expect(s.context).toEqual([151006])
  expect(s.window).toBe(1000000)
  expect(s.cache).toBe(1)
  // Stamped by the module's clock, set to the engine's epoch: within a
  // second of the mocked engine time, never the machine's own date.
  expect(Math.abs(s.lastAt - w.clock.now())).toBeLessThan(1000)
  expect(text).not.toContain('claude-opus')
  expect(w.open).toBe(false)
  expect(rosterOffers(w)).toEqual([])
  expect(w.usageCalls).toBe(0)
  expect(writerToasts(w)).toEqual([])
})

test('a step with wrong usage values is passed on unchanged, and a turn end with no counted call writes nothing', async ($, on) => {
  const w = world(on)
  await begin($, w)
  const bad = { ...STEP_USAGE, input_tokens: -5, output_tokens: 1.5 }
  // A copy taken before the step: a writer that changed the usage in place
  // would change `bad` too.
  const before = { ...bad }
  w.stepUsage = bad
  const { chunks, result } = await raiseStep($)
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'hi' }, { kind: 'stop', stopReason: 'end_turn', usage: before }])
  expect(result).toEqual({ turnId: 'turn-1', index: stepIndex - 1, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: before })
  w.stepUsage = null
  expect((await raiseStep($)).result.usage).toBe(null)
  await turnEnd($)
  await w.clock.settle()
  expect(w.text(USAGE)).toBeUndefined()
  expect(usageWrites(w)).toEqual([])
})

test('a subagent\'s steps and turn end write nothing', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  await raiseStep($, { agentId: 'agent-1' })
  await turnEnd($, { agentId: 'agent-1' })
  await w.clock.settle()
  expect(w.text(USAGE)).toBeUndefined()
  // A main-loop step writes at once; a second inside 15 s is held by the
  // throttle. A subagent's turn end then must not write it.
  await raiseStep($)
  await w.clock.settle()
  w.stepUsage = { ...STEP_USAGE, input_tokens: 94 }
  await raiseStep($)
  await raiseStep($, { agentId: 'agent-1' })
  await turnEnd($, { agentId: 'agent-1' })
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  // The main loop's own turn end does.
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006, 151094])
})

test('the step waits on no engine call: with the clock, the session id and the file system never answering, every step still returns', async ($, on) => {
  const never = () => new Promise<never>(() => {})
  on('clock.now', never)
  on('session.id', never)
  on('fs.stat', never)
  on('fs.read', never)
  on('fs.write', never)
  on('state.get', never)
  const usage = STEP_USAGE
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer, usage: undefined }))
  for (let i = 0; i < 40; i++) expect((await raiseStep($)).result.usage).toEqual(usage)
  expect((await turnEnd($)).text).toBe('done')
})

test('a file other than a summary at the summary path stops every later write, with exactly one toast', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.dirs(USAGE_DIR)
  const planted = JSON.stringify({ cards: [], todos: [] })
  w.put(USAGE, { type: 'file', data: { text: planted } })
  w.stepUsage = STEP_USAGE
  for (let round = 0; round < 3; round++) {
    await raiseStep($)
    await turnEnd($)
    await w.clock.settle()
  }
  expect(w.text(USAGE)).toBe(planted)
  expect(usageWrites(w)).toEqual([])
  expect(writerToasts(w).length).toBe(1)
  expect(writerToasts(w)[0]).not.toContain('cards')
})

test('a junction at the usage folder is refused, stopping the writer with one toast', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.dirs(BRIGADE)
  w.dirs(ELSEWHERE)
  w.put(USAGE_DIR, { type: 'link', kind: 'junction', target: ELSEWHERE })
  w.stepUsage = STEP_USAGE
  for (let round = 0; round < 2; round++) {
    await raiseStep($)
    await turnEnd($)
    await w.clock.settle()
  }
  expect(w.text(`${ELSEWHERE}\\${SID}.json`)).toBeUndefined()
  expect(usageWrites(w)).toEqual([])
  expect(writerToasts(w).length).toBe(1)
  expect(writerToasts(w)[0]).toContain('the summary path failed its check')
  expect(writerToasts(w)[0]).not.toContain('is a link')
  expect(writerToasts(w)[0]).not.toContain(CONFIG)
})

test('a summary file already there is overwritten with the newer numbers', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  w.stepUsage = { ...STEP_USAGE, input_tokens: 94 }
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  const s = JSON.parse(w.text(USAGE) ?? '{}')
  expect(s.context).toEqual([151006, 151094])
  expect(writerToasts(w)).toEqual([])
})

test('after a clear the series starts over under the new session id, and the old file is left behind', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  w.sid = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW, transcript_path: `${CONFIG}\\projects\\C--work\\${NEW}.jsonl` })
  w.stepUsage = { ...STEP_USAGE, input_tokens: 2 }
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  expect(JSON.parse(w.text(`${USAGE_DIR}\\${NEW}.json`) ?? '{}').context).toEqual([151002])
})

test('an aborted turn\'s end writes the newest numbers too', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  // The first counted step writes at once; the second, inside 15 s, waits.
  await raiseStep($)
  await w.clock.settle()
  w.stepUsage = { ...STEP_USAGE, input_tokens: 94 }
  await raiseStep($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  await turnEnd($, { isAborted: true, reason: 'aborted' })
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006, 151094])
})

test('a link swapped in during the write is caught by the check after it: one toast, and no later write', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.dirs(BRIGADE)
  w.dirs(ELSEWHERE)
  w.holdWrite = true
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await w.clock.settle()
  // The write is held; a junction now takes the usage folder's place.
  w.put(USAGE_DIR, { type: 'link', kind: 'junction', target: ELSEWHERE })
  w.holdWrite = false
  w.release()
  await w.clock.settle()
  // The race itself is the accepted gap: the held write went through the link.
  expect(w.text(`${ELSEWHERE}\\${SID}.json`)).toBeDefined()
  expect(writerToasts(w).length).toBe(1)
  expect(writerToasts(w)[0]).toContain('after the write')
  const writes = w.log.filter(l => l.startsWith('write ')).length
  for (let round = 0; round < 2; round++) {
    await raiseStep($)
    await turnEnd($)
    await w.clock.settle()
  }
  expect(w.log.filter(l => l.startsWith('write ')).length).toBe(writes)
  expect(writerToasts(w).length).toBe(1)
})

test('after a module reload, a clear still starts the series over: the module load names the session id', async ($, on) => {
  const w = world(on)
  // A reload: the module starts with no record of this session's start, and
  // its own load names the id.
  await $.session.start({ cwd: 'C:\\work' })
  await w.clock.settle()
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  const NEW_FILE = `${USAGE_DIR}\\${NEW}.json`
  w.sid = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW, transcript_path: `${CONFIG}\\projects\\C--work\\${NEW}.jsonl` })
  // The first turn after the clear is cut short before any reply: it counts
  // nothing, so nothing from before the clear may be written under the new id.
  w.stepUsage = null
  await raiseStep($)
  await turnEnd($, { isAborted: true, reason: 'aborted' })
  await w.clock.settle()
  expect(w.text(NEW_FILE)).toBeUndefined()
  w.stepUsage = { ...STEP_USAGE, input_tokens: 2 }
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(NEW_FILE) ?? '{}').context).toEqual([151002])
})

// C8, as far as the runner can show it: a step whose model side fails below
// the writer still fails, and the writer records and writes nothing for it.
// The runner answers a hook below that throws as absent ("no implementation"),
// with the writer's registration catch or without it, so no test here can
// tell the catch apart; nor has the try around the hook's own work a seam that
// throws today (stepCall and the decisions catch their own errors, and the
// write is not awaited). Both are held by reading.
test('a step that fails below the writer still fails, and nothing is recorded or written for it', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepFail = 'model failed below'
  let caught = ''
  try {
    await raiseStep($)
  } catch (err) {
    caught = String(err instanceof Error ? err.message : err)
  }
  expect(caught).not.toBe('')
  await turnEnd($)
  await w.clock.settle()
  expect(w.text(USAGE)).toBeUndefined()
  expect(writerToasts(w)).toEqual([])
})

// CodeRabbit on #317: a write takes the session id, then awaits its checks
// before it takes the numbers. A clear in that gap must not put the new
// session's numbers in the old session's file.
test('a clear while a write waits on its checks skips that write; the new session\'s numbers go to its own file', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.dirs(BRIGADE)
  w.holdStat = true
  w.stepUsage = STEP_USAGE
  // The first counted step starts a write, which names this session's file
  // and then waits on its first stat.
  await raiseStep($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  w.sid = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW, transcript_path: `${CONFIG}\\projects\\C--work\\${NEW}.jsonl` })
  w.stepUsage = { ...STEP_USAGE, input_tokens: 2 }
  await raiseStep($)
  w.holdStat = false
  w.releaseStat()
  await w.clock.settle()
  expect(w.text(USAGE)).toBeUndefined()
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(`${USAGE_DIR}\\${NEW}.json`) ?? '{}').context).toEqual([151002])
  expect(w.text(USAGE)).toBeUndefined()
})

// #363: where Claude Code's guard skips the classic hooks, a clear or a resume
// raises no classic.SessionStart. The writer follows the session id itself.
test('with classic.SessionStart skipped, a changed session id starts the series over in the new file', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  w.sid = NEW
  w.stepUsage = { ...STEP_USAGE, input_tokens: 2 }
  await raiseStep($)
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  expect(JSON.parse(w.text(`${USAGE_DIR}\\${NEW}.json`) ?? '{}').context).toEqual([151002, 151002])
})

test('with classic.SessionStart skipped, a write held while the session id changes leaves the old file unchanged', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.dirs(BRIGADE)
  w.holdStat = true
  w.stepUsage = STEP_USAGE
  await raiseStep($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  w.sid = NEW
  w.holdStat = false
  w.releaseStat()
  await w.clock.settle()
  expect(w.text(USAGE)).toBeUndefined()
  expect(usageWrites(w)).toEqual([])
})

test('with classic.SessionStart skipped, only the latest-started session id read counts: an older answer arriving late is ignored', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  // The first step's id read is held; its answer, the old id, comes last.
  w.holdNextId = true
  await raiseStep($)
  await w.clock.settle()
  const NEW = '99999999-8888-7777-6666-555555555555'
  w.sid = NEW
  w.stepUsage = { ...STEP_USAGE, input_tokens: 2 }
  await raiseStep($)
  await w.clock.settle()
  w.releaseId()
  await w.clock.settle()
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  expect(JSON.parse(w.text(`${USAGE_DIR}\\${NEW}.json`) ?? '{}').context).toEqual([151002, 151002])
})

test('with classic.SessionStart skipped, a rejected session id read is ignored and the step still writes', async ($, on) => {
  const w = world(on)
  await begin($, w)
  w.stepUsage = STEP_USAGE
  w.rejectIds = 1
  await raiseStep($)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.text(USAGE) ?? '{}').context).toEqual([151006])
  expect(writerToasts(w)).toEqual([])
})

// --- issue 339: the redesigned pane ---------------------------------------------
//
// Spec revision 3 on #339. The card's PR fields and its age, the `gh` call,
// the switch between Sessions and Pull requests, the folds, the selection bar
// and the look on each surface. The `gh` call is answered by the fake in
// `world`, so no test reaches the network.

const GH_ARGV = ['gh', 'pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,additions,deletions,updatedAt,url,isCrossRepository']
const ghPr = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Title ${n}`,
  state: 'OPEN',
  additions: 12,
  deletions: 3,
  updatedAt: '1970-01-01T00:00:00Z',
  url: `https://github.com/o/r/pull/${n}`,
  isCrossRepository: false,
  ...over,
})
const PRS = {
  cards: [
    card('alpha', { status: 'working', pr: '341', prState: 'open' }),
    card('beta', { status: 'done', pr: '342', prState: 'merged' }),
    card('gamma', { status: 'needs-you' }),
  ],
  todos: [],
}
const asked = (w: World) => w.ghCalls.length

test('set_roster takes pr and prState and writes them with the card and its age', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const r = await call($, { cards: [card('a', { pr: '341', prState: 'merged' })], todos: [] })
  expect(r.ok).toBe(true)
  expect(JSON.parse(w.text(FILE) ?? 'null').cards[0]).toEqual({ ...card('a', { pr: '341', prState: 'merged' }), since: 0 })
})

for (const [label, over, field] of [
  ['a non-digit pr', { pr: 'abc' }, 'pr'],
  ['an 8-digit pr', { pr: '12345678' }, 'pr'],
  ['a pr that is a number', { pr: 341 }, 'pr'],
  ['an unknown prState', { prState: 'draft' }, 'prState'],
  ['a prototype key as prState', { prState: 'constructor' }, 'prState'],
  ['a since the model sent', { since: 5 }, 'since'],
] as const) {
  test(`set_roster refuses ${label}, names the field, and leaves the file`, async ($, on) => {
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: '{"cards":[],"todos":[]}' } })
    })
    await start($)
    await brigade($)
    const r = await call($, { cards: [card('a', over)], todos: [] })
    expect(r.ok).toBe(false)
    expect(r.text).toContain(`card 1 ${field} `)
    expect(w.text(FILE)).toBe('{"cards":[],"todos":[]}')
  })
}

test('the pane reads a roster file holding pr, prState and since', async ($, on) => {
  const w = await grouped(on, $, { cards: [card('a', { pr: '341', prState: 'open', since: 5 })], todos: [] })
  expect(w.errors.at(-1)).toBe('')
})

test('the pane refuses a roster file whose since is 2^53', async ($, on) => {
  const w = await grouped(on, $, { cards: [card('a', { since: 2 ** 53 })], todos: [] })
  expect(w.errors.at(-1)).toMatch(/^Roster not shown: card 1 since is not a whole number/)
})

test('a call keeps a card\'s age while its status and phase stand, and stamps the clock when they change or the card is new', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  await call($, { cards: [card('a', { phase: 'p1' }), card('b')], todos: [] })
  await w.clock.advance(120000)
  await call($, { cards: [card('a', { phase: 'p1' }), card('b', { phase: 'new' }), card('c')], todos: [] })
  const now = w.clock.now()
  expect(JSON.parse(w.text(FILE) ?? 'null').cards.map((c: any) => c.since)).toEqual([0, now, now])
})

test('two calls in one turn stamp in order, the second from the file the first wrote', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  await call($, { cards: [card('a')], todos: [] })
  await w.clock.advance(60000)
  const now = w.clock.now()
  // The first changes the status, the second changes it back: read from the first's file, the second
  // stamps again; read from the file as it was before the turn, it would keep the old age.
  const [x, y] = await Promise.all([call($, { cards: [card('a', { status: 'done' })], todos: [] }), call($, { cards: [card('a')], todos: [] })])
  expect([x.ok, y.ok]).toEqual([true, true])
  const written = w.log.filter(l => l.startsWith('write ')).slice(-2).map(l => JSON.parse(l.slice(l.indexOf('{'))))
  expect(written.map(r => r.cards[0].since)).toEqual([now, now])
})

test('a clock answer that is a fraction refuses the call, leaves the file, and the next good answer is kept', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: '{"cards":[],"todos":[]}' } })
  })
  await start($)
  await brigade($)
  // The kit's clock answers what it is set to, a fraction included.
  await w.clock.set(1.5)
  const refused = await call($, { cards: [card('a')], todos: [] })
  expect(refused.ok).toBe(false)
  expect(refused.text).toContain('clock')
  expect(w.text(FILE)).toBe('{"cards":[],"todos":[]}')
  await w.clock.set(2)
  expect((await call($, { cards: [card('a')], todos: [] })).ok).toBe(true)
  expect(JSON.parse(w.text(FILE) ?? 'null').cards[0].since).toBe(2)
})

test('the stamp keeps no age the file carries ahead of the clock by more than 2 minutes', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify({ cards: [card('a', { since: 500000 })], todos: [] }) } })
  })
  await start($)
  await brigade($)
  expect((await call($, { cards: [card('a')], todos: [] })).ok).toBe(true)
  expect(JSON.parse(w.text(FILE) ?? 'null').cards[0].since).toBe(0)
})

// --- the gh call ---------------------------------------------------------------

test('with a card carrying a pr, the open pane runs the one fixed gh list at most once a minute, with a 15 s limit', async ($, on) => {
  const w = await grouped(on, $, PRS)
  expect(asked(w)).toBe(1)
  expect(w.ghCalls[0]).toEqual(GH_ARGV)
  expect(w.ghInits[0]).toEqual({ timeoutMs: 15000 })
  await w.clock.advance(59000)
  expect(asked(w)).toBe(1)
  await w.clock.advance(1000)
  expect(asked(w)).toBe(2)
  await w.clock.advance(60000)
  expect(asked(w)).toBe(3)
})

test('no gh call runs when no card carries a pr', async ($, on) => {
  const w = await grouped(on, $, ALL)
  await w.clock.advance(180000)
  expect(asked(w)).toBe(0)
})

test('no gh call runs once the pane is closed', async ($, on) => {
  const w = await grouped(on, $, PRS)
  expect(asked(w)).toBe(1)
  w.open = false
  await w.clock.advance(5000)
  await w.clock.advance(180000)
  expect(asked(w)).toBe(1)
})

test("a dismissed card's PR is not asked about", async ($, on) => {
  const w = await grouped(on, $, { cards: [card('alpha', { status: 'working', pr: '341' })], todos: [] })
  expect(asked(w)).toBe(1)
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'dismiss-0-alpha' })
  await w.clock.advance(180000)
  expect(asked(w)).toBe(1)
})

test('once gh says every shown PR is merged, it is not asked again', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    w.ghOut = JSON.stringify([ghPr(341, { state: 'MERGED' }), ghPr(342, { state: 'MERGED' })])
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  expect(asked(w)).toBe(1)
  await w.clock.advance(240000)
  expect(asked(w)).toBe(1)
})

test('a result the pane\'s close overtakes is dropped', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    w.holdGh = true
    w.ghOut = JSON.stringify([ghPr(341, { title: 'Dropped answer' })])
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  const opening = brigade($)
  await w.clock.settle()
  w.open = false
  await w.clock.advance(5000)
  w.holdGh = false
  w.releaseGh()
  await opening
  await w.clock.settle()
  w.open = true
  await brigade($)
  await w.clock.settle()
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'view-prs' })
  expect((await textOf(m)).includes('Dropped answer')).toBe(false)
})

const BAD_GH = [
  ['a non-zero exit', (w: World) => { w.ghExit = 1 }],
  ['output the engine cut short', (w: World) => { w.ghCut = true }],
  ['output that is no JSON', (w: World) => { w.ghOut = 'not json' }],
  ['a failure to start', (w: World) => { w.ghDeny = 'spawn failed: SECRET_MARKER_XYZ' }],
] as const
for (const [label, spoil] of BAD_GH) {
  test(`gh with ${label}: the last good answers stay, one dim line says so, and the error text is shown and stored nowhere`, async ($, on) => {
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
      w.ghOut = JSON.stringify([ghPr(341, { title: 'Good title' })])
    })
    on('session.receive', (_: any, e: any) => e)
    await start($)
    await brigade($)
    await w.clock.settle()
    const m = await mountOn($, 'desktop')
    await m.press({ key: 'view-prs' })
    expect((await textOf(m)).includes('Good title')).toBe(true)
    expect((await textOf(m)).includes('PR details unavailable')).toBe(false)
    spoil(w)
    w.ghErr = 'SECRET_MARKER_XYZ account=octo host=ghe.example'
    await w.clock.advance(60000)
    const text = await textOf(m)
    expect(text.includes('PR details unavailable')).toBe(true)
    expect(text.includes('Good title')).toBe(true)
    expect(text.includes('SECRET_MARKER')).toBe(false)
    expect(text.includes('octo')).toBe(false)
    expect(w.states.some(([, v]) => v.includes('SECRET_MARKER') || v.includes('octo'))).toBe(false)
    expect(w.errors.some(e => e.includes('SECRET_MARKER'))).toBe(false)
    expect(w.toasts.some(t => t.includes('SECRET_MARKER'))).toBe(false)
  })
}

test('a PR from a fork gets no title, counts or state: the card draws its own title and prState', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    w.ghOut = JSON.stringify([ghPr(341, { title: 'Stranger PR', state: 'MERGED', isCrossRepository: true }), ghPr(342, { title: 'Real merged', state: 'MERGED' })])
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'view-prs' })
  const text = await textOf(m)
  expect(text.includes('Stranger PR')).toBe(false)
  expect(text.includes('alpha')).toBe(true)
  expect(text.includes('Real merged')).toBe(true)
  // The fork's PR left the card's own state, open, in place.
  expect(text.includes('▾ Open 1')).toBe(true)
  expect(text.indexOf('▾ Open 1')).toBeLessThan(text.indexOf('alpha'))
  // And no counts from the fork's PR on the card's row.
  expect(text.includes('alpha · +')).toBe(false)
})

// --- issue 379: the PR chip opens the pull request ---------------------------------

for (const surface of SURFACES) {
  test(`${surface}: a card's PR chip links to the PR gh answered for, from gh's repository and the card's number only`, async ($, on) => {
    // alpha's 341 is answered; beta's 342 is a fork's, so no answer; gamma has
    // no pr. Every free-text field of alpha's carries a link gh never named.
    const evil = 'https://github.com/evil/repo/pull/9'
    const cards = [
      { ...PRS.cards[0], title: `alpha ${evil}`, work: evil, phase: evil, settings: evil },
      PRS.cards[1],
      PRS.cards[2],
    ]
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: JSON.stringify({ cards, todos: [] }) } })
      w.ghOut = JSON.stringify([ghPr(341), ghPr(342, { state: 'MERGED', isCrossRepository: true })])
    })
    on('session.receive', (_: any, e: any) => e)
    await start($)
    await brigade($)
    await w.clock.settle()
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    const links = all.filter(n => n.type === 'Link')
    expect(links.map(l => l.props.href)).toEqual(['https://github.com/o/r/pull/341'])
    // On Desktop the image pill stays, the link is a small arrow beside it,
    // named in a tooltip; the terminal's link is the number itself.
    if (surface === 'desktop') {
      expect((links[0].children ?? []).map(spoken).join('')).toBe('↗')
      expect((await textOf(m)).includes('Open pull request #341')).toBe(true)
      expect(all.some(n => n.type === 'Svg' && n.props.alt === '#341, open')).toBe(true)
    } else {
      expect((links[0].children ?? []).map(spoken).join('')).toBe('#341')
    }
  })
}

// --- issue 405: the Pull requests tab's chips open the pull request ---------------

for (const surface of SURFACES) {
  test(`${surface}: a Pull requests row links to the PR gh answered for, from gh's repository and the row's number only`, async ($, on) => {
    // 341 is answered; 342 is a fork's, so no answer. Every free-text field
    // of alpha's carries a link gh never named.
    const evil = 'https://github.com/evil/repo/pull/9'
    const cards = [{ ...PRS.cards[0], title: `alpha ${evil}`, work: evil, phase: evil, settings: evil }, PRS.cards[1], PRS.cards[2]]
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: JSON.stringify({ cards, todos: [] }) } })
      w.ghOut = JSON.stringify([ghPr(341), ghPr(342, { state: 'MERGED', isCrossRepository: true })])
    })
    on('session.receive', (_: any, e: any) => e)
    await start($)
    await brigade($)
    await w.clock.settle()
    const m = await mountOn($, surface)
    await m.press({ key: 'view-prs' })
    const all = await nodes(m)
    const links = all.filter(n => n.type === 'Link')
    expect(links.map(l => l.props.href)).toEqual(['https://github.com/o/r/pull/341'])
    if (surface === 'desktop') {
      expect((links[0].children ?? []).map(spoken).join('')).toBe('↗')
      expect((await textOf(m)).includes('Open pull request #341')).toBe(true)
      expect(all.some(n => n.type === 'Svg' && n.props.alt === '#341, open')).toBe(true)
    } else {
      expect((links[0].children ?? []).map(spoken).join('')).toBe('#341')
    }
  })
}

// --- the views ------------------------------------------------------------------

for (const surface of SURFACES) {
  test(`${surface}: the switch shows Sessions first, each time the pane opens, and the Pull requests view groups the PRs with counts and hints`, async ($, on) => {
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: JSON.stringify({ cards: [...PRS.cards, card('delta', { status: 'working', pr: '343', prState: 'closed' })], todos: [] }) } })
      w.ghOut = JSON.stringify([ghPr(341, { title: 'Fix the pane', additions: 20, deletions: 4 }), ghPr(342, { title: 'Merged thing', state: 'MERGED' })])
    })
    on('session.receive', (_: any, e: any) => e)
    await start($)
    await brigade($)
    await w.clock.settle()
    const m = await mountOn($, surface)
    let text = await textOf(m)
    expect(text.startsWith('4 sessions')).toBe(true)
    await m.press({ key: 'view-prs' })
    text = await textOf(m)
    expect(text.startsWith('3 pull requests')).toBe(true)
    expect(text.includes('1 waiting on you')).toBe(true)
    for (const bar of ['▾ Open 1', '▾ Merged 1', '▾ Closed 1']) expect(text.includes(bar)).toBe(true)
    // The PR's title, then the card's title, the counts, the repository and the age.
    expect(text.includes('Fix the pane')).toBe(true)
    expect(text.includes('alpha · +20 −4 · o/r')).toBe(true)
    expect(text.includes('Merged thing')).toBe(true)
    // The card with no answer from gh shows its own title.
    expect(text.includes('delta')).toBe(true)
    if (surface === 'desktop') {
      // Rows a small step apart, with no hairline between them.
      const all = await nodes(m)
      expect(all.filter(n => n.type === 'Svg' && n.props.alt === 'divider').length).toBe(0)
      const prRows = all.filter(n => n.type === 'Box' && n.props.marginBottom === 'xs' && n.props.paddingY === 'sm')
      expect(prRows.length).toBe(3)
      // The pill and the title on one line, the dim line under both; each row
      // carries the round ring in the pane's grey that its hover fills.
      for (const row of prRows) {
        expect(row.props.flexDirection).toBe('column')
        expect([row.props.borderStyle, row.props.borderColor]).toEqual(['round', '#1a1a19'])
        expect(row.children.length).toBe(2)
        expect(row.children[0]?.props.flexDirection).toBe('row')
        expect(row.children[1]?.type).toBe('Text')
      }
    }
    // Usage and the spacer stay.
    expect(text.includes('Usage')).toBe(true)
    // Reopening the pane opens on Sessions.
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    expect((await textOf(m)).startsWith('4 sessions')).toBe(true)
  })

  test(`${surface}: the Pull requests view shows its empty groups' hints and folds on a press`, async ($, on) => {
    await grouped(on, $, { cards: [card('plain', { status: 'working' })], todos: [] })
    const m = await mountOn($, surface)
    await m.press({ key: 'view-prs' })
    let text = await textOf(m)
    expect(text.startsWith('0 pull requests')).toBe(true)
    for (const hint of ['No open pull requests.', 'Nothing merged yet.', 'No closed pull requests.']) expect(text.includes(hint)).toBe(true)
    await m.press({ key: 'grp-pr-open' })
    text = await textOf(m)
    expect(text.includes('▸ Open 0')).toBe(true)
    expect(text.includes('No open pull requests.')).toBe(false)
  })

  test(`${surface}: the roster's errors stay on top of the Pull requests view`, async ($, on) => {
    const bad = await grouped(on, $, { cards: [card('bad', { status: 'paused' })], todos: [] })
    bad.put(`${SESSIONS}\\100.json`, { type: 'file', data: { text: 'not json' } })
    await bad.clock.advance(10000)
    const n = await mountOn($, surface)
    await n.press({ key: 'view-prs' })
    const text = await textOf(n)
    expect(text.includes('Roster not shown')).toBe(true)
    // The poll's line too, and both above the groups.
    expect(text.includes('Cannot read the session files.')).toBe(true)
    expect(text.indexOf('Roster not shown')).toBeLessThan(text.indexOf('▾ Open'))
    expect(text.indexOf('Cannot read the session files.')).toBeLessThan(text.indexOf('▾ Open'))
    expect(bad.errors.at(-1)).toContain('Roster not shown')
  })

  test(`${surface}: a card shows its PR pill in the state's colour, and a state outside the Map draws the pill with no colour`, async ($, on) => {
    await grouped(on, $, PRS, (key, value) =>
      key === 'roster' ? { ...value, cards: [...(value?.cards ?? []), { ...card('odd', { status: 'working' }), pr: '7', prState: 'constructor' }] } : value,
    )
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const all = await nodes(m)
    // On Desktop the pill is a small image of a rounded tint, its mark and the
    // number, 18 px high, as Desktop's own PR pill; the terminal draws the
    // number in the state's colour. A state outside the Maps draws the number
    // uncoloured, on both.
    const pills = all.filter(n => n.type === 'Svg' && /^#\d+, /.test(String(n.props.alt)))
    if (surface === 'desktop') {
      expect(pills.map(p => p.props.alt).sort()).toEqual(['#341, open', '#342, merged'])
      for (const p of pills) expect(p.props.height).toBe(18)
      expect(String(pills.find(p => p.props.alt === '#341, open')?.props.source)).toContain('class="tint-open"')
    } else {
      expect(pills.length).toBe(0)
      expect(texts(all, '#341')[0]?.props.color).toBe('success')
      expect(texts(all, '#342')[0]?.props.color).toBe('merged')
    }
    expect(texts(all, '#7')[0]).toBeDefined()
    expect(texts(all, '#7')[0]?.props.color).toBeUndefined()
  })

  test(`${surface}: a card's age is drawn from its since, and none when since is ahead of the clock by over 2 minutes`, async ($, on) => {
    const w = await grouped(on, $, { cards: [card('old', { status: 'working', since: 0 }), card('future', { status: 'working', since: 1200000 })], todos: [] })
    await w.clock.advance(14 * 60000)
    const m = await mountOn($, surface)
    const all = await nodes(m)
    const ages = all.filter(n => n.type === 'Text' && n.props.tabular === true).map(n => n.text)
    expect(ages).toEqual(['14m'])
  })

  test(`${surface}: the settings show as one character each on Desktop, in full on the terminal`, async ($, on) => {
    await grouped(on, $, { cards: [card('mx', { status: 'working', settings: 'Opus, max, default mode' })], todos: [] })
    const m = await mountOn($, surface)
    const text = await textOf(m)
    expect(text.includes('O·∞')).toBe(surface === 'desktop')
    // The tooltip holds the full line on Desktop; the terminal shows it inline.
    expect(text.includes('Opus, max, default mode')).toBe(true)
  })

  test(`${surface}: hairlines, hover fills and tooltips are Desktop's; the terminal draws a blank row and always shows the actions`, async ($, on) => {
    // A waiting card and a to-do as well: Waiting on you parts its rows with a
    // row gap, not a hairline.
    await grouped(on, $, { cards: [card('one', { status: 'working' }), card('two', { status: 'working' }), card('wait', { status: 'needs-you' })], todos: [{ id: 't1', text: 'look' }] })
    const m = await mountOn($, surface)
    const all = await nodes(m)
    const lines = all.filter(n => n.type === 'Svg' && n.props.alt === 'divider')
    // The Box that holds the waiting card and the to-do, and no other card.
    const waitingRows = all.find(n => n.type === 'Box' && spoken(n).includes('wait') && spoken(n).includes('look') && !spoken(n).includes('two') && n.children.length > 1)
    // A hover is not in the drawn tree; what it reveals is: a Box hidden at rest.
    const hidden = all.filter(n => n.type === 'Box' && n.props.display === 'none')
    const actions = all.filter(n => n.type === 'Box' && ['Dismiss', 'OpenDismiss'].includes(spoken(n)))
    // Each card carries a round border in the pane's own grey, unseen at rest,
    // which its hover fills, so the lit card is rounded; none in the terminal.
    const rounded = all.filter(n => n.type === 'Box' && n.props.borderStyle === 'round' && n.props.borderColor === '#1a1a19')
    expect(rounded.length).toBe(surface === 'desktop' ? 3 : 0)
    if (surface === 'desktop') {
      expect(lines.length).toBe(1)
      expect(waitingRows?.props.rowGap).toBe(1)
      expect(hidden.length).toBeGreaterThan(0)
      // A tooltip is a square fill, as in the prototype.
      for (const h of hidden.filter(n => n.props.position === 'absolute')) {
        expect(h.props.backgroundColor).toBe('#3a3a38')
        expect(h.props.borderStyle).toBeUndefined()
      }
      expect(actions.some(a => a.props.display === 'none')).toBe(true)
      expect(String(lines[0]?.props.source)).toContain('class="rule"')
    } else {
      // A blank row parts the waiting card from the to-do, as it parts cards.
      expect(waitingRows?.children.map(spoken)).toContain(' ')
      expect(lines.length).toBe(0)
      expect(hidden.length).toBe(0)
      expect(actions.length).toBeGreaterThan(0)
      for (const a of actions) expect(a.props.display).toBeUndefined()
    }
  })

  test(`${surface}: the checkbox selects a card and a to-do's box ticks the to-do, each with its own key and word`, async ($, on) => {
    const w = await grouped(on, $, { cards: [card('one', { status: 'working' }), card('two', { status: 'working' })], todos: [{ id: 't1', text: 'look' }] })
    const m = await mountOn($, surface)
    // The terminal draws a box with no word, in a slot: the card's takes the
    // box's width, the to-do's is fixed. A desktop gives a native button a
    // minimum width (#396), so there the card's status dot is its checkbox
    // and the to-do's box is a plain circle, each in a slot 3 cells wide.
    const all = await nodes(m)
    const pickButton = await m.find({ key: 'pick-0-one' })
    const todoButton = await m.find({ key: 'todo-0-t1' })
    const pick = boxAround(all, (c: any) => c?.props?.key === 'pick-0-one')?.props
    const todo = boxAround(all, (c: any) => c?.props?.key === 'todo-0-t1')?.props
    if (surface === 'desktop') {
      expect([pickButton.props.plain, pickButton.props.label]).toEqual([true, '○'])
      expect([todoButton.props.plain, todoButton.props.label, todoButton.props.dimColor]).toEqual([true, '○', true])
      // Both sit in a slot of one width that never shrinks, so the text
      // beside never moves; it is not clipped, and it starts at the row's
      // edge, with no padding or centring.
      for (const slot of [pick, todo]) expect([slot?.width, slot?.flexShrink, slot?.overflow, slot?.paddingLeft, slot?.justifyContent]).toEqual([3, 0, undefined, undefined, undefined])
    } else {
      expect([pickButton.props.plain, pickButton.props.label]).toEqual([undefined, ' '])
      expect([todoButton.props.plain, todoButton.props.label]).toEqual([undefined, ' '])
      expect([pick?.width, pick?.overflow]).toEqual([undefined, undefined])
      expect([todo?.width, todo?.overflow]).toEqual([5, undefined])
    }
    const ticks = () => w.log.filter(l => l.startsWith('state ticking')).length
    await m.press({ key: 'pick-0-one' })
    await m.press({ key: 'pick-1-two' })
    expect(ticks()).toBe(0)
    const two = await textOf(m)
    expect(two.includes('2 selected')).toBe(true)
    expect(two.includes('✓ Dismiss')).toBe(true)
    // The bar is a rounded fill with a soft outline a shade above it; the
    // terminal keeps its theme keys.
    const bar = boxAround(await nodes(m), (c: any) => c?.props?.key === 'bardismiss')
    expect([bar?.props.borderStyle, bar?.props.borderColor, bar?.props.backgroundColor]).toEqual(surface === 'desktop' ? ['round', '#3a3a38', '#262625'] : ['round', 'inactive', 'subtle'])
    await m.press({ key: 'todo-0-t1' })
    expect(ticks()).toBeGreaterThan(0)
    // Ticked, both show a tick and keep the slot they had unticked.
    const after = await nodes(m)
    const slot = (key: string) => { const p = boxAround(after, (c: any) => c?.props?.key === key)?.props; return [p?.width, p?.overflow] }
    expect(slot('pick-0-one')).toEqual([pick?.width, pick?.overflow])
    expect(slot('todo-0-t1')).toEqual([todo?.width, todo?.overflow])
    const picked = (await m.find({ key: 'pick-0-one' })).props
    const ticked = (await m.find({ key: 'todo-0-t1' })).props
    expect([picked.label, ticked.label]).toEqual(['✓', '✓'])
    if (surface === 'desktop') {
      expect(picked.plain).toBe(true)
      expect([ticked.plain, ticked.dimColor]).toEqual([true, false])
    }
    // The tick selected nothing: still the two cards.
    expect((await textOf(m)).includes('2 selected')).toBe(true)
    // A second press on a card's box unselects it.
    await m.press({ key: 'pick-0-one' })
    expect((await textOf(m)).includes('1 selected')).toBe(true)
    // The bar's Dismiss ticks no to-do.
    const before = ticks()
    await m.press({ key: 'bardismiss' })
    expect(ticks()).toBe(before)
  })

  test(`${surface}: the bar's Dismiss hides the selected cards, skips one that waits on the owner, and clears the selection; the cross clears it alone`, async ($, on) => {
    // Every selection the pane sets is replaced by one naming a card that waits on the owner.
    const PLANTED = ['work-one', 'need-one', 'stop-one', 'not-a-card']
    const w = await grouped(on, $, ALL, (key, value) => (key === 'picked' && Array.isArray(value) && value.length > 0 ? PLANTED : value))
    const m = await mountOn($, surface)
    await m.press({ key: 'pick-1-workone' })
    // The bar counts only picks a checkbox shows: not the card that waits on
    // the owner, and not a title no card holds.
    expect((await textOf(m)).includes('2 selected')).toBe(true)
    await m.press({ key: 'barclear' })
    const cleared = await textOf(m)
    expect(cleared.includes('selected')).toBe(false)
    expect(cleared.includes('work-one')).toBe(true)
    await m.press({ key: 'pick-1-workone' })
    await m.press({ key: 'bardismiss' })
    const after = await textOf(m)
    expect(after.includes('selected')).toBe(false)
    expect(after.includes('work-one')).toBe(false)
    expect(after.includes('need-one')).toBe(true)
    expect(after.includes('▸ Done · stopped 1')).toBe(true)
    // Reopening brings the dismissed cards back and clears the selection.
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    const back = await textOf(m)
    expect(back.includes('work-one')).toBe(true)
    expect(back.includes('▸ Done · stopped 2')).toBe(true)
  })

  test(`${surface}: Dismiss is on working, done and stopped cards and never on one that waits on the owner; a card dismissed while working shows in Waiting on you when it turns needs-you`, async ($, on) => {
    const w = await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    await m.redraw(PANE_PROPS)
    expect(await m.find({ key: 'dismiss-1-workone' })).toBeDefined()
    expect(await m.find({ key: 'dismiss-0-doneone' })).toBeDefined()
    expect(await m.find({ key: 'dismiss-3-stopone' })).toBeDefined()
    expect(await m.find({ key: 'dismiss-2-needone' })).toBeUndefined()
    expect(await m.find({ key: 'dismiss-4-needtwo' })).toBeUndefined()
    // Nor a checkbox: the bar's Dismiss never takes a card that waits.
    expect(await m.find({ key: 'pick-2-needone' })).toBeUndefined()
    await m.press({ key: 'dismiss-1-workone' })
    expect((await textOf(m)).includes('work-one')).toBe(false)
    // The head chef turns the dismissed card to needs-you: it shows again, in Waiting on you.
    await call($, { cards: ALL.cards.map(c => (c.title === 'work-one' ? { ...c, status: 'needs-you' } : c)), todos: [] })
    await w.clock.settle()
    const text = await textOf(m)
    expect(text.includes('▾ Waiting on you 3')).toBe(true)
    expect(text.indexOf('work-one')).toBeLessThan(text.indexOf('▾ Working'))
  })

  test(`${surface}: a planted view or selection is checked again and changes nothing it should not`, async ($, on) => {
    await grouped(on, $, ALL, (key, value) => {
      if (key === 'view') return '__proto__'
      // 49 titles no card holds, then work-one, 50th and kept, then stop-one,
      // 51st and past the cap, then more.
      if (key === 'picked') return [...Array.from({ length: 49 }, (_, i) => `bogus-${i}`), 'work-one', 'stop-one', ...Array.from({ length: 250 }, (_, i) => `more-${i}`)]
      return value
    })
    const m = await mountOn($, surface)
    await m.press({ key: 'pick-1-workone' })
    const text = await textOf(m)
    // The planted view word reads as Sessions; the long selection reads as at
    // most 50 entries, and the bar counts only the cards among them.
    expect(text.startsWith('5 sessions')).toBe(true)
    expect(text.includes('1 selected')).toBe(true)
  })
}

// --- issue 339: fixes from the first review round ---------------------------------

test('opening the pane does not wait on the first gh call: the reply comes and the tool is offered while gh runs', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    w.holdGh = true
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  const reply = await brigade($)
  expect(reply.text).toContain('`set_roster` is ready')
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(asked(w)).toBe(1)
  // A tick that finds a call still running does nothing.
  await w.clock.advance(120000)
  expect(asked(w)).toBe(1)
  w.holdGh = false
  w.releaseGh()
  await w.clock.settle()
})

for (const surface of SURFACES) {
  test(`${surface}: a done card shows its settings too`, async ($, on) => {
    await grouped(on, $, { cards: [card('fin', { status: 'done', settings: 'Opus, high' })], todos: [] })
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-finished' })
    const text = await textOf(m)
    expect(text.includes(surface === 'desktop' ? 'O·H' : 'Opus, high')).toBe(true)
  })

  test(`${surface}: a card dismissed with its own button leaves the selection and its count`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'pick-1-workone' })
    expect((await textOf(m)).includes('1 selected')).toBe(true)
    await m.press({ key: 'dismiss-1-workone' })
    const text = await textOf(m)
    expect(text.includes('selected')).toBe(false)
  })

  test(`${surface}: reports count from the open: reopening the pane clears them`, async ($, on) => {
    const w = await grouped(on, $, ALL)
    await $.session.receive({ origin: { kind: 'peer' }, text: '<cross-session-message from="done-one">\nold news\n</cross-session-message>' })
    const m = await mountOn($, surface)
    expect((await textOf(m)).includes('· 1 report')).toBe(true)
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    const text = await textOf(m)
    expect(text.includes('· 1 report')).toBe(false)
    expect(text.includes('old news')).toBe(false)
    expect(text.includes('No reports since the pane opened.')).toBe(true)
  })
}

// --- issue 339: fixes from the second review round --------------------------------

test('a phase that differs only by a trailing space or a hidden character keeps the card\'s age', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  await call($, { cards: [card('a', { phase: 'building' })], todos: [] })
  await w.clock.advance(60000)
  await call($, { cards: [card('a', { phase: 'building \u{200b}' })], todos: [] })
  expect(JSON.parse(w.text(FILE) ?? 'null').cards[0].since).toBe(0)
})

test('a call that answers for none of the shown numbers says PR details are unavailable', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    // Another host's URLs: every entry fails the github.com rule.
    w.ghOut = JSON.stringify([ghPr(341, { url: 'https://ghe.example/o/r/pull/341' })])
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'view-prs' })
  expect((await textOf(m)).includes('PR details unavailable')).toBe(true)
})

test('an answer naming another repository than the first one is no answer', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    w.ghOut = JSON.stringify([ghPr(341, { title: 'First repo title' })])
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  const m = await mountOn($, 'desktop')
  await m.press({ key: 'view-prs' })
  expect((await textOf(m)).includes('First repo title')).toBe(true)
  // The repository gh answers for changes under the pane.
  w.ghOut = JSON.stringify([ghPr(341, { title: 'Other repo title', url: 'https://github.com/evil/repo/pull/341' })])
  await w.clock.advance(60000)
  const text = await textOf(m)
  expect(text.includes('Other repo title')).toBe(false)
  expect(text.includes('First repo title')).toBe(true)
  expect(text.includes('PR details unavailable')).toBe(true)
})

test('on macOS a PATH with an empty or relative entry runs no gh, and an absolute PATH does', async ($, on) => {
  const bad = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    macos(w)
    w.env = { PATH: '/usr/bin::/bin' }
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await bad.clock.settle()
  await bad.clock.advance(120000)
  expect(asked(bad)).toBe(0)
})

test('on macOS an absolute PATH lets gh run', async ($, on) => {
  const good = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(PRS) } })
    macos(w)
    w.env = { PATH: '/usr/bin:/bin' }
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await good.clock.settle()
  expect(asked(good)).toBe(1)
})

for (const surface of SURFACES) {
  test(`${surface}: every Sessions bar counts the reports of its cards`, async ($, on) => {
    await grouped(on, $, ALL)
    for (const from of ['need-one', 'work-one', 'work-one']) {
      await $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="${from}">\nnews\n</cross-session-message>` })
    }
    const m = await mountOn($, surface)
    await m.press({ key: 'grp-working' })
    const text = await textOf(m)
    expect(text.includes('▸ Working 1 · 2 reports')).toBe(true)
    expect(text.includes('▾ Waiting on you 2 · 1 report')).toBe(true)
  })

  test(`${surface}: the icon-only buttons draw their icon, carry no label, and a tooltip or a word names each`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.redraw(PANE_PROPS)
    // A desktop draws a Button's label in place of its text, so none sets one;
    // the harness reports the drawn text as the label.
    expect((await m.find({ key: 'view-sessions' })).props.label).toBe(surface === 'desktop' ? '◫' : 'Sessions')
    expect((await m.find({ key: 'view-prs' })).props.label).toBe(surface === 'desktop' ? '⎇' : 'Pull requests')
    // The Pull requests tooltip counts what the view holds.
    expect((await textOf(m)).includes('Pull requests 0')).toBe(surface === 'desktop')
    await m.press({ key: 'pick-1-workone' })
    expect((await m.find({ key: 'barclear' })).props.label).toBe('✕')
  })
}

test('the editor and mobile show Open, Dismiss and the full settings without a pointer', async ($, on) => {
  await grouped(on, $, { cards: [card('one', { status: 'working', settings: 'Opus, high, plan mode', pr: '341', prState: 'open' })], todos: [] })
  for (const surface of ['vscode', 'mobile']) {
    const m = await mountOn($, surface)
    const all = await nodes(m)
    // No Box is hidden at rest, so Dismiss is reachable, and the settings show in full.
    expect(all.filter(n => n.type === 'Box' && n.props.display === 'none').length).toBe(0)
    expect(await m.find({ key: 'dismiss-0-one' })).toBeDefined()
    expect(String(all[0]?.text).includes('Opus, high, plan mode')).toBe(true)
    // The images and fills draw as on Desktop; the hover's ring does not, with no pointer.
    expect(boxAround(all, (c: any) => c?.props?.key === 'grp-working')?.props.backgroundColor).toBe('#2b2b2a')
    expect(all.filter(n => n.type === 'Svg' && n.props.alt === '#341, open').length).toBe(1)
    expect(all.filter(n => n.type === 'Box' && n.props.borderColor === '#1a1a19').length).toBe(0)
  }
})

// --- the live poll's source (#347) --------------------------------------------
//
// The live state comes from the engine's session files on every 10 s poll.
// The pane runs no `claude agents --json`, which makes every running session
// do work at once. A file that fails its check, or a sessions folder that
// cannot be read, draws one fixed line and no row from that file.

const S1 = 'aaaaaaaa-1111-4222-8333-444444444444'
const S2 = 'bbbbbbbb-1111-4222-8333-444444444444'
const claudeRuns = (w: World) => w.procs.filter(p => p[0] === 'claude').length
const lastLive = (w: World) => JSON.parse(w.states.filter(([k]) => k === 'live').at(-1)?.[1] ?? '[]')
const lastLiveError = (w: World) => JSON.parse(w.states.filter(([k]) => k === 'liveError').at(-1)?.[1] ?? '""')
const UNREAD = 'Cannot read the session files.'

test('the live state follows the session files at every poll, and the pane never runs claude agents, shown or not', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [{ name: 'alpha', status: 'busy', sessionId: S1, cwd: 'C:\\work' }]))
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: 'alpha' }])
  liveRows(w, [{ name: 'alpha', status: 'idle', sessionId: S1, cwd: 'C:\\work' }])
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'idle', shown: 'alpha' }])
  w.shown = false
  await w.clock.advance(300000)
  w.shown = true
  await w.clock.advance(300000)
  await w.clock.settle()
  expect(claudeRuns(w)).toBe(0)
  expect(lastLiveError(w)).toBe('')
  // A session that ended took its file with it.
  liveRows(w, [])
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(lastLive(w)).toEqual([])
})

test('a session file that fails its check draws the one fixed line and no row from it; the good file still draws, and a fixed file clears the line', async ($, on) => {
  const w = await pane(on, $, 'desktop', w =>
    liveRows(w, [
      { name: 'alpha', status: 'busy', sessionId: S1, cwd: 'C:\\work' },
      { name: 'beta', status: 'idle', sessionId: S2, cwd: 'C:\\work' },
    ]),
  )
  w.put(`${SESSIONS}\\101.json`, { type: 'file', data: { text: '{"name":"beta","status":' } })
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: 'alpha' }])
  expect(lastLiveError(w)).toBe(UNREAD)
  const text = await textOf(mounted)
  expect(text.includes(UNREAD)).toBe(true)
  w.put(`${SESSIONS}\\101.json`, { type: 'file', data: { text: JSON.stringify({ name: 'beta', status: 'idle', sessionId: S2 }) } })
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(lastLiveError(w)).toBe('')
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: 'alpha' }, { name: 'beta', value: 'idle', shown: 'beta' }])
})

test('a sessions folder that cannot be read draws the fixed line and no rows, and keeps the cards\' last cache and meter values', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [{ name: 'alpha', status: 'busy', sessionId: S1, cwd: 'C:\\work' }]))
  w.drop(`${SESSIONS}\\100.json`)
  w.drop(`${SESSIONS}\\100.0123abcd.key`)
  w.drop(SESSIONS)
  const kept = w.states.filter(([k]) => k === 'warmth' || k === 'meters').length
  await w.clock.advance(10000)
  await w.clock.settle()
  expect(lastLive(w)).toEqual([])
  expect(lastLiveError(w)).toBe(UNREAD)
  expect(claudeRuns(w)).toBe(0)
  // Nothing the transcripts gave is redrawn from no rows.
  expect(w.states.filter(([k]) => k === 'warmth' || k === 'meters').length).toBe(kept)
})

test('a close while the session files are being read stores no live state', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [{ name: 'alpha', status: 'busy', sessionId: S1, cwd: 'C:\\work' }]))
  liveRows(w, [{ name: 'alpha', status: 'idle', sessionId: S1, cwd: 'C:\\work' }])
  w.holdStat = true
  await w.clock.advance(10000)
  // The pane goes from the engine's list; the next roster tick sees it and
  // stops every read, while the session read still waits on its stat.
  w.open = false
  await w.clock.advance(5000)
  const from = w.states.length
  w.holdStat = false
  w.releaseStat()
  await w.clock.settle()
  expect(w.states.slice(from).filter(([k]) => k === 'live' || k === 'liveError')).toEqual([])
})

test('the pane keeps nothing from a session file but the name and status: no socket, bridge id or folder in any value it set', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [{ name: 'alpha', status: 'busy', sessionId: S1, cwd: 'C:\\work' }]))
  await w.clock.advance(10000)
  await w.clock.settle()
  for (const [k, v] of w.states) for (const piece of ['cc-msg', 'session_X', 'C:\\\\work', '.key']) expect(`${k} ${v}`.includes(piece)).toBe(false)
  // The file was read, and the key file beside it never was.
  expect(w.log.some(l => l.startsWith('read ') && l.endsWith('\\100.json'))).toBe(true)
  expect(w.log.some(l => l.startsWith('read ') && l.endsWith('.key'))).toBe(false)
  // No Refresh button: there is nothing for it to run.
  expect(await mounted.find({ key: 'refresh' })).toBeUndefined()
})

// --- #358: a card finds its session by id, and the pane moves a card up -------------

const FULL = 'Plan 358: Brigade pane refreshes itself'
const BG_JOB = 'ffffffff'
const idRow = (over: Record<string, unknown> = {}) => ({ name: FULL, status: 'busy', sessionId: S1, cwd: 'C:\\work', hostSessionId: DESKTOP, statusUpdatedAt: 5, ...over })
const poll = async (w: World) => {
  await w.clock.advance(10000)
  await w.clock.settle()
}
const groupText = async (m: any, group: string) => {
  const text = await groupsOf(m)
  const heads = ['Waiting on you', 'Working', 'Done · stopped', 'Open', 'Merged', 'Closed']
  const at = text.search(new RegExp(`[▾▸] ${group}`))
  if (at < 0) return ''
  const rest = text.slice(at + 2)
  const next = Math.min(...heads.filter(h => h !== group).map(h => { const i = rest.search(new RegExp(`[▾▸] ${h}`)); return i < 0 ? Infinity : i }))
  return rest.slice(0, next)
}

test('a card finds its session by Desktop id whatever the head chef titled it, and draws the session\'s own name and live word', async ($, on) => {
  on('session.receive', (_: any, e: any) => e)
  const w = await pane(on, $, 'desktop', w => liveRows(w, [idRow()]))
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: FULL }])
  const working = await groupText(mounted, 'Working')
  expect(working.includes(FULL)).toBe(true)
  expect(working.includes('busy')).toBe(true)
  // A report counts and shows under the card's title or the session's own name.
  for (const from of ['alpha', FULL]) {
    await $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="${from}">\nnews\n</cross-session-message>` })
  }
  expect((await groupText(mounted, 'Working')).includes('news')).toBe(true)
  expect((await groupsOf(mounted)).includes('Working 4 · 2 reports')).toBe(true)
  // A card whose Desktop id no file holds is not found, even by a file named like it.
  liveRows(w, [idRow({ hostSessionId: 'local_ffffffff-0000' }), idRow({ name: 'delta', hostSessionId: undefined, sessionId: S2 })])
  await poll(w)
  expect(lastLive(w)).toEqual([])
  // The first card in the roster is alpha: its own word is the first one drawn.
  const after = await groupText(mounted, 'Working')
  expect(after.includes('not running')).toBe(true)
  expect(after.includes(FULL)).toBe(false)
  expect(after.indexOf('not running')).toBeLessThan(after.indexOf('beta'))
})

test('a session waiting on a prompt moves its working card under Waiting on you with the reason, no Dismiss, and back when it goes busy', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [idRow()]))
  expect(await mounted.find({ key: 'dismiss-0-alpha' })).toBeDefined()
  liveRows(w, [idRow({ status: 'waiting', waitingFor: 'permission prompt' })])
  await poll(w)
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'waiting · permission prompt', shown: FULL, move: 'waiting' }])
  const waiting = await groupText(mounted, 'Waiting on you')
  expect(waiting.includes(FULL)).toBe(true)
  expect(waiting.includes('waiting · permission prompt')).toBe(true)
  expect(await mounted.find({ key: 'dismiss-0-alpha' })).toBeUndefined()
  // A reason outside the fixed set draws a bare waiting.
  liveRows(w, [idRow({ status: 'waiting', waitingFor: 'anything the engine might say' })])
  await poll(w)
  expect(lastLive(w)[0].value).toBe('waiting')
  liveRows(w, [idRow()])
  await poll(w)
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: FULL }])
  expect((await groupText(mounted, 'Working')).includes(FULL)).toBe(true)
})

test('a card the head chef marked done stays where it is whatever its session file says', async ($, on) => {
  const w = await grouped(on, $, { cards: [card('alpha', { status: 'done', desktopId: DESKTOP })], todos: [] })
  liveRows(w, [idRow({ status: 'waiting', waitingFor: 'input needed' })])
  await poll(w)
  expect(lastLive(w)[0].move).toBeUndefined()
  expect(w.states.filter(([k]) => k === 'live').length).toBeGreaterThan(0)
})

test('live holds entries only for roster cards and no id from a session file; a planted move or name over its cap draws nothing', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [idRow({ jobId: BG_JOB, bridgeSessionId: 'session_X' }), idRow({ name: 'Not a card', sessionId: S2, hostSessionId: 'local_aaaa' })]))
  expect(lastLive(w)).toEqual([{ name: 'alpha', value: 'busy', shown: FULL }])
  for (const [k, v] of w.states) for (const piece of [BG_JOB, 'session_X', 'Not a card', 'C:\\\\work']) expect(`${k} ${v}`.includes(piece)).toBe(false)
  for (const [k, v] of w.states.filter(([k]) => k === 'live')) expect(`${k} ${v}`.includes(DESKTOP)).toBe(false)
  w.plant = (key: string, value: any) =>
    key === 'live' ? [{ name: 'alpha', value: 'busy', shown: 'y'.repeat(500), move: 'sideways' }] : value
  await poll(w)
  const text = await textOf(mounted)
  // A name over its cap is dropped whole, so even the 80 characters a drawn title keeps are absent.
  expect(text.includes('y'.repeat(80))).toBe(false)
  expect((await groupText(mounted, 'Waiting on you')).includes('alpha')).toBe(false)
})

test('a background card is found by its job id and shows the session\'s name, live word and link source', async ($, on) => {
  const w = await pane(on, $, 'desktop', w => liveRows(w, [{ name: 'a bg job', status: 'idle', sessionId: BG_ID, cwd: 'C:\\work', jobId: 'ab12cd34' }]))
  expect(lastLive(w)).toEqual([{ name: 'gamma', value: 'idle', shown: 'a bg job' }])
})

// --- the pane opens when the head-chef skill loads (#376) ----------------------
//
// A skill.prompt event is raised as the engine raises it: the skill's name (`skill`), its
// text, its frontmatter, its source, the plugin's name for a plugin's skill and
// the file's path. The hook's answer is the text the model reads.

const SKILL_TEXT = 'THE HEAD-CHEF SKILL TEXT'
const READY = 'The Brigade pane is open. `set_roster` is ready: call it with the full roster on your next turn.'
const NOT_OFFERED = 'The Brigade pane is open, but `set_roster` could not be offered; keep no roster.'
const ALREADY_OPEN = 'The Brigade pane was already open. `set_roster` is ready: call it with the full roster on your next turn.'
const NOT_SHOWN = 'The Brigade pane is open but not shown, so `set_roster` is not ready yet. It is offered once the pane is shown; if it does not come, ask the owner to type /brigade.'
const NO_READS = 'The Brigade pane opened without its reads, so `set_roster` is not ready. Ask the owner to type /brigade.'
const READY_UNLISTED = 'The Brigade pane is opening but not ready yet, so a `set_roster` call is refused for now. Wait for a Brigade note saying it is ready, then call it with the full roster.'
const load = ($: any, over: Record<string, unknown> = {}): Promise<{ text: string }> =>
  $.skill.prompt({ skill: 'head-chef', text: SKILL_TEXT, frontmatter: {}, source: 'plugin', pluginName: 'grimoire', path: 'C:\\skills\\head-chef\\SKILL.md', ...over })
// What follows the skill's own text.
const added = (r: { text: string }) => {
  expect(r.text.startsWith(SKILL_TEXT)).toBe(true)
  return r.text.slice(SKILL_TEXT.length).trim()
}

for (const name of ['head-chef', 'grimoire:head-chef']) {
  test(`C1: the plugin's own head-chef load (named ${name}) opens the pane, starts the reads, offers the tool and appends the ready line`, async ($, on) => {
    const w = world(on, w => {
      w.dirs(BRIGADE)
      w.put(FILE, { type: 'file', data: { text: JSON.stringify(GOOD) } })
    })
    await start($)
    const r = await load($, { skill: name })
    expect(w.open).toBe(true)
    expect(rosterOffers(w)).toEqual(['set_roster'])
    expect(added(r)).toBe(READY)
    await w.clock.settle()
    expect(w.files.at(-1)).toBe(FILE)
    expect(w.roster.some(x => JSON.stringify(x).includes('alpha'))).toBe(true)
    expect(w.usageCalls).toBeGreaterThan(0)
  })
}

test("C2: the owner's own copy (source userSettings, no plugin name) opens the pane the same way", async ($, on) => {
  const w = world(on)
  await start($)
  const r = await load($, { source: 'userSettings', pluginName: undefined })
  expect(w.open).toBe(true)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(added(r)).toBe(READY)
  await w.clock.settle()
  expect(w.files.at(-1)).toBe(FILE)
})

const NOT_OURS: [string, Record<string, unknown>][] = [
  ['projectSettings', { source: 'projectSettings', pluginName: undefined }],
  ['policySettings', { source: 'policySettings', pluginName: undefined }],
  ['mcp', { source: 'mcp', pluginName: undefined }],
  ['syncedSkills', { source: 'syncedSkills', pluginName: undefined }],
  ['built-in', { source: 'built-in', pluginName: undefined }],
  ['a plugin named other than grimoire', { pluginName: 'other' }],
  ['a plugin named other than grimoire, with the prefixed name', { skill: 'other:head-chef', pluginName: 'other' }],
  ['the prefixed name from userSettings', { skill: 'grimoire:head-chef', source: 'userSettings', pluginName: undefined }],
  ['the prefixed name from projectSettings, naming grimoire', { skill: 'grimoire:head-chef', source: 'projectSettings' }],
  ['a grimoire skill named other than head-chef', { skill: 'groundtrack' }],
  ['a user skill named other than head-chef', { skill: 'head-chef-2', source: 'userSettings', pluginName: undefined }],
]
test('C3: a head-chef from anywhere else, or another skill, opens no pane, offers no tool and returns the text unchanged', async ($, on) => {
  const w = world(on)
  await start($)
  const asked = w.panesCalls
  for (const [what, over] of NOT_OURS) {
    const r = await load($, over)
    expect(r.text, what).toBe(SKILL_TEXT)
  }
  await w.clock.settle()
  expect(w.open).toBe(false)
  expect(rosterOffers(w)).toEqual([])
  expect(w.usageCalls).toBe(0)
  // No engine call for a load that is not ours.
  expect(w.panesCalls).toBe(asked)
})

// The expected value changed in #380 (spec rev 3, S2.3): a second load with
// the pane open used to add no line and offer nothing, so a lead that loaded
// the skill again kept no tool. It still resets nothing.
test('C4: a second load with the pane open resets nothing, offers the tool again and says the pane was already open', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(SEEDED) } })
  })
  on('session.receive', (_: any, e: any) => e)
  await start($)
  await brigade($)
  await w.clock.settle()
  const m = await $.ui.mount({ plugin: 'grimoire', surface: 'desktop', component: 'Pane', requestId: 'brigade', props: PANE_PROPS })
  await m.press({ key: 'pick-0-alpha' })
  await m.press({ key: 'dismiss-1-beta' })
  await m.press({ key: 'view-prs' })
  await $.session.receive({ origin: { kind: 'peer' }, text: '<cross-session-message from="alpha">\nfinished\n</cross-session-message>' })
  const mine = (key: string) => w.states.filter(([k]) => k === key)
  const keys = ['view', 'picked', 'dismissed', 'reports']
  const before = keys.map(k => mine(k).length)
  expect(mine('view').at(-1)?.[1]).toBe('"prs"')
  expect(mine('picked').at(-1)?.[1]).toContain('alpha')
  expect(mine('dismissed').at(-1)?.[1]).toContain('beta')
  expect(mine('reports').at(-1)?.[1]).toContain('finished')
  const offers = rosterOffers(w).length
  const r = await load($)
  expect(added(r)).toBe(ALREADY_OPEN)
  expect(keys.map(k => mine(k).length)).toEqual(before)
  expect(rosterOffers(w).length).toBe(offers + 1)
  // The pane closes: the next load opens it clean.
  w.open = false
  const again = await load($)
  expect(added(again)).toBe(READY)
  expect(mine('view').at(-1)?.[1]).toBe('"sessions"')
  for (const k of ['picked', 'dismissed', 'reports']) expect(mine(k).at(-1)?.[1]).toBe('[]')
})

test('C5: the load returns while the first roster read is unanswered, and the pane shows the roster once it is', { timeoutMs: 15000 }, async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(GOOD) } })
  })
  await start($)
  w.holdStat = true
  const r = await load($)
  expect(added(r)).toBe(READY)
  expect(w.roster.some(x => JSON.stringify(x).includes('alpha'))).toBe(false)
  w.holdStat = false
  w.releaseStat()
  await w.clock.settle()
  expect(w.roster.some(x => JSON.stringify(x).includes('alpha'))).toBe(true)
})

// The expected values changed in #380 (spec rev 3, S2.5 and S2.2): a throw
// after the open used to leave the text unchanged, with a toast alone that
// nobody may see, and an unlisted pane used to add nothing.
test('C6: when the tool cannot be offered the line says so with no error text; when the listed check throws after the open, a line and a toast say so', async ($, on) => {
  const w = world(on)
  w.failRegister = true
  await start($)
  const r = await load($)
  expect(added(r)).toBe(NOT_OFFERED)
  expect(r.text).not.toContain('forced register failure')
  expect(w.toasts).toEqual([])

  // The pane closes, and the next load opens it but cannot list it.
  w.failRegister = false
  w.open = false
  w.failPanes = true
  const q = await load($)
  expect(added(q)).toBe(NO_READS)
  expect(q.text).not.toContain('forced panes failure')
  expect(w.toasts).toEqual(['The Brigade pane opened without its reads. Type /brigade to start them.'])
  expect(rosterOffers(w)).toEqual([])

  // A throw before the open says nothing and opens nothing.
  w.failPanes = false
  w.open = false
  w.failPanesClosed = true
  const early = await load($)
  expect(early.text).toBe(SKILL_TEXT)
  expect(w.toasts.length).toBe(1)
  expect(w.open).toBe(false)

  // A pane the engine does not list yet is offered the tool all the same, with
  // the ready line's not-listed form. The expected value changed in #380 (spec
  // rev 3, S2.2): it used to add no line and offer no tool, which left the
  // field test of 2026-10-24 with no roster tool and nothing said.
  w.failPanesClosed = false
  w.unlisted = true
  const unlisted = await load($)
  expect(added(unlisted)).toBe(READY_UNLISTED)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  await w.clock.settle()
})

// The owner's q5 (a) on #380: a placed pane the engine does not list yet is
// offered the tool, but its reads wait until a turn finds it listed; that turn
// starts them and adds one note that the tool now works, and offers the tool
// no second time.
test('S2.2: a placed pane the engine does not list starts no reads until a turn finds it listed, which says the tool is ready', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(GOOD) } })
  })
  await start($)
  w.unlisted = true
  expect(added(await load($))).toBe(READY_UNLISTED)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  await w.clock.settle()
  expect(w.usageCalls).toBe(0)
  expect(w.files).toEqual([])
  expect(w.ghCalls).toEqual([])
  w.unlisted = false
  await $.turn.start({ text: 'go on', turnId: 's22' })
  await w.clock.settle()
  expect(w.usageCalls).toBeGreaterThan(0)
  expect(w.files.at(-1)).toBe(FILE)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.notes).toEqual([LATE])
})

test('C7: /brigade when the engine opens the pane but never lists it replies that it opened, and offers no tool', async ($, on) => {
  const w = world(on)
  w.unlisted = true
  await start($)
  const reply = await brigade($)
  expect(reply.text).toBe('Brigade pane opened.')
  expect(rosterOffers(w)).toEqual([])
})

// The expected values changed in #380 (spec rev 3, S2.4): a load that is not
// placed used to leave the skill text unchanged, with a toast alone, which a
// session started from the phone never shows anyone.
test('C9: when the open answers that the pane is not placed, a skill load starts no reads, offers no tool, says so in a line and toasts /brigade; /brigade then starts them', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(GOOD) } })
  })
  w.unplaced = true
  await start($)
  const r = await load($)
  expect(added(r)).toBe(NOT_SHOWN)
  await w.clock.settle()
  expect(w.open).toBe(true)
  expect(rosterOffers(w)).toEqual([])
  expect(w.usageCalls).toBe(0)
  expect(w.files).toEqual([])
  expect(w.toasts).toEqual(['The Brigade pane opened but is not shown, so its reads did not start. Type /brigade to show it.'])
  // A second load, with the pane listed but still not placed, says so again and does nothing more.
  const again = await load($)
  expect(added(again)).toBe(NOT_SHOWN)
  expect(w.toasts.length).toBe(1)
  await w.clock.settle()
  expect(w.usageCalls).toBe(0)
  expect(w.files).toEqual([])
  expect(rosterOffers(w)).toEqual([])
  // /brigade, as ever, opens afresh, starts the reads and offers the tool; the engine still
  // answers not placed, so its reply says the pane is open but not shown.
  const reply = await brigade($)
  expect(reply.text).toBe('Brigade pane is open but not shown: the pane is too narrow. `set_roster` is ready: call it with the full roster.')
  await w.clock.settle()
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.files.at(-1)).toBe(FILE)
})

// --- a load that is not shown is offered the tool once it is (#380) -----------
//
// spec rev 3 on #380, S2.7: a head-chef load whose pane is open but not shown,
// as when a session's first turn comes from the phone over Remote Control,
// leaves a flag. Each turn while it is set looks at the pane once; the turn
// that finds it shown starts the reads, offers the tool and stores one note.

const LATE = 'Brigade (plugin note): The Brigade pane is now shown. `set_roster` is ready: call it with the full roster.'
let turnNo = 0
const turn = ($: any, over: Record<string, unknown> = {}) => $.turn.start({ text: 'go on', turnId: `t${++turnNo}`, ...over })

test('S2.7: a load that is not placed is offered the tool, with one note, at the first turn that finds the pane shown', async ($, on) => {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(GOOD) } })
  })
  w.unplaced = true
  await start($)
  expect(added(await load($))).toBe(NOT_SHOWN)
  // Still not shown: the turn looks, and nothing more.
  await turn($)
  await w.clock.settle()
  expect(rosterOffers(w)).toEqual([])
  expect(w.notes).toEqual([])
  // The pane is shown now: this turn starts the reads, offers the tool and says so once.
  w.unplaced = false
  await turn($)
  await w.clock.settle()
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.notes).toEqual([LATE])
  expect(w.files.at(-1)).toBe(FILE)
  // The flag is clear: a later turn asks the engine nothing.
  const asked = w.panesCalls
  await turn($)
  expect(w.panesCalls).toBe(asked)
  expect(w.notes).toEqual([LATE])
})

test('S2.7: a subagent\'s turn, and any turn with no load waiting, asks the engine nothing', async ($, on) => {
  const w = world(on)
  await start($)
  const asked = w.panesCalls
  await turn($)
  expect(w.panesCalls).toBe(asked)
  w.unplaced = true
  await load($)
  const after = w.panesCalls
  w.unplaced = false
  await turn($, { agentId: 'a1' })
  expect(w.panesCalls).toBe(after)
  expect(rosterOffers(w)).toEqual([])
  expect(w.notes).toEqual([])
})

test('S2.7: a load whose reads failed to start is offered the tool at the next turn that finds the pane shown', async ($, on) => {
  const w = world(on)
  await start($)
  w.failPanes = true
  expect(added(await load($))).toBe(NO_READS)
  w.failPanes = false
  await turn($)
  await w.clock.settle()
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.notes).toEqual([LATE])
})

test('S2.7: /brigade, or a turn that finds the pane closed, clears the flag, so no later turn offers the tool or adds a note', async ($, on) => {
  const w = world(on)
  await start($)
  w.unplaced = true
  await load($)
  await brigade($)
  w.unplaced = false
  const asked = w.panesCalls
  await turn($)
  expect(w.panesCalls).toBe(asked)
  expect(w.notes).toEqual([])

  // The engine no longer lists the pane: one look clears the flag, and the
  // next turn asks nothing.
  w.open = false
  w.unplaced = true
  await load($)
  w.open = false
  w.unplaced = false
  await turn($)
  const closed = w.panesCalls
  await turn($)
  expect(w.panesCalls).toBe(closed)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.notes).toEqual([])
})

test('S2.7: a later load that finds the pane shown clears the flag, so no turn adds the late note', async ($, on) => {
  const w = world(on)
  await start($)
  w.unplaced = true
  await load($)
  w.unplaced = false
  expect(added(await load($))).toBe(ALREADY_OPEN)
  await turn($)
  expect(w.notes).toEqual([])
})

test('S2.7: a late look that throws leaves the turn to go on and the next turn looks again; a failed offer is tried again', async ($, on) => {
  const w = world(on)
  await start($)
  w.unplaced = true
  await load($)
  w.unplaced = false
  w.failPanes = true
  expect((await turn($)).turnId).toBeDefined()
  w.failPanes = false
  w.failRegister = true
  await turn($)
  expect(rosterOffers(w)).toEqual([])
  expect(w.notes).toEqual([])
  w.failRegister = false
  await turn($)
  await w.clock.settle()
  expect(rosterOffers(w)).toEqual(['set_roster'])
  expect(w.notes).toEqual([LATE])
})

test('S2.3: a load that finds the pane open but cannot offer the tool says so', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  w.failRegister = true
  expect(added(await load($))).toBe(NOT_OFFERED)
})

// --- where the security default is seated (#380) -----------------------------
//
// spec rev 3 on #380, S3, as the owner settled it there (q5 and q6): where the
// security default is seated, a user plugin's skill.prompt hook never runs, so
// a head-chef load is seen through the call around it. Each wrapper returns
// the load's own answer. A model's Skill load that ran, with the skill hook
// skipped, opens nothing and stores one fixed note asking for /brigade. Only a
// typed load core answered opens the pane, after the local skill listing
// confirms the copy (tests/brigade-roster-rules.test.mjs tests the listing
// check and the two "ran" checks directly).

const NOTE = 'Brigade (plugin note): '
const MODEL_LOAD = `${NOTE}The Brigade pane was not opened, so \`set_roster\` is not ready: in this session a head-chef load the owner did not type opens no pane. Ask the owner to type /brigade.`
const listing = (skills: Record<string, unknown>[], total = skills.length) => ({
  context: { breakdown: { skills: { totalSkills: total, includedSkills: skills.length, tokens: 0, skillFrontmatter: skills.map(s => ({ tokens: 1, ...s })) } } },
})
const PLUGIN_COPY = { name: 'grimoire:head-chef', source: 'plugin', pluginName: 'grimoire' }
const USER_COPY = { name: 'head-chef', source: 'userSettings' }
// A world whose loads raise their skill hook through the test's own `$`.
const loads = (on: any, $: any, setup?: (w: World) => void) => {
  const w = world(on, setup)
  w.top = $
  return w
}
const skillCall = ($: any, skill: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Skill', skill, ...over })
const typed = ($: any, command: string) => $.command.run({ command, args: '' })

for (const name of ['grimoire:head-chef', 'head-chef']) {
  test(`S3: seated, the model's Skill call for ${name} returns the load's answer, opens nothing and stores the /brigade note`, async ($, on) => {
    const w = loads(on, $)
    w.seated = true
    w.usage = listing([PLUGIN_COPY, USER_COPY])
    await start($)
    const r = await skillCall($, name)
    expect(r.text).toBe(`Launching skill: ${name}`)
    await w.clock.settle()
    expect(w.open).toBe(false)
    expect(rosterOffers(w)).toEqual([])
    expect(w.notes).toEqual([MODEL_LOAD])
    expect(w.usageCalls).toBe(0)
  })
}

// A typed load ran only when core answered with its `ref`, which no test can
// give: the kit's answer beneath stands for a hook that answered the command
// in core's place. That a real typed skill carries a `ref` is the probe's
// finding on #380 (2.1.302), and the seated live run is a stated gap.
test('S3: seated, a typed /grimoire:head-chef answered without core\'s ref opens nothing and adds no note', async ($, on) => {
  const w = loads(on, $)
  w.seated = true
  w.usage = listing([PLUGIN_COPY, USER_COPY])
  await start($)
  const r = await typed($, 'grimoire:head-chef')
  expect(r.text).toBe('')
  await w.clock.settle()
  expect(w.open).toBe(false)
  expect(rosterOffers(w)).toEqual([])
  expect(w.notes).toEqual([])
  expect(w.usageCalls).toBe(0)
})

test('S3: any other skill, a subagent\'s load, and another plugin\'s head-chef pass on with no engine call', async ($, on) => {
  const w = loads(on, $)
  w.seated = true
  w.usage = listing([PLUGIN_COPY])
  await start($)
  const asked = [w.panesCalls, w.usageCalls]
  expect((await skillCall($, 'groundtrack')).text).toBe('Launching skill: groundtrack')
  expect((await skillCall($, 'grimoire:head-chef', { agentId: 'a1' })).text).toBe('Launching skill: grimoire:head-chef')
  expect((await skillCall($, 'other:head-chef')).text).toBe('Launching skill: other:head-chef')
  await w.clock.settle()
  expect([w.panesCalls, w.usageCalls]).toEqual(asked)
  expect(w.open).toBe(false)
  expect(w.notes).toEqual([])
})

test('S3: a refused, failed or unsuccessful head-chef load opens nothing and adds no note, seated or not', async ($, on) => {
  const w = loads(on, $)
  w.usage = listing([PLUGIN_COPY])
  await start($)
  for (const seated of [true, false]) {
    w.seated = seated
    for (const answer of ['deny', 'error', 'unsuccessful'] as const) {
      w.skillAnswer = answer
      await skillCall($, 'grimoire:head-chef')
      await w.clock.settle()
    }
  }
  expect(w.open).toBe(false)
  expect(rosterOffers(w)).toEqual([])
  expect(w.notes).toEqual([])
  expect(w.usageCalls).toBe(0)
})

// spec rev 3 on #380, S4: with no classic.SessionStart, session.start offers
// the warning, a resume's session.start offers set_roster again while the pane
// is listed, and the roster is named from the live session id. With no
// transcript path the config folder is a stated gap the pane names.
test('S4: seated, with no classic.SessionStart, the warning, the roster tool after a resume and the live id each still work', async ($, on) => {
  const w = loads(on, $)
  w.seated = true
  await $.session.start({ cwd: 'C:\\work' })
  expect(w.registered).toEqual(['show_permission_warning'])
  await brigade($)
  expect(rosterOffers(w)).toEqual(['set_roster'])
  // A resume is a new process: its session.start finds the pane listed.
  await $.session.start({ cwd: 'C:\\work' })
  expect(rosterOffers(w)).toEqual(['set_roster', 'set_roster'])
  // The roster is named from the id the engine gives now, so a clear's new id
  // names a new file; here no transcript names the config folder, and the
  // reason says so.
  const gap = (id: string) => `Cannot find the Claude config folder from where the plugin was loaded. The roster would be <Claude config folder>/plugins/data/grimoire-inline/brigade/${id}.json. Nothing was read.`
  await w.clock.settle()
  expect(w.errors).toContain(gap(SID))
  const NEW = '66666666-7777-8888-9999-000000000000'
  w.sid = NEW
  expect((await call($, GOOD)).text).toBe(`set_roster refused: path: ${gap(NEW)}. The roster file is unchanged.`)
})

test('S3: not seated, a wrapped load opens once through the skill hook and stores no note; a project copy opens nothing', async ($, on) => {
  const w = loads(on, $)
  w.usage = listing([PLUGIN_COPY])
  await start($)
  await skillCall($, 'grimoire:head-chef')
  await typed($, 'grimoire:head-chef')
  await w.clock.settle()
  expect(w.open).toBe(true)
  // The first load opened it; the second found it open and offered the tool again.
  expect(rosterOffers(w)).toEqual(['set_roster', 'set_roster'])
  expect(w.notes).toEqual([])

  w.open = false
  w.loadedAs = { source: 'projectSettings', pluginName: undefined }
  await skillCall($, 'head-chef')
  await w.clock.settle()
  expect(w.open).toBe(false)
  expect(rosterOffers(w)).toEqual(['set_roster', 'set_roster'])
  expect(w.notes).toEqual([])
})
