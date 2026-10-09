// How the command lines start `gh` and `claude`: no shell, ever. Each program
// is found once per run in the absolute entries of PATH, skipping the working
// folder and every relative entry, and started with an argument list from a
// fixed working folder outside any repository.

import { execFileSync } from 'node:child_process';
import { lstatSync, accessSync, realpathSync, constants } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// A folder's real path, so a short name or a link names the same folder; null
// when it cannot be read.
function real(dir) {
  try { return realpathSync.native(dir); } catch { return null; }
}

// On Windows only an `.exe` counts; a program found only as a `.cmd` or a
// `.bat` would need a shell. Elsewhere, a regular, executable file. The working
// folder is skipped like a relative entry, compared by real path, and so is an
// entry whose real path cannot be read; folders inside it are not skipped, so
// a working folder at the home folder still finds programs installed there.
export function resolveProgram(name, pathEnv, platform, cwd) {
  const entries = (pathEnv || '').split(platform === 'win32' ? ';' : ':');
  const fold = s => (platform === 'win32' ? s.toLowerCase() : s);
  const here = cwd ? real(resolve(cwd)) : null;
  for (const dir of entries) {
    if (!dir || !isAbsolute(dir)) continue;
    const d = real(resolve(dir));
    if (!d || (here && fold(d) === fold(here))) continue;
    const file = join(dir, platform === 'win32' ? `${name}.exe` : name);
    try {
      if (!lstatSync(file).isFile()) continue;
      if (platform !== 'win32') accessSync(file, constants.X_OK);
      const where = real(dirname(file));
      if (!where || (here && fold(where) === fold(here))) continue;
      return file;
    } catch { /* not here */ }
  }
  return null;
}

// The variables `gh` is started with: what it needs to find its own sign-in
// and the system, and nothing that points it at another account, host,
// repository, configuration, proxy or certificate.
const GH_KEEP = new Set([
  'path', 'pathext', 'systemroot', 'windir', 'systemdrive', 'comspec', 'userprofile', 'home', 'homedrive',
  'homepath', 'appdata', 'localappdata', 'programdata', 'programfiles', 'programfiles(x86)', 'temp', 'tmp',
  'tmpdir', 'lang', 'lc_all', 'lc_ctype', 'user', 'username', 'logname',
]);
export function childEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (GH_KEEP.has(k.toLowerCase())) out[k] = v;
  return out;
}

// What the runner starts, from the process's own values: the program's path
// and the environment it gets. `claude` keeps the caller's environment, which
// holds its own configuration; `gh` gets the named list above.
export function programPath(name) {
  return resolveProgram(name, process.env.PATH ?? process.env.Path, process.platform, process.cwd());
}
export function programEnv(name) {
  return name === 'gh' ? childEnv(process.env) : { ...process.env };
}

// A runner for one program, resolved on first use. `onMissing` ends the run.
export function runner(name, onMissing) {
  let path;
  return (args) => {
    if (path === undefined) path = programPath(name);
    if (!path) onMissing();
    try {
      const stdout = execFileSync(path, args, {
        cwd: tmpdir(), encoding: 'utf8', windowsHide: true, timeout: 60000, env: programEnv(name),
        maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], shell: false,
      });
      return { ok: true, stdout };
    } catch {
      return { ok: false, stdout: '' };
    }
  };
}
