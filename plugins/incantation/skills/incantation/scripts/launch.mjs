// The engine launcher (docs/spec/incantation.md, S4.1 a). A Node script with no
// dependencies.
//
//   node launch.mjs run     starts both speech engines on sockets, in the foreground
//   node launch.mjs start   the same, detached, outliving the session
//   node launch.mjs stop    stops the engines it started
//
// It runs each engine's program from where VoiceMode installed it, listening on
// a socket in ~/.incantation/run/ and on no TCP port. It reads VoiceMode's
// installed start script for each engine as data, never runs it, takes the
// server's command line and exports from it, and swaps the host and port for
// the socket. It edits no file VoiceMode installed. It reads only
// ~/.voicemode/voicemode.env and fixed paths under the person's home, never the
// environment, and refuses when a project-level VoiceMode settings file is
// found from the folder it was started in. Every line it prints is fixed text.

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { connect } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOCKETS, findProjectEnv, readGlobalSettings, runDir } from './lib.mjs';

export const KNOBS = {
  restartsPerMinute: 3, // an engine that exits more often than this is stopped
  restartDelayMs: 2000,
};

// The engines, as VoiceMode installs them (v9.0.2). Where each is installed,
// which start script holds the server's command line, and how the socket
// replaces the host and port: whisper.cpp's server takes `--host <path>.sock`,
// and kokoro's uvicorn takes `--uds <path>`.
const ENGINES = {
  stt: { dir: ['.voicemode', 'services', 'whisper'], scripts: () => ['bin/start-whisper-server.sh'], socketFlag: 'host', extraEnv: {} },
  tts: {
    dir: ['.voicemode', 'services', 'kokoro'],
    scripts: gpu => (gpu ? ['start-gpu.sh'] : ['start-cpu.sh']),
    socketFlag: 'uds',
    // The web player and cross-origin access are off by construction (S4.1 b).
    extraEnv: { ENABLE_WEB_PLAYER: 'false', CORS_ENABLED: 'false' },
  },
};
const PATH_FOR_ENGINES = (home) => `${join(home, '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin`;
const GPU_PROBES = ['/usr/lib/wsl/lib/nvidia-smi', '/usr/bin/nvidia-smi'];

class Refusal extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const refuse = reason => {
  throw new Refusal(reason);
};

// Reading a start script as data.

// Where a `$( … )` that opens at index i ends: the index after its closing
// parenthesis, counting nested ones and ignoring any inside quotes. -1 when it
// never closes.
function substEnd(s, i) {
  let depth = 1;
  let quote = null;
  for (let k = i + 2; k < s.length; k++) {
    const c = s[k];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') k++;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return k + 1;
  }
  return -1;
}

// One word of shell, expanded with the known variables and nothing else.
// Unknown variables and unknown command substitutions throw: nothing is run to
// find out a value.
function expand(text, vars, ctx) {
  let out = '';
  let i = 0;
  let quote = null;
  const lookup = name => {
    if (!Object.hasOwn(vars, name) || vars[name] === undefined) throw new Error('unknown');
    return vars[name];
  };
  while (i < text.length) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else out += c;
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
      i++;
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
      i++;
    } else if (c === '\\') {
      out += text[i + 1] ?? '';
      i += 2;
    } else if (c === '`') {
      throw new Error('unknown');
    } else if (c === '$' && text[i + 1] === '(') {
      const j = substEnd(text, i);
      if (j < 0) throw new Error('unknown');
      out += substitute(text.slice(i + 2, j - 1).trim(), vars, ctx);
      i = j;
    } else if (c === '$' && text[i + 1] === '{') {
      const j = text.indexOf('}', i);
      if (j < 0) throw new Error('unknown');
      const inner = text.slice(i + 2, j);
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/s.exec(inner);
      if (!m) throw new Error('unknown');
      const value = Object.hasOwn(vars, m[1]) ? vars[m[1]] : undefined;
      out += value !== undefined && value !== '' ? value : m[2] !== undefined ? expand(m[2], vars, ctx) : lookup(m[1]);
      i = j + 1;
    } else if (c === '$' && /[A-Za-z_]/.test(text[i + 1] ?? '')) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1));
      out += lookup(m[0]);
      i += 1 + m[0].length;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The few command substitutions the installed scripts use, and no others.
function substitute(command, vars, ctx) {
  if (command === 'pwd') return ctx.cwd;
  if (command === 'cd "$(dirname "${BASH_SOURCE[0]}")" && pwd') return ctx.scriptDir;
  let m = /^dirname\s+(.+)$/s.exec(command);
  if (m) return dirname(expand(m[1], vars, ctx));
  if (/\b(nproc|sysctl)\b/.test(command)) return String(availableParallelism());
  throw new Error('unknown');
}

// The words of a command line, split on unquoted spaces and stopped at the
// first unquoted `&`, `;`, `|`, `>` or `<`.
function words(line) {
  const out = [];
  let current = '';
  let started = false;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '$' && line[i + 1] === '(' && quote !== "'") {
      const end = substEnd(line, i);
      if (end < 0) return [...out, current + line.slice(i)];
      current += line.slice(i, end);
      started = true;
      i = end - 1;
      continue;
    }
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') current += line[++i] ?? '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      started = true;
    } else if (c === '\\') {
      current += c + (line[++i] ?? '');
      started = true;
    } else if (/\s/.test(c)) {
      if (started) out.push(current);
      current = '';
      started = false;
    } else if ('&;|<>'.includes(c)) {
      break;
    } else {
      current += c;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

// What a start script says: its top-level assignments and exports (lines that
// do not start with a space), in order, and the server's command line, the
// first top-level line that carries `--host`.
export function readStartScript(text, vars, ctx) {
  const lines = text.replace(/\\\r?\n/g, ' ').split('\n');
  const known = { ...vars };
  const exports = {};
  let command = null;
  for (const line of lines) {
    if (!line || /^\s/.test(line) || line.startsWith('#')) continue;
    const m = /^(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(line);
    if (m) {
      try {
        const value = expand(words(m[3])[0] ?? '', known, ctx);
        known[m[2]] = value;
        if (m[1]) exports[m[2]] = value;
      } catch {
        // A value that cannot be known here is left unset; a use of it fails later.
      }
      continue;
    }
    if (command === null && /\s--host[\s=]/.test(line)) command = words(line.replace(/^exec\s+/, ''));
  }
  return { command, known, exports };
}

// The command with the socket in place of the host and port.
function withSocket(tokens, flag, socket) {
  const out = [];
  let placed = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--host' || t === '--port') {
      if (t === '--host' && flag === 'host') {
        out.push('--host', socket);
        placed = true;
      }
      i++;
    } else if (t.startsWith('--host=') || t.startsWith('--port=')) {
      if (t.startsWith('--host=') && flag === 'host') {
        out.push(`--host=${socket}`);
        placed = true;
      }
    } else out.push(t);
  }
  if (flag === 'uds') out.push('--uds', socket);
  else if (!placed) refuse('arguments');
  return out;
}

const closedFile = path => {
  const st = lstatSync(path);
  return st.isFile() && (st.mode & 0o022) === 0 && (st.mode & 0o100) !== 0;
};

// Everything needed to run one engine, or a refusal.
function planEngine(name, { home, vars, run, gpu, uvCandidates }) {
  const spec = ENGINES[name];
  const dir = join(home, ...spec.dir);
  let found = null;
  for (const rel of spec.scripts(gpu)) if (existsSync(join(dir, rel))) found = join(dir, rel);
  if (!found) refuse(`${name} script`);
  let text;
  try {
    text = readFileSync(found, 'utf8');
  } catch {
    return refuse(`${name} script`);
  }
  const ctx = { cwd: dir, scriptDir: dirname(found) };
  const fallbacks = {};
  if (name === 'stt') {
    const root = dirname(dirname(found));
    fallbacks.SERVER_BIN = [join(root, 'build', 'bin', 'whisper-server'), join(root, 'server')].find(p => existsSync(p));
    fallbacks.WHISPER_THREADS = vars.VOICEMODE_WHISPER_THREADS || String(availableParallelism());
  }
  const base = { HOME: home, ...vars };
  let script;
  try {
    script = readStartScript(text, { ...fallbacks, ...base }, ctx);
  } catch {
    return refuse(`${name} arguments`);
  }
  if (!script.command) refuse(`${name} arguments`);
  const socket = join(run, SOCKETS[name]);
  let tokens;
  try {
    tokens = withSocket(script.command.map(w => expand(w, script.known, ctx)), spec.socketFlag, socket);
  } catch {
    return refuse(`${name} arguments`);
  }
  let program = tokens.shift();
  if (program === 'uv') program = uvCandidates.find(p => existsSync(p));
  if (!program || !isAbsolute(program)) refuse(`${name} program`);
  try {
    if (!closedFile(program)) refuse(`${name} program`);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse(`${name} program`);
  }
  if (name === 'stt') {
    const model = tokens[tokens.indexOf('--model') + 1];
    if (!model || !existsSync(model)) refuse('stt arguments');
  }
  const env = { HOME: home, PATH: PATH_FOR_ENGINES(home), LANG: 'C', ...script.exports, ...spec.extraEnv };
  return { name, program, args: tokens, cwd: dir, env, socket };
}

const accepts = path => new Promise(r => {
  const s = connect(path);
  s.once('connect', () => (s.destroy(), r(true)));
  s.once('error', () => r(false));
});

const procStart = pid => {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
};

// Start both engines on their sockets and keep them running. Resolves
// { status, stop, done }; rejects { reason } when it cannot start.
export async function startLaunch({ home, projectDir, knobs, gpu, uvCandidates } = {}) {
  const k = { ...KNOBS, ...knobs };
  if (typeof home !== 'string' || !home) refuse('settings');
  const run = runDir(home);
  if (projectDir !== undefined && findProjectEnv(projectDir, home)) refuse('project settings');
  let settings;
  try {
    settings = readGlobalSettings(home);
  } catch {
    return refuse('settings');
  }
  const vars = Object.fromEntries(settings);
  const useGpu = gpu ?? GPU_PROBES.some(p => existsSync(p));
  const uv = uvCandidates ?? [join(home, '.local', 'bin', 'uv'), '/usr/local/bin/uv', '/usr/bin/uv'];
  const plans = ['stt', 'tts'].map(name => planEngine(name, { home, vars, run, gpu: useGpu, uvCandidates: uv }));

  mkdirSync(run, { recursive: true, mode: 0o700 });
  chmodSync(dirname(run), 0o700);
  chmodSync(run, 0o700);
  for (const plan of plans) {
    if (existsSync(plan.socket)) {
      if (await accepts(plan.socket)) refuse('running');
      rmSync(plan.socket, { force: true });
    }
  }

  const state = Object.fromEntries(plans.map(p => [p.name, { pid: null, start: null, state: 'starting', exits: [] }]));
  let stopping = false;
  const children = new Map();
  let resolveDone;
  const done = new Promise(r => (resolveDone = r));

  const writePids = () => {
    const engines = {};
    for (const p of plans) engines[p.name] = { pid: state[p.name].pid, start: state[p.name].start, program: basename(p.program) };
    writeFileSync(join(run, 'launch.pid'), JSON.stringify({ supervisor: process.pid, engines }), { mode: 0o600 });
  };

  const spawnEngine = plan => {
    const child = spawn(plan.program, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'ignore', windowsHide: true });
    children.set(plan.name, child);
    state[plan.name].pid = child.pid;
    state[plan.name].start = procStart(child.pid);
    state[plan.name].state = 'running';
    child.on('error', () => {});
    child.on('exit', async () => {
      children.delete(plan.name);
      if (stopping) return;
      const now = Date.now();
      const s = state[plan.name];
      s.exits = s.exits.filter(t => now - t < 60_000);
      s.exits.push(now);
      if (s.exits.length > k.restartsPerMinute) {
        s.state = 'stopped';
        s.pid = null;
        writePids();
        return;
      }
      s.state = 'restarting';
      await new Promise(r => setTimeout(r, k.restartDelayMs));
      if (stopping) return;
      if (existsSync(plan.socket) && !(await accepts(plan.socket))) rmSync(plan.socket, { force: true });
      spawnEngine(plan);
      writePids();
    });
  };
  for (const plan of plans) spawnEngine(plan);
  writePids();

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const child of children.values()) child.kill('SIGTERM');
    await Promise.all([...children.values()].map(c => new Promise(r => (c.exitCode !== null || c.signalCode !== null ? r() : c.once('exit', r)))));
    for (const plan of plans) rmSync(plan.socket, { force: true });
    try {
      if (JSON.parse(readFileSync(join(run, 'launch.pid'), 'utf8')).supervisor === process.pid) rmSync(join(run, 'launch.pid'), { force: true });
    } catch {
      // already gone
    }
    resolveDone('stopped');
  };
  return { status: () => Object.fromEntries(Object.entries(state).map(([n, s]) => [n, { state: s.state, pid: s.pid }])), stop, done };
}

const alive = pid => {
  try {
    process.kill(pid, 0);
    return !/^\d+ \([^)]*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
};

// Stop what a launcher started: its own pid, and each engine it recorded, each
// only after checking that it is the process that was recorded and is the
// person's. Returns the number of processes signalled.
export function stopLaunch({ home }) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(runDir(home), 'launch.pid'), 'utf8'));
  } catch {
    return 0;
  }
  const mine = pid => {
    try {
      return statSync(`/proc/${pid}`).uid === process.getuid();
    } catch {
      return false;
    }
  };
  const cmdline = pid => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    } catch {
      return [];
    }
  };
  let signalled = 0;
  const supervisor = record.supervisor;
  if (Number.isInteger(supervisor) && supervisor > 1 && mine(supervisor) && cmdline(supervisor).some(p => /(^|[\\/])launch\.mjs$/.test(p))) {
    process.kill(supervisor, 'SIGTERM');
    signalled++;
  }
  for (const e of Object.values(record.engines ?? {})) {
    if (!Number.isInteger(e?.pid) || e.pid < 2 || !mine(e.pid)) continue;
    if (!e.start || procStart(e.pid) !== e.start) continue;
    if (!cmdline(e.pid).some(p => basename(p) === e.program)) continue;
    process.kill(e.pid, 'SIGTERM');
    signalled++;
  }
  return signalled;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const KNOWN = new Set(['project settings', 'running', 'settings', 'stt script', 'tts script', 'stt arguments', 'tts arguments', 'stt program', 'tts program']);

async function main(argv) {
  const home = homedir();
  const say = text => process.stdout.write(`${text}\n`);
  const command = argv[2];
  if (command === 'run') {
    let launch;
    try {
      launch = await startLaunch({ home, projectDir: process.cwd() });
    } catch (e) {
      return say(`launch error: ${KNOWN.has(e?.reason) ? e.reason : 'failed'}`), 1;
    }
    const end = () => launch.stop();
    process.on('SIGTERM', end);
    process.on('SIGINT', end);
    await launch.done;
    return 0;
  }
  if (command === 'start') {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], cwd: process.cwd(), env: { HOME: home, PATH: process.env.PATH ?? '' } });
    let line = '';
    let exited = false;
    child.stdout.on('data', d => (line += d));
    child.on('exit', () => (exited = true));
    for (let i = 0; i < 60 && !exited; i++) {
      await sleep(50);
      try {
        const rec = JSON.parse(readFileSync(join(runDir(home), 'launch.pid'), 'utf8'));
        if (rec.supervisor === child.pid) {
          child.stdout.destroy();
          child.unref();
          return say('launch started'), 0;
        }
      } catch {
        // not yet
      }
    }
    await sleep(50);
    return say(line.trim() || 'launch error: failed'), 1;
  }
  if (command === 'stop') {
    const n = stopLaunch({ home });
    if (!n) return say('launch: not running'), 0;
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      let record;
      try {
        record = JSON.parse(readFileSync(join(runDir(home), 'launch.pid'), 'utf8'));
      } catch {
        break;
      }
      if (![record.supervisor, ...Object.values(record.engines ?? {}).map(e => e?.pid)].some(p => Number.isInteger(p) && alive(p))) break;
    }
    return say('launch stopped'), 0;
  }
  say('usage: launch.mjs run | start | stop');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv);
  process.exit(code);
}
