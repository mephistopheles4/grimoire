// The incantation timeline sheet, at the seam a maintainer uses: the script's
// command line. scripts/incantation-sheets.mjs draws docs/brand/incantation-timeline.svg
// from the skill's own timing constants in gate.mjs, turn.mjs and nudge.mjs.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run } from './helpers.mjs';
import { KNOBS } from '../skills/incantation/scripts/gate.mjs';
import { EVERY_MS } from '../skills/incantation/scripts/nudge.mjs';
import { TurnHold } from '../skills/incantation/scripts/turn.mjs';

const sheetsScript = join(root, 'scripts', 'incantation-sheets.mjs');
const committed = join(root, 'docs', 'brand', 'incantation-timeline.svg');
const work = mkdtempSync(join(tmpdir(), 'grimoire-incantation-sheets-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('the script writes one self-contained timeline SVG with no external fetches or scripts', () => {
  const dir = mkdtempSync(join(work, 'draw-'));
  const r = run(sheetsScript, [dir]);
  assert.equal(r.code, 0, r.stderr);
  const out = join(dir, 'incantation-timeline.svg');
  assert.equal(existsSync(out), true, 'writes incantation-timeline.svg');
  const svg = readFileSync(out, 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<script\b/i, 'an image runs no script');
  assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:/, 'an image fetches nothing');
  assert.equal((svg.match(/@font-face/g) || []).length, 6, 'the six faces travel inside it');
});

test('the timeline uses the Aviation zone border, réseau crosses, and text contrast floor (>= 0.7)', () => {
  const svg = readFileSync(committed, 'utf8');
  assert.match(svg, /<pattern id="reseau"[^>]*width="120" height="120"/, 'réseau pattern at 120px pitch');
  assert.match(svg, /fill="url\(#reseau\)"/, 'field uses réseau crosses');
  for (const label of ['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D']) {
    assert.match(svg, new RegExp(`>${label}<`), `zone label ${label}`);
  }
  for (const m of svg.matchAll(/<text[^>]*fill="rgba\(34,38,43,([0-9.]+)\)"/g)) {
    assert.ok(Number(m[1]) >= 0.7, `text alpha ${m[1]} below Aviation floor 0.7`);
  }
});

test('the timeline shows plain-English roles, searchable model names, and live timings from code', () => {
  const dir = mkdtempSync(join(work, 'vals-'));
  const r = run(sheetsScript, [dir]);
  assert.equal(r.code, 0, r.stderr);
  const svg = readFileSync(join(dir, 'incantation-timeline.svg'), 'utf8');
  const turnDefaults = new TurnHold({ judge: null, release: () => {} });
  const preRollS = `${(KNOBS.preRollFrames * KNOBS.frameMs) / 1000} s`;
  for (const needle of [
    preRollS,
    `${KNOBS.frameMs} ms`,
    '1.5 s',
    `+${turnDefaults.holdMs / 1000} s`,
    `${KNOBS.bargeMs} ms`,
    `${KNOBS.progressMs / 1000} s`,
    `${EVERY_MS / 1000} s`,
    `${KNOBS.idleMs / 60_000} min`,
    'Echo canceller',
    'Speech detector',
    'FINISH CHECK',
    'SPEECH TO TEXT',
    'CLAUDE THINKS',
    'SPEAK REPLY',
    'WebRTC AEC3',
    'Silero VAD',
    'Smart Turn',
    'Parakeet',
    'Claude',
    'Phonon',
  ]) {
    assert.equal(svg.includes(needle), true, `missing ${needle}`);
  }
});

test('all rect and text elements stay inside the sheet bounds', () => {
  const svg = readFileSync(committed, 'utf8');
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(vb, 'viewBox present');
  const W = Number(vb[1]);
  const H = Number(vb[2]);
  for (const m of svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)) {
    const [, rx, ry, rw, rh] = m.map(Number);
    assert.ok(rx >= 0 && ry >= 0 && rx + rw <= W && ry + rh <= H, `rect out of bounds: ${m[0]}`);
  }
  for (const m of svg.matchAll(/<text x="([^"]+)" y="([^"]+)"/g)) {
    const [, tx, ty] = m.map(Number);
    assert.ok(tx >= 0 && tx <= W && ty >= 0 && ty <= H, `text out of bounds: ${m[0]}`);
  }
});

test('the committed incantation-timeline.svg matches the generator output', () => {
  const dir = mkdtempSync(join(work, 'sync-'));
  const r = run(sheetsScript, [dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(committed, 'utf8'), readFileSync(join(dir, 'incantation-timeline.svg'), 'utf8'));
});

test('missing output directory exits 2 with usage', () => {
  const r = run(sheetsScript, []);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: node scripts\/incantation-sheets\.mjs <dir>/);
});
