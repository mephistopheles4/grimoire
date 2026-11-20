// The player the listener owns (docs/spec/incantation.md, T18). Node built-ins
// only. The listener asks the speech engine for a WAV and plays it here, so it
// knows when a reply starts and ends and can kill it the moment the person
// talks over it.
//
//   findPlayer(...)  which player this machine has: ffplay beside the pinned
//                    recorder first, then one system player per platform
//   makePlayer(...)  .play(wav) starts one reply and returns { done, stop }
//
// A player is never found by searching PATH: ffplay is looked for in the folder
// the setup pinned the recorder in, and the others at their one system path.
// The command is a program and fixed arguments, started with no shell; the WAV
// goes in on stdin, or in a private file named only in the environment. The
// reply's text never reaches this module: it never sees anything but audio.

import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';

const FFPLAY_ARGS = ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', 'pipe:0'];
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command', '(New-Object System.Media.SoundPlayer $env:INCANTATION_WAV).PlaySync()'];
const KILL_GRACE_MS = 1000;

// The first player this machine has, or null. { file, args, via, fileEnv? }:
// `via` is how the WAV gets in, 'stdin' or 'file' (the path is appended to
// args, or passed in the environment variable `fileEnv`).
export function findPlayer({ platform = process.platform, recorder, exists = existsSync, env = process.env } = {}) {
  const api = platform === 'win32' ? win32 : posix;
  const rows = [];
  if (typeof recorder === 'string' && recorder) {
    rows.push({ file: api.join(api.dirname(recorder), platform === 'win32' ? 'ffplay.exe' : 'ffplay'), args: FFPLAY_ARGS, via: 'stdin' });
  }
  if (platform === 'darwin') rows.push({ file: '/usr/bin/afplay', args: [], via: 'file' });
  if (platform === 'linux') {
    rows.push({ file: '/usr/bin/paplay', args: [], via: 'file' });
    rows.push({ file: '/usr/bin/aplay', args: ['-q'], via: 'file' });
  }
  if (platform === 'win32') {
    rows.push({ file: win32.join(env?.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: POWERSHELL_ARGS, via: 'file', fileEnv: 'INCANTATION_WAV' });
  }
  return rows.find(row => exists(row.file)) ?? null;
}

export function makePlayer({ platform = process.platform, recorder, exists = existsSync, spawn = nodeSpawn, tempDir, env = process.env, writeFile = writeFileSync, rm = rmSync } = {}) {
  const row = findPlayer({ platform, recorder, exists, env });
  return {
    available: row !== null,
    name: row ? row.file : null,
    // Starts one reply. { done, stop } at once; `done` resolves 'ended', 'killed' or 'failed'.
    // null when the machine has no player.
    play(wav) {
      if (!row) return null;
      let path = null;
      let child = null;
      let stopped = false;
      let settled = false;
      let resolveDone;
      const done = new Promise(r => (resolveDone = r));
      const settle = outcome => {
        if (settled) return;
        settled = true;
        if (path) rm(path, { force: true });
        resolveDone(outcome);
      };
      try {
        const args = [...row.args];
        const options = { shell: false, windowsHide: true, stdio: [row.via === 'stdin' ? 'pipe' : 'ignore', 'ignore', 'ignore'] };
        if (row.via === 'file') {
          path = join(tempDir, `play-${randomBytes(6).toString('hex')}.wav`); // this machine's own join: tempDir is a path here
          writeFile(path, wav, { mode: 0o600, flag: 'wx' });
          if (row.fileEnv) options.env = { SystemRoot: env?.SystemRoot || 'C:\\Windows', [row.fileEnv]: path };
          else args.push(path);
        }
        child = spawn(row.file, args, options);
        child.on('error', () => settle('failed'));
        child.on('exit', code => settle(stopped ? 'killed' : code === 0 ? 'ended' : 'failed'));
        if (row.via === 'stdin') {
          child.stdin.on('error', () => settle('failed'));
          child.stdin.end(wav);
        }
      } catch {
        settle('failed');
      }
      return {
        done,
        stop() {
          if (stopped || settled) return;
          stopped = true;
          try {
            child?.kill();
          } catch {
            // Already gone: the exit event settles it.
          }
          setTimeout(() => settle('killed'), KILL_GRACE_MS).unref?.();
        },
      };
    },
  };
}
