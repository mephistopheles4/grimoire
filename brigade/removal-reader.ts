// The cleanup gate's removal reader (issue 359, spec v3 D1, D2 and D8). It
// takes one command's text, the shell that runs it and the platform, and
// answers what the text would remove: a worktree, a branch, a background
// session, a forced form, or a part it cannot read. It also answers whether
// the whole text is exactly one of cleanup's allowed shapes, with that
// shape's values. The gate refuses a call with any finding outside a window,
// and inside one passes only an allowed shape for an open entry.
//
// It is a reader, not a shell: it reads the text as each shell would split
// it, and fails closed on anything it cannot follow. A part it cannot read is
// a finding, never a pass. It imports nothing from the engine, keeps nothing
// it reads, and never throws: any internal error answers cannot-read.
// tests/brigade-removal-reader.test.mjs tests it as it is.
//
// A finding's path, repository, branch and id, and a shape's values, are the
// caller's own command text: they are for comparing with an open entry only,
// never for a refusal's text or for anything kept (spec v3 D5, story 17). A
// finding's `why` and `what` are fixed phrases that hold none of the text.
//
// The option tables are git 2.55.0's (`git <command> -h`), the version
// head-chef's submodule reference was measured on.

export type Shell = 'posix' | 'powershell'
export type Platform = 'win32' | 'other'

export type Finding =
  | { kind: 'removes-worktree'; path: string; repo: string | null }
  | { kind: 'deletes-branch'; name: string; repo: string | null }
  | { kind: 'removes-session'; id: string }
  | { kind: 'forced'; what: string }
  | { kind: 'cannot-read'; why: string }

/** D8's allowed shapes, with their values after the path normal form. */
export type Shape =
  | { kind: 'worktree-remove'; hooks: string; main: string; cwd: string }
  | { kind: 'branch-delete'; hooks: string; main: string; branch: string }
  | { kind: 'session-stop'; id: string }
  | { kind: 'session-rm'; id: string }

export type Reading = { findings: Finding[]; shape: Shape | null }

/** Text over this many bytes is cannot-read (D2). */
export const MAX_BYTES = 8 * 1024
// Nesting and re-reading past these depths is cannot-read.
const MAX_NEST = 64
const MAX_DEPTH = 8

/** The subcommand words D2's backstop looks for after a gated word. */
export const REMOVAL_WORDS: ReadonlySet<string> = new Set([
  'worktree', 'branch', 'update-ref', 'symbolic-ref', 'push', 'fetch', 'checkout', 'switch', 'config', 'rm', 'stop',
])

// git's own commands at 2.55.0: its built-ins, and the shipped commands
// cleanup and D2 name (`submodule`, `filter-branch`). Anything else, an alias
// or an external `git-*` program included, is cannot-read.
const GIT_COMMANDS: ReadonlySet<string> = new Set([
  'add', 'am', 'annotate', 'apply', 'archive', 'backfill', 'bisect', 'blame', 'branch', 'bugreport', 'bundle', 'cat-file',
  'check-attr', 'check-ignore', 'check-mailmap', 'check-ref-format', 'checkout', 'checkout--worker', 'checkout-index',
  'cherry', 'cherry-pick', 'clean', 'clone', 'column', 'commit', 'commit-graph', 'commit-tree', 'config',
  'count-objects', 'credential', 'credential-cache', 'credential-cache--daemon', 'credential-store', 'describe',
  'diagnose', 'diff', 'diff-files', 'diff-index', 'diff-pairs', 'diff-tree', 'difftool', 'fast-export', 'fast-import',
  'fetch', 'fetch-pack', 'fmt-merge-msg', 'for-each-ref', 'for-each-repo', 'format-patch', 'format-rev', 'fsck',
  'fsck-objects', 'fsmonitor--daemon', 'gc', 'get-tar-commit-id', 'grep', 'hash-object', 'help', 'history', 'hook',
  'index-pack', 'init', 'init-db', 'interpret-trailers', 'last-modified', 'log', 'ls-files', 'ls-remote', 'ls-tree',
  'mailinfo', 'mailsplit', 'maintenance', 'merge', 'merge-base', 'merge-file', 'merge-index', 'merge-ours',
  'merge-recursive', 'merge-recursive-ours', 'merge-recursive-theirs', 'merge-subtree', 'merge-tree', 'mktag',
  'mktree', 'multi-pack-index', 'mv', 'name-rev', 'notes', 'pack-objects', 'pack-redundant', 'pack-refs', 'patch-id',
  'pickaxe', 'prune', 'prune-packed', 'pull', 'push', 'range-diff', 'read-tree', 'rebase', 'receive-pack', 'reflog',
  'refs', 'remote', 'remote-ext', 'remote-fd', 'repack', 'replace', 'replay', 'repo', 'rerere', 'reset', 'restore',
  'rev-list', 'rev-parse', 'revert', 'rm', 'send-pack', 'shortlog', 'show', 'show-branch', 'show-index', 'show-ref',
  'sparse-checkout', 'stage', 'stash', 'status', 'stripspace', 'survey', 'switch', 'symbolic-ref',
  'tag', 'unpack-file', 'unpack-objects', 'update-index', 'update-ref', 'update-server-info', 'upload-archive',
  'upload-archive--writer', 'upload-pack', 'url-parse', 'var', 'verify-commit', 'verify-pack', 'verify-tag', 'version',
  'whatchanged', 'worktree', 'write-tree', 'submodule', 'filter-branch',
])

// git's global options cleanup and ordinary work use (D2); any other is cannot-read.
const GIT_FLAGS: ReadonlySet<string> = new Set(['--no-optional-locks', '--no-replace-objects', '--no-pager', '-P'])
const GIT_ENDS: ReadonlySet<string> = new Set(['--version', '--help'])

// Programs that run their arguments as a command (D2's wrappers).
const WRAPPERS: ReadonlySet<string> = new Set([
  'env', 'nohup', 'nice', 'ionice', 'timeout', 'gtimeout', 'time', 'command', 'builtin', 'exec', 'sudo', 'doas', 'su',
  'stdbuf', 'setsid', 'chronic', 'unbuffer', 'taskset', 'chrt', 'flock', 'caffeinate', 'watch', 'script', 'strace',
  'ltrace', 'busybox', 'winpty', 'wsl', 'start', 'call', 'runas', 'coproc', 'xargs', 'parallel', 'firejail', 'proot',
])
// Wrappers that add arguments of their own from input, so what they run cannot be read.
const FED_WRAPPERS: ReadonlySet<string> = new Set(['xargs', 'parallel'])
const POSIX_SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'yash'])
const PS_SHELLS: ReadonlySet<string> = new Set(['pwsh', 'powershell', 'powershell_ise'])
// Interpreters whose inline code is cannot-read when it holds a gated word (D2).
const CODE_INTERPRETERS: ReadonlySet<string> = new Set([
  'node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'python2', 'py', 'pypy', 'pypy3', 'perl', 'ruby', 'php', 'lua',
  'luajit', 'rscript', 'osascript', 'tclsh', 'awk', 'gawk', 'mawk', 'nawk', 'jshell', 'groovy', 'scala', 'julia',
])
const INLINE_FLAGS: ReadonlySet<string> = new Set(['-e', '-E', '-c', '-r', '-p', '--eval', '--print', '--command'])
const CODE_GATED = /\b(git|claude|worktree)\b/i
const POSIX_RESERVED: ReadonlySet<string> = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until'])
const PS_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'elseif', 'else', 'switch', 'foreach', 'for', 'while', 'do', 'until', 'try', 'catch', 'finally', 'trap',
  'begin', 'process', 'end', 'param', 'dynamicparam', 'class', 'enum', 'using', 'data', 'configuration', 'parallel',
  'sequence', 'inlinescript', 'clean',
])
const PS_FLOW: ReadonlySet<string> = new Set(['return', 'throw', 'exit', 'break', 'continue'])
const PS_FUNCTION: ReadonlySet<string> = new Set(['function', 'filter', 'workflow'])
const PS_ASSIGN: ReadonlySet<string> = new Set(['=', '+=', '-=', '*=', '/=', '%=', '??='])
const SUFFIX = /\.(exe|cmd|bat|com|ps1)$/i

class ParseError extends Error {}
const fail = (why: string): never => {
  throw new ParseError(why)
}

// --- words and scripts ---------------------------------------------------------------

type Word = {
  raw: string
  value: string
  // A quote or an escape (D2's command-position rule).
  quoted: boolean
  escaped: boolean
  // A variable, a substitution, a splat, a glob, a brace form, a tilde, or a
  // part the reader does not decode: its value is not known.
  expands: boolean
  subs: Script[]
  // A construct outside the strict subset (q3 B): a backtick or `${...}`
  // substitution, ANSI-C quoting, a process substitution, an extglob, an
  // array, a PowerShell script block, hashtable, type or splat.
  exotic?: boolean
  // PowerShell: the whole token is a string, a group, a call operator, a type, or a here-string.
  str?: boolean
  group?: string
  op?: boolean
  hereString?: boolean
}
type Redir = { op: string; target: Word | null; body?: { quoted: boolean; subs: Script[] } }
type Simple = {
  words: Word[]
  redirs: Redir[]
  groups: Script[]
  continued: boolean
  hereString: boolean
  stopParsing: boolean
  funcDef: boolean
  punct: boolean
}
type Item = { pipe: Simple[]; sep: string }
type Script = { items: Item[]; comment: boolean }

const literal = (w: Word): boolean => !w.expands
const emptySimple = (): Simple => ({
  words: [], redirs: [], groups: [], continued: false, hereString: false, stopParsing: false, funcDef: false, punct: false,
})

type Lexer = { src: string; i: number; nest: number; heredocs: { delim: string; strip: boolean; quoted: boolean; redir: Redir }[] }

// --- the POSIX lexer -------------------------------------------------------------------

const POSIX_META = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>'])

function parsePosix(src: string): Script {
  const lx: Lexer = { src, i: 0, nest: 0, heredocs: [] }
  const s = posixList(lx, null)
  if (lx.heredocs.length > 0) fail('heredoc body missing')
  return s
}

function posixList(lx: Lexer, closer: ')' | null): Script {
  if (++lx.nest > MAX_NEST) fail('too deep')
  const script: Script = { items: [], comment: false }
  let pipe: Simple[] = []
  let cur = emptySimple()
  const endSimple = () => {
    if (cur.words.length > 0 || cur.redirs.length > 0 || cur.groups.length > 0) pipe.push(cur)
    else if (cur.continued && pipe.length > 0) pipe[pipe.length - 1].continued = true
    cur = emptySimple()
  }
  const endItem = (sep: string) => {
    endSimple()
    if (pipe.length > 0) script.items.push({ pipe, sep })
    else if (sep !== '\n' && sep !== '') fail('empty command')
    pipe = []
  }
  const { src } = lx
  for (;;) {
    const ch = src[lx.i]
    if (ch === undefined) {
      if (closer !== null) fail('unclosed group')
      endItem('')
      break
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { lx.i++; continue }
    if (ch === '\\' && src[lx.i + 1] === '\n') { lx.i += 2; cur.continued = true; continue }
    if (ch === '#' ) {
      while (lx.i < src.length && src[lx.i] !== '\n') lx.i++
      script.comment = true
      continue
    }
    if (ch === ')') {
      if (closer !== ')') fail('unmatched )')
      lx.i++
      endItem('')
      break
    }
    if (ch === '\n') {
      lx.i++
      endItem('\n')
      readHeredocs(lx)
      continue
    }
    if (ch === ';') {
      if (src[lx.i + 1] === ';' || src[lx.i + 1] === '&') fail('case clause')
      lx.i++
      endItem(';')
      continue
    }
    if (ch === '&') {
      if (src[lx.i + 1] === '&') { lx.i += 2; endItem('&&'); continue }
      if (src[lx.i + 1] === '>') { posixRedir(lx, cur); continue }
      lx.i++
      endItem('&')
      continue
    }
    if (ch === '|') {
      if (src[lx.i + 1] === '|') { lx.i += 2; endItem('||'); continue }
      lx.i += src[lx.i + 1] === '&' ? 2 : 1
      if (cur.words.length === 0 && cur.groups.length === 0 && cur.redirs.length === 0) fail('empty pipe')
      endSimple()
      continue
    }
    if (ch === '(') {
      if (cur.words.length > 0) {
        // `name()`: a function definition.
        if (src[lx.i + 1] === ')') { lx.i += 2; cur.funcDef = true; continue }
        fail('unexpected (')
      }
      lx.i++
      cur.groups.push(posixList(lx, ')'))
      continue
    }
    if ((ch === '<' || ch === '>') && src[lx.i + 1] !== '(') { posixRedir(lx, cur); continue }
    const w = posixWord(lx)
    // A file descriptor before a redirection: `2>`.
    if (/^\d+$/.test(w.raw) && (src[lx.i] === '<' || src[lx.i] === '>') && src[lx.i + 1] !== '(') { posixRedir(lx, cur); continue }
    cur.words.push(w)
  }
  lx.nest--
  return script
}

function posixRedir(lx: Lexer, cur: Simple) {
  const { src } = lx
  const m = /^(&>>|&>|<<<|<<-|<<|<>|<&|<|>>|>&|>\||>)/.exec(src.slice(lx.i, lx.i + 3))
  if (m === null) fail('redirection')
  const op = (m as RegExpExecArray)[1]
  lx.i += op.length
  while (src[lx.i] === ' ' || src[lx.i] === '\t') lx.i++
  if (lx.i >= src.length || POSIX_META.has(src[lx.i]) && !(src[lx.i] === '<' || src[lx.i] === '>')) fail('redirection target')
  const target = posixWord(lx)
  const redir: Redir = { op, target }
  if (op === '<<' || op === '<<-') {
    const quoted = target.quoted || target.escaped
    if (target.expands && !quoted) fail('heredoc delimiter')
    lx.heredocs.push({ delim: target.value, strip: op === '<<-', quoted, redir })
  }
  if (op === '<<<') cur.hereString = true
  cur.redirs.push(redir)
}

function readHeredocs(lx: Lexer) {
  const { src } = lx
  for (const h of lx.heredocs.splice(0)) {
    const start = lx.i
    let end = -1
    while (lx.i <= src.length) {
      const nl = src.indexOf('\n', lx.i)
      const lineEnd = nl === -1 ? src.length : nl
      let line = src.slice(lx.i, lineEnd).replace(/\r$/, '')
      if (h.strip) line = line.replace(/^\t+/, '')
      if (line === h.delim) { end = lx.i; lx.i = nl === -1 ? src.length : nl + 1; break }
      if (nl === -1) break
      lx.i = nl + 1
    }
    if (end === -1) fail('heredoc not closed')
    const body = src.slice(start, end)
    h.redir.body = { quoted: h.quoted, subs: h.quoted ? [] : posixExpansions(body, lx.nest) }
  }
}

// The substitutions in an unquoted heredoc's body, which the shell runs.
function posixExpansions(text: string, nest: number): Script[] {
  const lx: Lexer = { src: text, i: 0, nest, heredocs: [] }
  const subs: Script[] = []
  while (lx.i < text.length) {
    const ch = text[lx.i]
    if (ch === '\\') { lx.i += 2; continue }
    if (ch === '$' || ch === '`') {
      const w: Word = { raw: '', value: '', quoted: false, escaped: false, expands: false, subs }
      if (!posixDollarOrTick(lx, w)) lx.i++
      continue
    }
    lx.i++
  }
  return subs
}

// Reads `$...` or a backtick part at lx.i into w; false when it is a plain `$`.
function posixDollarOrTick(lx: Lexer, w: Word): boolean {
  const { src } = lx
  const ch = src[lx.i]
  if (ch === '`') {
    let j = lx.i + 1
    let inner = ''
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\' && (src[j + 1] === '`' || src[j + 1] === '\\' || src[j + 1] === '$')) { inner += src[j + 1]; j += 2; continue }
      inner += src[j]
      j++
    }
    if (j >= src.length) fail('unclosed backtick')
    lx.i = j + 1
    if (lx.nest + 1 > MAX_NEST) fail('too deep')
    const sub: Lexer = { src: inner, i: 0, nest: lx.nest + 1, heredocs: [] }
    w.subs.push(posixList(sub, null))
    w.expands = true
    w.exotic = true
    return true
  }
  const next = src[lx.i + 1]
  if (next === '(') {
    lx.i += 2
    w.subs.push(posixList(lx, ')'))
    w.expands = true
    return true
  }
  if (next === '{') {
    // `${...}`: its body may hold substitutions of its own.
    lx.i += 2
    let depth = 1
    while (lx.i < src.length && depth > 0) {
      const c = src[lx.i]
      if (c === '\\') { lx.i += 2; continue }
      if (c === "'") { const e = src.indexOf("'", lx.i + 1); if (e === -1) fail('unclosed quote'); lx.i = e + 1; continue }
      if (c === '$' || c === '`') { if (!posixDollarOrTick(lx, w)) lx.i++; continue }
      if (c === '{') depth++
      if (c === '}') depth--
      lx.i++
    }
    if (depth > 0) fail('unclosed ${')
    w.expands = true
    w.exotic = true
    return true
  }
  if (next === "'") {
    // `$'...'`: escapes the reader does not decode.
    const e = src.indexOf("'", lx.i + 2)
    if (e === -1) fail('unclosed quote')
    lx.i = e + 1
    w.expands = true
    w.quoted = true
    w.exotic = true
    return true
  }
  if (next !== undefined && /[A-Za-z0-9_?$#@*!\-]/.test(next)) {
    lx.i += 2
    if (/[A-Za-z_]/.test(next)) while (lx.i < src.length && /[A-Za-z0-9_]/.test(src[lx.i])) lx.i++
    w.expands = true
    return true
  }
  return false
}

function posixWord(lx: Lexer): Word {
  const { src } = lx
  const start = lx.i
  const w: Word = { raw: '', value: '', quoted: false, escaped: false, expands: false, subs: [] }
  let bare = ''
  while (lx.i < src.length) {
    const ch = src[lx.i]
    if ((ch === '<' || ch === '>') && src[lx.i + 1] === '(') {
      // Process substitution.
      lx.i += 2
      w.subs.push(posixList(lx, ')'))
      w.expands = true
      w.exotic = true
      continue
    }
    if (ch === '(' && lx.i > start && /[@!+*?]/.test(src[lx.i - 1])) {
      // An extglob: a glob, whatever it holds.
      let depth = 0
      while (lx.i < src.length) {
        if (src[lx.i] === '(') depth++
        if (src[lx.i] === ')' && --depth === 0) break
        lx.i++
      }
      if (lx.i >= src.length) fail('unclosed extglob')
      lx.i++
      w.expands = true
      w.exotic = true
      continue
    }
    if (ch === '(' && lx.i > start && src[lx.i - 1] === '=' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(src.slice(start, lx.i))) {
      // `a=(...)`: an array, read as words of its own.
      lx.i++
      w.subs.push(posixList(lx, ')'))
      w.expands = true
      w.exotic = true
      continue
    }
    if (POSIX_META.has(ch)) break
    if (ch === '\\') {
      if (src[lx.i + 1] === '\n') { lx.i += 2; continue }
      if (lx.i + 1 >= src.length) fail('trailing backslash')
      w.value += src[lx.i + 1]
      w.escaped = true
      lx.i += 2
      continue
    }
    if (ch === "'") {
      const e = src.indexOf("'", lx.i + 1)
      if (e === -1) fail('unclosed quote')
      w.value += src.slice(lx.i + 1, e)
      w.quoted = true
      lx.i = e + 1
      continue
    }
    if (ch === '"') {
      w.quoted = true
      lx.i++
      for (;;) {
        const c = src[lx.i]
        if (c === undefined) fail('unclosed quote')
        if (c === '"') { lx.i++; break }
        if (c === '\\' && /[$`"\\\n]/.test(src[lx.i + 1] ?? '')) {
          if (src[lx.i + 1] !== '\n') w.value += src[lx.i + 1]
          lx.i += 2
          continue
        }
        if ((c === '$' || c === '`') && posixDollarOrTick(lx, w)) continue
        w.value += c
        lx.i++
      }
      continue
    }
    if ((ch === '$' || ch === '`') && posixDollarOrTick(lx, w)) continue
    w.value += ch
    bare += ch
    lx.i++
  }
  w.raw = src.slice(start, lx.i)
  if (/[*?]|\[.*\]/.test(bare) || /\{[^{}]*(,|\.\.)[^{}]*\}/.test(bare) || bare.startsWith('~')) w.expands = true
  return w
}

// --- the PowerShell lexer -------------------------------------------------------------------

// PowerShell takes the typographic quotes as quotes too.
const SQ = new Set(["'", '\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}'])
const DQ = new Set(['"', '\u{201C}', '\u{201D}', '\u{201E}'])
const PS_END = new Set([' ', '\t', '\r', '\n', ';', '|', '&', '(', ')', '{', '}', ',', '<', '>'])

function parsePs(src: string): Script {
  return psList({ src, i: 0, nest: 0, heredocs: [] }, null)
}

function psList(lx: Lexer, closer: ')' | '}' | null): Script {
  if (++lx.nest > MAX_NEST) fail('too deep')
  const script: Script = { items: [], comment: false }
  let pipe: Simple[] = []
  let cur = emptySimple()
  const endSimple = () => {
    if (cur.words.length > 0 || cur.redirs.length > 0) pipe.push(cur)
    else if (cur.continued && pipe.length > 0) pipe[pipe.length - 1].continued = true
    cur = emptySimple()
  }
  const endItem = (sep: string) => {
    endSimple()
    if (pipe.length > 0) script.items.push({ pipe, sep })
    pipe = []
  }
  const { src } = lx
  for (;;) {
    const ch = src[lx.i]
    if (ch === undefined) {
      if (closer !== null) fail('unclosed group')
      endItem('')
      break
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { lx.i++; continue }
    if (ch === '`' && (src[lx.i + 1] === '\n' || src[lx.i + 1] === '\r' && src[lx.i + 2] === '\n')) {
      lx.i += src[lx.i + 1] === '\n' ? 2 : 3
      cur.continued = true
      continue
    }
    if (ch === '<' && src[lx.i + 1] === '#') {
      const e = src.indexOf('#>', lx.i + 2)
      if (e === -1) fail('unclosed comment')
      lx.i = e + 2
      script.comment = true
      continue
    }
    if (ch === '#') {
      while (lx.i < src.length && src[lx.i] !== '\n') lx.i++
      script.comment = true
      continue
    }
    if (ch === ')' || ch === '}') {
      if (ch !== closer) fail('unmatched closer')
      lx.i++
      endItem('')
      break
    }
    if (ch === '\n' || ch === ';') { lx.i++; endItem(ch); continue }
    if (ch === '|') {
      if (src[lx.i + 1] === '|') { lx.i += 2; endItem('||'); continue }
      lx.i++
      endSimple()
      continue
    }
    if (ch === '&') {
      if (src[lx.i + 1] === '&') { lx.i += 2; endItem('&&'); continue }
      lx.i++
      if (cur.words.length === 0) { cur.words.push({ raw: '&', value: '&', quoted: false, escaped: false, expands: false, subs: [], op: true }); continue }
      endItem('&')
      continue
    }
    if (ch === ',') { lx.i++; cur.punct = true; continue }
    const redir = /^(\*|[1-6])?(>>|>)(&[12])?/.exec(src.slice(lx.i, lx.i + 5))
    if (ch === '<') fail('PowerShell input redirection')
    if (redir !== null && (ch === '>' || src[lx.i + (redir[1] ?? '').length] === '>')) {
      lx.i += redir[0].length
      let target: Word | null = null
      if (redir[3] === undefined) {
        while (src[lx.i] === ' ' || src[lx.i] === '\t') lx.i++
        if (lx.i >= src.length || PS_END.has(src[lx.i]) && src[lx.i] !== '(' && src[lx.i] !== '{') fail('redirection target')
        target = psToken(lx, cur)
      }
      cur.redirs.push({ op: redir[0], target })
      continue
    }
    const w = psToken(lx, cur)
    if (w.value === '--%' && !w.quoted && !w.escaped) {
      // Stop-parsing: the rest of the line goes to the program as it is.
      cur.stopParsing = true
      while (lx.i < src.length && src[lx.i] !== '\n') lx.i++
    }
    cur.words.push(w)
  }
  lx.nest--
  return script
}

function psDouble(lx: Lexer, w: Word, here: boolean) {
  // Reads a double-quoted string's body from lx.i up to its end.
  const { src } = lx
  for (;;) {
    const c = src[lx.i]
    if (c === undefined) fail('unclosed string')
    if (here) {
      if (c === '\n' && (src.startsWith('"@', lx.i + 1) || src.startsWith('\r\n"@', lx.i))) {
        lx.i = src.indexOf('"@', lx.i) + 2
        return
      }
    } else if (DQ.has(c)) {
      if (DQ.has(src[lx.i + 1] ?? '')) { w.value += '"'; lx.i += 2; continue }
      lx.i++
      return
    }
    if (c === '`') {
      if (lx.i + 1 >= src.length) fail('trailing backtick')
      w.value += src[lx.i + 1]
      w.escaped = true
      lx.i += 2
      continue
    }
    if (c === '$' && psDollar(lx, w)) continue
    w.value += c
    lx.i++
  }
}

// Reads a `$` part at lx.i into w; false when it is a plain `$`.
function psDollar(lx: Lexer, w: Word): boolean {
  const { src } = lx
  const next = src[lx.i + 1]
  if (next === '(') {
    lx.i += 2
    w.subs.push(psList(lx, ')'))
    w.expands = true
    return true
  }
  if (next === '{') {
    const e = src.indexOf('}', lx.i + 2)
    if (e === -1) fail('unclosed ${')
    lx.i = e + 1
    w.expands = true
    w.exotic = true
    return true
  }
  if (next !== undefined && /[A-Za-z0-9_?$^:]/.test(next)) {
    lx.i += 2
    while (lx.i < src.length && /[A-Za-z0-9_:]/.test(src[lx.i])) lx.i++
    w.expands = true
    return true
  }
  return false
}

function psToken(lx: Lexer, cur: Simple): Word {
  const { src } = lx
  const start = lx.i
  const w: Word = { raw: '', value: '', quoted: false, escaped: false, expands: false, subs: [] }
  const ch = src[lx.i]
  const done = () => {
    w.raw = src.slice(start, lx.i)
    return w
  }
  if (ch === '@' && (SQ.has(src[lx.i + 1]) || DQ.has(src[lx.i + 1])) && /^\r?\n/.test(src.slice(lx.i + 2, lx.i + 4))) {
    // A here-string: data, unless double-quoted, where `$(...)` runs.
    const single = SQ.has(src[lx.i + 1])
    lx.i += src[lx.i + 2] === '\r' ? 4 : 3
    w.str = true
    w.quoted = true
    w.hereString = true
    cur.hereString = true
    if (single) {
      const m = /\r?\n'@/.exec(src.slice(lx.i))
      if (m === null) fail('unclosed here-string')
      w.value = src.slice(lx.i, lx.i + (m as RegExpExecArray).index)
      lx.i += (m as RegExpExecArray).index + (m as RegExpExecArray)[0].length
    } else {
      lx.i--
      psDouble(lx, w, true)
    }
    return done()
  }
  if (ch === '@' && (src[lx.i + 1] === '(' || src[lx.i + 1] === '{')) {
    lx.i += 2
    w.group = src[lx.i - 1] === '(' ? '@(' : '@{'
    w.exotic = w.group === '@{'
    w.subs.push(psList(lx, src[lx.i - 1] === '(' ? ')' : '}'))
    w.expands = true
    return done()
  }
  if (ch === '(' || ch === '{') {
    lx.i++
    w.group = ch
    w.exotic = ch === '{'
    w.subs.push(psList(lx, ch === '(' ? ')' : '}'))
    w.expands = true
    return done()
  }
  if (ch === '[' ) {
    // A type literal, as `[string]`.
    let depth = 0
    while (lx.i < src.length) {
      if (src[lx.i] === '[') depth++
      if (src[lx.i] === ']' && --depth === 0) { lx.i++; break }
      lx.i++
    }
    if (depth > 0) fail('unclosed [')
    while (lx.i < src.length && !PS_END.has(src[lx.i])) lx.i++
    w.group = '['
    w.expands = true
    w.exotic = true
    return done()
  }
  let first = true
  while (lx.i < src.length) {
    const c = src[lx.i]
    if (PS_END.has(c)) break
    if (SQ.has(c)) {
      let j = lx.i + 1
      for (;;) {
        if (j >= src.length) fail('unclosed string')
        if (SQ.has(src[j])) {
          if (SQ.has(src[j + 1] ?? '')) { w.value += "'"; j += 2; continue }
          break
        }
        w.value += src[j]
        j++
      }
      lx.i = j + 1
      w.quoted = true
      if (first && (lx.i >= src.length || PS_END.has(src[lx.i]))) w.str = true
      first = false
      continue
    }
    if (DQ.has(c)) {
      lx.i++
      psDouble(lx, w, false)
      w.quoted = true
      if (first && (lx.i >= src.length || PS_END.has(src[lx.i]))) w.str = true
      first = false
      continue
    }
    if (c === '`') {
      if (lx.i + 1 >= src.length) fail('trailing backtick')
      w.value += src[lx.i + 1]
      w.escaped = true
      lx.i += 2
      first = false
      continue
    }
    if (c === '$' && psDollar(lx, w)) { first = false; continue }
    if (c === '@' && first && /[A-Za-z_]/.test(src[lx.i + 1] ?? '')) {
      // A splat.
      lx.i++
      while (lx.i < src.length && /[A-Za-z0-9_]/.test(src[lx.i])) lx.i++
      w.expands = true
      w.exotic = true
      first = false
      continue
    }
    w.value += c
    lx.i++
    first = false
  }
  if (lx.i === start) fail('unexpected character')
  if (!w.quoted && /[*?]/.test(w.value)) w.expands = true
  return done()
}

// --- names and paths ------------------------------------------------------------------------

/** A program word's name: path stripped, an executable suffix stripped, and on win32 case folded. */
export function normProgram(value: string, platform: Platform): string {
  let name = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  name = name.replace(SUFFIX, '')
  return platform === 'win32' ? name.toLowerCase() : name
}

/** D2's path normal form: one separator, no trailing separator, and on win32
 *  a Git Bash drive form read as its drive and letters compared without case. */
export function normPath(path: string, platform: Platform, shell: Shell = 'posix'): string {
  let p = String(path).replace(/\\/g, '/')
  const unc = p.startsWith('//')
  p = p.replace(/\/{2,}/g, '/')
  if (unc) p = `/${p}`
  if (platform === 'win32') {
    // The drive form is Git Bash's; under PowerShell, git reads `/h/...` as a path on the current drive.
    const m = shell === 'posix' ? /^\/([A-Za-z])(\/|$)/.exec(p) : null
    if (m !== null && !unc) p = `${m[1]}:/${p.slice(m[0].length)}`
    p = p.toLowerCase()
  }
  if (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) p = p.replace(/\/+$/, '')
  return p
}

const absolute = (p: string, platform: Platform) =>
  p.startsWith('/') || (platform === 'win32' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')))

// --- reading ----------------------------------------------------------------------------------

// `strict`: the text holds a gated word and a removal word (q3 B). `reads`:
// the texts read so far, capped so nested wrappers cannot multiply the work.
type Ctx = { findings: Finding[]; platform: Platform; depth: number; strict: boolean; reads: number }
type Fed = { piped: boolean; input: boolean }

const MAX_READS = 64
const cannot = (ctx: Ctx, why: string) => ctx.findings.push({ kind: 'cannot-read', why })

function readText(text: string, shell: Shell, ctx: Ctx) {
  if (ctx.depth + 1 > MAX_DEPTH) return cannot(ctx, 'too deep')
  if (++ctx.reads > MAX_READS) return cannot(ctx, 'too many reads')
  let script: Script
  try {
    script = shell === 'posix' ? parsePosix(text) : parsePs(text)
  } catch (e) {
    if (e instanceof ParseError) return cannot(ctx, e.message)
    throw e
  }
  ctx.depth++
  readScript(script, shell, ctx)
  if (ctx.strict) strictScript(script, shell, ctx)
  ctx.depth--
}

// --- q3 B: the strict subset -----------------------------------------------------------------
//
// A text whose folded form holds git or claude and a removal word, or a
// variable and one of git's own removal words, passes only when every
// construct in it is one this reader reads exactly. Anything else in such a
// text is cannot-read, so a construct the reader splits differently from the
// real shell fails closed, the next unknown one included. Text without such a
// pair is read as before.

// The removal words a pair looks for: D2's, and git's other ref writers.
const TRIP = /\b(worktree|branch|update-ref|symbolic-ref|push|fetch|checkout|switch|config|rm|stop|replay|fast-import|send-pack|fetch-pack|pull|filter-branch|for-each-repo)\b/
// git's own removal words, which a variable can stand in front of.
const GIT_TRIP = /\b(worktree|branch|update-ref|symbolic-ref|replay|fast-import|send-pack|fetch-pack|filter-branch|for-each-repo)\b/
// A `.git` folder in a path is not the program.
const GATED_RE = /(^|[^.\w])(git|claude)\b/
const VAR_RE = /\$(\{|[a-z_]|[?$#@*!0-9-])/

/** Lower case, with the characters a shell removes or escapes with dropped. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/['"`\\^\u{2018}-\u{201F}]/gu, '')
}

export function strictPair(text: string): boolean {
  const f = fold(text)
  return (GATED_RE.test(f) && TRIP.test(f)) || (VAR_RE.test(f) && GIT_TRIP.test(f))
}

// Programs whose arguments and input are data: nothing they are given runs.
const DATA_PROGRAMS: ReadonlySet<string> = new Set([
  'echo', 'printf', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'pwd', 'cd',
  'mkdir', 'touch', 'true', 'false', 'test', '[', 'basename', 'dirname', 'realpath', 'date', 'sleep', 'tee', 'gh',
  'write-output', 'write-host', 'out-null', 'out-string', 'select-string', 'get-content', 'gc', 'get-childitem', 'gci',
  'dir', 'select-object', 'select', 'sort-object', 'measure-object', 'get-date', 'get-location', 'set-location', 'sl',
  'test-path', 'resolve-path', 'join-path', 'split-path', 'format-table', 'format-list', 'convertto-json', 'convertfrom-json',
])
// Programs that run what they are given, in any form: never in a strict text.
const STRICT_REFUSED: ReadonlySet<string> = new Set([
  ...WRAPPERS, ...POSIX_SHELLS, ...PS_SHELLS, ...CODE_INTERPRETERS, 'cmd', 'eval', 'iex', 'invoke-expression',
  'start-process', 'saps', 'invoke-command', 'icm', 'start-job', 'sajb', 'start-threadjob', 'invoke-item', 'ii',
  'alias', 'set-alias', 'new-alias', 'sal', 'nal', 'hash', 'trap', 'source', 'find', 'sed', 'vi', 'vim', 'nano',
  'ex', 'ed', 'emacs', 'make', 'npx', 'cp', 'ln', 'copy', 'copy-item', 'cpi', 'move-item', 'mklink', 'new-item', 'ni',
  'set-item', 'si', 'foreach-object', '%', 'where-object', '?', 'invoke-command', 'ssh',
])
const POSIX_STRICT_HEADS: ReadonlySet<string> = new Set([
  ...POSIX_RESERVED, 'for', 'select', 'case', 'esac', 'function', 'time', 'coproc', '[[', '.',
])

function strictScript(s: Script, shell: Shell, ctx: Ctx) {
  for (const item of s.items) {
    if (shell === 'posix' && item.sep === '&') cannot(ctx, 'outside the strict subset')
    for (const c of item.pipe) strictSimple(c, shell, ctx)
  }
}

function strictSimple(c: Simple, shell: Shell, ctx: Ctx) {
  const out = () => cannot(ctx, 'outside the strict subset')
  if (c.funcDef || c.groups.length > 0 || c.continued || c.stopParsing) return out()
  for (const r of c.redirs) {
    if (r.op === '<<<' || (r.body !== undefined && !r.body.quoted)) return out()
    if (r.target?.exotic) return out()
    for (const sub of r.target?.subs ?? []) strictScript(sub, shell, ctx)
  }
  for (const w of c.words) {
    if (w.exotic) return out()
    for (const sub of w.subs) strictScript(sub, shell, ctx)
  }
  let words = c.words
  if (shell === 'posix') {
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(words[0].raw)) words = words.slice(1)
  } else if (words.length > 0 && (/^[$@]/.test(words[0].raw) || words[0].str || words[0].group !== undefined)) {
    // An expression or an assignment: its right-hand side is a statement of its own.
    const k = words.findIndex(w => !w.quoted && literal(w) && PS_ASSIGN.has(w.value))
    if (k < 0) return strictOwnText(words, ctx)
    words = words.slice(k + 1)
    if (words.length === 0) return
    if (/^[$@]/.test(words[0].raw) || words[0].str || words[0].group !== undefined) return strictOwnText(words, ctx)
  }
  if (words.length === 0) return
  let head = words[0]
  let rest = words.slice(1)
  const headValue = literal(head) && !head.quoted && !head.escaped ? head.value.toLowerCase() : ''
  if (shell === 'posix' && POSIX_STRICT_HEADS.has(headValue)) return out()
  if (shell === 'powershell') {
    if (PS_KEYWORDS.has(headValue) || PS_FLOW.has(headValue) || PS_FUNCTION.has(headValue)) return out()
    if (head.op || headValue === '.') {
      // `&` or `.` on a literal path is a command; on anything else it was refused already.
      if (rest.length === 0 || !literal(rest[0]) || rest[0].group !== undefined) return out()
      head = rest[0]
      rest = rest.slice(1)
    }
  }
  if (!literal(head)) return out()
  const name = normProgram(head.value, ctx.platform)
  const lower = name.toLowerCase()
  if (isGated(name)) return
  if (STRICT_REFUSED.has(lower) || lower.startsWith('git-')) return out()
  if (DATA_PROGRAMS.has(lower) && !(lower === 'gh' && rest.some(w => /^(alias|extension|ext)$/.test(w.value)))) return
  strictOwnText([head, ...rest], ctx)
}

// Any other command, or an expression: it may not name git or claude, nor put
// a variable in front of one of git's removal words.
function strictOwnText(words: Word[], ctx: Ctx) {
  const own = fold(words.map(w => (w.subs.length > 0 ? w.value : w.raw) + (literal(w) ? '' : ' $v')).join(' '))
  if (GATED_RE.test(own)) return cannot(ctx, 'outside the strict subset')
  const v = own.search(/\$/)
  if (v >= 0 && GIT_TRIP.test(own.slice(v))) cannot(ctx, 'outside the strict subset')
}

function readScript(s: Script, shell: Shell, ctx: Ctx) {
  for (const item of s.items) {
    item.pipe.forEach((c, i) => readSimple(c, shell, ctx, i > 0))
  }
}

function readNested(c: Simple, shell: Shell, ctx: Ctx) {
  const words = [...c.words, ...c.redirs.flatMap(r => (r.target === null ? [] : [r.target]))]
  for (const w of words) for (const s of w.subs) readScript(s, shell, ctx)
  for (const r of c.redirs) for (const s of r.body?.subs ?? []) readScript(s, shell, ctx)
  for (const g of c.groups) readScript(g, shell, ctx)
}

function readSimple(c: Simple, shell: Shell, ctx: Ctx, piped: boolean) {
  readNested(c, shell, ctx)
  const fed: Fed = { piped, input: c.redirs.some(r => r.op.startsWith('<')) }
  if (shell === 'posix') readPosixSimple(c, ctx, fed)
  else readPsWords(c.words, c, ctx, fed)
}

function readPosixSimple(c: Simple, ctx: Ctx, fed: Fed) {
  let words = c.words
  // Assignment-only words are not the command; their substitutions were read above.
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(words[0].raw)) words = words.slice(1)
  while (words.length > 0 && literal(words[0]) && !words[0].quoted && !words[0].escaped && POSIX_RESERVED.has(words[0].value)) {
    words = words.slice(1)
  }
  if (words.length === 0) return
  const head = words[0]
  if (literal(head) && !head.quoted && (head.value === 'for' || head.value === 'select')) return
  if (literal(head) && !head.quoted && head.value === 'case') return cannot(ctx, 'case')
  if (literal(head) && !head.quoted && head.value === 'function') {
    const name = words[1]
    if (name === undefined || !literal(name) || isGated(normProgram(name.value, ctx.platform))) cannot(ctx, 'function of a gated name')
    return
  }
  if (c.funcDef) {
    if (!literal(head) || isGated(normProgram(head.value, ctx.platform))) cannot(ctx, 'function of a gated name')
    return
  }
  readCommand(head, words.slice(1), c, ctx, 'posix', fed)
}

function readPsWords(words: Word[], c: Simple, ctx: Ctx, fed: Fed) {
  if (words.length === 0) return
  const head = words[0]
  // A variable, a type or a parenthesis at the head is an expression; in an
  // assignment, its right-hand side is a pipeline of its own. A bare word that
  // only holds a `$` part is a command name that expands, which is cannot-read.
  if (/^[$@]/.test(head.raw) && head.group === undefined || head.group === '[' || head.group === '(') {
    const k = words.findIndex(w => !w.quoted && literal(w) && PS_ASSIGN.has(w.value))
    if (k > 0) return readPsWords(words.slice(k + 1), c, ctx, fed)
    return
  }
  if (head.str || head.group !== undefined) return
  if (head.op || (head.value === '.' && literal(head) && !head.quoted && !head.escaped)) {
    const target = words[1]
    if (target === undefined) return
    if (target.group === '{') return
    if (!literal(target) || target.group !== undefined) return cannot(ctx, 'call operator on a value')
    const named: Word = { ...target, quoted: false, escaped: false, str: false }
    return readCommand(named, words.slice(2), c, ctx, 'powershell', fed)
  }
  const kw = literal(head) && !head.quoted && !head.escaped ? head.value.toLowerCase() : ''
  if (PS_KEYWORDS.has(kw)) return
  if (PS_FLOW.has(kw)) return readPsWords(words.slice(1), c, ctx, fed)
  if (PS_FUNCTION.has(kw)) {
    const name = words[1]
    if (name === undefined || !literal(name) || isGated(normProgram(name.value, ctx.platform))) cannot(ctx, 'function of a gated name')
    return
  }
  // A number or an operator at the head is an expression.
  if (literal(head) && !head.quoted && /^[-+]?\d|^-/.test(head.value)) return
  readCommand(head, words.slice(1), c, ctx, 'powershell', fed)
}

const isGated = (name: string) => name === 'git' || name === 'claude'

function readCommand(head: Word, args: Word[], c: Simple, ctx: Ctx, shell: Shell, fed: Fed) {
  if (!literal(head) || head.quoted || head.escaped) return cannot(ctx, 'command name not literal')
  const name = normProgram(head.value, ctx.platform)
  const lower = name.toLowerCase()
  if ((c.continued || c.hereString) && [head, ...args].some(w => REMOVAL_WORDS.has(w.value))) {
    cannot(ctx, 'continued or here-string removal')
  }
  if (c.stopParsing && (isGated(name) || POSIX_SHELLS.has(lower) || PS_SHELLS.has(lower))) return cannot(ctx, 'stop-parsing')
  // D2's environment rule on the words as the shell decodes them, beside the raw-text rules.
  // A value may expand (`PATH="$PATH:x"`); the name may not.
  if (ENV_SETTERS.has(lower) && args.some(a => {
    if (literal(a)) return GIT_ENV.test(a.value)
    const name = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/.exec(a.raw)
    return name === null ? DECLARES.has(lower) : GIT_ENV.test(name[1])
  })) cannot(ctx, 'GIT_ environment')
  if (ITEM_SETTERS.has(lower) && args.some(a => (literal(a) ? /^env:[\\/]?GIT_/i.test(a.value) : /env:/i.test(a.raw)))) {
    cannot(ctx, 'GIT_ environment')
  }
  if (name === 'git') return readGit(args, ctx, shell)
  if (name === 'claude') return readClaude(args, ctx)
  if (lower.startsWith('git-')) return cannot(ctx, 'dashed git command')
  // fish and zsh quote unlike bash, so their inline code is not read as POSIX.
  if ((lower === 'fish' || lower === 'zsh') && args.some(a => /^-[A-Za-z]*c/.test(a.value)) &&
    args.some(a => !literal(a) || CODE_GATED.test(a.value))) return cannot(ctx, 'inline shell of another grammar')
  if (POSIX_SHELLS.has(lower)) return readPosixShell(args, ctx, fed)
  if (PS_SHELLS.has(lower)) return readPwsh(args, ctx, fed, lower)
  if (lower === 'cmd') return readCmd(args, ctx, fed)
  if (lower === 'eval') return readJoined(args, 'posix', ctx)
  // trap's first argument is code the shell runs later; source and `.` run a file.
  if (shell === 'posix' && lower === 'trap') return args[0] === undefined || args[0].value.startsWith('-') ? undefined : readJoined(args.slice(0, 1), 'posix', ctx)
  if (shell === 'posix' && (lower === 'source' || lower === '.')) return args[0] !== undefined && readsInput(args[0]) ? cannot(ctx, 'shell reads its input') : undefined
  if (lower === 'hash' && args.some(a => !literal(a) || /^-[A-Za-z]*p/.test(a.value))) return cannot(ctx, 'hash names a program')
  if (lower === 'iex' || lower === 'invoke-expression') {
    const rest = args.filter(a => !(literal(a) && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(a.value)))
    if (rest.length === 0) return fed.piped || fed.input ? cannot(ctx, 'expression from input') : undefined
    return readJoined(rest, 'powershell', ctx)
  }
  if (lower === 'start-process' || lower === 'saps' || (shell === 'powershell' && lower === 'start')) return readStartProcess(args, ctx)
  if (lower === 'alias' || lower === 'set-alias' || lower === 'new-alias' || lower === 'sal' || lower === 'nal') return readAlias(args, ctx)
  if (CODE_INTERPRETERS.has(lower)) return readCode(lower, args, ctx, fed)
  if (lower === 'find') return readFind(args, ctx)
  if (WRAPPERS.has(lower)) return readWrapper(lower, args, c, ctx, shell, fed)
  backstop(args, ctx)
}

// D2's backstop: a gated word after command position, then a removal word.
// Also any program whose first argument is one of git's own removal subcommands,
// as git under another name would take it.
function backstop(args: Word[], ctx: Ctx) {
  const first = args[0]?.value
  if (first === 'worktree' || first === 'update-ref' || first === 'symbolic-ref' ||
    (first === 'branch' && args.slice(1).some(a => /^-[A-Za-z]*[dDmMcCf]|^--(delete|move|copy|force)/.test(a.value)))) {
    cannot(ctx, 'git removal word under another name')
  }
  args.forEach((a, i) => {
    const gated = !literal(a) || isGated(normProgram(a.value, ctx.platform))
    if (gated && args.slice(i + 1).some(b => literal(b) && REMOVAL_WORDS.has(b.value))) cannot(ctx, 'gated word after command position')
  })
}

const programLike = (name: string) => {
  const n = name.toLowerCase()
  return isGated(name) || n.startsWith('git-') || POSIX_SHELLS.has(n) || PS_SHELLS.has(n) || n === 'cmd' || n === 'eval' ||
    CODE_INTERPRETERS.has(n) || WRAPPERS.has(n) || n === 'find' || n === 'alias'
}

function readWrapper(name: string, args: Word[], c: Simple, ctx: Ctx, shell: Shell, fed: Fed) {
  if (name === 'command' && args.some(a => a.value === '-v' || a.value === '-V')) return
  const idx = args.findIndex(a => literal(a) && programLike(normProgram(a.value, ctx.platform)))
  // A string a wrapper runs (`su -c '...'`, `watch '...'`), before the wrapped program if there is one.
  for (const a of idx < 0 ? args : args.slice(0, idx)) if (literal(a) && /\s/.test(a.value)) readText(a.value, 'posix', ctx)
  if (idx < 0) {
    if (args.some(a => !literal(a))) cannot(ctx, 'wrapped command not literal')
    return backstop(args, ctx)
  }
  if (args.slice(0, idx).some(a => !literal(a))) return cannot(ctx, 'wrapped command not literal')
  if (FED_WRAPPERS.has(name)) return cannot(ctx, 'wrapper adds arguments from input')
  readCommand({ ...args[idx], quoted: false, escaped: false }, args.slice(idx + 1), c, ctx, shell, fed)
}

function readJoined(args: Word[], shell: Shell, ctx: Ctx) {
  if (args.some(a => !literal(a))) return cannot(ctx, 'inline code not literal')
  if (args.length > 0) readText(args.map(a => a.value).join(' '), shell, ctx)
}

function readPosixShell(args: Word[], ctx: Ctx, fed: Fed) {
  let inline = false
  let stdin = false
  let i = 0
  for (; i < args.length; i++) {
    const a = args[i]
    if (!literal(a)) break
    const v = a.value
    if (v === '--') { i++; break }
    if (v === '-') { stdin = true; i++; break }
    if (v === '-o' || v === '+o' || v === '-O' || v === '+O' || v === '--rcfile' || v === '--init-file') { i++; continue }
    if (/^--/.test(v)) continue
    if (/^[-+][A-Za-z]+$/.test(v)) {
      if (v.includes('c')) inline = true
      if (v.includes('s')) stdin = true
      // Each `o` or `O` in a cluster takes the next argument as its value.
      i += (v.slice(1).match(/[oO]/g) ?? []).length
      continue
    }
    break
  }
  if (inline) {
    const code = args[i]
    if (code === undefined || !literal(code)) return cannot(ctx, 'inline shell not literal')
    return readText(code.value, 'posix', ctx)
  }
  if (stdin) return cannot(ctx, 'shell reads its input')
  if (i >= args.length) {
    if (fed.piped || fed.input) cannot(ctx, 'shell fed by input')
    return
  }
  // A script that is input in another form: a substitution, or a device that reads input.
  if (readsInput(args[i])) cannot(ctx, 'shell reads its input')
}

const readsInput = (w: Word) => !literal(w) || /^\/(dev|proc\/self)\/(stdin|fd\/)/.test(w.value)

function readPwsh(args: Word[], ctx: Ctx, fed: Fed, name: string) {
  const VALUE = /^(ex|ep|executionpolicy|w|wd|workingdirectory|config|configurationname|i|if|inp|inputformat|o|of|outputformat|windowstyle|settingsfile|settings|v|version|psconsolefile|cu|custompipename)$/
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!literal(a)) return cannot(ctx, 'PowerShell argument not literal')
    const v = a.value.toLowerCase()
    if (!/^[-/]/.test(v) || v === '-' ) {
      if (v === '-') return cannot(ctx, 'PowerShell reads its input')
      // A positional is the command (Windows PowerShell) or a file (pwsh): read it as a command either way.
      return readJoined(args.slice(i), 'powershell', ctx)
    }
    const p = v.replace(/^--?|^\//, '')
    if (p.startsWith('e') && !/^(ex|ep)/.test(p)) return cannot(ctx, 'encoded command')
    if (p.startsWith('c') && !/^(conf|cu)/.test(p)) {
      const rest = args.slice(i + 1)
      if (rest.length === 1 && literal(rest[0]) && rest[0].value === '-') return cannot(ctx, 'PowerShell reads its input')
      return readJoined(rest, 'powershell', ctx)
    }
    if (/^f(i(l(e)?)?)?$/.test(p)) {
      // `-File -` reads the script from input.
      const file = args[i + 1]
      if (file !== undefined && (!literal(file) || file.value === '-' || readsInput(file))) cannot(ctx, 'PowerShell reads its input')
      return
    }
    if (VALUE.test(p)) i++
  }
  if (fed.piped || fed.input) cannot(ctx, `${name} fed by input`)
}

function readCmd(args: Word[], ctx: Ctx, fed: Fed) {
  const i = args.findIndex(a => literal(a) && /^\/[ckr]/i.test(a.value))
  if (i < 0) {
    if (fed.piped || fed.input) cannot(ctx, 'cmd fed by input')
    return
  }
  if (args.slice(i).some(a => !literal(a))) return cannot(ctx, 'cmd command not literal')
  const text = [args[i].value.slice(2), ...args.slice(i + 1).map(a => a.value)].join(' ').trim()
  // cmd expands `%`, `^` and `!`, and takes no single quote as a quote, so its
  // text is read with POSIX rules only when none of these sits beside a gated word.
  if (/[%^!']/.test(text) && CODE_GATED.test(text)) return cannot(ctx, 'cmd text the reader cannot split')
  readText(text, 'posix', ctx)
}

function readStartProcess(args: Word[], ctx: Ctx) {
  if (args.some(a => !literal(a))) return cannot(ctx, 'Start-Process not literal')
  const SKIP = /^-(wo|wi|v|re|cr|en|lo|us|wa|pa|no|use)/i
  const parts: string[] = []
  for (let i = 0; i < args.length; i++) {
    const v = args[i].value
    if (/^-/.test(v)) {
      if (SKIP.test(v) && !/^-(wait|passthru|nonewwindow|usenewenvironment|loaduserprofile)$/i.test(v)) i++
      continue
    }
    parts.push(v)
  }
  if (parts.length > 0) readText(parts.join(' '), 'posix', ctx)
}

function readAlias(args: Word[], ctx: Ctx) {
  for (const a of args) {
    if (!literal(a)) return cannot(ctx, 'alias not literal')
    const value = a.value.includes('=') ? a.value.slice(a.value.indexOf('=') + 1) : a.value
    const firstWord = value.trim().split(/\s+/)[0] ?? ''
    if (isGated(normProgram(firstWord, ctx.platform))) return cannot(ctx, 'alias of a gated word')
  }
}

// Inline code is the value after an inline flag, a flag with its code joined
// (`-e'...'`), `deno eval`'s, or awk's program. A script file's name is not code.
function readCode(name: string, args: Word[], ctx: Ctx, fed: Fed) {
  const awk = /awk$/.test(name)
  let operand = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!literal(a)) {
      if (!operand && awk) return cannot(ctx, 'inline code not literal')
      operand = true
      continue
    }
    const v = a.value
    if (v === '-' || /^\/(dev|proc\/self)\/(stdin|fd\/)/.test(v)) return cannot(ctx, 'interpreter reads its input')
    const inline = INLINE_FLAGS.has(v) || (name === 'deno' && v === 'eval' && !operand)
    if (inline && args[i + 1] !== undefined && !(literal(args[i + 1]) && args[i + 1].value.startsWith('-'))) {
      const code = args[i + 1]
      if (!literal(code)) return cannot(ctx, 'inline code not literal')
      if (CODE_GATED.test(code.value)) return cannot(ctx, 'inline code holds a gated word')
      operand = true
      i++
      continue
    }
    if (v.startsWith('-')) {
      if (CODE_GATED.test(v)) return cannot(ctx, 'inline code holds a gated word')
      continue
    }
    if (awk && !operand && CODE_GATED.test(v)) return cannot(ctx, 'inline code holds a gated word')
    operand = true
  }
  if (!operand && (fed.piped || fed.input)) cannot(ctx, 'interpreter fed by input')
}

function readFind(args: Word[], ctx: Ctx) {
  const i = args.findIndex(a => literal(a) && /^-(exec|execdir|ok|okdir)$/.test(a.value))
  if (i < 0) return
  if (args.slice(i + 1).some(a => !literal(a) || isGated(normProgram(a.value, ctx.platform)))) cannot(ctx, 'find runs a gated command')
}

// --- git --------------------------------------------------------------------------------

type Opt = { long?: string; short?: string; arg: 'none' | 'req' | 'opt'; neg?: boolean }
type Table = Opt[]

const t = (spec: string): Table => spec.trim().split(/\s+/).map(s => {
  // `name/x:req!`: long name, short letter, value, `!` negatable.
  const m = /^([a-z0-9-]*)(?:\/(.))?(?::(req|opt))?(!)?$/.exec(s)
  if (m === null) throw new Error(`bad option spec ${s}`)
  return { long: m[1] === '' ? undefined : m[1], short: m[2], arg: (m[3] as 'req' | 'opt' | undefined) ?? 'none', neg: m[4] === '!' }
})

const TABLES: Record<string, Table> = {
  'branch': t(`verbose/v! quiet/q! track/t:opt! set-upstream-to/u:req! unset-upstream! color:opt! remotes/r contains:req
    no-contains:req abbrev:opt! all/a delete/d! /D move/m! /M omit-empty! copy/c! /C list/l! show-current! create-reflog!
    edit-description! force/f! merged:req no-merged:req column:opt! sort:req! points-at:req! ignore-case/i!
    recurse-submodules! format:req!`),
  'symbolic-ref': t('quiet/q! delete/d! short! recurse! /m:req'),
  'checkout': t(`/b:req /B:req /l guess! overlay! auto-advance! quiet/q! recurse-submodules:opt! progress! merge/m!
    conflict:req! detach/d! track/t:opt! force/f! orphan:req! overwrite-ignore! ignore-other-worktrees! ours/2 theirs/3
    patch/p! unified/U:req inter-hunk-context:req ignore-skip-worktree-bits! pathspec-from-file:req! pathspec-file-nul!`),
  'switch': t(`create/c:req! force-create/C:req! guess! discard-changes! quiet/q! recurse-submodules:opt! progress!
    merge/m! conflict:req! detach/d! track/t:opt! force/f! orphan:req! overwrite-ignore! ignore-other-worktrees!`),
  'push': t(`verbose/v! quiet/q! repo:req! all! branches! mirror! delete/d! tags! dry-run/n! porcelain! force/f!
    force-with-lease:opt! force-if-includes! recurse-submodules:req! thin! receive-pack:req! exec:req! set-upstream/u!
    progress! prune! no-verify verify follow-tags! signed:opt! atomic! push-option/o:req! ipv4/4 ipv6/6`),
  'fetch': t(`verbose/v! quiet/q! all! set-upstream! append/a! atomic! upload-pack:req! force/f! multiple/m! tags/t! /n
    jobs/j:req! prefetch! prune/p! prune-tags/P! recurse-submodules:opt! dry-run! porcelain! write-fetch-head! keep/k!
    update-head-ok/u! progress! depth:req! shallow-since:req! shallow-exclude:req! deepen:req! unshallow refetch
    update-shallow! refmap:req server-option/o:req! ipv4/4 ipv6/6 negotiation-restrict:req! negotiation-tip:req!
    negotiation-include:req! negotiate-only! filter:req! auto-maintenance! auto-gc! show-forced-updates!
    write-commit-graph! stdin!`),
  'config': t(`global system local worktree file/f:req blob:req get get-all get-regexp get-urlmatch replace-all add unset
    unset-all rename-section remove-section list/l fixed-value edit/e get-color get-colorbool type:req! bool int
    bool-or-int bool-or-str path expiry-date null/z name-only includes! show-origin show-scope default:req comment:req
    value:req all regexp url:req`),
  'worktree remove': t('force/f!'),
  'worktree add': t(`force/f! /b:req /B:req detach/d! checkout! guess-remote! lock! reason:req! quiet/q! track! orphan!
    relative-paths!`),
  'worktree list': t('porcelain! verbose/v! expire:req! /z'),
  'worktree lock': t('reason:req!'),
  'worktree move': t('force/f!'),
  'worktree prune': t('dry-run/n! verbose/v! expire:req!'),
  'worktree repair': t('relative-paths!'),
  'worktree unlock': t(''),
}

type Parsed = { on: Map<string, number>; values: Map<string, string[]>; positionals: Word[] }

// git's parse-options: short clusters split, a long option by unique prefix,
// `--no-` on a negatable one, options anywhere before `--`. An ambiguous or
// unknown option, or any argument that expands, throws.
function parseOpts(args: Word[], table: Table): Parsed {
  const on = new Map<string, number>()
  const values = new Map<string, string[]>()
  const positionals: Word[] = []
  const key = (o: Opt) => o.long ?? `-${o.short}`
  const keep = (o: Opt, v: string) => values.set(key(o), [...(values.get(key(o)) ?? []), v])
  const set = (o: Opt, yes: boolean) => on.set(key(o), yes ? (on.get(key(o)) ?? 0) + 1 : 0)
  let i = 0
  for (; i < args.length; i++) {
    const a = args[i]
    if (!literal(a)) fail('argument expands')
    const v = a.value
    if (v === '--') { i++; break }
    if (v.startsWith('--')) {
      const [name, value] = v.slice(2).split(/=(.*)/s)
      let o = table.find(x => x.long === name)
      let yes = true
      if (o === undefined && name.startsWith('no-')) {
        o = table.find(x => x.long === name.slice(3) && x.neg === true)
        yes = false
      }
      if (o === undefined) {
        const cands = table.filter(x => x.long?.startsWith(name))
        const negs = name.startsWith('no-') ? table.filter(x => x.neg === true && x.long?.startsWith(name.slice(3))) : []
        if (cands.length + negs.length !== 1 || name.length === 0) fail('unknown or ambiguous option')
        o = cands[0] ?? negs[0]
        yes = cands.length === 1
      }
      const opt = o as Opt
      set(opt, yes)
      if (yes && value !== undefined) keep(opt, value)
      if (yes && opt.arg === 'req' && value === undefined) {
        if (args[i + 1] === undefined) fail('option value missing')
        if (!literal(args[i + 1])) fail('argument expands')
        keep(opt, args[i + 1].value)
        i++
      }
      continue
    }
    if (v.startsWith('-') && v.length > 1) {
      for (let k = 1; k < v.length; k++) {
        const o = table.find(x => x.short === v[k])
        if (o === undefined) fail('unknown option')
        set(o as Opt, true)
        if ((o as Opt).arg === 'req') {
          if (k + 1 < v.length) { keep(o as Opt, v.slice(k + 1)); break }
          if (args[i + 1] === undefined) fail('option value missing')
          if (!literal(args[i + 1])) fail('argument expands')
          keep(o as Opt, args[i + 1].value)
          i++
          break
        }
        if ((o as Opt).arg === 'opt') break
      }
      continue
    }
    positionals.push(a)
  }
  for (; i < args.length; i++) {
    if (!literal(args[i])) fail('argument expands')
    positionals.push(args[i])
  }
  return { on, values, positionals }
}

const isOn = (p: Parsed, name: string) => (p.on.get(name) ?? 0) > 0

// Cleanup's three `-c` keys (D2). A key's section and name ignore case, as git's do.
function allowedC(kv: string, platform: Platform): boolean {
  const eq = kv.indexOf('=')
  if (eq < 0) return false
  const key = kv.slice(0, eq).toLowerCase()
  const value = kv.slice(eq + 1)
  if (key === 'core.fsmonitor' || key === 'log.showsignature') return value === 'false'
  if (key === 'core.hookspath') return absolute(value, platform)
  return false
}

// A remote that is `.`, a path or a file URL makes push and fetch write local refs.
// A URL with a scheme, or `host:path`, is a remote; any other remote holding a
// separator or starting with a dot is a path.
const localRemote = (v: string) =>
  /^(\.|~|[\\/]|[A-Za-z]:[\\/]|file:)/i.test(v) ||
  (/[\\/]/.test(v) && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v) && !/^[^\\/:]+:/.test(v))
// git's options that run a command they are given, by subcommand (git 2.55.0).
const RUNS_COMMAND: Record<string, RegExp> = {
  'grep': /^(-O|--op)/,
  'clone': /^(-u|--upl|--template)/,
  'ls-remote': /^(--upl|--exec)/,
  'archive': /^(--exec|--remote)/,
  'fetch': /^--upl/,
  'pull': /^--upl/,
  'push': /^(--receive-pack|--rec|--exec)/,
  'send-pack': /^(--receive-pack|--exec)/,
  'fetch-pack': /^(--upload-pack|--exec)/,
}

function readGit(args: Word[], ctx: Ctx, shell: Shell) {
  try {
    gitArgs(args, ctx, shell)
  } catch (e) {
    if (e instanceof ParseError) return cannot(ctx, e.message)
    throw e
  }
}

function gitArgs(args: Word[], ctx: Ctx, shell: Shell) {
  const { platform } = ctx
  const path = (p: string) => normPath(p, platform, shell)
  let repo: string | null = null
  let i = 0
  for (; i < args.length; i++) {
    const a = args[i]
    if (!literal(a)) fail('git global option expands')
    const v = a.value
    if (v === '-C') {
      if (repo !== null) fail('second -C')
      const p = args[++i]
      if (p === undefined || !literal(p)) fail('-C value')
      repo = path(p.value)
      continue
    }
    if (v === '-c') {
      const kv = args[++i]
      if (kv === undefined || !literal(kv) || !allowedC(kv.value, platform)) fail('-c key')
      continue
    }
    if (GIT_FLAGS.has(v)) continue
    if (GIT_ENDS.has(v)) return
    if (v.startsWith('-')) fail('git global option')
    break
  }
  const subWord = args[i]
  if (subWord === undefined) return
  const sub = subWord.value
  if (!GIT_COMMANDS.has(sub)) fail('not a git command')
  const rest = args.slice(i + 1)
  const add = (f: Finding) => ctx.findings.push(f)
  const forced = (what: string) => add({ kind: 'forced', what })
  const runs = RUNS_COMMAND[sub]
  if (runs !== undefined && rest.some(a => runs.test(a.value))) fail('option that runs a command')
  switch (sub) {
    case 'worktree': {
      const verb = rest[0]
      if (verb === undefined) return
      if (!literal(verb)) fail('argument expands')
      const table = TABLES[`worktree ${verb.value}`]
      if (table === undefined) fail('worktree subcommand')
      const p = parseOpts(rest.slice(1), table)
      if (verb.value === 'remove') {
        for (const w of p.positionals) add({ kind: 'removes-worktree', path: path(w.value), repo })
        if (isOn(p, 'force')) forced('worktree-remove')
      }
      if (verb.value === 'add' && isOn(p, '-B')) forced('worktree-add-reset')
      return
    }
    case 'branch': {
      const p = parseOpts(rest, TABLES.branch)
      if (isOn(p, 'delete') || isOn(p, '-D')) {
        for (const w of p.positionals) add({ kind: 'deletes-branch', name: w.value, repo })
      }
      for (const o of ['-D', 'force', 'move', '-M', 'copy', '-C']) if (isOn(p, o)) { forced(`branch ${o}`); break }
      return
    }
    case 'update-ref':
      for (const a of rest) if (!literal(a)) fail('argument expands')
      return forced('update-ref')
    case 'symbolic-ref': {
      const p = parseOpts(rest, TABLES['symbolic-ref'])
      if (isOn(p, 'delete') || p.positionals.length >= 2) forced('symbolic-ref')
      return
    }
    case 'checkout': {
      const p = parseOpts(rest, TABLES.checkout)
      if (isOn(p, '-B')) forced('checkout -B')
      return
    }
    case 'switch': {
      const p = parseOpts(rest, TABLES.switch)
      if (isOn(p, 'force-create')) forced('switch -C')
      return
    }
    case 'push': {
      const p = parseOpts(rest, TABLES.push)
      const remotes = [...(p.values.get('repo') ?? []), ...p.positionals.slice(0, 1).map(w => w.value)]
      if (remotes.some(localRemote)) fail('push to a local path')
      return
    }
    case 'fetch': {
      const p = parseOpts(rest, TABLES.fetch)
      if (isOn(p, 'stdin')) fail('refspecs from input')
      if (isOn(p, 'update-head-ok')) forced('fetch --update-head-ok')
      const remotes = isOn(p, 'multiple') || isOn(p, 'all') ? p.positionals : p.positionals.slice(0, 1)
      for (const r of remotes) if (localRemote(r.value)) fail('fetch from a local path')
      // A refspec's destination, positional or `--refmap`, under refs/heads/ or with no refs/ moves a branch.
      const specs = [...(isOn(p, 'multiple') || isOn(p, 'all') ? [] : p.positionals.slice(1).map(w => w.value)), ...(p.values.get('refmap') ?? [])]
      for (const r of specs) {
        const spec = r.replace(/^\+/, '')
        if (spec.startsWith('^') || !spec.includes(':')) continue
        const dst = spec.slice(spec.lastIndexOf(':') + 1)
        if (movesBranch(dst)) { forced('fetch into a branch'); break }
      }
      return
    }
    case 'config': {
      const READS = ['get', 'get-all', 'get-regexp', 'list']
      const WRITES = ['replace-all', 'add', 'unset', 'unset-all', 'rename-section', 'remove-section', 'edit', 'get-urlmatch', 'get-color', 'get-colorbool']
      const p = parseOpts(rest, TABLES.config)
      const flagRead = READS.some(o => isOn(p, o)) && !WRITES.some(o => isOn(p, o))
      const verbRead = !READS.some(o => isOn(p, o)) && !WRITES.some(o => isOn(p, o)) &&
        (p.positionals[0]?.value === 'get' || p.positionals[0]?.value === 'list')
      if (!flagRead && !verbRead) fail('config write')
      return
    }
    case 'pull': {
      // Read as fetch is: a refspec's destination, and a local remote.
      if (rest.some(w => !literal(w))) fail('argument expands')
      const pos = rest.filter(w => !w.value.startsWith('-'))
      if (pos[0] !== undefined && localRemote(pos[0].value)) fail('pull from a local path')
      if (pos.slice(1).some(w => w.value.includes(':') && movesBranch(w.value.slice(w.value.lastIndexOf(':') + 1)))) forced('pull into a branch')
      return
    }
    case 'remote': {
      // A remote pointed at a local path makes a later push or fetch write local refs.
      if (rest.some(w => !literal(w))) fail('argument expands')
      const verb = rest.find(w => !w.value.startsWith('-'))?.value
      if ((verb === 'add' || verb === 'set-url') && rest.slice(1).some(w => !w.value.startsWith('-') && localRemote(w.value))) fail('remote set to a local path')
      return
    }
    case 'replay':
    case 'fast-import':
    case 'send-pack':
    case 'fetch-pack':
      // These write refs directly.
      return forced(sub)
    case 'rebase':
      // Its exec option runs a command (q3 B: refused, not read).
      if (rest.some(w => !literal(w) || /^--ex|^-[A-Za-z]*x/.test(w.value))) fail('option that runs a command')
      return
    case 'difftool':
      if (rest.some(w => !literal(w) || /^--ext|^-[A-Za-z]*x/.test(w.value))) fail('option that runs a command')
      return
    case 'filter-branch':
    case 'for-each-repo':
      fail('git command that runs commands')
      return
    case 'bisect':
      if (rest.some(w => w.value === 'run')) fail('option that runs a command')
      return
    case 'submodule': {
      let k = 0
      while (k < rest.length && literal(rest[k]) && rest[k].value.startsWith('-')) k++
      if (rest[k] === undefined || rest[k].value !== 'foreach') return
      k++
      while (k < rest.length && literal(rest[k]) && /^(--quiet|-q|--recursive)$/.test(rest[k].value)) k++
      const cmd = rest.slice(k)
      if (cmd.some(a => !literal(a))) fail('argument expands')
      return readCmdArg(cmd.map(a => a.value).join(' '), ctx)
    }
    default:
      return
  }
}

// A destination under refs/heads/, or one with no refs/ prefix (git reads it as
// a branch), moves a branch. Ref names ignore case on a case-folding disk.
const movesBranch = (dst: string) => {
  const d = dst.toLowerCase()
  return dst !== '' && (d.startsWith('refs/heads/') || !d.startsWith('refs/'))
}

// A command git runs through the shell: a literal one is read as a command of its own.
function readCmdArg(text: string | undefined, ctx: Ctx) {
  if (text === undefined) fail('command missing')
  readText(text as string, 'posix', ctx)
}

// --- claude -----------------------------------------------------------------------------------

function readClaude(args: Word[], ctx: Ctx) {
  if (args.some(a => !literal(a))) return cannot(ctx, 'claude argument expands')
  const v = args.map(a => a.value)
  if (v.length === 1 && ['--version', '-v', '--help', '-h'].includes(v[0])) return
  if (v.length === 2 && v[0] === 'agents' && v[1] === '--json') return
  if (v.length === 2 && v[0] === 'logs' && !v[1].startsWith('-')) return
  if (v[0] === 'plugin' && (v[1] === 'test' || v[1] === 'validate')) return
  if (v[0] === 'rm' || v[0] === 'stop') {
    const rest = v.slice(1)
    const ids = rest.filter(x => !x.startsWith('-'))
    if (rest.some(x => x.startsWith('-'))) ctx.findings.push({ kind: 'forced', what: `claude ${v[0]} with a flag` })
    if (ids.length === 1) return void ctx.findings.push({ kind: 'removes-session', id: ids[0] })
    return cannot(ctx, `claude ${v[0]} needs one id`)
  }
  cannot(ctx, 'claude command outside the list')
}

// --- the environment rule (D2) --------------------------------------------------------------

const ENV_RULES = [
  /(^|[^A-Za-z0-9_$])GIT_[A-Za-z0-9_]*\+?=/i,
  /\$\{?env:GIT_[A-Za-z0-9_]*\}?\s*(\+|\?\?)?=(?!=)/i,
  /\b(export|declare|typeset|readonly|local|setenv|unset)\s+(-\S+\s+)*GIT_/i,
  /\b(Set-Item|New-Item|si|ni|Set-Content|sc|Remove-Item|ri)\b[^;\n|]*\benv:[\\/]?GIT_/i,
  // A variable set by name through .NET: refused unless the name is a literal that is not GIT_.
  /SetEnvironmentVariable(?!\s*\(\s*['"](?!GIT_)[A-Za-z_])/i,
]
// The same rule on decoded words: a word that names or sets a GIT_ variable,
// given to a command that sets the environment.
const GIT_ENV = /^GIT_[A-Za-z0-9_]*(\+?=|$)/i
const DECLARES: ReadonlySet<string> = new Set(['export', 'declare', 'typeset', 'readonly', 'local'])
const ENV_SETTERS: ReadonlySet<string> = new Set([...DECLARES, 'setenv', 'unset', 'set', 'env'])
const ITEM_SETTERS: ReadonlySet<string> = new Set(['set-item', 'new-item', 'si', 'ni'])

// --- D8's allowed shapes ------------------------------------------------------------------------

const EXIT_PRINT: Record<Shell, string[]> = { posix: ['echo', '"exit=$?"'], powershell: ['"exit=$LASTEXITCODE"'] }
const G_HEAD = ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c']

function shapeOf(script: Script, shell: Shell, platform: Platform, findings: Finding[]): Shape | null {
  if (script.comment || findings.length !== 1) return null
  const items = script.items
  if (items.length < 1 || items.length > 2) return null
  const last = items[items.length - 1]
  if (last.sep !== '' && last.sep !== '\n') return null
  if (items.length === 2) {
    if (items[0].sep !== ';') return null
    const exit = items[1].pipe
    if (exit.length !== 1 || !plain(exit[0])) return null
    const raws = exit[0].words.map(w => w.raw)
    if (raws.join('\u{1}') !== EXIT_PRINT[shell].join('\u{1}')) return null
  }
  const pipe = items[0].pipe
  if (pipe.length !== 1 || !plain(pipe[0])) return null
  const w = pipe[0].words
  if (w.some(x => !literal(x) || x.subs.length > 0)) return null
  const raw = w.map(x => x.raw)
  const f = findings[0]
  if (raw[0] === 'claude' && w.length === 3 && f.kind === 'removes-session' && (raw[1] === 'stop' || raw[1] === 'rm')) {
    return { kind: raw[1] === 'stop' ? 'session-stop' : 'session-rm', id: f.id }
  }
  if (w.length !== 13 || G_HEAD.some((x, k) => raw[k] !== x)) return null
  if (!raw[7].startsWith('core.hooksPath=') || raw[8] !== '-C') return null
  const hooks = w[7].value.slice('core.hooksPath='.length)
  if (!absolute(hooks, platform)) return null
  const main = normPath(w[9].value, platform, shell)
  if (raw[10] === 'worktree' && raw[11] === 'remove' && f.kind === 'removes-worktree') {
    return { kind: 'worktree-remove', hooks: normPath(hooks, platform, shell), main, cwd: normPath(w[12].value, platform, shell) }
  }
  if (raw[10] === 'branch' && raw[11] === '-d' && f.kind === 'deletes-branch') {
    return { kind: 'branch-delete', hooks: normPath(hooks, platform, shell), main, branch: w[12].value }
  }
  return null
}

const plain = (c: Simple) =>
  c.redirs.length === 0 && c.groups.length === 0 && !c.continued && !c.hereString && !c.stopParsing && !c.funcDef && !c.punct

// --- the entry point ----------------------------------------------------------------------------

/** Reads one command's text as `shell` would run it on `platform` (D1). */
export function readRemovals(text: unknown, shell: unknown, platform: unknown): Reading {
  const unreadable = (why: string): Reading => ({ findings: [{ kind: 'cannot-read', why }], shape: null })
  try {
    if (typeof text !== 'string') return unreadable('not text')
    if (shell !== 'posix' && shell !== 'powershell') return unreadable('unknown shell')
    const plat: Platform = platform === 'win32' ? 'win32' : 'other'
    if (new TextEncoder().encode(text).length > MAX_BYTES) return unreadable('over 8 KiB')
    const ctx: Ctx = { findings: [], platform: plat, depth: 0, strict: strictPair(text), reads: 0 }
    const folded = fold(text)
    // GIT_ anywhere in the folded text, or a .NET environment write, is cannot-read (q3 B).
    if (ENV_RULES.some(r => r.test(text)) || /(^|[^a-z0-9_])git_[a-z0-9_]/.test(folded) || folded.includes('setenvironmentvariable')) {
      cannot(ctx, 'GIT_ environment')
    }
    // A name for git or claude written through PowerShell's alias or function drive.
    if (/\b(alias|function):/.test(folded) && GATED_RE.test(folded)) cannot(ctx, 'alias of a gated word')
    if (ctx.strict && /[^\t\n\x20-\x7e]/.test(text)) cannot(ctx, 'outside the strict subset')
    let script: Script
    try {
      script = shell === 'posix' ? parsePosix(text) : parsePs(text)
    } catch (e) {
      if (e instanceof ParseError) return unreadable(e.message)
      throw e
    }
    readScript(script, shell, ctx)
    if (ctx.strict) strictScript(script, shell, ctx)
    return { findings: ctx.findings, shape: shapeOf(script, shell, plat, ctx.findings) }
  } catch {
    return unreadable('internal')
  }
}
