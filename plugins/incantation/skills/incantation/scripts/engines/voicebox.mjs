// The Voicebox engine (docs/spec/incantation.md, S5.1 to S5.3). Node built-ins
// only. Every request goes to the literal 127.0.0.1 at the settings' port,
// through an agent made for that one call, which reads no proxy setting from
// the environment (S6, "No proxy").

import { EventEmitter } from 'node:events';
import { Agent, request } from 'node:http';
import { performance } from 'node:perf_hooks';

// What this module takes from Voicebox 0.5.0's published interface (its
// OpenAPI schema and its MCP tool list), before the prototype has watched any
// of it work (W13). Each value names the prototype check that confirms it
// (S9). The pull request lists them all.
export const VALUES = Object.freeze({
  speakTool: { value: 'mcp__voicebox__voicebox_speak', args: ['text', 'profile'], verified: false, check: 'F8' },
  mcpForm: { value: 'user scope, http, http://127.0.0.1:<port>/mcp', verified: false, check: 'F8' },
  health: { value: 'GET /health', verified: false, check: 'F7' },
  transcribe: { value: 'POST /transcribe, multipart, one WAV part named file, default model', verified: false, check: 'F7' },
  playback: { value: 'GET /events/speak, server-sent events speak-start and speak-end (route A)', verified: false, check: 'F2' },
  tailMs: { value: 300, verified: false, check: 'F2' },
  speechWarm: { value: 'none: the greeting is the speech warm', verified: false, check: 'F1' },
});

const HOST = '127.0.0.1';
const RATE = 16_000;
const MAX_REPLY = 1_000_000;
const MAX_LINE = 64 * 1024;

export function wavHeader(dataLength) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(dataLength, 40);
  return h;
}

// One request to Voicebox. Resolves { status, body } or null on any failure.
function call(port, { method, path, headers = {}, body, timeoutMs = 15_000 }) {
  return new Promise(resolve => {
    const agent = new Agent({ keepAlive: false });
    const req = request({ host: HOST, port, path, method, agent, timeout: timeoutMs, headers: { host: `${HOST}:${port}`, ...headers } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size <= MAX_REPLY) chunks.push(c);
        else req.destroy();
      });
      res.on('end', () => resolve(size <= MAX_REPLY ? { status: res.statusCode, body: Buffer.concat(chunks) } : null));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.on('close', () => agent.destroy());
    req.end(body);
  });
}

const parseJson = buf => {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
};

// The engine's speech-event feed: `start` and `end` with only a time, `error`
// when the stream fails. Unknown events are skipped; text, voice and id are
// dropped as they arrive.
function speakFeed(port) {
  const feed = new EventEmitter();
  const agent = new Agent({ keepAlive: false });
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    feed.emit('error', new Error('playback'));
  };
  const req = request({ host: HOST, port, path: '/events/speak', method: 'GET', agent, headers: { host: `${HOST}:${port}`, accept: 'text/event-stream' } }, res => {
    if (res.statusCode !== 200) {
      res.resume();
      return fail();
    }
    let pending = '';
    let event = '';
    let data = '';
    feed.emit('open');
    const dispatch = () => {
      let type = event;
      if (!type && data) type = parseJson(Buffer.from(data))?.type ?? '';
      if (type === 'speak-start') feed.emit('start', { at: performance.now() });
      else if (type === 'speak-end') feed.emit('end', { at: performance.now() });
      event = '';
      data = '';
    };
    res.setEncoding('utf8');
    res.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      if (pending.length > MAX_LINE) {
        req.destroy();
        return fail();
      }
      for (const line of lines) {
        if (line.length > MAX_LINE) {
          req.destroy();
          return fail();
        }
        if (line === '') dispatch();
        else if (line.startsWith(':')) continue;
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
      }
    });
    res.on('end', fail);
    res.on('error', fail);
  });
  req.on('error', fail);
  req.on('close', () => {
    agent.destroy();
    fail();
  });
  req.end();
  feed.close = () => {
    failed = true;
    req.destroy();
  };
  return feed;
}

// timeoutMs bounds one transcription; warmMs bounds the first, which loads the
// model and can take tens of seconds on a cold start (W6). The listener bounds
// the warm again with its own warmMs.
export function makeEngine({ port, timeoutMs = 15_000, warmMs = 60_000 }) {
  const transcribe = async (pcm, limit = timeoutMs) => {
    const boundary = `----incantation${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="turn.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'latin1'),
      wavHeader(pcm.length),
      pcm,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
    ]);
    const res = await call(port, { method: 'POST', path: '/transcribe', body, timeoutMs: limit, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': body.length, accept: 'application/json' } });
    if (!res || res.status !== 200) return null;
    const text = parseJson(res.body)?.text;
    return typeof text === 'string' ? text.trim() : null;
  };
  return {
    name: 'voicebox',
    mcpServer: 'voicebox',
    speakTools: [VALUES.speakTool.value],
    speakArgs: VALUES.speakTool.args,
    mcpUrl: `http://${HOST}:${port}/mcp`,
    // The one header the entry may carry: Voicebox's own setup adds a client id.
    // The guard checks its name only and never reads or prints its value.
    mcpHeaders: ['x-voicebox-client-id'],
    host: HOST,
    port,
    capture: 'ffmpeg',
    tailMs: VALUES.tailMs.value,
    async health() {
      const res = await call(port, { method: 'GET', path: '/health', timeoutMs: 1500, headers: { accept: 'application/json' } });
      return !!res && res.status === 200;
    },
    transcribe,
    // Voicebox's profiles, for setup.mjs in the person's own terminal only:
    // id, name and engine. Null when it does not answer.
    async profiles() {
      const res = await call(port, { method: 'GET', path: '/profiles', headers: { accept: 'application/json' } });
      const list = res?.status === 200 ? parseJson(res.body) : null;
      if (!Array.isArray(list)) return null;
      return list
        .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map(p => ({ id: p.id, name: p.name, engine: typeof p.preset_engine === 'string' ? p.preset_engine : typeof p.default_engine === 'string' ? p.default_engine : '' }));
    },
    // The transcription model, loaded with one second of silence. No speech
    // model is loaded until F1 shows a load that warms the profile's own engine.
    async warm() {
      const began = performance.now();
      const text = await transcribe(Buffer.alloc(RATE * 2), warmMs);
      if (text === null) throw new Error('warm');
      return Math.round(performance.now() - began);
    },
    playback: () => speakFeed(port),
  };
}
