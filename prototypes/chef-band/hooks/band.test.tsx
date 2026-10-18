import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CAPABILITIES, versionOf } from './register'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const START = { cwd: 'C:\work', surface: null, isInteractive: true } as const

// What a session answers beneath the plugin: its start and command registry.
function session(on: On, entries?: Record<string, unknown>) {
  mock.store(on, entries)
  mock.clock(on)
  on('session.start', ($, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($, e: any) => ({ value: { command: e.name } }))
  // The engine's own band: nothing, so a hidden band draws an empty tree.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
}
const chefBand = ($: any) => $.command.run({ command: 'chef-band', args: '' })

describe('chef-band', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`no band before /chef-band, a band after it, gone after I understand (${surface})`, async ($, on) => {
      session(on)
      await $.session.start(START)
      const before = await $.ui.mount({ plugin: 'chef-band', surface, ...BAND })
      expect(await before.find({ key: 'understand' })).toBeUndefined()
      await before.unmount()

      await chefBand($)
      const ui = await $.ui.mount({ plugin: 'chef-band', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /Any device signed in/ })).toBeDefined()
      await ui.press({ key: 'understand' })
      expect(await ui.find({ key: 'understand' })).toBeUndefined()
      await ui.unmount()

      // A fresh start reads the acknowledgement back from the store.
      await $.session.start(START)
      const later = await $.ui.mount({ plugin: 'chef-band', surface, ...BAND })
      expect(await later.find({ key: 'understand' })).toBeUndefined()
    })
  }

  test('an acknowledgement of another version leaves the band up', async ($, on) => {
    session(on, { ack: { at: '2026-01-01T00:00:00.000Z', version: 'old' } })
    await $.session.start(START)
    await chefBand($)
    const ui = await $.ui.mount({ plugin: 'chef-band', surface: 'desktop', ...BAND })
    expect(await ui.find({ key: 'understand' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /list changed/ })).toBeDefined()
  })

  test('the version moves when a line changes', () => {
    expect(versionOf([...CAPABILITIES, 'x'])).not.toBe(versionOf(CAPABILITIES))
  })
})
