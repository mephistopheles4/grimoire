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
  health: { value: 'GET /health', verified: false, check: 'F7' },
  transcribe: { value: 'POST /transcribe, multipart, one WAV part named file, default model', verified: false, check: 'F7' },
  playback: { value: 'GET /events/speak, server-sent events speak-start and speak-end (route A)', verified: false, check: 'F2' },
  tailMs: { value: 300, verified: false, check: 'F2' },
  synthesize: { value: 'POST /generate/stream with {profile_id, text, language, engine}: a WAV back, PCM 16-bit mono 24 kHz, and no speak events (a probe on one machine, 2026-11-13: silent, 147 ms to the first byte for 12 s of audio)', verified: false, check: 'F2' },
  speechWarm: { value: 'none: the greeting is the speech warm', verified: false, check: 'F1' },
});

const HOST = '127.0.0.1';
const RATE = 16_000;
const MAX_REPLY = 1_000_000;
const MAX_LINE = 64 * 1024;
const MAX_WAV = 12 * 1024 * 1024; // a reply of about four minutes at 24 kHz, 16-bit, mono

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
function call(port, { method, path, headers = {}, body, timeoutMs = 15_000, maxBytes = MAX_REPLY }) {
  return new Promise(resolve => {
    const agent = new Agent({ keepAlive: false });
    const req = request({ host: HOST, port, path, method, agent, timeout: timeoutMs, headers: { host: `${HOST}:${port}`, ...headers } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size <= maxBytes) chunks.push(c);
        else req.destroy();
      });
      res.on('end', () => resolve(size <= maxBytes ? { status: res.statusCode, body: Buffer.concat(chunks) } : null));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    // The request's own timeout counts idle time only; this bounds the whole call.
    const wall = setTimeout(() => req.destroy(), timeoutMs);
    req.on('error', () => resolve(null));
    req.on('close', () => {
      clearTimeout(wall);
      agent.destroy();
    });
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

// The engine's speech-event feed: `start` and `end` with a time and the
// generation's id when the event names one, `error` when the stream fails. The
// id stays in memory and is never printed or kept. Unknown events are skipped;
// text and voice are dropped as they arrive. The listener counts these events
// for replies other callers speak through Voicebox itself (T18).
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const idOf = data => {
  const id = parseJson(Buffer.from(data || '{}'))?.generation_id;
  return typeof id === 'string' && ID.test(id) ? id : undefined;
};
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
      if (type === 'speak-start') feed.emit('start', { at: performance.now(), id: idOf(data) });
      else if (type === 'speak-end') feed.emit('end', { at: performance.now(), id: idOf(data) });
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
export function makeEngine({ port, profile, timeoutMs = 15_000, warmMs = 60_000, speakMs = 60_000, maxWavBytes = MAX_WAV }) {
  let voice = null; // the profile's engine and language, once read
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
    // A reply as audio (T18): the WAV for `text` in the settings' profile, from
    // the route that generates without playing. The text goes in a JSON body and
    // nowhere else. The engine to ask for is the profile's own, read once from
    // /profiles and kept: Voicebox refuses a preset profile on any other. Null
    // when anything fails, so a caller never plays what is not a WAV.
    async synthesize(text) {
      if (typeof text !== 'string' || !text) return null;
      if (!voice) {
        const res = await call(port, { method: 'GET', path: '/profiles', headers: { accept: 'application/json' } });
        const list = res?.status === 200 ? parseJson(res.body) : null;
        const p = Array.isArray(list) ? list.find(x => x && x.id === profile) : null;
        const kind = p && (typeof p.preset_engine === 'string' ? p.preset_engine : p.default_engine);
        if (typeof kind !== 'string' || !kind) return null;
        voice = { engine: kind, language: typeof p.language === 'string' && p.language ? p.language : 'en' };
      }
      const body = Buffer.from(JSON.stringify({ profile_id: profile, text, language: voice.language, engine: voice.engine }), 'utf8');
      const res = await call(port, { method: 'POST', path: '/generate/stream', body, timeoutMs: speakMs, maxBytes: maxWavBytes, headers: { 'content-type': 'application/json', 'content-length': body.length, accept: 'audio/wav' } });
      if (!res || res.status !== 200 || res.body.length < 44 || res.body.toString('latin1', 0, 4) !== 'RIFF') return null;
      return res.body;
    },
    // Replies that other callers speak through Voicebox itself still show on this
    // feed; the listener counts them, and no more (T18).
    playback: () => speakFeed(port),
  };
}
