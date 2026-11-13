import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { EASE_MS, EASE_STEPS, SLOW_EVERY, TICK_MS, WORDS, colorAt, commandFile, fullWidth, homeFrom, labelOf, levelsFile, parseLevels, toggleFor } from './mic-view.ts'
import type { MicFrame, MicWord } from './mic-view.ts'
import { orbSvg } from './mic-svg.ts'

// The Incantation mic band: a row above the prompt that shows what the voice
// listener is doing, a wave of what it hears, and a button that mutes and
// unmutes it. The terminal's status line is not drawn by the desktop app, so
// this is the one place both draw. The terminal draws the wave as two block
// rows as wide as the terminal; the other surfaces draw an orb with the wave
// flowing out of it, as an `Svg` image (mic-svg.ts).
//
// It reads one file the listener writes, run/levels, four times a second while
// a listener is writing and once in eight ticks while none is, and it writes
// one word, mute or unmute, to run/command when the button is pressed. It
// holds the mic's loudness as 24 digits and nothing of what was said, runs no
// process and keeps nothing across sessions. With no listener, it draws nothing.

const frameAtom = atom({ plugin: 'grimoire', key: 'micFrame' } as const, null)
const prevAtom = atom({ plugin: 'grimoire', key: 'micPrev' } as const, '')
const easeAtom = atom({ plugin: 'grimoire', key: 'micEase' } as const, { from: 'listening', to: 'listening', step: EASE_STEPS })

/** How far ahead of the clock each picture is laid out, ms: the desktop starts
 *  a picture's animations a moment after the draw. Fixed, from a live trial. */
const LEAD_MS = 100

let timer: Timer | undefined
let eases: Timer[] = []
let generation = 0
let quiet = 0

const wordOf = (v: unknown): MicWord => ((WORDS as readonly unknown[]).includes(v) ? (v as MicWord) : 'listening')

const homeOf = async ($: EngineInterface): Promise<string | undefined> => homeFrom(await $.env.get('USERPROFILE'), await $.env.get('HOME'))

// One reading. A file that is not there clears the band at once; one that
// will not read leaves what it showed until its stamp goes stale.
async function tick($: EngineInterface, dir: string, live: () => boolean) {
  if (!live()) return
  const path = levelsFile(dir)
  const now = await $.clock.now()
  // A file that is not there is no listener: null at once. Any other read
  // failure (a rename mid-write on Windows) is no new reading.
  let next: MicFrame | null | undefined
  try {
    next = parseLevels(String(await $.fs.read(path)), now)
  } catch (e) {
    next = /ENOENT|no such file|not found/i.test(String((e as Error)?.message ?? e)) ? null : undefined
  }
  if (!live()) return
  const was = (await read($, frameAtom)) as MicFrame | null
  if (next === undefined) next = was !== null && Math.abs(now - was.stamp) <= 10_000 ? was : null
  quiet = next === null ? quiet + 1 : 0
  if (next === null && was === null) return
  if (next !== null && was !== null && next.word === was.word && next.digits === was.digits) return
  // Every new reading is drawn (four a second), and nothing between: the band
  // redraws only when it draws, since each redraw puts up a new picture and one
  // in between flashed. A change of word draws at once, as any new reading does.
  await update($, prevAtom, () => (was === null ? '' : was.digits))
  await update($, frameAtom, () => next)
  if (next !== null && (was === null || was.word !== next.word)) {
    const from = was === null ? next.word : wordOf(was.word)
    const to = next.word
    await update($, easeAtom, () => ({ from, to, step: 0 }))
    for (const t of eases) t.cancel()
    eases = []
    for (let i = 1; i <= EASE_STEPS; i++) {
      eases.push($.clock.after(EASE_MS * i, () => void (live() && update($, easeAtom, s => (s.to === to ? { ...s, step: i } : s)))))
    }
  }
}

// The reads start at the first draw of the band, once: the mod has one
// session.start hook already, and the band draws as soon as the prompt does.
// A draw writes no state, so the reads are told apart by their own beat: the
// timer stamps each period on the engine clock, and a stamp within a second
// of now means they run. A timer that has gone quiet, one a reload left
// behind, or a clock that has started over, is started again.
const ALIVE_MS = 1000
let beat = -Infinity
let starting = false
async function begin($: EngineInterface) {
  if (starting) return
  starting = true
  try {
    const now = await $.clock.now()
    if (timer !== undefined && now - beat >= 0 && now - beat <= ALIVE_MS) return
    timer?.cancel()
    const dir = await homeOf($)
    if (dir === undefined) return
    const mine = ++generation
    const live = () => generation === mine
    quiet = 0
    beat = now
    let skip = 0
    timer = $.clock.every(TICK_MS, () => {
      if (!live()) return
      void Promise.resolve($.clock.now()).then(t => (beat = t), () => undefined)
      // With no listener writing, one tick in SLOW_EVERY reads.
      if (quiet > 0) {
        skip = (skip + 1) % SLOW_EVERY
        if (skip !== 0) return
      }
      void tick($, dir, live).catch(() => undefined)
    })
  } finally {
    starting = false
  }
}

// What the picture last drew. Its clock is taken once per reading, when that
// reading is first drawn: any other redraw of the same reading (the colour
// easing when the word changes, a button press) makes the very same picture,
// so the desktop keeps it running instead of restarting it.
let shown = { stamp: -1, t: 0, digits: '', prev: '', word: 'listening', at: 0 }

// The moment of the newest reading, kept by the mod itself. The listener's
// stamp is when it wrote the file, which can be a reading early or late, and
// that slid the whole loudness outline by a reading against the wave. Instead,
// match the new readings against the last ones to see how many places they
// moved, and advance by exactly that many readings (the stamp's expected shift
// weighs the match). The stamp only resets the count when it drifts by more
// than two readings.
let line = { t: -1, stamp: 0, digits: '' }
function advance(stamp: number, digits: string, ms: number): number {
  if (line.t < 0 || line.digits.length !== digits.length) {
    line = { t: stamp, stamp, digits }
    return line.t
  }
  const n = digits.length
  const expected = (stamp - line.stamp) / ms
  let best = 0
  let bestScore = Infinity
  for (let k = 0; k <= Math.min(8, n - 4); k++) {
    let miss = 0
    for (let i = 0; i < n - k; i++) if (digits[i] !== line.digits[i + k]) miss++
    const score = miss / (n - k) + 0.15 * Math.abs(k - expected)
    if (score < bestScore) {
      bestScore = score
      best = k
    }
  }
  let t = line.t + best * ms
  if (Math.abs(t - stamp) > 2 * ms) t = stamp
  line = { t, stamp, digits }
  return t
}

export function registerMic(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // With nothing to draw the hook hands the chain on untouched, so a session
    // with no listener sees the band exactly as it was.
    let frame: MicFrame | null = null
    try {
      await begin($)
      frame = e.props.hasSurvey ? null : ((await read($, frameAtom)) as MicFrame | null)
      if (frame !== null && parseLevels(`${frame.stamp} ${frame.word} ${frame.digits}`, frame.stamp) === null) frame = null
    } catch {
      frame = null
    }
    if (frame === null) return next(e)
    const beneath = await next(e)
    try {
      const ease = await read($, easeAtom)
      const word = wordOf(frame.word)
      const color = colorAt(wordOf(ease.from), wordOf(ease.to), Math.min(EASE_STEPS, Math.max(0, Math.trunc(Number(ease.step)) || 0)))
      const toggle = toggleFor(word)
      const terminal = e.surface === 'terminal'
      // A new reading: take its picture clock now, once.
      if (!terminal && shown.stamp !== frame.stamp) {
        const prev = String((await read($, prevAtom)) ?? '')
        shown = { stamp: frame.stamp, t: advance(frame.stamp, frame.digits, TICK_MS), digits: frame.digits, prev: shown.digits || prev, word, at: Number(await $.clock.now()) }
      }
      const els = $.ui.resolve(e) as unknown as Record<string, (p: unknown) => unknown>
      const { Box, Button, Text } = $.ui.resolve(e)
      const Svg = els.Svg as any
      const columns = (e as { viewport?: { columns?: number } }).viewport?.columns
      // Every animation in the picture begins this far in the past.
      const el = Number(await $.clock.now()) - shown.at
      return (
        <Box key="mic-band" flexDirection="column">
          <Box key="mic-row" flexDirection="row" alignItems="center" gap="md">
            <Text color={color} bold>
              {labelOf(word)}
            </Text>
            <Button
              key="mic-toggle"
              label={toggle.label}
              onPress={async () => {
                // Only for a listener that is writing now: the file is the listener's own folder's.
                const dir = await homeOf($)
                const now = (await read($, frameAtom)) as MicFrame | null
                if (dir === undefined || now === null) return
                await $.fs.write(commandFile(dir), toggleFor(wordOf(now.word)).command)
              }}
            />
          </Box>
          {terminal ? (
            <Box key="mic-wave" flexDirection="column" overflow="hidden">
              {fullWidth(frame.digits, word, columns ?? 80).map((row, i) => (
                <Text key={`wave-${i}`} color={color} wrap="truncate-end">
                  {row}
                </Text>
              ))}
            </Box>
          ) : (
            <Box key="mic-wave" flexDirection="column" width="100%">
              <Svg key="mic-svg" source={orbSvg(shown.prev, shown.digits, wordOf(shown.word), TICK_MS, shown.t, shown.at + LEAD_MS, el)} alt={labelOf(word)} height={44} isInteractive={false} />
            </Box>
          )}
          {beneath}
        </Box>
      )
    } catch {
      return beneath
    }
  }).catch(($, e, next) => next(e))
}
