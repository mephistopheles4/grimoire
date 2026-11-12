// A card's quick action (issue 223), tested at its own seam: brigade/quick.ts
// holds the rules with no engine import. This file also checks pressQuick's text.
// The engine-driven press, the prompt box and the toasts run in
// brigade/set-roster.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { TITLE, quickAction, quickDigest, quickPress, quickSurface } = await import('../brigade/quick.ts');
const { slug } = await import('../brigade/view.ts');

const card = (title, over = {}) => ({ title, work: 'w', settings: 's', status: 'working', since: 0, ...over });
const gh = (n, over = {}) => ({ number: n, title: 't', state: 'open', additions: 1, deletions: 1, updatedAt: 1, repo: 'o/r', ...over });
const answers = (rows = [], over = {}) => ({ base: new Map(rows.map(r => [r.number, r])), named: new Map(), pinned: 'o/r', ...over });
const NONE = answers();

test('claim 1: an idle card with a title that passes the rule gets Ask, and its line asks what it needs', () => {
  const q = quickAction(card('alpha', { status: 'idle' }), NONE, new Map());
  assert.deepEqual(q, { action: 'ask', label: 'Ask', line: 'What does alpha need from me?' });
});

test('581 C7: a working card the poll moved to waiting or idle gets Ask too', () => {
  for (const move of ['waiting', 'idle']) {
    assert.equal(quickAction(card('alpha'), NONE, new Map([['alpha', move]]))?.action, 'ask', move);
  }
});

test('581 C7: Ask shows on no working, done or stopped card, a move or not, and an older needs-you word draws nothing here', () => {
  assert.equal(quickAction(card('alpha', { status: 'working' }), NONE, new Map()), undefined);
  // done and stopped cards ignore a move; with no PR they get Clean up, never Ask.
  for (const status of ['done', 'stopped']) {
    assert.equal(quickAction(card('alpha', { status }), NONE, new Map([['alpha', 'waiting']]))?.action, 'cleanup', status);
  }
  // The pane reads needs-you as idle before a card reaches here, so the word itself is no status.
  assert.equal(quickAction(card('alpha', { status: 'needs-you' }), NONE, new Map()), undefined);
});

test('claim 2: a done card with no repo field and an open PR gh answered gets Merge, with the number and repository from gh', () => {
  const q = quickAction(card('alpha', { status: 'done', pr: '18' }), answers([gh(18)]), new Map());
  assert.deepEqual(q, { action: 'merge', label: 'Merge', line: 'Merge PR #18 in o/r.' });
});

test('claim 3: a done or stopped card with no PR gets Clean up, and its line asks for the list', () => {
  for (const status of ['done', 'stopped']) {
    const q = quickAction(card('alpha', { status }), NONE, new Map());
    assert.deepEqual(q, { action: 'cleanup', label: 'Clean up', line: 'Show me what cleaning up alpha would remove.' });
  }
});

test('claim 3: a done or stopped card whose PR gh answered merged or closed gets Clean up, and so does a done card with a repo field', () => {
  for (const state of ['merged', 'closed']) {
    for (const status of ['done', 'stopped']) {
      assert.equal(quickAction(card('alpha', { status, pr: '18' }), answers([gh(18, { state })]), new Map())?.action, 'cleanup', `${status} ${state}`);
    }
    const named = answers([], { named: new Map([['x/y', new Map([[18, gh(18, { state, repo: 'x/y' })]])]]) });
    assert.equal(quickAction(card('alpha', { status: 'done', pr: '18', repo: 'x/y' }), named, new Map())?.action, 'cleanup', `named ${state}`);
  }
});

test('claim 4: no button on a working card, a draft PR, a stopped card with an open PR, a card with a repo field and an open PR, or a PR gh has not answered', () => {
  const none = (c, a = answers([gh(18)])) => assert.equal(quickAction(c, a, new Map()), undefined, JSON.stringify(c));
  none(card('alpha', { status: 'working' }));
  none(card('alpha', { status: 'working', pr: '18' }));
  none(card('alpha', { status: 'done', pr: '18' }), answers([gh(18, { state: 'draft' })]));
  none(card('alpha', { status: 'stopped', pr: '18' }));
  // The card names the pinned repository itself: only the `repo` field rule keeps Merge away.
  const named = answers([], { named: new Map([['o/r', new Map([[18, gh(18)]])]]) });
  none(card('alpha', { status: 'done', pr: '18', repo: 'o/r' }), named);
  none(card('alpha', { status: 'done', pr: '19' }));
  none(card('alpha', { status: 'done', pr: 'abc' }));
  none(card('alpha', { status: 'done', pr: '18' }), answers());
});

test('claim 5: a title outside the rule gets no button, on any row', () => {
  assert.equal(TITLE.test('has space'), false);
  for (const title of ['has space', '', 'a'.repeat(81), 'tab\there', 'ünï', 'new\nline']) {
    assert.equal(quickAction(card(title, { status: 'idle' }), NONE, new Map()), undefined, `ask ${JSON.stringify(title)}`);
    assert.equal(quickAction(card(title, { status: 'done' }), NONE, new Map()), undefined, `cleanup ${JSON.stringify(title)}`);
    assert.equal(quickAction(card(title, { status: 'done', pr: '18' }), answers([gh(18)]), new Map()), undefined, `merge ${JSON.stringify(title)}`);
  }
  assert.equal(quickAction(card('a'.repeat(80), { status: 'done' }), NONE, new Map())?.action, 'cleanup');
});

test('claim 5: a gh repository that fails REPO or the dot rule, or is not the pinned one, gets no Merge', () => {
  const c = card('alpha', { status: 'done', pr: '18' });
  for (const repo of ['no-slash', 'o/..', 'o/.', '-o/r', 'o/r r', 'o/r\nx']) {
    assert.equal(quickAction(c, answers([gh(18, { repo })], { pinned: repo }), new Map()), undefined, repo);
  }
  assert.equal(quickAction(c, answers([gh(18, { repo: 'other/r' })]), new Map()), undefined);
  assert.equal(quickAction(c, answers([gh(18)], { pinned: undefined }), new Map()), undefined);
});

test('claim 11: quickSurface is true for desktop alone', () => {
  assert.equal(quickSurface('desktop'), true);
  for (const surface of ['terminal', 'mobile', 'vscode', '', undefined, null, 'Desktop', 7]) assert.equal(quickSurface(surface), false, String(surface));
});

test('claim 7: quickPress returns undefined when the place, slug, action or digest no longer matches', () => {
  const cards = [card('alpha', { status: 'done', pr: '18' })];
  const a = answers([gh(18)]);
  const d = quickDigest('merge', 'alpha', 'Merge PR #18 in o/r.');
  assert.match(d, /^[0-9a-f]{16}$/);
  const press = (over = {}) => {
    const p = { cards, place: 0, slugged: 'alpha', action: 'merge', digest: d, answers: a, ...over };
    return quickPress(p.cards, p.place, p.slugged, p.action, p.digest, p.answers, new Map());
  };
  assert.equal(press(), 'Merge PR #18 in o/r.');
  assert.equal(press({ place: 1 }), undefined);
  assert.equal(press({ slugged: 'beta' }), undefined);
  assert.equal(press({ action: 'cleanup' }), undefined);
  assert.equal(press({ digest: '0'.repeat(16) }), undefined);
  assert.equal(press({ digest: undefined }), undefined);
  // The PR number changed since the draw.
  assert.equal(press({ cards: [card('alpha', { status: 'done', pr: '19' })], answers: answers([gh(19)]) }), undefined);
  // The card is no longer in a state that gets this action.
  assert.equal(press({ cards: [card('alpha', { status: 'working', pr: '18' })] }), undefined);
  assert.equal(press({ answers: answers([gh(18, { state: 'merged' })]) }), undefined);
});

test('claim 7: a rename from ab-c to abc keeps the slug, and the digest still refuses the press, even for Merge, whose line holds no title', () => {
  assert.equal(slug('ab-c'), slug('abc'));
  const a = answers([gh(18)]);
  const d = quickDigest('merge', 'ab-c', 'Merge PR #18 in o/r.');
  assert.equal(quickPress([card('ab-c', { status: 'done', pr: '18' })], 0, 'abc', 'merge', d, a, new Map()), 'Merge PR #18 in o/r.');
  assert.equal(quickPress([card('abc', { status: 'done', pr: '18' })], 0, 'abc', 'merge', d, a, new Map()), undefined);
});

// The engine's stand-in fixes the text a `prompt.fill` answers with, so no engine test can hand the
// press a secret there. The press's own text is the check: it reads nothing off the answer but
// `isFilled`, and it submits, logs, stores and calls no tool or process.
const register = fs.readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
const press = (() => {
  const from = register.indexOf('async function pressQuick(');
  assert.ok(from > 0, 'register.tsx holds pressQuick');
  return register.slice(from, register.indexOf('\n}\n', from));
})();

// The press half of claim 11: the engine only presses a key its surface drew, so no engine test can raise a
// quick press from a surface that did not. The gate is checked in the text: it is the press's first
// statement, and the call site hands it the event's own surface.
test('claim 11: the press asks quickSurface first, with the surface the event reports', () => {
  const body = press.slice(press.indexOf('{', press.indexOf(') {')) + 1).trimStart();
  assert.ok(body.startsWith('if (!quickSurface(surface)) return'), 'the first statement is the surface gate');
  assert.match(register, /await pressQuick\(\$, e\.surface, /);
});

test('claims 9 and 12: the press reads only isFilled off the fill, and submits, logs, stores and calls no tool', () => {
  assert.ok(press.includes("$.prompt.fill({ text: ' ' + line, mode: 'append' }))?.isFilled === true"));
  assert.equal(press.match(/\$\.prompt\./g)?.length, 2, 'only prompt.read and prompt.fill');
  for (const gone of ['.text', 'submit', 'asUser', 'ui.log', 'console', '$.state', '$.store', 'update(', 'tool.', 'process.']) {
    assert.ok(!press.includes(gone), `pressQuick holds ${gone}`);
  }
});
