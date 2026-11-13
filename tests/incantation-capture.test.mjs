// Tests of capture/ffmpeg.mjs (docs/spec/incantation.md, S5.4; claim 13). Each
// platform's row is picked by a passed-in platform value, so every row runs on
// every runner. Every listing here is made up: invented names and ids, no real
// device, no path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureArgs, listDevices, listingLines, resolveRecorder, rowsFor, stampOf } from '../plugins/incantation/skills/incantation/scripts/capture/ffmpeg.mjs';

// What each row's listing command prints, on the stream it prints it to.
const LISTINGS = {
  win32: {
    stderr: [
      '[dshow @ 0000] DirectShow video devices (some may be both video and audio devices)',
      '[dshow @ 0000]  "Made Up Camera"',
      '[dshow @ 0000] DirectShow audio devices',
      '[dshow @ 0000]  "Desk Mic One"',
      '[dshow @ 0000]     Alternative name "@device_cm_{MADEUP-1}"',
      '[in#0 @ 0000] "Headset Mic Two" (audio)',
      '[in#0 @ 0000]   Alternative name "@device_cm_{MADEUP-2}"',
      '[in#0 @ 0000] "Made Up Camera Two" (video)',
      'dummy: Immediate exit requested',
    ].join('\r\n'),
    want: [
      { name: 'Desk Mic One', id: '@device_cm_{MADEUP-1}' },
      { name: 'Headset Mic Two', id: '@device_cm_{MADEUP-2}' },
    ],
  },
  darwin: {
    stderr: ['[AVFoundation indev @ 0x1] AVFoundation video devices:', '[AVFoundation indev @ 0x1] [0] Made Up Camera', '[AVFoundation indev @ 0x1] AVFoundation audio devices:', '[AVFoundation indev @ 0x1] [0] Desk Mic One', '[AVFoundation indev @ 0x1] [1] Headset Mic Two'].join('\n'),
    want: [
      { name: 'Desk Mic One', id: ':0' },
      { name: 'Headset Mic Two', id: ':1' },
    ],
  },
  linux: {
    stdout: ['Auto-detected sources for pulse:', '* made_up.analog-stereo [Desk Mic One]', '  made_up.analog-stereo.monitor [Monitor of Speakers]', '  made_up.usb-mic [Headset Mic Two]'].join('\n'),
    want: [
      { name: 'Desk Mic One', id: 'made_up.analog-stereo' },
      { name: 'Headset Mic Two', id: 'made_up.usb-mic' },
    ],
  },
};

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: the row's listing parses from the stream ffmpeg prints it to, and capture uses the row's input`, async () => {
    const l = LISTINGS[platform];
    const run = async (file, args) => {
      assert.deepEqual(args, rowsFor(platform)[0].list);
      return `${l.stdout ?? ''}\n${l.stderr ?? ''}`;
    };
    const { row, devices } = await listDevices({ recorder: 'ffmpeg', platform, run });
    assert.equal(row, 0);
    assert.deepEqual(devices, l.want);
    const args = captureArgs(platform, row, devices[0].id);
    assert.deepEqual(args.slice(-7), ['-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']);
    const fmt = { win32: 'dshow', darwin: 'avfoundation', linux: 'pulse' }[platform];
    assert.equal(args[args.indexOf('-f') + 1], fmt);
  });
}

test('linux falls back to alsa when pulse lists nothing', async () => {
  const run = async (file, args) => (args.includes('pulse') ? 'Cannot list sources: not implemented\n' : 'Auto-detected sources for alsa:\n  hw:CARD=Made,DEV=0 [Made Up Card]\n');
  const { row, devices } = await listDevices({ recorder: 'ffmpeg', platform: 'linux', run });
  assert.equal(row, 1);
  assert.deepEqual(devices, [{ name: 'Made Up Card', id: 'hw:CARD=Made,DEV=0' }]);
  assert.equal(captureArgs('linux', 1, devices[0].id).includes('alsa'), true);
});

test('the listing lines show the stamp and cleaned names cut at 64, never an id', () => {
  const devices = [{ name: `Mic\u0007 ${'x'.repeat(80)}`, id: '@device_secret_id' }];
  const lines = listingLines(devices);
  assert.equal(lines[0], `stamp ${stampOf(devices)}`);
  assert.match(lines[0], /^stamp [0-9a-f]{16}$/);
  assert.equal(lines[1], `0 ${`Mic ${'x'.repeat(80)}`.slice(0, 64)}`);
  assert.ok(!lines.join('\n').includes('@device_secret_id'));
  assert.notEqual(stampOf(devices), stampOf([{ name: 'Mic', id: 'other' }]));
});

// A file system for the resolver: `files` maps a path to its real path, and
// `meta` gives a path's owner and mode (POSIX only).
const fsOf = (files, meta = {}) => ({
  isFile: p => Object.hasOwn(files, p),
  realpath: p => files[p] ?? null,
  lstat: p => meta[p] ?? { uid: 0, mode: 0o40755 },
  uid: () => 1000,
});

test('windows: only fully qualified drive folders count, and the real path must still be a drive path', () => {
  const fs = fsOf({ 'D:\\tools\\ffmpeg.exe': 'D:\\tools\\ffmpeg.exe', 'E:\\link\\ffmpeg.exe': '\\\\server\\share\\ffmpeg.exe', 'C:\\proj\\bin\\ffmpeg.exe': 'C:\\proj\\bin\\ffmpeg.exe', 'C:\\ok\\ffmpeg.exe': 'C:\\ok\\ffmpeg.exe' });
  const pathValue = ['.', '', 'bin', 'C:relative', '\\rooted', '\\\\server\\share', 'E:\\link', 'C:\\proj\\bin', '"D:\\tools"'].join(';');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue, startDir: 'C:\\proj', fs }), 'D:\\tools\\ffmpeg.exe');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue: 'C:\\proj\\bin;E:\\link', startDir: 'C:\\proj', fs }), null, 'the start folder and a share are refused');
  assert.equal(resolveRecorder({ platform: 'win32', pathValue: 'C:\\ok', startDir: 'C:\\proj', fs }), 'C:\\ok\\ffmpeg.exe');
});

test('posix: a relative, empty or current-folder entry, or one inside the start folder, is never used', () => {
  const fs = fsOf({ '/proj/bin/ffmpeg': '/proj/bin/ffmpeg', '/usr/bin/ffmpeg': '/usr/bin/ffmpeg' });
  assert.equal(resolveRecorder({ platform: 'linux', pathValue: '.::bin:/proj/bin:/usr/bin', startDir: '/proj', fs }), '/usr/bin/ffmpeg');
  assert.equal(resolveRecorder({ platform: 'darwin', pathValue: '/proj/bin', startDir: '/proj', fs }), null);
});

test('posix: a recorder in a group- or other-writable folder, or owned by another account, is refused', () => {
  const files = { '/opt/x/bin/ffmpeg': '/opt/x/bin/ffmpeg' };
  const ok = { uid: 0, mode: 0o40755 };
  const base = { '/': ok, '/opt': ok, '/opt/x': ok, '/opt/x/bin': ok, '/opt/x/bin/ffmpeg': { uid: 0, mode: 0o100755 } };
  const resolve = meta => resolveRecorder({ platform: 'linux', pathValue: '/opt/x/bin', startDir: '/proj', fs: fsOf(files, { ...base, ...meta }) });
  assert.equal(resolve({}), '/opt/x/bin/ffmpeg');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 1000, mode: 0o100755 } }), '/opt/x/bin/ffmpeg', 'owned by this account');
  assert.equal(resolve({ '/opt/x': { uid: 0, mode: 0o40775 } }), null, 'a group-writable folder above it');
  assert.equal(resolve({ '/opt/x/bin': { uid: 0, mode: 0o40757 } }), null, 'an other-writable folder');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 501, mode: 0o100755 } }), null, 'owned by another account');
  assert.equal(resolve({ '/opt/x/bin/ffmpeg': { uid: 0, mode: 0o100775 } }), null, 'a group-writable file');
});
