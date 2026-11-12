// The fake recorder for the live listener's tests. The listener runs it with
// `process.execPath` in place of ffmpeg, only under NODE_ENV=test (the spec's
// test seam, docs/spec/live.md S6). It takes ffmpeg's arguments.
//
//   -list_devices   prints a fixed dshow device list to stderr, or the list
//                   in GRIMOIRE_LIVE_FAKE_DEVICES (a JSON array of
//                   [name, alternative name]).
//   capture         writes its pid to the file GRIMOIRE_LIVE_FAKE_PID and its
//                   arguments to GRIMOIRE_LIVE_FAKE_ARGS (when set), then
//                   streams s16le PCM at 16 kHz in real time from the
//                   scenario in GRIMOIRE_LIVE_FAKE_SCENARIO: a JSON array of
//                   { kind: 'tone' | 'noise' | 'quiet', ms } segments, and
//                   { kind: 'exit', code } to fail. After the last segment it
//                   streams quiet until its stdout closes.
//
// It ends when its stdout closes, as ffmpeg does, so a killed listener
// leaves no recorder behind.

import { writeFileSync } from 'node:fs';

const RATE = 16000;
const args = process.argv.slice(2);

if (args.includes('-list_devices')) {
  const devices = process.env.GRIMOIRE_LIVE_FAKE_DEVICES
    ? JSON.parse(process.env.GRIMOIRE_LIVE_FAKE_DEVICES)
    : [['Fake Microphone', '@device_cm_{FAKE-1}\\wave_{FAKE-1}'], ['Second Microphone', '@device_cm_{FAKE-2}\\wave_{FAKE-2}']];
  const lines = ['[dshow @ 0000000000000001] "Fake Camera" (video)', '[dshow @ 0000000000000001]   Alternative name "@device_pnp_fake_camera"'];
  for (const [name, alt] of devices) {
    lines.push(`[dshow @ 0000000000000001] "${name}" (audio)`);
    lines.push(`[dshow @ 0000000000000001]   Alternative name "${alt}"`);
  }
  lines.push('dummy: Immediate exit requested');
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(1);
}

if (process.env.GRIMOIRE_LIVE_FAKE_PID) writeFileSync(process.env.GRIMOIRE_LIVE_FAKE_PID, String(process.pid));
if (process.env.GRIMOIRE_LIVE_FAKE_ARGS) writeFileSync(process.env.GRIMOIRE_LIVE_FAKE_ARGS, JSON.stringify(args));

const scenario = JSON.parse(process.env.GRIMOIRE_LIVE_FAKE_SCENARIO || '[]');
let seed = 12345;
let sample = 0; // the sample number inside the current segment

/** `n` samples of one segment kind. */
function make(kind, n) {
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (kind === 'tone') v = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (sample + i)) / RATE));
    else if (kind === 'noise') {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      v = (seed % 201) - 100;
    }
    buf.writeInt16LE(v, i * 2);
  }
  sample += n;
  return buf;
}

process.stdout.on('error', () => process.exit(0));
process.stdout.on('close', () => process.exit(0));

const TICK_MS = 50;
const started = Date.now();
let sent = 0; // samples written so far
let index = 0;

setInterval(() => {
  const due = Math.floor(((Date.now() - started) * RATE) / 1000);
  while (sent < due) {
    const seg = scenario[index];
    if (seg && seg.kind === 'exit') process.exit(seg.code ?? 1);
    const left = seg ? Math.round((seg.ms * RATE) / 1000) - sample : Infinity;
    if (left <= 0) {
      index++;
      sample = 0;
      continue;
    }
    const n = Math.min(due - sent, left, RATE);
    process.stdout.write(make(seg ? seg.kind : 'quiet', n));
    sent += n;
  }
}, TICK_MS);
