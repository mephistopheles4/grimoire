// The outbound scan (issue 450, spec rev 4, S3.2): a backstop for accidents
// that refuses a call whose outbound text holds a secret's shape, or personal
// data where the text leaves the machine. Three parts, all plain functions
// with no engine import, so tests/brigade-scan.test.mjs runs them under
// `node --test`:
//
// - the scanner: text in, findings out, each a rule and a position, never the
//   matched text. It holds no list of the owner's own values. Every pattern
//   starts only where a run of its own characters starts, and every count is
//   bounded, so a scan's time grows with the text's length and no faster;
// - the route match: which calls are read, which text and body files they
//   carry, and which rule families apply;
// - the decision: the setting, the body files' checks and reads, the limits,
//   and the refusal in fixed words. register.tsx hands it the engine's store,
//   file system and clock, and keeps nothing from a call.
//
// A composed command is read as far as its words go: the text is scanned from
// the matched call to the command's end, and a body file is resolved only
// where the folder it is read from is known. What it does not see is listed
// in the threat model, row 15.

export const MAX_BYTES = 1024 * 1024
export const TIME_LIMIT_MS = 2000

export type Family = 'secret' | 'personal'
export type Rule = 'token' | 'private-key' | 'url-user' | 'email' | 'home-path'
export type Finding = { rule: Rule; at: number }

const RULE_WORDS: Readonly<Record<Rule, string>> = {
  token: 'text shaped like a token or key',
  'private-key': 'a private-key header',
  'url-user': 'a user part in a URL',
  email: 'an email address',
  'home-path': 'a home-folder path',
}

// --- the scanner -------------------------------------------------------------

// Each token shape is anchored behind by its own body's characters, so a
// match is tried only where such a run starts, and each count is bounded.
const TOKEN_SHAPES = [
  /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,255}/g,
  /(?<![A-Za-z0-9_-])sk-(?:or-|proj-)?[A-Za-z0-9_-]{20,255}/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,255}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{30,255}/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g,
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g,
  /(?<![A-Za-z0-9-])xox[abprs]-[A-Za-z0-9-]{10,255}/g,
  /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,255}/g,
  /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}/g,
  /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,255}/g,
  /(?<![A-Za-z0-9_])[rs]k_live_[A-Za-z0-9]{20,255}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,1024}\.eyJ[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,1024}/g,
]
const KEY_HEADER = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,10}-----/g
// A home folder with a name after it: Windows with either slash, Git Bash's,
// WSL's and Cygwin's spellings of it, macOS, Linux, and a Linux home spelled
// with backslashes. `~` and `$HOME` hold no name, so they pass.
const NAME = String.raw`[^\\/\s"'<>|:*?\x60]`
// Where a Unix-shaped home may start: not inside a word or a path, and not
// right after a drive letter, which the Windows shape reports.
const AFTER = String.raw`(?<![\w.-]|[A-Za-z]:)`
const HOME_SHAPES = [
  new RegExp(String.raw`(?<![A-Za-z])[A-Za-z](?::|%3A)(?:\\{1,4}|\/)[Uu]sers(?:\\{1,4}|\/)${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}(?:\/mnt|\/cygdrive)?\/[A-Za-z]\/[Uu]sers\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\/Users\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\/home\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\\home\\${NAME}`, 'g'),
]

const LOCAL = /[A-Za-z0-9._%+-]/
const DOMAIN = /[A-Za-z0-9.-]/
const SCHEME = /[A-Za-z0-9+.-]/
const URL_STOP = /[\/?#@\s"'<>`\\]/

// An email address around each `@`: a local part of 1 to 64 characters and a
// domain of up to 255 whose last label is two letters or more. The scan of a
// side stops at the next `@`, so each character is read a bounded number of
// times. The two noreply addresses pass.
function emails(text: string, out: Finding[]) {
  for (let i = text.indexOf('@'); i !== -1; i = text.indexOf('@', i + 1)) {
    let a = i
    while (a > 0 && i - a < 64 && LOCAL.test(text[a - 1])) a--
    if (a === i) continue
    let b = i + 1
    while (b < text.length && b - i <= 255 && DOMAIN.test(text[b])) b++
    const domain = text.slice(i + 1, b).replace(/[.-]+$/, '')
    const labels = domain.split('.')
    if (labels.length < 2 || labels.some(l => l === '') || !/^[A-Za-z]{2,63}$/.test(labels[labels.length - 1])) continue
    const host = domain.toLowerCase()
    const local = text.slice(a, i).replace(/^[.]+/, '').toLowerCase()
    if (host === 'users.noreply.github.com' || (host === 'anthropic.com' && local === 'noreply')) continue
    out.push({ rule: 'email', at: a })
  }
}

// A user part in a URL: `scheme://` and then, before any `/ ? # @` or space,
// an `@` with something before it. Every `://` holds a `/`, so the scan from
// one never reaches past the next.
function urlUsers(text: string, out: Finding[]) {
  for (let i = text.indexOf('://'); i !== -1; i = text.indexOf('://', i + 3)) {
    let a = i
    while (a > 0 && i - a < 32 && SCHEME.test(text[a - 1])) a--
    if (a === i || !/[A-Za-z]/.test(text[a])) continue
    let b = i + 3
    while (b < text.length && b - i < 260 && !URL_STOP.test(text[b])) b++
    if (b > i + 3 && text[b] === '@') out.push({ rule: 'url-user', at: a })
  }
}

function each(res: readonly RegExp[], rule: Rule, text: string, out: Finding[]) {
  for (const re of res) for (const m of text.matchAll(re)) out.push({ rule, at: m.index ?? 0 })
}

/** Scans text for the given families' rules. Each finding is a rule and the
 *  position where its match starts; one rule at one position is one finding. */
export function scanText(text: string, families: readonly Family[]): Finding[] {
  const out: Finding[] = []
  if (families.includes('secret')) {
    each(TOKEN_SHAPES, 'token', text, out)
    each([KEY_HEADER], 'private-key', text, out)
    urlUsers(text, out)
  }
  if (families.includes('personal')) {
    emails(text, out)
    each(HOME_SHAPES, 'home-path', text, out)
  }
  const seen = new Set<string>()
  return out
    .filter(f => {
      const k = `${f.rule} ${f.at}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((x, y) => x.at - y.at)
}

// --- shell words -------------------------------------------------------------
//
// Enough of Bash's and PowerShell's quoting to find a `gh` or `git` call and
// its flags: quotes, escapes, a Bash heredoc (whose lines are data), a
// PowerShell here-string, comments, and the operators that end a command.

type Word = { text: string; at: number }

function commandsOf(cmd: string, pwsh: boolean): Word[][] {
  const cmds: Word[][] = []
  let words: Word[] = []
  let cur = ''
  let at = -1
  let heredocs: { tag: string; strip: boolean }[] = []
  const endWord = () => {
    if (at !== -1) words.push({ text: cur, at })
    cur = ''
    at = -1
  }
  const endCmd = () => {
    endWord()
    if (words.length > 0) cmds.push(words)
    words = []
  }
  const start = (i: number) => {
    if (at === -1) at = i
  }
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === '\n') {
      endCmd()
      i++
      // A Bash heredoc's lines are data, up to the line that holds its tag.
      for (const h of heredocs) {
        while (i < cmd.length) {
          const nl = cmd.indexOf('\n', i)
          const line = cmd.slice(i, nl === -1 ? cmd.length : nl)
          i = nl === -1 ? cmd.length : nl + 1
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.tag) break
        }
      }
      heredocs = []
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
      continue
    }
    if (c === '#' && at === -1) {
      while (i < cmd.length && cmd[i] !== '\n') i++
      continue
    }
    if (c === ';' || c === '|' || c === '&' || (at === -1 && (c === '(' || c === ')' || c === '{' || c === '}'))) {
      endCmd()
      i++
      continue
    }
    if (!pwsh && c === '`') {
      endCmd()
      i++
      continue
    }
    if (c === '$' && cmd[i + 1] === '(') {
      endCmd()
      i += 2
      continue
    }
    if (!pwsh && c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      endWord()
      let j = i + 2
      const strip = cmd[j] === '-'
      if (strip) j++
      while (cmd[j] === ' ' || cmd[j] === '\t') j++
      let tag = ''
      while (j < cmd.length && !/[\s;&|<>()]/.test(cmd[j])) {
        if (cmd[j] !== "'" && cmd[j] !== '"' && cmd[j] !== '\\') tag += cmd[j]
        j++
      }
      if (tag !== '') heredocs.push({ tag, strip })
      i = j
      continue
    }
    if (pwsh && c === '@' && at === -1 && (cmd[i + 1] === "'" || cmd[i + 1] === '"') && /^[ \t]*\r?\n/.test(cmd.slice(i + 2, i + 64))) {
      const close = `\n${cmd[i + 1]}@`
      const body = cmd.indexOf('\n', i) + 1
      const end = cmd.indexOf(close, body - 1)
      start(i)
      cur += cmd.slice(body, end === -1 ? cmd.length : end)
      i = end === -1 ? cmd.length : end + close.length
      continue
    }
    if (c === "'") {
      start(i)
      let j = i + 1
      while (j < cmd.length) {
        if (cmd[j] === "'") {
          if (pwsh && cmd[j + 1] === "'") {
            cur += "'"
            j += 2
            continue
          }
          break
        }
        cur += cmd[j++]
      }
      i = j + 1
      continue
    }
    if (c === '"') {
      start(i)
      let j = i + 1
      const esc = pwsh ? '`' : '\\'
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === esc && j + 1 < cmd.length) {
          cur += cmd[j + 1]
          j += 2
          continue
        }
        if (pwsh && cmd[j] === '"' && cmd[j + 1] === '"') {
          cur += '"'
          j += 2
          continue
        }
        cur += cmd[j++]
      }
      i = j + 1
      continue
    }
    if (c === (pwsh ? '`' : '\\')) {
      start(i)
      if (cmd[i + 1] === '\n') i += 2
      else {
        if (i + 1 < cmd.length) cur += cmd[i + 1]
        i += 2
      }
      continue
    }
    start(i)
    cur += c
    i++
  }
  endCmd()
  return cmds
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PREFIXES = new Set(['command', 'exec', 'env', 'time', 'nohup'])
const FOLDER_CHANGES = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location'])

const programOf = (w: string) =>
  (w.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')

// A flag's value: `--flag value`, `--flag=value`, or for a one-letter flag
// `-Fvalue`. Returns the value and how many words it took.
function flagValue(words: readonly Word[], i: number, names: readonly string[]): { value: string; took: number } | undefined {
  const w = words[i].text
  for (const n of names) {
    if (w === n) return i + 1 < words.length ? { value: words[i + 1].text, took: 2 } : undefined
    if (n.startsWith('--') && w.startsWith(`${n}=`)) return { value: w.slice(n.length + 1), took: 1 }
    if (!n.startsWith('--') && w.startsWith(n) && w.length > n.length) return { value: w.slice(n.length), took: 1 }
  }
  return undefined
}
const hasFlag = (words: readonly Word[], names: readonly string[]) =>
  words.some((_, i) => flagValue(words, i, names) !== undefined)

export type BodyFile = { path: string; base?: string }
type Matched = { from: number; files: BodyFile[] }

const GH_SUBS: Readonly<Record<string, readonly string[]>> = {
  issue: ['create', 'new', 'edit', 'comment', 'close', 'reopen'],
  pr: ['create', 'new', 'edit', 'comment', 'review', 'close', 'reopen', 'merge'],
  release: ['create', 'new', 'edit'],
}
const MERGE_TEXT = ['-t', '--subject', '-b', '--body', '-F', '--body-file']

function ghCall(words: readonly Word[]): Matched | undefined {
  let i = 1
  while (i < words.length && words[i].text.startsWith('-')) i += words[i].text === '-R' || words[i].text === '--repo' ? 2 : 1
  if (i >= words.length) return undefined
  const group = words[i].text
  const sub = words[i + 1]?.text ?? ''
  const rest = words.slice(i + 1)
  const files: BodyFile[] = []
  if (group === 'api') {
    for (let k = 0; k < rest.length; k++) {
      const input = flagValue(rest, k, ['--input'])
      const field = flagValue(rest, k, ['--field', '-F'])
      if (input !== undefined) files.push({ path: input.value })
      else if (field !== undefined) {
        const m = /^[^=]*=@(.+)$/s.exec(field.value)
        if (m) files.push({ path: m[1] })
      }
    }
    return { from: words[i].at, files: files.filter(f => f.path !== '-') }
  }
  if (!(GH_SUBS[group] ?? []).includes(sub)) return undefined
  if (group === 'pr' && sub === 'merge' && !hasFlag(rest, MERGE_TEXT)) return undefined
  const names = group === 'release' ? ['--notes-file', '-F'] : ['--body-file', '-F']
  for (let k = 0; k < rest.length; k++) {
    const v = flagValue(rest, k, names)
    if (v !== undefined) files.push({ path: v.value })
  }
  return { from: words[i].at, files: files.filter(f => f.path !== '-') }
}

const GIT_TAKES_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path'])
const TAG_TEXT = ['-m', '--message', '-F', '--file']

function gitCall(words: readonly Word[]): Matched | undefined {
  let i = 1
  let base: string | undefined
  while (i < words.length && words[i].text.startsWith('-')) {
    const w = words[i].text
    if (w === '-C' && i + 1 < words.length) {
      const dir = words[i + 1].text
      base = base === undefined || isAbsolute(dir) ? dir : joinPath(base, dir)
    }
    i += GIT_TAKES_VALUE.has(w) ? 2 : 1
  }
  if (i >= words.length) return undefined
  const sub = words[i].text
  const rest = words.slice(i + 1)
  if (sub !== 'commit' && !(sub === 'tag' && hasFlag(rest, TAG_TEXT))) return undefined
  const files: BodyFile[] = []
  for (let k = 0; k < rest.length; k++) {
    const v = flagValue(rest, k, ['--file', '-F'])
    if (v !== undefined && v.value !== '-') files.push(base === undefined ? { path: v.value } : { path: v.value, base })
  }
  return { from: words[i].at, files }
}

// --- the routes --------------------------------------------------------------

export const MOD_TOOLS = ['mcp__grimoire__set_roster', 'mcp__grimoire__log_decision', 'mcp__grimoire__set_lead_handoff'] as const
const SHELLS = ['Bash', 'PowerShell']

export type Part = { field: string; text: string }
export type Route = { families: Family[]; parts: Part[]; files: BodyFile[]; folderChanged: boolean }

const BOTH: Family[] = ['secret', 'personal']
const WORD = /^[A-Za-z_]{1,32}$/

// Every text value in a tool's input, each named by its top key and its own
// key when both are plain words, else by "input": a key is never echoed.
function textParts(v: unknown, path: string[], out: Part[]) {
  if (typeof v === 'string') {
    const top = path[0]
    const leaf = path[path.length - 1]
    const field = top === undefined || !WORD.test(top) ? 'input' : leaf === top || !WORD.test(leaf) ? top : `${top}.${leaf}`
    out.push({ field, text: v })
  } else if (Array.isArray(v)) {
    for (const x of v) textParts(x, path, out)
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) textParts(x, [...path, k], out)
  }
}

// A command's matched calls. The text is read from the first one's subcommand
// to the command's end, so a folder named before it is not read as a home
// path, and every matched call's body files are read. A change of folder
// anywhere in the command makes a relative body file one the scan refuses.
function shellRoute(command: string, pwsh: boolean): Route | undefined {
  let folderChanged = false
  let from: number | undefined
  const files: BodyFile[] = []
  for (const words of commandsOf(command, pwsh)) {
    let k = 0
    while (k < words.length && (ASSIGNMENT.test(words[k].text) || PREFIXES.has(words[k].text))) k++
    const call = words.slice(k)
    if (call.length === 0) continue
    const program = programOf(call[0].text)
    if (FOLDER_CHANGES.has(program)) folderChanged = true
    const m = program === 'gh' ? ghCall(call) : program === 'git' ? gitCall(call) : undefined
    if (m === undefined) continue
    from ??= m.from
    files.push(...m.files)
  }
  if (from === undefined) return undefined
  return { families: BOTH, parts: [{ field: 'command', text: command.slice(from) }], files, folderChanged }
}

/** The route a call takes, or undefined for a call the scan never touches. */
export function routeOf(tool: string, input: Readonly<Record<string, unknown>>): Route | undefined {
  if (SHELLS.includes(tool)) {
    return typeof input.command === 'string' ? shellRoute(input.command, tool === 'PowerShell') : undefined
  }
  if (tool === 'SendMessage') {
    const parts: Part[] = []
    textParts(input.message, ['message'], parts)
    return { families: ['secret'], parts: parts.map(p => ({ field: 'message', text: p.text })), files: [], folderChanged: false }
  }
  if ((MOD_TOOLS as readonly string[]).includes(tool)) {
    const parts: Part[] = []
    for (const [k, v] of Object.entries(input)) {
      if (k === 'tool' || k === 'tool_use_id' || k === 'agentId' || k === 'requestMeta') continue
      textParts(v, [k], parts)
    }
    return { families: BOTH, parts, files: [], folderChanged: false }
  }
  return undefined
}

// --- paths -------------------------------------------------------------------

const isAbsolute = (p: string) => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p)
function joinPath(base: string, rel: string): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${sep}${sep === '\\' ? rel.replace(/\//g, '\\') : rel}`
}

// --- the decision ------------------------------------------------------------

const REFUSED = 'Outbound scan refused this call:'
const OFF_HINT = 'Tell the owner; the owner can type /brigade scan off to turn the scan off.'
export const FAILED = `${REFUSED} the scan failed, so the call was not checked. Nothing was sent. ${OFF_HINT}`
export const TIMED_OUT = `${REFUSED} reading and scanning its text ran past the scan's 2-second limit, so the call was not checked. Nothing was sent. ${OFF_HINT}`
// How a refusal names a field: "the command", "the message", or the field's
// own name ("body file 1", "cards.work").
const noun = (field: string) => (field === 'command' || field === 'message' ? `the ${field}` : field)
const tooBig = (field: string, bytes: number) =>
  `${REFUSED} ${noun(field)} is ${bytes} bytes, over the scan's limit of 1 MiB (${MAX_BYTES} bytes). Nothing was sent.`
const notRegular = (field: string) =>
  `${REFUSED} ${field} is not a regular file (a pipe, a device, a folder or a link), which the scan never opens. Nothing was sent. Write the text to a plain file and name that.`
const relativeAfterCd = (field: string) =>
  `${REFUSED} ${field} is a relative path after a change of folder, so the scan cannot tell which file the program would read. Nothing was sent. Name the file by its absolute path.`
const found = (hits: readonly string[]) =>
  `${REFUSED} it found ${hits.join('; ')}. Nothing was sent. Remove the value and try again; if it must go out, the owner can send it by hand.`

/** The setting as the store holds it: only the exact text `on` is on. */
export const settingOf = (v: unknown): 'on' | 'off' => (v === 'on' ? 'on' : 'off')

export type FileStat = { kind: string; size: number; isLink: boolean }
export type Deps = {
  /** The stored setting; a throw reads as off. */
  setting: () => Promise<unknown>
  /** The folder the call runs in, as the hook reads it. */
  cwd: () => Promise<string>
  stat: (path: string) => Promise<FileStat>
  read: (path: string) => Promise<string>
  /** Milliseconds, from any fixed start. */
  now: () => number
  /** Resolves after the given milliseconds. */
  after: (ms: number) => Promise<void>
}

function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

const LATE = Symbol('late')

/** The answer for one call: a refusal in fixed words, or undefined to let the
 *  call through untouched. An unmatched call reads nothing, the setting
 *  included. A matched call with the setting off reads only the setting. Any
 *  failure after that refuses the call. */
export async function decide(tool: string, input: Readonly<Record<string, unknown>>, deps: Deps): Promise<{ deny: string } | undefined> {
  const route = routeOf(tool, input)
  if (route === undefined) return undefined
  let setting: unknown
  try {
    setting = await deps.setting()
  } catch {
    return undefined
  }
  if (settingOf(setting) !== 'on') return undefined
  try {
    const started = deps.now()
    const late = () => deps.now() - started > TIME_LIMIT_MS
    const inTime = async <T>(p: Promise<T>): Promise<T | typeof LATE> => {
      const left = TIME_LIMIT_MS - (deps.now() - started)
      if (left < 0) return LATE
      return Promise.race([p, deps.after(left + 1).then(() => LATE)])
    }
    const parts: Part[] = [...route.parts]
    for (const p of parts) {
      const bytes = utf8Bytes(p.text)
      if (bytes > MAX_BYTES) return { deny: tooBig(p.field, bytes) }
    }
    let cwd: string | undefined
    for (const [n, f] of route.files.entries()) {
      const field = `body file ${n + 1}`
      let path = f.path
      if (!isAbsolute(path)) {
        if (route.folderChanged) return { deny: relativeAfterCd(field) }
        if (cwd === undefined) {
          const got = await inTime(deps.cwd())
          if (got === LATE) return { deny: TIMED_OUT }
          cwd = got
        }
        const base = f.base === undefined ? cwd : isAbsolute(f.base) ? f.base : joinPath(cwd, f.base)
        path = joinPath(base, path)
      }
      const st = await inTime(deps.stat(path))
      if (st === LATE) return { deny: TIMED_OUT }
      if (st.kind !== 'file' || st.isLink !== false) return { deny: notRegular(field) }
      if (st.size > MAX_BYTES) return { deny: tooBig(field, st.size) }
      const text = await inTime(deps.read(path))
      if (text === LATE) return { deny: TIMED_OUT }
      const bytes = utf8Bytes(String(text))
      if (bytes > MAX_BYTES) return { deny: tooBig(field, bytes) }
      parts.push({ field, text: String(text) })
    }
    if (late()) return { deny: TIMED_OUT }
    const hits: string[] = []
    for (const p of parts) {
      for (const f of scanText(p.text, route.families)) {
        const hit = `${RULE_WORDS[f.rule]} in ${noun(p.field)}`
        if (!hits.includes(hit)) hits.push(hit)
      }
    }
    if (late()) return { deny: TIMED_OUT }
    return hits.length > 0 ? { deny: found(hits) } : undefined
  } catch {
    return { deny: FAILED }
  }
}

// --- the switch --------------------------------------------------------------

export type SwitchArg = 'on' | 'off' | 'show' | 'bad'

/** `/brigade scan on`, `off` or bare `scan`; undefined when the arguments are
 *  not about the scan, so `/brigade` keeps its own meaning. */
export function switchArgs(args: string): SwitchArg | undefined {
  const w = args.trim().split(/\s+/).filter(x => x !== '')
  if (w[0] !== 'scan') return undefined
  if (w.length === 1) return 'show'
  if (w.length === 2 && (w[1] === 'on' || w[1] === 'off')) return w[1]
  return 'bad'
}

const TYPED = ['composer', 'bridge']
const ABOUT =
  'The outbound scan refuses a gh post, a git commit or tag message, a SendMessage and the Brigade tools when their text holds a secret, and on gh, git and the Brigade tools an email address or a home-folder path. It is a backstop for accidents, in every session on this machine where grimoire loads.'
export const showLine = (setting: 'on' | 'off') =>
  setting === 'on' ? 'Outbound scan is on.' : 'Outbound scan is off. Type /brigade scan on to turn it on.'

/** The reply to a scan command, and the setting to store when it moves. Only a
 *  command the owner typed, at the prompt or over Remote Control, moves it. */
export function switchReply(arg: SwitchArg, originKind: unknown, now: 'on' | 'off'): { text: string; set?: 'on' | 'off' } {
  if (arg === 'bad') return { text: 'Brigade: type /brigade scan on, /brigade scan off, or /brigade scan to see the setting.' }
  if (arg === 'show') return { text: `${showLine(now)} ${ABOUT}` }
  if (typeof originKind !== 'string' || !TYPED.includes(originKind)) {
    return { text: `Brigade: the outbound scan moves only on a command the owner typed. It stays ${now}.` }
  }
  return {
    set: arg,
    text: arg === 'on' ? `Outbound scan is on, for every session on this machine. ${ABOUT}` : 'Outbound scan is off, for every session on this machine.',
  }
}
