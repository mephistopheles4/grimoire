// The hiring page's one module, interview.js, tested in Node: the marks, the
// block it writes, the tally, the export, restore, redraft and Reset. The
// module takes its store as a parameter, so these tests pass one in memory;
// Node 20 has no localStorage. What only a browser shows stays on the
// checklist ticket 2 runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('the export matches the template: its title block, the nine parts in order, and an empty heading for each part the level does not ask', () => {
  const d = quick();
  const kept = answers();
  kept.delete('term-1');
  const block = Interview.blockOf(d, kinds, hashes, { answers: kept, edits: [] });
  const md = Interview.exportContract(d, kinds, block);
  assert.match(md, /^# Contract: contract\n\nVersion: 1\.0\.0\nKind: skill\nLevel: Quick\n/);
  const headings = md.split('\n').filter(l => l.startsWith('## '));
  assert.deepEqual(headings, ['## purpose', '## why', '## good', '## roles', '## tools', '## rules', '## writing', '## open', '## schedules']);
  assert.match(md, /## rules\n\n## writing\n\n## open\n\n## schedules\n$/);
  assert.match(md, /Because people forget why they decided\. \*\*Decided\*\*/);
  assert.match(md, /Only you decide|The person decides: confirm the type, the level and the name/);
  const fresh = { ...d };
  delete fresh.rewrite;
  assert.match(Interview.exportContract(fresh, kinds, block), /^Version: 0\.1\.0$/m, 'a new contract starts at 0.1.0');
});

test('the export escapes a backslash, a pipe and a line break in a table cell, and writes an agreed none as None', () => {
  const d = base();
  // A typed backslash before a pipe would escape the escape and end the cell,
  // so the backslash is escaped too.
  const block = Interview.blockOf(d, kinds, hashes, {
    answers: new Map([['rule-1', { fields: { rule: 'one | two\nthree\\| **Decided**', guards: 'a slip', status: 'potential' } }]]),
    edits: [{ op: 'none', part: 'purpose', kind: 'stays-out' }],
  });
  const md = Interview.exportContract(d, kinds, block);
  assert.ok(md.includes('| one \\| two<br>three\\\\\\| **Decided** | a slip | potential |'), md.slice(md.indexOf('## rules'), md.indexOf('## rules') + 400));
  assert.match(md, /\*\*Not its job\*\*\n\n- None\. \*\*Decided\*\*/);
  assert.match(md, /\*\*A record it keeps\*\*\n\n- None\. \*Proposed\*/);
  // The term and open tables keep the template's columns; the mark folds into
  // the last cell, as the rules table does.
  assert.ok(md.includes('| Term | Plain meaning | Standard |\n|---|---|---|\n'), 'the term table has the template\'s three columns');
  assert.ok(md.includes('| Skill | Instructions the agent picks up by itself when a situation matches, in a folder holding `SKILL.md` | Agent Skills specification; *Proposed* |'));
  assert.ok(md.includes('| Question | Why it is open | Settled when |\n|---|---|---|\n'), 'the open table has the template\'s three columns');
  assert.ok(md.includes('| Does a simple agent need more than Quick? | No Quick contract for an agent exists yet | Two Quick contracts are written after release; *Proposed* |'));
  // A gate is a cell's text too: its pipe and line break are escaped.
  const gated = base();
  gated.parts.rules[0].gate = 'a | b\n| forged | row | potential | **Decided** |';
  const g = Interview.exportContract(gated, kinds, Interview.blockOf(gated, kinds, hashes, { answers: new Map(), edits: [] }));
  assert.ok(g.includes('Gated by: a \\| b<br>\\| forged \\| row \\| potential \\| **Decided** \\|'), 'the gate stays in its cell');
  // An agreed none's stand-in can never share an id with a clause, so an edit
  // by id never reaches it: the export keeps None and drops the added key.
  const stand = Interview.blockOf(d, kinds, hashes, {
    answers: new Map(),
    edits: [
      { op: 'none', part: 'purpose', kind: 'stays-out' },
      { op: 'add', id: 'stays-out-none', part: 'tools', kind: 'key', fields: { capability: 'push to main', reason: 'speed' } },
      { op: 'remove', id: 'stays-out-none' },
    ],
  });
  assert.deepEqual(Interview.checkBlock(stand, d, kinds, hashes).refusals, []);
  const sm = Interview.exportContract(d, kinds, stand);
  assert.match(sm, /\*\*Not its job\*\*\n\n- None\. \*\*Decided\*\*/);
  assert.ok(!sm.includes('push to main'), 'the removed clause is not exported');
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
    { op: 'rekind', id: 'duty-3', kind: 'stop', fields: { when: 'the person has not said yes' } },
  ];
  const withEdits = memoryStore();
  Interview.save(withEdits, base(), kinds, hashes, { answers: saved(), edits });
  const back = Interview.restore(withEdits, base(), kinds, hashes);
  assert.ok(back.state.edits.length === 4 && back.state.edits.every(e => e.restored === true), 'each edit is marked restored');
  const again = Interview.blockOf(base(), kinds, hashes, back.state);
  assert.deepEqual(Interview.checkBlock(again, base(), kinds, hashes).refusals, []);
  const read = Interview.readBack(again, base(), kinds);
  assert.ok(read.changes.includes('  edit (restored): added rules/added-1, a house rule'), read.changes.join('\n'));
  assert.ok(read.changes.includes('  edit (restored): removed roles/duty-2'));
  assert.ok(read.changes.includes('  edit (restored): agreed none for the purpose schedule of stays-out'));
  assert.ok(read.changes.includes('  edit (restored): re-kinded roles/duty-3 from duty to stop'));
  for (const at of ['rules/added-1', 'roles/duty-2', 'purpose/(stays-out)', 'roles/duty-3']) assert.ok(read.pushback.some(l => l.startsWith(`  ${at}:`) && l.includes('a restored edit')), `${at} pushed back\n${read.pushback.join('\n')}`);
  const md = Interview.exportContract(base(), kinds, again);
  assert.ok(md.includes('| one | a slip | potential | *Proposed* |'), 'a restored add exports Proposed');
  assert.match(md, /\*\*Not its job\*\*\n\n- None\. \*Proposed\*/, 'a restored none exports Proposed');
  assert.ok(md.includes('- When the person has not said yes, it stops and asks *Proposed*'), 'a restored re-kind exports Proposed');
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
  assert.equal(r.note, '', 'a redraft with no schedule edit to leave behind says nothing');
  // Schedule edits are not carried over to a new draft, and the note says so.
  const edited = memoryStore();
  Interview.save(edited, base(), kinds, hashes, { answers: saved(), edits: [{ op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'a duty of mine' } }] });
  const re = Interview.redraft(edited, redrafted(), kinds, newHashes, { shared: false });
  assert.deepEqual(re.adopted, ['near-miss', 'duty-1']);
  assert.equal(re.note, '1 schedule edit from the earlier draft was not carried over: make it again here if you still want it.');
  // A save that fails leaves the old entry in place, so no answer is lost.
  const full = memoryStore();
  Interview.save(full, base(), kinds, hashes, { answers: saved(), edits: [] });
  full.setItem = () => { throw new Error('quota'); };
  Interview.redraft(full, redrafted(), kinds, newHashes, { shared: false });
  assert.ok(full.map.has(keyOf(base(), hashes.draft)), 'the old entry stays when the new one was not saved');
  // A chip is carried by its place, so a reworded chip drops its answer and
  // names it, as a reworded option does, and an unchanged chip carries over.
  const chipped = () => {
    const s = memoryStore();
    Interview.save(s, base(), kinds, hashes, { answers: new Map([['near-miss', { option: 'near-miss-a', chip: 0 }]]), edits: [] });
    return s;
  };
  const r1 = Interview.redraft(chipped(), redrafted(d => (d.questions.find(q => q.clause === 'near-miss').chips = ['a new chip'])), kinds, newHashes, { shared: false });
  assert.deepEqual([r1.adopted, r1.dropped], [[], ['near-miss']]);
  const kept = chipped();
  const r3 = Interview.redraft(kept, redrafted(), kinds, newHashes, { shared: false });
  assert.deepEqual([r3.adopted, r3.dropped], [['near-miss'], []], 'an answer with an unchanged chip was dropped');
  assert.equal(Interview.restore(kept, redrafted(), kinds, newHashes).state.answers.get('near-miss').chip, 0, 'the unchanged chip did not carry over');
  // Carried answers that fail the new draft's block check (a chip saved as
  // its text, before chips were kept by place) leave the old entry, and the
  // note says whether Reset here clears it.
  const old = memoryStore();
  Interview.save(old, base(), kinds, hashes, { answers: new Map([['near-miss', { option: 'near-miss-a', chip: base().questions.find(q => q.clause === 'near-miss').chips[0] }]]), edits: [] });
  const r2 = Interview.redraft(old, redrafted(), kinds, newHashes, { shared: false });
  assert.deepEqual(r2.adopted, []);
  assert.ok(old.map.has(keyOf(base(), hashes.draft)));
  // Under the same name and type, Reset here does clear them, and says so.
  assert.match(r2.note, /were left alone\. Reset here clears them\./);
  assert.doesNotMatch(r2.note, /does not clear/);
});

test('redraft: a draft that changes its name adopts from the old name\'s key, and no key under the old name remains', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  const d = redrafted(x => (x.name = 'contract-two'));
  const r = Interview.redraft(store, d, kinds, newHashes, { shared: false });
  assert.deepEqual(r.adopted, ['near-miss', 'duty-1']);
  assert.ok(![...store.map.keys()].some(k => k.startsWith('contract-interview:skill:contract:')));
  assert.ok(store.map.has(keyOf(d, newHashes.draft)));
  // A failed save under the new name keeps the old entry, which Reset here
  // cannot reach, and the note says so and how to clear it.
  const full = memoryStore();
  Interview.save(full, base(), kinds, hashes, { answers: saved(), edits: [] });
  full.setItem = () => { throw new Error('quota'); };
  const r2 = Interview.redraft(full, d, kinds, newHashes, { shared: false });
  assert.ok(full.map.has(keyOf(base(), hashes.draft)));
  assert.match(r2.note, /Reset here does not clear them/);
  assert.match(r2.note, /render the earlier draft and press Reset there/);
});

test('redraft on a shared page whose previous names another contract adopts nothing, says so, and leaves that entry', () => {
  const store = memoryStore();
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  store.reads.length = 0;
  const d = redrafted(x => (x.name = 'contract-two'));
  const r = Interview.redraft(store, d, kinds, newHashes, { shared: true });
  assert.deepEqual(r.adopted, []);
  assert.match(r.note, /another name were left alone/);
  assert.match(r.note, /Reset here does not clear them/, 'the note says the earlier answers stay past Reset');
  assert.match(r.note, /render the earlier draft and press Reset there/, 'and how to clear them');
  assert.deepEqual(store.reads, []);
  assert.ok(store.map.has(keyOf(base(), hashes.draft)));
});

test('Reset removes every key under the contract\'s prefix and no other key, the theme key included', () => {
  const other = `contract-interview:skill:other:${'d'.repeat(64)}`;
  const store = memoryStore({ [other]: '{}', 'aviation-scheme': 'dark' });
  Interview.save(store, base(), kinds, hashes, { answers: saved(), edits: [] });
  store.map.set(keyOf(base(), 'e'.repeat(64)), '{}');
  assert.equal(Interview.forget(store, base()), 2);
  assert.deepEqual([...store.map.keys()].sort(), ['aviation-scheme', other]);
  assert.equal(Interview.forget(null, base()), 0);
});
test('the key shapes equal the masking in scripts/practice.mjs that the threat model\'s R11 names, so the two copies cannot drift', () => {
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

/* -- the schedule kind (#604, T1) --------------------------------------------
 *
 * A schedule holds the text of one section of a built file, names the body
 * clauses it carries out, and names its home. The part is optional in a draft
 * saved before it existed; every refusal names the field it is about. */

test('kinds.json holds the schedules part last in every level, and the schedule kind with the strings every kind carries', () => {
  assert.equal(kinds.parts.at(-1), 'schedules');
  assert.equal(kinds.parts.length, 9);
  for (const [level, list] of Object.entries(kinds.levels)) assert.equal(list.at(-1), 'schedules', `${level} asks the schedules part last`);
  const k = kinds.kinds.find(x => x.id === 'schedule');
  assert.ok(k, 'the schedule kind');
  assert.equal(k.part, 'schedules');
  assert.equal(k.stakes, 'high');
  assert.deepEqual(k.fields.map(f => f.name), ['name', 'home', 'text']);
  for (const key of ['kind', 'exports', 'hiring', 'plain']) assert.equal(typeof k[key], 'string', key);
  for (const frame of ['hiring', 'plain']) assert.equal(k[frame].split('___').length - 1, 3, `${frame} has a blank for each field`);
});

/** A schedule clause; `duty-1` is a body clause of the measurement draft. */
const schedule = (fields = {}, over = {}) => ({
  id: 'sched-1',
  kind: 'schedule',
  fields: { name: 'Starting a session', home: 'SKILL.md', text: 'Run the steps.\n\nThen stop.', ...fields },
  mark: 'Proposed',
  refs: ['duty-1'],
  ...over,
});
const withSchedules = (...list) => { const d = base(); d.parts.schedules = list; return d; };
const refusalsOf = d => Interview.checkDraft(d, kinds).refusals;
/** The reason refused at exactly this path, or undefined. */
const at = (d, path) => (refusalsOf(d).find(([p]) => p === path) || [])[1];

test('a draft with no schedules key loads as an empty part, and a draft with schedules passes', () => {
  const old = base();
  assert.ok(!Object.hasOwn(old.parts, 'schedules'));
  assert.deepEqual(refusalsOf(old), []);
  assert.deepEqual(old.parts.schedules, [], 'the check leaves the part empty on the draft, so every reader sees nine parts');
  assert.deepEqual(refusalsOf(withSchedules(schedule())), []);
  // Every other part is still required.
  const gone = base();
  delete gone.parts.open;
  assert.deepEqual(refusalsOf(gone), [['parts', 'missing required key "open"']]);
  // The module's readers cope with a draft that never went through the check.
  const raw = base();
  const block = Interview.blockOf(raw, kinds, hashes, { answers: new Map(), edits: [] });
  assert.deepEqual(Interview.checkBlock(block, raw, kinds, hashes).refusals, []);
  assert.match(Interview.exportContract(raw, kinds, block), /## open\n[\s\S]*\n## schedules\n$/);
});

test('a schedule with no refs is refused, and so is a ref outside the eight body parts', () => {
  const none = schedule();
  delete none.refs;
  assert.match(at(withSchedules(none), 'parts.schedules[0].refs'), /names the body clauses it carries out/);
  assert.match(at(withSchedules(schedule({}, { refs: [] })), 'parts.schedules[0].refs'), /names the body clauses it carries out/);
  const other = schedule({ name: 'Other' }, { id: 'sched-2', refs: ['sched-1'] });
  assert.match(at(withSchedules(schedule(), other), 'parts.schedules[1].refs[0]'), /outside the eight body parts/);
  assert.match(at(withSchedules(schedule({}, { refs: ['no-such-clause'] })), 'parts.schedules[0].refs[0]'), /names no clause/);
  assert.match(at(withSchedules(schedule({}, { refs: 'duty-1' })), 'parts.schedules[0].refs'), /expected an array/);
  // An agreed none is no schedule, so it names no clause.
  assert.deepEqual(refusalsOf(withSchedules({ id: 'sched-none', kind: 'schedule', none: true, mark: 'Proposed' })), []);
});

const BAD_HOMES = [
  'contract', 'CONTRACT.md', 'references/contract.md', 'references/CONTRACT.md', 'references/Contract.md', 'references/cOnTrAcT.md',
  'references/contract-changelog.md', 'references/CONTRACT-CHANGELOG.md', 'references/Contract-Changelog.md',
  'references/con.md', 'references/CON.md', 'references/prn.md', 'references/aux.md', 'references/Nul.md',
  'references/com1.md', 'references/COM9.md', 'references/lpt1.md', 'references/LPT9.md',
  'references/a_b.md', 'references/a.b.md', `references/${'a'.repeat(41)}.md`, 'references/.md', 'references/sub/x.md', 'references/x.txt', 'references/x.MD', 'references/x.md ',
  'SKILL.MD', 'skill.md', 'Skill.md', 'README.md', '../SKILL.md', '/etc/x.md', 'references\\x.md', 'references/../SKILL.md', 'references/x.md\n', '', ' SKILL.md',
];
const GOOD_HOMES = ['SKILL.md', 'references/cleanup.md', 'references/a-1.md', `references/${'a'.repeat(40)}.md`, 'references/com0.md', 'references/com10.md', 'references/lpt0.md', 'references/contracts.md', 'references/0.md'];

test('a home outside the grammar is refused with its field path, the contract, its change log and a Windows device name in any letter case', () => {
  for (const home of BAD_HOMES) {
    const why = at(withSchedules(schedule({ home })), 'parts.schedules[0].fields.home');
    assert.ok(why, `refused: ${JSON.stringify(home)}`);
  }
  assert.match(at(withSchedules(schedule({ home: 'references/CONTRACT.md' })), 'parts.schedules[0].fields.home'), /contract or its change log/);
  assert.match(at(withSchedules(schedule({ home: 'references/Contract-Changelog.md' })), 'parts.schedules[0].fields.home'), /contract or its change log/);
  assert.match(at(withSchedules(schedule({ home: 'references/LPT9.md' })), 'parts.schedules[0].fields.home'), /Windows device name/);
  assert.match(at(withSchedules(schedule({ home: 'references/a_b.md' })), 'parts.schedules[0].fields.home'), /SKILL\.md or references\/<file>\.md/);
  for (const home of GOOD_HOMES) assert.equal(at(withSchedules(schedule({ home })), 'parts.schedules[0].fields.home'), undefined, `accepted: ${home}`);
});

test('a name is one line of 1 to 120 characters that starts with no # and holds no <!--', () => {
  const bad = ['', 'x'.repeat(121), 'one\ntwo', 'one\rtwo', '# Heading', '#x', 'a <!-- b', '<!--', 'Autonomy levels (2 of 3) <!-- x -->'];
  for (const name of bad) assert.ok(at(withSchedules(schedule({ name })), 'parts.schedules[0].fields.name'), `refused: ${JSON.stringify(name)}`);
  for (const name of ['x', 'x'.repeat(120), 'Starting a session', 'Tools (1 of 1)', 'a # b', 'Stop 1 <! no']) {
    assert.equal(at(withSchedules(schedule({ name })), 'parts.schedules[0].fields.name'), undefined, `accepted: ${JSON.stringify(name)}`);
  }
});

const BAD_TEXT = {
  'an ATX heading': '# Heading',
  'an ATX heading after three spaces': 'text\n\n   ## Heading',
  'a level 6 heading': '###### Deep',
  'an empty heading': 'text\n\n#',
  'a heading closed with hashes': '## Title ##',
  'a heading inside a code fence': '```bash\n# a comment\n```',
  'a setext heading with =': 'Title\n=====',
  'a setext heading with -': 'Title\n---',
  'a setext heading with one -': 'Title\n-',
  'an underline with trailing spaces': 'Title\n---   ',
  'an HTML comment': 'before <!-- hidden --> after',
  'a declaration': '<!DOCTYPE html>',
  'a CDATA section': 'x <![CDATA[ y ]]>',
  'a processing instruction': '<?xml version="1.0"?>',
  'a comment on a later line': 'one\n\ntwo <!-- c',
  'a link reference definition': '[label]: https://example.org',
  'a definition after three spaces': 'text\n\n   [label]: https://example.org "title"',
  'a definition after a quote marker': '> [label]: https://example.org',
  'a definition after a list marker': '- [label]: https://example.org',
  'a definition after a numbered marker': '1. [label]: https://example.org',
  'a definition after a star marker': '* [label]: https://example.org',
  'a definition after nested markers': '> - > [label]: https://example.org',
  'a definition whose label opens on one line and closes on the next': 'text\n\n[label\ncontinued]: https://example.org',
  'a label that opens and never closes on its line': 'see\n\n[ an open label',
  'a label closed on a later line, after a quote marker': '> [label\n> continued]: https://example.org',
  'a label opened in a list item': '- [label\n  continued]: https://example.org',
  'a closing line with no opening bracket': 'a\n\ncontinued]: https://example.org',
  'a heading in a quote': '> ## Heading',
  'a heading in a list item': '- # Heading',
  'a heading in a numbered item': '1. ## Heading',
  'a heading in nested containers': '> - ### Heading',
  'a setext heading in a quote': '> Title\n> ---',
  'a setext heading in a quote, with =': '> Title\n> ===',
};
const GOOD_TEXT = {
  'a hashtag': '#hashtag and #another',
  'an indented hash': 'text\n\n    # four spaces is code',
  'a table': '| a | b |\n|---|---|\n| 1 | 2 |',
  'a rule under a blank line': 'text\n\n---\n\nmore',
  'an inline link': 'see [label](https://example.org) and [a]: b is not at the start',
  'a list': '- one\n- two\n\n1. three',
  'a fence': '```text\nrun it\n```',
  'an angle bracket': 'a < b and c > d',
  'a quote': '> a quoted line',
  'a quoted rule under a blank quoted line': '> text\n>\n> ---',
  'a bracket pair on one line': '[a] and [b] and [ ] done\n[x]',
  'a hashtag in a quote and a list': '> #tag\n- #tag two',
  'empty': '',
};

test('a text holding a heading line, a line with <! or <?, or a link reference definition is refused with its field path and line', () => {
  for (const [what, text] of Object.entries(BAD_TEXT)) {
    const why = at(withSchedules(schedule({ text })), 'parts.schedules[0].fields.text');
    assert.match(why || '', /^line \d+ /, `refused: ${what}`);
  }
  assert.match(at(withSchedules(schedule({ text: 'a\n\n## H' })), 'parts.schedules[0].fields.text'), /^line 3 is a heading line/);
  assert.match(at(withSchedules(schedule({ text: 'a\nb\n===' })), 'parts.schedules[0].fields.text'), /^line 3 is a setext underline/);
  assert.match(at(withSchedules(schedule({ text: 'a\n<!-- x' })), 'parts.schedules[0].fields.text'), /^line 2 holds <! or <\?/);
  assert.match(at(withSchedules(schedule({ text: 'a\n> [x]: y' })), 'parts.schedules[0].fields.text'), /^line 2 is a link reference definition/);
  for (const [what, text] of Object.entries(GOOD_TEXT)) assert.equal(at(withSchedules(schedule({ text })), 'parts.schedules[0].fields.text'), undefined, `accepted: ${what}`);
});

test('the same field checks hold wherever a schedule\'s fields come from: a question\'s option, an answer, an edit', () => {
  const d = withSchedules(schedule());
  d.questions.push({ id: 'q-sched', clause: 'sched-1', situation: 'A section is long.', chips: [], proposed: 'o-a', options: [
    { id: 'o-a', label: 'Keep it', fields: { name: 'Starting a session', home: 'SKILL.md', text: 'ok' } },
    { id: 'o-b', label: 'Move it', fields: { name: 'Starting a session', home: 'references/contract.md', text: 'ok' } },
  ] });
  assert.match(at(d, `questions[${d.questions.length - 1}].options[1].fields.home`), /contract or its change log/);
  d.questions.pop();
  const h = { draft: 'a'.repeat(64), kinds: hashes.kinds };
  const block = fields => ({ format: 1, draft: h.draft, kinds: h.kinds, answers: [{ id: 'sched-1', fields, mark: 'Decided' }], edits: [] });
  const ok = { name: 'Starting a session', home: 'SKILL.md', text: 'ok' };
  assert.deepEqual(Interview.checkBlock(block(ok), d, kinds, h).refusals, []);
  const refused = (b, path) => (Interview.checkBlock(b, d, kinds, h).refusals.find(([p]) => p === path) || [])[1];
  assert.match(refused(block({ ...ok, home: 'references/CON.md' }), 'answers[0].fields.home'), /Windows device name/);
  assert.match(refused(block({ ...ok, text: '# no' }), 'answers[0].fields.text'), /heading line/);
  assert.match(refused(block({ ...ok, name: '# no' }), 'answers[0].fields.name'), /start with #/);
  // A schedule added on the page has no refs to name its clauses, so it is refused.
  const added = { format: 1, draft: h.draft, kinds: h.kinds, answers: [], edits: [{ op: 'add', id: 'sched-new', part: 'schedules', kind: 'schedule', fields: ok }] };
  assert.match(refused(added, 'edits[0].kind'), /names the body clauses it carries out; add it to the draft/);
  // An agreed none names none, so the page may add it.
  const none = { ...added, edits: [{ op: 'add', id: 'sched-none', part: 'schedules', kind: 'schedule', none: true }] };
  assert.deepEqual(Interview.checkBlock(none, d, kinds, h).refusals, []);
});

test('a clause a schedule carries out cannot be removed on the page, by id or with the rest of its kind, unless the schedule goes first', () => {
  const d = withSchedules(schedule({}, { refs: ['duty-1', 'job'] }));
  const h = { draft: 'a'.repeat(64), kinds: hashes.kinds };
  const block = edits => ({ format: 1, draft: h.draft, kinds: h.kinds, answers: [], edits });
  const refused = (edits, path) => (Interview.checkBlock(block(edits), d, kinds, h).refusals.find(([p]) => p === path) || [])[1];
  assert.match(refused([{ op: 'remove', id: 'duty-1' }], 'edits[0].id'), /schedule sched-1 carries out duty-1, so it cannot go while the schedule stands/);
  assert.match(refused([{ op: 'remove', part: 'roles', kind: 'duty' }], 'edits[0].kind'), /schedule sched-1 carries out duty-1/);
  assert.match(refused([{ op: 'none', part: 'roles', kind: 'duty' }], 'edits[0].kind'), /schedule sched-1 carries out duty-1/);
  assert.match(refused([{ op: 'remove', id: 'job' }], 'edits[0].id'), /schedule sched-1 carries out job, so it cannot go while the schedule stands/);
  // A clause no schedule names goes as before, and so does one whose schedule went first.
  assert.deepEqual(Interview.checkBlock(block([{ op: 'remove', id: 'stop-2' }]), d, kinds, h).refusals, []);
  assert.deepEqual(Interview.checkBlock(block([{ op: 'remove', id: 'sched-1' }, { op: 'remove', id: 'duty-1' }]), d, kinds, h).refusals, []);
  assert.match(refused([{ op: 'remove', id: 'duty-1' }, { op: 'remove', id: 'sched-1' }], 'edits[0].id'), /carries out duty-1/);
});

test('the schedule kind is for skills: an agent or a CLAUDE.md draft refuses one, and an edit cannot add one there', () => {
  const kind = kinds.kinds.find(k => k.id === 'schedule');
  assert.deepEqual(kind.types, ['skill']);
  const h = { draft: 'a'.repeat(64), kinds: hashes.kinds };
  for (const type of ['agent', 'CLAUDE.md']) {
    const d = withSchedules(schedule());
    d.type = type;
    assert.match(at(d, 'parts.schedules[0].kind'), /this draft's type cannot hold this kind; it is for skill$/, type);
    const add = { format: 1, draft: h.draft, kinds: h.kinds, answers: [], edits: [{ op: 'add', id: 'sched-none', part: 'schedules', kind: 'schedule', none: true }] };
    assert.match((Interview.checkBlock(add, d, kinds, h).refusals.find(([p]) => p === 'edits[0].kind') || [])[1], /it is for skill$/, type);
  }
  assert.equal(at(withSchedules(schedule()), 'parts.schedules[0].kind'), undefined, 'a skill draft holds one');
});

test('pieces of a split section are named (n of m) and must form a complete run in order', () => {
  const piece = (n, m, extra = {}) => schedule({ name: `Autonomy levels (${n} of ${m})`, text: `part ${n}` }, { id: `sched-${n}`, ...extra });
  assert.deepEqual(refusalsOf(withSchedules(piece(1, 3), piece(2, 3), piece(3, 3))), []);
  assert.match(at(withSchedules(piece(1, 3), piece(2, 3)), 'parts.schedules[1].fields.name'), /not followed by piece 3 of 3/);
  assert.match(at(withSchedules(piece(2, 3), piece(3, 3)), 'parts.schedules[0].fields.name'), /piece 2 of 3 does not follow piece 1 of 3/);
  assert.match(at(withSchedules(piece(1, 2), piece(1, 2, { id: 'sched-9' })), 'parts.schedules[0].fields.name'), /not followed by piece 2 of 2/);
  const elsewhere = piece(2, 2);
  elsewhere.fields.home = 'references/other.md';
  assert.match(at(withSchedules(piece(1, 2), elsewhere), 'parts.schedules[1].fields.name'), /does not follow piece 1 of 2/);
  const renamedPiece = piece(2, 2);
  renamedPiece.fields.name = 'Another section (2 of 2)';
  assert.match(at(withSchedules(piece(1, 2), renamedPiece), 'parts.schedules[1].fields.name'), /does not follow piece 1 of 2 with the same home and name/);
  assert.match(at(withSchedules(schedule({ name: 'Tools (3 of 2)' })), 'parts.schedules[0].fields.name'), /piece 3 of 2/);
  assert.match(at(withSchedules(schedule({ name: 'Tools (0 of 2)' })), 'parts.schedules[0].fields.name'), /piece 0 of 2/);
});

/* -- the export of the schedules part ----------------------------------------- */

/** The contract the draft and its answers make. */
const exported = (d, answered = new Map(), edits = []) => Interview.exportContract(d, kinds, Interview.blockOf(d, kinds, hashes, { answers: answered, edits }));
/** The text under one schedule's title, as the export wrote it. */
const textOf = (md, title) => {
  const head = `### ${title}\n\n`;
  const from = md.indexOf(head);
  assert.ok(from >= 0, `the export holds ${title}`);
  const rest = md.slice(from + head.length);
  const lines = rest.slice(0, rest.search(/\n\n(?:#{2,3} |$)/));
  // Home and mark lines, a blank line, then the text.
  const body = lines.split('\n');
  const mark = body.findIndex(l => /^\*Proposed\*$|^\*\*(?:Confirmed|Decided)\*\*$/.test(l));
  assert.ok(mark > 0, 'a mark line');
  return { home: body.slice(0, mark).join('\n'), mark: body[mark], text: lines.split('\n').slice(mark + 2).join('\n') };
};

test('the export writes ## schedules after ## open, one ### <home>: <name> schedule each, with its home, the clauses it carries out, its mark and its text', () => {
  const d = withSchedules(
    schedule({ name: 'Starting a session', home: 'SKILL.md', text: 'Run the steps.\n\nThen stop.' }, { refs: ['duty-1', 'job'] }),
    schedule({ name: 'Removing a worktree', home: 'references/cleanup.md', text: 'Ask first.' }, { id: 'sched-2', refs: ['stop-1'] }),
  );
  const md = exported(d);
  assert.ok(md.indexOf('## open') < md.indexOf('## schedules'), 'schedules come after open');
  assert.equal(md.split('\n').filter(l => l.startsWith('## ')).at(-1), '## schedules');
  const part = md.slice(md.indexOf('## schedules'));
  assert.equal(part, [
    '## schedules',
    '',
    '- SKILL.md: Starting a session. Home: `SKILL.md`.',
    '- references/cleanup.md: Removing a worktree. Home: `references/cleanup.md`.',
    '',
    '### SKILL.md: Starting a session',
    '',
    'Home: `SKILL.md`, the section "Starting a session". Carries out: "A duty", "The job".',
    '*Proposed*',
    '',
    'Run the steps.',
    '',
    'Then stop.',
    '',
    '### references/cleanup.md: Removing a worktree',
    '',
    'Home: `references/cleanup.md`, the section "Removing a worktree". Carries out: "A stop".',
    '*Proposed*',
    '',
    'Ask first.',
    '',
  ].join('\n'));
  // A body clause is named by the bold label the export writes for it, which
  // a rename on the page changes, and by no id.
  const renamed = exported(d, new Map(), [{ op: 'rename', part: 'roles', kind: 'duty', name: 'What it owns' }]);
  assert.match(renamed, /Carries out: "What it owns", "The job"\./);
  assert.ok(renamed.includes('\n**What it owns**\n'), 'the body writes that label');
  // An agreed none is written as none, with its mark, and opens no table of contents.
  const nothing = exported(withSchedules({ id: 'sched-none', kind: 'schedule', none: true, mark: 'Proposed' }));
  assert.ok(nothing.endsWith('## schedules\n\n- None. *Proposed*\n'), nothing.slice(-80));
  // A text with no characters writes no empty block after its mark.
  assert.ok(exported(withSchedules(schedule({ text: '' }))).endsWith('\n*Proposed*\n'));
});

test('a schedule\'s mark follows its answer: changed words are Decided, an answer taken as drafted stays Proposed', () => {
  const d = withSchedules(schedule(), schedule({ name: 'Other', text: 'Other text.' }, { id: 'sched-2' }));
  const md = exported(d, new Map([
    ['sched-1', { fields: { ...d.parts.schedules[0].fields, text: 'My own words.' } }],
    ['sched-2', { fields: d.parts.schedules[1].fields }],
  ]));
  assert.equal(textOf(md, 'SKILL.md: Starting a session').mark, '**Decided**');
  assert.equal(textOf(md, 'SKILL.md: Other').mark, '*Proposed*');
});

/** A section of the shape a home holds: paragraphs, a list, and a code fence that holds empty lines. */
const section = () => {
  const paras = [];
  for (let i = 0; i < 40; i++) paras.push(`Paragraph ${i}. ${'The lead keeps the rule and says so once. '.repeat(8)}`.trim());
  paras.splice(7, 0, ['```text', 'a fenced block', '', '', 'with empty lines in it', '```'].join('\n'));
  paras.splice(20, 0, '- one\n- two\n\n- three');
  // Two empty lines in a row, and a line of spaces, which is no cut.
  return `${paras.join('\n\n')}\n\n\nA paragraph after two empty lines.\n\n   \n\nThe last one.`;
};

test('a section longer than one field is cut on an empty line outside a code fence, and joins back byte for byte', () => {
  const text = section();
  assert.ok(text.length > Interview.LIMITS.fieldChars * 2, `the section is long enough to need three pieces (${text.length})`);
  const pieces = Interview.cutSection(text);
  assert.ok(pieces.length >= 3, `${pieces.length} pieces`);
  for (const p of pieces) assert.ok(p.length <= Interview.LIMITS.fieldChars, `a piece of ${p.length}`);
  // The blank line that is cut goes with neither piece, and no fence is split.
  for (const p of pieces) assert.equal((p.match(/^```/gm) || []).length % 2, 0, 'a fence cut in two');
  assert.equal(pieces.join('\n\n'), text, 'the pieces join back to the section');
  // Through the draft: pieces named (n of m), exported as one schedule, byte for byte.
  const named = pieces.map((p, i) => schedule({ name: `Autonomy levels (${i + 1} of ${pieces.length})`, text: p }, { id: `sched-${i + 1}` }));
  const d = withSchedules(...named);
  assert.deepEqual(refusalsOf(d), []);
  const md = exported(d);
  const got = textOf(md, 'SKILL.md: Autonomy levels');
  assert.equal(got.text, text, 'the exported schedule holds the section byte for byte');
  assert.equal(md.split('\n').filter(l => l.startsWith('### ')).length, 1, 'the pieces are one schedule');
  assert.match(got.home, /the section "Autonomy levels"\./, 'the suffix is stripped from the section name');
  // A section that fits is one piece, unchanged.
  assert.deepEqual(Interview.cutSection('short\n\ntext'), ['short\n\ntext']);
  // Two empty lines in a row: one is the cut, the other stays with a piece.
  assert.deepEqual(Interview.cutSection('a\n\n\nb', 3), ['a\n', 'b']);
  assert.equal(Interview.cutSection('a\n\n\nb', 3).join('\n\n'), 'a\n\n\nb');
});

test('a cut that no empty line outside a fence allows is refused, and a fence is never cut', () => {
  const fenced = ['```text', ...Array.from({ length: 300 }, (_, i) => `line ${i}${' x'.repeat(30)}`).flatMap(l => [l, '']), '```'].join('\n');
  assert.ok(fenced.length > Interview.LIMITS.fieldChars);
  assert.throws(() => Interview.cutSection(fenced), /no empty line outside a code fence/);
  assert.throws(() => Interview.cutSection('x'.repeat(Interview.LIMITS.fieldChars + 1)), /no empty line outside a code fence/);
  // A tilde fence and a longer fence close as CommonMark closes them.
  const tilde = ['~~~', 'a', '', 'b', '~~~', '', 'c'].join('\n');
  assert.deepEqual(Interview.cutSection(tilde, 12), ['~~~\na\n\nb\n~~~', 'c']);
  // Too short for the fence whole: a cut inside it is the only one that would fit, and none is made.
  assert.throws(() => Interview.cutSection(tilde, 8), /no empty line outside a code fence/);
  const long = ['````', '```', '', 'a', '````', '', 'c'].join('\n');
  assert.deepEqual(Interview.cutSection(long, 17), ['````\n```\n\na\n````', 'c']);
});

test('a fence behind a list indent or a quote marker is never cut either', () => {
  // The limit holds the fence and no more, so a cut after the intro and one
  // after the fence are right, and an empty line inside the fence would be the
  // last cut to fit were the fence not seen.
  const fences = {
    'a list item': ['  ```text', '  a', '', '  b', '  ```'],
    'a numbered item': ['   ```text', '   a', '', '   b', '   ```'],
    'a deep indent': ['      ~~~text', '      a', '', '      b', '      ~~~'],
    'a quote': ['> ```text', '> a', '', '> b', '> ```'],
    'a list item in a quote': ['> - ```text', '>   a', '', '>   b', '>   ```'],
  };
  for (const [what, fence] of Object.entries(fences)) {
    const body = fence.join('\n');
    const text = ['intro', '', body, '', 'c'].join('\n');
    assert.deepEqual(Interview.cutSection(text, body.length + 2), ['intro', body, 'c'], what);
    assert.equal(Interview.cutSection(text, body.length + 2).join('\n\n'), text, `${what} joins back`);
  }
  // A fence at the left edge is closed by a fence line there, not by one a quote marker or four spaces away.
  for (const inner of ['    ```', '> ```', '- ```']) {
    const body = ['```', inner, '', 'b', '```'].join('\n');
    assert.deepEqual(Interview.cutSection(['intro', '', body, '', 'c'].join('\n'), body.length + 2), ['intro', body, 'c'], inner);
  }
  // A fence left open is cut nowhere.
  assert.throws(() => Interview.cutSection('- x\n\n  ```text\n  a\n\n  b', 12), /no empty line outside a code fence/);
});

test('a joined schedule takes the weakest of its pieces\' marks', () => {
  const pieces = ['one', 'two', 'three'].map((text, i) => schedule({ name: `Tools (${i + 1} of 3)`, text }, { id: `p-${i + 1}` }));
  const d = withSchedules(...pieces);
  const change = i => [`p-${i}`, { fields: { ...pieces[i - 1].fields, text: `${pieces[i - 1].fields.text}!` } }];
  const mark = answered => textOf(exported(d, new Map(answered)), 'SKILL.md: Tools').mark;
  assert.equal(mark([change(1), change(2), change(3)]), '**Decided**', 'every piece Decided');
  assert.equal(mark([change(1), change(3)]), '*Proposed*', 'one piece never answered');
  assert.equal(mark([change(1), change(2), ['p-3', { fields: pieces[2].fields }]]), '*Proposed*', 'one piece taken as drafted');
  assert.equal(mark([]), '*Proposed*');
  // The text carries the changed words of each piece, joined with one blank line.
  assert.equal(textOf(exported(d, new Map([change(1), change(2), change(3)])), 'SKILL.md: Tools').text, 'one!\n\ntwo!\n\nthree!');
  // Pieces of another home or name are separate schedules, each with its own mark.
  const apart = withSchedules(schedule({ name: 'A (1 of 2)', text: 'a1' }, { id: 'a-1' }), schedule({ name: 'A (2 of 2)', text: 'a2' }, { id: 'a-2' }), schedule({ name: 'B', home: 'references/b.md', text: 'b' }, { id: 'b-1' }));
  const md = exported(apart, new Map([['a-1', { fields: { ...apart.parts.schedules[0].fields, text: 'a1!' } }]]));
  assert.equal(md.split('\n').filter(l => l.startsWith('### ')).join('|'), '### SKILL.md: A|### references/b.md: B');
});

test('a run of pieces the edits left incomplete is written as it stands, suffix and all, so the drift test sees it', () => {
  const d = withSchedules(...[1, 2, 3].map(n => schedule({ name: `Tools (${n} of 3)`, text: `t${n}` }, { id: `p-${n}` })));
  const md = exported(d, new Map(), [{ op: 'remove', id: 'p-2' }]);
  assert.deepEqual(md.split('\n').filter(l => l.startsWith('### ')), ['### SKILL.md: Tools (1 of 3)', '### SKILL.md: Tools (3 of 3)']);
});

/* -- the contract skill's own text (#604, T1, C3) ----------------------------- */

test('the contract skill says nine parts everywhere but its history, and its template holds the rules R1 to R8, each with a source link', () => {
  const dir = join(root, 'skills', 'contract');
  const hits = [];
  for (const f of readdirSync(dir, { recursive: true })) {
    if (!/\.(?:md|json|js|mjs|html)$/.test(f)) continue;
    const name = f.replaceAll('\\', '/');
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/eight parts/i.test(line)) hits.push({ name, line });
    });
  }
  // History is the change log, and the README's note on the 0.12.0 rebuild.
  const stray = hits.filter(h => h.name !== 'references/contract.changelog.md' && !(h.name === 'README.md' && h.line.includes('in place of 20 questions')));
  assert.deepEqual(stray.map(h => `${h.name}: ${h.line.slice(0, 80)}`), []);
  assert.ok(hits.length > 0, 'the history notes are still found, so this search reads the files');
  const template = readFileSync(join(dir, 'references', 'template.md'), 'utf8');
  for (let n = 1; n <= 8; n++) {
    const start = template.indexOf(`- **R${n}.**`);
    assert.ok(start >= 0, `R${n} is in template.md`);
    const end = template.indexOf('\n- **R', start + 1);
    const rule = template.slice(start, end < 0 ? template.indexOf('\n\n', start) : end);
    assert.match(rule, /\]\(https:\/\/[^)\s]+\)/, `R${n} links its source`);
  }
  assert.ok(!template.includes('R9.**'), 'the rules end at R8');
});
