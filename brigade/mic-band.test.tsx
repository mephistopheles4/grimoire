import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { commandFile, levelsFile } from './mic-view.ts'

// The Incantation mic band, driven the way the person sees it: the listener's
// levels file appears, changes and goes, and the button is pressed. Runs under
// `claude plugin test .`, which gives a plugin no file system: the hooks below
// hold a small one in memory, and the clock is the test's.

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const ON_WINDOWS = /^file:\/\/\/[A-Za-z]:/.test(import.meta.url)
const HOME = ON_WINDOWS ? 'C:\\Work\\owner' : '/work/owner'
const LEVELS = levelsFile(HOME)
const COMMAND = commandFile(HOME)
const WAVE = '000012345678765432100000'

function world(on: On) {
  const w = { files: new Map<string, string>(), writes: [] as [string, string][], reads: 0, clock: undefined as unknown as ReturnType<typeof mock.clock> }
  w.clock = mock.clock(on)
  on('env.get', (_$, e: any) => ({ value: e.name === 'USERPROFILE' || e.name === 'HOME' ? HOME : undefined }))
  on('fs.read', (_$, e: any) => {
    if (e.path === LEVELS) w.reads++
    return w.files.has(e.path) ? { value: w.files.get(e.path) } : { deny: 'ENOENT: no such file or directory' }
  })
  on('fs.write', (_$, e: any) => {
    w.writes.push([e.path, String(e.text)])
    w.files.set(e.path, String(e.text))
    return { value: undefined }
  })
  // The engine's own band: an empty box, so a hidden band draws nothing more.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return w
}
const levels = (w: ReturnType<typeof world>, word: string, digits = WAVE, at = w.clock.now()) => w.files.set(LEVELS, `${at} ${word} ${digits}\n`)
const mount = ($: any, surface: 'terminal' | 'desktop' | 'mobile', props: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'grimoire', surface, ...BAND, props: { ...BAND.props, ...props } })

describe('mic band', () => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`with no listener the band draws nothing, and with one it draws the state word, the wave and a mute button (${surface})`, async ($, on) => {
      const w = world(on)
      const ui = await mount($, surface)
      await w.clock.advance(1000)
      expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
      levels(w, 'hearing')
      // With none listening the reads come at the slow beat, two seconds apart.
      await w.clock.advance(2250)
      expect(await ui.find({ type: 'Text', text: /mic: hearing/ })).toBeDefined()
      expect(await ui.find({ key: 'mic-toggle', label: 'Mute' })).toBeDefined()
      const wave = await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█]{24}$/ })
      expect(wave).toBeDefined()
      await ui.unmount()
    })
  }

  test('the button writes mute, and once muted unmute, to the listener\'s command file and nothing else', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    levels(w, 'listening')
    await w.clock.advance(1000)
    await ui.press({ key: 'mic-toggle' })
    expect(w.writes).toEqual([[COMMAND, 'mute']])
    levels(w, 'muted')
    await w.clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: /mic: muted/ })).toBeDefined()
    expect(await ui.find({ key: 'mic-toggle', label: 'Unmute' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^·{24}$/ })).toBeDefined()
    await ui.press({ key: 'mic-toggle' })
    expect(w.writes).toEqual([[COMMAND, 'mute'], [COMMAND, 'unmute']])
    await ui.unmount()
  })

  test('the band follows the file: a new word and new digits redraw, a removed file or an old stamp clears it', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'terminal')
    levels(w, 'listening', '0'.repeat(24))
    await w.clock.advance(500)
    expect(await ui.find({ type: 'Text', text: /mic: listening/ })).toBeDefined()
    levels(w, 'speaking')
    await w.clock.advance(500)
    expect(await ui.find({ type: 'Text', text: /mic: speaking/ })).toBeDefined()
    w.files.delete(LEVELS)
    await w.clock.advance(500)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    levels(w, 'hearing', WAVE, w.clock.now() - 60_000)
    await w.clock.advance(2000)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    await ui.unmount()
  })

  test('a file that is not the listener\'s shape draws nothing: wrong word, short row, a digit past 8, a long line', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    for (const text of [`${w.clock.now()} shouting ${WAVE}\n`, `${w.clock.now()} hearing 0123\n`, `${w.clock.now()} hearing ${'9'.repeat(24)}\n`, `${w.clock.now()} hearing ${WAVE} words here`, 'x'.repeat(200)]) {
      w.files.set(LEVELS, text)
      await w.clock.advance(500)
      expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    }
    await ui.unmount()
  })

  test('a survey holds the band: nothing is drawn over it', async ($, on) => {
    const w = world(on)
    levels(w, 'hearing')
    const ui = await mount($, 'desktop', { hasSurvey: true })
    await w.clock.advance(1000)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    await ui.unmount()
  })

  test('the reads: four a second while a listener writes, about one a second and a half without', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    await w.clock.advance(8000)
    const idle = w.reads
    expect(idle).toBeLessThanOrEqual(5)
    levels(w, 'listening')
    w.reads = 0
    for (let i = 0; i < 8; i++) {
      levels(w, 'listening')
      await w.clock.advance(1000)
    }
    // Back at the fast beat within one slow beat, then four a second.
    expect(w.reads).toBeGreaterThanOrEqual(24)
    expect(w.reads).toBeLessThanOrEqual(34)
    await ui.unmount()
  })
})
