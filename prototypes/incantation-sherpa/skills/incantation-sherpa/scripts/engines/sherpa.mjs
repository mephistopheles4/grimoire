// The sherpa-onnx engine: a throwaway trial for grimoire 646. Parakeet TDT 0.6b
// v2 hears, Kokoro 1.0 speaks, both through sherpa-onnx-node 1.13.8, loaded
// once in the listener's own process and kept warm. Nothing here downloads: the
// models and the addon sit in ~/.grimoire/incantation-sherpa-runtime, fetched
// and hash-checked by hand. Not reviewed; the real engine is 646 step 2.

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RT = join(homedir(), '.grimoire', 'incantation-sherpa-runtime');
const RATE = 16_000;
// CUDA 13 and cuDNN 9 libraries already on this machine (trial only).
const CUDA_DIRS = [
  join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'lib', 'ollama', 'cuda_v13'),
  join(homedir(), 'AppData', 'Local', 'uv', 'cache', 'archive-v0', '4Yr30a2V0SYztJs0', 'Lib', 'site-packages', 'torch', 'lib'),
];
// Kokoro 1.0 speaker ids for the voices offered here.
const VOICES = Object.freeze({ bella: 2 });
// Phonon voices, spoken by phonon-worker.py, kept loaded in its own process.
const PHONON = Object.freeze({ everly: 'Everly' });
const PHONON_PY = join(RT, 'phonon-venv', 'Scripts', 'python.exe');
const PHONON_WORKER = fileURLToPath(new URL('./phonon-worker.py', import.meta.url));

// One long-running Phonon process; replies come back in order, one per line.
function phononWorker(voice) {
  const child = spawn(PHONON_PY, ['-I', PHONON_WORKER, voice], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const waiting = [];
  let ready;
  const readyP = new Promise((res, rej) => { ready = { res, rej }; });
  readyP.catch(() => {});
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg = null;
      try { msg = JSON.parse(line); } catch {}
      if (msg?.ready) { ready.res(); continue; }
      waiting.shift()?.(msg?.ok ? msg : null);
    }
  });
  const fail = () => { ready.rej(new Error('phonon')); while (waiting.length) waiting.shift()(null); };
  child.on('exit', fail);
  child.on('error', fail);
  return {
    ready: readyP,
    say(text) {
      return new Promise(res => {
        if (child.exitCode !== null) return res(null);
        waiting.push(res);
        child.stdin.write(JSON.stringify({ text }) + '\n');
      });
    },
  };
}

export const VALUES = Object.freeze({ tailMs: { value: 150, verified: false } });

function wav16(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

export function makeEngine({ port, profile, provider = 'cuda' }) {
  let sherpa = null;
  let tts = null;
  let asr = null;
  const sid = VOICES[profile] ?? VOICES.bella;
  const phononVoice = PHONON[profile];
  let phonon = null;

  const load = () => {
    if (sherpa) return;
    if (provider === 'cuda') process.env.PATH = [...CUDA_DIRS, process.env.PATH].join(';');
    sherpa = createRequire(import.meta.url)(join(RT, 'node_modules', 'sherpa-onnx-node'));
    if (phononVoice) phonon = phononWorker(phononVoice);
    const k = join(RT, 'kokoro');
    if (!phonon) tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: join(k, 'model.onnx'),
          voices: join(k, 'voices.bin'),
          tokens: join(k, 'tokens.txt'),
          dataDir: join(k, 'espeak-ng-data'),
          dictDir: join(k, 'dict'),
          lexicon: join(k, 'lexicon-us-en.txt'),
        },
        numThreads: 4,
        provider,
        debug: false,
      },
      maxNumSentences: 1,
    });
    const p = join(RT, 'parakeet');
    asr = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: join(p, 'encoder.int8.onnx'), decoder: join(p, 'decoder.int8.onnx'), joiner: join(p, 'joiner.int8.onnx') },
        tokens: join(p, 'tokens.txt'),
        modelType: 'nemo_transducer',
        numThreads: 4,
        provider: 'cpu',
        debug: false,
      },
      decodingMethod: 'greedy_search',
    });
  };

  // pcm: 16-bit mono 16 kHz, as the listener captures it.
  const transcribe = async pcm => {
    try {
      load();
      const n = Math.floor(pcm.length / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
      const stream = asr.createStream();
      stream.acceptWaveform({ sampleRate: RATE, samples });
      asr.decode(stream);
      const text = asr.getResult(stream)?.text;
      return typeof text === 'string' ? text.trim() : null;
    } catch {
      return null;
    }
  };

  return {
    name: 'sherpa',
    host: '127.0.0.1',
    port,
    capture: 'ffmpeg',
    tailMs: VALUES.tailMs.value,
    // Cheap: the files are there. Loading is warm()'s job, off the guard's clock.
    async health() {
      const speak = phononVoice ? 'phonon-venv/Scripts/python.exe' : 'kokoro/model.onnx';
      return [speak, 'parakeet/encoder.int8.onnx', 'node_modules/sherpa-onnx-node'].every(f => existsSync(join(RT, f)));
    },
    transcribe,
    async profiles() {
      return [
        ...Object.keys(VOICES).map(id => ({ id, name: id, engine: 'kokoro' })),
        ...Object.keys(PHONON).map(id => ({ id, name: id, engine: 'phonon' })),
      ];
    },
    // Loads both models and runs each once, so the first real line is warm.
    async warm() {
      const began = performance.now();
      load();
      if (phonon) await phonon.ready;
      else tts.generate({ text: 'Okay.', sid, speed: 1.0 });
      if ((await transcribe(Buffer.alloc(RATE * 2))) === null) throw new Error('warm');
      return Math.round(performance.now() - began);
    },
    async synthesize(text) {
      if (typeof text !== 'string' || !text) return null;
      try {
        load();
        if (phonon) {
          const r = await phonon.say(text);
          if (!r) return null;
          const pcm = Buffer.from(r.pcm, 'base64');
          const samples = new Float32Array(pcm.length / 2);
          for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
          return wav16(samples, r.rate);
        }
        const audio = tts.generate({ text, sid, speed: 1.0 });
        return wav16(audio.samples, audio.sampleRate);
      } catch {
        return null;
      }
    },
    // No other caller speaks through this engine, so the feed only opens.
    playback() {
      const feed = new EventEmitter();
      feed.close = () => {};
      setImmediate(() => feed.emit('open'));
      return feed;
    },
  };
}
