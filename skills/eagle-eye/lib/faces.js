/* The faces, exactly as IBM publishes them, and their own unicode ranges.
 *
 * These files are IBM's, byte for byte, and that is the whole point. The
 * licence names "Plex" as a Reserved Font Name, so a font we had cut down
 * ourselves would be a Modified Version and could not keep the name it
 * carries. IBM's own splits are original versions, so the name stands. The
 * design system's own fonts/ directory is a third-party cut and is not used.
 *
 * Latin1 holds the text and Pi holds the arrows and box characters. Two faces
 * per weight, each under the range IBM declares for it. THE RANGE IS NOT
 * OPTIONAL: two @font-face rules for one family, style and weight with no
 * range both default to U+0-10FFFF, so they fully overlap and only the last
 * one — Pi, which has no Latin letters in it — is in force for every
 * character. What a browser does then is not something to rely on. Chromium
 * happens to walk back to the earlier face in the family and renders Plex
 * anyway; that is engine behaviour, not a contract, and assets/FONTS.md
 * states the contract.
 *
 * These replaced a <link> to Google Fonts. A font CDN is a dependency on
 * somebody else's uptime, some hosts will not load one, and a page whose
 * monospace silently degrades is a worse page.
 *
 * WHY THIS IS ITS OWN FILE. render.mjs and scripts/build-pages.mjs both emit
 * these rules, and build-pages.mjs already carries a comment about the last
 * time it kept a private copy of something — the escape, which drifted and
 * rendered a missing value as the string "undefined". A second copy of six
 * lines of hex ranges is the same bargain, so there is one copy and both read
 * it. groundtrack keeps its own, and must: a skill has to stand alone under
 * every install route, which is the whole argument in assets/FONTS.md.
 */
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

/* One @font-face rule per face, with the file already read and base64'd by the
 * caller — this file does no I/O, so it stays usable from anywhere in the tree
 * without knowing where assets/ is. */
function faceRule(weight, range, b64) {
  return `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:block;unicode-range:${range};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}

module.exports = { LATIN1, PI, FACES, faceRule };
