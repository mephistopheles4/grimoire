// The engine runs only code the mod's folders hold.
//
// The fixed-path, dependency and version rules know the mod by folder name.
// That holds only while the code the engine runs sits in those folders, and
// the engine finds it through pointers: the manifest's "hooks" key, the
// hooks/hooks.json it reads at the plugin's root, and the "modules" each hooks
// file lists. A pointer out of the mod's folders would run code no rule here
// reads. These tests break one pointer each and assert the check names it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tree, manifest, readJson, writeJson, assertPasses, assertFails, modFile, importLine } from './check-fixture.mjs';

// A small mod of the layout the plugin ships, which is the one the mods
// reference documents: hooks/hooks.json at the plugin's root names a module in
// brigade/, and the manifest names the contract there. A test of the
// manifest's own "hooks" key passes one.
// Every test starts from this and breaks one thing, so its control is the
// same tree unbroken.
function withMod(dir, { hooks, types = './brigade/types/index.d.ts' } = {}) {
  const m = readJson(manifest(dir));
  writeJson(manifest(dir), hooks === undefined ? { ...m, types } : { ...m, hooks, types });
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["../brigade/register.tsx"] }\n');
  modFile(dir, 'brigade/register.tsx', `${importLine('type { Register }', 'claude-code')}export const register: Register = () => {};\n`);
  modFile(dir, 'brigade/types/index.d.ts', "declare module 'claude-code' { interface PluginState { grimoire: { n: number } } }\n");
  return dir;
}

test('the documented layout passes: hooks/hooks.json naming a module in brigade/', () => {
  assertPasses(withMod(tree()));
});

test('a hooks/hooks.json naming a module outside the mod fails, naming the module', () => {
  // The round-one fixture from the security review of the check rules: the
  // root hooks folder is the mod's, and the module it points at is not.
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["../lib/m.tsx"] }\n');
  modFile(dir, 'lib/m.tsx', 'export const register = () => {};\n');
  assertFails(dir, /hooks\/hooks\.json names the module "\.\.\/lib\/m\.tsx", which is lib\/m\.tsx — outside the mod's folders/);
});

test('a module path that climbs with backslashes is read the same way', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["..\\\\lib\\\\m.tsx"] }\n');
  modFile(dir, 'lib/m.tsx', 'export const register = () => {};\n');
  assertFails(dir, /hooks\/hooks\.json names the module .* which is lib\/m\.tsx — outside the mod's folders/);
});

test('an absolute module path fails, because no install route puts the plugin there', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["/opt/m.tsx"] }\n');
  assertFails(dir, /hooks\/hooks\.json names the module "\/opt\/m\.tsx", an absolute path/);
});

test('a module the hooks file names and the tree does not hold fails', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ "modules": ["../brigade/gone.tsx"] }\n');
  assertFails(dir, /hooks\/hooks\.json names the module "\.\.\/brigade\/gone\.tsx", and brigade\/gone\.tsx is not there/);
});

test('a manifest "hooks" key naming a file outside the mod fails', () => {
  const dir = withMod(tree(), { hooks: './lib/hooks.json' });
  modFile(dir, 'lib/hooks.json', '{ "modules": ["./m.tsx"] }\n');
  modFile(dir, 'lib/m.tsx', 'export const register = () => {};\n');
  assertFails(dir, /plugin\.json "hooks" names "\.\/lib\/hooks\.json", which is lib\/hooks\.json — outside the mod's folders/);
});

test('a manifest "hooks" key naming a hooks file inside the mod passes', () => {
  const dir = withMod(tree(), { hooks: './brigade/hooks.json' });
  modFile(dir, 'brigade/hooks.json', '{ "modules": ["./register.tsx"] }\n');
  assertPasses(dir);
});

test('a manifest "hooks" list is read entry by entry', () => {
  // The outside entry comes first, so a check that read only the last one
  // would pass this.
  const dir = withMod(tree(), { hooks: ['./lib/hooks.json', './brigade/hooks.json'] });
  modFile(dir, 'brigade/hooks.json', '{ "modules": ["./register.tsx"] }\n');
  modFile(dir, 'lib/hooks.json', '{ "modules": [] }\n');
  assertFails(dir, /plugin\.json "hooks" names "\.\/lib\/hooks\.json", which is lib\/hooks\.json — outside the mod's folders/);
});

test('a manifest "hooks" value that is not a path fails, because the check cannot read where it leads', () => {
  const dir = withMod(tree(), { hooks: { SessionStart: [] } });
  assertFails(dir, /plugin\.json "hooks" is not a path or a list of paths/);
});

test('a hooks file holding anything but "modules" fails, because a command hook runs code no rule reads', () => {
  const dir = withMod(tree());
  modFile(
    dir,
    'hooks/hooks.json',
    '{ "modules": ["../brigade/register.tsx"], "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "node x.js" }] }] } }\n',
  );
  assertFails(dir, /hooks\/hooks\.json holds "hooks" — the check reads only "modules"/);
});

test('a hooks file that is not JSON fails, naming it', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ modules: [ ../brigade/register.tsx ] }\n');
  assertFails(dir, /hooks\/hooks\.json is not JSON/);
});

test('a manifest "types" key naming a file outside the mod fails', () => {
  const dir = withMod(tree(), { types: './lib/index.d.ts' });
  modFile(dir, 'lib/index.d.ts', 'export {};\n');
  assertFails(dir, /plugin\.json "types" names "\.\/lib\/index\.d\.ts", which is lib\/index\.d\.ts — outside the mod's folders/);
});

test('a relative import from the mod out of its folders fails, naming the file', () => {
  // The module may import the plugin's own files, and the engine loads each
  // one it reaches. A climb out of the mod's folders is code no rule reads.
  const dir = withMod(tree());
  modFile(dir, 'brigade/register.tsx', importLine('{ x }', '../scripts/lib/tree.mjs'));
  assertFails(dir, /brigade\/register\.tsx:1 imports "\.\.\/scripts\/lib\/tree\.mjs", which is scripts\/lib\/tree\.mjs — outside the mod's folders/);
});

test('a relative import between the two mod folders passes', () => {
  const dir = withMod(tree());
  modFile(dir, 'brigade/register.tsx', importLine('{ x }', '../hooks/shared.ts'));
  modFile(dir, 'hooks/shared.ts', 'export const x = 1;\n');
  const r = assertPasses(dir);
  assert.doesNotMatch(r.stderr, /outside the mod's folders/);
});

test('a manifest-named hooks file inside the mod has its modules read too', () => {
  const dir = withMod(tree(), { hooks: './brigade/hooks.json' });
  modFile(dir, 'brigade/hooks.json', '{ "modules": ["../lib/m.tsx"] }\n');
  modFile(dir, 'lib/m.tsx', 'export const register = () => {};\n');
  assertFails(dir, /brigade\/hooks\.json names the module "\.\.\/lib\/m\.tsx", which is lib\/m\.tsx — outside the mod's folders/);
});

test('a hooks file that is JSON but not an object fails', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '["../brigade/register.tsx"]\n');
  assertFails(dir, /hooks\/hooks\.json is not a JSON object with a "modules" list/);
});

test('a "modules" value that is not a list of paths fails', () => {
  const dir = withMod(tree());
  modFile(dir, 'hooks/hooks.json', '{ "modules": "../brigade/register.tsx" }\n');
  assertFails(dir, /hooks\/hooks\.json "modules" is not a list of paths/);
});

test('a manifest "types" value that is not a path fails', () => {
  const dir = withMod(tree(), { types: ['./brigade/types/index.d.ts'] });
  assertFails(dir, /plugin\.json "types" is not a path/);
});

test('a relative import that climbs out of the repository fails', () => {
  const dir = withMod(tree());
  modFile(dir, 'brigade/register.tsx', importLine('{ x }', '../../elsewhere/m.ts'));
  assertFails(dir, /brigade\/register\.tsx:1 imports "\.\.\/\.\.\/elsewhere\/m\.ts", a path out of the repository/);
});

// Three ways to write an import that the line patterns of the dependency rule
// do not read. Each loads in the engine, so each is held all the same.
const q = "'";
for (const [name, text, line] of [
  ['behind a comment', `/* x */ import { y } from ${q}../scripts/lib/tree.mjs${q};\n`, 1],
  ['with its path on the next line', `import { y } from\n  ${q}../scripts/lib/tree.mjs${q};\n`, 2],
  ['after a semicolon', `;import { y } from ${q}../scripts/lib/tree.mjs${q};\n`, 1],
]) {
  test(`a relative import out of the mod ${name} fails`, () => {
    const dir = withMod(tree());
    modFile(dir, 'brigade/extra.ts', text);
    assertFails(dir, new RegExp(`brigade/extra\\.ts:${line} imports "\\.\\./scripts/lib/tree\\.mjs", which is scripts/lib/tree\\.mjs — outside the mod's folders`));
  });
}

test('an absolute import path in the mod fails', () => {
  const dir = withMod(tree());
  modFile(dir, 'brigade/extra.ts', importLine('{ y }', '/opt/lib/m.ts'));
  assertFails(dir, /brigade\/extra\.ts:1 imports "\/opt\/lib\/m\.ts", an absolute path/);
});

test('a mod folder spelled in another case fails, because an install that folds case loads it', () => {
  const dir = withMod(tree());
  rmSync(join(dir, 'hooks'), { recursive: true, force: true });
  modFile(dir, 'Hooks/hooks.json', '{ "modules": ["../lib/m.tsx"] }\n');
  assertFails(dir, /Hooks\/ at the root is hooks\/ in another case/);
});