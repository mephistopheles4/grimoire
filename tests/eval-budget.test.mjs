// The eval cases are counted, and each skill has a budget (issue 553). A case
// is a direct subfolder of evals/<skill>/ that holds a prompt.md; a skill is a
// folder under evals/ that holds at least one case. A folder with no case in
// it, such as the git-ignored evals/results/ that an eval run writes, is
// neither. Adding a case past a budget fails here unless a case goes out with
// it. Raising a number is a spec change: the owner's yes in the issue. Only
// review enforces that. CONTRIBUTING.md, "Eval cases", gives the rule for when
// a case earns its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Skill folder -> its budget. See the header before changing a number.
const BUDGET = { contract: 6, 'head-chef': 47 };

// The case count of each skill under an evals folder.
function counts(evalsDir) {
  const out = {};
  for (const skill of readdirSync(evalsDir, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const n = readdirSync(join(evalsDir, skill.name), { withFileTypes: true })
      .filter(c => c.isDirectory() && existsSync(join(evalsDir, skill.name, c.name, 'prompt.md'))).length;
    if (n > 0) out[skill.name] = n;
  }
  return out;
}

// What is wrong with the counts against a budget; empty when nothing is.
function faults(found, budget) {
  const out = [];
  for (const [skill, n] of Object.entries(found)) {
    if (!(skill in budget)) out.push(`evals/${skill}/ holds ${n} ${n === 1 ? 'case' : 'cases'} and has no budget; add it to BUDGET in tests/eval-budget.test.mjs, which is a spec change (CONTRIBUTING.md, "Eval cases")`);
    else if (n > budget[skill]) out.push(`evals/${skill}/ holds ${n} cases, over its budget of ${budget[skill]}; merge or cut a case, or ask the owner to raise the budget (CONTRIBUTING.md, "Eval cases")`);
  }
  return out;
}

test('each skill\'s eval cases are within its budget', () => {
  assert.deepEqual(faults(counts(join(root, 'evals')), BUDGET), []);
});

test('the counter fails a skill over budget or without one, and ignores a folder with no case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-budget-'));
  try {
    const mk = (skill, cases) => cases.forEach(c => { mkdirSync(join(dir, skill, c), { recursive: true }); writeFileSync(join(dir, skill, c, 'prompt.md'), 'x'); });
    mk('a', ['one', 'two']);
    mk('b', ['one']);
    mkdirSync(join(dir, 'results', 'run-1'), { recursive: true });
    writeFileSync(join(dir, 'results', 'run-1', 'report.json'), '{}');
    mkdirSync(join(dir, 'a', 'not-a-case', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a', 'not-a-case', 'deep', 'prompt.md'), 'x');
    const found = counts(dir);
    assert.deepEqual(found, { a: 2, b: 1 });
    assert.deepEqual(faults(found, { a: 2, b: 1 }), [], 'at budget passes, with results/ beside it');
    const over = faults(found, { a: 1, b: 1 });
    assert.equal(over.length, 1, 'over budget fails');
    assert.match(over[0], /evals\/a\/.*2 cases.*budget of 1/, 'the message names the skill, count and budget');
    const none = faults(found, { a: 2 });
    assert.equal(none.length, 1, 'a skill with no budget fails');
    assert.match(none[0], /evals\/b\/.*1 case and has no budget/, 'the message names the skill and count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
