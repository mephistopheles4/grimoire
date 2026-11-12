// Tests of guard.mjs (docs/spec/incantation.md, S4.1 d; claims 8 to 12). Fixture
// home folders, fake servers on free loopback ports and sockets in a temporary
// folder, and addresses handed to the imported function, as the spec says. The
// command line reads no override. The tests that need unix sockets and /proc
// skip on win32 and say so; the settings tests run everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuard } from '../plugins/incantation/skills/incantation/scripts/guard.mjs';
import { cleanup, closeServer, fakeEngine, fakeProxy, fakeTcp, freePort, localOnlyEnv, makeHome, onWindows } from './incantation-helpers.mjs';

const GUARD = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/guard.mjs', import.meta.url));
const socketsSkip = onWindows ? 'unix sockets and /proc: skipped on win32, run in the athanor container and in CI' : false;
const quiet = { servePort: 1, readVersion: () => '9.0.2', addresses: [] };

// A home with local-only settings and nothing else running: enough for every
// check that fails before the first port is tried.
async function settingsOnly(env, over = {}) {
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts, env: env?.(stt, tts) });
  return { h, stt, tts, opts: { home: h.home, env: {}, projectDir: join(h.home, 'work'), ...quiet, ...over } };
}

// A home with everything running and in order: the proxy on both ports, an
// engine on each socket, the folder at 0700. A test breaks one thing in it.
async function ready(t, { proxy = {}, page = false, extra = '' } = {}) {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts, env: localOnlyEnv({ stt, tts, extra: `VOICEMODE_WHISPER_PORT=${stt}\nVOICEMODE_KOKORO_PORT=${tts}\n${extra}` }) });
  c.add(h.remove);
  const engines = [await fakeEngine(join(h.run, 'stt.sock')), await fakeEngine(join(h.run, 'tts.sock'), { page })];
  engines.forEach(e => c.add(e.close));
  const p = await fakeProxy({ ports: [stt, tts], token: h.token, ...proxy });
  c.add(p.close);
  const servePort = await freePort();
  return { h, stt, tts, servePort, c, engines, opts: { home: h.home, env: {}, projectDir: join(h.home, 'work'), servePort, readVersion: () => '9.0.2', addresses: [], uid: process.getuid?.() } };
}

// Claim 8.

test('guard prints ok with local-only settings and fake servers on 127.0.0.1 only', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  assert.equal(await runGuard(r.opts), 'ok');
});

// Claim 9.

test('guard prints exposed when a fake server listens on all interfaces', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const port = await freePort();
  const wide = await fakeTcp(port, '0.0.0.0');
  r.c.add(wide.close);
  const env = localOnlyEnv({ stt: r.stt, tts: r.tts, extra: `VOICEMODE_WHISPER_PORT=${port}\nVOICEMODE_KOKORO_PORT=${r.tts}\n` });
  writeFileSync(join(r.h.home, '.voicemode', 'voicemode.env'), env);
  // 127.0.0.2 stands in for the machine's own address, so this runs in the container.
  const line = await runGuard({ ...r.opts, addresses: [{ address: '127.0.0.2', family: 'IPv4' }] });
  assert.equal(line, `exposed stt ${port}: see README step 3`);
});

test('guard prints exposed when the proxy itself listens beyond loopback', { skip: socketsSkip }, async t => {
  const c = cleanup();
  t.after(() => c.run());
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts });
  c.add(h.remove);
  const wide = await fakeTcp(stt, '0.0.0.0');
  c.add(wide.close);
  const line = await runGuard({ home: h.home, env: {}, projectDir: h.home, servePort: 1, readVersion: () => '9.0.2', addresses: [{ address: '127.0.0.2', family: 'IPv4' }] });
  assert.equal(line, `exposed stt ${stt}: see README step 3`);
});

test('guard skips link-local addresses and counts a connect that fails as not exposed', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const line = await runGuard({ ...r.opts, addresses: [{ address: 'fe80::1', family: 'IPv6' }, { address: '169.254.1.1', family: 'IPv4' }] });
  assert.equal(line, 'ok');
});

// Claim 10, one case per setting.

test('guard prints remote when either speech URL is unset anywhere', async () => {
  for (const key of ['VOICEMODE_TTS_BASE_URLS', 'VOICEMODE_STT_BASE_URLS']) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).split('\n').filter(l => !l.startsWith(`${key}=`)).join('\n'));
    assert.equal(await runGuard(opts), `remote ${key}: set it to the loopback URL only, see README step 4`);
    h.remove();
  }
});

test('guard prints remote when a speech URL lists anything but http://127.0.0.1:<port>/…', async () => {
  for (const bad of ['https://api.openai.com/v1', 'http://localhost:8880/v1', 'http://127.0.0.1:8880', 'http://127.0.0.1:99999/v1', 'http://127.0.0.1:8880/v1,https://api.openai.com/v1', 'http://user@127.0.0.1:8880/v1', 'not a url', '']) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).replace(/VOICEMODE_TTS_BASE_URLS=.*/, `VOICEMODE_TTS_BASE_URLS=${bad}`));
    assert.equal(await runGuard(opts), 'remote VOICEMODE_TTS_BASE_URLS: set it to the loopback URL only, see README step 4', `for ${JSON.stringify(bad)}`);
    h.remove();
  }
});

test('guard prints remote when VOICEMODE_MCP_URL or VOICEMODE_MLX_AUDIO_BASE_URL is set, even empty', async () => {
  for (const key of ['VOICEMODE_MCP_URL', 'VOICEMODE_MLX_AUDIO_BASE_URL']) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts, extra: `${key}=` }));
    assert.equal(await runGuard(opts), `remote ${key}: set it to the loopback URL only, see README step 4`);
    h.remove();
  }
});

test('guard prints remote when a speech URL is set only in the process environment', async () => {
  const { h, opts } = await settingsOnly();
  const line = await runGuard({ ...opts, env: { VOICEMODE_STT_BASE_URLS: 'http://127.0.0.1:2022/v1' } });
  assert.equal(line, 'remote VOICEMODE_STT_BASE_URLS: move it to the global file, see README step 4');
  h.remove();
});

test('guard prints server env when an MCP server entry for VoiceMode holds a VOICEMODE_ key in its env block', async () => {
  const { h, opts } = await settingsOnly();
  writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ mcpServers: { voicemode: { command: 'uvx', args: ['voice-mode'], env: { VOICEMODE_TTS_BASE_URLS: 'x' } } } }));
  assert.equal(await runGuard(opts), 'server env: move VoiceMode settings to the global file, see README step 4');
  h.remove();
});

test('guard reads the server env of the project, local and plugin MCP configs too', async () => {
  const where = {
    project: (h, dir) => writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { voicemode: { command: 'voicemode-mcp', env: { VOICE_MODE_X: '1' } } } })),
    local: (h, dir) => writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ projects: { [dir]: { mcpServers: { voicemode: { command: 'voicemode-mcp', env: { VOICEMODE_X: '1' } } } } } })),
    plugin: (h) => {
      const at = join(h.home, '.claude', 'plugins', 'cache', 'voicemode');
      mkdirSync(join(at, '.claude-plugin'), { recursive: true });
      writeFileSync(join(at, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'voicemode', mcpServers: { voicemode: { command: 'voicemode-mcp', env: { VOICEMODE_X: '1' } } } }));
      writeFileSync(join(h.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'voicemode@voicemode': [{ scope: 'user', installPath: at }] } }));
    },
  };
  for (const [name, write] of Object.entries(where)) {
    const { h, opts } = await settingsOnly();
    mkdirSync(opts.projectDir, { recursive: true });
    mkdirSync(join(h.home, '.claude'), { recursive: true });
    write(h, opts.projectDir);
    assert.equal(await runGuard(opts), 'server env: move VoiceMode settings to the global file, see README step 4', name);
    h.remove();
  }
});

test('guard ignores an MCP server that does not provide VoiceMode, and never reads a value', async () => {
  const { h, opts } = await settingsOnly();
  writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x', env: { VOICEMODE_OTHER: '1' } }, voicemode: { command: 'voicemode-mcp', env: { PATH_TO: 'a' } } } }));
  const line = await runGuard(opts);
  assert.doesNotMatch(line, /^server env/);
  h.remove();
});

test('guard prints server env for a key in a Claude Code settings env block, HOME included', async () => {
  for (const [file, key] of [['settings.json', 'VOICEMODE_X'], ['settings.json', 'HOME'], ['settings.local.json', 'VOICE_MODE_X']]) {
    const { h, opts } = await settingsOnly();
    mkdirSync(join(opts.projectDir, '.claude'), { recursive: true });
    writeFileSync(join(opts.projectDir, '.claude', file), JSON.stringify({ env: { [key]: '1' } }));
    assert.equal(await runGuard(opts), 'server env: move VoiceMode settings to the global file, see README step 4', `${file} ${key}`);
    h.remove();
  }
  const { h, opts } = await settingsOnly();
  mkdirSync(join(h.home, '.claude'), { recursive: true });
  writeFileSync(join(h.home, '.claude', 'settings.json'), JSON.stringify({ env: { HOME: '/elsewhere' } }));
  assert.equal(await runGuard(opts), 'server env: move VoiceMode settings to the global file, see README step 4');
  h.remove();
});

test('guard prints project for a project-level settings file, in either form and from a folder above', async () => {
  for (const file of [['.voicemode.env'], ['.voicemode', 'voicemode.env']]) {
    const { h, opts } = await settingsOnly();
    const sub = join(h.home, 'work', 'a', 'b');
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(h.home, 'work', ...file.slice(0, -1)), { recursive: true });
    writeFileSync(join(h.home, 'work', ...file), 'VOICEMODE_VOICES=af_sky\n');
    const line = await runGuard({ ...opts, projectDir: sub });
    assert.equal(line, `project ${file.join('/')}: move VoiceMode settings to the global file, see README step 4`);
    h.remove();
  }
});

test('guard does not take the global file for a project file', async () => {
  const { h, opts } = await settingsOnly();
  const line = await runGuard({ ...opts, projectDir: h.home });
  assert.doesNotMatch(line, /^project/);
  h.remove();
});

test('guard prints auto-start with either auto-start key on or the service enable not false', async () => {
  for (const extra of ['VOICEMODE_AUTO_START_KOKORO=true', 'VOICE_MODE_AUTO_START_KOKORO=yes', 'VOICEMODE_AUTO_START_KOKORO=1', 'VOICEMODE_SERVICE_AUTO_ENABLE=true']) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).replace('VOICEMODE_SERVICE_AUTO_ENABLE=false', '') + `${extra}\n`);
    assert.equal(await runGuard(opts), 'auto-start: turn it off, see README step 4', extra);
    h.remove();
  }
});

test('guard prints auto-start when the service enable is unset or empty', async () => {
  for (const drop of [true, false]) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).replace('VOICEMODE_SERVICE_AUTO_ENABLE=false', drop ? '' : 'VOICEMODE_SERVICE_AUTO_ENABLE='));
    assert.equal(await runGuard(opts), 'auto-start: turn it off, see README step 4');
    h.remove();
  }
});

test('guard prints voice for a path-form default voice', async () => {
  for (const voice of ['/models/voice.onnx', 'a:b', 'dir/x', '../x']) {
    const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).replace('VOICEMODE_VOICES=af_sky', `VOICEMODE_VOICES=${voice}`));
    assert.equal(await runGuard(opts), 'voice: see README step 4', voice);
    h.remove();
  }
});

test('guard prints heard hook when the hook is in any of the three settings files', async () => {
  const hook = { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'voicemode-heard-hook hook || exit 1' }] }] } };
  for (const where of ['user', 'project', 'local']) {
    const { h, opts } = await settingsOnly();
    const dir = where === 'user' ? join(h.home, '.claude') : join(opts.projectDir, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, where === 'local' ? 'settings.local.json' : 'settings.json'), JSON.stringify(hook));
    assert.equal(await runGuard(opts), 'heard hook: remove it, see README step 4', where);
    h.remove();
  }
});

test('guard prints voicemode version when the installed version is outside the checked range or unreadable', async () => {
  for (const readVersion of [() => '9.1.0', () => '8.9.0', () => null, () => { throw new Error('boom'); }]) {
    const { h, opts } = await settingsOnly();
    assert.equal(await runGuard({ ...opts, readVersion }), 'voicemode version: see README step 1');
    h.remove();
  }
});

test('guard reads a Claude Code settings file it cannot parse as a failure, with a fixed line', async () => {
  const { h, opts } = await settingsOnly();
  mkdirSync(join(h.home, '.claude'), { recursive: true });
  writeFileSync(join(h.home, '.claude', 'settings.json'), '{ not json');
  assert.equal(await runGuard(opts), 'guard error: see README step 3');
  h.remove();
});

// Claim 11.

test('guard prints no proxy when a port answers without the right keyed hash', { skip: socketsSkip }, async t => {
  for (const mode of ['wrong-token', 'replay']) {
    const r = await ready(t, { proxy: { mode } });
    assert.equal(await runGuard(r.opts), `no proxy stt ${r.stt}: see README step 3`, mode);
  }
});

test('guard prints no proxy when nothing listens on a speech port', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  await r.c.run();
  const h = makeHome({ stt: r.stt, tts: r.tts });
  t.after(h.remove);
  const line = await runGuard({ ...r.opts, home: h.home });
  assert.equal(line, `no proxy stt ${r.stt}: see README step 3`);
});

test('guard prints no proxy when the listener belongs to another uid', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const line = await runGuard({ ...r.opts, uid: r.opts.uid + 1 });
  assert.equal(line, `no proxy stt ${r.stt}: see README step 3`);
});

test('guard prints exposed when an engine service port other than the proxy answers on loopback', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const port = await freePort();
  const tcp = await fakeTcp(port, '127.0.0.1');
  r.c.add(tcp.close);
  writeFileSync(join(r.h.home, '.voicemode', 'voicemode.env'), localOnlyEnv({ stt: r.stt, tts: r.tts, extra: `VOICEMODE_WHISPER_PORT=${port}\nVOICEMODE_KOKORO_PORT=${r.tts}\n` }));
  assert.equal(await runGuard(r.opts), `exposed stt ${port}: see README step 3`);
});

test('guard prints serve running when anything answers on loopback at the serve port', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const tcp = await fakeTcp(r.servePort, '127.0.0.1');
  r.c.add(tcp.close);
  assert.equal(await runGuard(r.opts), 'serve running: see README step 6');
});

test('guard prints proxy open when a foreign Host, a foreign Origin or an unlisted path gets through', { skip: socketsSkip }, async t => {
  for (const mode of ['no-host-check', 'no-origin-check', 'no-path-check']) {
    const r = await ready(t, { proxy: { mode } });
    assert.equal(await runGuard(r.opts), `proxy open stt ${r.stt}: see README step 3`, mode);
  }
});

test('guard prints exposed when something answers on [::1] at a speech port', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  let wide;
  try {
    wide = await fakeTcp(r.stt, '::1');
  } catch {
    t.skip('no IPv6 loopback in this environment');
    return;
  }
  r.c.add(wide.close);
  assert.equal(await runGuard(r.opts), `exposed stt ${r.stt}: see README step 3`);
});

test('guard prints socket when an engine socket is missing, stale or in an open folder', { skip: socketsSkip }, async t => {
  const missing = await ready(t);
  rmSync(join(missing.h.run, 'tts.sock'));
  assert.equal(await runGuard(missing.opts), 'socket tts: see README step 3');

  // A stale socket: a process that bound it and was killed leaves the file
  // behind, and nobody accepts on it.
  const stale = await ready(t);
  await stale.engines[0].close();
  rmSync(join(stale.h.run, 'stt.sock'), { force: true });
  spawnSync(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(join(stale.h.run, 'stt.sock'))}, () => process.kill(process.pid, 'SIGKILL'))`]);
  assert.equal(await runGuard(stale.opts), 'socket stt: see README step 3');

  const notSocket = await ready(t);
  await notSocket.engines[1].close();
  rmSync(join(notSocket.h.run, 'tts.sock'), { force: true });
  writeFileSync(join(notSocket.h.run, 'tts.sock'), '');
  assert.equal(await runGuard(notSocket.opts), 'socket tts: see README step 3');

  const open = await ready(t);
  chmodSync(open.h.run, 0o755);
  assert.equal(await runGuard(open.opts), 'socket stt: see README step 3');
});

test('guard prints socket when the proxy reports a TCP upstream', { skip: socketsSkip }, async t => {
  const r = await ready(t, { proxy: { mode: 'tcp-upstream' } });
  assert.equal(await runGuard(r.opts), 'socket stt: see README step 3');
});

test('guard prints tts scope when the text-to-speech engine serves a page', { skip: socketsSkip }, async t => {
  const r = await ready(t, { page: true });
  assert.equal(await runGuard(r.opts), 'tts scope: see README step 3');
});

// Claim 12.

test('a malformed URL holding a marker string gives a fixed line that holds neither the marker, an address nor a path', async () => {
  const marker = 'MARKER-7f3a91';
  const { h, opts } = await settingsOnly((stt, tts) => localOnlyEnv({ stt, tts }).replace(/VOICEMODE_STT_BASE_URLS=.*/, `VOICEMODE_STT_BASE_URLS=http://127.0.0.1:${marker}/v1,http://[bad`));
  const line = await runGuard(opts);
  assert.equal(line, 'remote VOICEMODE_STT_BASE_URLS: set it to the loopback URL only, see README step 4');
  assert.ok(!line.includes(marker) && !line.includes('127.0.0.1') && !line.includes(h.home));
  h.remove();
});

test('the command line prints one fixed line, nothing on stderr, and exits non-zero off ok', async () => {
  const marker = 'MARKER-5c0de1';
  const stt = await freePort();
  const tts = await freePort();
  const h = makeHome({ stt, tts, env: localOnlyEnv({ stt, tts }).replace(/VOICEMODE_TTS_BASE_URLS=.*/, `VOICEMODE_TTS_BASE_URLS=http://${marker}/v1`) });
  const r = spawnSync(process.execPath, [GUARD, h.home], { env: { HOME: h.home, USERPROFILE: h.home, PATH: process.env.PATH }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, 'remote VOICEMODE_TTS_BASE_URLS: set it to the loopback URL only, see README step 4\n');
  assert.equal(r.stderr, '');
  assert.ok(!(r.stdout + r.stderr).includes(marker) && !(r.stdout + r.stderr).includes(h.home));
  h.remove();
});

test('guard finishes within 2 s with every port timing out, and says so with a fixed line', { skip: socketsSkip }, async t => {
  const r = await ready(t);
  const start = Date.now();
  // A documentation-range address nothing answers, so each connect waits out its timeout.
  const line = await runGuard({ ...r.opts, addresses: [{ address: '198.51.100.7', family: 'IPv4' }] });
  assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  assert.equal(line, 'ok');
});

test('a check that never finishes ends at the deadline with the fixed error line, never ok', async () => {
  const { h, opts } = await settingsOnly();
  const start = Date.now();
  const line = await runGuard({ ...opts, readVersion: () => new Promise(() => {}) });
  const took = Date.now() - start;
  assert.equal(line, 'guard error: see README step 3');
  assert.ok(took >= 1500 && took < 2500, `took ${took} ms`);
  h.remove();
});

test('guard catches an error it did not expect and prints a fixed line, never the error', async () => {
  const { h, opts } = await settingsOnly();
  const line = await runGuard({ ...opts, readVersion: () => { throw new Error(`secret ${h.home}`); } });
  assert.equal(line, 'voicemode version: see README step 1');
  const line2 = await runGuard({ ...opts, home: undefined, env: undefined });
  assert.match(line2, /^guard error: see README step 3$/);
  h.remove();
});

test('the guard parses under node alone, with no dependency to load', () => {
  assert.equal(execFileSync(process.execPath, ['--check', GUARD]).length, 0);
});
