import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ack } from '../types'

// The risks the owner accepts, first, then what else the head chef does. A
// change to either changes the version, and the band comes back until the
// owner acknowledges it again.
export const RISKS = [
  'Any device signed in to your account can drive the sessions it starts in the background.',
  'Those sessions trust any message that claims to come from it.',
]
export const ALSO = 'It also starts sessions, relays between them, and merges or cleans up on your word.'
export const CAPABILITIES = [...RISKS, ALSO]

// A short, stable version of the list: djb2 over the joined text, in hex.
export function versionOf(lines: readonly string[]): string {
  let h = 5381
  for (const ch of lines.join('\n')) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0
  return h.toString(16).padStart(8, '0')
}

const VERSION = versionOf(CAPABILITIES)
const STORE_KEY = 'ack'

const isLead = atom({ plugin: 'chef-band', key: 'isLead' } as const, false)
const ack = atom({ plugin: 'chef-band', key: 'ack' } as const, null)

function asAck(value: unknown): Ack | null {
  if (typeof value !== 'object' || value === null) return null
  const { at, version } = value as Record<string, unknown>
  return typeof at === 'string' && typeof version === 'string' ? { at, version } : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chef-band',
      description: "Show the head chef's capabilities above the prompt (this session is the lead)",
    })
    const kept = asAck(await $.store.get(STORE_KEY))
    await update($, ack, () => kept)
    return next(e)
  })

  // The trigger: the lead runs /chef-band. Running it again shows the band
  // even after an acknowledgement, so the owner can read the list again.
  on('command.run', { command: 'chef-band' }, async $ => {
    await update($, isLead, () => true)
    const kept = await read($, ack)
    if (kept?.version === VERSION) {
      await update($, ack, () => null)
      return { text: `Showing the list again (you acknowledged version ${VERSION} on ${kept.at}).` }
    }
    return { text: "The head chef's capabilities are above the prompt." }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isLead))) return next(e)
    const kept = await read($, ack)
    if (kept?.version === VERSION) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const changed = kept

    return (
      <Box flexDirection="column" borderStyle="round" paddingX="lg" paddingY="md" gap="md">
        <Text bold>Head chef is on. Two things to know:</Text>
        <Box flexDirection="column" gap="xs" paddingLeft="sm">
          {RISKS.map((line, i) => (
            <Text key={`risk-${i}`}>• {line}</Text>
          ))}
        </Box>
        {changed !== null && changed.version !== VERSION ? (
          <Text dimColor>The list changed since you acknowledged it on {changed.at}.</Text>
        ) : null}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
          <Box flexShrink={1}>
            <Text dimColor>{ALSO}</Text>
          </Box>
          <Button
            key="understand"
            variant="primary"
            label="I understand"
            onPress={async () => {
              const value: Ack = { at: new Date(await $.clock.now()).toISOString(), version: VERSION }
              await $.store.set(STORE_KEY, value)
              await update($, ack, () => value)
              $.ui.toast(`Acknowledged version ${VERSION}`)
            }}
          />
        </Box>
      </Box>
    )
  })
}
