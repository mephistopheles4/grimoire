import { HUES } from './mic-view.ts'
import type { MicWord } from './mic-view.ts'

// The desktop's mic picture: an orb in the middle, the loudness flowing out of
// it both ways as a faint wave, and round ripples dropping out of it while the
// person talks. While Claude speaks there is no wave, one slow ripple, and the
// orb breathes. A pure function from the last two readings (24 digits each) and
// two clocks to SVG markup, drawn by `Svg` as an image (never interactive: an
// interactive frame flashes on every redraw).
//
// The desktop puts a picture up afresh on every redraw, even with the same
// source, and that restarts every animation in it from its start. So every
// animation begins `el` ms in the past (`el` is how long this picture's reading
// has already been showing), and every loop begins at the phase its clock says.
// A fresh copy then carries on exactly where the last one was.
//
// No text of what was said and nothing but the 24 digits goes in.

const W = 1000
const H = 44
const MID = H / 2
const CX = W / 2

const nums = (d: string) => [...d].map(c => Number(c) || 0)
const f = (n: number) => n.toFixed(1)

const tween = (attr: string, from: string, to: string, ms: number) =>
  `<animate attributeName="${attr}" from="${from}" to="${to}" dur="${ms}ms" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"/>`

/** The start, in ms, that puts a looping animation at the phase `t` says. */
export const phase = (t: number, periodMs: number) => -(((t % periodMs) + periodMs) % periodMs)

// The listener's stamp jitters by a few ms around each reading's real time.
// Snap it to the reading grid (its phase taken from the first stamp seen), so a
// reading's moment never moves between pictures.
let gridPhase: number | undefined
const snap = (stamp: number, ms: number): number => {
  if (gridPhase === undefined) gridPhase = stamp % ms
  return Math.round((stamp - gridPhase) / ms) * ms + gridPhase
}

const RUN = 40 // readings (10 s) the line keeps sliding, so silence never stalls it
const SAMPLES = 360
const CARRIER_MS = 1000 // one full wave per four readings
const RIP_MS = 2200
const BREATH_MS = 1900 // the speaking orb's breath, kept in phase across pictures
const ORB_R = 2 // ripples are born at the orb's middle

/** The picture. `prevDigits` and `digits` are the readings before and now ('' for
 *  no earlier one), `ms` the time between readings, `stamp` the moment of the
 *  newest reading, `now` the picture's clock (the same for every redraw of one
 *  reading, plus the fixed lead) and `el` how long this reading has been showing. */
export function orbSvg(prevDigits: string, digits: string, word: MicWord, ms: number, stamp: number, now: number, el: number): string {
  const prev = nums(prevDigits || digits)
  const cur = nums(digits)
  const fresh = prevDigits === '' && el < 350
  const B = `begin="${-Math.round(el)}ms"`
  const hue = HUES[word]
  const n = cur.length
  const step = CX / (n - 1)
  const pxPerMs = step / ms
  const muted = word === 'muted'

  // Loudness at an age (ms before the stamp), from the readings, newest last,
  // with a soft S-curve between readings so the wave swells with no corners.
  const loudAt = (age: number) => {
    const pos = n - 1 - age / ms
    const i = Math.floor(pos)
    const t = pos - i
    const a = cur[Math.max(0, Math.min(n - 1, i))] ?? 0
    const b = cur[Math.max(0, Math.min(n - 1, i + 1))] ?? 0
    return a + (b - a) * t * t * (3 - 2 * t)
  }

  // A conveyor: every point of the wave is a moment in time, T = now - x / speed,
  // so its height is the carrier's phase and the loudness at that moment, and a
  // point keeps its height as it slides out. Laid out against the picture's
  // clock, never the listener's stamp, so every picture agrees on where each
  // moment sits however late or rare the updates are.
  const pathFor = (dir: 1 | -1) => {
    const pts = Array.from({ length: SAMPLES }, (_, j) => {
      // From one reading inside the orb (hidden by it) out to the far edge.
      const x = -RUN * step + (j / (SAMPLES - 1)) * (CX + RUN * step)
      const tAbs = now - x / pxPerMs
      const age = Math.max(0, snap(stamp, ms) - tAbs)
      // The newest readings still change from picture to picture, so the wave
      // starts flat at the orb and reaches full height two readings out.
      const u = Math.max(0, Math.min(1, x / (2 * step)))
      const ease = u * u * (3 - 2 * u)
      const amp = muted ? 0 : Math.pow(loudAt(age) / 8, 1.4) * (MID - 1) * (0.75 + 0.25 * (1 - Math.max(0, x) / CX)) * ease
      return [CX + dir * x, MID + amp * Math.sin((2 * Math.PI * tAbs) / CARRIER_MS)] as [number, number]
    })
    // A plain polyline: no curve fitting.
    return 'M' + pts.map(([px, py]) => `${f(px)},${f(py)}`).join('L')
  }
  const side = (dir: 1 | -1) =>
    `<g clip-path="url(#grow)"><g clip-path="url(#half${dir > 0 ? 'r' : 'l'})"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="${f(dir * RUN * step)} 0" dur="${RUN * ms}ms" ${B} fill="freeze"/><path d="${pathFor(dir)}" fill="none" stroke="url(#t${dir > 0 ? 'r' : 'l'})" stroke-width="1.6" stroke-linecap="round" filter="url(#tg)"/></g></g></g>`

  const lvl = (d: number[]) => d.slice(-3).reduce((p, q) => p + q, 0) / 3 / 8
  const r0 = 6 + lvl(prev) * 10
  const r1 = 6 + lvl(cur) * 10

  const ripple = (begin: string, reach: number, op: number, repeat: boolean) => {
    const rep = repeat ? ' repeatCount="indefinite"' : ' fill="freeze"'
    return `<circle cx="${CX}" cy="${MID}" r="${f(ORB_R)}" fill="none" stroke="${hue}" stroke-width="1.2" stroke-opacity="0"><animate attributeName="r" from="${f(ORB_R)}" to="${f(ORB_R + reach)}" dur="${RIP_MS}ms" begin="${begin}"${rep} calcMode="spline" keyTimes="0;1" keySplines="0.25 0.4 0.5 1"/><animate attributeName="stroke-opacity" from="${op}" to="0" dur="${RIP_MS}ms" begin="${begin}"${rep} calcMode="spline" keyTimes="0;1" keySplines="0.3 0 0.6 1"/><animate attributeName="stroke-width" from="1.8" to="0.4" dur="${RIP_MS}ms" begin="${begin}"${rep}/></circle>`
  }
  let ring = ''
  if (word === 'speaking') {
    // One slow ripple, kept in phase across pictures.
    ring = ripple(`${Math.round(phase(now + el, RIP_MS))}ms`, 60, 0.3, true)
  } else if (!muted) {
    // One ripple a second at most, on readings fixed in time (every fourth), as
    // loud as the loudest reading of that second, and none for soft sound. A
    // ripple is born when its reading first shows, so its age counts from the
    // newest reading: it never pops up already halfway out.
    const at = snap(stamp, ms)
    for (let k = 0; k < n; k++) {
      const te = at - (n - 1 - k) * ms
      if (Math.round(te / ms) % 4 !== 0) continue
      const ago = at - te
      const v = Math.max(...cur.slice(Math.max(0, k - 3), k + 1))
      if (v < 3 || ago >= RIP_MS) continue
      ring += ripple(`${Math.round(-ago - el)}ms`, 15 + (v / 8) * 60, 0.2 + (v / 8) * 0.25, false)
    }
  }

  const defs =
    `<radialGradient id="o"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.35" stop-color="${hue}"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="tr" x1="0" x2="1"><stop offset="0.5" stop-color="${hue}" stop-opacity="0.7"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="tl" x1="1" x2="0"><stop offset="0.5" stop-color="${hue}" stop-opacity="0.7"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="halfr"><rect x="${CX}" y="0" width="${CX}" height="${H}"/></clipPath><clipPath id="halfl"><rect x="0" y="0" width="${CX}" height="${H}"/></clipPath>` +
    `<filter id="tg" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    (fresh
      ? `<clipPath id="grow"><rect x="${CX}" y="0" width="0" height="${H}"><animate attributeName="x" from="${CX}" to="0" dur="350ms" ${B} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0 0 1"/><animate attributeName="width" from="0" to="${W}" dur="350ms" ${B} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0 0 1"/></rect></clipPath>`
      : `<clipPath id="grow"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>`)

  const wave = word === 'speaking' ? '' : `${side(1)}${side(-1)}`
  // While Claude speaks there is no mic loudness to drive the orb, so it
  // breathes on its own, at about the size it reaches for a person's voice.
  const orb =
    word === 'speaking'
      ? `<circle cx="${CX}" cy="${MID}" r="15" fill="url(#o)"><animate attributeName="r" values="12;19;14;21;13;18;12" dur="${BREATH_MS}ms" begin="${Math.round(phase(now + el, BREATH_MS))}ms" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.16;0.33;0.5;0.66;0.83;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/></circle>`
      : `<circle cx="${CX}" cy="${MID}" r="${f(r1 * 1.5)}" fill="url(#o)">${tween('r', f(r0 * 1.5), f(r1 * 1.5), ms).replace('<animate ', `<animate ${B} `)}</circle>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet"><defs>${defs}</defs>${wave}${ring}${orb}</svg>`
}
