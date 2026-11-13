// The Incantation mic band: what its levels file says, and how the band draws
// it. Pure text and numbers, so the plain tests can drive every line of it.
//
// The listener (plugins/incantation) writes ~/.grimoire/incantation/run/levels:
// one line, `<epoch ms> <state word> <24 digits>`. The digits are the mic's
// loudness, 0 to 8, one per quarter second: no audio and no text. The band
// reads that line, and a click on its button writes `mute` or `unmute` to
// run/command, which the listener reads once and removes. The mod holds no
// path of the plugin and runs no process: it only reads and writes those two
// files in the person's own folder.

export type MicWord = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'muted'
export type MicFrame = { stamp: number; word: MicWord; digits: string }

export const WORDS: readonly MicWord[] = ['listening', 'hearing', 'thinking', 'speaking', 'muted']
export const BARS = 24
const LINE = /^(\d{1,16}) (listening|hearing|thinking|speaking|muted) ([0-8]{24})\r?\n?$/

/** A reading older than this is no reading: the listener has gone. */
export const FRESH_MS = 10_000
/** The band polls this often while a listener is writing, and this often
 *  again at a slow beat while none is. */
export const TICK_MS = 250
export const SLOW_EVERY = 8
/** The colour of a new state takes this many steps, this far apart. */
export const EASE_STEPS = 4
export const EASE_MS = 75

/** The file's text as a frame, or null: any other shape, or a stamp more than
 *  FRESH_MS from `now` either way. */
export function parseLevels(text: unknown, now: number): MicFrame | null {
  if (typeof text !== 'string' || text.length > 80) return null
  const m = LINE.exec(text)
  if (m === null) return null
  const stamp = Number(m[1])
  if (!Number.isFinite(now) || Math.abs(now - stamp) > FRESH_MS) return null
  return { stamp, word: m[2] as MicWord, digits: m[3] }
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '█']
/** One block per digit, lightly smoothed with its neighbours so the row moves
 *  as a wave and not as steps; a muted mic is a flat line of dots. */
export function bars(digits: string, word: MicWord): string {
  if (word === 'muted') return '·'.repeat(BARS)
  const d = [...digits].map(c => Number(c))
  return d
    .map((v, i) => {
      const a = d[i - 1] ?? v
      const b = d[i + 1] ?? v
      return BLOCKS[Math.min(8, Math.max(0, Math.round((a + 2 * v + b) / 4)))]
    })
    .join('')
}

export const HUES: Record<MicWord, string> = {
  listening: '#6f9bd1',
  hearing: '#7ec27e',
  thinking: '#d9b25b',
  speaking: '#b490e0',
  muted: '#8a8f9c',
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
/** The colour k of the way from one hex colour to another, k from 0 to 1. */
export function mix(a: string, b: string, k: number): string {
  const t = Math.min(1, Math.max(0, k))
  return `#${[0, 1, 2].map(i => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The word's colour at a step of the change from the word before it. */
export const colorAt = (from: MicWord, to: MicWord, step: number): string => mix(HUES[from], HUES[to], step / EASE_STEPS)

export const labelOf = (word: MicWord): string => `mic: ${word}`
/** What the button says, and the one word a click writes. */
export const toggleFor = (word: MicWord): { label: string; command: 'mute' | 'unmute' } =>
  word === 'muted' ? { label: 'Unmute', command: 'unmute' } : { label: 'Mute', command: 'mute' }

const sepOf = (dir: string): string => (dir.includes('\\') ? '\\' : '/')
const runFile = (home: string, name: string): string => {
  const s = sepOf(home)
  return [home.replace(/[\\/]+$/, ''), '.grimoire', 'incantation', 'run', name].join(s)
}
export const levelsFile = (home: string): string => runFile(home, 'levels')
export const commandFile = (home: string): string => runFile(home, 'command')

/** The person's home folder from the engine's environment: an absolute path
 *  of sane length, else undefined. */
export function homeFrom(profile: unknown, home: unknown): string | undefined {
  for (const v of [profile, home]) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 260 || /[\0\r\n]/.test(v)) continue
    if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('/')) return v
  }
  return undefined
}
