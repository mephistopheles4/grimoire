// The proxy: a loopback reverse proxy in front of both speech engines
// (docs/spec/incantation.md, S4.2). A Node script with no dependencies.
//
//   node proxy.mjs run     in the foreground, until a signal
//   node proxy.mjs start   detached, outliving the session
//   node proxy.mjs stop    signals the running proxy, after checking its pid
//
// It reads its ports from the global VoiceMode settings and its sockets from
// ~/.incantation/run, never from the working folder or the environment. It
// logs nothing: every line it prints is fixed text, and a refusal is counted,
// not recorded.

import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOCKETS, keyedHash, loopbackPorts, readGlobalSettings, runDir } from './lib.mjs';

const MAX_BODY = 25 * 1024 * 1024;
const REFUSED = 'refused';

// The speech API VoiceMode calls, by engine: method and exact raw path.
const ALLOWED = {
  stt: new Set(['POST /v1/audio/transcriptions']),
  tts: new Set(['POST /v1/audio/speech', 'GET /v1/audio/voices', 'GET /v1/models']),
};
const FORWARD = ['content-type', 'content-length', 'accept', 'accept-encoding', 'user-agent'];
const DROP_BACK = new Set(['connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'upgrade', 'proxy-authenticate']);

function fail(message) {
  throw new Error(message);
}

// The proxy for one home folder. `upstreams` is for tests: engine socket paths
// by service. Resolves to { addresses, close } once both ports are listening
// and the token and pid file are written; rejects, touching nothing of a
// running proxy's, when it cannot start.
export async function startProxy({ home, upstreams } = {}) {
  if (typeof home !== 'string' || !home) fail('settings');
  const run = runDir(home);
  const settings = readGlobalSettings(home);
  const ports = {};
  for (const [service, name] of [['stt', 'VOICEMODE_STT_BASE_URLS'], ['tts', 'VOICEMODE_TTS_BASE_URLS']]) {
    const found = loopbackPorts(settings.get(name));
    if (!found) fail('settings');
    ports[service] = found[0];
  }
  if (ports.stt === ports.tts) fail('settings');
  const sockets = {};
  for (const service of ['stt', 'tts']) {
    const path = upstreams?.[service] ?? join(run, SOCKETS[service]);
    if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.sock')) fail('tcp upstream');
    sockets[service] = path;
  }

  const token = randomBytes(32);
  let refused = 0;
  const live = new Set();

  const refuse = (res) => {
    refused++;
    res.writeHead(403, { 'content-type': 'text/plain', 'content-length': REFUSED.length, connection: 'close', 'x-content-type-options': 'nosniff' });
    res.end(REFUSED);
  };
  const refuseRaw = (socket) => {
    refused++;
    socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${REFUSED.length}\r\nconnection: close\r\n\r\n${REFUSED}`);
  };

  function handler(service, port) {
    const host = [`127.0.0.1:${port}`, `localhost:${port}`];
    const origins = host.map(h => `http://${h}`);
    return (req, res) => {
      const h = req.headers;
      const target = req.url;
      const bare = target.split('?')[0];
      const health = bare === '/health' && req.method === 'GET';
      if (!host.includes(h.host)) return refuse(res);
      if (h.origin !== undefined && !origins.includes(h.origin)) return refuse(res);
      if (h['sec-fetch-site'] === 'cross-site' || h['sec-fetch-site'] === 'same-site') return refuse(res);
      if (h.upgrade !== undefined || h['transfer-encoding'] !== undefined) return refuse(res);
      if (typeof target !== 'string' || !target.startsWith('/') || /%|\/\/|\/\.{1,2}(\/|$)/.test(bare)) return refuse(res);

      if (health) {
        let nonce;
        if (target !== '/health') {
          const m = /^\/health\?nonce=([A-Za-z0-9]{1,64})$/.exec(target);
          if (!m) return refuse(res);
          nonce = m[1];
        }
        const body = JSON.stringify({ upstream: { stt: 'socket', tts: 'socket' }, refused, ...(nonce ? { proof: keyedHash(token, nonce) } : {}) });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }

      if (!ALLOWED[service].has(`${req.method} ${target}`)) return refuse(res);
      const length = h['content-length'];
      if (req.method === 'POST') {
        if (typeof length !== 'string' || !/^[0-9]{1,9}$/.test(length) || Number(length) > MAX_BODY) return refuse(res);
      } else if (length !== undefined && length !== '0') {
        return refuse(res);
      }

      const headers = { host: 'localhost' };
      for (const name of FORWARD) if (h[name] !== undefined) headers[name] = h[name];
      const up = request({ socketPath: sockets[service], path: target, method: req.method, headers, agent: false }, back => {
        const out = {};
        for (const [k, v] of Object.entries(back.headers)) if (!DROP_BACK.has(k) && !k.startsWith('access-control-')) out[k] = v;
        out['x-content-type-options'] = 'nosniff';
        res.writeHead(back.statusCode ?? 502, out);
        back.pipe(res);
        back.on('error', () => res.destroy());
      });
      live.add(up);
      up.on('close', () => live.delete(up));
      up.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain', 'content-length': 11, connection: 'close' });
          res.end('unavailable');
        } else res.destroy();
      });
      // The client going away, or a request that breaks the parser after this
      // one, takes the upstream request with it.
      res.on('close', () => {
        if (!res.writableFinished) up.destroy();
      });
      req.socket.once('close', () => up.destroy());
      req.pipe(up);
    };
  }

  const servers = [];
  const closeAll = () => Promise.all(servers.map(s => new Promise(r => s.close(() => r()))));
  for (const service of ['stt', 'tts']) {
    const server = createServer(handler(service, ports[service]));
    server.keepAliveTimeout = 5000;
    server.requestTimeout = 0;
    server.on('upgrade', (req, socket) => refuseRaw(socket));
    server.on('connect', (req, socket) => refuseRaw(socket));
    // Only the bad connection goes; its own upstream request ends with it.
    server.on('clientError', (err, socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(ports[service], '127.0.0.1', resolve);
      });
    } catch (e) {
      await closeAll();
      fail(e.code === 'EADDRINUSE' ? 'port in use' : 'bind');
    }
    servers.push(server);
  }

  try {
    mkdirSync(run, { recursive: true, mode: 0o700 });
    chmodSync(join(home, '.incantation'), 0o700);
    chmodSync(run, 0o700);
    rmSync(join(run, 'token'), { force: true });
    writeFileSync(join(run, 'token'), token, { mode: 0o600, flag: 'wx' });
    writeFileSync(join(run, 'proxy.pid'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  } catch {
    await closeAll();
    fail('files');
  }

  let closed = false;
  return {
    addresses: servers.map(s => `${s.address().address}:${s.address().port}`),
    async close() {
      if (closed) return;
      closed = true;
      for (const up of live) up.destroy();
      for (const s of servers) s.closeAllConnections();
      await closeAll();
      // Only what this proxy wrote: a later proxy's token is not removed.
      try {
        if (readFileSync(join(run, 'token')).equals(token)) rmSync(join(run, 'token'), { force: true });
        if (JSON.parse(readFileSync(join(run, 'proxy.pid'), 'utf8')).pid === process.pid) rmSync(join(run, 'proxy.pid'), { force: true });
      } catch {
        // already gone
      }
    },
  };
}

// The pid of a running proxy.mjs owned by this person, or null. A pid file that
// names anything else is not acted on.
function runningProxy(home) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(join(runDir(home), 'proxy.pid'), 'utf8')).pid;
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!cmd.some(part => /(^|[\\/])proxy\.mjs$/.test(part))) return null;
    if (statSync(`/proc/${pid}`).uid !== process.getuid()) return null;
  } catch {
    return null;
  }
  return pid;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// A process that has exited but is not yet reaped by its parent still answers a
// signal of 0; its state in /proc says it is gone.
const alive = pid => {
  try {
    process.kill(pid, 0);
    return !/^\d+ \([^)]*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
};

async function main(argv) {
  const home = homedir();
  const say = text => process.stdout.write(`${text}\n`);
  const command = argv[2];
  if (command === 'run') {
    let proxy;
    try {
      proxy = await startProxy({ home });
    } catch (e) {
      const known = ['port in use', 'tcp upstream', 'settings'];
      say(`proxy error: ${known.includes(e.message) ? e.message : 'failed'}`);
      return 1;
    }
    const stop = () => proxy.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    return new Promise(() => {});
  }
  if (command === 'start') {
    if (runningProxy(home)) return say('proxy running'), 0;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], { detached: true, stdio: 'ignore', cwd: home, env: { HOME: home, PATH: process.env.PATH ?? '' } });
    let exited = false;
    child.on('exit', () => (exited = true));
    child.unref();
    for (let i = 0; i < 60 && !exited; i++) {
      await sleep(50);
      if (runningProxy(home)) return say('proxy started'), 0;
    }
    return say('proxy error: failed'), 1;
  }
  if (command === 'stop') {
    const pid = runningProxy(home);
    if (!pid) return say('proxy: not running'), 0;
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
    return say(alive(pid) ? 'proxy error: did not stop' : 'proxy stopped'), alive(pid) ? 1 : 0;
  }
  say('usage: proxy.mjs run | start | stop');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv);
  process.exit(code);
}
