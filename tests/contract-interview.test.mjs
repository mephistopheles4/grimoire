// The hiring page's one module, interview.js, tested in Node: the marks, the
// block it writes, the tally, the export, restore, redraft and Forget. The
// module takes its store as a parameter, so these tests pass one in memory;
// Node 20 has no localStorage. What only a browser shows stays on the
// checklist ticket 2 runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { contractModule, measurementDraft, root } from './helpers.mjs';

const Interview = createRequire(import.meta.url)(contractModule);
const kindsPath = join(root, 'skills', 'contract', 'scripts', 'kinds.json');
const kinds = JSON.parse(readFileSync(kindsPath, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = { draft: sha(readFileSync(measurementDraft)), kinds: sha(readFileSync(kindsPath)) };
const base = () => JSON.parse(readFileSync(measurementDraft, 'utf8'));

/** One answer per way an answer is made, on the measurement draft. */
const answers = () => new Map([
  ['job', { option: 'job-b' }], // a low-stakes pick, not the proposal
  ['near-miss', { option: 'near-miss-a' }], // a low-stakes pick of the proposal
  ['sign-off-1', { option: 'sign-off-1-a' }], // a high-stakes pick, unchanged
  ['stop-3', { option: 'stop-3-b' }], // a high-stakes pick of another option
  ['runtime', { option: 'runtime-a' }], // runtime: low-stakes, exempt
  ['duty-1', { fields: { text: 'proposes the type and the name, and the person confirms' } }], // edited
  ['term-1', { fields: base().parts.writing[0].fields }], // agreed as drafted
  ['why', { fields: { text: 'Because people forget why they decided.' } }],
]);

test('marks follow the rules for every way an answer is made', () => {
  const block = Interview.blockOf(base(), kinds, hashes, { answers: answers(), edits: [] });
  const mark = new Map(block.answers.map(a => [a.id, a.mark]));
  assert.equal(mark.get('job'), 'Confirmed', 'an unchanged low-stakes pick');
  assert.equal(mark.get('near-miss'), 'Confirmed', 'a low-stakes pick of the proposal');
  assert.equal(mark.get('sign-off-1'), 'Proposed', 'an unchanged high-stakes pick stays Proposed until restated in chat');
  assert.equal(mark.get('stop-3'), 'Proposed', 'any unchanged high-stakes pick');
  assert.equal(mark.get('runtime'), 'Confirmed', 'an unchanged pick on runtime');
  assert.equal(mark.get('duty-1'), 'Decided', 'edited wording');
  assert.equal(mark.get('term-1'), 'Confirmed', 'a low-stakes draft agreed as it stands');
  assert.equal(mark.get('why'), 'Decided', 'why is always Decided');
  const restored = Interview.blockOf(base(), kinds, hashes, { answers: new Map([['duty-1', { fields: { text: 'x' }, restored: true }]]), edits: [] });
  assert.deepEqual(restored.answers[0], { id: 'duty-1', fields: { text: 'x' }, mark: 'Proposed', restored: true }, 'an untouched restored answer is Proposed, whatever it was');
  const stop = base().parts.roles.find(c => c.id === 'stop-1').fields;
  const edited = Interview.blockOf(base(), kinds, hashes, { answers: new Map([['stop-1', { fields: { ...stop, when: 'the person has not said yes' } }], ['stop-2', { fields: base().parts.roles.find(c => c.id === 'stop-2').fields }]]), edits: [] });
  assert.equal(edited.answers[0].mark, 'Decided', 'any edit makes a high-stakes clause Decided');
  assert.equal(edited.answers[1].mark, 'Proposed', 'a high-stakes clause agreed as drafted stays Proposed');
});

test('the block holds exactly its keys and binds itself to the draft and the kinds table by hash', () => {
  const block = Interview.blockOf(base(), kinds, hashes, { answers: answers(), edits: [] });
  assert.deepEqual(Object.keys(block), ['format', 'draft', 'kinds', 'answers', 'edits']);
  assert.equal(block.draft, hashes.draft);
  assert.equal(block.kinds, hashes.kinds);
  const text = Interview.blockText(block);
  assert.match(text, /^```json\n[\s\S]*\n```\n$/);
  assert.deepEqual(JSON.parse(text.slice(8, -5)), block);
  assert.deepEqual(Interview.checkBlock(block, base(), kinds, hashes).refusals, []);
});

test('the tally counts proposals taken as drafted apart from other picks and edits', () => {
  const t = Interview.tally(base(), { answers: answers(), edits: [] });
  assert.deepEqual(t, { proposalsTaken: 4, otherPicks: 2, edited: 2 });
});

const quick = () => {
  const d = base();
  d.level = 'Quick';
  d.parts.rules = [];
  d.parts.writing = [];
  d.parts.open = [];
  d.questions = d.questions.filter(q => q.clause !== 'rule-33');
  return d;
};

test('the export matches the template: its title block, the eight parts in order, and an empty heading for each part the level does not ask', () => {
  const d = quick();
  const kept = answers();
  kept.delete('term-1');
  const block = Interview.blockOf(d, kinds, hashes, { answers: kept, edits: [] });
  const md = Interview.exportContract(d, kinds, block);
  assert.match(md, /^# Contract: contract\n\nVersion: 1\.0\.0\nKind: skill\nLevel: Quick\n/);
  const headings = md.split('\n').filter(l => l.startsWith('## '));
  assert.deepEqual(headings, ['## purpose', '## why', '## good', '## roles', '## tools', '## rules', '## writing', '## open']);
  assert.match(md, /## rules\n\n## writing\n\n## open\n$/);
  assert.match(md, /Because people forget why they decided\. \*\*Decided\*\*/);
  assert.match(md, /Only you decide|The person decides: confirm the type, the level and the name/);
  const fresh = { ...d };
  delete fresh.rewrite;
  assert.match(Interview.exportContract(fresh, kinds, block), /^Version: 0\.1\.0$/m, 'a new contract starts at 0.1.0');
});

test('the export escapes a pipe and a line break in a table cell, and writes an agreed none as None', () => {
  const d = base();
  const block = Interview.blockOf(d, kinds, hashes, {
    answers: new Map([['rule-1', { fields: { rule: 'one | two\nthree', guards: 'a slip', status: 'potential' } }]]),
    edits: [{ op: 'none', part: 'purpose', kind: 'stays-out' }],
  });
  const md = Interview.exportContract(d, kinds, block);
  assert.ok(md.includes('| one \\| two<br>three | a slip | potential |'), md.slice(md.indexOf('## rules'), md.indexOf('## rules') + 400));
  assert.match(md, /\*\*Not its job\*\*\n\n- None\. \*\*Decided\*\*/);
  assert.match(md, /\*\*A record it keeps\*\*\n\n- None\. \*Proposed\*/);
  // The term and open tables keep the template's columns; the mark folds into
  // the last cell, as the rules table does.
  assert.ok(md.includes('| Term | Plain meaning | Standard |\n|---|---|---|\n'), 'the term table has the template\'s three columns');
  assert.ok(md.includes('| Skill | Instructions the agent picks up by itself when a situation matches, in a folder holding `SKILL.md` | Agent Skills specification; *Proposed* |'));
  assert.ok(md.includes('| Question | Why it is open | Settled when |\n|---|---|---|\n'), 'the open table has the template\'s three columns');
});
/** An in-memory store shaped like the browser's localStorage, which records
 *  every key read, and every listing of key names through length or key(i). */
function memoryStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  const reads = [];
  return {
    reads,
    map: m,
    get length() { reads.push('(length)'); return m.size; },
    key: i => { reads.push(`(key ${i})`); return [...m.keys()][i] ?? null; },
    getItem: k => { reads.push(k); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}
const keyOf = (d, h) => `contract-interview:${d.type}:${d.name}:${h}`;
const saved = () => new Map([['job', { option: 'job-b' }], ['near-miss', { option: 'near-miss-a' }], ['duty-1', { fields: { text: 'my words' } }]]);

test('restore: saved answers survive a reload, come back marked restored and counted, and go into the block as Proposed', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  const r = Interview.restore(store, base(), kinds, hashes);
  assert.equal(r.count, 3);
  assert.deepEqual([...r.state.answers.keys()], ['job', 'near-miss', 'duty-1']);
  assert.ok([...r.state.answers.values()].every(a => a.restored === true));
  const block = Interview.blockOf(base(), kinds, hashes, r.state);
  assert.ok(block.answers.every(a => a.mark === 'Proposed' && a.restored === true));
  // Folder edits come back marked restored too: each is pushed back, and a
  // restored add or none exports Proposed, never as the person's own.
  const edits = [
    { op: 'add', id: 'added-1', part: 'rules', kind: 'rule', fields: { rule: 'one', guards: 'a slip', status: 'potential' } },
    { op: 'remove', id: 'duty-2' },
    { op: 'none', part: 'purpose', kind: 'stays-out' },
  ];
  const withEdits = memoryStore();
  Interview.save(withEdits, base(), kinds, hashes, { answers: saved(), edits });
  const back = Interview.restore(withEdits, base(), kinds, hashes);
  assert.ok(back.state.edits.length === 3 && back.state.edits.every(e => e.restored === true), 'each edit is marked restored');
  const again = Interview.blockOf(base(), kinds, hashes, back.state);
  assert.deepEqual(Interview.checkBlock(again, base(), kinds, hashes).refusals, []);
  const read = Interview.readBack(again, base(), kinds);
  assert.ok(read.changes.includes('  edit (restored): added rules/added-1, a house rule'), read.changes.join('\n'));
  for (const at of ['rules/added-1', 'roles/duty-2', 'purpose/(stays-out)']) assert.ok(read.pushback.some(l => l.startsWith(`  ${at}:`) && l.includes('a restored edit')), `${at} pushed back\n${read.pushback.join('\n')}`);
  const md = Interview.exportContract(base(), kinds, again);
  assert.ok(md.includes('| one | a slip | potential | *Proposed* |'), 'a restored add exports Proposed');
  assert.match(md, /\*\*Not its job\*\*\n\n- None\. \*Proposed\*/, 'a restored none exports Proposed');
});

test('restore drops saved answers that fail the block check, and survives a store that is missing or throws', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  const k = keyOf(base(), hashes.draft);
  const entry = JSON.parse(store.map.get(k));
  entry.block.answers[0].mark = 'Decided';
  store.map.set(k, JSON.stringify(entry));
  const r = Interview.restore(store, base(), kinds, hashes);
  assert.equal(r.count, 0);
  assert.equal(r.dropped, true);
  store.map.set(k, '{ not json');
  assert.equal(Interview.restore(store, base(), kinds, hashes).count, 0);
  assert.equal(Interview.restore(null, base(), kinds, hashes).count, 0, 'the published example passes no store');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {}, length: 0, key: () => null };
  assert.equal(Interview.restore(broken, base(), kinds, hashes).count, 0);
  assert.doesNotThrow(() => Interview.save(broken, base(), kinds, hashes, { answers: saved(), edits: [] }));
});

/** The measurement draft redrafted: `previous` names the first, and option B
 *  of the job question is reworded. */
const redrafted = mutate => {
  const d = base();
  d.previous = { type: d.type, name: d.name, hash: hashes.draft };
  d.questions[0].options[1].fields.does = 'writes the file from what the person said';
  if (mutate) mutate(d);
  return d;
};
const newHashes = { draft: 'c'.repeat(64), kinds: hashes.kinds };

test('redraft: a reworded option drops its saved pick and names it, adopts the unchanged answers and names them, reads no key but previous, and leaves one entry', () => {
  const store = memoryStore({ [`contract-interview:skill:other:${'d'.repeat(64)}`]: '{}', 'aviation-scheme': 'dark' });
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  store.reads.length = 0;
  const r = Interview.redraft(store, redrafted(), kinds, newHashes, { shared: false });
  assert.deepEqual(r.adopted, ['near-miss', 'duty-1']);
  assert.deepEqual(r.dropped, ['job']);
  assert.deepEqual(store.reads, [keyOf(base(), hashes.draft)]);
  const mine = [...store.map.keys()].filter(k => k.startsWith('contract-interview:skill:contract:'));
  assert.deepEqual(mine, [keyOf(base(), newHashes.draft)]);
  assert.equal(Interview.restore(store, redrafted(), kinds, newHashes).count, 2);
  // A save that fails leaves the old entry in place, so no answer is lost.
  const full = memoryStore();
  Interview.save(full, base(), kinds, hashes, { answers: saved(), edits: [] });
  full.setItem = () => { throw new Error('quota'); };
  Interview.redraft(full, redrafted(), kinds, newHashes, { shared: false });
  assert.ok(full.map.has(keyOf(base(), hashes.draft)), 'the old entry stays when the new one was not saved');
});

test('redraft: a draft that changes its name adopts from the old name\'s key, and no key under the old name remains', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  const d = redrafted(x => (x.name = 'contract-two'));
  const r = Interview.redraft(store, d, kinds, newHashes, { shared: false });
  assert.deepEqual(r.adopted, ['near-miss', 'duty-1']);
  assert.ok(![...store.map.keys()].some(k => k.startsWith('contract-interview:skill:contract:')));
  assert.ok(store.map.has(keyOf(d, newHashes.draft)));
});

test('redraft on a shared page whose previous names another contract adopts nothing, says so, and leaves that entry', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  store.reads.length = 0;
  const d = redrafted(x => (x.name = 'contract-two'));
  const r = Interview.redraft(store, d, kinds, newHashes, { shared: true });
  assert.deepEqual(r.adopted, []);
  assert.match(r.note, /another name were left alone/);
  assert.match(r.note, /Forget here does not clear them/, 'the note says the earlier answers stay past Forget');
  assert.match(r.note, /render the earlier draft and press Forget there/, 'and how to clear them');
  assert.deepEqual(store.reads, []);
  assert.ok(store.map.has(keyOf(base(), hashes.draft)));
});

test('Forget removes every key under the contract\'s prefix and no other key, the theme key included', () => {
  const other = `contract-interview:skill:other:${'d'.repeat(64)}`;
  const store = memoryStore({ [other]: '{}', 'aviation-scheme': 'dark' });
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  store.map.set(keyOf(base(), 'e'.repeat(64)), '{}');
  assert.equal(Interview.forget(store, base()), 2);
  assert.deepEqual([...store.map.keys()].sort(), ['aviation-scheme', other]);
  assert.equal(Interview.forget(null, base()), 0);
});
test('the key shapes equal the masking the threat model\'s row 14 names, in scripts/practice.mjs, so the two copies cannot drift', () => {
  const src = readFileSync(join(root, 'scripts', 'practice.mjs'), 'utf8');
  const block = /const START = (String\.raw`[^`]*`);\nconst KEY_SHAPES = (\[[\s\S]*?\n\]);/.exec(src);
  assert.ok(block, 'practice.mjs still holds START and KEY_SHAPES in this shape');
  const theirs = new Function(`const START = ${block[1]}; return ${block[2]};`)();
  assert.deepEqual(Interview.KEY_SHAPES.map(String), theirs.map(String));
});

test('the page\'s warning list finds a key shape and an email with no home folder known, and masks them', () => {
  const key = `sk-ant-${'a'.repeat(24)}`;
  assert.deepEqual(Interview.shapesIn(`use ${key} or write to a@example.org`), ['a key-shaped value', 'an email address']);
  assert.deepEqual(Interview.shapesIn('a plain sentence'), []);
  assert.equal(Interview.mask(`use ${key} or write to a@example.org`), 'use [masked] or write to [masked]');
});

// The measurement draft's SHA-256 as recorded on issue 343 (spec v4.2, claim
// 22). An edit to the draft fails here until the record and the limits'
// figures are measured again.
test('the measurement draft is the one the limits were measured on', () => {
  assert.equal(hashes.draft, '9faf6d8bca75bd599f62e92906eec45c6288fd550d421ddeab920a006866032b');
});