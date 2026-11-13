// The gate and the heard queue (docs/spec/incantation.md, S6), from #622's
// listener with the engine seam in place of the sound server. Pure: time comes
// in with each call, so a test drives it with scripted frames and scripted
// playback, and nothing here reads a clock, a file or the network.

import { cleanText } from './lib.mjs';

// The listener's own numbers, in one place. Each is a starting point.
export const KNOBS = {
  frameMs: 30,
  floorMs: 1000, // how long the room's level is measured at start
  voiceDb: 10, // a frame is voice at this many dB over the floor
  minVoiceMs: 250, // a turn with less voice is dropped
  maxTurnMs: 30_000, // a longer turn is cut, and the rest goes on as the next
  tailMs: 300, // muted this long after the last playback ends (F2 may raise it, at most 1500)
  mutedAfterMs: 30_000, // a mute this long is reported once
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
export class Gate {
  constructor({ silenceMs = 1000, knobs = KNOBS, playing = 0, t = 0 } = {}) {
    this.k = knobs;
    this.silenceMs = silenceMs;
    this.count = playing;
    this.playStart = playing > 0 ? t : null;
    this.playEnd = null;
    this.playId = playing > 0 ? 1 : 0;
    this.exemptPlay = 0;
    this.deliveredAt = -Infinity;
    this.muteStart = playing > 0 ? t : null;
    this.mutedReported = false;
    this.floor = null;
    this.calib = [];
    this.roll = [];
    this.turn = null;
  }

  muted(t) {
    return this.count > 0 || (this.playEnd !== null && t < this.playEnd + this.k.tailMs);
  }

  // The number of streams now playing, at time t.
  playback(count, t) {
    if (count > 0 && this.count === 0) {
      if (!this.muted(t)) {
        // a new mute; a restart inside the tail goes on with the one in force
        this.muteStart = t;
        this.mutedReported = false;
      }
      this.playStart = t;
      this.playId++;
      this.turn = null; // a turn open when playback starts is dropped
      this.roll = [];
    } else if (count === 0 && this.count > 0) {
      this.playEnd = t;
    }
    this.count = count;
  }

  delivered(t) {
    this.deliveredAt = t;
  }

  // One frame; returns the events it caused: { type: 'turn', ... } or { type: 'muted' }.
  frame(buf, t) {
    const k = this.k;
    const events = [];
    if (this.muted(t)) {
      if (this.muteStart === null) {
        this.muteStart = t;
        this.mutedReported = false;
      }
      if (!this.mutedReported && t - this.muteStart > k.mutedAfterMs) {
        this.mutedReported = true;
        events.push({ type: 'muted' });
      }
      return events;
    }
    this.muteStart = null;
    const level = levelDb(buf);
    if (this.floor === null) {
      this.calib.push(level);
      if (this.calib.length * k.frameMs >= k.floorMs) this.floor = this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
      return events;
    }
    const voice = level >= this.floor + k.voiceDb;
    if (!this.turn) {
      if (!voice) {
        this.floor = this.floor * 0.98 + level * 0.02;
        this.roll.push(buf);
        if (this.roll.length > k.preRollFrames) this.roll.shift();
        return events;
      }
      const afterReply = this.playStart !== null && this.playEnd !== null && this.playStart > this.deliveredAt && this.playEnd + k.tailMs <= t;
      this.turn = { frames: [...this.roll, buf], voice: 1, silent: 0, afterReply, playId: this.playId };
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
        events.push({ type: 'turn', pcm: Buffer.concat(turn.frames.slice(0, keep)), afterReply: turn.afterReply, firstAfterReply: first, silenceMs: this.silenceMs });
      }
    }
    return events;
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
