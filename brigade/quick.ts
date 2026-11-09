// A card's quick action (issue 223): which button a card shows, the one line it
// puts in the lead's prompt box, and the check a press makes again. Plain
// TypeScript with no engine import, so tests/brigade-quick.test.mjs imports it
// as it is; keep it to erasable syntax. register.tsx draws the button and
// fills the box, and only on Desktop. A button never sends: the owner reads
// the line and presses Enter, so the yes stays the owner's own submission.

import { sha256Hex } from './decisions.ts'
import { REPO, type GhPr } from './roster.ts'
import { movedLook, prAnswer, slug, type Moves } from './view.ts'

/** A title that may be built into a line: whole-string, no space. */
export const TITLE = /^[A-Za-z0-9._-]{1,80}$/

export type QuickAction = { action: 'ask' | 'merge' | 'cleanup'; label: string; line: string }

/** What `gh` answered, and the repository its base run first answered for. */
export type QuickAnswers = {
  base: ReadonlyMap<number, GhPr>
  named?: ReadonlyMap<string, ReadonlyMap<number, GhPr>>
  pinned?: string
}

export const CHANGED = 'The card changed. Nothing was put in the prompt box.'
export const DRAFT = 'The prompt box holds a draft. Send or clear it, then press again.'
export const FILL_FAILED = (line: string) => `Brigade could not fill the prompt box. Type this instead: ${line}`

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Where a quick action draws and fills: Desktop alone. The draw and the press
 *  both ask. The engine only presses a button its surface drew; the press asks
 *  again anyway, to keep the Desktop-only rule for any press that reports another surface.
 *  It is not a control against another plugin, which picks the surface it reports
 *  (candidate O1). */
export const quickSurface = (surface: unknown): boolean => surface === 'desktop'

/** The repository as `gh` spelled it, kept only if it is whole, passes `REPO`
 *  and has no `.` or `..` part. */
const safeRepo = (repo: unknown): repo is string =>
  typeof repo === 'string' && REPO.test(repo) && !['.', '..'].includes(repo.split('/')[1] ?? '')

/** The action a card shows, or undefined: the first rule that matches wins: Ask, then Merge, then Clean up.
 *  The draw and the press both call this one function. */
export function quickAction(c: unknown, answers: QuickAnswers, moves?: Moves): QuickAction | undefined {
  if (!isRecord(c) || typeof c.title !== 'string' || !TITLE.test(c.title)) return undefined
  const title = c.title
  if (c.status === 'needs-you' || movedLook(c, moves)?.group === 'needsYou') {
    return { action: 'ask', label: 'Ask', line: `What does ${title} need from me?` }
  }
  if (c.status === 'done' && c.repo === undefined && c.pr !== undefined) {
    const answer = prAnswer(c, answers.base, answers.named)
    if (answer?.state === 'open' && answers.pinned !== undefined && answer.repo === answers.pinned && safeRepo(answer.repo) && Number.isInteger(answer.number) && answer.number > 0) {
      return { action: 'merge', label: 'Merge', line: `Merge PR #${answer.number} in ${answer.repo}.` }
    }
  }
  if (c.status === 'done' || c.status === 'stopped') {
    const answer = c.pr === undefined ? undefined : prAnswer(c, answers.base, answers.named)
    if (c.pr === undefined || answer?.state === 'merged' || answer?.state === 'closed') {
      return { action: 'cleanup', label: 'Clean up', line: `Show me what cleaning up ${title} would remove.` }
    }
  }
  return undefined
}

/** The key's last part: 16 hex digits over the action, the whole title and the
 *  line. It has no hyphen, so it survives the key's split. It is a staleness
 *  check, not authentication. */
export const quickDigest = (action: string, title: string, line: string): string => sha256Hex([action, title, line].join('\n')).slice(0, 16)

/** A press: the card found again by place and slug, its action and line worked
 *  out again from the state as it is now, and kept only if they match the key.
 *  Any difference gives undefined. */
export function quickPress(cards: readonly unknown[], place: number, slugged: string, action: string, digest: unknown, answers: QuickAnswers, moves?: Moves): string | undefined {
  const c = cards[place]
  if (!isRecord(c) || typeof c.title !== 'string' || slug(c.title) !== slugged) return undefined
  const q = quickAction(c, answers, moves)
  return q !== undefined && q.action === action && digest === quickDigest(q.action, c.title, q.line) ? q.line : undefined
}

/** Whether a `prompt.read` answer is a blank box. The answer is a string or a
 *  record with a `text` string; any other shape counts as a draft, so the press
 *  fails closed. The draft is tested and dropped, never kept. */
export function boxIsBlank(read: unknown): boolean {
  const text = typeof read === 'string' ? read : isRecord(read) && typeof read.text === 'string' ? read.text : undefined
  return text !== undefined && /^\s*$/.test(text)
}
