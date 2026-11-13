// Tests of the Incantation plugin's text (docs/spec/incantation.md, claims 1
// and 15). What a model does with the text is the eval cases' job; this file
// holds the lines that must be there, and the ones that must not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PLUGIN = join(ROOT, 'plugins', 'incantation');
const SKILL = join(PLUGIN, 'skills', 'incantation');
const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');

const filesUnder = dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath ?? e.path, e.name));

// The skill's prose files: SKILL.md and every markdown file under references/.
const prose = () => [['SKILL.md', text], ...filesUnder(join(SKILL, 'references')).filter(f => f.endsWith('.md')).map(f => [f.slice(SKILL.length + 1), readFileSync(f, 'utf8')])];

// Claim 1: what no shipped file may name.
const BANNED = /voice-?mode|\bconverse\b|\bWSL\b|\bparec\b|\bpactl\b|\bproxy\.mjs\b|\blaunch\.mjs\b/i;
export const claim1 = (name, body) => (BANNED.test(body) ? [`${name} names ${BANNED.exec(body)[0]}`] : []);

test('claim 1: no file under plugins/incantation/, nor its marketplace entry, names VoiceMode, converse, WSL, parec, pactl or the old proxy', () => {
  for (const f of filesUnder(PLUGIN)) assert.deepEqual(claim1(f.slice(PLUGIN.length + 1), readFileSync(f, 'utf8')), []);
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find(p => p.name === 'incantation');
  assert.ok(entry, 'the marketplace lists incantation');
  assert.deepEqual(claim1('marketplace entry', JSON.stringify(entry)), []);
  const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const holder of [entry, manifest]) for (const key of ['dependencies', 'requires', 'peerDependencies']) assert.equal(holder[key], undefined, key);
});

test('claim 1: the check fails on each name it forbids', () => {
  for (const bad of ['VoiceMode', 'voicemode', 'the converse tool', 'on WSL 2', 'parec', 'pactl', 'proxy.mjs', 'launch.mjs']) assert.equal(claim1('x', bad).length, 1, bad);
  assert.equal(claim1('x', 'reads no proxy setting').length, 0);
});

// Claim 15: every command the skill runs, and what it may hold.
const ALLOWED = [/^guard\.mjs$/, /^listen\.mjs (start|wait|stop)$/, /^observe\.mjs add <8 hex>$/, /^observe\.mjs freeze <n>$/];
export function claim15(name, body) {
  const out = [];
  for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)([^`\n]*)/g)) {
    const [, script, rest] = m;
    const before = body.slice(0, m.index);
    if (!before.endsWith('<skill base>/') || /[^\s`'"(]$/.test(before.slice(0, -'<skill base>/'.length))) out.push(`${name} runs ${script} by a path not under the skill base`);
    if (script === 'setup.mjs') out.push(`${name} runs setup.mjs`);
    const command = `${script}${rest.replace(/[`.,].*$/, '')}`.trim();
    if (script !== 'setup.mjs' && !ALLOWED.some(r => r.test(command))) out.push(`${name} builds a command the skill may not run: ${command}`);
  }
  for (const m of body.matchAll(/settings\.json/g)) if (!/Never read `~\/\.incantation\/settings\.json`/.test(body.slice(Math.max(0, m.index - 40), m.index + 20))) out.push(`${name} reads the settings file`);
  if (/\b(kokoro|whisper|qwen|chatterbox|luxtts)\b/i.test(body)) out.push(`${name} names a speech engine`);
  return out;
}

test('claim 15: the skill runs only its own commands, under the skill base, with no heard text, spoken line, profile or device name, never setup, never the settings file', () => {
  for (const [name, body] of prose()) assert.deepEqual(claim15(name, body), [], name);
});

test('claim 15: the check fails on each thing it forbids', () => {
  assert.equal(claim15('x', 'node scripts/guard.mjs').length, 1);
  assert.equal(claim15('x', 'node ./scripts/listen.mjs wait').length, 1);
  assert.equal(claim15('x', 'run `node <skill base>/scripts/setup.mjs devices`').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/observe.mjs add "the build is green"`').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs say hello`').length, 1);
  assert.equal(claim15('x', 'cat ~/.incantation/settings.json').length, 1);
  assert.equal(claim15('x', 'use the kokoro engine').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs wait`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/observe.mjs add <8 hex>`').length, 0);
});

test('every script and reference the skill names exists', () => {
  for (const [name, body] of prose()) {
    for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) assert.equal(existsSync(join(SKILL, 'scripts', m[1])), true, `${name}: scripts/${m[1]}`);
    for (const m of body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)) assert.equal(existsSync(join(SKILL, 'references', m[1])), true, `${name}: references/${m[1]}`);
  }
});

test('the speak tool is the one exact name, passed text and profile only, at most once a turn', () => {
  assert.match(text, /named exactly `mcp__voicebox__voicebox_speak`/);
  assert.match(text, /No other name counts/);
  assert.match(text, /passing `text` and `profile`/);
  assert.match(text, /at most one speak call per turn/);
  assert.match(text, /Never listen\s+through Voicebox/);
});

test('the guard runs before the listener, the first wait before the greeting, and the signs are printed', () => {
  const start = text.slice(text.indexOf('## Start'), text.indexOf('## Speaking'));
  const at = word => start.indexOf(word);
  assert.ok(at('**Lead session.**') > 0 && at('**Speak tool.**') > at('**Lead session.**') && at('**Setup check.**') > at('**Speak tool.**') && at('**Listener.**') > at('**Setup check.**') && at('**First wait.**') > at('**Listener.**') && at('**Greeting.**') > at('**First wait.**'));
  assert.match(start.slice(at('**First wait.**')), /Print `Listening, always on\.`/);
  assert.match(start.slice(at('**Greeting.**')), /Print `Warming the voice…`/);
  assert.match(start.slice(at('**Greeting.**')), /print `Stopped listening\.`/);
  assert.match(text.slice(text.indexOf('## Stop')), /whenever the listener's background command ends,\s+print `Stopped listening\.`/);
  assert.match(start, /when unsure, treat it as a lead/);
});

test('the next wait is the first act after each delivery, and the say-back comes before any other tool call', () => {
  assert.match(text, /Your first act after that is to start\s+the next `listen\.mjs wait`/);
  assert.match(text, /your next tool call is the\s+say-back/);
  assert.match(text, /Make no other tool call before the say-back except the next\s+`listen\.mjs wait`/);
  assert.match(text, /Never end a say-back with\s+the word "yes"/);
  assert.match(text, /any change to `~\/\.incantation\/` other than an\s+observe inbox file/);
});

test('the tuning file is marked a starting point and holds none of the fixed rules or listener settings', () => {
  const tuning = readFileSync(join(SKILL, 'references', 'tuning.md'), 'utf8');
  assert.match(tuning, /starting point/i);
  for (const fixed of ['"stop"', "that's all", 'merge, push', '(after reply)', '300 ms', 'a minute', '30 minutes']) assert.equal(tuning.includes(fixed), false, `tuning.md holds ${fixed}`);
  assert.match(text, /The hear-back, the typed-yes list, the stop words, and\s+the never-speak list are never subject to the settings/);
});

test('the skill is under 500 lines and its frontmatter holds only the keys the check allows', () => {
  assert.ok(text.split('\n').length < 500);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
  const keys = [...front.matchAll(/^([A-Za-z-]+):/gm)].map(m => m[1]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.ok(/description: (.+)/.exec(front)[1].length <= 1024);
});
