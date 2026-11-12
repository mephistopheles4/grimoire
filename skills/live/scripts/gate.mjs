// The live skill's energy gate. Pure: PCM goes in, turn events come out.
// No file, no process and no clock, so the tests feed it a built signal.
//
// Input is 16 kHz, mono, signed 16-bit little-endian, cut in 30 ms frames.
// - The noise floor is the RMS of the first 0.5 s.
// - The threshold is the larger of three times the floor and 300.
// - A turn starts at three frames in a row above the threshold.
// - A turn ends after 1.6 s below it, or is cut at 30 s.
// - A turn with under 0.4 s voiced is discarded.

export const RATE = 16000;
const FRAME = (RATE * 30) / 1000; // samples per 30 ms frame
const CALIBRATION = RATE / 2; // samples in the first 0.5 s
const MIN_THRESHOLD = 300;
const START_FRAMES = 3;
const END_FRAMES = Math.floor((1.6 * RATE) / FRAME); // 53 frames, 1.59 s: exactly 1.6 s of quiet ends a turn
const MAX_FRAMES = Math.floor((30 * RATE) / FRAME);
const MIN_VOICED_MS = 400;

const rms = (samples, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/**
 * One gate. `push(chunk)` takes a Buffer of PCM and returns the events it
 * completes, in order: `{ type: 'end', pcm }` or `{ type: 'discard' }`.
 * `flush()` closes a turn that is still open when the stream ends.
 */
export function createGate() {
  let floorSamples = [];
  let threshold = null;
  let pending = Buffer.alloc(0); // bytes not yet a whole frame
  let turn = null; // { frames: Buffer[], voiced, quiet, length }
  let run = []; // the frames above the threshold that may start a turn

  const finish = () => {
    const t = turn;
    turn = null;
    run = [];
    if (t.voiced * 30 < MIN_VOICED_MS) return { type: 'discard' };
    // Keep the PCM up to the last voiced frame, so the quiet that ended the turn stays out.
    const kept = t.frames.slice(0, t.frames.length - t.quiet);
    return { type: 'end', pcm: Buffer.concat(kept) };
  };

  const frame = (buf, events) => {
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = buf.readInt16LE(i * 2);
      sum += v * v;
    }
    const loud = Math.sqrt(sum / FRAME) > threshold;
    if (!turn) {
      if (!loud) {
        run = [];
        return;
      }
      run.push(buf);
      if (run.length < START_FRAMES) return;
      turn = { frames: run, voiced: run.length, quiet: 0 };
      run = [];
      return;
    }
    turn.frames.push(buf);
    if (loud) {
      turn.voiced++;
      turn.quiet = 0;
    } else {
      turn.quiet++;
    }
    if (turn.quiet >= END_FRAMES || turn.frames.length >= MAX_FRAMES) events.push(finish());
  };

  return {
    push(chunk) {
      const events = [];
      let bytes = Buffer.concat([pending, chunk]);
      if (threshold === null) {
        // The floor takes exactly the first 0.5 s; frames start right after it.
        const need = CALIBRATION * 2 - floorSamples.length * 2;
        const take = Math.min(need, bytes.length - (bytes.length % 2));
        for (let i = 0; i < take; i += 2) floorSamples.push(bytes.readInt16LE(i));
        bytes = bytes.subarray(take);
        if (floorSamples.length < CALIBRATION) {
          pending = Buffer.from(bytes);
          return events;
        }
        threshold = Math.max(3 * rms(floorSamples, 0, CALIBRATION), MIN_THRESHOLD);
        floorSamples = [];
      }
      let at = 0;
      while (bytes.length - at >= FRAME * 2) {
        // Copy, so the frame outlives the chunk it came from.
        frame(Buffer.from(bytes.subarray(at, at + FRAME * 2)), events);
        at += FRAME * 2;
      }
      pending = Buffer.from(bytes.subarray(at));
      return events;
    },
    flush() {
      return turn ? [finish()] : [];
    },
    /** True while a turn is open: the listener lets it run to its end. */
    get inTurn() {
      return turn !== null;
    },
  };
}
