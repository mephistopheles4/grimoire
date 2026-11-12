// Tests of launch.mjs (docs/spec/incantation.md, S4.1 a; claim 18). A fixture
// home holds a VoiceMode install made of fake engine programs and start
// scripts shaped like the real ones; the fake engines listen on the socket they
// are given and answer with the command line and environment they got. They
// skip on win32 and say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLaunch, stopLaunch } from '../plugins/incantation/skills/incantation/scripts/launch.mjs';
import { cleanup, freePort, makeHome, onWindows } from './incantation-helpers.mjs';

const LAUNCH = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/launch.mjs', import.meta.url));
const skip = onWindows ? 'fake engines, sockets and /proc: skipped on win32, run in the athanor container and in CI' : false;
const NODE = process.execPath;

// An engine: listens on the socket it is given, answers with what it was run with.
const FAKE_ENGINE = `#!${NODE}
const fs = require('node:fs');
const http = require('node:http');
const args = process.argv.slice(2);
const read = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };
try { fs.appendFileSync('fake-starts', 'x'); } catch {}
if (read('fake-mode') === 'exit') process.exit(1);
const at = args.indexOf('--uds') >= 0 ? args.indexOf('--uds') : args.indexOf('--host');
http.createServer((req, res) => res.end(JSON.stringify({ argv: args, env: process.env, cwd: process.cwd() }))).listen(args[at + 1]);
`;

// VoiceMode's start script for whisper, as installed (v9.0.2), trimmed to the
// lines that decide how the server is run.
const WHISPER_SCRIPT = `#!/usr/bin/env bash
set -o nounset -o pipefail -o errexit
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
WHISPER_DIR="$(dirname "$SCRIPT_DIR")"
VOICEMODE_DIR="$HOME/.voicemode"
LOG_DIR="$VOICEMODE_DIR/logs/whisper"
mkdir -p "$LOG_DIR"
log() {
    echo "[$(date)] $1" >> "$STARTUP_LOG"
}
voicemode_load_env_file() {
    local file="$1" line key val
    export "$key=$val"
}
MODEL_NAME="\${VOICEMODE_WHISPER_MODEL:-base}"
MODEL_PATH="$WHISPER_DIR/models/ggml-$MODEL_NAME.bin"
WHISPER_PORT="\${VOICEMODE_WHISPER_PORT:-2022}"
if [ -n "\${VOICEMODE_WHISPER_THREADS:-}" ]; then
    WHISPER_THREADS="$VOICEMODE_WHISPER_THREADS"
else
    WHISPER_THREADS=$(nproc 2>/dev/null || echo 4)
fi
if [ -f "$WHISPER_DIR/build/bin/whisper-server" ]; then
    SERVER_BIN="$WHISPER_DIR/build/bin/whisper-server"
fi
cd "$WHISPER_DIR"
"$SERVER_BIN" \\
    --host 0.0.0.0 \\
    --port "$WHISPER_PORT" \\
    --model "$MODEL_PATH" \\
    --inference-path /v1/audio/transcriptions \\
    --threads "$WHISPER_THREADS" \\
    --convert &
SERVER_PID=$!
`;

// Kokoro-FastAPI's start script, as it stands in the repository VoiceMode clones.
const KOKORO_SCRIPT = `#!/bin/bash
PROJECT_ROOT=$(pwd)
export USE_GPU=false
export PYTHONPATH=$PROJECT_ROOT:$PROJECT_ROOT/api
export MODEL_DIR=src/models
export VOICES_DIR=src/voices/v1_0
export WEB_PLAYER_PATH=$PROJECT_ROOT/web
export ESPEAK_DATA_PATH=/usr/lib/x86_64-linux-gnu/espeak-ng-data
uv pip install -e ".[cpu]"
uv run --no-sync python docker/scripts/download_model.py --output api/src/models/v1_0
uv run --no-sync uvicorn api.src.main:app --host "\${HOST:-0.0.0.0}" --port "\${PORT:-8880}"
`;

function put(path, text, mode = 0o644) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
}

// A home with VoiceMode installed in it.
function install({ env = '', whisper = WHISPER_SCRIPT, kokoro = KOKORO_SCRIPT, model = 'base' } = {}) {
  const h = makeHome({ stt: 2022, tts: 8880 });
  if (env) writeFileSync(join(h.home, '.voicemode', 'voicemode.env'), `${env}\n`, { flag: 'a' });
  const w = join(h.home, '.voicemode', 'services', 'whisper');
  put(join(w, 'bin', 'start-whisper-server.sh'), whisper, 0o755);
  put(join(w, 'build', 'bin', 'whisper-server'), FAKE_ENGINE, 0o755);
  if (model) put(join(w, 'models', `ggml-${model}.bin`), 'model');
  const k = join(h.home, '.voicemode', 'services', 'kokoro');
  put(join(k, 'start-cpu.sh'), kokoro, 0o755);
  put(join(h.home, '.local', 'bin', 'uv'), FAKE_ENGINE, 0o755);
  return { ...h, whisperDir: w, kokoroDir: k };
}

const ask = socketPath => new Promise((resolve, reject) => {
  const req = request({ socketPath, path: '/', agent: false, timeout: 1500 }, res => {
    let out = '';
    res.on('data', d => (out += d));
    res.on('end', () => resolve(JSON.parse(out)));
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy());
  req.end();
});
const waitUp = async socketPath => {
  for (let i = 0; i < 100; i++) {
    try {
      return await ask(socketPath);
    } catch {
      await new Promise(r => setTimeout(r, 30));
    }
  }
  throw new Error(`nothing on ${socketPath}`);
};
const waitFor = async (test, ms = 4000) => {
  for (let i = 0; i < ms / 20 && !test(); i++) await new Promise(r => setTimeout(r, 20));
};

// What is in the home outside ~/.incantation/, by path, size and time, leaving
// out the fake engines' own record files.
const outside = home => {
  const seen = {};
  for (const e of readdirSync(home, { withFileTypes: true, recursive: true })) {
    const path = join(e.parentPath ?? e.path, e.name);
    if (path.startsWith(join(home, '.incantation')) || e.name.startsWith('fake-')) continue;
    const st = statSync(path);
    seen[path] = e.isFile() ? `${st.size}:${st.mtimeMs}` : 'dir';
  }
  return seen;
};

test('each engine starts with a socket in the run folder, its server arguments from the start script, and no host or port', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const l = await startLaunch({ home: h.home, gpu: false });
  c.add(() => l.stop());
  const stt = await waitUp(join(h.run, 'stt.sock'));
  const tts = await waitUp(join(h.run, 'tts.sock'));
  const model = join(h.whisperDir, 'models', 'ggml-base.bin');
  assert.deepEqual(stt.argv.slice(0, 4), ['--host', join(h.run, 'stt.sock'), '--model', model]);
  assert.deepEqual(stt.argv.slice(4, 7), ['--inference-path', '/v1/audio/transcriptions', '--threads']);
  assert.match(stt.argv[7], /^\d+$/);
  assert.equal(stt.argv[8], '--convert');
  assert.equal(stt.argv.includes('--port'), false);
  assert.equal(stt.argv.includes('0.0.0.0'), false);
  assert.equal(stt.cwd, h.whisperDir);
  assert.deepEqual(tts.argv, ['run', '--no-sync', 'uvicorn', 'api.src.main:app', '--uds', join(h.run, 'tts.sock')]);
  assert.equal(tts.cwd, h.kokoroDir);
  assert.equal(tts.env.USE_GPU, 'false');
  assert.equal(tts.env.PYTHONPATH, `${h.kokoroDir}:${h.kokoroDir}/api`);
  assert.equal(tts.env.WEB_PLAYER_PATH, `${h.kokoroDir}/web`);
  assert.equal(tts.env.ENABLE_WEB_PLAYER, 'false');
  assert.equal(tts.env.CORS_ENABLED, 'false');
  assert.deepEqual(Object.keys(stt.env).sort(), ['HOME', 'LANG', 'PATH']);
  assert.equal(statSync(h.run).mode & 0o777, 0o700);
});

test('it writes nothing outside ~/.incantation/ and edits no file VoiceMode installed', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const before = outside(h.home);
  const l = await startLaunch({ home: h.home, gpu: false });
  await waitUp(join(h.run, 'stt.sock'));
  await waitUp(join(h.run, 'tts.sock'));
  await l.stop();
  assert.deepEqual(outside(h.home), before);
});

test('a start script is read as data: an unknown variable or substitution is refused and nothing is run', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const marker = join(process.env.TMPDIR ?? '/tmp', `incantation-ran-${process.pid}`);
  c.add(() => rmSync(marker, { force: true }));
  const bad = [
    WHISPER_SCRIPT.replace('--port "$WHISPER_PORT"', '--port "$NOT_SET"').replace('--threads "$WHISPER_THREADS"', '--threads "$NOT_SET"'),
    WHISPER_SCRIPT.replace('--convert', `--convert "$(touch ${marker})"`),
    WHISPER_SCRIPT.replace('--convert', `--convert \`touch ${marker}\``),
  ];
  for (const whisper of bad) {
    const h = install({ whisper });
    c.add(h.remove);
    await assert.rejects(() => startLaunch({ home: h.home, gpu: false }), { reason: 'stt arguments' });
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(h.run, 'stt.sock')), false);
  }
});

test('a missing model, script or program is refused with a fixed reason', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const noModel = install({ model: null });
  c.add(noModel.remove);
  await assert.rejects(() => startLaunch({ home: noModel.home, gpu: false }), { reason: 'stt arguments' });
  const noScript = install();
  c.add(noScript.remove);
  rmSync(join(noScript.whisperDir, 'bin', 'start-whisper-server.sh'));
  await assert.rejects(() => startLaunch({ home: noScript.home, gpu: false }), { reason: 'stt script' });
  const noUv = install();
  c.add(noUv.remove);
  await assert.rejects(() => startLaunch({ home: noUv.home, gpu: false, uvCandidates: [join(noUv.home, 'absent')] }), { reason: 'tts program' });
  const writable = install();
  c.add(writable.remove);
  chmodSync(join(writable.whisperDir, 'build', 'bin', 'whisper-server'), 0o777);
  await assert.rejects(() => startLaunch({ home: writable.home, gpu: false }), { reason: 'stt program' });
});

test('the settings file picks the model and threads; the environment and the start folder do not', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install({ env: 'VOICEMODE_WHISPER_MODEL=small\nVOICEMODE_WHISPER_THREADS=3', model: 'small' });
  c.add(h.remove);
  put(join(h.whisperDir, 'models', 'ggml-large.bin'), 'model');
  process.env.VOICEMODE_WHISPER_MODEL = 'large';
  c.add(() => delete process.env.VOICEMODE_WHISPER_MODEL);
  const l = await startLaunch({ home: h.home, gpu: false });
  c.add(() => l.stop());
  const stt = await waitUp(join(h.run, 'stt.sock'));
  assert.equal(stt.argv[stt.argv.indexOf('--model') + 1], join(h.whisperDir, 'models', 'ggml-small.bin'));
  assert.equal(stt.argv[stt.argv.indexOf('--threads') + 1], '3');
});

test('a project-level VoiceMode settings file found from the start folder is refused; a planted module there is ignored', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const work = join(h.home, 'work');
  mkdirSync(work);
  put(join(work, '.voicemode.env'), 'VOICEMODE_WHISPER_MODEL=large\n');
  await assert.rejects(() => startLaunch({ home: h.home, projectDir: work, gpu: false }), { reason: 'project settings' });
  assert.equal(existsSync(join(h.run, 'stt.sock')), false);
  rmSync(join(work, '.voicemode.env'));
  put(join(work, 'lib.mjs'), 'throw new Error("planted")');
  put(join(work, 'node_modules', 'x', 'index.js'), 'throw new Error("planted")');
  const l = await startLaunch({ home: h.home, projectDir: work, gpu: false });
  c.add(() => l.stop());
  await waitUp(join(h.run, 'stt.sock'));
});

test('a stale socket of its own is removed; a socket that answers means it is already running', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  spawnSync(NODE, ['-e', `require('node:net').createServer().listen(${JSON.stringify(join(h.run, 'stt.sock'))}, () => process.kill(process.pid, 'SIGKILL'))`]);
  assert.equal(existsSync(join(h.run, 'stt.sock')), true);
  const l = await startLaunch({ home: h.home, gpu: false });
  c.add(() => l.stop());
  await waitUp(join(h.run, 'stt.sock'));
  await waitUp(join(h.run, 'tts.sock'));
  await assert.rejects(() => startLaunch({ home: h.home, gpu: false }), { reason: 'running' });
  assert.equal((await ask(join(h.run, 'stt.sock'))).cwd, h.whisperDir, 'the first is untouched');
});

test('an engine that exits is restarted at most three times a minute, then stopped, and the other keeps running', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  writeFileSync(join(h.whisperDir, 'fake-mode'), 'exit');
  const l = await startLaunch({ home: h.home, gpu: false, knobs: { restartDelayMs: 20 } });
  c.add(() => l.stop());
  await waitFor(() => l.status().stt.state === 'stopped');
  assert.equal(l.status().stt.state, 'stopped');
  assert.equal(readFileSync(join(h.whisperDir, 'fake-starts'), 'utf8').length, 4, 'one start and three restarts');
  assert.equal((await waitUp(join(h.run, 'tts.sock'))).cwd, h.kokoroDir);
  assert.equal(l.status().tts.state, 'running');
});

test('stop signals only the engines it started, after checking each is the process it recorded', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const decoy = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)']);
  c.add(() => decoy.kill());
  const record = join(h.run, 'launch.pid');
  const pids = { supervisor: decoy.pid, engines: { stt: { pid: decoy.pid, start: '1', program: 'whisper-server' }, tts: { pid: decoy.pid, start: '1', program: 'uv' } } };
  writeFileSync(record, JSON.stringify(pids));
  assert.equal(stopLaunch({ home: h.home }), 0);
  assert.equal(decoy.exitCode, null, 'a pid that is not what was recorded is left alone');

  const l = await startLaunch({ home: h.home, gpu: false });
  c.add(() => l.stop());
  await waitUp(join(h.run, 'stt.sock'));
  await waitUp(join(h.run, 'tts.sock'));
  const { pid: stt } = l.status().stt;
  const { pid: tts } = l.status().tts;
  // The in-process supervisor is not a launch.mjs, so only the two engines count.
  assert.equal(stopLaunch({ home: h.home }), 2);
  await waitFor(() => !existsSync(`/proc/${stt}`) && !existsSync(`/proc/${tts}`), 4000);
  assert.equal(decoy.exitCode, null);
});

test('the command line runs, stops and prints only fixed lines', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const work = join(h.home, 'work');
  mkdirSync(work);
  const env = { HOME: h.home, USERPROFILE: h.home, PATH: process.env.PATH };
  const out = [];
  const run = spawn(NODE, [LAUNCH, 'run'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.add(() => run.kill());
  run.stdout.on('data', d => out.push(String(d)));
  run.stderr.on('data', d => out.push(String(d)));
  const closed = new Promise(r => run.on('close', r));
  await waitUp(join(h.run, 'stt.sock'));
  await waitUp(join(h.run, 'tts.sock'));
  assert.equal(existsSync(join(h.run, 'launch.pid')), true);
  const stopped = spawnSync(NODE, [LAUNCH, 'stop'], { cwd: work, env, encoding: 'utf8', timeout: 8000 });
  assert.equal(stopped.stdout, 'launch stopped\n');
  await closed;
  assert.deepEqual(out, [], 'the foreground launcher printed nothing');
  assert.equal(existsSync(join(h.run, 'launch.pid')), false);
  assert.equal(existsSync(join(h.run, 'stt.sock')), false);
  assert.equal(spawnSync(NODE, [LAUNCH, 'stop'], { cwd: work, env, encoding: 'utf8' }).stdout, 'launch: not running\n');

  put(join(work, '.voicemode.env'), 'X=1\n');
  const refused = spawnSync(NODE, [LAUNCH, 'run'], { cwd: work, env, encoding: 'utf8', timeout: 8000 });
  assert.equal(refused.stdout, 'launch error: project settings\n');
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, '');
  assert.equal(spawnSync(NODE, [LAUNCH, 'bogus'], { cwd: work, env, encoding: 'utf8' }).stdout, 'usage: launch.mjs run | start | stop\n');
});

test('start detaches a supervisor that outlives the command', { skip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const h = install();
  c.add(h.remove);
  const work = join(h.home, 'work');
  mkdirSync(work);
  const env = { HOME: h.home, USERPROFILE: h.home, PATH: process.env.PATH };
  c.add(() => spawnSync(NODE, [LAUNCH, 'stop'], { cwd: work, env, timeout: 8000 }));
  const started = spawnSync(NODE, [LAUNCH, 'start'], { cwd: work, env, encoding: 'utf8', timeout: 8000 });
  assert.equal(started.stdout, 'launch started\n');
  await waitUp(join(h.run, 'stt.sock'));
  assert.equal(spawnSync(NODE, [LAUNCH, 'stop'], { cwd: work, env, encoding: 'utf8', timeout: 8000 }).stdout, 'launch stopped\n');
  await freePort();
});
