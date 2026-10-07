#!/usr/bin/env node
// Records what Claude Code's own `$.fs.stat` answers about real links, for the
// Brigade mod's path rule and its tests.
//
//   node scripts/record-brigade-stats.mjs           compare with the recording
//   node scripts/record-brigade-stats.mjs --write   write a new recording
//
// The mod's set_roster tool decides from `stat` answers alone whether it may
// write the roster file, and `claude plugin test` gives a plugin no file
// system: its tests answer `stat` themselves. Those answers are only as good
// as their likeness to the engine's. So this script builds each kind of link
// for real in a fresh temporary folder, asks the installed engine to `stat`
// each one through a throwaway probe plugin in a headless session, and keeps
// the shapes in brigade/recorded-stats.ts, which the plugin tests and the
// repository's own suite both read.
//
// A fixture it cannot create fails the run: a link kind nobody recorded is a
// link kind no test models. On Windows a symbolic link needs Developer Mode
// or an elevated shell; a junction and a hard link need neither.
//
// It runs the local `claude` with no settings sources, so the owner's own
// settings, hooks and plugins stay out of the session whose answers become
// the tests' fixtures. It makes no model call while the probe loads: the probe
// answers a slash command itself, and if it did not load, the run fails on the
// missing record (the command then reached the model as a prompt, on Haiku).
// It is a local gate, not part of the one command, because CI has no Claude
// Code and installing it there would put a fetched dependency on the
// publishing path.
//
// Windows only. The recording holds what the engine answered on Windows, and
// the tests are built on it; macOS and Linux are not measured (threat model,
// row 15). On another platform the script says so and fails, rather than
// comparing against answers from another system or overwriting them.

import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(root, 'brigade', 'recorded-stats.ts');
const write = process.argv.includes('--write');

if (process.platform !== 'win32') {
  console.error(
    `This gate records Windows only, and this is ${process.platform}. brigade/recorded-stats.ts holds what Claude Code answered on Windows, and the tests are built on it; there is no ${process.platform} recording to compare with, and writing one would replace the Windows one. macOS and Linux are not measured: see the threat model, row 15.`,
  );
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'brigade-stats-'));
const fx = join(scratch, 'fx');
const probe = join(scratch, 'probe');

// Each fixture: its name, how it is made, and where a resolving stat should
// land if it lands anywhere (its own path, or the link's target).
const made = [];
function fixture(name, lands, make) {
  try {
    make(join(fx, name));
    made.push({ name, lands });
  } catch (err) {
    console.error(`could not create the ${name} fixture: ${err.message}`);
    console.error('A fixture that cannot be created fails the recording. On Windows, turn on Developer Mode for symbolic links.');
    process.exitCode = 1;
  }
}

let output;
try {
  mkdirSync(join(fx, 'target-dir'), { recursive: true });
  writeFileSync(join(fx, 'target-file.txt'), 'hello');

  fixture('folder', 'self', p => mkdirSync(p));
  fixture('file', 'self', p => writeFileSync(p, 'hello'));
  fixture('junction', 'target', p => symlinkSync(join(fx, 'target-dir'), p, 'junction'));
  fixture('broken-junction', 'none', p => {
    mkdirSync(join(fx, 'gone-dir'));
    symlinkSync(join(fx, 'gone-dir'), p, 'junction');
    rmSync(join(fx, 'gone-dir'), { recursive: true });
  });
  fixture('dir-symlink', 'target', p => symlinkSync(join(fx, 'target-dir'), p, 'dir'));
  fixture('file-symlink', 'target', p => symlinkSync(join(fx, 'target-file.txt'), p, 'file'));
  fixture('broken-file-symlink', 'none', p => {
    writeFileSync(join(fx, 'gone-file.txt'), 'x');
    symlinkSync(join(fx, 'gone-file.txt'), p, 'file');
    rmSync(join(fx, 'gone-file.txt'));
  });
  fixture('hard-link', 'self', p => linkSync(join(fx, 'target-file.txt'), p));
  if (process.exitCode) process.exit();

  // Paths that are not there, three ways: plainly, under a junction, and
  // under a file.
  const missing = [
    { name: 'missing', path: join(fx, 'missing') },
    { name: 'under-junction', path: join(fx, 'junction', 'missing') },
    { name: 'under-file', path: join(fx, 'file', 'missing') },
  ];

  mkdirSync(join(probe, '.claude-plugin'), { recursive: true });
  mkdirSync(join(probe, 'hooks'), { recursive: true });
  writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'stat-recorder', version: '0.1.0', description: 'Records stat answers.' }));
  writeFileSync(join(probe, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.ts'] }));
  writeFileSync(
    join(probe, 'hooks', 'register.ts'),
    `export const register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'record-stats', description: 'Records stat answers.' })
    return next(e)
  })
  on('command.run', { command: 'record-stats' }, async ($, e) => {
    const out = []
    for (const path of String(e.args).split('|')) {
      try {
        out.push({ path, found: await $.fs.stat(path, { resolve: true }) })
      } catch (err) {
        out.push({ path, rejected: String(err && err.message) })
      }
    }
    return { text: '<<<' + JSON.stringify(out) + '>>>' }
  })
}
`,
  );

  const all = [...made.map(m => ({ ...m, path: join(fx, m.name) })), ...missing];
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const version = execFileSync('claude', ['--version'], { encoding: 'utf8', env }).trim().split(/\s/)[0];
  const raw = execFileSync('claude', ['-p', '--setting-sources', '', '--model', 'haiku', '--plugin-dir', probe, `/record-stats ${all.map(a => a.path).join('|')}`], {
    encoding: 'utf8',
    env,
    timeout: 120000,
  });
  const m = /<<<(.*)>>>/s.exec(raw);
  if (m === null) throw new Error(`the probe answered no record:\n${raw}`);
  const answers = JSON.parse(m[1]);

  const stats = {};
  for (const f of made) {
    const a = answers.find(x => x.path === join(fx, f.name));
    if (a?.found === undefined) throw new Error(`${f.name}: stat rejected (${a?.rejected}), and it exists`);
    const real = a.found.realPath;
    const target = f.name.includes('file') ? join(fx, 'target-file.txt') : join(fx, 'target-dir');
    const lands = real === undefined ? 'none' : real.toLowerCase() === a.path.toLowerCase() ? 'self' : real.toLowerCase() === target.toLowerCase() ? 'target' : `elsewhere`;
    if (lands !== f.lands) throw new Error(`${f.name}: realPath lands ${lands}, expected ${f.lands}`);
    stats[f.name] = { kind: a.found.kind, isLink: a.found.isLink, realPath: lands };
  }
  const rejections = {};
  for (const x of missing) {
    const a = answers.find(y => y.path === x.path);
    if (a?.rejected === undefined) throw new Error(`${x.name}: stat answered, and nothing is there`);
    rejections[x.name] = a.rejected.split(x.path).join('<path>').replace(/^stat-recorder:/, '<plugin>:');
  }
  const recording = { engine: version, platform: process.platform, stats, rejections };
  output = `// Written by scripts/record-brigade-stats.mjs: what Claude Code's own
// \`$.fs.stat(path, { resolve: true })\` answered about each kind of real link,
// built for real in a temporary folder. \`realPath\` says where the answer's
// real path landed: the path itself, the link's target, or nowhere (absent).
// A rejection is its message, with the path and the plugin's name taken out.
// Do not edit by hand; run the script with --write.

export const RECORDED = ${JSON.stringify(recording, null, 2).replace(/"([A-Za-z]+)":/g, '$1:')} as const
`;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (write) {
  writeFileSync(OUT, output);
  console.log(`wrote ${OUT}`);
} else {
  let kept = '';
  try {
    kept = readFileSync(OUT, 'utf8');
  } catch {}
  if (kept.replace(/\r\n/g, '\n') !== output) {
    console.error(`brigade/recorded-stats.ts differs from what the engine answers now. Recorded now:\n${output}`);
    console.error('Run the script with --write, then rerun `claude plugin test .`.');
    process.exit(1);
  }
  console.log('ok    brigade/recorded-stats.ts matches what the engine answers');
}
