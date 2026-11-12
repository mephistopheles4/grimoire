#!/usr/bin/env node
// The live skill's listener. It records from the microphone through a local
// recorder (ffmpeg), runs the energy gate over the audio, and writes one clip
// per heard turn. It never transcribes: the session does, through its own
// speech tool, and clears the clip afterwards.
//
//   node listen.mjs devices
//   node listen.mjs on --device-index <n> --stamp <hex> --speech-tool <name> [--take]
//   node listen.mjs listen --token <t> --words <n> [--cold] [--timeout <s>]
//   node listen.mjs stop|clear|reset|off --token <t>
//
// Every answer is a line from a fixed set: `LIVE on`, `LIVE held`,
// `LIVE heard`, `LIVE timeout`, `LIVE superseded`, `LIVE off`, `LIVE paused`
// and `LIVE error <reason>`. Heard text and device names are never an argument
// and never reach a shell: the recorder runs with `shell: false`.
//
// Checks run in this order in every command: arguments, the state folder, the
// token, the lock, the platform, the recorder, then the spawn.
//
// Runtime: Node 24, no dependencies.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RATE, createGate } from './gate.mjs';

const REASONS = ['platform', 'recorder-missing', 'device', 'argument', 'token', 'folder', 'recorder-failed'];
const HEARD_LIMIT = 3; // heard returns before the listener pauses
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const TURN_CAP_MS = 30000; // a turn open at the timeout may run this much longer
const ISO =/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const sleep = ms => new Promise(done => setTimeout(done, ms));

class Live extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const fail = reason => {
  throw new Live(reason);
};

// ---- the recorder ----

const isFile = path => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * The first `ffmpeg.exe` on a Windows PATH value, searching only fully
 * qualified drive folders. An empty, relative, drive-relative, root-relative
 * or network-share entry is skipped, and so is the current folder: a recorder
 * must never come from where the session happens to stand. The file found is
 * then followed to its real path, and that path must still be a drive path: a
 * mapped drive or a link that leads to a network share is refused, and the
 * real path is the one returned. `exists` and `real` are seams for the tests.
 */
export function resolveRecorder(pathValue, exists = isFile, real = realPath) {
  for (let entry of String(pathValue ?? '').split(';')) {
    entry = entry.trim().replace(/^"(.*)"$/, '$1').trim();
    if (!/^[A-Za-z]:[\\/]/.test(entry)) continue;
    const candidate = win32.join(entry, 'ffmpeg.exe');
    if (!exists(candidate)) continue;
    const found = real(candidate);
    if (found && /^[A-Za-z]:[\\/]/.test(found)) return found;
  }
  return null;
}

function realPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

// The test seam: under NODE_ENV=test, a Node script stands in for ffmpeg.
const testRecorder = () => (process.env.NODE_ENV === 'test' && process.env.GRIMOIRE_LIVE_RECORDER ? resolve(process.env.GRIMOIRE_LIVE_RECORDER) : null);

function checkPlatform() {
  if (!testRecorder() && process.platform !== 'win32') fail('platform');
}

/** The recorder as it resolves now, or null. */
function currentRecorder() {
  const test = testRecorder();
  if (test) return isFile(test) ? test : null;
  return resolveRecorder(process.env.PATH ?? process.env.Path);
}

const command = (recorder, args) => (testRecorder() ? { file: process.execPath, args: [recorder, ...args] } : { file: recorder, args });

const clean = text => Array.from(String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')).slice(0, 128).join('');

/** The audio devices the recorder lists, as { name, id }, in the order it lists them. */
function listDevices(recorder, cwd) {
  const { file, args } = command(recorder, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  const run = spawnSync(file, args, { encoding: 'utf8', shell: false, cwd, windowsHide: true, timeout: 15000, stdio: ['ignore', 'ignore', 'pipe'] });
  if (run.error || typeof run.stderr !== 'string') fail('recorder-failed');
  const devices = [];
  let section = null;
  let last = null;
  for (const line of run.stderr.split(/\r?\n/)) {
    const header = /DirectShow (audio|video) devices/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const alt = /Alternative name "(.*)"\s*$/.exec(line);
    if (alt) {
      if (last) last.id = alt[1];
      last = null;
      continue;
    }
    const named = /\[dshow[^\]]*\]\s+"(.+)"(?:\s+\((audio|video|none)\))?\s*$/.exec(line);
    last = null;
    if (!named) continue;
    if ((named[2] ?? section) !== 'audio') continue;
    last = { name: named[1], id: named[1] };
    devices.push(last);
  }
  return devices;
}

const stampOf = devices => createHash('sha256').update(JSON.stringify(devices.map(d => [d.name, d.id]))).digest('hex').slice(0, 16);

// ---- the state folder ----

const inside = (child, parent) => {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** The state folder, made if absent. Refuses a link, and a temp folder outside home. */
function prepareState() {
  let home;
  let temp;
  try {
    home = realpathSync.native(homedir());
    temp = realpathSync.native(tmpdir());
  } catch {
    fail('folder');
  }
  if (!inside(temp, home)) fail('folder');
  const dir = join(temp, 'grimoire-live');
  let stat = null;
  try {
    stat = lstatSync(dir);
  } catch {
    // absent: made below
  }
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('folder');
  } else {
    mkdirSync(dir, { mode: 0o700 });
  }
  let real;
  try {
    real = realpathSync.native(dir);
  } catch {
    fail('folder');
  }
  if (real.toLowerCase() !== dir.toLowerCase() || !inside(real, home)) fail('folder');
  return dir;
}

const file = (dir, name) => join(dir, name);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(path, text) {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
}

const readNumber = path => {
  try {
    const n = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};
const writeNumber = (path, n) => writeAtomic(path, String(n));

const deleteClips = dir => {
  for (const name of readdirSync(dir)) if (/^clip-[0-9a-f]+\.wav$/.test(name)) rmSync(join(dir, name), { force: true });
};

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitGone(pid, ms) {
  if (!pid || pid === process.pid) return;
  for (let waited = 0; alive(pid) && waited < ms; waited += 25) await sleep(25);
}

/** The lock, when the token is the session's own. */
function requireToken(dir, token) {
  if (!/^[0-9a-f]{32}$/.test(token)) fail('token');
  const lock = readJson(file(dir, 'lock.json'));
  if (!lock || lock.token !== token) fail('token');
  return lock;
}

// ---- arguments ----

const COMMANDS = {
  devices: { values: [], flags: [], required: [] },
  on: { values: ['device-index', 'stamp', 'speech-tool'], flags: ['take'], required: ['device-index', 'stamp', 'speech-tool'] },
  listen: { values: ['token', 'words', 'timeout'], flags: ['cold'], required: ['token', 'words'] },
  stop: { values: ['token'], flags: [], required: ['token'] },
  clear: { values: ['token'], flags: [], required: ['token'] },
  reset: { values: ['token'], flags: [], required: ['token'] },
  off: { values: ['token'], flags: [], required: ['token'] },
};

function parseArguments(name, argv) {
  const spec = COMMANDS[name];
  if (!spec) fail('argument');
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || m[1] in opts) fail('argument');
    if (spec.flags.includes(m[1])) opts[m[1]] = true;
    else if (spec.values.includes(m[1]) && i + 1 < argv.length) opts[m[1]] = argv[++i];
    else fail('argument');
  }
  for (const key of spec.required) if (!(key in opts)) fail('argument');
  const count = (text, min, max) => {
    if (!/^\d{1,3}$/.test(text)) fail('argument');
    const n = Number(text);
    if (n < min || n > max) fail('argument');
    return n;
  };
  if (name === 'on') {
    opts.index = count(opts['device-index'], 0, 999);
    if (!/^[0-9a-f]{1,64}$/.test(opts.stamp)) fail('argument');
    if (!TOOL_NAME.test(opts['speech-tool'])) fail('argument');
  }
  if (name === 'listen') {
    opts.words = count(opts.words, 0, 200);
    opts.timeout = 'timeout' in opts ? count(opts.timeout, 1, 600) : 120;
  }
  return opts;
}

// ---- output ----

const out = lines => process.stdout.write(lines.join('\n') + '\n');
const ctx = { dir: null, token: null, tool: null };

/** The line the session reads with every listener return. */
function reminder() {
  const lock = ctx.dir && ctx.token ? readJson(file(ctx.dir, 'lock.json')) : null;
  // The tool name is checked again on every read: a rewritten lock must not put other text in the line.
  const valid = lock && lock.token === ctx.token && TOOL_NAME.test(String(lock.speechTool));
  return valid ? `live mode is on, token ${ctx.token}, speech tool ${lock.speechTool}: speak only at seams` : 'live mode is off';
}

// ---- commands ----

function held(dir) {
  const lock = readJson(file(dir, 'lock.json'));
  out([`LIVE held ${typeof lock?.since === 'string' && ISO.test(lock.since) ? lock.since : 'unknown'}`]);
}

async function turnOn(o) {
  const dir = (ctx.dir = prepareState());
  const lockPath = file(dir, 'lock.json');
  const existing = readJson(lockPath) ?? (statExists(lockPath) ? {} : null);
  if (existing && !o.take) return held(dir);
  checkPlatform();
  const recorder = currentRecorder() ?? fail('recorder-missing');
  const devices = listDevices(recorder, dir);
  if (stampOf(devices) !== o.stamp) fail('device');
  const device = devices[o.index] ?? fail('argument');
  const lock = {
    token: randomBytes(16).toString('hex'),
    since: new Date().toISOString(),
    deviceId: device.id,
    recorder,
    speechTool: o['speech-tool'],
  };
  if (existing) {
    // A take-over stops the old listener first, and waits up to 2 s for it.
    const listener = readJson(file(dir, 'listener.json'));
    writeNumber(file(dir, 'stop'), listener?.seq ?? 0);
    await waitGone(listener?.pid, 2000);
    writeAtomic(lockPath, JSON.stringify(lock));
  } else {
    try {
      writeFileSync(lockPath, JSON.stringify(lock), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') return held(dir);
      throw error;
    }
  }
  // Only now, holding the lock, is anything left over deleted.
  deleteClips(dir);
  for (const name of ['stop', 'heard', 'listener.json']) rmSync(file(dir, name), { force: true });
  out([`LIVE on ${lock.token}`, `device: ${clean(device.name)}`, `recorder: ${clean(win32.dirname(recorder))}`]);
}

const statExists = path => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

function wavOf(pcm) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

async function listenOnce(o) {
  const dir = (ctx.dir = prepareState());
  const lock = requireToken(dir, o.token);
  ctx.token = o.token;
  const heardPath = file(dir, 'heard');
  const stopPath = file(dir, 'stop');
  const lockPath = file(dir, 'lock.json');
  const reply = first => out([first, reminder()]);
  if (readNumber(heardPath) >= HEARD_LIMIT) return reply('LIVE paused');

  checkPlatform();
  const recorder = currentRecorder();
  if (!recorder || recorder.toLowerCase() !== String(lock.recorder).toLowerCase()) fail('recorder-missing');
  if (!listDevices(recorder, dir).some(d => d.id === lock.deviceId)) fail('device');

  // Supersede the running listener: a stop marker for its seq, then a new seq.
  const previous = readJson(file(dir, 'listener.json'));
  const seq = (previous?.seq ?? 0) + 1;
  writeNumber(stopPath, previous?.seq ?? 0);
  writeAtomic(file(dir, 'listener.json'), JSON.stringify({ seq, pid: process.pid }));
  await waitGone(previous?.pid, 1500);
  deleteClips(dir);

  /** Why this listener must end now, or null. */
  const verdict = () => {
    const now = readJson(lockPath);
    if (!now) return 'off';
    if (now.token !== o.token || readNumber(stopPath) >= seq) return 'superseded';
    return null;
  };
  const finish = why => (why === 'off' ? reply('LIVE off') : reply(`LIVE ${why} ${seq}`));

  // Wait out the line just spoken, so the mic does not hear it.
  const waitEnd = Date.now() + (1 + o.words / 2.5 + 0.5 + (o.cold ? 30 : 0)) * 1000;
  while (Date.now() < waitEnd) {
    const why = verdict();
    if (why) return finish(why);
    await sleep(Math.min(50, Math.max(1, waitEnd - Date.now())));
  }

  const { file: exe, args } = command(recorder, [
    '-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-i', `audio=${lock.deviceId}`, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-',
  ]);
  const child = spawn(exe, args, { shell: false, cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const closed = new Promise(done => {
    child.once('close', done);
    child.once('error', done);
  });
  process.once('exit', () => child.kill());

  const gate = createGate();
  const deadline = Date.now() + o.timeout * 1000;
  let timer;
  const result = await new Promise(done => {
    child.stdout.on('data', chunk => {
      for (const event of gate.push(chunk)) {
        if (event.type === 'end') return done({ heard: event.pcm });
      }
    });
    child.once('close', () => done({ error: 'recorder-failed' }));
    child.once('error', () => done({ error: 'recorder-failed' }));
    timer = setInterval(() => {
      const why = verdict();
      if (why) done({ why });
      // A turn still going at the timeout runs to its end.
      // Back-to-back turns must not hold the mic open without end: the overrun has the turn cap too.
      else if (Date.now() >= deadline && (!gate.inTurn || Date.now() >= deadline + TURN_CAP_MS)) done({ why: 'timeout' });
    }, 50);
  });
  clearInterval(timer);
  // The recorder stops on every exit path, and the return waits for it.
  child.kill();
  const hardKill = setTimeout(() => child.kill('SIGKILL'), 3000);
  await closed;
  clearTimeout(hardKill);

  if (result.error) fail(result.error);
  const why = result.why ?? verdict();
  if (why) return finish(why);
  const clip = file(dir, `clip-${randomBytes(8).toString('hex')}.wav`);
  writeFileSync(clip, wavOf(result.heard), { mode: 0o600 });
  writeNumber(heardPath, readNumber(heardPath) + 1);
  reply(`LIVE heard ${seq} ${clip}`);
}

async function stopListener(o) {
  const dir = (ctx.dir = prepareState());
  requireToken(dir, o.token);
  const listener = readJson(file(dir, 'listener.json'));
  writeNumber(file(dir, 'stop'), listener?.seq ?? 0);
  await waitGone(listener?.pid, 1500);
}

async function turnOff(o) {
  const dir = (ctx.dir = prepareState());
  requireToken(dir, o.token);
  const listener = readJson(file(dir, 'listener.json'));
  rmSync(file(dir, 'lock.json'), { force: true });
  await waitGone(listener?.pid, 1500);
  deleteClips(dir);
  for (const name of ['stop', 'heard', 'listener.json']) rmSync(file(dir, name), { force: true });
  out(['LIVE off', reminder()]);
}

async function main(argv) {
  const [name, ...rest] = argv;
  try {
    const o = parseArguments(name, rest);
    if (name === 'devices') {
      const dir = prepareState();
      checkPlatform();
      const devices = listDevices(currentRecorder() ?? fail('recorder-missing'), dir);
      out([`stamp ${stampOf(devices)}`, ...devices.map((d, i) => `${i} ${clean(d.name)}`)]);
    } else if (name === 'on') await turnOn(o);
    else if (name === 'listen') await listenOnce(o);
    else if (name === 'stop') await stopListener(o);
    else if (name === 'off') await turnOff(o);
    else {
      const dir = (ctx.dir = prepareState());
      requireToken(dir, o.token);
      if (name === 'clear') deleteClips(dir);
      else writeNumber(file(dir, 'heard'), 0); // reset
    }
  } catch (error) {
    const reason = error instanceof Live && REASONS.includes(error.reason) ? error.reason : 'folder';
    out(name === 'listen' ? [`LIVE error ${reason}`, reminder()] : [`LIVE error ${reason}`]);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => process.exit(1));
  await main(process.argv.slice(2));
}
