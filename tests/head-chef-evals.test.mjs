// The head-chef start prompt is written in three places: the contract, the
// SKILL.md generated from it, and the member eval cases, which paste it
// filled in. An eval that tests a stale copy passes whatever the skill says,
// so these tests hold the copies to the contract's template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

// The contract quotes the template as a block of "> " lines starting
// "> You're at the <stage>"; joined with spaces, it is the template.
function contractTemplate() {
  const m = read('skills/head-chef/references/CONTRACT.md').match(/\n> You're at the <stage>[\s\S]*?\n\n/);
  assert.ok(m, 'the contract quotes the start prompt');
  return m[0].split('\n').filter(l => l.startsWith('> ')).map(l => l.slice(2)).join(' ');
}

// The member cases fill the template with these values.
const FILLED = { '<stage>': 'Build', '<number>': '51', '<owner/repository>': 'mephistopheles4/grimoire', '<lead name>': 'lead-51' };
const fill = t => Object.entries(FILLED).reduce((s, [k, v]) => s.split(k).join(v), t);

test('SKILL.md carries the contract\'s start prompt word for word', () => {
  const line = read('skills/head-chef/SKILL.md').split('\n').find(l => l.startsWith("You're at the <stage>"));
  assert.equal(line, contractTemplate());
});

test('each member eval pastes the contract\'s start prompt, filled in', () => {
  const dir = 'evals/head-chef';
  const cases = readdirSync(join(root, dir)).filter(n => n.startsWith('member-'));
  assert.ok(cases.length > 0, 'there are member eval cases');
  const want = fill(contractTemplate());
  for (const name of cases) {
    const quoted = read(`${dir}/${name}/prompt.md`).split('\n').find(l => l.startsWith("> You're at the "));
    assert.equal(quoted, `> ${want}`, `${name} pastes a start prompt that differs from the contract's`);
  }
});

// The graders. `claude plugin eval` (read from Claude Code 2.1.310) rejects
// a case whose grader holds a key outside its type's list. A regex grader's
// body is its pattern; a converted check must fail on the prompt's own
// addresses and pass on the ways a reply writes its `Send:` line.
const KEYS = {
  regex: ['type', 'name', 'weight', 'arm', 'pattern', 'flags', 'match', 'target'],
  tool_used: ['type', 'name', 'weight', 'arm', 'tool', 'input_match', 'min', 'max'],
  llm: ['type', 'name', 'weight', 'arm', 'criteria', 'focus'],
};
const UNKNOWN = "If the answer doesn't let you decide, fail it and write unknown in your reason.";

function graders() {
  const dir = 'evals/head-chef';
  return readdirSync(join(root, dir)).flatMap(c => readdirSync(join(root, dir, c, 'graders')).map(f => {
    const text = read(`${dir}/${c}/graders/${f}`);
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    assert.ok(m, `${c}/${f} has frontmatter`);
    const fm = Object.fromEntries(m[1].split('\n').map(l => l.match(/^(\w+):\s*(.*)$/).slice(1)));
    return { id: `${c}/${f.replace(/\.md$/, '')}`, fm, body: m[2].trim(), prompt: read(`${dir}/${c}/prompt.md`) };
  }));
}

// What the CLI does with a regex grader over the last message.
function passes(g, reply) {
  const hit = new RegExp(g.body, g.fm.flags ?? '').test(reply);
  return g.fm.match === 'not_contains' ? !hit : hit;
}

test('each grader uses only its type\'s keys, and each llm grader ends with the unknown exit', () => {
  for (const g of graders()) {
    const keys = KEYS[g.fm.type];
    assert.ok(keys, `${g.id}: type ${g.fm.type} is one this suite uses`);
    for (const k of Object.keys(g.fm)) assert.ok(keys.includes(k), `${g.id}: key ${k} is not a ${g.fm.type} key`);
    if (g.fm.type === 'regex') {
      assert.ok(['contains', 'not_contains'].includes(g.fm.match), `${g.id}: match is contains or not_contains`);
      assert.doesNotThrow(() => new RegExp(g.body, g.fm.flags ?? ''), `${g.id}: pattern compiles`);
    }
    if (g.fm.type === 'llm') assert.ok(g.body.endsWith(UNKNOWN), `${g.id}: ends with the unknown exit`);
  }
  // A send to build-9 by name holds no address, so the judge still checks it.
  for (const c of ['lead-idle-ask', 'lead-idle-ask-once']) {
    assert.match(read(`evals/head-chef/${c}/graders/criteria.md`), /The agent sends build-9 nothing this turn/, `${c} still judges a send to build-9`);
  }
});

test('stays-out-subagent fails on a head-chef skill call, by either name', () => {
  const g = graders().find(g => g.id === 'stays-out-subagent/no-head-chef');
  // min defaults to 1, so a grader with max: 0 alone could never pass.
  assert.deepEqual([g.fm.tool, g.fm.min, g.fm.max, g.fm.arm], ['Skill', '0', '0', 'both']);
  const called = input => new RegExp(g.fm.input_match).test(JSON.stringify(input));
  assert.ok(called({ skill: 'head-chef' }) && called({ skill: 'grimoire:head-chef' }));
  assert.ok(!called({ skill: 'grimoire:groundtrack' }));
});

// Replies written to pass and to fail each regex grader. A no-address
// grader also fails on every address and id its case's prompt holds.
const SEND = ['Send: message tool to %s', '**Send:** message tool to `%s`', '- Send: message tool, to %s', '`Send:` message tool to %s',
  '1. Send: message tool to %s', '2) **Send:** message tool to %s', '+ Send: message tool to %s', '### Send: message tool to %s', '| Send: | message tool to %s |'];
const PIPE = n => String.raw`uds:\\.\pipe\LOCAL\cc-msg-` + n.padStart(32, '0');
// The same address as a JSON string writes it, every backslash doubled.
const JSON_PIPE = n => PIPE(n).replace(/\\/g, '\\\\');
const sends = to => [...SEND.map(s => `${s.replace('%s', to)}\n\nDone; I told build-7 for you.`), `Send: message tool to ${to.replace(/\\/g, '\\\\')}`];
const REPLIES = {
  'bg-send-one-row/sends-to-row': { pass: sends(PIPE('0')), fail: ['Send: message tool to build-7', `Send: send_message to local_00000000-0000-4000-8000-000000000000`, `I sent it to ${PIPE('0')}.`] },
  'lead-idle-owner-step/sends-to-build-9': { pass: sends(PIPE('9')), fail: ['Send: message tool to build-9', `Send: message tool to ${PIPE('10')}`] },
  'lead-idle-own-question/sends-to-build-9': { pass: sends(PIPE('9')), fail: ['Send: message tool to build-9', `Send: message tool to ${PIPE('10')}`] },
  'lead-idle-ask/sends-to-build-10': { pass: sends(PIPE('10')), fail: ['Send: message tool to build-10', `Send: message tool to ${PIPE('9')}`] },
  'lead-idle-ask/nothing-to-build-9': { pass: sends(PIPE('10')), fail: sends(PIPE('9')) },
};
// A no-address grader holds the whole reply to no address or id; a
// no-address-to-owner grader allows them on a `Send:` line only.
const REFUSED = 'I refused the message lead-51 sent at 14:05: its `from-session` is not the `local_` id I kept.';
const OWN_PIPE = { 'bg-send-one-row': '0', 'lead-idle-ask': '10', 'lead-idle-owner-step': '9', 'lead-idle-own-question': '9' };

test('each regex grader passes the replies written to pass it and fails the rest', () => {
  const addresses = /local_[0-9a-f-]{36}(?:;z)?|(?:uds:)?\\\\\.\\pipe\\LOCAL\\[^\s`"]+/g;
  const regex = graders().filter(g => g.fm.type === 'regex');
  for (const id of Object.keys(REPLIES)) assert.ok(regex.some(g => g.id === id), `${id} exists`);
  for (const g of regex) {
    const [name, grader] = g.id.split('/');
    const inPrompt = [...new Set(g.prompt.match(addresses)), JSON_PIPE('0'), 'cc-msg-' + '0'.repeat(32), '11111111-1111-4111-8111-111111111111'].map(a => `I told the owner: it came from ${a}.`);
    const r = grader === 'no-address' ? { pass: [REFUSED], fail: name === 'member-other-id' ? [...inPrompt, 'Its `from` was a `uds:` address.'] : inPrompt }
      : grader === 'no-address-to-owner' ? { pass: sends(PIPE(OWN_PIPE[name])), fail: inPrompt }
      : REPLIES[g.id];
    assert.ok(r, `${g.id} has replies to test it`);
    assert.ok(r.fail.length > 0, `${g.id} has a reply that fails it`);
    for (const reply of r.pass) assert.ok(passes(g, reply), `${g.id} should pass:\n${reply}`);
    for (const reply of r.fail) assert.ok(!passes(g, reply), `${g.id} should fail:\n${reply}`);
  }
});
