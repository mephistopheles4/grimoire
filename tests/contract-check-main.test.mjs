// Tests of skills/contract/scripts/check.mjs: the main agent file, CLAUDE.md,
// and the contract's Kind line. How every case drives the check, and the
// fixture they share, are in contract-fixture.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fresh, run, has, show, expect, once, CONTRACT, familiarText, defaultFm, skill } from './contract-fixture.mjs';

const CANARY = 'zq-canary-7e2';
const NOT_WRITTEN = 'FAIL seal: refused; nothing written';
const BODY = '# Project rules\n\nRun the tests before every commit.\n';
const MAIN_CON = 'Version: 1.0.0\nTarget: claude\nKind: main agent file\n\n# Contract\n\nWhat this familiar is for.\n';
const conWith = (...head) => `Version: 1.0.0\n${head.join('\n')}\n\n# Contract\n\nWhat this familiar is for.\n`;

/** Write <dir>/<name> (CLAUDE.md by default) and, when given, CLAUDE.contract.md beside it. */
function main({ text = BODY, contract, name = 'CLAUDE.md', contractName = 'CLAUDE.contract.md' } = {}) {
  const dir = fresh();
  const file = join(dir, name);
  writeFileSync(file, text);
  if (contract !== undefined) writeFileSync(join(dir, contractName), contract);
  return { dir, file };
}

/** The exit code, and each line printed exactly as given. */
function exact(r, code, ...lines) {
  expect(r, code);
  for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
}

/** No line for the rule at all. */
function none(r, rule) {
  assert.ok(!r.lines.some(l => l.split(':')[0].endsWith(` ${rule}`)), `a ${rule} line\n${show(r)}`);
}

/** Seal, check, seal again: the second seal changes no byte. Returns the sealed text. */
function sealTwice(file) {
  const s = run(['--seal', file]);
  expect(s, 0, 'PASS seal: wrote ');
  const sealed = readFileSync(file, 'utf8');
  exact(run([file]), 0, 'PASS familiar-digest', 'PASS contract-digest', 'PASS contract-version');
  expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
  assert.equal(readFileSync(file, 'utf8'), sealed, 'a second seal changed the file');
  return sealed;
}

function sha(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** The text the digest covers before a first seal: LF endings, one final LF. */
function canonical(text) {
  return `${text.replaceAll('\r\n', '\n').replace(/\n+$/, '')}\n`;
}

// ------------------------------------------------------------------ detection

describe('a CLAUDE.md is found by listing its folder', () => {
  test('CLAUDE.md with no frontmatter and no contract -> 0, not built from a contract, and no name or description failure', () => {
    const r = run([main().file]);
    exact(r, 0, 'PASS frontmatter', 'PASS contract: not built from a contract');
    none(r, 'name');
    none(r, 'description');
  });

  for (const variant of ['claude.md', 'Claude.md']) {
    test(`a folder holding only ${variant}, typed as found -> 1, file must be named CLAUDE.md`, () => {
      const { file } = main({ name: variant });
      exact(run([file]), 1, `FAIL familiar-file: file must be named CLAUDE.md (found "${variant}")`);
    });
    test(`a folder holding only ${variant}, typed as CLAUDE.md -> the same failure on every disk`, () => {
      const { dir } = main({ name: variant });
      exact(run([join(dir, 'CLAUDE.md')]), 1, `FAIL familiar-file: file must be named CLAUDE.md (found "${variant}")`);
    });
  }

  test('a folder holding only claude.md under --seal -> 2, and nothing written', () => {
    const { file } = main({ name: 'claude.md', contract: MAIN_CON });
    const before = readFileSync(file);
    exact(run(['--seal', file]), 2, 'FAIL familiar-file: file must be named CLAUDE.md (found "claude.md")', NOT_WRITTEN);
    assert.deepEqual(readFileSync(file), before);
  });

  test('a typed CLAUDE.md that is not there, with no case variant beside it -> 2, the path refusal', () => {
    exact(run([join(fresh(), 'CLAUDE.md')]), 2, 'FAIL path: the path does not exist or cannot be read');
  });

  test('CLAUDE.contract.md given as the path -> 2, give the familiar', () => {
    const { dir } = main({ contract: MAIN_CON });
    exact(run([join(dir, 'CLAUDE.contract.md')]), 2, "FAIL path: give the familiar's file, not its contract");
  });

  test('a contract named claude.contract.md beside CLAUDE.md -> 1, contract-file', () => {
    const { file } = main({ contract: MAIN_CON, contractName: 'claude.contract.md' });
    exact(run([file]), 1, 'FAIL contract-file: file must be named "CLAUDE.contract.md" (found "claude.contract.md")');
  });
});

// ------------------------------------------------------------------ frontmatter

describe('the frontmatter of a CLAUDE.md', () => {
  for (const key of ['name', 'description', 'tools']) {
    const want = `FAIL keys: "${key}" at line 2: a main agent file must not hold it; with it, the file loads as a sub-agent from an agents folder`;
    test(`${key} -> 1, and the value never echoed`, () => {
      const r = run([main({ text: familiarText([`${key}: ${CANARY}`], BODY) }).file]);
      exact(r, 1, want);
      assert.ok(!r.out.includes(CANARY) && !r.err.includes(CANARY), show(r));
    });
    test(`${key} under --seal -> 2, and nothing written`, () => {
      const { file } = main({ text: familiarText([`${key}: ${CANARY}`], BODY), contract: MAIN_CON });
      const before = readFileSync(file);
      const r = run(['--seal', file]);
      exact(r, 2, want, NOT_WRITTEN);
      assert.ok(!r.out.includes(CANARY) && !r.err.includes(CANARY), show(r));
      assert.deepEqual(readFileSync(file), before);
    });
  }

  test('any other key -> 0 with a warning naming the key and its line, never its value, once', () => {
    const r = run([main({ text: familiarText([`zq_other: ${CANARY}`], BODY) }).file]);
    const want = 'WARN ignored-key: zq_other at line 2: Claude Code ignores it when the file loads as CLAUDE.md';
    exact(r, 0, 'PASS keys', want);
    once(r, want);
    assert.ok(!r.out.includes(CANARY) && !r.err.includes(CANARY), show(r));
  });

  test('an other key needs no Extra keys line, and seals', () => {
    const { file } = main({ text: familiarText(['zq_other: x'], BODY), contract: MAIN_CON });
    sealTwice(file);
  });

  test('the .md danger rows still apply: allowed-tools -> 0 with its danger line and the ignored-key line', () => {
    const r = run([main({ text: familiarText(['allowed-tools: Read'], BODY) }).file]);
    exact(
      r,
      0,
      'WARN danger: allowed-tools at line 2 may let the agent use tools without asking',
      'WARN ignored-key: allowed-tools at line 2: Claude Code ignores it when the file loads as CLAUDE.md',
    );
  });

  test('metadata that is not a map -> 1, as today', () => {
    exact(run([main({ text: familiarText(['metadata: x'], BODY) }).file]), 1, 'FAIL metadata: line 2: must be a map of text values');
  });

  test('a frontmatter block not at the very top is body text, not frontmatter', () => {
    const r = run([main({ text: `\n---\nname: x\n---\n${BODY}` }).file]);
    exact(r, 0, 'PASS keys');
    assert.ok(!has(r, 'FAIL keys'), show(r));
  });

  test('a byte-order mark -> 1 cannot-check', () => {
    exact(run([main({ text: `\u{FEFF}${BODY}` }).file]), 1, 'CANNOT-CHECK frontmatter: CLAUDE.md line 1: a byte-order mark (a CLAUDE.md file must not start with one)');
  });

  test('a byte-order mark under --seal -> 2, and nothing written', () => {
    const { file } = main({ text: `\u{FEFF}${BODY}`, contract: MAIN_CON });
    const before = readFileSync(file);
    expect(run(['--seal', file]), 2, NOT_WRITTEN);
    assert.deepEqual(readFileSync(file), before);
  });

  describe('a mark line outside the top block', () => {
    const DECOY = 'a line outside the top frontmatter block that reads as a mark key; the mark goes only in the block at the very top';
    for (const line of ['contract-version: 1.0.0', '  familiar-digest: "sha256:00"', 'Contract-Digest : x']) {
      test(`"${line}" in the body -> 1 cannot-check`, () => {
        exact(run([main({ text: `${BODY}\n${line}\n` }).file]), 1, `CANNOT-CHECK frontmatter: CLAUDE.md line 5: ${DECOY}`);
      });
    }
    test('a later block holding a mark -> 1 cannot-check at the mark line', () => {
      const text = `${BODY}\n---\nmetadata:\n  contract-version: 1.0.0\n---\n`;
      exact(run([main({ text }).file]), 1, `CANNOT-CHECK frontmatter: CLAUDE.md line 7: ${DECOY}`);
    });
    test('prose that mentions a mark key -> 0', () => {
      expect(run([main({ text: `${BODY}\nThe contract-version key holds the version.\n` }).file]), 0);
    });
  });
});

// ------------------------------------------------------------------ imports

describe('an @ import in the body warns once per line, never with its path', () => {
  const want = n => `WARN import: line ${n} loads instructions from a file the seal does not cover`;
  for (const [label, line] of [
    ['at the start of a line', `@docs/${CANARY}.md`],
    ['mid-sentence', `See @docs/${CANARY}.md for more.`],
    ['in a list item', `- @docs/${CANARY}.md`],
    ['in a numbered list item', `1. @docs/${CANARY}.md`],
    ['after a list marker with no space', `-@docs/${CANARY}.md`],
    ['after a tab', `Read\t@docs/${CANARY}.md`],
    ['after a no-break space', `Read\u{A0}@docs/${CANARY}.md`],
    ['twice on one line', `@a/${CANARY}.md and @b/${CANARY}.md`],
  ]) {
    test(`${label} -> 0 with one warning`, () => {
      const r = run([main({ text: `${BODY}${line}\n` }).file]);
      exact(r, 0, want(4));
      once(r, want(4));
      assert.ok(!r.out.includes(CANARY) && !r.err.includes(CANARY), show(r));
    });
  }
  test('an email address -> no warning', () => {
    none(run([main({ text: `${BODY}Mail a@b.example.\n` }).file]), 'import');
  });
  test('an @ inside the frontmatter -> no warning', () => {
    none(run([main({ text: familiarText(['zq_other: see @x'], BODY) }).file]), 'import');
  });
  test('two import lines -> two warnings', () => {
    const r = run([main({ text: `${BODY}@a.md\n@b.md\n` }).file]);
    exact(r, 0, want(4), want(5));
  });
  test('an agent .md with an @ line -> no import warning', () => {
    const file = join(fresh(), 'x.md');
    writeFileSync(file, familiarText(defaultFm('x'), '@docs/a.md\n'));
    none(run([file]), 'import');
  });
});

// ------------------------------------------------------------------ the contract

describe('the contract beside a CLAUDE.md', () => {
  test('Target claude and Kind main agent file -> sealed, then checked', () => {
    const { file } = main({ contract: MAIN_CON });
    sealTwice(file);
    exact(run([file]), 0, 'PASS target: claude', 'PASS kind: main agent file');
  });

  for (const [label, contract, want] of [
    ['no Target line', conWith('Kind: main agent file'), 'FAIL target: a main agent file\'s contract must name claude on its "Target:" line'],
    ['Target codex', conWith('Target: codex', 'Kind: main agent file'), 'FAIL target: a main agent file\'s contract must name claude on its "Target:" line'],
    ['Target antigravity', conWith('Target: antigravity', 'Kind: main agent file'), 'FAIL target: a main agent file\'s contract must name claude on its "Target:" line'],
    ['no Kind line', conWith('Target: claude'), 'FAIL kind: a main agent file\'s contract must say "Kind: main agent file"'],
    ['Kind agent', conWith('Target: claude', 'Kind: agent'), 'FAIL kind: a main agent file\'s contract must say "Kind: main agent file"'],
  ]) {
    test(`${label} -> 1`, () => {
      exact(run([main({ contract }).file]), 1, want);
    });
    test(`${label} under --seal -> 2, and nothing written`, () => {
      const { file } = main({ contract });
      const before = readFileSync(file);
      exact(run(['--seal', file]), 2, want, NOT_WRITTEN);
      assert.deepEqual(readFileSync(file), before);
    });
  }
});

describe('a contract that opens with a frontmatter block', () => {
  const want = label => `FAIL contract-frontmatter: ${label} starts with a "---" line; a contract holds no frontmatter`;
  const framed = `---\nname: x\ndescription: ${CANARY}\n---\n${conWith('Target: claude', 'Kind: agent')}`;

  /** An agent .md file and the given contract beside it. */
  function agentWith(contract) {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText(defaultFm('x')));
    writeFileSync(join(dir, 'x.contract.md'), contract);
    return file;
  }

  test('beside an agent -> 1, and the seal refuses, never echoing its values', () => {
    const file = agentWith(framed);
    const before = readFileSync(file);
    const s = run(['--seal', file]);
    exact(s, 2, want('x.contract.md'), NOT_WRITTEN);
    assert.deepEqual(readFileSync(file), before);
    const r = run([file]);
    exact(r, 1, want('x.contract.md'));
    for (const out of [r.out, r.err, s.out, s.err]) assert.ok(!out.includes(CANARY), `${show(r)}\n${show(s)}`);
  });
  for (const [label, opener] of [['a trailing space', '--- '], ['a trailing tab', '---\t']]) {
    test(`an opener with ${label} -> 1, and the seal refuses`, () => {
      const file = agentWith(framed.replace(/^---\n/, `${opener}\n`));
      exact(run([file]), 1, want('x.contract.md'));
      exact(run(['--seal', file]), 2, want('x.contract.md'), NOT_WRITTEN);
    });
  }
  test('beside a CLAUDE.md -> 1', () => {
    exact(run([main({ contract: `---\n---\n${MAIN_CON}` }).file]), 1, want('CLAUDE.contract.md'));
  });
  test('a "---" line later in the contract -> no failure', () => {
    const file = agentWith(`${conWith('Target: claude')}\n---\n`);
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    none(run([file]), 'contract-frontmatter');
  });
});

describe('the Kind line', () => {
  const TWO = 'FAIL kind: the contract has more than one "Kind:" line';
  const UNKNOWN = 'FAIL kind: the "Kind:" line must say skill, agent or main agent file';
  const MISMATCH = kind => `FAIL kind: the contract's "Kind:" line does not match the familiar, which is ${kind}`;

  /** An agent .md file and its contract, which names claude. */
  function agent(...head) {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText(defaultFm('x')));
    writeFileSync(join(dir, 'x.contract.md'), conWith('Target: claude', ...head));
    return file;
  }

  test('an agent contract with no Kind line -> seals, and no kind line', () => {
    const file = agent();
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    none(run([file]), 'kind');
  });
  test('a skill contract with no Kind line -> seals, and no kind line', () => {
    const dir = skill({ contract: CONTRACT });
    expect(run(['--seal', dir]), 0, 'PASS seal: wrote ');
    none(run([dir]), 'kind');
  });
  test('Kind agent beside an agent -> PASS kind', () => {
    const file = agent('Kind: agent');
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    exact(run([file]), 0, 'PASS kind: agent');
  });
  test('Kind skill beside a skill -> PASS kind', () => {
    const dir = skill({ contract: conWith('Kind: skill') });
    expect(run(['--seal', dir]), 0, 'PASS seal: wrote ');
    exact(run([dir]), 0, 'PASS kind: skill');
  });
  test('Kind agent beside a Codex .toml agent -> PASS kind', () => {
    const dir = fresh();
    const file = join(dir, 'cx.toml');
    writeFileSync(file, 'name = "cx"\ndescription = "A test Codex agent."\ndeveloper_instructions = "Review."\n');
    writeFileSync(join(dir, 'cx.contract.md'), conWith('Target: codex', 'Kind: agent'));
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    exact(run([file]), 0, 'PASS kind: agent');
  });

  for (const [label, head, want] of [
    ['Kind main agent file beside an agent .md', ['Kind: main agent file'], MISMATCH('an agent')],
    ['Kind skill beside an agent', ['Kind: skill'], MISMATCH('an agent')],
    ['two Kind lines', ['Kind: agent', 'Kind: agent'], TWO],
    ['an unknown value', [`Kind: ${CANARY}`], UNKNOWN],
    ['an empty value', ['Kind:'], UNKNOWN],
    ['a double-spaced second line', ['Kind: agent', 'Kind:  agent'], TWO],
  ]) {
    test(`${label} -> 1, and the seal refuses`, () => {
      const file = agent(...head);
      const before = readFileSync(file);
      const s = run(['--seal', file]);
      exact(s, 2, want, NOT_WRITTEN);
      assert.deepEqual(readFileSync(file), before);
      const r = run([file]);
      exact(r, 1, want);
      for (const out of [r.out, r.err, s.out, s.err]) assert.ok(!out.includes(CANARY), `${show(r)}\n${show(s)}`);
    });
  }

  test('a no-space line is read: Kind:agent beside an agent -> PASS kind', () => {
    const file = agent('Kind:agent');
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    exact(run([file]), 0, 'PASS kind: agent');
  });
  test('a no-space second line is seen: Kind: agent then Kind:agent -> 1', () => {
    exact(run([agent('Kind: agent', 'Kind:agent')]), 1, TWO);
  });
  test('Kind agent beside a skill -> 1', () => {
    exact(run([skill({ contract: conWith('Kind: agent') })]), 1, MISMATCH('a skill'));
  });
});

// ------------------------------------------------------------------ the seal

describe('sealing a CLAUDE.md', () => {
  /** The text a CLAUDE.md with no frontmatter is digested as: one that starts with an empty block. */
  function noBlock(text) {
    return canonical(`---\n---\n${text}`);
  }

  /** The mark block the seal writes at the very top of a file with no frontmatter. */
  function topBlock(text, eol = '\n') {
    const famDigest = sha(noBlock(text));
    const conDigest = sha(canonical(MAIN_CON));
    return [
      '---',
      'metadata:',
      '  contract-version: 1.0.0',
      `  familiar-digest: "${famDigest}"`,
      `  contract-digest: "${conDigest}"`,
      '---',
    ].join(eol) + eol;
  }

  for (const [label, text, eol] of [
    ['LF line endings', BODY, '\n'],
    ['CRLF line endings', BODY.replaceAll('\n', '\r\n'), '\r\n'],
    ['no final line ending', BODY.slice(0, -1), '\n'],
    ['an empty file', '', '\n'],
    ['a first line of --- with no closing line', `---\n${BODY}`, '\n'],
  ]) {
    test(`no frontmatter, ${label}: the seal adds a block at the top, the digest equals the file's before the seal, and a reseal changes no byte`, () => {
      const { file } = main({ text, contract: MAIN_CON });
      const sealed = sealTwice(file);
      assert.equal(sealed, topBlock(text, eol) + text);
    });
  }

  test('a block holding another key: the seal writes the mark into it, and a reseal changes no byte', () => {
    const text = familiarText(['zq_other: x'], BODY);
    const { file } = main({ text, contract: MAIN_CON });
    const sealed = sealTwice(file);
    assert.ok(sealed.startsWith('---\nzq_other: x\nmetadata:\n  contract-version: 1.0.0\n'), sealed);
    assert.ok(sealed.includes(`  familiar-digest: "${sha(canonical(text))}"`), sealed);
  });

  test('an empty block before the seal: its digest is the same as the body with no block', () => {
    const { file } = main({ text: `---\n---\n${BODY}`, contract: MAIN_CON });
    const sealed = sealTwice(file);
    assert.ok(sealed.includes(`  familiar-digest: "${sha(noBlock(BODY))}"`), sealed);
  });

  test('a line moved out of the top block into a second block below it breaks the seal', () => {
    const { file } = main({ text: familiarText(['# note'], BODY), contract: MAIN_CON });
    sealTwice(file);
    const lines = readFileSync(file, 'utf8').split('\n');
    const note = lines.indexOf('# note');
    lines.splice(note, 1);
    const close = lines.indexOf('---', 1);
    lines.splice(close + 1, 0, '---', '# note', '---');
    writeFileSync(file, lines.join('\n'));
    expect(run([file]), 1, 'FAIL familiar-digest: ');
  });

  for (const [label, line] of [
    ['a comment line', '# note'],
    ['a blank line', ''],
  ]) {
    test(`${label} added inside a sealed block breaks the seal`, () => {
      const { file } = main({ contract: MAIN_CON });
      sealTwice(file);
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.splice(1, 0, line);
      writeFileSync(file, lines.join('\n'));
      exact(run([file]), 1, 'FAIL familiar-digest: line 5: the seal is broken; CLAUDE.md changed since it was sealed');
    });
  }

  test('an edit to the body breaks the seal', () => {
    const { file } = main({ contract: MAIN_CON });
    sealTwice(file);
    writeFileSync(file, `${readFileSync(file, 'utf8')}One more rule.\n`);
    exact(run([file]), 1, 'FAIL familiar-digest: line 4: the seal is broken; CLAUDE.md changed since it was sealed');
  });

  test('a sealed file with its contract removed -> 1, marked but its contract is missing', () => {
    const { dir, file } = main({ contract: MAIN_CON });
    sealTwice(file);
    unlinkSync(join(dir, 'CLAUDE.contract.md'));
    exact(run([file]), 1, 'FAIL contract: marked, but its contract is missing');
  });

  test('a contract present beside an unsealed CLAUDE.md -> 1, not sealed', () => {
    exact(run([main({ contract: MAIN_CON }).file]), 1, 'FAIL contract: contract present, but the file is not sealed');
  });
});

// ------------------------------------------------------------------ the modes

// No command line reaches an unknown mode, so this one test reads the check's
// source: every comparison on a mode goes through isMode, which throws on a
// mode it does not know. A raw comparison would read a new mode as another.
test('every mode comparison in the check goes through isMode', () => {
  const source = readFileSync(new URL('../skills/contract/scripts/check.mjs', import.meta.url), 'utf8');
  const raw = source.split('\n').map(l => l.trim()).filter(l => /\.mode\s*[!=]==|[!=]==\s*[\w.]*\.mode\b/.test(l));
  assert.deepEqual(raw, ['return loc.mode === mode;']);
});
