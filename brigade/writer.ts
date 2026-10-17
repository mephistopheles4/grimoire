import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { dataPlace, oneLine, placeSummary, statRejection } from './roster.ts'
import type { StatAnswer } from './roster.ts'
import {
  MAX_SUMMARY_BYTES,
  askWrite,
  isSummaryFile,
  newFlight,
  newUsageMemory,
  recordCall,
  serializeSummary,
  stepCall,
  summaryFrom,
  writeDone,
} from './view.ts'

// The usage summary writer. Every session with the plugin keeps its own usage
// numbers as it works and writes them, numbers only, to its own summary file,
// brigade/usage/<session id>.json in the plugin's data folder, so the lead's
// pane can draw a member whose transcript is too large to read. No pane, no
// /brigade and no tool is needed for it to run.
//
// A `turn.step` hook passes the step on first, then records it. On the step's
// path it awaits no engine call: it reads the step's own result, keeps the
// numbers in module memory, stamps them from the module's own clock and, when
// a write is due, starts one it does not await. The writes run one at a time,
// at most every 15 s while a turn runs and at every main-loop turn end. The
// decisions are view.ts's, under its tests; this file only feeds them, stats
// and writes.
//
// It makes no session usage call, so no cost, rate limit or context breakdown
// ever enters it. The first refusal of the summary path, before or after a
// write, stops it for the rest of the module's life, with one toast.


// The engine's record of this session's start, which register.tsx's
// `classic.SessionStart` hook keeps under the same key.
const started = atom({ plugin: 'grimoire', key: 'start' } as const, { sessionId: '', transcript: '' })

let memory = newUsageMemory()
let flight = newFlight()
let stopped = false
// The session id the memory belongs to, from the engine's session start.
let sessionOf: string | undefined

// The module's clock: the engine clock's epoch, read once and never awaited
// on a step's path, carried on by `performance.now()`. Until the epoch
// arrives, the machine's own clock stands in; both read the same epoch in a
// live session (probe part 2 on #311). Whole milliseconds.
let epoch: { engine: number; perf: number } | undefined
let epochAsked = false
function readEpoch($: EngineInterface) {
  if (epochAsked) return
  epochAsked = true
  const perf = performance.now()
  $.clock.now().then(
    engine => {
      if (Number.isFinite(engine)) epoch = { engine, perf }
    },
    () => undefined,
  )
}
const now = (): number => Math.round(epoch === undefined ? Date.now() : epoch.engine + (performance.now() - epoch.perf))


// The engine follows `$` only into functions declared in the file that holds
// the hook, so these two are written here rather than imported.

// The config folder, the plugin's data id and this session's id, read at
// each write, so after a clear the file follows the new id; by the rule the
// roster uses (`dataPlace`). Undefined when no config folder can be named.
async function locate($: EngineInterface): Promise<{ config: string; plugin: string; id: string } | undefined> {
  const id = await $.session.id()
  const { config, plugin } = dataPlace($.plugin.root, $.plugin.name, await read($, started), id)
  return config === undefined ? undefined : { config, plugin, id }
}

// One resolving `stat` for the path rule, a rejection sorted into missing or
// failed by its message.
function statOf($: EngineInterface): (path: string) => Promise<StatAnswer> {
  return path =>
    $.fs.stat(path, { resolve: true }).then(
      found => ({ found }),
      err => statRejection(String(err instanceof Error ? err.message : err)),
    )
}

// The first refusal stops every later write, and says so once.
function refuse($: EngineInterface, rule: string) {
  if (stopped) return
  stopped = true
  $.ui.toast(`Brigade: the usage summary was not written, and will not be for the rest of this session: ${oneLine(rule, 200)}.`, { timeoutMs: 15000 })
}

// A write is asked for; one starts when the throttle and the single flight
// allow. Its run, and any run waiting behind it, is never awaited here.
function ask($: EngineInterface, turnEnd: boolean) {
  const r = askWrite(flight, now(), turnEnd)
  flight = r.flight
  if (r.start) void run($)
}

async function run($: EngineInterface) {
  try {
    await writeOnce($)
  } catch {
    // A write that fails is tried again at the next one due.
  } finally {
    const r = writeDone(flight, now())
    flight = r.flight
    if (r.start) void run($)
  }
}

// One write: place the file under the path rule, overwrite only a summary
// file, take the newest numbers, write, and run the path rule again after.
async function writeOnce($: EngineInterface) {
  if (stopped) return
  // No config folder named: nothing is written, and nothing was refused.
  const at = await locate($)
  if (at === undefined) return
  const placed = await placeSummary(at.config, at.plugin, at.id, statOf($))
  if ('refused' in placed) return refuse($, `the summary path failed its check (${placed.refused})`)
  if (placed.existing !== undefined) {
    const text = placed.existing.size <= MAX_SUMMARY_BYTES ? String(await $.fs.read(placed.file)) : undefined
    if (!isSummaryFile(placed.existing.size, text)) {
      return refuse($, 'the summary path holds a file that is not a summary file, so it is not overwritten')
    }
  }
  const summary = summaryFrom(memory, now())
  if (summary === undefined || stopped) return
  const text = serializeSummary(summary)
  if ('error' in text) return
  await $.fs.write(placed.file, text.value)
  // A link swapped in between the check and the write is caught here, after
  // the fact. A hard link is not.
  const after = await placeSummary(at.config, at.plugin, at.id, statOf($)).catch(() => ({ refused: 'the check could not run' }))
  const why = 'refused' in after ? after.refused : after.existing === undefined ? 'the file is not there' : undefined
  if (why !== undefined) refuse($, `the summary path failed its check after the write (${why})`)
}

/** For register.tsx's `session.start` hook, which a module load raises: the
 *  engine clock's time and `performance.now()` when it was asked, so the
 *  epoch is known before the first step. Only numbers cross: the engine
 *  follows `$` into no function of another file. The first epoch wins. */
export function writerEpoch(engine: number, perf: number) {
  epochAsked = true
  if (epoch === undefined && Number.isFinite(engine) && Number.isFinite(perf)) epoch = { engine, perf }
}

/** For register.tsx's `classic.SessionStart` hook: a clear or a resume names
 *  a new session id, and the series starts over under it, the old file left
 *  behind. Never throws. */
export function writerSession(sessionId: unknown) {
  if (typeof sessionId !== 'string') return
  if (sessionOf !== undefined && sessionOf !== sessionId) memory = newUsageMemory()
  sessionOf = sessionId
}

/** Registers the writer's two hooks. The engine takes one hook per event from
 *  a module, so the session start's work is register.tsx's to call:
 *  `writerEpoch` and `writerSession`. */
export function registerWriter(on: On) {
  // The step is passed on first. Everything after it sits in one catch, and
  // the registration's own catch passes the step through unchanged.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      if (!stopped) {
        readEpoch($)
        const call = stepCall(e, r)
        if (call !== undefined) {
          memory = recordCall(memory, call, now())
          ask($, false)
        }
      }
    } catch {
      // The step goes on unchanged.
    }
    return r
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // Every main-loop turn end writes, aborted turns included, once a call was
  // counted since the module loaded. A subagent's turn end writes nothing.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (!stopped && e.agentId === undefined && memory.calls > 0) ask($, true)
    } catch {
      // The turn ends unchanged.
    }
    return r
  }).catch(($, e, next) => next(e))
}
