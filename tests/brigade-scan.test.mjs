// The outbound scan's rules, tested at their own seam: the scanner (text in,
// findings out), the route match that says which calls it reads and with
// which rule families, and the decision a matched call gets, with the file
// system, the clock and the setting handed in. brigade/scan.ts takes plain
// values and no engine import, so these run under `node --test` in CI, where
// there is no Claude Code. Each test names the acceptance claim of issue 450's
// spec (rev 4, S8) it backs, 12 to 16, or the step of S3.2 it pins.
//
// Every secret-shaped fixture is built from parts at run time, so no file in
// the tree holds a value a secret scanner would flag.
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const s = await import('../brigade/scan.ts');
const {
  MAX_BYTES, TIME_LIMIT_MS, scanText, routeOf, decide, settingOf, switchArgs, switchReply,
  FAILED, TIMED_OUT, MOD_TOOLS,
} = s;

// --- fixtures ---------------------------------------------------------------

const rep = (c, n) => c.repeat(n);
const SECRETS = {
  github: 'gh' + 'p_' + rep('A1b2', 9),
  finegrained: 'github' + '_pat_' + rep('Ab1_', 12),
  anthropic: 'sk' + '-ant-' + rep('aB3-', 10),
  openai: 'sk' + '-proj-' + rep('Qw9_', 8),
  aws: 'AK' + 'IA' + 'ABCDEFGHIJ234567',
  google: 'AI' + 'za' + rep('Bc4_', 8) + 'xyz',
  slack: 'xo' + 'xb-' + '1234567890-abcdef',
  gitlab: 'gl' + 'pat-' + rep('Zz9-', 6),
  npm: 'np' + 'm_' + rep('a1B2', 9),
  huggingface: 'h' + 'f_' + rep('Ab12', 9),
  stripe: 's' + 'k_live_' + rep('Ab12', 6),
  jwt: 'ey' + 'J' + rep('h', 12) + '.ey' + 'J' + rep('p', 12) + '.' + rep('s', 12),
};
const KEY_HEADER = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';
const URL_USER = 'https://' + 'someone:hunter2' + '@example.com/repo.git';
const EMAIL = 'someone' + '@' + 'example.com';
const HOMES = {
  windows: 'C:' + '\\Users\\someone\\notes.md',
  windowsSlash: 'C:' + '/Users/someone/notes.md',
  mac: '/Us' + 'ers/someone/notes.md',
  linux: '/ho' + 'me/someone/notes.md',
  gitBash: '/c/Us' + 'ers/someone/notes.md',
  wsl: '/mnt/c/Us' + 'ers/someone/notes.md',
};
const NOREPLY = ['12345+someone@users.noreply.github.com', 'noreply@anthropic.com'];
const rules = fs => fs.map(f => f.rule);

// --- the scanner (claim 12) -------------------------------------------------

test('claim 12: each secret shape is reported as a token', () => {
  for (const [name, v] of Object.entries(SECRETS)) {
    assert.deepEqual(rules(scanText(`token: ${v} end`, ['secret'])), ['token'], name);
  }
});

test('claim 12: a private-key header and a URL user part are secret shapes', () => {
  assert.deepEqual(rules(scanText(`x\n${KEY_HEADER}\nabc`, ['secret'])), ['private-key']);
  assert.deepEqual(rules(scanText(`clone ${URL_USER} now`, ['secret'])), ['url-user']);
});

test('claim 12: an email address and each home path are personal data', () => {
  assert.deepEqual(rules(scanText(`mail ${EMAIL} please`, ['personal'])), ['email']);
  for (const [name, v] of Object.entries(HOMES)) {
    assert.deepEqual(rules(scanText(`see ${v} there`, ['personal'])), ['home-path'], name);
  }
});

test('claim 12: the secret family alone passes personal data', () => {
  const text = `${EMAIL} ${HOMES.windows} ${HOMES.linux}`;
  assert.deepEqual(scanText(text, ['secret']), []);
  assert.deepEqual(rules(scanText(text, ['secret', 'personal'])).sort(), ['email', 'home-path', 'home-path']);
});

test('claim 12: clean text passes', () => {
  const clean = [
    'Fixes the roster rule; see ~/notes and $HOME/x, task-runner-for-everything, risk-assessment.',
    'https://example.com/path?q=a@b and ssh:/x',
    'A plain sentence with a hyphenated-word and an @mention.',
    '/home/ alone, C:\\Program Files\\x, docs/home/page.md, myhome/someone',
  ].join('\n');
  assert.deepEqual(scanText(clean, ['secret', 'personal']), []);
});

test('claim 12: the two noreply addresses pass, and look-alikes do not', () => {
  for (const a of NOREPLY) assert.deepEqual(scanText(`Co-Authored-By: X <${a}>`, ['personal']), [], a);
  assert.deepEqual(scanText('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', ['personal']), []);
  for (const a of ['noreply@anthropic.com.example.org', 'xnoreply@anthropic.com', 'someone@users.noreply.github.com.example.org']) {
    assert.deepEqual(rules(scanText(`<${a}>`, ['personal'])), ['email'], a);
  }
});

test('claim 12: a finding names a rule and a position, never the matched text', () => {
  const text = `a ${SECRETS.github} b ${EMAIL} c ${HOMES.mac}`;
  const found = scanText(text, ['secret', 'personal']);
  assert.equal(found.length, 3);
  for (const f of found) {
    assert.deepEqual(Object.keys(f).sort(), ['at', 'rule']);
    assert.equal(typeof f.at, 'number');
  }
  const out = JSON.stringify(found);
  for (const v of [SECRETS.github, EMAIL, HOMES.mac, 'someone', 'A1b2']) assert.ok(!out.includes(v), v);
  assert.equal(found[0].at, 2);
});

// Worst cases: a run of near-misses for each rule, so a pattern that backtracks
// over the run, or starts again inside it, shows as time. Best of three runs.
const MiB = 1024 * 1024;
const fill = unit => unit.repeat(Math.ceil(MiB / unit.length)).slice(0, MiB);
const WORST = {
  'token prefixes': fill('ghp_ghs_sk-ant-github_pat_eyJ'),
  'token bodies': fill('A'),
  'jwt parts': fill('eyJaaaaaaaaaaaa.'),
  'key headers': fill('-----BEGIN RSA PRIVATE KE'),
  'dashes': fill('-'),
  'url schemes': fill('a://'),
  'url users': 'https://' + fill('x').slice(9),
  'emails': fill('a.b@'),
  'email domains': 'a@' + fill('b.').slice(2),
  'home paths': fill('C:\\Users'),
  'slashes': fill('/home/'),
};

test('claim 12: a worst-case 1 MiB fixture of each kind finishes in under 100 ms', t => {
  for (const [name, text] of Object.entries(WORST)) {
    assert.ok(text.length >= MiB - 8, name);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      scanText(text, ['secret', 'personal']);
      best = Math.min(best, performance.now() - start);
    }
    t.diagnostic(`${name}: ${best.toFixed(1)} ms`);
    assert.ok(best < 100, `${name}: ${best.toFixed(1)} ms`);
  }
});

// --- the routes (S3.2 steps 2 to 4) ------------------------------------------

const bash = command => routeOf('Bash', { command });
const ps = command => routeOf('PowerShell', { command });

test('claim 12: each gh and git route is matched, with both families', () => {
  const matched = [
    'gh issue create --title t --body b',
    'gh issue comment 12 --body b',
    'gh issue edit 12 --body b',
    'gh issue close 12 --comment b',
    'gh pr create --title t --body b',
    'gh pr edit 3 --body b',
    'gh pr comment 3 -b b',
    'gh pr review 3 --approve -b b',
    'gh pr merge 3 --squash --subject s',
    'gh pr merge 3 --body=b',
    'gh release create v1 --notes n',
    'gh release edit v1 --notes n',
    'gh api repos/o/r/issues -f body=b',
    'gh -R owner/repo pr comment 3 --body b',
    'git commit -m "a message"',
    'git -C sub commit -am m',
    'git tag -a v1 -m "a message"',
    'git tag v1 --message=m',
    'FOO=1 gh pr create --body b',
    'gh.exe pr create --body b',
  ];
  for (const c of matched) {
    const r = bash(c);
    assert.ok(r, c);
    assert.deepEqual([...r.families].sort(), ['personal', 'secret'], c);
  }
});

test('S3.2 step 3: other gh and git commands are not matched', () => {
  for (const c of [
    'gh pr view 3', 'gh pr list', 'gh issue view 1 --comments', 'gh pr merge 3 --squash', 'gh pr checks 3',
    'gh release view v1', 'git status', 'git log -1', 'git tag v1', 'git push -u origin x', 'git diff',
    'echo gh pr create --body b', 'ls', 'node scripts/x.mjs',
  ]) {
    assert.equal(bash(c), undefined, c);
  }
});

test('S3.2 step 3: the scanned text starts at the matched call, after its global options', () => {
  const r = bash(`cd ${HOMES.linux} && git -C ${HOMES.linux} commit -m "fix"`);
  assert.ok(r);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].field, 'command');
  assert.ok(r.parts[0].text.startsWith('commit -m'), r.parts[0].text);
  assert.equal(r.folderChanged, true);
});

test('S3.2 step 3: a heredoc body is in the scanned text, and a command inside it is data', () => {
  const c = `git commit -F - <<'EOF'\nfix it\ngh issue create --body-file notes.md\nEOF\n`;
  const r = bash(c);
  assert.ok(r);
  assert.deepEqual(r.files, []);
  assert.ok(r.parts[0].text.includes('fix it'));
  const sub = bash(`gh pr create --title t --body "$(cat <<'EOF'\nthe body ${EMAIL}\nEOF\n)"`);
  assert.ok(sub);
  assert.ok(sub.parts[0].text.includes(EMAIL));
});

test('S3.2 step 3: a PowerShell here-string body is in the scanned text', () => {
  const r = ps(`gh pr create --title t --body @'\nthe body ${EMAIL}\n'@`);
  assert.ok(r);
  assert.ok(r.parts[0].text.includes(EMAIL));
  assert.ok(ps("Set-Location x; git commit -m 'it''s fixed'").folderChanged);
});

test('claim 14: each body-file form names the file the program reads', () => {
  const files = c => bash(c).files.map(f => [f.path, f.base]);
  assert.deepEqual(files('gh pr create --body-file b.md'), [['b.md', undefined]]);
  assert.deepEqual(files('gh pr create --body-file=b.md'), [['b.md', undefined]]);
  assert.deepEqual(files('gh issue comment 1 -F b.md'), [['b.md', undefined]]);
  assert.deepEqual(files('gh issue comment 1 -Fb.md'), [['b.md', undefined]]);
  assert.deepEqual(files('gh release create v1 --notes-file n.md'), [['n.md', undefined]]);
  assert.deepEqual(files('gh release create v1 -F n.md'), [['n.md', undefined]]);
  assert.deepEqual(files('gh api repos/o/r/issues --input i.json'), [['i.json', undefined]]);
  assert.deepEqual(files('gh api repos/o/r/issues -F body=@b.md -F title=t'), [['b.md', undefined]]);
  assert.deepEqual(files('gh api repos/o/r/issues --field body=@b.md'), [['b.md', undefined]]);
  assert.deepEqual(files('git commit -F m.txt'), [['m.txt', undefined]]);
  assert.deepEqual(files('git commit --file=m.txt'), [['m.txt', undefined]]);
  assert.deepEqual(files('git -C sub commit --file m.txt'), [['m.txt', 'sub']]);
  assert.deepEqual(files('git tag -a v1 -F m.txt'), [['m.txt', undefined]]);
  assert.deepEqual(files("gh pr create --body-file 'my notes.md'"), [['my notes.md', undefined]]);
  // Standard input is in the unseen list (S3.2 step 4).
  assert.deepEqual(files('gh pr create --body-file -'), []);
  assert.deepEqual(files('git commit -F -'), []);
});

test('claim 12: SendMessage gets the secret shapes only, on its message', () => {
  const r = routeOf('SendMessage', { to: 'build-1', message: `see ${HOMES.windows}`, summary: 'x' });
  assert.deepEqual(r.families, ['secret']);
  assert.deepEqual(r.parts.map(p => p.field), ['message']);
  const obj = routeOf('SendMessage', { to: 'x', message: { type: 'shutdown_response', reason: SECRETS.github } });
  assert.ok(obj.parts.some(p => p.text.includes(SECRETS.github)));
});

test("claim 12: the mod's three tools get both families on every text field", () => {
  for (const tool of MOD_TOOLS) {
    const r = routeOf(tool, { cards: [{ title: 't', work: `w ${EMAIL}` }], todos: [], note: 'n' });
    assert.deepEqual([...r.families].sort(), ['personal', 'secret'], tool);
    const fields = r.parts.map(p => p.field);
    assert.ok(fields.includes('cards.work'), fields.join());
    assert.ok(fields.includes('note'), fields.join());
  }
  // A key that is not a plain word is named as "input", never echoed.
  const odd = routeOf(MOD_TOOLS[0], { [`x ${EMAIL}`]: 'v' });
  assert.deepEqual(odd.parts.map(p => p.field), ['input']);
});

test('claim 13: other tools are not matched', () => {
  for (const tool of ['Read', 'Write', 'Edit', 'WebFetch', 'Agent', 'mcp__grimoire__read_autonomy', 'mcp__other__post']) {
    assert.equal(routeOf(tool, { command: 'gh pr create --body b', message: EMAIL }), undefined, tool);
  }
});

// --- the decision (claims 13 to 15, S3.2 steps 5 to 9) ----------------------

// A file system in memory, a clock, and the setting. `calls` counts every
// call into them, so a test can say nothing was touched.
function deps(o = {}) {
  const files = o.files ?? {};
  const calls = [];
  let t = 0;
  const d = {
    calls,
    setting: async () => { calls.push('setting'); if (o.settingThrows) throw new Error('store'); return 'setting' in o ? o.setting : 'on'; },
    cwd: async () => { calls.push('cwd'); return o.cwd ?? '/work'; },
    stat: async p => {
      calls.push(`stat ${p}`);
      if (o.statThrows) throw new Error('stat');
      const f = files[p];
      if (f === undefined) throw new Error('missing');
      return f;
    },
    read: async p => {
      calls.push(`read ${p}`);
      if (o.readHangs) return new Promise(() => {});
      return files[p].text;
    },
    now: () => (t += o.step ?? 1),
    after: ms => new Promise(r => setTimeout(r, Math.min(ms, 20))),
  };
  return d;
}
const file = text => ({ kind: 'file', isLink: false, size: Buffer.byteLength(text), text });

test('claim 15: with the setting off or unset, a matched call with a hit passes untouched', async () => {
  for (const setting of ['off', undefined, 'ON', true, { on: true }, 'on ']) {
    const d = deps({ setting });
    assert.equal(await decide('Bash', { command: `gh pr create --body ${SECRETS.github} --body-file b.md` }, d), undefined, String(setting));
    assert.deepEqual(d.calls, ['setting'], String(setting));
  }
});

test('claim 15: a setting that fails to read counts as off', async () => {
  const d = deps({ settingThrows: true });
  assert.equal(await decide('Bash', { command: `gh pr create --body ${SECRETS.github}` }, d), undefined);
});

test('claim 13: an unmatched call is untouched: nothing is read, not even the setting', async () => {
  const d = deps();
  assert.equal(await decide('Bash', { command: `echo ${SECRETS.github}` }, d), undefined);
  assert.equal(await decide('Read', { file_path: '/x' }, d), undefined);
  assert.deepEqual(d.calls, []);
});

test('claim 13: a matched call with a hit is refused in fixed words naming each rule and field', async () => {
  const d = deps();
  const r = await decide('Bash', { command: `gh pr create --title t --body "${SECRETS.github} and ${EMAIL}"` }, d);
  assert.ok(r && typeof r.deny === 'string');
  assert.match(r.deny, /^Outbound scan refused this call: /);
  assert.match(r.deny, /text shaped like a token or key in the command/);
  assert.match(r.deny, /an email address in the command/);
  assert.match(r.deny, /Remove the value and try again/);
  for (const v of [SECRETS.github, EMAIL, 'someone']) assert.ok(!r.deny.includes(v), v);
});

test('claim 13: a clean matched call passes unchanged', async () => {
  const d = deps();
  assert.equal(await decide('Bash', { command: 'git commit -m "Fix the scan" -m "Co-Authored-By: C <noreply@anthropic.com>"' }, d), undefined);
  assert.equal(await decide('SendMessage', { to: 'x', message: `report from ${HOMES.windows}` }, d), undefined);
});

test("claim 13: a hit in the mod's own tool is refused by the scan's words", async () => {
  const r = await decide(MOD_TOOLS[1], { work: 'w', why: `see ${HOMES.linux}` }, deps());
  assert.match(r.deny, /^Outbound scan refused this call: .*a home-folder path in why/);
});

test('claim 14: a body file is scanned, resolved against the folder the hook reads', async () => {
  const d = deps({ cwd: '/work', files: { '/work/b.md': file(`hello ${SECRETS.aws}`) } });
  const r = await decide('Bash', { command: 'gh pr create --title t --body-file b.md' }, d);
  assert.match(r.deny, /text shaped like a token or key in body file 1/);
  assert.ok(!r.deny.includes('b.md'));
  const ok = deps({ files: { '/abs/b.md': file('clean text') } });
  assert.equal(await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, ok), undefined);
  const win = deps({ cwd: 'C:\\work', files: { 'C:\\work\\b.md': file(EMAIL) } });
  assert.match((await decide('PowerShell', { command: 'gh pr create --body-file b.md' }, win)).deny, /email address in body file 1/);
  const sub = deps({ cwd: '/work', files: { '/work/sub/m.txt': file(EMAIL) } });
  assert.match((await decide('Bash', { command: 'git -C sub commit -F m.txt' }, sub)).deny, /body file 1/);
});

test('claim 14: a body file over 1 MiB is refused with its size', async () => {
  const big = { kind: 'file', isLink: false, size: MAX_BYTES + 1, text: '' };
  const d = deps({ files: { '/abs/b.md': big } });
  const r = await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, d);
  assert.match(r.deny, new RegExp(`body file 1 is ${MAX_BYTES + 1} bytes, over the scan's limit of 1 MiB`));
  assert.ok(!d.calls.includes('read /abs/b.md'));
  // A file that grew between the size check and the read is refused too.
  const grew = deps({ files: { '/abs/b.md': { kind: 'file', isLink: false, size: 10, text: 'x'.repeat(MAX_BYTES + 1) } } });
  assert.match((await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, grew)).deny, /over the scan's limit/);
});

test('claim 13: a pipe, a folder or a link named as a body file is refused', async () => {
  for (const f of [{ kind: 'other', isLink: false, size: 0 }, { kind: 'dir', isLink: false, size: 0 }, { kind: 'file', isLink: true, size: 3, text: 'abc' }]) {
    const d = deps({ files: { '/abs/p': f } });
    const r = await decide('Bash', { command: 'gh pr create --body-file /abs/p' }, d);
    assert.match(r.deny, /body file 1 is not a regular file/);
    assert.ok(!d.calls.includes('read /abs/p'));
  }
});

test('S3.2 step 6: a text over 1 MiB is refused with its size', async () => {
  const command = `gh pr create --body ${'x'.repeat(MAX_BYTES)}`;
  const r = await decide('Bash', { command }, deps());
  assert.match(r.deny, /the command is \d+ bytes, over the scan's limit of 1 MiB/);
});

test('q3: a relative body file after a change of folder is refused; an absolute one is read', async () => {
  const r = await decide('Bash', { command: 'cd docs && gh pr create --body-file b.md' }, deps());
  assert.match(r.deny, /body file 1 is a relative path after a change of folder/);
  const ok = deps({ files: { '/abs/b.md': file('fine') } });
  assert.equal(await decide('Bash', { command: 'cd docs && gh pr create --body-file /abs/b.md' }, ok), undefined);
});

test('claim 13: a hook failure refuses the matched call, in its own fixed words', async () => {
  for (const o of [{ statThrows: true }, { files: {} }]) {
    const r = await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, deps(o));
    assert.equal(r.deny, FAILED);
  }
  assert.match(FAILED, /the scan failed/);
  assert.match(FAILED, /\/brigade scan off/);
});

test('claim 13: a run past the time bound is refused, in its own fixed words', async () => {
  const slow = deps({ step: TIME_LIMIT_MS + 1, files: { '/abs/b.md': file('fine') } });
  assert.equal((await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, slow)).deny, TIMED_OUT);
  const hang = deps({ readHangs: true, files: { '/abs/b.md': file('fine') } });
  assert.equal((await decide('Bash', { command: 'gh pr create --body-file /abs/b.md' }, hang)).deny, TIMED_OUT);
  assert.match(TIMED_OUT, /2-second/);
  assert.match(TIMED_OUT, /\/brigade scan off/);
});

// --- the switch (claim 15, S3.2 step 9) -------------------------------------

test('claim 15: only an exact stored "on" turns the scan on', () => {
  assert.equal(settingOf('on'), 'on');
  for (const v of ['off', undefined, null, 'ON', ' on', true, 1, { on: true }, ['on']]) assert.equal(settingOf(v), 'off', String(v));
});

test('claim 15: /brigade scan on and off are read from the arguments', () => {
  assert.equal(switchArgs(''), undefined);
  assert.equal(switchArgs('done x'), undefined);
  assert.equal(switchArgs('scan on'), 'on');
  assert.equal(switchArgs('  scan   off '), 'off');
  assert.equal(switchArgs('scan'), 'show');
  assert.equal(switchArgs('scan maybe'), 'bad');
  assert.equal(switchArgs('scan on now'), 'bad');
});

test('claim 15: the switch moves only from a typed origin, composer or bridge', () => {
  for (const kind of ['composer', 'bridge']) {
    assert.deepEqual(switchReply('on', kind, 'off').set, 'on');
    assert.deepEqual(switchReply('off', kind, 'on').set, 'off');
  }
  for (const kind of ['sdk', 'peer', 'peer-send-message', 'plugin', 'task-notification', 'scheduled-trigger', 'unclassified', undefined]) {
    const r = switchReply('on', kind, 'off');
    assert.equal(r.set, undefined, String(kind));
    assert.match(r.text, /typed/, String(kind));
  }
  assert.match(switchReply('show', 'composer', 'off').text, /Outbound scan is off/);
  assert.equal(switchReply('show', 'composer', 'off').set, undefined);
});

// --- the wiring --------------------------------------------------------------

// register.tsx cannot run here, so its two facts the scan rests on are read
// from its text: the three tool names are the ones scan.ts routes, and the
// scan's hooks are registered first, which makes them the outermost (the
// engine nests a plugin's registrations in order, first outermost).
test("S3.2 step 3: the scan's hooks are the mod's outermost, on the mod's own tool names", async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
  for (const [name, tool] of [['TOOL_NAME', MOD_TOOLS[0]], ['LOG_TOOL_NAME', MOD_TOOLS[1]], ['SET_HANDOFF_NAME', MOD_TOOLS[2]]]) {
    assert.ok(src.includes(`const ${name} = '${tool}'`), name);
  }
  const body = src.slice(src.indexOf('export const register: Register = on => {'));
  const firstCall = /^\s*([A-Za-z]+)\(on\)/m.exec(body);
  assert.equal(firstCall?.[1], 'registerScan');
  const scan = src.slice(src.indexOf('function registerScan('), src.indexOf('// `/brigade scan`'));
  for (const tool of ["'Bash'", "'PowerShell'", "'SendMessage'", 'TOOL_NAME', 'LOG_TOOL_NAME', 'SET_HANDOFF_NAME']) {
    assert.ok(scan.includes(`{ tool: ${tool} }`), tool);
  }
  assert.equal((scan.match(/\.catch\(/g) ?? []).length, 6);
});

// Claim 13's last part, as far as text can show it: the scan's code in
// register.tsx writes nothing but the setting, and scan.ts reaches no engine.
test('claim 13: the scan keeps nothing: its only write is the setting', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
  const part = src.slice(src.indexOf('// --- the outbound scan'), src.indexOf('export const register: Register = on => {'));
  assert.ok(part.length > 500);
  assert.equal((part.match(/\$\.store\.set\(/g) ?? []).length, 1);
  assert.match(part, /\$\.store\.set\(SCAN_KEY, r\.set\)/);
  for (const w of ['$.fs.write', '$.state.set', 'update(', '$.session.append', '$.ui.toast', 'console.']) {
    assert.ok(!part.includes(w), w);
  }
  const mod = readFileSync(new URL('../brigade/scan.ts', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(mod), 'scan.ts imports nothing');
});
