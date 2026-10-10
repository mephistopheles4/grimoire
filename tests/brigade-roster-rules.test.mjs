// The roster's shared rules, tested at their own seam: the shape check and its
// strict mode, the byte cap measured on the text that is written, and the path
// decision given `stat` answers. brigade/roster.ts takes plain values and no
// engine import, so these run under `node --test` in CI, where there is no
// Claude Code.
//
// The Windows-shaped `stat` answers come from brigade/recorded-stats.ts, what
// the real engine answered about real links (scripts/record-brigade-stats.mjs
// records it). The POSIX-shaped ones are written by hand, in the same shape.
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const roster = await import('../brigade/roster.ts');
const { RECORDED } = await import('../brigade/recorded-stats.ts');
const { MAX_ROSTER_BYTES, checkRoster, foldsCase, placeRoster, serialize, statRejection } = roster;

const SID = '11111111-2222-3333-4444-555555555555';
const card = (title, over = {}) => ({ title, work: '', phase: '', settings: '', status: 'working', ...over });

// --- the shape check ------------------------------------------------------------

test('the pane reads a missing list as empty; the strict check refuses it', () => {
  assert.deepEqual(checkRoster('{}'), { value: { cards: [], todos: [] } });
  assert.deepEqual(checkRoster('{}', true), { error: 'the roster has no "cards" list' });
  assert.deepEqual(checkRoster('{"cards":[]}', true), { error: 'the roster has no "todos" list' });
  assert.deepEqual(checkRoster('{"cards":[],"todos":[]}', true), { value: { cards: [], todos: [] } });
});

test('__proto__ and constructor are refused at the top level and nested', () => {
  for (const raw of [
    '{"cards":[],"todos":[],"__proto__":{"x":1}}',
    '{"cards":[],"todos":[],"constructor":1}',
    '{"cards":[{"title":"a","status":"working","__proto__":{"x":1}}],"todos":[]}',
    '{"cards":[],"todos":[{"id":"t","text":"x","constructor":1}]}',
  ]) {
    for (const strict of [false, true]) {
      const r = checkRoster(raw, strict);
      assert.ok('error' in r, raw);
      assert.match(r.error, /has a field the roster does not use: (__proto__|constructor)/);
    }
  }
  assert.equal({}.x, undefined);
});

test('the strict check holds every rule the normal one does', () => {
  const bad = [
    { cards: [card('a', { status: 'paused' })], todos: [] },
    { cards: [card('a'), card('a')], todos: [] },
    { cards: Array.from({ length: 51 }, (_, i) => card(`c${i}`)), todos: [] },
    { cards: [], todos: [{ id: 't', text: 'x' }, { id: 't', text: 'y' }] },
    { cards: [card('a', { colour: 'red' })], todos: [] },
  ];
  for (const r of bad) {
    assert.ok('error' in checkRoster(JSON.stringify(r)));
    assert.ok('error' in checkRoster(JSON.stringify(r), true));
  }
});

// --- the byte cap ------------------------------------------------------------------

test('the cap counts UTF-8 bytes of the text that is written, and refuses one byte over', () => {
  const empty = JSON.stringify({ cards: [], todos: [] });
  // One to-do whose text fills the roster to exactly the cap: ASCII padding,
  // then the same with one more byte.
  const base = JSON.stringify({ cards: [], todos: [{ id: 't', text: '' }] });
  const fill = MAX_ROSTER_BYTES - Buffer.byteLength(base);
  const at = { cards: [], todos: [{ id: 't', text: 'a'.repeat(fill) }] };
  assert.deepEqual(serialize(at), { value: JSON.stringify(at) });
  const over = { cards: [], todos: [{ id: 't', text: 'a'.repeat(fill + 1) }] };
  assert.match(serialize(over).error, new RegExp(`is ${MAX_ROSTER_BYTES + 1} bytes, over the cap of ${MAX_ROSTER_BYTES}`));
  // A four-byte character counts four.
  const wide = { cards: [], todos: [{ id: 't', text: '\u{1F600}'.repeat(Math.floor(fill / 4) + 1) }] };
  assert.ok('error' in serialize(wide));
  assert.deepEqual(serialize({ cards: [], todos: [] }), { value: empty });
});

test('the cap is 256 KiB', () => {
  assert.equal(MAX_ROSTER_BYTES, 256 * 1024);
});

// --- stat rejections ---------------------------------------------------------------

test('a rejection the engine gave for a missing path reads as missing, and nothing else does', () => {
  for (const template of Object.values(RECORDED.rejections)) {
    const message = template.replace('<plugin>', 'grimoire').replace('<path>', 'C:\\cfg\\x');
    assert.deepEqual(statRejection(message), { missing: true }, message);
  }
  // What a test's own `stat` hook answers reaches the mod this way.
  assert.deepEqual(statRejection('grimoire: $.fs.stat: failed: ENOENT'), { missing: true });
  for (const other of [
    'grimoire: $.fs.stat(C:\\x) failed: EACCES',
    'grimoire: $.fs.stat(C:\\x) failed: EPERM',
    'grimoire: $.fs.stat(C:\\ENOENT) failed: EIO',
    'no implementation for fs.stat',
    'ENOENTS',
  ]) {
    assert.ok('failed' in statRejection(other), other);
  }
});

// --- the path decision -------------------------------------------------------------

// A `stat` over a table: path -> answer. A path not in it is missing.
const statFrom = (table, log = []) => async path => {
  log.push(path);
  return table[path] ?? { missing: true };
};
const dir = realPath => ({ found: { kind: 'dir', size: 0, isLink: false, realPath } });
const file = (realPath, size = 10) => ({ found: { kind: 'file', size, isLink: false, realPath } });
// An answer built from the recording: the shape as the engine gave it, with
// the real path it would carry.
const recorded = (shape, realPath) => {
  const r = RECORDED.stats[shape];
  return { found: { kind: r.kind, size: 0, isLink: r.isLink, ...(r.realPath === 'none' ? {} : { realPath }) } };
};

const shapes = {
  windows: {
    config: 'C:\\cfg\\.claude',
    join: (...p) => p.join('\\'),
    other: 'D:\\elsewhere',
  },
  posix: {
    config: '/srv/u/.claude',
    join: (...p) => p.join('/'),
    other: '/srv/elsewhere',
  },
};

for (const [os, s] of Object.entries(shapes)) {
  const ID = 'grimoire-inline';
  const at = (...p) => s.join(s.config, ...p);
  const PLUGINS = at('plugins');
  const DATA = at('plugins', 'data');
  const IDDIR = at('plugins', 'data', ID);
  const BRIGADE = at('plugins', 'data', ID, 'brigade');
  const FILE = s.join(BRIGADE, `${SID}.json`);
  const all = (over = {}) => ({
    [s.config]: dir(s.config),
    [PLUGINS]: dir(PLUGINS),
    [DATA]: dir(DATA),
    [IDDIR]: dir(IDDIR),
    [BRIGADE]: dir(BRIGADE),
    ...over,
  });
  const place = (table, sid = SID, id = ID) => placeRoster(s.config, id, sid, statFrom(table));

  test(`${os}: every folder there and no file: the file may be created`, async () => {
    assert.deepEqual(await place(all()), { file: FILE });
  });

  test(`${os}: a roster file there is reported with its size`, async () => {
    assert.deepEqual(await place(all({ [FILE]: file(FILE, 42) })), { file: FILE, existing: { size: 42 } });
  });

  test(`${os}: a missing folder below plugins ends the walk, and the write creates it`, async () => {
    for (const gone of [DATA, IDDIR, BRIGADE]) {
      const t = all();
      for (const k of Object.keys(t)) if (k.startsWith(gone)) delete t[k];
      const log = [];
      assert.deepEqual(await placeRoster(s.config, ID, SID, statFrom(t, log)), { file: FILE }, gone);
      assert.equal(log.at(-1), gone, 'nothing is asked below a missing folder');
    }
  });

  test(`${os}: plugins missing is refused`, async () => {
    assert.deepEqual(await place({ [s.config]: dir(s.config) }), { refused: 'path: the config folder has no plugins folder' });
  });

  test(`${os}: a link at any folder is refused, whatever its kind`, async () => {
    const shapesOf = os === 'windows' ? ['junction', 'broken-junction', 'dir-symlink'] : ['dir-symlink'];
    for (const [name, path] of [['plugins', PLUGINS], ['data', DATA], [ID, IDDIR], ['brigade', BRIGADE]]) {
      for (const shape of shapesOf) {
        const r = await place(all({ [path]: recorded(shape, s.join(s.other, name)) }));
        assert.deepEqual(r, { refused: `link: ${name} is a link` }, `${shape} at ${name}`);
      }
    }
  });

  test(`${os}: a folder that leads elsewhere with no link flag is refused by the real-path compare`, async () => {
    // A mount point or a reparse kind `isLink` was never measured for.
    for (const [name, path] of [['plugins', PLUGINS], ['brigade', BRIGADE]]) {
      const r = await place(all({ [path]: dir(s.join(s.other, name)) }));
      assert.deepEqual(r, { refused: `link: ${name} does not lead where its name says` });
    }
  });

  test(`${os}: a folder with no real path, or not a folder, or a stat that fails, is refused`, async () => {
    assert.match((await place(all({ [DATA]: { found: { kind: 'dir', size: 0, isLink: false } } }))).refused, /^link: data does not lead/);
    assert.deepEqual(await place(all({ [DATA]: file(DATA) })), { refused: 'path: data is not a folder' });
    assert.match((await place(all({ [DATA]: { failed: 'EACCES' } }))).refused, /^path: data could not be read \(EACCES\)/);
  });

  test(`${os}: the roster file refused as a link, broken or not, as a non-file, or landing elsewhere`, async () => {
    const shapesOf = os === 'windows' ? ['file-symlink', 'broken-file-symlink', 'junction'] : ['file-symlink', 'broken-file-symlink'];
    for (const shape of shapesOf) {
      assert.deepEqual(await place(all({ [FILE]: recorded(shape, s.join(s.other, 'x.json')) })), { refused: 'link: the roster file is a link' }, shape);
    }
    assert.deepEqual(await place(all({ [FILE]: dir(FILE) })), { refused: 'path: the roster path is not a plain file' });
    assert.deepEqual(await place(all({ [FILE]: file(s.join(s.other, 'x.json')) })), { refused: 'link: the roster file does not lead where its name says' });
    assert.deepEqual(await place(all({ [FILE]: { found: { kind: 'file', size: 1, isLink: false } } })), { refused: 'link: the roster file does not lead where its name says' });
    assert.match((await place(all({ [FILE]: { failed: 'EPERM' } }))).refused, /^path: the roster file could not be read/);
  });

  test(`${os}: a hard link keeps its own spelling and is not caught here; the writer's strict check is what stops it`, async () => {
    const r = await place(all({ [FILE]: recorded('hard-link', FILE) }));
    assert.deepEqual(r, { file: FILE, existing: { size: 0 } });
  });

  test(`${os}: a config folder that is itself a link is resolved, not refused`, async () => {
    const real = s.join(s.other, 'real-config');
    const sub = (...p) => s.join(real, ...p);
    const t = {
      [s.config]: recorded(os === 'windows' ? 'junction' : 'dir-symlink', real),
      [PLUGINS]: dir(sub('plugins')),
      [DATA]: dir(sub('plugins', 'data')),
      [IDDIR]: dir(sub('plugins', 'data', ID)),
      [BRIGADE]: dir(sub('plugins', 'data', ID, 'brigade')),
    };
    assert.deepEqual(await place(t), { file: FILE });
    assert.deepEqual(await place({ ...t, [s.config]: { found: { kind: 'other', size: 0, isLink: true } } }), {
      refused: 'path: the config folder does not resolve to a folder',
    });
  });

  test(`${os}: a session id or data id out of shape is refused before any stat`, async () => {
    for (const [sid, id] of [['not-an-id', ID], [`${SID}/../x`, ID], [SID, '../x'], [SID, 'a b']]) {
      const log = [];
      const r = await placeRoster(s.config, id, sid, statFrom(all(), log));
      assert.match(r.refused, /^path: /);
      assert.deepEqual(log, []);
    }
  });
}

test('windows: the real-path compare ignores case and separators; posix: it does not ignore case', async () => {
  const C = 'C:\\cfg\\.claude';
  const ID = 'grimoire-inline';
  const t = {
    [C]: dir('c:/CFG/.Claude/'),
    [`${C}\\plugins`]: dir('C:\\cfg\\.claude\\Plugins'),
    [`${C}\\plugins\\data`]: dir('C:/cfg/.claude/plugins/DATA'),
  };
  assert.deepEqual(await placeRoster(C, ID, SID, statFrom(t)), { file: `${C}\\plugins\\data\\${ID}\\brigade\\${SID}.json` });
  const P = '/srv/u/.claude';
  const p = { [P]: dir(P), [`${P}/plugins`]: dir('/srv/u/.claude/Plugins') };
  assert.deepEqual(await placeRoster(P, ID, SID, statFrom(p)), { refused: 'link: plugins does not lead where its name says' });
});

test('case is folded for Windows paths and macOS homes and volumes only', () => {
  for (const p of ['C:\\x', 'c:/x', '\\\\server\\share', '/Users/a/.claude', '/Volumes/d/x']) assert.equal(foldsCase(p), true, p);
  for (const p of ['/srv/u/.claude', '/home/u', 'relative']) assert.equal(foldsCase(p), false, p);
});

test('the recording covers every link kind the guard is tested against', () => {
  for (const shape of ['folder', 'file', 'junction', 'broken-junction', 'dir-symlink', 'file-symlink', 'broken-file-symlink', 'hard-link']) {
    assert.ok(RECORDED.stats[shape], shape);
  }
  // What the guard leans on: every link says so, a broken one has no real
  // path, and a hard link does not look like a link at all.
  for (const shape of ['junction', 'broken-junction', 'dir-symlink', 'file-symlink', 'broken-file-symlink']) {
    assert.equal(RECORDED.stats[shape].isLink, true, shape);
  }
  assert.equal(RECORDED.stats['broken-junction'].realPath, 'none');
  assert.equal(RECORDED.stats['broken-file-symlink'].realPath, 'none');
  assert.equal(RECORDED.stats['hard-link'].isLink, false);
});

// --- Open in app: the route's pure rules -----------------------------------------
//
// Spec v3 on #212, decisions 5 and 10. Which card a press may send to the
// Desktop app's tool, whether the engine lists that tool, whether the owner's
// rules allow it, and what the app's answer means. The press itself is held
// by brigade/set-roster.test.ts under the engine's runner; the ceiling is held
// here, since the 2.1.289 engine declares none on a verdict.

const { appLink, listsOpenTool, readOpenAnswer, rulesAllowTool, toolSession } = roster;
const LOCAL = 'local_0123abcd-4567-89ab-cdef-0123456789ab';

test('only a Desktop id of the checked shape goes to the tool; every other card shape takes the link alone', () => {
  assert.equal(toolSession(card('a', { desktopId: LOCAL })), LOCAL);
  for (const over of [
    {},
    { url: 'https://claude.ai/code/session_ABC123' },
    { bgId: 'bg1' },
    { desktopId: 'local_NOT-HEX' },
    { desktopId: `${LOCAL}\n` },
    { desktopId: `local_${'a'.repeat(81)}` },
    { desktopId: 'session_ABC123' },
    { desktopId: `x${LOCAL}` },
  ]) {
    assert.equal(toolSession(card('a', over)), undefined, JSON.stringify(over));
  }
});

test('appLink is unchanged: a checked Desktop id, else a Remote Control link, else none', () => {
  assert.equal(appLink(card('a', { desktopId: LOCAL }), undefined), `claude://claude.ai/epitaxy/${LOCAL}`);
  assert.equal(appLink(card('a', { url: 'https://claude.ai/code/session_ABC123' }), undefined), 'claude://claude.ai/code/session_ABC123');
  assert.equal(appLink(card('a', { bgId: 'bg1' }), 'https://claude.ai/code/session_BG1'), 'claude://claude.ai/code/session_BG1');
  assert.equal(appLink(card('a', { bgId: 'bg1' }), undefined), undefined);
  assert.equal(appLink(card('a', { desktopId: 'local_NOT-HEX' }), undefined), undefined);
  assert.equal(appLink(card('a', { url: 'https://evil.example/code/session_A' }), undefined), undefined);
});

// Spec v4 on #220, decisions 1 and 4. The link route's program by host, and
// the real-path shape a Unix answer needs. The host reads themselves are held
// by brigade/set-roster.test.ts under the engine's runner.

const { openerArgv, unixRealPath } = roster;

test('openerArgv gives the one program for each host and the link, as two entries', () => {
  for (const link of ['claude://claude.ai/epitaxy/' + LOCAL, 'claude://claude.ai/code/session_ABC123']) {
    assert.deepEqual(openerArgv('windows', link), ['explorer.exe', link]);
    assert.deepEqual(openerArgv('macos', link), ['/usr/bin/open', link]);
    assert.deepEqual(openerArgv('linux', link), ['/usr/bin/xdg-open', link]);
    for (const os of ['windows', 'macos', 'linux']) assert.equal(openerArgv(os, link).length, 2);
  }
});

test('a Unix answer needs a raw real path with one leading / then a non-separator, and no \\ anywhere', () => {
  for (const p of ['/System/Library/CoreServices/SystemVersion.plist', '/usr/bin/xdg-open', '/x']) {
    assert.equal(unixRealPath(p), true, p);
  }
  for (const p of [
    'C:\\System\\Library\\CoreServices\\SystemVersion.plist',
    'C:/System/Library/CoreServices/SystemVersion.plist',
    '\\\\server\\share\\System\\Library\\CoreServices\\SystemVersion.plist',
    '//server/share/System/Library/CoreServices/SystemVersion.plist',
    '/\\server\\share',
    '/usr\\bin\\xdg-open',
    '\\usr\\bin\\xdg-open',
    'usr/bin/xdg-open',
    '/',
    '',
  ]) {
    assert.equal(unixRealPath(p), false, p);
  }
});

test('the tool is listed only under its exact name, in a list', () => {
  assert.equal(listsOpenTool([{ name: 'mcp__ccd_window__open_session_in', description: '', mcp: true }]), true);
  assert.equal(listsOpenTool([{ name: 'Bash' }, { name: 'mcp__ccd_window__open_session_in' }]), true);
  for (const tools of [
    [],
    [{ name: 'mcp__ccd_window__open_session_in_v2' }],
    [{ name: 'mcp__ccd window__open_session_in' }],
    [{ name: 'MCP__CCD_WINDOW__OPEN_SESSION_IN' }],
    [null, 'mcp__ccd_window__open_session_in'],
    { name: 'mcp__ccd_window__open_session_in' },
    undefined,
    'mcp__ccd_window__open_session_in',
  ]) {
    assert.equal(listsOpenTool(tools), false, JSON.stringify(tools));
  }
});

test("the owner's rules: allow and a mode's ask go on; a deny, a rule's ask, a lower ceiling or anything else stops", () => {
  for (const v of [
    { decision: 'allow' },
    { decision: 'ask' },
    { decision: 'ask', reason: 'the mode asks' },
    { decision: 'allow', ceiling: 'allow' },
    { decision: 'ask', ceiling: 'allow' },
  ]) {
    assert.equal(rulesAllowTool(v), true, JSON.stringify(v));
  }
  for (const v of [
    { decision: 'deny' },
    { decision: 'deny', reason: 'no' },
    { decision: 'ask', rule: 'mcp__ccd_window__open_session_in' },
    { decision: 'ask', rule: 'mcp__ccd_window' },
    { decision: 'ask', rule: '' },
    { decision: 'allow', ceiling: 'ask' },
    { decision: 'allow', ceiling: 'deny' },
    { decision: 'ask', ceiling: 'ask' },
    { decision: 'allow', ceiling: null },
    { decision: 'maybe' },
    {},
    null,
    undefined,
    'allow',
  ]) {
    assert.equal(rulesAllowTool(v), false, JSON.stringify(v));
  }
});

test("the app's answer has exactly one of three outcomes, and nothing in reading it throws", () => {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
  assert.deepEqual(readOpenAnswer(text('Opened session in a split pane.\nMore')), { opened: true, toast: 'Opened session in a split pane.' });
  assert.deepEqual(readOpenAnswer(text('Opened\r\nMore')), { opened: true, toast: 'Opened' });
  assert.deepEqual(readOpenAnswer(text('Opened\u{2028}More')), { opened: true, toast: 'Opened' });
  // Success without text: the fixed line.
  for (const content of [[], [{ type: 'image', data: '', mimeType: 'image/png' }], [{ type: 'text', text: 7 }], [{ type: 'text' }], [null], [{ type: 'text', text: '' }], [{ type: 'text', text: '\nlater' }]]) {
    assert.deepEqual(readOpenAnswer({ content, isError: false }), { opened: true, toast: 'Opened in the app.' }, JSON.stringify(content));
  }
  // Not a success: the link route, with the app's words when it refused in text.
  assert.deepEqual(readOpenAnswer(text('was not started from this session.\nUse window', true)), {
    opened: false,
    reason: 'The app did not open it: was not started from this session.',
  });
  for (const answer of [
    { content: [], isError: true },
    { content: [{ type: 'image' }], isError: true },
    { content: [{ type: 'text', text: 'ok' }] },
    { content: [{ type: 'text', text: 'ok' }], isError: 'false' },
    { content: [{ type: 'text', text: 'ok' }], isError: 0 },
    { content: 'ok', isError: false },
    { content: { 0: { type: 'text', text: 'ok' } }, isError: false },
    null,
    undefined,
    'Opened',
    [],
  ]) {
    assert.deepEqual(readOpenAnswer(answer), { opened: false }, JSON.stringify(answer));
  }
});

test("the app's text is cleaned and cut to 200 characters, whether it opened or refused", () => {
  const raw = `\u{1B}[31mOpened\u{7}\u{200B} \u{2066}split\u{2069}\u{202E}\t${'x'.repeat(400)}`;
  const opened = readOpenAnswer({ content: [{ type: 'text', text: raw }], isError: false });
  assert.equal(opened.opened, true);
  assert.equal([...opened.toast].length, 200);
  assert.ok(opened.toast.startsWith('[31mOpened split xxx'), opened.toast);
  assert.ok(opened.toast.endsWith('…'));
  assert.doesNotMatch(opened.toast, /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{200B}\u{202E}\u{2066}\u{2069}]/u);
  const refused = readOpenAnswer({ content: [{ type: 'text', text: raw }], isError: true });
  assert.equal(refused.reason, `The app did not open it: ${opened.toast}`);
});
test('an answer whose field throws when read is not an answer, and the reader does not throw', () => {
  const answer = { content: [], get isError() { throw new Error('planted'); } };
  assert.deepEqual(readOpenAnswer(answer), { opened: false });
  const block = { get type() { throw new Error('planted'); } };
  assert.deepEqual(readOpenAnswer({ content: [block], isError: false }), { opened: false });
});