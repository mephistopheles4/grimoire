// The mic's loudness as a short row of digits, for a band that draws bars
// (#208, T16). Numbers only: no audio, no text, and nothing from which words
// could be rebuilt. One digit, 0 to 8, is the loudest frame of a 250 ms bucket
// on a scale from -60 to -15 dBFS; the row holds the last 24 buckets, 6 s.

export const METER = { bars: 24, bucketMs: 250, loDb: -60, hiDb: -15, steps: 8 };

// A level in dBFS as a digit. Silence, a gap and NaN are 0.
export const digit = (db, m = METER) => {
  if (!(db > m.loDb)) return 0;
  return Math.min(m.steps, Math.round(((Math.min(db, m.hiDb) - m.loDb) / (m.hiDb - m.loDb)) * m.steps));
};

// The row the file holds: the stamp in epoch ms, the state word, the digits.
export const levelsLine = (ms, word, digits) => `${ms} ${word} ${digits}\n`;

export class Meter {
  constructor(m = METER) {
    this.m = m;
    this.digits = '0'.repeat(m.bars);
    this.peak = -Infinity;
    this.since = null;
  }

  // One frame's level at time t (ms, any clock). While muted a bucket reads 0,
  // so a muted mic draws flat. Returns true when a bucket closed.
  add(db, t, muted = false) {
    if (this.since === null) this.since = t;
    if (db > this.peak) this.peak = db;
    if (t - this.since < this.m.bucketMs) return false;
    this.digits = this.digits.slice(1) + (muted ? '0' : String(digit(this.peak, this.m)));
    this.peak = -Infinity;
    this.since = t;
    return true;
  }
}
