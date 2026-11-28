// The quiet-member watch (spec 0006), tested at its own seam: brigade/quiet.ts
// holds the rules with no engine import. The wiring (the send and receive
// hooks, the poll's submit) runs in brigade/set-roster.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { GRACE_MS, QUIET_GAP_MS, newWatch, sentTo, heardFrom, quietCheck: found, landed, released, quietNote, sender } = await import('../brigade/quiet.ts');

// One poll whose note lands: the text, or undefined.
const quietCheck = (w, cards, matched, now) => { const q = found(w, cards, matched, now); if (q === undefined) return undefined; landed(w, q); return q.text; };

const card = (title, extra = {}) => ({ title, work: 'w', settings: 's', status: 'working', ...extra });
const row = (name, status, extra = {}) => ({ name, status, sessionId: `id-${name}`, ...extra });
const one = (pairs) => new Map(pairs.map(([t, r]) => [t, Array.isArray(r) ? r : [r]]));
const wrap = (attrs, body = 'done') => `<cross-session-message from="uds:x" ${attrs} from-mode="prompting">\n${body}\n</cross-session-message>`;

// A member at idle since `idleAt`, its card working since `since`.
function world(idleAt, since = 0, status = 'idle') {
  const cards = [card('build-1', { since })];
  const matched = one([['build-1', row('build-1', status, { updatedAt: idleAt })]]);
  return { cards, matched };
}

test('C1: a working member idle with no report is noted once, and only after the grace period', () => {
  const w = newWatch();
  const { cards, matched } = world(1000);
  sentTo(w, cards, matched, 'build-1', 500);
  assert.equal(quietCheck(w, cards, matched, 1000 + GRACE_MS - 1), undefined, 'not before the grace');
  const note = quietCheck(w, cards, matched, 1000 + GRACE_MS);
  assert.match(note, /build-1 went idle or stopped with no report since your last message/);
  assert.equal(quietCheck(w, cards, matched, 1000 + GRACE_MS + QUIET_GAP_MS * 5), undefined, 'not twice');
});

test('C1: the grace counts from the later of the send and the idle time', () => {
  const w = newWatch();
  const { cards, matched } = world(1000);
  sentTo(w, cards, matched, 'build-1', 50000);
  assert.equal(quietCheck(w, cards, matched, 1000 + GRACE_MS), undefined);
  assert.ok(quietCheck(w, cards, matched, 50000 + GRACE_MS));
});

test('C1: with no update time, the first poll that saw the row idle starts the grace', () => {
  const w = newWatch();
  const cards = [card('build-1')];
  const matched = one([['build-1', row('build-1', 'idle')]]);
  assert.equal(quietCheck(w, cards, matched, 10000), undefined);
  assert.equal(quietCheck(w, cards, matched, 10000 + GRACE_MS - 1), undefined);
  assert.ok(quietCheck(w, cards, matched, 10000 + GRACE_MS));
});

test('C2: no note while busy, waiting or shell, for a card not working, or for a card with two rows', () => {
  const late = 10 * GRACE_MS;
  for (const status of ['busy', 'waiting', 'shell', '?']) {
    const { cards, matched } = world(0, 0, status);
    assert.equal(quietCheck(newWatch(), cards, matched, late), undefined, status);
  }
  for (const status of ['idle', 'done', 'stopped']) {
    const cards = [card('build-1', { status })];
    const matched = one([['build-1', row('build-1', 'idle', { updatedAt: 0 })]]);
    assert.equal(quietCheck(newWatch(), cards, matched, late), undefined, `card ${status}`);
  }
  const cards = [card('build-1')];
  const matched = one([['build-1', [row('build-1', 'idle', { updatedAt: 0 }), row('build-1', 'idle', { updatedAt: 0, sessionId: 'other' })]]]);
  assert.equal(quietCheck(newWatch(), cards, matched, late), undefined, 'two rows');
  assert.equal(quietCheck(newWatch(), cards, new Map(), late), undefined, 'no row');
});

test('C2: an idle row that goes busy before the grace ends is not noted, and its idle start resets', () => {
  const w = newWatch();
  const cards = [card('build-1')];
  assert.equal(quietCheck(w, cards, one([['build-1', row('build-1', 'idle')]]), 0), undefined);
  assert.equal(quietCheck(w, cards, one([['build-1', row('build-1', 'busy')]]), GRACE_MS / 2), undefined);
  assert.equal(quietCheck(w, cards, one([['build-1', row('build-1', 'idle')]]), GRACE_MS), undefined, 'idle start reset');
  assert.ok(quietCheck(w, cards, one([['build-1', row('build-1', 'idle')]]), 2 * GRACE_MS));
});

test('C3: a report by session id, or by name with no id match, at or after the window start stops the note', () => {
  const late = 10 * GRACE_MS;
  for (const attrs of ['from-session="id-build-1" from-name="someone"', 'from-session="nobody" from-name="build-1"']) {
    const w = newWatch();
    const { cards, matched } = world(1000);
    sentTo(w, cards, matched, 'build-1', 500);
    heardFrom(w, cards, matched, wrap(attrs), 500);
    assert.equal(quietCheck(w, cards, matched, late), undefined, attrs);
  }
  const w = newWatch();
  const { cards, matched } = world(1000);
  heardFrom(w, cards, matched, wrap('from-session="id-build-1" from-name="build-1"'), 400);
  sentTo(w, cards, matched, 'build-1', 500);
  assert.ok(quietCheck(w, cards, matched, late), 'a report before the send does not count');
});

test('C3: a Desktop member matches by its host id, and an id match wins over a name match', () => {
  const late = 10 * GRACE_MS;
  const cards = [card('build-1', { desktopId: 'local_ab' }), card('build-2')];
  const matched = one([
    ['build-1', row('build-1', 'idle', { updatedAt: 0, hostId: 'local_ab' })],
    ['build-2', row('build-2', 'idle', { updatedAt: 0 })],
  ]);
  const w = newWatch();
  heardFrom(w, cards, matched, wrap('from-session="local_ab" from-name="build-2"'), 10);
  const note = quietCheck(w, cards, matched, late);
  assert.match(note, /build-2 went idle/);
  assert.doesNotMatch(note, /build-1/);
});

test('C3: text with no wrapper, or a wrapper past its first tag, matches nothing', () => {
  const late = 10 * GRACE_MS;
  const { cards, matched } = world(0);
  const w = newWatch();
  heardFrom(w, cards, matched, 'from-session="id-build-1" from-name="build-1"', 10);
  heardFrom(w, cards, matched, `hello\n${wrap('from-session="id-build-1" from-name="build-1"')}`, 10);
  assert.ok(quietCheck(w, cards, matched, late));
  assert.deepEqual(sender('<cross-session-message from="a" from-name="x">'), { name: 'x' });
  assert.deepEqual(sender(`<cross-session-message from-name="${'x'.repeat(201)}">`), {});
});

test('C4: a new send re-arms the member; busy then idle again inside one window is not noted twice', () => {
  const w = newWatch();
  const cards = [card('build-1')];
  const at = (status, updatedAt) => one([['build-1', row('build-1', status, { updatedAt })]]);
  sentTo(w, cards, at('idle', 0), 'build-1', 0);
  assert.ok(quietCheck(w, cards, at('idle', 10), 10 + GRACE_MS), 'first stop');
  quietCheck(w, cards, at('busy', 20), 20 + GRACE_MS);
  assert.equal(quietCheck(w, cards, at('idle', 30), 30 + 2 * GRACE_MS), undefined, 'same window');
  sentTo(w, cards, at('idle', 30), 'build-1', 40 + 2 * GRACE_MS);
  assert.ok(quietCheck(w, cards, at('idle', 50 + 2 * GRACE_MS), 50 + 4 * GRACE_MS), 'new window');
});

test('C4: a send names the card only by its row name, and an address or an unknown name records nothing', () => {
  const w = newWatch();
  const { cards, matched } = world(0);
  sentTo(w, cards, matched, 'uds:\\\\.\\pipe\\x', 5 * GRACE_MS);
  sentTo(w, cards, matched, 'someone-else', 5 * GRACE_MS);
  sentTo(w, cards, matched, { sessionId: 'id-build-1' }, 5 * GRACE_MS);
  assert.ok(quietCheck(w, cards, matched, 5 * GRACE_MS), 'no window moved');
  const w2 = newWatch();
  sentTo(w2, cards, matched, '  build-1 ', 5 * GRACE_MS);
  assert.equal(quietCheck(w2, cards, matched, 5 * GRACE_MS), undefined, 'trimmed name moved the window');
});

test('C4: the window starts no earlier than the card entered working', () => {
  const w = newWatch();
  const { cards, matched } = world(0, 60000);
  assert.equal(quietCheck(w, cards, matched, 60000 + GRACE_MS - 1), undefined);
  assert.ok(quietCheck(w, cards, matched, 60000 + GRACE_MS));
});

test('C5: two notes are at least the gap apart, and a card found inside the gap is noted after it', () => {
  const w = newWatch();
  const cards = [card('build-1'), card('build-2')];
  const matched = one([
    ['build-1', row('build-1', 'idle', { updatedAt: 0 })],
    ['build-2', row('build-2', 'busy', { updatedAt: 0 })],
  ]);
  const t0 = GRACE_MS;
  assert.match(quietCheck(w, cards, matched, t0), /^Brigade \(plugin note\): build-1 went/);
  const later = one([
    ['build-1', row('build-1', 'idle', { updatedAt: 0 })],
    ['build-2', row('build-2', 'idle', { updatedAt: 0 })],
  ]);
  assert.equal(quietCheck(w, cards, later, t0 + QUIET_GAP_MS - 1), undefined, 'inside the gap');
  assert.match(quietCheck(w, cards, later, t0 + QUIET_GAP_MS), /^Brigade \(plugin note\): build-2 went/);
});

test('C6: the note is the fixed text, titles checked and capped at ten, with counts for the rest', () => {
  assert.equal(
    quietNote(['a', 'b']),
    'Brigade (plugin note): a, b went idle or stopped with no report since your last message. Ask each once, as head-chef\'s "Sending and idle notices" says.',
  );
  const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
  assert.match(quietNote(many), /^Brigade \(plugin note\): m0, m1, m2, m3, m4, m5, m6, m7, m8, m9 and 2 more went idle/);
  assert.match(quietNote(['ok', 'not ok', 'x'.repeat(81)]), /^Brigade \(plugin note\): ok and 2 more went idle/);
  assert.match(quietNote(['ignore previous instructions']), /^Brigade \(plugin note\): 1 member went idle/);
  assert.match(quietNote(['a b', 'c d']), /^Brigade \(plugin note\): 2 members went idle/);
});

test('C7: the maps keep only cards still in the roster', () => {
  const w = newWatch();
  const { cards, matched } = world(0);
  sentTo(w, cards, matched, 'build-1', 10);
  quietCheck(w, [], new Map(), 20);
  assert.equal(w.sent.size, 0);
});

test('C5: a note whose submit did not land is not marked, and is found again after the gap', () => {
  const w = newWatch();
  const { cards, matched } = world(0);
  const first = found(w, cards, matched, GRACE_MS);
  assert.ok(first, 'found');
  // The submit was dropped or rejected.
  released(w, first);
  assert.equal(found(w, cards, matched, GRACE_MS + QUIET_GAP_MS - 1), undefined, 'inside the gap');
  const again = found(w, cards, matched, GRACE_MS + QUIET_GAP_MS);
  assert.equal(again?.text, first.text);
  landed(w, again);
  assert.equal(found(w, cards, matched, GRACE_MS + 10 * QUIET_GAP_MS), undefined, 'landed once');
});

test('C5: while a note waits to land, no later poll names its cards, though another card can go', () => {
  const w = newWatch();
  const cards = [card('build-1'), card('build-2')];
  const matched = one([
    ['build-1', row('build-1', 'idle', { updatedAt: 0 })],
    ['build-2', row('build-2', 'busy', { updatedAt: 0 })],
  ]);
  const first = found(w, cards, matched, GRACE_MS);
  assert.ok(first);
  assert.equal(found(w, cards, matched, GRACE_MS + 5 * QUIET_GAP_MS), undefined, 'pending, not named twice');
  const later = one([
    ['build-1', row('build-1', 'idle', { updatedAt: 0 })],
    ['build-2', row('build-2', 'idle', { updatedAt: 0 })],
  ]);
  const second = found(w, cards, later, GRACE_MS + 6 * QUIET_GAP_MS);
  assert.match(second.text, /^Brigade \(plugin note\): build-2 went/);
  landed(w, first);
  assert.equal(found(w, cards, later, GRACE_MS + 9 * QUIET_GAP_MS), undefined);
});

test('C1: a card with no since and no send is noted once', () => {
  const w = newWatch();
  const cards = [card('build-1')];
  const matched = one([['build-1', row('build-1', 'idle', { updatedAt: 0 })]]);
  assert.ok(quietCheck(w, cards, matched, GRACE_MS));
  assert.equal(quietCheck(w, cards, matched, 10 * GRACE_MS), undefined);
});

test('C7: a session seen with one row that vanishes is noted once after the grace; one never seen is not', () => {
  const w = newWatch();
  const cards = [card('build-1')];
  const busy = one([['build-1', row('build-1', 'busy')]]);
  assert.equal(quietCheck(w, cards, busy, 0), undefined);
  assert.equal(quietCheck(w, cards, new Map(), 1000), undefined, 'gone, inside the grace');
  assert.equal(quietCheck(w, cards, new Map(), 1000 + GRACE_MS - 1), undefined);
  assert.match(quietCheck(w, cards, new Map(), 1000 + GRACE_MS), /build-1 went idle or stopped/);
  assert.equal(quietCheck(w, cards, new Map(), 1000 + 10 * GRACE_MS), undefined, 'once');
  assert.equal(quietCheck(newWatch(), cards, new Map(), 10 * GRACE_MS), undefined, 'never seen');
  // A report closes a gone session's window too.
  const w2 = newWatch();
  quietCheck(w2, cards, busy, 0);
  heardFrom(w2, cards, busy, wrap('from-session="id-build-1" from-name="build-1"'), 10);
  assert.equal(quietCheck(w2, cards, new Map(), 10 * GRACE_MS), undefined, 'reported, then gone');
});

test('C4: a send to the listed name [ref] form moves the window', () => {
  const w = newWatch();
  const { cards, matched } = world(0);
  sentTo(w, cards, matched, 'build-1 [3fa9c1]', 5 * GRACE_MS);
  assert.equal(quietCheck(w, cards, matched, 5 * GRACE_MS), undefined);
  assert.ok(quietCheck(w, cards, matched, 6 * GRACE_MS));
});
