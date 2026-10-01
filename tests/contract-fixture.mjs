// skills/contract/scripts/check.mjs reads files a stranger may hand over, and
// its exit code is the verdict the skill acts on. So every test here drives it
// through its command line, the way the skill does, and asserts the exit code
// and the lines it prints — never anything inside it.
//
// Every fixture is written into a temporary folder at run time and removed
// after. None is committed: a SKILL.md anywhere in the tree is read by
// scripts/check.mjs as a skill, and a broken one would fail it.
//
// The numbered cases follow the plan the check was built to, so a failure
// names the rule it guards. Cases 25 onwards, and the "held by a mutation"
// cases, each close a gap a mutation found: a behaviour that could be removed
// with every earlier test still green.
//
// Characters that are invisible, or that a terminal acts on, are written as
// \u{...} escapes and never typed literally. A literal one in this file is
// the thing the check exists to catch, and a reader cannot see it.

// The shared fixture for the tests of skills/contract/scripts/check.mjs. The
// tests are split across tests/contract-check-*.test.mjs so that node --test
// runs them in parallel; one file ran them one after another. Nothing here is
// a test.

import { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { root } from './helpers.mjs';

export const SCRIPT = join(root, 'skills', 'contract', 'scripts', 'check.mjs');

export let base;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'contract-check-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

export function fresh() {
  return mkdtempSync(join(base, 't-'));
}

export function run(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: cwd ?? base });
  if (r.error) throw r.error;
  const lines = r.stdout.split('\n').filter(l => l !== '');
  return { code: r.status, out: r.stdout, lines, err: r.stderr };
}

export function has(r, prefix) {
  return r.lines.some(l => l.startsWith(prefix));
}

export function show(r) {
  return `exit ${r.code}\n${r.out}${r.err}`;
}

// The exit code, the lines asked for, and exactly one RESULT line that agrees
// with the code. A second RESULT line is what an injected one would look like.
export function expect(r, code, ...prefixes) {
  assert.equal(r.code, code, show(r));
  for (const p of prefixes) assert.ok(has(r, p), `missing a line starting "${p}"\n${show(r)}`);
  const results = r.lines.filter(l => l.startsWith('RESULT:'));
  assert.equal(results.length, 1, show(r));
  assert.equal(results[0], code === 0 ? 'RESULT: pass' : 'RESULT: fail', show(r));
}

// A line printed exactly once. A warning is one line per key, so a second
// copy is a rule that ran twice.
export function once(r, line) {
  assert.equal(r.lines.filter(l => l === line).length, 1, `want the line "${line}" exactly once\n${show(r)}`);
}

// The danger warning for sandbox_mode at a line.
export const SANDBOX_DANGER = n => `WARN danger: sandbox_mode at line ${n} may let the agent act outside a sandbox`;

export const CONTRACT = 'Version: 1.0.0\n\n# Contract\n\nWhat this familiar is for.\n';

// A skill's digest covers its whole folder and cannot say which file changed.
export const BROKEN = "FAIL familiar-digest: the seal is broken; a file in the familiar's folder changed since it was sealed";

export function familiarText(fm, body = '# Demo\n\nBody text.\n') {
  return `---\n${fm.join('\n')}\n---\n${body}`;
}

export function defaultFm(name) {
  return [`name: ${name}`, 'description: A test skill that does one thing.'];
}

/** Write a skill folder <parent>/<folder>/SKILL.md (+ CONTRACT.md). Returns the folder path. */
export function skill({ name = 'demo', folder, fm, body, text, contract, parent } = {}) {
  const dir = join(parent ?? fresh(), folder ?? name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), text ?? familiarText(fm ?? defaultFm(name), body));
  if (contract !== undefined) writeFileSync(join(dir, 'CONTRACT.md'), contract);
  return dir;
}

export function sealAndCheck(dir) {
  const s = run(['--seal', dir]);
  expect(s, 0, 'PASS seal: wrote ');
  const c = run([dir]);
  expect(c, 0, 'PASS familiar-digest', 'PASS contract-digest', 'PASS contract-version');
  return c;
}

export function editFile(path, from, to) {
  const t = readFileSync(path, 'utf8');
  assert.ok(t.includes(from), `fixture edit: "${from}" not found`);
  writeFileSync(path, t.replace(from, to));
}

export function digestOf(path) {
  const m = /familiar-digest: "(sha256:[0-9a-f]{64})"/.exec(readFileSync(path, 'utf8'));
  assert.ok(m, 'no familiar-digest in the sealed file');
  return m[1];
}

/** Lines with their own terminators kept, so a changed ending shows as a changed line. */
export function splitKeep(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 13 || c === 10) {
      const end = c === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      out.push(text.slice(start, end));
      i = end - 1;
      start = end;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** Make a folder, or return null where the file system refuses the name. */
export function tryMkdir(path) {
  try {
    mkdirSync(path, { recursive: true });
    return path;
  } catch {
    return null;
  }
}

/** Make a symbolic link, or return the error code where the platform refuses. */
export function trySymlink(target, path, type) {
  try {
    symlinkSync(target, path, type);
    return null;
  } catch (err) {
    return err.code ?? 'error';
  }
}

/** Write a file under a folder, making the folders on its path. */
export function put(dir, rel, content) {
  const p = join(dir, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

/** Every path under a folder, sorted, so a test can see that nothing was added or left. */
export function listing(dir) {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

/**
 * Write a file by a name the file system may refuse or change, such as one
 * ending in "." or holding "\". True only when the name landed as given.
 */
export function tryPut(dir, name, content) {
  try {
    writeFileSync(join(dir, name), content);
  } catch {
    return false;
  }
  return readdirSync(dir).includes(name);
}
