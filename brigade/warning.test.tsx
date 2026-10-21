import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { WORDING, versionOf } from './warning-text.ts'

// The permission warning, driven the way the head-chef skill and the owner
// drive it: the model calls the tool, the owner presses the band's buttons, and
// a later session starts. Runs under `claude plugin test .`.

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const START = { cwd: 'C:\\work', surface: null, isInteractive: true } as const

// What a session answers beneath the plugin: just enough for the Brigade
// mod's own start, with no pane open, and a store the test can seed, or one
// that cannot be written.
function session(on: On, entries?: Record<string, unknown> | 'unwritable') {
  const w = { registered: [] as string[], verdict: { decision: 'allow' } as Record<string, unknown> }
  on('tool.check', () => w.verdict as any)
  on('classic.SessionStart', () => ({}))
  if (entries === 'unwritable') {
    on('store.get', () => ({ value: undefined }) as any)
    on('store.set', () => {
      throw new Error('the store cannot be written')
    })
  } else {
    mock.store(on, entries)
  }
  mock.clock(on)
  on('session.start', ($, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($, e: any) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.id', () => ({ value: 'a1b2c3d4-0000-4000-8000-000000000000' }))
  on('tool.register', ($, e: any) => {
    w.registered.push(e.name)
    return { value: { tool: `mcp__grimoire__${e.name}` } }
  })
  // The engine's own band: nothing, so a hidden band draws an empty tree.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return w
}
const call = ($: any, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'mcp__grimoire__show_permission_warning', ...extra })
const mount = ($: any, surface: 'terminal' | 'desktop' | 'mobile') => $.ui.mount({ plugin: 'grimoire', surface, ...BAND })

describe('permission warning', () => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`no band before the tool, the band after it, hidden for the session by I understand (${surface})`, async ($, on) => {
      const w = session(on)
      await $.session.start(START)
      expect(w.registered).toContain('show_permission_warning')
      const before = await mount($, surface)
      expect(await before.find({ key: 'understand' })).toBeUndefined()
      await before.unmount()

      const r = await call($)
      expect(String(r.result)).toMatch(/shown above the prompt/)
      const ui = await mount($, surface)
      // Every line of the wording, whole, and the button by its label.
      for (const line of WORDING) {
        const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect(await ui.find({ type: 'Text', text: new RegExp(escaped) })).toBeDefined()
      }
      expect(await ui.find({ key: 'understand', label: 'I understand' })).toBeDefined()
      await ui.press({ key: 'understand' })
      expect(await ui.find({ key: 'understand' })).toBeUndefined()
      await ui.unmount()

      // Without the box ticked, the next lead shows it again.
      await $.session.start(START)
      await call($)
      const later = await mount($, surface)
      expect(await later.find({ key: 'understand' })).toBeDefined()
    })
  }

  test("Don't show again, then I understand, hides it in every later lead", async ($, on) => {
    session(on)
    await $.session.start(START)
    await call($)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'dont-show' })
    expect(await ui.find({ key: 'dont-show', label: /☑/ })).toBeDefined()
    await ui.press({ key: 'understand' })
    await ui.unmount()

    await $.session.start(START)
    const r = await call($)
    expect(String(r.result)).toMatch(/Don't show again/)
    const later = await mount($, 'desktop')
    expect(await later.find({ key: 'understand' })).toBeUndefined()
  })

  test("a store that cannot be written still lets I understand hide the band for this session", async ($, on) => {
    session(on, 'unwritable')
    await $.session.start(START)
    await call($)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'dont-show' })
    await ui.press({ key: 'understand' })
    expect(await ui.find({ key: 'understand' })).toBeUndefined()
  })

  test('ticking the box twice unticks it, and I understand then hides it for this session only', async ($, on) => {
    session(on)
    await $.session.start(START)
    await call($)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'dont-show' })
    await ui.press({ key: 'dont-show' })
    expect(await ui.find({ key: 'dont-show', label: /☐/ })).toBeDefined()
    await ui.press({ key: 'understand' })
    await ui.unmount()

    await $.session.start(START)
    await call($)
    const later = await mount($, 'desktop')
    expect(await later.find({ key: 'understand' })).toBeDefined()
  })

  test("a Don't show again for older wording leaves the band up, and says the wording changed", async ($, on) => {
    session(on, { 'permission-warning-ack': { at: '2026-01-01T00:00:00.000Z', version: 'old' } })
    await $.session.start(START)
    await call($)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ key: 'understand' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /wording changed/ })).toBeDefined()
  })

  test("a Don't show again for this wording keeps it hidden from the first call", async ($, on) => {
    session(on, { 'permission-warning-ack': { at: '2026-01-01T00:00:00.000Z', version: versionOf(WORDING) } })
    await $.session.start(START)
    const r = await call($)
    expect(String(r.result)).toMatch(/stays hidden/)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ key: 'understand' })).toBeUndefined()
  })

  test('a clear or a resume offers the tool again', async ($, on) => {
    const w = session(on)
    await $.session.start(START)
    expect(w.registered).toEqual(['show_permission_warning'])
    await $.classic.SessionStart({ source: 'clear', session_id: 'a1b2c3d4-0000-4000-8000-000000000000', transcript_path: 'C:\\work\\t.jsonl' })
    expect(w.registered).toEqual(['show_permission_warning', 'show_permission_warning'])
  })

  test("the owner's deny rule, or an ask rule naming the tool, refuses the call and shows nothing", async ($, on) => {
    const w = session(on)
    await $.session.start(START)
    for (const verdict of [{ decision: 'deny', reason: 'no' }, { decision: 'ask', rule: 'mcp__grimoire__show_permission_warning' }]) {
      w.verdict = verdict
      const r = await call($)
      expect(String(r.deny)).toMatch(/owner's rules/)
      const ui = await mount($, 'desktop')
      expect(await ui.find({ key: 'understand' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a stored time that is not a date is never drawn', async ($, on) => {
    session(on, { 'permission-warning-ack': { at: 'evil\u{202E}text', version: 'old' } })
    await $.session.start(START)
    await call($)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /wording changed since you chose Don't show again\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /evil/ })).toBeUndefined()
  })

  test("a subagent's call is refused and shows nothing", async ($, on) => {
    session(on)
    await $.session.start(START)
    const r = await call($, { agentId: 'sub-1' })
    expect(String(r.deny)).toMatch(/only the lead session/)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ key: 'understand' })).toBeUndefined()
  })
})
