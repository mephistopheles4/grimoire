// Tests of skills/contract/scripts/check.mjs: the first plan (S10), the plain
// contract-version, mutations, usage, probes and TOML strings. How every case
// drives the check, and the fixture they share, are in contract-fixture.mjs.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { root } from './helpers.mjs';
import { fresh, run, has, show, expect, CONTRACT, BROKEN, familiarText, defaultFm, skill, sealAndCheck, editFile, digestOf, tryMkdir, trySymlink, listing } from './contract-fixture.mjs';

// ------------------------------------------------------------------ S10

describe('S10', () => {
  test('1 valid skill, unmarked, no contract -> 0, not built from a contract', () => {
    expect(run([skill()]), 0, 'PASS contract: not built from a contract', 'PASS name: demo');
  });

  test('2 valid skill with a > multi-line description -> 0', () => {
    const dir = skill({ fm: ['name: demo', 'description: >', '  Use when a thing', '  needs doing: carefully.', '', '  Second paragraph.'] });
    expect(run([dir]), 0, 'PASS description', 'PASS frontmatter');
  });

  test('3 skill.md lower case in the folder -> 1, names the file', () => {
    const dir = join(fresh(), 'demo');
    mkdirSync(dir);
    writeFileSync(join(dir, 'skill.md'), familiarText(defaultFm('demo')));
    expect(run([dir]), 1, 'FAIL familiar-file: file must be named SKILL.md (found "skill.md")');
  });

  describe('4 name rules -> each 1', () => {
    const cases = [
      ['upper case', 'Demo', 'Demo'],
      ['underscore', 'de_mo', 'de_mo'],
      ['double hyphen', 'de--mo', 'de--mo'],
      ['leading hyphen', '-demo', '-demo'],
      ['trailing hyphen', 'demo-', 'demo-'],
      ['65 chars', 'a'.repeat(65), 'a'.repeat(65)],
    ];
    for (const [label, name, folder] of cases) {
      test(label, () => {
        const r = run([skill({ name, folder })]);
        expect(r, 1, 'FAIL name: ');
        assert.ok(has(r, 'PASS name-matches-folder'), `folder should match, only the name rule fails\n${show(r)}`);
      });
    }
    test('64 chars passes (boundary)', () => {
      expect(run([skill({ name: 'a'.repeat(64) })]), 0, 'PASS name: ');
    });
    test('empty', () => {
      expect(run([skill({ folder: 'demo', fm: ['name: ""', 'description: A test skill.'] })]), 1, 'FAIL name: ');
    });
    test('mismatched folder', () => {
      const r = run([skill({ name: 'demo', folder: 'other' })]);
      expect(r, 1, 'PASS name: demo', 'FAIL name-matches-folder: name "demo" differs from the folder "other"');
    });
  });

  describe('5 name and description presence and length', () => {
    test('missing name -> 1', () => {
      expect(run([skill({ fm: ['description: A test skill.'] })]), 1, 'FAIL name: missing');
    });
    test('missing description -> 1', () => {
      expect(run([skill({ fm: ['name: demo'] })]), 1, 'FAIL description: missing');
    });
    test('empty description -> 1', () => {
      expect(run([skill({ fm: ['name: demo', 'description: "   "'] })]), 1, 'FAIL description: line 3: empty');
    });
    test('description 1,025 chars -> 1', () => {
      expect(run([skill({ fm: ['name: demo', `description: ${'d'.repeat(1025)}`] })]), 1, 'FAIL description: line 3: longer than 1024');
    });
    test('description exactly 1,024 chars -> 0', () => {
      expect(run([skill({ fm: ['name: demo', `description: ${'d'.repeat(1024)}`] })]), 0, 'PASS description');
    });
  });

  describe('6 compatibility', () => {
    test('empty -> 1', () => {
      expect(run([skill({ fm: [...defaultFm('demo'), 'compatibility: ""'] })]), 1, 'FAIL compatibility: ');
    });
    test('501 chars -> 1', () => {
      expect(run([skill({ fm: [...defaultFm('demo'), `compatibility: ${'c'.repeat(501)}`] })]), 1, 'FAIL compatibility: ');
    });
    test('500 chars -> 0 (boundary)', () => {
      expect(run([skill({ fm: [...defaultFm('demo'), `compatibility: ${'c'.repeat(500)}`] })]), 0, 'PASS compatibility');
    });
  });

  describe('6b license and allowed-tools are one line', () => {
    for (const key of ['license', 'allowed-tools']) {
      test(`${key} as a two-line | block -> 1`, () => {
        const r = run([skill({ fm: [...defaultFm('demo'), `${key}: |`, '  first line', '  second line'] })]);
        expect(r, 1, `FAIL ${key}: line 4: must be one line`);
      });
      test(`${key} as a >- block -> 0`, () => {
        expect(run([skill({ fm: [...defaultFm('demo'), `${key}: >-`, '  one line'] })]), 0, `PASS ${key}`);
      });
    }
  });

  describe('7 metadata', () => {
    test('nested map -> 1 cannot-check', () => {
      const r = run([skill({ fm: [...defaultFm('demo'), 'metadata:', '  owner:', '    team: x'] })]);
      expect(r, 1, 'CANNOT-CHECK frontmatter: SKILL.md line 5: metadata key "owner" has no value on its line');
    });
    test('non-string (flow value) -> 1', () => {
      const r = run([skill({ fm: [...defaultFm('demo'), 'metadata:', '  tags: [a, b]'] })]);
      expect(r, 1, 'CANNOT-CHECK frontmatter: SKILL.md line 5: a value starting with a flow, anchor, alias, tag, block or other indicator character');
    });
    test('string values -> 0', () => {
      const r = run([skill({ fm: [...defaultFm('demo'), 'metadata:', '  owner: team-x', "  since: '2026'"] })]);
      expect(r, 0, 'PASS metadata');
    });
    test('metadata holding a text value, not a map -> 1', () => {
      expect(run([skill({ fm: [...defaultFm('demo'), 'metadata: team-x'] })]), 1, 'FAIL metadata: line 4: must be a map');
    });
    test('an upper-case metadata key -> 1 cannot-check', () => {
      const r = run([skill({ fm: [...defaultFm('demo'), 'metadata:', '  Owner: team-x'] })]);
      expect(r, 1, 'CANNOT-CHECK frontmatter: SKILL.md line 5: a metadata key outside the readable subset');
    });
  });

  describe('8 frontmatter shape', () => {
    test('no frontmatter -> 1', () => {
      expect(run([skill({ text: '# Demo\n\nNo frontmatter here.\n' })]), 1, 'FAIL frontmatter: no frontmatter');
    });
    test('{name: x} -> 1 cannot-check', () => {
      expect(run([skill({ text: '---\n{name: x}\n---\nBody.\n' })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 2');
    });
  });

  describe('9 colon in a value', () => {
    test('plain "Use when: pushing" -> 1 cannot-check', () => {
      expect(run([skill({ fm: ['name: demo', 'description: Use when: pushing'] })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 3');
    });
    test('quoted "Use when: pushing" -> 0', () => {
      expect(run([skill({ fm: ['name: demo', 'description: "Use when: pushing"'] })]), 0, 'PASS description');
    });
  });

  describe('10 comments', () => {
    test('full-line comment -> 0', () => {
      expect(run([skill({ fm: ['# a comment', 'name: demo', '  # indented comment', 'description: A test skill.'] })]), 0, 'PASS frontmatter');
    });
    test('trailing # note after a value -> 1 cannot-check', () => {
      expect(run([skill({ fm: ['name: demo # note', 'description: A test skill.'] })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 2');
    });
  });

  describe('11 duplicates', () => {
    test('duplicate name -> 1 cannot-check', () => {
      expect(run([skill({ fm: ['name: demo', 'name: demo', 'description: A test skill.'] })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 3: duplicate key "name"');
    });
    test('duplicate metadata block -> 1 cannot-check', () => {
      const fm = [...defaultFm('demo'), 'metadata:', '  a: "1"', 'metadata:', '  b: "2"'];
      expect(run([skill({ fm })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 6: duplicate key "metadata"');
    });
    test('duplicate metadata key -> 1 cannot-check', () => {
      const fm = [...defaultFm('demo'), 'metadata:', '  a: "1"', '  a: "2"'];
      expect(run([skill({ fm })]), 1, 'CANNOT-CHECK frontmatter: SKILL.md line 6: duplicate metadata key "a"');
    });
  });

  describe('12 unknown keys', () => {
    test('permissionMode with no contract -> 1', () => {
      const r = run([skill({ fm: [...defaultFm('demo'), 'permissionMode: x'] })]);
      expect(r, 1, 'FAIL keys: unknown key "permissionMode" at line 4');
    });
    test('permissionMode listed in Extra keys, sealed -> 0', () => {
      const dir = skill({ fm: [...defaultFm('demo'), 'permissionMode: x'], contract: 'Version: 1.0.0\nExtra keys: tools, permissionMode\n' });
      const c = sealAndCheck(dir);
      assert.ok(has(c, 'PASS keys'), show(c));
    });
  });

  test('13 600-line body -> 0 with a WARN line', () => {
    const body = `${Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
    expect(run([skill({ body })]), 0, 'WARN body-length: body is 600 lines');
  });

  test('14 2 MiB file -> 1 cannot-check', () => {
    const body = `${'x'.repeat(2 * 1024 * 1024)}\n`;
    expect(run([skill({ body })]), 1, 'CANNOT-CHECK familiar-read: SKILL.md is larger than 1 MiB');
  });

  describe('15 invisible characters', () => {
    test('U+200B in the description -> 1', () => {
      const r = run([skill({ fm: ['name: demo', 'description: A test\u{200B} skill.'] })]);
      expect(r, 1, 'FAIL invisible-characters: SKILL.md line 3 holds U+200B');
    });
    test('U+200B in the contract -> 1', () => {
      // Sealed over a clean contract first, because a seal now refuses a
      // contract that fails (case 27). The character arrives afterwards.
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'CONTRACT.md'), 'What this', 'What\u{200B} this');
      expect(run([dir]), 1, 'FAIL invisible-characters: CONTRACT.md line 5 holds U+200B', 'FAIL contract-digest');
    });
  });

  test('16 seal a valid skill with contract -> 0; then check -> 0', () => {
    sealAndCheck(skill({ contract: CONTRACT }));
  });

  describe('17 after sealing', () => {
    test('edit one body line -> 1 familiar-digest', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'SKILL.md'), 'Body text.', 'Body text, edited.');
      expect(run([dir]), 1, BROKEN);
    });
    test('change one word of description -> 1', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'SKILL.md'), 'does one thing', 'does two thing');
      expect(run([dir]), 1, 'FAIL familiar-digest');
    });
    test('add permissionMode: x (contract allows it) -> 1 familiar-digest', () => {
      const dir = skill({ contract: 'Version: 1.0.0\nExtra keys: permissionMode\n' });
      sealAndCheck(dir);
      editFile(join(dir, 'SKILL.md'), 'name: demo\n', 'name: demo\npermissionMode: x\n');
      expect(run([dir]), 1, 'FAIL familiar-digest', 'PASS keys');
    });
    test('add permissionMode: x (contract silent) -> 1', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'SKILL.md'), 'name: demo\n', 'name: demo\npermissionMode: x\n');
      expect(run([dir]), 1, 'FAIL keys: unknown key "permissionMode"', 'FAIL familiar-digest');
    });
    test('edit the contract without changing Version: -> 1 contract-digest', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'CONTRACT.md'), 'What this familiar is for.', 'What this familiar is really for.');
      expect(
        run([dir]),
        1,
        'FAIL contract-digest: line 7: the seal is broken; CONTRACT.md changed since the familiar was sealed',
        'PASS contract-version',
        'PASS familiar-digest',
      );
    });
    test('change Version: only -> 1 contract-version', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'CONTRACT.md'), 'Version: 1.0.0', 'Version: 2.0.0');
      expect(run([dir]), 1, 'FAIL contract-version');
    });
    test("hand-edit the mark's contract-version -> 1 contract-version (digests still pass)", () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      editFile(join(dir, 'SKILL.md'), 'contract-version: 1.0.0', 'contract-version: 9.0.0');
      expect(run([dir]), 1, 'FAIL contract-version', 'PASS familiar-digest', 'PASS contract-digest');
    });
  });

  describe('18 matrix', () => {
    test('marked skill, contract deleted -> 1', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      unlinkSync(join(dir, 'CONTRACT.md'));
      expect(run([dir]), 1, 'FAIL contract: marked, but its contract is missing');
    });
    test('unmarked skill with a contract -> 1', () => {
      expect(run([skill({ contract: CONTRACT })]), 1, 'FAIL contract: contract present, but the file is not sealed');
    });
    test('partial mark -> 1', () => {
      const dir = skill({ contract: CONTRACT });
      sealAndCheck(dir);
      const p = join(dir, 'SKILL.md');
      const t = readFileSync(p, 'utf8');
      writeFileSync(p, t.split('\n').filter(l => !l.startsWith('  contract-digest:')).join('\n'));
      expect(run([dir]), 1, 'FAIL mark: partial mark; missing contract-digest');
    });
  });

  describe('19 seal refusals', () => {
    test('familiar is a symlink -> 2, target unchanged', t => {
      const dirBase = fresh();
      const target = join(dirBase, 'target.md');
      const original = familiarText(defaultFm('demo'));
      writeFileSync(target, original);
      const dir = join(dirBase, 'demo');
      mkdirSync(dir);
      writeFileSync(join(dir, 'CONTRACT.md'), CONTRACT);
      const refused = trySymlink(target, join(dir, 'SKILL.md'), 'file');
      if (refused) {
        t.skip(`symlink creation failed on this platform: ${refused}`);
        return;
      }
      const r = run(['--seal', dir]);
      expect(r, 2, 'FAIL familiar-file: SKILL.md is not a regular file', 'FAIL seal: refused; nothing written');
      assert.equal(readFileSync(target, 'utf8'), original);
    });
    test('familiar fails the field rules -> 2, file unchanged', () => {
      const dir = skill({ fm: ['name: demo'], contract: CONTRACT });
      const before = readFileSync(join(dir, 'SKILL.md'));
      const r = run(['--seal', dir]);
      expect(r, 2, 'FAIL description: missing', 'FAIL field-rules', 'FAIL seal: refused; nothing written');
      assert.deepEqual(readFileSync(join(dir, 'SKILL.md')), before);
    });
    test('contract has no Version: -> 2', () => {
      const dir = skill({ contract: '# Contract\n\nNo version line.\n' });
      const before = readFileSync(join(dir, 'SKILL.md'));
      const r = run(['--seal', dir]);
      expect(r, 2, 'FAIL contract-version: CONTRACT.md has no "Version:" line', 'FAIL seal: refused; nothing written');
      assert.deepEqual(readFileSync(join(dir, 'SKILL.md')), before);
    });
  });

  describe('20 agent mode', () => {
    function agent({ stem = 'x', name = 'x', contract } = {}) {
      const dir = fresh();
      writeFileSync(join(dir, `${stem}.md`), familiarText(defaultFm(name)));
      if (contract !== undefined) writeFileSync(join(dir, `${stem}.contract.md`), contract);
      return { dir, file: join(dir, `${stem}.md`) };
    }
    test('x.md + x.contract.md, sealed -> 0', () => {
      const { file } = agent({ contract: CONTRACT });
      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      expect(run([file]), 0, 'PASS name-matches-file', 'PASS familiar-digest', 'PASS contract-digest');
    });
    test('stem differs from name -> 1', () => {
      const { file } = agent({ stem: 'y', name: 'x' });
      expect(run([file]), 1, 'FAIL name-matches-file: name "x" differs from the file stem "y"');
    });
    test('marked agent with no sibling contract -> 1', () => {
      const { dir, file } = agent({ contract: CONTRACT });
      expect(run(['--seal', file]), 0);
      unlinkSync(join(dir, 'x.contract.md'));
      expect(run([file]), 1, 'FAIL contract: marked, but its contract is missing');
    });
    test('unmarked agent, no contract -> 0', () => {
      const { file } = agent();
      expect(run([file]), 0, 'PASS contract: not built from a contract');
    });
    test('x.contract.md given as the path -> 2', () => {
      const { dir } = agent({ contract: CONTRACT });
      expect(run([join(dir, 'x.contract.md')]), 2, "FAIL path: give the familiar's file, not its contract");
    });
    test('X.Contract.md given -> 2', () => {
      const dir = fresh();
      writeFileSync(join(dir, 'X.md'), familiarText(defaultFm('x')));
      writeFileSync(join(dir, 'X.Contract.md'), CONTRACT);
      expect(run([join(dir, 'X.Contract.md')]), 2, "FAIL path: give the familiar's file, not its contract");
    });
    test('case-variant sibling contract fails by name, and still counts as a contract -> 1', () => {
      // Counted as present, so an unmarked file beside it is reported as
      // unsealed, not as "not built from a contract".
      const dir = fresh();
      writeFileSync(join(dir, 'x.md'), familiarText(defaultFm('x')));
      writeFileSync(join(dir, 'x.CONTRACT.md'), CONTRACT);
      const r = run([join(dir, 'x.md')]);
      expect(
        r,
        1,
        'FAIL contract-file: file must be named "x.contract.md" (found "x.CONTRACT.md")',
        'FAIL contract: contract present, but the file is not sealed',
      );
      assert.ok(!has(r, 'PASS contract: not built from a contract'), show(r));
    });

    test('antigravity agent with booleans and flow tools array, sealed -> 0', () => {
      const dir = fresh();
      const contract = 'Version: 1.0.0\nExtra keys: model, subagent, mainAgent, commandExecutionPolicy, tools\n\n# Contract\n';
      const fm = [
        'name: agy-agent',
        'description: A test Antigravity agent.',
        'model: pro',
        'subagent: true',
        'mainAgent: false',
        'commandExecutionPolicy: sandbox',
        'tools: [view_file, write_to_file, replace_file_content, run_command]',
      ];
      const file = join(dir, 'agy-agent.md');
      writeFileSync(file, familiarText(fm));
      writeFileSync(join(dir, 'agy-agent.contract.md'), contract);

      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      expect(run([file]), 0, 'PASS name-matches-file', 'PASS familiar-digest', 'PASS contract-digest', 'PASS keys', 'PASS contract-version');
    });

    test('codex agent in TOML format, sealed with a trailing comment block and tamper checked -> 0', () => {
      // Codex will not load an agent file with a [metadata] table, so the
      // mark is three comment lines at the end of the file instead.
      const dir = fresh();
      const contract = 'Version: 1.0.0\nExtra keys: model, model_reasoning_effort\n\n# Contract\n';
      const tomlContent = [
        'name = "codex-agent"',
        'description = "A test OpenAI Codex agent."',
        'model = "o3-mini"',
        'model_reasoning_effort = "high"',
        'sandbox_mode = "workspace-write"',
        'developer_instructions = """',
        'You are an agent that writes code.',
        '"""',
      ].join('\n') + '\n';
      const file = join(dir, 'codex-agent.toml');
      writeFileSync(file, tomlContent);
      writeFileSync(join(dir, 'codex-agent.contract.md'), contract);

      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      const sealed = readFileSync(file, 'utf8');
      assert.ok(!sealed.includes('[metadata]'), 'a [metadata] table in the sealed toml');
      assert.ok(sealed.startsWith(tomlContent), 'the seal changed a line above the mark');
      assert.match(
        sealed.slice(tomlContent.length),
        /^# contract-version = "1\.0\.0"\n# familiar-digest = "sha256:[0-9a-f]{64}"\n# contract-digest = "sha256:[0-9a-f]{64}"\n$/,
      );

      expect(run([file]), 0, 'PASS name-matches-file', 'PASS familiar-digest', 'PASS contract-digest', 'PASS toml', 'PASS contract-version');

      editFile(file, 'writes code', 'writes bugs');
      expect(run([file]), 1, 'FAIL familiar-digest: line 10: the seal is broken; codex-agent.toml changed since it was sealed');
    });

    test('claude code agent with tools string, sealed -> 0', () => {
      const dir = fresh();
      const contract = 'Version: 1.0.0\nExtra keys: model, effort, tools\n\n# Contract\n';
      const fm = [
        'name: claude-agent',
        'description: A test Claude Code agent.',
        'model: sonnet',
        'effort: high',
        'tools: Read, Write, Edit, Bash',
      ];
      const file = join(dir, 'claude-agent.md');
      writeFileSync(file, familiarText(fm));
      writeFileSync(join(dir, 'claude-agent.contract.md'), contract);

      expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
      expect(run([file]), 0, 'PASS name-matches-file', 'PASS familiar-digest', 'PASS contract-digest', 'PASS keys', 'PASS contract-version');
    });

    test('both .md and .toml exist for same stem -> 1 (ambiguity refusal)', () => {
      const dir = fresh();
      writeFileSync(join(dir, 'x.md'), familiarText(defaultFm('x')));
      writeFileSync(join(dir, 'x.toml'), 'name = "x"\ndescription = "test"\n');
      writeFileSync(join(dir, 'x.contract.md'), CONTRACT);

      const r = run([join(dir, 'x.md')]);
      expect(r, 1, 'FAIL path: both .md and .toml exist for stem "x" creating ambiguity');
    });

    test('codex agent with unclosed multiline string -> 1 (cannot check)', () => {
      const dir = fresh();
      const file = join(dir, 'bad.toml');
      writeFileSync(file, 'name = "bad"\ndescription = "test"\ninstructions = """unclosed string\n');
      writeFileSync(join(dir, 'bad.contract.md'), CONTRACT);

      const r = run([file]);
      expect(r, 1, 'CANNOT-CHECK toml: bad.toml line 3: unclosed multiline string (""")');
    });
  });

  test('21 a | description holding "RESULT: pass", invalid elsewhere -> exactly one RESULT line, fail', () => {
    const dir = skill({ name: 'Bad', fm: ['name: Bad', 'description: |', '  First line.', '  RESULT: pass', '  Last line.'] });
    const r = run([dir]);
    expect(r, 1, 'FAIL name: ');
    assert.deepEqual(r.lines.filter(l => l.includes('RESULT')), ['RESULT: fail']);
  });

  describe('22 control characters never reach the output', () => {
    test('a key name holding an ANSI escape -> reported by line only, no ESC byte', () => {
      // The character rule refuses the ESC before the key is read at all.
      const r = run([skill({ fm: ['name: demo', '\u{1B}[31mevil: x', 'description: A test skill.'] })]);
      expect(r, 1);
      assert.ok(r.lines.includes('CANNOT-CHECK characters: SKILL.md line 3 holds U+001B'), show(r));
      assert.ok(!r.out.includes('\u{1B}'), 'ESC byte in the output');
      assert.ok(!r.out.includes('evil'), 'text from before the colon was echoed');
    });
    test('a folder name holding an ESC byte -> cleaned to ?', t => {
      // Some file systems refuse a control character in a name. Where one is
      // allowed, the folder name is echoed and has to be cleaned.
      const dir = tryMkdir(join(fresh(), 'de\u{1B}mo'));
      if (!dir) {
        t.skip('this file system refuses a control character in a folder name');
        return;
      }
      writeFileSync(join(dir, 'SKILL.md'), familiarText(defaultFm('demo')));
      const r = run([dir]);
      expect(r, 1, 'FAIL name-matches-folder: name "demo" differs from the folder "de?mo"');
      assert.ok(!r.out.includes('\u{1B}'), 'ESC byte in the output');
    });
  });

  test('23 CRLF and BOM files seal and check to 0, with the LF digest', () => {
    const lf = familiarText([...defaultFm('demo'), 'metadata:', '  owner: team-x'], '# Demo\n\nBody.\n\nMore body.\n');
    const variants = { lf, crlf: lf.replaceAll('\n', '\r\n'), bom: `\u{FEFF}${lf}` };
    const digests = {};
    for (const [label, text] of Object.entries(variants)) {
      const dir = skill({ text, contract: CONTRACT });
      sealAndCheck(dir);
      const p = join(dir, 'SKILL.md');
      digests[label] = digestOf(p);
      const after = readFileSync(p, 'utf8');
      if (label === 'crlf') {
        assert.ok(!/(^|[^\r])\n/.test(after), 'sealed CRLF file holds a bare LF');
        assert.ok(after.includes('  contract-digest: "sha256:'), 'mark written');
      }
      if (label === 'bom') assert.equal(after.charCodeAt(0), 0xfeff, 'sealed BOM file lost its BOM');
      if (label === 'lf') assert.ok(!after.includes('\r'), 'sealed LF file gained a CR');
    }
    assert.equal(digests.crlf, digests.lf);
    assert.equal(digests.bom, digests.lf);
  });

  describe("24 this repository's own skills pass as they stand", () => {
    // Read in place, not copied: the folder name, the file and anything beside
    // it are exactly what scripts/check.mjs will see.
    // eagle-eye is generated from its CONTRACT.md and sealed; groundtrack is not.
    for (const [name, contract] of [
      ['eagle-eye', 'PASS contract: marked, contract present'],
      ['groundtrack', 'PASS contract: not built from a contract'],
    ]) {
      test(name, () => {
        expect(run([join(root, 'skills', name)]), 0, `PASS name: ${name}`, contract);
      });
    }
  });
});

// ------------------------------------------------------------------ v7

// The seal writes contract-version as a plain value, because a quoted dotted
// value reads to a prose scanner as the name of a file that is not there. So
// it takes one shape only, numbers separated by at least two dots with an
// optional - or + suffix, and refuses every other version with nothing
// written. Reading stays lenient: a mark sealed before, quoted, still checks.
describe('v7 the seal writes contract-version plain', () => {
  const SHAPE = 'FAIL contract-version: the Version line in CONTRACT.md must be numbers separated by at least two dots, such as 0.5.0';
  const contractAt = v => `Version: ${v}\n\n# Contract\n\nWhat this familiar is for.\n`;
  const markLines = text => text.split('\n').filter(l => l.startsWith('  contract-version:'));

  test('Version: 0.4.3 -> sealed as a plain value, and the check passes', () => {
    const dir = skill({ contract: contractAt('0.4.3') });
    sealAndCheck(dir);
    assert.deepEqual(markLines(readFileSync(join(dir, 'SKILL.md'), 'utf8')), ['  contract-version: 0.4.3']);
  });

  test('a - or + suffix is sealed plain too', () => {
    for (const v of ['1.2.3-rc.1', '1.2.3+build-5', '10.20.30.40']) {
      const dir = skill({ contract: contractAt(v) });
      sealAndCheck(dir);
      assert.deepEqual(markLines(readFileSync(join(dir, 'SKILL.md'), 'utf8')), [`  contract-version: ${v}`], v);
    }
  });

  describe('any other version -> 2, the folder byte for byte unchanged', () => {
    for (const v of ['"0.5"', 'x:', '2026-09-27', '0.5', '1', '1.2', '1..2', '1.2.3-', '1.2.3-a+b', "'1.2.3'", 'v1.2.3']) {
      test(`Version: ${v}`, () => {
        const dir = skill({ contract: contractAt(v) });
        const fam = readFileSync(join(dir, 'SKILL.md'));
        const con = readFileSync(join(dir, 'CONTRACT.md'));
        const r = run(['--seal', dir]);
        expect(r, 2, SHAPE, 'FAIL seal: refused; nothing written');
        assert.deepEqual(readFileSync(join(dir, 'SKILL.md')), fam, 'the familiar changed');
        assert.deepEqual(readFileSync(join(dir, 'CONTRACT.md')), con, 'the contract changed');
        assert.deepEqual(listing(dir), ['CONTRACT.md', 'SKILL.md'], 'something was left behind');
      });
    }
  });

  test('the refusal never echoes the version', () => {
    const r = run(['--seal', skill({ contract: contractAt('ZQXSECRET') })]);
    expect(r, 2, SHAPE);
    assert.ok(!r.out.includes('ZQXSECRET'), show(r));
  });

  test('an agent whose contract has Version: 0.5 -> 2, the file unchanged', () => {
    const dir = fresh();
    const file = join(dir, 'x.md');
    writeFileSync(file, familiarText(defaultFm('x')));
    writeFileSync(join(dir, 'x.contract.md'), contractAt('0.5'));
    const before = readFileSync(file);
    const r = run(['--seal', file]);
    expect(r, 2, 'FAIL contract-version: the Version line in x.contract.md must be numbers separated', 'FAIL seal: refused; nothing written');
    assert.deepEqual(readFileSync(file), before);
  });

  test('a mark sealed before, with contract-version quoted -> still 0', () => {
    const dir = skill({ contract: CONTRACT });
    sealAndCheck(dir);
    editFile(join(dir, 'SKILL.md'), '  contract-version: 1.0.0\n', '  contract-version: "1.0.0"\n');
    expect(run([dir]), 0, 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest');
  });

  test('a mark sealed before over a bare-number Version: 1, quoted -> still 0', () => {
    // The seal refuses Version: 1 now, so the old mark is written by hand: the
    // familiar's digest leaves the mark lines out, and the contract's is the
    // sha256 of its text with one final line feed.
    const dir = skill({ contract: CONTRACT });
    sealAndCheck(dir);
    const old = 'Version: 1\n\n# Contract\n\nWhat this familiar is for.\n';
    writeFileSync(join(dir, 'CONTRACT.md'), old);
    const p = join(dir, 'SKILL.md');
    const text = readFileSync(p, 'utf8');
    const conDigest = `sha256:${createHash('sha256').update(old, 'utf8').digest('hex')}`;
    const next = text
      .replace('  contract-version: 1.0.0\n', '  contract-version: "1"\n')
      .replace(/ {2}contract-digest: "sha256:[0-9a-f]{64}"/, `  contract-digest: "${conDigest}"`);
    assert.notEqual(next, text, 'fixture edit did nothing');
    writeFileSync(p, next);
    expect(run([dir]), 0, 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest');
  });

  test('a second seal over a quoted mark rewrites it plain, in place', () => {
    const dir = skill({ contract: CONTRACT });
    sealAndCheck(dir);
    editFile(join(dir, 'SKILL.md'), '  contract-version: 1.0.0\n', '  contract-version: "1.0.0"\n');
    sealAndCheck(dir);
    assert.deepEqual(markLines(readFileSync(join(dir, 'SKILL.md'), 'utf8')), ['  contract-version: 1.0.0']);
  });
});

// ------------------------------------------------------------------ held by a mutation

describe('held by a mutation', () => {
  test('check mode refuses a symlinked SKILL.md rather than reading its target -> 1', t => {
    const dirBase = fresh();
    const target = join(dirBase, 'target.md');
    writeFileSync(target, familiarText(defaultFm('demo')));
    const dir = join(dirBase, 'demo');
    mkdirSync(dir);
    const refused = trySymlink(target, join(dir, 'SKILL.md'), 'file');
    if (refused) {
      t.skip(`symlink creation failed on this platform: ${refused}`);
      return;
    }
    expect(run([dir]), 1, 'FAIL familiar-file: SKILL.md is not a regular file');
  });
  test('check mode refuses a symlinked CONTRACT.md -> 1', t => {
    const dirBase = fresh();
    const dir = skill({ parent: dirBase, contract: CONTRACT });
    expect(run(['--seal', dir]), 0);
    const target = join(dirBase, 'target-contract.md');
    writeFileSync(target, CONTRACT);
    unlinkSync(join(dir, 'CONTRACT.md'));
    const refused = trySymlink(target, join(dir, 'CONTRACT.md'), 'file');
    if (refused) {
      t.skip(`symlink creation failed on this platform: ${refused}`);
      return;
    }
    expect(run([dir]), 1, 'FAIL contract-file: CONTRACT.md is not a regular file');
  });
  test('the name is compared with the folder as it is on disk, not as typed', t => {
    const dir = skill();
    const typed = join(dir, '..', 'DEMO');
    if (!existsSync(typed)) {
      t.skip('this disk does not fold case, so the typed name names no folder');
      return;
    }
    expect(run([typed]), 0, 'PASS name-matches-folder');
  });
  test('a lower-case contract.md counts as a contract as well as failing by name -> 1', () => {
    const dir = join(fresh(), 'demo');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), familiarText(defaultFm('demo')));
    writeFileSync(join(dir, 'contract.md'), CONTRACT);
    const r = run([dir]);
    expect(
      r,
      1,
      'FAIL contract-file: file must be named CONTRACT.md (found "contract.md")',
      'FAIL contract: contract present, but the file is not sealed',
    );
  });
  test('a second seal after an edit rewrites the mark in place -> 0, one mark', () => {
    const dir = skill({ contract: CONTRACT });
    sealAndCheck(dir);
    editFile(join(dir, 'SKILL.md'), 'Body text.', 'Body text, edited.');
    expect(run([dir]), 1, 'FAIL familiar-digest');
    sealAndCheck(dir);
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    assert.equal(text.split('\n').filter(l => l.startsWith('  familiar-digest:')).length, 1, text);
  });
});

// ------------------------------------------------------------------ usage

describe('usage', () => {
  test('no arguments -> 2', () => {
    expect(run([]), 2, 'FAIL usage: ');
  });
  test('--seal with no path -> 2', () => {
    expect(run(['--seal']), 2, 'FAIL usage: ');
  });
  test('unknown flag -> 2', () => {
    expect(run(['--force', skill()]), 2, 'FAIL usage: ');
  });
  test('a file that is not .md -> 2', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'x.txt'), 'x');
    expect(run([join(dir, 'x.txt')]), 2, 'FAIL path: ');
  });
  test('a path that does not exist -> 2', () => {
    expect(run([join(fresh(), 'nothing-here')]), 2, 'FAIL path: the path does not exist');
  });
});

// ------------------------------------------------------------------ probes

describe('probes P1-P7', () => {
  test('P1 a path with a space in it', () => {
    const parent = join(fresh(), 'has space');
    mkdirSync(parent);
    expect(run([skill({ parent })]), 0);
  });
  test('P2 a path ending in a separator', () => {
    expect(run([skill() + sep]), 0, 'PASS name-matches-folder');
  });
  test('P3 . inside a valid skill folder', () => {
    expect(run(['.'], skill()), 0, 'PASS name-matches-folder');
    expect(run(['.'], skill({ name: 'demo', folder: 'other' })), 1, 'FAIL name-matches-folder: name "demo" differs from the folder "other"');
  });
  test('P4 description of exactly 1,024 code points, non-ASCII -> 0; 1,025 -> 1', () => {
    const d1024 = `${'\u{E9}'.repeat(512)}${'\u{1F600}'.repeat(512)}`;
    expect(run([skill({ fm: ['name: demo', `description: ${d1024}`] })]), 0, 'PASS description');
    expect(run([skill({ fm: ['name: demo', `description: ${d1024}x`] })]), 1, 'FAIL description: ');
  });
  test('P5 a > block whose continuation lines use a tab -> 1 cannot-check', () => {
    expect(run([skill({ fm: ['name: demo', 'description: >', '\tUse when.'] })]), 1, 'CANNOT-CHECK frontmatter: ');
    expect(run([skill({ fm: ['name: demo', 'description: >', '  Use when', '\tthings.'] })]), 1, 'CANNOT-CHECK frontmatter: ');
  });
  test('P6 frontmatter never closes -> 1', () => {
    expect(run([skill({ text: '---\nname: demo\ndescription: A test skill.\n\nBody.\n' })]), 1, 'FAIL frontmatter: no frontmatter');
  });
  test('P7 seal twice -> identical file', () => {
    const dir = skill({ fm: [...defaultFm('demo'), 'metadata:', '  owner: team-x'], contract: CONTRACT });
    expect(run(['--seal', dir]), 0);
    const first = readFileSync(join(dir, 'SKILL.md'));
    expect(run(['--seal', dir]), 0);
    assert.deepEqual(readFileSync(join(dir, 'SKILL.md')), first);
  });
});

describe('multi-harness multiline and unquoted toml string tests', () => {
  const CONTRACT_TEXT = 'Version: 1.0.0\nTarget: codex\n\n# Contract\n';

  function demo(lines, contract) {
    const dir = fresh();
    const file = join(dir, 'demo.toml');
    writeFileSync(file, `${lines.join('\n')}\n`);
    if (contract !== undefined) writeFileSync(join(dir, 'demo.contract.md'), contract);
    return file;
  }

  test("a ''' multiline literal string holds a table header and a key as text -> sealed, 0", () => {
    const file = demo(
      ['name = "demo"', 'description = "A test Codex agent."', "developer_instructions = '''", 'This is a test.', '[metadata]', 'other = "ignored"', "'''"],
      CONTRACT_TEXT,
    );
    expect(run(['--seal', file]), 0, 'PASS seal: wrote ');
    expect(run([file]), 0, 'PASS toml', 'PASS keys', 'PASS contract-version', 'PASS familiar-digest', 'PASS contract-digest');
  });

  test('a """ multiline description is read whole: over 1,024 characters -> 1', () => {
    const file = demo(['name = "demo"', 'description = """', 'x'.repeat(1025), '"""', 'developer_instructions = "Review."']);
    expect(run([file]), 1, 'FAIL description: line 2: longer than 1024 characters');
  });

  test('text after a closing quote -> 1 cannot-check, for that reason alone', () => {
    const file = demo(['name = "demo"', 'description = "demo" trailing', 'developer_instructions = "Review."']);
    const r = run([file]);
    expect(r, 1);
    assert.deepEqual(
      r.lines.filter(l => !l.startsWith('PASS ') && !l.startsWith('RESULT:')),
      ['CANNOT-CHECK toml: demo.toml line 2: text after a closing quote (for example a trailing comment)'],
    );
  });

  test('an unquoted value -> 1 cannot-check', () => {
    const file = demo(['name = "demo"', 'description = "demo"', 'model = o3-mini', 'developer_instructions = "Review."']);
    expect(run([file]), 1, 'CANNOT-CHECK toml: demo.toml line 3: a value that is not a quoted string, true or false');
  });
});
