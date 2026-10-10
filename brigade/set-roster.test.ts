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
async function pane(on: On, $: any) {
  const w = world(on, w => {
    w.dirs(BRIGADE)
    w.put(FILE, { type: 'file', data: { text: JSON.stringify(SEEDED) } })
  })
  await start($)
  await brigade($)
  await w.clock.settle()
  mounted = await $.ui.mount({ plugin: 'grimoire', surface: 'desktop', component: 'Pane', requestId: 'brigade', props: PANE_PROPS })
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