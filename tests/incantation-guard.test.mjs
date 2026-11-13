// Tests of guard.mjs (docs/spec/incantation.md, S5.6; claim 3), on a fake
// engine, a fake recorder file system and a fixture home. No real Voicebox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { LINES, runGuard } from '../plugins/incantation/skills/incantation/scripts/guard.mjs';
import { secureState, settingsPath, writePrivate } from '../plugins/incantation/skills/incantation/scripts/lib.mjs';

const win = process.platform === 'win32';
const BIN = win ? 'C:\\fake\\bin' : '/fake/bin';
const RECORDER = win ? win32.join(BIN, 'ffmpeg.exe') : posix.join(BIN, 'ffmpeg');
const URL_OK = 'http://127.0.0.1:17493/mcp';
const PLANTED = 'sk-planted-fake-key-0123456789abcdef';

const fakeFs = {
  isFile: p => p === RECORDER,
  realpath: p => p,
  lstat: () => ({ uid: 0, mode: 0o40755 }),
  uid: () => 1000,
};

function fixture({ settings = {}, claude, project } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'incantation-guard-'));
  secureState(home);
  writePrivate(settingsPath(home), JSON.stringify({ engine: 'voicebox', port: 17493, profile: 'made-up', device: { index: 0, stamp: '0123456789abcdef' }, recorder: RECORDER, endOfSpeechMs: 1000, ...settings }));
  const claudeJson = claude ?? { mcpServers: { voicebox: { type: 'http', url: URL_OK } }, projects: {} };
  writeFileSync(join(home, '.claude.json'), typeof claudeJson === 'string' ? claudeJson : JSON.stringify(claudeJson));
  const projectDir = mkdtempSync(join(tmpdir(), 'incantation-project-'));
  if (project) writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify(project));
  return { home, projectDir, remove: () => (rmSync(home, { recursive: true, force: true }), rmSync(projectDir, { recursive: true, force: true })) };
}

const engine = (over = {}) => ({ mcpServer: 'voicebox', mcpUrl: URL_OK, health: async () => true, ...over });

const guard = (f, over = {}) =>
  runGuard({ home: f.home, projectDir: f.projectDir, pathValue: BIN, startDir: f.projectDir, fs: fakeFs, engine: engine(), addresses: () => [], ...over });

const noValues = line => {
  assert.ok(!/127\.0\.0\.1|17493|fake|[\\/]Users|[\\/]home|sk-/.test(line), line);
  assert.ok(Object.values(LINES).includes(line) || line === 'ok', line);
};

test('ok with valid settings, a fake engine on 127.0.0.1 and a fake recorder', async t => {
  const f = fixture();
  t.after(f.remove);
  assert.equal(await guard(f), 'ok');
});

test('each check fails with its fixed line and no value', async t => {
  const cases = [
    [{}, { nodeVersion: '22.11.0' }, 'node'],
    [{ settings: { port: 80 } }, {}, 'settings'],
    [{ settings: { engine: 'elsewhere' } }, {}, 'engine'],
    [{ settings: { engine: '../../evil' } }, {}, 'settings'],
    [{}, { engine: engine({ health: async () => false }) }, 'health'],
    [{}, { addresses: () => ['192.0.2.10'], tcpOpen: async () => true }, 'reach'],
    [{ claude: { mcpServers: { voicebox: { type: 'http', url: 'http://192.0.2.10:17493/mcp' } } } }, {}, 'mcp'],
    [{ claude: { mcpServers: { voicebox: { type: 'stdio', command: '/usr/bin/bridge', args: [] } } } }, {}, 'mcp'],
    [{ claude: { mcpServers: { voicebox: { type: 'http', url: URL_OK } }, projects: { '/some/project': { mcpServers: { voicebox: { type: 'http', url: URL_OK } } } } } }, {}, 'mcp'],
    [{ project: { mcpServers: { voicebox: { type: 'http', url: URL_OK } } } }, {}, 'mcp'],
    [{ claude: { mcpServers: {} } }, {}, 'mcp'],
    [{ claude: `{"mcpServers": {"other": {"headers": {"Authorization": "${PLANTED}"` }, {}, 'mcp'],
    [{ settings: { recorder: win ? 'C:\\elsewhere\\ffmpeg.exe' : '/elsewhere/ffmpeg' } }, {}, 'recorder'],
    [{}, { pathValue: '' }, 'recorder'],
  ];
  for (const [fx, over, key] of cases) {
    const f = fixture(fx);
    const line = await guard(f, over);
    f.remove();
    assert.equal(line, LINES[key], `${key}: ${line}`);
    noValues(line);
  }
});

test('the reach check asks every non-loopback address on the settings port', async t => {
  const f = fixture();
  t.after(f.remove);
  const asked = [];
  await guard(f, { addresses: () => ['192.0.2.10', '2001:db8::1'], tcpOpen: async (a, p) => (asked.push(`${a} ${p}`), false) });
  assert.deepEqual(asked, ['192.0.2.10 17493', '2001:db8::1 17493']);
});

test('it finishes within 2 s with every port timing out', async t => {
  const f = fixture();
  t.after(f.remove);
  const began = Date.now();
  const line = await guard(f, { addresses: () => ['192.0.2.10'], tcpOpen: () => new Promise(() => {}) });
  assert.ok(Date.now() - began < 2500);
  assert.equal(line, LINES.late);
});
