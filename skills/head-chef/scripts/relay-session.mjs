#!/usr/bin/env node
// What a session runs to ask the owner by relay, to take a relayed answer, to
// post its fixed record lines, and to clean up:
//
//   node relay-session.mjs ask --record <issue link> --file <question file>
//   node relay-session.mjs take --record <issue link>
//   node relay-session.mjs post --record <issue link> --kind report|milestone-miss|question-miss [--link <link>]
//   node relay-session.mjs end
//
// This file builds the real inputs and the two runners, and does nothing
// else; the rules live in lib/session-core.mjs. The last line printed always
// starts RESULT:. Exit 0 ok, 1 refused, 2 usage, 3 ask in your own chat.

import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { runSession } from './lib/session-core.mjs';
import { runner } from './lib/programs.mjs';
import { endAsk, askOwn } from './lib/relay-core.mjs';

const config = process.env.CLAUDE_CONFIG_DIR;
const ctx = {
  fs,
  env: {
    sessionId: process.env.CLAUDE_CODE_SESSION_ID || '',
    configDir: config && isAbsolute(config) ? config : join(homedir(), '.claude'),
    jobDir: process.env.CLAUDE_JOB_DIR || '',
    tmpDir: tmpdir(),
    platform: process.platform,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    now: () => Date.now(),
  },
  random: n => randomBytes(n),
  gh: runner('gh', () => endAsk('no-program')),
  claude: runner('claude', () => endAsk('no-program')),
};

let result;
try {
  result = runSession(process.argv.slice(2), ctx);
} catch {
  result = askOwn('read-failed');
}
process.stdout.write(`${result.lines.join('\n')}\n`);
process.exitCode = result.code;
