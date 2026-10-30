// The decision log's shared rules, tested at their own seam: the check of a
// log_decision call's input and of each file kind, the append with its caps
// and drop rule, the marks merge and the marks cap, the review queue, the
// history pages, the search, and the SHA-256 the project digest takes.
// brigade/decisions.ts takes plain values and no engine import, so these run
// under `node --test` in CI, where there is no Claude Code. Each test names
// the acceptance claim of spec 402 (S7) it backs, or C9 to C12 for the
// decisions taken at #430's build and its Test rounds, which the closing
// read's claims list on #430 records.
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const d = await import('../brigade/decisions.ts');
const {
  MAX_ENTRIES, MAX_LOG_BYTES, MAX_MARKS, MAX_MARKS_BYTES, HISTORY_PAGE,
  appendEntry, checkInput, checkLog, checkMarks, emptyLog, addMark, addMarks, mergeMarks, markKey,
  reviewQueue, flaggedRows, historyRows, matchesSearch, searchWords, serializeLog, serializeMarks,
  sha256Hex, projectDigest, sourceLabel, writerName, missingIds,
  MAX_HANDOFF_BYTES, checkHandoffInput, checkHandoff, serializeHandoff, chooseHandoff,
  levelFrom, storedLevel, levelInForce, ownerEntry, paneEntry, alarmEntry, inFixedShape, unreadOwnAlarm, clockTime,
  drawnLogs, markAllSet, parseMarkAllKey,
} = d;

const SID = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';
const NOW = 1_800_000_000_000;

const input = (over = {}) => ({
  source: 'lead', work: 'issue 411', question: 'Which tier?', options: ['Thorough', 'Standard'],
  pick: 'Thorough', why: 'It is sensitive.', undo: 'Re-propose the tier.', ...over,
});
// A log built through the append, as the tool builds it, one entry a millisecond.
const logOf = (n, over = () => ({})) => {
  let log = emptyLog(null);
  for (let i = 0; i < n; i++) {
    const r = appendEntry(log, input(over(i)), { at: NOW + i, level: 1, read: new Map() });
    assert.ok('value' in r, JSON.stringify(r));
    log = r.value.log;
  }
  return log;
};
const readAll = (log, state = 'read') => new Map(log.entries.map(e => [markKey(SID, e.id, e.at), state]));

// --- claim 2: the mod stamps id, at and level; the lead may not ---------------------

test('claim 2: an append stamps id from next, at from the clock and the level, and next only goes up', () => {
  const r = appendEntry(emptyLog(null), input(), { at: NOW, level: 1, read: new Map() });
  assert.ok('value' in r);
  const { log, entry } = r.value;
  assert.equal(entry.id, '1');
  assert.equal(entry.at, NOW);
  assert.equal(entry.level, 1);
  assert.equal(log.next, 2);
  assert.deepEqual(log.entries, [entry]);
  const again = appendEntry(log, input(), { at: NOW + 5, level: 1, read: new Map() });
  assert.equal(again.value.entry.id, '2');
  assert.equal(again.value.log.next, 3);
});

test('claim 2: an input carrying id, at or level, or a source other than lead or relayed, is refused by name', () => {
  for (const [over, rule] of [
    [{ id: '7' }, /id is stamped by the mod/],
    [{ at: 1 }, /at is stamped by the mod/],
    [{ level: 3 }, /level is stamped by the mod/],
    [{ source: 'owner' }, /source is not lead or relayed/],
    [{ source: 'pane' }, /source is not lead or relayed/],
    [{ source: 'alarm' }, /source is not lead or relayed/],
    [{ source: undefined }, /source is not lead or relayed/],
    [{ colour: 'red' }, /a field the decision log does not use: colour/],
    [{ constructor: 1 }, /a field the decision log does not use: constructor/],
  ]) {
    const r = checkInput({ ...input(), ...over });
    assert.ok('error' in r, JSON.stringify(over));
    assert.match(r.error, rule);
  }
  assert.ok('value' in checkInput(input({ source: 'relayed' })));
});

// --- claim 14: the log fields' text rules ---------------------------------------------

test('claim 14: every field refuses hidden and direction-changing characters and other controls, and keeps a line break', () => {
  const bad = ['a\u{200B}b', 'a\u{202E}b', 'a\u{2066}b', 'a\u{FE0F}b', 'a\u{E0041}b', 'a\u{AD}b', 'a\u{0}b', 'a\u{7}b', 'a\rb', 'a\u{2028}b', 'a\u{85}b'];
  for (const field of ['work', 'question', 'why', 'undo', 'revisit']) {
    for (const t of bad) {
      const r = checkInput(input({ [field]: t }));
      assert.ok('error' in r, `${field} ${JSON.stringify(t)}`);
      assert.match(r.error, new RegExp(`^${field} `));
    }
    // Twice in a row: a check that kept state between calls would pass the second.
    assert.ok('error' in checkInput(input({ [field]: 'x\u{200B}' })));
    assert.ok('error' in checkInput(input({ [field]: 'x\u{200B}' })));
    assert.ok('value' in checkInput(input({ [field]: 'line one\nline two' })), field);
  }
  for (const t of bad) {
    assert.ok('error' in checkInput(input({ options: [t, 'b'], pick: t })), JSON.stringify(t));
  }
});

test('claim 14: every field refuses session-id and Desktop-id shaped text, in any case, and keeps ordinary words', () => {
  for (const t of [SID, `see ${SID.toUpperCase()} now`, 'local_0123abcd-4567-89ab-cdef-0123456789ab', 'open LOCAL_deadbeef please']) {
    for (const field of ['work', 'question', 'why', 'undo', 'revisit']) {
      const r = checkInput(input({ [field]: t }));
      assert.ok('error' in r, `${field} ${t}`);
      assert.match(r.error, /session id or Desktop id/);
    }
    assert.ok('error' in checkInput(input({ options: [t, 'b'], pick: t })));
  }
  for (const t of ['local_cache', 'a local_ deal', '1111-2222', 'deadbeef']) assert.ok('value' in checkInput(input({ why: t })), t);
  // The Desktop-id shape the roster knows takes 1 to 80 characters after
  // local_, and a Remote Control session's link is an id too.
  for (const t of ['local_a', 'id local_0123abc here', 'https://claude.ai/code/session_ABC123', 'see claude.ai/code/session_x']) {
    assert.match(checkInput(input({ why: t })).error ?? '', /session id or Desktop id/, t);
  }
});

// Beyond S5.2's id shapes, on the owner's word (q3 A on #402's ticket 411,
// relayed by the lead, 2026-10-26): until the head-chef skill's data rule
// lands, the mod itself refuses key-shaped values, email addresses and
// home-folder paths, with fixed words that never echo the value.
test('every field refuses a key-shaped value, an email address and a home-folder path, naming the shape and never the value', () => {
  const key = `sk-ant-${'a'.repeat(24)}`;
  const cases = [
    [key, /holds text shaped like a key/],
    [`ghp_${'b'.repeat(36)}`, /holds text shaped like a key/],
    [`token AKIA${'C'.repeat(16)} here`, /holds text shaped like a key/],
    ['write to someone@example.org', /holds an email address/],
    ['see C:\\Users\\someone\\x', /holds a home-folder path/],
    ['see C:/Users/someone', /holds a home-folder path/],
    ['in /home/someone/repo', /holds a home-folder path/],
    ['in /Users/someone/repo', /holds a home-folder path/],
    ['in /c/Users/someone', /holds a home-folder path/],
    ['in ~/.claude/plugins', /holds a home-folder path/],
    ['on \\\\wsl$\\Ubuntu\\home\\someone\\repo', /holds a home-folder path/],
  ];
  for (const field of ['work', 'question', 'why', 'undo', 'revisit']) {
    for (const [t, rule] of cases) {
      const r = checkInput(input({ [field]: t }));
      assert.match(r.error ?? '', rule, `${field} ${t}`);
      assert.ok(!r.error.includes(t), 'the refusal never echoes the value');
    }
  }
  assert.match(checkInput(input({ options: [key, 'b'], pick: key })).error ?? '', /holds text shaped like a key/);
  for (const t of ['a key decision', 'mail the owner', 'the user@ handle', 'api/Users/42', 'the /users route', 'sk-short']) {
    assert.ok('value' in checkInput(input({ why: t })), t);
  }
});

test('the home shapes are the check\'s own, in scripts/check.mjs, so the copies cannot drift', () => {
  const src = readFileSync(new URL('../scripts/check.mjs', import.meta.url), 'utf8');
  const block = /\nconst FIXED = (\[[\s\S]*?\n\]);/.exec(src);
  assert.ok(block, 'check.mjs still holds FIXED in this shape');
  const theirs = new Function(`return ${block[1]};`)();
  // The copy reads a field, not a file's lines, so it drops the check's
  // \r? before an end; and it adds the backslash spelling of a Linux home.
  const ours = d.HOME_SHAPES.map(String);
  assert.deepEqual(ours.slice(0, theirs.length), theirs.map(re => String(re).replaceAll('\\r?$', '$')));
  assert.deepEqual(ours.slice(theirs.length), [String(/\\home\\[a-z$]/i)]);
});

test('the key shapes equal the masking the threat model\'s row 14 names, in scripts/practice.mjs, so the copies cannot drift', () => {
  const src = readFileSync(new URL('../scripts/practice.mjs', import.meta.url), 'utf8');
  const block = /const START = (String\.raw`[^`]*`);\nconst KEY_SHAPES = (\[[\s\S]*?\n\]);/.exec(src);
  assert.ok(block, 'practice.mjs still holds START and KEY_SHAPES in this shape');
  const theirs = new Function(`const START = ${block[1]}; return ${block[2]};`)();
  assert.deepEqual(d.KEY_SHAPES.map(String), theirs.map(String));
});

test('claim 14: options must be distinct after case folding, the pick one of them, or empty for a waiting entry', () => {
  assert.match(checkInput(input({ options: ['Yes', 'yes'], pick: 'Yes' })).error, /options repeat/);
  // Full case folding, not only lower case: ß folds to ss.
  assert.match(checkInput(input({ options: ['STRASSE', 'straße'], pick: 'STRASSE' })).error ?? '', /options repeat/);
  assert.match(checkInput(input({ pick: 'Maybe' })).error, /pick is not one of the options/);
  assert.match(checkInput(input({ pick: '' })).error, /pick is not one of the options/);
  assert.match(checkInput(input({ options: [] })).error, /options/);
  assert.match(checkInput(input({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], pick: 'a' })).error, /options/);
  assert.ok('value' in checkInput(input({ waiting: true, pick: '' })));
  assert.match(checkInput(input({ waiting: true, pick: 'Thorough' })).error, /a waiting entry has no pick/);
  assert.match(checkInput(input({ waiting: true, source: 'relayed', pick: '' })).error, /waiting/);
});

test('claim 14: the lengths S5.2 sets hold', () => {
  const long = n => 'x'.repeat(n);
  assert.ok('error' in checkInput(input({ work: '' })));
  assert.ok('error' in checkInput(input({ work: long(301) })));
  assert.ok('value' in checkInput(input({ work: long(300) })));
  assert.ok('error' in checkInput(input({ question: long(1001) })));
  assert.ok('value' in checkInput(input({ why: long(1000) })));
  assert.ok('value' in checkInput(input({ revisit: '' })));
  assert.ok('error' in checkInput(input({ revisit: long(301) })));
  assert.ok('error' in checkInput(input({ undo: '' })));
});

test('claim 10: answers names a waiting entry in the same log that no entry answered, and only a relayed entry may carry it', () => {
  const asked = appendEntry(emptyLog(null), input({ waiting: true, pick: '' }), { at: NOW, level: 1, read: new Map() }).value.log;
  const answer = input({ source: 'relayed', answers: '1' });
  const ok = appendEntry(asked, answer, { at: NOW + 1, level: 1, read: new Map() });
  assert.ok('value' in ok);
  assert.match(appendEntry(ok.value.log, answer, { at: NOW + 2, level: 1, read: new Map() }).error, /answers a waiting entry already answered/);
  assert.match(appendEntry(asked, input({ source: 'relayed', answers: '9' }), { at: NOW + 1, level: 1, read: new Map() }).error, /answers no waiting entry/);
  assert.match(checkInput(input({ answers: '1' })).error, /only a relayed entry/);
  const plain = logOf(1);
  assert.match(appendEntry(plain, answer, { at: NOW + 1, level: 1, read: new Map() }).error, /answers no waiting entry/);
});

// --- claim 4: the caps and the drop rule ----------------------------------------------

test('claim 4: a full log drops read, unflagged entries oldest first, and ids are never reused', () => {
  const log = logOf(MAX_ENTRIES);
  // Every entry read but the first, which is unread.
  const read = readAll(log);
  read.delete(markKey(SID, '1', NOW));
  read.set(markKey(SID, '2', NOW + 1), 'unflagged');
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.ok('value' in r);
  const ids = r.value.log.entries.map(e => e.id);
  assert.equal(ids.length, MAX_ENTRIES);
  assert.equal(ids[0], '1');
  assert.ok(!ids.includes('2'), 'the oldest read entry dropped');
  assert.equal(ids.at(-1), String(MAX_ENTRIES + 1));
  assert.equal(r.value.log.next, MAX_ENTRIES + 2);
  // A second append after the drop takes the next id, never one counted from the entries.
  const again = appendEntry(r.value.log, input(), { at: NOW + 1000, level: 1, read: readAll(r.value.log), sid: SID });
  assert.equal(again.value.entry.id, String(MAX_ENTRIES + 2));
  // A log whose next is ahead of its entries keeps counting from next.
  const gapped = { ...logOf(2), next: 7 };
  assert.equal(appendEntry(gapped, input(), { at: NOW, level: 1, read: new Map() }).value.entry.id, '7');
});

test('claim 4: a read Relayed answer never drops while the waiting entry it answers is in the log', () => {
  let log = logOf(1, () => ({ waiting: true, pick: '' }));
  log = appendEntry(log, input({ source: 'relayed', answers: '1' }), { at: NOW + 1, level: 1, read: new Map() }).value.log;
  for (let i = 2; i < MAX_ENTRIES; i++) log = appendEntry(log, input(), { at: NOW + i, level: 1, read: new Map() }).value.log;
  // Only the answer is read: the waiting entry is unread, so nothing may drop.
  const read = new Map([[markKey(SID, '2', NOW + 1), 'read']]);
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.match(r.error ?? '', /full/);
  // Both read: the waiting entry drops first, then its answer may.
  read.set(markKey(SID, '1', NOW), 'read');
  const both = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.deepEqual(both.value.log.entries.slice(0, 1).map(e => e.id), ['2']);
});

test('claim 4: an unread, flagged or unanswered waiting entry never drops, and refuses with nothing changed when nothing can', () => {
  const log = logOf(MAX_ENTRIES, i => (i % 3 === 0 ? { waiting: true, pick: '' } : {}));
  // Every entry is read, but each is flagged or an unanswered waiting one.
  const read = new Map(log.entries.map(e => [markKey(SID, e.id, e.at), e.waiting ? 'read' : 'flagged']));
  const before = serializeLog(log).value;
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.ok('error' in r);
  assert.match(r.error, /the decision log is full/);
  assert.equal(serializeLog(log).value, before);
  // With no read mark at all, nothing drops either.
  assert.ok('error' in appendEntry(log, input(), { at: NOW + 999, level: 1, read: new Map(), sid: SID }));
});

test('claim 4: a read waiting entry drops only once a later entry answers it', () => {
  let log = logOf(MAX_ENTRIES - 1, i => (i === 0 ? { waiting: true, pick: '' } : {}));
  const keepAllButFirst = new Map(log.entries.map(e => [markKey(SID, e.id, e.at), e.id === '1' ? 'read' : 'flagged']));
  log = appendEntry(log, input(), { at: NOW + 900, level: 1, read: new Map() }).value.log;
  keepAllButFirst.set(markKey(SID, String(MAX_ENTRIES), NOW + 900), 'flagged');
  assert.ok('error' in appendEntry(log, input(), { at: NOW + 901, level: 1, read: keepAllButFirst, sid: SID }), 'unanswered: kept');
  // The answer itself is the append: the waiting entry it answers is read, and drops for it.
  const r = appendEntry(log, input({ source: 'relayed', answers: '1' }), { at: NOW + 902, level: 1, read: keepAllButFirst, sid: SID });
  assert.ok('value' in r, JSON.stringify(r.error));
  assert.ok(!r.value.log.entries.some(e => e.id === '1'));
  // The log the drop leaves, an answer whose waiting entry is gone, still passes its own strict check.
  assert.ok('value' in checkLog(serializeLog(r.value.log).value));
});

test('claim 4: Owner, Pane and alarm entries never drop, even as the oldest and read', () => {
  let log = emptyLog(null);
  for (const source of ['owner', 'pane', 'alarm']) log = appendEntry(log, { ...input(), source }, { at: NOW, level: 1, read: new Map(), fixed: true }).value.log;
  for (let i = 0; i < MAX_ENTRIES - 3; i++) log = appendEntry(log, input(), { at: NOW + 1 + i, level: 1, read: new Map() }).value.log;
  const r = appendEntry(log, input(), { at: NOW + 9999, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.deepEqual(r.value.log.entries.slice(0, 3).map(e => e.source), ['owner', 'pane', 'alarm']);
  assert.equal(r.value.log.entries[3].id, '5');
});

test('claim 4: Owner, Pane and alarm entries never drop, are written past the entry cap, and never past the byte cap', () => {
  let log = logOf(MAX_ENTRIES);
  for (const source of ['owner', 'pane', 'alarm']) {
    const r = appendEntry(log, { ...input(), source }, { at: NOW + 1000, level: 1, read: new Map(), sid: SID, fixed: true });
    assert.ok('value' in r, source);
    log = r.value.log;
  }
  assert.equal(log.entries.length, MAX_ENTRIES + 3);
  // All read: a lead append drops lead entries only, never the three.
  const r = appendEntry(log, input(), { at: NOW + 2000, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.deepEqual(r.value.log.entries.filter(e => ['owner', 'pane', 'alarm'].includes(e.source)).length, 3);
  // A fixed append that would pass the byte cap is refused.
  const wide = '\u{1F600}'.repeat(250);
  let big = emptyLog(null);
  let refused;
  for (let i = 0; i < 2000 && refused === undefined; i++) {
    const a = appendEntry(big, { ...input({ why: wide, question: wide }), source: 'owner' }, { at: NOW + i, level: 1, read: new Map(), sid: SID, fixed: true });
    if ('error' in a) refused = a.error;
    else big = a.value.log;
  }
  assert.match(refused ?? '', /the decision log is full/);
  assert.ok(new TextEncoder().encode(serializeLog(big).value).length <= MAX_LOG_BYTES);
});

test('claim 4: past the byte cap, read entries drop until the log fits', () => {
  const wide = '\u{1F600}'.repeat(900);
  let log = emptyLog(null);
  let first;
  for (let i = 0; ; i++) {
    const a = appendEntry(log, input({ why: wide, question: wide }), { at: NOW + i, level: 1, read: new Map(), sid: SID });
    if ('error' in a) {
      first = i;
      break;
    }
    log = a.value.log;
  }
  assert.ok(first < MAX_ENTRIES);
  const r = appendEntry(log, input({ why: wide, question: wide }), { at: NOW + 99999, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.equal(r.value.log.entries[0].id, '2');
  assert.ok(new TextEncoder().encode(serializeLog(r.value.log).value).length <= MAX_LOG_BYTES);
});

// --- claim 5's strict checks ----------------------------------------------------------

test('claim 5: the strict log check takes only a log of its own kind', () => {
  const good = serializeLog(logOf(3)).value;
  assert.ok('value' in checkLog(good));
  for (const raw of [
    '{}', '[]', 'not json', '{"cards":[],"todos":[]}',
    JSON.stringify({ ...JSON.parse(good), kind: 'marks' }),
    JSON.stringify({ ...JSON.parse(good), v: 2 }),
    JSON.stringify({ ...JSON.parse(good), extra: 1 }),
    JSON.stringify({ ...JSON.parse(good), next: 2 }),
    JSON.stringify({ ...JSON.parse(good), project: 'not-a-digest' }),
    JSON.stringify({ ...JSON.parse(good), entries: [...JSON.parse(good).entries, JSON.parse(good).entries[0]] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], level: 4 }] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], why: `a ${SID}` }] }),
    // An answer naming a later entry, an entry that does not wait, or one already answered.
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], source: 'relayed', answers: '2' }, JSON.parse(good).entries[1]] }),
    JSON.stringify({ ...JSON.parse(good), entries: [JSON.parse(good).entries[0], { ...JSON.parse(good).entries[1], source: 'relayed', answers: '1' }] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], waiting: true, pick: '' }, { ...JSON.parse(good).entries[1], source: 'relayed', answers: '1' }, { ...JSON.parse(good).entries[2], source: 'relayed', answers: '1' }] }),
  ]) {
    assert.ok('error' in checkLog(raw), raw.slice(0, 80));
  }
});

test('claim 5: the strict marks check takes only a marks file', () => {
  const mark = { log: SID, id: '1', entryAt: NOW, state: 'read', at: NOW };
  assert.ok('value' in checkMarks(JSON.stringify({ kind: 'marks', v: 1, marks: [mark] })));
  for (const raw of [
    '{}', serializeLog(logOf(1)).value,
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, state: 'gone' }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, log: 'x' }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, extra: 1 }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ ...mark, at: i })) }),
  ]) {
    assert.ok('error' in checkMarks(raw), raw.slice(0, 80));
  }
});

// --- claim 7: marks ---------------------------------------------------------------------

test('claim 7: the latest mark by time wins across marks files, a mark over two minutes ahead is ignored, and a mark never applies to another at', () => {
  const m = (state, at, entryAt = NOW) => ({ log: SID, id: '1', entryAt, state, at });
  const states = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 10)] }, { kind: 'marks', v: 1, marks: [m('unflagged', NOW + 20)] }], NOW + 30);
  assert.equal(states.get(markKey(SID, '1', NOW)), 'unflagged');
  // In the other order of files too: the time decides, never the order read.
  const reversed = mergeMarks([{ kind: 'marks', v: 1, marks: [m('unflagged', NOW + 20)] }, { kind: 'marks', v: 1, marks: [m('read', NOW + 10)] }], NOW + 30);
  assert.equal(reversed.get(markKey(SID, '1', NOW)), 'unflagged');
  const ahead = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 120_001)] }], NOW);
  assert.equal(ahead.get(markKey(SID, '1', NOW)), undefined);
  assert.equal(mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 120_000)] }], NOW).get(markKey(SID, '1', NOW)), 'read');
  const other = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW, NOW - 1)] }], NOW);
  assert.equal(other.get(markKey(SID, '1', NOW)), undefined);
});

test('claim 7: a marks file past its cap drops marks for entries in no log read first, then the oldest', () => {
  const known = new Set([markKey(SID, '1', NOW)]);
  const mark = i => ({ log: i === 0 ? SID : OTHER, id: String(i + 1), entryAt: NOW, state: 'read', at: NOW + i });
  // The known entry's mark is the oldest; the count cap bites at 2,000 marks.
  let file = { kind: 'marks', v: 1, marks: [] };
  for (let i = 0; i < MAX_MARKS + 50; i++) file = addMark(file, mark(i), known);
  const kept = file.marks.length;
  assert.equal(kept, MAX_MARKS);
  assert.ok(file.marks.some(x => x.log === SID && x.id === '1'), "the known entry's mark is kept while unknown ones remain");
  assert.ok(!file.marks.some(x => x.log === OTHER && x.id === '2'), 'the oldest unknown mark dropped');
  assert.ok(new TextEncoder().encode(serializeMarks(file).value).length <= MAX_MARKS_BYTES);
  // With every mark known, the oldest drops.
  const all = new Set(file.marks.map(x => markKey(x.log, x.id, x.entryAt)));
  const next = addMark(file, mark(MAX_MARKS + 5), all);
  assert.equal(next.marks.length, kept);
  assert.ok(!next.marks.some(x => x.log === SID && x.id === '1'));
  assert.equal(next.marks.at(-1).at, NOW + MAX_MARKS + 5);
  // The count cap holds on its own too.
  assert.ok('error' in serializeMarks({ kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ ...mark(1), at: i })) }));
});

// --- claim 6: the review queue -----------------------------------------------------------

const logs = () => {
  const a = logOf(3);
  const b = logOf(2, () => ({}));
  b.entries = b.entries.map((e, i) => ({ ...e, at: NOW - 10 + i }));
  return [
    { sid: SID, writer: 'lead-a', log: a },
    { sid: OTHER, writer: 'an ended session', log: b },
  ];
};

test('claim 6: To review is the oldest unread entry across the logs read, with n of N; Owner and Pane never show there', () => {
  const ls = logs();
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '9', at: NOW - 100, source: 'owner' }, { ...ls[0].log.entries[0], id: '10', at: NOW - 99, source: 'pane' });
  const q = reviewQueue(ls, new Map(), new Set(), []);
  assert.equal(q.total, 5);
  assert.equal(q.head.sid, OTHER);
  assert.equal(q.head.entry.at, NOW - 10);
  assert.equal(q.n, 1);
  const states = new Map([[markKey(OTHER, '1', NOW - 10), 'read']]);
  const q2 = reviewQueue(ls, states, new Set(), []);
  assert.equal(q2.total, 4);
  assert.equal(q2.head.entry.at, NOW - 9);
});

test('claim 6: Skip shows the next unread without marking, and wraps once every unread was skipped', () => {
  const ls = logs();
  const skipped = new Set([markKey(OTHER, '1', NOW - 10)]);
  const q = reviewQueue(ls, new Map(), skipped, []);
  assert.equal(q.n, 2);
  assert.equal(q.total, 5);
  assert.equal(q.head.entry.at, NOW - 9);
  const all = new Set(reviewQueue(ls, new Map(), new Set(), []).order.map(o => markKey(o.sid, o.entry.id, o.entry.at)));
  assert.equal(reviewQueue(ls, new Map(), all, []).n, 1);
});

test('claim 6: the writer is the session name for that id, or an ended session', () => {
  assert.equal(writerName([{ name: 'lead-a', status: 'idle', sessionId: SID }], SID), 'lead-a');
  assert.equal(writerName([{ name: 'lead-a', status: 'idle', sessionId: SID }], OTHER), 'an ended session');
  assert.equal(writerName([{ name: 'x\u{202E}y', status: 'idle', sessionId: SID }], SID), 'xy');
});

test('claim 10: Lead, Relayed by the writer, and a waiting entry draw as their sources say', () => {
  const e = logOf(1).entries[0];
  assert.equal(sourceLabel({ ...e, source: 'lead' }, 'lead-a'), 'Lead');
  assert.equal(sourceLabel({ ...e, source: 'relayed' }, 'lead-a'), 'Relayed by lead-a');
  assert.equal(sourceLabel({ ...e, source: 'relayed' }, 'an ended session'), 'Relayed by an ended session');
});

// --- the autonomy level (ticket 4) ------------------------------------------------

test('claim 11: a stored level other than the number 1, 2 or 3 reads as 1, and only this session\'s own counts', () => {
  for (const [v, want] of [[1, 1], [2, 2], [3, 3], [0, 1], [4, 1], ['3', 1], [2.5, 1], [null, 1], [undefined, 1], [[3], 1], [{ level: 3 }, 1]]) {
    assert.equal(levelFrom(v), want, String(v));
    assert.equal(storedLevel([{ session: SID, level: v }], SID), want, String(v));
  }
  assert.equal(storedLevel([{ session: OTHER, level: 3 }], SID), 1);
  for (const planted of [undefined, null, 'x', {}, { [SID]: 3 }, [null], [{ session: SID }]]) assert.equal(storedLevel(planted, SID), 1);
});

test('claim 11: the level in force is 1 when the stored level differs from the last pressed one, an alarm or a Pane entry waits, or a 3 has no press time', () => {
  assert.equal(levelInForce({ stored: 2, pressed: 2, pressAt: undefined, waiting: false }), 2);
  assert.equal(levelInForce({ stored: 3, pressed: 3, pressAt: NOW, waiting: false }), 3);
  assert.equal(levelInForce({ stored: 3, pressed: 3, pressAt: undefined, waiting: false }), 1);
  assert.equal(levelInForce({ stored: 3, pressed: 2, pressAt: NOW, waiting: false }), 1);
  assert.equal(levelInForce({ stored: 2, pressed: 3, pressAt: NOW, waiting: false }), 1);
  assert.equal(levelInForce({ stored: 2, pressed: 2, pressAt: undefined, waiting: true }), 1);
  assert.equal(levelInForce({ stored: 1, pressed: 1, pressAt: undefined, waiting: false }), 1);
});

test('claim 10: the Owner, Pane and alarm entries are built in one fixed shape each, pass the log\'s check, and draw as their sources', () => {
  let log = emptyLog(null);
  for (const raw of [ownerEntry(3), paneEntry('shown'), paneEntry('reload'), alarmEntry(2)]) {
    const r = appendEntry(log, raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r, JSON.stringify(r));
    log = r.value.log;
  }
  assert.ok('value' in checkLog(JSON.stringify(log)));
  const [owner, shown, reload, alarm] = log.entries;
  assert.deepEqual([owner.question, owner.options, owner.pick, owner.why], ['Autonomy level', ['1 Manual', '2 Auto', '3 Full throttle'], '3 Full throttle', 'Moved in the pane']);
  assert.deepEqual([shown.pick, shown.why, reload.why], ['1 Manual', 'The pane was shown again', 'The Brigade mod was reloaded']);
  assert.deepEqual([alarm.pick, alarm.why], ['2 Auto', 'Changed, not from a press']);
  for (const e of log.entries) assert.equal(inFixedShape(e), true, e.source);
  assert.equal(sourceLabel(owner, 'lead-a', true), 'Owner');
  assert.equal(sourceLabel(owner, 'lead-a', false), 'Owner (as recorded)');
  assert.equal(sourceLabel(owner, 'lead-a'), 'Owner (as recorded)');
  assert.equal(sourceLabel(shown, 'lead-a'), 'Pane');
  assert.equal(sourceLabel(alarm, 'lead-a'), 'Not from a press');
  // The tool's own entries are never held to these shapes.
  assert.equal(inFixedShape(logOf(1).entries[0]), true);
});

test("C12, Test round 1's q3g: a clock time is kept only as a whole number of milliseconds inside the Date range", () => {
  for (const ok of [0, 1, NOW, 8.64e15, -8.64e15]) assert.equal(clockTime(ok), true, String(ok));
  for (const bad of [8.64e15 + 1, -8.64e15 - 1, Number.MAX_SAFE_INTEGER, 1.5, NaN, Infinity, '5', undefined, null]) assert.equal(clockTime(bad), false, String(bad));
});

test("claim 25: a compaction's Pane entry has its own fixed shape, and each of the three whys reads only as itself", () => {
  const base = (raw) => {
    const r = appendEntry(emptyLog(null), raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r);
    return r.value.log.entries[0];
  };
  const compacted = base(paneEntry('compact'));
  assert.deepEqual([compacted.source, compacted.pick, compacted.why, compacted.undo], ['pane', '1 Manual', "The lead's context was compacted", 'Move the slider in the pane']);
  assert.ok('value' in checkLog(JSON.stringify({ ...emptyLog(null), next: 2, entries: [compacted] })));
  for (const why of ['The pane was shown again', 'The Brigade mod was reloaded', "The lead's context was compacted"]) {
    assert.equal(inFixedShape({ ...compacted, why }), true, why);
  }
  // Any other why is out of shape, the near misses included.
  for (const why of ['The lead was compacted', "The lead's context was compacted.", 'Moved in the pane', '']) {
    assert.equal(inFixedShape({ ...compacted, why }), false, why);
  }
});

test('claim 10: an Owner, Pane or alarm entry that differs from its fixed shape in any field is out of shape', () => {
  const base = (raw) => {
    const r = appendEntry(emptyLog(null), raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r);
    return r.value.log.entries[0];
  };
  const owner = base(ownerEntry(2));
  const pane = base(paneEntry('shown'));
  const alarm = base(alarmEntry(3));
  const bent = [
    [owner, { work: 'issue 1' }], [owner, { question: 'Which level?' }], [owner, { options: ['1 Manual', '2 Auto'] }],
    [owner, { options: ['2 Auto', '1 Manual', '3 Full throttle'] }], [owner, { pick: 'Yes', options: ['Yes', 'No'] }],
    [owner, { why: 'The lead moved it' }], [owner, { undo: 'Nothing' }], [owner, { revisit: 'Tomorrow' }], [owner, { waiting: true, pick: '' }],
    [pane, { pick: '3 Full throttle' }], [pane, { why: 'Moved in the pane' }], [pane, { undo: 'Move the slider back' }],
    [alarm, { why: 'Moved in the pane' }], [alarm, { undo: 'Move the slider back' }],
    [pane, { level: 2 }], [alarm, { level: 3 }],
  ];
  for (const [e, over] of bent) assert.equal(inFixedShape({ ...e, ...over }), false, `${e.source} ${JSON.stringify(over)}`);
});

test('claim 11: a repeat alarm is held back only while an alarm the pane wrote sits unread, in its shape, in this log', () => {
  let log = emptyLog(null);
  for (const raw of [alarmEntry(3), input()]) {
    const r = appendEntry(log, raw, { at: NOW, level: 1, read: new Map(), fixed: raw.source === 'alarm' });
    assert.ok('value' in r);
    log = r.value.log;
  }
  const [alarm, lead] = log.entries;
  const wrote = new Set([markKey(SID, alarm.id, alarm.at)]);
  assert.equal(unreadOwnAlarm(log, SID, wrote, new Map()), true);
  // Read, or flagged, by any mark: the next alarm is logged.
  for (const state of ['read', 'flagged', 'unflagged']) {
    assert.equal(unreadOwnAlarm(log, SID, wrote, new Map([[markKey(SID, alarm.id, alarm.at), state]])), false, state);
  }
  // An alarm the pane did not write, or one it wrote in another session's log, holds nothing back.
  assert.equal(unreadOwnAlarm(log, SID, new Set(), new Map()), false);
  assert.equal(unreadOwnAlarm(log, OTHER, wrote, new Map()), false);
  // Nor does one rewritten out of its shape, nor another entry under an alarm's key.
  const bent = { ...log, entries: [{ ...alarm, why: 'Moved in the pane' }, lead] };
  assert.equal(unreadOwnAlarm(bent, SID, wrote, new Map()), false);
  assert.equal(unreadOwnAlarm(log, SID, new Set([markKey(SID, lead.id, lead.at)]), new Map()), false);
});

// --- claim 9: Flagged to revisit and Dismiss ------------------------------------------------

test('claim 9: Flagged holds the entries whose latest mark is flagged, oldest first across the logs, and the search filters it', () => {
  const ls = logs();
  ls[0].log.entries[2].work = 'needle';
  const m = (sid, id, at, state, when) => ({ log: sid, id, entryAt: at, state, at: when });
  const states = mergeMarks([
    { kind: 'marks', v: 1, marks: [m(SID, '3', NOW + 2, 'flagged', NOW + 5), m(OTHER, '2', NOW - 9, 'flagged', NOW + 5), m(SID, '1', NOW, 'flagged', NOW + 5)] },
    // Unflagged later, in another file: no longer flagged.
    { kind: 'marks', v: 1, marks: [m(SID, '1', NOW, 'unflagged', NOW + 6), m(SID, '2', NOW + 1, 'read', NOW + 6)] },
  ], NOW + 10);
  const rows = flaggedRows(ls, states, []);
  assert.deepEqual(rows.map(r => [r.sid, r.entry.id]), [[OTHER, '2'], [SID, '3']]);
  assert.deepEqual(flaggedRows(ls, states, searchWords('NEEDLE')).map(r => [r.sid, r.entry.id]), [[SID, '3']]);
  assert.deepEqual(flaggedRows(ls, new Map(), []), []);
});

test('claim 9: Dismiss adds every picked mark in one file; past the cap old marks drop, never a new one, and the file given is unchanged', () => {
  const mark = i => ({ log: OTHER, id: String(i + 1), entryAt: NOW, state: 'read', at: NOW + i });
  let file = { kind: 'marks', v: 1, marks: [] };
  for (let i = 0; i < MAX_MARKS; i++) file = addMark(file, mark(i), new Set());
  const before = JSON.stringify(file);
  const oldest = file.marks[0].at;
  const picked = [0, 1, 2].map(i => ({ log: SID, id: String(i + 1), entryAt: NOW, state: 'unflagged', at: NOW + 9000 }));
  // Every old mark is for an entry the pane read, so the new marks are the only
  // unknown ones: a cap rule that let a new mark drop would take one first.
  const known = new Set(file.marks.map(x => markKey(x.log, x.id, x.entryAt)));
  const next = addMarks(file, picked, known);
  assert.equal(JSON.stringify(file), before);
  assert.deepEqual(next.marks.slice(-3), picked);
  assert.ok(!next.marks.slice(0, -3).some(x => x.log === SID), 'no new mark dropped');
  assert.ok(!next.marks.some(x => x.at === oldest), 'the oldest old mark dropped');
  const old = next.marks.slice(0, -3);
  assert.deepEqual(old, file.marks.slice(file.marks.length - old.length), 'the old marks kept are the newest, in order');
  assert.ok('value' in serializeMarks(next));
});

// --- claim 8: search ------------------------------------------------------------------------

test('claim 8: the search keeps an entry only when every word typed appears in it, in any case', () => {
  const e = { ...logOf(1).entries[0], work: 'PR 391', why: 'The owner prefers one check' };
  assert.deepEqual(searchWords('  Owner   391 '), ['owner', '391']);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('owner 391')), true);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('owner 392')), false);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('LEAD-A thorough')), true);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('1')), true, 'the id');
  assert.equal(matchesSearch(e, 'lead-a', []), true);
  const ls = logs();
  ls[1].log.entries[0].work = 'needle';
  assert.equal(reviewQueue(ls, new Map(), new Set(), searchWords('needle')).total, 1);
  assert.equal(historyRows(ls, searchWords('needle'), 1).rows.length, 1);
});

// --- claim 19: history ------------------------------------------------------------------------

test('claim 19: History holds every entry newest first, at most 50 a page until Show more', () => {
  const ls = [{ sid: SID, writer: 'lead-a', log: logOf(120) }];
  const one = historyRows(ls, [], 1);
  assert.equal(one.rows.length, HISTORY_PAGE);
  assert.equal(one.total, 120);
  assert.equal(one.more, true);
  assert.equal(one.rows[0].entry.id, '120');
  assert.equal(historyRows(ls, [], 2).rows.length, 100);
  assert.equal(historyRows(ls, [], 3).more, false);
});

// --- the dim line ------------------------------------------------------------------------------

test('the dim line counts the ids missing below next that the cap rule does not explain', () => {
  const log = logOf(5);
  assert.equal(missingIds(log), 0);
  assert.equal(missingIds({ ...log, entries: log.entries.filter(e => e.id !== '3') }), 1);
  const full = logOf(MAX_ENTRIES);
  const r = appendEntry(full, input(), { at: NOW + 999, level: 1, read: readAll(full), sid: SID });
  assert.equal(missingIds(r.value.log), 0);
});

// --- the SHA-256 the project digest takes (S5.1, tested as S6 says) ----------------------------

test('the SHA-256 matches the NIST vectors and Node at the block boundaries, astral text and a hand-off-sized input', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  const node = t => createHash('sha256').update(t, 'utf8').digest('hex');
  for (const n of [0, 55, 56, 63, 64, 65, 119, 120, 32 * 1024]) assert.equal(sha256Hex('a'.repeat(n)), node('a'.repeat(n)), String(n));
  for (const t of ['é', '日本語', '\u{1F600}\u{1F680}', 'C--src-grimoire']) assert.equal(sha256Hex(t), node(t), t);
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < 50; i++) {
    const t = Array.from({ length: rand() % 300 }, () => String.fromCodePoint(rand() % 0xd7ff)).join('');
    assert.equal(sha256Hex(t), node(t));
  }
});

test('the project digest is the SHA-256 of the transcript folder name, only for the current session, else null', () => {
  const start = { sessionId: SID, transcript: `C:\\cfg\\.claude\\projects\\C--work\\${SID}.jsonl` };
  assert.equal(projectDigest(start, SID), createHash('sha256').update('C--work').digest('hex'));
  assert.equal(projectDigest(start, OTHER), null);
  assert.equal(projectDigest({ sessionId: SID, transcript: 'C:\\nowhere.jsonl' }, SID), null);
  assert.equal(projectDigest({ sessionId: '', transcript: '' }, SID), null);
});

// --- the lead hand-off (ticket 3: claims 12 and 14) --------------------------------------------

const sections = (over = {}) => ({ resume: ['Read issue 413.'], rules: [], sessions: ['build-413 builds.'], cleanup: [], owner: ['q1 waits.'], ...over });
const DIGEST = createHash('sha256').update('C--work').digest('hex');
const OTHER_DIGEST = createHash('sha256').update('C--elsewhere').digest('hex');
const handoff = (at, project = DIGEST, over = {}) => ({ kind: 'handoff', v: 1, at, project, sections: sections(over) });

test('claim 14: every hand-off line refuses hidden and direction-changing characters, id-shaped text and a line break', () => {
  assert.deepEqual(checkHandoffInput(sections()).value, sections());
  for (const line of [
    'a\u{202E}b', 'a\u{200F}b', 'a\u{2066}b', 'zero\u{200B}width',
    `see ${SID}`, 'open local_0123abcd-4567-89ab-cdef-0123456789ab',
    'two\nlines', 'a\u{7}bell', '', 'x'.repeat(301),
  ]) {
    const r = checkHandoffInput(sections({ rules: ['fine', line] }));
    assert.ok('error' in r, JSON.stringify(line));
    assert.match(r.error, /^rules line 2 /);
  }
  assert.ok('value' in checkHandoffInput(sections({ rules: ['x'.repeat(300)] })));
});

test('S5.3: a hand-off input takes exactly the five sections, each a list of at most 20 lines, and nothing the mod stamps', () => {
  assert.ok('value' in checkHandoffInput(sections({ resume: Array.from({ length: 20 }, (_, i) => `Line ${i}`) })));
  assert.match(checkHandoffInput(sections({ resume: Array.from({ length: 21 }, (_, i) => `Line ${i}`) })).error, /^resume is not a list of at most 20 lines$/);
  const { owner, ...four } = sections();
  assert.match(checkHandoffInput(four).error, /^owner is not a list of at most 20 lines$/);
  assert.match(checkHandoffInput({ ...sections(), at: 5 }).error, /^the hand-off has a field it does not use: at$/);
  assert.match(checkHandoffInput({ ...sections(), project: DIGEST }).error, /^the hand-off has a field it does not use: project$/);
  assert.match(checkHandoffInput(sections({ cleanup: 'one line' })).error, /^cleanup is not a list/);
  assert.match(checkHandoffInput(null).error, /^the hand-off is not an object$/);
});

test('claim 5: a hand-off file passes its strict check only in its own shape', () => {
  const good = serializeHandoff(handoff(5));
  assert.deepEqual(checkHandoff(good.value).value, handoff(5));
  assert.ok('value' in checkHandoff(JSON.stringify(handoff(5, null))));
  for (const bad of [
    { ...handoff(5), extra: 1 },
    { ...handoff(5), kind: 'decisions' },
    { ...handoff(5), v: 2 },
    { ...handoff(5), at: -1 },
    { ...handoff(5), project: 'C--work' },
    { ...handoff(5), sections: { ...sections(), more: [] } },
    { ...handoff(5), sections: sections({ owner: [`see ${SID}`] }) },
  ]) assert.ok('error' in checkHandoff(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 80));
  assert.ok('error' in checkHandoff('{"cards":[],"todos":[]}'));
  assert.ok('error' in checkHandoff('not json'));
});

test('a hand-off over 32 KiB is refused', () => {
  // Twenty lines of 300 four-byte characters in each section: about 120 KiB.
  const wide = Array.from({ length: 20 }, () => '\u{1F600}'.repeat(300));
  const big = handoff(5, DIGEST, { resume: wide, rules: wide, sessions: wide, cleanup: wide, owner: wide });
  assert.ok('value' in checkHandoffInput(big.sections));
  assert.match(serializeHandoff(big).error, /^the hand-off is over 32 KiB$/);
  assert.equal(MAX_HANDOFF_BYTES, 32 * 1024);
});

test('claim 12: the hand-off chosen is this session\'s own, else the newest by stamped time with the same project digest', () => {
  const own = { sid: SID, handoff: handoff(100) };
  const older = { sid: '22222222-2222-2222-2222-222222222222', handoff: handoff(200) };
  const newer = { sid: '33333333-3333-3333-3333-333333333333', handoff: handoff(300) };
  const elsewhere = { sid: '44444444-4444-4444-4444-444444444444', handoff: handoff(900, OTHER_DIGEST) };
  const ahead = { sid: '55555555-5555-5555-5555-555555555555', handoff: handoff(NOW + 120_001) };
  const undated = { sid: '66666666-6666-6666-6666-666666666666', handoff: handoff(950, null) };
  const others = [older, elsewhere, ahead, newer, undated];
  // The own hand-off wins, however old.
  assert.equal(chooseHandoff(own, others, DIGEST, NOW), own);
  // Without one: the newest by its own time among the same digest, never
  // another digest's, a null one or one dated more than two minutes ahead.
  assert.equal(chooseHandoff(undefined, others, DIGEST, NOW), newer);
  assert.equal(chooseHandoff(undefined, [elsewhere, ahead, undated], DIGEST, NOW), undefined);
  // An own hand-off dated ahead is never chosen either.
  assert.equal(chooseHandoff({ sid: SID, handoff: handoff(NOW + 120_001) }, others, DIGEST, NOW), newer);
  assert.equal(chooseHandoff({ sid: SID, handoff: handoff(NOW + 120_000) }, others, DIGEST, NOW)?.sid, SID);
  // A session with no digest finds no other's.
  assert.equal(chooseHandoff(undefined, others, null, NOW), undefined);
  assert.equal(chooseHandoff(own, others, null, NOW), own);
});

// --- spec 444: one lead's log, carried entries, Mark all read, the marks cap order ------------

const mk = (sid, id, at, state, when) => ({ log: sid, id, entryAt: at, state, at: when });
// This session's log (3 plain leads) and another's: two waiting entries (one answered), the answer, a plain lead, a relayed, an alarm and an Owner entry.
const tabLogsFor = () => {
  const own = { sid: SID, writer: 'lead-a', log: logOf(3) };
  let ol = emptyLog(null);
  const add = (raw, at, fixed) => {
    const r = appendEntry(ol, raw, { at, level: 1, read: new Map(), fixed });
    assert.ok('value' in r, JSON.stringify(r));
    ol = r.value.log;
  };
  add(input({ waiting: true, pick: '', work: 'waits' }), NOW - 90);
  add(input({ waiting: true, pick: '', work: 'answered' }), NOW - 89);
  add(input({ source: 'relayed', answers: '2', work: 'the answer' }), NOW - 88);
  add(input({ work: 'plain' }), NOW - 87);
  add(input({ source: 'relayed', work: 'relayed plain' }), NOW - 86);
  add(alarmEntry(3), NOW - 85, true);
  add(ownerEntry(2), NOW - 84, true);
  return [own, { sid: OTHER, writer: 'an ended session', log: ol }];
};
const keyOf = (sid, e) => markKey(sid, e.id, e.at);

test('spec 444 claims 1, 2, 13: the tab draws this log, and from another only waiting, Relayed, unread fixed-shape alarm and flagged entries', () => {
  const ls = tabLogsFor();
  const other = ls[1].log.entries;
  const v = drawnLogs(ls, SID, new Map());
  const reviewOther = v.review.find(l => l.sid === OTHER).log.entries.map(e => e.work);
  // The answered waiting entry comes with its unread answer, and every Relayed entry is carried, answering or not.
  assert.deepEqual(reviewOther.sort(), [alarmEntry(3).work, 'waits', 'answered', 'the answer', 'relayed plain'].sort());
  assert.equal(v.review.find(l => l.sid === SID).log.entries.length, 3);
  assert.deepEqual(v.history.map(l => l.sid), [SID], 'History draws this log only');
  // A mark clears a carried one.
  const waits = other[0];
  const states = new Map([[keyOf(OTHER, waits), 'read']]);
  assert.ok(!reviewQueue(drawnLogs(ls, SID, states).review, states, new Set(), []).order.some(r => r.entry.work === 'waits'));
  // Flagged: any source from another log whose latest mark is flagged; unflagged leaves.
  const owner = other[6];
  const fs = new Map([[keyOf(OTHER, owner), 'flagged'], [keyOf(OTHER, other[3]), 'flagged']]);
  assert.deepEqual(flaggedRows(drawnLogs(ls, SID, fs).flagged, fs, []).map(r => r.entry.id).sort(), [owner.id, other[3].id].sort());
  const un = new Map([[keyOf(OTHER, owner), 'unflagged']]);
  assert.deepEqual(flaggedRows(drawnLogs(ls, SID, un).flagged, un, []), []);
  // An alarm out of its fixed shape is not carried.
  const bent = structuredClone(ls);
  bent[1].log.entries[5].why = 'changed';
  assert.ok(!drawnLogs(bent, SID, new Map()).review.find(l => l.sid === OTHER).log.entries.some(e => e.source === 'alarm'));
  // A read carried alarm leaves To review.
  const alarmRead = new Map([[keyOf(OTHER, other[5]), 'read']]);
  assert.ok(drawnLogs(ls, SID, new Map()).review.find(l => l.sid === OTHER).log.entries.some(e => e.source === 'alarm'));
  assert.ok(!drawnLogs(ls, SID, alarmRead).review.find(l => l.sid === OTHER).log.entries.some(e => e.source === 'alarm'));
  // A flagged carried waiting entry is read, so it leaves To review and shows in Flagged.
  const fl = new Map([[keyOf(OTHER, waits), 'flagged']]);
  const flv = drawnLogs(ls, SID, fl);
  assert.ok(!flv.review.flatMap(l => l.log.entries).some(e => e.work === 'waits'));
  assert.deepEqual(flaggedRows(flv.flagged, fl, []).map(r => r.entry.work), ['waits']);
});

test('spec 444 claim 15: the unshown count is the unread entries of other logs the tab does not draw, as a number only', () => {
  const ls = tabLogsFor();
  // A plain Lead entry: the one unread entry that is not drawn (a Relayed entry is carried).
  const e = ls[1].log.entries;
  assert.equal(drawnLogs(ls, SID, new Map()).unshown, 1);
  const states = new Map([[keyOf(OTHER, e[3]), 'read']]);
  assert.equal(drawnLogs(ls, SID, states).unshown, 0, 'the count falls when marked');
});

test('spec 444 claims 2 and 15: a Relayed answer and the waiting entry it answers are each carried until read', () => {
  const ls = tabLogsFor();
  const [, answered, answer] = ls[1].log.entries;
  const works = states => drawnLogs(ls, SID, states).review.find(l => l.sid === OTHER).log.entries.map(e => e.work).filter(w => ['answered', 'the answer'].includes(w)).sort();
  assert.deepEqual(works(new Map()), ['answered', 'the answer']);
  // The answer read first: the unread question stays, so it cannot fall out of sight.
  assert.deepEqual(works(new Map([[keyOf(OTHER, answer), 'read']])), ['answered']);
  assert.deepEqual(works(new Map([[keyOf(OTHER, answer), 'flagged']])), ['answered']);
  // Both read: neither shows.
  assert.deepEqual(works(new Map([[keyOf(OTHER, answer), 'read'], [keyOf(OTHER, answered), 'read']])), []);
  // The waiting entry read first: the unread answer still shows, alone.
  assert.deepEqual(works(new Map([[keyOf(OTHER, answered), 'read']])), ['the answer']);
  // Mark all read never takes a carried entry.
  const q = reviewQueue(drawnLogs(ls, SID, new Map()).review, new Map(), new Set(), []);
  assert.ok(markAllSet(q.order, SID).rows.every(r => r.sid === SID));
});

test('spec 444 claim 7: Mark all read takes only this log\'s shown plain Lead entries, with a hash that moves when the set does', () => {
  const ls = tabLogsFor();
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '4', at: NOW + 10, waiting: true, pick: '', work: 'mine waits' });
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '5', at: NOW + 11, source: 'relayed', answers: '4', waiting: false });
  // An unread alarm in this session's own log is never taken either.
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '6', at: NOW + 12, source: 'alarm' });
  const q = reviewQueue(drawnLogs(ls, SID, new Map()).review, new Map(), new Set(), []);
  assert.ok(q.order.some(r => r.sid === SID && r.entry.source === 'alarm'), 'the alarm is in To review');
  const set = markAllSet(q.order, SID);
  assert.deepEqual(set.rows.map(r => r.entry.id), ['1', '2', '3']);
  assert.equal(set.n, 3);
  assert.equal(set.hash, createHash('sha256').update(set.rows.map(r => keyOf(r.sid, r.entry)).sort().join('\n')).digest('hex').slice(0, 16));
  assert.notEqual(markAllSet(q.order.filter(r => !(r.sid === SID && r.entry.id === '1')), SID).hash, set.hash);
  assert.deepEqual(markAllSet([], SID), { rows: [], n: 0, hash: '' });
  ls[0].log.entries[1].work = 'needle';
  const q2 = reviewQueue(drawnLogs(ls, SID, new Map()).review, new Map(), new Set(), searchWords('needle'));
  assert.deepEqual(markAllSet(q2.order, SID).rows.map(r => r.entry.id), ['2']);
  // Spec 448 claim 6: with the own pair 4 and 5 on one card, the set and its count are unchanged.
  const cards = d.reviewCards(drawnLogs(ls, SID, new Map()).review, SID, new Map(), new Set(), []);
  assert.ok(cards.cards.some(c => c.answer?.entry.id === '5'), 'the own pair draws on one card');
  assert.deepEqual(markAllSet(cards.shown, SID), set);
});

test('spec 444 claim 8: the Mark all read key matches whole, from 1 to 500', () => {
  const h = 'abcdef0123456789';
  assert.deepEqual(parseMarkAllKey(`dmarkall-3-${h}`), { n: 3, hash: h });
  assert.deepEqual(parseMarkAllKey(`dmarkall-500-${h}`), { n: 500, hash: h });
  for (const bad of [`dmarkall-0-${h}`, `dmarkall-501-${h}`, `dmarkall-03-${h}`, `dmarkall-1000-${h}`, `dmarkall-3-${h}x`, ` dmarkall-3-${h}`, `dmarkall-3-${h.toUpperCase()}`, `dmarkall-3-${h.slice(1)}`, `dmarkall-3-${h}\n`]) {
    assert.equal(parseMarkAllKey(bad), undefined, bad);
  }
});

test('spec 444 claim 10: the marks cap is 256 KiB and a press of 500 fits beside the count cap', () => {
  assert.equal(d.MAX_MARKS_BYTES, 256 * 1024);
  const added = Array.from({ length: 500 }, (_, i) => mk(SID, String(1_000_000_000_000_000 + i), NOW, 'read', NOW + 1));
  const file = { kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS - 500 }, (_, i) => mk(OTHER, String(i + 1), NOW, 'read', NOW + 2)) };
  const known = new Set([...file.marks, ...added].map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks(file, added, known);
  assert.equal(next.marks.length, MAX_MARKS);
  assert.ok('value' in serializeMarks(next));
});

test('spec 444 claim 10: at wide ids the byte cap binds before the count cap, and the order of the drops still holds', () => {
  const wide = (log, i, at) => mk(log, String(1_000_000_000_000_000 + i), NOW, 'unflagged', at);
  const old = Array.from({ length: MAX_MARKS - 500 }, (_, i) => wide(OTHER, i, NOW + i));
  const added = Array.from({ length: 500 }, (_, i) => wide(SID, 10_000 + i, NOW + 5000));
  const file = { kind: 'marks', v: 1, marks: old };
  const known = new Set([...old, ...added].map(m => markKey(m.log, m.id, m.entryAt)));
  assert.ok(Buffer.byteLength(JSON.stringify({ kind: 'marks', v: 1, marks: [...old, ...added] })) > d.MAX_MARKS_BYTES, 'the count alone would not fit');
  const next = addMarks(file, added, known);
  assert.ok(next.marks.length < MAX_MARKS, 'the byte cap dropped marks the count cap would have kept');
  assert.ok('value' in serializeMarks(next));
  assert.deepEqual(next.marks.slice(-500), added, 'none of the new marks drops');
  assert.deepEqual(next.marks.slice(0, 3).map(m => m.id), old.slice(next.marks.length - 500 > 3 ? old.length - (next.marks.length - 500) : 0).slice(0, 3).map(m => m.id), 'the oldest dropped first');
});

test('spec 444 claim 10: past the cap a superseded mark drops before a live one, so no cleared flag comes back', () => {
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), mk(SID, '1', NOW, 'unflagged', NOW + 2), ...Array.from({ length: MAX_MARKS - 2 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 3 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9999', NOW, 'read', NOW + 5000)];
  const next = addMarks(file, added, known, [], NOW + 6000);
  assert.equal(next.marks.length, MAX_MARKS);
  assert.ok(!next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the superseded flag dropped first');
  assert.ok(next.marks.some(m => m.id === '1' && m.state === 'unflagged'));
  assert.deepEqual(next.marks.slice(-1), added);
});

test('spec 444 claim 10: a superseded mark drops before a live one that is older than it', () => {
  // A live read mark for entry A is the oldest; B's flag is superseded by B's later unflag. Oldest-first would drop A's.
  const marks = [mk(SID, '1', NOW, 'read', NOW + 1), mk(SID, '2', NOW, 'flagged', NOW + 2), mk(SID, '2', NOW, 'unflagged', NOW + 3), ...Array.from({ length: MAX_MARKS - 3 }, (_, i) => mk(SID, String(i + 3), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks(file, [mk(SID, '9999', NOW, 'read', NOW + 9000)], known, [], NOW + 20000);
  assert.ok(next.marks.some(m => m.id === '1'), 'the older live mark stays');
  assert.ok(!next.marks.some(m => m.id === '2' && m.state === 'flagged'), 'the superseded flag dropped');
});

test('spec 444 claim 10: a newest mark whose older flag sits in another file is kept past step 3, and unknown entries drop first', () => {
  const flagOther = { kind: 'marks', v: 1, marks: [mk(OTHER, '1', NOW, 'flagged', NOW + 1)] };
  const marks = [mk(OTHER, '1', NOW, 'unflagged', NOW + 2), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 1), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9000', NOW, 'read', NOW + 9000), mk(SID, '9001', NOW, 'read', NOW + 9000)];
  const next = addMarks(file, added, known, [flagOther], NOW + 20000);
  assert.ok(next.marks.some(m => m.log === OTHER && m.state === 'unflagged'), 'the unflagged mark stays');
  assert.notEqual(mergeMarks([next, flagOther], NOW + 20000).get(markKey(OTHER, '1', NOW)), 'flagged');
  const unknown = addMarks(file, added, new Set([...known].filter(k => !k.startsWith(OTHER))), [flagOther], NOW + 20000);
  assert.ok(!unknown.marks.some(m => m.log === OTHER), 'an unknown entry\'s mark dropped first');
});

test('spec 444 claim 10: a mark dated one minute ahead is inside the allowance, so it supersedes and the older flag of its entry drops first', () => {
  const now = NOW + 20000;
  const soon = { kind: 'marks', v: 1, marks: [mk(SID, '1', NOW, 'unflagged', now + 60 * 1000)] };
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 10 + i))];
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks({ kind: 'marks', v: 1, marks }, [mk(SID, '9000', NOW, 'read', NOW + 9000)], known, [soon], now);
  assert.ok(!next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the flag a counted mark supersedes dropped first');
  assert.ok(next.marks.some(m => m.id === '2'), 'the oldest plain read stays');
});

test('spec 444 claim 10: a mark dated over two minutes ahead supersedes nothing, and a live flag drops after the plain reads', () => {
  const future = { kind: 'marks', v: 1, marks: [mk(SID, '1', NOW, 'unflagged', NOW + 10 * 60 * 1000)] };
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9000', NOW, 'read', NOW + 9000)];
  const next = addMarks(file, added, known, [future], NOW + 20000);
  assert.ok(next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the flag stays');
  assert.ok(!next.marks.some(m => m.id === '2'), 'the oldest plain read dropped');
});

// --- spec 447: ended sessions' claims leave To review, with one line a session ----------------
//
// Each test names the acceptance claim of spec 447 (S10) it backs.

const { RECENT_MS, canTell, sessionStates, endedLines, parseMarkEndedKey, dropsLiveMark } = d;
const THIRD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
// The other log's newest entry is NOW - 84, so 31 minutes on it is quiet.
const LATER = NOW + 31 * 60 * 1000;
// A complete read that began after the pane opened, holding only this session's file.
const seenOnly = (ids = [SID], over = {}) => ({ ids, complete: true, fileGone: false, startedAt: LATER - 1000, ...over });
const live = (over = {}) => ({ seen: seenOnly(), openedAt: LATER - 60_000, now: LATER, ...over });
const view447 = (ls, states = new Map(), l = live()) => drawnLogs(ls, SID, states, sessionStates(ls, SID, l), canTell(l));
const works447 = v => v.review.find(r => r.sid === OTHER).log.entries.map(e => e.work).sort();

test('spec 447 claim 1: with the state ended, a log\'s unread Relayed and answered waiting entries leave the queue; unanswered waiting entries and alarms stay', () => {
  const ls = tabLogsFor();
  assert.equal(sessionStates(ls, SID, live()).get(OTHER), 'ended');
  const v = view447(ls);
  assert.deepEqual(works447(v), [alarmEntry(3).work, 'waits'].sort());
  const q = reviewQueue(v.review, new Map(), new Set(), []);
  assert.ok(!q.order.some(r => r.sid === OTHER && ['answered', 'the answer', 'relayed plain'].includes(r.entry.work)));
  assert.equal(q.total, 3 + 2, 'the "n of N" counts the three own entries and the two that stay');
  // Flagged is unchanged: a flagged Relayed entry of an ended log still shows there.
  const fl = new Map([[keyOf(OTHER, ls[1].log.entries[4]), 'flagged']]);
  assert.deepEqual(flaggedRows(view447(ls, fl).flagged, fl, []).map(r => r.entry.work), ['relayed plain']);
});

test('spec 447 claim 2: a running session draws as in 0.89.0, by its session file or by an entry from the last 30 minutes', () => {
  const ls = tabLogsFor();
  const old = drawnLogs(ls, SID, new Map());
  const byFile = live({ seen: seenOnly([SID, OTHER]) });
  assert.equal(sessionStates(ls, SID, byFile).get(OTHER), 'running');
  assert.deepEqual(works447(view447(ls, new Map(), byFile)), works447(old));
  // A file in a read that is not complete still makes its session running.
  assert.equal(sessionStates(ls, SID, live({ seen: seenOnly([SID, OTHER], { complete: false }) })).get(OTHER), 'running');
  // No session file, but the newest entry is 30 minutes old to the millisecond: still running.
  const recent = live({ now: NOW - 84 + RECENT_MS });
  assert.equal(RECENT_MS, 30 * 60 * 1000);
  assert.equal(sessionStates(ls, SID, recent).get(OTHER), 'running');
  assert.deepEqual(works447(view447(ls, new Map(), recent)), works447(old));
  assert.equal(sessionStates(ls, SID, live({ now: NOW - 84 + RECENT_MS + 1 })).get(OTHER), 'ended');
  // This session's own log is always running, whatever the read says.
  assert.equal(sessionStates(ls, SID, live()).get(SID), 'running');
  // The newest entry is taken from the log as read, so an out-of-shape entry still keeps it running.
  const odd = structuredClone(ls);
  odd[1].log.entries.push({ ...odd[1].log.entries[6], id: '8', at: LATER - 1000, why: 'not the fixed words' });
  odd[1].log.next = 9;
  assert.equal(sessionStates(odd, SID, live()).get(OTHER), 'running');
});

test('spec 447 claim 3: with no usable session read the state is unknown, every log draws as in 0.89.0, and the fold cannot tell', () => {
  const ls = tabLogsFor();
  const old = works447(drawnLogs(ls, SID, new Map()));
  for (const [why, l] of [
    ['no read since the pane opened, or one that returned nothing', live({ seen: undefined })],
    ['a read that is not complete', live({ seen: seenOnly([SID], { complete: false }) })],
    ['a file that went after the listing', live({ seen: seenOnly([SID], { fileGone: true }) })],
    ['a read from before this open', live({ seen: seenOnly([SID], { startedAt: LATER - 60_001 }) })],
    ['no open time', live({ openedAt: undefined })],
    ['a clock that is not a whole number', live({ now: LATER + 0.5 })],
    ['a clock that gave nothing', live({ now: Number.NaN })],
  ]) {
    assert.equal(sessionStates(ls, SID, l).get(OTHER), 'unknown', why);
    const v = view447(ls, new Map(), l);
    assert.deepEqual(works447(v), old, why);
    assert.equal(v.canTell, false, why);
    assert.deepEqual(v.ended, [], why);
  }
  assert.equal(view447(ls).canTell, true);
  // A log with no entries cannot be told ended.
  const empty = [ls[0], { sid: THIRD, writer: 'an ended session', log: emptyLog(null) }];
  assert.equal(sessionStates(empty, SID, live()).get(THIRD), 'unknown');
});

test('spec 447 claim 6: one line for each ended session with an entry S4.1 takes, newest first, its time, at most 3 work values and N', () => {
  const ls = tabLogsFor();
  // A third ended log, whose newest such entry is newer than the other's, with five work values.
  let tl = emptyLog(null);
  for (const [i, w] of ['one', 'two', 'three', 'four', 'From an ended session'].entries()) {
    tl = appendEntry(tl, input({ source: 'relayed', work: w }), { at: NOW - 50 + i, level: 1, read: new Map() }).value.log;
  }
  ls.push({ sid: THIRD, writer: 'an ended session', log: tl });
  const v = view447(ls);
  const lines = endedLines(v.ended, new Map(), []);
  assert.equal(lines.length, 2);
  const [first, second] = lines;
  assert.equal(first.at, NOW - 46);
  assert.deepEqual(first.works, ['From an ended session', 'four', 'three'], 'the newest three, the writer\'s text as it is');
  assert.equal(first.more, 2);
  assert.equal(first.n, 5, 'a work value holding the fixed words leaves N unchanged');
  // The other log: the answered waiting entry, its answer and the plain Relayed entry.
  assert.equal(second.at, NOW - 86);
  assert.equal(second.n, 3);
  assert.deepEqual(second.works, ['relayed plain', 'the answer', 'answered']);
  assert.equal(second.more, 0);
  // Each work value is cleaned as a roster line is and cut to 40 characters.
  ls[2].log.entries[4].work = `${'x'.repeat(50)}\u{202E}`;
  assert.equal(endedLines(view447(ls).ended, new Map(), [])[0].works[0], `${'x'.repeat(39)}…`);
  // Values that draw alike once cleaned count once.
  for (const [i, e] of ls[2].log.entries.entries()) e.work = ['a  b', 'a b', 'a\nb', 'c', 'c\u{200B}'][i];
  const alike = endedLines(view447(ls).ended, new Map(), [])[0];
  assert.deepEqual([alike.works, alike.more, alike.n], [['c', 'a b'], 0, 5]);
  // A session whose such entries are all read has no line; its unanswered waiting entry is not one of them.
  const read = new Map(ls[1].log.entries.map(e => [keyOf(OTHER, e), 'read']));
  read.delete(keyOf(OTHER, ls[1].log.entries[0]));
  assert.deepEqual(endedLines(view447(ls, read).ended, read, []).map(l => l.n), [5]);
});

test('spec 447 claim 7: a search hides lines and lowers N', () => {
  const ls = tabLogsFor();
  const v = view447(ls);
  const lines = endedLines(v.ended, new Map(), searchWords('answer'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].n, 2);
  assert.deepEqual(lines[0].works, ['the answer', 'answered']);
  assert.equal(lines[0].at, NOW - 88);
  assert.deepEqual(endedLines(v.ended, new Map(), searchWords('nowhere')), []);
});

test('spec 447 claim 10: History\'s fold holds every Relayed and answered waiting entry of each ended log, read or not, newest first, under the search', () => {
  const ls = tabLogsFor();
  const states = new Map([[keyOf(OTHER, ls[1].log.entries[4]), 'read']]);
  const v = view447(ls, states);
  assert.deepEqual(v.ended.map(l => [l.sid, l.writer]), [[OTHER, 'an ended session']]);
  const fold = historyRows(v.ended, [], 1);
  assert.deepEqual(fold.rows.map(r => r.entry.work), ['relayed plain', 'the answer', 'answered']);
  assert.deepEqual(historyRows(v.ended, searchWords('answer'), 1).rows.map(r => r.entry.work), ['the answer', 'answered']);
  // This session's History rows are unchanged.
  assert.deepEqual(v.history, drawnLogs(ls, SID, states).history);
  // 50 a page.
  let big = emptyLog(null);
  for (let i = 0; i < 60; i++) big = appendEntry(big, input({ source: 'relayed' }), { at: NOW - 100 + i, level: 1, read: new Map() }).value.log;
  const bv = view447([ls[0], { sid: OTHER, writer: 'x', log: big }]);
  assert.equal(historyRows(bv.ended, [], 1).rows.length, HISTORY_PAGE);
  assert.ok(historyRows(bv.ended, [], 1).more);
});

test('spec 447 claim 8: a line\'s hash is over its sorted mark keys and moves when its set does', () => {
  const ls = tabLogsFor();
  const [line] = endedLines(view447(ls).ended, new Map(), []);
  assert.equal(line.hash, createHash('sha256').update(line.rows.map(r => keyOf(r.sid, r.entry)).sort().join('\n')).digest('hex').slice(0, 16));
  const read = new Map([[keyOf(OTHER, ls[1].log.entries[2]), 'read']]);
  const [after] = endedLines(view447(ls, read).ended, read, []);
  assert.equal(after.n, 2);
  assert.notEqual(after.hash, line.hash);
});

test('spec 447 claim 13: the Mark these N read key holds no session id, matches whole, from 1 to 500', () => {
  const h = 'abcdef0123456789';
  assert.deepEqual(parseMarkEndedKey(`dmarkended-3-${h}`), { n: 3, hash: h });
  assert.deepEqual(parseMarkEndedKey(`dmarkended-500-${h}`), { n: 500, hash: h });
  for (const bad of [`dmarkended-0-${h}`, `dmarkended-501-${h}`, `dmarkended-03-${h}`, `dmarkended-1000-${h}`, `dmarkended-3-${h}x`, ` dmarkended-3-${h}`, `dmarkended-3-${h.toUpperCase()}`, `dmarkended-3-${h.slice(1)}`, `dmarkended-3-${h}\n`, `dmarkall-3-${h}`, `dmarkended-3-${SID}`]) {
    assert.equal(parseMarkEndedKey(bad), undefined, bad);
  }
  assert.equal(parseMarkAllKey(`dmarkended-3-${h}`), undefined);
});

test('spec 447 claim 8 (Test round 1, q3 A): a write that pushes out a mark still its entry\'s newest state is caught; one that drops a mark for no log read is not', () => {
  const known = new Set(Array.from({ length: MAX_MARKS }, (_, i) => markKey(OTHER, String(i + 1), NOW)));
  const live = { kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS }, (_, i) => mk(OTHER, String(i + 1), NOW, 'read', NOW + i)) };
  const added = [mk(SID, '1', NOW, 'read', NOW + 5000)];
  const marked = new Set([markKey(SID, '1', NOW)]);
  const after = addMarks(live, added, known, [], NOW + 5000);
  assert.equal(after.marks.length, MAX_MARKS, 'the oldest live read mark dropped');
  assert.equal(dropsLiveMark(live, after, [], known, marked, NOW + 5000), true);
  // The same marks for entries in no log read drop first and change nothing the pane reads.
  const after2 = addMarks(live, added, new Set(), [], NOW + 5000);
  assert.equal(dropsLiveMark(live, after2, [], new Set(), marked, NOW + 5000), false);
  // A dropped mark that a newer mark in another file supersedes changes no state either.
  const elsewhere = { kind: 'marks', v: 1, marks: [mk(OTHER, '1', NOW, 'read', NOW + 9000)] };
  const after3 = addMarks(live, added, known, [elsewhere], NOW + 9000);
  assert.equal(dropsLiveMark(live, after3, [elsewhere], known, marked, NOW + 9000), false);
  // The entries the write marks are its own business.
  assert.equal(dropsLiveMark(undefined, { kind: 'marks', v: 1, marks: added }, [], marked, marked, NOW + 5000), false);
});

// --- spec 448: a lead's own answered pair on one card -------------------------------------------
//
// Each test names the acceptance claim of spec 448 (S8) it backs.

const { reviewCards, parsePairKey } = d;
// This session's log: a plain Lead entry, a waiting entry W, a Relayed entry A
// that answers W, and a later plain entry; and another log's own pair.
const pairLogs = () => {
  let own = emptyLog(null);
  const add = (raw, at) => {
    own = appendEntry(own, raw, { at, level: 1, read: new Map() }).value.log;
  };
  add(input({ work: 'plain first' }), NOW + 1);
  add(input({ waiting: true, pick: '', work: 'mine waits' }), NOW + 2);
  add(input({ source: 'relayed', answers: '2', work: 'my answer' }), NOW + 3);
  add(input({ work: 'plain later' }), NOW + 4);
  const other = tabLogsFor()[1];
  return [{ sid: SID, writer: 'lead-a', log: own }, other];
};

test('spec 448 claims 1 and 5: an own unread waiting entry and its answer are one card at the waiting entry\'s place, counted once; a carried pair stays two cards', () => {
  const ls = pairLogs();
  const v = drawnLogs(ls, SID, new Map());
  const q = reviewCards(v.review, SID, new Map(), new Set(), []);
  const own = q.cards.filter(c => c.row.sid === SID);
  assert.deepEqual(own.map(c => [c.row.entry.work, c.answer?.entry.work]), [['plain first', undefined], ['mine waits', 'my answer'], ['plain later', undefined]]);
  // The answer has no card of its own, and To review's count counts the pair once.
  assert.ok(!q.cards.some(c => c.row.sid === SID && c.row.entry.work === 'my answer'));
  const entries = reviewQueue(v.review, new Map(), new Set(), []).total;
  assert.equal(q.total, entries - 1);
  // The shown rows hold every entry, both of the pair included, oldest first.
  assert.deepEqual(q.shown, reviewQueue(v.review, new Map(), new Set(), []).order);
  // Claim 5: the other log's waiting entry and its answer draw as two cards.
  const carried = q.cards.filter(c => c.row.sid === OTHER).map(c => c.row.entry.work);
  assert.ok(carried.includes('answered') && carried.includes('the answer'));
  assert.ok(q.cards.every(c => c.row.sid === SID || c.answer === undefined));
});

test('spec 448 claim 3: when only one of the pair is unread it draws alone', () => {
  const ls = pairLogs();
  const [, w, a] = ls[0].log.entries;
  const v = drawnLogs(ls, SID, new Map());
  for (const [read, alone] of [[w, a], [a, w]]) {
    for (const state of ['read', 'flagged']) {
      const states = new Map([[keyOf(SID, read), state]]);
      const own = reviewCards(v.review, SID, states, new Set(), []).cards.filter(c => c.row.sid === SID);
      assert.deepEqual(own.map(c => [c.row.entry.id, c.answer]), [['1', undefined], [alone.id, undefined], ['4', undefined]], `${read.work} ${state}`);
    }
  }
});

test('spec 448 claim 4: a search matching only the answer draws the pair, and one matching neither hides it', () => {
  const ls = pairLogs();
  const v = drawnLogs(ls, SID, new Map());
  const only = reviewCards(v.review, SID, new Map(), new Set(), searchWords('my answer'));
  assert.deepEqual(only.cards.map(c => [c.row.entry.work, c.answer?.entry.work]), [['mine waits', 'my answer']]);
  assert.deepEqual(only.shown.map(r => r.entry.work), ['mine waits', 'my answer'], 'both count as shown');
  assert.deepEqual(reviewCards(v.review, SID, new Map(), new Set(), searchWords('mine waits')).shown.map(r => r.entry.work), ['mine waits', 'my answer']);
  assert.deepEqual(reviewCards(v.review, SID, new Map(), new Set(), searchWords('plain later')).cards.map(c => c.row.entry.work), ['plain later']);
});

test('spec 448 claim 2: a pair counts as skipped when its waiting entry is, and the queue wraps by card', () => {
  const ls = [pairLogs()[0]];
  const [, w] = ls[0].log.entries;
  const first = keyOf(SID, ls[0].log.entries[0]);
  const q = reviewCards(ls, SID, new Map(), new Set([first, keyOf(SID, w)]), []);
  assert.equal(q.head.entry.work, 'plain later');
  assert.equal(q.answer, undefined);
  assert.deepEqual([q.n, q.total], [3, 3]);
  const head = reviewCards(ls, SID, new Map(), new Set([first]), []);
  assert.deepEqual([head.head.entry.work, head.answer?.entry.work, head.n], ['mine waits', 'my answer', 2]);
  // Every card skipped: the first again.
  const all = new Set([0, 1, 3].map(i => keyOf(SID, ls[0].log.entries[i])));
  assert.equal(reviewCards(ls, SID, new Map(), all, []).n, 1);
});

test('spec 448 claim 3: a pair key matches whole, naming both entries by id and time', () => {
  assert.deepEqual(parsePairKey('dnext-2-100-3-110'), { verb: 'dnext', id: '2', at: 100, answerId: '3', answerAt: 110 });
  assert.deepEqual(parsePairKey('dflag-2-0-3-1'), { verb: 'dflag', id: '2', at: 0, answerId: '3', answerAt: 1 });
  assert.deepEqual(parsePairKey('dskip-9999999999999999-9999999999999999-1-1')?.verb, 'dskip');
  for (const bad of ['dnext-2-100', 'dnext-0-100-3-110', 'dnext-2-100-03-110', 'dnext-2-100-3-110-4', ' dnext-2-100-3-110', 'dnext-2-100-3-110\n', 'dread-2-100-3-110', 'dnext-2-100-3-', 'dnext-2-100-3-12345678901234567', 'dmarkall-2-100-3-110']) {
    assert.equal(parsePairKey(bad), undefined, bad);
  }
});

// --- spec 448 Part B: Mark N relayed read ---------------------------------------------------------

const { markRelayedSet, parseMarkRelayedKey } = d;

test('spec 448 claims 7 and 8: Mark N relayed read takes only this log\'s shown Relayed entries that answer nothing, with the hash over their sorted mark keys', () => {
  const ls = pairLogs();
  let own = ls[0].log;
  for (const [raw, at] of [[input({ source: 'relayed', work: 'lone claim' }), NOW + 5], [alarmEntry(3), NOW + 6]]) {
    own = appendEntry(own, raw, { at, level: 1, read: new Map(), fixed: raw.source === 'alarm' }).value.log;
  }
  ls[0].log = own;
  const v = drawnLogs(ls, SID, new Map());
  const q = reviewCards(v.review, SID, new Map(), new Set(), []);
  // The other log's relayed entries are in the order, and never taken.
  assert.ok(q.shown.some(r => r.sid === OTHER && r.entry.source === 'relayed'));
  const set = markRelayedSet(q.shown, SID);
  assert.deepEqual(set.rows.map(r => r.entry.work), ['lone claim'], 'never the waiting entry, its answer, a plain Lead entry, an alarm or another log\'s entry');
  assert.equal(set.n, 1);
  assert.equal(set.hash, createHash('sha256').update(set.rows.map(r => keyOf(r.sid, r.entry)).sort().join('\n')).digest('hex').slice(0, 16));
  // A search that hides the claim leaves nothing; the answer drawn alone, its question read, is still not taken.
  assert.deepEqual(markRelayedSet(reviewCards(v.review, SID, new Map(), new Set(), searchWords('my answer')).shown, SID), { rows: [], n: 0, hash: '' });
  const wRead = new Map([[keyOf(SID, own.entries[1]), 'read']]);
  assert.deepEqual(markRelayedSet(reviewCards(drawnLogs(ls, SID, wRead).review, SID, wRead, new Set(), []).shown, SID).rows.map(r => r.entry.work), ['lone claim']);
  // The hash moves when the set does.
  own = appendEntry(own, input({ source: 'relayed', work: 'second claim' }), { at: NOW + 7, level: 1, read: new Map() }).value.log;
  ls[0].log = own;
  const more = markRelayedSet(reviewCards(drawnLogs(ls, SID, new Map()).review, SID, new Map(), new Set(), []).shown, SID);
  assert.equal(more.n, 2);
  assert.notEqual(more.hash, set.hash);
});

test('spec 448 claim 9: the Mark N relayed read key matches whole, from 1 to 500, and is no other press\'s key', () => {
  const h = 'abcdef0123456789';
  assert.deepEqual(parseMarkRelayedKey(`dmarkrelayed-3-${h}`), { n: 3, hash: h });
  assert.deepEqual(parseMarkRelayedKey(`dmarkrelayed-500-${h}`), { n: 500, hash: h });
  for (const bad of [`dmarkrelayed-0-${h}`, `dmarkrelayed-501-${h}`, `dmarkrelayed-03-${h}`, `dmarkrelayed-1000-${h}`, `dmarkrelayed-3-${h}x`, ` dmarkrelayed-3-${h}`, `dmarkrelayed-3-${h.toUpperCase()}`, `dmarkrelayed-3-${h.slice(1)}`, `dmarkrelayed-3-${h}\n`, `dmarkall-3-${h}`, `dmarkended-3-${h}`]) {
    assert.equal(parseMarkRelayedKey(bad), undefined, bad);
  }
  assert.equal(parseMarkAllKey(`dmarkrelayed-3-${h}`), undefined);
  assert.equal(parseMarkEndedKey(`dmarkrelayed-3-${h}`), undefined);
});
