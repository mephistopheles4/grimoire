// head-chef's relay scripts as processes: argument forms, exit codes, the
// RESULT line, reasons that echo no input, and how a program is found. Each
// child gets a PATH of scratch folders only, so no real `gh` or `claude` can
// resolve, a fixed fake session id, a scratch config folder, and no GitHub
// token. Each run ends before any program starts, or meets a planted stub
// that must not run. A canary lists the real relay-state folder before and
// after, and fails on any change. A last test scans every relay fixture for
// an id, an inbox address or a home path that is not synthetic.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './helpers.mjs';
import { IDS, FIXTURE_IDS, RECORD } from './relay-fixture.mjs';

const SESSION = join(root, 'skills', 'head-chef', 'scripts', 'relay-session.mjs');
const LEAD = join(root, 'skills', 'head-chef', 'scripts', 'relay-lead.mjs');
const CONFIG = process.env.CLAUDE_CONFIG_DIR && isAbsolute(process.env.CLAUDE_CONFIG_DIR) ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude');
const REAL_STATE = join(CONFIG, 'plugins', 'data', 'grimoire-relay');
const win = process.platform === 'win32';

let scratch;
let canary;
// A digest of the real folder's listing, never the listing: its file names are
// live session ids, and a failed assertion prints both sides.
const listReal = () => {
  let names;
  try { names = fs.readdirSync(REAL_STATE).sort().join('\n'); } catch { names = 'absent'; }
  return createHash('sha256').update(names).digest('hex');
};

before(() => {
  canary = listReal();
  scratch = fs.mkdtempSync(join(tmpdir(), 'relay-cli-'));
  fs.mkdirSync(join(scratch, 'config', 'projects'), { recursive: true });
  fs.mkdirSync(join(scratch, 'bin'));
  fs.mkdirSync(join(scratch, 'stubs'));
  fs.mkdirSync(join(scratch, 'work'));
  const marker = join(scratch, 'ran').replace(/\\/g, '/');
  // Stubs that must never run: in the working folder and in a relative PATH
  // entry. On Windows an `.exe` here is not even a program, so running it
  // would fail and the run would end in read-failed, not no-program.
  for (const dir of [join(scratch, 'work'), join(scratch, 'work', 'stubs')]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['gh', 'claude']) {
      if (win) fs.writeFileSync(join(dir, `${name}.exe`), 'not a program');
      else { fs.writeFileSync(join(dir, name), `#!/bin/sh\ntouch ${marker}\n`); fs.chmodSync(join(dir, name), 0o755); }
    }
  }
  // An absolute PATH entry holding `claude` as a batch file only.
  if (win) fs.writeFileSync(join(scratch, 'bin', 'claude.cmd'), '@echo off\r\necho ran> "%~dp0ran"\r\n');
});

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  assert.ok(listReal() === canary, 'the real relay-state folder changed');
});

function run(script, args, { sid = IDS.session } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|CLAUDE_CODE_SESSION_ID|CLAUDE_CONFIG_DIR|CLAUDE_JOB_DIR|GH_CONFIG_DIR|PATH)$/i.test(k)) delete env[k];
  }
  env.PATH = ['stubs', '.', join(scratch, 'bin')].join(win ? ';' : ':');
  env.CLAUDE_CONFIG_DIR = join(scratch, 'config');
  env.GH_CONFIG_DIR = join(scratch, 'gh');
  if (sid !== null) env.CLAUDE_CODE_SESSION_ID = sid;
  const r = spawnSync(process.execPath, [script, ...args], { cwd: join(scratch, 'work'), env, encoding: 'utf8' });
  if (r.error) throw r.error;
  const lines = r.stdout.split('\n').filter(Boolean);
  return { code: r.status, lines, out: r.stdout + r.stderr };
}

function expectExit(r, code, line) {
  assert.equal(r.code, code, r.out);
  assert.equal(r.lines.at(-1), line, r.out);
  assert.equal(r.lines.filter(l => l.startsWith('RESULT:')).length, 1, r.out);
}

test('usage errors exit 2 with one line, and echo no input', () => {
  for (const [script, args] of [
    [SESSION, []], [SESSION, ['take']], [SESSION, ['take', '--record', IDS.other]], [SESSION, ['ask', '--record', RECORD, '--file', IDS.other]],
    [LEAD, ['relay', '--code', IDS.other]], [LEAD, ['note', '--chip-name', 'a b', '--record', RECORD]], [LEAD, ['frobnicate']],
  ]) {
    const r = run(script, args);
    expectExit(r, 2, 'RESULT: usage');
    assert.equal(r.lines.length, 1, r.out);
    assert.ok(!r.out.includes(IDS.other));
  }
});

test('no session id, or one that is not a GUID, asks in the session\'s own chat', () => {
  expectExit(run(SESSION, ['end'], { sid: null }), 3, 'RESULT: ask-in-own-chat no-session-id');
  const r = run(LEAD, ['end'], { sid: 'C:/x' });
  expectExit(r, 3, 'RESULT: ask-in-own-chat no-session-id');
  assert.ok(!r.out.includes('C:/x'));
});

test('a session with no transcript asks in its own chat, before any program starts', () => {
  expectExit(run(SESSION, ['take', '--record', RECORD]), 3, 'RESULT: ask-in-own-chat no-transcript');
});

test('programs resolve only from absolute PATH entries; a stub in the working folder or a relative entry never runs', () => {
  const r = run(LEAD, ['note', '--snapshot'], { sid: IDS.lead });
  expectExit(r, 3, 'RESULT: ask-in-own-chat no-program');
  assert.ok(!fs.existsSync(join(scratch, 'ran')), 'a stub ran');
  assert.ok(!fs.existsSync(join(scratch, 'bin', 'ran')), 'the batch file ran');
});

test('rule prints the relay sentence with this script folder\'s path, or refuses the path', () => {
  const r = run(LEAD, ['rule', '--record', RECORD], { sid: IDS.lead });
  const dir = join(root, 'skills', 'head-chef', 'scripts').replace(/\\/g, '/');
  if (/^[A-Za-z0-9/:._~-]+$/.test(dir)) {
    expectExit(r, 0, 'RESULT: ok');
    assert.ok(r.lines[2].includes(`${dir}/relay-session.mjs for ${RECORD};`));
  } else {
    expectExit(r, 1, 'RESULT: refused path');
  }
});

test('end deletes only the caller\'s own state file', () => {
  const dir = join(scratch, 'config', 'plugins', 'data', 'grimoire-relay');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, `${IDS.session}.json`), JSON.stringify({ grimoireRelay: 1, role: 'session', open: {} }));
  fs.writeFileSync(join(dir, `${IDS.other}.json`), JSON.stringify({ grimoireRelay: 1, role: 'session', open: {} }));
  expectExit(run(SESSION, ['end']), 0, 'RESULT: ok');
  assert.deepEqual(fs.readdirSync(dir), [`${IDS.other}.json`]);
});

test('the relay fixtures hold only synthetic ids, no inbox address and no home path', () => {
  const guid = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'gi');
  const home = homedir();
  const forbidden = [
    new RegExp('ud' + 's:', 'i'), new RegExp('\\\\\\\\\\.\\\\' + 'pipe', 'i'),
    new RegExp('[A-Za-z]:[\\\\/]+' + 'Users[\\\\/]', 'i'), new RegExp('/' + 'home/[a-z]'),
  ];
  for (const f of fs.readdirSync(join(root, 'tests')).filter(n => n.startsWith('relay-'))) {
    const text = fs.readFileSync(join(root, 'tests', f), 'utf8');
    for (const g of text.match(guid) || []) assert.ok(FIXTURE_IDS.has(g.toLowerCase()), `${f} holds an id outside the fixture list`);
    for (const re of forbidden) assert.ok(!re.test(text), `${f} matches ${re}`);
    assert.ok(!text.includes(home) && !text.includes(home.replace(/\\/g, '/')), `${f} holds the home folder`);
  }
});
