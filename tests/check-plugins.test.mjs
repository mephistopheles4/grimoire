// Tests of scripts/check.mjs: the rules widened to every plugin under
// plugins/<name>/ (spec docs/spec/incantation.md, S5 and claim 7). One case per
// widened rule. The fixture they share, and why every case copies the tree, is
// in check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tree, readJson, writeJson, assertPasses, assertFails, fixturePlugin, repo, baselineName } from './check-fixture.mjs';

const market = dir => join(dir, '.claude-plugin', 'marketplace.json');
const pluginManifest = base => join(base, '.claude-plugin', 'plugin.json');
const skillFile = base => join(base, 'skills', 'fixture-plugin', 'SKILL.md');

// Rule 4, the marketplace entries (claim 7).

test('a second marketplace entry at plugins/<name> with its own manifest passes', () => {
  const dir = tree();
  fixturePlugin(dir);
  assertPasses(dir);
});

test('a second entry whose source is outside ./plugins/<name> fails', () => {
  const dir = tree();
  fixturePlugin(dir);
  const m = readJson(market(dir));
  m.plugins.find(p => p.name === 'fixture-plugin').source = './skills';
  writeJson(market(dir), m);
  assertFails(dir, /"fixture-plugin": source is ".\/skills"; a plugin other than the root one must be at "\.\/plugins\/fixture-plugin"/);
});

test('a second entry whose source climbs out of plugins/ fails', () => {
  const dir = tree();
  fixturePlugin(dir);
  const m = readJson(market(dir));
  m.plugins.find(p => p.name === 'fixture-plugin').source = './plugins/../skills';
  writeJson(market(dir), m);
  assertFails(dir, /a plugin other than the root one must be at/);
});

test('a second entry whose folder has no manifest fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeFileSync(pluginManifest(base), 'not json');
  assertFails(dir, /plugins\/fixture-plugin\/\.claude-plugin\/plugin\.json is missing or is not JSON/);
});

test('a second entry whose folder is missing altogether fails', () => {
  const dir = tree();
  fixturePlugin(dir);
  rmSync(join(dir, 'plugins', 'fixture-plugin'), { recursive: true });
  assertFails(dir, /marketplace\.json "fixture-plugin" points at a folder with no manifest/);
});

test('a second entry whose name is not a plugin folder name fails', () => {
  const dir = tree();
  fixturePlugin(dir);
  const m = readJson(market(dir));
  m.plugins.find(p => p.name === 'fixture-plugin').name = 'Bad_Name';
  writeJson(market(dir), m);
  assertFails(dir, /a plugin's name holds lowercase letters, digits and hyphens only/);
});

test('a second entry that names a different plugin than its manifest fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeJson(pluginManifest(base), { ...readJson(pluginManifest(base)), name: 'someone-else' });
  assertFails(dir, /"fixture-plugin" points at plugins\/fixture-plugin, whose manifest calls the plugin "someone-else"/);
});

test('a second entry that carries a version fails', () => {
  const dir = tree();
  fixturePlugin(dir);
  const m = readJson(market(dir));
  m.plugins.find(p => p.name === 'fixture-plugin').version = '9.9.9';
  writeJson(market(dir), m);
  assertFails(dir, /"fixture-plugin": drop "version"/);
});

test('the entry named like the root plugin keeps source ./', () => {
  const dir = tree();
  fixturePlugin(dir);
  const m = readJson(market(dir));
  m.plugins[0].source = './plugins/grimoire';
  writeJson(market(dir), m);
  assertFails(dir, /"grimoire": source is "\.\/plugins\/grimoire"; the plugin at the root is one plugin, so its entry must be "\.\/"/);
});

test('a plugins/<name> folder with no manifest fails, listed or not', () => {
  const dir = tree();
  mkdirSync(join(dir, 'plugins', 'orphan', 'skills'), { recursive: true });
  assertFails(dir, /plugins\/orphan\/\.claude-plugin\/plugin\.json is missing or is not JSON/);
});

// Rules 6b and 6c, the load roots and the manifest keys.

test('a commands folder in a plugin fails, as it does at the root', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'commands'));
  assertFails(dir, /plugins\/fixture-plugin\/commands\/ in the plugin is a place the engine loads \(commands\)/);
});

test('a hooks folder in a plugin fails, since the engine loads hooks/hooks.json there', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'hooks'));
  assertFails(dir, /plugins\/fixture-plugin\/hooks\/ in the plugin is a place the engine loads \(hooks\)/);
});

test('a load root in a plugin fails in another case too', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeFileSync(join(base, '.MCP.json'), '{}');
  // On a disk that folds case this is the same file as .mcp.json, and the
  // message still names the root it matched.
  assertFails(dir, /plugins\/fixture-plugin\/\.MCP\.json in the plugin is a place the engine loads/);
});

test('a manifest key outside the allow-list fails in a plugin, hooks and types included', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeJson(pluginManifest(base), { ...readJson(pluginManifest(base)), hooks: './hooks.json', commands: './c', types: './t.d.ts' });
  const r = assertFails(dir, /plugins\/fixture-plugin\/\.claude-plugin\/plugin\.json holds "hooks"/);
  assert.match(r.stderr, /plugin\.json holds "commands"/);
  assert.match(r.stderr, /plugin\.json holds "types"/);
});

test('a plugin manifest with no version fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const { version, ...rest } = readJson(pluginManifest(base));
  writeJson(pluginManifest(base), rest);
  assertFails(dir, /plugins\/fixture-plugin\/\.claude-plugin\/plugin\.json has no version/);
});

test('a plugin folder spelled like skills/ in another case fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  // Taken out first, so a disk that folds case holds one folder and the case
  // rule is the only thing that fires.
  rmSync(join(base, 'skills'), { recursive: true });
  mkdirSync(join(base, 'Skills'));
  assertFails(dir, /plugins\/fixture-plugin\/Skills\/ in the plugin is skills\/ in another case/);
});

test('plugins/ at the root spelled in another case fails', () => {
  const dir = tree();
  rmSync(join(dir, 'plugins'), { recursive: true, force: true });
  mkdirSync(join(dir, 'Plugins'));
  assertFails(dir, /Plugins\/ at the root is plugins\/ in another case/);
});

test('a skill directory in a plugin with no SKILL.md fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'skills', 'empty'));
  assertFails(dir, /plugins\/fixture-plugin\/skills\/empty\/ has no SKILL\.md/);
});

// Rules 2 and 2c, fixed paths and hidden characters.

test('a fixed home path in a plugin skill fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  appendFileSync(skillFile(base), '\nSee ~/.claude/skills/ for the file.\n');
  assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/SKILL\.md:\d+ holds a fixed path/);
});

test('a fixed home path in a plugin script and its README fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'skills', 'fixture-plugin', 'scripts'));
  writeFileSync(join(base, 'skills', 'fixture-plugin', 'scripts', 'a.mjs'), "export const p = '/home/someone/x';\n");
  writeFileSync(join(base, 'README.md'), 'Run it from /home/someone/x.\n');
  const r = assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/scripts\/a\.mjs:1 holds a fixed path/);
  assert.match(r.stderr, /plugins\/fixture-plugin\/README\.md:1 holds a fixed path/);
});

test('a hidden character in a plugin file fails, scripts and README included', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'skills', 'fixture-plugin', 'scripts'));
  writeFileSync(join(base, 'skills', 'fixture-plugin', 'scripts', 'a.mjs'), 'export const a = 1;​\n');
  writeFileSync(join(base, 'README.md'), 'Read me‮.\n');
  const r = assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/scripts\/a\.mjs:1 holds U\+200B/);
  assert.match(r.stderr, /plugins\/fixture-plugin\/README\.md:1 holds U\+202E/);
});

test('a frontmatter key off the allow-list fails in a plugin skill', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeFileSync(skillFile(base), '---\nname: fixture-plugin\ndescription: x\nhooks: y\n---\n\n# Fixture\n');
  assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/SKILL\.md:4 has the frontmatter key "hooks"/);
});

test('a bare fence in a plugin README fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeFileSync(join(base, 'README.md'), '# Fixture\n\n```\nbare\n```\n');
  assertFails(dir, /plugins\/fixture-plugin\/README\.md:3 opens a code fence with no language/);
});

test('a dependency import in a plugin script fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  mkdirSync(join(base, 'skills', 'fixture-plugin', 'scripts'));
  writeFileSync(join(base, 'skills', 'fixture-plugin', 'scripts', 'a.mjs'), `import x from ${"'"}left-pad${"'"};\n`);
  assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/scripts\/a\.mjs:1 imports "left-pad"/);
});

// Rule 5, the version bump in the plugin's own manifest.

test('a change to a plugin with no bump of its own manifest fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const git = repo(dir);
  appendFileSync(skillFile(base), '\nOne more sentence, shipped to nobody.\n');
  git('commit', '-aqm', 'change the plugin');
  const r = assertFails(dir, /1 file\(s\) in plugins\/fixture-plugin\/ changed since origin\/main, but its version is still 0\.1\.0/);
  assert.match(r.stderr, /plugin users receive no update/);
});

test('the same plugin change passes once its own version moves, and moves no other', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const git = repo(dir);
  appendFileSync(skillFile(base), '\nOne more sentence, and a release to carry it.\n');
  writeJson(pluginManifest(base), { ...readJson(pluginManifest(base)), version: '0.2.0' });
  git('commit', '-aqm', 'change the plugin and bump it');
  assertPasses(dir);
});

test('a change to the root plugin is not met by bumping another plugin', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const git = repo(dir);
  appendFileSync(join(dir, 'skills', 'unsealed-fixture', 'SKILL.md'), '\nOne more sentence.\n');
  writeJson(pluginManifest(base), { ...readJson(pluginManifest(base)), version: '0.2.0' });
  git('commit', '-aqm', 'change a root skill and bump the other plugin');
  assertFails(dir, /skill or mod file\(s\) changed since origin\/main, but version is still/);
});

test('a change to a plugin does not ask for a bump of the root plugin', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const git = repo(dir);
  appendFileSync(skillFile(base), '\nOne more sentence.\n');
  writeJson(pluginManifest(base), { ...readJson(pluginManifest(base)), version: '0.2.0' });
  git('commit', '-aqm', 'change the plugin');
  const r = assertPasses(dir);
  assert.doesNotMatch(r.stdout + r.stderr, /but version is still/);
});

test('a plugin added in this branch needs no bump and the check says it skipped', () => {
  const dir = tree();
  const git = repo(dir);
  const base = fixturePlugin(dir);
  git('add', '-A');
  git('commit', '-qm', 'add the plugin');
  const r = assertPasses(dir);
  assert.match(r.stdout, /note: no plugin\.json at the base commit for plugins\/fixture-plugin — version bump check skipped/);
  assert.ok(base);
});

// Rules 7 and 7a, the SkillSpector baselines under a plugin's skills.

test('a plugin skill baseline that suppresses a rule the root does not fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  writeFileSync(join(base, 'skills', 'fixture-plugin', baselineName), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "NOT-AT-ROOT"\n    reason: "x"\n');
  assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/\.skillspector-baseline\.yaml:\d+: NOT-AT-ROOT is suppressed here and not at the repository root/);
});

test('a plugin skill baseline that agrees with the root passes, and one with another reason fails', () => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const mine = join(base, 'skills', 'fixture-plugin', baselineName);
  copyFileSync(join(dir, 'skills', 'eagle-eye', baselineName), mine);
  // Control: the copy of a real skill baseline agrees with the root's, so the
  // failure below comes from the changed reason and from nothing else.
  assertPasses(dir);
  const text = readFileSync(mine, 'utf8');
  writeFileSync(mine, text.replace(/(reason: ")/, '$1A different reason. '));
  assertFails(dir, /plugins\/fixture-plugin\/skills\/fixture-plugin\/\.skillspector-baseline\.yaml:\d+: \S+ gives a different reason here than/);
});

test('two paths under a plugin skill that differ only in case fail', t => {
  const dir = tree();
  const base = fixturePlugin(dir);
  const refs = join(base, 'skills', 'fixture-plugin', 'References');
  mkdirSync(refs);
  writeFileSync(join(refs, 'A.txt'), 'a twin\n');
  writeFileSync(join(refs, 'a.txt'), 'another twin\n');
  if (readdirSync(refs).length < 2) {
    t.diagnostic('case folds: the twin cannot be written, caseTwinPaths is asserted in tests/case.test.mjs');
    return;
  }
  assertFails(dir, /differ only in case/);
});
