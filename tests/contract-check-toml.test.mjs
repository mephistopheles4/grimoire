// Tests of skills/contract/scripts/check.mjs: the .toml reader fails closed,
// and the contract names its target. How every case drives the check, and the
// fixture they share, are in contract-fixture.mjs.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fresh, run, has, show, expect, once, SANDBOX_DANGER, CONTRACT, familiarText, defaultFm, skill, sealAndCheck, editFile, splitKeep, put, listing } from './contract-fixture.mjs';

// ------------------------------------------------------------------ v8 (#154)

// A Codex agent file (.toml) is read by a reader that takes one small subset
// of TOML and calls everything else "cannot check", and it is sealed with
// three comment lines at its end. Every red case asserts its whole reason
// line. A backslash in a fixture is written as BS, so no escape in this file
// can turn into the character it names.
describe('v8 the .toml reader fails closed, and the contract names its target', () => {
  const BS = String.fromCharCode(92);
  const HEX = 'ab'.repeat(32);
  const CODEX = ['name = "cx"', 'description = "A test Codex agent."', 'developer_instructions = """', 'You review code.', '"""'];
  const TCON = 'Version: 1.0.0\nTarget: codex\n\n# Contract\n\nWhat this familiar is for.\n';
  const conWith = extra => `Version: 1.0.0\n${extra}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const block = (cv = '"1.0.0"', fd = `"sha256:${HEX}"`, cd = `"sha256:${HEX}"`) => [
    `# contract-version = ${cv}`,
    `# familiar-digest = ${fd}`,
    `# contract-digest = ${cd}`,
  ];

  const R = {
    table: 'a table header ([table] or [[array]]); this check reads top-level keys only',
    dotted: 'a dotted or quoted key',
    key: 'a key outside the readable subset',
    notKv: 'a line that is not "key = value", a comment or a blank line',
    metadata: 'a top-level "metadata" key, which stops Codex loading the agent',
    empty: 'an empty value',
    array: 'an array value (this check reads only strings, true and false)',
    inline: 'an inline table value (this check reads only strings, true and false)',
    number: 'a number or a date value (this check reads only strings, true and false)',
    other: 'a value that is not a quoted string, true or false',
    bool: 'an unquoted true or false on a key the contract does not list on its "Extra keys:" line',
    afterQuote: 'text after a closing quote (for example a trailing comment)',
    afterValue: 'text after a value (for example a trailing comment)',
    escape: 'a backslash escape other than \\" or \\\\',
    twoSingle: 'two single quotes in a row inside a literal string (a TOML literal string has no escapes)',
    longClose: 'a closing quote run longer than the three-quote delimiter',
    unclosedBasic: 'a double-quoted value that does not close on its line',
    bom: 'a byte-order mark (a .toml file must not start with one)',
    cr: 'a carriage return with no line feed after it',
    ctrl: u => `a control character other than tab (${u})`,
    decoy: 'a comment that names a seal key but is not part of the seal block (three exact lines at the end of the file)',
  };
  const cannot = (line, reason, file = 'cx.toml') => `CANNOT-CHECK toml: ${file} line ${line}: ${reason}`;

  /** Write <stem>.toml (and its contract) into a fresh folder. */
  function codex({ lines = CODEX, stem = 'cx', contract, eol = '\n', end = eol, text } = {}) {
    const dir = fresh();
    const file = join(dir, `${stem}.toml`);
    writeFileSync(file, text ?? lines.join(eol) + end);
    if (contract !== undefined) writeFileSync(join(dir, `${stem}.contract.md`), contract);
    return { dir, file };
  }

  /** Write <stem>.md, an agent in YAML frontmatter, and its contract. */
  function mdAgent({ fm, stem = 'x', contract } = {}) {
    const dir = fresh();
    const file = join(dir, `${stem}.md`);
    writeFileSync(file, familiarText(fm ?? defaultFm(stem)));
    if (contract !== undefined) writeFileSync(join(dir, `${stem}.contract.md`), contract);
    return { dir, file };
  }

  /** The exit code, and each line printed exactly as given. */
  function exact(r, code, ...lines) {
    expect(r, code);
    for (const l of lines) assert.ok(r.lines.includes(l), `missing the line "${l}"\n${show(r)}`);
  }

  function sealCodex(file) {
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    const c = run([file]);
    expect(c, 0, 'PASS toml', 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest');
    return c;
  }

  describe('D1 one subset of TOML, and everything else is cannot-check', () => {
    test('a valid agent -> 0, and no body-length line at all (D12)', () => {
      const r = run([codex().file]);
      exact(r, 0, 'PASS toml', 'PASS keys', 'PASS name: cx', 'PASS name-matches-file', 'PASS description', 'PASS developer_instructions');
      assert.ok(!r.lines.some(l => l.includes('body-length')), show(r));
    });
    test('blank lines, whole-line comments, tabs and spaces around "=" -> 0', () => {
      const lines = ['# an agent', '', 'name\t=  "cx"', '  # indented', 'description = "A test Codex agent."', '', ...CODEX.slice(2)];
      exact(run([codex({ lines }).file]), 0, 'PASS toml');
    });
    test('H1: a key under a [table] header is not skipped -> 1', () => {
      const lines = [...CODEX, '[mcp_servers.x]', 'command = "sh"'];
      const r = run([codex({ lines, contract: conWith('Extra keys: command') }).file]);
      exact(r, 1, cannot(6, R.table));
      assert.ok(!has(r, 'PASS keys'), show(r));
    });
    const tables = [
      ['an [[array]] table', ['[[agents]]']],
      ['a [metadata] table (D7)', ['[metadata]', 'owner = "x"']],
      ['a table after a would-be [metadata] (D7)', ['[metadata]', 'owner = "x"', '[other]']],
      ['a duplicate [metadata] (D7)', ['[metadata]', 'owner = "x"', '[metadata]']],
      ['an indented table header', ['  [x]']],
    ];
    for (const [label, extra] of tables) {
      test(`${label} -> 1`, () => {
        exact(run([codex({ lines: [...CODEX, ...extra] }).file]), 1, cannot(6, R.table));
      });
    }
    test('a dotted key -> 1', () => {
      exact(run([codex({ lines: [...CODEX, 'a.b = "x"'] }).file]), 1, cannot(6, R.dotted));
    });
    test('a quoted key -> 1', () => {
      exact(run([codex({ lines: [...CODEX, '"name" = "x"'] }).file]), 1, cannot(6, R.dotted));
    });
    test('a key outside the bare-key pattern -> 1', () => {
      exact(run([codex({ lines: [...CODEX, '1st = "x"'] }).file]), 1, cannot(6, R.key));
    });
    test('a duplicate key -> 1', () => {
      exact(run([codex({ lines: [...CODEX, 'name = "cx"'] }).file]), 1, cannot(6, 'duplicate key "name"'));
    });
    test('a duplicate key where one copy is multiline -> 1', () => {
      const lines = [...CODEX, 'description = """', 'Again.', '"""'];
      exact(run([codex({ lines }).file]), 1, cannot(6, 'duplicate key "description"'));
    });
    test('a dotted key with a multiline value -> 1', () => {
      const lines = [...CODEX, 'a.b = """', 'x', '"""'];
      exact(run([codex({ lines }).file]), 1, cannot(6, R.dotted));
    });
    test('a trailing comment after a multiline close -> 1', () => {
      const lines = [...CODEX.slice(0, 4), '""" # note'];
      exact(run([codex({ lines }).file]), 1, cannot(5, R.afterQuote));
    });
    test('a trailing comment after a one-line string -> 1', () => {
      exact(run([codex({ lines: ['name = "cx" # note', ...CODEX.slice(1)] }).file]), 1, cannot(1, R.afterQuote));
    });
    test('text after a literal string -> 1', () => {
      exact(run([codex({ lines: ["name = 'cx' x", ...CODEX.slice(1)] }).file]), 1, cannot(1, R.afterQuote));
    });
    test('a line that is not key = value -> 1', () => {
      exact(run([codex({ lines: [...CODEX, 'just words'] }).file]), 1, cannot(6, R.notKv));
    });
    test('a key with no "=" -> 1', () => {
      exact(run([codex({ lines: [...CODEX, 'model'] }).file]), 1, cannot(6, R.notKv));
    });
    test('an empty value -> 1', () => {
      exact(run([codex({ lines: [...CODEX, 'model ='] }).file]), 1, cannot(6, R.empty));
    });
    const values = [
      ['an array', 'tools = ["a"]', R.array],
      ['an inline table', 'm = { a = "b" }', R.inline],
      ['a number', 'n = 1', R.number],
      ['a signed number', 'n = -1', R.number],
      ['a float', 'n = 1.5', R.number],
      ['inf', 'n = inf', R.number],
      ['a date', 'd = 2026-09-29', R.number],
      ['a bare word', 'model = o3', R.other],
    ];
    for (const [label, line, reason] of values) {
      test(`${label} value -> 1`, () => {
        exact(run([codex({ lines: [...CODEX, line], contract: conWith('Extra keys: tools, m, n, d, model') }).file]), 1, cannot(6, reason));
      });
    }
    test('a top-level metadata key, even when the contract lists it (D7) -> 1', () => {
      const r = run([codex({ lines: [...CODEX, 'metadata = "x"'], contract: conWith('Extra keys: metadata') }).file]);
      exact(r, 1, cannot(6, R.metadata));
    });
    test('an unquoted true on a key the contract does not list -> 1 (D2)', () => {
      exact(run([codex({ lines: [...CODEX, 'hide = true'] }).file]), 1, cannot(6, R.bool));
    });
    test('an unquoted false on a listed key is read, and passes keys with an unreviewed warning, sealed -> 0', () => {
      // The reader takes the listed false; the key rule passes the listed key,
      // and the warning says the check does not review what it does.
      const { file } = codex({ lines: [...CODEX, 'hide = false'], contract: conWith('Target: codex\nExtra keys: hide') });
      const r = sealCodex(file);
      const want = 'WARN unreviewed: hide at line 6 is a setting this check does not review';
      exact(r, 0, 'PASS toml', 'PASS keys', want);
      assert.equal(r.lines.filter(l => l === want).length, 1, show(r));
    });
    test('text after true -> 1', () => {
      const r = run([codex({ lines: [...CODEX, 'hide = true # note'], contract: conWith('Extra keys: hide') }).file]);
      exact(r, 1, cannot(6, R.afterValue));
    });
  });

  describe('D2 strings, the narrow way', () => {
    const escapes = ['u200B', 'u202E', 'U000E0041', 'u0000', 'u001B', 'uD800', 'U00110000', 'n', 't', 'e'];
    for (const e of escapes) {
      test(`the escape \\${e} in a one-line string -> 1`, () => {
        const lines = ['name = "cx"', `description = "A${BS}${e}B"`, ...CODEX.slice(2)];
        const r = run([codex({ lines }).file]);
        exact(r, 1, cannot(2, R.escape));
      });
    }
    test('the escape \\u200B in a multiline string -> 1', () => {
      const lines = [...CODEX.slice(0, 3), `You review${BS}u200B code.`, '"""'];
      exact(run([codex({ lines }).file]), 1, cannot(4, R.escape));
    });
    test('a line-ending backslash in a multiline string -> 1', () => {
      const lines = [...CODEX.slice(0, 3), `You review ${BS}`, 'code.', '"""'];
      exact(run([codex({ lines }).file]), 1, cannot(4, R.escape));
    });
    test('the escapes \\" and \\\\ -> 0', () => {
      const lines = ['name = "cx"', `description = "A ${BS}"quoted${BS}" ${BS}${BS} agent."`, CODEX[2], `Say ${BS}"no${BS}".`, '"""'];
      exact(run([codex({ lines }).file]), 0, 'PASS toml');
    });
    test("two single quotes inside a literal string -> 1", () => {
      exact(run([codex({ lines: ['name = "cx"', "description = 'it''s'", ...CODEX.slice(2)] }).file]), 1, cannot(2, R.twoSingle));
    });
    test("two single quotes inside a multiline literal string -> 1", () => {
      const lines = [...CODEX.slice(0, 2), "developer_instructions = '''", "it''s", "'''"];
      exact(run([codex({ lines }).file]), 1, cannot(4, R.twoSingle));
    });
    test("an empty literal string '' is a value -> 1 on description only", () => {
      exact(run([codex({ lines: ['name = "cx"', "description = ''", ...CODEX.slice(2)] }).file]), 1, 'FAIL description: line 2: empty');
    });
    test('"""" at a close -> 1', () => {
      const lines = [...CODEX.slice(0, 3), 'You review code.""""'];
      exact(run([codex({ lines }).file]), 1, cannot(4, R.longClose));
    });
    test("'''' at a close -> 1", () => {
      const lines = [...CODEX.slice(0, 2), "developer_instructions = '''", "You review code.''''"];
      exact(run([codex({ lines }).file]), 1, cannot(4, R.longClose));
    });
    test('H2: \\"""" closes where TOML closes, so the key after it is read -> 0 with the sandbox_mode danger line at line 3', () => {
      // The line number proves the key after the close was read as a key.
      const lines = ['name = "cx"', `description = """A test${BS}""""`, 'sandbox_mode = "danger-full-access"', 'developer_instructions = "Review."'];
      const r = run([codex({ lines }).file]);
      exact(r, 0, SANDBOX_DANGER(3), 'PASS description');
      once(r, SANDBOX_DANGER(3));
      assert.ok(!has(r, 'PASS sandbox-mode') && !has(r, 'FAIL sandbox-mode'), show(r));
    });
    test('a one-line basic string that does not close -> 1', () => {
      exact(run([codex({ lines: ['name = "cx', ...CODEX.slice(1)] }).file]), 1, cannot(1, R.unclosedBasic));
    });
    test('an unclosed multiline string -> 1', () => {
      exact(run([codex({ lines: CODEX.slice(0, 4) }).file]), 1, cannot(3, 'unclosed multiline string (""")'));
    });
    test('the newline right after """ is not part of the value: 1,024 characters -> 0, 1,025 -> 1', () => {
      // The value is the line of text plus the line ending before the close.
      const at = n => ['name = "cx"', 'description = """', 'd'.repeat(n), '"""', 'developer_instructions = "Review."'];
      exact(run([codex({ lines: at(1023) }).file]), 0, 'PASS description');
      exact(run([codex({ lines: at(1024) }).file]), 1, 'FAIL description: line 2: longer than 1024 characters');
    });
    test('text on the opening line starts the value', () => {
      const lines = ['name = "cx"', `description = """${'d'.repeat(1023)}`, '"""', 'developer_instructions = "Review."'];
      exact(run([codex({ lines }).file]), 0, 'PASS description');
    });
    test('spaces after an opening """ are part of the value, so the newline after them is too -> 0 with the sandbox_mode danger line', () => {
      // TOML trims a newline only straight after the delimiter. Read as
      // trimmed, this value would be "read-only" and print no danger line.
      const lines = [...CODEX, 'sandbox_mode = """  ', 'read-only"""'];
      const r = run([codex({ lines }).file]);
      exact(r, 0, SANDBOX_DANGER(6));
      once(r, SANDBOX_DANGER(6));
      assert.ok(!has(r, 'PASS sandbox-mode') && !has(r, 'FAIL sandbox-mode'), show(r));
    });
    test("spaces after an opening ''' are part of the value too -> 0 with the sandbox_mode danger line", () => {
      const lines = [...CODEX, "sandbox_mode = '''\t", "read-only'''"];
      const r = run([codex({ lines }).file]);
      exact(r, 0, SANDBOX_DANGER(6));
      once(r, SANDBOX_DANGER(6));
      assert.ok(!has(r, 'PASS sandbox-mode') && !has(r, 'FAIL sandbox-mode'), show(r));
    });
    test('a one-line """ value -> 0', () => {
      const lines = ['name = "cx"', 'description = """A test agent."""', 'developer_instructions = """Review."""'];
      exact(run([codex({ lines }).file]), 0, 'PASS toml', 'PASS description');
    });
  });

  describe('D3 text hygiene', () => {
    test('a lone CR -> 1', () => {
      exact(run([codex({ text: `name = "cx"\r${CODEX.slice(1).join('\n')}\n` }).file]), 1, cannot(1, R.cr));
    });
    test('a byte-order mark -> 1', () => {
      exact(run([codex({ text: `\u{FEFF}${CODEX.join('\n')}\n` }).file]), 1, cannot(1, R.bom));
    });
    test('a raw control character in a string -> 1, and never echoed', () => {
      const r = run([codex({ lines: ['name = "cx"', 'description = "A\u{1}B"', ...CODEX.slice(2)] }).file]);
      exact(r, 1, cannot(2, R.ctrl('U+0001')));
    });
    test('a raw ESC in a comment -> 1, and never echoed', () => {
      const r = run([codex({ lines: [...CODEX, '# note \u{1B}[31m'] }).file]);
      exact(r, 1, cannot(6, R.ctrl('U+001B')));
      assert.ok(!r.out.includes('\u{1B}'), 'ESC byte in the output');
    });
    test('a raw DEL in a string -> 1', () => {
      const r = run([codex({ lines: ['name = "cx"', 'description = "A\u{7F}B"', ...CODEX.slice(2)] }).file]);
      exact(r, 1, cannot(2, R.ctrl('U+007F')));
      assert.ok(!r.out.includes('\u{7F}'), 'DEL byte in the output');
    });
    test('a raw DEL in a comment -> 1', () => {
      exact(run([codex({ lines: [...CODEX, '# note \u{7F}'] }).file]), 1, cannot(6, R.ctrl('U+007F')));
    });
    // The seal block's lines take the same rules as every other line. A seal
    // written clean, then a lone CR put in after the fact.
    const crInBlock = [
      ['after seal line 2', /(# familiar-digest = "sha256:[0-9a-f]{64}")\n/, 7],
      ['at the end of seal line 3', /(# contract-digest = "sha256:[0-9a-f]{64}")\n$/, 8],
    ];
    for (const [label, re, line] of crInBlock) {
      test(`a lone CR ${label} -> 1 cannot-check`, () => {
        const { file } = codex({ contract: TCON });
        sealCodex(file);
        const text = readFileSync(file, 'utf8');
        assert.ok(re.test(text), 'fixture edit: the seal line was not found');
        writeFileSync(file, text.replace(re, '$1\r'));
        exact(run([file]), 1, cannot(line, R.cr));
      });
      test(`a lone CR ${label} -> --seal refuses, and writes nothing`, () => {
        const { file } = codex({ contract: TCON });
        sealCodex(file);
        writeFileSync(file, readFileSync(file, 'utf8').replace(re, '$1\r'));
        const before = readFileSync(file);
        exact(run(['--seal', file]), 2, `FAIL toml: cannot check cx.toml line ${line}: ${R.cr}`, 'FAIL seal: refused; nothing written');
        assert.deepEqual(readFileSync(file), before);
      });
    }
    test('a tab inside a string -> 0', () => {
      exact(run([codex({ lines: ['name = "cx"', 'description = "A\ttest."', ...CODEX.slice(2)] }).file]), 0, 'PASS toml');
    });
    test('a no-break space after a value is not trimmed -> 1', () => {
      exact(run([codex({ lines: ['name = "cx"\u{A0}', ...CODEX.slice(1)] }).file]), 1, cannot(1, R.afterQuote));
    });
    test('an ideographic space before a key is not trimmed -> 1', () => {
      exact(run([codex({ lines: ['\u{3000}name = "cx"', ...CODEX.slice(1)] }).file]), 1, cannot(1, R.notKv));
    });
    test('a CRLF file -> 0', () => {
      exact(run([codex({ eol: '\r\n' }).file]), 0, 'PASS toml');
    });
  });

  describe('D4 the invisible set is every default-ignorable code point', () => {
    const cps = [
      ['LRM', 0x200e],
      ['RLM', 0x200f],
      ['ALM', 0x61c],
      ['a soft hyphen', 0xad],
      ['a variation selector', 0xfe0f],
      ['a supplementary variation selector', 0xe0100],
      ['a Hangul filler', 0x3164],
    ];
    for (const [label, cp] of cps) {
      test(`${label}, raw, in a .toml -> 1`, () => {
        const lines = ['name = "cx"', `description = "A test${String.fromCodePoint(cp)} agent."`, ...CODEX.slice(2)];
        const r = run([codex({ lines }).file]);
        exact(r, 1, `FAIL invisible-characters: cx.toml line 2 holds U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
      });
    }
    test('a variation selector in a skill -> 1', () => {
      const r = run([skill({ fm: ['name: demo', 'description: A test\u{FE0F} skill.'] })]);
      exact(r, 1, 'FAIL invisible-characters: SKILL.md line 3 holds U+FE0F');
    });
    test('an LRM in a file beside SKILL.md -> 1', () => {
      const dir = skill();
      put(dir, 'references/a.md', 'One\u{200E} line.\n');
      exact(run([dir]), 1, 'FAIL invisible-characters: references/a.md line 1 holds U+200E');
    });
    test('an LRM in an agent .md -> 1', () => {
      const r = run([mdAgent({ fm: ['name: x', 'description: A test\u{200E} agent.'] }).file]);
      exact(r, 1, 'FAIL invisible-characters: x.md line 3 holds U+200E');
    });
  });

  describe('D5 the seal is a comment block at the end of the file', () => {
    test('seal -> 0; the block is three exact lines after the untouched file', () => {
      const { file } = codex({ contract: TCON });
      const before = readFileSync(file, 'utf8');
      sealCodex(file);
      const after = readFileSync(file, 'utf8');
      assert.ok(after.startsWith(before), 'the seal changed a line above the block');
      assert.match(after.slice(before.length), /^# contract-version = "1\.0\.0"\n# familiar-digest = "sha256:[0-9a-f]{64}"\n# contract-digest = "sha256:[0-9a-f]{64}"\n$/);
    });
    test('the familiar digest is the sha256 of every line before the block, with one final line feed', () => {
      const { file } = codex({ contract: TCON });
      const before = readFileSync(file, 'utf8');
      sealCodex(file);
      const want = `sha256:${createHash('sha256').update(before, 'utf8').digest('hex')}`;
      assert.ok(readFileSync(file, 'utf8').includes(`# familiar-digest = "${want}"`));
    });
    test('a file with no final line ending -> the seal adds one, then 0', () => {
      const { file } = codex({ contract: TCON, end: '' });
      const before = readFileSync(file, 'utf8');
      sealCodex(file);
      const after = readFileSync(file, 'utf8');
      assert.ok(after.startsWith(`${before}\n# contract-version = "1.0.0"\n`), after);
      assert.ok(after.endsWith('"\n'), after);
    });
    test('a CRLF file -> the block takes CRLF, then 0', () => {
      const { file } = codex({ contract: TCON, eol: '\r\n' });
      const before = readFileSync(file, 'utf8');
      sealCodex(file);
      const after = readFileSync(file, 'utf8');
      assert.ok(after.startsWith(before), 'the seal changed a line above the block');
      assert.ok(!/(^|[^\r])\n/.test(after), 'a bare LF in the sealed CRLF file');
      assert.equal(splitKeep(after).length, splitKeep(before).length + 3);
    });
    test('a CRLF file with no final line ending -> CRLF added, then 0', () => {
      const { file } = codex({ contract: TCON, eol: '\r\n', end: '' });
      sealCodex(file);
      assert.ok(!/(^|[^\r])\n/.test(readFileSync(file, 'utf8')), 'a bare LF in the sealed CRLF file');
    });
    test('seal twice -> identical file, one block', () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      const first = readFileSync(file);
      sealCodex(file);
      assert.deepEqual(readFileSync(file), first);
    });
    test('a second seal after an edit rewrites the block in place -> 0, one block', () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      editFile(file, 'You review code.', 'You review code carefully.');
      expect(run([file]), 1, 'FAIL familiar-digest');
      sealCodex(file);
      const text = readFileSync(file, 'utf8');
      assert.equal(text.split('\n').filter(l => l.startsWith('# familiar-digest')).length, 1, text);
    });
    test('seal -> body tamper -> 1 familiar-digest', () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      editFile(file, 'You review code.', 'You write code.');
      exact(run([file]), 1, 'FAIL familiar-digest: line 7: the seal is broken; cx.toml changed since it was sealed', 'PASS contract-digest');
    });
    test('seal -> a key added -> 1 familiar-digest', () => {
      const { file } = codex({ contract: conWith('Target: codex\nExtra keys: model') });
      sealCodex(file);
      editFile(file, 'name = "cx"\n', 'name = "cx"\nmodel = "o3"\n');
      exact(run([file]), 1, 'FAIL familiar-digest: line 8: the seal is broken; cx.toml changed since it was sealed');
    });
    test('seal -> contract tamper -> 1 contract-digest', () => {
      const { dir, file } = codex({ contract: TCON });
      sealCodex(file);
      editFile(join(dir, 'cx.contract.md'), 'What this familiar is for.', 'What this familiar is really for.');
      exact(
        run([file]),
        1,
        'FAIL contract-digest: line 8: the seal is broken; cx.contract.md changed since the familiar was sealed',
        'PASS contract-version',
        'PASS familiar-digest',
      );
    });
    test("seal -> the mark's contract-version edited -> 1 contract-version", () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      editFile(file, '# contract-version = "1.0.0"', '# contract-version = "9.0.0"');
      exact(run([file]), 1, "FAIL contract-version: line 6: does not match the contract's Version line", 'PASS familiar-digest', 'PASS contract-digest');
    });
    test("seal -> the mark's familiar-digest edited -> 1 familiar-digest", () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, text.replace(/# familiar-digest = "sha256:[0-9a-f]{64}"/, `# familiar-digest = "sha256:${HEX}"`));
      exact(run([file]), 1, 'FAIL familiar-digest: line 7: the seal is broken; cx.toml changed since it was sealed', 'PASS contract-digest');
    });
    test('mark lines inside a closed multiline string are text, and stay in the digest', () => {
      const lines = [...CODEX.slice(0, 3), ...block(), '"""'];
      const { file } = codex({ lines, contract: TCON });
      sealCodex(file);
      editFile(file, `# familiar-digest = "sha256:${HEX}"`, `# familiar-digest = "sha256:${'cd'.repeat(32)}"`);
      exact(run([file]), 1, 'FAIL familiar-digest: line 9: the seal is broken; cx.toml changed since it was sealed');
    });
    test('mark lines inside an unclosed multiline string -> 1 unclosed', () => {
      const lines = [...CODEX.slice(0, 2), "developer_instructions = '''", 'text', ...block()];
      exact(run([codex({ lines }).file]), 1, cannot(3, "unclosed multiline string (''')"));
    });
    const bad = [
      ['63 hex digits', block(undefined, `"sha256:${HEX.slice(1)}"`)],
      ['65 hex digits', block(undefined, `"sha256:${HEX}a"`)],
      ['upper-case hex', block(undefined, `"sha256:${HEX.toUpperCase()}"`)],
      ['text after the closing quote', block(undefined, undefined, `"sha256:${HEX}" x`)],
      ['a single-quoted value', block(undefined, `'sha256:${HEX}'`)],
      ['no spaces round "="', ['# contract-version="1.0.0"', ...block().slice(1)]],
      ['a partial block', block().slice(1)],
      ['a reordered block', [block()[1], block()[0], block()[2]]],
    ];
    for (const [label, lines] of bad) {
      test(`a block with ${label} -> 1 cannot-check`, () => {
        exact(run([codex({ lines: [...CODEX, ...lines], contract: TCON }).file]), 1, cannot(6, R.decoy));
      });
    }
    test('a block followed by a trailing blank line -> 1 cannot-check', () => {
      exact(run([codex({ lines: [...CODEX, ...block()], end: '\n\n', contract: TCON }).file]), 1, cannot(6, R.decoy));
    });
    test('a block followed by a key -> 1 cannot-check', () => {
      exact(run([codex({ lines: [...CODEX, ...block(), 'model = "o3"'], contract: TCON }).file]), 1, cannot(6, R.decoy));
    });
  });

  describe('D6 a comment that looks like a seal is refused', () => {
    const decoys = [
      ['no spaces', `#familiar-digest="sha256:${HEX}"`],
      ['a tab indent', `\t# familiar-digest = "sha256:${HEX}"`],
      ['upper case', `# FAMILIAR-DIGEST = "sha256:${HEX}"`],
      ['single quotes', `# familiar-digest = 'sha256:${HEX}'`],
      ['the ":" form', `# familiar-digest: "sha256:${HEX}"`],
      ['the exact form, away from the end', `# contract-version = "1.0.0"`],
      ['prose naming a key', '# sealed; see contract-digest'],
    ];
    for (const [label, line] of decoys) {
      test(`${label} -> 1 cannot-check`, () => {
        const lines = [CODEX[0], line, ...CODEX.slice(1)];
        exact(run([codex({ lines }).file]), 1, cannot(2, R.decoy));
      });
    }
    test('a decoy above a valid block -> 1 cannot-check', () => {
      const { file } = codex({ contract: TCON });
      sealCodex(file);
      editFile(file, 'name = "cx"\n', `name = "cx"\n# contract-digest = "sha256:${HEX}"\n`);
      exact(run([file]), 1, cannot(2, R.decoy));
    });
  });

  describe('D8 the keys a .toml may hold', () => {
    for (const [key, value] of [['license', '"MIT"'], ['compatibility', '"any"'], ['allowed-tools', '"Read"']]) {
      test(`${key} -> 1 unknown key`, () => {
        exact(run([codex({ lines: [...CODEX, `${key} = ${value}`] }).file]), 1, `FAIL keys: unknown key "${key}" at line 6`);
      });
    }
    test('a key the contract lists, sealed -> 0', () => {
      const { file } = codex({ lines: [...CODEX, 'model = "o3"'], contract: conWith('Target: codex\nExtra keys: model') });
      exact(sealCodex(file), 0, 'PASS keys');
    });
    test('developer_instructions missing -> 1', () => {
      exact(run([codex({ lines: CODEX.slice(0, 2) }).file]), 1, 'FAIL developer_instructions: missing (required)');
    });
    test('developer_instructions blank -> 1', () => {
      const lines = [...CODEX.slice(0, 3), '   ', '"""'];
      exact(run([codex({ lines }).file]), 1, 'FAIL developer_instructions: line 3: empty');
    });
    test('instructions, the wrong key, -> 1 unknown key and developer_instructions missing', () => {
      const lines = [...CODEX.slice(0, 2), 'instructions = """', 'You review code.', '"""'];
      exact(run([codex({ lines }).file]), 1, 'FAIL keys: unknown key "instructions" at line 3', 'FAIL developer_instructions: missing (required)');
    });
  });

  describe('D9 sandbox_mode is flagged, not refused', () => {
    test('danger-full-access -> 0 with the danger line, with no Extra keys entry needed, and the value never echoed', () => {
      const r = run([codex({ lines: [...CODEX, 'sandbox_mode = "danger-full-access"'] }).file]);
      exact(r, 0, SANDBOX_DANGER(6), 'PASS keys');
      once(r, SANDBOX_DANGER(6));
      assert.ok(!has(r, 'PASS sandbox-mode') && !has(r, 'FAIL sandbox-mode'), show(r));
      assert.ok(!r.out.includes('danger-full-access'), show(r));
    });
    test('danger-full-access -> the seal writes the mark, and the danger line prints once', () => {
      const { file } = codex({ lines: [...CODEX, 'sandbox_mode = "danger-full-access"'], contract: TCON });
      const r = run(['--seal', file]);
      exact(r, 0, 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest', SANDBOX_DANGER(6));
      assert.ok(has(r, 'PASS seal: wrote '), show(r));
      once(r, SANDBOX_DANGER(6));
      assert.ok(!r.out.includes('danger-full-access'), show(r));
      assert.ok(readFileSync(file, 'utf8').includes('# familiar-digest = "sha256:'), 'the mark was not written');
    });
    for (const v of ['read-only', 'workspace-write']) {
      test(`${v} -> 0`, () => {
        const r = run([codex({ lines: [...CODEX, `sandbox_mode = "${v}"`] }).file]);
        exact(r, 0, 'PASS sandbox-mode', 'PASS keys');
        assert.ok(!has(r, 'WARN '), show(r));
      });
    }
  });

  describe('D10 the contract names its target', () => {
    test('codex and a .toml, sealed -> 0', () => {
      const c = sealCodex(codex({ contract: TCON }).file);
      exact(c, 0, 'PASS target: codex');
    });
    for (const target of ['claude', 'antigravity']) {
      test(`${target} and a .md, sealed -> 0`, () => {
        const { file } = mdAgent({ contract: conWith(`Target: ${target}`) });
        expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
        exact(run([file]), 0, `PASS target: ${target}`, 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest');
      });
      test(`${target} and a .toml -> 1`, () => {
        exact(run([codex({ contract: conWith(`Target: ${target}`) }).file]), 1, `FAIL target: the contract names ${target}, which needs a .md file`);
      });
    }
    test('codex and a .md -> 1', () => {
      exact(run([mdAgent({ contract: conWith('Target: codex') }).file]), 1, 'FAIL target: the contract names codex, which needs a .toml file');
    });
    test('codex and a .md -> the seal refuses, and writes nothing', () => {
      const { file } = mdAgent({ contract: conWith('Target: codex') });
      const before = readFileSync(file);
      exact(
        run(['--seal', file]),
        2,
        'FAIL target: the contract names codex, which needs a .toml file',
        'FAIL contract-rules: x.contract.md fails its file rules',
        'FAIL seal: refused; nothing written',
      );
      assert.deepEqual(readFileSync(file), before);
    });
    test('an unknown target -> 1, and never echoed', () => {
      const r = run([codex({ contract: conWith('Target: ZQXHARNESS') }).file]);
      exact(r, 1, 'FAIL target: the "Target:" line must name claude, antigravity or codex');
      assert.ok(!r.out.includes('ZQXHARNESS'), show(r));
    });
    test('two Target lines, the second after Version and Extra keys -> 1 cannot-check', () => {
      const r = run([codex({ contract: 'Version: 1.0.0\nExtra keys: model\nTarget: codex\n\n# Contract\n\nTarget: claude\n' }).file]);
      exact(r, 1, 'CANNOT-CHECK target: the contract has more than one "Target:" line');
    });
    test('a skill whose contract names a target -> 1', () => {
      const dir = skill({ contract: conWith('Target: claude') });
      exact(run([dir]), 1, "FAIL target: a skill's contract names a target; only an agent's contract has a \"Target:\" line");
    });
    test('an agent whose contract names no target -> 0 with a WARN line', () => {
      const { file } = codex({ contract: conWith('Extra keys: model') });
      sealCodex(file);
      exact(run([file]), 0, 'WARN target: the contract names no target');
    });
    test('a skill whose contract names no target prints no target line', () => {
      const dir = skill({ contract: CONTRACT });
      const c = sealAndCheck(dir);
      assert.ok(!c.lines.some(l => l.includes('target')), show(c));
    });
  });

  describe('D11 YAML flow sequences only for listed keys, never under metadata', () => {
    const INDICATOR = 'a value starting with a flow, anchor, alias, tag, block or other indicator character';
    const ITEM = 'a flow sequence item that is not a plain word of letters, digits, "_" and "-", or that YAML reads as null, a boolean, a number or a date';
    test('subagent: true with no Extra keys -> 1 cannot-check', () => {
      const r = run([mdAgent({ fm: [...defaultFm('x'), 'subagent: true'] }).file]);
      exact(
        r,
        1,
        'CANNOT-CHECK frontmatter: x.md line 4: an unquoted value YAML reads as null, a boolean, a number or a date, such as a hex, octal, binary or base-60 number or a timestamp (quote it to use it as text)',
      );
    });
    test('model: [a] with model not listed -> 1 cannot-check', () => {
      exact(run([mdAgent({ fm: [...defaultFm('x'), 'model: [a]'] }).file]), 1, `CANNOT-CHECK frontmatter: x.md line 4: ${INDICATOR}`);
    });
    test('tools: [a] with tools not listed -> 1 cannot-check', () => {
      exact(run([mdAgent({ fm: [...defaultFm('x'), 'tools: [a]'] }).file]), 1, `CANNOT-CHECK frontmatter: x.md line 4: ${INDICATOR}`);
    });
    test('tools: [a] under metadata, tools listed -> 1 cannot-check', () => {
      const r = run([mdAgent({ fm: [...defaultFm('x'), 'metadata:', '  tools: [a]'], contract: conWith('Extra keys: tools') }).file]);
      exact(r, 1, `CANNOT-CHECK frontmatter: x.md line 5: ${INDICATOR}`);
    });
    for (const v of ['[a b]', '["x"]', '[true]', '[null]', '[1]', '[2026-09-29]', '[a, ]', '[-]', '[a,, b]']) {
      test(`tools: ${v}, tools listed -> 1 cannot-check`, () => {
        const r = run([mdAgent({ fm: [...defaultFm('x'), `tools: ${v}`], contract: conWith('Extra keys: tools') }).file]);
        exact(r, 1, `CANNOT-CHECK frontmatter: x.md line 4: ${ITEM}`);
      });
    }
    test('tools: [view_file, run-command], tools listed, sealed -> 0', () => {
      const { file } = mdAgent({ fm: [...defaultFm('x'), 'tools: [view_file, run-command]'], contract: conWith('Extra keys: tools') });
      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      exact(run([file]), 0, 'PASS keys', 'PASS contract-version', 'PASS familiar-digest');
    });
  });

  describe('the test review: seal refusals and ambiguity', () => {
    test('an unsealable contract version on the .toml path -> 2, the file unchanged', () => {
      const { file } = codex({ contract: 'Version: 0.5\nTarget: codex\n' });
      const before = readFileSync(file);
      exact(
        run(['--seal', file]),
        2,
        'FAIL contract-version: the Version line in cx.contract.md must be numbers separated by at least two dots, such as 0.5.0, with an optional - or + suffix; a bare number such as 0.5 is refused',
        'FAIL seal: refused; nothing written',
      );
      assert.deepEqual(readFileSync(file), before);
    });
    test('a .toml the reader refuses -> the seal refuses with the reason, exit 2', () => {
      const { file } = codex({ lines: [...CODEX, '[x]'], contract: TCON });
      exact(run(['--seal', file]), 2, `FAIL toml: cannot check cx.toml line 6: ${R.table}`, 'FAIL seal: refused; nothing written');
    });
    function both() {
      const dir = fresh();
      writeFileSync(join(dir, 'x.md'), familiarText(defaultFm('x')));
      writeFileSync(join(dir, 'x.toml'), 'name = "x"\ndescription = "test"\ndeveloper_instructions = "Review."\n');
      return dir;
    }
    const AMBIGUOUS = 'FAIL path: both .md and .toml exist for stem "x" creating ambiguity';
    test('.md and .toml for one stem, --seal on the .md -> 2, nothing written', () => {
      const dir = both();
      writeFileSync(join(dir, 'x.contract.md'), CONTRACT);
      const before = listing(dir).map(n => readFileSync(join(dir, n)));
      exact(run(['--seal', join(dir, 'x.md')]), 2, AMBIGUOUS, 'FAIL seal: refused; nothing written');
      assert.deepEqual(listing(dir).map(n => readFileSync(join(dir, n))), before);
    });
    test('.md and .toml for one stem, from the .toml side -> 1, and 2 under --seal', () => {
      const dir = both();
      writeFileSync(join(dir, 'x.contract.md'), CONTRACT);
      exact(run([join(dir, 'x.toml')]), 1, AMBIGUOUS);
      exact(run(['--seal', join(dir, 'x.toml')]), 2, AMBIGUOUS, 'FAIL seal: refused; nothing written');
    });
    test('ambiguity plus a case-variant contract name -> both problems reported', () => {
      const dir = both();
      writeFileSync(join(dir, 'x.Contract.md'), CONTRACT);
      exact(run([join(dir, 'x.toml')]), 1, AMBIGUOUS, 'FAIL contract-file: file must be named "x.contract.md" (found "x.Contract.md")');
    });
  });
});
