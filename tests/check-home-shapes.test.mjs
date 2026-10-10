// Tests of rule 2 of scripts/check.mjs, the fixed-path rule, one per shape a
// home path takes. Each case runs the whole check, so they sit in a file of
// their own, which node --test runs in parallel with the others. How the
// check prints what it found is in check-home-paths.test.mjs.

import { test } from 'node:test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, fixtureMd, assertFails } from './check-fixture.mjs';
// The shapes a fixed home path takes in code, in Git Bash and on a Mac, which
// the original three patterns missed. `someone` is the account in every one,
// so no real name enters this file. A `.js` line goes into eagle-eye's lib/,
// as above; a `.md` line goes into the unsealed fixture's SKILL.md, on a line
// that is not a block quote. String.raw keeps each backslash as written.
const inJs = String.raw;
const jsFile = dir => join(dir, 'skills', 'eagle-eye', 'lib', 'eagle-eye.js');
const shapes = [
  ['js', 'two backslashes, as a JS string holds one', inJs`"C:\\Users\\someone"`],
  ['js', 'four backslashes, as JSON inside a JS string holds one', inJs`"C:\\\\Users\\\\someone"`],
  ['md', 'forward slashes after a drive', 'C:/Users/someone/'],
  ['md', 'any drive letter', 'D:\\Users\\someone\\'],
  ['md', 'a Windows home in lower case', 'c:\\users\\someone\\'],
  ['md', "VS Code's file link with the colon encoded", 'file:///c%3A/Users/someone/'],
  ['js', 'the Windows home root joined at run time', inJs`join('C:\\Users', name)`],
  ['md', 'a Mac home', '/Users/someone/'],
  ['md', 'a Mac file link', 'file:///Users/someone/'],
  ['js', 'the Mac home root joined at run time', `const p = '/Users/' + name;`],
  ['js', 'the Mac home root in a template', 'const p = `/Users/${name}`;'],
  ['md', 'Git Bash', '/c/Users/someone/'],
  ['js', 'the Git Bash home root joined at run time', `const p = '/c/Users/' + name;`],
  ['js', 'the Git Bash home root in a template', 'const p = `/c/Users/${name}`;'],
  ['md', 'WSL', '/mnt/c/Users/someone/'],
  ['md', 'Cygwin', '/cygdrive/c/Users/someone/'],
  ['js', 'the Linux home root in a template', 'const p = `/home/${name}`;'],
];
for (const [kind, what, text] of shapes) {
  test(`a fixed home path fails: ${what}`, () => {
    const dir = tree();
    if (kind === 'js') {
      appendFileSync(jsFile(dir), `\nconst where = ${text};\n`);
      assertFails(dir, /lib\/eagle-eye\.js:\d+ holds a fixed path/);
    } else {
      appendFileSync(fixtureMd(dir), `\nOpen ${text} first.\n`);
      assertFails(dir, /unsealed-fixture\/SKILL\.md:\d+ holds a fixed path/);
    }
  });
}
