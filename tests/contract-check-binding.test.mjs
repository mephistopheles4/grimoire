// Tests that skills/contract/references/binding-claude.md and
// skills/contract/scripts/check.mjs say the same thing about the settings the
// check warns on. The check's tables say "Mirror of references/binding-*.md;
// change both", and nothing else holds that line. Each row of the binding's
// table is driven through the check's command line, and the check's own .md
// danger keys are read from its source, so a row added to either side alone
// fails here. How every case drives the check is in contract-fixture.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { fresh, run, show, SCRIPT, familiarText, defaultFm } from './contract-fixture.mjs';

const BINDING = join(root, 'skills', 'contract', 'references', 'binding-claude.md');

/** The rows of the binding's "Settings the check warns on" table: [first cell, second cell]. */
function bindingRows() {
  const text = readFileSync(BINDING, 'utf8').replaceAll('\r\n', '\n');
  const start = text.indexOf('## Settings the check warns on');
  assert.ok(start >= 0, 'binding-claude.md has no "Settings the check warns on" section');
  const end = text.indexOf('\n## ', start + 1);
  const rows = text
    .slice(start, end < 0 ? undefined : end)
    .split('\n')
    .filter(l => l.startsWith('| ') && !l.startsWith('| Key') && !l.startsWith('|---'));
  return rows.map(l => l.slice(2, -2).split(' | '));
}

/** The keys of the check's .md DANGER table, read from its source. */
function checkMdDangerKeys() {
  const lines = readFileSync(SCRIPT, 'utf8').replaceAll('\r\n', '\n').split('\n');
  const from = lines.findIndex(l => l.trim() === "'.md',");
  assert.ok(from >= 0, "check.mjs has no '.md' DANGER table");
  const keys = [];
  for (let i = from + 1; i < lines.length && lines[i].trim() !== ']),'; i += 1) {
    const m = /^\s*\['([A-Za-z-]+)', warnRow\(/.exec(lines[i]);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** The label of the check's danger line for a listed .md key with an unsafe value. */
function dangerLabel(key) {
  const dir = fresh();
  const file = join(dir, 'x.md');
  writeFileSync(file, familiarText([...defaultFm('x'), `${key}: zq-unsafe`, 'tools: [Read]']));
  writeFileSync(join(dir, 'x.contract.md'), `Version: 1.0.0\nTarget: claude\nExtra keys: ${key}, tools\n`);
  const r = run([file]);
  const prefix = `WARN danger: ${key} at line 4 `;
  const line = r.lines.find(l => l.startsWith(prefix));
  assert.ok(line, `no danger line for ${key}\n${show(r)}`);
  return line.slice(prefix.length);
}

const keyRows = bindingRows().filter(([cell]) => /^`[A-Za-z-]+`$/.test(cell));

describe('the binding and the check list the same .md settings', () => {
  test('every key row of the binding is a key of the check, and every key of the check has a row', () => {
    assert.deepEqual(keyRows.map(([cell]) => cell.slice(1, -1)).sort(), checkMdDangerKeys().sort());
  });

  for (const [cell, unless] of keyRows) {
    const key = cell.slice(1, -1);
    test(`${key}: the binding's row holds the check's label`, () => {
      assert.ok(unless.includes(dangerLabel(key)), `the row for ${key} does not say "${dangerLabel(key)}"`);
    });
  }

  test("the tools grant row holds the check's line", () => {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText([...defaultFm('x'), 'tools: [mcp__s__*]']));
    writeFileSync(join(dir, 'x.contract.md'), 'Version: 1.0.0\nTarget: claude\nExtra keys: tools\n');
    const r = run([file]);
    const prefix = 'WARN danger: tools item 1 at line 4 ';
    const line = r.lines.find(l => l.startsWith(prefix));
    assert.ok(line, show(r));
    const row = bindingRows().find(([cell]) => cell.includes('mcp__<server>__*'));
    assert.ok(row && row[1].includes(line.slice(prefix.length)), `the binding has no tools grant row saying "${line.slice(prefix.length)}"`);
  });

  test("the import row holds the check's line", () => {
    const file = join(fresh(), 'CLAUDE.md');
    writeFileSync(file, '# Rules\n\n@notes.md\n');
    const r = run([file]);
    const prefix = 'WARN import: line 3 ';
    const line = r.lines.find(l => l.startsWith(prefix));
    assert.ok(line, show(r));
    const row = bindingRows().find(([cell]) => cell.includes('`@` import'));
    assert.ok(row && row[1].includes(line.slice(prefix.length)), `the binding has no import row saying "${line.slice(prefix.length)}"`);
  });
});
