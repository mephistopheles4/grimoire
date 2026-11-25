#!/usr/bin/env node
// The timing and model timeline sheet incantation's README shows, drawn from
// the skill's own timing constants in Aviation's drafting language (zone
// border + réseau ground + framed surface panels). This repository's tool, not
// the skill's: it ships to no install.
//
//   node scripts/incantation-sheets.mjs <dir>
//
// Writes <dir>/incantation-timeline.svg. A README shows an SVG as an image: no
// script runs and nothing is fetched, so the six IBM Plex Mono faces are
// inlined as data.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAUTION, INK, MONO, NORMAL, PAPER, L, R, T, ink, titleBlock } from './lib/drafting.mjs';
import { KNOBS } from '../skills/incantation/scripts/gate.mjs';
import { EVERY_MS } from '../skills/incantation/scripts/nudge.mjs';
import { TurnHold } from '../skills/incantation/scripts/turn.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '..', 'skills', 'groundtrack', 'assets');
const SURFACE = 'rgba(250,250,247,0.86)';

const LATIN1 =
  'U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, ' +
  'U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, ' +
  'U+2122, U+2212, U+FB01-FB02';
const PI =
  'U+03C0, U+0E3F, U+2000-200D, U+2010-2012, U+2015, U+2028-2029, U+202F, U+2032-2033, ' +
  'U+203E, U+205F, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, ' +
  'U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, ' +
  'U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+2219-221A, ' +
  'U+221E, U+222B, U+2236, U+2248, U+2260, U+2264-2265, U+2400-2421, U+2500-259F, ' +
  'U+25CA, U+2713, U+274C, U+2B0E-2B11, U+3000, U+FEFF, U+FFFD';
const FACES = [
  ['400', 'IBMPlexMono-Regular-Latin1.woff2', LATIN1],
  ['400', 'IBMPlexMono-Regular-Pi.woff2', PI],
  ['500', 'IBMPlexMono-Medium-Latin1.woff2', LATIN1],
  ['500', 'IBMPlexMono-Medium-Pi.woff2', PI],
  ['600', 'IBMPlexMono-SemiBold-Latin1.woff2', LATIN1],
  ['600', 'IBMPlexMono-SemiBold-Pi.woff2', PI],
];
const facesCss = FACES.map(([weight, file, range]) => {
  const b64 = readFileSync(resolve(ASSETS, file)).toString('base64');
  return `@font-face{font-family:'IBM Plex Mono';font-weight:${weight};unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('');

const sec = ms => {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}.0 s` : `${s} s`;
};
const secShort = ms => `${ms / 1000} s`;
const centerText = (cx, y, text, size, o = {}) => T(cx, y, text, size, { ...o, anchor: 'middle' });

function dimLine(x1, x2, y, label) {
  const mid = (x1 + x2) / 2;
  const halfText = (label.length * 11 * MONO) / 2 + 8;
  const g = [];
  g.push(L(x1, y - 5, x1, y + 5, { stroke: ink(0.55), sw: 1 }));
  g.push(L(x2, y - 5, x2, y + 5, { stroke: ink(0.55), sw: 1 }));
  if (mid - halfText > x1 + 4) {
    g.push(L(x1, y, mid - halfText, y, { stroke: ink(0.45), sw: 1 }));
    g.push(L(mid + halfText, y, x2, y, { stroke: ink(0.45), sw: 1 }));
  }
  g.push(centerText(mid, y + 4, label, 11, { fill: ink(0.75), w: 500 }));
  return g.join('');
}

function spanBracket(x1, x2, y, label, o = {}) {
  const mid = (x1 + x2) / 2;
  const color = o.stroke || ink(0.55);
  const g = [];
  g.push(L(x1, y + 14, x1, y + 8, { stroke: color, sw: 1.2 }));
  g.push(L(x1, y + 8, x2, y + 8, { stroke: color, sw: 1.2 }));
  g.push(L(x2, y + 8, x2, y + 14, { stroke: color, sw: 1.2 }));
  g.push(centerText(mid, y, label, 11, { fill: o.fill || ink(0.8), w: 600, ls: 1.2 }));
  return g.join('');
}

/** Aviation zone border + réseau ground (mirrors docs/brand/cards.mjs & aviation.css). */
function zoneSheet(W, H, title, body) {
  const RULE = 2;
  const BAND = 36;
  const F = { x: RULE + BAND, y: RULE + BAND, w: W - 2 * (RULE + BAND), h: H - 2 * (RULE + BAND) };
  const COLS = 6;
  const ROWS = 4;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWX';

  const zoneLabel = (x, y, t) =>
    `<text x="${x}" y="${y}" font-size="18" letter-spacing="2.88" fill="${ink(0.7)}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const band = [];
  const cw = F.w / COLS;
  const rh = F.h / ROWS;
  for (let i = 0; i < COLS; i++) {
    const cx = Math.round((F.x + cw * (i + 0.5)) * 100) / 100;
    band.push(zoneLabel(cx, RULE + BAND / 2, i + 1), zoneLabel(cx, H - RULE - BAND / 2, i + 1));
    if (i) {
      const dx = Math.round((F.x + cw * i) * 100) / 100;
      band.push(`<path d="M${dx} ${RULE}V${F.y}M${dx} ${F.y + F.h}V${H - RULE}" stroke="${ink(0.3)}" stroke-width="1"/>`);
    }
  }
  for (let i = 0; i < ROWS; i++) {
    const cy = Math.round((F.y + rh * (i + 0.5)) * 100) / 100;
    band.push(zoneLabel(RULE + BAND / 2, cy, LETTERS[i]), zoneLabel(W - RULE - BAND / 2, cy, LETTERS[i]));
    if (i) {
      const dy = Math.round((F.y + rh * i) * 100) / 100;
      band.push(`<path d="M${RULE} ${dy}H${F.x}M${F.x + F.w} ${dy}H${W - RULE}" stroke="${ink(0.3)}" stroke-width="1"/>`);
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<style>${facesCss}text{font-family:'IBM Plex Mono',ui-monospace,monospace}</style>` +
    `<defs><pattern id="reseau" x="${F.x}" y="${F.y}" width="120" height="120" patternUnits="userSpaceOnUse">` +
    `<path d="M54 60.5H67M60.5 54V67" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1" shape-rendering="crispEdges"/>` +
    `</pattern></defs>` +
    R(0, 0, W, H, { fill: PAPER, stroke: null }) +
    `<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" fill="url(#reseau)" stroke="${ink(0.3)}" stroke-width="1"/>` +
    `<rect x="${RULE / 2}" y="${RULE / 2}" width="${W - RULE}" height="${H - RULE}" fill="none" stroke="${INK}" stroke-width="${RULE}"/>` +
    band.join('') +
    body +
    '</svg>\n'
  );
}

export function timelineSheet() {
  const turnDefaults = new TurnHold({ judge: null, release: () => {} });

  const preRollMs = KNOBS.preRollFrames * KNOBS.frameMs;
  const frameMs = KNOBS.frameMs;
  const minVoiceMs = KNOBS.minVoiceMs;
  const softTurnS = KNOBS.softTurnMs / 1000;
  const maxTurnS = KNOBS.maxTurnMs / 1000;
  const silenceDefaultS = 1.5;
  const smartHoldS = turnDefaults.holdMs / 1000;
  const smartJoins = turnDefaults.maxJoins;
  const joinS = sec(KNOBS.joinMs);
  const progressS = KNOBS.progressMs / 1000;
  const nudgeS = EVERY_MS / 1000;
  const bargeMs = KNOBS.bargeMs;
  const bargeGraceS = sec(KNOBS.bargeGraceMs);
  const bargeWarmS = sec(KNOBS.bargeWarmMs);
  const floorS = secShort(KNOBS.floorMs);
  const idleMin = KNOBS.idleMs / 60_000;
  const warmS = KNOBS.warmMs / 1000;

  const W = 1600;
  const H = 1040;
  const g = [];

  // 1. Header & Legend surface panel (y = 58..156)
  g.push(R(64, 58, 1472, 98, { fill: SURFACE, stroke: ink(0.3), sw: 1 }));
  g.push(T(82, 94, 'ONE VOICE TURN — TIMING & MODEL TIMELINE', 26, { w: 600, ls: 1.5 }));
  g.push(T(82, 122, 'FIG. 01 — what runs, when it kicks in, and how long each stage waits.', 13.5, { fill: ink(0.8) }));
  g.push(T(82, 142, 'Audio stays on your CPU; only transcribed text crosses to Claude.', 13.5, { fill: ink(0.7) }));

  const legend = [
    [1040, 74, { fill: PAPER, stroke: INK, sw: 2 }, 'CORE LOCAL ML (CPU)'],
    [1040, 106, { fill: PAPER, stroke: INK, sw: 1.5, dash: '5 3' }, 'OPTIONAL (uv PYTHON)'],
    [1300, 74, { fill: INK, stroke: INK, sw: 1.5 }, 'CLOUD LLM (CLAUDE)'],
    [1300, 106, { fill: PAPER, stroke: INK, sw: 1 }, 'DSP / RULES'],
  ];
  for (const [lx, ly, rectOpts, label] of legend) {
    g.push(R(lx, ly, 24, 16, rectOpts));
    g.push(T(lx + 32, ly + 12, label, 12, { w: 600, ls: 0.8 }));
  }

  // 2. Hero Horizontal Timing Bar surface panel (y = 172..496)
  g.push(R(64, 172, 1472, 324, { fill: SURFACE, stroke: ink(0.3), sw: 1 }));

  const boundaryX = 1080;
  g.push(spanBracket(80, 1070, 196, 'ON YOUR MACHINE (CPU · AUDIO NEVER LEAVES)', { stroke: NORMAL, fill: NORMAL }));
  g.push(spanBracket(1090, 1306, 196, 'CLOUD (TEXT ONLY)', { stroke: CAUTION, fill: CAUTION }));
  g.push(spanBracket(1314, 1520, 196, 'ON YOUR MACHINE (CPU)', { stroke: NORMAL, fill: NORMAL }));

  // Vertical machine-cloud boundary line (caution signal)
  g.push(L(boundaryX, 192, boundaryX, 474, { stroke: CAUTION, sw: 1.5, dash: '5 4' }));

  // Dimension lines above each stage
  const dims = [
    [80, 176, `${secShort(preRollMs)}`],
    [184, 450, `${minVoiceMs} ms min · ${softTurnS}–${maxTurnS} s split`],
    [458, 634, `${silenceDefaultS} s quiet`],
    [642, 854, `+${smartHoldS} s (${smartJoins}x max)`],
    [862, 1070, `on turn · +${joinS}?`],
    [1090, 1306, `prompt · ${progressS} s beat`],
    [1314, 1520, 'per spoken line'],
  ];
  for (const [x1, x2, label] of dims) g.push(dimLine(x1, x2, 230, label));

  const barY = 250;
  const barH = 162;

  // Block 1: Pre-roll
  g.push(R(80, barY, 96, barH, { fill: PAPER, stroke: INK, sw: 1 }));
  g.push(centerText(128, barY + 34, 'PRE-ROLL', 13, { w: 600, ls: 0.6 }));
  g.push(centerText(128, barY + 68, secShort(preRollMs), 15, { w: 600 }));
  g.push(centerText(128, barY + 94, `${KNOBS.preRollFrames} frames`, 11, { fill: ink(0.7) }));
  g.push(centerText(128, barY + 124, 'keeps 1st', 11, { fill: ink(0.8) }));
  g.push(centerText(128, barY + 140, 'word', 11, { fill: ink(0.8) }));

  // Block 2: Live per-frame stack
  g.push(R(184, barY, 266, barH, { fill: PAPER, stroke: INK, sw: 1.5 }));
  g.push(centerText(317, barY + 22, `YOU SPEAK · every ${frameMs} ms`, 12, { w: 600, ls: 0.5 }));

  const strips = [
    [barY + 34, { fill: PAPER, stroke: INK, sw: 1.5, dash: '5 3' }, 'Echo canceller', 'WebRTC AEC3 · uv'],
    [barY + 75, { fill: PAPER, stroke: INK, sw: 2 }, 'Speech detector', 'Silero VAD'],
    [barY + 116, { fill: PAPER, stroke: INK, sw: 1 }, 'Loudness gate', `+${KNOBS.voiceDb} dB over floor`],
  ];
  for (const [sy, rOpts, leftTxt, rightTxt] of strips) {
    g.push(R(194, sy, 246, 36, rOpts));
    g.push(T(202, sy + 22, leftTxt, 11.5, { w: 600 }));
    g.push(T(432, sy + 22, rightTxt, 10.5, { anchor: 'end', fill: ink(0.7) }));
  }

  // Block 3: Wait for silence
  g.push(R(458, barY, 176, barH, { fill: PAPER, stroke: INK, sw: 1 }));
  g.push(centerText(546, barY + 34, 'WAIT FOR SILENCE', 13, { w: 600, ls: 0.5 }));
  g.push(centerText(546, barY + 68, `${silenceDefaultS} s quiet`, 15, { w: 600 }));
  g.push(centerText(546, barY + 94, '(0.3–3.0 s)', 11.5, { fill: ink(0.7) }));
  g.push(centerText(546, barY + 128, 'Assumes you stopped', 11, { fill: ink(0.8) }));

  // Block 4: Finish check (Smart Turn v3.2)
  g.push(R(642, barY, 212, barH, { fill: PAPER, stroke: INK, sw: 1.5, dash: '6 4' }));
  g.push(centerText(748, barY + 34, 'FINISH CHECK', 13.5, { w: 600, ls: 0.6 }));
  g.push(centerText(748, barY + 60, 'Smart Turn v3.2 · uv', 11.5, { fill: ink(0.7) }));
  g.push(centerText(748, barY + 96, 'Unsure you finished?', 12, { w: 500 }));
  g.push(centerText(748, barY + 122, `Waits +${smartHoldS} s (${smartJoins}x max)`, 11.5, { fill: ink(0.8) }));
  g.push(centerText(748, barY + 144, '9 MB local model', 11, { fill: ink(0.7) }));

  // Block 5: Speech to text (Parakeet)
  g.push(R(862, barY, 208, barH, { fill: PAPER, stroke: INK, sw: 2 }));
  g.push(centerText(966, barY + 34, 'SPEECH TO TEXT', 13.5, { w: 600, ls: 0.6 }));
  g.push(centerText(966, barY + 60, 'Parakeet 0.6b · 660 MB', 11, { fill: ink(0.7) }));
  g.push(centerText(966, barY + 96, 'Audio -> words', 12.5, { w: 500 }));
  g.push(centerText(966, barY + 122, '+ echo/filler filter', 11.5, { fill: ink(0.8) }));
  g.push(centerText(966, barY + 144, `splits past ${KNOBS.maxText} chars`, 11, { fill: ink(0.7) }));

  // Block 6: Claude thinks (Cloud)
  g.push(R(1090, barY, 216, barH, { fill: INK, stroke: INK, sw: 2 }));
  g.push(centerText(1198, barY + 34, 'CLAUDE THINKS', 13.5, { w: 600, ls: 0.6, fill: PAPER }));
  g.push(centerText(1198, barY + 60, 'Cloud · text only', 11.5, { fill: PAPER }));
  g.push(centerText(1198, barY + 96, 'Answer or say-back', 12.5, { w: 500, fill: PAPER }));
  g.push(centerText(1198, barY + 122, 'Waits for clear yes', 11.5, { fill: PAPER }));
  g.push(centerText(1198, barY + 144, '[voice] user prompt', 11, { fill: 'rgba(250,250,247,0.8)' }));

  // Block 7: Speak reply (Kokoro / Phonon)
  g.push(R(1314, barY, 206, barH, { fill: PAPER, stroke: INK, sw: 2 }));
  g.push(centerText(1417, barY + 34, 'SPEAK REPLY', 13.5, { w: 600, ls: 0.6 }));
  g.push(centerText(1417, barY + 60, 'Kokoro / Phonon', 11.5, { fill: ink(0.7) }));
  g.push(centerText(1417, barY + 96, 'Words -> voice', 12.5, { w: 500 }));
  g.push(centerText(1417, barY + 122, 'Feeds echo canceller', 11.5, { fill: ink(0.8) }));
  g.push(centerText(1417, barY + 144, '393 MB / 104 MB', 11, { fill: ink(0.7) }));

  // Flow arrows between blocks
  for (const ax of [176, 450, 634, 854, 1306]) {
    g.push(L(ax, barY + barH / 2, ax + 8, barY + barH / 2, { stroke: INK, sw: 1.8 }));
  }
  g.push(`<path d="M1070 ${barY + barH / 2} h18 m-5 -4 l5 4 l-5 4" stroke="${CAUTION}" stroke-width="2" fill="none"/>`);

  // Bottom callouts under Hero Bar
  g.push(L(634, barY + barH, 634, 434, { stroke: INK, sw: 1.2 }));
  g.push(`<circle cx="634" cy="${barY + barH}" r="3" fill="${INK}"/>`);
  g.push(L(634, 434, 618, 434, { stroke: INK, sw: 1.2 }));
  g.push(T(612, 438, 'SPINNER WORD: "One sec." plays right away (cut if echo or filler)', 11, { anchor: 'end', w: 500, fill: ink(0.85) }));

  g.push(L(748, barY + barH, 748, 454, { stroke: ink(0.55), sw: 1.2, dash: '3 3' }));
  g.push(centerText(748, 468, 'Waits longer only; never cuts sooner', 11, { fill: ink(0.8), w: 500 }));

  g.push(L(966, barY + barH, 966, 428, { stroke: INK, sw: 1.2 }));
  g.push(centerText(966, 442, `Holds +${joinS} if no . ? !`, 11, { fill: ink(0.8) }));

  // Boundary pill at x=1080, y=452..474 (caution signal)
  g.push(R(1028, 452, 104, 22, { fill: PAPER, stroke: CAUTION, sw: 1.5 }));
  g.push(centerText(1080, 467, 'TEXT ONLY ->', 11, { fill: CAUTION, w: 600 }));

  g.push(L(1198, barY + barH, 1198, 428, { stroke: INK, sw: 1.2 }));
  g.push(centerText(1198, 442, `${progressS} s progress · ${nudgeS} s OK nudge`, 11, { fill: ink(0.8) }));

  // Return-loop line from Block 7 back toward Echo canceller
  g.push(`<path d="M1417 ${barY + barH} v72 H317 v-64 m-5 7 l5 -7 l5 7" stroke="${ink(0.55)}" stroke-width="1.2" stroke-dasharray="4 3" fill="none"/>`);
  g.push(R(1232, 474, 300, 18, { fill: PAPER, stroke: null }));
  g.push(centerText(1382, 487, 'Speaker output loops to echo canceller', 11, { fill: ink(0.75) }));

  // 3. Parallel / Interrupt Timing Bars surface panel (y = 512..704)
  g.push(R(64, 512, 1472, 192, { fill: SURFACE, stroke: ink(0.3), sw: 1 }));

  // Bar A: Barge-in
  g.push(T(80, 534, 'IF YOU TALK OVER CLAUDE (BARGE-IN)', 12, { w: 600, ls: 1.2, fill: ink(0.85) }));
  const ay = 544;
  const ah = 54;
  g.push(R(80, ay, 310, ah, { fill: PAPER, stroke: INK, sw: 1.5, dash: '5 3' }));
  g.push(centerText(235, ay + 23, `Echo canceller settle · ${bargeGraceS}`, 12.5, { w: 600 }));
  g.push(centerText(235, ay + 42, `${bargeWarmS} once at session start`, 11, { fill: ink(0.7) }));

  g.push(R(398, ay, 330, ah, { fill: PAPER, stroke: CAUTION, sw: 2 }));
  g.push(centerText(563, ay + 23, `${bargeMs} ms of your voice`, 13, { w: 600, fill: CAUTION }));
  g.push(centerText(563, ay + 42, 'louder than speaker echo', 11, { fill: ink(0.8) }));

  g.push(R(736, ay, 784, ah, { fill: PAPER, stroke: INK, sw: 1.5 }));
  g.push(centerText(1128, ay + 23, 'Stops playback at once · drops queued replies', 13, { w: 600 }));
  g.push(centerText(1128, ay + 42, 'Marks turn "interrupted" · starts your new turn', 12, { fill: ink(0.8) }));

  // Bar B: Startup & Idle
  g.push(T(80, 624, 'SESSION STARTUP & IDLE', 12, { w: 600, ls: 1.2, fill: ink(0.85) }));
  const by = 634;
  const bh = 54;
  g.push(R(80, by, 250, bh, { fill: PAPER, stroke: INK, sw: 1 }));
  g.push(centerText(205, by + 23, `${floorS} room noise floor`, 12.5, { w: 600 }));
  g.push(centerText(205, by + 42, 'opens microphone', 11, { fill: ink(0.7) }));

  g.push(R(338, by, 570, bh, { fill: PAPER, stroke: INK, sw: 2 }));
  g.push(centerText(623, by + 23, `Model warm-up (<= ${warmS} s)`, 13, { w: 600 }));
  g.push(centerText(623, by + 42, 'Loads local models · pre-caches 10 spinner words', 11, { fill: ink(0.8) }));

  g.push(R(916, by, 270, bh, { fill: PAPER, stroke: NORMAL, sw: 2 }));
  g.push(centerText(1051, by + 23, 'Claude greets you', 13, { w: 600, fill: NORMAL }));
  g.push(centerText(1051, by + 42, 'ready -> listening', 11, { fill: ink(0.8) }));

  g.push(R(1194, by, 326, bh, { fill: PAPER, stroke: INK, sw: 1 }));
  g.push(centerText(1357, by + 23, `Idle auto-stop · ${idleMin} min`, 13, { w: 600 }));
  g.push(centerText(1357, by + 42, 'Paused while muted, or say "stop"', 11, { fill: ink(0.7) }));

  // 4. Bottom Reference Table + Privacy Box + Title Block surface panel (y = 720..986)
  g.push(R(64, 720, 1472, 266, { fill: SURFACE, stroke: ink(0.3), sw: 1 }));

  const ty = 736;
  const tw = 910;
  g.push(R(80, ty, tw, 32, { fill: PAPER, sw: 2 }));
  g.push(T(94, ty + 21, 'MODELS & STAGES (PLAIN JOB + SEARCHABLE NAME)', 13, { w: 600, ls: 1.3 }));

  const col1 = 80;
  const col2 = 300;
  const col3 = 520;
  const col4 = 720;
  g.push(R(80, ty + 32, tw, 24, { fill: PAPER }));
  g.push(T(col1 + 14, ty + 48, 'PLAIN JOB', 11, { fill: ink(0.7), ls: 1.2 }));
  g.push(T(col2 + 14, ty + 48, 'SEARCHABLE NAME', 11, { fill: ink(0.7), ls: 1.2 }));
  g.push(T(col3 + 14, ty + 48, 'WHEN IT RUNS', 11, { fill: ink(0.7), ls: 1.2 }));
  g.push(T(col4 + 14, ty + 48, 'SIZE & WHERE', 11, { fill: ink(0.7), ls: 1.2 }));

  const rows = [
    ['Echo canceller', 'WebRTC AEC3', `Every ${frameMs} ms`, 'Optional uv (CPU)'],
    ['Speech detector', 'Silero VAD', `Every ${frameMs} ms`, '0.6 MB (CPU)'],
    ['Finish check', 'Smart Turn v3.2', `On ${silenceDefaultS} s silence`, '9 MB · optional uv'],
    ['Speech to text', 'Parakeet TDT 0.6b', 'Once turn settles', '660 MB int8 (CPU)'],
    ['Thinking & acting', 'Claude', 'On [voice] text', 'Cloud (text only)'],
    ['Speak reply', 'Kokoro / Phonon', 'Per spoken line', '393 / 104 MB (CPU)'],
  ];

  let ry = ty + 56;
  for (const [job, name, when, where] of rows) {
    g.push(R(80, ry, tw, 27, { fill: PAPER }));
    g.push(T(col1 + 14, ry + 18, job, 12, { w: 600 }));
    g.push(T(col2 + 14, ry + 18, name, 12));
    g.push(T(col3 + 14, ry + 18, when, 12, { fill: ink(0.8) }));
    g.push(T(col4 + 14, ry + 18, where, 12, { fill: ink(0.75) }));
    ry += 27;
  }
  g.push(L(col2, ty + 32, col2, ry), L(col3, ty + 32, col3, ry), L(col4, ty + 32, col4, ry), R(80, ty, tw, ry - ty, { sw: 2 }));
  g.push(T(80, ry + 20, 'Voicebox option: swaps Parakeet + Kokoro/Phonon for a local HTTP server on 127.0.0.1:17493.', 11.5, { fill: ink(0.75) }));

  // Right column: Privacy boundary box + Grimoire title block
  g.push(R(1016, 736, 504, 84, { fill: PAPER, sw: 2 }));
  g.push(T(1032, 758, 'WHAT LEAVES YOUR MACHINE', 12, { w: 600, ls: 1.4 }));
  g.push(L(1016, 768, 1520, 768));
  g.push(T(1032, 788, 'AUDIO: NEVER', 12, { w: 600, fill: NORMAL }), T(1180, 788, 'Stays on CPU; loopback in RAM only', 12, { fill: ink(0.8) }));
  g.push(T(1032, 808, 'TEXT: ON TURN', 12, { w: 600, fill: CAUTION }), T(1180, 808, 'Transcribed words go to Claude', 12, { fill: ink(0.8) }));

  g.push(titleBlock(1016, 834, 504, {
    kicker: 'INCANTATION',
    subject: 'TURN TIMELINE & MODELS',
    from: 'gate.mjs · turn.mjs · listen.mjs · sherpa.mjs',
    dwg: 'INC-01',
    sheetNo: '1 OF 1',
  }));

  return zoneSheet(W, H, 'Incantation — timing and model timeline', g.join(''));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [dir] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/incantation-sheets.mjs <dir>');
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, 'incantation-timeline.svg');
  writeFileSync(target, timelineSheet());
  console.error(`wrote ${target}`);
}
