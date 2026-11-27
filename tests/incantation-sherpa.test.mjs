// Tests of engines/sherpa.mjs and the engine table
// (docs/spec/0003-incantation-retire-voicebox-and-kokoro.md), with a fake addon
// and a fake worker. No model, no Python, no real runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEngine, loadEngine } from '../skills/incantation/scripts/engines/index.mjs';
import { makeEngine } from '../skills/incantation/scripts/engines/sherpa.mjs';
import { SETTINGS_DEFAULTS, isProfile, parseSettings, ensureState } from '../skills/incantation/scripts/lib.mjs';
import { PARTS, platformKey, pythonExe, runtimeDir } from '../skills/incantation/scripts/runtime/install.mjs';

const KEY = platformKey(process.platform, process.arch);

// A fake addon that records what it is asked, and returns fixed answers.
function fakeAddon(log) {
  return {
    OfflineRecognizer: class {
      constructor(cfg) {
        log.push(['asr', cfg]);
      }
      createStream() {
        return { acceptWaveform: a => log.push(['wave', a.samples.length]) };
      }
      decode() {
        log.push(['decode']);
      }
      getResult() {
        return { text: '  hello there ' };
      }
    },
  };
}

function fakeSpawn(calls = []) {
  return (file, args, opts) => {
    calls.push({ file, args, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.kill = () => {};
    const pcm = Buffer.alloc(4);
    child.stdin.on('data', () => child.stdout.write(`${JSON.stringify({ ok: true, rate: 24000, pcm: pcm.toString('base64') })}\n`));
    setImmediate(() => child.stdout.write(`${JSON.stringify({ ready: true, rate: 24000 })}\n`));
    return child;
  };
}

// A small table of the same shape as the real one: each part has one file, so
// a fixture can write every file at its pinned size.
const PINS = {
  ARCHIVES: [{ name: 'win', url: '/w', platform: KEY, dest: 'node_modules/w', size: 1, sha256: '0'.repeat(64), sha512: '', files: [['a.node', 3, '0'.repeat(64)]] }],
  FILES: ['hearing', 'detector', 'turn', 'phonon'].map(part => ({ part, src: 'hf', base: '/o/r/resolve/abc/', dest: `${part}/`, files: [['f.bin', 4, '0'.repeat(64)]] })),
  LOCKS: { [KEY]: 'lock-test.txt' },
};

function installFake(home, parts, platform = process.platform) {
  const put = (rel, size) => {
    const p = join(runtimeDir(home), ...rel.split('/'));
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, Buffer.alloc(size));
  };
  if (parts.includes('addon')) put('node_modules/w/a.node', 3);
  if (parts.includes('python')) {
    const py = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    put(`py/${py}`, 0);
    writeFileSync(join(runtimeDir(home), 'py.manifest.json'), JSON.stringify({ files: [[py, 0]] }));
  }
  for (const part of parts.filter(p => p !== 'addon' && p !== 'python')) put(`${part}/f.bin`, 4);
}

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-sherpa-'));
  ensureState(home);
  return { home, remove: () => rmSync(home, { recursive: true, force: true }) };
};

test('claim 16: warm loads Parakeet and the Phonon worker once; transcribe and synthesize return text and a WAV', async () => {
  const f = fixture();
  try {
    const log = [];
    const calls = [];
    const engine = makeEngine({ profile: 'everly', home: f.home, load: () => fakeAddon(log), spawn: fakeSpawn(calls) });
    const ms = await engine.warm();
    assert.ok(Number.isInteger(ms));
    assert.equal(log.filter(l => l[0] === 'asr').length, 1);
    assert.equal(log.filter(l => l[0] === 'decode').length, 1);
    assert.equal(calls.length, 1);
    assert.equal(await engine.transcribe(Buffer.alloc(3200)), 'hello there');
    const wav = await engine.synthesize('Okay.');
    assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(calls.length, 1, 'the worker was started once');
    assert.equal(await engine.synthesize(''), null);
  } finally {
    f.remove();
  }
});

test('claim 16: no provider but cpu is ever passed, and no PATH is changed', async () => {
  const f = fixture();
  const before = process.env.PATH;
  try {
    const log = [];
    const engine = makeEngine({ profile: 'everly', home: f.home, load: () => fakeAddon(log), spawn: fakeSpawn() });
    await engine.warm();
    const providers = JSON.stringify(log.filter(l => l[0] === 'asr'), (k, v) => v);
    assert.deepEqual([...providers.matchAll(/"provider":"([a-z]+)"/g)].map(m => m[1]), ['cpu']);
    assert.equal(process.env.PATH, before);
    for (const name of ['cuda', 'CUDA', 'Ollama']) assert.ok(!providers.includes(name));
  } finally {
    f.remove();
  }
});

test('claim 16: a Phonon voice runs in a worker started with no shell, -I, the runtime interpreter, the state folder and a named environment', async () => {
  const f = fixture();
  try {
    const calls = [];
    const env = { PATH: 'p', HF_TOKEN: 'secret', UV_INDEX_URL: 'x', SystemRoot: 'r' };
    const engine = makeEngine({ profile: 'everly', home: f.home, load: () => fakeAddon([]), spawn: fakeSpawn(calls), env, platform: 'win32', pins: PINS });
    await engine.warm();
    const wav = await engine.synthesize('Hello.');
    assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
    const [{ file, args, opts }] = calls;
    assert.ok(file.startsWith(runtimeDir(f.home)) && /python/i.test(file));
    assert.equal(args[0], '-I');
    assert.equal(args[2], 'Everly');
    assert.equal(opts.shell, false);
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(opts.cwd, join(f.home, '.grimoire', 'incantation'));
    assert.deepEqual(Object.keys(opts.env).sort(), ['HF_HOME', 'HF_HUB_OFFLINE', 'PATH', 'SYSTEMROOT']);
    assert.equal(opts.env.HF_HUB_OFFLINE, '1');
    assert.equal(opts.env.HF_HOME, join(runtimeDir(f.home), 'hf'));
  } finally {
    f.remove();
  }
});

test('claim 16: health and profiles require all six runtime parts and the runtime interpreter', async () => {
  const f = fixture();
  try {
    const engine = (exists = () => true) => makeEngine({ profile: 'everly', home: f.home, pins: PINS, exists });
    assert.equal(await engine().health(), false);
    assert.deepEqual(await engine().profiles(), []);
    installFake(f.home, ['addon', 'hearing', 'detector', 'python', 'turn']);
    assert.equal(await engine().health(), false, 'phonon is still missing');
    assert.deepEqual(await engine().profiles(), []);
    installFake(f.home, ['phonon']);
    assert.equal(await engine().health(), true);
    assert.equal(await engine(() => false).health(), false, 'requires the runtime interpreter');
    assert.deepEqual(await engine().profiles(), [{ id: 'everly', name: 'everly', engine: 'phonon' }]);
    assert.deepEqual(await engine(() => false).profiles(), []);
    writeFileSync(join(runtimeDir(f.home), 'hearing', 'f.bin'), 'x');
    assert.equal(await engine().health(), false, 'a short file fails health');
    assert.deepEqual(await engine().profiles(), [], 'a short file hides profiles');
  } finally {
    f.remove();
  }
});

test('claim 16: missing any single runtime part fails health', async () => {
  for (const missing of PARTS) {
    const f = fixture();
    try {
      installFake(f.home, PARTS.filter(p => p !== missing));
      const engine = makeEngine({ profile: 'everly', home: f.home, pins: PINS, exists: () => true });
      assert.equal(await engine.health(), false, `runtime needs ${missing}`);
    } finally {
      f.remove();
    }
  }
});

test('claim 16: health asks for the runtime interpreter of the platform it runs on', async () => {
  const f = fixture();
  try {
    const other = process.platform === 'win32' ? 'linux' : 'win32';
    const key = platformKey(other, process.arch);
    const pins = { ...PINS, ARCHIVES: PINS.ARCHIVES.map(a => ({ ...a, platform: key })), LOCKS: { [key]: 'lock-test.txt' } };
    installFake(f.home, PARTS, other);
    const asked = [];
    const engine = makeEngine({ profile: 'everly', home: f.home, platform: other, pins, exists: p => (asked.push(p), true) });
    assert.equal(await engine.health(), true);
    assert.deepEqual(asked, [pythonExe(f.home, other)]);
  } finally {
    f.remove();
  }
});

test('claim 16: retired or prototype profiles (bella, toString) never load or synthesize', async () => {
  const f = fixture();
  try {
    assert.equal(isProfile('everly'), true);
    assert.equal(isProfile('bella'), false);
    assert.equal(isProfile('toString'), false);
    for (const profile of ['bella', 'toString', undefined]) {
      const spawned = [];
      const engine = makeEngine({ profile, home: f.home, load: () => fakeAddon([]), spawn: (...a) => spawned.push(a) });
      await assert.rejects(engine.warm(), /profile/);
      assert.equal(await engine.synthesize('Okay.'), null);
      assert.equal(spawned.length, 0);
    }
  } finally {
    f.remove();
  }
});

test('claim 17: the engine table holds sherpa and nothing else', async () => {
  assert.ok(isEngine('sherpa'));
  assert.ok(!isEngine('voicebox') && !isEngine('whisper') && !isEngine('__proto__') && !isEngine(undefined));
  const e = await loadEngine('sherpa', { profile: 'everly' });
  assert.equal(e.name, 'sherpa');
  assert.equal(e.port, undefined);
  assert.equal(e.playback, undefined);
  await assert.rejects(loadEngine('voicebox', {}), /engine/);
});

test('claim 17: parseSettings requires engine, profile (Phonon), device, and recorder, and refuses pre-retirement Voicebox/Kokoro settings', () => {
  assert.deepEqual(SETTINGS_DEFAULTS, { endOfSpeechMs: 1500 });
  const rec = process.platform === 'win32' ? 'C:\\bin\\ffmpeg.exe' : '/bin/ffmpeg';
  const base = { engine: 'sherpa', profile: 'everly', device: { index: 0, stamp: '0123456789abcdef' }, recorder: rec };
  assert.equal(parseSettings(JSON.stringify(base)).engine, 'sherpa');
  // Pre-retirement files: missing engine, unknown key port, Kokoro profile bella.
  assert.throws(() => parseSettings(JSON.stringify({ profile: 'everly', device: base.device, recorder: rec })), /settings/);
  assert.throws(() => parseSettings(JSON.stringify({ ...base, port: 17493 })), /settings/);
  assert.throws(() => parseSettings(JSON.stringify({ ...base, profile: 'bella' })), /settings/);
  assert.equal(parseSettings(JSON.stringify({ ...base, engine: 'voicebox' })).engine, 'voicebox');
});
