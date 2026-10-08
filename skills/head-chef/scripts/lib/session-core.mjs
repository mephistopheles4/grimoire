// The core of relay-session.mjs: what a session runs to ask the owner by
// relay, to take a relayed answer, to post its fixed record lines, and to
// clean up. It takes its inputs and its two runners as values, and starts
// no program itself.

import {
  parseArgs, Usage, usage, ok, refused, askOwn, End, endAsk, endRefused, preflight,
  findTranscript, readTranscript, findStartPrompt, listRows, leadCheck, parseRecord,
  readConfinedFile, removeQuietly, screen, hitsFloor, hitsLocalOnly, hitsIdentifiers,
  withState, deleteOwnState, post, fence, utcTime, sha256, parseBlock, messageLines,
  asMessage, isCompaction, ownerLogin, recordEntries, recordLocalOnly, nameForLine,
  NAME, CODE, LETTERS,
} from './relay-core.mjs';

const SPEC = {
  ask: ['--record', '--file'],
  take: ['--record'],
  post: ['--record', '--kind', '--link?'],
  end: [],
};

const RELAY_HEAD = "Owner's answer, relayed by the head chef: choice ";
const FORBIDDEN = ['Choices:', 'Recommended:', 'Detail:', 'Code:', 'Check:'];

const fresh = () => ({ open: {}, handled: [], forced: {}, unmatchedPosted: false });

export function runSession(argv, ctx) {
  let parsed;
  try {
    parsed = parseArgs(argv, SPEC);
  } catch (e) {
    if (e instanceof Usage) return usage();
    throw e;
  }
  try {
    preflight(ctx);
    if (parsed.sub === 'end') {
      deleteOwnState(ctx);
      return ok(['Relay state deleted.']);
    }
    return COMMANDS[parsed.sub](parsed.opts, ctx);
  } catch (e) {
    if (e instanceof End) return e.result;
    throw e;
  }
}

// The transcript, the start prompt read from its head, and the session list
// on first use.
function start(ctx) {
  const path = findTranscript(ctx);
  if (!path) endAsk('no-transcript');
  const head = readTranscript(ctx, path, 'head');
  let rows = null;
  const rowsFn = () => (rows ??= listRows(ctx));
  const sp = findStartPrompt(ctx, head.records, rowsFn);
  if (!sp) endAsk('no-start-prompt');
  return { path, sp, rowsFn };
}

// The lead's current name when the rows with its id share one, for a miss
// line; nameForLine falls back to "the head chef".
function looseLeadName(rows, leadId) {
  const names = new Set(rows.filter(r => r.sessionId === leadId).map(r => r.name));
  return names.size === 1 ? [...names][0] : null;
}

// A question file: the question on one line, two to six choices labelled A)
// on, and an optional Recommended line. Returns null when it does not parse.
export function parseQuestionFile(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const question = (lines.shift() || '').trim();
  if (!question || /^[A-F]\) /.test(question)) return null;
  const choices = {};
  let recommended = 'none';
  let i = 0;
  for (const line of lines) {
    const rec = /^Recommended: ([A-F]|none)$/.exec(line.trim());
    if (rec && line === lines[lines.length - 1]) { recommended = rec[1]; continue; }
    const m = /^([A-F])\) (.+)$/.exec(line.trim());
    if (!m || m[1] !== LETTERS[i]) return null;
    choices[m[1]] = m[2].trim();
    i++;
  }
  if (i < 2 || i > 6) return null;
  if (recommended !== 'none' && !Object.hasOwn(choices, recommended)) return null;
  const words = [question, ...Object.values(choices)];
  if (words.some(w => FORBIDDEN.some(f => w.includes(f)))) return null;
  if (Object.values(choices).some(w => w.includes(';') || w.endsWith('.'))) return null;
  return { question, choices, recommended };
}

const choicesText = choices => Object.entries(choices).map(([l, w]) => `${l}) ${w}`).join('; ');

function questionLine(name, q) {
  return `Question for the owner, from "${name}": ${q.question} Choices: ${choicesText(q.choices)}. Recommended: ${q.recommended}.`;
}

function ask(opts, ctx) {
  const { fs, env } = ctx;
  const { path, sp, rowsFn } = start(ctx);
  if (opts['--record'] !== sp.record) return refused('record');
  const file = opts['--file'];
  const text = readConfinedFile(ctx, file);
  if (text === null) return refused('file');
  const q = parseQuestionFile(text);
  if (!q) return refused('file');
  try {
    for (const t of [q.question, ...Object.values(q.choices)]) {
      const hit = screen(t, sp.localOnly);
      if (hit) return askOwn(hit);
    }
    const rec = parseRecord(sp.record);
    return withState(ctx, 'session', fresh, (state, save) => {
      const qkey = sha256(q.question);
      if ((state.forced[qkey] || 0) >= 2) return askOwn('closed-twice');
      const rows = rowsFn();
      const own = new Set(rows.filter(r => r.sessionId === env.sessionId).map(r => r.name));
      const [me] = own;
      if (own.size !== 1 || !NAME.test(me) || rows.some(r => r.sessionId !== env.sessionId && r.name === me)) {
        return askOwn('no-name');
      }
      const lead = leadCheck(rows, sp.leadId);
      if (!lead) {
        const miss = `Question not delivered to ${nameForLine(looseLeadName(rows, sp.leadId))} at ${utcTime(env.now())}; see the question above.`;
        post(ctx, rec, `${questionLine(me, q)}\n\n${miss}`);
        return askOwn('lead-not-found');
      }
      const code = ctx.random(4).toString('hex');
      state.open[code] = {
        question: q.question, choices: q.choices, recommended: q.recommended, record: sp.record,
        askOffset: fs.statSync(path).size, failures: 0, failedPosted: false, qkey, entry: null,
      };
      save(state);
      const entry = post(ctx, rec, questionLine(me, q));
      if (!entry) {
        delete state.open[code];
        save(state);
        return askOwn('post-failed');
      }
      state.open[code].entry = entry;
      save(state);
      return ok(messageLines(lead, `${questionLine(me, q)} Detail: ${entry}.`, code));
    });
  } finally {
    removeQuietly(fs, file);
  }
}

// The relayed-answer form: the letter, the choice's words as shown, and the
// owner's words quoted.
export function parseRelay(text) {
  if (text.includes('\n') || !text.startsWith(RELAY_HEAD)) return null;
  const m = /^Owner's answer, relayed by the head chef: choice ([A-F])\) (.*?)\. The owner's words, quoted: "(.*)"$/.exec(text);
  return m ? { letter: m[1], words: m[2], owner: m[3] } : null;
}

const relayShaped = body => {
  const b = parseBlock(body);
  return b.code !== null || b.text.startsWith(RELAY_HEAD);
};

const failedLine = n => `A relayed answer failed check ${n}; nothing was taken.`;

function take(opts, ctx) {
  const { path, sp, rowsFn } = start(ctx);
  if (opts['--record'] !== sp.record) return refused('record');
  const rec = parseRecord(sp.record);
  return withState(ctx, 'session', fresh, (state, save) => {
    const lines = [];
    const tail = readTranscript(ctx, path, 'tail');

    // A compaction closes every question asked before it.
    const compacted = tail.records.filter(r => isCompaction(r.rec)).map(r => r.off);
    const last = compacted.length ? Math.max(...compacted) : -1;
    let closed = 0;
    for (const code of Object.keys(state.open)) {
      if (state.open[code].askOffset < last) { delete state.open[code]; closed++; }
    }
    if (closed) {
      save(state);
      lines.push('A compaction closed the open questions for relay. Ask again with a fresh code.');
    }

    const handled = new Set(state.handled);
    const messages = [];
    for (const r of tail.records) {
      const m = asMessage(r.rec);
      if (m && m.id && !handled.has(m.id) && relayShaped(m.body)) messages.push(m);
    }
    if (!messages.length) return ok([...lines, 'No relayed answer to handle.']);

    const rows = rowsFn();
    const leadName = leadCheck(rows, sp.leadId);
    let owner = null;
    const ownerLines = () => {
      if (owner) return owner;
      const login = ownerLogin(ctx);
      const entries = login && recordEntries(ctx, rec);
      if (!entries) endAsk('read-failed', lines);
      owner = recordLocalOnly(entries, login);
      return owner;
    };

    for (const m of messages) {
      const blk = parseBlock(m.body);
      const codeValid = blk.code !== null && CODE.test(blk.code);
      const q = codeValid && Object.hasOwn(state.open, blk.code) ? state.open[blk.code] : null;
      if (q && q.record !== opts['--record']) endRefused('record', lines);

      // The four checks, in order. The first that fails decides.
      let failed = 0;
      let screened = false;
      const relay = parseRelay(blk.text);
      if (!leadCheck(rows, sp.leadId, m.name)) failed = 1;
      else if (!q) failed = 2;
      else if (!blk.intact || !relay || !Object.hasOwn(q.choices, relay.letter) || q.choices[relay.letter] !== relay.words) failed = 3;
      else {
        const words = q.choices[relay.letter];
        if (hitsFloor(words) || hitsLocalOnly(words, sp.localOnly) || hitsLocalOnly(words, ownerLines())) failed = 4;
        else if (hitsIdentifiers(relay.owner)) { failed = 4; screened = true; }
      }

      if (!failed) {
        const applied = [...sp.localOnly, ...ownerLines()];
        delete state.open[blk.code];
        state.handled.push(m.id);
        save(state);
        const f = fence(relay.owner);
        const posted = post(ctx, rec, `Owner's answer to ${q.entry}, relayed by the head chef: choice ${relay.letter}.\n\n${f}text\n${relay.owner}\n${f}\n`);
        if (!posted) {
          const reply = leadName ? messageLines(leadName, 'A relayed answer could not be recorded; nothing was taken.', blk.code) : [];
          endAsk('post-failed', [...lines, 'Verdict: not taken; the taken line could not be posted.', ...reply]);
        }
        lines.push(
          'Verdict: taken.',
          `Act on choice ${relay.letter}: ${q.choices[relay.letter]}`,
          `Question: ${q.question}`,
          `Choices: ${choicesText(q.choices)}`,
          `Local-only list applied: ${applied.length ? applied.join(', ') : 'none'}`,
          ...(leadName ? messageLines(leadName, `Took choice ${relay.letter} for the question above.`, blk.code) : ['No single lead row: send no reply, and tell the owner in your own chat.']),
        );
        continue;
      }

      state.handled.push(m.id);
      let line = null;
      let reply = null;
      const verdict = [`Verdict: not taken; check ${failed} failed.`];
      if (q) {
        q.failures++;
        const closing = failed >= 3;
        if (!q.failedPosted) {
          line = failedLine(failed);
          q.failedPosted = true;
          reply = leadName ? messageLines(leadName, failedLine(failed), blk.code) : null;
        } else if (closing && q.failures > 1) {
          line = `Question closed after ${q.failures} failed relayed answers.`;
        }
        if (closing) {
          delete state.open[blk.code];
          state.forced[q.qkey] = (state.forced[q.qkey] || 0) + 1;
          verdict.push(state.forced[q.qkey] >= 2
            ? 'The question is closed again: ask it in your own chat, not by relay.'
            : 'The question is closed: ask it again once, with a fresh code.');
        }
      } else if (!state.unmatchedPosted) {
        state.unmatchedPosted = true;
        line = failedLine(failed);
        reply = leadName ? messageLines(leadName, failedLine(failed), codeValid ? blk.code : undefined) : null;
      }
      save(state);
      if (line && !post(ctx, rec, line)) endAsk('post-failed', [...lines, ...verdict]);
      lines.push(...verdict, ...(reply || []));
      if (screened) endAsk('screened', lines);
    }
    return ok(lines);
  });
}

function postLine(opts, ctx) {
  const { env } = ctx;
  const { sp, rowsFn } = start(ctx);
  if (opts['--record'] !== sp.record) return refused('record');
  const kind = opts['--kind'];
  const link = opts['--link'];
  if ((kind === 'report') !== (link !== undefined)) return usage();
  if (link && !link.startsWith(`${sp.record}#`) && link !== sp.record) return refused('record');
  let line;
  if (kind === 'report') {
    line = `Milestone report sent to the head chef; entry ${link}.`;
  } else {
    const n = nameForLine(looseLeadName(rowsFn(), sp.leadId));
    const what = kind === 'milestone-miss' ? 'Milestone report' : 'Question';
    line = `${what} not delivered to ${n} at ${utcTime(env.now())}; see the comment above.`;
  }
  return withState(ctx, 'session', fresh, (state, save) => {
    if (kind === 'report' && state.unmatchedPosted) {
      state.unmatchedPosted = false;
      save(state);
    }
    return post(ctx, parseRecord(sp.record), line) ? ok([`Posted the ${kind} line.`]) : askOwn('post-failed');
  });
}

const COMMANDS = { ask, take, post: postLine };
