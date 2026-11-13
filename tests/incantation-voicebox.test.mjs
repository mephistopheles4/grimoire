// Claim 18 (docs/spec/incantation.md, S8): engines/voicebox.mjs against a fake
// server that follows Voicebox 0.5.0's published interface. Every reply here is
// made up in the schema's shapes; nothing is recorded from a real Voicebox.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const ENGINE = new URL('../plugins/incantation/skills/incantation/scripts/engines/voicebox.mjs', import.meta.url);
const { makeEngine, VALUES } = await import(ENGINE);

// A fake Voicebox on 127.0.0.1. `routes` maps "METHOD /path" to a handler.
async function fakeVoicebox(routes) {
  // The request text is only compared with each route's own key, never used as a property name.
  const table = Object.entries(routes).map(([key, handler]) => ({ key, handler }));
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const key = `${req.method} ${req.url}`;
      const route = table.find(r => r.key === key);
      if (!route) {
        res.statusCode = 404;
        return res.end('{}');
      }
      route.handler(req, res, body);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, close: () => new Promise(r => (server.closeAllConnections(), server.close(() => r()))) };
}

const json = obj => (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
};

test('the values table marks every Voicebox value unverified, with its prototype check', () => {
  assert.ok(Object.keys(VALUES).length >= 5);
  for (const [name, v] of Object.entries(VALUES)) {
    assert.equal(v.verified, false, name);
    assert.match(v.check, /^[FT][1-9]$/, name);
  }
  const engine = makeEngine({ port: 17493 });
  assert.equal(engine.speakTools, undefined, 'the session no longer speaks through Voicebox\'s MCP tool (T18)');
  assert.equal(engine.mcpUrl, undefined);
  assert.equal(typeof engine.synthesize, 'function');
});

const wavBytes = n => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(Math.max(n - 16, 0), 2)]);
const profiles = list => json(list);
const BELLA = [{ id: 'prof-1', name: 'Bella', language: 'en', preset_engine: 'kokoro', default_engine: 'kokoro' }];

test('T18: synthesize asks /generate/stream for the WAV with the profile\'s own engine, and sends the text only as JSON', async t => {
  const hostile = 'say "hi" $(rm -rf /) ; `x` \\ and\nnew line, café \u{1F600} <b>';
  const vb = await fakeVoicebox({
    'GET /profiles': profiles(BELLA),
    'POST /generate/stream': (req, res) => {
      res.setHeader('content-type', 'audio/wav');
      res.end(wavBytes(2000));
    },
  });
  t.after(vb.close);
  const wav = await makeEngine({ port: vb.port, profile: 'prof-1' }).synthesize(hostile);
  assert.ok(Buffer.isBuffer(wav) && wav.toString('latin1', 0, 4) === 'RIFF');
  const post = vb.seen.find(s => s.method === 'POST');
  assert.match(post.headers['content-type'], /^application\/json/);
  assert.equal(post.headers.host, `127.0.0.1:${vb.port}`);
  const sent = JSON.parse(post.body.toString('utf8'));
  assert.deepEqual(Object.keys(sent).sort(), ['engine', 'language', 'profile_id', 'text']);
  assert.equal(sent.text, hostile, 'the text arrives byte for byte, nothing escaped by hand and nothing run');
  assert.equal(sent.engine, 'kokoro');
  assert.equal(sent.profile_id, 'prof-1');
  assert.equal(sent.language, 'en');
});

test('T18: synthesize is null on a refused request, a reply that is not a WAV, an unknown profile, or a Voicebox that does not answer', async t => {
  const refused = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => ((res.statusCode = 400), res.end('{"detail":"x"}')) });
  t.after(refused.close);
  assert.equal(await makeEngine({ port: refused.port, profile: 'prof-1' }).synthesize('hello'), null);
  const notWav = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => res.end('<html>nope</html>') });
  t.after(notWav.close);
  assert.equal(await makeEngine({ port: notWav.port, profile: 'prof-1' }).synthesize('hello'), null);
  const unknown = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => res.end(wavBytes(100)) });
  t.after(unknown.close);
  assert.equal(await makeEngine({ port: unknown.port, profile: 'someone-else' }).synthesize('hello'), null);
  assert.equal(unknown.seen.filter(s => s.method === 'POST').length, 0, 'no generation for a profile it cannot place');
  const gone = await fakeVoicebox({});
  const port = gone.port;
  await gone.close();
  assert.equal(await makeEngine({ port, profile: 'prof-1' }).synthesize('hello'), null);
});

test('T18: synthesize is bounded: a slow generation and a reply over the size cap both end as null', async t => {
  const slow = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => setTimeout(() => res.end(wavBytes(100)), 300) });
  t.after(slow.close);
  assert.equal(await makeEngine({ port: slow.port, profile: 'prof-1', speakMs: 50 }).synthesize('hello'), null);
  const big = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => res.end(wavBytes(5000)) });
  t.after(big.close);
  assert.equal(await makeEngine({ port: big.port, profile: 'prof-1', maxWavBytes: 1000 }).synthesize('hello'), null);
});

test('T18: the profile\'s engine is looked up once and kept', async t => {
  const vb = await fakeVoicebox({ 'GET /profiles': profiles(BELLA), 'POST /generate/stream': (req, res) => res.end(wavBytes(100)) });
  t.after(vb.close);
  const engine = makeEngine({ port: vb.port, profile: 'prof-1' });
  await engine.synthesize('one');
  await engine.synthesize('two');
  assert.equal(vb.seen.filter(s => s.method === 'GET' && s.url === '/profiles').length, 1);
});

test('health reads GET /health on 127.0.0.1 at the settings port', async t => {
  const vb = await fakeVoicebox({ 'GET /health': json({ status: 'healthy', model_loaded: false, gpu_available: false }) });
  t.after(vb.close);
  const engine = makeEngine({ port: vb.port });
  assert.equal(await engine.health(), true);
  assert.equal(vb.seen[0].headers.host, `127.0.0.1:${vb.port}`);
});

test('health is false when nothing answers', async () => {
  const vb = await fakeVoicebox({});
  const port = vb.port;
  await vb.close();
  assert.equal(await makeEngine({ port }).health(), false);
});

test('transcribe sends one multipart file part holding a WAV of the turn, and returns text', async t => {
  const vb = await fakeVoicebox({ 'POST /transcribe': json({ text: '  hello there ', duration: 0.5 }) });
  t.after(vb.close);
  const pcm = Buffer.alloc(3200, 1);
  const text = await makeEngine({ port: vb.port }).transcribe(pcm);
  assert.equal(text, 'hello there');
  const req = vb.seen[0];
  assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
  const body = req.body.toString('latin1');
  assert.equal(body.match(/Content-Disposition: form-data;/g).length, 1, 'one part only');
  assert.match(body, /name="file"; filename="turn.wav"/);
  const at = req.body.indexOf('RIFF');
  assert.ok(at > 0);
  assert.equal(req.body.toString('latin1', at + 8, at + 12), 'WAVE');
  assert.equal(req.body.readUInt32LE(at + 24), 16000, 'sample rate');
  assert.equal(req.body.readUInt32LE(at + 40), pcm.length, 'data length');
});

test('transcribe returns null on a non-200 answer or a reply with no text', async t => {
  const vb = await fakeVoicebox({ 'POST /transcribe': (req, res) => ((res.statusCode = 500), res.end('{"detail":"x"}')) });
  t.after(vb.close);
  assert.equal(await makeEngine({ port: vb.port }).transcribe(Buffer.alloc(320)), null);
  const empty = await fakeVoicebox({ 'POST /transcribe': json({}) });
  t.after(empty.close);
  assert.equal(await makeEngine({ port: empty.port }).transcribe(Buffer.alloc(320)), null, 'a 200 reply with no text');
});

test('the warm has its own, longer limit than one transcription, for a cold model load', async t => {
  const slow = (req, res) => setTimeout(() => json({ text: '', duration: 1 })(req, res), 150);
  const vb = await fakeVoicebox({ 'POST /transcribe': slow });
  t.after(vb.close);
  const engine = makeEngine({ port: vb.port, timeoutMs: 50, warmMs: 2000 });
  assert.equal(await engine.transcribe(Buffer.alloc(320)), null, 'one transcription past its limit');
  assert.equal(typeof (await engine.warm()), 'number', 'the warm waits past it');
  await assert.rejects(makeEngine({ port: vb.port, warmMs: 50 }).warm());
});

test('warm transcribes one second of silence and loads no speech model', async t => {
  const vb = await fakeVoicebox({ 'POST /transcribe': json({ text: '', duration: 1 }), 'POST /models/load': json({}) });
  t.after(vb.close);
  const ms = await makeEngine({ port: vb.port }).warm();
  assert.equal(typeof ms, 'number');
  assert.deepEqual(vb.seen.map(s => `${s.method} ${s.url}`), ['POST /transcribe']);
  const body = vb.seen[0].body;
  const at = body.indexOf('RIFF');
  assert.equal(body.readUInt32LE(at + 40), 32000, 'one second of 16 kHz mono 16-bit');
});

const sse = events => (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(e);
  // the stream stays open until the test closes the server
};

test('playback turns speak-start and speak-end events into start and end, keeping the generation id in memory and no text', async t => {
  const vb = await fakeVoicebox({
    'GET /events/speak': sse([
      ': keep-alive\n\n',
      'event: speak-start\ndata: {"generation_id":"gen-1","text":"a private line","profile":"p1"}\n\n',
      'data: {"type":"speak-end","generation_id":"gen-1","text":"a private line"}\n\n',
      'event: something-else\ndata: {}\n\n',
    ]),
  });
  t.after(vb.close);
  const feed = makeEngine({ port: vb.port }).playback();
  const got = [];
  let openedFirst = null;
  feed.once('open', () => (openedFirst ??= true));
  feed.once('start', () => (openedFirst ??= false));
  await new Promise((resolve, reject) => {
    feed.on('start', e => got.push(['start', e]));
    feed.on('end', e => {
      got.push(['end', e]);
      resolve();
    });
    feed.on('error', reject);
  });
  feed.close();
  assert.deepEqual(got.map(g => g[0]), ['start', 'end']);
  assert.equal(openedFirst, true, 'open comes once the feed answers, before any event');
  for (const [, e] of got) assert.deepEqual(Object.keys(e).sort(), ["at", "id"]);
  assert.deepEqual(got.map(g => g[1].id), ["gen-1", "gen-1"]);
});

test('playback errors when the stream ends, answers other than 200, or sends a line over 64 KB', async t => {
  for (const handler of [
    (req, res) => res.writeHead(200, { 'content-type': 'text/event-stream' }).end('event: speak-start\ndata: {}\n\n'),
    // A 503 that still streams an event and stays open: only the status check refuses it.
    (req, res) => res.writeHead(503, { 'content-type': 'text/event-stream' }).write('event: speak-start\ndata: {}\n\n'),
    (req, res) => res.writeHead(200, { 'content-type': 'text/event-stream' }).write(`data: ${'x'.repeat(70_000)}`),
  ]) {
    const vb = await fakeVoicebox({ 'GET /events/speak': handler });
    const feed = makeEngine({ port: vb.port }).playback();
    let started = false;
    feed.on('start', () => (started = true));
    await new Promise(resolve => feed.on('error', resolve));
    if (handler.toString().includes('503')) assert.equal(started, false, 'no start from a refused stream');
    feed.close();
    await vb.close();
  }
  t.diagnostic('all three ended in error');
});

test('with NODE_USE_ENV_PROXY and HTTP_PROXY set, a fake proxy receives nothing', async t => {
  const vb = await fakeVoicebox({ 'GET /health': json({ status: 'healthy' }) });
  t.after(vb.close);
  let proxied = 0;
  const proxy = createServer((req, res) => {
    proxied++;
    res.end('{}');
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => proxy.close(() => r())));
  const script = `const { makeEngine } = await import(${JSON.stringify(ENGINE.href)}); process.stdout.write(String(await makeEngine({ port: ${vb.port} }).health()));`;
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  // execFile, not spawnSync: the fakes live in this process and must keep answering.
  const run = await new Promise(resolve =>
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NO_PROXY: '', no_proxy: '' }, encoding: 'utf8', timeout: 15_000 },
      (error, stdout, stderr) => resolve({ stdout, stderr }),
    ),
  );
  assert.equal(run.stdout, 'true', run.stderr);
  assert.equal(proxied, 0);
  assert.equal(vb.seen.length, 1);
});
