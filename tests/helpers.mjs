// Shared paths and one process runner for the test files.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(fileURLToPath(import.meta.url), '..', '..');
export const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');
export const check = join(root, 'scripts', 'check.mjs');
export const exampleBox = join(root, 'skills', 'eagle-eye', 'examples', 'eagle-eye-skill.box.json');

// Run a node script and report both streams and the exit code, rather than
// throwing. A test about a gate that fails needs the failure, not an exception.
// Every script under test says the interesting part on stderr and the answer
// on stdout, so a runner that drops either one can only test half of them.
//
// GRIMOIRE_IN_TEST stops the recursion: scripts/check.mjs runs this suite as
// its last step, and this suite runs scripts/check.mjs. Whichever one starts,
// the child sees the variable and does not start the other again.
//
// Pass `env: { GRIMOIRE_IN_TEST: null }` to clear it, which is how a test
// reaches the test step itself. Only do that against a copied tree that has no
// tests/ directory; against this one it recurses.
export function run(script, args = [], opts = {}) {
  const env = { ...process.env, GRIMOIRE_IN_TEST: '1', ...opts.env };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  // Node sets NODE_TEST_CONTEXT for anything a test file spawns, and a
  // `node --test` that sees it refuses to run: "run() is being called
  // recursively within a test file. skipping running files." It skips and
  // exits 0, so a suite that should have failed reads as a suite that passed —
  // which is how the test for a failing suite first went green. The scripts
  // spawned here are not test files, so the variable does not belong to them.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd || root,
    env,
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
