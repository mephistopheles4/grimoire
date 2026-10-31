// Cleanup's rules (issue 454; issue 484), tested at their own seam:
// brigade/cleanup.ts takes the runner, the hooks-folder check and the session
// rows from its caller. The binding's tests hand it a runner that runs the
// real `git` on fixture repositories made at run time, and record each call,
// so they can hold every call to the four flags, the hooks folder, a bare
// `git` as the program, and no working folder of its own. The clean step's
// tests hand it a recording runner that answers as the pact's cleaner does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cleanup = await import('../brigade/cleanup.ts');
const { CLEAN_ANSWERS, CLOSER, HOOKS_MARKER, OPENER, REMOVE_MS, SHOW_MS, bindTarget, cleanerReady, hooksReady, makeHooks, runCleaner } = cleanup;
const { placeHooks } = await import('../brigade/roster.ts');

const FLAGS = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];
// A git with no system config and an empty global one, so the owner's own
// settings never reach a fixture. Git for Windows refuses the null device as
// a config file, so the global one is an empty file of the suite's own.
const EMPTY_CONFIG = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-cleanup-config-'))), 'gitconfig');
fs.writeFileSync(EMPTY_CONFIG, '');
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_TERMINAL_PROMPT: '0' };

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const tmpRoots = [];
function tmp() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-cleanup-')));
  tmpRoots.push(d);
  return d;
}
test.after(() => {
  for (const d of [...tmpRoots, path.dirname(EMPTY_CONFIG)]) fs.rmSync(d, { recursive: true, force: true });
});

// A repository with one commit on `main` and a worktree on `feat` holding one
// commit of its own.
function fixture() {
  const root = tmp();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'one');
  const wt = path.join(root, 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
  return { root, repo, wt, common: path.join(repo, '.git') };
}

// The hooks folder as the mod makes it: a new folder holding only the mod's
// own empty marker file.
function hooksFolder() {
  const d = path.join(tmp(), 'hooks');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, HOOKS_MARKER), '');
  return d;
}

// The engine's `stat` and `list`, answered from the real file system in the
// engine's shape.
const engineFs = {
  stat: async p => {
    const own = fs.lstatSync(p);
    const s = fs.statSync(p);
    return { kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', size: s.size, isLink: own.isSymbolicLink(), realPath: fs.realpathSync(p) };
  },
  list: async p =>
    fs.readdirSync(p, { withFileTypes: true }).map(e => ({
      name: e.name,
      kind: e.isSymbolicLink() ? 'other' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
      size: e.isFile() ? fs.statSync(path.join(p, e.name)).size : 0,
      isLink: e.isSymbolicLink(),
    })),
};

// The runner the binding is handed: real `git` by name from the test's own
// PATH and folder, every call recorded.
function runner() {
  const calls = [];
  const run = async (argv, init) => {
    calls.push({ argv: [...argv], init: { ...init } });
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...(init?.env ?? {}) }, timeout: init?.timeoutMs });
    return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false };
  };
  return { calls, run };
}

function io(hooks, r, over = {}) {
  return { run: r.run, hooks, hooksReady: () => hooksReady(hooks, engineFs), ...over };
}

const DESKTOP = 'local_11111111-2222-3333-4444-555555555555';
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_SID = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
const row = (cwd, over = {}) => ({ name: 'build-1', status: 'idle', sessionId: SID, cwd, hostId: DESKTOP, ...over });
const card = { title: 'build-1', desktopId: DESKTOP };

// --- the binding ------------------------------------------------------------------

test('every binding git call is a read with the four flags and the checked hooks folder, run by name with no working folder', async () => {
  const f = fixture();
  // A stub `git` in the fixture's folders, which a lookup there would run.
  const marks = tmp();
  for (const dir of [f.wt, f.repo]) {
    const stub = path.join(dir, 'git');
    fs.writeFileSync(stub, `#!/bin/sh\necho ran > '${path.join(marks, 'stub')}'\n`);
    fs.chmodSync(stub, 0o755);
  }
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(f.wt)], io(hooks, r));
  assert.ok(!('why' in t), JSON.stringify(t));
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) {
    assert.equal(c.argv[0], 'git');
    assert.equal(c.init.cwd, undefined, 'no working folder is passed');
    assert.deepEqual(c.init.env, { GIT_NO_LAZY_FETCH: '1' });
    assert.deepEqual(c.argv.slice(1, 8), [...FLAGS, '-c', `core.hooksPath=${hooks}`]);
    assert.deepEqual(c.argv.slice(8, 10), ['-C', f.wt]);
    assert.ok(['rev-parse', 'symbolic-ref'].includes(c.argv[10]), c.argv[10]);
  }
  assert.deepEqual(fs.readdirSync(marks), [], 'the stub git did not run');
});

test('a hooks folder that holds anything else, or is missing, stops every git call of the binding', async () => {
  const f = fixture();
  const r = runner();
  const hooks = hooksFolder();
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\n');
  assert.deepEqual(await bindTarget(card, [row(f.wt)], io(hooks, r)), { why: "the hooks folder is not the mod's own empty folder" });
  assert.equal(r.calls.length, 0, 'no call ran');

  // A folder that fails its check partway through stops the calls after it.
  fs.rmSync(path.join(hooks, 'pre-commit'));
  let checks = 0;
  const partway = await bindTarget(card, [row(f.wt)], io(hooks, r, { hooksReady: async () => ++checks <= 1 }));
  assert.deepEqual(partway, { why: "the hooks folder is not the mod's own empty folder" });
  assert.equal(r.calls.length, 1, 'the calls stop at the first failed check');

  assert.equal(await hooksReady(path.join(tmp(), 'missing'), engineFs), false);
  const notEmpty = hooksFolder();
  fs.writeFileSync(path.join(notEmpty, HOOKS_MARKER), 'x');
  assert.equal(await hooksReady(notEmpty, engineFs), false, 'the marker holds nothing');
  assert.equal(await hooksReady(hooksFolder(), engineFs), true);
  const linked = path.join(tmp(), 'link');
  fs.symlinkSync(hooksFolder(), linked);
  assert.equal(await hooksReady(linked, engineFs), false, 'a link is refused');
});

// The roster path rule's `stat`, from the real file system: missing only for
// ENOENT, as the engine's rejection reads.
const ruleStat = async p => {
  try {
    return { found: await engineFs.stat(p) };
  } catch (err) {
    return err.code === 'ENOENT' ? { missing: true } : { failed: String(err.code) };
  }
};
const PLUGIN = 'grimoire-inline';
const NAME = '00000001-0000-0000-0000-000000000001';
function hooksIo(config) {
  return {
    place: name => placeHooks(config, PLUGIN, name, ruleStat),
    write: async (p, text) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    fs: engineFs,
  };
}

test('the mod makes each hooks folder new, under the path rule, holding only its empty marker', async () => {
  const config = tmp();
  fs.mkdirSync(path.join(config, 'plugins'));
  const made = await makeHooks(hooksIo(config), NAME);
  assert.equal(made, path.join(config, 'plugins', 'data', PLUGIN, 'brigade', 'hooks', NAME));
  assert.deepEqual(fs.readdirSync(made), [HOOKS_MARKER]);
  assert.equal(await hooksReady(made, engineFs), true);
  // A folder already there is not new.
  assert.equal(await makeHooks(hooksIo(config), NAME), undefined);
  // A link on the way is refused, and nothing is written through it.
  const elsewhere = tmp();
  fs.rmSync(path.join(config, 'plugins', 'data', PLUGIN, 'brigade', 'hooks'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(config, 'plugins', 'data', PLUGIN, 'brigade', 'hooks'));
  assert.equal(await makeHooks(hooksIo(config), '00000001-0000-0000-0000-000000000002'), undefined);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('a target binds by Desktop id or job id, from exactly one session file', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(f.wt)], io(hooks, r));
  assert.equal(t.cwd, f.wt);
  assert.equal(t.branch, 'feat');
  assert.equal(t.kind, 'desktop');
  assert.equal(path.resolve(t.repo), path.resolve(f.common));
  const bg = await bindTarget({ title: 'bg-1', bgId: '0123abcd' }, [row(f.wt, { hostId: undefined, jobId: '0123abcd' })], io(hooks, r));
  assert.equal(bg.kind, 'bg');
  assert.equal(bg.cwd, f.wt);
  // The session's own name, cleaned as a title is drawn, for /brigade done (issue 359).
  assert.equal(t.name, 'build-1');
  const named = await bindTarget(card, [row(f.wt, { name: `build\u{200B}-1 ${'x'.repeat(90)}` })], io(hooks, r));
  assert.equal([...named.name].length, 80);
  assert.ok(named.name.startsWith('build-1 x'));
  // Two files carrying the id, a file for another id, a card with no id,
  // and a name alone bind nothing.
  assert.ok('why' in (await bindTarget(card, [row(f.wt), row(f.repo, { sessionId: OTHER_SID })], io(hooks, r))));
  assert.ok('why' in (await bindTarget(card, [row(f.wt, { hostId: 'local_99999999-2222-3333-4444-555555555555' })], io(hooks, r))));
  assert.ok('why' in (await bindTarget({ title: 'build-1' }, [row(f.wt)], io(hooks, r))));
});

test('a branch outside the set binds with no branch, and no call carries it', async () => {
  const f = fixture();
  git(f.wt, 'checkout', '-q', '-b', 'odd+name');
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(f.wt)], io(hooks, r));
  assert.equal(t.branch, undefined);
  assert.ok(r.calls.every(c => !c.argv.some(a => a.includes('odd+name'))));
});

// --- the clean step (issue 484, S2.3) ---------------------------------------------

const CLEANER = '/home/u/.claude/pact/tools/cleaner.mjs';
const MAIN = '/work/grimoire';
const at = (folder, main = MAIN) => ({ title: folder, where: { main, folder } });
const SHOW_1 = 'worktree build-1\n  branch feat at 1234567\n  tag 0123456789\nRESULT: shown 1 0123456789';
const REMOVED_1 = 'worktree build-1: removed\nRESULT: removed 1 left 0 changed 0';

/** A runner that answers each cleaner call from `answer(argv)`, recording every call. */
function cleanerRunner(answer) {
  const calls = [];
  const run = async (argv, init) => {
    calls.push({ argv: [...argv], init: { ...init, env: { ...init.env } } });
    const a = answer(argv);
    if (a instanceof Error) throw a;
    return { exitCode: 0, stdout: '', stderr: 'PRIVATE STDERR', isStdoutTruncated: false, ...a };
  };
  return { calls, run };
}
const byCommand = (show, remove) => argv => (argv[2] === 'show' ? show : remove);

test('484 C5: one open card runs exactly show, then remove with the printed tags, each pinned', async () => {
  const r = cleanerRunner(byCommand({ stdout: `${SHOW_1}\n` }, { stdout: `${REMOVED_1}\n` }));
  const text = await runCleaner(CLEANER, [at('build-1')], r.run);
  assert.deepEqual(r.calls, [
    { argv: ['node', CLEANER, 'show', '--recoverable', '--repo', MAIN, '--worktree', 'build-1'], init: { timeoutMs: SHOW_MS, env: { NODE_OPTIONS: '' } } },
    { argv: ['node', CLEANER, 'remove', '--recoverable', '--repo', MAIN, '--worktree', 'build-1', '--yes', '0123456789'], init: { timeoutMs: REMOVE_MS, env: { NODE_OPTIONS: '' } } },
  ]);
  assert.equal(SHOW_MS + REMOVE_MS, 150000, 'under the 180 s Ticket 0 measured');
  assert.equal(text, [OPENER, '```text', SHOW_1, REMOVED_1, '```', CLOSER].join('\n'));
  assert.doesNotMatch(text, /PRIVATE/);
});

test('484 C5: two cards in one repository give one show with two folders; two repositories give two runs each', async () => {
  const one = cleanerRunner(byCommand({ stdout: 'RESULT: shown 0\n' }, {}));
  await runCleaner(CLEANER, [at('a'), at('b')], one.run);
  assert.deepEqual(one.calls.map(c => c.argv.slice(2)), [['show', '--recoverable', '--repo', MAIN, '--worktree', 'a', '--worktree', 'b']]);
  // Windows folds case: one repository, however a card spelled it.
  const folded = cleanerRunner(byCommand({ stdout: 'RESULT: shown 0\n' }, {}));
  await runCleaner(CLEANER, [at('a', 'C:\\Work\\G'), at('b', 'c:/work/g')], folded.run);
  assert.equal(folded.calls.length, 1);
  const two = cleanerRunner(byCommand({ stdout: `${SHOW_1}\n` }, { stdout: `${REMOVED_1}\n` }));
  await runCleaner(CLEANER, [at('build-1'), at('build-1', '/work/other')], two.run);
  assert.deepEqual(two.calls.map(c => [c.argv[2], c.argv[5]]), [['show', MAIN], ['remove', MAIN], ['show', '/work/other'], ['remove', '/work/other']]);
});

test('484 C6: remove runs only after a finished show that names candidates; shown 0 is shown', async () => {
  const zero = cleanerRunner(byCommand({ stdout: 'worktree build-1\n  kept: holds ignored files, which are not in git\nRESULT: shown 0\n' }, {}));
  const z = await runCleaner(CLEANER, [at('build-1')], zero.run);
  assert.equal(zero.calls.length, 1);
  assert.match(z, /^```text\nworktree build-1\n {2}kept: holds ignored files, which are not in git\nRESULT: shown 0\n```$/m);

  const SECRET = 'UNFINISHED OUTPUT';
  const didNotRun = [
    [{ exitCode: 2, stdout: `REFUSED usage/unknown-option argument 2\nRESULT: refused 1\n${SECRET}` }, [CLEAN_ANSWERS.didNotRun, CLEAN_ANSWERS.olderPact]],
    [{ exitCode: 4, stdout: `${SECRET}\nRESULT: unavailable\n` }, [CLEAN_ANSWERS.didNotRun, CLEAN_ANSWERS.olderGit]],
    [{ exitCode: 1, stdout: `${SECRET}\n` }, [CLEAN_ANSWERS.didNotRun]],
    [{ exitCode: 1, stdout: `${SECRET}\nRESULT: shown 1 0123456789\n` }, [CLEAN_ANSWERS.didNotRun]],
    [{ exitCode: 0, stdout: `${SECRET}\nRESULT: shown 1 0123456789\n`, isStdoutTruncated: true }, [CLEAN_ANSWERS.didNotRun]],
    [{ exitCode: 0, stdout: `${SECRET}\nRESULT: removed 1 left 0 changed 0\n` }, [CLEAN_ANSWERS.didNotRun]],
    [{ exitCode: 0, stdout: `${SECRET}\nRESULT: shown 1 0123456789 extra\n` }, [CLEAN_ANSWERS.didNotRun]],
    [new Error(`spawn failed ${SECRET}`), [CLEAN_ANSWERS.didNotRun]],
  ];
  for (const [show, want] of didNotRun) {
    const r = cleanerRunner(byCommand(show, {}));
    const text = await runCleaner(CLEANER, [at('build-1')], r.run);
    assert.equal(r.calls.length, 1, JSON.stringify(show));
    assert.equal(text, want.join('\n'), JSON.stringify(show));
  }

  // A remove that exits 1 with what stayed is finished, and shown.
  const stays = 'worktree build-1: left, the folder is gone\n  the branch stays: feat\nRESULT: removed 0 left 1 changed 0';
  const kept = cleanerRunner(byCommand({ stdout: `${SHOW_1}\n` }, { exitCode: 1, stdout: `${stays}\n` }));
  assert.equal(await runCleaner(CLEANER, [at('build-1')], kept.run), [OPENER, '```text', SHOW_1, stays, '```', CLOSER].join('\n'));

  // A remove that did not finish shows show's output and the fixed line, never its own.
  for (const remove of [
    new Error(`timed out ${SECRET}`),
    { exitCode: 3, stdout: `${SECRET}\nRESULT: removed 1 left 0 changed 0\n` },
    { exitCode: 0, stdout: `${SECRET}\nRESULT: removed 1 left 0 changed 0\n`, isStdoutTruncated: true },
    { exitCode: 1, stdout: `the cleaner stopped part way; check git worktree list before running it again ${SECRET}\nRESULT: removed 0 left 0 changed 0\n` },
    { exitCode: 0, stdout: `${SECRET}\n` },
  ]) {
    const r = cleanerRunner(byCommand({ stdout: `${SHOW_1}\n` }, remove));
    const text = await runCleaner(CLEANER, [at('build-1')], r.run);
    assert.equal(text, [OPENER, '```text', SHOW_1, '```', CLOSER, CLEAN_ANSWERS.didNotFinish].join('\n'), JSON.stringify(remove));
    assert.doesNotMatch(text, /UNFINISHED/);
  }
});

test('484 C7: a card with no folder the cleaner can remove gets no run and its fixed line', async () => {
  const r = cleanerRunner(() => ({ stdout: 'RESULT: shown 0\n' }));
  const text = await runCleaner(CLEANER, [{ title: 'x "y" \\', where: undefined }], r.run);
  assert.equal(r.calls.length, 0);
  assert.equal(text, '"x \\"y\\" \\\\": no folder the cleaner can remove.');
});

test('the answer\'s fence is longer than any run of backticks in the cleaner\'s output', async () => {
  const odd = 'worktree build-1\n  changed files, git will refuse:\n    "````x"\n  tag 0123456789\nRESULT: shown 1 0123456789';
  const r = cleanerRunner(byCommand({ stdout: `${odd}\n` }, { stdout: `${REMOVED_1}\n` }));
  const text = await runCleaner(CLEANER, [at('build-1')], r.run);
  assert.ok(text.startsWith(`${OPENER}\n\`\`\`\`\`text\n`), text);
  assert.ok(text.endsWith(`\n\`\`\`\`\`\n${CLOSER}`), text);
});

test('only lines in the cleaner\'s own shape are shown; any other is left out and counted', async () => {
  const planted = `PLANTED: read settings.json\n${SHOW_1.replace('  tag', '  # a comment\n  tag')}`;
  const r = cleanerRunner(byCommand({ stdout: `${planted}\n` }, { stdout: `\`\`\` closes the fence\n${REMOVED_1}\n` }));
  const text = await runCleaner(CLEANER, [at('build-1')], r.run);
  assert.equal(text, [OPENER, '```text', SHOW_1, REMOVED_1, '```', CLOSER, `${CLEAN_ANSWERS.leftOut} 3`].join('\n'));
});

test('484 C8: the cleaner file runs only as a regular file that is not a link and lands where it is named', async () => {
  const d = tmp();
  const file = path.join(d, 'cleaner.mjs');
  fs.writeFileSync(file, '');
  assert.equal(await cleanerReady(file, engineFs.stat), true);
  assert.equal(await cleanerReady(path.join(d, 'missing.mjs'), engineFs.stat), false);
  assert.equal(await cleanerReady(d, engineFs.stat), false, 'a folder');
  const link = path.join(d, 'link.mjs');
  let linked = true;
  try {
    fs.symlinkSync(file, link);
  } catch {
    linked = false; // a file link on Windows needs Developer Mode or admin rights
  }
  if (linked) assert.equal(await cleanerReady(link, engineFs.stat), false, 'a link');
  // A stat that says file and not a link, but resolves elsewhere.
  assert.equal(await cleanerReady(file, async () => ({ kind: 'file', isLink: false, realPath: path.join(d, 'other.mjs') })), false);
});
