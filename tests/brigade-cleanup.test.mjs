// Cleanup's reads (issue 454, spec 450 S3.3), tested at their own seam:
// brigade/cleanup.ts takes the runner, the hooks-folder check and the session
// rows from its caller, so these tests hand it a runner that runs the real
// `git` on fixture repositories made at run time, and a fake `gh`. The
// container has no `gh`, and the suite never reaches the network.
//
// Each git call the module makes is recorded, so the tests can hold every
// call to the four flags, the hooks folder, a bare `git` or `gh` as the
// program, and no working folder of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cleanup = await import('../brigade/cleanup.ts');
const { HOOKS_MARKER, bindTarget, hooksReady, makeHooks, runCleanup } = cleanup;
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

// A repository with one commit on `main`, an `origin` on github.com that is
// never fetched, `origin/HEAD` pointing at `origin/main`, and a worktree on
// `feat` holding one commit no remote has.
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
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const wt = path.join(root, 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', 'b.txt');
  git(wt, 'commit', '-q', '-m', 'two');
  const tip = git(wt, 'rev-parse', 'HEAD');
  return { root, repo, wt, tip, common: path.join(repo, '.git') };
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

// The runner the module is handed: real `git` by name from the test's own
// PATH and folder, a fake `gh`, every call recorded.
function runner(gh = () => ({ exitCode: 0, stdout: '[]' })) {
  const calls = [];
  const run = async (argv, init) => {
    calls.push({ argv: [...argv], init: { ...init } });
    if (argv[0] === 'gh') return { stderr: '', isStdoutTruncated: false, ...gh(argv, init) };
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...(init?.env ?? {}) }, timeout: init?.timeoutMs });
    return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false };
  };
  return { calls, run };
}

function io(hooks, r, over = {}) {
  return { run: r.run, hooks, hooksReady: () => hooksReady(hooks, engineFs), list: engineFs.list, gh: true, ...over };
}

const DESKTOP = 'local_11111111-2222-3333-4444-555555555555';
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_SID = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
const row = (cwd, over = {}) => ({ name: 'build-1', status: 'idle', sessionId: SID, cwd, hostId: DESKTOP, ...over });
const card = { title: 'build-1', desktopId: DESKTOP };

// Binds the fixture's worktree to the card the way the mod does when the card
// joins the roster, and returns the module memory the tool keeps.
async function bound(f, hooks, r) {
  const targets = new Map();
  const t = await bindTarget(card, [row(f.wt)], io(hooks, r));
  assert.ok(!('why' in t), `bound: ${JSON.stringify(t)}`);
  targets.set(DESKTOP, t);
  return { targets, nameBacks: new Map() };
}

const call = (f, hooks, r, memory, step, rows = [row(f.wt)], over = {}) =>
  runCleanup({ titles: ['build-1'], step }, { cards: [card], rows, ...memory, io: io(hooks, r, over) });

const commandLines = text => text.split('\n').filter(l => /^\s+(run|only if)/.test(l));

// --- claim 18: the facts today's reads give ------------------------------------

test('the name-back gives the facts of the reads, and no command but the archive', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner(argv =>
    argv.includes('--head') ? { exitCode: 0, stdout: JSON.stringify([{ number: 42, headRefOid: 'f'.repeat(40) }]) } : { exitCode: 0, stdout: '[]' },
  );
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.match(text, /acme\/widget/);
  assert.match(text, /branch: feat/);
  assert.match(text, new RegExp(`commit on no remote: ${f.tip.slice(0, 7)}`));
  assert.match(text, /default branch: main/);
  assert.match(text, /merged into the default branch: no/);
  assert.match(text, /merged pull request at its tip: none/);
  assert.match(text, /uncommitted or untracked work: none/);
  assert.match(text, /stash entries: none/);
  assert.match(text, /archive it with Desktop's archive tool/);
  assert.equal(commandLines(text).length, 0, 'no removal command at the name-back');
});

test('found work is named by file names, counts, short hashes and stash refs', async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.wt, 'stashed.txt'), 's\n');
  git(f.wt, 'add', 'stashed.txt');
  git(f.wt, 'stash', 'push', '-q', '-m', 'a private stash subject');
  fs.writeFileSync(path.join(f.wt, 'new.txt'), 'n\n');
  fs.writeFileSync(path.join(f.wt, 'a.txt'), 'changed\n');
  git(f.repo, 'worktree', 'lock', '--reason', 'a private lock reason', f.wt);
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.match(text, /uncommitted or untracked work: 2 file\(s\): a\.txt, new\.txt/);
  assert.match(text, /stash entries: stash@\{0\}/);
  assert.match(text, /locked/);
  assert.doesNotMatch(text, /private stash subject|private lock reason|changed/);
});

test('a merged branch and a merged pull request at its tip are named', async () => {
  const f = fixture();
  git(f.repo, 'update-ref', 'refs/remotes/origin/main', f.tip);
  const hooks = hooksFolder();
  const r = runner(() => ({ exitCode: 0, stdout: JSON.stringify([{ number: 7, headRefOid: f.tip }]) }));
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.match(text, /merged into the default branch: yes/);
  assert.match(text, /merged pull request at its tip: acme\/widget #7/);
  const ghCall = r.calls.find(c => c.argv[0] === 'gh');
  assert.deepEqual(ghCall.argv, ['gh', 'pr', 'list', '--state', 'merged', '--head', 'feat', '--json', 'number,headRefOid']);
  assert.deepEqual(ghCall.init.env, { GH_REPO: 'acme/widget' });
});

test('with gh not findable, no gh runs and its line reads not checked', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back', undefined, { gh: false });
  assert.match(text, /merged pull request at its tip: not checked/);
  assert.equal(r.calls.filter(c => c.argv[0] === 'gh').length, 0);
});

// A worktree holding one populated submodule, `mod`, cloned from a local
// repository; the submodule's own git folder sits in the worktree's admin
// `modules` folder.
function withSubmodule(f) {
  const sub = path.join(f.root, 'subsrc');
  fs.mkdirSync(sub);
  git(sub, 'init', '-q', '-b', 'main');
  git(sub, 'config', 'user.email', 'fixture@example.invalid');
  git(sub, 'config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(sub, 's.txt'), 's\n');
  git(sub, 'add', 's.txt');
  git(sub, 'commit', '-q', '-m', 's');
  git(f.wt, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'mod');
  git(f.wt, 'commit', '-q', '-m', 'add mod');
  const mod = path.join(f.wt, 'mod');
  git(mod, 'config', 'user.email', 'fixture@example.invalid');
  git(mod, 'config', 'user.name', 'Fixture');
  return mod;
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('a worktree with submodules gets the submodule lines and the loss list', async () => {
  const f = fixture();
  const mod = withSubmodule(f);
  // A commit on no remote and a stash inside the submodule, then loose work.
  fs.writeFileSync(path.join(mod, 'c.txt'), 'c\n');
  git(mod, 'add', 'c.txt');
  git(mod, 'commit', '-q', '-m', 'c');
  fs.writeFileSync(path.join(mod, 's.txt'), 'stashed\n');
  git(mod, 'stash', 'push', '-q');
  fs.writeFileSync(path.join(mod, 'loose.txt'), 'l\n');
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.match(text, /submodules: 1 populated/);
  assert.match(text, /work inside the submodules: 1 file\(s\): loose\.txt/);
  assert.match(text, /commit in a submodule on no remote: [0-9a-f]{7,}/);
  assert.match(text, /stash in a submodule: stash@\{0\}/);
  assert.match(text, /a forced remove deletes each submodule's own git folder/);
  assert.doesNotMatch(text, /outside this worktree|unused submodule git folder/);
  // The inner commands of `submodule foreach` carry the flags and this use's
  // hooks folder too.
  const inner = r.calls.filter(c => c.argv.includes('foreach')).map(c => c.argv.at(-1));
  assert.ok(inner.length > 0);
  const prefix = `git --no-optional-locks -c core.fsmonitor=false -c log.showSignature=false -c 'core.hooksPath=${hooks}' `;
  for (const cmd of inner) assert.match(cmd, new RegExp(`^${escape(prefix)}`));

  // New work inside the submodule after the name-back is a change.
  fs.writeFileSync(path.join(mod, 'late.txt'), 'l\n');
  const again = await call(f, hooks, r, memory, 're-read');
  assert.match(again, /changed since the name-back: [^\n]*submodules/);
  assert.equal(commandLines(again).length, 0);
});

test('a submodule git folder outside the worktree, and one no submodule uses, are named', async () => {
  const f = fixture();
  const mod = withSubmodule(f);
  // Move the submodule's git folder out of the worktree's admin folder, and
  // leave a copy behind that no submodule uses.
  const admin = git(f.wt, 'rev-parse', '--absolute-git-dir');
  const inside = path.join(admin, 'modules', 'mod');
  const outside = path.join(f.root, 'elsewhere-mod');
  fs.cpSync(inside, outside, { recursive: true });
  fs.writeFileSync(path.join(mod, '.git'), `gitdir: ${outside}\n`);
  git(f.root, 'config', '--file', path.join(outside, 'config'), 'core.worktree', mod);
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.match(text, /a submodule's git folder outside this worktree: 1/);
  assert.match(text, /an unused submodule git folder: 1/);
});

test('a read that fails gives not checked, never git or gh text', async () => {
  const f = fixture();
  withSubmodule(f);
  git(f.repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
  const hooks = hooksFolder();
  const r = runner(() => ({ exitCode: 1, stdout: '', stderr: 'gh: HTTP 401 a private message' }));
  const memory = await bound(f, hooks, r);
  // A gh that fails, and git asked about a worktree that is gone.
  fs.rmSync(f.wt, { recursive: true, force: true });
  const text = await call(f, hooks, r, memory, 'name-back', [row(f.wt)]);
  assert.match(text, /uncommitted or untracked work: not checked/);
  assert.match(text, /stash entries: not checked/);
  assert.match(text, /submodules: not checked/);
  assert.match(text, /default branch: not known/);
  assert.match(text, /merged into the default branch: not checked/);
  assert.match(text, /merged pull request at its tip: not checked/);
  assert.doesNotMatch(text, /fatal|error|usage|HTTP|private message/i);
});

// --- claim 19: the flags, the hooks folder and the program ---------------------

// The git subcommands the tool may run: reads only.
const READS = [
  ['rev-parse'],
  ['symbolic-ref'],
  ['worktree', 'list'],
  ['status'],
  ['stash', 'list'],
  ['submodule', 'status'],
  ['submodule', 'foreach'],
  ['log'],
  ['branch', '--merged'],
  ['remote', 'get-url'],
  ['config', '--show-scope', '--list', '--name-only'],
];

test('every git call is a read with the four flags and the checked hooks folder, run by name with no working folder', async () => {
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
  const memory = await bound(f, hooks, r);
  await call(f, hooks, r, memory, 'name-back');
  const text = await call(f, hooks, r, memory, 're-read');
  assert.ok(commandLines(text).length > 0, 'the re-read handed back its commands');
  assert.ok(r.calls.length > 10);
  for (const c of r.calls) {
    assert.ok(c.argv[0] === 'git' || c.argv[0] === 'gh', `program: ${c.argv[0]}`);
    assert.equal(c.init.cwd, undefined, 'no working folder is passed');
    if (c.argv[0] !== 'git') continue;
    assert.deepEqual(c.argv.slice(1, 8), [...FLAGS, '-c', `core.hooksPath=${hooks}`]);
    const rest = c.argv.slice(8);
    const sub = rest[0] === '-C' ? rest.slice(2) : rest;
    assert.ok(READS.some(words => words.every((w, i) => sub[i] === w)), `not a read: ${sub.slice(0, 2).join(' ')}`);
  }
  // The mod removed nothing: the worktree and the branch are still there.
  assert.ok(fs.existsSync(f.wt));
  assert.equal(git(f.repo, 'rev-parse', '--verify', 'refs/heads/feat'), f.tip);
  assert.deepEqual(fs.readdirSync(marks), [], 'the stub git did not run');
});

test('a hook, a hooks path and a file watcher planted in the fixture do not run; without the flags they do', async () => {
  const f = fixture();
  const marks = tmp();
  const plant = name => {
    const p = path.join(f.root, `${name}.sh`);
    fs.writeFileSync(p, `#!/bin/sh\necho ran > '${path.join(marks, name)}'\n`);
    fs.chmodSync(p, 0o755);
    return p;
  };
  // The repository's own hooks folder, a hooks path in its config, and a
  // file watcher in its config.
  for (const h of ['post-index-change', 'reference-transaction']) {
    const p = path.join(f.common, 'hooks', h);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(plant(`hook-${h}`), p);
    fs.chmodSync(p, 0o755);
  }
  const planted = path.join(f.root, 'planted-hooks');
  fs.mkdirSync(planted);
  fs.copyFileSync(plant('hookspath'), path.join(planted, 'post-index-change'));
  fs.chmodSync(path.join(planted, 'post-index-change'), 0o755);
  git(f.repo, 'config', 'core.hooksPath', planted);
  git(f.repo, 'config', 'core.fsmonitor', plant('fsmonitor'));
  fs.writeFileSync(path.join(f.wt, 'b.txt'), 'touched\n');

  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  await call(f, hooks, r, memory, 'name-back');
  await call(f, hooks, r, memory, 're-read');
  assert.deepEqual(fs.readdirSync(marks), [], 'nothing planted ran');

  // Without the flags, a read runs the planted file watcher, and an index
  // write runs the planted hooks path, so the check above can fail.
  const env = { ...process.env, ...GIT_ENV };
  spawnSync('git', ['-C', f.wt, 'status', '--porcelain'], { env });
  spawnSync('git', ['-C', f.wt, '-c', 'core.fsmonitor=false', 'update-index', '--refresh'], { env });
  fs.writeFileSync(path.join(f.wt, 'b.txt'), 'touched again\n');
  spawnSync('git', ['-C', f.wt, '-c', 'core.fsmonitor=false', 'add', 'b.txt'], { env });
  const ran = fs.readdirSync(marks);
  assert.ok(ran.includes('fsmonitor'), 'the control run started the planted file watcher');
  assert.ok(ran.includes('hookspath'), 'the control run started the planted hooks path');
});

test('a hooks folder that holds anything else, or is missing, stops every git call', async () => {
  const f = fixture();
  const r = runner();
  const hooks = hooksFolder();
  const memory = await bound(f, hooks, r);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\n');
  const before = r.calls.length;
  const text = await call(f, hooks, r, memory, 'name-back');
  assert.equal(r.calls.length, before, 'no call ran');
  assert.match(text, /not checked: the hooks folder is not the mod's own empty folder/);
  assert.equal(commandLines(text).length, 0);

  // A folder that fails its check partway through stops the calls after it.
  fs.rmSync(path.join(hooks, 'pre-commit'));
  let checks = 0;
  const atStart = r.calls.length;
  const partway = await call(f, hooks, r, memory, 'name-back', undefined, { hooksReady: async () => ++checks <= 3 });
  assert.equal(r.calls.length - atStart, 2, 'the calls stop at the first failed check');
  assert.match(partway, /not checked: the hooks folder is not the mod's own empty folder, so the reads stopped/);
  assert.equal(commandLines(partway).length, 0);

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

// --- claim 20: targets ----------------------------------------------------------

test('a target binds by Desktop id or job id, from exactly one session file', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(f.wt)], io(hooks, r));
  assert.equal(t.cwd, f.wt);
  assert.equal(t.branch, 'feat');
  assert.equal(t.kind, 'desktop');
  const bg = await bindTarget({ title: 'bg-1', bgId: '0123abcd' }, [row(f.wt, { hostId: undefined, jobId: '0123abcd' })], io(hooks, r));
  assert.equal(bg.kind, 'bg');
  assert.equal(bg.cwd, f.wt);
  // Two files carrying the id, a file for another id, a card with no id,
  // and a name alone bind nothing.
  assert.ok('why' in (await bindTarget(card, [row(f.wt), row(f.repo, { sessionId: OTHER_SID })], io(hooks, r))));
  assert.ok('why' in (await bindTarget(card, [row(f.wt, { hostId: 'local_99999999-2222-3333-4444-555555555555' })], io(hooks, r))));
  assert.ok('why' in (await bindTarget({ title: 'build-1' }, [row(f.wt)], io(hooks, r))));
});

test('no record, a moved folder, a planted file or a borrowed name: not bound to its session, and no command', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const cases = [
    // A session with no record.
    [{ targets: new Map(), nameBacks: new Map() }, [row(f.wt)], [card]],
    // Its folder reads differently at cleanup.
    [memory, [row(f.repo)], [card]],
    // A planted second file carrying its id.
    [memory, [row(f.wt), row(f.repo, { sessionId: OTHER_SID })], [card]],
    // A card that borrows the name, with no id.
    [memory, [row(f.wt)], [{ title: 'build-1' }]],
  ];
  for (const [mem, rows, cards] of cases) {
    for (const step of ['name-back', 're-read']) {
      const text = await runCleanup({ titles: ['build-1'], step }, { cards, rows, ...mem, io: io(hooks, r) });
      assert.match(text, /not bound to its session/);
      assert.equal(commandLines(text).length, 0);
    }
  }
});

test('a branch outside the set is not checked and gets no command', async () => {
  const f = fixture();
  git(f.wt, 'checkout', '-q', '-b', 'odd+name');
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  for (const step of ['name-back', 're-read']) {
    const text = await call(f, hooks, r, memory, step);
    assert.match(text, /branch: not checked/);
    assert.doesNotMatch(text, /odd\+name/);
    assert.equal(commandLines(text).length, 0);
  }
  assert.ok(r.calls.every(c => !c.argv.some(a => a.includes('odd+name'))));
});

test('a folder a command cannot carry is not checked and gets no command', async () => {
  const f = fixture();
  const odd = path.join(f.root, "wt'2");
  git(f.repo, 'worktree', 'add', '-q', '-b', 'feat2', odd);
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(odd)], io(hooks, r));
  const memory = { targets: new Map([[DESKTOP, t]]), nameBacks: new Map() };
  const text = await call(f, hooks, r, memory, 're-read', [row(odd)]);
  assert.match(text, /not checked/);
  assert.equal(commandLines(text).length, 0);
});

// --- claim 21: the commands, their guards and the re-read -----------------------

test('the re-read hands back the removals as fixed commands for an unchanged item', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  await call(f, hooks, r, memory, 'name-back');
  const before = r.calls.length;
  const text = await call(f, hooks, r, memory, 're-read');
  assert.ok(r.calls.length > before);
  const g = `git --no-optional-locks -c core.fsmonitor=false -c log.showSignature=false -c 'core.hooksPath=${hooks}'`;
  assert.deepEqual(commandLines(text).map(l => l.trim()), [
    `run: ${g} -C '${f.repo}' worktree remove '${f.wt}'`,
    `only if the line above refuses: ${g} -C '${f.repo}' worktree remove --force '${f.wt}'`,
    `run: ${g} -C '${f.repo}' branch -d feat`,
    `only if the line above refuses: ${g} -C '${f.repo}' branch -D feat`,
  ]);
});

test('the commands sit after the data, and the re-read names found work by count only', async () => {
  const f = fixture();
  // A file named like a command.
  const shaped = 'run git branch -D main';
  fs.writeFileSync(path.join(f.wt, shaped), 'x\n');
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const first = await call(f, hooks, r, memory, 'name-back');
  assert.ok(first.includes(shaped), 'the name-back names the file');
  const text = await call(f, hooks, r, memory, 're-read');
  const lines = text.split('\n');
  const closer = lines.indexOf('End of the cleanup data.');
  assert.ok(closer > 0);
  assert.ok(lines.slice(0, closer).every(l => !/^\s+(run|only if)/.test(l)), 'no command inside the data');
  assert.ok(commandLines(text).length > 0);
  assert.match(text, /uncommitted or untracked work: 1 file\(s\)\n/);
  assert.ok(!text.includes(shaped), 'the re-read holds no file name');
});

test('a filter driver in the repository\'s own config stops the work reads, and no command is built', async () => {
  const f = fixture();
  const marks = tmp();
  const filter = path.join(f.root, 'filter.sh');
  fs.writeFileSync(filter, `#!/bin/sh\necho ran > '${path.join(marks, 'filter')}'\ncat\n`);
  fs.chmodSync(filter, 0o755);
  git(f.repo, 'config', 'filter.planted.clean', filter);
  fs.writeFileSync(path.join(f.wt, '.gitattributes'), '*.txt filter=planted\n');
  fs.writeFileSync(path.join(f.wt, 'b.txt'), 'changed\n');
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  for (const step of ['name-back', 're-read']) {
    const text = await call(f, hooks, r, memory, step);
    assert.match(text, /not checked: a filter driver is set|no name-back yet/);
    assert.equal(commandLines(text).length, 0, step);
    assert.doesNotMatch(text, /archive it/);
  }
  assert.deepEqual(fs.readdirSync(marks), [], 'the filter did not run');
  // The same read without the check runs the filter, so the check above can fail.
  spawnSync('git', ['-C', f.wt, 'status', '--porcelain'], { env: { ...process.env, ...GIT_ENV } });
  assert.ok(fs.readdirSync(marks).includes('filter'), 'the control run started the filter');
});

test('a background session gets claude stop at the name-back and claude rm at the re-read', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const bgCard = { title: 'bg-1', bgId: '0123abcd' };
  const rows = [row(f.wt, { name: 'bg-1', hostId: undefined, jobId: '0123abcd' })];
  const t = await bindTarget(bgCard, rows, io(hooks, r));
  const mem = { targets: new Map([['0123abcd', t]]), nameBacks: new Map() };
  const first = await runCleanup({ titles: ['bg-1'], step: 'name-back' }, { cards: [bgCard], rows, ...mem, io: io(hooks, r) });
  assert.match(first, /archive it: claude stop 0123abcd/);
  // `claude stop` takes the session's file away: the re-read expects that.
  const second = await runCleanup({ titles: ['bg-1'], step: 're-read' }, { cards: [bgCard], rows: [], ...mem, io: io(hooks, r) });
  assert.equal(commandLines(second)[0].trim(), 'run: claude rm 0123abcd');
});

test('a locked worktree goes only with the doubled force', async () => {
  const f = fixture();
  git(f.repo, 'worktree', 'lock', f.wt);
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  await call(f, hooks, r, memory, 'name-back');
  const lines = commandLines(await call(f, hooks, r, memory, 're-read')).join('\n');
  assert.match(lines, /worktree remove --force --force/);
  assert.doesNotMatch(lines, /worktree remove '/);
});

test('no -D for a default branch, a branch checked out elsewhere, or where the default is not known', async () => {
  const setups = {
    'a default branch': f => {
      git(f.repo, 'update-ref', 'refs/remotes/origin/feat', f.tip);
      git(f.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feat');
    },
    'a branch checked out elsewhere': f => git(f.repo, 'worktree', 'add', '-q', '--force', path.join(f.root, 'again'), 'feat'),
    'an unknown default branch': f => git(f.repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'),
  };
  for (const [name, setup] of Object.entries(setups)) {
    const f = fixture();
    setup(f);
    const hooks = hooksFolder();
    const r = runner();
    const memory = await bound(f, hooks, r);
    await call(f, hooks, r, memory, 'name-back');
    const lines = commandLines(await call(f, hooks, r, memory, 're-read')).join('\n');
    assert.match(lines, /branch -d feat/, name);
    assert.doesNotMatch(lines, /branch -D/, name);
  }
});

test('a fixture changed after the name-back gets a new name-back and no command', async () => {
  const changes = {
    'new work': f => fs.writeFileSync(path.join(f.wt, 'late.txt'), 'l\n'),
    'a new tip': f => {
      fs.writeFileSync(path.join(f.wt, 'b.txt'), 'b2\n');
      git(f.wt, 'commit', '-q', '-am', 'three');
    },
    'a new lock': f => git(f.repo, 'worktree', 'lock', f.wt),
    'a new stash': f => {
      fs.writeFileSync(path.join(f.wt, 'b.txt'), 'b3\n');
      git(f.wt, 'stash', 'push', '-q');
    },
  };
  for (const [name, change] of Object.entries(changes)) {
    const f = fixture();
    const hooks = hooksFolder();
    const r = runner();
    const memory = await bound(f, hooks, r);
    await call(f, hooks, r, memory, 'name-back');
    change(f);
    const text = await call(f, hooks, r, memory, 're-read');
    assert.match(text, /changed since the name-back/, name);
    assert.equal(commandLines(text).length, 0, name);
    // The changed facts are the new name-back: a re-read with nothing new
    // after it hands back the commands.
    const again = await call(f, hooks, r, memory, 're-read');
    assert.ok(commandLines(again).length > 0, name);
  }
});

test('a -D guard the name-back showed, changed by the re-read, gets a new name-back and no -D', async () => {
  const cases = {
    'the branch is no longer checked out elsewhere': [
      f => git(f.repo, 'worktree', 'add', '-q', '--force', path.join(f.root, 'again'), 'feat'),
      f => git(path.join(f.root, 'again'), 'checkout', '-q', '--detach'),
    ],
    'the default branch becomes known': [
      f => git(f.repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'),
      f => git(f.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'),
    ],
    'the default branch moves off the branch': [
      f => {
        git(f.repo, 'update-ref', 'refs/remotes/origin/feat', f.tip);
        git(f.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feat');
      },
      f => git(f.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'),
    ],
  };
  for (const [name, [before, after]] of Object.entries(cases)) {
    const f = fixture();
    before(f);
    const hooks = hooksFolder();
    const r = runner();
    const memory = await bound(f, hooks, r);
    await call(f, hooks, r, memory, 'name-back');
    after(f);
    const text = await call(f, hooks, r, memory, 're-read');
    assert.match(text, /changed since the name-back/, name);
    assert.doesNotMatch(text, /branch -D/, name);
    assert.equal(commandLines(text).length, 0, name);
  }
});

test('a branch switched in the folder after the name-back is not bound at the re-read', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  await call(f, hooks, r, memory, 'name-back');
  git(f.wt, 'checkout', '-q', '-b', 'other');
  const text = await call(f, hooks, r, memory, 're-read');
  assert.match(text, /not bound to its session/);
  assert.equal(commandLines(text).length, 0);
  // A detached head, which Desktop's archive leaves, is no change.
  git(f.wt, 'checkout', '-q', '--detach', 'feat');
  assert.ok(commandLines(await call(f, hooks, r, memory, 're-read')).length > 0);
});

test('a re-read with no name-back before it gets no command', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const text = await call(f, hooks, r, memory, 're-read');
  assert.match(text, /no name-back yet/);
  assert.equal(commandLines(text).length, 0);
});

test('another running session inside the worktree leaves the item, with no command', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const memory = await bound(f, hooks, r);
  const inside = row(path.join(f.wt, 'deep'), { name: 'helper', sessionId: OTHER_SID, hostId: undefined });
  await call(f, hooks, r, memory, 'name-back');
  const text = await call(f, hooks, r, memory, 're-read', [row(f.wt), inside]);
  assert.match(text, /another running session inside: helper/);
  assert.equal(commandLines(text).length, 0);

  // Inside at the name-back: no archive step, and once the other session
  // goes, the re-read still builds no command, since the item was never
  // archived and needs a new name-back.
  const g = fixture();
  const memory2 = await bound(g, hooks, r);
  const inside2 = row(path.join(g.wt, 'deep'), { name: 'helper', sessionId: OTHER_SID, hostId: undefined });
  const first = await call(g, hooks, r, memory2, 'name-back', [row(g.wt), inside2]);
  assert.match(first, /another running session inside: helper/);
  assert.doesNotMatch(first, /archive it/);
  const after = await call(g, hooks, r, memory2, 're-read', [row(g.wt)]);
  assert.match(after, /no name-back yet/);
  assert.equal(commandLines(after).length, 0);
});

test('the main working tree is never named for removal', async () => {
  const f = fixture();
  const hooks = hooksFolder();
  const r = runner();
  const t = await bindTarget(card, [row(f.repo)], io(hooks, r));
  const memory = { targets: new Map([[DESKTOP, t]]), nameBacks: new Map() };
  await call(f, hooks, r, memory, 'name-back', [row(f.repo)]);
  const text = await call(f, hooks, r, memory, 're-read', [row(f.repo)]);
  assert.match(text, /the repository's main working tree/);
  assert.equal(commandLines(text).length, 0);
});
