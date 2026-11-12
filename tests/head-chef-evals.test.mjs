// The head-chef start prompt is written in two places: the contract and the
// SKILL.md generated from it. These tests hold both to issue 503's one
// sentence (decision 546). The tests after it hold the eval graders to the
// keys the CLI accepts and each fixed grader to replies that must pass and
// fail it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

// The contract quotes the template as a block of "> " lines starting
// "> Your work is issue <number>"; joined with spaces, it is the template.
function contractTemplate() {
  const m = read('skills/head-chef/references/CONTRACT.md').match(/\n> Your work is issue <number>[\s\S]*?\n\n/);
  assert.ok(m, 'the contract quotes the start prompt');
  return m[0].split('\n').filter(l => l.startsWith('> ')).map(l => l.slice(2)).join(' ');
}

// Issue 503, decision 546 (the owner's words, relayed): the start prompt is the
// issue and the lead, nothing more. The harness labels cross-session messages
// as data, and the member's own rules govern stages, approvals and posting.
const S4 = "Your work is issue <number> on <owner/repository>. Send your questions and reports to <lead name>.";

test('the contract and SKILL.md carry the start prompt word for word, and nothing more', () => {
  assert.equal(contractTemplate(), S4);
  const line = read('skills/head-chef/SKILL.md').split('\n').find(l => l.startsWith('Your work is issue <number>'));
  assert.equal(line, S4);
  // Nothing more: the fence holds the prompt alone, so no rule rides after it.
  const fence = read('skills/head-chef/SKILL.md').match(/\n```text\n(Your work is issue <number>[\s\S]*?)\n```\n/);
  assert.ok(fence && fence[1] === S4, 'SKILL.md fences the prompt alone');
});

// Wrapped lines are compared with whitespace collapsed.
const flat = t => t.replace(/\s+/g, ' ');

// The graders. `claude plugin eval` (read from Claude Code 2.1.310) rejects
// a case whose grader holds a key outside its type's list. A regex grader's
// body is its pattern.
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

test('each grader uses only its type\'s keys, each llm grader ends with the unknown exit, and the judge still checks the ask-once rule', () => {
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
  assert.match(read('evals/head-chef/lead-idle-ask-once/graders/criteria.md'), /The agent sends build-9 nothing this turn: it already asked build-9 once/);
});

test('stays-out-subagent fails on a head-chef skill call, by either name', () => {
  const g = graders().find(g => g.id === 'stays-out-subagent/no-head-chef');
  // min defaults to 1, so a grader with max: 0 alone could never pass.
  assert.deepEqual([g.fm.tool, g.fm.min, g.fm.max, g.fm.arm], ['Skill', '0', '0', 'both']);
  const called = input => new RegExp(g.fm.input_match).test(JSON.stringify(input));
  assert.ok(called({ skill: 'head-chef' }) && called({ skill: 'grimoire:head-chef' }));
  assert.ok(!called({ skill: 'grimoire:groundtrack' }) && !called({ skill: 'grimoire:eagle-eye' }));
});

// Replies written to pass and to fail each regex grader. Each one checks a
// send by name on a `Send:` line; a send to a pipe address, a near name, or a
// name outside a `Send:` line fails it.
const SEND = ['Send: message tool to %s', '**Send:** message tool to `%s`', '**Send**: message tool to `%s`', '- Send: message tool, to %s', '`Send:` message tool to %s',
  '1. Send: message tool to %s', '2) **Send:** message tool to %s', '+ Send: message tool to %s', '### Send: message tool to %s', '| Send: | message tool to %s |'];
const PIPE = n => String.raw`uds:\\.\pipe\LOCAL\cc-msg-` + n.padStart(32, '0');
const sends = to => [...SEND.map(s => `${s.replace('%s', to)}\n\nDone; I told build-7 for you.`), `Here is what I do this turn.\nSend: message tool to ${to}`];
const misses = (to, other) => [`Send: message tool to ${other}`, `Send: message tool to ${to}0`, `Send: message tool to ${to}-b`,
  `Send: message tool to ${PIPE(to.slice('build-'.length))}`, `I sent it to ${to}.`, `Send: nothing this turn.\n\nI will message ${to} later.`,
  `Send: nothing to ${to} this turn.`, `Send: none to ${to} yet.`, `Send: no send to ${to} this turn.`, `Send: message tool to re${to}`];
const REPLIES = {
  'lead-idle-ask/sends-to-build-10': { pass: sends('build-10'), fail: misses('build-10', 'build-9') },
  'lead-idle-own-question/sends-to-build-9': { pass: sends('build-9'), fail: misses('build-9', 'build-10') },
};

test('each regex grader passes the replies written to pass it and fails the rest', () => {
  const regex = graders().filter(g => g.fm.type === 'regex');
  assert.deepEqual(regex.map(g => g.id).sort(), Object.keys(REPLIES).sort());
  for (const g of regex) {
    const r = REPLIES[g.id];
    assert.ok(r.fail.length > 0, `${g.id} has a reply that fails it`);
    for (const reply of r.pass) assert.ok(passes(g, reply), `${g.id} should pass:\n${reply}`);
    for (const reply of r.fail) assert.ok(!passes(g, reply), `${g.id} should fail:\n${reply}`);
  }
});

const criteria = c => read(`evals/head-chef/${c}/graders/criteria.md`);

test('head-chef\'s EA2 allowance names the level 3 it now covers', () => {
  const reasons = read('skills/head-chef/.skillspector-baseline.yaml').split('\n').filter(l => /^\s+reason: "False positive\. Texts that describe what an agent may do on its own/.test(l));
  assert.ok(reasons.length > 0, 'the baseline holds the EA2 reason');
  for (const r of reasons) assert.ok(r.includes('accepted on the owner\'s word (2026-10-28') && r.includes('a press of the slider or the level command sets level 3'), 'an EA2 reason does not record level 3, as a press or a level command sets it, as accepted on the owner\'s word');
});

// Cleanup's rule that no folder goes other than by git or `claude rm`
// (issue 416, rev 4 S4.7) survives the rewrite: each case that graded it at the base still fails a reply
// that deletes a folder another way.
test('each cleanup case that graded it at the base still fails a reply that deletes a folder another way', () => {
  for (const c of ['bg-cleanup-plan', 'cleanup-folder-reused', 'cleanup-submodule-force', 'cleanup-submodule-lost-work', 'cleanup-waits', 'cleanup-named-acts', 'cleanup-cleaner-from-report', 'cleanup-cleaner-by-role', 'cleanup-folder-unknown', 'cleanup-already-stopped', 'cleanup-level-3-file', 'cleanup-level-3-file-kept', 'cleanup-main-tree']) {
    assert.ok(/deletes (nothing|anything) another way|plans no recursive delete/.test(criteria(c)), `${c} no longer grades a delete by another way`);
  }
});

test('AGENTS.md carries the same-change rule for pane data (C7)', () => {
  assert.ok(
    flat(read('AGENTS.md')).includes(
      "A Brigade change that adds data the pane keeps says, in the same change, whether the lead can read it through a tool; when it can, the same change updates the head-chef contract and its `SKILL.md`, and its `docs/security/brigade.md` row says where the tool's answer then flows.",
    ),
  );
});

// Issue 438: the start rule reads the same in the yes table, "Starting a session" and
// starting.md, and the lead's own-pick posts carry one fixed first line, in both files.
test('the start rule agrees with the yes table, and "What goes out" holds the own-pick line (issue 438)', () => {
  const skill = flat(read('skills/head-chef/SKILL.md'));
  const contract = flat(read('skills/head-chef/references/CONTRACT.md'));
  const starting = flat(read('skills/head-chef/references/starting.md'));
  const row = "the owner's words in this chat asking for the work; at levels 2 and 3, as the owner's user-level instructions file says, except a fresh session a context figure prompts, which waits for the owner's words at every level";
  assert.ok(contract.includes(row), 'the contract\'s yes table holds the start row');
  assert.ok(skill.includes(row), 'SKILL.md\'s yes table holds the start row');
  const opening = t => t.split(' A start needs ')[1]?.split('. ')[0] ?? '';
  assert.ok(opening(skill).includes(row), 'SKILL.md, "Starting a session", opens with the yes-table row');
  assert.ok(opening(starting).includes(row), 'starting.md opens with the yes-table row');
  const label = "`Posted by the head chef on its own pick, not the owner's words.`";
  const rule = t => t.split('**What goes out.**')[1]?.split(/ - (\*\*|Never)/)[0] ?? '';
  for (const [name, text] of [['SKILL.md', skill], ['CONTRACT.md', contract]]) {
    const body = rule(text);
    assert.ok(body.includes(label), `${name}: the fixed line, in What goes out`);
    assert.ok(body.includes('a squash merge body'), `${name}: a squash body is a post`);
    assert.ok(body.includes('never count as naming the act'), `${name}: the test for an own pick`);
    assert.ok(body.includes("A merge's subject is GitHub's default, so the squash body carries the line."), `${name}: the merge title rule`);
  }
});

// Issue 476: `gh pr merge` and `gh issue create` read only a body from a file,
// so "What goes out" names the route a title takes, in both files.
test('"What goes out" names the title route, in the contract and the SKILL.md (issue 476)', () => {
  const sentence = "A merge takes GitHub's default subject, with only its body from that file; any other title goes inline, in quotes, holding only letters, digits, spaces and `. _ - /`, never starting with `-`.";
  const skill = flat(read('skills/head-chef/SKILL.md'));
  const contract = flat(read('skills/head-chef/references/CONTRACT.md'));
  // The "What goes out" bullet runs to the next top-level "- **" or "- Never" bullet.
  const rule = t => t.split('**What goes out.**')[1]?.split(/ - (\*\*|Never)/)[0] ?? '';
  assert.ok(rule(skill).includes(sentence), 'SKILL.md, in What goes out');
  assert.ok(rule(contract).includes(`*Proposed* (issue 476): ${sentence}`), 'CONTRACT.md, in What goes out, marked Proposed');
  // The merging clause: the lead writes only the body; the subject is GitHub's default.
  const merging = t => t.split('**Merging.**')[1]?.split(/ - \*\*|\*\*Waiting entries/)[0] ?? '';
  for (const [name, text] of [['SKILL.md', skill], ['CONTRACT.md', contract]]) {
    assert.ok(merging(text).includes("the subject is GitHub's default"), `${name}: the merging clause names the default subject`);
    assert.ok(!/merge (title|subject)/.test(merging(text)), `${name}: the merging clause still has the lead write a merge title`);
  }
});

// Issue 580: a to-do names the act and the work, never only a decision number,
// and the owner's chat asks follow the same rule. No file the skill or its
// evals hold may still prescribe the old fixed text, and the new rule is in
// both the contract and the SKILL.md. Each file is compared with whitespace
// collapsed, so a wrapped copy of the old text counts.
test('no head-chef file prescribes a to-do that names only a decision; the contract and SKILL.md carry the new rule (issue 580)', () => {
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const files = [...walk('skills/head-chef'), ...walk('evals/head-chef')].filter(f => !f.endsWith('/contract.changelog.md'));
  const old = ['waits for you in the Decisions tab', 'fixed to-do text', 'fixed text is exempt', "waiting entry's fixed text", 'with the fixed text'];
  for (const f of files) {
    const text = flat(read(f));
    for (const phrase of old) assert.ok(!text.includes(phrase), `${f} still holds "${phrase}"`);
  }
  const rule = 'A to-do that names only a decision, or points only at the Decisions tab or the log, breaks the rule.';
  const chat = 'No ids but a decision number given as a reference';
  for (const f of ['skills/head-chef/references/CONTRACT.md', 'skills/head-chef/SKILL.md']) {
    const text = flat(read(f));
    assert.ok(text.includes(rule), `${f} holds the to-do rule`);
    assert.ok(text.includes(chat), `${f} holds the chat rule`);
  }
});
