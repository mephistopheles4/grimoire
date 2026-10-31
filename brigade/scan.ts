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

// Each token shape starts only where a run of its own body's characters
// starts, or right after an escaped line break or tab, as text written for a
// JSON body (`\n`), a PowerShell string (backtick-n) or a URL (`%0A`) holds
// one. Each count is bounded, so a match is tried once per run.
const ESC = String.raw`(?<=\\[nrtbf]|\\u[0-9A-Fa-f]{4}|\x60[nrt]|%0[AaDd9])`
const startAt = (cls: string) => String.raw`(?:(?<![${cls}])|${ESC})`
const shape = (cls: string, body: string) => new RegExp(startAt(cls) + body, 'g')
const TOKEN_SHAPES = [
  shape('A-Za-z0-9_-', 'sk-ant-[A-Za-z0-9_-]{20,255}'),
  shape('A-Za-z0-9_-', 'sk-(?:or-|proj-)?[A-Za-z0-9_-]{20,255}'),
  shape('A-Za-z0-9_', 'gh[pousr]_[A-Za-z0-9]{30,255}'),
  shape('A-Za-z0-9_', 'github_pat_[A-Za-z0-9_]{30,255}'),
  shape('A-Za-z0-9', '(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])'),
  shape('A-Za-z0-9_-', 'AIza[0-9A-Za-z_-]{35}'),
  shape('A-Za-z0-9-', 'xox[abprs]-[A-Za-z0-9-]{10,255}'),
  shape('A-Za-z0-9_-', 'glpat-[A-Za-z0-9_-]{20,255}'),
  shape('A-Za-z0-9_', 'npm_[A-Za-z0-9]{36}'),
  shape('A-Za-z0-9_', 'hf_[A-Za-z0-9]{30,255}'),
  shape('A-Za-z0-9_', '[rs]k_live_[A-Za-z0-9]{20,255}'),
  shape('A-Za-z0-9_-', String.raw`eyJ[A-Za-z0-9_-]{10,1024}\.eyJ[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,1024}`),
]
const KEY_HEADER = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,10}-----/g
// A home folder with a name after it: Windows with either slash, Git Bash's,
// WSL's and Cygwin's spellings of it, macOS, Linux, and a Linux home spelled
// with backslashes. `~` and `$HOME` hold no name, so they pass.
const NAME = String.raw`[^\\/\s"'<>|:*?\x60]`
// Where a Unix-shaped home may start: not inside a word or a path, and not
// right after a drive letter, which the Windows shape reports; or right after
// an escaped line break, as for the token shapes.
const AFTER = String.raw`(?:(?<![\w.-]|[A-Za-z]:)|${ESC})`
const HOME_SHAPES = [
  new RegExp(String.raw`${startAt('A-Za-z')}[A-Za-z](?::|%3A)(?:\\{1,4}|\/)[Uu]sers(?:\\{1,4}|\/)${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}(?:\/mnt|\/cygdrive)?\/[A-Za-z]\/[Uu]sers\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\/Users\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\/home\/${NAME}`, 'g'),
  new RegExp(String.raw`${AFTER}\\home\\${NAME}`, 'g'),
]

// Character classes as tables over ASCII, read by char code: a character past
// ASCII is in none of them.
const table = (chars: string) => {
  const t = new Uint8Array(128)
  for (const c of chars) t[c.charCodeAt(0)] = 1
  return t
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const LOCAL = table(`${ALNUM}._%+-`)
const DOMAIN = table(`${ALNUM}.-`)
const SCHEME = table(`${ALNUM}+.-`)
const LETTER = table(ALNUM.slice(0, 52))
const URL_STOP = table('/?#@ \t\r\n\f\v"\'<>`\\')
const has = (t: Uint8Array, code: number) => code < 128 && t[code] === 1

// An email address around each `@`: a local part of 1 to 64 characters and a
// domain of up to 255 whose last label is two letters or more. The scan of a
// side stops at the next `@`, so each character is read a bounded number of
// times. The two noreply addresses pass.
function emails(text: string, out: Finding[]) {
  for (let i = text.indexOf('@'); i !== -1; i = text.indexOf('@', i + 1)) {
    let a = i
    while (a > 0 && i - a < 64 && has(LOCAL, text.charCodeAt(a - 1))) a--
    if (a === i) continue
    let b = i + 1
    while (b < text.length && b - i <= 255 && has(DOMAIN, text.charCodeAt(b))) b++
    // The last label: letters only, two or more, after a dot that ends a
    // non-empty label. Trailing dots and hyphens are not part of the address.
    let end = b
    while (end > i + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) end--
    let tld = end
    while (tld > i + 1 && has(LETTER, text.charCodeAt(tld - 1))) tld--
    if (end - tld < 2 || end - tld > 63 || text[tld - 1] !== '.' || tld - 1 <= i + 1) continue
    const domain = text.slice(i + 1, end)
    if (domain.split('.').some(l => l === '')) continue
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
    while (a > 0 && i - a < 32 && has(SCHEME, text.charCodeAt(a - 1))) a--
    if (a === i || !has(LETTER, text.charCodeAt(a))) continue
    let b = i + 3
    while (b < text.length && b - i < 260 && !has(URL_STOP, text.charCodeAt(b))) b++
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

// A word's text with its quotes taken off, where it starts and ends in the
// command, and whether it opened with a quote: a quoted word is a value, never
// a flag, so "-Fix" in a message is not read as `-F ix`.
type Word = { text: string; at: number; end: number; quoted: boolean }

// A command's words, as simple commands, and the spans of its heredoc and
// here-string bodies.
function commandsOf(cmd: string, pwsh: boolean): { cmds: Word[][]; bodies: [number, number][] } {
  const cmds: Word[][] = []
  const bodies: [number, number][] = []
  let words: Word[] = []
  let cur = ''
  let at = -1
  let quoted = false
  let heredocs: { tag: string; strip: boolean }[] = []
  let i = 0
  const endWord = () => {
    if (at !== -1) words.push({ text: cur, at, end: i, quoted })
    cur = ''
    at = -1
  }
  const endCmd = () => {
    endWord()
    if (words.length > 0) cmds.push(words)
    words = []
  }
  const start = (from: number, q = false) => {
    if (at === -1) {
      at = from
      quoted = q
    }
  }
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === '\n') {
      endCmd()
      i++
      // A Bash heredoc's lines are data, up to the line that holds its tag;
      // each body's span is kept, since the text it writes may be posted.
      for (const h of heredocs) {
        const from = i
        let to = cmd.length
        while (i < cmd.length) {
          const nl = cmd.indexOf('\n', i)
          const line = cmd.slice(i, nl === -1 ? cmd.length : nl)
          const lineAt = i
          i = nl === -1 ? cmd.length : nl + 1
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.tag) {
            to = lineAt
            break
          }
        }
        bodies.push([from, to])
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
      // A heredoc's tag is a word; `x << 2` is a shift, and its lines are not data.
      if (/^[A-Za-z_]/.test(tag)) heredocs.push({ tag, strip })
      i = j
      continue
    }
    if (pwsh && c === '@' && at === -1 && (cmd[i + 1] === "'" || cmd[i + 1] === '"') && /^[ \t]*\r?\n/.test(cmd.slice(i + 2, i + 64))) {
      const close = `\n${cmd[i + 1]}@`
      const body = cmd.indexOf('\n', i) + 1
      const end = cmd.indexOf(close, body - 1)
      start(i, true)
      bodies.push([body, end === -1 ? cmd.length : end])
      cur += cmd.slice(body, end === -1 ? cmd.length : end)
      i = end === -1 ? cmd.length : end + close.length
      continue
    }
    if (c === "'") {
      start(i, true)
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
      start(i, true)
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
      // A line continuation joins the lines and starts no word.
      if (cmd[i + 1] === '\n') i += 2
      else if (cmd[i + 1] === '\r' && cmd[i + 2] === '\n') i += 3
      else {
        start(i)
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
  return { cmds, bodies }
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// Words that come before the program they run: Bash's reserved words and `!`,
// and programs that run the next word as a command.
const PREFIXES = new Set(['command', 'exec', 'env', 'time', 'nohup', 'sudo', 'xargs', 'if', 'then', 'do', 'else', 'elif', 'while', 'until', '!'])
const FOLDER_CHANGES = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location'])

const programOf = (w: string) =>
  (w.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')

// Where the program starts in a command's words: past assignments (`NAME=x`,
// PowerShell's `$name = ` and `$name=`), the prefixes above, `timeout` and its
// duration, and any option a prefix takes.
function programAt(words: readonly Word[]): number {
  let k = 0
  while (k < words.length) {
    const w = words[k].text
    if (words[k].quoted) break
    if (ASSIGNMENT.test(w) || /^\$[A-Za-z_][\w:]*=$/.test(w)) k++
    else if (/^\$[A-Za-z_][\w:]*$/.test(w) && words[k + 1]?.text === '=') k += 2
    else if (PREFIXES.has(w)) {
      k++
      while (k < words.length && words[k].text.startsWith('-') && !words[k].quoted) k++
    } else if (w === 'timeout') {
      k++
      while (k < words.length && words[k].text.startsWith('-') && !words[k].quoted) {
        k += ['-s', '-k', '--signal', '--kill-after'].includes(words[k].text) ? 2 : 1
      }
      k++
    } else break
  }
  return k
}

// A flag's value: `--flag value`, `--flag=value`, a one-letter flag's
// `-Fvalue`, or the one in a cluster of one-letter flags, `-aF value` or
// `-aFvalue`. A quoted word is never a flag. Returns the value and the span of
// the command that holds it, which is a local path for a body file.
type Value = { value: string; span: [number, number] }
function flagValue(words: readonly Word[], i: number, names: readonly string[]): Value | undefined {
  const word = words[i]
  if (word.quoted) return undefined
  const w = word.text
  const next = words[i + 1]
  for (const n of names) {
    if (w === n) return next === undefined ? undefined : { value: next.text, span: [next.at, next.end] }
    if (n.startsWith('--')) {
      if (w.startsWith(`${n}=`)) return { value: w.slice(n.length + 1), span: [word.at, word.end] }
    } else if (w.startsWith(n) && w.length > n.length) {
      return { value: w.slice(n.length), span: [word.at, word.end] }
    } else {
      const cluster = new RegExp(`^-[A-Za-z]+${n[1]}(.*)$`, 's').exec(w)
      if (cluster === null) continue
      if (cluster[1] !== '') return { value: cluster[1], span: [word.at, word.end] }
      return next === undefined ? undefined : { value: next.text, span: [next.at, next.end] }
    }
  }
  return undefined
}
const hasFlag = (words: readonly Word[], names: readonly string[]) =>
  words.some((_, i) => flagValue(words, i, names) !== undefined)

export type BodyFile = { path: string; base?: string }
type Matched = { from: number; files: BodyFile[]; spans: [number, number][] }

const GH_SUBS: Readonly<Record<string, readonly string[]>> = {
  issue: ['create', 'new', 'edit', 'comment', 'close', 'reopen'],
  pr: ['create', 'new', 'edit', 'comment', 'review', 'close', 'reopen', 'merge'],
  release: ['create', 'new', 'edit'],
}
const MERGE_TEXT = ['-t', '--subject', '-b', '--body', '-F', '--body-file']
const API_BODY = ['-f', '--raw-field', '-F', '--field', '--input']

function ghCall(words: readonly Word[]): Matched | undefined {
  let i = 1
  while (i < words.length && words[i].text.startsWith('-')) i += words[i].text === '-R' || words[i].text === '--repo' ? 2 : 1
  if (i >= words.length) return undefined
  const group = words[i].text
  const sub = words[i + 1]?.text ?? ''
  const rest = words.slice(i + 1)
  const found: Value[] = []
  if (group === 'api') {
    if (!hasFlag(rest, API_BODY)) return undefined
    for (let k = 0; k < rest.length; k++) {
      const input = flagValue(rest, k, ['--input'])
      const field = flagValue(rest, k, ['--field', '-F'])
      if (input !== undefined) found.push(input)
      else if (field !== undefined) {
        const m = /^[^=]*=@(.+)$/s.exec(field.value)
        if (m) found.push({ value: m[1], span: field.span })
      }
    }
  } else {
    if (!(GH_SUBS[group] ?? []).includes(sub)) return undefined
    if (group === 'pr' && sub === 'merge' && !hasFlag(rest, MERGE_TEXT)) return undefined
    const names = group === 'release' ? ['--notes-file', '-F'] : ['--body-file', '-F']
    for (let k = 0; k < rest.length; k++) {
      const v = flagValue(rest, k, names)
      if (v !== undefined) found.push(v)
    }
  }
  const files = found.filter(f => f.value !== '-')
  return { from: words[i].at, files: files.map(f => ({ path: f.value })), spans: files.map(f => f.span) }
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
  const spans: [number, number][] = []
  for (let k = 0; k < rest.length; k++) {
    const v = flagValue(rest, k, ['--file', '--fil', '-F'])
    if (v === undefined || v.value === '-') continue
    files.push(base === undefined ? { path: v.value } : { path: v.value, base })
    spans.push(v.span)
  }
  return { from: words[i].at, files, spans }
}

// --- the routes --------------------------------------------------------------

export const MOD_TOOLS = ['mcp__grimoire__set_roster', 'mcp__grimoire__log_decision', 'mcp__grimoire__set_lead_handoff'] as const
const SHELLS = ['Bash', 'PowerShell']
// The keys the engine puts beside a tool's own input, which the tool never sees.
const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']

// A text the scan reads, the field a refusal names it by, and, when they are
// fewer than the route's, the rule families that read it.
export type Part = { field: string; text: string; families?: Family[] }
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

// The command with each span turned to spaces, in one pass.
function blank(command: string, spans: readonly [number, number][]): string {
  const sorted = [...spans].sort((x, y) => x[0] - y[0])
  let out = ''
  let at = 0
  for (const [a, b] of sorted) {
    if (b <= at) continue
    const from = Math.max(a, at)
    out += command.slice(at, from) + ' '.repeat(b - from)
    at = b
  }
  return out + command.slice(at)
}

// A command's matched calls. Both rule families read the text from the first
// call's subcommand to the command's end, so a folder named before it is not
// read as a home path, and every heredoc and here-string body, wherever it
// sits, since the command may write one to the file it then posts. The secret
// shapes read the rest of the command too. A body file's own path is blanked
// out of the text: the program reads it here and never sends it. Every
// matched call's body files are read, and a change of folder anywhere in the
// command makes a relative body file one the scan refuses.
function shellRoute(command: string, pwsh: boolean): Route | undefined {
  let folderChanged = false
  let from: number | undefined
  const files: BodyFile[] = []
  const spans: [number, number][] = []
  const { cmds, bodies } = commandsOf(command, pwsh)
  for (const words of cmds) {
    const call = words.slice(programAt(words))
    if (call.length === 0) continue
    const program = programOf(call[0].text)
    if (FOLDER_CHANGES.has(program)) folderChanged = true
    const m = program === 'gh' ? ghCall(call) : program === 'git' ? gitCall(call) : undefined
    if (m === undefined) continue
    from ??= m.from
    files.push(...m.files)
    spans.push(...m.spans)
  }
  if (from === undefined) return undefined
  const text = blank(command, spans)
  const parts: Part[] = [{ field: 'command', text: text.slice(from) }]
  if (from > 0) {
    parts.push({ field: 'command', text: text.slice(0, from), families: ['secret'] })
    for (const [a, b] of bodies) if (a < from) parts.push({ field: 'command', text: command.slice(a, Math.min(b, from)) })
  }
  return { families: BOTH, parts, files, folderChanged }
}

/** The route a call takes, or undefined for a call the scan never touches. */
export function routeOf(tool: string, input: Readonly<Record<string, unknown>>): Route | undefined {
  if (SHELLS.includes(tool)) {
    return typeof input.command === 'string' ? shellRoute(input.command, tool === 'PowerShell') : undefined
  }
  if (tool === 'SendMessage') {
    // The message and its summary line both reach the other session.
    const parts: Part[] = []
    textParts(input.message, ['message'], parts)
    const out = parts.map(p => ({ field: 'message', text: p.text }))
    if (typeof input.summary === 'string') out.push({ field: 'summary', text: input.summary })
    return { families: ['secret'], parts: out, files: [], folderChanged: false }
  }
  if ((MOD_TOOLS as readonly string[]).includes(tool)) {
    const parts: Part[] = []
    for (const [k, v] of Object.entries(input)) {
      if (ENVELOPE.includes(k)) continue
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
const onWindows = (cwd: string) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(cwd)
// A path the hook would have to expand as a shell does: `~`, a variable, or
// on Windows a Unix-rooted path other than Git Bash's `/c/...` drive form.
const needsShell = (p: string) => p.startsWith('~') || /\$|%[A-Za-z_][A-Za-z0-9_]*%/.test(p)
// A share, a device or the long-path namespace: two separators at the start,
// or Windows's object-manager prefix, a backslash, two question marks and a backslash.
const isNetwork = (p: string) => /^(?:[\\/]{2}|\\\?\?\\)/.test(p)

// --- the decision ------------------------------------------------------------

const REFUSED = 'Outbound scan refused this call:'
const OFF_HINT = 'Tell the owner; the owner can type /brigade scan off to turn the scan off.'
export const FAILED = `${REFUSED} the scan failed, so the call was not checked. Nothing was sent. ${OFF_HINT}`
export const TIMED_OUT = `${REFUSED} reading and scanning its text ran past the scan's 2-second limit, so the call was not checked. Nothing was sent. ${OFF_HINT}`
export const MAX_FILES = 4
export const MAX_TOTAL = 2 * MAX_BYTES
// How a refusal names a field: "the command", "the message", or the field's
// own name ("body file 1", "cards.work").
const noun = (field: string) => (field === 'command' || field === 'message' ? `the ${field}` : field)
const tooBig = (field: string, bytes: number) =>
  `${REFUSED} ${noun(field)} is ${bytes} bytes, over the scan's limit of 1 MiB (${MAX_BYTES} bytes). Nothing was sent.`
const tooMuch = `${REFUSED} its text and body files together are over the scan's limit of 2 MiB (${MAX_TOTAL} bytes). Nothing was sent.`
const tooMany = `${REFUSED} the command names more than ${MAX_FILES} body files, more than the scan reads for one call. Nothing was sent.`
const notRegular = (field: string) =>
  `${REFUSED} ${field} is not a regular file (a pipe, a device, a folder or a link), which the scan never opens. Nothing was sent. Write the text to a plain file and name that.`
const network = (field: string) =>
  `${REFUSED} ${field} is a network or device path, which the scan never opens. Nothing was sent. Copy the text to a local file and name that.`
const unresolved = (field: string) =>
  `${REFUSED} ${field} is a path the scan cannot resolve as the shell would (it starts with ~, holds a variable, or is a Unix path on Windows). Nothing was sent. Name the file by its full path.`
const relativeAfterCd = (field: string) =>
  `${REFUSED} ${field} is a relative path after a change of folder, so the scan cannot tell which file the program would read. Nothing was sent. Name the file by its absolute path.`
const found = (hits: readonly string[]) =>
  `${REFUSED} it found ${hits.join('; ')}. Nothing was sent. Remove the value and try again; if it must go out, the owner can send it by hand.`

/** The setting as the store holds it: only the exact text `on` is on. */
export const settingOf = (v: unknown): 'on' | 'off' => (v === 'on' ? 'on' : 'off')

/** The setting as one read gives it: on, off, or unreadable when the read
 *  throws or does not answer in time. */
export type Setting = 'on' | 'off' | 'unreadable'
export async function readSetting(get: () => Promise<unknown>): Promise<Setting> {
  try {
    return settingOf(await get())
  } catch {
    return 'unreadable'
  }
}

/** The setting in force for one session: an unreadable setting counts as off
 *  until this session has read "on" since its module loaded, and as a failure,
 *  which refuses a matched call, once it has; a typed off clears what it read. */
export const settled = (s: Setting, seenOn: boolean): Setting => (s === 'unreadable' && !seenOn ? 'off' : s)

export type FileStat = { kind: string; size: number; isLink: boolean }
export type Deps = {
  /** The stored setting. A throw, or no answer within the time limit, reads
   *  as unreadable, which `settled` resolves. */
  setting: () => Promise<unknown>
  /** Whether this session has read "on" since its module loaded, and not typed off since. */
  seenOn: () => boolean
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
 *  included. A matched call with the setting off reads only the setting. The
 *  setting's read counts toward the time limit; an unreadable setting is
 *  resolved by `settled`. Any other failure after the match refuses the call. */
export async function decide(tool: string, input: Readonly<Record<string, unknown>>, deps: Deps): Promise<{ deny: string } | undefined> {
  const route = routeOf(tool, input)
  if (route === undefined) return undefined
  try {
    const started = deps.now()
    const late = () => deps.now() - started > TIME_LIMIT_MS
    const inTime = async <T>(p: Promise<T>): Promise<T | typeof LATE> => {
      const left = TIME_LIMIT_MS - (deps.now() - started)
      if (left < 0) return LATE
      return Promise.race([p, deps.after(left + 1).then(() => LATE)])
    }
    const read = await inTime(readSetting(deps.setting))
    const setting = settled(read === LATE ? 'unreadable' : read, deps.seenOn())
    if (setting === 'off') return undefined
    if (setting === 'unreadable') return { deny: FAILED }
    const parts: Part[] = [...route.parts]
    let total = 0
    for (const p of parts) {
      const bytes = utf8Bytes(p.text)
      if (bytes > MAX_BYTES) return { deny: tooBig(p.field, bytes) }
      total += bytes
    }
    if (route.files.length > MAX_FILES) return { deny: tooMany }
    let cwd: string | undefined
    const seen = new Set<string>()
    for (const [n, f] of route.files.entries()) {
      const field = `body file ${n + 1}`
      let path = f.path
      if (isNetwork(path) || (f.base !== undefined && isNetwork(f.base))) return { deny: network(field) }
      if (needsShell(path) || (f.base !== undefined && needsShell(f.base))) return { deny: unresolved(field) }
      if (cwd === undefined) {
        const got = await inTime(deps.cwd())
        if (got === LATE) return { deny: TIMED_OUT }
        cwd = got
      }
      if (onWindows(cwd) && /^\//.test(path)) {
        // Git Bash's `/c/...` is drive C; any other Unix root is not known here.
        const drive = /^\/([A-Za-z])(?:\/|$)/.exec(path)
        if (drive === null) return { deny: unresolved(field) }
        path = `${drive[1].toUpperCase()}:/${path.slice(3)}`
      }
      if (!isAbsolute(path)) {
        if (route.folderChanged) return { deny: relativeAfterCd(field) }
        const base = f.base === undefined ? cwd : isAbsolute(f.base) ? f.base : joinPath(cwd, f.base)
        path = joinPath(base, path)
      }
      const key = onWindows(cwd) ? path.replace(/\\/g, '/').toLowerCase() : path
      if (seen.has(key)) continue
      seen.add(key)
      const st = await inTime(deps.stat(path))
      if (st === LATE) return { deny: TIMED_OUT }
      if (st.kind !== 'file' || st.isLink !== false) return { deny: notRegular(field) }
      if (st.size > MAX_BYTES) return { deny: tooBig(field, st.size) }
      if (total + st.size > MAX_TOTAL) return { deny: tooMuch }
      const text = await inTime(deps.read(path))
      if (text === LATE) return { deny: TIMED_OUT }
      const bytes = utf8Bytes(String(text))
      if (bytes > MAX_BYTES) return { deny: tooBig(field, bytes) }
      total += bytes
      if (total > MAX_TOTAL) return { deny: tooMuch }
      parts.push({ field, text: String(text) })
    }
    const hits: string[] = []
    for (const p of parts) {
      if (late()) return { deny: TIMED_OUT }
      for (const f of scanText(p.text, p.families ?? route.families)) {
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

/** What the hook's catch handler does with a throw or an overrun: hand a
 *  throw from beneath back to the chain (`replay`), refuse a matched call
 *  whose setting read on or reads on now (`refuse`), or let it go (`pass`). */
export function caughtAnswer(o: { nextCalled: boolean; armed: boolean; setting: Setting }): 'replay' | 'refuse' | 'pass' {
  if (o.nextCalled) return 'replay'
  return o.armed || o.setting !== 'off' ? 'refuse' : 'pass'
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
export const showLine = (setting: Setting) =>
  setting === 'on'
    ? 'Outbound scan is on.'
    : setting === 'off'
      ? 'Outbound scan is off. Type /brigade scan on to turn it on.'
      : 'The outbound scan cannot read its setting, so it refuses every call it matches. Type /brigade scan off to turn it off in this session.'

/** The reply to a scan command, and the setting to store when it moves. Only a
 *  command the owner typed, at the prompt or over Remote Control, moves it. */
export function switchReply(arg: SwitchArg, originKind: unknown, now: Setting): { text: string; set?: 'on' | 'off' } {
  if (arg === 'bad') return { text: 'Brigade: type /brigade scan on, /brigade scan off, or /brigade scan to see the setting.' }
  if (arg === 'show') return { text: `${showLine(now)} ${ABOUT}` }
  if (typeof originKind !== 'string' || !TYPED.includes(originKind)) {
    return { text: `Brigade: the outbound scan moves only on a command the owner typed. It stays as it was.` }
  }
  return {
    set: arg,
    text: arg === 'on' ? `Outbound scan is on, for every session on this machine. ${ABOUT}` : 'Outbound scan is off, for every session on this machine.',
  }
}
