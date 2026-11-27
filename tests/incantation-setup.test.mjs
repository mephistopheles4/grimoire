// Tests of setup.mjs (docs/spec/0003-incantation-retire-voicebox-and-kokoro.md),
// with a fake engine, a made-up listing and a fake recorder file system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { stampOf } from '../skills/incantation/scripts/capture/ffmpeg.mjs';
import { deviceDigest, parseSettings, readKey, ensureState, settingsPath } from '../skills/incantation/scripts/lib.mjs';
import { ARCHIVES, FILES } from '../skills/incantation/scripts/runtime/pins.mjs';
import { PARTS, platformKey, runtimeDir } from '../skills/incantation/scripts/runtime/install.mjs';
import { LINES, runSetup } from '../skills/incantation/scripts/setup.mjs';

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const RECORDER = win ? win32.join(BIN, 'ffmpeg.exe') : posix.join(BIN, 'ffmpeg');
const fs = { isFile: p => p === RECORDER, realpath: p => p };
const LISTING = {
  win32: '[in#0 @ 0] "Desk Mic One" (audio)\n[in#0 @ 0] "Headset Mic Two" (audio)\n',
  darwin: '[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Desk Mic One\n[AVFoundation indev @ 0x1] [1] Headset Mic Two\n',
  linux: '* made_up.one [Desk Mic One]\n  made_up.two [Headset Mic Two]\n',
}[process.platform] ?? '* made_up.one [Desk Mic One]\n  made_up.two [Headset Mic Two]\n';
const DEVICES = {
  win32: [{ name: 'Desk Mic One', id: 'Desk Mic One' }, { name: 'Headset Mic Two', id: 'Headset Mic Two' }],
  darwin: [{ name: 'Desk Mic One', id: ':0' }, { name: 'Headset Mic Two', id: ':1' }],
}[process.platform] ?? [{ name: 'Desk Mic One', id: 'made_up.one' }, { name: 'Headset Mic Two', id: 'made_up.two' }];
const STAMP = stampOf(DEVICES);
const engine = { profiles: async () => [{ id: 'everly', name: 'Everly', engine: 'phonon' }, { id: 'bad id!', name: 'x', engine: '' }] };

function setup(argv, over = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-setup-'));
  const done = runSetup(argv, { home, pathValue: BIN, startDir: home, fs, list: async () => LISTING, engine, ...over });
  return done.then(r => ({ ...r, home, remove: () => rmSync(home, { recursive: true, force: true }) }));
}

test('devices prints only the stamp and index-and-name lines, never an id or a path', async t => {
  const r = await setup(['devices']);
  t.after(r.remove);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [`stamp ${STAMP}`, '0 Desk Mic One', '1 Headset Mic Two']);
  assert.ok(!r.lines.join('\n').includes(BIN));
});

test('profiles prints id, name and engine, and leaves out an id outside the settings range', async t => {
  const r = await setup(['profiles']);
  t.after(r.remove);
  assert.deepEqual(r.lines, ['everly Everly (phonon)']);
});

test('choose writes settings whose every key is in range, with the pinned recorder and the mic as keyed digests (S13.5)', async t => {
  const r = await setup(['choose', '1', STAMP, 'everly']);
  t.after(r.remove);
  assert.deepEqual(r.lines, [LINES.saved]);
  const text = readFileSync(settingsPath(r.home), 'utf8');
  const s = parseSettings(text);
  const key = readKey(r.home);
  assert.ok(key, 'the key is made at the first choose');
  assert.deepEqual(s.device, { index: 1, stamp: STAMP, id: deviceDigest(key, DEVICES[1].id), name: deviceDigest(key, DEVICES[1].name) });
  assert.deepEqual({ ...s, device: null }, { engine: 'sherpa', endOfSpeechMs: 1500, profile: 'everly', device: null, recorder: RECORDER });
  assert.ok(!text.includes(DEVICES[1].name) && !text.includes(DEVICES[1].id), 'no device name or id is kept in the file');
});

test('a second choose keeps the key, so the digests stay comparable', async t => {
  const r = await setup(['choose', '1', STAMP, 'everly']);
  t.after(r.remove);
  const first = readKey(r.home);
  const again = await runSetup(['choose', '0', STAMP, 'everly'], { home: r.home, pathValue: BIN, startDir: r.home, fs, list: async () => LISTING, engine });
  assert.deepEqual(again.lines, [LINES.saved]);
  assert.deepEqual(readKey(r.home), first);
});

test('settings with a mic id or name that is not a digest, or an extra key, are refused', () => {
  const base = { engine: 'sherpa', profile: 'everly', recorder: RECORDER };
  const device = d => JSON.stringify({ ...base, device: d });
  assert.doesNotThrow(() => parseSettings(device({ index: 0, stamp: STAMP })), 'settings from before');
  assert.doesNotThrow(() => parseSettings(device({ index: 0, stamp: STAMP, id: 'a'.repeat(64), name: 'b'.repeat(64) })));
  for (const bad of [{ id: 'Desk Mic One' }, { name: 'a'.repeat(63) }, { id: 'A'.repeat(64) }, { id: 5 }, { other: 'x' }]) assert.throws(() => parseSettings(device({ index: 0, stamp: STAMP, ...bad })), { message: 'settings' }, JSON.stringify(bad));
});

test('choose refuses a stale stamp, an out-of-range index, an unknown profile and a malformed call, writing nothing', async t => {
  const cases = [
    [['choose', '0', '0123456789abcdef', 'everly'], LINES.stale],
    [['choose', '7', STAMP, 'everly'], LINES.index],
    [['choose', '0', STAMP, 'not-a-profile'], LINES.profile],
    [['choose', '0', STAMP, '../x'], LINES.profile],
    [['choose', '0', STAMP], LINES.usage],
    [['choose', '-1', STAMP, 'everly'], LINES.usage],
    [['runtime', 'plan', 'phonon'], LINES.usage],
    [['runtime', 'install', 'phonon'], LINES.usage],
    [['runtime', 'verify', 'phonon'], LINES.usage],
    [['runtime'], LINES.usage],
    [['runtime', 'plan', ''], LINES.usage],
  ];
  for (const [argv, line] of cases) {
    const r = await setup(argv);
    assert.deepEqual(r.lines, [line], argv.join(' '));
    if (line === LINES.usage) assert.equal(r.code, 2, argv.join(' '));
    assert.throws(() => readFileSync(settingsPath(r.home)));
    r.remove();
  }
});

test('no trusted recorder, no microphone, or no installed voice each give a fixed line', async t => {
  for (const [argv, over, line] of [
    [['devices'], { pathValue: '' }, LINES.recorder],
    [['devices'], { list: async () => 'nothing here\n' }, LINES.devices],
    [['profiles'], { engine: { profiles: async () => [] } }, LINES.voices],
  ]) {
    const r = await setup(argv, over);
    assert.deepEqual(r.lines, [line]);
    r.remove();
  }
  assert.equal(LINES.voicebox, undefined);
});

const UV = win ? win32.join(BIN, 'uv.exe') : posix.join(BIN, 'uv');
const fsUv = { ...fs, isFile: p => p === RECORDER || p === UV };
const ARCH = 'x64';
const basesOf = part => FILES.filter(g => g.part === part).map(g => g.base);
const notFound = log => async url => (log.push(url.pathname), { status: 404, headers: {}, body: (async function* () {})() });
const failingUv = async () => ({ code: 1, stdout: '' });

function put(home, rel, size) {
  const p = join(runtimeDir(home), ...rel.split('/'));
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
  truncateSync(p, size);
}
const lay = (home, part) => {
  if (part === 'addon') {
    const key = platformKey(process.platform, process.arch);
    for (const a of ARCHIVES.filter(a => a.platform === null || a.platform === key)) for (const [f, size] of a.files) put(home, `${a.dest}/${f}`, size);
    return;
  }
  if (part === 'python') {
    const py = win ? 'Scripts/python.exe' : 'bin/python';
    put(home, `py/${py}`, 0);
    writeFileSync(join(runtimeDir(home), 'py.manifest.json'), JSON.stringify({ files: [[py, 0]] }));
    return;
  }
  for (const g of FILES.filter(g => g.part === part)) for (const [f, size] of g.files) put(home, `${g.dest}${f}`, size);
};

test('runtime plan checks all six unified parts and exits 1 without uv', async () => {
  const bare = await setup(['runtime', 'plan'], { fs: fsUv, arch: ARCH });
  bare.remove();
  assert.equal(bare.code, 0);
  assert.ok(bare.lines.includes('uv found'), bare.lines.join('\n'));
  for (const part of PARTS) assert.ok(bare.lines.some(l => l.startsWith(`${part} `) && !l.includes('skipped')), part);
  const noUv = await setup(['runtime', 'plan'], { fs: fsUv, arch: ARCH, pathValue: '' });
  noUv.remove();
  assert.equal(noUv.code, 1);
  assert.ok(noUv.lines.includes('uv not found') && noUv.lines.includes('uv is required to install and run incantation'), noUv.lines.join('\n'));
});

test('runtime install fetches all shared parts with uv and refuses early without uv or disk', async () => {
  const install = async (over = {}) => {
    const log = [];
    const r = await setup(['runtime', 'install'], { fs: fsUv, arch: ARCH, transport: notFound(log), runUv: failingUv, free: () => Infinity, env: {}, ...over });
    r.remove();
    return { ...r, log };
  };
  const asked = (log, part) => log.some(p => basesOf(part).some(b => p.startsWith(b)));

  const withUv = await install();
  assert.ok(asked(withUv.log, 'hearing') && asked(withUv.log, 'detector'));
  assert.equal(withUv.code, 1, 'fake 404 transport refuses downloads');

  const noUv = await install({ pathValue: '' });
  assert.equal(noUv.code, 1);
  assert.deepEqual(noUv.lines, ['python failed no uv']);
  assert.deepEqual(noUv.log, [], 'nothing is fetched when uv is missing');

  const full = await install({ free: () => 0 });
  assert.equal(full.code, 1);
  assert.deepEqual(full.lines, ['install: not enough free disk space on the home drive']);
  assert.deepEqual(full.log, [], 'nothing is fetched when disk is full');
});

test('runtime verify reports every part as not installed on an empty home, and fails on a file whose bytes are not the pinned ones', async t => {
  const empty = await setup(['runtime', 'verify'], { arch: ARCH });
  empty.remove();
  assert.deepEqual([empty.lines, empty.code], [PARTS.map(p => `${p} skipped not installed`), 0]);
  const home = mkdtempSync(join(tmpdir(), 'incantation-setup-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  ensureState(home);
  lay(home, 'detector');
  const r = await runSetup(['runtime', 'verify'], { home, arch: ARCH });
  assert.equal(r.code, 1);
  const [[file]] = FILES.find(g => g.part === 'detector').files;
  assert.ok(r.lines.includes(`detector failed ${file}`), r.lines.join('\n'));
});

// profiles with the real sherpa engine, on the home it is handed.
test('profiles with the sherpa engine lists everly when all six runtime parts are present, and says so when not', async t => {
  const none = await setup(['profiles'], { engine: undefined });
  none.remove();
  assert.deepEqual([none.lines, none.code], [[LINES.voices], 1]);
  const home = mkdtempSync(join(tmpdir(), 'incantation-setup-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  ensureState(home);
  for (const part of PARTS) lay(home, part);
  const r = await runSetup(['profiles'], { home, pathValue: BIN, startDir: home, fs });
  assert.deepEqual([r.lines, r.code], [['everly everly (phonon)'], 0]);
});
