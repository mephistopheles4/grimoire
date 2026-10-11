// The Brigade pane's view module, tested at its own seam: its exports take
// plain values and return what the pane would draw, so these tests check the
// SVG source, its alt text and the terminal's text rows as strings. They do
// not check element trees or paint.
//
// The module is TypeScript. Node imports it as it is from 22.18 on, where
// type stripping is on by default (23.6 on the 23 line). On an older Node the
// import fails with an error about the file's extension, so the version is
// checked first and named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MINIMUM = '22.18';
const [major, minor] = process.versions.node.split('.').map(Number);
const strips = major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
if (!strips) {
  throw new Error(
    `tests/brigade-view.test.mjs needs Node ${MINIMUM} or later, which imports TypeScript as it is; this is Node ${process.versions.node}. See CONTRIBUTING.md.`,
  );
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const view = await import('../brigade/view.ts');
const roster = await import('../brigade/roster.ts');
const { EMPTY_USAGE, LEGEND_MAX, SVG_MAX, limitName, num, resetsIn, snapshotFrom, svgText, tokens, usageView } = view;

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const at = ms => new Date(NOW + ms).toISOString();
const MIN = 60000;
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'];
const IMAGE_SURFACES = ['desktop', 'vscode', 'mobile'];

const LONE = String.fromCharCode(0xd800);
const NONCHAR = String.fromCodePoint(0xffff) + String.fromCodePoint(0xfffe);
// Every hostile shape the SVG text path must hold: markup, an entity, both
// quotes, a closing tag, C0 and C1 controls, bidirectional marks, a zero-width
// joiner, a lone surrogate and two code points XML forbids.
const HOSTILE = `a<b>&amp;"q"'s'</svg><script>x</script>\u{0}\u{7}\u{85}\u{202E}rtl\u{2066}\u{200D}${LONE}${NONCHAR}z`;

const snapshot = (over = {}) => ({
  limits: [
    { kind: 'five_hour', percent: 64, resetsAt: at(125 * MIN) },
    { kind: 'seven_day', percent: 12.5, resetsAt: at(3 * 1440 * MIN + 4 * 60 * MIN) },
  ],
  context: { percent: 23, tokens: 46000, window: 200000 },
  categories: [
    { name: 'System prompt', kind: 'used', tokens: 3100 },
    { name: 'Messages', kind: 'used', tokens: 40000 },
    { name: 'MCP tools (deferred)', kind: 'deferred', tokens: 9000 },
    { name: 'Empty row', kind: 'used', tokens: 0 },
    { name: 'Free space', kind: 'free', tokens: 120000 },
    { name: 'Autocompact buffer', kind: 'buffer', tokens: 36900 },
  ],
  ...over,
});

// Every attribute in the source, as [tag, name, value, tag index]. Outside
// text is escaped, so a `<` in the source opens a real tag and a `"` ends a
// value. A tag whose attributes are not all written name="value" matches no
// tag here, so the openings are counted too, and a tag left unread fails the
// check.
function attributes(source) {
  const out = [];
  let tags = 0;
  for (const tag of source.matchAll(/<([a-zA-Z]+)((?:\s+[^\s=>/]+="[^"]*")*)\s*\/?>/g)) {
    for (const a of tag[2].matchAll(/([^\s=]+)="([^"]*)"/g)) out.push([tag[1], a[1], a[2], tags]);
    tags += 1;
  }
  const openings = source.match(/<[a-zA-Z]+/g)?.length ?? 0;
  assert.equal(tags, openings, 'every tag the source opens is read for its attributes');
  return out;
}

// The allowlist every SVG this module builds is held to: a fixed set of
// attribute names, each with the forms its value may take, and nothing else.
// The classes `done` and `stopped` and the id `st` are admitted for the
// status strip, to-do bar and cache bar still to come, as threat-model row 15
// says; no image builds them yet.
const CLASSES = new Set(['muted', 'track', 'ok', 'warn', 'hot', 'free', 'buffer', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'done', 'stopped']);
const LENGTHS = new Set(['width', 'height', 'x', 'y', 'rx', 'cx', 'cy', 'r']);
const NUMBER = /^\d+(?:\.\d+)?$/;
const PERCENT = /^(\d+(?:\.\d+)?)%$/;
const length = value => NUMBER.test(value) || (PERCENT.test(value) && Number(PERCENT.exec(value)[1]) <= 100);
const allowed = (name, value, index) => {
  if (LENGTHS.has(name)) return length(value);
  if (name === 'class') return CLASSES.has(value);
  if (name === 'id') return value === 'cb' || value === 'st';
  if (name === 'clip-path') return value === 'url(#cb)' || value === 'url(#st)';
  if (name === 'text-anchor') return value === 'end';
  if (name === 'transform') return value === 'translate(-2 0)';
  // Only on the outermost <svg>, which is the source's first tag.
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg' && index === 0;
  return false;
};

function assertAllowlisted(source) {
  assert.match(source, /^<svg /, 'the source opens with the outermost <svg>');
  // Every < opens a tag or a closing tag: no comment, CDATA section,
  // declaration or processing instruction, none of which the checks below read.
  assert.doesNotMatch(source, /<[^a-zA-Z/]|<\/[^a-zA-Z]/, 'every < opens a tag');
  // At most one style block, holding exactly the module's own style text.
  const styles = [...source.matchAll(/<style>(.*?)<\/style>/g)];
  assert.equal(styles.length, source.match(/<style/g)?.length ?? 0, 'every style block is read');
  assert.ok(styles.length <= 1, 'at most one style block');
  for (const s of styles) assert.equal(s[1], view.STYLE, "the style block is the module's own");
  const attrs = attributes(source);
  assert.ok(attrs.length > 0, 'the source has attributes to check');
  for (const [tag, name, value, index] of attrs) {
    assert.ok(allowed(name, value, index), `<${tag} ${name}="${value}"> is not on the attribute allowlist`);
  }
  // Every tag is one the module writes, every <svg> closes, and nothing
  // follows the outermost one's close.
  for (const t of source.matchAll(/<\/?([a-zA-Z]+)/g)) {
    assert.ok(['svg', 'style', 'text', 'rect', 'clipPath', 'g', 'circle'].includes(t[1]), `unexpected tag <${t[1]}>`);
  }
  assert.equal(source.match(/<\/svg>/g)?.length ?? 0, source.match(/<svg[\s>]/g)?.length ?? 0, 'as many </svg> as <svg openings');
  assert.ok(source.endsWith('</svg>'), 'the source ends with </svg>');
  // The outermost <svg> closes last: the depth reaches 0 only at the end.
  let depth = 0;
  for (const m of source.matchAll(/<svg[\s>]|<\/svg>/g)) {
    assert.ok(depth > 0 || m.index === 0, 'nothing follows the outermost </svg>');
    depth += m[0] === '</svg>' ? -1 : 1;
  }
  assert.doesNotMatch(source, /NaN|Infinity/);
}

const svgOf = (s, surface = 'desktop') => {
  const v = usageView(s, surface, NOW);
  assert.equal(v.kind, 'svg', `expected an SVG on ${surface}, got ${v.kind}`);
  return v;
};

// --- the allowlist itself --------------------------------------------------

const OK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><rect class="track" x="0" y="0" width="100%" height="8" rx="4"/></svg>';

test('the attribute allowlist admits each form it lists', () => {
  assertAllowlisted(OK_SVG);
  assertAllowlisted(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><style>${view.STYLE}</style></svg>`);
  assertAllowlisted(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8">' +
      '<clipPath id="st"><rect width="100%" height="8" rx="4"/></clipPath>' +
      '<g clip-path="url(#st)"><svg x="12.5%" width="37.5%" height="8"><rect class="done" width="100%" height="8" transform="translate(-2 0)"/></svg></g>' +
      '<text class="muted" x="100%" y="12" text-anchor="end">a</text><circle class="stopped" cx="4" cy="8" r="4"/></svg>',
  );
});

test('the attribute allowlist refuses each form it leaves out', () => {
  const refused = {
    'an unknown attribute name with a number value': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8" opacity="1"></svg>',
    'a fill attribute': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><rect fill="red" width="1"/></svg>',
    'an event handler': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8" onload="x"></svg>',
    'a viewBox': '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="8" viewBox="0 0 100 8"></svg>',
    'xmlns on a nested svg': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><svg xmlns="http://www.w3.org/2000/svg" width="1"></svg></svg>',
    'another namespace': '<svg xmlns="http://www.w3.org/1999/xhtml" width="100%" height="8"></svg>',
    'a percentage over 100': '<svg xmlns="http://www.w3.org/2000/svg" width="101%" height="8"></svg>',
    'a negative length': '<svg xmlns="http://www.w3.org/2000/svg" width="-1" height="8"></svg>',
    'a length with a unit': '<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="8"></svg>',
    'an id outside the set': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><clipPath id="bar"><rect width="1"/></clipPath></svg>',
    'a clip-path outside the set': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><g clip-path="url(#bar)"></g></svg>',
    'a class outside the set': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><rect class="x" width="1"/></svg>',
    'another transform': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><rect width="1" transform="scale(2)"/></svg>',
    'another text-anchor': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><text x="0" text-anchor="middle">a</text></svg>',
    'text after the close': `${OK_SVG}x`,
    'a tag after the close': `${OK_SVG}<svg width="1"></svg>`,
    'an <svg> left open': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><svg width="1"></svg>',
    'a tag outside the set': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><image width="1"/></svg>',
    'a tag whose attributes cannot be read': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><rect width=1/></svg>',
    'a comment': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><!-- x --></svg>',
    'a CDATA section': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><text x="0"><![CDATA[x]]></text></svg>',
    'a declaration': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><!ENTITY x "y"></svg>',
    'a processing instruction': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><?x y?></svg>',
    'a style block with other text': '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><style>@import url(x);</style></svg>',
    'two style blocks': `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="8"><style>${view.STYLE}</style><style>${view.STYLE}</style></svg>`,
  };
  for (const [name, source] of Object.entries(refused)) {
    assert.throws(() => assertAllowlisted(source), assert.AssertionError, name);
  }
});

// --- the import seam -------------------------------------------------------

test('the view module and the roster module import under node --test', () => {
  assert.equal(typeof usageView, 'function');
  assert.equal(typeof roster.oneLine, 'function');
});

// --- the usage view on each surface ----------------------------------------

test('a non-terminal surface gets an SVG: a bar per rate limit, "Resets in ... · NN%", a segmented context bar and a legend', () => {
  for (const surface of IMAGE_SURFACES) {
    const v = svgOf(snapshot(), surface);
    assert.match(v.source, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
    assert.ok(v.source.includes('>Current session</text>'));
    assert.ok(v.source.includes('>Weekly limit</text>'));
    assert.ok(v.source.includes('>Resets in 2 hr 5 min · 64%</text>'));
    assert.ok(v.source.includes('>Resets in 3 d 4 hr · 13%</text>'));
    // One track per rate-limit bar, then the context track, each full width.
    assert.equal(v.source.match(/<rect class="track" x="0" y="[\d.]+" width="100%"/g).length, 3);
    // A fill in percentages over a fixed 6 px stub, so a small one stays seen.
    assert.match(v.source, /<rect class="ok" x="0" y="20" width="6" height="6" rx="3"\/><rect class="ok" x="0" y="20" width="64%" height="6" rx="3"\/>/);
    assert.match(v.source, /<rect class="ok" x="0" y="58" width="6" height="6" rx="3"\/><rect class="ok" x="0" y="58" width="12.5%" height="6" rx="3"\/>/);
    // Right-aligned text sits at 100% of the image or of its legend column;
    // left-aligned text at 0, or a fixed step past a legend dot.
    const anchored = [...v.source.matchAll(/<text [^>]*text-anchor="end"[^>]*>/g)].map(m => m[0]);
    assert.equal(anchored.length, 7);
    for (const t of anchored) assert.match(t, / x="100%" /);
    for (const t of v.source.matchAll(/<text (?:class="muted" )?x="([^"]+)"/g)) assert.ok(['0', '100%', '14', '24'].includes(t[1]), `text at ${t[1]}`);
    // The context bar: four segments (deferred and empty rows left out),
    // clipped to the rounded track.
    const bar = v.source.match(/<g clip-path="url\(#cb\)">(.*?)<\/g>/)[1];
    assert.equal(bar.match(/<rect /g).length, 4);
    assert.match(bar, /class="c0".*class="c1".*class="free".*class="buffer"/);
    // Each used segment sits in a nested <svg> placed in percentages, its
    // rect moved 2 px left, so the nested <svg> cuts a gap that survives the
    // stretch; free space and buffer are plain rects, with no gap.
    assert.equal([...bar.matchAll(/<svg x="[\d.]+%" y="[\d.]+" width="[\d.]+%" height="8"><rect class="c\d" width="100%" height="8" transform="translate\(-2 0\)"\/><\/svg>/g)].length, 2);
    assert.match(bar, /<rect class="free" x="[\d.]+%" y="[\d.]+" width="[\d.]+%" height="8"\/>/);
    // The legend: dot, name and tokens per drawn row, in two columns, each a
    // nested <svg> half the image wide.
    assert.equal(v.source.match(/<circle /g).length, 4);
    for (const name of ['System prompt', 'Messages', 'Free space', 'Autocompact buffer']) assert.ok(v.source.includes(`>${name}</text>`));
    assert.deepEqual([...new Set([...v.source.matchAll(/<svg x="([^"]+)" y="[\d.]+" width="50%" height="18">/g)].map(m => m[1]))], ['0', '50%'], 'two columns');
    assert.ok(!v.source.includes('deferred'));
    assert.ok(!v.source.includes('Empty row'));
    assert.ok(v.source.includes('>3.1k</text>') && v.source.includes('>40k</text>'));
    // Full width: placed in percentages, with no viewBox and no width to pass.
    assert.match(v.source, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100%" height="\d+">/);
    assert.ok(!v.source.includes('viewBox'));
    assert.ok(!('width' in v), 'the view carries no width');
    assert.ok(Number.isFinite(v.height) && v.height > 0);
    assert.ok(v.source.includes(`height="${v.height}"`));
    assertAllowlisted(v.source);
  }
});

test('the alt text names each bar and its percentage', () => {
  const { alt } = svgOf(snapshot());
  assert.match(alt, /Current session 64%/);
  assert.match(alt, /Weekly limit 13%/);
  assert.match(alt, /Context 23%: System prompt 3\.1k, Messages 40k, Free space 120k, Autocompact buffer 37k/);
});

test('a bar is amber from 75% and red from 90%', () => {
  const cls = p => {
    const v = svgOf(snapshot({ limits: [{ kind: 'five_hour', percent: p }], categories: undefined }));
    return v.source.match(/<rect class="(ok|warn|hot)"/)?.[1];
  };
  assert.equal(cls(74.9), 'ok');
  assert.equal(cls(75), 'warn');
  assert.equal(cls(89.9), 'warn');
  assert.equal(cls(90), 'hot');
  assert.equal(cls(0), undefined, 'an empty window draws its track only');
  const tone = p => usageView({ limits: [{ kind: 'five_hour', percent: p }], context: {} }, 'terminal', NOW).rows[0].tone;
  assert.deepEqual([tone(10), tone(75), tone(90)], ['success', 'warning', 'error']);
});

test('the terminal gets text rows, never SVG: a Context row, then a row per rate limit', () => {
  const v = usageView(snapshot(), 'terminal', NOW);
  assert.equal(v.kind, 'text');
  assert.ok(!JSON.stringify(v).includes('<svg'));
  assert.deepEqual(
    v.rows.map(r => [r.name.trim(), r.percent, r.note]),
    [
      ['Context', '23%', '46k of 200k'],
      ['Current session', '64%', 'Resets in 2 hr 5 min'],
      ['Weekly limit', '13%', 'Resets in 3 d 4 hr'],
    ],
  );
  // Names are padded to one width, so the bars line up.
  assert.equal(new Set(v.rows.map(r => r.name.length)).size, 1);
  // 23% of 20 cells is 4.6 cells: four full and one at five eighths, then
  // blanks to make 20. The dim end marks are the render's, not the bar's.
  assert.equal(v.rows[0].bar, `████▋${' '.repeat(15)}`);
  for (const r of v.rows) assert.equal([...r.bar].length, 20);
});

test('with no rate limits and no breakdown the view is "nothing yet" on every surface', () => {
  for (const surface of SURFACES) {
    assert.deepEqual(usageView(EMPTY_USAGE, surface, NOW), { kind: 'none' });
    assert.deepEqual(usageView({ limits: [], context: {}, categories: [] }, surface, NOW), { kind: 'none' });

    // A breakdown of deferred and empty rows only draws nothing.
    const bare = { limits: [], context: {}, categories: [{ name: 'x', kind: 'deferred', tokens: 5 }, { name: 'y', kind: 'used', tokens: 0 }] };
    assert.deepEqual(usageView(bare, surface, NOW), { kind: 'none' });
  }
});

test('the view never throws on a reading of the wrong shape', () => {
  for (const reading of [undefined, null, 0, 'x', [], {}, { rateLimits: 'x', context: 5 }, { rateLimits: [null, 1, {}], context: { breakdown: { categories: 'x' } } }]) {
    const s = snapshotFrom(reading);
    for (const surface of SURFACES) assert.deepEqual(usageView(s, surface, NOW), { kind: 'none' });
  }
});

// --- "Resets in" -----------------------------------------------------------

test('"Resets in" reads minutes, hours and minutes, or days and hours', () => {
  assert.equal(resetsIn(at(7 * MIN), NOW), 'Resets in 7 min');
  assert.equal(resetsIn(at(59 * MIN), NOW), 'Resets in 59 min');
  assert.equal(resetsIn(at(60 * MIN), NOW), 'Resets in 1 hr 0 min');
  assert.equal(resetsIn(at(125 * MIN), NOW), 'Resets in 2 hr 5 min');
  assert.equal(resetsIn(at(1440 * MIN), NOW), 'Resets in 1 d 0 hr');
  assert.equal(resetsIn(at((2 * 1440 + 3 * 60 + 59) * MIN), NOW), 'Resets in 2 d 3 hr');
});

test('"Resets in" reads a past time as 0 min, and a missing or invalid time as nothing', () => {
  assert.equal(resetsIn(at(-90 * MIN), NOW), 'Resets in 0 min');
  assert.equal(resetsIn(at(0), NOW), 'Resets in 0 min');
  assert.equal(resetsIn(undefined, NOW), undefined);
  for (const bad of ['', 'soon', '2026-10-06', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', '2026-10-06T25:00:00Z', '2026-10-06T12:00:00', 'NaN', '2026-10-06T12:00:00Zjunk']) {
    assert.equal(resetsIn(bad, NOW), undefined, bad);
  }
  // An offset and a long fraction read as the same moment.
  assert.equal(resetsIn('2026-10-06T14:05:00+02:00', NOW), 'Resets in 5 min');
  assert.equal(resetsIn('2026-10-06T12:05:00.123456Z', NOW), 'Resets in 5 min');
  // The SVG and the text rows then show no reset, only the percent.
  const s = { limits: [{ kind: 'five_hour', percent: 10, resetsAt: 'soon' }], context: {} };
  assert.ok(svgOf(s).source.includes('>10%</text>'));
  assert.equal(usageView(s, 'terminal', NOW).rows[0].note, '');
});

// --- the SVG text path -----------------------------------------------------

test('outside text in the SVG is cleaned, stripped of XML-invalid code points, then escaped', () => {
  const s = snapshot({
    limits: [{ kind: HOSTILE, percent: 50, resetsAt: at(5 * MIN) }, { kind: HOSTILE, percent: 20, resetsAt: HOSTILE }],
    categories: [{ name: HOSTILE, kind: 'used', tokens: 1000 }, { name: HOSTILE, kind: 'free', tokens: 500 }],
  });
  for (const surface of IMAGE_SURFACES) {
    const v = svgOf(s, surface);
    assert.ok(!v.source.includes('<script'));
    assert.ok(!v.source.includes('<b>'));
    assert.ok(!v.source.includes(LONE));
    assert.ok(!/[\u{0}-\u{1F}\u{7F}-\u{9F}\u{202E}\u{2066}\u{200D}\u{FFFE}\u{FFFF}]/u.test(v.source));
    // The rate-limit kind is cut to 30 characters, the category name to 60,
    // each after cleaning and before escaping.
    const expectKind = svgText(HOSTILE, 30);
    const expectName = svgText(HOSTILE, 60);
    assert.ok(v.source.includes(`>${expectKind}</text>`), 'the kind is drawn as escaped text');
    assert.ok(v.source.includes(`>${expectName}</text>`), 'the category name is drawn as escaped text');
    assert.ok(expectName.includes('a&lt;b&gt;&amp;amp;&quot;q&quot;&#39;s&#39;&lt;/svg&gt;&lt;script&gt;'));
    assertAllowlisted(v.source);
    // The alt text is cleaned to one line too.
    assert.ok(!/[\u{0}-\u{1F}\u{202E}\u{2066}\u{200D}]/u.test(v.alt));
  }
});

test('svgText applies the one-line cleaner first, then removes XML-invalid code points, then escapes', () => {
  assert.equal(svgText('x\u{7}y', 10), 'x y');
  assert.equal(svgText(`a${LONE}b${NONCHAR}c`, 10), 'abc');
  assert.equal(svgText(`&<>"'`, 10), '&amp;&lt;&gt;&quot;&#39;');
  // Cut before escaping: the cut counts characters, not entities.
  assert.equal(svgText('<<<<<', 3), '&lt;&lt;…');
  assert.equal(svgText('a\u{202E}b\u{200F}c', 10), roster.oneLine('a\u{202E}b\u{200F}c', 10));
});

test('a NaN or infinite number never reaches an attribute', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const s = {
      limits: [{ kind: 'five_hour', percent: bad }, { kind: 'seven_day', percent: 50 }],
      context: { percent: bad, tokens: bad, window: bad },
      categories: [{ name: 'a', kind: 'used', tokens: bad }, { name: 'b', kind: 'used', tokens: 10 }, { name: 'c', kind: 'free', tokens: 1e300 }],
    };
    for (const surface of SURFACES) {
      const v = usageView(s, surface, bad);
      assert.doesNotMatch(JSON.stringify(v), /NaN|Infinity/);
      if (v.kind === 'svg') assertAllowlisted(v.source);
    }
  }
  assert.equal(num(NaN), '0');
  assert.equal(num(Infinity), '0');
  assert.equal(num(-5), '0');
  assert.equal(num(1e300), '100000');
  assert.equal(num(1 / 3), '0.33');
});

test('pct is num up to 100, then %', () => {
  const { pct } = view;
  assert.deepEqual([NaN, Infinity, -Infinity, -1, 0, 12.345, 100, 150, 1e300].map(pct), ['0%', '0%', '0%', '0%', '0%', '12.35%', '100%', '100%', '100%']);
});

test('the eighth-block bar: full cells, one partial cell, then blanks, always exactly its cell count', () => {
  const { eighthBar } = view;
  assert.equal(eighthBar(0, 20), ' '.repeat(20));
  assert.equal(eighthBar(1, 20), '█'.repeat(20));
  assert.equal(eighthBar(0.5, 16), `${'█'.repeat(8)}${' '.repeat(8)}`);
  // Rounded to the nearest eighth of a cell: 1/160 of 20 cells is one eighth.
  assert.equal(eighthBar(1 / 160, 20), `▏${' '.repeat(19)}`);
  assert.equal(eighthBar(7 / 160, 20), `▉${' '.repeat(19)}`);
  assert.equal(eighthBar(0.4 / 160, 20), ' '.repeat(20));
  const partials = [...'▏▎▍▌▋▊▉'];
  for (let k = 1; k <= 7; k++) assert.equal(eighthBar((8 + k) / 256, 32), `█${partials[k - 1]}${' '.repeat(30)}`);
  // Clamped to between 0 and 1, a number that is not finite read as 0; it
  // never throws and always returns its cell count, counted by code points.
  for (const cells of [16, 20, 32]) {
    for (const bad of [NaN, Infinity, -Infinity, -0.5, -1e300, 1.5, 1e300, Number.MIN_VALUE, 1 - Number.EPSILON]) {
      const bar = eighthBar(bad, cells);
      assert.equal([...bar].length, cells, `${bad} over ${cells}`);
      assert.match(bar, /^█*[▏▎▍▌▋▊▉]? *$/u);
    }
    assert.equal(eighthBar(Infinity, cells), ' '.repeat(cells), 'Infinity is not a number to draw: empty');
    assert.equal(eighthBar(1.5, cells), '█'.repeat(cells));
    assert.equal(eighthBar(-0.5, cells), ' '.repeat(cells));
  }
});

test('the terminal usage rows clamp too: a percent past 100 is a full bar, and every bar is 20 cells', () => {
  const s = { limits: [{ kind: 'five_hour', percent: 100000 }, { kind: 'seven_day', percent: 0 }], context: { percent: 250, tokens: 1, window: 1 } };
  const v = usageView(s, 'terminal', NOW);
  assert.deepEqual(v.rows.map(r => r.bar), ['█'.repeat(20), '█'.repeat(20), ' '.repeat(20)]);
});

test('the legend holds at most 12 categories', () => {
  const categories = Array.from({ length: 30 }, (_, i) => ({ name: `row ${i}`, kind: 'used', tokens: 100 + i }));
  const v = svgOf({ limits: [], context: {}, categories });
  assert.equal(LEGEND_MAX, 12);
  assert.equal(v.source.match(/<circle /g).length, 12);
  assert.ok(v.source.includes('>row 11</text>') && !v.source.includes('>row 12</text>'));
  assertAllowlisted(v.source);
});

test('an SVG over 131,072 characters falls back to the text bars', () => {
  assert.equal(SVG_MAX, 131072);
  const limits = Array.from({ length: 20 }, (_, i) => ({ kind: `k${'<'.repeat(28)}${i}`, percent: 50, resetsAt: at(i * MIN) }));
  const s = { limits, context: {} };
  const size = usageView(s, 'desktop', NOW).source.length;
  // The default cap is the engine's: at that cap this snapshot is an image.
  assert.equal(usageView(s, 'desktop', NOW, SVG_MAX).kind, 'svg');
  // One character under its size, it falls back on every image surface.
  for (const surface of IMAGE_SURFACES) {
    const v = usageView(s, surface, NOW, size - 1);
    assert.equal(v.kind, 'text', `${surface} falls back`);
    assert.equal(v.rows.length, 20);
  }
  assert.equal(usageView(s, 'desktop', NOW, size).kind, 'svg');
  // The stored caps keep the largest snapshot far below the engine's cap.
  const largest = {
    limits: Array.from({ length: 30 }, (_, i) => ({ kind: `${'<'.repeat(200)}`, percent: 99, resetsAt: at(i * MIN) })),
    context: { percent: 99, tokens: 1e10, window: 1e10 },
    categories: Array.from({ length: 60 }, () => ({ name: '&'.repeat(200), kind: 'used', tokens: 1e10 })),
  };
  assert.ok(usageView(largest, 'desktop', NOW).source.length < SVG_MAX / 4);
});
// --- rate-limit names ------------------------------------------------------

test('rate-limit kinds that name a prototype member draw as text on every surface', () => {
  for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(limitName(kind), kind);
    const s = { limits: [{ kind, percent: 42, resetsAt: at(3 * MIN) }], context: {} };
    const t = usageView(s, 'terminal', NOW);
    assert.equal(t.kind, 'text');
    assert.equal(t.rows[0].name, kind);
    for (const surface of IMAGE_SURFACES) {
      const v = svgOf(s, surface);
      assert.ok(v.source.includes(`>${kind}</text>`), `${kind} on ${surface}`);
      assert.match(v.alt, new RegExp(`${kind} 42%`));
    }
  }
  assert.equal(limitName('five_hour'), 'Current session');
  assert.equal(limitName('seven_day'), 'Weekly limit');
  assert.equal(limitName('spend_limit'), 'Spend limit');
  assert.equal(limitName('x'.repeat(40)), `${'x'.repeat(29)}…`);
});

// --- what is fetched and stored --------------------------------------------

// A usage call that asks for the token-count API's breakdown names the
// other detail word as a string. Any quote style counts.
const FULL = /(['"`])full\1/;

test('the matcher for the costly breakdown catches every string form', () => {
  for (const sample of [`{ breakdown: 'full' }`, `{ breakdown: "full" }`, 'x = `full`']) assert.match(sample, FULL, sample);
  for (const sample of [`'summary'`, 'a full path', `'fully'`]) assert.doesNotMatch(sample, FULL, sample);
});

test('the view and register modules never ask for the costly breakdown', () => {
  for (const file of ['brigade/view.ts', 'brigade/register.tsx']) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(text, FULL, `${file} names the costly breakdown`);
  }
  // The one breakdown the register module asks for is the local summary.
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  const asks = [...register.matchAll(/breakdown:\s*([^\s,}]+)/g)].map(m => m[1]);
  assert.deepEqual(asks, [`'summary'`]);
});

test('the stored snapshot holds only the fields the view draws', () => {
  const reading = {
    startedAt: 1,
    cost: { usd: 3.5 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 64, resetsAt: at(5 * MIN), extra: 'x' },
      { kind: 'seven_day', percentUsed: 12 },
      { kind: 'bad', percentUsed: -1 },
      { kind: 'bad', percentUsed: NaN },
      { kind: 5, percentUsed: 1 },
    ],
    context: {
      tokens: 46000,
      window: 200000,
      percent: 23,
      breakdown: {
        totalTokens: 46000,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 23,
        model: 'some-model',
        memoryFiles: [{ path: 'C:\\Users\\someone\\secret\\CLAUDE.md', tokens: 10 }],
        mcpTools: [{ name: 'tool', serverName: 'server', tokens: 5 }],
        agents: [],
        gridRows: [[{ color: 'x', isFilled: true, categoryName: 'Messages' }]],
        apiUsage: { input_tokens: 1 },
        categories: [
          { name: 'Messages', tokens: 40000, color: 'promptBorder', isDeferred: false, kind: 'used' },
          { name: 'Free space', tokens: 120000, color: 'inactive', isDeferred: false, kind: 'free' },
          { name: 'Odd', tokens: 1, color: 'x', isDeferred: false, kind: 'other' },
          { name: 'Negative', tokens: -3, color: 'x', isDeferred: false, kind: 'used' },
        ],
      },
    },
  };
  const s = snapshotFrom(reading);
  assert.deepEqual(s, {
    limits: [
      { kind: 'five_hour', percent: 64, resetsAt: at(5 * MIN) },
      { kind: 'seven_day', percent: 12 },
    ],
    context: { percent: 23, tokens: 46000, window: 200000 },
    categories: [
      { name: 'Messages', kind: 'used', tokens: 40000 },
      { name: 'Free space', kind: 'free', tokens: 120000 },
    ],
  });
  assert.ok(!JSON.stringify(s).includes('secret'));
  // With no breakdown in the reading, no categories are stored.
  assert.equal(snapshotFrom({ rateLimits: [], context: { window: 1 } }).categories, undefined);
});

test('a stored snapshot is bounded: 20 limits, 50 categories, 200 characters a text', () => {
  const s = snapshotFrom({
    rateLimits: Array.from({ length: 30 }, (_, i) => ({ kind: `k${i}`, percentUsed: 1 })).concat([{ kind: 'x'.repeat(201), percentUsed: 1 }]),
    context: { breakdown: { categories: Array.from({ length: 60 }, (_, i) => ({ name: `n${i}`, kind: 'used', tokens: 1 })) } },
  });
  assert.equal(s.limits.length, 20);
  assert.equal(s.categories.length, 50);
  assert.equal(snapshotFrom({ rateLimits: [{ kind: 'x'.repeat(201), percentUsed: 1 }] }).limits.length, 0);
  assert.equal(snapshotFrom({ rateLimits: [{ kind: 'k', percentUsed: 1, resetsAt: 'x'.repeat(41) }] }).limits[0].resetsAt, undefined);
});

// --- token counts ----------------------------------------------------------

test('token counts read "Nk" from 10,000, "N.Nk" from 1,000, and "N" below', () => {
  assert.deepEqual([0, 999, 1000, 1049, 9999, 10000, 46000, 123456].map(tokens), ['0', '999', '1.0k', '1.0k', '9.9k', '10k', '46k', '123k']);
  assert.equal(tokens(NaN), '0');
  assert.equal(tokens(-1), '0');
});

// --- after move 4's review -------------------------------------------------

test('a context reading with no rate limit shows a Context row, on the terminal and as text on every other surface', () => {
  const s = { limits: [], context: { percent: 40, tokens: 80000, window: 200000 } };
  for (const surface of SURFACES) {
    const v = usageView(s, surface, NOW);
    assert.equal(v.kind, 'text', surface);
    assert.deepEqual(v.rows.map(r => [r.name, r.percent, r.note]), [['Context', '40%', '80k of 200k']]);
  }
});

test('the image and the terminal show one context figure for one reading', () => {
  const s = snapshot();
  const image = svgOf(s);
  const row = usageView(s, 'terminal', NOW).rows[0];
  assert.ok(image.source.includes('>46k / 200k · 23%</text>'));
  assert.deepEqual([row.percent, row.note], ['23%', '46k of 200k']);
  // Without the engine's reading, the figures are summed from the rows.
  const summed = svgOf(snapshot({ context: {} }));
  assert.ok(summed.source.includes('>43k / 200k · 22%</text>'));
  assert.match(summed.alt, /Context 22%/);
});

test('a stored snapshot of the wrong shape is checked again: the view never throws and every attribute stays on the allowlist', () => {
  const stored = [
    undefined,
    null,
    'x',
    { limits: 'x', context: null },
    { context: { percent: 'x' } },
    { limits: [{ kind: 5, percent: 1 }, { kind: 'ok', percent: 'x' }, null], context: {} },
    { limits: [], context: {}, categories: [{ name: null, kind: 'used', tokens: 5 }, { name: 'odd', kind: 'other', tokens: 5 }, { name: 'n', kind: 7, tokens: 5 }] },
    { limits: Array.from({ length: 500 }, () => ({ kind: 'k', percent: 1 })), context: {} },
    { limits: [{ kind: 'five_hour', percent: 10 }], context: {}, categories: [{ name: 'a', kind: 'used', tokens: 5 }, { name: 'odd', kind: 'other', tokens: 5 }] },
  ];
  for (const s of stored) {
    for (const surface of SURFACES) {
      const v = usageView(s, surface, NOW);
      if (v.kind === 'svg') {
        assertAllowlisted(v.source);
        assert.ok(!v.source.includes('odd'));
      }
      if (v.kind === 'text') assert.ok(v.rows.length <= 21, 'the stored caps hold on the way out too');
    }
  }
  assert.deepEqual(usageView({ limits: [{ kind: 'k', percent: 'x' }], context: {} }, 'desktop', NOW), { kind: 'none' });
});

// --- tick and undo ---------------------------------------------------------

const { GRACE_MS, settleTicks, sweepTicks, ticksFrom, toggleTick, waitingCount } = view;
const tick = (name, ms) => ({ name, value: String(NOW + ms) });

test('the grace period is 30 seconds', () => {
  assert.equal(GRACE_MS, 30000);
});

test('a press ticks a to-do with its time, and a second press undoes it', () => {
  const once = toggleTick([], 'a', NOW);
  assert.deepEqual(once, [{ name: 'a', value: String(NOW) }]);
  const twice = toggleTick(once, 'a', NOW + 5000);
  assert.deepEqual(twice, []);
  // Another to-do's tick is left as it was.
  assert.deepEqual(toggleTick([tick('b', 0)], 'a', NOW), [tick('b', 0), { name: 'a', value: String(NOW) }]);
  assert.deepEqual(toggleTick([tick('b', 0), tick('a', 0)], 'a', NOW), [tick('b', 0)]);
});

test('a sweep keeps a tick under 30 s and moves one at 30 s or more to done', () => {
  const ticking = [tick('young', 0), tick('edge', 0), tick('old', 0)];
  const at = (name, ms) => sweepTicks([tick(name, 0)], NOW + ms, [name]);
  assert.deepEqual(at('young', 29900), { ticking: [tick('young', 0)], done: [] });
  assert.deepEqual(at('edge', 30000), { ticking: [], done: ['edge'] });
  assert.deepEqual(at('old', 600000), { ticking: [], done: ['old'] });
  const mixed = sweepTicks([tick('young', 1000), tick('old', 0)], NOW + 30500, ['young', 'old']);
  assert.deepEqual(mixed, { ticking: [tick('young', 1000)], done: ['old'] });
  assert.equal(ticking.length, 3, 'the sweep does not change its input');
});

test('a tick whose value is not a finite number is due at the next sweep', () => {
  for (const value of ['x', '', 'NaN', 'Infinity', '1e400', undefined, null, 5, {}]) {
    const r = sweepTicks([{ name: 'a', value }], NOW, ['a']);
    assert.deepEqual(r, { ticking: [], done: ['a'] }, String(value));
  }
});

test('a tick dated more than the grace period ahead of the clock is due, so it cannot stay forever', () => {
  assert.deepEqual(sweepTicks([tick('a', 31000)], NOW, ['a']), { ticking: [], done: ['a'] });
  // A clock that stepped back a little keeps the tick.
  assert.deepEqual(sweepTicks([tick('a', 2000)], NOW, ['a']), { ticking: [tick('a', 2000)], done: [] });
});

test('a tick whose to-do left the roster is dropped, not moved to done', () => {
  assert.deepEqual(sweepTicks([tick('gone', 0), tick('kept', 0)], NOW + 1000, ['kept']), { ticking: [tick('kept', 0)], done: [] });
  assert.deepEqual(sweepTicks([tick('gone', 0)], NOW + 60000, []), { ticking: [], done: [] });
});

test('a sweep after a failed or missing roster load keeps every tick, due ones included', () => {
  const ticking = [tick('a', 0), tick('b', -60000)];
  assert.deepEqual(sweepTicks(ticking, NOW + 1000, undefined), { ticking, done: [] });
});

test('stored ticks of the wrong shape are checked: names must be text, repeats and extras go', () => {
  for (const stored of [undefined, null, 'x', 5, {}, { length: 2 }]) assert.deepEqual(ticksFrom(stored), [], String(stored));
  assert.deepEqual(ticksFrom([null, 'a', { name: 5, value: '1' }, { name: '', value: '1' }, { value: '1' }, tick('a', 0), tick('a', 5)]), [tick('a', 0)]);
  // A value that is not text is kept as an empty value, which is due.
  assert.deepEqual(ticksFrom([{ name: 'a', value: 7 }]), [{ name: 'a', value: '' }]);
  assert.equal(ticksFrom(Array.from({ length: 80 }, (_, i) => tick(`t${i}`, 0))).length, 50);
  assert.equal(ticksFrom([{ name: 'x'.repeat(201), value: '1' }]).length, 0);
  // `constructor` is a name like any other.
  assert.deepEqual(sweepTicks([tick('constructor', 0)], NOW + 30000, ['constructor']), { ticking: [], done: ['constructor'] });
  assert.deepEqual(toggleTick('not a list', '__proto__', NOW), [{ name: '__proto__', value: String(NOW) }]);
});

// A store whose update reads, applies the function and writes only if nothing
// wrote in between, trying again on a miss, as the engine's `update` does.
function store(initial) {
  let value = initial;
  let version = 0;
  const calls = [];
  return {
    get: () => value,
    set: v => {
      value = v;
      version += 1;
    },
    calls,
    // `between` runs after the read and before the write, once, to stand in
    // for a press that lands while the sweep is working.
    update(between) {
      return async fn => {
        for (;;) {
          const seen = version;
          const next = fn(value);
          calls.push(next);
          if (between !== undefined) {
            const run = between;
            between = undefined;
            run();
          }
          if (version === seen) {
            value = next;
            version += 1;
            return next;
          }
        }
      };
    },
  };
}

test('the sweep works out its due ids inside the ticking update, so an undo that lands mid-sweep is not moved to done', async () => {
  const ticking = store([tick('a', 0)]);
  const done = store([]);
  // The press's undo lands after the sweep's first read: the write misses, the
  // update runs the function again on the fresh state, and nothing is due.
  const undo = () => ticking.set(toggleTick(ticking.get(), 'a', NOW + 30000));
  const moved = await settleTicks(ticking.update(undo), done.update(), NOW + 30000, ['a']);
  assert.equal(ticking.calls.length, 2, 'the first write missed and the function ran again');
  assert.deepEqual(moved, []);
  assert.deepEqual(done.get(), []);
  assert.deepEqual(ticking.get(), []);
});

test('a sweep moves its due ids to done once, however often its update runs', async () => {
  const ticking = store([tick('a', 0), tick('b', 20000)]);
  const done = store(['a']);
  const other = () => ticking.set([...ticking.get()]);
  const moved = await settleTicks(ticking.update(other), done.update(), NOW + 30000, ['a', 'b']);
  assert.deepEqual(moved, ['a']);
  assert.deepEqual(done.get(), ['a'], 'an id already done is not added again');
  assert.deepEqual(ticking.get(), [tick('b', 20000)]);
  const later = await settleTicks(ticking.update(), done.update(), NOW + 50000, ['a', 'b']);
  assert.deepEqual(later, ['b']);
  assert.deepEqual(done.get(), ['a', 'b']);
});

test('a sweep after a failed or missing roster load writes nothing', async () => {
  const ticking = store([tick('a', 0)]);
  const done = store([]);
  assert.deepEqual(await settleTicks(ticking.update(), done.update(), NOW + 60000, undefined), []);
  assert.equal(ticking.calls.length, 0);
  assert.equal(done.calls.length, 0);
  assert.deepEqual(ticking.get(), [tick('a', 0)]);
});

test('the "Waiting on you" count leaves out ticking and done to-dos', () => {
  const todos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.equal(waitingCount(2, todos, [], []), 6);
  assert.equal(waitingCount(2, todos, ['a'], [tick('b', 0)]), 4);
  assert.equal(waitingCount(0, todos, ['a', 'b'], [tick('c', 0), tick('d', 0)]), 0);
  // Stored values of the wrong shape count nothing out, and never throw.
  assert.equal(waitingCount(1, todos, 'x', { name: 'a' }), 5);
});

test('the stored done list is checked: only text entries of a list count, and no shape throws', async () => {
  const { idsFrom } = view;
  for (const stored of [undefined, null, 'ab', 5, {}, { length: 2 }, { 0: 'a', length: 1 }]) assert.deepEqual(idsFrom(stored), [], String(stored));
  assert.deepEqual(idsFrom(['a', 5, null, 'b', {}]), ['a', 'b']);
  // The count and the sweep's append read it through the same check.
  assert.equal(waitingCount(0, [{ id: 'a' }], { length: 1, 0: 'a' }, []), 1);
  const done = store({ length: 2 });
  const ticking = store([tick('a', 0)]);
  await settleTicks(ticking.update(), done.update(), NOW + 30000, ['a']);
  assert.deepEqual(done.get(), ['a']);
});

test('the state contract declares ticking under the plugin\'s manifest name', () => {
  const types = readFileSync(join(root, 'brigade/types/index.d.ts'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const block = types.slice(types.indexOf('interface PluginState'));
  assert.ok(block.includes(`${manifest.name}: {`), 'the values sit under the manifest name');
  assert.match(block, /\n\s+ticking: Pair\[\]\n/);
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  assert.match(register, /atom\(\{ plugin: 'grimoire', key: 'ticking' \} as const, \[\]\)/);
});
// --- cache warmth ------------------------------------------------------------

const { MAX_TRANSCRIPT_BYTES, NUDGE_TOKENS, lastCall, liveState, readWarmth, warmthFrom, warmthLine } = view;
const { parseAgents } = roster;
const HOUR = 60 * MIN;

// A transcript row as Claude Code writes it, with only the fields the parser
// reads. `usage` overrides the token counts; `extra` the row's own fields.
const row = ({ ms = 0, usage = {}, write = '1h', extra = {}, model = 'claude-opus-5-5' } = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at(ms),
    isSidechain: false,
    message: {
      model,
      usage: {
        input_tokens: 6,
        cache_creation_input_tokens: write === 'none' ? 0 : 1000,
        cache_read_input_tokens: 150000,
        output_tokens: 300,
        cache_creation: {
          ephemeral_5m_input_tokens: write === '5m' ? 1000 : 0,
          ephemeral_1h_input_tokens: write === '1h' ? 1000 : 0,
        },
        ...usage,
      },
    },
    ...extra,
  });
const file = (...rows) => rows.join('\n') + '\n';
const MTIME = NOW;

test('the last-call parser takes the last real model call: its time, context tokens and window', () => {
  const t = file(JSON.stringify({ type: 'user', timestamp: at(-2 * MIN) }), row({ ms: -MIN }));
  assert.deepEqual(lastCall(t, MTIME), { at: NOW - MIN, tokens: 151006, windowMs: HOUR });
});

test('a call that wrote only 5-minute cache has a 5-minute window, and one hour otherwise', () => {
  assert.equal(lastCall(file(row({ write: '5m' })), MTIME)?.windowMs, 5 * MIN);
  assert.equal(lastCall(file(row({ write: '1h' })), MTIME)?.windowMs, HOUR);
  const both = row({ usage: { cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } } });
  assert.equal(lastCall(file(both), MTIME)?.windowMs, HOUR);
});

test('a call that only read the cache takes its window from the last earlier call that wrote it, else the window is unknown', () => {
  const t = file(row({ ms: -3 * MIN, write: '5m' }), row({ ms: -2 * MIN, write: 'none' }), row({ ms: -MIN, write: 'none' }));
  assert.deepEqual(lastCall(t, MTIME), { at: NOW - MIN, tokens: 150006, windowMs: 5 * MIN });
  const none = lastCall(file(row({ ms: -MIN, write: 'none' })), MTIME);
  assert.deepEqual(none, { at: NOW - MIN, tokens: 150006 });
  assert.equal('windowMs' in none, false);
  // A row that wrote cache but fails a check does not give the window.
  const bad = file(row({ ms: -3 * MIN, write: '5m', extra: { isSidechain: true } }), row({ ms: -MIN, write: 'none' }));
  assert.equal(lastCall(bad, MTIME)?.windowMs, undefined);
});

test('a valid row followed by each kind of skipped row: the valid one wins', () => {
  const valid = row({ ms: -5 * MIN });
  const skipped = {
    synthetic: row({ ms: -MIN, model: '<synthetic>', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    'API error': row({ ms: -MIN, extra: { isApiErrorMessage: true } }),
    sidechain: row({ ms: -MIN, extra: { isSidechain: true } }),
    'zero context': row({ ms: -MIN, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    'a day after the file': row({ ms: 1440 * MIN }),
    'not UTC': row({ ms: -MIN }).replace(/"timestamp":"([^"]+)Z"/, '"timestamp":"$1+00:00"'),
    unparseable: row({ ms: -MIN }).replace(/"timestamp":"[^"]+"/, '"timestamp":"2026-13-40T99:00:00Z"'),
    'no timestamp': row({ ms: -MIN }).replace(/"timestamp":"[^"]+",/, ''),
    'not JSON': row({ ms: -MIN }).slice(0, -1),
    'usage not an object': row({ ms: -MIN }).replace(/"usage":\{/, '"usage":7,"x":{'),
  };
  for (const [kind, line] of Object.entries(skipped)) {
    assert.equal(lastCall(file(valid, line), MTIME)?.at, NOW - 5 * MIN, kind);
  }
});

test('a row is accepted up to two minutes past the file\'s modified time, and refused after', () => {
  assert.equal(lastCall(file(row({ ms: 2 * MIN })), MTIME)?.at, NOW + 2 * MIN);
  assert.equal(lastCall(file(row({ ms: 2 * MIN + 1 })), MTIME), undefined);
});

test('token fields must be absent or finite non-negative integers up to 10,000,000', () => {
  const valid = row({ ms: -5 * MIN });
  for (const v of [-1, 1.5, 10000001, '5', null, true, 1e400, Number.NaN]) {
    for (const field of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
      const line = row({ ms: -MIN }).replace(new RegExp(`"${field}":\\d+`), `"${field}":${typeof v === 'string' ? JSON.stringify(v) : String(v)}`);
      assert.equal(lastCall(file(valid, line), MTIME)?.at, NOW - 5 * MIN, `${field} = ${String(v)}`);
    }
  }
  // Absent fields count as 0; 10,000,000 is the top.
  const sparse = JSON.stringify({ type: 'assistant', timestamp: at(-MIN), message: { model: 'm', usage: { cache_read_input_tokens: 10000000 } } });
  assert.deepEqual(lastCall(file(sparse), MTIME), { at: NOW - MIN, tokens: 10000000 });
  // A cache-write count out of range spoils the row too.
  const badWrite = row({ ms: -MIN, usage: { cache_creation: { ephemeral_5m_input_tokens: -5, ephemeral_1h_input_tokens: 0 } } });
  assert.equal(lastCall(file(valid, badWrite), MTIME)?.at, NOW - 5 * MIN);
});

test('no assistant row, or no valid one, means no record', () => {
  assert.equal(lastCall('', MTIME), undefined);
  assert.equal(lastCall(file(JSON.stringify({ type: 'user', timestamp: at(0) })), MTIME), undefined);
  assert.equal(lastCall(file(row({ extra: { isApiErrorMessage: true } })), MTIME), undefined);
});

// The classifier. A record as the poll stores it.
const call = (idleMs, tokens = 150000, windowMs = HOUR) => ({ name: 'S', kind: 'call', at: NOW - idleMs, tokens, windowMs });

test('the warmth bands: working dim, more than 15 min left green, 15 min or less amber, cold red', () => {
  assert.deepEqual(warmthLine(call(10 * MIN), 'busy', 'working', NOW), { tone: 'dim', text: '◆ cache warm (working) · 150k context' });
  assert.equal(warmthLine(call(10 * MIN), 'running', 'working', NOW)?.tone, 'dim');
  assert.deepEqual(warmthLine(call(10 * MIN), 'idle', 'working', NOW), { tone: 'success', text: '◆ cache warm · idle 10 min · cold in 50 min · 150k context' });
  assert.deepEqual(warmthLine(call(50 * MIN), 'idle', 'working', NOW), { tone: 'warning', text: '◆ cache warm · idle 50 min · cold in 10 min · 150k context' });
  assert.deepEqual(warmthLine(call(70 * MIN), 'idle', 'working', NOW), { tone: 'error', text: '◆ cache cold · idle 1 hr 10 min · 150k context' });
});

test('the 15-minute and 0-minute edges', () => {
  assert.equal(warmthLine(call(45 * MIN - 1), 'idle', 'working', NOW)?.tone, 'success');
  assert.equal(warmthLine(call(45 * MIN), 'idle', 'working', NOW)?.tone, 'warning');
  assert.match(warmthLine(call(45 * MIN), 'idle', 'working', NOW)?.text ?? '', /cold in 15 min/);
  assert.equal(warmthLine(call(HOUR - 1), 'idle', 'working', NOW)?.tone, 'warning');
  assert.match(warmthLine(call(HOUR - 1), 'idle', 'working', NOW)?.text ?? '', /cold in 1 min/);
  assert.equal(warmthLine(call(HOUR), 'idle', 'working', NOW)?.tone, 'error');
  // A 5-minute window is amber from the start.
  assert.equal(warmthLine(call(MIN, 150000, 5 * MIN), 'idle', 'working', NOW)?.tone, 'warning');
  // A call time ahead of the clock reads as idle 0.
  assert.match(warmthLine(call(-MIN), 'idle', 'working', NOW)?.text ?? '', /idle 0 min · cold in 1 hr 0 min/);
});

test('the nudge: only a needs-you card with 100,000 or more known tokens that is not working', () => {
  assert.equal(NUDGE_TOKENS, 100000);
  assert.equal(warmthLine(call(50 * MIN, 100000), 'idle', 'needs-you', NOW)?.nudge, 'Reply within 10 min to keep the cache.');
  assert.equal(warmthLine(call(50 * MIN, 99999), 'idle', 'needs-you', NOW)?.nudge, undefined);
  assert.equal(
    warmthLine(call(70 * MIN, 182400), 'idle', 'needs-you', NOW)?.nudge,
    'Replying re-reads about 182k tokens at full price. Consider a hand-off through the issue to a fresh session.',
  );
  // More than 15 min left: no nudge yet.
  assert.equal(warmthLine(call(45 * MIN - 1, 150000), 'idle', 'needs-you', NOW)?.nudge, undefined);
  assert.equal(warmthLine(call(45 * MIN, 150000), 'idle', 'needs-you', NOW)?.nudge, 'Reply within 15 min to keep the cache.');
  // Not needing the owner, or working: no nudge.
  for (const status of ['working', 'done', 'stopped']) assert.equal(warmthLine(call(70 * MIN), 'idle', status, NOW)?.nudge, undefined, status);
  assert.equal(warmthLine(call(70 * MIN), 'busy', 'needs-you', NOW)?.nudge, undefined);
  assert.equal(warmthLine(call(70 * MIN), 'running', 'needs-you', NOW)?.nudge, undefined);
  // A blocked or not-running session that needs the owner still gets it.
  assert.ok(warmthLine(call(70 * MIN), 'blocked', 'needs-you', NOW)?.nudge);
  assert.ok(warmthLine(call(70 * MIN), undefined, 'needs-you', NOW)?.nudge);
});

test('an unknown window shows no countdown and no nudge', () => {
  const r = { name: 'S', kind: 'call', at: NOW - 70 * MIN, tokens: 150000 };
  assert.deepEqual(warmthLine(r, 'idle', 'needs-you', NOW), { tone: 'dim', text: '◆ cache window unknown · idle 1 hr 10 min · 150k context' });
});

test('a transcript too large to read, or a name two sessions share, shows unknown: never warm, never a nudge, even while working', () => {
  for (const live of ['idle', 'busy', undefined]) {
    assert.deepEqual(warmthLine({ name: 'S', kind: 'too-large' }, live, 'needs-you', NOW), { tone: 'dim', text: '◆ cache unknown · transcript too large to read' });
    assert.deepEqual(warmthLine({ name: 'S', kind: 'shared' }, live, 'needs-you', NOW), { tone: 'dim', text: '◆ cache unknown · two sessions share this name' });
  }
});

test('no record, no line', () => {
  assert.equal(warmthLine(undefined, 'idle', 'needs-you', NOW), undefined);
});

test('stored warmth records are checked again: wrong shapes go, and none reaches a prototype', () => {
  const good = call(MIN);
  assert.deepEqual(warmthFrom([good, { name: 'T', kind: 'too-large' }, { name: 'U', kind: 'shared' }]), [good, { name: 'T', kind: 'too-large' }, { name: 'U', kind: 'shared' }]);
  for (const stored of [undefined, null, 'x', 5, {}, { length: 1, 0: good }]) assert.deepEqual(warmthFrom(stored), [], String(stored));
  const bad = [
    { ...good, name: 5 },
    { ...good, name: '' },
    { ...good, name: 'x'.repeat(301) },
    { ...good, kind: 'warm' },
    { ...good, kind: 'constructor' },
    { ...good, at: Number.NaN },
    { ...good, at: '5' },
    { ...good, tokens: -1 },
    { ...good, tokens: 1.5 },
    { ...good, tokens: 30000001 },
    { ...good, windowMs: 1000 },
  ];
  for (const b of bad) assert.deepEqual(warmthFrom([b]), [], JSON.stringify(b));
  // An absent window stays absent; a repeated name keeps the first; at most 50.
  const { windowMs, ...noWindow } = good;
  assert.deepEqual(warmthFrom([noWindow]), [noWindow]);
  assert.deepEqual(warmthFrom([good, { ...good, tokens: 1 }]), [good]);
  assert.equal(warmthFrom(Array.from({ length: 60 }, (_, i) => ({ ...good, name: `S${i}` }))).length, 50);
});

test('live states: busy and running are success, idle and blocked warning, others inactive', () => {
  assert.deepEqual(liveState('busy'), { text: 'busy', color: 'success' });
  assert.deepEqual(liveState('running'), { text: 'running', color: 'success' });
  assert.deepEqual(liveState('working'), { text: 'working', color: 'success' });
  assert.deepEqual(liveState('idle'), { text: 'idle', color: 'warning' });
  assert.deepEqual(liveState('blocked'), { text: 'blocked', color: 'warning' });
  assert.deepEqual(liveState('?'), { text: '?', color: 'inactive' });
  assert.deepEqual(liveState('constructor'), { text: 'constructor', color: 'inactive' });
  assert.deepEqual(liveState(undefined), { text: 'not running', color: 'inactive' });
});

test('the agents-row parser reads an interactive row\'s status and a background row\'s state', () => {
  const sid = '11111111-2222-4333-8444-555555555555';
  const rows = parseAgents(JSON.stringify([
    { name: 'Interactive', status: 'busy', sessionId: sid, cwd: 'C:\\w' },
    { name: 'Background', state: 'blocked', sessionId: sid, cwd: 'C:\\w' },
    { name: 'Both', status: 'idle', state: 'blocked' },
    { name: 'Neither' },
    { name: 'Hostile', state: '\u{202E}x\ny'.repeat(10) },
  ]));
  assert.ok('value' in rows);
  assert.deepEqual(rows.value.map(r => r.status), ['busy', 'blocked', 'idle', '?', rows.value[4].status]);
  assert.ok(rows.value[4].status.length <= 20 && !/[\n\u{202E}]/u.test(rows.value[4].status));
});

// The read decision, with a fake file system.
const CONFIG = 'C:\\cfg';
const SID = ['11111111-2222-4333-8444-555555555555', '22222222-3333-4444-8555-666666666666', '33333333-4444-4555-8666-777777777777'];
const agent = (name, i, status = 'idle') => ({ name, status, sessionId: SID[i], cwd: 'C:\\work' });
const pathOf = i => `${CONFIG}\\projects\\C--work\\${SID[i]}.jsonl`;

function fakeFs(files) {
  const reads = [];
  const stats = [];
  return {
    reads,
    stats,
    io: {
      live: () => true,
      stat: async p => {
        stats.push(p);
        const f = files[p];
        if (f === undefined) throw new Error('ENOENT');
        return { kind: f.kind ?? 'file', size: f.size ?? f.text.length, mtimeMs: f.mtimeMs ?? MTIME, isLink: f.isLink ?? false };
      },
      read: async p => {
        reads.push(p);
        const f = files[p];
        if (f === undefined || f.fail) throw new Error('read failed');
        return f.text;
      },
    },
  };
}

test('a transcript is read once, and again only when its modified time changes', async () => {
  const files = { [pathOf(0)]: { text: file(row({ ms: -MIN })) } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  const rows = [agent('A', 0)];
  const first = await readWarmth(rows, ['A'], CONFIG, memory, io);
  assert.deepEqual(first, [{ name: 'A', kind: 'call', at: NOW - MIN, tokens: 151006, windowMs: HOUR }]);
  assert.equal(reads.length, 1);
  assert.deepEqual(await readWarmth(rows, ['A'], CONFIG, memory, io), first);
  assert.equal(reads.length, 1, 'unchanged: not read again');
  files[pathOf(0)] = { text: file(row({ ms: -MIN }), row({ ms: 0 })), mtimeMs: MTIME + 1 };
  const second = await readWarmth(rows, ['A'], CONFIG, memory, io);
  assert.equal(reads.length, 2, 'changed: read again');
  assert.equal(second[0].at, NOW);
});

test('the re-read memory is a Map keyed by transcript path, set only after a successful read and parse', async () => {
  const files = { [pathOf(0)]: { text: file(row()), fail: true } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  assert.deepEqual(await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io), []);
  assert.equal(memory.size, 0, 'a failed read leaves no entry');
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.equal(reads.length, 2, 'and is retried at the next poll');
  files[pathOf(0)].fail = false;
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.deepEqual([...memory.keys()], [pathOf(0)]);
  assert.equal(memory.get(pathOf(0)).mtimeMs, MTIME);
});

test('a failed re-read keeps the last good record and is retried', async () => {
  const files = { [pathOf(0)]: { text: file(row({ ms: -MIN })) } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  files[pathOf(0)] = { text: '', mtimeMs: MTIME + 1, fail: true };
  const kept = await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.equal(kept[0].at, NOW - MIN);
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.equal(reads.length, 3);
});

test('a busy or running member is not read, and keeps its last record', async () => {
  const files = { [pathOf(0)]: { text: file(row({ ms: -MIN })) }, [pathOf(1)]: { text: file(row({ ms: -MIN })) } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  assert.deepEqual(await readWarmth([agent('A', 0, 'busy'), agent('B', 1, 'running')], ['A', 'B'], CONFIG, memory, io), [{ name: 'A', kind: 'unread' }, { name: 'B', kind: 'unread' }]);
  assert.equal(reads.length, 0);
  await readWarmth([agent('A', 0, 'idle')], ['A'], CONFIG, memory, io);
  files[pathOf(0)].mtimeMs = MTIME + 1;
  const busy = await readWarmth([agent('A', 0, 'busy')], ['A'], CONFIG, memory, io);
  assert.equal(reads.length, 1);
  assert.equal(busy[0].at, NOW - MIN, 'the last known record');
});

test('a path that is not a regular file is not read', async () => {
  for (const f of [{ kind: 'dir', text: '' }, { kind: 'other', text: '' }, { isLink: true, text: file(row()) }]) {
    const { io, reads } = fakeFs({ [pathOf(0)]: f });
    assert.deepEqual(await readWarmth([agent('A', 0)], ['A'], CONFIG, new Map(), io), [], JSON.stringify(f));
    assert.equal(reads.length, 0);
  }
  // A missing transcript: no read, no record.
  const { io, reads } = fakeFs({});
  assert.deepEqual(await readWarmth([agent('A', 0)], ['A'], CONFIG, new Map(), io), []);
  assert.equal(reads.length, 0);
});

test('a transcript over 4 MiB is not read and records "too large"', async () => {
  assert.equal(MAX_TRANSCRIPT_BYTES, 4 * 1024 * 1024);
  const { io, reads } = fakeFs({ [pathOf(0)]: { text: '', size: MAX_TRANSCRIPT_BYTES + 1 }, [pathOf(1)]: { text: file(row()), size: MAX_TRANSCRIPT_BYTES } });
  const out = await readWarmth([agent('A', 0), agent('B', 1)], ['A', 'B'], CONFIG, new Map(), io);
  assert.deepEqual(out.map(w => [w.name, w.kind]), [['A', 'too-large'], ['B', 'call']]);
  assert.deepEqual(reads, [pathOf(1)]);
});

test('a name on two rows is reported as shared, and neither transcript is read', async () => {
  const files = { [pathOf(0)]: { text: file(row()) }, [pathOf(1)]: { text: file(row()) } };
  const { io, reads, stats } = fakeFs(files);
  const out = await readWarmth([agent('A', 0), agent('A', 1)], ['A'], CONFIG, new Map(), io);
  assert.deepEqual(out, [{ name: 'A', kind: 'shared' }]);
  assert.equal(reads.length + stats.length, 0);
});

test('only roster members are read', async () => {
  const files = { [pathOf(0)]: { text: file(row()) }, [pathOf(1)]: { text: file(row()) } };
  const { io, reads } = fakeFs(files);
  const out = await readWarmth([agent('A', 0), agent('Other', 1)], ['A'], CONFIG, new Map(), io);
  assert.deepEqual(out.map(w => w.name), ['A']);
  assert.deepEqual(reads, [pathOf(0)]);
});

test('a name that moves to another session and back reads the right transcript', async () => {
  const files = { [pathOf(0)]: { text: file(row({ ms: -10 * MIN })) }, [pathOf(1)]: { text: file(row({ ms: -2 * MIN })) } };
  const { io } = fakeFs(files);
  const memory = new Map();
  assert.equal((await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io))[0].at, NOW - 10 * MIN);
  assert.equal((await readWarmth([agent('A', 1)], ['A'], CONFIG, memory, io))[0].at, NOW - 2 * MIN);
  assert.equal((await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io))[0].at, NOW - 10 * MIN);
  // A shared spell in between does not leave the card on the other session.
  await readWarmth([agent('A', 0), agent('A', 1)], ['A'], CONFIG, memory, io);
  assert.equal((await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io))[0].at, NOW - 10 * MIN);
});

test('a transcript with no valid row records nothing and is not read again until it changes', async () => {
  const files = { [pathOf(0)]: { text: file(JSON.stringify({ type: 'user' })) } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  assert.deepEqual(await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io), []);
  assert.deepEqual(await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io), []);
  assert.equal(reads.length, 1);
});

test('the memory keeps only the current members\' paths', async () => {
  const files = { [pathOf(0)]: { text: file(row()) }, [pathOf(1)]: { text: file(row()) } };
  const { io } = fakeFs(files);
  const memory = new Map();
  await readWarmth([agent('A', 0), agent('B', 1)], ['A', 'B'], CONFIG, memory, io);
  assert.equal(memory.size, 2);
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.deepEqual([...memory.keys()], [pathOf(0)]);
});

test('a close mid-poll stops the reads and stores nothing', async () => {
  const files = { [pathOf(0)]: { text: file(row()) }, [pathOf(1)]: { text: file(row()) } };
  const { io, reads } = fakeFs(files);
  let open = true;
  const closing = { ...io, live: () => open, read: async p => { open = false; return io.read(p); } };
  assert.equal(await readWarmth([agent('A', 0), agent('B', 1)], ['A', 'B'], CONFIG, new Map(), closing), undefined);
  assert.equal(reads.length, 1);
});

test('the state contract declares warmth under the plugin\'s manifest name', () => {
  const types = readFileSync(join(root, 'brigade/types/index.d.ts'), 'utf8');
  const block = types.slice(types.indexOf('interface PluginState'));
  assert.match(block, /\n\s+warmth: Warmth\[\]\n/);
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  assert.match(register, /atom\(\{ plugin: 'grimoire', key: 'warmth' \} as const, \[\]\)/);
});

test('the agents poll has an in-flight guard: a tick that finds a poll running does nothing', () => {
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  const poll = register.slice(register.indexOf('async function pollAgents'));
  assert.match(poll, /^async function pollAgents[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*if \(polling\) return\n\s*polling = true\n\s*try \{/);
  assert.match(poll, /\} finally \{\n\s*polling = false\n\s*\}/);
});

test('a busy member is still checked for size, so a transcript too large to read stays unknown while it works', async () => {
  const { io, reads } = fakeFs({ [pathOf(0)]: { text: '', size: MAX_TRANSCRIPT_BYTES + 1 } });
  assert.deepEqual(await readWarmth([agent('A', 0, 'busy')], ['A'], CONFIG, new Map(), io), [{ name: 'A', kind: 'too-large' }]);
  assert.equal(reads.length, 0);
});

test('a busy member whose transcript has not been read yet shows "warm (working)" with no size, with no read', async () => {
  const { io, reads } = fakeFs({ [pathOf(0)]: { text: file(row({ ms: -MIN })) } });
  const memory = new Map();
  const out = await readWarmth([agent('A', 0, 'busy')], ['A'], CONFIG, memory, io);
  assert.deepEqual(out, [{ name: 'A', kind: 'unread' }]);
  assert.equal(reads.length, 0);
  assert.deepEqual(warmthLine(out[0], 'busy', 'needs-you', NOW), { tone: 'dim', text: '◆ cache warm (working)' });
  assert.deepEqual(warmthLine(out[0], 'running', 'needs-you', NOW), { tone: 'dim', text: '◆ cache warm (working)' });
  // Not working, it has no line: the next poll reads it.
  assert.equal(warmthLine(out[0], 'idle', 'needs-you', NOW), undefined);
  // A missing or non-file transcript gives no record, busy or not.
  for (const f of [undefined, { kind: 'dir', text: '' }]) {
    const fs = fakeFs(f === undefined ? {} : { [pathOf(0)]: f });
    assert.deepEqual(await readWarmth([agent('A', 0, 'busy')], ['A'], CONFIG, new Map(), fs.io), []);
  }
  // Once read, a busy member keeps its last size rather than this line.
  await readWarmth([agent('A', 0, 'idle')], ['A'], CONFIG, memory, io);
  assert.equal((await readWarmth([agent('A', 0, 'busy')], ['A'], CONFIG, memory, io))[0].kind, 'call');
  // A transcript read before its first model call: working, with no size,
  // and not read again while it works.
  const empty = fakeFs({ [pathOf(1)]: { text: file(JSON.stringify({ type: 'user' })) } });
  const mem2 = new Map();
  assert.deepEqual(await readWarmth([agent('B', 1, 'idle')], ['B'], CONFIG, mem2, empty.io), []);
  empty.io.stat = async () => ({ kind: 'file', size: 10, mtimeMs: MTIME + 1, isLink: false });
  assert.deepEqual(await readWarmth([agent('B', 1, 'busy')], ['B'], CONFIG, mem2, empty.io), [{ name: 'B', kind: 'unread' }]);
  assert.equal(empty.reads.length, 1);
});

test('a stored "unread" record is kept by the check', () => {
  assert.deepEqual(warmthFrom([{ name: 'A', kind: 'unread' }]), [{ name: 'A', kind: 'unread' }]);
});

test('a <synthetic> row is skipped even when its usage looks real', () => {
  const t = file(row({ ms: -5 * MIN }), row({ ms: -MIN, model: '<synthetic>' }));
  assert.equal(lastCall(t, MTIME)?.at, NOW - 5 * MIN);
});

test('a modified time that is not a finite number gives no record', () => {
  for (const m of [Number.NaN, Infinity, -Infinity]) assert.equal(lastCall(file(row()), m), undefined, String(m));
});

test('a close while the only transcript is being read stores nothing', async () => {
  const { io } = fakeFs({ [pathOf(0)]: { text: file(row()) } });
  let open = true;
  const closing = { ...io, live: () => open, read: async p => { open = false; return io.read(p); } };
  const memory = new Map();
  assert.equal(await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, closing), undefined);
  assert.equal(memory.size, 0);
});

test('with two calls that wrote cache, the newest one sets the window, in either order', () => {
  const t1 = file(row({ ms: -10 * MIN, write: '5m' }), row({ ms: -5 * MIN, write: '1h' }), row({ ms: -MIN, write: 'none' }));
  assert.equal(lastCall(t1, MTIME)?.windowMs, HOUR);
  const t2 = file(row({ ms: -10 * MIN, write: '1h' }), row({ ms: -5 * MIN, write: '5m' }), row({ ms: -MIN, write: 'none' }));
  assert.equal(lastCall(t2, MTIME)?.windowMs, 5 * MIN);
});

test('a modified time that goes back is a change too: the transcript is read again', async () => {
  const files = { [pathOf(0)]: { text: file(row({ ms: -MIN })), mtimeMs: MTIME } };
  const { io, reads } = fakeFs(files);
  const memory = new Map();
  await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  // A restore from a backup: older contents, an older modified time.
  files[pathOf(0)] = { text: file(row({ ms: -70 * MIN })), mtimeMs: MTIME - HOUR };
  const out = await readWarmth([agent('A', 0)], ['A'], CONFIG, memory, io);
  assert.equal(reads.length, 2);
  assert.equal(out[0].at, NOW - 70 * MIN);
});

test('a token count of 1e400 in valid JSON parses to Infinity and spoils the row', () => {
  const valid = row({ ms: -5 * MIN });
  for (const field of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'ephemeral_1h_input_tokens']) {
    const line = row({ ms: -MIN }).replace(new RegExp(`"${field}":\\d+`), `"${field}":1e400`);
    assert.ok(line.includes('1e400'), field);
    assert.equal(JSON.parse(line).type, 'assistant', 'the row is valid JSON');
    assert.equal(lastCall(file(valid, line), MTIME)?.at, NOW - 5 * MIN, field);
  }
});

test('a background row that says "working" counts as working: not read, and no countdown', async () => {
  const { io, reads } = fakeFs({ [pathOf(0)]: { text: file(row({ ms: -MIN })) } });
  assert.deepEqual(await readWarmth([agent('A', 0, 'working')], ['A'], CONFIG, new Map(), io), [{ name: 'A', kind: 'unread' }]);
  assert.equal(reads.length, 0);
  assert.deepEqual(warmthLine(call(70 * MIN), 'working', 'needs-you', NOW), { tone: 'dim', text: '◆ cache warm (working) · 150k context' });
});

test('the pane keeps its re-read memory in a Map of the view module\'s ReadMemory type', () => {
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  assert.match(register, /\nconst memory: ReadMemory = new Map\(\)\n/);
  assert.equal(register.match(/\bmemory\b/g)?.length, 2, 'declared once and handed to readWarmth once');
  assert.match(register, /readWarmth\(rows\.value, cards\.map\(c => c\.title\), config, memory, \{/);
  const v = readFileSync(join(root, 'brigade/view.ts'), 'utf8');
  assert.match(v, /export type ReadMemory = Map<string, \{ mtimeMs: number; call: LastCall \| undefined \}>/);
});

// --- severity groups and badges ---------------------------------------------
//
// Spec revision 3 on #250, S3 and S5; ticket #254. Every status is drawn from
// one fixed Map, and the stored roster is drawn as stored, so a status outside
// the four words, or one that names a prototype key, counts nowhere.

const { STATUS, statusOf, groupCards, isOpen, foldLabel, reportCount, drawnTitle } = view;
const cardOf = (title, status) => ({ title, work: 'w', phase: 'p', settings: 's', status });
const placed = list => list.map(({ c, i }) => [i, c.title]);

test('the status Map gives each of the four statuses its glyph, word, theme key and class, in display order', () => {
  assert.ok(STATUS instanceof Map, 'a Map, so no status text reaches a prototype');
  assert.deepEqual([...STATUS.keys()], ['needs-you', 'working', 'done', 'stopped']);
  const look = s => { const v = STATUS.get(s); return [v.glyph, v.word, v.color, v.cls]; };
  assert.deepEqual(look('needs-you'), ['●', 'needs you', 'warning', 'warn']);
  assert.deepEqual(look('working'), ['◐', 'working', 'suggestion', 'ok']);
  assert.deepEqual(look('done'), ['✓', 'done', 'success', 'done']);
  // Stopped changes from ○ to –.
  assert.deepEqual(look('stopped'), ['–', 'stopped', 'inactive', 'stopped']);
});

test('a status outside the four words, a prototype key or a value that is not text has no look', () => {
  for (const s of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', HOSTILE, 'Done', ' done', '', 5, null, undefined, {}, ['done']]) {
    assert.equal(statusOf(s), undefined, String(s));
  }
  assert.equal(statusOf('done'), STATUS.get('done'));
});

test('cards sit under needs you, then working, then done and stopped together, each in roster order, with their roster index', () => {
  const cards = [
    cardOf('a', 'done'), cardOf('b', 'working'), cardOf('c', 'needs-you'), cardOf('d', 'stopped'),
    cardOf('e', 'working'), cardOf('f', 'needs-you'), cardOf('g', 'done'),
  ];
  const g = groupCards(cards, new Set());
  assert.deepEqual(placed(g.needsYou), [[2, 'c'], [5, 'f']]);
  assert.deepEqual(placed(g.working), [[1, 'b'], [4, 'e']]);
  assert.deepEqual(placed(g.finished), [[0, 'a'], [3, 'd'], [6, 'g']]);
});

test('a dismissed card is in no group, and an empty group is empty', () => {
  const g = groupCards([cardOf('a', 'done'), cardOf('b', 'working')], new Set(['a']));
  assert.deepEqual(placed(g.needsYou), []);
  assert.deepEqual(placed(g.working), [[1, 'b']]);
  assert.deepEqual(placed(g.finished), []);
});

test('a stored card with a hostile or unknown status draws in no group, the rest keep their roster index, and nothing throws', () => {
  const statuses = ['__proto__', 'constructor', 'toString', HOSTILE, 'paused', 5, null, {}, ['done']];
  const cards = [cardOf('first', 'working'), ...statuses.map((s, i) => cardOf(`bad${i}`, s)), cardOf('last', 'done')];
  const g = groupCards(cards, new Set());
  assert.deepEqual(placed(g.working), [[0, 'first']]);
  assert.deepEqual(placed(g.finished), [[cards.length - 1, 'last']]);
  assert.deepEqual(placed(g.needsYou), []);
  // A card that is not a record, and a roster whose cards are not a list.
  assert.deepEqual(placed(groupCards([null, 7, 'done', cardOf('x', 'done')], new Set()).finished), [[3, 'x']]);
  for (const stored of [undefined, null, 'cards', {}, { length: 1, 0: cardOf('x', 'done') }]) {
    const empty = groupCards(stored, new Set());
    assert.deepEqual([empty.needsYou, empty.working, empty.finished], [[], [], []], String(stored));
  }
});

test('the done and stopped group reads open only when its stored value is exactly true', () => {
  assert.equal(isOpen(true), true);
  for (const v of [false, 'true', 1, {}, [], null, undefined]) assert.equal(isOpen(v), false, String(v));
});

test('the toggle reads ▸ closed and ▾ open, with its card count, and adds the report count only when there are reports', () => {
  assert.equal(foldLabel(false, 2, 0), '▸ DONE · STOPPED  2');
  assert.equal(foldLabel(true, 2, 0), '▾ DONE · STOPPED  2');
  assert.equal(foldLabel(false, 2, 1), '▸ DONE · STOPPED  2 · 1 report');
  assert.equal(foldLabel(false, 3, 2), '▸ DONE · STOPPED  3 · 2 reports');
  // A stored open value that is not exactly true draws closed.
  assert.equal(foldLabel('true', 1, 0), '▸ DONE · STOPPED  1');
});

test('the report count is the inbox entries whose sender matches a done or stopped card, as the card\'s report line matches', () => {
  const inbox = [
    { from: 'alpha', line: 'one', at: '10:00' },
    { from: 'beta', line: 'x', at: '10:01' },
    { from: 'alpha', line: 'two', at: '10:02' },
    { from: 'gamma', line: 'y', at: '10:03' },
  ];
  // Every report from a card counts, not one per card.
  assert.equal(reportCount(['alpha'], inbox), 2);
  assert.equal(reportCount(['alpha', 'gamma'], inbox), 3);
  assert.equal(reportCount([], inbox), 0);
  // Matched by the title as drawn: cleaned and cut to 80, as the sender is,
  // by the one helper the card's report line uses too.
  assert.equal(drawnTitle(`x${'y'.repeat(100)}`), roster.oneLine(`x${'y'.repeat(100)}`, 80));
  const long = `${'t'.repeat(90)}\u{202E}`;
  assert.equal(reportCount([long], [{ from: 't'.repeat(79) + '…', line: 'l', at: '' }]), 1);
  // An inbox of the wrong shape counts nothing, and never throws.
  for (const stored of [undefined, null, 'alpha', {}, [null, 5, 'alpha', { from: 5 }, { line: 'x' }]]) {
    assert.equal(reportCount(['alpha'], stored), 0, String(stored));
  }
});

test('the state contract declares doneOpen as a boolean, and the pane keeps it in an atom that starts false', () => {
  const types = readFileSync(join(root, 'brigade/types/index.d.ts'), 'utf8');
  const block = types.slice(types.indexOf('interface PluginState'));
  assert.match(block, /\n\s+doneOpen: boolean\n/);
  const register = readFileSync(join(root, 'brigade/register.tsx'), 'utf8');
  assert.match(register, /atom\(\{ plugin: 'grimoire', key: 'doneOpen' \} as const, false\)/);
});