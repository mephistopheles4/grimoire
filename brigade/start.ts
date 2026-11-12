import { foldsCase, oneLine, pathKey, REPO } from './roster.ts'

// The background start tool's rules (issue 543, spec rev 4), as plain
// TypeScript with no engine import, so tests/brigade-start.test.mjs runs them
// directly, as stop.ts's are run. Nothing here reads a file, runs a process or
// keeps a value: every answer from the machine (a stat, a git run, a PATH
// lookup, a clock) is passed in, and every result is a value. The mod's guards,
// queue, runs and command are a later ticket and call these.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type Checked<T> = { value: T } | { why: string }

/** The two kinds of path the rules tell apart: Windows' (a drive letter, one
 *  backslash separator, case ignored) and every other. */
export type Platform = 'win32' | 'posix'

// --- the fixed words ---------------------------------------------------------------

/** The three reasons a folder is refused, in fixed words with no path (issue 579, S3.5). */
export const NOT_SPELLED = 'folder: not a plain absolute local path'
export const NOT_MAIN = 'folder: not a main checkout of this repository'
export const NOT_READ = 'folder: the checkout could not be read'

export const NOT_STARTED =
  'Not started: claude did not run, did not exit 0, or printed no job id. It may have started: tell the owner, who can check `claude agents`, and retry nothing.'

export const CAP_MAX = 4
export const CAP_WINDOW_MS = 10 * 60 * 1000
export const CAP_REASON = 'cap: four background starts in ten minutes were reached; wait, or ask the owner. Nothing was started.'

export const ORIGIN_TIMEOUT_MS = 15000
export const START_TIMEOUT_MS = 60000

/** What the lead still reads after a compaction (S2.0). */
export const DESCRIPTION =
  'The only way to start a background member: never type `claude --bg`. Needs name, repository, issue, model, effort, lead (your own name) and folder (a main checkout of the repository; the harness refuses a folder the owner has not trusted). It starts one session on Remote Control with a fixed command and a fixed one-line prompt, takes no permission mode, and prints nothing from the run. It writes no card: call set_roster after it. It works only while the Brigade pane is open. A refusal names the rule that failed.'

export const NAME_REASONS = {
  card: 'name: a roster card already has this name',
  session: 'name: a live session already has this name',
  attempted: 'name: already started or tried since the pane loaded',
  worktree: 'name: a worktree folder with this name exists',
  branch: 'name: a branch with this name exists',
  incomplete: 'name: the session files could not be read whole',
}

// --- the seven inputs (S2.1) ------------------------------------------------------

export type Inputs = { name: string; repository: string; issue: string; model: string; effort: string; lead: string; folder: string }
const KEYS = ['name', 'repository', 'issue', 'model', 'effort', 'lead', 'folder']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MAX_FOLDER = 1000

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MODEL = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const ISSUE = /^[1-9][0-9]{0,6}$/
// No full stop: the lead's name sits in the member's first sentence, and a full stop would let a second one in.
const LEAD = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/

const goodName = (v: string): boolean => NAME.test(v) && !v.includes('..') && !v.endsWith('.') && !v.endsWith('.lock')

function shape(raw: unknown): Checked<Inputs> {
  if (!isRecord(raw)) return { why: 'input: not an object' }
  const keys = Object.keys(raw)
  if (keys.length !== KEYS.length || !KEYS.every(k => keys.includes(k))) return { why: 'input: exactly name, repository, issue, model, effort, lead and folder' }
  for (const k of KEYS) if (typeof raw[k] !== 'string') return { why: `${k}: not text` }
  const i = raw as Inputs
  if (!goodName(i.name)) return { why: 'name: 1 to 64 letters, digits, . _ -, starting with a letter or digit, no .., not ending in . or .lock' }
  if (!REPO.test(i.repository)) return { why: 'repository: not a plain owner/name' }
  if (!ISSUE.test(i.issue)) return { why: 'issue: 1 to 7 digits, not starting with 0' }
  if (!MODEL.test(i.model)) return { why: 'model: starts with a letter; 1 to 64 letters, digits, . _ -' }
  if (!EFFORTS.includes(i.effort)) return { why: `effort: one of ${EFFORTS.join(', ')}` }
  if (!LEAD.test(i.lead) || i.lead.endsWith(' ') || i.lead.includes('  ')) return { why: 'lead: 1 to 80 letters, digits, single spaces, _ -, no full stop' }
  if (i.folder.length < 1 || i.folder.length > MAX_FOLDER) return { why: 'folder: 1 to 1000 characters' }
  return { value: { name: i.name, repository: i.repository, issue: i.issue, model: i.model, effort: i.effort, lead: i.lead, folder: i.folder } }
}

/** The tool's seven fields: exactly those keys, every one a string, each by its
 *  own rule, and `lead` equal to the caller's own session name, exactly. None is
 *  rewritten; the first that fails refuses the call. The folder is only
 *  length-checked here; S4 owns its spelling. The equality is what keeps a lead's
 *  own clause out of the member's first prompt: the caller's name comes from the
 *  engine, never from the model. */
export function checkInputs(raw: unknown, callerName: unknown): Checked<Inputs> {
  const r = shape(raw)
  if ('why' in r) return r
  if (r.value.lead !== callerName) return { why: 'lead: must be your own session name, exactly' }
  return r
}

function passed(i: unknown): Inputs {
  const r = shape(i)
  if ('why' in r) throw new Error('start: an input did not pass the check')
  return r.value
}

// --- the prompt and the argv (S2.3) -------------------------------------------------

/** The one sentence the member starts with, from inputs that passed. */
export function startPrompt(input: Inputs): string {
  const i = passed(input)
  const prompt = `Your work is issue ${i.issue} on ${i.repository}. Send your questions and reports to ${i.lead}.`
  if (/[\r\n]/.test(prompt) || prompt.length > 400) throw new Error('start: the prompt is not one short line')
  return prompt
}

/** The start's argv: the fixed flags, no permission mode, no other flag. */
export function startArgv(input: Inputs, claude: string): string[] {
  const i = passed(input)
  return [claude, '--bg', '--remote-control', i.name, '-n', i.name, '-w', i.name, '--model', i.model, '--effort', i.effort, startPrompt(i)]
}

/** The origin read: git keeps -C, reads every value, and takes nothing else. */
export function originArgv(git: string, folder: string): string[] {
  return [git, '-C', folder, 'config', '--local', '--get-all', 'remote.origin.url']
}

// --- the folder (S4) ------------------------------------------------------------------

const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/u

/** Whether a path begins as a network path does. No production code calls it since issue 579; spec S4.1 keeps it, with its test. */
export const isNetworkPath = (folder: string): boolean => /^(?:\\\\|\/\/)/.test(folder)

/** Step 1: the folder is spelled as a canonical absolute path, and nothing else. */
export function folderSpelling(folder: string, platform: Platform): Checked<string> {
  const no = { why: NOT_SPELLED }
  if (typeof folder !== 'string' || folder.length === 0 || folder.length > MAX_FOLDER || CONTROL.test(folder)) return no
  let parts: string[]
  if (platform === 'win32') {
    if (!/^[A-Za-z]:\\/.test(folder)) return no
    parts = folder.slice(3).split('\\')
  } else {
    if (!folder.startsWith('/') || folder.startsWith('//')) return no
    parts = folder.slice(1).split('/')
  }
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..' || p.includes('~')) return no
    if (platform === 'win32' && /[\/:*?"<>|]/.test(p)) return no
  }
  return { value: folder }
}

/** Step 2's compare: the resolved path against the given one. */
// Only A to Z fold: toLowerCase also folds letters such as U+212A onto k, which NTFS keeps distinct.
const foldAscii = (p: string): string => p.replace(/[A-Z]/g, c => c.toLowerCase())

export function samePath(a: string, b: string, platform: Platform): boolean {
  return platform === 'win32' ? foldAscii(a) === foldAscii(b) : a === b
}

/** Step 3: a main checkout. `gitKind` is what `<folder>/.git` is, and
 *  `ancestorHasGit` is whether any directory above the folder holds a `.git`. */
export function mainCheckout(folder: string, facts: { gitKind: 'dir' | 'file' | 'none'; ancestorHasGit: boolean }, platform: Platform): Checked<true> {
  void platform
  const segments = folder.split(/[\\/]/).map(s => s.toLowerCase())
  for (let n = 0; n + 1 < segments.length; n++) if (segments[n] === '.claude' && segments[n + 1] === 'worktrees') return { why: NOT_MAIN }
  if (facts.gitKind !== 'dir' || facts.ancestorHasGit) return { why: NOT_MAIN }
  return { value: true }
}

/** Steps 4 and 5: the origin read, then its match with the repository. Git was
 *  asked for every value, so more than one line refuses whichever comes first. */
export function originMatch(ran: unknown, repository: string): Checked<true> {
  const unreadable = { why: NOT_READ }
  if (!isRecord(ran) || ran.exitCode !== 0 || ran.isStdoutTruncated !== false || typeof ran.stdout !== 'string') return unreadable
  const lines = ran.stdout.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length !== 1) return unreadable
  const line = lines[0]
  if (line === '' || [...line].length > 300 || CONTROL.test(line)) return unreadable
  const m = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(line)
  if (m === null || `${m[1]}/${m[2]}`.toLowerCase() !== repository.toLowerCase()) return { why: NOT_MAIN }
  return { value: true }
}

// --- names (S2.1, S2.5) -----------------------------------------------------------------

/** What `-w <name>` makes, in the folder it ran in. */
export const worktreeBranch = (name: string): string => `worktree-${name}`
export const worktreeFolder = (folder: string, name: string, platform: Platform): string =>
  platform === 'win32' ? `${folder}\\.claude\\worktrees\\${name}` : `${folder}/.claude/worktrees/${name}`

export type NameFacts = {
  titles: readonly string[]
  sessionNames: readonly string[]
  /** Names this load attempted, lower case. */
  attempted: ReadonlySet<string>
  worktreeExists: boolean
  branchExists: boolean
  sessionsComplete: boolean
}

/** A fresh name: unused by a card, a live session, an earlier attempt, a worktree folder or a branch. */
export function nameFresh(name: string, facts: NameFacts): Checked<true> {
  const lower = name.toLowerCase()
  const same = (t: string) => oneLine(t, 80).toLowerCase() === lower
  if (!facts.sessionsComplete) return { why: NAME_REASONS.incomplete }
  if (facts.titles.some(same)) return { why: NAME_REASONS.card }
  if (facts.sessionNames.some(same)) return { why: NAME_REASONS.session }
  if (facts.attempted.has(lower)) return { why: NAME_REASONS.attempted }
  if (facts.worktreeExists) return { why: NAME_REASONS.worktree }
  if (facts.branchExists) return { why: NAME_REASONS.branch }
  return { value: true }
}

// --- programs (S2.3) --------------------------------------------------------------------

/** The absolute path of a program from the session's PATH: absolute entries only,
 *  the first hit wins, and a hit inside the folder, or a Windows `.cmd` shim
 *  with no `.exe` beside it, refuses. `exists` is the caller's file check. */
export function resolveProgram(name: string, pathValue: unknown, platform: Platform, folder: string, exists: (path: string) => boolean): Checked<string> {
  if (typeof pathValue !== 'string' || pathValue === '') return { why: 'program: no PATH to look in' }
  const win = platform === 'win32'
  const fold = win || foldsCase(folder)
  const root = pathKey(folder, fold)
  let shim = false
  for (const raw of pathValue.split(win ? ';' : ':')) {
    const entry = raw.replace(/[\\/]+$/, '')
    // An entry spelled with `..`, `.`, an empty segment or an 8.3 name could reach the folder by a route the compare below cannot see.
    if ('why' in folderSpelling(entry, platform)) continue
    const file = win ? `${entry}\\${name}.exe` : `${entry}/${name}`
    if (exists(file)) {
      if (pathKey(file, fold).startsWith(`${root}/`)) return { why: 'program: found inside the folder' }
      return { value: file }
    }
    if (win && exists(`${entry}\\${name}.cmd`)) shim = true
  }
  return { why: shim ? 'program: only a .cmd shim was found' : 'program: not found on PATH' }
}

// --- the answer (S2.4, S5) ----------------------------------------------------------------

/** The start's answer, in fixed words whatever the run printed: the id comes
 *  from the first line alone, `backgrounded · <8 hex> · <name>`, from a run that
 *  exited 0 with whole output; the folder and branch are the ones `-w` makes. */
export function startAnswer(ran: unknown, input: Inputs, platform: Platform = 'win32'): string {
  if (!isRecord(ran) || ran.exitCode !== 0 || ran.isStdoutTruncated !== false || typeof ran.stdout !== 'string') return NOT_STARTED
  const lines = ran.stdout.split(/\r?\n/)
  if (lines.filter(l => l.startsWith('backgrounded')).length !== 1) return NOT_STARTED
  const m = /^backgrounded · ([0-9a-f]{8}) · (.+)$/.exec(lines[0])
  if (m === null || m[2] !== input.name) return NOT_STARTED
  return `Started ${input.name}: job ${m[1]}. Folder: ${worktreeFolder(input.folder, input.name, platform)}. Branch: ${worktreeBranch(input.name)}. Write its card with set_roster; the tool wrote none.`
}

// --- the cap (S2.5) ----------------------------------------------------------------------------

/** Whether another start may reach the run: fewer than four inside ten minutes.
 *  A clock that is not a number opens nothing. */
export function capOpen(times: readonly number[], now: number): boolean {
  if (typeof now !== 'number' || !Number.isFinite(now)) return false
  return times.filter(t => now - t < CAP_WINDOW_MS).length < CAP_MAX
}

/** The times after a start reached the run: the window's, and this one. */
export function capRecord(times: readonly number[], now: number): number[] {
  return [...times.filter(t => now - t < CAP_WINDOW_MS), now]
}
