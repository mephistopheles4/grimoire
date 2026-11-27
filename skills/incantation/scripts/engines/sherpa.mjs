// The sherpa-onnx engine (docs/spec/0003-incantation-retire-voicebox-and-kokoro.md).
// Parakeet TDT 0.6b v2 hears, Phonon speaks. The addon and the models come from
// the runtime folder (runtime/install.mjs fetches and checks them); nothing here
// downloads, opens a port or changes PATH. The provider is `cpu` everywhere (O6).
// Parakeet loads once in the listener's own process; Phonon runs in its own
// worker, from the runtime's own interpreter.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VOICES, isProfile, stateDir } from '../lib.mjs';
import { checkRuntime, platformKey, pythonExe, runtimeDir, workerEnv } from '../runtime/install.mjs';

export { VOICES, isProfile };

const RATE = 16_000;
const PHONON_WORKER = fileURLToPath(new URL('./phonon-worker.py', import.meta.url));
const PROVIDER = 'cpu';

// One long-running Phonon process; replies come back in order, one per line.
// No shell, `-I`, the runtime's own interpreter, stdin and stdout pipes only,
// stderr discarded, the state folder as its working folder, a named
// environment; it exits when its stdin closes.
function phononWorker(voice, { python, home, spawn, env, platform }) {
  const child = spawn(python, ['-I', PHONON_WORKER, voice], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false, cwd: stateDir(home), env: workerEnv(home, env, platform) });
  const waiting = [];
  let ready;
  const readyP = new Promise((res, rej) => {
    ready = { res, rej };
  });
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
      try {
        msg = JSON.parse(line);
      } catch {}
      if (msg?.ready) {
        ready.res();
        continue;
      }
      waiting.shift()?.(msg?.ok ? msg : null);
    }
  });
  const fail = () => {
    ready.rej(new Error('phonon'));
    while (waiting.length) waiting.shift()(null);
  };
  child.on('exit', fail);
  child.on('error', fail);
  return {
    ready: readyP,
    say(text) {
      return new Promise(res => {
        if (child.exitCode !== null) return res(null);
        waiting.push(res);
        child.stdin.write(`${JSON.stringify({ text })}\n`);
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

// `load` loads the addon, `spawn` starts a worker, `exists` checks a file: all
// replaceable by a test. Everything else comes from the settings and the home.
export function makeEngine({ profile, home = homedir(), platform = process.platform, arch = process.arch, env = process.env, load, spawn = nodeSpawn, exists = existsSync, pins } = {}) {
  let sherpa = null;
  let asr = null;
  const key = platformKey(platform, arch);
  const root = runtimeDir(home);
  const phononVoice = isProfile(profile) ? VOICES[profile] : undefined;
  let phonon = null;

  const loadAddon = load ?? (() => createRequire(import.meta.url)(join(root, 'node_modules', 'sherpa-onnx-node')));
  const loadModels = () => {
    if (sherpa) return;
    if (!phononVoice) throw new Error('profile');
    sherpa = loadAddon();
    phonon = phononWorker(phononVoice, { python: pythonExe(home, platform), home, spawn, env, platform });
    const p = join(root, 'parakeet');
    asr = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: join(p, 'encoder.int8.onnx'), decoder: join(p, 'decoder.int8.onnx'), joiner: join(p, 'joiner.int8.onnx') },
        tokens: join(p, 'tokens.txt'),
        modelType: 'nemo_transducer',
        numThreads: 4,
        provider: PROVIDER,
        debug: false,
      },
      decodingMethod: 'greedy_search',
    });
  };

  // pcm: 16-bit mono 16 kHz, as the listener captures it.
  const transcribe = async pcm => {
    try {
      loadModels();
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
    capture: 'ffmpeg',
    tailMs: VALUES.tailMs.value,
    // Cheap: all six runtime parts and the worker interpreter are present.
    async health() {
      if (!checkRuntime(home, key, pins).ok) return false;
      return exists(pythonExe(home, platform));
    },
    transcribe,
    // A voice is offered only when the full runtime and its worker interpreter
    // are present: a voice the guard would refuse is not one to pick.
    async profiles() {
      const rt = checkRuntime(home, key, pins);
      return rt.ok && exists(pythonExe(home, platform)) ? Object.keys(VOICES).map(id => ({ id, name: id, engine: 'phonon' })) : [];
    },
    // Loads Parakeet and the Phonon worker and runs each once, so the first real line is warm.
    async warm() {
      const began = performance.now();
      loadModels();
      await phonon.ready;
      if ((await transcribe(Buffer.alloc(RATE * 2))) === null) throw new Error('warm');
      return Math.round(performance.now() - began);
    },
    async synthesize(text) {
      if (typeof text !== 'string' || !text) return null;
      try {
        loadModels();
        const r = await phonon.say(text);
        if (!r) return null;
        const pcm = Buffer.from(r.pcm, 'base64');
        const samples = new Float32Array(pcm.length / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
        return wav16(samples, r.rate);
      } catch {
        return null;
      }
    },
  };
}
