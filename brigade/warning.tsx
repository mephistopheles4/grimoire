import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

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

// register.tsx's own start hooks read the store and offer the tool, from
// these: `claude plugin validate` refuses `$` handed to an imported function.
export const TOOL = 'show_permission_warning'
const TOOL_NAME = 'mcp__grimoire__show_permission_warning'
export const DESCRIPTION =
  "Shows the head chef's permission warning above the prompt in this session. The head-chef skill calls it once, before its first launch in a lead. Takes no input."
export const SCHEMA = { type: 'object', properties: {}, additionalProperties: false }
export const STORE_KEY = 'permission-warning-ack'
const VERSION = versionOf(WORDING)

// Shown in this session: set by the tool, and kept across a reload.
const shown = atom({ plugin: 'grimoire', key: 'warningShown' } as const, false)
// Hidden by "I understand" for the rest of this session.
const hidden = atom({ plugin: 'grimoire', key: 'warningHidden' } as const, false)
// The box's tick, for this session. "I understand" reads it.
const ticked = atom({ plugin: 'grimoire', key: 'warningTicked' } as const, false)
// The owner's "Don't show again", read from the store at each start.
// register.tsx writes it at each start, through its own atom of this key.
const ack = atom({ plugin: 'grimoire', key: 'warningAck' } as const, null)

/** What the store holds, as an acknowledgement. Any well-formed one is kept,
 *  of this version or an older one, so the band can say the wording changed;
 *  anything else is none. */
export function ackFrom(value: unknown): Ack | null {
  if (typeof value !== 'object' || value === null) return null
  const { at, version } = value as Record<string, unknown>
  return typeof at === 'string' && typeof version === 'string' ? { at, version } : null
}

export function registerWarning(on: On) {
  on('tool.call', { tool: TOOL_NAME }, async ($, e) => {
    if ((e as unknown as Record<string, unknown>).agentId !== undefined) {
      return { deny: `${TOOL} refused: only the lead session's own turns show the warning.` }
    }
    // The owner's own rules hold for this tool, as for set_roster: a deny,
    // or an ask rule that names it, refuses the call.
    const verdict = await $.tool.check({ tool: TOOL_NAME, input: {} })
    if (verdict.decision === 'deny' || (verdict.decision === 'ask' && verdict.rule !== undefined)) {
      return { deny: `${TOOL} refused: the owner's rules cover this tool. Say the warning to the owner in chat instead.` }
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
    // The stored time is drawn only as a date of that shape; anything else
    // the store holds is never drawn.
    const at: unknown = kept !== null ? (kept as Ack).at : null
    const changed = at === null ? null : typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : ''

    return (
      <Box key="permission-warning" flexDirection="column" borderStyle="round" paddingX="lg" paddingY="md" gap="md">
        <Text bold>{TITLE}</Text>
        <Box flexDirection="column" gap="xs" paddingLeft="sm">
          {RISKS.map((line, i) => (
            <Text key={`risk-${i}`}>• {line}</Text>
          ))}
        </Box>
        {changed !== null ? (
          <Text dimColor>
            {changed === '' ? "The wording changed since you chose Don't show again." : `The wording changed since you chose Don't show again on ${changed}.`}
          </Text>
        ) : null}
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
                  try {
                    const value: Ack = { at: new Date(await $.clock.now()).toISOString(), version: VERSION }
                    await $.store.set(STORE_KEY, value)
                    await update($, ack, () => value)
                  } catch {
                    // Not kept for later leads; the band still hides for this one.
                  }
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
