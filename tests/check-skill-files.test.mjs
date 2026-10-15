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
  assertFails(dir, /skills\/hooked\/SKILL\.md:4 has the frontmatter key "hooks"/);
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
  assertFails(dir, /skills\/open\/SKILL\.md has no closing --- line/);
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
  for (const cp of [0x00, 0x1b, 0x7f, 0x85, 0x9f, 0x2029, 0xfffe, 0xffff]) {
    const dir = tree();
    const at = skill(dir, 'kinds', front(...named('kinds')));
    writeFileSync(join(at, 'notes.txt'), `before ${String.fromCodePoint(cp)} after\n`);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    assertFails(dir, new RegExp(`skills/kinds/notes\\.txt:1 holds U\\+${hex}`));
  }
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
