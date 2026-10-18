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
  for (const key of PLUGIN_OFF_LIST) Object.defineProperty(m, key, { value: key === 'skills' ? ['./'] : {}, enumerable: true });
  writeJson(manifest(dir), m);
  const r = assertFails(dir, /plugin\.json holds "/);
  for (const key of PLUGIN_OFF_LIST) {
    assert.match(r.stderr, new RegExp(`\\.claude-plugin/plugin\\.json holds "${esc(key)}", which is not one of`), key);
  }
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
