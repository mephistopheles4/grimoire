// A send to a member that lists twice (brigade/send.ts, GRIM-41).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLD_MS, REFUSE_COLD, coldRefusal, listedCursor, needsListing, resolveListed, resolveSend, MAX_PAGES,REFUSE_MANY, REFUSE_NO_LOCAL, REFUSE_PARTIAL, REFUSE_TWO_LOCAL, REFUSE_UNKNOWN } from '../brigade/send.ts';

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

// The cold check (GRIM-86, claims C1 to C4).
const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
const row = (status, minutesAgo, name = 'build-1') => ({ name, status, sessionId: 'x', ...(minutesAgo === undefined ? {} : { updatedAt: NOW - minutesAgo * MIN }) });
const say = { to: 'build-1', message: 'go on' };

test('C1: a message to an idle member whose last turn ended 61 minutes ago is refused with the fixed words', () => {
  assert.equal(COLD_MS, 60 * MIN);
  assert.equal(coldRefusal(say, [row('idle', 61)], NOW), REFUSE_COLD);
    assert.equal(REFUSE_COLD, "Brigade: nothing was sent. That session has been idle for over an hour, so a message would make it re-read its whole context at full price. For new work on its issue, start a fresh session from the record on the issue, as \"When the model changes or the member is cold\" in head-chef's starting.md says, and ask the owner to stop the old one. To wake it on purpose, on your own judgment at level 3 and only on the owner's words at levels 1 and 2: log it with log_decision (source lead, with a flag giving the reason), then make the message's first line \"COLD WAKE: <your reason>\".");
});

// The wake line (GRIM-87).
const cold = [row('idle', 500)];
const send = message => coldRefusal({ to: 'build-1', message }, cold, NOW);

test('GRIM-87: a message whose first line is the wake line with a reason passes to a cold member', () => {
  assert.equal(send('COLD WAKE: only it holds the uncommitted fix'), undefined);
  assert.equal(send('COLD WAKE: only it holds the uncommitted fix\nCommit and push it.'), undefined);
  assert.equal(send('COLD WAKE: only it holds the uncommitted fix\r\nCommit and push it.'), undefined);
  assert.equal(coldRefusal({ to: 'build-1 [aaa111]', message: 'COLD WAKE: the owner asked' }, cold, NOW), undefined);
});

test('GRIM-87: anything short of the wake line and a reason is refused', () => {
  for (const message of [
    'go on\nCOLD WAKE: later line',
    ' COLD WAKE: leading space',
    '> COLD WAKE: quoted',
    '"COLD WAKE: quoted"',
    'cold wake: lower case',
    'COLD WAKE no colon',
    'COLD WAKE:',
    'COLD WAKE:   ',
    'COLD WAKE:\nthe reason on the next line',
    'COLD WAKE: <your reason>',
    REFUSE_COLD,
    { type: 'shutdown_request', reason: 'COLD WAKE: structured' },
  ]) assert.equal(send(message), REFUSE_COLD, JSON.stringify(message));
});

test('GRIM-87: a name in another letter case is checked, and a row spelled as sent is judged first', () => {
  assert.equal(coldRefusal({ to: 'Build-1', message: 'go on' }, cold, NOW), REFUSE_COLD);
  assert.equal(coldRefusal(say, [row('idle', 500, 'BUILD-1')], NOW), REFUSE_COLD);
  assert.equal(coldRefusal(say, [row('idle', 1), row('idle', 500, 'BUILD-1')], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', 500), row('idle', 1, 'BUILD-1')], NOW), REFUSE_COLD);
  assert.equal(coldRefusal(say, [row('idle', 500, 'Build-1'), row('idle', 500, 'BUILD-1')], NOW), undefined);
});

test('C2: 59 minutes, exactly 60, or a busy row at any time passes on', () => {
  assert.equal(coldRefusal(say, [row('idle', 59)], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', 60)], NOW), undefined);
  for (const status of ['busy', 'waiting', '?']) assert.equal(coldRefusal(say, [row(status, 500)], NOW), undefined);
});

test('C3: a subscription with no message to a cold member passes on, and so does a send to main, all or an address', () => {
  const cold = [row('idle', 500)];
  assert.equal(coldRefusal({ to: 'build-1', notify_when_idle: true }, cold, NOW), undefined);
  assert.equal(coldRefusal({ to: 'build-1', message: '  ' }, cold, NOW), undefined);
  for (const to of ['main', '*', 'uds:/x', 'bridge:s1']) assert.equal(coldRefusal({ to, message: 'go on' }, [row('idle', 500, to)], NOW), undefined);
  assert.equal(coldRefusal(say, cold, NOW), REFUSE_COLD);
  // A name sent with its ref is judged by the name, so a ref is no way round the check.
  assert.equal(coldRefusal({ to: 'build-1 [aaa111]', message: 'go on' }, cold, NOW), REFUSE_COLD);
  assert.equal(coldRefusal({ to: 'build-1 [aaa111]', message: 'go on' }, [row('idle', 59)], NOW), undefined);
  for (const to of ['build-1[aaa111]', 'build-1  [aaa111]', 'build-1 [a.b]', 'build-1 ']) assert.equal(coldRefusal({ to, message: 'go on' }, cold, NOW), REFUSE_COLD, to);
});

test('C4: no usable time passes the send on', () => {
  assert.equal(coldRefusal(say, undefined, NOW), undefined);
  assert.equal(coldRefusal(say, [], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', 500, 'other')], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', 500), row('idle', 500)], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', undefined)], NOW), undefined);
  assert.equal(coldRefusal(say, [{ ...row('idle', 500), updatedAt: Number.NaN }], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', -3)], NOW), undefined);
  assert.equal(coldRefusal(say, [row('idle', 500)], Number.NaN), undefined);
  assert.equal(coldRefusal(undefined, [row('idle', 500)], NOW), undefined);
});
