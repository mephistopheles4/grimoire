// Tests of skills/contract/scripts/check.mjs: the three warnings that follow
// Anthropic's Skills docs for a skill — a reserved word in the name, an XML
// tag in the description, and a long reference file with no contents heading.
// Each only warns: never a failure, a cannot-check line or a throw, so none
// can block a seal. How every case drives the check, and the fixture they
// share, are in contract-fixture.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fresh, run, has, show, expect, once, CONTRACT, familiarText, skill, sealAndCheck, trySymlink, put } from './contract-fixture.mjs';

const RULE = "a rule Anthropic's Skills docs set and the open Agent Skills specification does not";
const CANARY = 'zq-canary-5d1';

/** The exit code, and each line printed exactly as given, exactly once. */
function exactlyOnce(r, code, ...lines) {
  expect(r, code);
  for (const l of lines) once(r, l);
}

/** No line for the rule, and no internal error. */
function none(r, rule) {
  assert.ok(!has(r, `WARN ${rule}`) && !has(r, `FAIL ${rule}`) && !has(r, `CANNOT-CHECK ${rule}`), `a ${rule} line\n${show(r)}`);
  assert.ok(!has(r, 'CANNOT-CHECK internal'), show(r));
}

/** Seal, then check: both exit 0, and both print each line exactly once. */
function sealThenCheck(dir, ...lines) {
  const s = run(['--seal', dir]);
  exactlyOnce(s, 0, ...lines);
  assert.ok(has(s, 'PASS seal: wrote '), show(s));
  exactlyOnce(sealAndCheck(dir), 0, ...lines);
}

/** An agent .md file with no contract. */
function mdAgent(name, description) {
  const file = join(fresh(), `${name}.md`);
  writeFileSync(file, familiarText([`name: ${name}`, `description: ${description}`]));
  return file;
}

/** A Codex agent .toml file with no contract. */
function tomlAgent(name, description) {
  const file = join(fresh(), `${name}.toml`);
  writeFileSync(file, `name = "${name}"\ndescription = "${description}"\ndeveloper_instructions = "Review."\n`);
  return file;
}

// ------------------------------------------------------------------ reserved-name

describe('reserved-name: a skill name holding "anthropic" or "claude" warns', () => {
  const want = words => `WARN reserved-name: the name holds the reserved ${words} (${RULE})`;

  for (const [name, words] of [
    ['claude-helper', 'word "claude"'],
    ['anthropic-tools', 'word "anthropic"'],
    ['claudette', 'word "claude"'],
    ['anthropic-claude', 'words "anthropic" and "claude"'],
  ]) {
    test(`${name} -> 0 with the warning, once`, () => {
      exactlyOnce(run([skill({ name })]), 0, `PASS name: ${name}`, want(words));
    });
  }

  test('a clean name -> 0 and no line', () => {
    const r = run([skill({ name: 'helper' })]);
    expect(r, 0, 'PASS name: helper');
    none(r, 'reserved-name');
  });

  test('a name that fails its shape rule gets that failure and no reserved-name line', () => {
    const r = run([skill({ name: 'Claude-Helper' })]);
    expect(r, 1, 'FAIL name: line 2: must be lower-case letters');
    none(r, 'reserved-name');
  });

  test('a name that fails its length rule gets that failure and no reserved-name line', () => {
    const name = `claude-${'a'.repeat(60)}`;
    const r = run([skill({ name })]);
    expect(r, 1, 'FAIL name: line 2: must be 1-64 characters');
    none(r, 'reserved-name');
  });

  test('an agent .md file named claude-reviewer -> no line', () => {
    const r = run([mdAgent('claude-reviewer', 'Reviews code.')]);
    expect(r, 0, 'PASS name: claude-reviewer');
    none(r, 'reserved-name');
  });

  test('an agent .toml file named claude-reviewer -> no line', () => {
    const r = run([tomlAgent('claude-reviewer', 'Reviews code.')]);
    expect(r, 0, 'PASS name: claude-reviewer');
    none(r, 'reserved-name');
  });

  test('sealed, then checked -> both 0 with the warning', () => {
    sealThenCheck(skill({ name: 'claude-helper', contract: CONTRACT }), want('word "claude"'));
  });
});

// ------------------------------------------------------------------ description-xml

describe('description-xml: a skill description holding a tag-shaped <...> warns', () => {
  const want = `WARN description-xml: line 3: the description holds an XML tag (${RULE})`;
  const withDesc = description => skill({ fm: ['name: demo', `description: ${description}`] });

  for (const d of ['Makes text <b>bold.', 'Ends a tag </b> here.', 'Fills in <name> for you.', 'Wraps <a href="x">a link</a>.']) {
    test(`"${d}" -> 0 with the warning, once`, () => {
      exactlyOnce(run([withDesc(d)]), 0, 'PASS description', want);
    });
  }

  for (const d of ['Checks that a < b holds.', 'Maps x -> y.', 'Says <3 to you.', 'Compares < b> forms.', 'Ends on a bare <', 'Holds <> and </>.']) {
    test(`"${d}" -> 0 and no line`, () => {
      const r = run([withDesc(d)]);
      expect(r, 0, 'PASS description');
      none(r, 'description-xml');
    });
  }

  test('a block description holding a tag on its second line -> 0 with the warning', () => {
    const dir = skill({ fm: ['name: demo', 'description: >', '  Does one thing,', '  and <b>only</b> that.'] });
    exactlyOnce(run([dir]), 0, 'PASS description', want);
  });

  test('a description over 1,024 characters gets the length failure and no XML line', () => {
    const r = run([withDesc(`${'d'.repeat(1020)} <b>x</b>`)]);
    expect(r, 1, 'FAIL description: line 3: longer than 1024 characters');
    none(r, 'description-xml');
  });

  test('1,024 characters of "<a" and no ">" -> 0, no line, and quickly', () => {
    const started = Date.now();
    const r = run([withDesc('<a'.repeat(512))]);
    expect(r, 0, 'PASS description');
    none(r, 'description-xml');
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  });

  test('the warning never echoes the description', () => {
    const r = run([withDesc(`Wraps <b>${CANARY}</b>.`)]);
    exactlyOnce(r, 0, want);
    assert.ok(!r.out.includes(CANARY), show(r));
  });

  test('an agent .md file with a tag in its description -> no line', () => {
    const r = run([mdAgent('x', 'Reviews <b>code</b>.')]);
    expect(r, 0, 'PASS description');
    none(r, 'description-xml');
  });

  test('an agent .toml file with a tag in its description -> no line', () => {
    const r = run([tomlAgent('cx', 'Reviews <b>code</b>.')]);
    expect(r, 0, 'PASS description');
    none(r, 'description-xml');
  });

  test('sealed, then checked -> both 0 with the warning', () => {
    const dir = skill({ fm: ['name: demo', 'description: Makes text <b>bold.'], contract: CONTRACT });
    sealThenCheck(dir, want);
  });
});

// ------------------------------------------------------------------ contents

describe('contents: a long .md file in a skill folder with no contents heading warns', () => {
  const want = (rel, n) => `WARN contents: "${rel}" has ${n} lines and no Contents heading in its first 30 (${RULE})`;
  /** n lines of text, each "line <i>", with `heading` as line `at` when given, ending in a line break. */
  const text = (n, at, heading = '## Contents') => `${Array.from({ length: n }, (_, i) => (i + 1 === at ? heading : `line ${i + 1}`)).join('\n')}\n`;
  const withFiles = files => {
    const dir = skill();
    for (const [rel, content] of Object.entries(files)) put(dir, rel, content);
    return dir;
  };
  const quiet = dir => {
    const r = run([dir]);
    expect(r, 0, 'PASS folder');
    none(r, 'contents');
  };

  test('100 lines, no heading -> 0 and no line', () => quiet(withFiles({ 'references/long.md': text(100) })));
  test('101 lines, no heading -> 0 with the warning, once', () => {
    exactlyOnce(run([withFiles({ 'references/long.md': text(101) })]), 0, want('references/long.md', 101));
  });
  test('101 lines, "## Contents" on line 30 -> 0 and no line', () => quiet(withFiles({ 'references/long.md': text(101, 30) })));
  test('101 lines, "## Contents" on line 31 -> 0 with the warning', () => {
    exactlyOnce(run([withFiles({ 'references/long.md': text(101, 31) })]), 0, want('references/long.md', 101));
  });

  describe('lines are counted as the body-line count counts them', () => {
    const bare = n => text(n).slice(0, -1);
    test('100 lines and no final line break -> no line', () => quiet(withFiles({ 'references/long.md': bare(100) })));
    test('101 lines and no final line break -> the warning', () => {
      exactlyOnce(run([withFiles({ 'references/long.md': bare(101) })]), 0, want('references/long.md', 101));
    });
    test('100 lines and one more empty line -> the warning at 101', () => {
      exactlyOnce(run([withFiles({ 'references/long.md': `${text(100)}\n` })]), 0, want('references/long.md', 101));
    });
    test('100 CRLF lines -> no line; 101 -> the warning', () => {
      quiet(withFiles({ 'references/long.md': text(100).replaceAll('\n', '\r\n') }));
      exactlyOnce(run([withFiles({ 'references/long.md': text(101).replaceAll('\n', '\r\n') })]), 0, want('references/long.md', 101));
    });
    test('a CRLF "## Contents" line counts as the heading', () => {
      quiet(withFiles({ 'references/long.md': text(101, 1).replaceAll('\n', '\r\n') }));
    });
    test('a byte-order mark before "## Contents" on line 1 is not part of the heading', () => {
      quiet(withFiles({ 'references/long.md': `\u{FEFF}${text(101, 1)}` }));
    });
  });

  describe('what counts as a Contents heading', () => {
    for (const heading of ['# Contents', '###### Contents', '## contents', '## CONTENTS', '   ## Contents', '##\tContents', '## Contents ##', '## Contents   ', '##   Contents']) {
      test(`"${heading}" -> no line`, () => quiet(withFiles({ 'references/long.md': text(101, 5, heading) })));
    }
    for (const heading of ['##Contents', '    ## Contents', '####### Contents', '## Table of Contents', '## Contents list', 'Contents', '> ## Contents', '## Content']) {
      test(`"${heading}" -> the warning`, () => {
        exactlyOnce(run([withFiles({ 'references/long.md': text(101, 5, heading) })]), 0, want('references/long.md', 101));
      });
    }
  });

  describe('which files it reads', () => {
    test('a long top-level README.md -> no line', () => quiet(withFiles({ 'README.md': text(150) })));
    test('a long README.md under references/ -> the warning', () => {
      exactlyOnce(run([withFiles({ 'references/README.md': text(150) })]), 0, want('references/README.md', 150));
    });
    test('a long top-level .md file other than README.md -> the warning', () => {
      exactlyOnce(run([withFiles({ 'guide.md': text(120) })]), 0, want('guide.md', 120));
    });
    test('a long .md file two folders down -> the warning', () => {
      exactlyOnce(run([withFiles({ 'references/deep/long.md': text(101) })]), 0, want('references/deep/long.md', 101));
    });
    test('a long file that is not .md -> no line', () => quiet(withFiles({ 'references/long.txt': text(200), 'scripts/run.mjs': text(200) })));
    test('a long SKILL.md body -> the body-length warning and no contents line', () => {
      const r = run([skill({ body: text(600) })]);
      expect(r, 0, 'WARN body-length: body is 600 lines');
      none(r, 'contents');
    });
    test('a long top-level CONTRACT.md -> no contents line', () => {
      const r = sealAndCheck(skill({ contract: `${CONTRACT}${text(200)}` }));
      none(r, 'contents');
    });
    test('two long files -> two warnings, in path order', () => {
      const r = run([withFiles({ 'references/b.md': text(130), 'references/a.md': text(110) })]);
      const a = want('references/a.md', 110);
      const b = want('references/b.md', 130);
      exactlyOnce(r, 0, a, b);
      assert.ok(r.lines.indexOf(a) < r.lines.indexOf(b), show(r));
    });
    test("the warning never echoes the file's contents", () => {
      const r = run([withFiles({ 'references/long.md': `${CANARY}\n${text(120)}` })]);
      exactlyOnce(r, 0, want('references/long.md', 121));
      assert.ok(!r.out.includes(CANARY), show(r));
    });
  });

  describe('a hostile reference file stays linear', () => {
    // A heading regex such as /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/ backtracks
    // quadratically on a long run of spaces. The rule uses string operations,
    // so each case finishes in about the time Node takes to start.
    const BOUND = 10_000;
    const lineOfSpaces = ' '.repeat(1_000_000);
    for (const [label, first, warns] of [
      ['a first line of a million spaces', lineOfSpaces, true],
      ['"##", a million spaces, then "Contents"', `##${lineOfSpaces}Contents`, false],
      ['"## Contents", then a million spaces', `## Contents${lineOfSpaces}`, false],
      ['"## x", then a million spaces and "#"', `## x${lineOfSpaces}#`, true],
    ]) {
      test(`${label} -> ${warns ? 'one warning' : 'no line'}, within ${BOUND / 1000} s`, () => {
        const content = `${first}\n${text(101)}`;
        assert.ok(Buffer.byteLength(content) < 1024 * 1024, 'the fixture must stay under the 1 MiB cap');
        const dir = withFiles({ 'references/long.md': content });
        const started = Date.now();
        const r = run([dir]);
        const took = Date.now() - started;
        if (warns) exactlyOnce(r, 0, want('references/long.md', 102));
        else quiet(dir);
        assert.ok(took < BOUND, `took ${took} ms`);
      });
    }
  });

  test('a folder the walk cannot read -> 1, the cannot-check folder line, and no contents or internal line', t => {
    const dir = withFiles({ 'references/long.md': text(101) });
    const target = join(dir, '..', 'outside');
    mkdirSync(target);
    writeFileSync(join(target, 'b.md'), text(101));
    const refused = trySymlink(target, join(dir, 'references', 'linked'), 'junction');
    if (refused) {
      t.skip(`folder link creation failed on this platform: ${refused}`);
      return;
    }
    const r = run([dir]);
    expect(r, 1, 'CANNOT-CHECK folder: "references/linked" is not a regular file or folder');
    none(r, 'contents');
  });

  test('sealed, then checked -> both 0 with the warning', () => {
    const dir = skill({ contract: CONTRACT });
    put(dir, 'references/long.md', text(101));
    sealThenCheck(dir, want('references/long.md', 101));
  });
});

// ------------------------------------------------------------------ all three

test('all three at once, sealed, then checked -> both 0 with each warning', () => {
  const dir = skill({ name: 'claude-helper', fm: ['name: claude-helper', 'description: Makes text <b>bold.'], contract: CONTRACT });
  put(dir, 'references/long.md', `${Array.from({ length: 101 }, (_, i) => `line ${i + 1}`).join('\n')}\n`);
  sealThenCheck(
    dir,
    `WARN reserved-name: the name holds the reserved word "claude" (${RULE})`,
    `WARN description-xml: line 3: the description holds an XML tag (${RULE})`,
    `WARN contents: "references/long.md" has 101 lines and no Contents heading in its first 30 (${RULE})`,
  );
});
