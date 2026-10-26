import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'decisions-proto',
  component: 'Pane',
  requestId: 'decisions-proto',
  props: { title: 'Brigade · PROTOTYPE 402', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('each variant draws, opens a row and ticks it, on terminal and desktop', async ($, on) => {
  on('command.register', () => ({ value: { command: 'decisions-proto' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /9 decisions · 5 unread/ }))?.text).toBe('9 decisions · 5 unread')
    await ui.press({ key: 'open:d9:log' })
    expect(await ui.find({ type: 'Text', text: /cache key needs the locale/ })).toBeTruthy()
    await ui.press({ key: 'read:d9:log' })
    expect(await ui.find({ type: 'Text', text: /4 unread/ })).toBeTruthy()
    for (const v of ['B', 'C']) {
      await ui.press({ key: `var:${v}` })
      expect(await ui.find({ type: 'Text', text: new RegExp(`variant ${v}`) })).toBeTruthy()
    }
    await ui.press({ key: 'fold:handoff' })
    expect(await ui.find({ type: 'Text', text: /How to resume/ })).toBeTruthy()
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'var:A' })
    await ui.unmount()
  }
})
