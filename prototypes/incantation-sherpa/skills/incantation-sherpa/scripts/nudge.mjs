// A spoken nudge for the person (grimoire 643, item 1). The mod's permission hook runs this
// when Claude Code is about to wait on a permission prompt. It speaks one fixed line through
// the listener, the way the session's own `say` does: a say file in the observe folder, then
// `listen.mjs say <8 hex>`. It never answers the prompt. With no live listener it does nothing.
//
//   node nudge.mjs   speaks "I need your OK on screen", at most once every 20 seconds

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeDir, runDir, secureState, statusPath } from './lib.mjs';

const LINE = 'I need your OK on screen.';
const FRESH_MS = 10_000; // the status file is touched every 2 s while a listener runs
const EVERY_MS = 20_000;

const home = homedir();
try {
  if (Date.now() - statSync(statusPath(home)).mtimeMs > FRESH_MS) process.exit(0);
  // A nudge within the last few seconds is enough: a marker's mtime says when.
  const marker = join(runDir(home), 'nudge.stamp');
  try {
    if (Date.now() - statSync(marker).mtimeMs < EVERY_MS) process.exit(0);
  } catch {
    // no marker yet
  }
  secureState(home);
  writeFileSync(marker, '');
  const hex = randomBytes(4).toString('hex');
  writeFileSync(join(observeDir(home), `say-${hex}.txt`), LINE);
  execFile(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'listen.mjs'), 'say', hex], { windowsHide: true, timeout: 100_000 }, () => process.exit(0));
} catch {
  process.exit(0);
}
