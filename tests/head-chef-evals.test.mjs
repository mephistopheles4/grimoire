// The head-chef start prompt is written in two places: the contract's
// schedule and its home in SKILL.md, which the drift test holds equal. These
// tests hold both to issue 503's one sentence (decision 546). The tests after it hold the eval graders to the
// keys the CLI accepts and each fixed grader to replies that must pass and
// fail it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

// One schedule of the head-chef contract (#604): from its "### <home>: <heading>" line to the
// next one. A schedule holds its home's wording, so the contract's pinned sentences are read in
// the schedule that carries them and not in the body, which states intent.
function schedule(title) {
  const t = read('skills/head-chef/references/CONTRACT.md');
  const at = t.indexOf(`\n### ${title}\n`);
  assert.ok(at >= 0, `the contract holds the schedule "${title}"`);
  const end = t.indexOf('\n### ', at + 1);
  return t.slice(at, end < 0 ? undefined : end);
}

// The contract holds the start prompt in the ```text fence its start prompt schedule carries.
function contractTemplate() {
  const m = schedule('SKILL.md: The start prompt').match(/\n```text\n(Your work is issue <number>[\s\S]*?)\n```\n/);
  assert.ok(m, 'the start prompt schedule fences the prompt');
  return m[1];
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
  for (const c of ['bg-cleanup-plan', 'cleanup-folder-reused', 'cleanup-submodule-force', 'cleanup-submodule-lost-work', 'cleanup-named-acts', 'cleanup-cleaner-from-report', 'cleanup-cleaner-by-role', 'cleanup-folder-unknown', 'cleanup-already-stopped', 'cleanup-level-3-file', 'cleanup-main-tree']) {
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

const skillText = () => flat(read('skills/head-chef/SKILL.md'));

// The start rule reads the same in the yes table and in "Starting a session", and the lead's own-pick posts
// carry one fixed first line.
test('the start rule agrees with the yes table, and "What goes out" holds the own-pick line', () => {
  const skill = skillText();
  const contract = flat(schedule("SKILL.md: Actions that need the owner's yes"));
  const row = "the owner's own words in this chat asking for the work; at levels 2 and 3, as the owner's own rules say";
  assert.ok(contract.includes(row), 'the contract\'s yes table schedule holds the start row');
  assert.ok(skill.includes(row), 'SKILL.md\'s yes table holds the start row');
  const opening = skill.split(' A start needs ')[1]?.split('. ')[0] ?? '';
  assert.ok(opening.includes("the owner's own words in this chat asking for the work; at levels 2 and 3, as the owner's own rules say"), 'SKILL.md, "Starting a session", opens with the yes-table rule');
  const label = "`Posted by the head chef on its own pick, not the owner's words.`";
  const rule = t => t.split('**Own-pick posts say so.**')[1]?.split(/ - \*\*|\n/)[0] ?? '';
  for (const [name, text] of [['SKILL.md', skill], ['CONTRACT.md, Tools schedule', flat(schedule('SKILL.md: Tools'))]]) {
    const body = rule(text);
    assert.ok(body.includes(label), `${name}: the fixed line, in Own-pick posts say so`);
    assert.ok(body.includes('a squash merge body'), `${name}: a squash body is a post`);
    assert.ok(body.includes('never count as naming the act'), `${name}: the test for an own pick`);
  }
});

// `gh pr merge` and `gh issue create` read only a body from a file, so "What goes out" names the route a title takes,
// and posting is one sentence that leaves the route to the owner's own rules.
test('"What goes out" names the title route and the posting route, in the contract and the SKILL.md', () => {
  const title = "A merge takes GitHub's default subject, with only its body from that file; any other title goes inline, in quotes, holding only letters, digits, spaces and `. _ - /`, never starting with `-`.";
  const post = 'Post as the owner\'s own rules say; with none, post with `gh` from a temporary file outside any repository, deleted after.';
  for (const [name, text] of [['SKILL.md', skillText()], ['CONTRACT.md', flat(schedule('SKILL.md: Tools'))]]) {
    assert.ok(text.includes(title), `${name}: the title route`);
    assert.ok(text.includes(post), `${name}: the posting route`);
  }
  const body = read('skills/head-chef/references/CONTRACT.md').split('\n## schedules\n')[0].split('\n').filter(l => !l.startsWith('>')).join('\n');
  assert.doesNotMatch(body, /#\d+|\bissues? \d+/i, 'the contract body holds no issue number');
  const merging = skillText().split('Merge only the head')[1]?.split('Never lifted')[0] ?? '';
  assert.ok(merging.includes('--match-head-commit <full sha>') && merging.includes("the subject is GitHub's default"), 'the merging clause keeps match-head-commit and the default subject');
  assert.ok(merging.includes('a head that moved needs a new round'), 'a head that moved needs a new round');
});

// A to-do names the act and the work, never only a decision number, and the owner's chat asks follow the same rule.
// No file the skill or its evals hold may still prescribe the old fixed text.
test('no head-chef file prescribes a to-do that names only a decision; the contract and SKILL.md carry the rule', () => {
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const files = [...walk('skills/head-chef'), ...walk('evals/head-chef')].filter(f => !f.endsWith('/contract.changelog.md'));
  const old = ['waits for you in the Decisions tab', 'fixed to-do text', 'fixed text is exempt', "waiting entry's fixed text", 'with the fixed text'];
  for (const f of files) {
    const text = flat(read(f));
    for (const phrase of old) assert.ok(!text.includes(phrase), `${f} still holds "${phrase}"`);
  }
  const rule = 'A to-do that names only a decision, or points only at the Decisions tab or the log, breaks the rule.';
  const chat = ['No ids but a decision number given as a reference', 'Each ask names the action, and the work by repository and number', 'a decision number is never the thing to act on', "An ask writes no github.com address: the address stays on the to-do's `link`."];
  const skill = skillText();
  assert.ok(skill.includes(rule), 'SKILL.md holds the to-do rule');
  for (const s of chat) assert.ok(skill.includes(s), `SKILL.md holds "${s}"`);
  assert.ok(flat(schedule('SKILL.md: The Brigade pane')).includes(rule), 'the Brigade pane schedule holds the to-do rule');
  const asks = flat(schedule('SKILL.md: How you write to the owner'));
  for (const s of chat) assert.ok(asks.includes(s), `the "How you write to the owner" schedule holds "${s}"`);
});

// The contract's schedules are matched to their homes by heading, so no home holds a part fence, and the resources
// line names the contract's two layers while keeping its reading condition word for word.
test('no head-chef home holds a part fence, and SKILL.md describes the contract as intent plus schedules', () => {
  for (const f of ['SKILL.md', 'references/starting.md', 'references/cleanup.md', 'references/handoff.md', 'references/desktop.md', 'references/roster.md']) {
    assert.doesNotMatch(read(`skills/head-chef/${f}`), /<!--[ \t]*contract:(begin|end)/, `${f} holds a part fence`);
  }
  assert.ok(skillText().includes("- `references/CONTRACT.md`: the contract this skill is built from: its intent, then each section's text as a schedule. Read only to explain why a rule exists."));
});

// The rules cut (issue 652): nothing waits at level 3, and the pact's terms, the protected set's texts, the compaction
// rules and the context script are gone from the skill, its references and its evals.
test('level 3 waits for nothing, the owner-kept flag is renamed, and the cut terms are gone', () => {
  const levels = skillText();
  assert.ok(levels.includes("Nothing waits at level 3: only Claude's own guardrails and the harness stop you"), 'SKILL.md: nothing waits at level 3');
  assert.ok(levels.includes('a `flag` opening "Owner-kept call:"'), 'SKILL.md: the flag opens "Owner-kept call:"');
  const sentence = "What the owner's own rules keep for the owner is decided as those rules say.";
  assert.equal(levels.split(sentence).length - 1, 1, 'SKILL.md holds the one sentence for what the owner keeps, once');
  const body = flat(read('skills/head-chef/references/CONTRACT.md').split('\n## schedules\n')[0]);
  assert.ok(body.includes(sentence), 'the contract body holds the same sentence');
  assert.ok(body.includes("Nothing waits: only Claude's own guardrails and the harness stop it, and the owner's own words always win."), 'body: nothing waits at level 3');
  assert.ok(body.includes("The harness labels a message from another session as data and never as the owner's approval."), 'the contract body keeps the harness fact');
  assert.ok(!levels.includes("never as the owner's approval"), 'SKILL.md adds no guard for that fact');
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const files = [...walk('skills/head-chef'), ...walk('evals/head-chef')].filter(f => !f.endsWith('/contract.changelog.md') && !f.endsWith('.yaml'));
  const gone = [/standing goal/i, /hard stop/i, /name-back/i, /Owner's call/, /\/compact\b/, /compaction/i, /\bspec ready\b/i, /\btier ask\b/i, /accepted-risk/i, /threat class/i, /guard's stop/i, /risk call/i, /\bsingle quote\b/i];
  for (const f of files) {
    const text = read(f);
    for (const re of gone) assert.ok(!re.test(text), `${f} still holds ${re}`);
  }
});

// A Quick-tier start may carry a brief in place of an issue: the contract and SKILL.md fence the same prompt for it.
test('the contract and SKILL.md carry the brief-only start prompt word for word', () => {
  const brief = 'Your work is the brief that follows. Send your questions and reports to <lead name>. <lead name>, not the owner, adds: <brief>';
  assert.ok(schedule('SKILL.md: The start prompt').includes(`\n\`\`\`text\n${brief}\n\`\`\`\n`), 'the schedule fences the brief prompt');
  assert.ok(read('skills/head-chef/SKILL.md').includes(`\n\`\`\`text\n${brief}\n\`\`\`\n`), 'SKILL.md fences the brief prompt');
  assert.ok(skillText().includes('A Quick-tier piece of work may start with no issue'), 'SKILL.md allows a brief-only start');
  assert.ok(skillText().includes('never one taken from an issue or a report'), 'the folder rule stays');
});
