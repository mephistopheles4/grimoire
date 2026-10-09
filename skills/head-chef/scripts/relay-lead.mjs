#!/usr/bin/env node
// What the head chef runs to relay the owner's answers:
//
//   node relay-lead.mjs rule --record <issue link> [--file <local-only file>]
//   node relay-lead.mjs note --bg-id <id> --record <issue link>
//   node relay-lead.mjs note --session-id <id> --record <issue link>
//   node relay-lead.mjs note --snapshot
//   node relay-lead.mjs note --chip-name <name> --record <issue link>
//   node relay-lead.mjs show
//   node relay-lead.mjs relay --code <code>
//   node relay-lead.mjs check
//   node relay-lead.mjs end
//
// This file builds the real inputs and the two runners, and does nothing
// else; the rules live in lib/lead-core.mjs. The last line printed always
// starts RESULT:. Exit 0 ok, 1 refused, 2 usage, 3 ask in your own chat.

import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLead } from './lib/lead-core.mjs';
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
  scriptDir: dirname(fileURLToPath(import.meta.url)),
  random: n => randomBytes(n),
  gh: runner('gh', () => endAsk('no-program')),
  claude: runner('claude', () => endAsk('no-program')),
};

let result;
try {
  result = runLead(process.argv.slice(2), ctx);
} catch {
  result = askOwn('read-failed');
}
process.stdout.write(`${result.lines.join('\n')}\n`);
process.exitCode = result.code;
