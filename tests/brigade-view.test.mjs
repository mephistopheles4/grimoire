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

// Every attribute in the source, as [tag, name, value]. Outside text is
// escaped, so a `<` in the source opens a real tag and a `"` ends a value.
function attributes(source) {
  const out = [];
  for (const tag of source.matchAll(/<([a-zA-Z]+)((?:\s+[^\s=>/]+="[^"]*")*)\s*\/?>/g)) {
    for (const a of tag[2].matchAll(/([^\s=]+)="([^"]*)"/g)) out.push([tag[1], a[1], a[2]]);
  }
  return out;
}

const CLASSES = new Set(['muted', 'track', 'ok', 'warn', 'hot', 'free', 'buffer', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
const NUMBER = /^\d+(?:\.\d+)?$/;
const allowed = (name, value) => {
  if (name === 'class') return CLASSES.has(value);
  if (name === 'id') return value === 'cb';
  if (name === 'clip-path') return value === 'url(#cb)';
  if (name === 'text-anchor') return value === 'end';
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg';
  if (name === 'viewBox') return /^0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?$/.test(value);
  return NUMBER.test(value);
};

function assertAllowlisted(source) {
  const attrs = attributes(source);
  assert.ok(attrs.length > 0, 'the source has attributes to check');
  for (const [tag, name, value] of attrs) {
    assert.ok(allowed(name, value), `<${tag} ${name}="${value}"> is not on the attribute allowlist`);
  }
  // Every tag is one the module writes, and the image closes once.
  for (const t of source.matchAll(/<\/?([a-zA-Z]+)/g)) {
    assert.ok(['svg', 'style', 'text', 'rect', 'clipPath', 'g', 'circle'].includes(t[1]), `unexpected tag <${t[1]}>`);
  }
  assert.equal(source.match(/<\/svg>/g)?.length, 1);
  assert.doesNotMatch(source, /NaN|Infinity/);
}

const svgOf = (s, surface = 'desktop') => {
  const v = usageView(s, surface, NOW);
  assert.equal(v.kind, 'svg', `expected an SVG on ${surface}, got ${v.kind}`);
  return v;
};

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
    // One track and one fill per rate-limit bar, then the context track.
    assert.equal(v.source.match(/<rect class="track"/g).length, 3);
    // The context bar: four segments (deferred and empty rows left out),
    // clipped to the rounded track.
    const bar = v.source.match(/<g clip-path="url\(#cb\)">(.*?)<\/g>/)[1];
    assert.equal(bar.match(/<rect /g).length, 4);
    assert.match(bar, /class="c0".*class="c1".*class="free".*class="buffer"/);
    // The legend: dot, name and tokens per drawn row, in two columns.
    assert.equal(v.source.match(/<circle /g).length, 4);
    for (const name of ['System prompt', 'Messages', 'Free space', 'Autocompact buffer']) assert.ok(v.source.includes(`>${name}</text>`));
    assert.ok(!v.source.includes('deferred'));
    assert.ok(!v.source.includes('Empty row'));
    assert.ok(v.source.includes('>3.1k</text>') && v.source.includes('>40k</text>'));
    assert.equal(v.width, 480);
    assert.ok(Number.isFinite(v.height) && v.height > 0);
    assertAllowlisted(v.source);
  }
});

test('the alt text names each bar and its percentage', () => {
  const { alt } = svgOf(snapshot());
  assert.match(alt, /Current session 64%/);
  assert.match(alt, /Weekly limit 13%/);
  assert.match(alt, /Context 22%: System prompt 3\.1k, Messages 40k, Free space 120k, Autocompact buffer 37k/);
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
  assert.equal(v.rows[0].bar, '█████░░░░░░░░░░░░░░░');
});

test('with no rate limits and no breakdown the view is "nothing yet" on every surface', () => {
  for (const surface of SURFACES) {
    assert.deepEqual(usageView(EMPTY_USAGE, surface, NOW), { kind: 'none' });
    assert.deepEqual(usageView({ limits: [], context: {}, categories: [] }, surface, NOW), { kind: 'none' });
    // A context reading alone is still no rate limit and no breakdown.
    assert.deepEqual(usageView({ limits: [], context: { percent: 40, tokens: 1, window: 2 } }, surface, NOW), { kind: 'none' });
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
    limits: [{ kind: HOSTILE, percent: 50, resetsAt: at(5 * MIN) }],
    categories: [{ name: HOSTILE, kind: 'used', tokens: 1000 }],
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
  const limits = Array.from({ length: 400 }, (_, i) => ({ kind: `k${'<'.repeat(28)}${i}`, percent: 50, resetsAt: at(i * MIN) }));
  const s = { limits, context: {} };
  for (const surface of IMAGE_SURFACES) {
    const v = usageView(s, surface, NOW);
    assert.equal(v.kind, 'text', `${surface} falls back`);
    assert.equal(v.rows.length, 400);
  }
  // Just under the cap it is still an image.
  const few = { limits: limits.slice(0, 50), context: {} };
  assert.equal(usageView(few, 'desktop', NOW).kind, 'svg');
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
