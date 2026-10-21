import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { ALSO, RISKS, TITLE, WORDING, isAcknowledged, versionOf } from './warning-text.ts'
import type { Ack } from './warning-text.ts'

// The permission warning: a band above the prompt in a lead session, saying
// what the sessions the head chef starts put at risk. The head-chef skill
// calls the tool before its first launch in a lead. "I understand" hides the
// band for this session; with "Don't show again" ticked first, it hides it in
// every later lead too, until the wording changes. The band is for awareness:
// pressing it accepts no risk.
//
// No checkbox element exists on any surface, so "Don't show again" is a
// button drawn as a box, which a press ticks and unticks.

const TOOL = 'show_permission_warning'
const TOOL_NAME = 'mcp__grimoire__show_permission_warning'
const DESCRIPTION =
  "Shows the head chef's permission warning above the prompt in this session. The head-chef skill calls it once, before its first launch in a lead. Takes no input."
const SCHEMA = { type: 'object', properties: {}, additionalProperties: false }
const STORE_KEY = 'permission-warning-ack'
const VERSION = versionOf(WORDING)

// Shown in this session: set by the tool, and kept across a reload.
const shown = atom({ plugin: 'grimoire', key: 'warningShown' } as const, false)
// Hidden by "I understand" for the rest of this session.
const hidden = atom({ plugin: 'grimoire', key: 'warningHidden' } as const, false)
// The box's tick, until "I understand" is pressed.
const ticked = atom({ plugin: 'grimoire', key: 'warningTicked' } as const, false)
// The owner's "Don't show again", read from the store at each start.
const ack = atom({ plugin: 'grimoire', key: 'warningAck' } as const, null)

async function stored($: EngineInterface): Promise<Ack | null> {
  try {
    // Any well-formed acknowledgement is kept, of this version or an older
    // one, so the band can say the wording changed; anything else is none.
    const value = await $.store.get(STORE_KEY)
    if (typeof value !== 'object' || value === null) return null
    const { at, version } = value as Record<string, unknown>
    return typeof at === 'string' && typeof version === 'string' ? { at, version } : null
  } catch {
    return null
  }
}

async function offer($: EngineInterface) {
  await $.tool.register({ name: TOOL, description: DESCRIPTION, inputSchema: SCHEMA })
}

/** At each session start, from register.tsx's own hook: read the owner's
 *  "Don't show again" back from the store, and offer the tool. A failure
 *  leaves no tool, and the skill then says the warning in chat. */
export async function warningStart($: EngineInterface) {
  try {
    const kept = await stored($)
    await update($, ack, () => kept)
    await offer($)
  } catch {
    // No warning tool this time.
  }
}

/** At a clear or a resume, which fires classic.SessionStart and not
 *  session.start: offer the tool again, since registering a name again
 *  replaces it. */
export async function warningOfferAgain($: EngineInterface) {
  try {
    await offer($)
  } catch {
    // As above.
  }
}

export function registerWarning(on: On) {
  on('tool.call', { tool: TOOL_NAME }, async ($, e) => {
    if ((e as unknown as Record<string, unknown>).agentId !== undefined) {
      return { deny: `${TOOL} refused: only the lead session's own turns show the warning.` }
    }
    if (isAcknowledged(await read($, ack), VERSION)) {
      return { result: "The owner chose Don't show again for this wording, so the warning stays hidden. Go on with the launch." }
    }
    await update($, shown, () => true)
    await update($, hidden, () => false)
    return { result: 'The permission warning is shown above the prompt. Go on with the launch; it needs no answer.' }
  }).catch(() => ({ deny: `${TOOL} refused: the tool failed. Say the warning to the owner in chat instead.` }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, shown)) || (await read($, hidden))) return next(e)
    const kept = await read($, ack)
    if (isAcknowledged(kept, VERSION)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const box = await read($, ticked)
    const changed = kept !== null ? (kept as Ack).at : null

    return (
      <Box key="permission-warning" flexDirection="column" borderStyle="round" paddingX="lg" paddingY="md" gap="md">
        <Text bold>{TITLE}</Text>
        <Box flexDirection="column" gap="xs" paddingLeft="sm">
          {RISKS.map((line, i) => (
            <Text key={`risk-${i}`}>• {line}</Text>
          ))}
        </Box>
        {changed !== null ? <Text dimColor>The wording changed since you chose Don't show again on {changed.slice(0, 10)}.</Text> : null}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
          <Box flexShrink={1}>
            <Text dimColor>{ALSO}</Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Button
              key="dont-show"
              label={box ? "☑ Don't show again" : "☐ Don't show again"}
              onPress={async () => {
                await update($, ticked, t => !t)
              }}
            />
            <Button
              key="understand"
              variant="primary"
              label="I understand"
              onPress={async () => {
                if (await read($, ticked)) {
                  const value: Ack = { at: new Date(await $.clock.now()).toISOString(), version: VERSION }
                  await $.store.set(STORE_KEY, value)
                  await update($, ack, () => value)
                }
                await update($, hidden, () => true)
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  })
}
