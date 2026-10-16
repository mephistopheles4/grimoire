// Tests of scripts/check.mjs: the frontmatter keys a SKILL.md may hold, and
// the hidden characters no shipped skill file may hold. The fixture they
// share, and why every case copies the tree, is in check-fixture.mjs.
//
// Every hostile character is built from its code point at run time. Written
// into this file, a line separator would end the line it sits on for any
// reader that splits on it, and the check would no longer be the only thing
// reading it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, assertPasses, assertFails } from './check-fixture.mjs';

const CR = String.fromCharCode(13);
const LS = String.fromCodePoint(0x2028);

// Text matched as itself inside a RegExp: every metacharacter escaped.
const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A skill written into the copy at run time, with the SKILL.md text given
// whole, frontmatter included.
function skill(dir, name, text) {
  const at = join(dir, 'skills', name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'SKILL.md'), text);
  return at;
}

const front = (...keys) => `---\n${keys.join('\n')}\n---\n\n# Fixture\n\nBody text.\n`;
const named = name => [`name: ${name}`, 'description: A fixture skill that exists only inside this test.'];

test('a SKILL.md with a hooks key fails, naming the file and the key', () => {
  const dir = tree();
  skill(dir, 'hooked', front(...named('hooked'), 'hooks:', '  PreToolUse: []'));
  // The whole list, so a key added to it is a change a test sees.
  assertFails(
    dir,
    /skills\/hooked\/SKILL\.md:4 has the frontmatter key "hooks", which is not one of name, description, compatibility, license, allowed-tools, metadata\./,
  );
});

test('a lowercase skill.md and a nested SKILL.md are held to the same list', () => {
  for (const at of [['lower', 'skill.md'], ['nested', 'more', 'inner', 'SKILL.md']]) {
    const dir = tree();
    const file = join(dir, 'skills', ...at);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, front(...named(at[0]), 'hooks: {}'));
    assertFails(dir, new RegExp(`skills/${literal(at.join('/'))}:4 has the frontmatter key "hooks"`));
  }
});

test('a frontmatter indented as a whole fails, though YAML reads it as top-level keys', () => {
  // The name rule passes this file on the body's margin name: line, so only
  // this rule stands between an indented hooks key and the merge.
  const dir = tree();
  skill(
    dir,
    'indented',
    `---\n  name: indented\n  description: A fixture.\n  hooks: {}\n---\n\n\`\`\`yaml\nname: example\n\`\`\`\n`,
  );
  assertFails(dir, /skills\/indented\/SKILL\.md:2 is indented before any key at the margin/);
});

test('an indented comment does not open the way for indented keys', () => {
  const dir = tree();
  skill(dir, 'commented', `---\n  # a comment\n  hooks: {}\n${named('commented').join('\n')}\n---\n\nBody.\n`);
  assertFails(dir, /skills\/commented\/SKILL\.md:3 is indented before any key at the margin/);
});

test('a fence line with anything after it does not close the frontmatter', () => {
  for (const near of ['--- x', '--- ', '----']) {
    const dir = tree();
    skill(dir, 'near', front(...named('near'), near, 'hooks: {}'));
    const r = assertFails(dir, /skills\/near\/SKILL\.md:4 holds a frontmatter line the check cannot read as one key/);
    assert.match(r.stderr, /skills\/near\/SKILL\.md:5 has the frontmatter key "hooks"/);
  }
});

test('a SKILL.md that does not open with --- on its first line fails', () => {
  const dir = tree();
  skill(dir, 'late', `\n${front(...named('late'), 'hooks: {}')}`);
  assertFails(dir, /skills\/late\/SKILL\.md does not open with a line of exactly ---/);
});

test('a line the check cannot read is masked before it is cut', () => {
  // The account name comes early and the home path that names it late, past
  // the cut. Cut first, the masker never sees the path and prints the name.
  const dir = tree();
  const line = `{note: "zqxaccount ${'a'.repeat(130)} /home/zqxaccount/x"}`;
  skill(dir, 'masked', front(...named('masked'), line));
  const r = assertFails(dir, /skills\/masked\/SKILL\.md:4 holds a frontmatter line the check cannot read/);
  assert.equal(r.stderr.includes('zqxaccount'), false, r.stderr);
});

test('a long quoted key is cut in the failure line', () => {
  const dir = tree();
  skill(dir, 'longkey', front(...named('longkey'), `"${'k'.repeat(300)}": 1`));
  const r = assertFails(dir, /skills\/longkey\/SKILL\.md:4 has the frontmatter key "k+\.\.\."/);
  assert.equal(r.stderr.includes('k'.repeat(121)), false);
});

test('a SKILL.md with only allow-listed keys passes', () => {
  // All six, with a list at the left margin under allowed-tools and a nested
  // map under metadata: neither is a key of its own.
  const dir = tree();
  skill(
    dir,
    'allowed',
    front(
      ...named('allowed'),
      'compatibility: Claude Code',
      'license: MIT',
      'allowed-tools:',
      '- Read',
      '- Grep',
      'metadata:',
      '  version: "1.0"',
      '  hooks: not a key of the frontmatter',
      '# a comment line',
      '',
    ),
  );
  assertPasses(dir);
});

test('a quoted hooks key fails like a bare one', () => {
  const dir = tree();
  skill(dir, 'quoted', front(...named('quoted'), '"hooks": {}'));
  assertFails(dir, /skills\/quoted\/SKILL\.md:4 has the frontmatter key "hooks"/);
});

test('a key in another case fails', () => {
  const dir = tree();
  skill(dir, 'cased', front(...named('cased'), 'Name: cased'));
  assertFails(dir, /skills\/cased\/SKILL\.md:4 has the frontmatter key "Name"/);
});

test('a frontmatter line that is not a key fails rather than being skipped', () => {
  // A flow map, a complex key and a merge key all set keys this rule would not
  // see by name, so each is refused as unreadable.
  for (const line of ['{hooks: {}}', '? hooks', '<<: *base']) {
    const dir = tree();
    skill(dir, 'unread', front(...named('unread'), line));
    assertFails(dir, /skills\/unread\/SKILL\.md:4 /);
  }
});

test('a key hidden behind a lone CR fails', () => {
  // YAML reads a lone CR as a line break, so this frontmatter sets hooks even
  // though no line feed comes before it.
  const dir = tree();
  skill(dir, 'hidden', `---\nname: hidden${CR}hooks: {}\ndescription: A fixture.\n---\n\nBody.\n`);
  const r = assertFails(dir, /skills\/hidden\/SKILL\.md:\d+ has the frontmatter key "hooks"/);
  assert.match(r.stderr, /skills\/hidden\/SKILL\.md:2 holds a lone CR \(U\+000D\)/);
});

test('a hooks line in the body, after the frontmatter, passes', () => {
  const dir = tree();
  skill(dir, 'body', front(...named('body')) + '\nhooks: this is prose, not frontmatter\n');
  assertPasses(dir);
});

test('a SKILL.md whose frontmatter never closes fails', () => {
  const dir = tree();
  skill(dir, 'open', `---\n${named('open').join('\n')}\nhooks: {}\n\n# Fixture\n`);
  assertFails(dir, /skills\/open\/SKILL\.md has no closing line of exactly ---/);
});

test('a file under skills/ with a lone CR fails, naming the file and the line', () => {
  const dir = tree();
  const at = skill(dir, 'cr', front(...named('cr')));
  writeFileSync(join(at, 'notes.md'), `first line\nsecond${CR}still the second\n`);
  assertFails(dir, /skills\/cr\/notes\.md:2 holds a lone CR \(U\+000D\)/);
});

test('a file under skills/ with a line separator fails', () => {
  const dir = tree();
  const at = skill(dir, 'ls', front(...named('ls')));
  mkdirSync(join(at, 'lib'));
  writeFileSync(join(at, 'lib', 'x.js'), `// one${LS}two\nexport const x = 1;\n`);
  assertFails(dir, /skills\/ls\/lib\/x\.js:1 holds U\+2028/);
});

test('each refused character kind fails', () => {
  // Both ends of every range, and a point inside each.
  for (const cp of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, 0x7f, 0x80, 0x84, 0x85, 0x9f, 0x2028, 0x2029, 0xfffe, 0xffff]) {
    const dir = tree();
    const at = skill(dir, 'kinds', front(...named('kinds')));
    writeFileSync(join(at, 'notes.txt'), `before ${String.fromCodePoint(cp)} after\n`);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    assertFails(dir, new RegExp(`skills/kinds/notes\\.txt:1 holds U\\+${hex}`));
  }
});

test('each invisible or direction-changing character fails', () => {
  // Tag characters a model reads as letters, zero-width characters, the soft
  // hyphen, a variation selector, bidi controls, and a BOM anywhere but the
  // very start of a file.
  for (const cp of [0xe0041, 0xe007f, 0x200b, 0x200d, 0x00ad, 0xfe0f, 0x202e, 0x2066, 0x061c, 0x200e, 0xfeff]) {
    const dir = tree();
    const at = skill(dir, 'invisible', front(...named('invisible')));
    writeFileSync(join(at, 'notes.md'), `before ${String.fromCodePoint(cp)} after\n`);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    assertFails(dir, new RegExp(`skills/invisible/notes\\.md:1 holds U\\+${hex}\\b`));
  }
});

test('a BOM at the very start of a file passes', () => {
  const dir = tree();
  const at = skill(dir, 'bom', front(...named('bom')));
  writeFileSync(join(at, 'notes.md'), `${String.fromCodePoint(0xfeff)}a note\n`);
  assertPasses(dir);
});

test('a lone CR as the last character of a file fails', () => {
  const dir = tree();
  const at = skill(dir, 'eof', front(...named('eof')));
  writeFileSync(join(at, 'notes.md'), `one\ntwo${CR}`);
  assertFails(dir, /skills\/eof\/notes\.md:2 holds a lone CR \(U\+000D\)/);
});

test('a hidden character fails in every text kind a skill ships', () => {
  for (const name of ['data.json', 'run.mjs', 'page.html', 'shape.svg', 'style.css', 'list.yaml']) {
    const dir = tree();
    const at = skill(dir, 'kinds', front(...named('kinds')));
    writeFileSync(join(at, name), `one${LS}two\n`);
    assertFails(dir, new RegExp(`skills/kinds/${literal(name)}:1 holds U\\+2028`));
  }
});

test('a text file named as a font is read as text', () => {
  const dir = tree();
  const at = skill(dir, 'font', front(...named('font')));
  writeFileSync(join(at, 'notes.woff2'), `not a font${LS}\n`);
  assertFails(dir, /skills\/font\/notes\.woff2:1 holds U\+2028/);
});

test('a character is named once a file, with the count, not once a line', () => {
  const dir = tree();
  const at = skill(dir, 'many', front(...named('many')));
  writeFileSync(join(at, 'notes.md'), `a${LS}\nb${LS}\nc${LS}\n`);
  const r = assertFails(dir, /skills\/many\/notes\.md:1 holds U\+2028/);
  assert.equal(r.stderr.match(/notes\.md:\d+ holds U\+2028/g).length, 1);
  assert.match(r.stderr, /3 times/);
});

test('a frontmatter line indented with a tab fails', () => {
  // YAML refuses a tab as indentation, so the rule cannot say which key such a
  // line belongs to, and refuses it rather than guess.
  const dir = tree();
  skill(dir, 'tabbed', front(...named('tabbed'), 'metadata:', '\thooks: {}'));
  assertFails(dir, /skills\/tabbed\/SKILL\.md:5 /);
});

test('tabs and CRLF line endings pass, in the frontmatter too', () => {
  const dir = tree();
  const text = front(...named('crlf'), 'license: MIT\twith a tab', 'metadata:', '  version: "1"').replace(/\n/g, '\r\n') + 'a\tb\r\n';
  const at = skill(dir, 'crlf', text);
  writeFileSync(join(at, 'notes.md'), 'col\tcol\r\nnext\r\n');
  assertPasses(dir);
});
