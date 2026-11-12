// Shared by the Incantation scripts. No dependencies: node built-ins only.
// Nothing here reads the environment or the working folder: each caller hands
// in the home folder and the text it wants read.

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The folder every Incantation process keeps its sockets, pid files and token
// in. The person owns it, mode 0700 (S4.1 a).
export const runDir = home => join(home, '.incantation', 'run');

// The two speech engines, each on one socket in the run folder.
export const SOCKETS = { stt: 'stt.sock', tts: 'tts.sock' };

// A file larger than this is not a settings file. A read past it fails.
const MAX_FILE = 1_000_000;

// The text of a file, or null when it is not there. Any other error, and a file
// over the cap, throws: a file the caller cannot read is not an absent one.
export function readBuffer(path) {
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  if (!st.isFile() || st.size > MAX_FILE) throw new Error('unreadable');
  return readFileSync(path);
}

export function readText(path) {
  const bytes = readBuffer(path);
  return bytes === null ? null : bytes.toString('utf8');
}

// VoiceMode's own reader of a settings file (voice_mode/config.py, v9.0.2),
// followed line for line so that the guard and the proxy read the values
// VoiceMode reads: blank lines and `#` lines skipped, KEY=VALUE split at the
// first `=`, both sides stripped, a value that opens with a quote taken to the
// closing quote, over lines if need be. The first line to set a key wins, as
// it does in VoiceMode, where a key already set is not set again.
export function parseVoiceModeEnv(text) {
  const out = new Map();
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      i++;
      continue;
    }
    if (line.includes('=')) {
      const at = line.indexOf('=');
      const key = line.slice(0, at).trim();
      let value = line.slice(at + 1).trim();
      if (value && (value[0] === '"' || value[0] === "'")) {
        const quote = value[0];
        if (value.length > 1 && value[value.length - 1] === quote) {
          value = value.slice(1, -1);
        } else {
          const parts = [value.slice(1)];
          i++;
          while (i < lines.length) {
            const next = lines[i];
            if (next.endsWith(quote)) {
              parts.push(next.slice(0, -1));
              break;
            }
            parts.push(next);
            i++;
          }
          value = parts.join('\n');
        }
      }
      if (key && !out.has(key)) out.set(key, value);
    }
    i++;
  }
  return out;
}

// The global settings file VoiceMode reads: voicemode.env, or the older
// .voicemode.env when that is missing, whatever VOICEMODE_BASE_DIR says.
// Returns the path VoiceMode would use even when neither file is there, since
// the project walk compares against it.
export function globalEnvPath(home) {
  const current = join(home, '.voicemode', 'voicemode.env');
  if (existsSync(current)) return current;
  const older = join(home, '.voicemode', '.voicemode.env');
  return existsSync(older) ? older : current;
}

// The settings the global file holds, or an empty map when there is none.
export function readGlobalSettings(home) {
  const text = readText(globalEnvPath(home));
  return text === null ? new Map() : parseVoiceModeEnv(text);
}

// The project-level settings file VoiceMode would find from a folder: up the
// tree from it, never the filesystem root itself, each folder's .voicemode.env
// first and then its .voicemode/voicemode.env unless that is the global file,
// the closest one winning. Returns { kind } or null.
export function findProjectEnv(projectDir, home) {
  const global = globalEnvPath(home);
  let current = resolve(projectDir);
  while (current !== dirname(current)) {
    if (existsSync(join(current, '.voicemode.env'))) return { kind: '.voicemode.env' };
    const inFolder = join(current, '.voicemode', 'voicemode.env');
    if (existsSync(inFolder) && inFolder !== global) return { kind: '.voicemode/voicemode.env' };
    current = dirname(current);
  }
  return null;
}

// The ports a list of speech URLs names, when every entry is exactly
// http://127.0.0.1:<port>/… and nothing else: no other host, no other scheme,
// no user information, no missing path, a port written plainly. Null otherwise.
// The list is split as VoiceMode splits it: on commas, entries stripped, empty
// ones dropped.
export function loopbackPorts(value) {
  if (typeof value !== 'string') return null;
  const entries = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  const ports = [];
  for (const entry of entries) {
    const m = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[^\s\\]*$/.exec(entry);
    if (!m || Number(m[1]) > 65535) return null;
    let url;
    try {
      url = new URL(entry);
    } catch {
      return null;
    }
    if (url.hostname !== '127.0.0.1' || url.port !== m[1] || url.username || url.password) return null;
    ports.push(Number(m[1]));
  }
  return ports;
}

// Words as the listener and the observe log keep them: control, invisible and
// line-separator characters removed as the repo's R2 rule removes them, then
// cut at `max` characters.
const HIDDEN = /[\x00-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FFFE}\u{FFFF}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;
export const cleanText = (text, max = 500) => [...String(text).replace(HIDDEN, '').trim()].slice(0, max).join('');

// The proof a proxy gives for a nonce: the keyed hash of it under the token the
// proxy wrote when it started. The token is never sent.
export const keyedHash = (token, nonce) => createHmac('sha256', token).update(String(nonce)).digest('hex');
