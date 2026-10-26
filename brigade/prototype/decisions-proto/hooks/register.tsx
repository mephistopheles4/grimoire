import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// PROTOTYPE for grimoire issue 402. Throwaway: nothing here merges.
// Question: what should a third Brigade tab, Decisions, look like?
// A pane drawn with the same elements and fills as the Brigade pane
// (brigade/register.tsx), its Sessions and Pull requests tabs stubbed, and
// three variants of the Decisions tab switched by the V buttons at its foot:
// A a ruled log, B a review queue, C grouped by session. Invented sample data.
// Opened with /decisions-proto.

const PANE = 'decisions-proto'
const variantAtom = atom({ plugin: 'decisions-proto', key: 'variant' } as const, 'B')
const tabAtom = atom({ plugin: 'decisions-proto', key: 'tab' } as const, 'decisions')
const filterAtom = atom({ plugin: 'decisions-proto', key: 'filter' } as const, 'all')
const readAtom = atom({ plugin: 'decisions-proto', key: 'read' } as const, ['d1', 'd2', 'd3', 'd4'])
const flaggedAtom = atom({ plugin: 'decisions-proto', key: 'flagged' } as const, ['d6'])
const openAtom = atom({ plugin: 'decisions-proto', key: 'open' } as const, [])
const foldedAtom = atom({ plugin: 'decisions-proto', key: 'folded' } as const, ['handoff', 'history'])
// The picked rows, and the rows the Dismiss island took off the list.
const pickedAtom = atom({ plugin: 'decisions-proto', key: 'picked' } as const, [])
const dismissedAtom = atom({ plugin: 'decisions-proto', key: 'dismissed' } as const, [])
// The autonomy slider: 1 Manual, 2 Auto, 3 Full throttle.
const levelAtom = atom({ plugin: 'decisions-proto', key: 'level' } as const, 2)
const levelDefaultAtom = atom({ plugin: 'decisions-proto', key: 'levelDefault' } as const, 2)
const queueAtom = atom({ plugin: 'decisions-proto', key: 'queue' } as const, 0)

// Brigade's fills (DARK_FILLS in brigade/register.tsx).
const FILLS = { pane: '#1a1a19', bar: '#2b2b2a', hover: '#262625', tip: '#3a3a38' } as const
const noop = () => {}

type Decision = { id: string; at: string; source: 'lead' | 'owner'; session: string; work: string; question: string; options: string[]; pick: string; why: string; undo: string; revisit: string }
// Fields follow the 2026-10-25 register: at, source, session, work, question,
// options, pick, why, undo, revisit. Newest first.
const DECISIONS: Decision[] = [
  { id: 'd9', at: '2026-10-26T11:32', source: 'lead', session: 'sample-412', work: 'issue 412', question: 'The spec pair disagree on whether the cache key needs the locale. Fold the finding or defer it?', options: ['Fold it into the spec now', 'Defer with a named trigger', 'Ask the owner'], pick: 'Fold it into the spec now', why: 'Cheap to reverse, and the standing instruction covers spec findings with a clear fix.', undo: 'Revert the spec commit that adds the locale to the key.', revisit: 'When 412 reaches Test' },
  { id: 'd8', at: '2026-10-26T10:58', source: 'owner', session: 'sample-388', work: 'PR 391', question: 'Merge 391 now, or wait for the batched visual check?', options: ['Wait for the batched check', 'Merge now'], pick: 'Wait for the batched check', why: 'The owner prefers one Desktop check per chain.', undo: 'None needed: nothing merged.', revisit: '' },
  { id: 'd7', at: '2026-10-26T10:41', source: 'lead', session: 'sample-412', work: 'issue 412', question: 'Model for the build session?', options: ['Sonnet, medium (tier default)', 'Opus, high'], pick: 'Sonnet, medium (tier default)', why: 'Standard tier, nothing on the sensitive list.', undo: 'Stop the session and restart it on Opus.', revisit: '' },
  { id: 'd6', at: '2026-10-26T09:15', source: 'lead', session: 'sample-405', work: 'issue 405', question: 'A lens report names a flaky test. File a follow-up or note it?', options: ['Note it in the review record', 'File a follow-up issue'], pick: 'Note it in the review record', why: 'The review already filed two follow-ups, the cost limit.', undo: 'File the issue from the note.', revisit: 'Next retro' },
  { id: 'd5', at: '2026-10-26T08:02', source: 'owner', session: 'lead', work: 'brigade', question: 'Which autonomy level for today?', options: ['2 Auto, with the usual owner list', '1 Manual', '3 Full throttle'], pick: '2 Auto, with the usual owner list', why: 'The owner is away until the afternoon.', undo: 'Slide autonomy back to 1 in this tab.', revisit: '' },
  { id: 'd4', at: '2026-10-25T18:44', source: 'lead', session: 'sample-399', work: 'PR 400', question: 'CI is red on a scan that reports late. Rerun or wait?', options: ['Wait for the scan to report', 'Rerun the job'], pick: 'Wait for the scan to report', why: 'A pending required scan reads as blocked; it clears by itself.', undo: 'Rerun the job.', revisit: '' },
  { id: 'd3', at: '2026-10-25T16:20', source: 'lead', session: 'sample-399', work: 'issue 399', question: 'Archive the finished session now?', options: ['Keep it until its worktree is checked', 'Archive it now'], pick: 'Keep it until its worktree is checked', why: 'Archiving is the owner\u{2019}s call after a worktree check.', undo: 'Archive it by hand.', revisit: '' },
  { id: 'd2', at: '2026-10-25T14:05', source: 'owner', session: 'sample-396', work: 'PR 398', question: 'Accept the review and merge 398?', options: ['Merge', 'Hold for another pass'], pick: 'Merge', why: 'The owner checked it on Desktop.', undo: 'Revert the merge commit.', revisit: '' },
  { id: 'd1', at: '2026-10-25T11:30', source: 'lead', session: 'sample-396', work: 'issue 396', question: 'Which tier to propose?', options: ['Standard', 'Quick'], pick: 'Standard', why: 'It touches the pane\u{2019}s press handling and needs a short spec.', undo: 'Re-propose the tier.', revisit: '' },
]
const HANDOFF: { updated: string; sections: [string, string[]][] } = {
  updated: '11:35',
  sections: [
    ['How to resume', ['Read this hand-off, then the roster', 'Re-verify each session\u{2019}s link before taking its messages']],
    ['Rules in force', ['Autonomy 2, Auto: lead picks outside the owner list', 'Owner list: merges, installs, publishing, accepted risks']],
    ['Running sessions', ['sample-412: spec review', 'sample-405: build, tests green']],
    ['Cleanup waiting', ['sample-399: worktree check, then archive']],
    ['Open for the owner', ['PR 391: batched visual check', 'Flagged: 1 decision to revisit']],
  ],
}
const VARIANTS: [string, string][] = [
  ['A', 'Ruled log'],
  ['B', 'Review queue'],
  ['C', 'By session'],
]
const FILTERS = ['all', 'unread', 'lead', 'owner', 'flag']
const IDS = new Set(DECISIONS.map(d => d.id))
const time = (d: Decision) => d.at.slice(11, 16)
const day = (d: Decision) => (d.at.slice(0, 10) === '2026-10-26' ? 'Today' : 'Yesterday')
const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter(y => y !== x) : [...list, x])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'decisions-proto', description: 'PROTOTYPE 402: open the Decisions tab prototype pane' })
    void $.ui.open({ id: PANE, title: 'Brigade · PROTOTYPE 402' })
    return next(e)
  })

  on('command.run', { command: 'decisions-proto' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Brigade · PROTOTYPE 402' })
    return { text: 'Decisions prototype pane opened.' }
  })

  on('ui.press', { requestId: PANE }, async ($, e) => {
    const [verb, arg = ''] = e.element.split(':')
    if (verb === 'var' && VARIANTS.some(v => v[0] === arg)) await update($, variantAtom, () => arg)
    if (verb === 'tab' && ['sessions', 'prs', 'decisions'].includes(arg)) await update($, tabAtom, () => arg)
    if (verb === 'filter' && FILTERS.includes(arg)) await update($, filterAtom, () => arg)
    if (verb === 'fold') await update($, foldedAtom, l => toggle(l, arg))
    if (IDS.has(arg)) {
      if (verb === 'open') await update($, openAtom, l => toggle(l, arg))
      if (verb === 'read') await update($, readAtom, l => toggle(l, arg))
      if (verb === 'pick') await update($, pickedAtom, l => toggle(l, arg))
      if (verb === 'flag') await update($, flaggedAtom, l => toggle(l, arg))
      if (verb === 'readnext') await update($, readAtom, l => (l.includes(arg) ? l : [...l, arg]))
    }
    if (verb === 'skip') await update($, queueAtom, n => n + 1)
    if (verb === 'bardismiss') {
      const chosen = await read($, pickedAtom)
      await update($, dismissedAtom, l => [...new Set([...l, ...chosen])])
      await update($, pickedAtom, () => [])
    }
    if (verb === 'barclear') await update($, pickedAtom, () => [])
    if (verb === 'level' && ['1', '2', '3'].includes(arg)) await update($, levelAtom, () => Number(arg))
    if (verb === 'leveldef') {
      const next = ((await read($, levelDefaultAtom)) % 3) + 1
      await update($, levelDefaultAtom, () => next)
      await update($, levelAtom, () => next)
    }
    if (verb === 'reset') {
      await update($, readAtom, () => ['d1', 'd2', 'd3', 'd4'])
      await update($, flaggedAtom, () => ['d6'])
      await update($, openAtom, () => [])
      await update($, foldedAtom, () => ['handoff', 'history'])
      await update($, pickedAtom, () => [])
      await update($, dismissedAtom, () => [])
      await update($, queueAtom, () => 0)
      await update($, filterAtom, () => 'all')
      await update($, levelDefaultAtom, () => 2)
      await update($, levelAtom, () => 2)
    }
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const terminal = !('Svg' in table) || e.surface === 'terminal'
    const pointer = e.surface === 'desktop'

    const variant = await read($, variantAtom)
    const tab = await read($, tabAtom)
    const filter = await read($, filterAtom)
    const readSet = new Set(await read($, readAtom))
    const flagged = new Set(await read($, flaggedAtom))
    const opened = new Set(await read($, openAtom))
    const folds = new Set(await read($, foldedAtom))
    const level = await read($, levelAtom)
    const levelDefault = await read($, levelDefaultAtom)
    const queueAt = await read($, queueAtom)
    const picks = new Set(await read($, pickedAtom))
    const gone = new Set(await read($, dismissedAtom))

    const kept = DECISIONS.filter(d => !gone.has(d.id))
    const unread = kept.filter(d => !readSet.has(d.id))
    const shown = kept.filter(d =>
      filter === 'unread' ? !readSet.has(d.id) : filter === 'lead' ? d.source === 'lead' : filter === 'owner' ? d.source === 'owner' : filter === 'flag' ? flagged.has(d.id) : true,
    )

    const hoverFill = (scope: string) =>
      !pointer ? {} : { borderStyle: 'round' as const, borderColor: FILLS.pane, hover: { scope, borderColor: FILLS.hover, backgroundColor: FILLS.hover } }
    const roundFill = { borderStyle: 'round', borderColor: FILLS.bar, backgroundColor: FILLS.bar } as const
    const tip = (key: string, anchorEl: JSX.Element, text: string) =>
      !pointer ? (
        anchorEl
      ) : (
        <Box position="relative" hover={{ scope: `tip-${key}` }}>
          {anchorEl}
          <Box position="absolute" top={1} left={0} display="none" hover={{ scope: `tip-${key}`, display: 'flex' }} backgroundColor={FILLS.tip} paddingX="sm">
            <Text>{text}</Text>
          </Box>
        </Box>
      )
    // A section bar with its fold arrow, as Brigade's groupHead draws it.
    const bar = (key: string, name: string, count: string) => {
      const arrow = folds.has(key) ? '▸' : '▾'
      return terminal ? (
        <Box marginTop={1}>
          <Button key={`fold:${key}`} plain onPress={noop}>
            <Text bold>{`${arrow} ${name}`}</Text>
            <Text dimColor>{` ${count}`}</Text>
          </Button>
        </Box>
      ) : (
        <Box paddingX="sm" marginTop="md" marginBottom="xs" {...roundFill} {...(pointer ? { hover: { scope: `bar-${key}` } } : {})}>
          <Button key={`fold:${key}`} plain onPress={noop}>
            <Text dimColor>{`${arrow} `}</Text>
            <Text weight="medium">{name}</Text>
            <Text dimColor>{` ${count}`}</Text>
          </Button>
        </Box>
      )
    }
    const hint = (text: string) => (
      <Box paddingX={3} paddingY={1}>
        <Text dimColor>{text}</Text>
      </Box>
    )
    const pick = (id: string, isOn: boolean, word: string) =>
      isOn ? (
        <Button key={id} variant="primary" onPress={noop}>
          {word}
        </Button>
      ) : (
        <Button key={id} dimColor onPress={noop}>
          {word}
        </Button>
      )
    // The pick box: a ○ that a press turns into ✓, as on Brigade's to-dos
    // and cards; picked rows go to the Dismiss island.
    const tick = (d: Decision, at: string) => (
      <Box flexShrink={0} width={3}>
        {picks.has(d.id) ? (
          <Button key={`pick:${d.id}:${at}`} plain onPress={noop}>
            <Text color="success">✓</Text>
          </Button>
        ) : (
          <Button key={`pick:${d.id}:${at}`} plain dimColor onPress={noop}>
            ○
          </Button>
        )}
      </Box>
    )
    const src = (d: Decision) => <Text color={d.source === 'owner' ? 'success' : 'suggestion'}>{d.source === 'owner' ? 'Owner' : 'Lead'}</Text>
    const flagMark = (d: Decision) => (flagged.has(d.id) ? <Text color="warning">⚑</Text> : undefined)

    // The full entry: each part a dim label over its text, the parts a step
    // apart, the options a list with the pick marked, the buttons last.
    const part = (label: string, body: JSX.Element | JSX.Element[]) => (
      <Box flexDirection="column">
        <Text dimColor size="footnote" weight="semibold">
          {label}
        </Text>
        {body}
      </Box>
    )
    const detail = (d: Decision, at: string) => (
      <Box flexDirection="column" marginTop="sm" marginBottom="xs" paddingX="md" paddingY="sm" rowGap="sm" {...(terminal ? { marginLeft: 3 } : { borderStyle: 'round', borderColor: FILLS.bar, backgroundColor: FILLS.hover })}>
        {part('Question', <Text wrap="wrap">{d.question}</Text>)}
        {part(
          'Options',
          d.options.map(o => (
            <Box flexDirection="row" columnGap={1} paddingLeft={1}>
              <Box flexShrink={0}>{o === d.pick ? <Text color="success">●</Text> : <Text dimColor>○</Text>}</Box>
              <Box flexShrink={1} minWidth={0}>
                {o === d.pick ? (
                  <Text weight="semibold" wrap="wrap">
                    {o}
                  </Text>
                ) : (
                  <Text dimColor wrap="wrap">
                    {o}
                  </Text>
                )}
              </Box>
            </Box>
          )),
        )}
        {part('Why', <Text wrap="wrap">{d.why}</Text>)}
        {part('To undo', <Text wrap="wrap">{d.undo}</Text>)}
        {d.revisit !== '' && part('Revisit', <Text wrap="wrap">{d.revisit}</Text>)}
        <Box flexDirection="row" columnGap={1} marginTop="xs">
          {pick(`read:${d.id}:${at}-d`, readSet.has(d.id), readSet.has(d.id) ? '✓ Read' : '○ Mark read')}
          {pick(`flag:${d.id}:${at}-d`, flagged.has(d.id), flagged.has(d.id) ? '⚑ Flagged to revisit' : '⚑ Flag to revisit')}
        </Box>
      </Box>
    )
    // A compact row: tick, time, source, pick; a dim line under it; a press on
    // the pick opens the full entry in place.
    const row = (d: Decision, stamp: string, sub: string, at: string) => (
      <Box flexDirection="column" paddingX={terminal ? 0 : 'sm'} {...hoverFill(`row-${d.id}`)}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {tick(d, at)}
          <Box flexShrink={0}>
            <Text dimColor tabular>{stamp}</Text>
          </Box>
          <Box flexShrink={0}>{src(d)}</Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Button key={`open:${d.id}:${at}`} plain onPress={noop}>
              {readSet.has(d.id) ? <Text dimColor wrap="truncate-end">{d.pick}</Text> : <Text weight="medium" wrap="truncate-end">{d.pick}</Text>}
            </Button>
          </Box>
          {flagMark(d)}
        </Box>
        <Box marginLeft={3}>
          <Text dimColor size="footnote" wrap="truncate-end">
            {sub}
          </Text>
        </Box>
        {opened.has(d.id) && detail(d, at)}
      </Box>
    )
    const filters = () => (
      <Box flexDirection="row" columnGap={1} rowGap={0} flexWrap="wrap" marginTop="sm">
        {pick('filter:all', filter === 'all', 'All')}
        {pick('filter:unread', filter === 'unread', `Unread ${unread.length}`)}
        {pick('filter:lead', filter === 'lead', 'Lead\u{2019}s calls')}
        {pick('filter:owner', filter === 'owner', 'Owner\u{2019}s answers')}
        {pick('filter:flag', filter === 'flag', `Flagged ${flagged.size}`)}
      </Box>
    )
    // The autonomy slider: three stops on a track, the chosen one primary.
    // Owner-only in the build; here a press moves it so each level can be seen.
    const LEVELS: [number, string, string][] = [
      [1, 'Manual', 'The lead asks you on every decision.'],
      [2, 'Auto', 'The lead takes its own pick outside the owner list, and logs each one here. It stops for the owner list.'],
      [3, 'Full throttle', 'The lead runs to the goal without stopping, even for major decisions. Each one is logged here for you to review.'],
    ]
    const [, levelName, levelText] = LEVELS[level - 1] ?? LEVELS[1]
    const track = ['●', '━━━━━', level >= 2 ? '●' : '○', '━━━━━', level >= 3 ? '●' : '○'].join('')
    // The track as an image that spans the pane: a stop at each end and in
    // the middle, the part up to the level lit in its colour.
    const lit = level === 3 ? '#e0a040' : level === 2 ? '#d97757' : '#8a8984'
    const off = '#4a4a47'
    const stop = (x: string, isLit: boolean, dx: number) =>
      `<svg x="${x}" overflow="visible"><circle cx="${dx}" cy="7" r="${isLit ? 5 : 4}" fill="${isLit ? lit : FILLS.hover}" stroke="${isLit ? lit : off}" stroke-width="2"/></svg>`
    const trackSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="14">' +
      `<rect x="0" y="6" width="100%" height="2" fill="${off}"/>` +
      `<rect x="0" y="6" width="${level === 1 ? '0' : level === 2 ? '50%' : '100%'}" height="2" fill="${lit}"/>` +
      stop('0', true, 6) +
      stop('50%', level >= 2, 0) +
      stop('100%', level >= 3, -6) +
      '</svg>'
    const autoRow = () => (
      <Box flexDirection="column" paddingX="sm" paddingY="xs" marginTop="sm" {...(terminal ? {} : { borderStyle: 'round', borderColor: level === 3 ? 'warning' : level === 2 ? 'claude' : FILLS.bar, backgroundColor: FILLS.hover })}>
        <Box flexDirection="row" columnGap={1}>
          <Box flexGrow={1}>
            <Text weight="medium">{`Autonomy · ${level} ${levelName}`}</Text>
          </Box>
          <Text dimColor size="footnote">
            🔒 owner
          </Text>
        </Box>
        {Svg !== undefined ? (
          <Box flexDirection="column" flexGrow={1} marginTop="xs">
            <Svg source={trackSvg} alt={`Autonomy level ${level} of 3`} height={14} />
          </Box>
        ) : (
          <Text color={level === 3 ? 'warning' : level === 2 ? 'claude' : 'inactive'}>{track}</Text>
        )}
        <Box flexDirection="row">
          {LEVELS.map(([n, word]) => (
            <Box width={n === 2 ? '34%' : '33%'} flexDirection="row" justifyContent={n === 1 ? 'flex-start' : n === 2 ? 'center' : 'flex-end'}>
              {level === n ? (
                <Button key={`level:${n}`} variant="primary" onPress={noop}>
                  {`${n} ${word}`}
                </Button>
              ) : (
                <Button key={`level:${n}`} dimColor onPress={noop}>
                  {`${n} ${word}`}
                </Button>
              )}
            </Box>
          ))}
        </Box>
        {level === 3 ? (
          <Text color="warning" size="footnote" wrap="wrap">
            {levelText}
          </Text>
        ) : (
          <Text dimColor size="footnote" wrap="wrap">
            {levelText}
          </Text>
        )}
      </Box>
    )
    const handoffBody = () => (
      <Box flexDirection="column" paddingX="md">
        <Text dimColor size="footnote">{`Updated today ${HANDOFF.updated}`}</Text>
        {HANDOFF.sections.map(([t, items]) => (
          <Box flexDirection="column" marginTop="xs">
            <Text dimColor weight="semibold" size="footnote">
              {t}
            </Text>
            {items.map(i => (
              <Text wrap="wrap">{`· ${i}`}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )

    // A: one ruled log, day bars, hand-off folded under the slider.
    const variantA = () => {
      const days = [...new Set(shown.map(day))]
      return (
        <Box flexDirection="column">
          {autoRow()}
          {bar('handoff', 'Lead hand-off', String(HANDOFF.sections.length))}
          {!folds.has('handoff') && handoffBody()}
          {filters()}
          {days.length === 0
            ? hint('Nothing matches this filter.')
            : days.map(dy => {
                const rows = shown.filter(d => day(d) === dy)
                return (
                  <Box flexDirection="column">
                    {bar(`day-${dy}`, dy, String(rows.length))}
                    {!folds.has(`day-${dy}`) && (
                      <Box flexDirection="column" rowGap={terminal ? 0 : 'xs'}>
                        {rows.map(d => row(d, time(d), `${d.session} · ${d.work} · ${d.question}`, 'log'))}
                      </Box>
                    )}
                  </Box>
                )
              })}
        </Box>
      )
    }

    // B: a review queue, oldest unread first at full detail, then Flagged.
    // History, the hand-off and the slider sit at the pane's foot (bFoot).
    const variantB = () => {
      const queue = unread.slice().reverse()
      const i = Math.min(queueAt, Math.max(queue.length - 1, 0))
      const d = queue[i]
      return (
        <Box flexDirection="column">
          {bar('queue', 'To review', String(queue.length))}
          {!folds.has('queue') &&
            (d === undefined ? (
              hint('All caught up. New decisions land here.')
            ) : (
              <Box flexDirection="column" paddingX="md" paddingY="sm" rowGap={0} {...(terminal ? {} : { borderStyle: 'round', borderColor: FILLS.hover, backgroundColor: FILLS.hover })}>
                <Box flexDirection="row" columnGap={1}>
                  <Box flexGrow={1}>
                    <Text dimColor>{`${i + 1} of ${queue.length}`}</Text>
                  </Box>
                  {src(d)}
                  <Text dimColor>{`${day(d)} ${time(d)}`}</Text>
                </Box>
                <Text dimColor size="footnote">{`${d.session} · ${d.work}`}</Text>
                <Text dimColor wrap="wrap">{d.question}</Text>
                <Text weight="semibold" wrap="wrap">{d.pick}</Text>
                <Text wrap="wrap">{d.why}</Text>
                <Button key={`open:${d.id}:queue`} plain dimColor onPress={noop}>
                  {`${opened.has(d.id) ? '▾' : '▸'} Options (${d.options.length}) and how to undo`}
                </Button>
                {opened.has(d.id) && (
                  <Box flexDirection="column" marginLeft={2}>
                    {d.options.map(o => (o === d.pick ? <Text wrap="wrap">{`● ${o}`}</Text> : <Text dimColor wrap="wrap">{`○ ${o}`}</Text>))}
                    <Text dimColor size="footnote" wrap="wrap">{`To undo: ${d.undo}`}</Text>
                    {d.revisit !== '' && <Text dimColor size="footnote" wrap="wrap">{`Revisit: ${d.revisit}`}</Text>}
                  </Box>
                )}
                <Box flexDirection="row" columnGap={1} marginTop="sm">
                  <Button key={`readnext:${d.id}`} variant="primary" onPress={noop}>
                    ✓ Read, next
                  </Button>
                  {pick(`flag:${d.id}:queue`, flagged.has(d.id), flagged.has(d.id) ? '⚑ Flagged' : '⚑ Flag to revisit')}
                  <Button key="skip" dimColor onPress={noop}>
                    Skip
                  </Button>
                </Box>
              </Box>
            ))}
          {bar('flagq', 'Flagged to revisit', String(flagged.size))}
          {!folds.has('flagq') &&
            (kept.every(x => !flagged.has(x.id))
              ? hint('Nothing flagged.')
              : kept.filter(x => flagged.has(x.id)).map(x => row(x, time(x), `${x.session} · ${x.work}`, 'flagged')))}
        </Box>
      )
    }
    const bFoot = () => {
      const history = kept.filter(x => readSet.has(x.id))
      return (
        <Box flexDirection="column">
          {bar('history', 'History', String(history.length))}
          {!folds.has('history') && history.map(x => row(x, `${day(x).slice(0, 3)} ${time(x)}`, `${x.session} · ${x.work}`, 'history'))}
          {bar('handoff', 'Lead hand-off', String(HANDOFF.sections.length))}
          {!folds.has('handoff') && handoffBody()}
          {autoRow()}
        </Box>
      )
    }

    // C: decisions under each session, as Sessions groups its cards.
    const variantC = () => {
      const sessions = [...new Set(shown.map(d => d.session))]
      return (
        <Box flexDirection="column">
          {autoRow()}
          {bar('handoff', 'Lead hand-off', `updated ${HANDOFF.updated}`)}
          {!folds.has('handoff') && handoffBody()}
          {filters()}
          {sessions.length === 0
            ? hint('Nothing matches this filter.')
            : sessions.map(s => {
                const rows = shown.filter(d => d.session === s)
                const u = rows.filter(d => !readSet.has(d.id)).length
                return (
                  <Box flexDirection="column">
                    {bar(`s-${s}`, s, `${rows.length}${u > 0 ? ` · ${u} unread` : ''}`)}
                    {!folds.has(`s-${s}`) && rows.map(d => row(d, `${day(d) === 'Today' ? '' : 'Yday '}${time(d)}`, `${d.work} · ${d.question}`, 'session'))}
                  </Box>
                )
              })}
        </Box>
      )
    }

    const switchButton = (id: string, icon: string, word: string, tipText: string) =>
      tip(
        `switch-${id}`,
        tab === id ? (
          <Button key={`tab:${id}`} variant="primary" onPress={noop}>
            {pointer ? icon : word}
          </Button>
        ) : (
          <Button key={`tab:${id}`} dimColor onPress={noop}>
            {pointer ? icon : word}
          </Button>
        ),
        tipText,
      )
    const heading = tab === 'decisions' ? `${kept.length} decisions · ${unread.length} unread` : tab === 'prs' ? '3 pull requests' : '4 sessions'
    const name = VARIANTS.find(v => v[0] === variant)?.[1] ?? ''
    const selected = kept.filter(d => picks.has(d.id)).length

    return (
      <Box flexDirection="column" flexGrow={1} minHeight={e.props.placement === 'dock' ? e.props.scroll.bodyRows : undefined}>
        <Box flexDirection="row" columnGap={1} marginBottom={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text weight="medium" wrap="truncate-end">
              {heading}
            </Text>
          </Box>
          {switchButton('sessions', '◫', 'Sessions', 'Sessions')}
          {switchButton('prs', '⎇', 'Pull requests', 'Pull requests 3')}
          {switchButton('decisions', '⚖', 'Decisions', `Decisions · ${unread.length} unread`)}
        </Box>
        {tab !== 'decisions'
          ? hint(`The ${tab === 'prs' ? 'Pull requests' : 'Sessions'} tab as it is today. Not drawn in this prototype.`)
          : variant === 'B'
            ? variantB()
            : variant === 'C'
              ? variantC()
              : variantA()}
        {/* A spacer takes the room left in a docked pane, so the island and
            the foot sit at its bottom, as Brigade's selection bar and Usage do. */}
        <Box flexGrow={1} />
        {tab === 'decisions' && selected > 0 && (
          <Box flexDirection="row" justifyContent="center" marginTop="md" marginBottom="sm">
            <Box flexDirection="row" alignItems="center" columnGap="md" paddingX="md" {...(terminal ? { borderStyle: 'round', borderColor: 'inactive', backgroundColor: 'subtle' } : { borderStyle: 'round', borderColor: FILLS.tip, backgroundColor: FILLS.hover })}>
              <Text>{`${selected} selected`}</Text>
              <Button key="bardismiss" plain onPress={noop}>
                ✓ Dismiss
              </Button>
              <Button key="barclear" plain dimColor onPress={noop}>
                ✕
              </Button>
            </Box>
          </Box>
        )}
        {tab === 'decisions' && variant === 'B' && bFoot()}
        {/* The prototype's own bar, not part of the design. */}
        <Box flexDirection="column" marginTop="md" paddingX="sm" paddingY="xs" {...(terminal ? {} : { borderStyle: 'round', borderColor: 'warning' })}>
          <Text color="warning" size="footnote">{`PROTOTYPE 402 · variant ${variant} (${name})`}</Text>
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {VARIANTS.map(([k]) => pick(`var:${k}`, variant === k, k))}
            {pick('leveldef', false, `Starts at ${levelDefault}`)}
            <Button key="reset" dimColor onPress={noop}>
              Reset
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })
}
