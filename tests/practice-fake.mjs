// A stand-in for Claude Code, for tests/practice.test.mjs. The runner starts it
// through GRIMOIRE_PRACTICE_PROGRAM, so no real session starts and nothing
// reaches the network.
//
// It records what it was given and answers with stream-json lines in the shape
// of the real `claude -p --output-format stream-json --verbose` (2.1.286):
// a system/init event, an optional Skill call, the reply, and a result event
// carrying permission_denials as { tool_name, tool_use_id, tool_input }.
//
// The test drives it through two files in the home folder the runner passes
// on, because the runner builds the session's environment itself and a test
// cannot reach the fake any other way:
//
// - `fake-plan.json` holds `{ turns: [...] }`, one entry per message the fake
//   receives. The last entry repeats once they run out.
// - `fake-log/` gets one JSON file per call: the arguments, standard input as
//   base64, the environment and the working folder.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const home = homedir();
const log = join(home, 'fake-log');
mkdirSync(log, { recursive: true });
const argv = process.argv.slice(2);
const calls = readdirSync(log).length;
const record = { argv, cwd: process.cwd(), env: { ...process.env } };

if (argv.includes('--version')) {
  writeFileSync(join(log, `call-${String(calls).padStart(3, '0')}.json`), JSON.stringify({ kind: 'version', ...record }));
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}

const stdin = readFileSync(0);
const prompts = readdirSync(log).filter(f => JSON.parse(readFileSync(join(log, f), 'utf8')).kind === 'prompt').length;
writeFileSync(join(log, `call-${String(calls).padStart(3, '0')}.json`),
  JSON.stringify({ kind: 'prompt', ...record, stdin: stdin.toString('base64') }));

const planFile = join(home, 'fake-plan.json');
const turns = existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')).turns || [] : [];
const t = turns[Math.min(prompts, turns.length - 1)] || {};

for (const [rel, content] of Object.entries(t.write || {})) {
  const path = join(process.cwd(), rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
// A file in the temp folder the runner gave the session.
for (const [rel, content] of Object.entries(t.writeTemp || {})) {
  writeFileSync(join(process.env.TEMP || process.env.TMPDIR, rel), content);
}

const resume = argv.indexOf('--resume');
const sid = t.sessionId ?? (resume >= 0 ? argv[resume + 1] : '0f1e2d3c-4b5a-4968-8776-655443322110');
const mode = argv[argv.indexOf('--permission-mode') + 1];
const out = e => process.stdout.write(`${JSON.stringify(e)}\n`);

if (!t.silent) {
  out({
    type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sid,
    tools: t.tools ?? ['Bash', 'Edit', 'Glob', 'Grep', 'PowerShell', 'Read', 'Skill', 'Write'],
    mcp_servers: t.mcp ?? [],
    model: 'claude-haiku-4-5-20251001', permissionMode: t.permissionMode ?? mode,
    apiKeySource: t.apiKeySource ?? 'none', claude_code_version: '9.9.9',
    agents: t.agents ?? ['claude', 'Explore', 'general-purpose', 'Plan'],
    skills: t.skills ?? ['probe-skill', 'dataviz', 'run'],
    plugins: (t.plugins ?? ['cc-plugin-agents-md', 'cc-plugin-telemetry']).map(name => ({ name, path: 'builtin', source: `${name}@builtin` })),
    per_turn_effort_active: false,
  });
  for (let i = 0; i < (t.hooks || 0); i++) out({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart', session_id: sid });
  if (t.skill) {
    out({
      type: 'assistant', session_id: sid, parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_fake_skill', name: 'Skill', input: { skill: t.skill } }] },
    });
  }
  const reply = t.reply ?? 'OK.';
  out({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: reply }] } });
  out({
    type: 'result', subtype: 'success', is_error: false, session_id: sid, result: reply,
    permission_denials: t.denials ?? [],
  });
}
process.exit(t.exit ?? 0);
