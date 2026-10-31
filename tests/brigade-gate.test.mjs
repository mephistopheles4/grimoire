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
  [DESKTOP, { kind: 'desktop', name: 'build-1', cwd: '/work/grimoire/.claude/worktrees/build-1', repo: '/work/grimoire/.git', branch: 'worktree-build-1' }],
  [JOB, { kind: 'bg', name: 'bg-1', cwd: '/work/grimoire/.claude/worktrees/bg-1', repo: '/work/grimoire/.git' }],
  ['local_88888888-2222-3333-4444-555555555555', { kind: 'desktop', name: 'something else' }],
]);
const opened = (titles, now = 1000) => {
  const w = new Map();
  openWindow(w, resolveTitles(titles, cards, targets), now);
  return w;
};

test('C1: a bound card whose session carried its title opens its archive entry and its clean entry, and the reply names the title and no id or path', () => {
  const r = resolveTitles(parseDone('done build-1'), cards, targets);
  assert.deepEqual(r, [{ title: 'build-1', open: { kind: 'desktop', id: DESKTOP } }]);
  const reply = doneReply(r, targets, true);
  assert.match(reply, /^Opened 1 of 1 for 15 minutes:\n"build-1": Desktop, /);
  // Past the reply's fixed lines (the undo line names /brigade), no slash or backslash: no path of any kind.
  const fixed = [...gate.CLEAN_LINES, gate.UNDO_LINE, gate.PANE_CLOSED_LINE, 'Now send any message, so this session acts on them.'];
  const own = reply.split('\n').filter(l => !fixed.includes(l)).join('\n');
  assert.ok(!reply.includes(DESKTOP) && !reply.includes('local_') && !/[\\/]/.test(own), reply);
  const w = opened(['build-1']);
  assert.deepEqual([...w.values()], [{ kind: 'desktop', id: DESKTOP, openedAt: 1000 }, { kind: 'clean', id: DESKTOP, openedAt: 1000 }]);
});

test('C3: no card, an unbound card, or a card whose bound name differs opens nothing, each with its fixed reason', () => {
  const r = resolveTitles(['nobody', 'loose', 'renamed'], cards, targets);
  assert.deepEqual(r.map(x => x.why), ['no card has this title', 'not bound to its session', 'changed since it joined']);
  assert.equal(opened(['nobody', 'loose', 'renamed']).size, 0);
  assert.equal(doneReply(r, targets, true), 'Opened 0 of 3 for 15 minutes.\nNot opened: "nobody": no card has this title.\nNot opened: "loose": not bound to its session.\nNot opened: "renamed": changed since it joined.');
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
  assert.ok(!doneReply(resolveTitles([t], cards, targets), targets, true).includes('\u{202E}'));
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
    [{ session_id: DESKTOP }, { plugin: 'engine', tier: 'append' }],
    [{ session_id: DESKTOP }, { plugin: 'engine' }],
    [{ session_id: DESKTOP }, undefined],
    [{ session_id: JOB }, ENGINE],
  ];
  for (const [e, origin] of refused) assert.equal(archivePasses(e, origin, w, 2000), false, JSON.stringify(e));
  assert.equal(w.size, 2, 'a refused call leaves the open entries open');
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

// ---------------------------------------------------------------- 484: one typed act

const { CLEAN_LINES, NONE_REPLY, NOTHING_DONE, PANE_CLOSED_LINE, UNDO_LINE, cleanFolder, doneWord, entryOpen, quoted, resolveAll } = gate;
const done = (title, ids) => ({ title, status: 'done', ...ids });

test('484 C1: done all names every shown done card through resolveTitles, and none other', () => {
  const roster = [
    done('build-1', { desktopId: DESKTOP }),
    done('bg-1', { bgId: JOB }),
    { title: 'working-1', status: 'working', desktopId: 'local_77777777-2222-3333-4444-555555555555' },
    done('gone', { desktopId: 'local_66666666-2222-3333-4444-555555555555' }),
    done('all', { desktopId: 'local_55555555-2222-3333-4444-555555555555' }),
    done('loose', { desktopId: 'local_99999999-2222-3333-4444-555555555555' }),
    done('renamed', { desktopId: 'local_88888888-2222-3333-4444-555555555555' }),
  ];
  const r = resolveAll(roster, ['gone'], targets);
  assert.deepEqual(r, [
    { title: 'build-1', open: { kind: 'desktop', id: DESKTOP } },
    { title: 'bg-1', open: { kind: 'bg', id: JOB } },
    { title: 'all', why: 'its title is a command word' },
    { title: 'loose', why: 'not bound to its session' },
    { title: 'renamed', why: 'changed since it joined' },
  ]);
  const w = new Map();
  openWindow(w, r, 1000);
  assert.deepEqual([...w.keys()].sort(), [`bg:${JOB}`, `clean:${JOB}`, `clean:${DESKTOP}`, `desktop:${DESKTOP}`]);
  // Two done cards under one title open neither.
  assert.deepEqual(resolveAll([done('twin', { desktopId: DESKTOP }), done('twin', { bgId: JOB })], [], targets).map(x => x.why), ['more than one card has this title', 'more than one card has this title']);
  // 21 done cards: the usage line, nothing opens; 20 run.
  const many = n => Array.from({ length: n }, (_, i) => done(`t${i}`, { desktopId: `local_${i}` }));
  assert.equal(resolveAll(many(21), [], targets), undefined);
  assert.equal(resolveAll(many(20), [], targets).length, 20);
  assert.deepEqual(resolveAll([], [], targets), []);
  assert.equal(NOTHING_DONE, 'Nothing opened: no card is done.');
  // `all` and `none` are the whole argument, trimmed; inside a list each is a title.
  assert.equal(doneWord('done all'), 'all');
  assert.equal(doneWord('  done   all  '), 'all');
  assert.equal(doneWord('done none'), 'none');
  for (const a of ['done all, x', 'done x, all', 'done allx', 'done All', 'done', 'done none, x']) assert.equal(doneWord(a), undefined, a);
  assert.deepEqual(parseDone('done all, x'), ['all', 'x']);
});

test('484 C2: the reply lists each opened card with its kind, repository, folder and branch in labelled fields, and holds no id, path, line break or folder outside the rule', () => {
  const r = resolveAll([done('build-1', { desktopId: DESKTOP }), done('bg-1', { bgId: JOB })], [], targets);
  assert.equal(doneReply(r, targets, true), [
    'Opened 2 of 2 for 15 minutes:',
    '"build-1": Desktop, repository "grimoire", folder build-1, branch worktree-build-1',
    '"bg-1": background, repository "grimoire", folder bg-1, no branch',
    ...CLEAN_LINES,
    'Now send any message, so this session acts on them.',
    UNDO_LINE,
  ].join('\n'));
  assert.deepEqual(CLEAN_LINES, ['Folders and branches are as they were when each session joined.', 'Each worktree and branch goes only if the cleaner finds everything in it recoverable; anything else stays and is listed after.']);
  assert.equal(UNDO_LINE, "The lead may act on this at its next turn, which a member's message can start. To take it back, type /brigade done none now.");

  // Hostile names: a title with a quote, a backslash and the reply's own words; a folder outside the rule; a repository name with a line break.
  const HOSTILE = 'local_44444444-2222-3333-4444-555555555555';
  const title = 'x" kept: \\ "build-1": Desktop';
  const bad = new Map([
    [HOSTILE, { kind: 'desktop', name: title, cwd: '/work/odd\nrepo/.claude/worktrees/.hidden', repo: '/work/odd\nrepo/.git', branch: 'b' }],
    [JOB, { kind: 'bg', name: 'bg-1', cwd: '/elsewhere/bg-1', repo: '/work/grimoire/.git' }],
  ]);
  const hr = resolveAll([done(title, { desktopId: HOSTILE }), done('bg-1', { bgId: JOB })], [], bad);
  const reply = doneReply(hr, bad, true);
  assert.match(reply, /^"x\\" kept: \\\\ \\"build-1\\": Desktop": Desktop, repository "odd repo", no folder the cleaner can remove, branch b$/m, reply);
  assert.match(reply, /^"bg-1": background, repository "grimoire", no folder the cleaner can remove, no branch$/m, reply);
  assert.ok(!reply.includes(HOSTILE) && !reply.includes(JOB) && !/[A-Za-z]:[\\/]|\/work|\/elsewhere|\.hidden/.test(reply), reply);
  assert.equal(reply.split('\n').length, 1 + 2 + CLEAN_LINES.length + 2);

  // A repository sitting right in a home folder is never named by that folder, which names the account.
  const HOME = 'local_33333333-2222-3333-4444-555555555555';
  for (const repo of ['/home/alice/.git', 'C:\\Users\\Alice\\.git']) {
    const homeTargets = new Map([[HOME, { kind: 'desktop', name: 'h-1', cwd: '/x', repo, branch: 'b' }]]);
    const line = doneReply(resolveAll([done('h-1', { desktopId: HOME })], [], homeTargets), homeTargets, true).split('\n')[1];
    assert.equal(line, '"h-1": Desktop, a repository with no GitHub name, no folder the cleaner can remove, branch b', repo);
    assert.doesNotMatch(line, /alice/i);
  }

  // A direction-changing or control character in a done card's title or a repository name never reaches the reply raw.
  const RLO = 'local_22222222-2222-3333-4444-555555555555';
  const rloTitle = `t\u{202E}x`;
  const rloTargets = new Map([[RLO, { kind: 'desktop', name: 'tx', cwd: '/x', repo: `/work/r\u{202E}e/.git` }]]);
  const rloReply = doneReply(resolveAll([done(rloTitle, { desktopId: RLO })], [], rloTargets), rloTargets, true);
  assert.ok(!/[\u{202E}\u{7}]/u.test(rloReply), rloReply);
  assert.match(rloReply, /^"tx": Desktop, repository "re", /m, rloReply);
  assert.equal(quoted(`a\u{202E}b\u{7}"\\`), '"a\\u{202e}b\\u{7}\\"\\\\"');
});

test('484 C7: a folder the cleaner may remove sits directly under <main>/.claude/worktrees, passes the name rule, and its repository ends in .git under a main that passes commandPath', () => {
  assert.deepEqual(cleanFolder({ cwd: '/work/g/.claude/worktrees/build-1', repo: '/work/g/.git' }), { main: '/work/g', folder: 'build-1' });
  assert.deepEqual(cleanFolder({ cwd: 'C:\\Work\\G\\.claude\\worktrees\\b_1.x', repo: 'c:/work/g/.git' }), { main: 'c:/work/g', folder: 'b_1.x' }, 'Windows folds case and separators');
  for (const t of [
    { cwd: '/work/g/.claude/worktrees/a/b', repo: '/work/g/.git' },
    { cwd: '/work/g/other/build-1', repo: '/work/g/.git' },
    { cwd: '/work/g/.claude/worktrees/.x', repo: '/work/g/.git' },
    { cwd: '/work/g/.claude/worktrees/-x', repo: '/work/g/.git' },
    { cwd: '/work/g/.claude/worktrees/a b', repo: '/work/g/.git' },
    { cwd: '/work/g/.claude/worktrees/x', repo: '/work/g/.git/worktrees/x' },
    { cwd: '/work/g/.claude/worktrees/x', repo: '/work/g/repo.git' },
    { cwd: "/work/g'/.claude/worktrees/x", repo: "/work/g'/.git" },
    { cwd: '/work/../g/.claude/worktrees/x', repo: '/work/../g/.git' },
    { cwd: '/work/G/.claude/worktrees/x', repo: '/work/g/.git' },
  ]) assert.equal(cleanFolder(t), undefined, JSON.stringify(t));
});

// C3's clearing of the window is pinned as a line of doneCommand by "C1, C2, C4, C5: the done path..." below.
test('484 C3: done none answers its fixed line', () => {
  assert.equal(NONE_REPLY, 'Closed: no window is open.');
});

test('484 C4, C9: a clean entry stays open for 15 minutes however often it is read, and one past its time is deleted', () => {
  const w = opened(['build-1'], 0);
  assert.equal(entryOpen(w, 'clean', DESKTOP, 1000), true);
  assert.equal(entryOpen(w, 'clean', DESKTOP, WINDOW_MS - 1), true, 'a second read within the window');
  assert.equal(entryOpen(w, 'clean', JOB, 1000), false);
  assert.equal(entryOpen(w, 'clean', DESKTOP, WINDOW_MS), false);
  assert.ok(!w.has(`clean:${DESKTOP}`), 'deleted past its time');
  assert.ok(w.has(`desktop:${DESKTOP}`), 'the archive entry is takeEntry\'s');
});

test('484 C14: with the pane closed the reply holds the pane line; with it open, none', () => {
  const r = resolveTitles(['build-1'], cards, targets);
  assert.equal(PANE_CLOSED_LINE, 'The Brigade pane is closed, so the stop and the cleanup will be refused: send /brigade to open it, then any message.');
  assert.ok(doneReply(r, targets, false).endsWith(`\n${PANE_CLOSED_LINE}\n${UNDO_LINE}`), 'the undo line stays last (S2.1)');
  assert.ok(!doneReply(r, targets, true).includes('pane'));
});

test('484 S2.5: the stop answer names clean_up, not read_cleanup', () => {
  assert.match(gate.stopAnswer({ exitCode: 0 }), /clean_up/);
  assert.doesNotMatch(gate.stopAnswer({ exitCode: 0 }), /read_cleanup/);
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
// The statements of a slice: each line trimmed, comments and blank lines left out.
const live = text => text.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('//'));

test('C7: the archive hook matches Desktop\'s archive tool by the name ADR 0012 measured (A14)', () => {
  assert.equal(gate.ARCHIVE_TOOL, 'mcp__ccd_session_mgmt__archive_session');
});

test('C1, C2, C4, C5: the done path is read first and returns, hands on the event\'s own origin, gates before it reads or opens anything, and fails closed', () => {
  const command = hook("on('command.run', { command: 'brigade' }");
  assert.match(command, /^on\('command\.run', \{ command: 'brigade' \}, async \(\$, e, next\) => \{/);
  assert.match(command, /\n {4}if \(isDoneCommand\(e\.args\)\) return doneCommand\(\$, e\.origin, next\.origin, e\.args\)\n/);
  assert.ok(command.indexOf('isDoneCommand(e.args)') < command.indexOf('isLevelCommand(e.args)'));
  assert.match(command, /\.catch\(\(\$, e, next\) => \{\n {4}if \(isDoneCommand\(e\.args\)\) return \{ text: DONE_REPLIES\.failed \}/);
  // Every live line of the function, in order: a line commented out, moved,
  // added or changed fails here.
  assert.deepEqual(live(between('async function doneCommand', '\n}\n')), [
    'async function doneCommand($: EngineInterface, origin: unknown, dispatch: unknown, args: string): Promise<{ text: string }> {',
    'try {',
    'if (!levelOriginAllowed(origin) || !fromEngine(dispatch)) return { text: DONE_REPLIES.notTyped }',
    'const word = doneWord(args)',
    "if (word === 'none') {",
    'doneWindow.clear()',
    'return { text: NONE_REPLY }',
    '}',
    "const titles = word === 'all' ? [] : parseDone(args)",
    'if (titles === undefined) return { text: DONE_REPLIES.usage }',
    'const { cards } = await read($, roster)',
    "const resolved = word === 'all' ? resolveAll(cards, await read($, dismissed), cleanupTargets) : resolveTitles(titles, cards, cleanupTargets)",
    'if (resolved === undefined) return { text: DONE_REPLIES.usage }',
    'if (resolved.length === 0) return { text: NOTHING_DONE }',
    'openWindow(doneWindow, resolved, await $.clock.now())',
    'return { text: doneReply(resolved, cleanupTargets, await paneOpen($)) }',
    '} catch {',
    'return { text: DONE_REPLIES.failed }',
    '}',
  ]);
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
  // Every live line, in order, up to each refusal's fixed rule: no guard can be
  // commented out, no exit added, and nothing but stopAnswer answers after the run.
  const lines = live(stop).map(l => l.replace(/return refuseStop\(.*\)$/, 'return refuseStop(…)'));
  assert.deepEqual(lines, [
    'async function stopBackground($: EngineInterface, e: Record<string, unknown>, origin: unknown) {',
    'if (e.agentId !== undefined) return refuseStop(…)',
    'if (!fromEngine(origin)) return refuseStop(…)',
    'const input = Object.fromEntries(Object.entries(e).filter(([k]) => !GATE_ENVELOPE.includes(k)))',
    'if (!rulesAllowTool(await $.tool.check({ tool: STOP_NAME, input }))) return refuseStop(…)',
    'if (!(await offered($))) return refuseStop(…)',
    'if (!(await paneOpen($))) return refuseStop(…)',
    'const { title } = input',
    "if (Object.keys(input).some(k => k !== 'title') || typeof title !== 'string') return refuseStop(…)",
    'const { cards } = await read($, roster)',
    'const [r] = resolveTitles([oneLine(title, 80)], cards, cleanupTargets)',
    "if (r === undefined || !('open' in r) || r.open.kind !== 'bg') return refuseStop(…)",
    'const t = r.open',
    "if (!takeEntry(doneWindow, 'bg', t.id, await $.clock.now())) return refuseStop(…)",
    'if (!(await ghFindable($))) return { result: stopAnswer(undefined) }',
    "const ran = await $.process.run(['claude', 'stop', t.id], { timeoutMs: 15000 }).catch(() => undefined)",
    'return { result: stopAnswer(ran) }',
    '}',
  ]);
  // Each refusal's rule is a fixed string: no value reaches it.
  for (const l of live(stop)) if (l.includes('refuseStop(')) assert.match(l, /return refuseStop\((?:'[^'$]*'|"[^"$]*"|RULES_RULE|OFFER_RULE)\)$/, l);
  assert.ok(!/["'`]rm["'`]/.test(stop), 'no claude rm');
  const handler = between("on('tool.call', { tool: STOP_NAME }", "on('tool.call', { tool: CLEAN_NAME }");
  assert.match(handler, /return await stopBackground\(\$, e as unknown as Record<string, unknown>, next\.origin\)/);
  assert.match(handler, /\}\)\.catch\(\(\) => \(\{ deny: 'stop_background_session refused: /);
});

test('484 C4, C5, C8: clean_up gates before it runs, in order, takes no input, reads only open clean entries, checks the cleaner file, and runs only through runCleaner', () => {
  const clean = between('async function cleanUp', '// end cleanUp');
  const lines = live(clean).map(l => l.replace(/return refuseClean\(.*\)$/, 'return refuseClean(…)'));
  assert.deepEqual(lines, [
    'async function cleanUp($: EngineInterface, e: Record<string, unknown>, origin: unknown) {',
    'if (e.agentId !== undefined) return refuseClean(…)',
    'if (!fromEngine(origin)) return refuseClean(…)',
    'const input = Object.fromEntries(Object.entries(e).filter(([k]) => !GATE_ENVELOPE.includes(k)))',
    'if (!rulesAllowTool(await $.tool.check({ tool: CLEAN_NAME, input }))) return refuseClean(…)',
    'if (!(await offered($))) return refuseClean(…)',
    'if (!(await paneOpen($))) return refuseClean(…)',
    'if (Object.keys(input).length > 0) return refuseClean(…)',
    'return cleanupTurn(async () => {',
    'const now = await $.clock.now()',
    "const open = [...doneWindow.values()].filter(x => x.kind === 'clean').map(x => x.id).filter(id => entryOpen(doneWindow, 'clean', id, now))",
    'if (open.length === 0) return refuseClean(…)',
    'const config = cleanerConfig($.plugin.root, $.plugin.name)',
    'if (config === undefined) return refuseClean(…)',
    'if (!(await ghFindable($))) return refuseClean(…)',
    'const sep = sepOf(config)',
    'const cleaner = `${config}${sep}pact${sep}tools${sep}cleaner.mjs`',
    'if (!(await cleanerReady(cleaner, path => $.fs.stat(path, { resolve: true })))) return { result: CLEAN_ANSWERS.notInstalled }',
    'const cards = open.map(id => {',
    'const t = cleanupTargets.get(id)',
    "return { title: t?.name ?? 'a card not bound to its session', where: t === undefined ? undefined : cleanFolder(t) }",
    '})',
    'return { result: await runCleaner(cleaner, cards, (argv, init) => $.process.run([...argv], init)) }',
    '})',
    '}',
  ]);
  for (const l of live(clean)) if (l.includes('refuseClean(')) assert.match(l, /return refuseClean\((?:'[^'$]*'|"[^"$]*"|RULES_RULE|OFFER_RULE)\)$/, l);
  const handler = hook("on('tool.call', { tool: CLEAN_NAME }");
  assert.match(handler, /return await cleanUp\(\$, e as unknown as Record<string, unknown>, next\.origin\)/);
  assert.match(handler, /\}\)\.catch\(\(\) => \(\{ deny: 'clean_up refused: /);
  assert.match(register, /\{ name: CLEAN_TOOL, description: CLEAN_DESCRIPTION, inputSchema: CLEAN_SCHEMA \}/);
});

test('484 C10: read_cleanup is gone from the README, CONTRIBUTING and skills/ but the changelog\'s history; SECURITY.md names no forced removal or claude rm for cleanup; ADR 0014 exists', () => {
  const root = new URL('../', import.meta.url);
  const read = rel => fs.readFileSync(new URL(rel, root), 'utf8');
  for (const rel of ['README.md', 'CONTRIBUTING.md']) assert.ok(!read(rel).includes('read_cleanup'), rel);
  const skills = fs.readdirSync(new URL('skills/', root), { recursive: true }).map(f => f.replace(/\\/g, '/')).filter(f => f.endsWith('.md') && !f.endsWith('contract.changelog.md'));
  assert.ok(skills.length > 5);
  for (const f of skills) assert.ok(!read(`skills/${f}`).includes('read_cleanup'), f);
  const security = read('SECURITY.md');
  const cleanup = security.slice(security.indexOf('**One skill tells the agent to start other agent sessions'), security.indexOf('The head chef starts a background session'));
  assert.ok(cleanup.length > 200, 'the head-chef cleanup paragraph');
  assert.match(cleanup, /typed `\/brigade done` is the\s+only yes/);
  assert.doesNotMatch(cleanup, /forced once|`-D` where|`claude rm` take/);
  assert.ok(fs.existsSync(new URL('docs/adr/0014-brigade-runs-the-pacts-cleaner-in-the-typed-window.md', root)));
});

test('484 C10: brigade/ holds no removal command text, and read_cleanup is gone', () => {
  const dir = new URL('../brigade/', import.meta.url);
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => /\.(?:ts|tsx)$/.test(f) && !/\.test\./.test(f) && !f.startsWith('types'));
  assert.ok(files.length > 5);
  for (const f of files) {
    const text = fs.readFileSync(new URL(f.replace(/\\/g, '/'), dir), 'utf8');
    for (const bad of ['worktree remove', 'branch -d', 'branch -D', "'-D'", '--force', 'claude rm', "'rm'", 'read_cleanup']) assert.ok(!text.includes(bad), `${f}: ${bad}`);
  }
});
