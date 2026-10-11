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
  | { type: 'file'; data: { text: string } }
  | { type: 'link'; kind: 'junction' | 'dir-symlink' | 'file-symlink'; target: string }

const key = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const parts = (p: string) => p.replace(/\//g, '\\').split('\\').filter(Boolean)

function makeFs() {
  const nodes = new Map<string, Node>()
  const log: string[] = []
  const put = (p: string, n: Node) => nodes.set(key(p), n)
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
        mtimeMs: 0,
        isLink: shape.isLink,
        ...(shape.realPath === 'target' && to !== undefined ? { realPath: to.real } : {}),
      }
    }
    const shape = RECORDED.stats[own.node.type === 'dir' ? 'folder' : 'file']
    return { kind: shape.kind, size: sizeOf(own.node), mtimeMs: 0, isLink: shape.isLink, realPath: own.real }
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
  return { nodes, log, put, dirs, walk, stat, write, text }
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
  agents: string
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
    agents: '[]',
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
  })
  w.dirs(CONFIG)
  setup(w)
  w.clock = mock.clock(on)
  on('fs.stat', ($, e: any) => {
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
    const t = w.text(e.path)
    return t === undefined ? { deny: ENOENT } : { value: t }
  })
  on('fs.exists', ($, e: any) => {
    w.existsCalls.push(e.path)
    return { deny: 'the mod must not ask exists' }
  })
  on('ui.open', () => {
    w.open = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: w.open ? [{ id: 'brigade', title: 'Brigade', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.toast', ($, e: any) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.id', () => ({ value: w.sid }))
  on('tool.check', ($, e: any) => {
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
  // Where the session is drawn: the Desktop app, unless a test says otherwise.
  on('session.surfaces', () => ({ value: w.surfaces }))
  // This session's usage reading, when a test gives one; else the kit's own.
  on('session.usage', ($, e: any, next: any) => (w.usage === undefined ? next(e) : { value: w.usage }))
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
  // The pane's own poll runs `claude agents --json` on its timer; it lists
  // `w.agents`, no session by default. Every process, an opener among them,
  // is recorded, with what it was started with. An opener can be made to fail
  // to start, or to run until released.
  on('process.run', async ($, e: any) => {
    w.procs.push([...e.argv])
    w.inits.push(e.init)
    if (OPENERS.includes(e.argv[0])) {
      w.order.push(`run ${e.argv[0]}`)
      if (w.failRun) return { deny: 'spawn failed: SECRET_TOKEN=abc123' }
      // One release lets every held opener go.
      if (w.holdRun) await new Promise<void>(res => { const before = w.releaseRun; w.releaseRun = () => { before(); res() } })
    }
    const stdout = e.argv[0] === 'claude' ? w.agents : ''
    return { value: { exitCode: e.argv[0] === 'explorer.exe' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

const start = ($: any) => $.classic.SessionStart({ source: 'startup', session_id: SID, transcript_path: TRANSCRIPT })
const brigade = ($: any) => $.command.run({ command: 'brigade', args: '' })
const call = async ($: any, input: Record<string, unknown>): Promise<{ ok: boolean; text: string }> => {
  const r = await $.tool.call({ tool: TOOL, ...input })
  if (typeof r.deny === 'string') return { ok: false, text: r.deny }
  if (r.isError) return { ok: false, text: String(r.text ?? r.result) }
  return { ok: true, text: String(r.text ?? r.result) }
}

const card = (title: string, over: Record<string, unknown> = {}) => ({ title, work: 'w', phase: 'p', settings: 's', status: 'working', ...over })
const GOOD = { cards: [card('alpha'), card('beta', { status: 'needs-you' })], todos: [{ id: 't1', text: 'look' }] }

// --- writes -------------------------------------------------------------------

test('a good roster is written whole to the session-id file, and the result names the counts', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  const r = await call($, GOOD)
  expect(r.ok).toBe(true)
  expect(r.text).toContain('2 card(s), 1 to-do(s)')
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(GOOD)
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
  expect([GOOD, second]).toContainEqual(JSON.parse(w.text(FILE) ?? 'null'))
})

// --- the pane's lifecycle -----------------------------------------------------

test('no tool before /brigade, and the tool after it; the reply names the tool and no roster path', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual([])
  const reply = await brigade($)
  expect(w.registered).toEqual(['set_roster'])
  // The expected value changed in #213 (spec v3 decision 3 on #212): the
  // reply used to carry "Roster file: <path>". No skill reads that line from
  // head-chef 0.2.0 on, Desktop rendered its path without the backslash
  // before .claude, and the pane's own top line shows the path to the owner.
  expect(reply.text).toBe('Brigade pane opened. `set_roster` is ready: call it with the full roster.')
  expect(reply.text).not.toContain('Roster file:')
  expect(reply.text).not.toContain(SID)
  // The path left the reply because the pane names it to the owner: the
  // pane's top line draws the file it was given.
  await w.clock.settle()
  expect(w.files.at(-1)).toBe(FILE)
})

test('when the config folder cannot be found, the reply names no path and the pane keeps the full reason', async ($, on) => {
  const w = world(on)
  // No session start, so no transcript path names the config folder.
  const reply = await brigade($)
  await w.clock.settle()
  expect(reply.text).toBe('Brigade pane opened. The pane cannot name the roster file, so it shows none; the pane says why. `set_roster` is ready: call it with the full roster.')
  expect(reply.text).not.toContain('Roster file:')
  expect(reply.text).not.toContain('Cannot find')
  expect(reply.text).not.toContain('\\')
  expect(reply.text).not.toContain('plugins/data')
  const full = new RegExp(`^Cannot find the Claude config folder from where the plugin was loaded \\(.+\\)\\. The roster would be <Claude config folder>/plugins/data/grimoire-inline/brigade/${SID}\\.json\\. Nothing was read\\.$`)
  expect(w.errors.some(e => full.test(e))).toBe(true)
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
  expect(w.registered).toEqual([])
  await brigade($)
  await $.classic.SessionStart({ source: 'clear', session_id: SID, transcript_path: TRANSCRIPT })
  expect(w.registered).toEqual(['set_roster', 'set_roster'])
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
  const top = await call($, JSON.parse('{"cards":[],"todos":[],"__proto__":{"polluted":1}}'))
  const nested = await call($, JSON.parse('{"cards":[{"title":"a","status":"working","__proto__":{"polluted":1}}],"todos":[]}'))
  // Measured on 2.1.292: the engine drops a __proto__ key, at the top level and
  // nested, before the call reaches the mod, so both calls write what is left.
  // Where one does reach it, the shared check refuses it, which
  // tests/brigade-roster-rules.test.mjs holds on the raw text.
  expect(top).toEqual({ ok: true, text: 'Roster kept: 0 card(s), 0 to-do(s).' })
  expect(nested).toEqual({ ok: true, text: 'Roster kept: 1 card(s), 0 to-do(s).' })
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual({ cards: [{ title: 'a', work: '', phase: '', settings: '', status: 'working' }], todos: [] })
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

test('plan and dont-ask modes refuse when the engine reports the mode', async ($, on) => {
  const w = world(on)
  await start($)
  await brigade($)
  for (const mode of ['plan', 'dontAsk']) {
    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: mode } as any)
    const r = await call($, GOOD)
    expect(r.ok).toBe(false)
    expect(r.text).toContain(`permission mode: ${mode}`)
  }
  expect(w.text(FILE)).toBeUndefined()
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'auto' } as any)
  expect((await call($, GOOD)).ok).toBe(true)
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
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(GOOD)
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
  expect(w.registered).toEqual([])
  await brigade($)
  await ($ as any).session.start({ cwd: 'C:\\work', surface: null, isInteractive: false })
  expect(w.registered).toEqual(['set_roster', 'set_roster'])
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
  expect(JSON.parse(w.text(FILE) ?? 'null')).toEqual(GOOD)
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
// pane's own `claude agents --json` poll runs on its timer, so these tests
// look for the opener only. The world is Windows, so the opener is
// explorer.exe; the host tests at the end change the host.

const DESKTOP = 'local_0123abcd-4567-89ab-cdef-0123456789ab'
const SEEDED = {
  cards: [
    card('alpha', { desktopId: DESKTOP }),
    card('beta', { url: 'https://claude.ai/code/session_ABC123' }),
    card('gamma', { bgId: 'bg1' }),
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
  w.agents = JSON.stringify([{ name: 'gamma', status: 'idle', sessionId: BG, cwd: 'C:\\work' }])
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
  w.agents = JSON.stringify([{ name: 'gamma', status: 'idle', sessionId: BG_ID, cwd: 'C:\\work' }])
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
  // Nothing else: every process but the pane's own claude agents poll.
  expect(w.procs.filter(p => p[0] !== 'claude')).toEqual([['/usr/bin/open', BG_LINK]])
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

// --- severity groups and the DONE · STOPPED fold --------------------------------
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
// The drawn text from the first group heading on, past the Waiting on you
// rows, which repeat each needs-you title.
const groupsOf = async (m: any): Promise<string> => {
  const text = await textOf(m)
  return text.slice(Math.max(0, text.indexOf('NEEDS YOU')))
}
for (const surface of SURFACES) {
  test(`${surface}: cards sit under NEEDS YOU, WORKING, then a closed DONE · STOPPED toggle, in roster order, with full badges`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    const text = await groupsOf(m)
    // The tree was drawn, not refused: its headings are there, in order.
    const at = (s: string) => text.indexOf(s)
    expect(text.startsWith('NEEDS YOU')).toBe(true)
    expect(at('NEEDS YOU')).toBeLessThan(at('need-one'))
    expect(at('need-one')).toBeLessThan(at('need-two'))
    expect(at('need-two')).toBeLessThan(at('WORKING'))
    expect(at('WORKING')).toBeLessThan(at('work-one'))
    expect(at('work-one')).toBeLessThan(at('▸ DONE · STOPPED  2'))
    expect(text.includes('● needs you')).toBe(true)
    expect(text.includes('◐ working')).toBe(true)
    // Closed on open: the done and stopped cards are not drawn.
    expect(text.includes('done-one')).toBe(false)
    expect(text.includes('stop-one')).toBe(false)
    expect((await textOf(m)).includes('Sessions')).toBe(false)
    expect(await m.find({ key: 'fold' })).toBeDefined()
    // Colour comes from the status Map: the badge and the heading both.
    const drawn = (await m.findAll({})) as { type: string; props: Record<string, unknown>; text?: string }[]
    const badge = drawn.find(n => n.type === 'Text' && n.text === '● needs you')
    expect(badge?.props.color).toBe('warning')
    const heading = drawn.find(n => n.type === 'Text' && n.props.bold === true && n.text === 'NEEDS YOU 2')
    expect(heading?.props.color).toBe('warning')
    expect(drawn.find(n => n.type === 'Text' && n.text === '◐ working')?.props.color).toBe('suggestion')
  })

  test(`${surface}: an empty group draws no heading`, async ($, on) => {
    await grouped(on, $, { cards: [card('only', { status: 'done' })], todos: [] })
    const m = await mountOn($, surface)
    const text = await textOf(m)
    expect(text.includes('▸ DONE · STOPPED  1')).toBe(true)
    expect(text.includes('NEEDS YOU')).toBe(false)
    expect(text.includes('WORKING')).toBe(false)
    expect(text.includes('No cards in the roster yet.')).toBe(false)
  })

  test(`${surface}: a roster with no cards draws no group and says there are none`, async ($, on) => {
    await grouped(on, $, { cards: [], todos: [] })
    const text = await textOf(await mountOn($, surface))
    expect(text.includes('No cards in the roster yet.')).toBe(true)
    for (const name of ['NEEDS YOU', 'WORKING', 'DONE · STOPPED']) expect(text.includes(name)).toBe(false)
  })

  test(`${surface}: a fold press opens DONE · STOPPED, with full badges, and a second press closes it`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'fold' })
    const opened = await groupsOf(m)
    expect(opened.includes('▾ DONE · STOPPED  2')).toBe(true)
    expect(opened.indexOf('▾ DONE · STOPPED')).toBeLessThan(opened.indexOf('done-one'))
    expect(opened.indexOf('done-one')).toBeLessThan(opened.indexOf('stop-one'))
    expect(opened.includes('✓ done')).toBe(true)
    expect(opened.includes('– stopped')).toBe(true)
    expect(opened.includes('○')).toBe(false)
    await m.press({ key: 'fold' })
    const closed = await groupsOf(m)
    expect(closed.includes('▸ DONE · STOPPED  2')).toBe(true)
    expect(closed.includes('done-one')).toBe(false)
  })

  test(`${surface}: DONE · STOPPED starts closed each time the pane opens`, async ($, on) => {
    const w = await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'fold' })
    expect((await groupsOf(m)).includes('▾ DONE · STOPPED')).toBe(true)
    // The pane goes from the engine's list; the next roster tick sees it and
    // stops every read. Then the owner opens it again.
    w.open = false
    await w.clock.advance(5000)
    await brigade($)
    await w.clock.settle()
    expect((await groupsOf(m)).includes('▸ DONE · STOPPED  2')).toBe(true)
  })

  test(`${surface}: a second /brigade while the pane is open closes DONE · STOPPED too`, async ($, on) => {
    await grouped(on, $, ALL)
    const m = await mountOn($, surface)
    await m.press({ key: 'fold' })
    expect((await groupsOf(m)).includes('▾ DONE · STOPPED')).toBe(true)
    await brigade($)
    expect((await groupsOf(m)).includes('▸ DONE · STOPPED  2')).toBe(true)
  })

  for (const planted of ['true', 1] as const) {
    test(`${surface}: a stored open state of ${JSON.stringify(planted)} draws the group closed, and a press cannot open it`, async ($, on) => {
      await grouped(on, $, ALL, (key, value) => (key === 'doneOpen' ? planted : value))
      const m = await mountOn($, surface)
      const text = await groupsOf(m)
      expect(text.includes('▸ DONE · STOPPED  2')).toBe(true)
      expect(text.includes('done-one')).toBe(false)
      await m.press({ key: 'fold' })
      expect((await groupsOf(m)).includes('done-one')).toBe(false)
    })
  }

  test(`${surface}: the toggle counts the reports of its cards, and an open card's report line uses →`, async ($, on) => {
    await grouped(on, $, ALL)
    const send = (from: string, text: string) =>
      $.session.receive({ origin: { kind: 'peer' }, text: `<cross-session-message from="${from}">\n${text}\n</cross-session-message>` })
    await send('done-one', 'finished the slice')
    await send('stop-one', 'stopped at a gate')
    await send('done-one', 'one more thing')
    await send('work-one', 'still going')
    const m = await mountOn($, surface)
    expect((await groupsOf(m)).includes('▸ DONE · STOPPED  2 · 3 reports')).toBe(true)
    await m.press({ key: 'fold' })
    const text = await groupsOf(m)
    expect(text.includes('→ one more thing')).toBe(true)
    expect(text.includes('→ still going')).toBe(true)
    expect(text.includes('↳')).toBe(false)
  })

  test(`${surface}: titles that fold to one slug in different groups keep their roster index, so each press acts on its own card`, async ($, on) => {
    const w = await grouped(on, $, SAME_SLUG)
    const m = await mountOn($, surface)
    await m.press({ key: 'fold' })
    await m.redraw(PANE_PROPS)
    expect(await m.find({ key: 'dismiss-1-ab' })).toBeDefined()
    expect(await m.find({ key: 'dismiss-2-ab' })).toBeDefined()
    // The group-local place of the first done or stopped card is 0: never a key.
    expect(await m.find({ key: 'dismiss-0-ab' })).toBeUndefined()
    // No working card: its group draws nothing, heading included.
    expect((await groupsOf(m)).includes('WORKING')).toBe(false)
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
    await m.press({ key: 'fold' })
    const text = await textOf(m)
    expect(text.includes('NEEDS YOU')).toBe(true)
    expect(text.includes('▾ DONE · STOPPED  2')).toBe(true)
    expect(text.includes('odd-')).toBe(false)
    expect(text.includes('__proto__')).toBe(false)
    expect(text.includes('paused')).toBe(false)
  })
}
// --- the cache bar ---------------------------------------------------------------
//
// Spec revision 3 on #250, S6 and S8; ticket #257. The warmth records and live
// states are planted as the agents poll stores them: the poll runs again on
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
  test(`${surface}: needs-you and working cards draw ◆ cache, a bar and its short text, the dim detail line, and the nudges unchanged`, async ($, on) => {
    await cached(on, $, CACHED, RECORDS)
    const m = await mountOn($, surface)
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    // Three bars: cold, amber and working. The card with no known window
    // keeps warmthLine's text, dim.
    expect(texts(all, '◆ cache').length).toBe(3)
    for (const [short, tone] of [['cold', 'error'], ['cold in 12 min', 'warning'], ['warm (working)', 'success']] as const) {
      const found = texts(all, short)
      expect(found.length).toBe(1)
      expect(found[0]?.props.color).toBe(tone)
    }
    for (const detail of ['idle 1 hr 10 min · 182k context', 'idle 48 min · 150k context', '150k context']) {
      const found = texts(all, detail)
      expect(found.length).toBe(1)
      expect(found[0]?.props.dimColor).toBe(true)
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
    expect(cacheBlocks.map(b => b.children.slice(1).map(said)).sort()).toEqual(
      [
        [],
        ['150k context'],
        ['idle 1 hr 10 min · 182k context', COLD_NUDGE],
        ['idle 48 min · 150k context', AMBER_NUDGE],
      ].sort(),
    )
    const holders = all.filter(b => b.type === 'Box' && b.props.marginLeft === 2 && b.children.some((c: any) => c?.props?.marginBottom === 1))
    expect(holders.length).toBe(4)
    for (const h of holders) {
      const at = h.children.findIndex((c: any) => c?.props?.marginBottom === 1)
      expect(said(h.children[at + 1])).toBe('p')
    }    // The old one-line ◆ text is gone where a bar draws.
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
    await m.press({ key: 'fold' })
    const all = await nodes(m)
    const text = String(all[0]?.text ?? '')
    // The group is open: its cards are drawn.
    expect(text.includes('done-one')).toBe(true)
    expect(text.includes('stop-one')).toBe(true)
    // Still three bars and one unknown line, all from the needs-you and
    // working cards; the 182k nudge only once, from need-cold.
    expect(texts(all, '◆ cache').length).toBe(3)
    expect(text.split('◆').length - 1).toBe(4)
    expect(text.split('Replying re-reads').length - 1).toBe(1)
    expect(text.split('Reply within').length - 1).toBe(1)
    const from = text.indexOf('▾ DONE · STOPPED')
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
}

// --- the Brigade heading, the status strip and the to-do bar --------------------
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
  test(`${surface}: the Brigade heading counts the shown cards, then the strip, its legend and the to-do bar, above Waiting on you`, async ($, on) => {
    await grouped(on, $, { ...ALL, todos: TODOS })
    const m = await mountOn($, surface)
    const nodes = await drawnOf(m)
    const text = await textOf(m)
    expect(nodes.some(n => n.type === 'Text' && n.text === 'Brigade' && n.props.bold === true)).toBe(true)
    const count = nodes.find(n => n.type === 'Text' && n.text === '5 sessions')
    expect(count?.props.dimColor).toBe(true)
    // The legend: each status with its glyph, count and word, in its colour,
    // in the Map's order.
    const legend = nodes.find(n => n.type === 'Text' && n.text === LEGEND)
    expect(legend).toBeDefined()
    // The line's own Text holds the entries, each a Text in its colour.
    const colours = nodes.filter(n => n.type === 'Text' && n.text !== LEGEND && /^ *[●◐✓–] \d+ /.test(n.text ?? '')).map(n => n.props.color)
    expect(colours).toEqual(['warning', 'suggestion', 'success', 'inactive'])
    expect(text.indexOf('Brigade')).toBeLessThan(text.indexOf('5 sessions'))
    expect(text.indexOf('5 sessions')).toBeLessThan(text.indexOf(LEGEND))
    expect(text.indexOf(LEGEND)).toBeLessThan(text.indexOf('To-dos'))
    expect(text.indexOf('0 of 3 done')).toBeLessThan(text.indexOf('Waiting on you'))
    expect(text.includes('Sessions')).toBe(false)
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
    await m.press({ key: 'fold' })
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
    await m.press({ key: 'fold' })
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
    await m.press({ key: 'fold' })
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
