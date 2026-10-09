// head-chef's relay-session.mjs, driven through its core with a synthetic
// transcript, a scratch state folder and fake runners (see relay-fixture.mjs).
// Each test checks what the script prints, what it writes to state and what
// it would post, and that no post and no line outside a message block holds
// a code, a session id or a local path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  World, IDS, RECORD, LEAD_NAME, core, metaRecords, typed, peer, compaction,
  startPrompt, messageOf, sendTo, expectResult, assertClean, show, fs, join, runSession,
} from './relay-fixture.mjs';

const QUESTION = 'Keep the long example?\nA) keep it\nB) cut it\nRecommended: A\n';

function world({ localOnly = [], first } = {}) {
  const w = new World();
  w.write(IDS.session, [...metaRecords(), first ?? typed(startPrompt({ localOnly }))]);
  w.write(IDS.lead, [...metaRecords(), typed('lead start')]);
  return w;
}

function ask(w, text = QUESTION, name) {
  return w.session('ask', '--record', RECORD, '--file', w.questionFile(text, name));
}

const codeOf = r => /Code: ([0-9a-f]{8})$/.exec(messageOf(r))[1];

// The relay the lead's script would print, as the lead would send it.
function relayBody(code, letter, words, owner, { tamper } = {}) {
  const text = `Owner's answer, relayed by the head chef: choice ${letter}) ${words}. The owner's words, quoted: "${owner}"`;
  const body = core.block(text, code);
  return tamper ? body.replace(owner, tamper) : body;
}

function relay(w, body, sender = LEAD_NAME, opts) {
  w.append(IDS.session, peer(sender, body, opts));
  return w.session('take', '--record', RECORD);
}

// ---------------------------------------------------------------------------
// ask

test('ask posts the question with no code and prints the message for the lead', () => {
  const w = world();
  const file = w.questionFile(QUESTION);
  const r = w.session('ask', '--record', RECORD, '--file', file);
  expectResult(r, 0, 'RESULT: ok');
  assert.equal(sendTo(r), LEAD_NAME);
  const msg = messageOf(r).split('\n');
  assert.match(msg[0], /^Question for the owner, from "build-7": Keep the long example\? Choices: A\) keep it; B\) cut it\. Recommended: A\. Detail: https:\/\/github\.com\/owner\/repo\/issues\/7#issuecomment-1001\.$/);
  assert.match(msg[1], /^Check: [0-9a-f]{12}$/);
  assert.match(msg[2], /^Code: [0-9a-f]{8}$/);
  assert.ok(core.parseBlock(messageOf(r)).intact);
  assert.equal(w.posts.length, 1);
  assert.ok(!w.posts[0].includes(codeOf(r)));
  assert.equal(fs.existsSync(file), false, 'the question file is deleted');
  const s = w.state(IDS.session);
  assert.deepEqual(Object.keys(s.open), [codeOf(r)]);
  assertClean(w, r);
});

test('ask refuses a record that is not the start prompt\'s, and leaves the file alone', () => {
  const w = world();
  const file = w.questionFile(QUESTION);
  const r = w.session('ask', '--record', 'https://github.com/owner/repo/issues/8', '--file', file);
  expectResult(r, 1, 'RESULT: refused record');
  assert.ok(fs.existsSync(file));
  assert.equal(w.posts.length, 0);
});

test('ask refuses a question file outside the two temporary folders, an oversize one, and one that does not parse', () => {
  const w = world();
  const outside = join(w.dir, 'q.txt');
  fs.writeFileSync(outside, QUESTION);
  expectResult(w.session('ask', '--record', RECORD, '--file', outside), 1, 'RESULT: refused file');
  assert.ok(fs.existsSync(outside));

  const big = w.questionFile(`${'x'.repeat(5000)}\nA) a\nB) b\n`, 'big.txt');
  expectResult(w.session('ask', '--record', RECORD, '--file', big), 1, 'RESULT: refused file');
  assert.ok(fs.existsSync(big));

  const bad = w.questionFile('Only a question\n', 'bad.txt');
  expectResult(w.session('ask', '--record', RECORD, '--file', bad), 1, 'RESULT: refused file');
  assert.ok(fs.existsSync(bad), 'a file that does not parse is left alone');

  const sys = join(w.tmp, 'q.txt');
  fs.writeFileSync(sys, QUESTION);
  expectResult(w.session('ask', '--record', RECORD, '--file', sys), 0, 'RESULT: ok');
  assert.equal(w.posts.length, 1);
});

test('ask refuses a question file reached through a link inside the temporary folder', () => {
  const w = world();
  const outsideDir = join(w.dir, 'outside');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(join(outsideDir, 'q.txt'), QUESTION);
  const link = join(w.job, 'tmp', 'linked');
  fs.symlinkSync(outsideDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  const r = w.session('ask', '--record', RECORD, '--file', join(link, 'q.txt'));
  expectResult(r, 1, 'RESULT: refused file');
  assert.ok(fs.existsSync(join(outsideDir, 'q.txt')), 'the outside file still exists');
  assert.equal(w.posts.length, 0);
});

test('ask screens the question and its choices, and deletes a refused file', () => {
  const cases = [
    [`Use ${IDS.other}?\nA) yes\nB) no\n`, 'screened'],
    ['Which hash?\nA) deadbeefcafe\nB) none\n', 'screened'],
    ['Where?\nA) C:/work\nB) here\n', 'screened'],
    ['Token?\nA) ghp_x\nB) no\n', 'screened'],
    ['Next step?\nA) merge it\nB) wait\n', 'floor'],
    ['Next step?\nA) remove the old branch\nB) wait\n', 'floor'],
    ['Next step?\nA) stop the session\nB) wait\n', 'floor'],
    ['Which wording?\nA) the license choice\nB) other\n', 'local-only'],
  ];
  for (const [text, reason] of cases) {
    const w = world({ localOnly: ['license choice'] });
    const file = w.questionFile(text);
    const r = w.session('ask', '--record', RECORD, '--file', file);
    expectResult(r, 3, `RESULT: ask-in-own-chat ${reason}`);
    assert.ok(!fs.existsSync(file), `deleted after a refusal: ${text}`);
    assert.equal(w.posts.length, 0);
    for (const l of r.lines) assert.ok(!l.includes(IDS.other) && !l.includes('C:/work') && !l.includes('license'), show(r));
  }
});

test('the screens let a lone kill, proceed, fix or done through, and stop "kill the session"', () => {
  for (const word of ['kill', 'proceed', 'fix', 'done']) assert.equal(core.screen(word), null, word);
  assert.equal(core.screen('kill the session'), 'floor');
  assert.equal(core.screen('Merged'), 'floor');
  assert.equal(core.screen('emerge'), null, 'whole words only');
  assert.equal(core.screen('change the Settings'), 'floor');
  assert.equal(core.screen('add an allow  rule'), 'floor');
  assert.equal(core.hitsLocalOnly('Merge', ['merge']), true);
  assert.equal(core.hitsLocalOnly('merging', ['merge']), false, 'local-only entries take no added endings');
  assert.equal(core.hitsLocalOnly('the Release Notes', ['release notes']), true);
});

test('ask with no single lead row posts the miss line and asks in its own chat', () => {
  const w = world();
  w.rows = w.rows.filter(r => r.sessionId !== IDS.lead);
  const r = ask(w);
  expectResult(r, 3, 'RESULT: ask-in-own-chat lead-not-found');
  assert.equal(w.posts.length, 1);
  assert.match(w.posts[0], /Question not delivered to the head chef at [0-9]{2}:[0-9]{2} UTC; see the question above\.$/);
  assertClean(w, r);
});

test('ask refuses when another session holds the lead\'s name', () => {
  const w = world();
  w.rows.push({ name: LEAD_NAME, sessionId: IDS.other, id: null });
  expectResult(ask(w), 3, 'RESULT: ask-in-own-chat lead-not-found');
});

test('a failed question post closes the code', () => {
  const w = world();
  w.failPost = 1;
  const r = ask(w);
  expectResult(r, 3, 'RESULT: ask-in-own-chat post-failed');
  assert.deepEqual(w.state(IDS.session).open, {});
  assert.equal(messageOf(r), null, 'no message to send');
});

// ---------------------------------------------------------------------------
// take

test('take acts on the letter alone, posts the owner\'s words in a fence, and replies with the code', () => {
  const w = world();
  const a = ask(w);
  const code = codeOf(a);
  const owner = 'A, and ```keep``` it short';
  const r = relay(w, relayBody(code, 'A', 'keep it', owner));
  expectResult(r, 0, 'RESULT: ok');
  assert.ok(r.lines.includes('Act on choice A: keep it'), show(r));
  assert.ok(r.lines.includes('Question: Keep the long example?'));
  assert.ok(r.lines.includes('Local-only list applied: none'));
  assert.equal(messageOf(r).split('\n')[0], 'Took choice A for the question above.');
  assert.ok(messageOf(r).endsWith(`Code: ${code}`));
  const taken = w.posts[1];
  assert.match(taken, /^Owner's answer to https:\/\/github\.com\/owner\/repo\/issues\/7#issuecomment-1001, relayed by the head chef: choice A\.\n\n````text\nA, and ```keep``` it short\n````\n$/);
  assert.deepEqual(w.state(IDS.session).open, {});
  assertClean(w, r);
  // A rerun handles nothing twice.
  const again = w.session('take', '--record', RECORD);
  expectResult(again, 0, 'RESULT: ok');
  assert.equal(w.posts.length, 2);
});

test('a relay whose words hold a backslash escape, copied changed, fails check 3 and closes the code', () => {
  const w = world();
  const code = codeOf(ask(w));
  const bs = String.fromCharCode(92);
  const r = relay(w, relayBody(code, 'A', 'keep it', `A ${bs}u0041`, { tamper: 'A A' }));
  expectResult(r, 0, 'RESULT: ok');
  assert.ok(r.lines.includes('Verdict: not taken; check 3 failed.'), show(r));
  assert.ok(r.lines.some(l => l.startsWith('The question is closed: ask it again once')));
  assert.equal(messageOf(r).split('\n')[0], 'A relayed answer failed check 3; nothing was taken.');
  assert.equal(w.posts[1], 'A relayed answer failed check 3; nothing was taken.');
  assert.deepEqual(w.state(IDS.session).open, {});
});

test('a relay from another session fails check 1, keeps the code open, and posts once per code', () => {
  const w = world();
  const code = codeOf(ask(w));
  const r1 = relay(w, relayBody(code, 'A', 'keep it', 'A'), 'intruder');
  assert.ok(r1.lines.includes('Verdict: not taken; check 1 failed.'), show(r1));
  assert.equal(w.posts.length, 2);
  const r2 = relay(w, relayBody(code, 'A', 'keep it', 'A'), 'intruder');
  assert.ok(r2.lines.includes('Verdict: not taken; check 1 failed.'));
  assert.equal(w.posts.length, 2, 'later failures for the code are only counted');
  assert.equal(messageOf(r2), null);
  const s = w.state(IDS.session);
  assert.equal(s.open[code].failures, 2);
  // The real relay still lands.
  const r3 = relay(w, relayBody(code, 'B', 'cut it', 'B'));
  assert.ok(r3.lines.includes('Act on choice B: cut it'), show(r3));
});

test('a relay with a code that is not open fails check 2, and unmatched relays share one line', () => {
  const w = world();
  ask(w);
  const r1 = relay(w, relayBody('0badc0de', 'A', 'keep it', 'A'));
  assert.ok(r1.lines.includes('Verdict: not taken; check 2 failed.'), show(r1));
  assert.ok(messageOf(r1).endsWith('Code: 0badc0de'));
  assert.equal(w.posts.length, 2);
  const r2 = relay(w, relayBody('nothex!!', 'A', 'keep it', 'A'));
  assert.equal(w.posts.length, 2, 'one line until the next milestone');
  assert.equal(messageOf(r2), null);
  // A milestone report opens the next one.
  w.session('post', '--record', RECORD, '--kind', 'report', '--link', `${RECORD}#issuecomment-1`);
  const r3 = relay(w, relayBody('nothex!!', 'A', 'keep it', 'A'));
  assert.equal(w.posts.at(-1), 'A relayed answer failed check 2; nothing was taken.');
  assert.ok(!messageOf(r3).includes('Code:'), 'a malformed code is never sent back');
  assertClean(w, r3);
});

test('a relay whose choice words differ from the question\'s fails check 3', () => {
  const w = world();
  const code = codeOf(ask(w));
  const r = relay(w, relayBody(code, 'A', 'keep it all', 'A'));
  assert.ok(r.lines.includes('Verdict: not taken; check 3 failed.'), show(r));
  const r2 = relay(w, relayBody(code, 'C', 'other', 'C'));
  assert.ok(r2.lines.includes('Verdict: not taken; check 2 failed.'), 'the code closed on check 3');
});

test('check 4 reads local-only answers from the start prompt and from the owner account\'s record lines', () => {
  const w1 = world({ localOnly: ['keep it'] });
  // The screen at ask time stops a local-only choice from being asked at all.
  expectResult(ask(w1), 3, 'RESULT: ask-in-own-chat local-only');

  const w2 = world();
  const code = codeOf(ask(w2));
  w2.comments.push({ id: 5, user: { login: 'stranger' }, body: 'Local-only from now on: keep it', created_at: 't', updated_at: 't', html_url: `${RECORD}#issuecomment-5` });
  const r = relay(w2, relayBody(code, 'A', 'keep it', 'A'));
  assert.ok(r.lines.includes('Act on choice A: keep it'), `another account's line changes nothing\n${show(r)}`);

  const w3 = world();
  const code3 = codeOf(ask(w3));
  w3.comments.push({ id: 6, user: { login: 'owner' }, body: 'Local-only from now on: keep it', created_at: 't', updated_at: 't', html_url: `${RECORD}#issuecomment-6` });
  const r3 = relay(w3, relayBody(code3, 'A', 'keep it', 'A'));
  assert.ok(r3.lines.includes('Verdict: not taken; check 4 failed.'), show(r3));
});

test('a way-back line followed by 30 owner entries is honoured; past the page cap the session asks in its own chat', () => {
  const w = world();
  const code = codeOf(ask(w));
  w.comments.push({ id: 6, user: { login: 'owner' }, body: 'Local-only from now on: keep it', created_at: 't', updated_at: 't', html_url: `${RECORD}#issuecomment-6` });
  for (let i = 0; i < 30; i++) w.comments.push({ id: 100 + i, user: { login: 'owner' }, body: 'note', created_at: 't', updated_at: 't', html_url: `${RECORD}#issuecomment-${100 + i}` });
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'));
  assert.ok(r.lines.includes('Verdict: not taken; check 4 failed.'), show(r));

  const w2 = world();
  const code2 = codeOf(ask(w2));
  for (let i = 0; i < core.PAGE_CAP * core.PAGE_SIZE; i++) w2.comments.push({ id: 100 + i, user: { login: 'owner' }, body: 'note', created_at: 't', updated_at: 't', html_url: 'x' });
  const r2 = relay(w2, relayBody(code2, 'A', 'keep it', 'A'));
  expectResult(r2, 3, 'RESULT: ask-in-own-chat read-failed');
});

test('owner words holding an id, a hash, a path or a token take nothing and post no words', () => {
  const words = [`A ${IDS.other}`, `A ${'f'.repeat(40)}`, 'A D:/work/notes', 'A ghp_abc'];
  for (const owner of words) {
    const w = world();
    const code = codeOf(ask(w));
    const r = relay(w, relayBody(code, 'A', 'keep it', owner));
    expectResult(r, 3, 'RESULT: ask-in-own-chat screened');
    assert.equal(messageOf(r).split('\n')[0], 'A relayed answer failed check 4; nothing was taken.');
    assert.ok(w.posts.every(p => !p.includes(owner)), show(r));
    assert.deepEqual(w.state(IDS.session).open, {});
    assertClean(w, r);
  }
});

test('a failed taken post takes nothing, replies that it could not be recorded, and a rerun posts nothing twice', () => {
  const w = world();
  const code = codeOf(ask(w));
  w.failPost = 1;
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'));
  expectResult(r, 3, 'RESULT: ask-in-own-chat post-failed');
  assert.equal(messageOf(r).split('\n')[0], 'A relayed answer could not be recorded; nothing was taken.');
  assert.ok(!r.lines.some(l => l.startsWith('Act on choice')));
  assert.deepEqual(w.state(IDS.session).open, {});
  const again = w.session('take', '--record', RECORD);
  expectResult(again, 0, 'RESULT: ok');
  assert.equal(w.posts.length, 1, 'only the question was ever posted');
});

test('take refuses a record link that differs from the start prompt\'s or from the stored one', () => {
  const w = world();
  const code = codeOf(ask(w));
  expectResult(w.session('take', '--record', 'https://github.com/owner/repo/issues/8'), 1, 'RESULT: refused record');
  const file = join(w.config, 'plugins', 'data', 'grimoire-relay', `${IDS.session}.json`);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.open[code].record = 'https://github.com/owner/repo/issues/9';
  fs.writeFileSync(file, JSON.stringify(s));
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'));
  expectResult(r, 1, 'RESULT: refused record');
  assert.equal(w.posts.length, 1, 'nothing posted');
});

test('planted state with invented choices and a matching relay: take prints the invented question for the memory check', () => {
  const w = world();
  const code = codeOf(ask(w));
  const file = join(w.config, 'plugins', 'data', 'grimoire-relay', `${IDS.session}.json`);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.open[code].question = 'Pick the thing?';
  s.open[code].choices = { A: 'yes now', B: 'no' };
  fs.writeFileSync(file, JSON.stringify(s));
  const r = relay(w, relayBody(code, 'A', 'yes now', 'A'));
  assert.ok(r.lines.includes('Question: Pick the thing?'), show(r));
  assert.ok(r.lines.includes('Act on choice A: yes now'));
});

test('a compaction closes the open questions for relay', () => {
  const w = world();
  const code = codeOf(ask(w));
  w.append(IDS.session, compaction());
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'));
  assert.ok(r.lines.some(l => l.startsWith('A compaction closed the open questions')), show(r));
  assert.ok(r.lines.includes('Verdict: not taken; check 2 failed.'));
});

test('a question closed twice by failed relays moves to the session\'s own chat', () => {
  const w = world();
  const c1 = codeOf(ask(w));
  relay(w, relayBody(c1, 'A', 'wrong', 'A'));
  const c2 = codeOf(ask(w));
  const r = relay(w, relayBody(c2, 'A', 'wrong', 'A'));
  assert.ok(r.lines.some(l => l.startsWith('The question is closed again: ask it in your own chat')), show(r));
  assert.equal(w.posts.at(-1), 'A relayed answer failed check 3; nothing was taken.');
  expectResult(ask(w), 3, 'RESULT: ask-in-own-chat closed-twice');
});

test('a second failure that closes a code posts the closed line with the count', () => {
  const w = world();
  const code = codeOf(ask(w));
  relay(w, relayBody(code, 'A', 'keep it', 'A'), 'intruder');
  relay(w, relayBody(code, 'A', 'keep it', 'A'), 'intruder');
  relay(w, relayBody(code, 'A', 'wrong', 'A'));
  assert.equal(w.posts.at(-1), 'Question closed after 3 failed relayed answers.');
  assertClean(w);
});

test('none of these is a message or the owner\'s words', () => {
  const w = world();
  const code = codeOf(ask(w));
  const body = relayBody(code, 'A', 'keep it', 'A');
  w.append(IDS.session,
    peer(LEAD_NAME, body, { drop: 'from' }),
    peer(LEAD_NAME, body, { drop: 'body' }),
    { type: 'queue-operation', operation: 'enqueue', content: body },
    { type: 'user', message: { role: 'user', content: `<task-notification>${body}</task-notification>` }, uuid: 'tn' },
    { type: 'attachment', attachment: { type: 'file', content: body }, uuid: 'f' },
    { weird: true, body },
  );
  const r = w.session('take', '--record', RECORD);
  assert.ok(r.lines.includes('No relayed answer to handle.'), show(r));
  assert.equal(core.asOwnerText(typed('x', { isMeta: true })), null);
  assert.equal(core.asOwnerText(typed(`a ${'cross-session-message'} b`)), null);
  assert.equal(core.asOwnerText(typed('x', { source: 'sdk' })), null, 'sdk counts only on Desktop');
  assert.ok(core.asOwnerText(typed('x', { source: 'sdk', entrypoint: 'claude-desktop' })));
  assert.ok(core.asOwnerText(typed('x', { isMeta: false })));
});

test('a relay arriving mid-turn as a queued attachment is read like one that starts a turn', () => {
  const w = world();
  const code = codeOf(ask(w));
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'), LEAD_NAME, { form: 'attachment' });
  assert.ok(r.lines.includes('Act on choice A: keep it'), show(r));
});

// ---------------------------------------------------------------------------
// The start prompt

test('the start prompt comes from the first user record only', () => {
  const w = new World();
  w.write(IDS.session, [...metaRecords(), typed('Hello.'), typed(startPrompt())]);
  expectResult(ask(w), 3, 'RESULT: ask-in-own-chat no-start-prompt');

  const w2 = new World();
  w2.write(IDS.session, [...metaRecords(), typed('Hello.'), peer(LEAD_NAME, startPrompt())]);
  expectResult(ask(w2), 3, 'RESULT: ask-in-own-chat no-start-prompt');
});

test('a start prompt longer than one line, or with a second session id, carries no relay rule', () => {
  const w = new World();
  w.write(IDS.session, [...metaRecords(), typed(`${startPrompt()}\nmore`)]);
  expectResult(ask(w), 3, 'RESULT: ask-in-own-chat no-start-prompt');
  const w2 = new World();
  w2.write(IDS.session, [...metaRecords(), typed(`Also ${IDS.other}. ${startPrompt()}`)]);
  expectResult(ask(w2), 3, 'RESULT: ask-in-own-chat no-start-prompt');
});

test('a Desktop start prompt with the app\'s prompt source is read', () => {
  const w = new World();
  w.write(IDS.session, [...metaRecords(), typed(startPrompt(), { source: 'sdk', entrypoint: 'claude-desktop' })]);
  expectResult(ask(w), 0, 'RESULT: ok');
});

test('a chip: the rule from its wait line\'s lead, by message; refused from another sender; not past the head cap', () => {
  const wait = `Send "ready: build-7" to "${LEAD_NAME}" (session ${IDS.lead}), then stop.`;
  const w = new World();
  w.write(IDS.session, [...metaRecords(), typed(wait, { source: 'sdk', entrypoint: 'claude-desktop' }), peer(LEAD_NAME, startPrompt())]);
  expectResult(ask(w), 0, 'RESULT: ok');

  const w2 = new World();
  w2.write(IDS.session, [...metaRecords(), typed(wait, { source: 'sdk', entrypoint: 'claude-desktop' }), peer('intruder', startPrompt()), peer(LEAD_NAME, startPrompt())]);
  expectResult(ask(w2), 3, 'RESULT: ask-in-own-chat no-start-prompt');

  const w3 = new World();
  const filler = { type: 'attachment', attachment: { type: 'file', content: 'x'.repeat(core.HEAD_CAP) }, uuid: 'fill' };
  w3.write(IDS.session, [...metaRecords(), typed(wait, { source: 'sdk', entrypoint: 'claude-desktop' }), filler, peer(LEAD_NAME, startPrompt())]);
  expectResult(ask(w3), 3, 'RESULT: ask-in-own-chat no-start-prompt');

  const w4 = new World();
  w4.write(IDS.session, [...metaRecords(), typed(`${wait} ${core.ruleSentence('C:/x', RECORD, [])}`, { source: 'sdk', entrypoint: 'claude-desktop' })]);
  expectResult(ask(w4), 0, 'RESULT: ok');
});

test('a transcript longer than the tail cap reads its start prompt from the head only', () => {
  const w = world();
  const code = codeOf(ask(w));
  const filler = { type: 'attachment', attachment: { type: 'file', content: 'x'.repeat(core.TAIL_CAP) }, uuid: 'fill' };
  w.append(IDS.session, filler, peer(LEAD_NAME, startPrompt({ leadId: IDS.other })));
  const r = relay(w, relayBody(code, 'A', 'keep it', 'A'));
  assert.ok(r.lines.includes('Act on choice A: keep it'), show(r));
});

// ---------------------------------------------------------------------------
// post, end, state, runs at once

test('post builds the report and miss lines, and refuses a link off the record', () => {
  const w = world();
  expectResult(w.session('post', '--record', RECORD, '--kind', 'report', '--link', `${RECORD}#issuecomment-55`), 0, 'RESULT: ok');
  assert.equal(w.posts.at(-1), `Milestone report sent to the head chef; entry ${RECORD}#issuecomment-55.`);
  expectResult(w.session('post', '--record', RECORD, '--kind', 'milestone-miss'), 0, 'RESULT: ok');
  assert.match(w.posts.at(-1), /^Milestone report not delivered to "lead-chef" at [0-9]{2}:[0-9]{2} UTC; see the comment above\.$/);
  w.rows[0].name = '[head chef] pane';
  expectResult(w.session('post', '--record', RECORD, '--kind', 'question-miss'), 0, 'RESULT: ok');
  assert.match(w.posts.at(-1), /^Question not delivered to the head chef at /);
  expectResult(w.session('post', '--record', RECORD, '--kind', 'report'), 2, 'RESULT: usage');
  expectResult(w.session('post', '--record', RECORD, '--kind', 'report', '--link', 'https://github.com/owner/repo/issues/9'), 1, 'RESULT: refused record');
  expectResult(w.session('post', '--record', RECORD, '--kind', 'report', '--link', `${RECORD}#issuecomment-1`, '--name', 'x'), 2, 'RESULT: usage');
  assertClean(w);
});

test('arguments that break their form are usage errors, and reasons echo no input', () => {
  const w = world();
  for (const argv of [
    [], ['nope'], ['take'], ['take', '--record', 'http://github.com/owner/repo/issues/7'],
    ['take', '--record', RECORD, '--record', RECORD], ['ask', '--record', RECORD, '--file', 'relative.txt'],
    ['post', '--record', RECORD, '--kind', 'other'], ['post', '--record', RECORD, '--kind', 'report', '--link', `${RECORD}#${IDS.other}`],
    ['take', '--record', RECORD, IDS.other],
  ]) {
    const r = w.session(...argv);
    expectResult(r, 2, 'RESULT: usage');
    assert.equal(r.lines.length, 1);
  }
});

test('an older Node, or no session id, asks in the session\'s own chat', () => {
  const w = world();
  expectResult(runSessionWith(w, { nodeMajor: 20 }), 3, 'RESULT: ask-in-own-chat old-node');
  expectResult(runSessionWith(w, {}, 'not-a-guid'), 3, 'RESULT: ask-in-own-chat no-session-id');
  expectResult(runSessionWith(w, {}, IDS.stale), 3, 'RESULT: ask-in-own-chat no-transcript');
});

function runSessionWith(w, env, sid = IDS.session) {
  return runSession(['take', '--record', RECORD], w.ctx(sid, env));
}

test('end deletes the session\'s own state file; a closed code leaves no entry', () => {
  const w = world();
  const code = codeOf(ask(w));
  relay(w, relayBody(code, 'A', 'keep it', 'A'));
  assert.deepEqual(w.state(IDS.session).open, {});
  expectResult(w.session('end'), 0, 'RESULT: ok');
  assert.deepEqual(w.stateFiles(), []);
});

test('a state path that is a link, or a state file that is not state, ends in the session\'s own chat', () => {
  const w = world();
  const dir = join(w.config, 'plugins', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const elsewhere = join(w.dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, join(dir, 'grimoire-relay'), process.platform === 'win32' ? 'junction' : 'dir');
  expectResult(ask(w), 3, 'RESULT: ask-in-own-chat state');

  const w2 = world();
  const d2 = join(w2.config, 'plugins', 'data', 'grimoire-relay');
  fs.mkdirSync(d2, { recursive: true });
  fs.writeFileSync(join(d2, `${IDS.session}.json`), '{"not":"state"}');
  expectResult(ask(w2), 3, 'RESULT: ask-in-own-chat state');
  assert.equal(fs.readFileSync(join(d2, `${IDS.session}.json`), 'utf8'), '{"not":"state"}', 'left untouched');
});

test('a stop mid-write leaves the old state whole', () => {
  const w = world();
  const code = codeOf(ask(w));
  const before = fs.readFileSync(join(w.config, 'plugins', 'data', 'grimoire-relay', `${IDS.session}.json`), 'utf8');
  const ctx = w.ctx(IDS.session);
  ctx.fs = { ...fs, realpathSync: fs.realpathSync, renameSync: () => { throw new Error('stopped'); } };
  w.append(IDS.session, peer(LEAD_NAME, relayBody(code, 'A', 'keep it', 'A')));
  assert.throws(() => runSession(['take', '--record', RECORD], ctx));
  assert.equal(fs.readFileSync(join(w.config, 'plugins', 'data', 'grimoire-relay', `${IDS.session}.json`), 'utf8'), before);
});

test('two take runs at once on one code: the second ends busy, and one post is made', () => {
  const w = world();
  const code = codeOf(ask(w));
  w.append(IDS.session, peer(LEAD_NAME, relayBody(code, 'A', 'keep it', 'A')));
  const lock = join(w.config, 'plugins', 'data', 'grimoire-relay', `${IDS.session}.lock`);
  fs.writeFileSync(lock, '');
  expectResult(w.session('take', '--record', RECORD), 3, 'RESULT: ask-in-own-chat busy');
  assert.equal(w.posts.length, 1);
  fs.rmSync(lock);
  expectResult(w.session('take', '--record', RECORD), 0, 'RESULT: ok');
  assert.equal(w.posts.length, 2);
  expectResult(w.session('take', '--record', RECORD), 0, 'RESULT: ok');
  assert.equal(w.posts.length, 2);
});

test('take prints the local-only list it applied', () => {
  const w = world({ localOnly: ['release notes'] });
  const code = codeOf(ask(w));
  w.comments.push({ id: 6, user: { login: 'owner' }, body: 'Local-only from now on: the license', created_at: 't', updated_at: 't', html_url: `${RECORD}#issuecomment-6` });
  const r = relay(w, relayBody(code, 'B', 'cut it', 'B'));
  assert.ok(r.lines.includes('Local-only list applied: release notes, the license'), show(r));
});

