// Tests of the Incantation skill's text (docs/spec/incantation.md, claims 13 and
// the written parts of 23). What a model does with the text is the eval cases'
// job; this file holds the lines that must be there, and the ones that must not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('../plugins/incantation/skills/incantation/', import.meta.url));
const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');

// The skill's prose files: SKILL.md and every markdown file under references/.
const prose = () => [
  ['SKILL.md', text],
  ...readdirSync(join(SKILL, 'references'), { recursive: true }).filter(f => f.endsWith('.md')).map(f => [`references/${f}`, readFileSync(join(SKILL, 'references', f), 'utf8')]),
];

// What is wrong with one file's text under claim 13; empty when nothing is.
export function claim13(name, body) {
  const out = [];
  if (/voicemode\s+serve/i.test(body)) out.push(`${name} names the VoiceMode server mode`);
  if (/\b8765\b/.test(body)) out.push(`${name} names the server mode's port`);
  if (/https?:\/\/[^\s)`'"]*\/mcp\b/i.test(body)) out.push(`${name} names an http MCP URL`);
  for (const m of body.matchAll(/guard\.mjs/g)) {
    if (!body.slice(0, m.index).endsWith('<skill base>/scripts/')) out.push(`${name} runs guard.mjs by a path that is not under the skill base directory`);
  }
  return out;
}

test('claim 13: the skill\'s files never name the server mode, its port or an http MCP URL, and run the guard only under the skill base', () => {
  for (const [name, body] of prose()) assert.deepEqual(claim13(name, body), [], name);
});

test('claim 13: the check fails on each thing it forbids', () => {
  assert.equal(claim13('x', 'run voicemode serve now').length, 1);
  assert.equal(claim13('x', 'port 8765').length, 1);
  assert.equal(claim13('x', 'use http://127.0.0.1:9/mcp here').length, 1);
  assert.equal(claim13('x', 'node scripts/guard.mjs').length, 1);
  assert.equal(claim13('x', 'node ./guard.mjs and node /home/x/guard.mjs').length, 2);
  assert.equal(claim13('x', 'node <skill base>/scripts/guard.mjs "$CLAUDE_PROJECT_DIR"').length, 0);
  assert.equal(claim13('x', 'the port 87650 is not it').length, 0);
});

test('every script and reference the skill names exists', () => {
  for (const [name, body] of prose()) {
    for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) assert.equal(existsSync(join(SKILL, 'scripts', m[1])), true, `${name}: scripts/${m[1]}`);
    for (const m of body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)) assert.equal(existsSync(join(SKILL, 'references', m[1])), true, `${name}: references/${m[1]}`);
  }
});

test('claim 23: converse is called only with wait_for_response false', () => {
  assert.match(text, /only with `wait_for_response: false`/);
  assert.doesNotMatch(text, /wait_for_response:\s*true/);
  assert.match(text, /Never listen through it/);
});

test('claim 23: the first wait starts before the greeting, and the listening notice comes with the listener', () => {
  const start = text.slice(text.indexOf('## Start'), text.indexOf('## Speaking'));
  const at = word => start.indexOf(word);
  assert.ok(at('**Listener.**') > 0 && at('**First wait.**') > at('**Listener.**') && at('**Greeting.**') > at('**First wait.**'), 'listener, then first wait, then greeting');
  const listener = start.slice(at('**Listener.**'), at('**First wait.**'));
  assert.match(listener, /Print `Listening, always on\.`/);
  assert.match(start.slice(at('**Greeting.**')), /print `Stopped listening\.`/);
  assert.match(text.slice(text.indexOf('## Stop')), /print `Stopped listening\.`/);
});

test('claim 23: the next wait is the first act after each delivery, and the say-back comes before any other tool call', () => {
  assert.match(text, /Your first act after that is to start\s+the next `listen\.mjs wait`/);
  assert.match(text, /your next tool call is the\s+say-back/);
  assert.match(text, /Make no other tool call before the say-back except the next\s+`listen\.mjs wait`/);
  assert.match(text, /Never end a say-back with\s+the word "yes"/);
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
