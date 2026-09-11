// Shared paths and one process runner for the test files.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(fileURLToPath(import.meta.url), '..', '..');
export const renderer = join(root, 'skills', 'eagle-eye', 'render.mjs');
export const check = join(root, 'scripts', 'check.mjs');
export const exampleBox = join(root, 'skills', 'eagle-eye', 'examples', 'eagle-eye-skill.box.json');
export const buildPages = join(root, 'scripts', 'build-pages.mjs');
export const groundtrack = join(root, 'skills', 'groundtrack', 'scripts', 'render.mjs');
export const examples = join(root, 'skills', 'groundtrack', 'examples');
// The small worked example: two nodes, three runs, and every move kind the
// shape has. It is the one every derived fixture starts from.
export const exampleFlightpath = join(examples, 'greet.flightpath.json');
// The layer-carrying one, which is the acceptance set for the toggle — and
// the only shipped example with two graphs, so it is also the acceptance set
// for the sheet picker and the shared node map.
export const layeredFlightpath = join(examples, 'pr-313.flightpath.json');

/**
 * Reshape a parsed copy of the small example so an error crosses three frames,
 * and the frame it starts in is one of two call sites of the same node.
 *
 * greet calls loadProfile, and loadProfile calls lookupName twice — by id,
 * then by alias. The error always starts at the second site, so the first one
 * is the row an id-keyed match would wrongly mark. Two runs:
 *
 * - "the alias is missing": lookupName throws NoSuchUser, it unwinds through
 *   loadProfile, and greet's call step catches it.
 * - "the store is down": the lookup's effect raises StoreDown, which greet
 *   does not catch, so it reaches the top. The validator refuses an uncaught
 *   tag while an open frame declares a handler for it, which is why this run
 *   raises a different tag from the first.
 *
 * Derived, never shipped: a fixture on disk would be published or would fail
 * the check. Mutates and returns the program it is given.
 */
export function errorPastTwoSites(prog) {
  const lookup = prog.nodes.lookupName;
  lookup.channels.E = ['NoSuchUser', 'StoreDown'];
  prog.nodes = {
    greet: {
      name: 'greet',
      role: 'handler',
      loc: 'src/greet.ts:8',
      params: ['userId'],
      channels: { A: 'a greeting line', E: ['StoreDown'], R: ['the name store'] },
      touches: ['src/greet.ts'],
      enteredBy: [],
      steps: [
        {
          op: 'call',
          target: 'loadProfile',
          args: { id: 'userId' },
          bind: 'profile',
          aside: 'the only call that can fail',
          onError: [{ tag: 'NoSuchUser', goto: 'plain' }],
        },
        { op: 'return', expr: '"Hello, " + profile.name' },
        { op: 'return', label: 'plain', expr: '"Hello there"' },
      ],
    },
    loadProfile: {
      name: 'loadProfile',
      role: 'service',
      loc: 'src/profile.ts:4',
      params: ['id'],
      channels: { A: 'a profile', E: ['NoSuchUser', 'StoreDown'], R: ['the name store'] },
      touches: ['src/name-store.ts'],
      enteredBy: [],
      steps: [
        { op: 'call', target: 'lookupName', args: { id: 'id' }, bind: 'name', aside: 'by id' },
        { op: 'call', target: 'lookupName', args: { id: 'alias' }, bind: 'alias', aside: 'by alias' },
        { op: 'return', expr: '{ name, alias }' },
      ],
    },
    lookupName: lookup,
  };
  const found = { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: { displayName: 'Ada' } };
  const firstLookup = [
    { k: 'call', at: 0, to: 'loadProfile', next: 1 },
    { k: 'call', at: 0, to: 'lookupName', next: 1 },
    found,
    { k: 'if', at: 1, next: 2 },
    { k: 'return', at: 2, value: 'Ada' },
    { k: 'call', at: 1, to: 'lookupName', next: 2 },
  ];
  const storeDown = { tag: 'StoreDown', message: 'the name store timed out', channel: 'retry' };
  prog.graphs = [
    {
      id: 'greet',
      title: 'greet a user, looked up twice',
      blurb: 'Enters at greet, which loads a profile by two lookups of the same node.',
      entry: 'greet',
      presets: [
        {
          name: 'the alias is missing',
          blurb: 'The second lookup throws, and greet catches it.',
          input: { userId: 'u-404' },
          walk: {
            provenance: 'authored',
            steps: [
              ...firstLookup,
              { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', next: 1, result: null },
              { k: 'if', at: 1, next: 3 },
              { k: 'throw', at: 3, tag: 'NoSuchUser', message: 'no row for that id', channel: 'escape' },
              { k: 'unwind' },
              { k: 'unwind' },
              { k: 'handled', at: 0, goto: 'plain', next: 2 },
              { k: 'return', at: 2, value: 'Hello there' },
              { k: 'done', result: 'Hello there' },
            ],
          },
        },
        {
          name: 'the store is down',
          blurb: 'The second lookup raises, and nothing catches it.',
          input: { userId: 'u-1' },
          walk: {
            provenance: 'authored',
            steps: [
              ...firstLookup,
              { k: 'effect', at: 0, kind: 'db.get', desc: 'read the name row', raised: storeDown },
              { k: 'unwind' },
              { k: 'unwind' },
              { k: 'uncaught', ...storeDown },
            ],
          },
        },
      ],
    },
  ];
  return prog;
}

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
