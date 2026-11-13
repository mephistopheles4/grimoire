// Fixtures shared by the Incantation tests (docs/spec/incantation.md, S5): a
// fixture home folder with local-only VoiceMode settings, a token, fake speech
// engines on unix sockets, and a fake proxy on loopback ports that answers the
// way proxy.mjs does. Nothing here is a test, and nothing reaches the network:
// every server binds 127.0.0.1 or a socket in a temporary folder.

import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const onWindows = process.platform === 'win32';

// A free TCP port on 127.0.0.1: bound and released, so a test can name it.
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Everything a test starts is closed by the test's cleanup list.
export function cleanup() {
  const items = [];
  return {
    add: fn => items.push(fn),
    async run() {
      for (const fn of items.reverse()) {
        try {
          await fn();
        } catch {
          // already closed
        }
      }
    },
  };
}

export const closeServer = s => () => new Promise(r => s.close(() => r()));

// The text of a local-only global settings file, as README step 4 sets it.
export function localOnlyEnv({ stt, tts, extra = '' }) {
  return [
    `VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:${tts}/v1`,
    `VOICEMODE_STT_BASE_URLS=http://127.0.0.1:${stt}/v1`,
    'VOICEMODE_SERVICE_AUTO_ENABLE=false',
    'VOICEMODE_AUTO_START_KOKORO=false',
    'VOICEMODE_VOICES=af_sky',
    'VOICEMODE_STREAMING_ENABLED=true',
    'VOICEMODE_SILENCE_THRESHOLD_MS=1000',
    extra,
    '',
  ].join('\n');
}

// A fixture home folder: ~/.voicemode/voicemode.env, and ~/.incantation/run
// at mode 0700 holding the proxy's token. `env` replaces the settings text.
export function makeHome({ stt, tts, env, token = randomBytes(32) } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-home-'));
  mkdirSync(join(home, '.voicemode'), { recursive: true });
  writeFileSync(join(home, '.voicemode', 'voicemode.env'), env ?? localOnlyEnv({ stt, tts }));
  const run = join(home, '.incantation', 'run');
  mkdirSync(run, { recursive: true });
  chmodSync(join(home, '.incantation'), 0o700);
  chmodSync(run, 0o700);
  writeFileSync(join(run, 'token'), token, { mode: 0o600 });
  return { home, run, token, remove: () => rmSync(home, { recursive: true, force: true }) };
}

export const proof = (token, nonce) => createHmac('sha256', token).update(String(nonce)).digest('hex');

// A fake proxy: one server per port, on 127.0.0.1 only. `mode` bends it one
// way at a time so a test can break exactly one thing.
//   good          answers /health with the right proof, refuses a foreign Host,
//                 a foreign Origin and an unlisted path with a 403
//   wrong-token   answers /health with a proof under another token
//   replay        answers every /health with a proof it made earlier
//   no-host-check lets a foreign Host through
//   no-origin-check lets a foreign Origin through
//   no-path-check lets an unlisted path through
//   tcp-upstream  reports a TCP upstream
export async function fakeProxy({ ports, token, mode = 'good', upstream = { stt: 'socket', tts: 'socket' } }) {
  const servers = [];
  const earlier = proof(token, 'earlier');
  for (const port of ports) {
    const server = createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url, 'http://x');
      const host = req.headers.host;
      const hostOk = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
      const origin = req.headers.origin;
      const originOk = origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
      if (!hostOk && mode !== 'no-host-check') return send(403, { error: 'refused' });
      if (!originOk && mode !== 'no-origin-check') return send(403, { error: 'refused' });
      if (url.pathname === '/health' && req.method === 'GET') {
        const nonce = url.searchParams.get('nonce');
        let answer = nonce === null ? undefined : proof(token, nonce);
        if (mode === 'wrong-token') answer = proof(randomBytes(32), nonce);
        if (mode === 'replay') answer = earlier;
        return send(200, { upstream: mode === 'tcp-upstream' ? { stt: 'tcp', tts: 'tcp' } : upstream, proof: answer });
      }
      if (mode === 'no-path-check') return send(200, { ok: true });
      return send(403, { error: 'refused' });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    servers.push(server);
  }
  return { close: () => Promise.all(servers.map(s => new Promise(r => s.close(() => r())))) };
}

// A fake speech engine on a unix socket. `page` makes it serve a web player
// page at /web/, as a text-to-speech engine with the player on would.
export async function fakeEngine(path, { page = false } = {}) {
  const server = createServer((req, res) => {
    if (page && req.url.startsWith('/web')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>player</html>');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  return { close: () => new Promise(r => server.close(() => r())) };
}

// A plain TCP listener that answers anything, on a given host.
export async function fakeTcp(port, host) {
  const server = createServer((req, res) => res.end('hello'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return { close: () => new Promise(r => server.close(() => r())) };
}
