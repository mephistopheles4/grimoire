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
  // A card naming as a job id an id bound to a Desktop session, under that session's name: not bound.
  assert.deepEqual(resolveTitles(['build-1'], [{ title: 'build-1', bgId: DESKTOP }], targets).map(x => x.why), ['not bound to its session']);
  // Two cards under one title open neither.
  assert.deepEqual(resolveTitles(['build-1'], [cards[0], { title: 'build-1', bgId: JOB }], targets).map(x => x.why), ['more than one card has this title']);
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
  // A key the engine or a hook above sets beside the input is not the model's.
  assert.equal(archivePasses({ session_id: DESKTOP, tool_use_id: 't', requestMeta: { 'anthropic/sources': '[]' } }, ENGINE, w2, 2000), true);
  assert.equal(archivePasses({ session_id: DESKTOP }, ENGINE, opened(['build-1']), 2000), true);
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
    [{ session_id: DESKTOP, requestMeta: { k: 'v' }, other: 1 }, ENGINE],
    [{ session_id: DESKTOP, reason: 7 }, ENGINE],
    [{ session_id: DESKTOP, agentId: 'a1' }, ENGINE],
    [{ session_id: DESKTOP }, { plugin: 'other', tier: 'append' }],
    [{ session_id: DESKTOP }, undefined],
    [{ session_id: JOB }, ENGINE],
  ];
  for (const [e, origin] of refused) assert.equal(archivePasses(e, origin, w, 2000), false, JSON.stringify(e));
  assert.equal(w.size, 1, 'a refused call leaves the open entry open');
  // `self` is refused even when a window holds that very key.
  const selfWindow = new Map([['desktop:self', { kind: 'desktop', id: 'self', openedAt: 1000 }]]);
  assert.equal(archivePasses({ session_id: 'self' }, ENGINE, selfWindow, 2000), false);
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
// The text from one marker to the next, which must both be there, in order.
const between = (from, to) => {
  const a = register.indexOf(from);
  const b = register.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `register.tsx lacks ${from} before ${to}`);
  return register.slice(a, b);
};
// A hook's handler: from its registration to the next hook's.
const hook = from => between(from, "\n  on('");

test('C7: the archive hook matches Desktop\'s archive tool by the name ADR 0012 measured (A14)', () => {
  assert.equal(gate.ARCHIVE_TOOL, 'mcp__ccd_session_mgmt__archive_session');
});

test('C1, C2, C4, C5: the done path is read first and returns, hands on the event\'s own origin, gates before it reads or opens anything, and fails closed', () => {
  const command = hook("on('command.run', { command: 'brigade' }");
  assert.match(command, /\n {4}if \(isDoneCommand\(e\.args\)\) return doneCommand\(\$, e\.origin, e\.args\)\n/);
  assert.ok(command.indexOf('isDoneCommand(e.args)') < command.indexOf('isLevelCommand(e.args)'));
  assert.match(command, /\.catch\(\(\$, e, next\) => \{\n {4}if \(isDoneCommand\(e\.args\)\) return \{ text: DONE_REPLIES\.failed \}/);
  const done = between('async function doneCommand', '\n}\n');
  const gateAt = done.indexOf('if (!levelOriginAllowed(origin)) return { text: DONE_REPLIES.notTyped }');
  assert.ok(gateAt > 0 && gateAt < done.indexOf('parseDone(') && gateAt < done.indexOf('openWindow('));
  assert.match(done, /openWindow\(doneWindow, resolved, await \$\.clock\.now\(\)\)/);
  assert.match(done, /\} catch \{\n {4}return \{ text: DONE_REPLIES\.failed \}/);
  assert.equal(DONE_REPLIES.failed, 'Nothing opened: the done command failed.');
});

test('C8: a session start empties the window first thing, and so does a clear or a resume', () => {
  assert.match(hook("on('session.start'"), /^on\('session\.start', async \(\$, e, next\) => \{\n {4}doneWindow\.clear\(\)\n/);
  assert.match(hook("on('classic.SessionStart'"), /if \(e\.source === 'clear' \|\| e\.source === 'resume'\) \{\n(?: {6}\/\/.*\n)* {6}doneWindow\.clear\(\)\n/);
});

test('C6, C7: the archive hook passes only what archivePasses passes, on the dispatch\'s own origin and the one window, and refuses in its .catch', () => {
  const archive = between("on('tool.call', { tool: ARCHIVE_TOOL }", "on('tool.call', { tool: STOP_NAME }");
  assert.match(archive, /\n {4}if \(!archivePasses\(e as unknown as Record<string, unknown>, next\.origin, doneWindow, await \$\.clock\.now\(\)\)\) return \{ deny: ARCHIVE_REFUSAL \}\n {4}return next\(e\)\n {2}\}\)\.catch\(\(\) => \(\{ deny: ARCHIVE_REFUSAL \}\)\)/);
});

test('C9, C10: the stop tool refuses a subagent or another plugin, takes its window entry before it runs, runs `claude stop` alone, and answers only through stopAnswer', () => {
  const stop = between('async function stopBackground', '// end stopBackground');
  const lines = [
    "if (e.agentId !== undefined) return refuseStop(",
    'if (!fromEngine(origin)) return refuseStop(',
    "if (!takeEntry(doneWindow, 'bg', t.id, await $.clock.now())) return refuseStop(",
    "const ran = await $.process.run(['claude', 'stop', t.id], { timeoutMs: 15000 }).catch(() => undefined)",
    'return { result: stopAnswer(ran) }',
  ];
  let at = -1;
  for (const l of lines) {
    const i = stop.indexOf(l);
    assert.ok(i > at, `out of order or missing: ${l}`);
    at = i;
  }
  assert.ok(!/["'`]rm["'`]/.test(stop), 'no claude rm');
  assert.equal((stop.match(/\$\.process\.run\(/g) ?? []).length, 1);
  assert.equal((stop.match(/return \{ result: /g) ?? []).length, 2);
  assert.ok(!/return \{ result: (?!stopAnswer\()/.test(stop), 'every answer goes through stopAnswer');
  const handler = between("on('tool.call', { tool: STOP_NAME }", "on('tool.call', { tool: CLEANUP_NAME }");
  assert.match(handler, /return await stopBackground\(\$, e as unknown as Record<string, unknown>, next\.origin\)/);
  assert.match(handler, /\}\)\.catch\(\(\) => \(\{ deny: 'stop_background_session refused: /);
});
