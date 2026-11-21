// Tests of the sherpa prototype's mic choice at start (grimoire 646, trial
// only). The saved mic is found by its id, then by its name, wherever it now
// sits in the list; a settings file from before that falls back on its old
// stamp and index. When the saved mic is gone, the listener uses another one,
// never a loopback that records what plays, and says which.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDevice, stampOf } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/capture/ffmpeg.mjs';
import { SETTINGS_KEYS } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/lib.mjs';
import { waitLines } from '../prototypes/incantation-sherpa/skills/incantation-sherpa/scripts/listen.mjs';

const HEADSET = { name: 'Headset (WF-1000XM6 Hands-Free)', id: '@device_cm_{33D9A762}\\wave_{11111111}' };
const BRIO = { name: 'Speakerphone (MX Brio)', id: '@device_cm_{33D9A762}\\wave_{22222222}' };
const MIX = { name: 'Stereo Mix (Realtek USB Audio)', id: '@device_cm_{33D9A762}\\wave_{33333333}' };

test('the saved mic is found by its id when the list has changed around it', () => {
  const now = [BRIO, HEADSET];
  const r = pickDevice(now, { index: 0, stamp: stampOf([HEADSET]), id: HEADSET.id, name: HEADSET.name });
  assert.deepEqual(r, { device: HEADSET, how: 'saved' });
});

test('the saved mic is found by its name when its id changed', () => {
  const moved = { ...HEADSET, id: 'other' };
  const r = pickDevice([BRIO, moved], { index: 0, stamp: 'x'.repeat(16), id: HEADSET.id, name: HEADSET.name });
  assert.deepEqual(r, { device: moved, how: 'saved' });
});

test('settings from before keep working on their stamp and index', () => {
  const list = [BRIO, HEADSET];
  const r = pickDevice(list, { index: 1, stamp: stampOf(list) });
  assert.deepEqual(r, { device: HEADSET, how: 'saved' });
});

test('a missing mic falls back to another one, and says so', () => {
  const r = pickDevice([BRIO], { index: 0, stamp: stampOf([HEADSET]), id: HEADSET.id, name: HEADSET.name });
  assert.deepEqual(r, { device: BRIO, how: 'fallback' });
});

test('old settings whose list changed fall back too', () => {
  const r = pickDevice([BRIO, HEADSET], { index: 0, stamp: stampOf([HEADSET]) });
  assert.equal(r.how, 'fallback');
});

test('a fallback never picks a loopback that records what plays', () => {
  const r = pickDevice([MIX, BRIO], { index: 0, stamp: 'x'.repeat(16), id: 'gone', name: 'gone' });
  assert.deepEqual(r, { device: BRIO, how: 'fallback' });
});

test('with only a loopback left there is no mic', () => {
  assert.deepEqual(pickDevice([MIX], { index: 0, stamp: 'x'.repeat(16), id: 'gone', name: 'gone' }), { device: null, how: null });
  assert.deepEqual(pickDevice([], { index: 0, stamp: 'x'.repeat(16) }), { device: null, how: null });
});

test('the settings take a mic id and name, and still take the old shape', () => {
  assert.equal(SETTINGS_KEYS.device({ index: 0, stamp: '0123456789abcdef' }), true);
  assert.equal(SETTINGS_KEYS.device({ index: 0, stamp: '0123456789abcdef', id: HEADSET.id, name: HEADSET.name }), true);
  assert.equal(SETTINGS_KEYS.device({ index: 0, stamp: '0123456789abcdef', id: 'a\nb', name: 'x' }), false);
  assert.equal(SETTINGS_KEYS.device({ index: 0, stamp: '0123456789abcdef', id: 'x'.repeat(600), name: 'x' }), false);
  assert.equal(SETTINGS_KEYS.device({ index: 0, stamp: '0123456789abcdef', extra: 1 }), false);
});

test('a wait passes the fallback mic line through, and nothing like it', () => {
  assert.equal(waitLines('mic-fallback "Speakerphone (MX Brio)"\n'), 'mic-fallback "Speakerphone (MX Brio)"\n');
  assert.equal(waitLines('mic-fallback "a"b"\n'), '');
  assert.equal(waitLines(`mic-fallback "${'x'.repeat(65)}"\n`), '');
});
