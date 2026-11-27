// Tests of guard.mjs (docs/spec/0003-incantation-retire-voicebox-and-kokoro.md),
// on a fake engine, a fake recorder file system and a fixture home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, mkdtempSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { LINES, runGuard } from '../skills/incantation/scripts/guard.mjs';
import { ensureState, settingsPath, writeWhole } from '../skills/incantation/scripts/lib.mjs';
import { ARCHIVES, FILES } from '../skills/incantation/scripts/runtime/pins.mjs';
import { platformKey, pythonExe, runtimeDir } from '../skills/incantation/scripts/runtime/install.mjs';

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const RECORDER = win ? win32.join(BIN, 'ffmpeg.exe') : posix.join(BIN, 'ffmpeg');
const PLANTED = 'sk-planted-fake-key-0123456789abcdef';

const fakeFs = {
  isFile: p => p === RECORDER,
  realpath: p => p,
};

function fixture({ settings = {}, claude, project } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-guard-'));
  ensureState(home);
  writeWhole(settingsPath(home), JSON.stringify({ engine: 'sherpa', profile: 'everly', device: { index: 0, stamp: '0123456789abcdef' }, recorder: RECORDER, endOfSpeechMs: 1000, ...settings }));
  const claudeJson = claude ?? { mcpServers: {}, projects: {} };
  writeFileSync(join(home, '.claude.json'), typeof claudeJson === 'string' ? claudeJson : JSON.stringify(claudeJson));
  const projectDir = mkdtempSync(join(tmpdir(), 'incantation-project-'));
  if (project) writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify(project));
  return { home, projectDir, remove: () => (rmSync(home, { recursive: true, force: true }), rmSync(projectDir, { recursive: true, force: true })) };
}

const engine = (over = {}) => ({ name: 'sherpa', health: async () => true, ...over });

const guard = (f, over = {}) =>
  runGuard({ home: f.home, projectDir: f.projectDir, pathValue: BIN, startDir: f.projectDir, fs: fakeFs, engine: engine(), checkRuntime: () => ({ damaged: [], ok: true, states: {} }), ...over });

const noValues = line => {
  assert.ok(!/127\.0\.0\.1|17493|fake|[\\/]Users|[\\/]home|sk-/.test(line), line);
  assert.ok(Object.values(LINES).includes(line) || line === 'ok', line);
};

test('ok with valid settings, a healthy sherpa engine and a fake recorder', async t => {
  const f = fixture();
  t.after(f.remove);
  assert.equal(await guard(f), 'ok');
});

test('each check fails with its fixed line and no value, including pre-retirement settings', async t => {
  const cases = [
    [{}, { nodeVersion: '22.11.0' }, 'node'],
    [{}, { nodeVersion: '23.9.0' }, 'node'],
    [{ settings: { port: 17493 } }, {}, 'settings'],
    [{ settings: { engine: undefined } }, {}, 'settings'],
    [{ settings: { profile: 'bella' } }, {}, 'settings'],
    [{ settings: { engine: 'voicebox' } }, {}, 'engine'],
    [{ settings: { engine: 'elsewhere' } }, {}, 'engine'],
    [{ settings: { engine: '../../evil' } }, {}, 'settings'],
    [{ settings: { recorder: win ? 'C:\\elsewhere\\ffmpeg.exe' : '/elsewhere/ffmpeg' } }, {}, 'recorder'],
    [{}, { pathValue: '' }, 'recorder'],
    [{}, { checkRuntime: () => ({ damaged: ['hearing'], ok: false, states: {} }) }, 'runtime'],
    [{}, { engine: engine({ health: async () => false }) }, 'runtime'],
  ];
  for (const [fx, over, key] of cases) {
    const f = fixture(fx);
    const line = await guard(f, over);
    f.remove();
    assert.equal(line, LINES[key], `${key}: ${line}`);
    noValues(line);
  }
  assert.equal(LINES.health, undefined);
  assert.equal(LINES.reach, undefined);
});

// The real sherpa engine and the real runtime check, on files of the real table
// laid at their pinned sizes in the fixture home.
test('with the real sherpa engine, all six runtime parts pass and any missing or short part fails with runtime', async t => {
  const f = fixture();
  t.after(f.remove);
  const root = runtimeDir(f.home);
  const put = (rel, size) => {
    const p = join(root, ...rel.split('/'));
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, '');
    truncateSync(p, size);
  };
  const key = platformKey(process.platform, process.arch);
  for (const a of ARCHIVES.filter(a => a.platform === null || a.platform === key)) for (const [file, size] of a.files) put(`${a.dest}/${file}`, size);
  for (const g of FILES) for (const [file, size] of g.files) put(`${g.dest}${file}`, size);
  const python = win ? 'Scripts/python.exe' : 'bin/python';
  put(`py/${python}`, 0);
  assert.equal(join(root, 'py', ...python.split('/')), pythonExe(f.home));
  writeWhole(join(root, 'py.manifest.json'), JSON.stringify({ files: [[python, 0]] }));
  const run = () => runGuard({ home: f.home, projectDir: f.projectDir, pathValue: BIN, startDir: f.projectDir, fs: fakeFs });
  assert.equal(await run(), 'ok');
  put(`${FILES[0].dest}${FILES[0].files[0][0]}`, 1);
  assert.equal(await run(), LINES.runtime, 'a short runtime file fails');
});

test('never reads Claude Code\'s own config', async t => {
  for (const claude of [{ mcpServers: {} }, 'not json at all ' + PLANTED, { mcpServers: { voicebox: { type: 'stdio', command: '/usr/bin/bridge' } } }]) {
    const f = fixture({ claude });
    assert.equal(await guard(f), 'ok');
    f.remove();
  }
  assert.equal(LINES.mcp, undefined);
});

// A link in place of a folder: a junction on Windows, a symlink elsewhere.
const linkFolder = (target, path) => symlinkSync(target, path, win ? 'junction' : 'dir');

test('the state check follows a link or junction in place of the folder, takes any mode, and still fails on a file in its place', async t => {
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const moved = fixture();
  t.after(moved.remove);
  renameSync(join(moved.home, '.grimoire', 'incantation'), join(outside, 'incantation'));
  linkFolder(join(outside, 'incantation'), join(moved.home, '.grimoire', 'incantation'));
  assert.equal(await guard(moved), 'ok', 'a link to a folder outside home');
  if (!win) {
    const f = fixture();
    t.after(f.remove);
    for (const [path, mode] of [[join('.grimoire', 'incantation'), 0o755], [join('.grimoire', 'incantation', 'run'), 0o750], [join('.grimoire', 'incantation', 'settings.json'), 0o644]]) chmodSync(join(f.home, path), mode);
    assert.equal(await guard(f), 'ok', 'looser modes');
  }
  const file = fixture();
  t.after(file.remove);
  rmSync(join(file.home, '.grimoire', 'incantation', 'run'), { recursive: true });
  writeFileSync(join(file.home, '.grimoire', 'incantation', 'run'), 'x');
  assert.equal(await guard(file), LINES.state, 'a file where a folder belongs');
});

test('T2: the first run moves an old ~/.incantation to ~/.grimoire/incantation, settings and all, and goes on; a folder already at the new place is never overwritten', async t => {
  const f = fixture();
  t.after(f.remove);
  const fresh = join(f.home, '.grimoire', 'incantation');
  const old = join(f.home, '.incantation');
  renameSync(fresh, old); // the shape the owner's machine has: settings, run/ and observe/ in the old place
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  assert.equal(await guard(f), 'ok', 'the old settings are found where they were moved');
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(join(fresh, 'settings.json')), true);
  assert.equal(existsSync(join(fresh, 'run')) && existsSync(join(fresh, 'observe')), true);
  // Both folders present: the old one is left alone.
  mkdirSync(old);
  writeFileSync(join(old, 'settings.json'), 'old');
  assert.equal(await guard(f), 'ok');
  assert.equal(readFileSync(join(old, 'settings.json'), 'utf8'), 'old');
});

test('T2: an old ~/.incantation that is a link is never moved', async t => {
  const f = fixture();
  t.after(f.remove);
  const outside = mkdtempSync(join(tmpdir(), 'incantation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const fresh = join(f.home, '.grimoire', 'incantation');
  renameSync(fresh, join(outside, 'incantation'));
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  linkFolder(join(outside, 'incantation'), join(f.home, '.incantation'));
  // Nothing is moved into place, so the new folder is simply not there: settings
  // missing, and the install that follows makes a fresh folder.
  assert.equal(await guard(f), LINES.settings);
  assert.equal(existsSync(fresh), false);
});

test('the command line exits 1 on a failed check, and prints only its fixed line', async t => {
  const home = mkdtempSync(join(tmpdir(), 'incantation-guard-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const GUARD = fileURLToPath(new URL('../skills/incantation/scripts/guard.mjs', import.meta.url));
  const r = await new Promise(res => execFile(process.execPath, [GUARD], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '' }, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res({ code: e ? e.code : 0, stdout })));
  assert.equal(r.code, 1);
  assert.ok(Object.values(LINES).includes(r.stdout.trimEnd()), r.stdout);
});

test('a machine where setup has not run is missing its settings, not an unsafe folder', async t => {
  const f = fixture();
  t.after(f.remove);
  rmSync(join(f.home, '.grimoire'), { recursive: true, force: true });
  assert.equal(await guard(f), LINES.settings);
});
