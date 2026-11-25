// Tests of scripts/check.mjs: the SkillSpector allowance. The fixture they
// share, and why every case copies the tree, is in check-fixture.mjs.
//
// .skillspector-allowances.json lists the partial reads this repository has
// accepted, and the workflow's gate trusts it. The gate never reads the tree,
// so the check is where an entry is held to the files it names: the format and
// every path. No content is pinned. Each case below breaks exactly one rule, or
// shows that an edit breaks none.
//
// No scan runs here, for the reason tests/skillspector-gate.test.mjs gives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './helpers.mjs';
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
  // The copy has no .git, so the change notice cannot compare and says so.
  const r = assertPasses(tree());
  assert.match(r.stdout, /cannot resolve origin\/main — \.skillspector-allowances\.json change notice skipped/);
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

test('an unknown key fails, at every level', () => {
  // Canonical form does not catch these: a file with an extra key is still
  // written the one way. The key sets are their own rule.
  const cases = [
    [a => (a.exceptions[0].line = 3), /exceptions\[0\] must have exactly the keys/],
    [a => (a.references[0].line = 3), /references\[0\] must have exactly the keys/],
    [a => (a.notes = 'more'), /the top level must be an object with exactly the keys version, exceptions, references/],
  ];
  for (const [change, pattern] of cases) {
    const dir = tree();
    edit(dir, change);
    assertFails(dir, pattern);
  }
});

test('a version other than 1 fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.version = 2;
  });
  assertFails(dir, /"version" must be 1/);
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
    // exceptions[0] is a file references point at, so it would fail twice.
    a.exceptions[1].skill = 'no-such-skill';
  });
  assertFails(dir, /skills\/no-such-skill\/ has no SKILL\.md/);
});

test('a path, from or target that does not exist fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[1].path = 'no-such-file.mjs';
  });
  assertFails(dir, /no-such-file\.mjs does not exist/);
  const dir2 = tree();
  edit(dir2, a => {
    a.references[0].from = 'NO-SUCH.md';
  });
  assertFails(dir2, /NO-SUCH\.md does not exist/);
});

test('a path not written relative to the skill fails', () => {
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

// An accepted file edited, against a base that holds its entry. No pin: the
// entry stands as it is.
test('an allowed file edited passes with its entry untouched, and no allowance change is listed', () => {
  const dir = tree();
  assert.ok(readAllowance(dir).exceptions.some(e => e.skill === 'groundtrack' && e.path === 'scripts/render.mjs'));
  const git = repo(dir);
  appendFileSync(join(dir, 'skills', 'groundtrack', 'scripts', 'render.mjs'), '\n// one more line\n');
  // A skill file changed, so the version gate wants the version to move too.
  const manifest = join(dir, '.claude-plugin', 'plugin.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/("version": ")(\d+)\.(\d+)\.(\d+)/, (_, p, a, b, c) => `${p}${a}.${b}.${Number(c) + 1}`));
  git('commit', '-aqm', 'edit the accepted file');
  const r = assertPasses(dir);
  assert.doesNotMatch(r.stdout, /changed against/);
});

test('an entry that still carries a content hash fails', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].sha256 = 'a'.repeat(64);
  });
  assertFails(dir, /exceptions\[0\] must have exactly the keys skill, path, reason_code, analyzers, reason/);
});

test('the check and the gate refuse the same malformed file', () => {
  const dir = tree();
  edit(dir, a => {
    a.exceptions[0].reason_code = 'runtime_limit';
  });
  assertFails(dir, /is not one of/);
  // The allowance file stands in for the report too. Any JSON object gets past
  // the gate's report check, and the allowance is read before the report is
  // judged, so the run is refused on the allowance alone.
  const gate = run(join(dir, 'scripts', 'skillspector-gate.mjs'), [allowancesIn(dir), '--label', 'skills/eagle-eye', '--allowances', allowancesIn(dir)], {
    env: { GITHUB_STEP_SUMMARY: null },
  });
  assert.equal(gate.code, 1);
  assert.match(gate.stderr, /the allowance file cannot be used[\s\S]*is not one of/);
});

test('every entry added, removed or re-checked against the base is listed by name', () => {
  const dir = tree();
  const git = repo(dir);
  const before = readAllowance(dir);
  const [first, second] = before.exceptions;
  const [, droppedRef] = before.references;
  edit(dir, a => {
    // Removed: the first entry. Re-checked: the second. Added: a new one, in another skill
    // on the second entry's own path and code, so a notice that keyed entries
    // without their skill would read it as the second one and never list it.
    a.exceptions = a.exceptions.slice(1);
    a.exceptions[0] = { ...second, analyzers: [...second.analyzers, 'static_patterns_ssrf'].sort() };
    a.exceptions.push({ ...second, skill: 'groundtrack', reason: 'A neutral reason for the test.' });
    // Recounted: the first reference. Removed: the second. Added: a new one.
    a.references[0].count += 1;
    a.references.splice(1, 1);
    a.references.push({ skill: 'groundtrack', from: 'SKILL.md', target: second.path, count: 1 });
  });
  git('commit', '-aqm', 'change the allowance');
  // As in CI: the notice is also a warning on the pull request and a list on
  // the run's summary page.
  const summary = join(mkdtempSync(join(tmpdir(), 'grimoire-notice-')), 'summary.md');
  const r = run(checkIn(dir), [], { cwd: dir, env: { GITHUB_BASE_REF: null, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary } });
  assert.match(r.stdout, /changed against origin\/main; review each by hand/);
  // Plain substrings, not a pattern built from the entry: a path is text, and
  // escaping it into a regular expression is one more thing to get wrong.
  const expected = [
    `removed exception ${first.skill}/${first.path} (${first.reason_code})`,
    `changed the checks on exception ${second.skill}/${second.path} (${second.reason_code})`,
    `added exception groundtrack/${second.path} (${second.reason_code})`,
    `removed reference ${droppedRef.skill}: ${droppedRef.from} -> ${droppedRef.target}`,
    `added reference groundtrack: SKILL.md -> ${second.path} (1)`,
  ];
  const page = readFileSync(summary, 'utf8');
  for (const line of expected) {
    assert.ok(r.stdout.includes(`note:   ${line}`), `log lacks "${line}":\n${r.stdout}`);
    assert.ok(r.stdout.includes(`::warning title=SkillSpector allowance changed::${line}`), `no warning for "${line}"`);
    assert.ok(page.includes(`- ${line}`), `summary lacks "${line}":\n${page}`);
  }
  assert.match(r.stdout, /recounted reference/);
});

test('an unchanged allowance prints no change notice', () => {
  const dir = tree();
  repo(dir);
  const r = assertPasses(dir);
  assert.doesNotMatch(r.stdout, /changed against/);
});

// An entry names one directory under skills/, and is held to that skill's files.
const incantation = 'incantation';
const lastOf = (a, skill) => a.exceptions.findLast(e => e.skill === skill);

test('an entry names one directory under skills/, so <plugin>/<name> and anything deeper fail', () => {
  for (const name of ['incantation/incantation', 'incantation/scripts']) {
    const dir = tree();
    edit(dir, a => {
      lastOf(a, incantation).skill = name;
    });
    assertFails(dir, /"skill" must be one directory name under skills\//);
  }
});

test('an entry for a skill with no SKILL.md fails, and says where it looked', () => {
  const dir = tree();
  edit(dir, a => {
    for (const x of [...a.exceptions, ...a.references]) if (x.skill === incantation) x.skill = 'missing';
  });
  assertFails(dir, /skills\/missing\/ has no SKILL\.md/);
});
