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
  // `color-scheme: light dark`. The pages use the Drafting tokens and declare
  // no color-scheme at all, so on a dark-mode browser the index rendered dark
  // and every page it linked rendered light: a visible flip on each
  // click-through, not a style inconsistency.
  const dir = tree();
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  const page = readFileSync(site(dir, 'skills-eagle-eye-examples-eagle-eye-skill.html'), 'utf8');

  for (const token of ['--dw-paper', '--dw-ink', '--dw-font']) {
    assert.ok(index.includes(token), `the index must carry ${token}`);
    assert.ok(page.includes(token), `the page must carry ${token}`);
  }
  assert.match(index, /IBM\+Plex\+Mono/);
  assert.equal(/ui-sans-serif/.test(index), false, 'the index must not keep its own type stack');
  // The same light/dark commitment, which is to make none.
  assert.equal(/color-scheme/.test(page), false);
  assert.equal(/color-scheme/.test(index), false, 'the index must not flip a dark browser to light');
});

test('the index page is the only external reference the site adds', () => {
  // SECURITY.md enumerates every external request the published site makes,
  // so a second one has to be a red test rather than a discovery. The index
  // links the same Google Fonts stylesheet the rendered pages link; nothing
  // else may join it. Asserting the link is present pins it in — this bounds
  // the set, which is the direction that matters.
  //
  // Same width as the render test, and stated for the same reason: this reads
  // src and href on a script, link or img element. A CSS @import, a url(), a
  // fetch or an iframe would be a second way out and this test stays green.
  const dir = tree();
  run(buildIn(dir), [], { cwd: dir });
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  const external = index.match(/<(?:script|link|img)[^>]+(?:src|href)="(https?:[^"]*)"/gi) || [];
  assert.equal(external.length, 1, `unexpected external references: ${external.join(', ')}`);
  assert.match(external[0], /^<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\//);
  assert.equal(/<script[^>]+src=/i.test(index), false, 'no script is loaded from a URL');
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
