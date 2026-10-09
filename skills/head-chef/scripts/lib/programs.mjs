// How the command lines start `gh` and `claude`: no shell, ever. Each program
// is found once per run in the absolute entries of PATH, skipping the working
// folder and every relative entry, and started with an argument list from a
// fixed working folder outside any repository.

import { execFileSync } from 'node:child_process';
import { lstatSync, accessSync, constants } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

// On Windows only an `.exe` counts; a program found only as a `.cmd` or a
// `.bat` would need a shell. Elsewhere, a regular, executable file. An entry
// that is the working folder, or inside it, is skipped like a relative one.
export function resolveProgram(name, pathEnv, platform, cwd) {
  const entries = (pathEnv || '').split(platform === 'win32' ? ';' : ':');
  const fold = s => (platform === 'win32' ? s.toLowerCase() : s);
  const here = cwd ? fold(resolve(cwd)) : null;
  for (const dir of entries) {
    if (!dir || !isAbsolute(dir)) continue;
    const d = fold(resolve(dir));
    if (here && (d === here || d.startsWith(here.endsWith(sep) ? here : here + sep))) continue;
    const file = join(dir, platform === 'win32' ? `${name}.exe` : name);
    try {
      if (!lstatSync(file).isFile()) continue;
      if (platform !== 'win32') accessSync(file, constants.X_OK);
      return file;
    } catch { /* not here */ }
  }
  return null;
}

// The child's environment: the caller's, without the settings that would
// point `gh` at another host or another repository than the record names.
export function childEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (/^(GH_HOST|GH_REPO)$/i.test(k)) delete out[k];
  return out;
}

// A runner for one program, resolved on first use. `onMissing` ends the run.
export function runner(name, onMissing) {
  let path;
  return (args) => {
    if (path === undefined) path = resolveProgram(name, process.env.PATH ?? process.env.Path, process.platform, process.cwd());
    if (!path) onMissing();
    try {
      const stdout = execFileSync(path, args, {
        cwd: tmpdir(), encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv(process.env),
        maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], shell: false,
      });
      return { ok: true, stdout };
    } catch {
      return { ok: false, stdout: '' };
    }
  };
}
