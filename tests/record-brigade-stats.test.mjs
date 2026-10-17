// Tests of scripts/record-brigade-stats.mjs: a fixture that cannot be created
// fails the run and still removes the run's scratch folder (issue 282).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(fileURLToPath(import.meta.url), '..', '..', 'scripts', 'record-brigade-stats.mjs');

test('a failed fixture exits non-zero and leaves no scratch folder', { skip: process.platform !== 'win32' && 'the recorder runs on Windows only' }, () => {
  const temp = mkdtempSync(join(tmpdir(), 'record-stats-test-'));
  try {
    const run = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, TEMP: temp, TMP: temp, BRIGADE_STATS_BREAK_FIXTURE: 'junction' },
    });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stderr, /could not create the junction fixture/);
    assert.deepEqual(readdirSync(temp), []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
