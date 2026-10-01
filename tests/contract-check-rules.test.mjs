// Tests of skills/contract/scripts/check.mjs: the character rule, extra keys,
// warnings, YAML forms and folder rules. How every case drives the check, and
// the fixture they share, are in contract-fixture.mjs.

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fresh, run, has, show, expect, once, SANDBOX_DANGER, CONTRACT, BROKEN, familiarText, defaultFm, skill, sealAndCheck, editFile, put, tryPut } from './contract-fixture.mjs';

// ------------------------------------------------------------------ v10 the character rule

// Line and paragraph separators, NEL, every C0 control but tab, DEL, every C1
// control, U+FFFE, U+FFFF and a lone CR are cannot-check in every text file
// the check reads. Each case asserts its whole reason line, and that the
// character itself never reaches the output.
describe('v10 the character rule refuses separators and control characters', () => {
  const TCLAUDE = 'Version: 1.0.0\nTarget: claude\n\n# Contract\n\nWhat this familiar is for.\n';
  const TCODEX = 'Version: 1.0.0\nTarget: codex\n\n# Contract\n\nWhat this familiar is for.\n';
  const CODEX = ['name = "cx"', 'description = "A test Codex agent."', 'developer_instructions = """', 'You review code.', '"""'];
  const LONE_CR = 'a carriage return with no line feed after it';
  const TOML_SEP = u => `a line or paragraph separator, a C1 control character or a noncharacter (${u})`;
  const holds = (label, line, what) => `CANNOT-CHECK characters: ${label} line ${line} holds ${what}`;
  const NOT_WRITTEN = 'FAIL seal: refused; nothing written';

  /** Write <stem>.md, an agent in YAML frontmatter, and its contract. */
  function agent({ fm, body, text, stem = 'x', contract } = {}) {
    const dir = fresh();
    const file = join(dir, `${stem}.md`);
    writeFileSync(file, text ?? familiarText(fm ?? defaultFm(stem), body));
    if (contract !== undefined) writeFileSync(join(dir, `${stem}.contract.md`), contract);
    return { dir, file };
  }

  /** Write <stem>.toml, a Codex agent, and its contract. */
  function codex({ lines = CODEX, stem = 'cx', contract } = {}) {
    const dir = fresh();
    const file = join(dir, `${stem}.toml`);
    writeFileSync(file, `${lines.join('\n')}\n`);
    if (contract !== undefined) writeFileSync(join(dir, `${stem}.contract.md`), contract);
    return { dir, file };
  }

  /** The exit code, each line printed exactly as given, and the character kept out of the output. */
  function refused(r, code, ch, ...lines) {
    expect(r, code);
    for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
    if (ch) assert.ok(!r.out.includes(ch), `the refused character reached the output\n${show(r)}`);
  }

  /** An agent with `description: A B`, sealed against a claude contract. */
  function sealedAgent() {
    const a = agent({ fm: ['name: x', 'description: A B'], contract: TCLAUDE });
    expect(run(['--seal', a.file]), 0, 'PASS seal: wrote ');
    return a;
  }

  describe('a) a plain value of an agent .md', () => {
    const SHOWN = ['PASS frontmatter', 'PASS keys', 'PASS name', 'PASS description', 'PASS target', 'PASS contract', 'PASS familiar-digest', 'PASS contract-digest'];
    test('control: a space in the value, sealed -> 0, with every PASS line', () => {
      const { file } = sealedAgent();
      expect(run([file]), 0, ...SHOWN);
    });
    test('refuses U+2028 in the value -> 1, and prints no PASS or WARN line', () => {
      const { file } = sealedAgent();
      editFile(file, 'description: A B', 'description: A\u{2028}B');
      const r = run([file]);
      refused(r, 1, '\u{2028}', holds('x.md', 3, 'U+2028'));
      assert.deepEqual(r.lines.filter(l => l.startsWith('PASS ') || l.startsWith('WARN ')), [], show(r));
    });
  });

  test('b) refuses U+2028 in a metadata value -> 1', () => {
    const { file } = agent({ fm: [...defaultFm('x'), 'metadata:', '  owner: team\u{2028}x'] });
    refused(run([file]), 1, '\u{2028}', holds('x.md', 5, 'U+2028'));
  });

  test('c) refuses U+2028 inside a | block -> 1', () => {
    const { file } = agent({ fm: ['name: x', 'description: |', '  First\u{2028}line.', '  Second line.'] });
    refused(run([file]), 1, '\u{2028}', holds('x.md', 4, 'U+2028'));
  });

  describe('d) the other separators', () => {
    test('refuses U+2029 in frontmatter -> 1', () => {
      const { file } = agent({ fm: ['name: x', 'description: A\u{2029}B'] });
      refused(run([file]), 1, '\u{2029}', holds('x.md', 3, 'U+2029'));
    });
    test('refuses U+0085 in frontmatter -> 1', () => {
      const { file } = agent({ fm: ['name: x', 'description: A\u{85}B'] });
      refused(run([file]), 1, '\u{85}', holds('x.md', 3, 'U+0085'));
    });
  });

  test('e) refuses U+2028 in the body, after the closing --- -> 1', () => {
    const { file } = agent({ body: '# X\n\nBody\u{2028}text.\n' });
    refused(run([file]), 1, '\u{2028}', holds('x.md', 7, 'U+2028'));
  });

  test('f) refuses U+2028 in a SKILL.md, in skill mode -> 1', () => {
    const dir = skill({ fm: ['name: demo', 'description: A\u{2028}B'] });
    refused(run([dir]), 1, '\u{2028}', holds('SKILL.md', 3, 'U+2028'));
  });

  describe("g) refuses U+2028 on the contract lines the check reads", () => {
    const CON = ['Version: 1.0.0', 'Target: claude', 'Extra keys: model', '', '# Contract', '', 'What this familiar is for.'];
    const WITH_LS = ['Version: 1.0\u{2028}.0', 'Target: cla\u{2028}ude', 'Extra keys: mo\u{2028}del'];
    for (const [label, at] of [['Version:', 0], ['Target:', 1], ['Extra keys:', 2]]) {
      test(`inside the ${label} line -> 1`, () => {
        const lines = CON.map((l, i) => (i === at ? WITH_LS[at] : l));
        const { file } = agent({ contract: `${lines.join('\n')}\n` });
        refused(run([file]), 1, '\u{2028}', holds('x.contract.md', at + 1, 'U+2028'));
      });
    }
  });

  describe('h) refuses C0 controls, DEL and a lone CR in every file it reads', () => {
    const cases = [
      ['NUL', '\u{0}', 'U+0000'],
      ['ESC', '\u{1B}', 'U+001B'],
      ['backspace', '\u{8}', 'U+0008'],
      ['VT', '\u{B}', 'U+000B'],
      ['FF', '\u{C}', 'U+000C'],
      ['DEL', '\u{7F}', 'U+007F'],
      ['a lone CR', '\r', LONE_CR],
    ];
    for (const [label, ch, what] of cases) {
      test(`${label} in an agent .md -> 1`, () => {
        const { file } = agent({ fm: ['name: x', `description: A${ch}B`] });
        refused(run([file]), 1, ch === '\r' ? null : ch, holds('x.md', 3, what));
      });
      test(`${label} in a SKILL.md -> 1`, () => {
        const dir = skill({ fm: ['name: demo', `description: A${ch}B`] });
        refused(run([dir]), 1, ch === '\r' ? null : ch, holds('SKILL.md', 3, what));
      });
      test(`${label} in a contract -> 1`, () => {
        const { file } = agent({ contract: `Version: 1.0.0\nTarget: claude\n\n# Contract\n\nA${ch}B\n` });
        refused(run([file]), 1, ch === '\r' ? null : ch, holds('x.contract.md', 6, what));
      });
    }
  });

  describe('i) refuses C1 controls and the two noncharacters YAML does not allow', () => {
    for (const [ch, what] of [['\u{80}', 'U+0080'], ['\u{9F}', 'U+009F'], ['\u{FFFE}', 'U+FFFE'], ['\u{FFFF}', 'U+FFFF']]) {
      test(`${what} in frontmatter -> 1`, () => {
        const { file } = agent({ fm: ['name: x', `description: A${ch}B`] });
        refused(run([file]), 1, ch, holds('x.md', 3, what));
      });
    }
  });

  describe("j) refuses them in every other text file in a skill's folder", () => {
    for (const [ch, what] of [['\u{2028}', 'U+2028'], ['\u{1B}', 'U+001B']]) {
      test(`${what} in references/x.md -> 1`, () => {
        const dir = skill();
        put(dir, 'references/x.md', `# Notes\n\nA${ch}B\n`);
        refused(run([dir]), 1, ch, `CANNOT-CHECK folder: "references/x.md" line 3 holds ${what}`);
      });
    }
  });

  test('k) refuses U+2028 in a .toml with its own reason -> 1', () => {
    const { file } = codex({ lines: ['name = "cx"', 'description = "A\u{2028}B"', ...CODEX.slice(2)] });
    const r = run([file]);
    refused(r, 1, '\u{2028}', `CANNOT-CHECK toml: cx.toml line 2: ${TOML_SEP('U+2028')}`);
    assert.ok(!r.out.includes('a control character other than tab'), show(r));
  });

  test('every line that holds one is reported, in the familiar and the contract', () => {
    const { file } = agent({
      fm: ['name: x', 'description: A\u{2028}B', 'metadata:', '  owner: team\u{1B}x'],
      contract: 'Version: 1.0.0\nTarget: claude\n\n# Contract\n\nA\u{85}B\n',
    });
    const r = run([file]);
    const want = [holds('x.md', 3, 'U+2028'), holds('x.md', 5, 'U+001B'), holds('x.contract.md', 6, 'U+0085')];
    refused(r, 1, null, ...want);
    assert.deepEqual(r.lines.filter(l => l.startsWith('CANNOT-CHECK characters: ')), want, show(r));
  });

  describe('at most 20 lines are reported, counted across the familiar and the contract', () => {
    // Twelve body lines of the familiar and `n` lines of the contract each hold one.
    const bodyLine = i => `Line ${i} A\u{2028}B`;
    function spread(n) {
      const body = `# X\n\n${Array.from({ length: 12 }, (_, i) => bodyLine(i + 1)).join('\n')}\n`;
      const contract = `Version: 1.0.0\nTarget: claude\n\n# Contract\n\n${Array.from({ length: n }, (_, i) => bodyLine(i + 1)).join('\n')}\n`;
      return agent({ body, contract });
    }
    const listed = r => r.lines.filter(l => l.startsWith('CANNOT-CHECK characters: '));
    test('exactly 20 -> 1, twenty lines and no summary', () => {
      const r = run([spread(8).file]);
      refused(r, 1, '\u{2028}', holds('x.md', 7, 'U+2028'), holds('x.contract.md', 13, 'U+2028'));
      assert.equal(listed(r).length, 20, show(r));
      assert.ok(!listed(r).some(l => l.includes(' more line')), show(r));
    });
    test('21 -> 1, twenty lines and a summary naming the one more', () => {
      const r = run([spread(9).file]);
      refused(r, 1, '\u{2028}', holds('x.contract.md', 13, 'U+2028'), 'CANNOT-CHECK characters: 1 more line holds a refused character');
      assert.equal(listed(r).length, 21, show(r));
      assert.ok(!r.lines.includes(holds('x.contract.md', 14, 'U+2028')), show(r));
      assert.equal(listed(r).at(-1), 'CANNOT-CHECK characters: 1 more line holds a refused character', show(r));
    });
    test('23 -> 1, twenty lines and a summary naming the three more', () => {
      const r = run([spread(11).file]);
      refused(r, 1, '\u{2028}', holds('x.contract.md', 13, 'U+2028'), 'CANNOT-CHECK characters: 3 more lines hold a refused character');
      assert.equal(listed(r).length, 21, show(r));
      assert.equal(listed(r).at(-1), 'CANNOT-CHECK characters: 3 more lines hold a refused character', show(r));
    });
  });

  describe('l) the seal refuses each, and writes nothing', () => {
    test('U+2028 in a plain value of an agent .md -> 2', () => {
      const { file } = agent({ fm: ['name: x', 'description: A\u{2028}B'], contract: TCLAUDE });
      const before = readFileSync(file);
      refused(run(['--seal', file]), 2, '\u{2028}', holds('x.md', 3, 'U+2028'), NOT_WRITTEN);
      assert.deepEqual(readFileSync(file), before);
    });
    test("U+2028 on the contract's Version: line -> 2", () => {
      const { file } = agent({ contract: 'Version: 1.0\u{2028}.0\nTarget: claude\n\n# Contract\n' });
      const before = readFileSync(file);
      refused(run(['--seal', file]), 2, '\u{2028}', holds('x.contract.md', 1, 'U+2028'), NOT_WRITTEN);
      assert.deepEqual(readFileSync(file), before);
    });
    test('U+2028 in references/x.md -> 2, SKILL.md unchanged', () => {
      const dir = skill({ contract: CONTRACT });
      put(dir, 'references/x.md', '# Notes\n\nA\u{2028}B\n');
      const before = readFileSync(join(dir, 'SKILL.md'));
      const r = run(['--seal', dir]);
      refused(r, 2, '\u{2028}', 'CANNOT-CHECK folder: "references/x.md" line 3 holds U+2028', 'FAIL folder-rules: the folder fails its file rules', NOT_WRITTEN);
      assert.deepEqual(readFileSync(join(dir, 'SKILL.md')), before);
    });
    test('U+2028 in a .toml -> 2', () => {
      const { file } = codex({ lines: ['name = "cx"', 'description = "A\u{2028}B"', ...CODEX.slice(2)], contract: TCODEX });
      const before = readFileSync(file);
      refused(run(['--seal', file]), 2, '\u{2028}', `FAIL toml: cannot check cx.toml line 2: ${TOML_SEP('U+2028')}`, NOT_WRITTEN);
      assert.deepEqual(readFileSync(file), before);
    });
  });

  describe('still allowed', () => {
    test('U+00A0 in a plain value -> 0', () => {
      expect(run([agent({ fm: ['name: x', 'description: A\u{A0}B'] }).file]), 0, 'PASS description');
    });
    test('a tab inside a quoted value -> 0', () => {
      expect(run([agent({ fm: ['name: x', 'description: "A\tB"'] }).file]), 0, 'PASS description');
    });
    test('a leading byte-order mark on an agent .md, sealed -> 0', () => {
      const { file } = agent({ text: `\u{FEFF}${familiarText(defaultFm('x'))}`, contract: TCLAUDE });
      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      expect(run([file]), 0, 'PASS familiar-digest', 'PASS contract-digest');
    });
    test('a CRLF agent .md, sealed -> 0', () => {
      const { file } = agent({ text: familiarText(defaultFm('x')).replaceAll('\n', '\r\n'), contract: TCLAUDE });
      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      expect(run([file]), 0, 'PASS familiar-digest', 'PASS contract-digest');
    });
  });
});

// ------------------------------------------------------------------ v10 the extra keys a file may hold

// In a .toml file and a .md file alike, a key the contract lists passes with
// whatever value it holds, and the value is never echoed; a key it does not
// list fails. A listed key the check does not know to be harmless prints a
// warning, and the check still passes. Each case asserts its whole line.
describe('v10 the extra keys a file may hold, listed in its contract', () => {
  const CODEX = ['name = "cx"', 'description = "A test Codex agent."', 'developer_instructions = """', 'You review code.', '"""'];
  const tomlCon = extra => `Version: 1.0.0\nTarget: codex\n${extra}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const mdCon = extra => `Version: 1.0.0\nTarget: claude\n${extra}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const NOT_WRITTEN = 'FAIL seal: refused; nothing written';

  function codex({ lines = CODEX, contract } = {}) {
    const dir = fresh();
    const file = join(dir, 'cx.toml');
    writeFileSync(file, `${lines.join('\n')}\n`);
    if (contract !== undefined) writeFileSync(join(dir, 'cx.contract.md'), contract);
    return { dir, file };
  }

  function agent({ fm, contract } = {}) {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText(fm ?? defaultFm('x')));
    if (contract !== undefined) writeFileSync(join(dir, 'x.contract.md'), contract);
    return { dir, file };
  }

  /** The exit code, and each line printed exactly as given. */
  function exact(r, code, ...lines) {
    expect(r, code);
    for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
  }

  describe('a .toml key the contract lists passes keys, and a dangerous one is flagged', () => {
    const lists = [
      ['approval_policy', '"never"', 'may let the agent run commands without asking'],
      ['web_search', '"live"', 'may let the agent reach the live web'],
      ['model_instructions_file', '"x"', 'loads instructions from a file the seal does not cover'],
    ];
    for (const [key, value, label] of lists) {
      test(`${key}, listed -> PASS keys and its danger line, and the seal writes the mark`, () => {
        const want = `WARN danger: ${key} at line 6 ${label}`;
        const { file } = codex({ lines: [...CODEX, `${key} = ${value}`], contract: tomlCon(`Extra keys: ${key}`) });
        const s = run(['--seal', file]);
        exact(s, 0, 'PASS keys', want);
        assert.ok(has(s, 'PASS seal: wrote '), show(s));
        once(s, want);
        const r = run([file]);
        exact(r, 0, 'PASS keys', want, 'PASS familiar-digest', 'PASS contract-digest');
        once(r, want);
      });
    }
    test('model and model_reasoning_effort, listed and present, sealed -> 0', () => {
      const lines = [...CODEX, 'model = "o3"', 'model_reasoning_effort = "high"'];
      const { file } = codex({ lines, contract: tomlCon('Extra keys: model, model_reasoning_effort') });
      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      const r = run([file]);
      exact(r, 0, 'PASS keys', 'PASS familiar-digest', 'PASS contract-digest');
      assert.ok(!has(r, 'WARN '), show(r));
    });
  });

  describe('a key a .md file adds passes with its value only when the contract lists it', () => {
    const fm = [...defaultFm('x'), 'permissionMode: bypassPermissions'];
    const want = 'WARN danger: permissionMode at line 4 may let the agent act without asking';
    test('listed -> the seal writes it and the check passes with the danger line, and the value is never printed', () => {
      const { file } = agent({ fm, contract: mdCon('Extra keys: permissionMode') });
      const s = run(['--seal', file]);
      expect(s, 0, 'PASS seal: wrote ');
      once(s, want);
      assert.ok(!s.out.includes('bypassPermissions'), show(s));
      const c = run([file]);
      exact(c, 0, 'PASS keys', 'PASS familiar-digest', 'PASS contract-digest', want);
      once(c, want);
      assert.ok(!c.out.includes('bypassPermissions'), show(c));
    });
    test('not listed -> 1 unknown key, and the value is never printed', () => {
      const r = run([agent({ fm, contract: mdCon('') }).file]);
      exact(r, 1, 'FAIL keys: unknown key "permissionMode" at line 4');
      assert.ok(!has(r, 'WARN '), show(r));
      assert.ok(!r.out.includes('bypassPermissions'), show(r));
    });
  });

  describe('held by a mutation', () => {
    test('name = true in a .toml -> 1 cannot-check, since the contract does not list name', () => {
      exact(
        run([codex({ lines: ['name = true', ...CODEX.slice(1)] }).file]),
        1,
        'CANNOT-CHECK toml: cx.toml line 1: an unquoted true or false on a key the contract does not list on its "Extra keys:" line',
      );
    });
    test('subagent: true in an agent .md whose contract has no Extra keys line -> 1 cannot-check', () => {
      exact(
        run([agent({ fm: [...defaultFm('x'), 'subagent: true'], contract: mdCon('') }).file]),
        1,
        'CANNOT-CHECK frontmatter: x.md line 4: an unquoted value YAML reads as null, a boolean, a number or a date, such as a hex, octal, binary or base-60 number or a timestamp (quote it to use it as text)',
      );
    });
    test('model in a .toml, present but not listed -> 1 unknown key', () => {
      const r = run([codex({ lines: [...CODEX, 'model = "x"'], contract: tomlCon('') }).file]);
      exact(r, 1, 'FAIL keys: unknown key "model" at line 6');
    });
  });
});

// ------------------------------------------------------------------ warnings

// A setting the check does not know to be harmless is flagged, not refused. A
// few known settings print a sharper danger line unless their value is safe;
// every other listed key outside a short harmless set prints the plainer
// unreviewed line. Both exit 0, and --seal still seals. Every warning is
// asserted as a whole line, printed exactly once. The canary value only ever
// checks for echo: it appears in no label, file name or echoed name.
describe('warnings on settings the check does not know to be harmless', () => {
  const CODEX = ['name = "cx"', 'description = "A test Codex agent."', 'developer_instructions = """', 'You review code.', '"""'];
  const tomlCon = extra => `Version: 1.0.0\nTarget: codex\n${extra}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const mdCon = extra => `Version: 1.0.0\nTarget: claude\n${extra}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const NOT_WRITTEN = 'FAIL seal: refused; nothing written';
  const CANARY = 'zq-canary-7f3';
  const DECOY_KEY = 'a key named like a seal key; the seal is three comment lines at the end of the file';

  function codex({ lines = CODEX, contract } = {}) {
    const dir = fresh();
    const file = join(dir, 'cx.toml');
    writeFileSync(file, `${lines.join('\n')}\n`);
    if (contract !== undefined) writeFileSync(join(dir, 'cx.contract.md'), contract);
    return { dir, file };
  }

  function agent({ fm, contract } = {}) {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText(fm ?? defaultFm('x')));
    if (contract !== undefined) writeFileSync(join(dir, 'x.contract.md'), contract);
    return { dir, file };
  }

  /** The exit code, and each line printed exactly as given. */
  function exact(r, code, ...lines) {
    expect(r, code);
    for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
  }

  /** Seal, then check. Both runs exit 0; returns both. */
  function sealThenCheck(file) {
    const s = run(['--seal', file]);
    expect(s, 0, 'PASS seal: wrote ');
    const c = run([file]);
    expect(c, 0, 'PASS keys', 'PASS familiar-digest', 'PASS contract-digest');
    return [s, c];
  }

  /** A .toml file holding `key = "value"` at line 6, listed, sealed then checked. */
  function tomlWith(key, value) {
    return sealThenCheck(codex({ lines: [...CODEX, `${key} = "${value}"`], contract: tomlCon(`Extra keys: ${key}`) }).file);
  }

  /** A .md agent holding `key: value` at line 4, listed, sealed then checked. */
  function mdWith(key, value) {
    return sealThenCheck(agent({ fm: [...defaultFm('x'), `${key}: ${value}`], contract: mdCon(`Extra keys: ${key}`) }).file);
  }

  const TOML_ROWS = [
    ['sandbox_mode', ['read-only', 'workspace-write'], 'danger-full-access', 'may let the agent act outside a sandbox'],
    ['default_permissions', [':read-only', ':workspace'], ':danger-full-access', 'may let the agent act outside a sandbox'],
    ['approval_policy', ['on-request'], 'never', 'may let the agent run commands without asking'],
    ['approvals_reviewer', ['user'], 'auto_review', 'may let something other than the person approve commands'],
    ['web_search', ['disabled', 'cached'], 'live', 'may let the agent reach the live web'],
    ['model_instructions_file', [], 'prompts/extra.md', 'loads instructions from a file the seal does not cover'],
    ['experimental_instructions_file', [], 'prompts/extra.md', 'loads instructions from a file the seal does not cover'],
    ['experimental_compact_prompt_file', [], 'prompts/compact.md', 'loads instructions from a file the seal does not cover'],
    ['model_catalog_json', [], 'catalog/models.json', 'loads a file the seal does not cover'],
    ['openai_base_url', [], 'https://example.test/v1', "sends the agent's work to a server the file names"],
  ];
  const MD_ROWS = [
    ['permissionMode', ['default', 'plan', 'manual', 'dontAsk'], 'bypassPermissions', 'may let the agent act without asking'],
    ['allowed-tools', [], 'Bash', 'may let the agent use tools without asking'],
    ['omitClaudeMd', [], 'true', "starts the agent without the person's CLAUDE.md files"],
    ['initialPrompt', [], '"Read the README first, then wait."', 'sends a first message the person did not type'],
  ];

  describe('each .toml danger row', () => {
    for (const [key, safe, bad, label] of TOML_ROWS) {
      const want = `WARN danger: ${key} at line 6 ${label}`;
      for (const v of safe) {
        test(`${key} = "${v}" -> 0 with no warning`, () => {
          for (const r of tomlWith(key, v)) assert.ok(!has(r, 'WARN '), show(r));
        });
      }
      test(`${key} = "${bad}" -> 0 with its danger line, once`, () => {
        for (const r of tomlWith(key, bad)) {
          exact(r, 0, want);
          once(r, want);
        }
      });
      test(`${key} holding the canary -> 0 with its danger line, once, and the value never echoed`, () => {
        for (const r of tomlWith(key, CANARY)) {
          exact(r, 0, want);
          once(r, want);
          assert.ok(!r.out.includes(CANARY), show(r));
        }
      });
    }
  });

  describe('each .md danger row', () => {
    for (const [key, safe, bad, label] of MD_ROWS) {
      const want = `WARN danger: ${key} at line 4 ${label}`;
      for (const v of safe) {
        test(`${key}: ${v} -> 0 with no warning`, () => {
          for (const r of mdWith(key, v)) assert.ok(!has(r, 'WARN '), show(r));
        });
      }
      test(`${key}: ${bad} -> 0 with its danger line, once`, () => {
        for (const r of mdWith(key, bad)) {
          exact(r, 0, want);
          once(r, want);
        }
      });
      test(`${key} holding the canary -> 0 with its danger line, once, and the value never echoed`, () => {
        for (const r of mdWith(key, CANARY)) {
          exact(r, 0, want);
          once(r, want);
          assert.ok(!r.out.includes(CANARY), show(r));
        }
      });
    }
    test('the .md rows apply to a SKILL.md too: allowed-tools -> 0 with its danger line, once', () => {
      const want = 'WARN danger: allowed-tools at line 4 may let the agent use tools without asking';
      const r = run([skill({ fm: [...defaultFm('demo'), 'allowed-tools: Read'] })]);
      exact(r, 0, 'PASS allowed-tools', want);
      once(r, want);
    });
  });

  describe('unreviewed keys', () => {
    const want = n => `WARN unreviewed: zq_unreviewed at line ${n} is a setting this check does not review`;
    test('a listed .toml key outside the known, harmless and danger keys -> 0 with the unreviewed line, once, and the value never echoed', () => {
      for (const r of tomlWith('zq_unreviewed', CANARY)) {
        exact(r, 0, want(6));
        once(r, want(6));
        assert.ok(!r.out.includes(CANARY), show(r));
      }
    });
    test('a listed .md key outside the known, harmless and danger keys -> 0 with the unreviewed line, once, and the value never echoed', () => {
      for (const r of mdWith('zq_unreviewed', CANARY)) {
        exact(r, 0, want(4));
        once(r, want(4));
        assert.ok(!r.out.includes(CANARY), show(r));
      }
    });
    test('a listed key named constructor -> 0 with one unreviewed line, in a .toml and a .md file, and no internal error', () => {
      for (const r of tomlWith('constructor', 'x')) {
        const line = 'WARN unreviewed: constructor at line 6 is a setting this check does not review';
        exact(r, 0, line);
        once(r, line);
        assert.ok(!has(r, 'CANNOT-CHECK internal'), show(r));
      }
      for (const r of mdWith('constructor', 'x')) {
        const line = 'WARN unreviewed: constructor at line 4 is a setting this check does not review';
        exact(r, 0, line);
        once(r, line);
        assert.ok(!has(r, 'CANNOT-CHECK internal'), show(r));
      }
    });
  });

  describe('harmless keys print nothing', () => {
    test('model and model_reasoning_effort, listed in a .toml -> 0 with no warning', () => {
      const lines = [...CODEX, 'model = "o3"', 'model_reasoning_effort = "high"'];
      const { file } = codex({ lines, contract: tomlCon('Extra keys: model, model_reasoning_effort') });
      for (const r of sealThenCheck(file)) assert.ok(!has(r, 'WARN '), show(r));
    });
    test('tools, model and effort, listed in a .md file -> 0 with no warning', () => {
      const fm = [...defaultFm('x'), 'tools: [Read, Glob, Grep]', 'model: sonnet', 'effort: high'];
      const { file } = agent({ fm, contract: mdCon('Extra keys: tools, model, effort') });
      for (const r of sealThenCheck(file)) assert.ok(!has(r, 'WARN '), show(r));
    });
  });

  describe('flow lists are compared item by item', () => {
    const want = 'WARN danger: permissionMode at line 4 may let the agent act without asking';
    test('permissionMode: [plan] -> 0 with no warning', () => {
      for (const r of mdWith('permissionMode', '[plan]')) assert.ok(!has(r, 'WARN '), show(r));
    });
    test('permissionMode: [plan, <canary>] -> 0 with one danger line, and the value never echoed', () => {
      for (const r of mdWith('permissionMode', `[plan, ${CANARY}]`)) {
        exact(r, 0, want);
        once(r, want);
        assert.ok(!r.out.includes(CANARY), show(r));
      }
    });
    test('permissionMode: [] -> 0 with no warning', () => {
      for (const r of mdWith('permissionMode', '[]')) assert.ok(!has(r, 'WARN '), show(r));
    });
    test('permissionMode: [ ] -> 0 with no warning', () => {
      for (const r of mdWith('permissionMode', '[ ]')) assert.ok(!has(r, 'WARN '), show(r));
    });
    // A row with no safe set warns on an empty list too: a loader may read
    // an empty list as a setting that is on.
    for (const [key, , , label] of MD_ROWS.filter(([, safe]) => safe.length === 0)) {
      for (const empty of ['[]', '[ ]']) {
        test(`${key}: ${empty} -> 0 with its danger line, once, after --seal`, () => {
          const line = `WARN danger: ${key} at line 4 ${label}`;
          for (const r of mdWith(key, empty)) {
            exact(r, 0, line);
            once(r, line);
          }
        });
      }
    }
    test('permissionMode: "[plan]", quoted, is text and compared whole -> 0 with the danger line', () => {
      for (const r of mdWith('permissionMode', '"[plan]"')) {
        exact(r, 0, want);
        once(r, want);
      }
    });
  });

  test('a safe sandbox_mode beside a dangerous listed default_permissions -> PASS sandbox-mode and the default_permissions danger line', () => {
    const lines = [...CODEX, 'sandbox_mode = "read-only"', 'default_permissions = ":danger-full-access"'];
    const want = 'WARN danger: default_permissions at line 7 may let the agent act outside a sandbox';
    for (const r of sealThenCheck(codex({ lines, contract: tomlCon('Extra keys: default_permissions') }).file)) {
      exact(r, 0, 'PASS sandbox-mode', want);
      once(r, want);
      assert.ok(!has(r, 'WARN danger: sandbox_mode'), show(r));
    }
  });

  test('two flagged keys under --seal -> 0, each danger line once, after the keys line and before contract-version', () => {
    const lines = [...CODEX, 'sandbox_mode = "danger-full-access"', 'approval_policy = "never"'];
    const { file } = codex({ lines, contract: tomlCon('Extra keys: approval_policy') });
    const r = run(['--seal', file]);
    const wants = [SANDBOX_DANGER(6), 'WARN danger: approval_policy at line 7 may let the agent run commands without asking'];
    exact(r, 0, 'PASS keys', 'PASS contract-version', ...wants);
    assert.ok(has(r, 'PASS seal: wrote '), show(r));
    const keys = r.lines.indexOf('PASS keys');
    const cv = r.lines.indexOf('PASS contract-version');
    for (const w of wants) {
      once(r, w);
      const at = r.lines.indexOf(w);
      assert.ok(keys < at && at < cv, `"${w}" is not between the keys line and contract-version\n${show(r)}`);
    }
  });

  describe('a key that failed the keys rule gets no warning', () => {
    const lines = [...CODEX, 'approval_policy = "never"'];
    const fail = 'FAIL keys: unknown key "approval_policy" at line 6';
    test('an unlisted approval_policy -> 1, the FAIL keys line and no WARN line', () => {
      const r = run([codex({ lines, contract: tomlCon('') }).file]);
      exact(r, 1, fail);
      assert.deepEqual(r.lines.filter(l => l.startsWith('FAIL keys')), [fail], show(r));
      assert.ok(!has(r, 'WARN '), show(r));
    });
    test('an unlisted approval_policy under --seal -> 2, the FAIL keys line and no WARN line, and nothing written', () => {
      const { file } = codex({ lines, contract: tomlCon('') });
      const before = readFileSync(file);
      const r = run(['--seal', file]);
      exact(r, 2, fail, NOT_WRITTEN);
      assert.deepEqual(r.lines.filter(l => l.startsWith('FAIL keys')), [fail], show(r));
      assert.ok(!has(r, 'WARN '), show(r));
      assert.deepEqual(readFileSync(file), before);
    });
  });

  describe('a .toml key named like a seal key is cannot-check', () => {
    const cases = [
      ['familiar-digest', 'Extra keys: familiar-digest'],
      ['familiar-digest', ''],
      ['Familiar-Digest', 'Extra keys: Familiar-Digest'],
      ['contract-version', ''],
      ['my-contract-digest', 'Extra keys: my-contract-digest'],
    ];
    for (const [key, extra] of cases) {
      const why = `CANNOT-CHECK toml: cx.toml line 6: ${DECOY_KEY}`;
      test(`${key}${extra ? ', listed' : ', unlisted'} -> 1 cannot-check`, () => {
        exact(run([codex({ lines: [...CODEX, `${key} = "x"`], contract: tomlCon(extra) }).file]), 1, why);
      });
      test(`${key}${extra ? ', listed' : ', unlisted'} -> the seal refuses, and writes nothing`, () => {
        const { file } = codex({ lines: [...CODEX, `${key} = "x"`], contract: tomlCon(extra) });
        const before = readFileSync(file);
        exact(run(['--seal', file]), 2, `FAIL toml: cannot check cx.toml line 6: ${DECOY_KEY}`, NOT_WRITTEN);
        assert.deepEqual(readFileSync(file), before);
      });
    }
  });
});

// ------------------------------------------------------------------ v10 more YAML forms

// YAML reads a number's prefix in any case and takes an underscore anywhere in
// its digits, reads y and n as booleans, and reads a plain = or << as a key of
// its own. Each is cannot-check unquoted, and text once quoted.
describe('v10 the YAML reader refuses more number, boolean and key forms', () => {
  const NON_TEXT =
    'an unquoted value YAML reads as null, a boolean, a number or a date, such as a hex, octal, binary or base-60 number or a timestamp (quote it to use it as text)';
  const SPECIAL_KEY = 'an unquoted = or <<, which YAML reads as the value key or the merge key (quote it to use it as text)';
  const cases = [
    ['1.2_3', NON_TEXT],
    ['.1_2', NON_TEXT],
    ['0X1F', NON_TEXT],
    ['-0X1F', NON_TEXT],
    ['0B101', NON_TEXT],
    ['0O17', NON_TEXT],
    ['y', NON_TEXT],
    ['N', NON_TEXT],
    ['=', SPECIAL_KEY],
    ['<<', SPECIAL_KEY],
  ];
  for (const [value, reason] of cases) {
    test(`description: ${value} -> 1 cannot-check`, () => {
      const r = run([skill({ fm: ['name: demo', `description: ${value}`] })]);
      expect(r, 1);
      assert.ok(r.lines.includes(`CANNOT-CHECK frontmatter: SKILL.md line 3: ${reason}`), show(r));
    });
    test(`description: "${value}" -> 0`, () => {
      expect(run([skill({ fm: ['name: demo', `description: "${value}"`] })]), 0, 'PASS description');
    });
  }

  // A base prefix followed only by underscores is refused as a number form,
  // while a bare 0x, 0b or 0o stays text (block 31).
  for (const value of ['0x_', '0b_', '-0x_', '+0b_', '0o_']) {
    test(`description: ${value} -> 1 cannot-check`, () => {
      const r = run([skill({ fm: ['name: demo', `description: ${value}`] })]);
      expect(r, 1);
      assert.ok(r.lines.includes(`CANNOT-CHECK frontmatter: SKILL.md line 3: ${NON_TEXT}`), show(r));
    });
  }
  test('a metadata value of 0x__ -> 1 cannot-check', () => {
    const r = run([skill({ fm: [...defaultFm('demo'), 'metadata:', '  owner: 0x__'] })]);
    expect(r, 1);
    assert.ok(r.lines.includes(`CANNOT-CHECK frontmatter: SKILL.md line 5: ${NON_TEXT}`), show(r));
  });
});

// ------------------------------------------------------------------ v10 held by a mutation: the folder

// Each case closes a gap a mutation found in the folder rules: a behaviour
// that could be removed with every earlier test still green.
describe('v10 the folder rules, held by a mutation', () => {
  /**
   * Each line printed exactly as given, then the exit code. The lines come
   * first, so a mutation that drops a rule fails on the line it dropped.
   */
  function exact(r, code, ...lines) {
    for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
    expect(r, code);
  }

  test('assets/x.png.md is text, not an image: an invisible character in it -> 1', () => {
    const dir = skill();
    put(dir, 'assets/x.png.md', 'A hid\u{200B}den mark.\n');
    exact(run([dir]), 1, 'FAIL invisible-characters: assets/x.png.md line 1 holds U+200B');
  });

  for (const nested of ['references/SKILL.md', 'references/CONTRACT.md']) {
    test(`a nested ${nested} is covered by the seal: edited after sealing -> 1`, () => {
      const dir = skill({ contract: CONTRACT });
      put(dir, nested, '# Nested\n\nFirst line.\n');
      sealAndCheck(dir);
      editFile(join(dir, ...nested.split('/')), 'First line.', 'First line, edited.');
      exact(run([dir]), 1, BROKEN);
    });
  }

  test('a file named caf\u{E9}.md in the folder -> 1 cannot-check', t => {
    const dir = skill();
    if (!tryPut(dir, 'caf\u{E9}.md', '# Notes\n')) {
      t.skip('this file system refuses or changes the name');
      return;
    }
    exact(run([dir]), 1, 'CANNOT-CHECK folder: "caf\u{E9}.md" holds a character outside A-Z, a-z, 0-9, ".", "_" and "-"');
  });
});
