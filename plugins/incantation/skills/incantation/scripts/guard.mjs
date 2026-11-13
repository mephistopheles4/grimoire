// The guard: checks that the speech setup is local only before Incantation
// speaks (docs/spec/incantation.md, S4.1 d). A Node script with no
// dependencies. It prints one line on stdout, `ok` or the first failure, and
// exits 0 only on `ok`. Every line is fixed text: nothing it prints holds an
// address, a path or a setting's value, and an error it did not expect prints
// a fixed line, never the error. It finishes within 2 s.
//
//   node guard.mjs <the folder Claude Code started in>
//
// The command line reads no override. Tests call runGuard with their own home
// folder, addresses and version reader.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOCKETS, findProjectEnv, keyedHash, loopbackPorts, readBuffer, readGlobalSettings, readText, runDir } from './lib.mjs';

// The VoiceMode versions this guard was checked against. README step 1 names
// the same ones.
const CHECKED_VERSIONS = ['9.0.2'];
const SERVE_PORT = 8765;
const CONNECT_MS = 500;
const DEADLINE_MS = 1800;
const GENERIC = 'guard error: see README step 3';

class Fail extends Error {
  constructor(line) {
    super('guard');
    this.line = line;
  }
}
const fail = line => {
  throw new Fail(line);
};

// Settings, read as VoiceMode reads them: the process environment, then the
// global file; the first source to set a key wins.

const SPEECH_URLS = ['VOICEMODE_TTS_BASE_URLS', 'VOICEMODE_STT_BASE_URLS'];
const serverEnvKey = k => /^(?:VOICEMODE_|VOICE_MODE_)/.test(k);
const TRUE = new Set(['true', '1', 'yes', 'on']);

function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
  return parsed;
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Does an MCP server entry provide VoiceMode's converse tool? By its name, or
// by what it runs.
function providesVoiceMode(name, entry) {
  if (!isObject(entry)) return false;
  const runs = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].filter(s => typeof s === 'string').join(' ');
  return /voice-?mode/i.test(name) || /voice-?mode/i.test(runs);
}

// The key names, never the values, of the env block of each MCP server entry
// that provides converse, in the user, local, project and plugin configs.
function mcpEnvKeys(home, projectDir) {
  const servers = [];
  const take = map => {
    if (isObject(map)) for (const [name, entry] of Object.entries(map)) servers.push([name, entry]);
  };
  const user = readJson(join(home, '.claude.json'));
  if (user) {
    take(user.mcpServers);
    if (isObject(user.projects) && isObject(user.projects[projectDir])) take(user.projects[projectDir].mcpServers);
  }
  const project = readJson(join(projectDir, '.mcp.json'));
  if (project) take(project.mcpServers);
  const installed = readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (installed && isObject(installed.plugins)) {
    for (const [plugin, installs] of Object.entries(installed.plugins)) {
      if (!/voice-?mode/i.test(plugin) || !Array.isArray(installs)) continue;
      for (const one of installs) {
        if (!isObject(one) || typeof one.installPath !== 'string') continue;
        const manifest = readJson(join(one.installPath, '.claude-plugin', 'plugin.json'));
        if (manifest) take(manifest.mcpServers);
        const mcp = readJson(join(one.installPath, '.mcp.json'));
        if (mcp) take(mcp.mcpServers ?? mcp);
      }
    }
  }
  return servers.filter(([name, entry]) => providesVoiceMode(name, entry)).flatMap(([, entry]) => (isObject(entry.env) ? Object.keys(entry.env) : []));
}

// Every hook command in a Claude Code settings file, as text.
function hookCommands(settings) {
  const out = [];
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      if (typeof v.command === 'string') out.push(v.command);
      Object.values(v).forEach(walk);
    }
  };
  if (isObject(settings.hooks)) walk(settings.hooks);
  return out;
}

// The version of VoiceMode on the machine, or null. It looks for the dist-info
// folder of the package that `uv tool install` puts in a tool environment; any
// other way VoiceMode was installed reads as null, which fails closed.
function installedVersion(home) {
  const lib = join(home, '.local', 'share', 'uv', 'tools', 'voice-mode', 'lib');
  for (const py of readdirSync(lib)) {
    if (!/^python3(?:\.\d+)?$/.test(py)) continue;
    for (const entry of readdirSync(join(lib, py, 'site-packages'))) {
      const m = /^voice_mode-(\d+\.\d+\.\d+)\.dist-info$/.exec(entry);
      if (m) return m[1];
    }
  }
  return null;
}

// Network helpers. Each answers in at most CONNECT_MS or a little more.

function tcpOpen(host, port) {
  return new Promise(resolve => {
    const s = connect({ host, port, timeout: CONNECT_MS });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

// One request, answered with { status, body } or null. The body is cut at 4 KB.
function ask({ host, port, socketPath, path, headers = {} }) {
  return new Promise(resolve => {
    const options = { path, method: 'GET', headers: { connection: 'close', ...headers }, agent: false, timeout: CONNECT_MS };
    if (socketPath) options.socketPath = socketPath;
    else Object.assign(options, { host, port });
    const req = request(options, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size <= 4096) chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => resolve(null));
    });
    req.once('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.once('error', () => resolve(null));
    req.end();
  });
}

const linkLocal = a => /^169\.254\./.test(a) || /^fe[89ab][0-9a-f]:/i.test(a);

function externalAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal) out.push({ address: a.address, family: a.family === 4 || a.family === 'IPv4' ? 'IPv4' : 'IPv6' });
  }
  return out;
}

// The user ids that own a listening socket on a port, read from /proc.
function listenerUids(port) {
  const uids = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const row of text.split('\n').slice(1)) {
      const f = row.trim().split(/\s+/);
      if (f.length < 8 || f[3] !== '0A') continue;
      if (parseInt(f[1].split(':')[1], 16) === port) uids.push(Number(f[7]));
    }
  }
  return uids;
}

const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function check(o) {
  const { home } = o;
  if (typeof home !== 'string' || !home) throw new Error('no home');
  const env = o.env ?? process.env;
  const projectDir = typeof o.projectDir === 'string' && o.projectDir ? o.projectDir : process.cwd();
  const uid = o.uid ?? process.getuid?.();
  const servePort = o.servePort ?? SERVE_PORT;
  const addresses = (o.addresses ?? externalAddresses()).filter(a => !linkLocal(a.address));

  // Settings. The three Claude Code settings files are read once: for the
  // env block's key names, and for the heard hook below.
  const claudeFiles = [join(home, '.claude', 'settings.json'), join(projectDir, '.claude', 'settings.json'), join(projectDir, '.claude', 'settings.local.json')].map(readJson);
  const moveEnv = 'server env: move VoiceMode settings to the global file, see README step 4';
  if (mcpEnvKeys(home, projectDir).some(serverEnvKey)) fail(moveEnv);
  for (const s of claudeFiles) if (s && isObject(s.env) && Object.keys(s.env).some(k => serverEnvKey(k) || k === 'HOME')) fail(moveEnv);

  for (const name of SPEECH_URLS) {
    if (Object.hasOwn(env, name)) fail(`remote ${name}: move it to the global file, see README step 4`);
  }
  const project = findProjectEnv(projectDir, home);
  if (project) fail(`project ${project.kind}: move VoiceMode settings to the global file, see README step 4`);

  const global = readGlobalSettings(home);
  const get = key => (Object.hasOwn(env, key) ? env[key] : global.get(key));
  const loopbackOnly = name => `remote ${name}: set it to the loopback URL only, see README step 4`;
  const urlPorts = {};
  for (const [service, name] of [['tts', 'VOICEMODE_TTS_BASE_URLS'], ['stt', 'VOICEMODE_STT_BASE_URLS']]) {
    urlPorts[service] = loopbackPorts(get(name));
    if (!urlPorts[service]) fail(loopbackOnly(name));
  }
  for (const name of ['VOICEMODE_MCP_URL', 'VOICEMODE_MLX_AUDIO_BASE_URL']) {
    if (get(name) !== undefined) fail(loopbackOnly(name));
  }
  const autoStart = 'auto-start: turn it off, see README step 4';
  for (const name of ['VOICEMODE_AUTO_START_KOKORO', 'VOICE_MODE_AUTO_START_KOKORO']) {
    if (TRUE.has(String(get(name) ?? '').trim().toLowerCase())) fail(autoStart);
  }
  if (String(get('VOICEMODE_SERVICE_AUTO_ENABLE') ?? '').trim().toLowerCase() !== 'false') fail(autoStart);

  const voices = get('VOICEMODE_VOICES');
  if (voices !== undefined) {
    const first = voices.split(',').map(s => s.trim()).filter(Boolean)[0];
    if (first !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(first)) fail('voice: see README step 4');
  }

  let version = null;
  try {
    version = await (o.readVersion ?? (() => installedVersion(home)))();
  } catch {
    version = null;
  }
  if (!CHECKED_VERSIONS.includes(version)) fail('voicemode version: see README step 1');

  for (const s of claudeFiles) if (s && hookCommands(s).some(c => /voicemode-heard-hook/i.test(c))) fail('heard hook: remove it, see README step 4');

  // Ports: the speech URLs' ports, which the proxy binds, the engines' service
  // ports, and the serve port.
  const portOf = (name, fallback) => {
    const v = get(name);
    if (v === undefined || v === '') return fallback;
    if (!/^[0-9]{1,5}$/.test(v.trim()) || Number(v) < 1 || Number(v) > 65535) throw new Error('port');
    return Number(v);
  };
  const proxyPorts = [['stt', urlPorts.stt[0]], ['tts', urlPorts.tts[0]]];
  const extra = [];
  for (const [service, port] of [['stt', portOf('VOICEMODE_WHISPER_PORT', 2022)], ['tts', portOf('VOICEMODE_KOKORO_PORT', 8880)], ...Object.entries(urlPorts).flatMap(([s, ps]) => ps.slice(1).map(p => [s, p]))]) {
    if (!proxyPorts.some(([, p]) => p === port) && !extra.some(([, p]) => p === port)) extra.push([service, port]);
  }
  const all = [...proxyPorts, ...extra, ['serve', servePort]];
  const exposed = (service, port) => `exposed ${service} ${port}: see README step 3`;

  // Reach: from this machine to its own addresses, a connect that succeeds is
  // exposed. All of them at once.
  const reach = await Promise.all(all.flatMap(([service, port]) => addresses.map(async a => ((await tcpOpen(a.address, port)) ? exposed(service, port) : null))));
  const wide = reach.find(Boolean);
  if (wide) fail(wide);

  // Only through the proxy, on loopback. Everything is started at once and read
  // in order afterwards.
  const token = readBuffer(join(runDir(home), 'token'));
  const nonceFor = () => randomBytes(16).toString('hex');
  const probes = Promise.all(
    proxyPorts.map(async ([service, port]) => {
      const nonce = nonceFor();
      const [health, host, origin, path, six] = await Promise.all([
        ask({ host: '127.0.0.1', port, path: `/health?nonce=${nonce}` }),
        ask({ host: '127.0.0.1', port, path: '/health', headers: { host: 'incantation.invalid' } }),
        ask({ host: '127.0.0.1', port, path: '/health', headers: { origin: 'http://incantation.invalid' } }),
        ask({ host: '127.0.0.1', port, path: '/incantation-unlisted' }),
        tcpOpen('::1', port),
      ]);
      let answer = null;
      try {
        answer = health && health.status === 200 ? JSON.parse(health.body) : null;
      } catch {
        answer = null;
      }
      const proved = token !== null && isObject(answer) && sameText(answer.proof, keyedHash(token, nonce));
      return { service, port, proved, answer, refused: [host, origin, path].every(r => r && r.status === 403), six };
    }),
  );
  const [probed, extras, serving] = await Promise.all([probes, Promise.all(extra.map(async ([service, port]) => ((await tcpOpen('127.0.0.1', port)) ? exposed(service, port) : null))), tcpOpen('127.0.0.1', servePort)]);
  const answered = extras.find(Boolean);
  if (answered) fail(answered);
  for (const p of probed) {
    const owners = listenerUids(p.port);
    if (!p.proved || owners.length === 0 || owners.some(u => u !== uid)) fail(`no proxy ${p.service} ${p.port}: see README step 3`);
    if (!p.refused) fail(`proxy open ${p.service} ${p.port}: see README step 3`);
    if (p.six) fail(exposed(p.service, p.port));
  }
  if (serving) fail('serve running: see README step 6');

  // Each engine's socket: in the run folder, which is the person's and closed
  // to everyone else, a socket the person owns that accepts, and named as a
  // socket upstream by the proxy.
  const run = runDir(home);
  const stat = path => {
    try {
      return lstatSync(path);
    } catch {
      return null;
    }
  };
  const folder = stat(run);
  const folderOk = folder && folder.isDirectory() && (folder.mode & 0o777) === 0o700 && folder.uid === uid;
  for (const [service] of proxyPorts) {
    const path = join(run, SOCKETS[service]);
    const st = folderOk ? stat(path) : null;
    const upstream = probed.find(p => p.service === service).answer?.upstream;
    const kind = isObject(upstream) ? upstream : {};
    const bothSocket = kind.stt === 'socket' && kind.tts === 'socket';
    if (!st || !st.isSocket() || st.uid !== uid || !bothSocket || !(await socketAccepts(path))) fail(`socket ${service}: see README step 3`);
  }

  // The text-to-speech engine's web player: through its socket, its page must
  // not be served.
  for (const path of ['/web/', '/web']) {
    const r = await ask({ socketPath: join(run, SOCKETS.tts), path, headers: { host: 'localhost' } });
    if (r && r.status >= 200 && r.status < 400) fail('tts scope: see README step 3');
  }
  return 'ok';
}

function socketAccepts(path) {
  return new Promise(resolve => {
    const s = connect({ path, timeout: CONNECT_MS });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

// The whole guard: one fixed line, whatever happens, inside the deadline.
export async function runGuard(options = {}) {
  let timer;
  const late = new Promise(resolve => {
    timer = setTimeout(() => resolve(GENERIC), DEADLINE_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([check(options), late]);
  } catch (e) {
    return e instanceof Fail ? e.line : GENERIC;
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const line = await runGuard({ home: homedir(), env: process.env, projectDir: process.argv[2] });
  process.stdout.write(`${line}\n`, () => process.exit(line === 'ok' ? 0 : 1));
}
