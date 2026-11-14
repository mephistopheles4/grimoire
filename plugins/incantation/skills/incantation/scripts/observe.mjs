// The observe-only log (docs/spec/incantation.md, S7.4). A Node script with no
// dependencies.
//
//   node observe.mjs add <8 hex>  reads ~/.grimoire/incantation/observe/inbox-<8 hex>.json,
//                                 appends its one line to today's file, and
//                                 deletes the inbox file whatever the result
//   node observe.mjs freeze <n>   copies n random lines into eval/
//
// It writes only under ~/.grimoire/incantation/observe/, in a 0700 folder, 0600 files,
// one file a day. A line holds the session's own candidate words, never heard
// text. Anything it does not accept is refused with one fixed line and nothing
// is written. Each run drops day files older than 30 days first, and never
// touches eval/.

import { randomInt } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanText } from './lib.mjs';

const MAX_LINE = 4096;
const KEEP_DAYS = 30;
const MAX_FREEZE = 1000;
// The candidate kinds the speak gate weighs (S4.4).
export const KINDS = ['result', 'decision', 'risk', 'failure', 'check-in'];
const KEYS = ['kind', 'urgency', 'score', 'words', 'spoken'];
const DAY_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

class Refused extends Error {}
const refuse = () => {
  throw new Refused('refused');
};

const folderOf = home => join(home, '.grimoire', 'incantation', 'observe');
const pad = n => String(n).padStart(2, '0');
const dayOf = now => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// Day files over 30 days old go. A folder that is not there has none.
function dropOld(folder, now) {
  if (!existsSync(folder)) return;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const name of readdirSync(folder)) {
    const m = DAY_FILE.exec(name);
    if (!m) continue;
    const days = (today - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86_400_000;
    if (days > KEEP_DAYS) rmSync(join(folder, name), { force: true });
  }
  // An inbox file the session wrote but never passed to add: gone after a day.
  for (const name of readdirSync(folder)) {
    if (!/^inbox-[0-9a-f]{8}.json$/.test(name)) continue;
    const p = join(folder, name);
    try {
      if (now.getTime() - lstatSync(p).mtimeMs > 86_400_000) rmSync(p, { force: true });
    } catch {
      // gone already
    }
  }
}

// Each folder from ~/.grimoire/incantation down, made 0700: never a link or junction, and
// its real path inside the real home (S5.5). A file written there is checked the
// same way first. Anything else is refused.
function secure(home, folder) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const realHome = realpathSync(home);
  const top = join(home, '.grimoire', 'incantation');
  for (let p = folder; ; p = dirname(p)) {
    const st = lstatSync(p);
    if (st.isSymbolicLink() || !st.isDirectory()) refuse();
    const rel = relative(realHome, realpathSync(p));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) refuse();
    if (process.platform !== 'win32') chmodSync(p, 0o700);
    if (p === top) break;
  }
}
// The folder checked before anything is read or deleted in it: one that is not
// there is left alone, one that is a link or a junction is refused.
function checkedIfThere(home, folder) {
  try {
    lstatSync(folder);
  } catch {
    return;
  }
  secure(home, folder);
}
function plainOrAbsent(file) {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || !st.isFile()) refuse();
}

// Words that look like a path, an address or a key never enter the log (claim 3).
// A crude shape test: it refuses some harmless words, and the session rewrites them.
const PATH_SHAPE = /(?:^|\s)(?:[A-Za-z]:)?[~.]*[\\/]\S|\S[\\/]\S+[\\/]|(?:^|\s)[A-Za-z]:[\\/]/;
const ADDRESS_SHAPE = /\S@\S+\.\S/;
const KEY_SHAPE = /[A-Za-z0-9_-]{24,}/;
function looksPrivate(text) {
  return PATH_SHAPE.test(text) || ADDRESS_SHAPE.test(text) || KEY_SHAPE.test(text);
}

// The line as the log keeps it, or a refusal.
function entryOf(input, now) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > MAX_LINE) refuse();
  const text = input.replace(/\r?\n$/, '');
  if (!text || text.includes('\n')) refuse();
  let given;
  try {
    given = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (given === null || typeof given !== 'object' || Array.isArray(given)) refuse();
  const keys = Object.keys(given);
  if (keys.length !== KEYS.length || !keys.every(k => KEYS.includes(k))) refuse();
  const { kind, urgency, score, words, spoken } = given;
  if (!KINDS.includes(kind)) refuse();
  if (typeof urgency !== 'number' || !Number.isFinite(urgency) || urgency < 0 || urgency > 10) refuse();
  if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > 100) refuse();
  if (typeof spoken !== 'boolean' || typeof words !== 'string') refuse();
  const clean = cleanText(words, 500);
  if (!clean || looksPrivate(clean)) refuse();
  return { time: now.toISOString(), kind, urgency, score, length: [...clean].length, spoken, reaction: '', words: clean };
}

export function add({ home, now = new Date(), input }) {
  const folder = folderOf(home);
  checkedIfThere(home, folder);
  dropOld(folder, now);
  const entry = entryOf(input, now);
  secure(home, folder);
  const file = join(folder, `${dayOf(now)}.jsonl`);
  plainOrAbsent(file);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// A random sample of n logged lines, copied to a new file in eval/. Returns how many.
export function freeze({ home, now = new Date(), n, random = randomInt }) {
  const folder = folderOf(home);
  checkedIfThere(home, folder);
  dropOld(folder, now);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FREEZE || !existsSync(folder)) refuse();
  const lines = [];
  for (const name of readdirSync(folder).sort()) {
    if (!DAY_FILE.test(name)) continue;
    plainOrAbsent(join(folder, name));
    lines.push(...readFileSync(join(folder, name), 'utf8').split('\n').filter(Boolean));
  }
  if (!lines.length) refuse();
  for (let i = lines.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  const sample = lines.slice(0, Math.min(n, lines.length));
  const evalDir = join(folder, 'eval');
  secure(home, evalDir);
  const stamp = `${dayOf(now)}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${sample.length}`;
  let file = join(evalDir, `${stamp}.jsonl`);
  for (let i = 2; existsSync(file); i++) file = join(evalDir, `${stamp}-${i}.jsonl`);
  writeFileSync(file, `${sample.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return sample.length;
}

// The session's inbox file for one line: read once, then deleted whatever the
// result. A link, a folder or a file over the line cap is refused.
export const INBOX = /^[0-9a-f]{8}$/;
export function takeInbox(home, hex) {
  if (!INBOX.test(hex ?? '')) refuse();
  const path = join(folderOf(home), `inbox-${hex}.json`);
  let text = null;
  try {
    const st = lstatSync(path);
    if (st.isFile() && !st.isSymbolicLink() && st.size <= MAX_LINE) text = readFileSync(path, 'utf8');
  } catch {
    // not there
  }
  rmSync(path, { force: true });
  if (text === null) refuse();
  return text;
}

function main(argv) {
  const home = homedir();
  const say = text => process.stdout.write(`${text}\n`);
  const [, , command, arg] = argv;
  try {
    if (command === 'add') {
      checkedIfThere(home, folderOf(home));
      add({ home, input: takeInbox(home, arg) });
      return say('observe: ok'), 0;
    }
    if (command === 'freeze') {
      if (!/^[1-9][0-9]{0,3}$/.test(arg ?? '')) refuse();
      return say(`observe: froze ${freeze({ home, n: Number(arg) })}`), 0;
    }
  } catch {
    return say('observe error: refused'), 1;
  }
  say('usage: observe.mjs add <8 hex> | freeze <n>');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
