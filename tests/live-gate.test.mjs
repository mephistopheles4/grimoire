// The live skill's gate, tested as the pure module it is: PCM in, turn events
// out. The signal is built here, in memory, so nothing waits for real time.
// Claims C1 to C3 of the live spec (docs/spec/live.md, S9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.mjs';

const { createGate } = await import(pathToFileURL(join(root, 'skills', 'live', 'scripts', 'gate.mjs')).href);

const RATE = 16000;

/** s16le PCM, `ms` long: a 440 Hz tone, low noise, or silence. */
function segment(kind, ms) {
  const n = Math.round((RATE * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (kind === 'tone') v = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    else if (kind === 'noise') {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      v = (seed % 201) - 100;
    }
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

/** Feed the segments in 100 ms chunks, and collect every event. */
function run(segments) {
  const gate = createGate();
  const events = [];
  const pcm = Buffer.concat(segments.map(([kind, ms]) => segment(kind, ms)));
  const chunk = (RATE * 100 / 1000) * 2;
  for (let at = 0; at < pcm.length; at += chunk) {
    events.push(...gate.push(pcm.subarray(at, at + chunk)));
  }
  return events;
}

const seconds = event => event.pcm.length / 2 / RATE;

test('C1: a 0.6 s tone after 0.5 s of noise, then 1.6 s of quiet, gives one end of about 0.6 s', () => {
  const events = run([['noise', 500], ['tone', 600], ['quiet', 1600]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'end');
  assert.ok(Math.abs(seconds(events[0]) - 0.6) < 0.1, `got ${seconds(events[0])} s`);

  // A pause shorter than 1.6 s does not end the turn: one end, holding both tones and the pause.
  const paused = run([['noise', 500], ['tone', 300], ['quiet', 1000], ['tone', 300], ['quiet', 1700]]);
  assert.deepEqual(paused.map(e => e.type), ['end']);
  assert.ok(Math.abs(seconds(paused[0]) - 1.6) < 0.1, `got ${seconds(paused[0])} s`);
});

test('C2: a 0.2 s burst gives discard, and a later 0.6 s tone gives end', () => {
  const events = run([
    ['noise', 500], ['tone', 200], ['quiet', 2000],
    ['tone', 600], ['quiet', 2000],
  ]);
  assert.deepEqual(events.map(e => e.type), ['discard', 'end']);
  assert.ok(Math.abs(seconds(events[1]) - 0.6) < 0.1);
});

test('C3: unbroken speech is cut at 30 s', () => {
  const events = run([['noise', 500], ['tone', 33000]]);
  assert.equal(events[0].type, 'end');
  assert.ok(Math.abs(seconds(events[0]) - 30) < 0.1, `got ${seconds(events[0])} s`);
});
