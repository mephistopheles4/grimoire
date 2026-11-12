// The agent-facing docs are counted in words, and each has a budget.
// A doc that grows past its budget fails here, so a doc cannot swell with the
// history of how its rules came to be: ADRs, change logs and dated logs hold
// that, and these docs hold what holds now. Raising a number is a spec change:
// the owner's yes in the issue. Only review enforces that. A new doc in this
// list needs a budget, set at its size when it is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Doc -> its budget in words. See the header before changing a number.
const BUDGET = {
  'AGENTS.md': 630,
  'CONTEXT.md': 300,
  'CONTRIBUTING.md': 6300,
  'docs/agents/issue-tracker.md': 1300,
  'docs/security/brigade.md': 35500,
  'docs/security/checks.md': 7200,
  'docs/security/scanners.md': 5900,
  'docs/security/rendering.md': 2400,
  'docs/security/hiring-interview.md': 900,
  'docs/practice-tests/eagle-eye.md': 2850,
  'skills/eagle-eye/CONTRACT.md': 3600,
  'skills/head-chef/references/CONTRACT.md': 14500,
  'skills/contract/references/binding-claude.md': 1100,
  'skills/contract/references/binding-codex.md': 780,
};

// The words in a text: runs of non-space characters, as `wc -w` counts them.
const words = text => text.split(/\s+/).filter(Boolean).length;

// What is wrong with the docs under a folder against a budget; empty when
// nothing is.
function faults(dir, budget) {
  const out = [];
  for (const [doc, max] of Object.entries(budget)) {
    const file = join(dir, doc);
    if (!existsSync(file)) {
      out.push(`${doc} is in BUDGET in tests/doc-budget.test.mjs and does not exist; remove its entry or restore the file`);
      continue;
    }
    const n = words(readFileSync(file, 'utf8'));
    if (n > max) out.push(`${doc} holds ${n} words, over its budget of ${max}; cut history from it, or ask the owner to raise the budget`);
  }
  return out;
}

test('each agent-facing doc is within its word budget', () => {
  assert.deepEqual(faults(root, BUDGET), []);
});

test('the counter fails a doc over budget or gone, and passes one at budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-budget-'));
  try {
    writeFileSync(join(dir, 'a.md'), 'one two  three\nfour\n');
    writeFileSync(join(dir, 'b.md'), 'one two\n');
    assert.equal(words('one two  three\nfour\n'), 4, 'runs of space and line breaks count as one break');
    assert.deepEqual(faults(dir, { 'a.md': 4, 'b.md': 2 }), [], 'at budget passes');
    const over = faults(dir, { 'a.md': 3, 'b.md': 2 });
    assert.equal(over.length, 1, 'one word over fails');
    assert.match(over[0], /^a\.md holds 4 words, over its budget of 3/, 'the message names the doc, count and budget');
    const gone = faults(dir, { 'a.md': 4, 'c.md': 10 });
    assert.equal(gone.length, 1, 'a listed doc that is gone fails');
    assert.match(gone[0], /^c\.md is in BUDGET/, 'the message names the doc');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
