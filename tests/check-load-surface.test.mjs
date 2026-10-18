// Tests of scripts/check.mjs: everything else the engine loads (rule 6c,
// issues 231 and 307). The plugin manifest reference lists default places at
// the plugin root that load with no manifest key, and manifest and marketplace
// keys that add component locations, run commands or change what installs.
// None is skills/ or the mod, so no other rule reads what they load.
//
// One tree per claim, and one assertion per place or key inside it: a place or
// key taken off the refusal drops its own line from the output, so the test
// still names it, at a fraction of one tree per case. The fixture they share,
// and why every case copies the tree, is in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tree, manifest, readJson, writeJson, assertPasses, assertFails, modFile } from './check-fixture.mjs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each default place at the plugin root, from the reference's "Standard
// layout", beyond skills/ and hooks/hooks.json, with one file to put there.
const PLACES = [
  ['commands', 'commands/x.md'],
  ['agents', 'agents/x.md'],
  ['output-styles', 'output-styles/x.md'],
  ['workflows', 'workflows/x.js'],
  ['themes', 'themes/x.json'],
  ['monitors', 'monitors/monitors.json'],
  ['bin', 'bin/x'],
  ['.mcp.json', '.mcp.json'],
  ['.lsp.json', '.lsp.json'],
  ['settings.json', 'settings.json'],
  ['SKILL.md', 'SKILL.md'],
];

test('each default place the engine loads at the root fails, and the failure names it', () => {
  const dir = tree();
  for (const [, file] of PLACES) modFile(dir, file, '{}\n');
  const r = assertFails(dir, /at the root is a place the engine loads/);
  for (const [place, file] of PLACES) {
    const shown = file.includes('/') ? `${place}/` : place;
    assert.match(r.stderr, new RegExp(`- ${esc(shown)} at the root is a place the engine loads \\(${esc(place)}\\)`), place);
  }
  // The way on, for a place: LOAD_ROOTS refuses, so the place comes off it.
  assert.match(r.stderr, /Remove it, or take it off LOAD_ROOTS in rule 6c of scripts\/check\.mjs/);
});

test('a default place spelled in another case fails, because an install that folds case loads it', () => {
  const dir = tree();
  modFile(dir, 'Commands/x.md', 'x\n');
  modFile(dir, 'Skill.md', 'x\n');
  const r = assertFails(dir, /Commands\/ at the root is a place the engine loads \(commands\)/);
  assert.match(r.stderr, /Skill\.md at the root is a place the engine loads \(SKILL\.md\)/);
});

test('a root entry whose name only starts or ends like a default place passes', () => {
  // The rule matches whole names. A prefix or suffix match would refuse
  // ordinary folders, and this repository's own AGENTS.md beside agents/.
  const dir = tree();
  modFile(dir, 'binaries/x', 'x\n');
  modFile(dir, 'commands-notes/x.md', 'x\n');
  modFile(dir, 'command.md', 'x\n');
  modFile(dir, 'AGENTS.md', 'x\n');
  modFile(dir, 'my-settings.json', '{}\n');
  // $schema is on both allow-lists, and the real manifests carry neither.
  writeJson(manifest(dir), { $schema: 'https://example.com/plugin.json', ...readJson(manifest(dir)) });
  const mp = join(dir, '.claude-plugin', 'marketplace.json');
  writeJson(mp, { $schema: 'https://example.com/marketplace.json', ...readJson(mp) });
  assertPasses(dir);
});

// Every top-level plugin.json key the reference lists outside the allow-list,
// and two names every JavaScript object holds, which a lookup in a plain
// object would read as present.
const PLUGIN_OFF_LIST = [
  'skills', 'commands', 'agents', 'mcpServers', 'lspServers', 'outputStyles', 'workflows', 'experimental',
  'themes', 'monitors', 'settings', 'dependencies', 'channels', 'userConfig', 'defaultEnabled', 'displayName',
  'metadata', 'icon', '__proto__', 'constructor',
];

test('every plugin.json key outside the allow-list fails, and the failure names it', () => {
  const dir = tree();
  const m = readJson(manifest(dir));
  // A path list, a boolean, a string and objects: the refusal reads the key, whatever its value.
  const value = { skills: ['./'], defaultEnabled: false, displayName: 'x', icon: './x.png' };
  for (const key of PLUGIN_OFF_LIST) Object.defineProperty(m, key, { value: Object.hasOwn(value, key) ? value[key] : {}, enumerable: true });
  writeJson(manifest(dir), m);
  const r = assertFails(dir, /plugin\.json holds "/);
  for (const key of PLUGIN_OFF_LIST) {
    assert.match(r.stderr, new RegExp(`\\.claude-plugin/plugin\\.json holds "${esc(key)}", which is not one of`), key);
  }
  // The way on, for a key: the sets allow, so the key goes onto one.
  assert.match(r.stderr, /Remove it, or add it to that list in rule 6c of scripts\/check\.mjs with a reason/);
});

// An entry accepts every plugin.json key and its own: components it appends,
// hooks that replace the manifest's, a strict switch, a command run for
// download headers. The top level can redirect where a bare source resolves,
// uninstall plugins and allow other marketplaces' plugins as dependencies.
const ENTRY_OFF_LIST = [
  'skills', 'hooks', 'commands', 'agents', 'outputStyles', 'themes', 'strict', 'mcpServers', 'headersHelper',
  'headers', 'dependencies', 'defaultEnabled', 'displayName', 'metadata', 'relevance', 'tags',
];
const MARKET_OFF_LIST = ['metadata', 'renames', 'forceRemoveDeletedPlugins', 'allowCrossMarketplaceDependenciesOn', 'version'];

test('every marketplace key outside its allow-list fails, at the top level and in an entry, and the failure names it', () => {
  const dir = tree();
  const p = join(dir, '.claude-plugin', 'marketplace.json');
  const m = readJson(p);
  for (const key of ENTRY_OFF_LIST) m.plugins[0][key] = key === 'strict' ? false : {};
  for (const key of MARKET_OFF_LIST) m[key] = {};
  writeJson(p, m);
  const r = assertFails(dir, /marketplace\.json/);
  for (const key of ENTRY_OFF_LIST) {
    assert.match(r.stderr, new RegExp(`\\.claude-plugin/marketplace\\.json "grimoire" holds "${esc(key)}", which is not one of`), key);
  }
  for (const key of MARKET_OFF_LIST) {
    assert.match(r.stderr, new RegExp(`\\.claude-plugin/marketplace\\.json holds "${esc(key)}", which is not one of`), key);
  }
});

test('a skill folder deeper than skills/<name>/ is sent to skills/<name>/SKILL.md, not to a refused skills key', () => {
  // Rule 4 used to say a category folder needs a "skills" array in
  // plugin.json, which rule 6c now refuses: following one failure into another.
  const dir = tree();
  modFile(dir, 'skills/category/inner/SKILL.md', 'x\n');
  const r = assertFails(dir, /skills\/category\/ has no SKILL\.md — the default scan reads one level, so put each skill at skills\/<name>\/SKILL\.md/);
  assert.doesNotMatch(r.stderr, /needs a "skills" array/);
});
test('a manifest spelled in another case beside the real one fails, because a checkout that folds case keeps only one of them', () => {
  // The check reads plugin.json and marketplace.json by their exact names. A
  // twin beside each can be the file a folding checkout keeps, read by no
  // rule. The long s upper-cases to S, so each twin can sit beside its manifest\n  // here; a plain upper-case twin would overwrite it on a disk that folds case.
  const dir = tree();
  modFile(dir, '.claude-plugin/plugin.j\u{17F}on', '{}\n');
  modFile(dir, '.claude-plugin/marketplace.j\u{17F}on', '{}\n');
  const r = assertFails(dir, /\.claude-plugin\/plugin\.j\u{17F}on is \.claude-plugin\/plugin\.json in another case/u);
  assert.match(r.stderr, /\.claude-plugin\/marketplace\.j\u{17F}on is \.claude-plugin\/marketplace\.json in another case/u);
});

test('a package manifest or lockfile in another case fails, as the exact name does', () => {
  // The engine installs packages when the plugin root holds a package manifest
  // and a lockfile, and an install that folds case finds Package.json.
  const dir = tree();
  modFile(dir, 'Package.json', '{}\n');
  modFile(dir, 'Bun.lock', '\n');
  const r = assertFails(dir, /Package\.json: a dependency manifest or lockfile/);
  assert.match(r.stderr, /Bun\.lock: a dependency manifest or lockfile/);
});