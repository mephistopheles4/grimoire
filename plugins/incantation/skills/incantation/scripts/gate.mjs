// The gate and the heard queue (docs/spec/incantation.md, S6, and its trial
// amendments), from #622's listener with the engine seam in place of the sound
// server. Pure: time comes in with each call, so a test drives it with scripted
// frames and scripted playback, and nothing here reads a clock, a file or the
// network. The mic is never closed to the session's own speech: only the person
// mutes it (T11), and a person who talks over a reply cuts it off (T8).

import { cleanText } from './lib.mjs';

// The listener's own numbers, in one place. Each is a starting point.
export const KNOBS = {
  frameMs: 30,
  floorMs: 1000, // how long the room's level is measured at start
  voiceDb: 6, // a frame is voice at this many dB over the floor (T17; was 10)
  minVoiceDbfs: -55, // ...and at least this loud in absolute terms, so a near-silent headset room (hiss, -70) cannot make a turn (T5; T17: was -45)
  minVoiceMs: 120, // a turn with less voice is dropped: under a clipped "yes", over a click (T17; T5 had 400, and before it 250)
  maxTurnMs: 30_000, // a longer turn is cut, and the rest goes on as the next
  tailMs: 300, // a reply counts as ended this long after its last playback ends (F2 may raise it, at most 1500)
  bargeMs: 360, // this much voice while a reply plays cuts the reply off
  joinMs: 2000, // a turn that stops mid-sentence waits this long for the next to join it
  maxJoins: 4, // at most this many turns join into one
  heartbeatMs: 2000, // the status file is touched this often
  commandPollMs: 250, // the band's click file is looked for this often (T16)
  commandFreshMs: 5000, // and a click older than this is dropped unread
  thinkingMs: 60_000, // "thinking" shows this long after a turn, at most
  idleWaitMs: 60_000, // an idle wait gives up after this long
  maxSayChars: 800, // one spoken reply, at most; a longer text is refused and goes to chat (T18)
  sayQueueMax: 3, // replies waiting behind the one playing; the next is refused as busy (T18)
  sayWaitMs: 90_000, // the say command waits this long for its answer: a generation can be slow (T18)
  queueMax: 20,
  ageMs: 5 * 60_000,
  perMinute: 4,
  idleMs: 30 * 60_000, // no heard turn this long ends the listener
  quietMs: 10 * 60_000, // a wait with nothing this long prints quiet
  noWaiterMs: 5 * 60_000, // no wait connected this long ends the listener
  maxText: 500,
  sttFailures: 3,
  sttTimeoutMs: 15_000,
  parentPollMs: 500,
  preRollFrames: 3,
  silentStartMs: 3000, // all-zero frames this long at start: the OS mic permission is off
  warmMs: 60_000,
  handshakeMs: 2000,
  feedOpenMs: 5000, // the playback feed must answer before the mic opens
};

export const SAMPLE_RATE = 16_000;
export const frameBytes = (knobs = KNOBS) => (SAMPLE_RATE * 2 * knobs.frameMs) / 1000;
const STOP_WORDS = new Set(['stop', 'thats all', 'wait']);

// Heard text as a waiter prints it: control, invisible and line-separator
// characters removed, inner quotes escaped, cut at 500 characters.
export function formatHeard(text, afterReply, max = KNOBS.maxText) {
  const clean = cleanText(text, max).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Heard${afterReply ? ' (after reply)' : ''}: "${clean}"`;
}

// Does the whole turn say stop, that's all, or wait?
export function isStopWord(text) {
  return STOP_WORDS.has(String(text).toLowerCase().replace(/['’.,!?]/g, '').replace(/\s+/g, ' ').trim());
}

const levelDb = buf => {
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(n, 1));
  return rms < 1 ? -100 : 20 * Math.log10(rms / 32768);
};

// Turns out of frames. Pure: time comes in with each call, so a test drives it
// with scripted frames and scripted playback, and nothing here reads a clock.
// Every frame is heard, a reply playing or not. While a reply plays and a turn
// holds enough voice, the gate says so once ({ type: 'barge' }), so the
// listener can cut the reply off.
export class Gate {
  constructor({ silenceMs = 1500, knobs = KNOBS, playing = 0, t = 0 } = {}) {
    this.k = knobs;
    this.silenceMs = silenceMs;
    this.count = playing;
    this.playStart = playing > 0 ? t : null;
    this.playEnd = null;
    this.playId = playing > 0 ? 1 : 0;
    this.exemptPlay = 0;
    this.deliveredAt = -Infinity;
    this.floor = null;
    this.calib = [];
    this.roll = [];
    this.turn = null;
  }

  // Is a reply playing now?
  get playing() {
    return this.count > 0;
  }

  // The number of streams now playing, at time t.
  playback(count, t) {
    if (count > 0 && this.count === 0) {
      this.playStart = t;
      this.playId++;
    } else if (count === 0 && this.count > 0) {
      this.playEnd = t;
    }
    this.count = count;
  }

  delivered(t) {
    this.deliveredAt = t;
  }

  // Is a turn open, with voice in it, now?
  get hearing() {
    return !!this.turn;
  }

  // One frame; returns the events it caused: { type: 'turn', ... } or { type: 'barge' }.
  frame(buf, t) {
    const k = this.k;
    const events = [];
    const level = levelDb(buf);
    this.level = level; // the last frame's loudness, for the meter (T16)
    if (this.floor === null) {
      this.calib.push(level);
      if (this.calib.length * k.frameMs >= k.floorMs) this.floor = this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
      return events;
    }
    const voice = level >= this.floor + k.voiceDb && level >= k.minVoiceDbfs;
    if (!this.turn) {
      if (!voice) {
        this.floor = this.floor * 0.98 + level * 0.02;
        this.roll.push(buf);
        if (this.roll.length > k.preRollFrames) this.roll.shift();
        return events;
      }
      // A turn is a reply to the session once any playback began after the last delivery.
      const afterReply = this.playStart !== null && this.playStart > this.deliveredAt;
      this.turn = { frames: [...this.roll, buf], voice: 1, silent: 0, afterReply, playId: this.playId, barged: false };
      this.roll = [];
    } else {
      this.turn.frames.push(buf);
      if (voice) {
        this.turn.voice++;
        this.turn.silent = 0;
      } else {
        this.turn.silent++;
        this.floor = this.floor * 0.98 + level * 0.02;
      }
    }
    const turn = this.turn;
    if (this.count > 0 && !turn.barged && turn.voice * k.frameMs >= k.bargeMs) {
      turn.barged = true;
      events.push({ type: 'barge' });
    }
    const length = turn.frames.length * k.frameMs;
    if (turn.silent * k.frameMs >= this.silenceMs || length >= k.maxTurnMs) {
      this.turn = null;
      if (turn.voice * k.frameMs >= k.minVoiceMs) {
        const keep = turn.frames.length - Math.max(0, turn.silent - 10);
        let first = false;
        if (turn.afterReply && this.exemptPlay !== turn.playId) {
          first = true;
          this.exemptPlay = turn.playId;
        }
        events.push({ type: 'turn', pcm: Buffer.concat(turn.frames.slice(0, keep)), afterReply: turn.afterReply, firstAfterReply: first, barged: turn.barged, silenceMs: this.silenceMs });
      }
    }
    return events;
  }
}

// The words of a turn, lowercased, with punctuation taken out.
const words = text =>
  String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// What the speech-to-text model delivers out of silence or room noise (T5): a
// lone "you", a filler, a sound tag such as [BLANK_AUDIO], or nothing but
// punctuation. Such a turn is dropped before it is queued. A word a person
// could mean, yes and no and a stop word included, is never in this set.
const FRAGMENTS = new Set(['you', 'uh', 'um', 'uhm', 'er', 'erm', 'hmm', 'hm', 'mm', 'huh', 'ah', 'thank you', 'thanks for watching', 'thank you for watching']);
export function isFragment(text) {
  const t = String(text).trim();
  if (!t) return true;
  if (/^[\[(][^\])]{0,40}[\])]$/.test(t)) return true;
  const w = words(t);
  return w === '' || FRAGMENTS.has(w);
}

// The person's own mic words (T11): the whole turn says mute or unmute.
const MUTE = new Set(['mute', 'mute mic', 'mute the mic', 'mute microphone', 'mute the microphone']);
const UNMUTE = new Set(['unmute', 'un mute', 'unmute mic', 'unmute the mic', 'unmute microphone', 'unmute the microphone']);
export const isMuteWord = text => MUTE.has(words(text));
export const isUnmuteWord = text => UNMUTE.has(words(text));

// Does the text end a sentence? A turn that does not may be a turn cut at a breath.
export const isComplete = text => /[.?!…]["')\]]*$/.test(String(text).trim());

// A turn cut at a breath is joined to the next one (T10). Pure: time comes in
// with each call. A turn that ends a sentence, a stop word and a reply to the
// session's own speech are never held, and any of them lets a held turn go first.
export class Joiner {
  constructor(knobs = KNOBS) {
    this.k = knobs;
    this.hold = null;
    this.deadline = null;
  }

  take() {
    const held = this.hold;
    this.hold = null;
    this.deadline = null;
    return held;
  }

  // Items to queue now, in order.
  offer(item, now) {
    if (item.exempt || item.afterReply) return [...(this.hold ? [this.take()] : []), item];
    const merged = this.hold ? { ...this.hold, text: `${this.hold.text} ${item.text}`, joins: this.hold.joins + 1, at: item.at } : { ...item, joins: 0 };
    if (isComplete(merged.text) || merged.joins >= this.k.maxJoins || merged.text.length >= this.k.maxText - 100) {
      this.hold = null;
      this.deadline = null;
      return [merged];
    }
    this.hold = merged;
    this.deadline = now + this.k.joinMs;
    return [];
  }

  // The held turn, once its wait is over.
  due(now) {
    return this.hold && now >= this.deadline ? [this.take()] : [];
  }

  nextAt() {
    return this.hold ? this.deadline : null;
  }
}

// Heard text waiting for a waiter: at most 20 turns, none older than 5 minutes,
// deliveries held to 4 a minute except for the turns that are never held.
export class HeardQueue {
  constructor(knobs = KNOBS) {
    this.k = knobs;
    this.items = [];
    this.dropped = 0;
    this.deliveries = [];
  }

  push(item) {
    this.items.push(item);
    while (this.items.length > this.k.queueMax) {
      this.items.shift();
      this.dropped++;
    }
  }

  age(now) {
    const before = this.items.length;
    this.items = this.items.filter(i => now - i.at <= this.k.ageMs);
    this.dropped += before - this.items.length;
  }

  held(now) {
    this.deliveries = this.deliveries.filter(d => now - d < 60_000);
    return this.deliveries.length >= this.k.perMinute;
  }

  // Can a delivery go now? A turn that is never held lets the whole queue go.
  ready(now) {
    this.age(now);
    if (!this.items.length) return false;
    return this.items.some(i => i.exempt) || !this.held(now);
  }

  // When the cap lifts, for a waiter that is waiting on it; null when it is not the cap.
  nextAt(now) {
    this.age(now);
    if (!this.items.length || !this.held(now)) return null;
    return Math.min(...this.deliveries) + 60_000;
  }

  take(now) {
    const exempt = this.items.some(i => i.exempt);
    const turns = this.items;
    const dropped = this.dropped;
    this.items = [];
    this.dropped = 0;
    if (!exempt) this.deliveries.push(now);
    return { turns, dropped };
  }
}
