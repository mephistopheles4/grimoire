// The cleanup gate's rules (issue 359, spec v5.2), tested at their own seam:
// brigade/gate.ts holds them with no engine import, so these tests check the
// done command's grammar, how a title resolves, the reply, the window and the
// archive hook's decision directly. brigade/register.tsx wires them to the
// engine, and the last tests here read its text for that wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gate = await import('../brigade/gate.ts');
const { ARCHIVE_REFUSAL, DONE_REPLIES, WINDOW_MS, archivePasses, doneReply, isDoneCommand, openWindow, parseDone, resolveTitles, takeEntry } = gate;

const DESKTOP = 'local_11111111-2222-3333-4444-555555555555';
const JOB = '0123abcd';
const ENGINE = { plugin: 'engine', tier: 'core' };
const cards = [
  { title: 'build-1', desktopId: DESKTOP },
  { title: 'bg-1', bgId: JOB },
  { title: 'loose', desktopId: 'local_99999999-2222-3333-4444-555555555555' },
  { title: 'renamed', desktopId: 'local_88888888-2222-3333-4444-555555555555' },
];
const targets = new Map([
  [DESKTOP, { kind: 'desktop', name: 'build-1' }],
  [JOB, { kind: 'bg', name: 'bg-1' }],
  ['local_88888888-2222-3333-4444-555555555555', { kind: 'desktop', name: 'something else' }],
]);
const opened = (titles, now = 1000) => {
  const w = new Map();
  openWindow(w, resolveTitles(titles, cards, targets), now);
  return w;
};

test('C1: a bound card whose session carried its title opens one entry, and the reply names the title and no id or path', () => {
  const r = resolveTitles(parseDone('done build-1'), cards, targets);
  assert.deepEqual(r, [{ title: 'build-1', open: { kind: 'desktop', id: DESKTOP } }]);
  const reply = doneReply(r);
  assert.match(reply, /^Opened 1 of 1 for 15 minutes: build-1\./);
  assert.ok(!reply.includes(DESKTOP) && !reply.includes('local_') && !/[\\/]/.test(reply));
  const w = opened(['build-1']);
  assert.deepEqual([...w.values()], [{ kind: 'desktop', id: DESKTOP, openedAt: 1000 }]);
});

test('C3: no card, an unbound card, or a card whose bound name differs opens nothing, each with its fixed reason', () => {
  const r = resolveTitles(['nobody', 'loose', 'renamed'], cards, targets);
  assert.deepEqual(r.map(x => x.why), ['no card has this title', 'not bound to its session', 'changed since it joined']);
  assert.equal(opened(['nobody', 'loose', 'renamed']).size, 0);
  assert.equal(doneReply(r), 'Opened 0 of 3 for 15 minutes.\nNot opened: nobody: no card has this title.\nNot opened: loose: not bound to its session.\nNot opened: renamed: changed since it joined.');
  // A swap after binding: the card titled bg-1 now carries the Desktop id bound as build-1.
  const swapped = [{ title: 'bg-1', desktopId: DESKTOP }, { title: 'build-1', bgId: JOB }];
  assert.deepEqual(resolveTitles(['bg-1', 'build-1'], swapped, targets).map(x => x.why), ['changed since it joined', 'changed since it joined']);
});

test('C3: the grammar takes 1 to 20 titles split on commas, cleans each as a title is drawn, and refuses an empty one', () => {
  assert.deepEqual(parseDone('done  build-1 ,bg-1'), ['build-1', 'bg-1']);
  for (const args of ['done', 'done   ', 'done a,,b', 'done a,', `done ${Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')}`]) {
    assert.equal(parseDone(args), undefined, args);
  }
  assert.equal(parseDone(`done ${Array.from({ length: 20 }, (_, i) => `t${i}`).join(',')}`).length, 20);
  // A hidden character goes, so it never reaches the reply.
  const [t] = parseDone('done build\u{200B}-1\u{202E}');
  assert.equal(t, 'build-1');
  assert.ok(!doneReply(resolveTitles([t], cards, targets)).includes('\u{202E}'));
  // A title over 80 characters is cut as the roster cuts a drawn title.
  assert.equal([...parseDone(`done ${'x'.repeat(90)}`)[0]].length, 80);
});

test('C4: only `done` as the first word is the done command', () => {
  for (const a of ['done', 'done x', '  done x']) assert.equal(isDoneCommand(a), true, a);
  for (const a of ['', 'doneX', 'level 3 done', 'scan on', undefined]) assert.equal(isDoneCommand(a), false, String(a));
});

test('C6: the archive passes once for an open Desktop entry, with session_id alone or with a string reason', () => {
  const w = opened(['build-1']);
  assert.equal(archivePasses({ tool: 'x', session_id: DESKTOP, reason: 'done' }, ENGINE, w, 2000), true);
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, w, 2001), false);
  const w2 = opened(['build-1']);
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, w2, 2000), true);
});

test('C7: the archive is refused with no window, past 15 minutes, for self, an unknown id, an extra key, a subagent or another plugin, and a refused call leaves the entry open', () => {
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, new Map(), 0), false);
  const late = opened(['build-1'], 0);
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, late, WINDOW_MS), false);
  const w = opened(['build-1']);
  const refused = [
    [{ session_id: 'self' }, ENGINE],
    [{ session_id: 'local_00000000-2222-3333-4444-555555555555' }, ENGINE],
    [{ session_id: DESKTOP, _consent: true }, ENGINE],
    [{ session_id: DESKTOP, other: 1 }, ENGINE],
    [{ session_id: DESKTOP, reason: 7 }, ENGINE],
    [{ session_id: DESKTOP, agentId: 'a1' }, ENGINE],
    [{ session_id: DESKTOP }, { plugin: 'other', tier: 'append' }],
    [{ session_id: DESKTOP }, undefined],
    [{ session_id: JOB }, ENGINE],
  ];
  for (const [e, origin] of refused) assert.equal(archivePasses(e, origin, w, 2000), false, JSON.stringify(e));
  assert.equal(w.size, 1, 'a refused call leaves the open entry open');
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, w, 2000), true);
  // The one refusal names no id, reason or key.
  for (const piece of [DESKTOP, 'self', '_consent', 'session_id', 'reason:']) assert.ok(!ARCHIVE_REFUSAL.includes(piece), piece);
});

test('C9: a background entry is taken once, by its kind, inside 15 minutes', () => {
  const w = opened(['bg-1']);
  assert.equal(takeEntry(w, 'desktop', JOB, 2000), false);
  assert.equal(takeEntry(w, 'bg', JOB, 2000), true);
  assert.equal(takeEntry(w, 'bg', JOB, 2000), false);
  assert.equal(takeEntry(opened(['bg-1'], 0), 'bg', JOB, WINDOW_MS), false);
  // Typing the command again opens it again, with a new 15 minutes.
  const again = opened(['bg-1'], 0);
  openWindow(again, resolveTitles(['bg-1'], cards, targets), WINDOW_MS - 1);
  assert.equal(takeEntry(again, 'bg', JOB, WINDOW_MS + 1000), true);
});

test('C10: the stop answer is fixed words, a stop only on exit 0, whatever the run printed or rejected with', () => {
  const stopped = gate.stopAnswer({ exitCode: 0, stdout: 'C:\\Users\\someone\\x', stderr: 'TOKEN=abc' });
  assert.match(stopped, /^Stopped: /);
  for (const ran of [undefined, { exitCode: 1, stdout: 'C:\\Users\\someone' }, { exitCode: '0' }, 'spawn failed: TOKEN=abc', null]) {
    assert.match(gate.stopAnswer(ran), /^Not stopped: /);
  }
  for (const piece of ['someone', 'TOKEN', 'abc']) assert.ok(!stopped.includes(piece) && !gate.stopAnswer('spawn failed: TOKEN=abc').includes(piece));
});

// The wiring, read from brigade/register.tsx's text: the runner that drives
// it (claude plugin test) is one of the brigade host gates.
const register = fs.readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');

test('C2, C5, C8: the done path is read first, gated on the typed origin, fails closed, and the window clears at each start', () => {
  const handler = register.slice(register.indexOf("on('command.run', { command: 'brigade' }"));
  assert.ok(handler.indexOf('isDoneCommand(e.args)') > 0 && handler.indexOf('isDoneCommand(e.args)') < handler.indexOf('isLevelCommand(e.args)'));
  assert.match(register, /async function doneCommand[\s\S]*?if \(!levelOriginAllowed\(origin\)\) return \{ text: DONE_REPLIES\.notTyped \}/);
  assert.match(register, /if \(isDoneCommand\(e\.args\)\) return \{ text: DONE_REPLIES\.failed \}/);
  assert.equal((register.match(/doneWindow\.clear\(\)/g) ?? []).length, 2);
  assert.equal(DONE_REPLIES.failed, 'Nothing opened: the done command failed.');
});

test('C7, C9: the archive hook and the stop tool refuse in their .catch, and the stop tool runs `claude stop` alone, never `claude rm`', () => {
  assert.match(register, /on\('tool\.call', \{ tool: ARCHIVE_TOOL \}[\s\S]*?\.catch\(\(\) => \(\{ deny: ARCHIVE_REFUSAL \}\)\)/);
  const stop = register.slice(register.indexOf('async function stopBackground'), register.indexOf('// end stopBackground'));
  assert.ok(stop.length > 0);
  assert.match(stop, /\['claude', 'stop', t\.id\]/);
  assert.ok(!/'rm'/.test(stop));
  assert.match(stop, /fromEngine\(origin\)/);
  assert.match(stop, /agentId !== undefined/);
  assert.match(stop, /takeEntry\(doneWindow, 'bg'/);
});
