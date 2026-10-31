// The cleanup gate's removal reader, tested at its own seam (issue 359, spec
// v3 D1, D2 and D8, ticket 2's first part). brigade/removal-reader.ts takes
// one command's text, its shell and the platform, and answers what the text
// would remove and whether it is one of cleanup's allowed shapes. It imports
// nothing from the engine, so these run under `node --test`. Each test names
// the acceptance claim of spec v3's S7 it backs (C1 to C8).
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { readRemovals, normPath, MAX_BYTES } = await import('../brigade/removal-reader.ts');

const HOOKS = 'H:/scratch/hooks';
const G = `--no-optional-locks -c core.fsmonitor=false -c log.showSignature=false -c core.hooksPath=${HOOKS}`;
const MAIN = 'H:/work/repo';
const CWD = 'H:/work/repo/.claude/worktrees/wt-1';
const BRANCH = 'worktree-wt-1';
const ID = 'bg-1a2b';
const EXIT = { posix: '; echo "exit=$?"', powershell: '; "exit=$LASTEXITCODE"' };
const SHELLS = ['posix', 'powershell'];

const kinds = r => r.findings.map(f => f.kind);
const read = (text, shell = 'posix', platform = 'win32') => readRemovals(text, shell, platform);
const none = (text, shell = 'posix', platform = 'win32') => {
  const r = read(text, shell, platform);
  assert.deepEqual(kinds(r), [], `${shell}: ${text}\n${JSON.stringify(r.findings)}`);
  assert.equal(r.shape, null, `${shell}: ${text}`);
};
const has = (text, want, shell = 'posix', platform = 'win32') => {
  const r = read(text, shell, platform);
  assert.deepEqual(kinds(r), want, `${shell}: ${text}\n${JSON.stringify(r.findings)}`);
  return r;
};
const unreadable = (text, shell = 'posix', platform = 'win32') => {
  const r = read(text, shell, platform);
  assert.ok(kinds(r).includes('cannot-read'), `${shell}: ${text}\n${JSON.stringify(r.findings)}`);
  assert.equal(r.shape, null);
};

// --- C1: cleanup's own lines, as the two references give them --------------------------

const refs = {
  cleanup: readFileSync(new URL('../skills/head-chef/references/cleanup.md', import.meta.url), 'utf8'),
  submodule: readFileSync(new URL('../skills/head-chef/references/submodule-cleanup.md', import.meta.url), 'utf8'),
};
const fill = tpl => tpl
  .replaceAll('<g>', G)
  .replaceAll('<kept cwd>', CWD)
  .replaceAll('<kept repository>', `${MAIN}/.git`)
  .replaceAll('<kept main>', MAIN)
  .replaceAll('<kept branch>', BRANCH)
  .replaceAll('<default>', 'main')
  .replaceAll('<owner/name>', 'owner/repo')
  .replaceAll('<worktree>', CWD)
  .replaceAll('<modules>', `${MAIN}/.git/worktrees/wt-1/modules`)
  .replaceAll('<hooks>', HOOKS)
  .replaceAll('<id>', ID);

const READS = [
  ['cleanup', 'git <g> -C <kept cwd> rev-parse --git-dir --git-common-dir'],
  ['cleanup', 'git <g> -C <kept repository> worktree list --porcelain'],
  ['cleanup', 'git <g> -C <kept cwd> status --porcelain --untracked-files=normal --ignore-submodules=none'],
  ['cleanup', 'git <g> -C <kept cwd> log --format=%h -n 1 refs/heads/<kept branch> --not --remotes'],
  ['cleanup', 'git <g> -C <kept cwd> stash list --format=%gd'],
  ['cleanup', 'git <g> -C <kept main> rev-parse --verify refs/heads/<kept branch>'],
  ['cleanup', 'git <g> -C <kept main> symbolic-ref refs/remotes/origin/HEAD'],
  ['cleanup', 'git <g> -C <kept main> branch --merged refs/remotes/origin/<default>'],
  ['cleanup', 'gh pr list --repo <owner/name> --state merged --head <kept branch> --json number,headRefOid'],
  ['cleanup', 'Get-ChildItem -LiteralPath <hooks> -Force', 'powershell'],
  ['cleanup', 'ls -A <hooks>', 'posix'],
  ['cleanup', "$o = @(git <g> -C <kept main> remote get-url origin 2>$null); $ok = $LASTEXITCODE -eq 0; $u = $o | Select-Object -First 1; if ($ok -and $u -is [string] -and $u -cmatch '^(?:https://github\\.com/|ssh://git@github\\.com/|git@github\\.com:)([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_][A-Za-z0-9._-]{0,99}?)(?:\\.git)?/?$') { \"$($Matches[1])/$($Matches[2])\" } else { 'not checked' }", 'powershell'],
  ['cleanup', "u=$(git <g> -C <kept main> remote get-url origin 2>/dev/null) && printf '%s\\n' \"$u\" | head -n 1 | sed -nE 's#^(https://github\\.com/|ssh://git@github\\.com/|git@github\\.com:)([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_][A-Za-z0-9._-]{0,99})/?$#\\2/\\3#p' | sed -E 's#\\.git$##' | grep -E '^[^/]+/[^/]+$' || echo 'not checked'", 'posix'],
  ['submodule', 'git <g> -C <worktree> submodule status --recursive'],
  ['submodule', 'git <g> -C <worktree> submodule foreach --quiet --recursive git <g> rev-parse --absolute-git-dir'],
  ['submodule', "Get-ChildItem -LiteralPath <modules> -Recurse -Force -ErrorAction Stop | Where-Object { $_.Name -in 'objects','commondir' }", 'powershell'],
  ['submodule', 'find <modules> \\( -iname objects -o -iname commondir \\)', 'posix'],
  ['submodule', 'git <g> -C <worktree> submodule foreach --quiet --recursive git <g> status --porcelain --untracked-files=normal --ignore-submodules=none'],
  ['submodule', 'git <g> -C <worktree> submodule foreach --quiet --recursive git <g> --no-replace-objects log --format=%h -n 1 --all --reflog --not --remotes'],
  ['submodule', 'git <g> -C <worktree> submodule foreach --quiet --recursive git <g> stash list --format=%gd -n 1'],
  ['submodule', 'git <g> -C <kept main> worktree list --porcelain'],
];

test('C1: the references still hold each line the table reads', () => {
  for (const [ref, tpl] of READS) assert.ok(refs[ref].includes(tpl), `${ref}: ${tpl}`);
  for (const [tpl] of REMOVALS) assert.ok(refs.cleanup.includes(tpl), tpl);
});

test("C1: each of cleanup's reads gives no finding, in its shells, with and without the exit print", () => {
  for (const [, tpl, only] of READS) {
    for (const shell of only ? [only] : SHELLS) {
      none(fill(tpl), shell);
      none(fill(tpl) + EXIT[shell], shell);
      // After a cmdlet, the submodule reference prints `"exit=$?"`.
      if (shell === 'powershell') none(fill(tpl) + '; "exit=$?"', shell);
    }
  }
});

const REMOVALS = [
  ['git <g> -C <kept main> worktree remove <kept cwd>', ['removes-worktree'], { kind: 'worktree-remove', hooks: normPath(HOOKS, 'win32'), main: normPath(MAIN, 'win32'), cwd: normPath(CWD, 'win32') }],
  ['git <g> -C <kept main> worktree remove --force <kept cwd>', ['removes-worktree', 'forced'], null],
  ['git <g> -C <kept main> worktree remove --force --force <kept cwd>', ['removes-worktree', 'forced'], null],
  ['git <g> -C <kept main> branch -d <kept branch>', ['deletes-branch'], { kind: 'branch-delete', hooks: normPath(HOOKS, 'win32'), main: normPath(MAIN, 'win32'), branch: BRANCH }],
  ['git <g> -C <kept main> branch -D <kept branch>', ['deletes-branch', 'forced'], null],
];

test("C1: each of cleanup's removals gives its finding, and D8's shape where it is in D8's form", () => {
  for (const [tpl, want, shape] of REMOVALS) {
    for (const shell of SHELLS) {
      for (const tail of ['', EXIT[shell]]) {
        const r = has(fill(tpl) + tail, want, shell);
        assert.deepEqual(r.shape, shape, `${shell}: ${tpl}${tail}`);
      }
    }
  }
  for (const verb of ['stop', 'rm']) {
    for (const shell of SHELLS) {
      for (const tail of ['', EXIT[shell]]) {
        const r = has(`claude ${verb} ${ID}${tail}`, ['removes-session'], shell);
        assert.deepEqual(r.findings[0], { kind: 'removes-session', id: ID });
        assert.deepEqual(r.shape, { kind: verb === 'stop' ? 'session-stop' : 'session-rm', id: ID });
      }
    }
  }
});

test("C1: a removal's finding names the worktree, branch and repository after the path normal form", () => {
  const w = read(fill('git <g> -C <kept main> worktree remove <kept cwd>')).findings[0];
  assert.deepEqual(w, { kind: 'removes-worktree', path: normPath(CWD, 'win32'), repo: normPath(MAIN, 'win32') });
  const b = read(fill('git <g> -C <kept main> branch -d <kept branch>')).findings[0];
  assert.deepEqual(b, { kind: 'deletes-branch', name: BRANCH, repo: normPath(MAIN, 'win32') });
  assert.deepEqual(read('git worktree remove ../x').findings[0], { kind: 'removes-worktree', path: '../x', repo: null });
});

// --- C2: a plain delete names each branch --------------------------------------------

test('C2: branch -d, --delete, and one -d naming two branches give one deletes-branch per branch', () => {
  for (const shell of SHELLS) {
    assert.deepEqual(read('git branch -d a', shell).findings, [{ kind: 'deletes-branch', name: 'a', repo: null }]);
    assert.deepEqual(read('git branch --delete a', shell).findings, [{ kind: 'deletes-branch', name: 'a', repo: null }]);
    assert.deepEqual(read('git branch --del a', shell).findings, [{ kind: 'deletes-branch', name: 'a', repo: null }]);
    assert.deepEqual(read('git branch -d a b', shell).findings.map(f => f.name), ['a', 'b']);
    assert.deepEqual(read('git branch a -d', shell).findings.map(f => f.name), ['a']);
  }
  has('git branch -d a,b', ['deletes-branch', 'deletes-branch'], 'powershell');
  none('git branch --no-delete a');
  none('git branch new-branch');
});

// --- C3: every forced form ----------------------------------------------------------

test('C3: each forced form, short cluster and long prefix gives forced', () => {
  const FORCED = [
    'git worktree remove -f x', 'git worktree remove --force x', 'git worktree remove --forc x',
    'git worktree remove --fo x', 'git worktree remove -ff x', 'git worktree remove x -f',
    'git worktree add -B b x',
    'git branch -D a', 'git branch -df a', 'git branch -fd a', 'git branch -d --force a', 'git branch -d --forc a',
    'git branch -f a HEAD', 'git branch -m a b', 'git branch -M a b', 'git branch -c a b', 'git branch -C a b',
    'git branch --move a b', 'git branch --mov a b', 'git branch --copy a b', 'git branch --cop a b', 'git branch -qm a b',
    'git update-ref refs/heads/a HEAD', 'git update-ref -d refs/heads/a', 'git update-ref --stdin',
    'git symbolic-ref -d HEAD', 'git symbolic-ref --delete HEAD', 'git symbolic-ref HEAD refs/heads/b',
    'git checkout -B a', 'git checkout -qB a', 'git switch -C a', 'git switch --force-create a', 'git switch --force-c a',
    'git fetch origin main:refs/heads/main', 'git fetch origin +x:main', 'git fetch origin HEAD:HEAD',
    'git fetch -u origin', 'git fetch --update-head-ok origin', 'git fetch --update-h origin',
    "git fetch --refmap='+refs/heads/*:refs/heads/*' origin main",
    `claude rm --force ${ID}`, `claude stop -f ${ID}`,
  ];
  for (const t of FORCED) for (const shell of SHELLS) {
    assert.ok(kinds(read(t, shell)).includes('forced'), `${shell}: ${t} → ${JSON.stringify(read(t, shell).findings)}`);
  }
  // A force turned off again is not a force.
  has('git branch -d --force --no-force a', ['deletes-branch']);
  // A fetch into remote-tracking refs or tags moves no branch.
  none('git fetch origin main:refs/remotes/origin/main');
  none('git fetch origin refs/tags/v1:refs/tags/v1');
  none('git fetch origin');
  none('git symbolic-ref HEAD');
});

// --- C4: what the reader cannot read ---------------------------------------------------

test('C4: each cannot-read form gives cannot-read', () => {
  const POSIX = [
    `git status # ${'x'.repeat(8200)}`,
    "'git' worktree remove x", 'g\\it worktree remove x', '"git" status', '$GIT worktree remove x', '$(echo git) status',
    'bash -c "$X"', 'sh -c "$(cat f)"', 'eval "$X"', 'eval git $X',
    'echo "git branch -D a" | bash', 'bash <<EOF\ngit branch -D a\nEOF', 'bash -s < cmds.txt', 'bash - <<< "git status"',
    'cat f | python', 'node - < f.js',
    'alias g=git', "alias g='git worktree'",
    'foo git worktree remove x', 'echo hi | tee git branch -D a', 'foo $X branch -d a',
    'git -C a -C b status', 'git --git-dir=x status', 'git --work-tree=x status', 'git -p status', 'git --exec-path=x status',
    'GIT_DIR=x git status', 'export GIT_DIR=x', 'export GIT_WORK_TREE', 'env GIT_DIR=x git status', 'git_dir=x git status',
    'git -c core.editor=vim status', 'git -c core.hooksPath=relative status', 'git -c core.fsmonitor=true status', 'git -c alias.x=y status',
    'git -C $D status', 'git branch -d $B', 'git branch -d "$B"', 'git branch -d $(cat f)', 'git branch -d `cat f`',
    'git branch -d feat*', 'git branch -d {a,b}', 'git worktree remove ~/x', "git branch -d $'a'",
    'git branch --fo a', 'git branch --frob a', 'git worktree remove --frob x', 'git worktree frob x',
    'git wtr', 'git Worktree remove x', 'git rmb a', 'git-branch -D a',
    'git push . HEAD:main', 'git push ../other main', 'git push file:///x main', 'git fetch .', 'git fetch ../other', 'git fetch /h/x',
    'git fetch --stdin origin',
    'git config core.hooksPath x', 'git config --unset x.y', 'git config user.name', 'git config --global --add a.b c',
    'claude', 'claude -p hi', 'claude mcp list', `claude rm ${ID} other`, 'claude rm $ID', 'claude logs a b',
    'git branch -d \\\na', 'git status &&\\\ngit worktree \\\nremove x',
    'git rebase -x "$C" main', 'git rebase --exec="$C" main', 'git bisect run $C', 'git submodule foreach $C',
    'git difftool --extcmd="$C"', 'git filter-branch --index-filter "$C"',
    'xargs git branch -d', 'find . -exec git worktree remove {} \\;', 'xargs -n1 git branch -D',
    "node -e 'require(\"child_process\").execSync(\"git branch -D a\")'", "python -c 'import os; os.system(\"claude rm x\")'",
    'echo "unclosed', "echo 'unclosed", 'git status $(', 'case $x in a) git status;; esac',
    'nohup $X branch -d a',
    "perl -e'system(\"git branch -D a\")'", "awk 'BEGIN { system(\"claude rm x\") }'", 'deno eval "$C"',
    'parallel git branch -d ::: a', 'export G"IT"_DIR=x', 'export GIT\\_DIR=x', "env 'GIT_DIR=x' git status", 'export "$N"=x',
    'git push --repo . main', 'git push --rep=. main', 'echo x | bash /dev/stdin', 'bash <(echo x)', 'python /dev/stdin < f',
    // Over 8 KiB in bytes, under it in characters.
    `echo ${'\u{e9}'.repeat(4100)}`,
  ];
  for (const t of POSIX) unreadable(t, 'posix');
  // The size rule counts bytes: exactly 8 KiB of a plain read is still read.
  none(`echo ${'a'.repeat(MAX_BYTES - 5)}`);
  const PS = [
    'g`it worktree remove x', '& $g worktree remove x', '& (Get-Git) worktree remove x', '. $g status',
    'pwsh -Command $x', 'pwsh -c "git $x"', 'powershell -EncodedCommand ZwBpAHQA', 'pwsh -e ZwBpAHQA', 'pwsh -ec ZwBpAHQA',
    "'git status' | pwsh -Command -", "'git status' | iex", 'Invoke-Expression $x', 'iex "git $b"',
    'Set-Alias g git', 'New-Alias -Name g -Value git.exe', 'sal g git',
    '$env:GIT_DIR = "x"', '$Env:git_work_tree="x"', "[Environment]::SetEnvironmentVariable('GIT_DIR', 'x')",
    'git branch -d @names', 'git branch -d $b', 'git branch -d (Get-Branch)', 'git branch -d "$b"', 'git --% branch -D a',
    'git branch -d `\n a', "git commit -m @'\nx\n'@ branch",
    'Start-Process git -ArgumentList "branch -D $b"', 'Start-Process $exe',
    'Set-Item env:GIT_DIR x', 'ni env:GIT_DIR -Value x', 'Set-Item Env:\\GIT_DIR x', "${env:GIT_DIR} = 'x'", 'New-Item -Path "env:$n"',
    '[Environment]::SetEnvironmentVariable($n, "x")', "cmd /c \"echo 'a & git branch -D b'\"",
    'g$x worktree remove x', 'function git { }', 'cmd /c "git branch -D %B%"',
  ];
  for (const t of PS) unreadable(t, 'powershell');
});

// --- C5: inline shells, wrappers, and program names ----------------------------------------

test("C5: a literal inline shell and each listed wrapper give the removal's own finding", () => {
  const RM = 'git worktree remove x';
  const POSIX = [
    `bash -c '${RM}'`, `sh -c "${RM}"`, `bash -lc '${RM}'`, `zsh -c '${RM}'`, `eval '${RM}'`, `eval ${RM}`,
    `env ${RM}`, `env -i A=b ${RM}`, `nohup ${RM}`, `nice -n 5 ${RM}`, `timeout 30 ${RM}`, `time ${RM}`, `command ${RM}`,
    `builtin ${RM}`, `exec ${RM}`, `sudo -u me ${RM}`, `doas ${RM}`, `stdbuf -o0 ${RM}`, `setsid ${RM}`, `wsl ${RM}`,
    `ionice -c 3 ${RM}`, `gtimeout 30 ${RM}`, `su -c '${RM}'`, `chronic ${RM}`, `unbuffer ${RM}`, `taskset 1 ${RM}`,
    `chrt 10 ${RM}`, `flock /tmp/l ${RM}`, `caffeinate ${RM}`, `script -qc '${RM}' /dev/null`, `strace -f ${RM}`,
    `ltrace ${RM}`, `busybox sh -c '${RM}'`, `winpty ${RM}`, `start ${RM}`, `call ${RM}`, `runas /user:me "${RM}"`,
    `coproc ${RM}`, `firejail ${RM}`, `proot ${RM}`,
    `env -S '${RM}'`, `watch '${RM}'`, `cmd /c "${RM}"`, `cmd.exe /C ${RM}`, `( ${RM} )`, `{ ${RM}; }`,
    `if true; then ${RM}; fi`, `true && ${RM}`, `echo $(${RM})`, `echo \`${RM}\``, `x=$(${RM})`, `cat <<EOF\n$(${RM})\nEOF`,
    `diff <(${RM}) f`, `git submodule foreach '${RM}'`, `git rebase -x '${RM}' main`, `git rebase --exec='${RM}' main`,
    `git bisect run ${RM}`, `git difftool --extcmd='${RM}'`, `git for-each-repo --config=maintenance.repo worktree remove x`,
  ];
  for (const t of POSIX) has(t, ['removes-worktree'], 'posix');
  const PS = [
    `pwsh -Command '${RM}'`, `pwsh -c "${RM}"`, `powershell -NoProfile -Command ${RM}`, `powershell ${RM}`, `iex '${RM}'`,
    `Invoke-Expression -Command '${RM}'`, `& git worktree remove x`, `& 'git' worktree remove x`, `& "git.exe" worktree remove x`,
    `. git worktree remove x`, `& { ${RM} }`, `1..2 | ForEach-Object { ${RM} }`, `$r = ${RM}`, `$r = @(${RM})`,
    `if ($true) { ${RM} }`, `try { ${RM} } finally { }`, `"$(${RM})"`, `return ${RM}`, `Start-Process git -ArgumentList 'worktree','remove','x'`,
  ];
  for (const t of PS) has(t, ['removes-worktree'], 'powershell');
});

test('C5: a gated word in another case or with a suffix on win32 gives the same finding as the plain word', () => {
  for (const shell of SHELLS) {
    for (const g of ['GIT', 'Git', 'git.exe', 'GIT.EXE', 'git.cmd', '/usr/bin/git', 'C:/Program Files/Git/cmd/git.exe']) {
      const text = g.includes(' ') ? (shell === 'posix' ? `${g.replace(' ', '\\ ')} branch -D a` : `& '${g}' branch -D a`) : `${g} branch -D a`;
      if (shell === 'posix' && g.includes(' ')) continue; // an escape in the program word is cannot-read (C4)
      has(text, ['deletes-branch', 'forced'], shell, 'win32');
    }
    has('CLAUDE.exe rm x', ['removes-session'], shell, 'win32');
  }
  // Off win32 a program's case is its own: `Git` is not git.
  none('Git branch -D a', 'posix', 'other');
  has('git.exe branch -D a', ['deletes-branch', 'forced'], 'posix', 'other');
});

// --- C6: path spellings --------------------------------------------------------------------

test('C6: each path spelling matches after the normal form on win32', () => {
  const want = normPath('H:/work/repo/wt', 'win32');
  for (const p of ['H:/work/repo/wt', 'H:\\work\\repo\\wt', 'h:/work/repo/wt/', '/h/work/repo/wt', '/H/Work/Repo/WT', 'H:\\work\\repo\\wt\\', 'H://work//repo/wt']) {
    assert.equal(normPath(p, 'win32'), want, p);
  }
  const f = read("git -C '/h/work/repo' worktree remove 'H:\\work\\repo\\wt'").findings[0];
  assert.equal(f.path, want);
  assert.equal(f.repo, normPath('H:/work/repo', 'win32'));
  // Off win32, case and the drive form are kept.
  assert.equal(normPath('/h/Work/', 'other'), '/h/Work');
  assert.notEqual(normPath('/h/work', 'other'), normPath('/H/work', 'other'));
});

// --- C7: claude's session removals --------------------------------------------------------

test('C7: claude rm and claude stop with one id give removes-session; with a flag, forced', () => {
  for (const shell of SHELLS) {
    assert.deepEqual(read(`claude rm ${ID}`, shell).findings, [{ kind: 'removes-session', id: ID }]);
    assert.deepEqual(read(`claude stop ${ID}`, shell).findings, [{ kind: 'removes-session', id: ID }]);
    assert.ok(kinds(read(`claude rm --yes ${ID}`, shell)).includes('forced'));
    for (const t of ['claude --version', 'claude -v', 'claude --help', 'claude -h', 'claude agents --json', `claude logs ${ID}`, 'claude plugin test .', 'claude plugin validate --strict .']) none(t, shell);
  }
});

// --- C8a: ordinary work passes ---------------------------------------------------------------

test('C8a: ordinary work gives no finding in either shell', () => {
  const POSIX = [
    "git commit -F - <<'EOF'\nfix: cleanup now runs git worktree remove and git branch -D\nEOF",
    "git commit -m \"$(cat <<'EOF'\nfix: git branch -D a; git worktree remove x\nEOF\n)\"",
    'git commit -m "$(cat msg.txt)"', 'git commit -m "mention git worktree remove x"',
    'git add src/*.ts', 'git add -A', 'git push -u origin feat/x', 'git push', 'git log --oneline -5', 'git status', 'git diff HEAD~1',
    'git fetch origin', 'git checkout -b new', 'git switch main', 'git branch', 'git branch -a', 'git branch --merged main',
    'git worktree list', 'git worktree add ../wt -b wt', 'git stash list', 'git rev-parse --show-toplevel',
    'git config --get user.name', 'git config --list', 'git config -l', 'git config --get-regexp ^alias', 'git config get user.name',
    'npm test', 'ls -la | grep x', 'echo "exit=$?"', 'cd /h/work && node scripts/check.mjs', 'rm -rf build',
    'gh pr view 12 --json state', "node -e 'console.log(1)'", "python -c 'print(\"github\")'", 'command -v git',
    'for f in a b; do echo $f; done', 'git log --grep=worktree', 'VAR=1 npm test', 'timeout 5 npm test', 'export PATH="$PATH:/x"', `cmd /c "dir 'a b'"`,
    'node --test tests/check-git.test.mjs', "perl -p -e 's/a/b/' f", "awk -F, '{ print $1 }' f",
  ];
  for (const t of POSIX) none(t, 'posix');
  const PS = [
    "git commit -m @'\nfix: cleanup now runs git worktree remove\n'@",
    'git commit -m "$(Get-Content msg.txt)"', 'git commit -m "mention git branch -D a"',
    'git add src/*.ts', 'git push -u origin feat/x', 'git log --oneline -5', 'git status', 'git diff HEAD~1',
    'Get-ChildItem -Force', '$x = 1; "x=$x"', '"exit=$LASTEXITCODE"', '"exit=$?"', 'Write-Output (Get-Date)',
    '& "C:\\Program Files\\nodejs\\node.exe" scripts/check.mjs', 'npm test 2>&1 | Select-Object -Last 5',
    'Get-Content f.txt | Where-Object { $_ -match "git" }', '$env:PATH = "x"', 'New-Item -ItemType Directory -Path $d',
    '[Environment]::SetEnvironmentVariable("PATH", $p)',
  ];
  for (const t of PS) none(t, 'powershell');
});

// --- C8: only the exact shapes are allowed shapes -------------------------------------------

test("C8: a removal in D8's form with anything changed is not an allowed shape", () => {
  const wt = fill('git <g> -C <kept main> worktree remove <kept cwd>');
  const br = fill('git <g> -C <kept main> branch -d <kept branch>');
  const NOT = [
    [wt + ' extra', 'posix'], [wt.replace(' -c log.showSignature=false', ''), 'posix'],
    [wt.replace('-c core.fsmonitor=false -c log.showSignature=false', '-c log.showSignature=false -c core.fsmonitor=false'), 'posix'],
    [wt.replace(`-C ${MAIN} `, ''), 'posix'],
    [br.replace(' -d ', ' --delete '), 'posix'], [wt + '; echo done', 'posix'], [wt + ' && echo "exit=$?"', 'posix'],
    [wt + '; echo "exit=$?";', 'posix'], [wt + '; "exit=$LASTEXITCODE"', 'posix'], [wt + '; echo "exit=$?"', 'powershell'],
    [wt + ' 2>/dev/null', 'posix'], [wt + ' # note', 'posix'], ['git.exe' + wt.slice(3), 'posix'], ['/usr/bin/git' + wt.slice(3), 'posix'],
    [wt.replace('core.hooksPath=H:/scratch/hooks', 'core.hooksPath=hooks'), 'posix'],
    [`claude stop ${ID} --now`, 'posix'], [`claude.exe stop ${ID}`, 'posix'], [`claude stop ${ID}; claude rm ${ID}`, 'posix'],
    [wt.replace('--no-optional-locks', '--no-optional-locks --no-pager'), 'powershell'],
  ];
  for (const [t, shell] of NOT) assert.equal(read(t, shell).shape, null, `${shell}: ${t}`);
});

// --- the reader's own contract (D1) ---------------------------------------------------------

test('D1: the reader never throws, and answers cannot-read for what it cannot take', () => {
  for (const t of [null, undefined, 42, {}, '\u0000git branch -D a', ')'.repeat(50), '('.repeat(5000), '$('.repeat(2000), '`'.repeat(3)]) {
    const r = readRemovals(t, 'posix', 'win32');
    assert.ok(Array.isArray(r.findings));
    if (typeof t !== 'string') assert.deepEqual(kinds(r), ['cannot-read']);
  }
  unreadable('$('.repeat(2000) + 'git branch -D a');
  for (const shell of [undefined, 'cmd', 'POSIX']) assert.deepEqual(kinds(readRemovals('git status', shell, 'win32')), ['cannot-read']);
  none('', 'posix');
  none('   \n  ', 'powershell');
});
