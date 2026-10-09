// The shared fixture for the tests of head-chef's relay scripts. Nothing here
// is a test.
//
// Each test drives a script's core in-process, with a scratch folder holding
// a synthetic transcript and a state folder, and with fake `gh` and `claude`
// runners passed in as values. The fakes answer from the fixture and record
// every call and every posted body. No real program can be reached: the
// cores start none themselves.
//
// The records are synthetic, built from the field list the Desktop probe
// measured on 2026-10-08 (#222). The ids come from the short fixed list below
// and nowhere else; a test scans every fixture for any other.

import { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.mjs';

export const SCRIPTS = join(root, 'skills', 'head-chef', 'scripts');
export const { runSession } = await import(pathToFileURL(join(SCRIPTS, 'lib', 'session-core.mjs')).href);
export const programs = await import(pathToFileURL(join(SCRIPTS, 'lib', 'programs.mjs')).href);
export const { runLead, pick } = await import(pathToFileURL(join(SCRIPTS, 'lib', 'lead-core.mjs')).href);
export const core = await import(pathToFileURL(join(SCRIPTS, 'lib', 'relay-core.mjs')).href);

// The only ids a fixture may hold.
export const IDS = {
  lead: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  other: '33333333-3333-4333-8333-333333333333',
  chip: '44444444-4444-4444-8444-444444444444',
  stale: '55555555-5555-4555-8555-555555555555',
};
export const FIXTURE_IDS = new Set(Object.values(IDS));

export const RECORD = 'https://github.com/owner/repo/issues/7';
export const SCRIPT_DIR = 'C:/plugins/grimoire~g3/skills/head-chef/scripts';
export const LEAD_NAME = 'lead-chef';
export const SESSION_NAME = 'build-7';

let base;
before(() => { base = fs.mkdtempSync(join(tmpdir(), 'relay-test-')); });
after(() => { fs.rmSync(base, { recursive: true, force: true }); });

let uuidCounter = 0;
const uuid = () => `rec-${++uuidCounter}`;

// Records.

const common = (entrypoint) => ({ cwd: 'X', sessionId: 'S', timestamp: '2026-10-08T00:00:00Z', version: '2.1.295', entrypoint, userType: 'external', isSidechain: false });

export function metaRecords() {
  return [
    { type: 'last-prompt', sessionId: 'S' },
    { type: 'custom-title', customTitle: 't', sessionId: 'S' },
    { type: 'agent-name', agentName: 'n', sessionId: 'S' },
    { type: 'mode', mode: 'normal', sessionId: 'S' },
    { type: 'attachment', attachment: { type: 'hook_success' }, uuid: uuid(), ...common('cli') },
    { type: 'system', subtype: 'bridge_status', content: 'x', isMeta: false, uuid: uuid(), ...common('cli') },
  ];
}

export function typed(text, { source = 'typed', entrypoint = 'cli', isMeta } = {}) {
  const r = {
    type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' },
    promptSource: source, turnOrigin: 'human', uuid: uuid(), parentUuid: 'p', ...common(entrypoint),
  };
  if (isMeta !== undefined) r.isMeta = isMeta;
  return r;
}

export function peer(name, body, { form = 'user', drop } = {}) {
  const origin = { kind: 'peer', name, from: 'inbox-address', fromMode: 'prompting', msg_id: 'm', body };
  if (drop) delete origin[drop];
  const envelope = `<cross-session-message from="inbox-address" from-name="${name}">\n${body}\n</cross-session-message>`;
  if (form === 'attachment') {
    return { type: 'attachment', attachment: { type: 'queued_command', prompt: envelope }, origin, uuid: uuid(), ...common('cli') };
  }
  return {
    type: 'user', message: { role: 'user', content: envelope }, isMeta: true, origin,
    promptSource: 'system', turnOrigin: 'peer', uuid: uuid(), parentUuid: 'p', ...common('cli'),
  };
}

export const assistant = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, uuid: uuid(), ...common('cli') });
export const toolResult = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] }, uuid: uuid(), ...common('cli') });
export const compaction = () => ({ type: 'system', subtype: 'compact_boundary', content: 'c', isMeta: false, compactMetadata: { trigger: 'manual' }, uuid: uuid(), ...common('cli') });

export function startPrompt({ leadId = IDS.lead, record = RECORD, localOnly = [], dir = SCRIPT_DIR } = {}) {
  return `Build session for repo issue 7. Read the issue and its comments; your brief is there. Report to "${LEAD_NAME}" (session ${leadId}) by name at milestones only. ${core.ruleSentence(dir, record, localOnly)}`;
}

// A world: a scratch config folder, temporary folders, a transcript per
// session id, the session rows, and a fake record.

export class World {
  constructor() {
    this.dir = fs.mkdtempSync(join(base, 'w-'));
    this.config = join(this.dir, 'config');
    this.tmp = join(this.dir, 'tmp');
    this.job = join(this.dir, 'job');
    fs.mkdirSync(join(this.config, 'projects', 'proj'), { recursive: true });
    fs.mkdirSync(this.tmp);
    fs.mkdirSync(join(this.job, 'tmp'), { recursive: true });
    this.rows = [
      { name: LEAD_NAME, sessionId: IDS.lead, id: null },
      { name: SESSION_NAME, sessionId: IDS.session, id: 'abcd1234' },
    ];
    this.login = 'owner';
    this.issue = { user: { login: 'owner' }, body: 'Brief.', created_at: 't0', private: false };
    this.comments = [];
    this.calls = [];
    this.posts = [];
    this.postStates = [];
    this.failPost = 0; // fail the next n posts
    this.failRead = false;
    this.nextComment = 1001;
    this.counter = 0;
    // Real time, moving on at every read, so a held lock times out quickly
    // and a lock file's real age compares with it.
    this.now = Date.now();
  }

  transcript(sid) {
    return join(this.config, 'projects', 'proj', `${sid}.jsonl`);
  }

  write(sid, records) {
    fs.writeFileSync(this.transcript(sid), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  append(sid, ...records) {
    fs.appendFileSync(this.transcript(sid), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  questionFile(text, name = 'q.txt') {
    const f = join(this.job, 'tmp', name);
    fs.writeFileSync(f, text);
    return f;
  }

  gh(args, sid) {
    this.calls.push(['gh', ...args]);
    if (args[0] === 'api' && args[1] === 'user') return this.failRead ? { ok: false, stdout: '' } : { ok: true, stdout: `${this.login}\n` };
    if (args[0] === 'issue' && args[1] === 'comment') {
      const body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      if (this.failPost > 0) { this.failPost--; return { ok: false, stdout: '' }; }
      const id = this.nextComment++;
      const url = `${RECORD}#issuecomment-${id}`;
      this.posts.push(body);
      // The caller's state on disk at the moment of the post, so a test can
      // check that state was written first.
      try { this.postStates.push(JSON.parse(fs.readFileSync(join(this.config, 'plugins', 'data', 'grimoire-relay', `${sid}.json`), 'utf8'))); } catch { this.postStates.push(null); }
      this.comments.push({ id, user: { login: this.login }, body, created_at: 't1', updated_at: 't1', html_url: url });
      return { ok: true, stdout: `${url}\n` };
    }
    if (args[0] === 'api' && /^repos\/owner\/repo$/.test(args[1])) {
      return this.failRead ? { ok: false, stdout: '' } : { ok: true, stdout: JSON.stringify({ private: this.issue.private, visibility: this.issue.visibility ?? (this.issue.private ? 'private' : 'public') }) };
    }
    if (args[0] === 'api' && /^repos\/owner\/repo\/issues\/7$/.test(args[1])) {
      return this.failRead ? { ok: false, stdout: '' } : { ok: true, stdout: JSON.stringify(this.issue) };
    }
    const page = /^repos\/owner\/repo\/issues\/7\/comments\?per_page=(\d+)&page=(\d+)$/.exec(args[1] || '');
    if (args[0] === 'api' && page) {
      if (this.failRead) return { ok: false, stdout: '' };
      const size = Number(page[1]);
      const n = Number(page[2]);
      return { ok: true, stdout: JSON.stringify(this.comments.slice((n - 1) * size, n * size)) };
    }
    return { ok: false, stdout: '' };
  }

  claude(args) {
    this.calls.push(['claude', ...args]);
    if (args.join(' ') === 'agents --json') return { ok: true, stdout: JSON.stringify(this.rows) };
    return { ok: false, stdout: '' };
  }

  ctx(sid, extra = {}) {
    return {
      fs,
      env: {
        sessionId: sid, configDir: this.config, jobDir: this.job, tmpDir: this.tmp,
        platform: process.platform, nodeMajor: 24, now: () => (this.now += 100), ...extra,
      },
      scriptDir: SCRIPT_DIR,
      random: (n) => {
        const b = Buffer.alloc(n);
        for (let i = 0; i < n; i++) b[i] = (0xa0 + this.counter++) & 0xff;
        return b;
      },
      gh: (a) => this.gh(a, sid),
      claude: (a) => this.claude(a),
    };
  }

  // Every call through these two also runs the leak check on what it printed
  // and on every post so far.
  session(...argv) {
    const r = runSession(argv, this.ctx(IDS.session));
    assertClean(this, r);
    return r;
  }

  lead(...argv) {
    const r = runLead(argv, this.ctx(IDS.lead));
    assertClean(this, r);
    return r;
  }

  stateFiles() {
    try { return fs.readdirSync(join(this.config, 'plugins', 'data', 'grimoire-relay')); } catch { return []; }
  }

  state(sid) {
    return JSON.parse(fs.readFileSync(join(this.config, 'plugins', 'data', 'grimoire-relay', `${sid}.json`), 'utf8'));
  }
}

// The message block a result printed, as the text a model would send.
export function messageOf(result) {
  const i = result.lines.indexOf('-----BEGIN MESSAGE-----');
  const j = result.lines.indexOf('-----END MESSAGE-----');
  if (i < 0 || j < 0) return null;
  return result.lines.slice(i + 1, j).join('\n');
}

export const sendTo = (result) => {
  const l = result.lines.find(x => x.startsWith('Send to: '));
  return l ? l.slice(10, -1) : null;
};

export const last = (result) => result.lines[result.lines.length - 1];

export function show(result) {
  return `exit ${result.code}\n${result.lines.join('\n')}`;
}

export function expectResult(result, code, line) {
  assert.equal(result.code, code, show(result));
  assert.equal(last(result), line, show(result));
  assert.equal(result.lines.filter(l => l.startsWith('RESULT:')).length, 1, show(result));
}

// No code, session id or local path on a record or outside a message block.
const LEAKS = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /(?<![0-9a-f])[0-9a-f]{8}(?![0-9a-f])/i, /[A-Za-z]:[\\/]/, /[\\/](Users|home)[\\/]/];
const stripLinks = (s) => s.replace(/https:\/\/github\.com\/\S+/g, 'LINK');

export function assertClean(world, result) {
  for (const body of world.posts) {
    for (const re of LEAKS) assert.ok(!re.test(stripLinks(body)), `a post leaks ${re}:\n${body}`);
  }
  if (!result) return;
  let inBlock = false;
  for (const line of result.lines) {
    if (line === '-----BEGIN MESSAGE-----' || line === '-----BEGIN RULE-----') inBlock = true;
    if (!inBlock) for (const re of LEAKS) assert.ok(!re.test(stripLinks(line)), `an output line leaks ${re}: ${line}`);
    if (line === '-----END MESSAGE-----' || line === '-----END RULE-----') inBlock = false;
  }
}

export { fs, join };
