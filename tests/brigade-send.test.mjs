// A send to a member that lists twice (brigade/send.ts, GRIM-41).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedCursor, needsListing, resolveListed, resolveSend, MAX_PAGES,REFUSE_MANY, REFUSE_NO_LOCAL, REFUSE_PARTIAL, REFUSE_TWO_LOCAL, REFUSE_UNKNOWN } from '../brigade/send.ts';

const local = (ref = 'aaa111', type = 'bg', name = 'build-1') => ({ name, ref, type });
const remote = (ref = 'bbb222', name = 'build-1') => ({ name, ref, type: 'remote_control' });
const page = (rows, extra = {}) => ({ listing: '', sections: [{ kind: 'sessions', total: rows.length, rows }], ...extra });
const resolve = (rows, more = true) => resolveSend('build-1', [page(rows)], !more);

test('a twin resolves to the local row by its ref, in either order and for each local kind', () => {
  for (const type of ['interactive', 'bg', 'daemon', 'daemon-worker']) {
    assert.deepEqual(resolve([remote(), local('aaa111', type)]), { to: 'build-1 [aaa111]' });
    assert.deepEqual(resolve([local('aaa111', type), remote()]), { to: 'build-1 [aaa111]' });
  }
});

test('other names in a subagent list and a cut-short account list leave a twin resolving', () => {
  const p = page([local(), remote()], { notes: [{ kind: 'list_truncated', text: 'x' }] });
  p.sections.push({ kind: 'subagents', total: 1, rows: [{ name: 'other', id: 'a1' }] });
  assert.deepEqual(resolveSend('build-1', [p], false), { to: 'build-1 [aaa111]' });
});

test('every refusal is its own text and says what to do', () => {
  const all = [REFUSE_MANY, REFUSE_NO_LOCAL, REFUSE_PARTIAL, REFUSE_TWO_LOCAL, REFUSE_UNKNOWN];
  assert.equal(new Set(all).size, all.length);
  for (const text of all) assert.match(text, /nothing was sent.*tell the owner/);
});

test('the only row on this machine is sent by its ref, with its Remote Control row unseen', () => {
  const cut = page([local()], { notes: [{ kind: 'list_truncated', text: 'x' }] });
  assert.deepEqual(resolveSend('build-1', [cut], false), { to: 'build-1 [aaa111]' });
});

test('no row, one row elsewhere, or one local row without a usable ref or a full list, passes on as sent', () => {
  for (const rows of [[], [remote()], [{ name: 'build-1', ref: 'a] [b', type: 'bg' }], [local('a1', 'bg', 'other'), remote('b2', 'other')]]) {
    assert.deepEqual(resolve(rows), {});
  }
  assert.deepEqual(resolve([local()], false), {});
});

test('a subagent or teammate of the name passes on, as the engine gives it the bare name', () => {
  for (const kind of ['subagents', 'teammates']) {
    const p = page([local(), remote()]);
    p.sections.push({ kind, total: 1, rows: [{ name: 'build-1', id: 'a1' }] });
    assert.deepEqual(resolveSend('build-1', [p], false), {});
  }
});

test('two local rows are refused', () => {
  assert.deepEqual(resolve([local(), local('ccc333', 'interactive')]), { deny: REFUSE_TWO_LOCAL });
});

test('three or more rows are refused', () => {
  assert.deepEqual(resolve([local(), remote(), remote('ccc333')]), { deny: REFUSE_MANY });
  assert.deepEqual(resolve([local(), local('ccc333'), remote()]), { deny: REFUSE_MANY });
});

test('no local row is refused', () => {
  assert.deepEqual(resolve([remote(), remote('ccc333')]), { deny: REFUSE_NO_LOCAL });
  assert.deepEqual(resolve([remote(), { name: 'build-1', ref: 'ccc333', type: 'cloud' }]), { deny: REFUSE_NO_LOCAL });
});

test('a local row beside anything but a Remote Control row, or with no usable ref, is refused', () => {
  for (const other of [{ name: 'build-1', ref: 'c1', type: 'cloud' }, { name: 'build-1', ref: 'c1' }, { name: 'build-1', ref: 'c1', type: 'new-kind' }]) {
    assert.deepEqual(resolve([local(), other]), { deny: REFUSE_UNKNOWN });
  }
  for (const ref of [undefined, '', 'a] [b', 'a\nb']) {
    assert.deepEqual(resolve([{ name: 'build-1', ref, type: 'bg' }, remote()]), { deny: REFUSE_UNKNOWN });
  }
});

test('a twin in a listing that may be missing rows on this machine is refused', () => {
  assert.deepEqual(resolve([local(), remote()], false), { deny: REFUSE_PARTIAL });
  const notes = [{ kind: 'local_list_failed', text: 'x' }];
  assert.deepEqual(resolveSend('build-1', [page([local(), remote()], { notes })], false), { deny: REFUSE_PARTIAL });
  const q = page([local(), remote()]);
  q.sections[0].notes = notes;
  assert.deepEqual(resolveSend('build-1', [q], false), { deny: REFUSE_PARTIAL });
});

test('an answer with no rows to read passes on', () => {
  for (const p of [undefined, null, 'text', {}, { sections: 'x' }, { sections: [null, { kind: 'sessions' }] }]) {
    assert.deepEqual(resolveSend('build-1', [p], false), {});
  }
});

test('only a bare session name is looked up', () => {
  assert.equal(needsListing('build-1'), true);
  for (const to of ['build-1 [aaa111]', 'main', '*', 'uds:/x', 'bridge:session_1', '', undefined, 4]) {
    assert.equal(needsListing(to), false, String(to));
  }
});

test('every page is read, and a page that fails or runs past the cap leaves the twin refused', async () => {
  const foot = '(… 1 more not shown — call again with cursor="0a" for the next page)';
  const asked = [];
  const two = await resolveListed('build-1', async cursor => {
    asked.push(cursor);
    return cursor === undefined ? page([local()], { listing: foot }) : page([remote()]);
  });
  assert.deepEqual([two, asked], [{ to: 'build-1 [aaa111]' }, [undefined, '0a']]);
  const failed = await resolveListed('build-1', async cursor => {
    if (cursor !== undefined) throw new Error('no page');
    return page([local(), remote()], { listing: foot });
  });
  assert.deepEqual(failed, { deny: REFUSE_PARTIAL });
  let reads = 0;
  const endless = await resolveListed('build-1', async () => page(reads++ === 0 ? [local(), remote()] : [], { listing: foot }));
  assert.deepEqual([endless, reads], [{ deny: REFUSE_PARTIAL }, MAX_PAGES]);
});

test('a footer that only says to call again later is not followed, so a twin already read resolves', async () => {
  const later = '(agents may be missing from this page \u2014 call again later with cursor="0e" for any that are)';
  let reads = 0;
  const found = await resolveListed('build-1', async () => {
    reads++;
    return page([local(), remote()], { listing: later });
  });
  assert.deepEqual([found, reads], [{ to: 'build-1 [aaa111]' }, 1]);
});

test('the next page is read from the listing\'s own footer line only', () => {
  const foot = '(… 3 more not shown — call again with cursor="0a1b2c3d" for the next page)';
  assert.equal(listedCursor({ listing: `Peer sessions (9):\n  x\n\n${foot}` }), '0a1b2c3d');
  const later = '(agents may be missing from this page \u2014 call again later with cursor="0e" for any that are)';
  assert.equal(listedCursor({ listing: later }), undefined);
  assert.equal(listedCursor({ listing: `  ${foot}  ·  bg` }), undefined);
  assert.equal(listedCursor({ listing: 'Peer sessions (1):' }), undefined);
  assert.equal(listedCursor(undefined), undefined);
});
