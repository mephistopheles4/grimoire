// Tests of skills/contract/scripts/check.mjs: the tools list of an agent .md
// file. A wildcard names one whole MCP server, written mcp__<server>__*, and
// every other form that holds a "*" or starts with "mcp" fails, in every way
// the list can be written. An agent with no tools gets a warning. How every
// case drives the check, and the fixture they share, are in
// contract-fixture.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fresh, run, has, show, expect, once, familiarText, defaultFm, skill } from './contract-fixture.mjs';

const CANARY = 'zq-canary-3b9';
const NOT_WRITTEN = 'FAIL seal: refused; nothing written';
const CON = 'Version: 1.0.0\nTarget: claude\nExtra keys: tools\n\n# Contract\n\nWhat this familiar is for.\n';
const WILD = 'a wildcard must name one whole server, written mcp__<server>__*';
const SHAPE = 'an MCP tool must be written mcp__<server>__<tool>, or mcp__<server>__* for a whole server';
const COMMA = 'a quoted item holding a comma; write each tool as its own item';
const BLOCK = 'write tools as a flow list or on one line';
const MISSING = 'WARN tools-missing: no tools listed, so the agent may get every tool';
const INDICATOR = 'a value starting with a flow, anchor, alias, tag, block or other indicator character';
const grant = n => `WARN danger: tools item ${n} at line 4 grants every current and future tool of one server, write tools included`;
const item = (n, why) => `FAIL tools-item: item ${n} at line 4: ${why}`;

/** Write x.md holding `tools: <value>` at line 4, and its contract. */
function agent(value, { contract = CON, extra = [] } = {}) {
  const dir = fresh();
  const file = join(dir, 'x.md');
  const fm = value === null ? [...defaultFm('x'), ...extra] : [...defaultFm('x'), `tools: ${value}`, ...extra];
  writeFileSync(file, familiarText(fm));
  if (contract !== undefined) writeFileSync(join(dir, 'x.contract.md'), contract);
  return file;
}

/** The exit code, and each line printed exactly as given. */
function exact(r, code, ...lines) {
  expect(r, code);
  for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
}

/** Seal, check, seal again: both exit 0, the second seal changes no byte. Returns the check's run. */
function sealTwice(file) {
  expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
  const sealed = readFileSync(file);
  const r = run([file]);
  exact(r, 0, 'PASS familiar-digest', 'PASS contract-digest');
  expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
  assert.deepEqual(readFileSync(file), sealed, 'a second seal changed the file');
  return r;
}

/** The check fails with these lines, and the seal refuses and writes nothing. */
function refused(file, ...lines) {
  const r = run([file]);
  exact(r, 1, ...lines);
  assert.ok(!has(r, 'CANNOT-CHECK'), show(r));
  const before = readFileSync(file);
  exact(run(['--seal', file]), 2, ...lines, NOT_WRITTEN);
  assert.deepEqual(readFileSync(file), before);
}

// ------------------------------------------------------------------ accepted

describe('an accepted wildcard passes, warns once per item, and seals', () => {
  for (const [label, value, n] of [
    ['flow list', '[Read, ToolSearch, mcp__Claude_Browser__*]', 3],
    ['flow list, double-quoted item', '[Read, "mcp__Claude_Browser__*"]', 2],
    ['flow list, single-quoted item', "[Read, 'mcp__Claude_Browser__*']", 2],
    ['one line', 'Read, mcp__Claude_Browser__*', 2],
    ['one line, quoted whole', '"Read, mcp__Claude_Browser__*"', 2],
    ['one line, alone', 'mcp__a-b_c9__*', 1],
  ]) {
    test(`${label}: ${value} -> 0 with one grant warning, sealed and resealed to the same bytes`, () => {
      const r = sealTwice(agent(value));
      exact(r, 0, 'PASS keys', grant(n));
      once(r, grant(n));
      assert.ok(!r.out.includes('Claude_Browser'), `the server name was echoed\n${show(r)}`);
    });
  }

  test('two wildcards -> two warnings, one per item', () => {
    const r = sealTwice(agent('[mcp__a__*, Read, mcp__b__*]'));
    exact(r, 0, grant(1), grant(3));
    once(r, grant(1));
    once(r, grant(3));
  });

  test('one named MCP tool -> 0 and no grant warning', () => {
    const r = sealTwice(agent('[Read, mcp__srv__get_page]'));
    assert.ok(!has(r, 'WARN danger: tools'), show(r));
    assert.ok(!has(r, 'FAIL'), show(r));
  });

  test('plain tool names pass as today', () => {
    const r = sealTwice(agent('[Read, Glob, Grep, view_file, run-command]'));
    assert.ok(!has(r, 'WARN'), show(r));
  });
});

// ------------------------------------------------------------------ refused

describe('a refused item fails with rule tools-item, in the flow form and the one-line form', () => {
  for (const [value, why] of [
    ['*', WILD],
    ['*alias', WILD],
    ['mcp__*', WILD],
    ['mcp____*', WILD],
    ['mcp__s__get_*', WILD],
    ['mcp__s__*x', WILD],
    ['mcp__s*__x', WILD],
    ['mcp__s__x__*', WILD],
    ['mcp___s__*', WILD],
    ['mcp__s___*', WILD],
    ['MCP__s__*', WILD],
    ['Mcp__s__*', WILD],
    ['mcp_s_*', WILD],
    ['mcp__srv', WILD],
    ['mcp__Claude_Browser', WILD],
    ['mcp__s__', SHAPE],
    ['MCP__s__x', SHAPE],
    ['mcp__s.x__y', SHAPE],
    ['mcp___s__x', SHAPE],
    ['mcpfoo', SHAPE],
  ]) {
    test(`[Read, ${value}] -> 1, item 2`, () => refused(agent(`[Read, ${value}]`), item(2, why)));
    test(`Read, ${value} on one line -> 1, item 2`, () => refused(agent(`Read, ${value}`), item(2, why)));
  }

  test('a bare * as the whole one-line value -> 1, item 1', () => refused(agent('*'), item(1, WILD)));
  test('*, Read on one line -> 1, item 1', () => refused(agent('*, Read'), item(1, WILD)));
  test('a quoted "*" -> 1, item 1', () => refused(agent('"*"'), item(1, WILD)));
  test('[Read, "*"] -> 1, item 2', () => refused(agent('[Read, "*"]'), item(2, WILD)));

  test('a quoted flow item holding a comma -> 1', () => refused(agent('[Read, "mcp__s__*, Write"]'), item(2, COMMA)));
  test('a quoted flow item holding a comma and no wildcard -> 1', () => refused(agent("['Read, Write']"), item(1, COMMA)));

  for (const header of ['>', '|', '>-', '|-']) {
    test(`a ${header} block on tools -> 1`, () => {
      const file = agent(header, { extra: ['  Read'] });
      refused(file, `FAIL tools-item: line 4: ${BLOCK}`);
    });
  }

  test('a refused item never echoes the item', () => {
    const r = run([agent(`[Read, mcp__${CANARY}]`)]);
    exact(r, 1, item(2, WILD));
    assert.ok(!r.out.includes(CANARY) && !r.err.includes(CANARY), show(r));
  });

  test('two refused items -> two failures', () => {
    refused(agent('[*, Read, mcp__srv]'), item(1, WILD), item(3, WILD));
  });

  test('a refused item beside an unlisted tools key still fails with tools-item', () => {
    const file = agent('Read, mcp__srv', { contract: 'Version: 1.0.0\nTarget: claude\n\n# Contract\n' });
    exact(run([file]), 1, 'FAIL keys: unknown key "tools" at line 4', item(2, WILD));
  });
});

// ------------------------------------------------------------------ unchanged elsewhere

describe('everywhere else the flow rule is unchanged', () => {
  test('tools: [mcp__s__*] with tools not listed -> 1 cannot-check, as today', () => {
    const r = run([agent('[mcp__s__*]', { contract: 'Version: 1.0.0\nTarget: claude\n\n# Contract\n' })]);
    exact(r, 1, `CANNOT-CHECK frontmatter: x.md line 4: ${INDICATOR}`);
  });

  test('a skill with tools listed and [mcp__s__*] -> 1 cannot-check, as today', () => {
    const dir = skill({ fm: [...defaultFm('demo'), 'tools: [mcp__s__*]'], contract: 'Version: 1.0.0\nExtra keys: tools\n\n# Contract\n' });
    const r = run([dir]);
    expect(r, 1);
    assert.ok(has(r, 'CANNOT-CHECK frontmatter: SKILL.md line 4: a flow sequence item that is not a plain word'), show(r));
    assert.ok(!has(r, 'FAIL tools-item'), show(r));
  });

  test('a skill with tools listed on one line holding mcp__srv -> no tools-item line', () => {
    const dir = skill({ fm: [...defaultFm('demo'), 'tools: Read, mcp__srv'], contract: 'Version: 1.0.0\nExtra keys: tools\n\n# Contract\n' });
    assert.ok(!has(run([dir]), 'FAIL tools-item'));
  });

  test('allowed-tools: [mcp__s__*] listed in an agent -> 1 cannot-check, as today', () => {
    const file = agent('[Read]', { contract: 'Version: 1.0.0\nTarget: claude\nExtra keys: tools, allowed-tools\n\n# Contract\n', extra: ['allowed-tools: [mcp__s__*]'] });
    const r = run([file]);
    expect(r, 1);
    assert.ok(has(r, 'CANNOT-CHECK frontmatter: x.md line 5: a flow sequence item that is not a plain word'), show(r));
  });

  test('a metadata entry holding a * is unchanged: one-line text under metadata, no tools-item line', () => {
    const r = sealTwice(agent('[Read]', { extra: ['metadata:', '  note: mcp__s__*'] }));
    assert.ok(!has(r, 'FAIL tools-item') && !has(r, 'WARN danger'), show(r));
  });
});

// ------------------------------------------------------------------ the 0.8.1 break

describe('a file sealed under 0.8.1 with a bare server entry now fails', () => {
  const sha = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

  test('its seal still matches, and the item fails with the rewrite reason', () => {
    const dir = fresh();
    const file = join(dir, 'x.md');
    const fm = [...defaultFm('x'), 'tools: [Read, mcp__srv]'];
    const unsealed = familiarText(fm);
    // The mark the 0.8.1 seal wrote: the digest of the file before the mark,
    // and of the contract, under metadata: just before the closing ---.
    const sealed = familiarText([
      ...fm,
      'metadata:',
      '  contract-version: 1.0.0',
      `  familiar-digest: "${sha(unsealed)}"`,
      `  contract-digest: "${sha(CON)}"`,
    ]);
    writeFileSync(file, sealed);
    writeFileSync(join(dir, 'x.contract.md'), CON);
    const r = run([file]);
    exact(r, 1, 'PASS familiar-digest', 'PASS contract-digest', item(2, WILD));
  });
});

// ------------------------------------------------------------------ tools-missing

describe('tools-missing: an agent .md with no tools warns, and still seals', () => {
  for (const [label, value] of [
    ['no tools key', null],
    ['an empty flow list', '[]'],
    ['an empty flow list with a space', '[ ]'],
    ['an empty quoted value', '""'],
    ['a blank quoted value', '"  "'],
    ["an empty single-quoted value", "''"],
  ]) {
    test(`${label} -> 0 with the warning once, sealed`, () => {
      const r = sealTwice(agent(value));
      exact(r, 0, MISSING);
      once(r, MISSING);
    });
  }

  test('a bare tools: with nothing after it -> 0 with the warning once, sealed', () => {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText([...defaultFm('x'), 'tools:']));
    writeFileSync(join(dir, 'x.contract.md'), CON);
    const r = sealTwice(file);
    exact(r, 0, MISSING);
    once(r, MISSING);
  });

  test('a bare tools: followed by an indented list -> 1 cannot-check, as today', () => {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText([...defaultFm('x'), 'tools:', '  - Read']));
    writeFileSync(join(dir, 'x.contract.md'), CON);
    expect(run([file]), 1, 'CANNOT-CHECK frontmatter: x.md line 5');
  });

  test('a bare key other than tools is still cannot-check', () => {
    const file = join(fresh(), 'x.md');
    writeFileSync(file, familiarText([...defaultFm('x'), 'model:']));
    expect(run([file]), 1, 'CANNOT-CHECK frontmatter: x.md line 4: key "model" has no value on its line');
  });

  test('a listed tool -> no warning', () => {
    assert.ok(!has(sealTwice(agent('[Read]')), 'WARN tools-missing'));
  });

  test('a skill with no tools -> no warning', () => {
    assert.ok(!has(run([skill()]), 'WARN tools-missing'));
  });

  test('a Codex .toml agent -> no warning', () => {
    const file = join(fresh(), 'cx.toml');
    writeFileSync(file, 'name = "cx"\ndescription = "A test Codex agent."\ndeveloper_instructions = "Review."\n');
    assert.ok(!has(run([file]), 'WARN tools-missing'));
  });

  test('a CLAUDE.md -> no warning', () => {
    const file = join(fresh(), 'CLAUDE.md');
    writeFileSync(file, '# Rules\n');
    assert.ok(!has(run([file]), 'WARN tools-missing'));
  });
});
