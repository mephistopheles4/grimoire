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
