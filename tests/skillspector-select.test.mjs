// Which skills the SkillSpector workflow scans on a run (docs/spec/0005, S5).
// The pick is a decision, so it lives in scripts/skillspector-select.mjs and
// not in the workflow's shell, where no test reaches it. These tests drive its
// two pure parts, selectSkills and changedPaths, with git stood in; the last
// ones run the script on a scratch tree, as the workflow does.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { root, run as runScript } from './helpers.mjs';
import { changedPaths, findLinks, listSkills, scanVerdict, selectSkills, SCANNER_PATHS } from '../scripts/skillspector-select.mjs';

const select = join(root, 'scripts', 'skillspector-select.mjs');
const work = mkdtempSync(join(tmpdir(), 'grimoire-select-'));
after(() => rmSync(work, { recursive: true, force: true }));

const skills = [
  { skill: 'contract', dir: 'skills/contract' },
  { skill: 'eagle-eye', dir: 'skills/eagle-eye' },
  { skill: 'incantation', dir: 'skills/incantation' },
];
const names = r => r.skills.map(s => s.skill);

test('a schedule run scans every skill, whatever changed', () => {
  assert.deepEqual(names(selectSkills({ event: 'schedule', skills, changed: [] })), ['contract', 'eagle-eye', 'incantation']);
});

test('a run by hand scans every skill', () => {
  assert.deepEqual(names(selectSkills({ event: 'workflow_dispatch', skills, changed: ['README.md'] })), ['contract', 'eagle-eye', 'incantation']);
});

test('changed paths that could not be read scan every skill', () => {
  const r = selectSkills({ event: 'pull_request', skills, changed: null });
  assert.equal(r.skills.length, 3);
  assert.match(r.why, /could not be read/);
});

for (const path of [
  '.github/workflows/skillspector.yml',
  '.skillspector-allowances.json',
  'scripts/skillspector-gate.mjs',
  'scripts/lib/skillspector-allowances.mjs',
  'scripts/lib/printable.mjs',
]) {
  test(`a change to ${path} scans every skill`, () => {
    const r = selectSkills({ event: 'pull_request', skills, changed: ['README.md', path] });
    assert.equal(r.skills.length, 3);
    assert.ok(r.why.includes(path), r.why);
  });
}

test('a file merely named like a scanner path elsewhere does not scan every skill', () => {
  const r = selectSkills({ event: 'pull_request', skills, changed: ['docs/scripts/skillspector-gate.mjs', 'scripts/lib/deep/skillspector-x.mjs'] });
  assert.deepEqual(names(r), []);
});

test('a pull request scans only the skills whose directory it changed', () => {
  const r = selectSkills({ event: 'pull_request', skills, changed: ['skills/incantation/README.md', 'skills/contract/SKILL.md', 'tests/x.test.mjs'] });
  assert.deepEqual(names(r), ['contract', 'incantation']);
});

test('a push scans only the skills it changed, by the same rule', () => {
  assert.deepEqual(names(selectSkills({ event: 'push', skills, changed: ['skills/eagle-eye/.skillspector-baseline.yaml'] })), ['eagle-eye']);
});

test('a directory is matched whole, not by its name as a prefix', () => {
  const r = selectSkills({ event: 'pull_request', skills, changed: ['skills/contract-old/SKILL.md', 'skills/contractx'] });
  assert.deepEqual(names(r), []);
});

test('a change that touches no skill scans none', () => {
  const r = selectSkills({ event: 'pull_request', skills, changed: ['brigade/view.ts', 'README.md'] });
  assert.deepEqual(r.skills, []);
});

// changedPaths: git is stood in by a function that returns stdout or throws.
const git = answers => args => {
  const key = args.join(' ');
  if (!(key in answers)) throw new Error(`unexpected git ${key}`);
  const a = answers[key];
  if (a instanceof Error) throw a;
  return a;
};

test('a pull request reads the merge commit against its first parent', () => {
  assert.deepEqual(changedPaths({ event: 'pull_request', git: git({ 'diff --name-only -z --no-renames HEAD^1 HEAD': 'a\0skills/x/y\0' }) }), ['a', 'skills/x/y']);
});

test('a push reads everything since the commit before it', () => {
  const before = 'a'.repeat(40);
  assert.deepEqual(changedPaths({ event: 'push', before, git: git({ [`diff --name-only -z --no-renames ${before} HEAD`]: 'b\0' }) }), ['b']);
});

// A git that answers every call with a skill's path and records it, so a
// guard that is missing shows as a call and as an answer that is not null.
const recording = () => {
  const calls = [];
  const fn = args => { calls.push(args); return 'skills/contract/x\0'; };
  fn.calls = calls;
  return fn;
};

for (const [what, before] of [['no before', ''], ['an all-zeros before', '0'.repeat(40)], ['a before that is not a commit id', '--output=x']]) {
  test(`a push with ${what} cannot be read, and git is never called`, () => {
    const g = recording();
    assert.equal(changedPaths({ event: 'push', before, git: g }), null);
    assert.deepEqual(g.calls, []);
  });
}

test('a failed git diff cannot be read', () => {
  assert.equal(changedPaths({ event: 'pull_request', git: git({ 'diff --name-only -z --no-renames HEAD^1 HEAD': new Error('no parent') }) }), null);
});

// The required `scan` check's verdict: the listing's result, the per-skill
// scans' result, and the pick's count, as the workflow hands them over.
test('scan passes when the listing and every picked scan passed', () => {
  assert.equal(scanVerdict({ listed: 'success', scanned: 'success', count: '3' }).pass, true);
});

test('scan passes when nothing was picked and the scans were skipped', () => {
  assert.equal(scanVerdict({ listed: 'success', scanned: 'skipped', count: '0' }).pass, true);
});

for (const [listed, why] of [['failure', 'failed'], ['cancelled', 'cancelled'], ['skipped', 'skipped']]) {
  test(`scan fails when the listing ${why}, whatever the scans did`, () => {
    assert.equal(scanVerdict({ listed, scanned: 'skipped', count: '' }).pass, false);
    assert.equal(scanVerdict({ listed, scanned: 'success', count: '0' }).pass, false);
  });
}

test('scan fails when a picked scan failed or was cancelled', () => {
  assert.equal(scanVerdict({ listed: 'success', scanned: 'failure', count: '2' }).pass, false);
  assert.equal(scanVerdict({ listed: 'success', scanned: 'cancelled', count: '2' }).pass, false);
});

test('scan fails when scans were skipped though skills were picked', () => {
  assert.equal(scanVerdict({ listed: 'success', scanned: 'skipped', count: '2' }).pass, false);
  assert.equal(scanVerdict({ listed: 'success', scanned: 'skipped', count: '' }).pass, false);
});

test('the verdict mode exits 0 on a pass and 1 on a fail', () => {
  const ok = runScript(select, ['verdict'], { env: { GITHUB_STEP_SUMMARY: null, LISTED: 'success', SCANNED: 'skipped', COUNT: '0' } });
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const bad = runScript(select, ['verdict'], { env: { GITHUB_STEP_SUMMARY: null, LISTED: 'failure', SCANNED: 'skipped', COUNT: '' } });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /listing/);
});

test('another event reads no paths, and git is never called', () => {
  const g = recording();
  assert.equal(changedPaths({ event: 'schedule', git: g }), null);
  assert.deepEqual(g.calls, []);
});

// Real git in a scratch repository: a move out of a skill and a name git
// would quote, read as a pull request reads its merge commit.
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repo = name => {
  const tree = join(work, name);
  mkdirSync(join(tree, 'skills', 'contract'), { recursive: true });
  mkdirSync(join(tree, 'skills', 'eagle-eye'), { recursive: true });
  writeFileSync(join(tree, 'skills', 'contract', 'SKILL.md'), '');
  writeFileSync(join(tree, 'skills', 'contract', 'moved.md'), 'moved\n');
  writeFileSync(join(tree, 'skills', 'eagle-eye', 'SKILL.md'), '');
  sh(tree, 'init', '-q');
  sh(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  sh(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
  return tree;
};
const commit = tree => {
  sh(tree, 'add', '-A');
  sh(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'change');
};
const realGit = tree => args => sh(tree, ...args);

test('with real git, a file moved out of a skill picks the skill it left', () => {
  const tree = repo('real-move');
  mkdirSync(join(tree, 'docs'));
  renameSync(join(tree, 'skills', 'contract', 'moved.md'), join(tree, 'docs', 'moved.md'));
  commit(tree);
  const changed = changedPaths({ event: 'pull_request', git: realGit(tree) });
  assert.deepEqual(names(selectSkills({ event: 'pull_request', skills, changed })), ['contract']);
});

test('with real git, a name git would quote picks its skill', t => {
  if (process.platform === 'win32') return t.skip('the name holds a character Windows refuses');
  const tree = repo('real-quote');
  writeFileSync(join(tree, 'skills', 'eagle-eye', 'a"b\\c\td.md'), '');
  commit(tree);
  const changed = changedPaths({ event: 'pull_request', git: realGit(tree) });
  assert.deepEqual(names(selectSkills({ event: 'pull_request', skills, changed })), ['eagle-eye']);
});

// Every local module the gate's scripts import is a scanner path, so a new
// import cannot narrow the every-skill trigger without this going red.
test('every module the skillspector scripts import is a scanner path', () => {
  const dir = join(root, 'scripts');
  const files = [
    ...readdirSync(dir).filter(n => /^skillspector-.*\.mjs$/.test(n)).map(n => `scripts/${n}`),
    ...readdirSync(join(dir, 'lib')).filter(n => /^skillspector-.*\.mjs$/.test(n)).map(n => `scripts/lib/${n}`),
  ];
  assert.ok(files.length >= 4, files.join(', '));
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/^import [^;]*? from '(\.[^']+)';$/gm)) {
      const target = posix.normalize(posix.join(posix.dirname(file), m[1]));
      assert.ok(SCANNER_PATHS.some(re => re.test(target)), `${file} imports ${target}, which is not a scanner path`);
    }
  }
});

test('listSkills reads directories under skills/ that hold a SKILL.md, sorted', () => {
  const tree = join(work, 'list');
  for (const d of ['b', 'a', 'none']) mkdirSync(join(tree, 'skills', d), { recursive: true });
  writeFileSync(join(tree, 'skills', 'a', 'SKILL.md'), '');
  writeFileSync(join(tree, 'skills', 'b', 'SKILL.md'), '');
  writeFileSync(join(tree, 'skills', 'loose.md'), '');
  assert.deepEqual(listSkills(tree), [{ skill: 'a', dir: 'skills/a' }, { skill: 'b', dir: 'skills/b' }]);
});

// A link under skills/ is refused by name. The base listing followed a linked
// skill folder; a pick by changed paths cannot tie a link's target to the
// skill, so a link fails closed instead (docs/spec/0005, S5.5). Making a link
// needs a privilege on Windows, so the case skips there when it cannot.
const linked = (name, make) => {
  const tree = join(work, name);
  mkdirSync(join(tree, 'skills', 'real'), { recursive: true });
  writeFileSync(join(tree, 'skills', 'real', 'SKILL.md'), '');
  mkdirSync(join(tree, 'elsewhere'), { recursive: true });
  writeFileSync(join(tree, 'elsewhere', 'SKILL.md'), '');
  try {
    make(tree);
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') return null;
    throw e;
  }
  return tree;
};

test('a skill folder that is a link is found', t => {
  const tree = linked('link-dir', tree => symlinkSync(join(tree, 'elsewhere'), join(tree, 'skills', 'via-link'), 'dir'));
  if (!tree) return t.skip('cannot make a link here');
  assert.deepEqual(findLinks(tree), ['skills/via-link']);
});

test('a link inside a skill folder is found', t => {
  const tree = linked('link-file', tree => symlinkSync(join(tree, 'elsewhere', 'SKILL.md'), join(tree, 'skills', 'real', 'more.md'), 'file'));
  if (!tree) return t.skip('cannot make a link here');
  assert.deepEqual(findLinks(tree), ['skills/real/more.md']);
});

test('skills/ itself as a link is found', t => {
  const tree = join(work, 'link-top');
  mkdirSync(join(tree, 'real', 'one'), { recursive: true });
  writeFileSync(join(tree, 'real', 'one', 'SKILL.md'), '');
  try {
    symlinkSync(join(tree, 'real'), join(tree, 'skills'), 'dir');
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') return t.skip('cannot make a link here');
    throw e;
  }
  assert.deepEqual(findLinks(tree), ['skills']);
});

test('a tree with no link finds none', () => {
  const tree = linked('no-link', () => {});
  assert.deepEqual(findLinks(tree), []);
});

test('the script fails by name on a link under skills/', t => {
  const tree = linked('link-script', tree => symlinkSync(join(tree, 'elsewhere'), join(tree, 'skills', 'via-link'), 'dir'));
  if (!tree) return t.skip('cannot make a link here');
  const out = join(work, 'out-link.txt');
  writeFileSync(out, '');
  const r = runScript(select, [], { cwd: tree, env: { GITHUB_STEP_SUMMARY: null, EVENT: 'schedule', GITHUB_OUTPUT: out } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /skills\/via-link is a link/);
  assert.equal(readFileSync(out, 'utf8'), '');
});

// The script end to end, on a scratch tree with no git: the event is a
// schedule, so no diff is read, and its outputs land in GITHUB_OUTPUT.
const runIn = (tree, env) => runScript(select, [], { cwd: tree, env: { GITHUB_STEP_SUMMARY: null, ...env } });

test('the script writes the pick and its count to GITHUB_OUTPUT', () => {
  const tree = join(work, 'script');
  mkdirSync(join(tree, 'skills', 'one'), { recursive: true });
  writeFileSync(join(tree, 'skills', 'one', 'SKILL.md'), '');
  const out = join(work, 'out.txt');
  writeFileSync(out, '');
  const r = runIn(tree, { EVENT: 'schedule', GITHUB_OUTPUT: out });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const lines = readFileSync(out, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['skills=[{"skill":"one","dir":"skills/one"}]', 'count=1']);
});

test('the script picks none on a pull request that touches no skill', () => {
  const tree = repo('script-pr');
  writeFileSync(join(tree, 'README.md'), 'x\n');
  commit(tree);
  const out = join(work, 'out-pr.txt');
  writeFileSync(out, '');
  const r = runIn(tree, { EVENT: 'pull_request', GITHUB_OUTPUT: out });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(readFileSync(out, 'utf8').trim().split('\n'), ['skills=[]', 'count=0']);
});

test('a changed name holding a line break prints on one line, so it cannot open a log command', t => {
  if (process.platform === 'win32') return t.skip('the name holds a character Windows refuses');
  const tree = repo('script-newline');
  // A scanner path is printed in the reason, so the name goes there.
  mkdirSync(join(tree, 'scripts'));
  writeFileSync(join(tree, 'scripts', 'skillspector-a\n::warning::forged'), '');
  commit(tree);
  const r = runIn(tree, { EVENT: 'pull_request', GITHUB_OUTPUT: join(work, 'out-newline.txt') });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skillspector-a\\u\{a\}::warning::forged changed/);
  assert.ok(!r.stdout.split('\n').some(l => l.startsWith('::')), r.stdout);
});

test('the script fails by name on a tree with no skill', () => {
  const tree = join(work, 'empty');
  mkdirSync(join(tree, 'skills'), { recursive: true });
  const out = join(work, 'out-empty.txt');
  writeFileSync(out, '');
  const r = runIn(tree, { EVENT: 'schedule', GITHUB_OUTPUT: out });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no directory under skills\/ holds a SKILL\.md/);
  assert.equal(readFileSync(out, 'utf8'), '');
});
