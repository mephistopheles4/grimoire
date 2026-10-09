// Tests of scripts/check.mjs: the SkillSpector allowance. The fixture they
// share, and why every case copies the tree, is in check-fixture.mjs.
//
// .skillspector-allowances.json lists the partial reads this repository has
// accepted, and the workflow's gate trusts it. The gate never reads the tree,
// so the check is where an entry is held to the files it names: the format,
// every path, and the content hash. Each case below breaks exactly one rule.
//
// No scan runs here, for the reason tests/skillspector-gate.test.mjs gives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers.mjs';
import { allowancesName, tree, assertPasses, assertFails, checkIn, repo } from './check-fixture.mjs';

const allowancesIn = dir => join(dir, allowancesName);
const readAllowance = dir => JSON.parse(readFileSync(allowancesIn(dir), 'utf8'));
const writeAllowance = (dir, value) => writeFileSync(allowancesIn(dir), `${JSON.stringify(value, null, 2)}\n`);
// Change the shipped allowance in the copy, in canonical form.
function edit(dir, change) {
  const a = readAllowance(dir);
  change(a);
  writeAllowance(dir, a);
  return a;
}

test('the allowance as shipped passes', () => {
  assertPasses(tree());
});

test('a missing allowance file fails rather than reading as empty', () => {
  const dir = tree();
  rmSync(allowancesIn(dir));
  assertFails(dir, /cannot read \.skillspector-allowances\.json: ENOENT/);
});

test('an allowance with empty lists passes, so the file can outlive its entries', () => {
  const dir = tree();
  writeAllowance(dir, { version: 1, exceptions: [], references: [] });
  assertPasses(dir);
});

test('a file not in canonical form fails', () => {
  const dir = tree();
  writeFileSync(allowancesIn(dir), JSON.stringify(readAllowance(dir)));
  assertFails(dir, /not in canonical form/);
});

test('a repeated key fails, though JSON.parse would keep the last one', () => {
  const dir = tree();
  const text = readFileSync(allowancesIn(dir), 'utf8');
  writeFileSync(allowancesIn(dir), text.replace('"version": 1,', '"version": 1,\n  "version": 1,'));
  assertFails(dir, /not in canonical form[^\n]*repeated key/);
});

test('an unknown key fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].line = 3;
  });
  assertFails(dir, /exceptions\[0\] must have exactly the keys/);
});

test('a reason code outside the two fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].reason_code = 'runtime_limit';
  });
  assertFails(dir, /"reason_code" "runtime_limit" is not one of static_parse_limit, obfuscated_instruction_text/);
});

test('an empty, unsorted or repeating list of checks fails', () => {
  const cases = [
    [[], /"analyzers" must be a non-empty list/],
    [['static_patterns_tool_misuse', 'static_patterns_ssrf'], /"analyzers" must be sorted/],
    [['static_patterns_ssrf', 'static_patterns_ssrf'], /"analyzers" must not repeat a check/],
  ];
  for (const [analyzers, pattern] of cases) {
    const dir = tree();
    edit(dir, a => {
      a.exceptions[0].analyzers = analyzers;
    });
    assertFails(dir, pattern);
  }
});

test('a count that is not a positive whole number fails', () => {
  for (const count of [0, 1.5, '1']) {
    const dir = tree();
    edit(dir, a => {
      a.references[0].count = count;
    });
    assertFails(dir, /"count" must be a positive whole number/);
  }
});

test('a skill with no SKILL.md fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].skill = 'no-such-skill';
  });
  assertFails(dir, /skills\/no-such-skill\/ has no SKILL\.md/);
});

test('a path, from or target that does not exist fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].path = 'no-such-file.mjs';
  });
  assertFails(dir, /no-such-file\.mjs does not exist/);
  const dir2 = tree();
  edit(dir2, a => {
    a.references[0].from = 'NO-SUCH.md';
  });
  assertFails(dir2, /NO-SUCH\.md does not exist/);
});

test('a path that climbs out of the skill fails', () => {
  for (const path of ['../contract/SKILL.md', 'lib\\x.mjs', '/abs.mjs', 'a//b.mjs']) {
    const dir = tree();
    edit(dir, a => {
      a.exceptions[0].path = path;
    });
    assertFails(dir, /"path" must be relative to the skill/);
  }
});

test('a duplicate exception fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions.push({ ...a.exceptions[0], reason: 'A second reason for the same entry.' });
  });
  assertFails(dir, /repeats exceptions\[0\] \(same skill, path and reason code\)/);
});

test('a duplicate reference fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.references.push({ ...a.references[0] });
  });
  assertFails(dir, /repeats references\[0\] \(same skill, from and target\)/);
});

test('an empty or placeholder reason fails', () => {
  for (const reason of ['', '   ', 'TODO', 'TBD: explain', '<reason>']) {
    const dir = tree();
    edit(dir, a => {
      a.exceptions[0].reason = reason;
    });
    assertFails(dir, /"reason" must be a sentence a stranger can read/);
  }
});

test('a reference to a target with no exception entry fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.references[0].target = 'SKILL.md';
  });
  assertFails(dir, /target "SKILL\.md" in "eagle-eye" has no exception entry/);
});

test('an allowed file edited without its sha256 updated fails, and says what to review', () => {
  const dir = tree();
  const entry = readAllowance(dir).exceptions.find(e => e.skill === 'groundtrack' && e.path === 'scripts/render.mjs');
  assert.ok(entry, 'the shipped allowance has no entry for groundtrack/scripts/render.mjs');
  appendFileSync(join(dir, 'skills', 'groundtrack', 'scripts', 'render.mjs'), '\n// one more line\n');
  const r = assertFails(dir, /exceptions\[\d+\] \(groundtrack\/scripts\/render\.mjs, static_parse_limit\): skills\/groundtrack\/scripts\/render\.mjs changed since its allowance was written/);
  assert.match(r.stderr, /the shell-aware destructive-command parser/);
  assert.match(r.stderr, /Review the diff of that file by hand for a long command expression with a destructive command/);
  // Never a value to paste. The pin exists to make someone look.
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /[0-9a-f]{64}/);
});

test('a marker-pass entry names its own pass and what to look for', () => {
  const dir = tree();
  const entry = readAllowance(dir).exceptions.find(e => e.reason_code === 'obfuscated_instruction_text');
  assert.ok(entry, 'the shipped allowance has no obfuscated_instruction_text entry');
  appendFileSync(join(dir, 'skills', entry.skill, ...entry.path.split('/')), '\n');
  const r = assertFails(dir, /changed since its allowance was written/);
  assert.match(r.stderr, /the declared-marker pass/);
  assert.match(r.stderr, /a disguised "remove the marker" directive/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /[0-9a-f]{64}/);
});

test('a CRLF checkout hashes the same as an LF one', () => {
  // A Windows checkout and the CI runner must agree, or every Windows run fails.
  const dir = tree();
  const p = join(dir, 'skills', 'groundtrack', 'scripts', 'render.mjs');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  assertPasses(dir);
});

test('the check and the gate refuse the same malformed file', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].reason_code = 'runtime_limit';
  });
  assertFails(dir, /is not one of/);
  const gate = run(join(dir, 'scripts', 'skillspector-gate.mjs'), [allowancesIn(dir), '--label', 'skills/eagle-eye', '--allowances', allowancesIn(dir)], {
    env: { GITHUB_STEP_SUMMARY: null },
  });
  assert.equal(gate.code, 1);
  assert.match(gate.stderr, /the allowance file cannot be used[\s\S]*is not one of/);
});

test('every entry added, removed or re-hashed against the base is listed by name', () => {
  const dir = tree();
  const git = repo(dir);
  const before = readAllowance(dir);
  const [first, second] = before.exceptions;
  edit(dir, a => {
    // Removed: the first entry. Re-hashed: the second. Added: a new one.
    a.exceptions = a.exceptions.slice(1);
    a.exceptions[0] = { ...second, sha256: 'b'.repeat(64) };
    a.exceptions.push({ ...second, path: 'SKILL.md', skill: 'groundtrack', reason: 'A neutral reason for the test.' });
    a.references[0].count += 1;
  });
  git('commit', '-aqm', 'change the allowance');
  const r = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null } });
  assert.match(r.stdout, /changed against origin\/main; review each by hand/);
  // Plain substrings, not a pattern built from the entry: a path is text, and
  // escaping it into a regular expression is one more thing to get wrong.
  assert.ok(r.stdout.includes(`removed exception ${first.skill}/${first.path} (${first.reason_code})`), r.stdout);
  assert.ok(r.stdout.includes(`re-hashed exception ${second.skill}/${second.path} (${second.reason_code})`), r.stdout);
  assert.match(r.stdout, /added exception groundtrack\/SKILL\.md \(static_parse_limit\)/);
  assert.match(r.stdout, /recounted reference/);
  assert.doesNotMatch(r.stdout, /[0-9a-f]{64}/);
});

test('an unchanged allowance prints no change notice', () => {
  const dir = tree();
  repo(dir);
  const r = assertPasses(dir);
  assert.doesNotMatch(r.stdout, /changed against/);
});
