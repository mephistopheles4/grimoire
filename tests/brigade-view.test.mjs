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
// A tag whose attributes are not all written name="value" matches no tag here,
// so the openings are counted too, and a tag left unread fails the check.
function attributes(source) {
  const out = [];
  let tags = 0;
  for (const tag of source.matchAll(/<([a-zA-Z]+)((?:\s+[^\s=>/]+="[^"]*")*)\s*\/?>/g)) {
    tags += 1;
    for (const a of tag[2].matchAll(/([^\s=]+)="([^"]*)"/g)) out.push([tag[1], a[1], a[2]]);
  }
  const openings = source.match(/<[a-zA-Z]+/g)?.length ?? 0;
  assert.equal(tags, openings, 'every tag the source opens is read for its attributes');
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
    assert.deepEqual([...new Set([...v.source.matchAll(/<circle [^>]*cx="([^"]+)"/g)].map(m => m[1]))], ['4', '244'], 'two columns');
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
  assert.equal(v.rows[0].bar, '█████░░░░░░░░░░░░░░░');
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