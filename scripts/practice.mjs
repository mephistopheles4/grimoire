#!/usr/bin/env node
// The practice runner: drives one practice-test case in a Claude Code session
// that loads only the skill under test, turn by turn, under a named variant.
//
//   node scripts/practice.mjs start --variant <name> --skill <dir> [--skill <dir>]...
//        [--setup <dir>] [--case <name>] --model <model> --effort <level>
//        [--value NAME=literal]... [--rule "<tool rule>"]...
//   node scripts/practice.mjs send <run-id>      (the message on standard input)
//   node scripts/practice.mjs report <run-id>
//   node scripts/practice.mjs end <run-id>
//
// Why it exists: a resumed turn sent without the variant's flags silently
// loads the whole account again. So `send` takes no flags at all. It rebuilds
// every turn's flags, settings file and environment from the variant table
// below plus the values `start` validated, and refuses when the recorded state
// no longer matches that recomputation.
//
// Maintainer tooling: it ships with no skill. It imports node built-ins only.
// No shell is involved anywhere, and the message never travels as an argument.
//
// Variants: clean, owner-pact, user-skills, full-account. desktop-app is a
// manual procedure, not a runner variant.
//
// --case names the case being run. Two kinds of case run only on clean and
// owner-pact, and start refuses them elsewhere: contract's B3 and B25b, and
// eagle-eye's session 4, named session-4 or by one of its cases P1 to P4.
//
// --value NAME=literal sets a test value in the session's environment, such as
// a fake key. It is always a literal written in the case, never the runner's
// own value passed through.
//
// --rule allows one command, in one of four shapes: a script in the skill
// under test, written as `node <skill>/scripts/check.mjs *`; `git status *`
// and its diff, log and show siblings; `$NAME`, a shell read of HOME or a test
// value; and `>> $NAME`, a shell append to the path a test value names. See
// "tool rules" below.
//
// The posture is hygiene, not a boundary (ADR 0006). It denies the obvious
// mistakes, backs up the owner's live folders at start and checks them at
// report, and masks what it prints. The threat model's practice-runner row
// says what it does not stop.
//
// A read rule shows the session an environment value. On clean and
// owner-pact the session's environment holds no secret by construction: it is
// the system list below, the temp folder and the case's own test values. On
// user-skills and full-account the user settings add their own values, keys
// among them; the threat model's row covers that.
//
// Runs live under <system temp>/grimoire-practice/<run-id>/: the run state,
// the settings file, the transcript, backup/ with its manifest, and work/,
// the folder the session runs in. The session's temp folder is work/.tmp.
//
// Exit codes: 0 done; 1 refused, with a one-line reason; 2 the session ran but
// the turn did not complete, or end could not delete everything.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, rmSync, rmdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE = 'state.json';
const runsRoot = () => join(tmpdir(), 'grimoire-practice');

class Refusal extends Error {}
const refuse = msg => { throw new Refusal(msg); };

// ---- the variants ----
//
// One conflict per variant, so the case × variant grid stays readable. The
// desktop-app variant is a manual procedure: the app cannot take flags.
const VARIANTS = {
  clean: { sources: 'project', strictMcp: true, exclude: true },
  'owner-pact': { sources: 'project', strictMcp: true, exclude: false },
  'user-skills': { sources: 'user,project', strictMcp: true, exclude: true },
  'full-account': { sources: 'user,project,local', strictMcp: false, exclude: false },
};

// The user's global instructions file. It follows CLAUDE_CONFIG_DIR when the
// runner's own environment sets it. Forward slashes, because the exclusion is
// a glob and a backslash is a glob escape: a backslash path would silently
// fail to match and load the file.
function globalFile() {
  return join(configFolder(), 'CLAUDE.md');
}
const forward = p => p.replace(/\\/g, '/');

// A relative config folder would resolve against the work folder in the
// session and against somewhere else here. And the exclusion is a pattern, so
// a path holding pattern characters might not match the file it names: the
// global file would load while the report said it was excluded.
function checkConfigFolder(variant) {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir && !isAbsolute(dir)) refuse(`CLAUDE_CONFIG_DIR is ${oneLine(dir)}; the runner needs an absolute path`);
  if (VARIANTS[variant]?.exclude && /[[\]{}()!*?+@]/.test(forward(globalFile()))) {
    refuse(`the global file's path ${oneLine(forward(globalFile()))} holds pattern characters, so the exclusion might not match it`);
  }
}

// A variant that loads the global file records which version of it ran, so
// two runs under different versions are never compared as equal. Send
// computes it again and refuses a change, because a turn under another version
// would sit in the same run under the first one's hash.
function globalRecord(variant) {
  const global = globalFile();
  return VARIANTS[variant].exclude
    ? { path: forward(global), excluded: true }
    : { path: forward(global), excluded: false, sha256: existsSync(global) ? sha256(readFileSync(global)) : null };
}

// ---- the posture ----
//
// Hygiene, not a boundary (ADR 0006): it keeps the cheap, obvious mistakes
// out, and the threat model's practice-runner row says what it does not stop.

// The tools that reach off the machine or schedule work. They are denied by
// name in the settings file and disallowed on the command line too, so a
// session never sees them. Smoke check 1 recorded a real session's tool list;
// a new tool of either kind goes here.
const OFF_MACHINE = [
  'SendMessage', 'RemoteTrigger', 'PushNotification', 'ListAgents',
  'Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync',
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Workflow',
  'WebFetch', 'WebSearch',
];

// An absolute path as a Read or Edit rule writes it: two leading slashes, and
// on Windows the drive as a lower-case folder, so C:\x becomes //c/x. The
// smoke run settles this form; a change to it belongs here and nowhere else.
function rulePath(abs) {
  const p = forward(resolve(abs));
  return /^[A-Za-z]:\//.test(p) ? `//${p[0].toLowerCase()}${p.slice(2)}` : `/${p}`;
}

// A rule is a pattern, so a path holding pattern characters might not match
// the file it names, and the rule would silently do nothing.
const PATTERN = /[[\]{}()!*?+@]/;
function rule(tool, abs, tail = '') {
  if (PATTERN.test(forward(abs))) refuse(`the path ${oneLine(forward(abs))} holds pattern characters, so a permission rule might not match it`);
  return `${tool}(${rulePath(abs)}${tail})`;
}

// The user's config folder, and the files in and beside it the session may
// not read. The global state file sits in the home folder, or in the config
// folder when CLAUDE_CONFIG_DIR names one; both are denied.
const configFolder = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// ---- tool rules ----
//
// A case allows commands by literal rules in its practice-test doc. The runner
// takes four shapes and refuses any other, because every allowed command is a
// way to write or run code:
//
//   a script rule: a program, <skill>/<path of a script in the skill under
//   test>, optional fixed words, an optional final *. <skill> stands for the
//   copy's absolute path, which exists only once start has made the run. The
//   copy is edit-denied and hash-checked, so a companion skill's script is
//   refused.
//
//   a git rule: git, one of status, diff, log or show, an optional final *.
//
//   a read: $NAME, a shell read of one environment value. NAME is HOME or a
//   value the case sets with --value.
//
//   an append: >> $NAME, a shell append to the path a test value names. The
//   value is a relative path of plain names, so the file is in the work folder.
//
// Each rule is written for both shell tools, because Claude Code checks a
// rule against the tool that runs the command. Claude Code compares a rule
// with the command as the session wrote it, quotes and slashes included
// (#165's dry run, #171's probe), so a rule is written in each form a skill's
// own wording produces. That changes the form, never the scope: the same
// script, the same value, the same file.

const GIT_COMMANDS = ['status', 'diff', 'log', 'show'];
const PROGRAM_WORD = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PATH_PART = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const FIXED_WORD = /^[A-Za-z0-9._=:,@+/-]+$/;
const READ = /^\$([A-Z_][A-Z0-9_]*)$/;
const APPEND = /^>> \$([A-Z_][A-Z0-9_]*)$/;

function parseRule(text) {
  const bad = why => refuse(`the tool rule ${oneLine(text)} ${why}`);
  if (typeof text !== 'string') bad('is not a string');
  if (text.startsWith('$') || text.startsWith('>')) {
    const read = READ.exec(text);
    const append = APPEND.exec(text);
    if (!read && !append) bad('is not $NAME or >> $NAME, with the name in capitals and nothing after it');
    return read ? { kind: 'read', name: read[1] } : { kind: 'append', name: append[1] };
  }
  if (text.startsWith('-')) bad('starts with -');
  const words = text.split(' ');
  if (words.some(w => !w)) bad('has an empty word: write single spaces between words');
  const wild = words.at(-1) === '*';
  if (wild) words.pop();
  if (words.includes('*')) bad('has a wildcard that is not its last word');
  const [program, script, ...fixed] = words;
  if (!PROGRAM_WORD.test(program ?? '')) bad('does not start with a program name');
  if (program === 'git') {
    if (!GIT_COMMANDS.includes(script) || fixed.length) bad(`is not git and one of ${GIT_COMMANDS.join(', ')}, with an optional final *`);
    return { kind: 'git', words, wild };
  }
  if (script === undefined) bad('names no script');
  if (!script.startsWith('<skill>/')) {
    bad(isAbsolute(script) || /^[A-Za-z]:/.test(script)
      ? 'names a script outside the skill under test; write its path as <skill>/...'
      : 'does not name its script as <skill>/<path in the skill under test>');
  }
  const rel = script.slice('<skill>/'.length).split('/');
  if (!rel.every(p => PATH_PART.test(p))) bad('has a script path with .., a glob character or another character the runner does not take');
  if (!fixed.every(w => FIXED_WORD.test(w))) bad('has a fixed word with a character the runner does not take');
  return { kind: 'script', program, rel, fixed, wild };
}

// A read names HOME or a test value. An append names a test value whose path
// is relative and of plain names only, so never the session's own setup under
// .claude, an instruction file or a device. A relative path resolves against
// the session's current folder, which starts as the work folder. They need
// the run's values, so they are checked here rather than in parseRule.
function checkRuleValues(state) {
  for (const text of state.rules) {
    const r = parseRule(text);
    const bad = why => refuse(`the tool rule ${oneLine(text)} ${why}`);
    if (r.kind === 'append' && r.name === 'HOME') bad('appends to the home folder; an append names a test value whose path is in the work folder');
    if (r.kind === 'read' && r.name === 'HOME') continue;
    if ((r.kind === 'read' || r.kind === 'append') && !Object.hasOwn(state.values, r.name)) bad(`names ${r.name}, a value the case does not set with --value`);
    if (r.kind !== 'append') continue;
    const parts = state.values[r.name].split('/');
    // A leading - would read as a PowerShell parameter.
    if (!parts.every(p => PATH_PART.test(p) && !p.startsWith('-'))) {
      bad(`appends to ${r.name}, whose value ${oneLine(state.values[r.name])} is not a relative path of plain names in the work folder`);
    }
    const lower = parts.map(p => p.toLowerCase());
    if (lower.some(p => INSTRUCTIONS.some(i => i.toLowerCase() === p) || DEVICE.test(p))) {
      bad(`appends to ${r.name}, whose value ${oneLine(state.values[r.name])} names an instruction file or a device`);
    }
  }
}

// A Windows device name names no file, in any folder and with any extension.
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/;

// The rule as Claude Code reads it, for each shell, with <skill> replaced by
// the copy's path. Each form is the same command as a session writes it:
//
//   a script path bare or in single or double quotes, with forward slashes,
//   with the platform's own, or with the base directory in the platform's
//   form and the rest as the skill writes it, because the harness hands a
//   skill its base directory in the platform's form, a skill may say to quote
//   it, and a session may quote a path the skill left bare. Bash
//   never gets a bare backslash form: Git Bash reads an unquoted backslash as
//   an escape, so node C:\x\run.mjs runs C:xrun.mjs, a path relative to the
//   drive's current folder, where a session could plant a file of its own.
//
//   a read in the spelling eagle-eye's usage record gives each shell. HOME in
//   PowerShell is its own variable, $HOME, not an environment value.
//
//   an append with PowerShell's Add-Content, the path relative or absolute, in
//   either slash form, bare or in either quotes. Bash gets none: Claude Code already
//   lets a redirect write into the work folder under the Edit rule (#171's
//   probe). The final * takes the line. In #171's probes Claude Code denied
//   every other thing tried there: a subexpression, a parenthesised or array
//   expression, an environment value, a pipe, an output redirect, and a
//   second command after ; or on a new line.
function expandRule(r, state, work) {
  const both = c => [`Bash(${c})`, `PowerShell(${c})`];
  if (r.kind === 'git') return both(`${r.words.join(' ')}${r.wild ? ' *' : ''}`);
  if (r.kind === 'read') {
    return [`Bash(echo "$${r.name}")`, r.name === 'HOME' ? 'PowerShell($HOME)' : `PowerShell($env:${r.name})`];
  }
  if (r.kind === 'append') {
    const rel = state.values[r.name];
    const abs = join(work, ...rel.split('/'));
    plainPath(abs);
    const paths = unique([rel, join(...rel.split('/')), forward(abs), abs]);
    return [...paths, ...quotedForms(paths)].map(p => `PowerShell(Add-Content -Path ${p} -Value *)`);
  }
  const copy = copyOf(work, state.skills[0]);
  const native = join(copy, ...r.rel);
  // The skill's own template, <skill base directory>/<path>, with the base
  // directory put in as the harness gives it.
  const mixed = `${copy}/${r.rel.join('/')}`;
  plainPath(native);
  const tail = [...r.fixed, ...(r.wild ? ['*'] : [])].map(w => ` ${w}`).join('');
  const command = path => `${r.program} ${path}${tail}`;
  const paths = unique([forward(native), native, mixed]);
  const bash = [forward(native), ...quotedForms(paths)].map(command);
  const powershell = [...paths, ...quotedForms(paths)].map(command);
  return unique([...bash.map(c => `Bash(${c})`), ...powershell.map(c => `PowerShell(${c})`)]);
}

const unique = list => [...new Set(list)];
const quotedForms = paths => paths.flatMap(p => [`'${p}'`, `"${p}"`]);

// A path a rule writes quoted must mean the same file in both shells, quoted
// either way: inside double quotes $ and ` expand. And a space or a quote
// would need quoting of its own, so no written form could match.
function plainPath(path) {
  if (/[\s"'$`]/.test(path)) refuse(`the path ${oneLine(forward(path))} holds a space, a quote, a $ or a backtick, so a quoted command might not name it and a rule could not match`);
}

// A script rule names a file that exists in the skill under test's source at
// start. Before each send, the hash check on the copy covers it.
function checkRuleFiles(state, root) {
  for (const text of state.rules) {
    const r = parseRule(text);
    if (r.kind === 'script' && !isFile(join(root, ...r.rel))) refuse(`the tool rule ${oneLine(text)} names a script that is not an existing file`);
  }
}

const copyOf = (work, skill) => join(work, '.claude', 'skills', skill.name);

function settingsFor(state, dir) {
  const v = VARIANTS[state.variant];
  const work = join(dir, 'work');
  const config = configFolder();
  const home = homedir();
  const s = {};
  if (v.exclude) s.claudeMdExcludes = [forward(globalFile())];
  s.disableAllHooks = true;
  s.permissions = {
    allow: [rule('Edit', work, '/**'), ...unique(state.rules.flatMap(t => expandRule(parseRule(t), state, work)))],
    deny: [
      // The skill under test: its copy is what the run tests. Companion
      // skills get no deny rule, but a session cannot edit them either:
      // Claude Code protects every write under .claude/ in "don't ask" mode,
      // and an allow rule cannot pre-approve one (#164's smoke check 4). That
      // is a platform limit the owner accepted. An attempted edit shows in the
      // report's denials. This rule stays, because it states the intent.
      rule('Edit', copyOf(work, state.skills[0]), '/**'),
      // The session's own setup.
      rule('Edit', join(work, '.claude', 'settings.json')),
      rule('Edit', join(work, '.claude', 'settings.local.json')),
      rule('Edit', join(work, '.mcp.json')),
      ...INSTRUCTIONS.map(name => rule('Edit', work, `/**/${name}`)),
      rule('Edit', work, '/**/.git/**'),
      rule('Edit', work, '/**/.gitattributes'),
      // The owner's secrets, and the run's backups of the live folders.
      rule('Read', join(config, '.credentials.json')),
      rule('Read', join(config, 'settings.json')),
      rule('Read', join(config, 'settings.local.json')),
      rule('Read', join(config, '.claude.json')),
      rule('Read', join(home, '.claude.json')),
      rule('Read', join(home, '.ssh'), '/**'),
      rule('Read', join(home, '.aws'), '/**'),
      rule('Read', join(home, '.git-credentials')),
      rule('Read', join(home, '.npmrc')),
      rule('Read', join(dir, 'backup'), '/**'),
      ...OFF_MACHINE,
    ],
  };
  return s;
}

function flagsFor(state, settingsPath) {
  const v = VARIANTS[state.variant];
  return [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--setting-sources', v.sources,
    ...(v.strictMcp ? ['--strict-mcp-config'] : []),
    '--settings', settingsPath,
    // One argument per tool, the form Claude Code documents. The list takes
    // every argument up to the next flag, so a flag must follow it.
    '--permission-mode', 'dontAsk', '--disallowedTools', ...OFF_MACHINE,
    '--model', state.model, '--effort', state.effort,
  ];
}

// ---- the program ----

//
// GRIMOIRE_PRACTICE_PROGRAM is the test seam: an absolute path to an .exe, or
// to an .mjs file that runs under the current Node. Without it, the runner
// searches the path for Claude Code once, at start, and records what it found.
// The report says which, so a variable left set from a test run cannot pass
// for a real result.

const PROGRAM_VAR = 'GRIMOIRE_PRACTICE_PROGRAM';
const NODE_KINDS = ['.mjs', '.js', '.cjs'];

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function findProgram() {
  const p = process.env[PROGRAM_VAR];
  if (p) {
    const ext = extname(p).toLowerCase();
    if (!isAbsolute(p) || !['.exe', '.mjs'].includes(ext) || !isFile(p)) {
      refuse(`${PROGRAM_VAR} must be an absolute path to an existing .exe or .mjs file; it is ${oneLine(p)}`);
    }
    return checkProgram({ path: resolve(p), node: ext === '.mjs', fromVariable: true });
  }
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const runs = resolve(runsRoot());
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    // An empty or relative entry would resolve against wherever the runner
    // was started, which is not a place anyone chose to search.
    if (!entry || !isAbsolute(entry) || within(resolve(entry), runs)) continue;
    for (const name of names) {
      const found = join(entry, name);
      if (!isFile(found)) continue;
      if (name.endsWith('.cmd')) return checkProgram(fromShim(found));
      return checkProgram({ path: found, node: false, fromVariable: false });
    }
  }
  refuse(`Claude Code was not found on the path; install it, or name the program in ${PROGRAM_VAR}`);
}

// An npm install puts a .cmd shim on the path, and a shim needs a shell to
// run. The runner uses none, so it reads the file the shim would start.
function fromShim(cmd) {
  const text = readFileSync(cmd, 'utf8');
  const targets = [...text.matchAll(/"%~?dp0%?\\([^"%]+?\.(?:mjs|cjs|js|exe))"/gi)]
    .map(m => m[1]).filter(t => basename(t).toLowerCase() !== 'node.exe');
  const target = targets[0] && join(dirname(cmd), targets[0]);
  if (!target || !isFile(target)) refuse(`found ${oneLine(cmd)}, a shim whose target the runner cannot resolve`);
  return { path: target, node: NODE_KINDS.includes(extname(target).toLowerCase()), fromVariable: false };
}

// Applied at start and again before every send, to the recorded path.
function checkProgram(program) {
  const p = program?.path;
  const ext = extname(String(p)).toLowerCase();
  const kindOk = program?.node ? NODE_KINDS.includes(ext) : process.platform !== 'win32' || ext === '.exe';
  if (typeof p !== 'string' || !isAbsolute(p) || !isFile(p) || !kindOk || within(resolve(p), resolve(runsRoot()))) {
    refuse(`the program ${oneLine(p)} is not an absolute path to an existing program outside the runs`);
  }
  return program;
}

function launch(program, args, opts) {
  const [cmd, argv] = program.node ? [process.execPath, [program.path, ...args]] : [program.path, args];
  return spawnSync(cmd, argv, { ...opts, shell: false, windowsHide: true });
}

// ---- the environment ----

// The session's environment is built from this list, never inherited. It holds
// only what a program needs to start and find the login: the path, the home
// folder and the operating system's own values. So a provider key, an
// ANTHROPIC_* value, a GitHub token or a CLAUDE_CODE_* value in the runner's
// environment never reaches the session. An Anthropic key there would also
// move billing off the plan.
const SYSTEM = [
  'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PUBLIC',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ',
  // Node on Windows copies this one into every child's environment whether
  // it is passed or not, so it is listed to keep the report true.
  'LOGONSERVER',
];

// The runner's own environment, by upper-cased name. On Windows a name like
// Path or SystemRoot comes in mixed case, and the list above is upper case.
function inherited() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k.toUpperCase()] = v;
  return out;
}

// Empty and relative entries would resolve against the work folder, and an
// entry under the runs would let a session plant a program the next turn runs.
function cleanPath(value) {
  const runs = resolve(runsRoot());
  return value.split(delimiter)
    .filter(p => p && isAbsolute(p) && !within(resolve(p), runs))
    .join(delimiter);
}

function within(path, dir) {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function sessionEnv(state, work) {
  const from = inherited();
  const env = {};
  for (const name of SYSTEM) if (from[name] !== undefined) env[name] = from[name];
  if (env.PATH !== undefined) env.PATH = cleanPath(env.PATH);
  // The login and the global file live in the config folder, so the session
  // must use the same one the exclusion was computed from.
  if (from.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = from.CLAUDE_CONFIG_DIR;
  const temp = join(work, '.tmp');
  env.TEMP = env.TMP = env.TMPDIR = temp;
  Object.assign(env, state.values);
  return env;
}

// ---- inputs ----
//
// Every value that becomes an argument, a path or an environment entry is
// checked against a fixed shape first. Each refusal names one reason, because
// a case run under conditions nobody chose would still look like a result.

const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{8}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,79}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME = /^[A-Z_][A-Z0-9_]*$/;

// Names that change how a program starts or where its state lives. A case may
// not set them, even as a literal. A name on the system list above is refused
// too, because it would replace a value the session needs to start.
const STARTUP_NAMES = new Set([
  'PATH', 'TEMP', 'TMP', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'USERPROFILE', 'HOME',
  'LD_PRELOAD', 'LD_LIBRARY_PATH',
  // Claude Code's own: one wraps every shell command, one names the shell.
  'CLAUDE_CODE_SHELL_PREFIX', 'CLAUDE_CODE_GIT_BASH_PATH',
  // Files a shell reads when it starts.
  'BASH_ENV', 'ENV', 'PSMODULEPATH', 'CLAUDE_ENV_FILE',
]);
const STARTUP_PREFIXES = ['NODE_', 'GIT_', 'DYLD_', 'BUN_'];
const startupName = name => STARTUP_NAMES.has(name) || STARTUP_PREFIXES.some(p => name.startsWith(p)) || SYSTEM.includes(name);

// The cases that plant an instruction, and eagle-eye's session that needs a
// fake key, run only where the posture is the runner's alone. On a variant
// that loads user settings, the owner's own allow rules merge into it, and a
// settings key could replace the fake one. Keyed by the skill under test's
// name, as its SKILL.md gives it. Case names compare without regard to case.
const RUNNER_ONLY_CASES = { contract: ['B3', 'B25b'], 'eagle-eye': ['session-4', 'P1', 'P2', 'P3', 'P4'] };
const RUNNER_ONLY_VARIANTS = ['clean', 'owner-pact'];

// A value quoted in a reason: escaped onto one line, and cut from the front
// when long, because the end of a path is the part that names the file.
const oneLine = s => {
  const t = String(s);
  return JSON.stringify(t.length > 120 ? `…${t.slice(-119)}` : t);
};

function checkValues(state) {
  if (state.variant === 'desktop-app') refuse('desktop-app is a manual procedure on the shared page, not a runner variant: the app cannot take flags');
  if (!Object.hasOwn(VARIANTS, state.variant)) refuse(`unknown variant ${oneLine(state.variant)}; the runner knows ${Object.keys(VARIANTS).join(', ')}`);
  if (!MODEL.test(state.model)) refuse(`the model ${oneLine(state.model)} is outside the model pattern`);
  if (!EFFORTS.includes(state.effort)) refuse(`the effort ${oneLine(state.effort)} is not one of ${EFFORTS.join(', ')}`);
  if (state.case !== null && !CASE.test(state.case)) refuse(`the case name ${oneLine(state.case)} is outside the case pattern`);
  for (const [name, value] of Object.entries(state.values)) {
    if (!NAME.test(name)) refuse(`the value name ${oneLine(name)} is outside ^[A-Z_][A-Z0-9_]*$`);
    if (startupName(name)) refuse(`a case may not set ${name}: it changes how programs start or where their state lives`);
    if (typeof value !== 'string' || value.includes('\0') || value.length > 4096) refuse(`the value of ${name} is not a literal the runner can pass`);
  }
  checkConfigFolder(state.variant);
  if (!Array.isArray(state.rules)) refuse('the run state no longer matches what its variant gives; start a new run');
  state.rules.forEach(parseRule);
  checkRuleValues(state);
  // The title comes from a file, so it is never used as a plain-object key.
  const title = state.skills[0]?.title;
  const only = (Object.hasOwn(RUNNER_ONLY_CASES, title) ? RUNNER_ONLY_CASES[title] : [])
    .find(c => c.toLowerCase() === state.case?.toLowerCase());
  if (only && !RUNNER_ONLY_VARIANTS.includes(state.variant)) {
    refuse(`case ${only} of ${state.skills[0].title} runs only on ${RUNNER_ONLY_VARIANTS.join(' and ')}, where the posture is the runner's alone`);
  }
}

function parseValue(v) {
  const at = v.indexOf('=');
  if (at < 0) refuse(`a named value must be a literal written in the case, NAME=value; ${oneLine(v)} would pass the runner's own value through`);
  return [v.slice(0, at), v.slice(at + 1)];
}

const SINGLE = ['--variant', '--setup', '--case', '--model', '--effort'];
const MULTI = ['--skill', '--value', '--rule'];

function parseStart(args) {
  const o = { skill: [], value: [], rule: [] };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!SINGLE.includes(flag) && !MULTI.includes(flag)) refuse(`unknown option ${oneLine(flag).slice(1, -1)}`);
    const value = args[i + 1];
    if (value === undefined) refuse(`${flag} needs a value`);
    const key = flag.slice(2);
    if (MULTI.includes(flag)) o[key].push(value);
    else if (o[key] !== undefined) refuse(`${flag} was given twice`);
    else o[key] = value;
  }
  for (const flag of ['--variant', '--model', '--effort']) if (o[flag.slice(2)] === undefined) refuse(`start needs ${flag}`);
  if (!o.skill.length) refuse('start needs --skill: the first one is the skill under test');
  const names = o.value.map(parseValue).map(([k]) => k);
  const twice = names.find((k, i) => names.indexOf(k) !== i);
  if (twice) refuse(`the value ${twice} was given twice`);
  return o;
}

// ---- folders ----

const INSTRUCTIONS = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Walk a folder without following links, and refuse any link: a link copied
// into the work folder could point the session anywhere. Calls visit(rel, st)
// for every entry below the root.
function walk(root, visit, rel = '') {
  for (const name of readdirSync(join(root, rel))) {
    const r = rel ? join(rel, name) : name;
    const st = lstatSync(join(root, r));
    if (st.isSymbolicLink()) refuse(`a link at ${oneLine(join(root, r))}; the runner copies no links`);
    visit(r, st);
    if (st.isDirectory()) walk(root, visit, r);
  }
}

function checkSkill(src) {
  const dir = resolve(src);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) refuse(`the skill folder ${oneLine(dir)} does not exist`);
  const md = join(dir, 'SKILL.md');
  if (!existsSync(md) || !lstatSync(md).isFile()) refuse(`the skill folder ${oneLine(dir)} has no SKILL.md, so nothing would be under test`);
  walk(dir, () => {});
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(md, 'utf8'));
  const title = front && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(front[1]);
  return { name: basename(dir), title: title ? title[1] : basename(dir), source: dir };
}

// A setup folder carries a case's files. It may not carry anything that would
// change the session's own setup: settings, MCP servers, instructions, agents,
// commands or rules. Those come from the variant, or not at all.
function checkSetup(src) {
  const dir = resolve(src);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) refuse(`the setup folder ${oneLine(dir)} does not exist`);
  walk(dir, (rel, st) => {
    const name = basename(rel);
    if (INSTRUCTIONS.some(i => i.toLowerCase() === name.toLowerCase())) refuse(`the setup folder holds an instruction file, ${oneLine(rel)}`);
    if (name.toLowerCase() === '.mcp.json') refuse(`the setup folder holds an MCP config, ${oneLine(rel)}`);
    if (name.toLowerCase() === '.claude' && st.isDirectory()) refuse(`the setup folder holds a .claude folder, ${oneLine(rel)}; skills come in through --skill`);
    if (rel.toLowerCase() === '.tmp') refuse('the setup folder holds .tmp, which is the session\'s temp folder');
  });
  return dir;
}

// The user's own config folder is the one place above the work folder that
// may hold a .claude folder. The account's real home counts as well as the
// home the environment names, so a faked HOME does not turn it into a project.
function ownConfigFolders() {
  const out = [join(homedir(), '.claude')];
  try { out.push(join(userInfo().homedir, '.claude')); } catch { /* no account entry */ }
  if (process.env.CLAUDE_CONFIG_DIR) out.push(resolve(process.env.CLAUDE_CONFIG_DIR));
  return out;
}

// Claude Code reads instruction files from every folder above the one it runs
// in, and a repository's .claude folder above it would load as a project. So
// the work folder must have neither above it.
//
// The names are walked as written, and again as the file system resolves
// them, because a temp folder reached through a link has other ancestors.
function checkAncestors(from) {
  let near = resolve(from);
  while (!existsSync(near) && dirname(near) !== near) near = dirname(near);
  const starts = [resolve(from)];
  try { starts.push(realpathSync.native(near)); } catch { /* nothing to resolve */ }
  for (const s of starts) walkUp(s);
}

function walkUp(from) {
  const own = ownConfigFolders();
  for (let d = resolve(from); ; d = dirname(d)) {
    for (const name of INSTRUCTIONS) {
      if (existsSync(join(d, name))) refuse(`an ancestor of the work folder holds ${oneLine(join(d, name))}; run under a temp folder outside any checkout`);
    }
    const dotClaude = join(d, '.claude');
    if (existsSync(dotClaude) && !own.some(o => same(resolve(o), dotClaude))) {
      refuse(`an ancestor of the work folder holds a project settings folder, ${oneLine(dotClaude)}`);
    }
    if (dirname(d) === d) return;
  }
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  const files = [];
  walk(from, (rel, st) => {
    if (st.isDirectory()) mkdirSync(join(to, rel), { recursive: true });
    else if (st.isFile()) { writeFileSync(join(to, rel), readFileSync(join(from, rel))); files.push(rel); }
  });
  return files;
}

// ---- the manifest ----
//
// One file in the run's backup folder holds the hash of every copied skill
// file at start. Start prints the manifest's own SHA-256, so a reference also
// lives outside the run directory, and every send checks the manifest against
// the hash start recorded before trusting it.

const MANIFEST = join('backup', 'manifest.json');

// Every entry under a folder, as [forward-slashed path, what it is]: a file's
// SHA-256, 'link -> <target>', 'unreadable' or 'other'. It never follows a link and
// never stops at an entry it cannot read. With `copyTo`, it also copies each
// file it read there, so the hash and the copy are of the same bytes.
function tree(root, copyTo = null) {
  const out = [];
  const visit = rel => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const p = join(root, r);
      let st;
      try { st = lstatSync(p); } catch { out.push([r, 'unreadable']); continue; }
      if (st.isSymbolicLink()) out.push([r, linkEntry(p)]);
      else if (st.isDirectory()) {
        if (copyTo) mkdirSync(join(copyTo, r), { recursive: true });
        try { visit(r); } catch { out.push([`${r}/`, 'unreadable']); }
      } else if (st.isFile()) {
        let bytes;
        try { bytes = readFileSync(p); } catch { out.push([r, 'unreadable']); continue; }
        if (copyTo) writeFileSync(join(copyTo, r), bytes);
        out.push([r, sha256(bytes)]);
      } else out.push([r, 'other']);
    }
  };
  visit('');
  return out;
}

// A link as the manifest records it: with its target, read without following
// it, so a link pointed somewhere else shows as a change.
const linkEntry = p => { try { return `link -> ${readlinkSync(p)}`; } catch { return 'link'; } };

// A folder's entries, where the folder itself may be gone, a link or
// unreadable: each of those is an entry at the folder's own path, never a crash.
function treeAt(root) {
  let st;
  try { st = lstatSync(root); } catch { return []; }
  if (st.isSymbolicLink()) return [['', linkEntry(root)]];
  if (!st.isDirectory()) return [['', 'not a folder']];
  try { return tree(root); } catch { return [['', 'unreadable']]; }
}

const copiedPrefix = skill => `.claude/skills/${skill.name}/`;

function copiedHashes(work, skills) {
  return skills.flatMap(s => treeAt(copyOf(work, s)).map(([r, h]) => [copiedPrefix(s) + r, h]));
}

function writeManifest(dir, manifest) {
  const file = join(dir, MANIFEST);
  plainFile(file);
  const text = JSON.stringify(manifest, null, 2);
  writeFileSync(file, text);
  return sha256(Buffer.from(text));
}

// The manifest, once its bytes match the hash start recorded.
function readManifest(dir, state) {
  const file = join(dir, MANIFEST);
  plainFile(file);
  let bytes;
  try { bytes = readFileSync(file); } catch { refuse('the backup manifest is gone; start a new run'); }
  if (sha256(bytes) !== state.manifest) refuse(`the backup manifest changed since start (start printed sha256 ${state.manifest}); start a new run`);
  return JSON.parse(bytes.toString('utf8'));
}

// ---- the live folders ----
//
// Start copies the owner's six live places into the run's backup folder and
// hashes them. Report hashes them again and lists any change; end deletes the
// backups when nothing changed. Detection and undo are what hygiene can
// promise: an allowed command can still write here, and could overwrite the
// backups too.
//
// The settings file is backed up without its environment block, so no key
// sits in the run directory. Its hash is of the live bytes, so a change to the
// environment block still shows.

const REPO_SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function livePlaces() {
  const config = configFolder();
  return [
    { key: 'user-skills', label: 'user skills', path: join(config, 'skills'), folder: true },
    { key: 'agent-skills', label: 'shared agent skills', path: join(homedir(), '.agents', 'skills'), folder: true },
    { key: 'user-agents', label: 'user agents', path: join(config, 'agents'), folder: true },
    { key: 'settings.json', label: 'user settings', path: join(config, 'settings.json'), settings: true },
    { key: 'CLAUDE.md', label: 'global instructions', path: globalFile() },
    { key: 'repo-skills', label: 'this repository\'s skills', path: resolve(REPO_SKILLS), folder: true },
  ];
}

// The user settings file as an object, or null. Read in memory only: its
// environment block never reaches a file the runner writes.
function userSettings() {
  try {
    const s = JSON.parse(readFileSync(join(configFolder(), 'settings.json'), 'utf8'));
    return s !== null && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch { return null; }
}

// One place as it is now: what it is, and its hashes. With `backup`, the
// place is copied there as it is read.
function snapshot(place, backup = null) {
  let st;
  try { st = lstatSync(place.path); } catch { return { kind: 'absent' }; }
  if (st.isSymbolicLink()) return { kind: 'link', target: linkEntry(place.path) };
  if (place.folder) {
    if (!st.isDirectory()) return { kind: 'not a folder' };
    const to = backup && join(backup, place.key);
    if (to) mkdirSync(to);
    try { return { kind: 'folder', entries: tree(place.path, to) }; } catch { return { kind: 'unreadable' }; }
  }
  if (!st.isFile()) return { kind: 'not a file' };
  let bytes;
  try { bytes = readFileSync(place.path); } catch { return { kind: 'unreadable' }; }
  const out = { kind: 'file', sha256: sha256(bytes) };
  if (!backup) return out;
  if (place.settings) {
    let s = null;
    try { s = JSON.parse(bytes.toString('utf8')); } catch { /* not JSON */ }
    if (s === null || typeof s !== 'object' || Array.isArray(s)) return { ...out, backup: 'none: not a JSON object' };
    delete s.env;
    writeFileSync(join(backup, place.key), JSON.stringify(s, null, 2));
    return { ...out, backup: 'without its environment block' };
  }
  writeFileSync(join(backup, place.key), bytes);
  return { ...out, backup: 'whole' };
}

// Each place's changes since the manifest, as [runner text, path] pairs; the
// path is empty when the change is the place's own.
function liveChanges(manifest) {
  const lines = [];
  for (const was of manifest.live) {
    // The kind comes from the table, the path from the manifest: the config
    // folder variable may differ in the shell that runs report or end.
    const place = livePlaces().find(p => p.key === was.key);
    const now = place && typeof was.path === 'string' ? snapshot({ ...place, path: was.path }) : { kind: 'absent' };
    if (now.kind !== was.kind) { lines.push([`${was.label}: was ${was.kind}, now ${now.kind}`, '']); continue; }
    if (now.kind === 'link' && now.target !== was.target) lines.push([`${was.label}: the link now points elsewhere`, '']);
    if (now.kind === 'file' && now.sha256 !== was.sha256) lines.push([`${was.label}: modified`, '']);
    if (now.kind === 'folder') for (const [verb, r] of diffEntries(was.entries, now.entries)) lines.push([`${was.label}: ${verb}`, r]);
  }
  return lines;
}

// A change line: the runner's words as they are, the path cleaned and masked.
const changeLine = ([text, path]) => (path ? `${text} ${one(path)}` : text);

// The places start could not back up or hash: a link, which is never
// followed, or a place it could not read. The report names each one, so
// "unchanged" never covers a place nobody checked.
const CHECKED = ['folder', 'file', 'absent'];
const notChecked = manifest => manifest.live.filter(p => !CHECKED.includes(p.kind));
const placeName = p => `${p.label} (${p.kind === 'link' ? 'a link' : p.kind})`;

// What changed between two entry lists, as [verb, path] pairs: added,
// modified and removed. The verb is the runner's; the path may be the
// session's, so only the path is masked when it is printed.
function diffEntries(was, now) {
  const before = new Map(was);
  const after = new Map(now);
  const out = [];
  for (const [r, h] of now) if (!before.has(r)) out.push(['added', r]); else if (before.get(r) !== h) out.push(['modified', r]);
  for (const [r] of was) if (!after.has(r)) out.push(['removed', r]);
  return out;
}

// The manifest if its bytes still match start's hash, or null.
function manifestIfIntact(dir, state) {
  try { return readManifest(dir, state); } catch (e) { if (e instanceof Refusal) return null; throw e; }
}

// ---- pre-turn checks ----
//
// They catch a write the deny rules missed, at the moment it matters: before
// the next turn runs under it.

function preTurn(state, dir, work) {
  const copied = new Set(state.copied.map(forward));
  listFiles(work, (rel, link, unreadable) => {
    const r = forward(rel);
    if (unreadable) refuse(`the work folder holds an entry the runner cannot read, ${oneLine(r)}; start a new run`);
    if (copied.has(r)) return;
    const lower = r.toLowerCase();
    const kind = ['.claude/settings.json', '.claude/settings.local.json'].includes(lower) ? 'a project settings file'
      : lower === '.mcp.json' ? 'an MCP config'
        : INSTRUCTIONS.some(i => i.toLowerCase() === basename(lower)) ? 'an instruction file' : null;
    if (kind) refuse(`the work folder holds ${kind} that setup did not put there, ${oneLine(r)}; start a new run`);
  });
  const sut = state.skills[0];
  const prefix = copiedPrefix(sut);
  const was = readManifest(dir, state).copied.filter(([r]) => r.startsWith(prefix));
  const now = treeAt(copyOf(work, sut)).map(([r, h]) => [prefix + r, h]);
  if (JSON.stringify(now) !== JSON.stringify(was)) {
    const before = new Map(was);
    const first = now.find(([r, h]) => before.get(r) !== h)?.[0] ?? was.find(([r]) => !now.some(([s]) => s === r))?.[0];
    refuse(`the copy of the skill under test changed since start, at ${oneLine(first ?? prefix)}; start a new run`);
  }
}

// ---- start ----

function newId() {
  return `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${randomBytes(4).toString('hex')}`;
}

function start(args) {
  const o = parseStart(args);
  const skills = o.skill.map(checkSkill);
  const dup = skills.find((s, i) => skills.findIndex(t => same(t.name, s.name)) !== i);
  if (dup) refuse(`two skill folders are both called ${oneLine(dup.name)}`);
  const setup = o.setup === undefined ? null : checkSetup(o.setup);
  const state = {
    id: null, created: new Date().toISOString(), variant: o.variant, case: o.case ?? null,
    model: o.model, effort: o.effort, skills, setup,
    values: Object.fromEntries(o.value.map(parseValue)), rules: o.rule,
    sessionId: null, attempts: 0, turns: [], ended: null,
  };
  checkValues(state);
  checkRuleFiles(state, skills[0].source);
  // Under any name: a long value equal to one the runner holds is that value,
  // whatever it is called now. A short one like 1 or true is no evidence.
  const own = Object.values(inherited());
  for (const [name, value] of Object.entries(state.values)) {
    if (inherited()[name] === value || (value.length >= 8 && own.includes(value))) {
      refuse(`the value of ${name} equals one of the runner's own values, so it would be passed through; write a test value`);
    }
  }
  checkAncestors(runsRoot());
  const program = findProgram();

  const id = newId();
  const dir = join(runsRoot(), id);
  mkdirSync(runsRoot(), { recursive: true });
  mkdirSync(dir);
  // From here a failure removes the half-made run, so no copy of the skill
  // stays where end cannot reach it.
  try {
    made(dir, id, state, skills, setup, program);
  } catch (e) {
    remove(dir);
    throw e;
  }
}

function made(dir, id, state, skills, setup, program) {
  const work = join(dir, 'work');
  mkdirSync(join(work, '.tmp'), { recursive: true });
  state.id = id;
  state.program = program;
  state.envNames = Object.keys(sessionEnv({ values: {} }, work)).sort();
  // The program's version, asked in the session's own environment. A program
  // that cannot answer it would not run a turn either.
  const v = launch(program, ['--version'], { cwd: work, env: sessionEnv(state, work), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (v.status !== 0 || !String(v.stdout).trim()) {
    refuse(`the program ${oneLine(program.path)} did not answer --version (exit ${v.status})`);
  }
  program.version = clean(String(v.stdout).trim().split('\n')[0]).slice(0, 200);
  // The copied skills' files, so the report can leave them out of the disk
  // listing and show only what the session made.
  state.copied = [];
  for (const s of skills) {
    const to = join('.claude', 'skills', s.name);
    for (const f of copyTree(s.source, join(work, to))) state.copied.push(join(to, f));
  }
  if (setup) copyTree(setup, work);
  state.flags = flagsFor(state, join(dir, 'settings.json'));
  state.settings = settingsFor(state, dir);
  state.globalFile = globalRecord(state.variant);
  const backup = join(dir, 'backup');
  mkdirSync(backup);
  const live = livePlaces().map(p => ({ key: p.key, label: p.label, path: p.path, ...snapshot(p, backup) }));
  state.manifest = writeManifest(dir, { copied: copiedHashes(work, skills), live });
  save(dir, state);
  process.stdout.write(`${id}\n`);
  process.stderr.write(`started run ${id} on variant ${state.variant}; the session works in ${work}\n`);
  process.stderr.write(`backup manifest sha256 ${state.manifest}: keep this line, so a restore can check the backups against it\n`);
}

// A run named on the command line. The id is checked against its generated
// pattern before any path is built from it.
function openRun(argv, command) {
  if (argv.length !== 1) refuse(`usage: practice.mjs ${command} <run-id>`);
  const id = argv[0];
  if (!RUN_ID.test(id)) refuse(`bad run id ${oneLine(id)}; a run id looks like 20261001-120000-0a1b2c3d`);
  const dir = join(runsRoot(), id);
  if (!existsSync(join(dir, STATE))) refuse(`unknown run ${id} under ${runsRoot()}`);
  try {
    plainFile(join(dir, STATE));
  } catch (e) {
    // End cannot mark such a run ended, so the copy of the skill stays.
    if (command === 'end' && e instanceof Refusal) refuse(`the run record is not a plain file, so the run cannot be ended; delete ${oneLine(join(dir, 'work'))} by hand`);
    throw e;
  }
  let state;
  try { state = JSON.parse(readFileSync(join(dir, STATE), 'utf8')); } catch { /* refused below */ }
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(state) || !Array.isArray(state.turns) || !Array.isArray(state.skills) || !state.skills.length
    || !isObject(state.values) || !Array.isArray(state.envNames) || !isObject(state.globalFile) || !Array.isArray(state.copied)
    || !isObject(state.program) || !Array.isArray(state.flags) || !isObject(state.settings)
    || !Array.isArray(state.rules) || typeof state.manifest !== 'string') {
    refuse(`the run state of ${id} is not readable; start a new run`);
  }
  return { id, dir, work: join(dir, 'work'), state };
}

// The runner's own files in the run directory are written only as plain
// files. A link, or a hard link shared with a file elsewhere, would turn the
// runner's write into a write somewhere else.
function plainFile(path) {
  let st;
  try { st = lstatSync(path); } catch { return; }
  if (!st.isFile() || st.nlink > 1) refuse(`${basename(path)} in the run directory is not a plain file; start a new run`);
}

// The work folder must be the folder start made, not a link to another one.
function plainFolder(path) {
  let st;
  try { st = lstatSync(path); } catch { refuse('the work folder is gone; start a new run'); }
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('the work folder is a link or not a folder; start a new run');
}

// ---- send ----

function events(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* not an event */ }
  }
  return out;
}

function send(argv) {
  const { dir, state } = openRun(argv, 'send');
  if (state.ended) refuse(`run ${state.id} ended at ${state.ended}; start a new run`);
  checkValues(state);
  checkAncestors(dir);
  checkProgram(state.program);
  // The flags and the settings are rebuilt from the variant table, never read
  // back. What start recorded must equal that rebuild, or something changed
  // the run since start, and this turn would run under conditions nobody chose.
  // The global file is checked before the settings, because a moved config
  // folder changes the settings' rules too, and its reason names the cause.
  const changed = 'the run state no longer matches what its variant gives; start a new run';
  const rebuilt = flagsFor(state, join(dir, 'settings.json'));
  if (JSON.stringify(rebuilt) !== JSON.stringify(state.flags)) refuse(changed);
  if (JSON.stringify(globalRecord(state.variant)) !== JSON.stringify(state.globalFile)) {
    refuse('the global instructions file changed since start, or its config folder moved; start a new run');
  }
  const settings = settingsFor(state, dir);
  if (JSON.stringify(settings) !== JSON.stringify(state.settings)) refuse(changed);
  const message = readFileSync(0);
  if (!message.length) refuse('no message on standard input');
  if (state.sessionId !== null && !UUID.test(state.sessionId)) refuse('the run state no longer matches what its variant gives; start a new run');
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0) refuse('the run state no longer matches what its variant gives; start a new run');
  const work = join(dir, 'work');
  plainFolder(work);
  preTurn(state, dir, work);
  const out = join(dir, `attempt-${state.attempts + 1}.jsonl`);
  for (const f of ['settings.json', 'transcript.jsonl', basename(out)]) plainFile(join(dir, f));
  // Written again before every turn, so a change to the file between turns
  // never reaches the session.
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  const args = state.sessionId ? [...rebuilt, '--resume', state.sessionId] : rebuilt;
  // Standard output goes to a file, not a buffer: a long turn's events can
  // pass any buffer limit, and a cut-off transcript would read as a short turn.
  const attempt = state.attempts + 1;
  const fd = openSync(out, 'w+');
  let r;
  let raw;
  try {
    r = launch(state.program, args, { cwd: work, env: sessionEnv(state, work), input: message, stdio: ['pipe', fd, 'pipe'] });
    // Read back through the runner's own handle, not by name: the session ran
    // in between, and a name can be pointed somewhere else.
    raw = readAll(fd);
  } finally {
    closeSync(fd);
    // The raw events are unmasked, so they never outlive this send, whatever
    // refuses below. remove() takes a link as itself, and never throws.
    remove(out);
  }
  state.attempts = attempt;
  const kept = scrubTranscript(raw);
  plainFile(join(dir, 'transcript.jsonl'));
  appendFileSync(join(dir, 'transcript.jsonl'), kept);
  const ev = events(raw);
  const init = ev.find(e => e.type === 'system' && e.subtype === 'init');
  const result = ev.find(e => e.type === 'result');
  const reported = [init?.session_id, result?.session_id].find(s => typeof s === 'string' && UUID.test(s));
  if (!reported) {
    save(dir, state);
    fail(`the session reported no session id (program exit ${r.status}), so this send did not count as a turn; its events are in the run's transcript`);
  }
  maskCount = 0;
  const turn = summarise(ev, reported, r.status, message.toString('utf8'));
  turn.masked = maskCount;
  turn.n = state.turns.length + 1;
  if (!state.sessionId) state.sessionId = reported;
  state.turns.push(turn);
  save(dir, state);
  // The frame carries a token the session cannot know, so a reply that
  // prints a closing line of its own does not close the frame.
  const token = randomBytes(8).toString('hex');
  const shown = `--- session reply, turn ${turn.n} (untrusted text from the session) [${token}] ---\n${scrub(result?.result ?? '')}\n--- end of session reply [${token}] ---\n`
    + `skills loaded on this turn: ${turn.skillsLoaded.length ? turn.skillsLoaded.map(one).join(', ') : 'none'}\n`;
  process.stdout.write(shown + masked(maskCount));
  if (reported !== state.sessionId) fail(`the session reported id ${reported}, not ${state.sessionId}: the earlier turns may be lost`);
  if (r.status !== 0 || !result || result.is_error) fail(`the turn did not complete (program exit ${r.status}${result ? `, result ${clean(String(result.subtype))}` : ', no result event'})`);
}

// What a turn's events say, kept in the run state for the report. The lists
// come from the session's own start-up event, so the report shows what loaded
// rather than what was asked for.
function summarise(ev, sessionId, exit, message) {
  const init = ev.find(e => e.type === 'system' && e.subtype === 'init') || {};
  const result = ev.find(e => e.type === 'result') || {};
  // Kept cleaned and masked, so the run state holds no more than the report.
  const strings = v => (Array.isArray(v) ? v.map(x => scrub(typeof x === 'object' && x ? x.name : x)) : []);
  return {
    sessionId, exit,
    startup: {
      agents: strings(init.agents),
      plugins: strings(init.plugins),
      skills: strings(init.skills),
      mcp: Array.isArray(init.mcp_servers) ? init.mcp_servers.map(m => scrub(`${m?.name} (${m?.status})`)) : [],
      tools: strings(init.tools),
      permissionMode: scrub(init.permissionMode),
      apiKeySource: scrub(init.apiKeySource),
      model: scrub(init.model),
    },
    hookEvents: ev.filter(e => e.type === 'system' && /^hook_/.test(String(e.subtype))).length,
    skillsLoaded: ev.filter(e => e.type === 'assistant')
      .flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []))
      .filter(c => c?.type === 'tool_use' && c.name === 'Skill')
      .map(c => scrub(c.input?.skill))
      .concat(slashSkill(init, message)),
    denials: (Array.isArray(result.permission_denials) ? result.permission_denials : [])
      // Masked before it becomes JSON text, where an escape would hide a key's start.
      .map(d => ({ tool: scrub(d?.tool_name), input: JSON.stringify(deepScrub(d?.tool_input ?? null)) })),
  };
}

// A skill opened by a slash command leaves no event in the stream, so the
// runner reads it from the message it sent: a first word /<name>, counted only
// when the session's own start-up lists name it as a command and as a skill.
function slashSkill(init, message) {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9:._-]*)(?:\s|$)/.exec(message);
  const lists = v => Array.isArray(v) && v.some(x => String(x) === m[1]);
  return m && lists(init.slash_commands) && lists(init.skills) ? [`${scrub(m[1])} (opened by the message's slash command)`] : [];
}

// Session text loses every control character but newline and tab, the line
// and paragraph separators, and every default-ignorable code point: the marks
// that reorder text on screen, the zero-width characters and the tag
// characters. So a reply cannot move the cursor, retitle the terminal or hide
// what it says.
const clean = s => String(s).replace(/\r\n?/g, '\n').replace(/[\u{0}-\u{8}\u{b}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}\p{Default_Ignorable_Code_Point}]/gu, '');

// A field meant to be one line stays one line, so a name the session chose
// cannot start a line that reads as the runner's.
const flat = s => clean(s).replace(/[\n\t]+/g, ' ');

// ---- masking ----
//
// A result gets posted, and session text could carry a secret. So every piece
// of session text the runner prints or keeps is masked, field by field before
// any output is put together: by known key shapes, and by exact value for the
// values the runner holds. Those are its own environment values that the
// session never receives, and the user settings environment values, read
// fresh here and never written anywhere. A path or a list of paths under an
// ordinary name is not held, because every run path starts with one, and a
// value shorter than 8 characters is no evidence. The runner's own fields are never masked, so a
// session cannot hide them.

const MASK = '[masked]';
// Before a key: not a letter, digit or underscore, or a JSON escape such as
// \n, because a denial's input is kept as JSON text. The shapes with a prefix
// no word ends in need no such start, so a key glued to a word goes too.
const START = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[nrtbf])|(?<=\\u[0-9A-Fa-f]{4}))`;
const KEY_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  new RegExp(`${START}sk-(?:or-|proj-)?[A-Za-z0-9_-]{20,}`, 'g'),
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  new RegExp(`${START}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g'),
  /AIza[0-9A-Za-z_-]{35}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /hf_[A-Za-z0-9]{30,}/g,
  new RegExp(`${START}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`, 'g'),
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

const pathLike = v => v.split(delimiter).every(p => p && isAbsolute(p));
// A name that says secret holds its value whatever the value looks like: a
// base64 key can start with a slash. A provider's name alone does not, so a
// path such as GITHUB_WORKSPACE stays readable.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE/i;

let held = null;
function heldValues() {
  if (held) return held;
  const values = new Set();
  for (const [name, value] of Object.entries(inherited())) {
    if (!SYSTEM.includes(name) && value.length >= 8 && (SECRET_NAME.test(name) || !pathLike(value))) values.add(value);
  }
  const us = userSettings();
  const env = us && Object.hasOwn(us, 'env') && us.env !== null && typeof us.env === 'object' ? us.env : {};
  for (const value of Object.values(env)) if (typeof value === 'string' && value.length >= 8) values.add(value);
  // A value also appears JSON-escaped, in a denial's input or a transcript.
  for (const v of [...values]) values.add(JSON.stringify(v).slice(1, -1));
  held = [...values].sort((a, b) => b.length - a.length);
  return held;
}

// How many values mask() has replaced, so the flag counts the runner's own
// masks and not a "[masked]" the session wrote.
let maskCount = 0;

function mask(s) {
  let out = String(s);
  for (const v of heldValues()) {
    const parts = out.split(v);
    maskCount += parts.length - 1;
    out = parts.join(MASK);
  }
  for (const shape of KEY_SHAPES) out = out.replace(shape, () => { maskCount += 1; return MASK; });
  return out;
}

// Session text as the runner keeps or prints it: masked, cleaned, and masked
// again, because stripping an invisible character can glue a key to a word.
const scrub = s => mask(clean(mask(s)));

// A field the runner prints on one line: flattened, then masked.
const one = s => mask(flat(mask(s)));

// The flag that goes with masking.
const masked = n => (n ? `masked: ${n} value${n === 1 ? '' : 's'} that look like credentials or match a value the runner holds\n` : '');

// Every string in a parsed value, cleaned and masked, keys included.
const deepScrub = v => (typeof v === 'string' ? scrub(v)
  : Array.isArray(v) ? v.map(deepScrub)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), deepScrub(x)]))
      : v);

// A transcript line is parsed, so a control character written as a JSON
// escape goes too, and every string in it is cleaned and masked.
function scrubTranscript(raw) {
  return raw.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    try { return JSON.stringify(deepScrub(JSON.parse(line))); } catch { return scrub(line); }
  }).join('\n');
}

// ---- report ----

// The run record. Everything in it is a field the runner wrote, or a name or
// list the session reported, cleaned. It prints names, never a named value.
// The report prints the record's runner fields as they are, so it checks
// their shapes first, as send checks what it rebuilds.
function checkRecord(state, id) {
  const bad = () => refuse(`the run state of ${id} is not readable; start a new run`);
  const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);
  if (state.id !== id || !Object.hasOwn(VARIANTS, state.variant) || !MODEL.test(state.model) || !EFFORTS.includes(state.effort)
    || (state.case !== null && !CASE.test(state.case)) || (state.sessionId !== null && !UUID.test(state.sessionId))
    || !/^[0-9a-f]{64}$/.test(state.manifest) || !iso(state.created) || (state.ended !== null && !iso(state.ended))
    || (state.setup !== null && (typeof state.setup !== 'string' || /[\u{0}-\u{1f}\u{7f}-\u{9f}]/u.test(state.setup)))
    || !state.envNames.every(n => typeof n === 'string' && /^[A-Z_][A-Z0-9_()]*$/.test(n))
    || !Object.keys(state.values).every(n => NAME.test(n))) bad();
  state.rules.forEach(parseRule);
  for (const t of state.turns) {
    if (!UUID.test(String(t?.sessionId)) || !Number.isSafeInteger(t.n) || !Number.isSafeInteger(t.hookEvents)) bad();
  }
}

function report(argv) {
  const { id, dir, state, work } = openRun(argv, 'report');
  checkRecord(state, id);
  maskCount = 0;
  const v = VARIANTS[state.variant] || {};
  const g = state.globalFile;
  const p = state.program;
  const L = [];
  L.push(`run ${state.id}`);
  L.push(`created: ${state.created}`);
  L.push(`ended: ${state.ended || 'no'}`);
  L.push(`variant: ${state.variant}`);
  L.push(`case: ${state.case ?? 'none'}`);
  L.push(`model: ${state.model}`);
  L.push(`effort: ${state.effort} (requested)`);
  L.push('permission mode: dontAsk');
  L.push(`setting sources: ${v.sources}; MCP servers from no file: ${v.strictMcp ? 'yes' : 'no'}`);
  L.push(g.excluded
    ? `global instructions: excluded ${g.path}`
    : `global instructions: layered ${g.path}, ${g.sha256 ? `sha256 ${g.sha256}` : 'absent'}`);
  L.push(`program: ${p.path} (${p.fromVariable ? 'from GRIMOIRE_PRACTICE_PROGRAM' : 'from the path search'}), version ${one(p.version)}`);
  L.push(`skill under test: ${one(state.skills[0].title)}`);
  if (state.skills.length > 1) L.push(`companion skills: ${state.skills.slice(1).map(s => one(s.title)).join(', ')}`);
  L.push(`setup: ${state.setup ?? 'none'}`);
  L.push(`environment names: ${state.envNames.join(', ')}`);
  L.push(`test values: ${Object.keys(state.values).join(', ') || 'none'}`);
  L.push(`tool rules: ${state.rules.join('; ') || 'none'}`);
  // On a variant that loads user settings, the owner's own allow rules merge
  // into the posture, and the settings' environment values reach the session.
  // So the report shows the permission part, and never the environment part,
  // whose names it gives only where they would replace a test value.
  if (v.sources?.split(',').includes('user')) {
    const us = userSettings();
    const perms = us && Object.hasOwn(us, 'permissions') ? us.permissions : undefined;
    L.push(`user permission block, from ${join(configFolder(), 'settings.json')}:`);
    L.push(perms === undefined ? '  none' : JSON.stringify(perms, null, 2).split('\n').map(l => `  ${one(l)}`).join('\n'));
    const env = us && Object.hasOwn(us, 'env') && us.env !== null && typeof us.env === 'object' ? us.env : {};
    // Windows matches environment names without regard to case.
    const key = n => (process.platform === 'win32' ? n.toUpperCase() : n);
    const names = new Set(Object.keys(env).map(key));
    const collide = Object.keys(state.values).filter(name => names.has(key(name)));
    L.push(`user settings environment names that collide with a test value: ${collide.join(', ') || 'none'}`);
  }
  L.push(`turns: ${state.turns.length}`);
  const first = state.turns[0];
  for (const t of state.turns) {
    L.push(`turn ${t.n} session ${t.sessionId}${t.sessionId !== state.sessionId ? ' (CHANGED: not the run\'s session)' : ''}`);
    const list = (label, key) => {
      const now = t.startup[key].map(one);
      if (t === first) return L.push(`  ${label}: ${now.join(', ') || 'none'}`);
      const was = first.startup[key].map(one);
      const added = now.filter(x => !was.includes(x));
      const removed = was.filter(x => !now.includes(x));
      if (!added.length && !removed.length) return L.push(`  ${label}: same as turn 1`);
      L.push(`  ${label}: CHANGED from turn 1${added.length ? `, added ${added.join(', ')}` : ''}${removed.length ? `, removed ${removed.join(', ')}` : ''}`);
    };
    const single = (label, key) => {
      const now = one(t.startup[key]);
      if (t === first || now === one(first.startup[key])) return L.push(`  ${label}: ${now}`);
      L.push(`  ${label}: CHANGED from turn 1: ${now}`);
    };
    list('agents', 'agents');
    list('plugins', 'plugins');
    list('skills', 'skills');
    list('MCP servers', 'mcp');
    list('tools', 'tools');
    single('permission mode', 'permissionMode');
    single('API key source', 'apiKeySource');
    single('model', 'model');
    L.push(`  hook events: ${t.hookEvents}`);
    L.push(`  skills loaded: ${t.skillsLoaded.map(one).join(', ') || 'none'}`);
    L.push(`  permission denials: ${t.denials.length || 'none'}`);
    for (const d of t.denials) L.push(`    ${one(d.tool)} ${one(d.input).slice(0, 300)}`);
  }
  const manifest = manifestIfIntact(dir, state);
  L.push(manifest
    ? `backup manifest: sha256 ${state.manifest}, as start printed it`
    : `backup manifest: CHANGED since start, or gone; start printed sha256 ${state.manifest}, and the checks below cannot be trusted`);
  let copiedSummary = 'not checked';
  let liveSummary = 'not checked';
  let workStat = null;
  try { workStat = lstatSync(work); } catch { /* deleted at end */ }
  if (workStat?.isSymbolicLink()) {
    L.push('work folder files: the work folder is a link, not listed');
  } else if (workStat) {
    // A copied file the session left as it was is not listed; a changed one is.
    const was = manifest ? manifest.copied : [];
    const now = copiedHashes(work, state.skills);
    const changes = diffEntries(was, now);
    const unchanged = new Set(now.filter(([r, h]) => new Map(was).get(r) === h).map(([r]) => r));
    if (manifest) {
      copiedSummary = changes.length ? `changed (${changes.length})` : 'unchanged';
      L.push(changes.length ? 'copied skills changed since start:' : 'copied skills: unchanged since start');
      for (const c of changes) L.push(`  ${changeLine(c)}`);
    }
    const files = [];
    const temp = [];
    listFiles(work, (rel, link, unreadable) => {
      const r = forward(rel) + (link ? ' (a link, not followed)' : '') + (unreadable ? ' (unreadable)' : '');
      if (r === '.tmp' || r.startsWith('.tmp/')) { if (r !== '.tmp') temp.push(r.slice(5)); }
      else if (!unchanged.has(r)) files.push(r);
    });
    L.push('work folder files, without the unchanged copied skills:');
    for (const f of files) L.push(`  ${one(f)}`);
    if (!files.length) L.push('  none');
    L.push('temp folder files:');
    for (const f of temp) L.push(`  ${one(f)}`);
    if (!temp.length) L.push('  none');
  } else {
    L.push('work folder files: the work folder was deleted at end');
  }
  // Outside the work folder: the owner's live places.
  if (manifest) {
    const live = liveChanges(manifest);
    liveSummary = live.length ? `changed (${live.length})` : 'unchanged';
    L.push(live.length ? 'live folders changed since start:' : 'live folders: unchanged since start');
    for (const c of live) L.push(`  ${changeLine(c)}`);
    const skipped = notChecked(manifest);
    if (skipped.length) L.push(`live folders not checked: ${skipped.map(placeName).join(', ')}`);
    if (skipped.length) liveSummary += `, ${skipped.length} not checked`;
  }
  // The line for a results grid: runner-written fields only, never session text.
  const loaded = state.turns.filter(t => t.skillsLoaded.length).length;
  const denials = state.turns.reduce((n, t) => n + t.denials.length, 0);
  L.push(`summary: run ${state.id}; variant ${state.variant}; case ${state.case ?? 'none'}; model ${state.model}; effort ${state.effort} (requested); `
    + `turns ${state.turns.length}; turns with a skill loaded ${loaded}; denials ${denials}; `
    + `copied skills ${copiedSummary}; live folders ${liveSummary}; manifest sha256 ${state.manifest}`);
  // Session text was masked field by field above, so a session cannot hide a
  // runner line by planting a pattern that runs to the end of the text.
  const n = state.turns.reduce((k, t) => k + (Number.isSafeInteger(t.masked) ? t.masked : 0), 0) + maskCount;
  process.stdout.write(`${L.join('\n')}\n${masked(n)}`);
}

// Every file and link under a folder, never following a link. A link is listed
// as itself, because what it points at is outside the work folder.
function listFiles(root, visit, rel = '') {
  let names;
  try { names = readdirSync(join(root, rel)).sort(); } catch { visit(rel || '.', false, true); return; }
  for (const name of names) {
    const r = rel ? join(rel, name) : name;
    let st;
    try { st = lstatSync(join(root, r)); } catch { visit(r, false, true); continue; }
    if (st.isDirectory()) listFiles(root, visit, r);
    else visit(r, st.isSymbolicLink(), false);
  }
}

// The whole of an open file, from its start, whatever its handle's position.
function readAll(fd) {
  const size = fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  let got = 0;
  while (got < size) {
    const n = readSync(fd, buf, got, size - got, got);
    if (!n) break;
    got += n;
  }
  return buf.subarray(0, got).toString('utf8');
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const save = (dir, state) => {
  plainFile(join(dir, STATE));
  writeFileSync(join(dir, STATE), JSON.stringify(state, null, 2));
};

// The session ran, but the turn did not complete. Not a refusal: something was
// sent, and the evidence is on disk.
class Failure extends Error {}
const fail = msg => { throw new Failure(msg); };

// ---- end ----

// Deletes the work folder, so no copy of the skill under test stays where a
// later session could load it. The run directory, with the record and the
// transcript, stays until the tester deletes it.
function end(argv) {
  const { dir, work, state } = openRun(argv, 'end');
  if (state.ended) refuse(`run ${state.id} already ended at ${state.ended}`);
  const left = existsSync(work) ? remove(work) : 0;
  if (left || existsSync(work)) fail(`end could not delete ${left || 'every'} entr${left === 1 ? 'y' : 'ies'} in ${work}; the run is not ended`);
  state.ended = new Date().toISOString();
  save(dir, state);
  process.stderr.write(`ended run ${state.id}; the record stays in ${dir}\n`);
  // The backups go only when the live folders show no change since start, so
  // a change can still be undone from them.
  const backup = join(dir, 'backup');
  const manifest = manifestIfIntact(dir, state);
  if (!manifest) {
    process.stderr.write(`kept the backups in ${backup}: the manifest changed since start, so the live folders could not be checked\n`);
  } else if (liveChanges(manifest).length) {
    process.stderr.write(`kept the backups in ${backup}: the live folders changed since start; see report\n`);
  } else {
    const kept = remove(backup);
    if (kept) fail(`the run ended, but ${kept} backup entr${kept === 1 ? 'y' : 'ies'} in ${backup} could not be deleted`);
    const skipped = notChecked(manifest);
    process.stderr.write(`deleted the backups: the live folders did not change since start${skipped.length ? `; not checked: ${skipped.map(placeName).join(', ')}` : ''}\n`);
  }
}

// Removes a tree without following links: a link is removed as itself, and
// what it points at is never entered. Returns how many entries it could not
// remove, rather than stopping at the first.
function remove(path) {
  let st;
  try { st = lstatSync(path); } catch { return 0; }
  let left = 0;
  if (st.isDirectory()) {
    let names = [];
    try { names = readdirSync(path); } catch { return 1; }
    for (const name of names) left += remove(join(path, name));
    try { rmdirSync(path); } catch { left += 1; }
    return left;
  }
  try {
    unlinkSync(path);
  } catch {
    // A link to a folder on Windows is removed as a folder, which removes the
    // link and not its target.
    try { if (st.isSymbolicLink()) rmdirSync(path); else return 1; } catch { return 1; }
  }
  return 0;
}

// ---- main ----

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'start') start(rest);
  else if (command === 'send') send(rest);
  else if (command === 'report') report(rest);
  else if (command === 'end') end(rest);
  else refuse('usage: practice.mjs start|send|report|end ...');
} catch (e) {
  if (e instanceof Failure) {
    process.stderr.write(mask(`practice: ${e.message}\n`));
    process.exit(2);
  }
  if (!(e instanceof Refusal)) throw e;
  process.stderr.write(mask(`practice: refused: ${e.message}\n`));
  process.exit(1);
}
