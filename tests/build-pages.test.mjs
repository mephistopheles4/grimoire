// scripts/build-pages.mjs publishes the site, so its failures are invisible:
// a page that never renders is a page nobody misses until they look for it.
//
// Each test copies the parts of the tree the script reads into a temporary
// directory and runs the copy's own scripts/build-pages.mjs. The copy is not
// decoration: the script finds the repository root from its own file location,
// so it cannot be pointed at a fixture any other way.
//
// No box file is committed as a fixture. Both tree walkers would find one, and
// a valid one would be published to the public site. Every box here is derived
// from the box the skill already ships and written at run time.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, exampleBox, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-pages-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;

// A copy of everything build-pages.mjs reads: the script, the renderer and its
// module, and the box file the skill ships. .gitignore comes too, because the
// walker reads it.
function tree() {
  const dir = join(work, `case-${n++}`);
  mkdirSync(dir);
  for (const part of ['scripts', 'skills']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  cpSync(join(root, '.gitignore'), join(dir, '.gitignore'));
  return dir;
}

const buildIn = dir => join(dir, 'scripts', 'build-pages.mjs');
const site = (dir, name) => join(dir, 'site', name);

// A valid box, derived from the shipped one so no fixture lands on disk.
function writeBox(dir, relPath, title) {
  const p = join(dir, relPath);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(exampleBox, 'utf8')), title }));
  return p;
}

test('two boxes with the same file name in different directories publish two pages', () => {
  // Keyed on the basename, the second render overwrote the first and the page
  // vanished from the published site, with no warning and no failure.
  const dir = tree();
  writeBox(dir, 'docs/decisions/dup.box.json', 'The first one');
  writeBox(dir, 'skills/eagle-eye/examples/dup.box.json', 'The second one');

  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);

  const first = site(dir, 'docs-decisions-dup.html');
  const second = site(dir, 'skills-eagle-eye-examples-dup.html');
  assert.match(readFileSync(first, 'utf8'), /<title>The first one/);
  assert.match(readFileSync(second, 'utf8'), /<title>The second one/);

  // Both reachable from the index, by title and by source path.
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  assert.match(index, /href="\.\/docs-decisions-dup\.html">The first one</);
  assert.match(index, /href="\.\/skills-eagle-eye-examples-dup\.html">The second one</);
  assert.match(index, /docs\/decisions\/dup\.box\.json/);
});

test('the box the skill ships still publishes, and the index links it', () => {
  const dir = tree();
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const name = 'skills-eagle-eye-examples-eagle-eye-skill.html';
  assert.match(readFileSync(site(dir, name), 'utf8'), /^<!doctype html>/i);
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  // A substring, not a regex built by escaping the dots in a file name. That
  // escape handled `.` and not `\`, and CodeQL raised js/incomplete-sanitization
  // on it — high severity, on a line that only ever sees a constant. The link
  // is a fixed string, so nothing here needs a pattern at all.
  assert.ok(index.includes(`href="./${name}"`), `the index must link ${name}`);
  assert.match(index, /skills\/eagle-eye\/examples\/eagle-eye-skill\.box\.json/);
});

test('the index is the same design as the pages it links', () => {
  // The index carried its own sans-serif stack and declared
  // `color-scheme: light dark`. The pages use the system's tokens and take
  // their light/dark from the scheme layer, so on a dark-mode browser the index
  // rendered dark and every page it linked rendered light: a visible flip on
  // each click-through, not a style inconsistency.
  //
  // Both now wear the Aviation bundle outright rather than a transcription of
  // it, which is what makes "the same design" checkable instead of a promise.
  const dir = tree();
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  const page = readFileSync(site(dir, 'skills-eagle-eye-examples-eagle-eye-skill.html'), 'utf8');

  // The bundle's own header line. If either side stops carrying it, they have
  // stopped sharing a source and this test is the place that says so.
  for (const marker of ['AVIATION — BUNDLE', '--av-paper', '--av-ink', '--av-font']) {
    assert.ok(index.includes(marker), `the index must carry ${marker}`);
    assert.ok(page.includes(marker), `the page must carry ${marker}`);
  }
  assert.equal(/ui-sans-serif/.test(index), false, 'the index must not keep its own type stack');
  // The same light/dark commitment, and now it is a commitment to something:
  // both consult the OS once, before first paint, and set the system's own
  // scheme attribute.
  //
  // `color-scheme: light dark` is what caused the flip and stays forbidden: it
  // hands the decision to the browser, which then disagreed with pages that had
  // made it themselves. The bundle's `color-scheme: dark` is the opposite —
  // scoped inside the dark layer, it tells the browser what the page has
  // ALREADY decided, so form controls and scrollbars match the ground.
  for (const html of [index, page]) {
    assert.doesNotMatch(html, /color-scheme:\s*light\s+dark/, 'neither may hand the choice to the browser');
    assert.match(html, /prefers-color-scheme: dark/, 'both read the OS preference');
    assert.match(html, /setAttribute\('data-aviation-scheme','dark'\)/);
  }
});

test('the site adds no external reference at all', () => {
  // SECURITY.md enumerates every external request the published site makes,
  // and that list is now empty. This test used to pin the count at exactly one
  // and name it — the Google Fonts stylesheet the index and the rendered pages
  // both linked. The faces are vendored and inlined everywhere, so nothing is
  // fetched, and this is what keeps a convenience link from creeping back.
  //
  // Same width as the render tests: src and href anywhere, a CSS @import, a
  // url() in a stylesheet, and the four ways a script opens a socket.
  const dir = tree();
  run(buildIn(dir), [], { cwd: dir });
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(index, /<link\b/i);
  assert.doesNotMatch(index, /\bsrc\s*=\s*["']https?:/i);
  assert.doesNotMatch(index, /\bhref\s*=\s*["']https?:(?!\/\/github\.com)/i);
  assert.doesNotMatch(index, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(index, /@import/i);
  assert.doesNotMatch(index, /XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
  assert.equal(/<script[^>]+src=/i.test(index), false, 'no script is loaded from a URL');
  // The one https the page may carry is the source link a reader clicks. An
  // anchor is not a request the page makes; the negative lookahead above says
  // so precisely rather than exempting every href.
  assert.match(index, /<a href="https:\/\/github\.com\/mephistopheles4\/grimoire">/);
  // The faces are here instead, and under the same contract as the rendered
  // pages: two subsets per weight, each with the range IBM declares for it.
  // The index shipped these WITHOUT a range for one commit. Two rules for one
  // family and weight with no range both default to U+0-10FFFF and fully
  // overlap, so only the last — Pi, which has no Latin letters — is in force.
  // It happened to render because Chromium walks back to the earlier face in
  // the family; that is not a contract. This is the assertion that was missing.
  assert.equal((index.match(/@font-face\{/g) || []).length, 6);
  assert.equal((index.match(/src:url\(data:font\/woff2;base64,/g) || []).length, 6);
  assert.equal((index.match(/unicode-range:/g) || []).length, 6);
});

test('a box that wants the listing page name refuses, rather than being overwritten', () => {
  // The listing page writes site/index.html too, and was not in the guard: a
  // root index.box.json rendered its page and the listing then overwrote it,
  // exit 0 and no warning — the same disappearance this guard exists to stop.
  const dir = tree();
  writeBox(dir, 'index.box.json', 'The box that wanted the front door');
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /both render to site\/index\.html/);
  assert.match(r.stderr, /listing page/);
});

test('two box names differing only in case refuse, because one filesystem folds them', () => {
  // Windows and macOS fold case, so two destinations differing only in case are
  // one file there — and that is the machine this site is built from. Two
  // distinct collision keys, one destination, second page silently gone.
  //
  // The two sources cannot themselves differ only in case: this test would then
  // write one file on the filesystem it is written for, which is the whole
  // point. So they differ by a directory boundary and collide once flattened —
  // one/Two.box.json and ONE-two.box.json both want one-two.html.
  const dir = tree();
  writeBox(dir, 'one/Two.box.json', 'Under a directory');
  writeBox(dir, 'ONE-two.box.json', 'Beside it, in another case');
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /both render to/i);
});

test('the index links a page by a percent-encoded href', () => {
  // esc deliberately leaves the double quote alone, and the page name comes
  // from a file name. Escaped into href="...", a name holding a quote closed
  // the attribute and wrote markup into the index. An href wants encoding, not
  // escaping, and encoding has no quote to leave behind.
  const dir = tree();
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  // Every href in the list points at one file and nothing follows it.
  for (const href of index.match(/href="\.\/[^"]*"/g) || []) {
    assert.equal(/[<>'\\]/.test(href), false, `unencoded character in ${href}`);
  }
  assert.ok(index.includes('href="./skills-eagle-eye-examples-eagle-eye-skill.html"'));
});

test('two sources that want one page name refuse, rather than overwrite', () => {
  // Flattening a path onto one name is not injective: a/b.box.json and
  // a-b.box.json both ask for a-b.html. The guard the basename version needed.
  const dir = tree();
  writeBox(dir, 'grid/one.box.json', 'Under a directory');
  writeBox(dir, 'grid-one.box.json', 'Beside it');

  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /both render to site\/grid-one\.html/);
  assert.match(r.stderr, /rename one/);
});
