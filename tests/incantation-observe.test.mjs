// Tests of observe.mjs (docs/spec/incantation.md, S4.4; claim 24): a fixture
// home, the command line run as the skill runs it, and the exported functions
// with a fixed clock. File modes are POSIX, so the mode checks skip on win32.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, utimesSync, renameSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { add, freeze } from '../plugins/incantation/skills/incantation/scripts/observe.mjs';

const OBSERVE = fileURLToPath(new URL('../plugins/incantation/skills/incantation/scripts/observe.mjs', import.meta.url));
const modes = process.platform === 'win32' ? 'POSIX file modes: skipped on win32, run in the athanor container and in CI' : false;
const NOW = new Date('2026-11-12T10:20:30Z');
const REFUSED = 'observe error: refused\n';

const home = t => {
  const dir = mkdtempSync(join(tmpdir(), 'incantation-observe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
// The command line, with this fixture as its home. For `add`, the line goes
// where the session's write tool puts it: a fresh inbox file, passed by name.
const run = (h, args) => spawnSync(process.execPath, [OBSERVE, ...args], { env: { HOME: h, USERPROFILE: h, PATH: process.env.PATH }, encoding: 'utf8', timeout: 8000 });
const cli = (h, args, input) => {
  if (args[0] !== 'add' || input === undefined) return run(h, args);
  const hex = randomBytes(4).toString('hex');
  mkdirSync(join(h, '.grimoire', 'incantation', 'observe'), { recursive: true, mode: 0o700 });
  writeFileSync(join(h, '.grimoire', 'incantation', 'observe', `inbox-${hex}.json`), input);
  return run(h, ['add', hex]);
};
const line = (over = {}) => JSON.stringify({ kind: 'result', urgency: 3, score: 0.62, words: 'The build is green.', spoken: false, ...over });
const everything = dir => readdirSync(dir, { withFileTypes: true, recursive: true }).map(e => join(e.parentPath ?? e.path, e.name).slice(dir.length));

test('add writes one line to that day\'s file, in a 0700 folder with a 0600 file, and writes nowhere else', { skip: modes }, t => {
  const h = home(t);
  const r = cli(h, ['add'], `${line()}\n`);
  assert.equal(r.stdout, 'observe: ok\n');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const folder = join(h, '.grimoire', 'incantation', 'observe');
  assert.equal(statSync(folder).mode & 0o777, 0o700);
  const files = readdirSync(folder);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.equal(statSync(join(folder, files[0])).mode & 0o777, 0o600);
  const lines = readFileSync(join(folder, files[0]), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(entry).sort(), ['kind', 'length', 'reaction', 'score', 'spoken', 'time', 'urgency', 'words']);
  assert.equal(entry.reaction, '');
  assert.equal(entry.length, 'The build is green.'.length);
  assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(everything(h).filter(p => !p.startsWith('/.grimoire')), [], 'nothing outside ~/.grimoire');
  assert.deepEqual(everything(join(h, '.grimoire', 'incantation')), ['/observe', `/observe/${files[0]}`]);
  cli(h, ['add'], `${line({ words: 'Second.' })}\n`);
  assert.equal(readFileSync(join(folder, files[0]), 'utf8').split('\n').filter(Boolean).length, 2, 'a second line is appended to the same day');
});

test('add refuses an unlisted key, an unknown kind and a line it cannot parse, with a fixed line and nothing written', t => {
  const marker = 'MARKER-8e41c0';
  const bad = [
    line({ extra: marker }),
    line({ kind: marker }),
    line({ kind: 'chat' }),
    `{ not json ${marker}`,
    JSON.stringify([1, 2]),
    JSON.stringify('words'),
    line({ words: 12 }),
    line({ words: '' }),
    line({ words: 'Edit /etc/hosts for me' }),
    line({ words: 'open src/lib/x now' }),
    line({ words: 'see C:\\work\\notes' }),
    line({ words: 'copy it to ~/notes' }),
    line({ words: 'mail the draft to someone@example.com' }),
    line({ words: `the key is ${'k3y9'.repeat(7)}` }), // a long unbroken run, built here so no key pattern sits in the file
    line({ urgency: 'high' }),
    line({ score: null }),
    line({ spoken: 'no' }),
    line({ time: '2026-01-01T00:00:00Z' }),
    line({ reaction: 'liked it' }),
    '',
    `${line()}\n${line()}\n`,
    JSON.stringify({ kind: 'result', urgency: 3, score: 0.6, spoken: false }),
  ];
  for (const input of bad) {
    const h = home(t);
    const r = cli(h, ['add'], input);
    assert.equal(r.stdout, REFUSED, JSON.stringify(input).slice(0, 60));
    assert.equal(r.status, 1);
    assert.equal(r.stderr, '');
    // The inbox file needs its folder; past that, nothing is left: the inbox is gone and no day file was made.
    assert.deepEqual(readdirSync(join(h, '.grimoire', 'incantation')), ['observe']);
    assert.deepEqual(readdirSync(join(h, '.grimoire', 'incantation', 'observe')), [], 'nothing written, and the inbox deleted');
    assert.ok(!r.stdout.includes(marker));
  }
  const h = home(t);
  assert.equal(cli(h, ['add'], 'x'.repeat(20_000)).stdout, REFUSED, 'a line over the cap');
  assert.equal(cli(h, ['bogus']).stdout, 'usage: observe.mjs add <8 hex> | freeze <n>\n');
  assert.deepEqual(readdirSync(join(h, '.grimoire', 'incantation', 'observe')), [], 'the over-cap inbox is deleted, and nothing written');
});

test('add keeps ordinary words that only resemble a path or a key', t => {
  const h = home(t);
  for (const words of ['The build and/or the tests are done.', 'It took 3.5 s, 40% of the budget.', 'Ready at 10:30 for review.']) add({ home: h, now: NOW, input: line({ words }) });
  const [file] = readdirSync(join(h, '.grimoire', 'incantation', 'observe'));
  assert.equal(readFileSync(join(h, '.grimoire', 'incantation', 'observe', file), 'utf8').split('\n').filter(Boolean).length, 3);
});

test('add cuts the words at 500 characters and cleans them as wait cleans heard text', t => {
  const h = home(t);
  const words = `a\u0007b‮c d​e${' xy'.repeat(300)}`;
  add({ home: h, now: NOW, input: line({ words }) });
  const [file] = readdirSync(join(h, '.grimoire', 'incantation', 'observe'));
  const entry = JSON.parse(readFileSync(join(h, '.grimoire', 'incantation', 'observe', file), 'utf8'));
  assert.equal(entry.words, `abcde${' xy'.repeat(300)}`.slice(0, 500));
  assert.equal(entry.length, 500);
});

test('each run drops day files over 30 days old, and leaves eval/ and newer files alone', t => {
  const h = home(t);
  const folder = join(h, '.grimoire', 'incantation', 'observe');
  mkdirSync(join(folder, 'eval'), { recursive: true });
  for (const name of ['2026-10-12.jsonl', '2026-10-13.jsonl', '2026-09-01.jsonl', '2025-01-01.jsonl']) writeFileSync(join(folder, name), '{}\n');
  writeFileSync(join(folder, 'eval', '2020-01-01.jsonl'), '{}\n'); // a name a recursive prune would match
  writeFileSync(join(folder, 'notes.txt'), 'not a day file');
  add({ home: h, now: NOW, input: line() });
  assert.deepEqual(readdirSync(folder).sort(), ['2026-10-13.jsonl', '2026-11-12.jsonl', 'eval', 'notes.txt']);
  assert.deepEqual(readdirSync(join(folder, 'eval')), ['2020-01-01.jsonl']);
  writeFileSync(join(folder, '2026-09-02.jsonl'), '{}\n');
  freeze({ home: h, now: NOW, n: 1, random: () => 0 });
  assert.equal(existsSync(join(folder, '2026-09-02.jsonl')), false, 'freeze drops them too');
  assert.equal(existsSync(join(folder, '2026-10-13.jsonl')), true, 'and keeps a file exactly 30 days old');
});

test('every run drops old day files, a refused one included, and the folder is made 0700', { skip: modes }, t => {
  const h = home(t);
  const folder = join(h, '.grimoire', 'incantation', 'observe');
  mkdirSync(folder, { recursive: true, mode: 0o755 });
  writeFileSync(join(folder, '2020-01-01.jsonl'), '{}\n');
  writeFileSync(join(folder, '2020-01-02.jsonl'), '{}\n');
  assert.equal(cli(h, ['add'], '{}').stdout, REFUSED);
  assert.equal(existsSync(join(folder, '2020-01-01.jsonl')), false);
  assert.equal(cli(h, ['add'], line()).stdout, 'observe: ok\n');
  assert.equal(existsSync(join(folder, '2020-01-02.jsonl')), false);
  assert.equal(statSync(folder).mode & 0o777, 0o700);
});

test('freeze n copies n lines into eval/, 0700 and 0600, and the sample is a subset of the log', { skip: modes }, t => {
  const h = home(t);
  const folder = join(h, '.grimoire', 'incantation', 'observe');
  mkdirSync(folder, { recursive: true });
  const all = [];
  for (const [day, count] of [['2026-11-10', 6], ['2026-11-11', 6]]) {
    const lines = Array.from({ length: count }, (_, i) => JSON.stringify({ kind: 'result', urgency: 1, score: 0.1, words: `${day} ${i}`, spoken: false, length: 12, time: `${day}T00:00:0${i}Z`, reaction: '' }));
    writeFileSync(join(folder, `${day}.jsonl`), `${lines.join('\n')}\n`);
    all.push(...lines);
  }
  const r = cli(h, ['freeze', '5']);
  assert.equal(r.stdout, 'observe: froze 5\n');
  const evalDir = join(folder, 'eval');
  assert.equal(statSync(evalDir).mode & 0o777, 0o700);
  const [file] = readdirSync(evalDir);
  assert.equal(statSync(join(evalDir, file)).mode & 0o777, 0o600);
  const sample = readFileSync(join(evalDir, file), 'utf8').split('\n').filter(Boolean);
  assert.equal(sample.length, 5);
  assert.equal(new Set(sample).size, 5, 'no line twice');
  for (const s of sample) assert.ok(all.includes(s));
  assert.equal(readdirSync(folder).filter(n => n.endsWith('.jsonl')).length, 2, 'the log is untouched');
  assert.deepEqual(everything(h).filter(p => !p.startsWith('/.grimoire')), []);
  assert.equal(cli(h, ['freeze', '50']).stdout, 'observe: froze 12\n', 'more than there are: all of them');
  for (const bad of ['0', '-1', 'x', '1.5', '', '100000']) assert.equal(cli(h, ['freeze', bad]).stdout, REFUSED, bad);
  assert.equal(cli(h, ['freeze']).stdout, REFUSED);
});

test('freeze with an empty log refuses and writes nothing', t => {
  const h = home(t);
  assert.equal(cli(h, ['freeze', '3']).stdout, REFUSED);
  assert.equal(existsSync(join(h, '.grimoire', 'incantation', 'observe', 'eval')), false);
});

test('add takes only an 8-hex name, reads only that inbox file, and deletes it on every result', t => {
  const h = home(t);
  const inbox = hex => join(h, '.grimoire', 'incantation', 'observe', `inbox-${hex}.json`);
  mkdirSync(join(h, '.grimoire', 'incantation', 'observe'), { recursive: true, mode: 0o700 });
  writeFileSync(inbox('0badf00d'), line());
  writeFileSync(inbox('deadbeef'), '{"not": "valid"}');
  for (const bad of ['', 'DEADBEEF', '0badf00', '0badf00d0', '../x', 'inbox-0badf00d']) assert.equal(run(h, ['add', bad]).stdout, REFUSED, bad);
  assert.equal(existsSync(inbox('0badf00d')), true, 'a refused name touches no file');
  assert.equal(run(h, ['add', 'deadbeef']).stdout, REFUSED);
  assert.equal(existsSync(inbox('deadbeef')), false, 'deleted after a refusal');
  assert.equal(run(h, ['add', '0badf00d']).stdout, 'observe: ok\n');
  assert.equal(existsSync(inbox('0badf00d')), false, 'deleted after an append');
  assert.equal(run(h, ['add', '0badf00d']).stdout, REFUSED, 'gone: nothing to read');
});

test('add refuses an observe folder that is a link or junction, or a day file that is a link, and writes nothing through it', t => {
  const h = home(t);
  const outside = home(t);
  mkdirSync(join(outside, 'observe'), { recursive: true });
  mkdirSync(join(h, '.grimoire', 'incantation'), { recursive: true });
  symlinkSync(join(outside, 'observe'), join(h, '.grimoire', 'incantation', 'observe'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => add({ home: h, now: NOW, input: line() }));
  assert.deepEqual(readdirSync(join(outside, 'observe')), [], 'nothing written through the link');
  if (process.platform === 'win32') return; // a file symlink needs a privilege Windows withholds
  const h2 = home(t);
  const target = join(outside, 'target.jsonl');
  writeFileSync(target, '');
  mkdirSync(join(h2, '.grimoire', 'incantation', 'observe'), { recursive: true });
  symlinkSync(target, join(h2, '.grimoire', 'incantation', 'observe', '2026-11-12.jsonl'));
  assert.throws(() => add({ home: h2, now: NOW, input: line() }));
  assert.equal(readFileSync(target, 'utf8'), '');
});

test('an inbox file never passed to add is dropped after a day, a fresh one is kept', t => {
  const h = home(t);
  const folder = join(h, '.grimoire', 'incantation', 'observe');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'inbox-0000aaaa.json'), line());
  writeFileSync(join(folder, 'inbox-0000bbbb.json'), line());
  const old = (NOW.getTime() - 2 * 86_400_000) / 1000;
  utimesSync(join(folder, 'inbox-0000aaaa.json'), old, old);
  utimesSync(join(folder, 'inbox-0000bbbb.json'), NOW.getTime() / 1000, NOW.getTime() / 1000);
  add({ home: h, now: NOW, input: line() });
  assert.equal(existsSync(join(folder, 'inbox-0000aaaa.json')), false);
  assert.equal(existsSync(join(folder, 'inbox-0000bbbb.json')), true);
});
