// Tests of proxy.mjs (docs/spec/incantation.md, S4.2; claims 15 to 17). Fake
// engines on unix sockets in a fixture home, the proxy on free loopback ports,
// raw bytes where a request has to be malformed. They skip on win32 and say so:
// they run in the athanor container and in CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy } from '../plugins/incantation/skills/incantation/scripts/proxy.mjs';
import { cleanup, freePort, localOnlyEnv, makeHome, onWindows, proof } from './incantation-helpers.mjs';

const PROXY = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/proxy.mjs', import.meta.url));
const skip = onWindows ? 'unix sockets: skipped on win32, run in the athanor container and in CI' : false;

// An engine on a socket that records what it is asked, and answers as told.
async function engineAt(path, { delay = 0 } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    const entry = { method: req.method, url: req.url, headers: req.headers, bytes: 0, ended: false, aborted: false };
    seen.push(entry);
    req.on('data', c => {
      entry.bytes += c.length;
      chunks.push(c);
    });
    req.on('aborted', () => (entry.aborted = true));
    res.on('close', () => {
      if (!res.writableFinished) entry.aborted = true;
    });
    req.on('end', () => {
      entry.ended = true;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-engine': 'yes' });
        res.end(Buffer.concat(chunks));
      }, delay);
    });
  });
  await new Promise(r => server.listen(path, r));
  return { seen, close: () => new Promise(r => server.close(() => r())) };
}

// The proxy, in front of two fake engines, in a fixture home.
async function setup(t, { delay = 0 } = {}) {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  const engines = { stt: await engineAt(join(h.run, 'stt.sock'), { delay }), tts: await engineAt(join(h.run, 'tts.sock'), { delay }) };
  c.add(engines.stt.close);
  c.add(engines.tts.close);
  const proxy = await startProxy({ home: h.home });
  c.add(proxy.close);
  return { h, stt, tts, engines, proxy };
}

// Raw bytes in, whatever comes back out, until the proxy closes or 400 ms pass.
function raw(port, text, { wait = 400, then } = {}) {
  return new Promise(resolve => {
    const s = connect(port, '127.0.0.1');
    let out = '';
    s.setEncoding('latin1');
    s.on('data', d => (out += d));
    s.on('connect', () => {
      s.write(text);
      if (then) setTimeout(() => s.write(then), 50);
    });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
    setTimeout(() => {
      s.destroy();
      resolve(out);
    }, wait);
  });
}

const statusOf = text => Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1]);
const get = (port, path, extra = '') => `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${extra}\r\n`;
const post = (port, path, body, extra = '') => `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: ${body.length}\r\n${extra}\r\n${body}`;
const FIXED = 'refused';

// Claim 15.

test('the proxy binds 127.0.0.1 only, on the ports in the global settings', { skip }, async t => {
  const { proxy, stt, tts } = await setup(t);
  assert.deepEqual(proxy.addresses.sort(), [`127.0.0.1:${stt}`, `127.0.0.1:${tts}`].sort());
});

test('a foreign Host is refused with a 403 and a fixed body, and nothing is forwarded', { skip }, async t => {
  const { stt, engines } = await setup(t);
  for (const host of ['evil.example', `evil.example:${stt}`, `127.0.0.1:${stt + 1}`, '127.0.0.1', `localhost:${stt}.evil.example`]) {
    const r = await raw(stt, `GET /v1/models HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    assert.equal(statusOf(r), 403, host);
    assert.ok(r.endsWith(FIXED), host);
  }
  assert.equal(engines.stt.seen.length, 0);
});

test('an Origin that is set and not the same origin is refused, null included', { skip }, async t => {
  const { tts, engines } = await setup(t);
  for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${tts + 1}`, `https://127.0.0.1:${tts}`]) {
    const r = await raw(tts, get(tts, '/v1/models', `Origin: ${origin}\r\n`));
    assert.equal(statusOf(r), 403, origin);
  }
  const same = await raw(tts, get(tts, '/v1/models', `Origin: http://localhost:${tts}\r\n`));
  assert.equal(statusOf(same), 200);
  assert.equal(engines.tts.seen.length, 1);
});

test('an unlisted method or path is refused, for each engine', { skip }, async t => {
  const { stt, tts, engines } = await setup(t);
  const cases = [
    [stt, get(stt, '/v1/audio/speech')],
    [stt, get(stt, '/v1/models')],
    [stt, get(stt, '/')],
    [stt, `DELETE /v1/audio/transcriptions HTTP/1.1\r\nHost: 127.0.0.1:${stt}\r\n\r\n`],
    [tts, get(tts, '/v1/audio/transcriptions')],
    [tts, get(tts, '/web/')],
    [tts, get(tts, '/v1/audio/voices?x=1')],
    [tts, `PUT /v1/audio/speech HTTP/1.1\r\nHost: 127.0.0.1:${tts}\r\nContent-Length: 0\r\n\r\n`],
  ];
  for (const [port, text] of cases) assert.equal(statusOf(await raw(port, text)), 403, text.split('\r\n')[0]);
  assert.equal(engines.stt.seen.length + engines.tts.seen.length, 0);
});

test('an encoded, dot-segment, doubled-slash or absolute-form target is refused', { skip }, async t => {
  const { tts, engines } = await setup(t);
  for (const target of ['/v1/audio/voices%2e', '/v1/%61udio/voices', '/v1/../v1/audio/voices', '/v1/./audio/voices', '//v1/audio/voices', '/v1//audio/voices', `http://127.0.0.1:${tts}/v1/audio/voices`]) {
    assert.equal(statusOf(await raw(tts, get(tts, target))), 403, target);
  }
  assert.equal(engines.tts.seen.length, 0);
});

test('Upgrade and CONNECT are refused', { skip }, async t => {
  const { tts, engines } = await setup(t);
  const up = await raw(tts, get(tts, '/v1/audio/voices', 'Connection: Upgrade\r\nUpgrade: websocket\r\n'));
  assert.equal(statusOf(up), 403);
  const cn = await raw(tts, `CONNECT 127.0.0.1:80 HTTP/1.1\r\nHost: 127.0.0.1:${tts}\r\n\r\n`);
  assert.equal(statusOf(cn), 403);
  assert.equal(engines.tts.seen.length, 0);
});

test('a POST with no Content-Length, or one over 25 MB, is refused', { skip }, async t => {
  const { stt, engines } = await setup(t);
  const none = await raw(stt, `POST /v1/audio/transcriptions HTTP/1.1\r\nHost: 127.0.0.1:${stt}\r\n\r\n`);
  assert.equal(statusOf(none), 403);
  const chunked = await raw(stt, `POST /v1/audio/transcriptions HTTP/1.1\r\nHost: 127.0.0.1:${stt}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`);
  assert.equal(statusOf(chunked), 403);
  const big = await raw(stt, `POST /v1/audio/transcriptions HTTP/1.1\r\nHost: 127.0.0.1:${stt}\r\nContent-Length: ${25 * 1024 * 1024 + 1}\r\n\r\n`);
  assert.equal(statusOf(big), 403);
  assert.equal(engines.stt.seen.length, 0);
});

test('a request whose Sec-Fetch-Site is cross-site or same-site is refused', { skip }, async t => {
  const { tts } = await setup(t);
  for (const site of ['cross-site', 'same-site']) assert.equal(statusOf(await raw(tts, get(tts, '/v1/models', `Sec-Fetch-Site: ${site}\r\n`))), 403, site);
  assert.equal(statusOf(await raw(tts, get(tts, '/v1/models', 'Sec-Fetch-Site: none\r\n'))), 200);
});

test('each request on a kept-alive connection is checked on its own', { skip }, async t => {
  const { tts, engines } = await setup(t);
  // The first is good and the second is not: the second must be refused, and
  // forward nothing, though the connection has already carried a good one.
  const both = await raw(tts, get(tts, '/v1/models') + get(tts, '/web/'), { wait: 600 });
  const statuses = [...both.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(m => Number(m[1]));
  assert.deepEqual(statuses, [200, 403]);
  assert.equal(engines.tts.seen.length, 1);
  const swapped = await raw(tts, get(tts, '/v1/models') + `GET /v1/models HTTP/1.1\r\nHost: evil.example\r\n\r\n`, { wait: 600 });
  assert.deepEqual([...swapped.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(m => Number(m[1])), [200, 403]);
});

test('bytes after a request body abort the upstream request', { skip }, async t => {
  const { stt, engines } = await setup(t, { delay: 400 });
  await raw(stt, post(stt, '/v1/audio/transcriptions', 'abcde'), { then: 'JUNK-BYTES\r\n\r\n', wait: 700 });
  assert.equal(engines.stt.seen.length, 1);
  for (let i = 0; i < 20 && !engines.stt.seen[0].aborted; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(engines.stt.seen[0].aborted, true);
});

// Claim 16.

test('a listed request reaches the socket with only the listed headers, and the answer streams back unchanged', { skip }, async t => {
  const { stt, engines } = await setup(t);
  const body = Buffer.alloc(300_000, 7);
  const seen = engines.stt.seen;
  const res = await fetch(`http://127.0.0.1:${stt}/v1/audio/transcriptions`, { method: 'POST', headers: { 'content-type': 'audio/wav', accept: '*/*', 'user-agent': 'test', authorization: 'Bearer x', cookie: 'a=b', 'x-forwarded-for': '1.2.3.4' }, body });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-engine'), 'yes');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(body));
  const got = seen.at(-1);
  assert.equal(got.url, '/v1/audio/transcriptions');
  assert.equal(got.bytes, body.length);
  const allowed = new Set(['content-type', 'content-length', 'accept', 'accept-encoding', 'user-agent', 'host', 'connection']);
  assert.deepEqual(Object.keys(got.headers).filter(k => !allowed.has(k)), []);
});

test('/health is answered by the proxy: sockets named, a proof for a nonce, never the token', { skip }, async t => {
  const { stt, h } = await setup(t);
  const res = await fetch(`http://127.0.0.1:${stt}/health?nonce=abc123`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(body.upstream, { stt: 'socket', tts: 'socket' });
  const token = readFileSync(join(h.run, 'token'));
  assert.equal(body.proof, proof(token, 'abc123'));
  assert.ok(!text.includes(token.toString('hex')) && !text.includes(h.home));
  const plain = await (await fetch(`http://127.0.0.1:${stt}/health`)).json();
  assert.equal(plain.proof, undefined);
  const odd = await raw(stt, get(stt, '/health?nonce=a%20b&x=1'));
  assert.equal(statusOf(odd), 403);
});

test('the refusal count is on /health and counts a refusal, not what was refused', { skip }, async t => {
  const { stt } = await setup(t);
  assert.equal((await (await fetch(`http://127.0.0.1:${stt}/health`)).json()).refused, 0);
  await raw(stt, get(stt, '/nope'));
  await raw(stt, get(stt, '/nope2'));
  const after = await (await fetch(`http://127.0.0.1:${stt}/health`)).json();
  assert.equal(after.refused, 2);
});

test('the proxy refuses to start with a TCP upstream, or when a port is taken', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  await assert.rejects(() => startProxy({ home: h.home, upstreams: { stt: 'http://127.0.0.1:9000', tts: join(h.run, 'tts.sock') } }), /tcp upstream/);
  const first = await startProxy({ home: h.home });
  c.add(first.close);
  await assert.rejects(() => startProxy({ home: h.home }), /port in use/);
});

test('the token is 32 random bytes, mode 0600, new at each start, and gone after stop', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  const path = join(h.run, 'token');
  const a = await startProxy({ home: h.home });
  const one = readFileSync(path);
  assert.equal(one.length, 32);
  assert.equal(readFileSync(path).equals(h.token), false);
  await a.close();
  assert.equal(existsSync(path), false);
  const b = await startProxy({ home: h.home });
  c.add(b.close);
  assert.equal(readFileSync(path).equals(one), false);
});

// The command line.

function cli(args, { home, cwd, env = {} }) {
  return spawn(process.execPath, [PROXY, ...args], { cwd, env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
const finish = child => new Promise(resolve => {
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  child.on('close', code => resolve({ code, out }));
});

test('the command line writes nothing but fixed lines, reads no environment or working folder, and stop signals only its own pid', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  const e = [await engineAt(join(h.run, 'stt.sock')), await engineAt(join(h.run, 'tts.sock'))];
  e.forEach(x => c.add(x.close));
  // A planted settings file in the working folder, and URLs in the environment,
  // that name other ports: neither is read.
  const planted = join(h.home, 'work');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(planted);
  writeFileSync(join(planted, '.voicemode.env'), localOnlyEnv({ stt: stt + 1, tts: tts + 1 }));
  const run = cli(['run'], { home: h.home, cwd: planted, env: { VOICEMODE_STT_BASE_URLS: `http://127.0.0.1:${stt + 1}/v1`, VOICEMODE_TTS_BASE_URLS: `http://127.0.0.1:${tts + 1}/v1` } });
  let out = '';
  run.stdout.on('data', d => (out += d));
  run.stderr.on('data', d => (out += d));
  c.add(() => run.kill());
  const runClosed = new Promise(r => run.on('close', r));
  for (let i = 0; i < 40 && !(await fetch(`http://127.0.0.1:${stt}/health`).then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await fetch(`http://127.0.0.1:${stt}/health`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${tts}/health`)).status, 200);
  assert.equal(existsSync(join(h.run, 'proxy.pid')), true);
  assert.equal(await fetch(`http://127.0.0.1:${stt + 1}/health`).then(() => 'answered', () => 'refused'), 'refused');
  // Refused and forwarded traffic carrying markers: the foreground proxy prints none of it.
  const { request } = await import('node:http');
  const send = (port, options, body) => new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, ...options }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.end(body);
  });
  assert.equal(await send(stt, { method: 'POST', path: '/v1/audio/transcriptions', headers: { host: 'MARKER-host.example' } }, 'x'), 403);
  assert.equal(await send(stt, { method: 'GET', path: '/MARKER-path-7d2e' }), 403);
  assert.equal(await send(stt, { method: 'POST', path: '/v1/audio/transcriptions', headers: { 'content-length': 17 } }, 'MARKER-body-3f9a1'), 200);
  // A decoy process: a pid file naming it is not the proxy, so stop leaves it.
  const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  c.add(() => decoy.kill());
  const real = readFileSync(join(h.run, 'proxy.pid'), 'utf8');
  writeFileSync(join(h.run, 'proxy.pid'), JSON.stringify({ pid: decoy.pid }));
  const refused = await finish(cli(['stop'], { home: h.home, cwd: planted }));
  assert.equal(decoy.exitCode, null, 'the decoy is still running');
  assert.match(refused.out, /^proxy: not running\n$/);
  writeFileSync(join(h.run, 'proxy.pid'), real);
  const stopped = await finish(cli(['stop'], { home: h.home, cwd: planted }));
  assert.equal(stopped.out, 'proxy stopped\n');
  await runClosed;
  assert.equal(existsSync(join(h.run, 'token')), false);
  assert.equal(existsSync(join(h.run, 'proxy.pid')), false);
  assert.equal(out, '', 'the foreground proxy printed nothing');
  // Claim 17: with the proxy stopped its ports refuse a connection.
  for (const port of [stt, tts]) assert.equal(await fetch(`http://127.0.0.1:${port}/health`).then(() => 'answered', () => 'refused'), 'refused');
});

test('a second start finds the ports taken and says so with a fixed line', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  const taken = await startProxy({ home: h.home });
  c.add(taken.close);
  const r = await finish(cli(['run'], { home: h.home, cwd: h.home }));
  assert.equal(r.code, 1);
  assert.equal(r.out, 'proxy error: port in use\n');
  assert.deepEqual(readdirSync(h.run).sort(), ['proxy.pid', 'token'].filter(f => existsSync(join(h.run, f))).sort());
  assert.equal(readdirSync(h.run).includes('token'), true, 'the running proxy keeps its own token');
});

test('start detaches a proxy that outlives the command, a second start says it is running, and stop ends it', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  c.add(() => cli(['stop'], { home: h.home, cwd: h.home }));
  const first = await finish(cli(['start'], { home: h.home, cwd: h.home }));
  assert.equal(first.out, 'proxy started\n');
  assert.equal((await fetch(`http://127.0.0.1:${stt}/health`)).status, 200);
  assert.equal((await finish(cli(['start'], { home: h.home, cwd: h.home }))).out, 'proxy running\n');
  assert.equal((await finish(cli(['stop'], { home: h.home, cwd: h.home }))).out, 'proxy stopped\n');
  assert.equal((await finish(cli(['stop'], { home: h.home, cwd: h.home }))).out, 'proxy: not running\n');
});
