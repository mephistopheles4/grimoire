// Tests of scripts/check.mjs for the agent guard (issue 377): the fallback flag
// the guard tells an agent to use, and the rules that hold the two files which
// run when an agent session opens, .claude/settings.json and
// scripts/agent-check-guard.mjs. The fixture they share is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, assertPasses, assertFails, checkIn } from './check-fixture.mjs';
import { root, run } from './helpers.mjs';

// The one entry the settings file holds, written here from the spec and not
// read from the file, so a change to the file has to agree with this.
const GUARD_ENTRY = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash|PowerShell',
        hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/scripts/agent-check-guard.mjs'], timeout: 10 }],
      },
    ],
  },
};

const settingsIn = dir => join(dir, '.claude', 'settings.json');
const guardIn = dir => join(dir, 'scripts', 'agent-check-guard.mjs');
const readSettings = dir => JSON.parse(readFileSync(settingsIn(dir), 'utf8'));
const writeSettings = (dir, value) => writeFileSync(settingsIn(dir), typeof value === 'string' ? value : JSON.stringify(value));
const note = r => r.stdout.split('\n').filter(l => l.includes('host fallback'));

test('the settings file in the repository holds exactly the one guard entry', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')), GUARD_ENTRY);
});

test('the check passes with the settings file and the guard in the tree', () => {
  assertPasses(tree());
});

test('a named host fallback is printed as one note and changes nothing else', () => {
  const dir = tree();
  const plain = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  const named = run(checkIn(dir), ['--host-fallback=docker is down, exit 137'], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.equal(plain.code, 0);
  assert.equal(named.code, 0);
  assert.deepEqual(note(plain), [], 'no flag, no note');
  assert.deepEqual(note(named), ['note: host fallback named: docker is down, exit 137']);
  assert.equal(named.stdout.replace(note(named)[0] + '\n', ''), plain.stdout);
  assert.equal(named.stderr, plain.stderr);
});

test('a fallback reason with a line break or an escape prints as one escaped line, capped', () => {
  const dir = tree();
  const nasty = run(checkIn(dir), ['--host-fallback=a\nb\rc\u001b[31md'], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.equal(nasty.code, 0);
  const [line, ...more] = note(nasty);
  assert.deepEqual(more, []);
  for (const escaped of ['\\u{a}', '\\u{d}', '\\u{1b}']) assert.ok(line.includes(escaped), escaped);
  assert.ok(!nasty.stdout.includes('\u001b'), 'no raw escape reaches the log');
  assert.ok(!nasty.stdout.split('\n').some(l => l.startsWith('b') || l.startsWith('c')), 'no line break splits the note');
  const long = run(checkIn(dir), [`--host-fallback=${'x'.repeat(500)}`], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  const [capped] = note(long);
  assert.equal(capped.length, 'note: host fallback named: '.length + 200);
  assert.ok(capped.endsWith('...'));
});

test('an empty fallback reason prints no note', () => {
  const dir = tree();
  for (const arg of ['--host-fallback=', '--host-fallback=   ']) {
    assert.deepEqual(note(run(checkIn(dir), [arg], { cwd: dir, env: { GITHUB_BASE_REF: null } })), [], arg);
  }
});

test('the settings file fails the check when it holds anything but the guard entry', () => {
  const extra = [
    ['a second hook event', s => { s.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node', args: ['x.mjs'] }] }]; }],
    ['a second matcher entry', s => { s.hooks.PreToolUse.push({ matcher: 'Read', hooks: [{ type: 'command', command: 'node' }] }); }],
    ['a second hook in the entry', s => { s.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'node' }); }],
    ['another command', s => { s.hooks.PreToolUse[0].hooks[0].args = ['scripts/other.mjs']; }],
    ['another timeout', s => { s.hooks.PreToolUse[0].hooks[0].timeout = 600; }],
    ['an env block', s => { s.env = { SECRET: 'x' }; }],
    ['a permissions block', s => { s.permissions = { allow: ['Bash(*)'] }; }],
    ['a status line', s => { s.statusLine = { type: 'command', command: 'node' }; }],
  ];
  for (const [, edit] of extra) {
    const dir = tree();
    const settings = readSettings(dir);
    edit(settings);
    writeSettings(dir, settings);
    assertFails(dir, /\.claude\/settings\.json holds more or less than the one guard entry/);
  }
});

test('a settings file that parses to the entry but is not its one line fails the check', () => {
  // A repeated key parses to the last value, and Claude Code's reader may pick
  // the first, so the file is held to the entry's own text.
  const dir = tree();
  writeSettings(dir, `{"hooks":{"Stop":[]},"hooks":${JSON.stringify(GUARD_ENTRY.hooks)}}`);
  assertFails(dir, /\.claude\/settings\.json holds more or less than the one guard entry/);
  const spaced = tree();
  writeSettings(spaced, JSON.stringify(GUARD_ENTRY, null, 2));
  assertFails(spaced, /holds more or less than the one guard entry/);
});

// Claude Code loads a settings file from the folder a session starts in, and a
// settings file can run code through its hooks, status line, helpers, environment
// and permissions, so one below the root fails whatever it holds.
test('a settings file below the root fails the check, whatever it holds', () => {
  // A settings.local.json is not tried: .gitignore matches *.local.*, so the
  // walk never reads one, and rule 2b fails one that git tracks anyway.
  const held = [
    JSON.stringify({ hooks: { Stop: [] } }),
    JSON.stringify({ statusLine: { type: 'command', command: 'node x.mjs' } }),
    JSON.stringify({ apiKeyHelper: 'node x.mjs' }),
    JSON.stringify({ env: { A: '1' } }),
    JSON.stringify({ model: 'sonnet' }),
    '{}',
    '{ "hooks": ',
  ];
  for (const [where, text] of held.flatMap(text => [['docs', text], ['skills/eagle-eye', text]])) {
    const dir = tree();
    mkdirSync(join(dir, where, '.claude'), { recursive: true });
    writeFileSync(join(dir, where, '.claude', 'settings.json'), text);
    assertFails(dir, new RegExp(`${where}/\\.claude/settings\\.json is a settings file below the root`));
  }
});

// The walk lists a link to a folder as a file, so a tracked link named .claude
// would hide the settings file behind it from the rule above. A file or a link
// with that name is never right, and a regular file stands in for the link here
// because a link needs a privilege some machines do not give.
test('a file or link named .claude, which the walk cannot look through, fails the check', () => {
  const dir = tree();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', '.claude'), 'not a folder\n');
  assertFails(dir, /docs\/\.claude is a file or a link named \.claude/);
});

test('a flag does not turn a failing check into a passing one', () => {
  const dir = tree();
  const settings = readSettings(dir);
  settings.env = { SECRET: 'x' };
  writeSettings(dir, settings);
  const plain = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  const named = run(checkIn(dir), ['--host-fallback=docker is down'], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.equal(plain.code, 1);
  assert.equal(named.code, 1);
  assert.equal(named.stderr, plain.stderr);
});

test('a settings file that is not JSON fails the check', () => {
  const dir = tree();
  writeSettings(dir, '{ "hooks": ');
  assertFails(dir, /\.claude\/settings\.json is not JSON/);
});

test('a hidden character in the settings file or the guard script fails the check', () => {
  for (const [file, pattern] of [
    [settingsIn, /\.claude\/settings\.json:\d+ holds U\+200B/],
    [guardIn, /scripts\/agent-check-guard\.mjs:\d+ holds U\+200B/],
  ]) {
    const dir = tree();
    appendFileSync(file(dir), '\n​\n');
    assertFails(dir, pattern);
  }
});

// Case twins. Where case folds the second spelling cannot sit beside the first,
// so each spelling is put in the tree on its own, in place of the real file: the
// walk then reports the name as written, and the rule is read on that.
test('a settings file or guard script spelled in another case fails the check', () => {
  const dir = tree();
  rmSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, '.Claude'));
  writeFileSync(join(dir, '.Claude', 'settings.json'), JSON.stringify(GUARD_ENTRY));
  assertFails(dir, /\.Claude\/settings\.json is \.claude\/settings\.json in another case/);

  const other = tree();
  renameSync(guardIn(other), join(other, 'scripts', 'Agent-Check-Guard.mjs'));
  assertFails(other, /scripts\/Agent-Check-Guard\.mjs is scripts\/agent-check-guard\.mjs in another case/);
});
