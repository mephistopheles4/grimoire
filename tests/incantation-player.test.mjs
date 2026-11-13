// Tests of scripts/player.mjs (docs/spec/incantation.md, T18): the player the
// listener owns. Everything runs on a fake spawn and made-up paths; nothing here
// opens an audio device or plays a sound. The same tests run on every platform.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { findPlayer, makePlayer } from '../plugins/incantation/skills/incantation/scripts/player.mjs';

const WIN_REC = 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe';
const NIX_REC = '/opt/ffmpeg/bin/ffmpeg';
const only = (...paths) => p => paths.includes(p);

test('ffplay beside the pinned recorder is the player, reading the WAV on stdin, with no window', () => {
  const win = findPlayer({ platform: 'win32', recorder: WIN_REC, exists: only('C:\\tools\\ffmpeg\\bin\\ffplay.exe') });
  assert.equal(win.file, 'C:\\tools\\ffmpeg\\bin\\ffplay.exe');
  assert.deepEqual(win.args, ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', 'pipe:0']);
  assert.equal(win.via, 'stdin');
  const nix = findPlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/opt/ffmpeg/bin/ffplay', '/usr/bin/paplay') });
  assert.equal(nix.file, '/opt/ffmpeg/bin/ffplay', 'ffplay first, a system player only when it is missing');
  assert.equal(nix.via, 'stdin');
});

test('ffplay is found beside the recorder and nowhere else: a PATH entry never stands in for it', () => {
  const seen = [];
  findPlayer({ platform: 'linux', recorder: NIX_REC, exists: p => (seen.push(p), false) });
  assert.ok(seen.includes('/opt/ffmpeg/bin/ffplay'));
  assert.ok(seen.every(p => p.startsWith('/opt/ffmpeg/') || p.startsWith('/usr/bin/')), `looked only beside the recorder and in /usr/bin: ${seen.join(', ')}`);
});

test('without ffplay each platform falls back to its own system player, on a file', () => {
  const mac = findPlayer({ platform: 'darwin', recorder: NIX_REC, exists: only('/usr/bin/afplay') });
  assert.equal(mac.file, '/usr/bin/afplay');
  assert.equal(mac.via, 'file');
  const pulse = findPlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/usr/bin/paplay', '/usr/bin/aplay') });
  assert.equal(pulse.file, '/usr/bin/paplay');
  const alsa = findPlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/usr/bin/aplay') });
  assert.equal(alsa.file, '/usr/bin/aplay');
  assert.ok(alsa.args.includes('-q'));
  const win = findPlayer({ platform: 'win32', recorder: WIN_REC, exists: p => /WindowsPowerShell\\v1\.0\\powershell\.exe$/i.test(p), env: { SystemRoot: 'C:\\Windows' } });
  assert.match(win.file, /^C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(win.via, 'file');
  assert.ok(win.args.includes('-NoProfile') && win.args.includes('-NonInteractive'));
  assert.ok(win.args.every(a => !/[A-Za-z]:\\|\.wav/.test(a)), 'the file name is passed in the environment, never inside the command text');
  assert.equal(win.fileEnv, 'INCANTATION_WAV');
});

test('no player at all is null, so the listener can say so instead of failing mid-reply', () => {
  assert.equal(findPlayer({ platform: 'linux', recorder: NIX_REC, exists: () => false }), null);
  assert.equal(findPlayer({ platform: 'win32', recorder: WIN_REC, exists: () => false, env: {} }), null);
  assert.equal(findPlayer({ platform: 'linux', recorder: '', exists: () => true })?.file, '/usr/bin/paplay', 'a missing recorder path only drops the ffplay row');
});

function fakeSpawn() {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.received = [];
    child.stdin.on('data', d => child.received.push(d));
    child.killed = 0;
    child.kill = () => {
      child.killed++;
      setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    };
    calls.push({ file, args, options, child });
    return child;
  };
  return { spawn, calls };
}

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40, 1)]);

test('a play spawns the player with no shell, the WAV on its stdin, and none of the reply text anywhere in the command', async () => {
  const s = fakeSpawn();
  const player = makePlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/opt/ffmpeg/bin/ffplay'), spawn: s.spawn });
  const h = player.play(WAV);
  assert.equal(s.calls.length, 1);
  const { file, args, options, child } = s.calls[0];
  assert.equal(file, '/opt/ffmpeg/bin/ffplay');
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(args, ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', 'pipe:0']);
  assert.deepEqual(Buffer.concat(child.received), WAV);
  child.emit('exit', 0, null);
  assert.equal(await h.done, 'ended');
});

test('stop kills the player and says it was killed; a second stop does nothing more', async () => {
  const s = fakeSpawn();
  const player = makePlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/opt/ffmpeg/bin/ffplay'), spawn: s.spawn });
  const h = player.play(WAV);
  h.stop();
  h.stop();
  assert.equal(await h.done, 'killed');
  assert.equal(s.calls[0].child.killed, 1);
});

test('a player that cannot start, or that exits with a failure, says failed', async () => {
  const s = fakeSpawn();
  const player = makePlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/opt/ffmpeg/bin/ffplay'), spawn: s.spawn });
  const a = player.play(WAV);
  s.calls[0].child.emit('error', new Error('ENOENT'));
  assert.equal(await a.done, 'failed');
  const b = player.play(WAV);
  s.calls[1].child.emit('exit', 1, null);
  assert.equal(await b.done, 'failed');
});

test('a player whose stdin breaks mid-write says failed and never throws', async () => {
  const s = fakeSpawn();
  const player = makePlayer({ platform: 'linux', recorder: NIX_REC, exists: only('/opt/ffmpeg/bin/ffplay'), spawn: s.spawn });
  const h = player.play(WAV);
  s.calls[0].child.stdin.emit('error', new Error('EPIPE'));
  s.calls[0].child.emit('exit', 1, null);
  assert.equal(await h.done, 'failed');
});

test('a file player gets a private temp file that is gone once it ends, is killed or fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'incantation-play-'));
  try {
    const s = fakeSpawn();
    const player = makePlayer({ platform: 'darwin', recorder: NIX_REC, exists: only('/usr/bin/afplay'), spawn: s.spawn, tempDir: dir });
    const h = player.play(WAV);
    const path = s.calls[0].args.at(-1);
    assert.ok(path.startsWith(dir), 'in the private run folder');
    assert.match(path, /play-[0-9a-f]{8,}\.wav$/);
    assert.deepEqual(readFileSync(path), WAV);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    s.calls[0].child.emit('exit', 0, null);
    assert.equal(await h.done, 'ended');
    assert.equal(existsSync(path), false);

    const k = player.play(WAV);
    const kpath = s.calls[1].args.at(-1);
    k.stop();
    assert.equal(await k.done, 'killed');
    assert.equal(existsSync(kpath), false, 'removed after a kill');

    const f = player.play(WAV);
    const fpath = s.calls[2].args.at(-1);
    s.calls[2].child.emit('error', new Error('x'));
    assert.equal(await f.done, 'failed');
    assert.equal(existsSync(fpath), false, 'removed after a failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('on Windows the file name goes to the player in the environment, not in the command text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'incantation-play-'));
  try {
    const s = fakeSpawn();
    const player = makePlayer({ platform: 'win32', recorder: WIN_REC, exists: p => /powershell\.exe$/i.test(p), spawn: s.spawn, tempDir: dir, env: { SystemRoot: 'C:\\Windows' } });
    player.play(WAV);
    const { args, options } = s.calls[0];
    assert.ok(options.env.INCANTATION_WAV.startsWith(dir));
    assert.ok(args.every(a => !a.includes(dir)));
    assert.equal(options.shell, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no player the maker says so and a play never spawns', () => {
  const s = fakeSpawn();
  const player = makePlayer({ platform: 'linux', recorder: NIX_REC, exists: () => false, spawn: s.spawn });
  assert.equal(player.available, false);
  assert.equal(player.play(WAV), null);
  assert.equal(s.calls.length, 0);
});
