// The permission warning's wording, and the test of whether the owner has
// already chosen "Don't show again" for it. Plain TypeScript with no engine
// import, so tests/brigade-warning.test.mjs imports it as it is. The band
// that draws it is warning.tsx.
//
// The wording is the head-chef contract's, word for word. Any change to it
// moves the version, and the band shows again in every lead until the owner
// ticks "Don't show again" once more.

export const TITLE = 'Head chef is on. Two things to know:'
export const RISKS = [
  'Every background session it starts is on Remote Control, so any device signed in to your account can read and drive it.',
  'Those sessions trust any message that claims to come from it, and any comment on their issue made as you.',
]
export const ALSO =
  'It also starts sessions, merges, posts, cleans up and decides on your word, or on its own toward a level 3 goal you set, as your user-level instructions allow.'
export const WORDING: readonly string[] = [TITLE, ...RISKS, ALSO]

/** The owner's "Don't show again": when, and which version of the wording. */
export type Ack = { at: string; version: string }

/** A short, stable version of the wording: djb2 over the joined lines, in hex. */
export function versionOf(lines: readonly string[]): string {
  let h = 5381
  for (const ch of lines.join('\n')) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** Whether a stored value is an acknowledgement of this version. Anything
 *  else the store holds, of any shape, leaves the warning to show. */
export function isAcknowledged(stored: unknown, version: string): boolean {
  if (typeof stored !== 'object' || stored === null) return false
  const { at, version: v } = stored as Record<string, unknown>
  return typeof at === 'string' && typeof v === 'string' && v === version
}
