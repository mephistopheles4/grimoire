// The contract skill's hiring page, at the seam the skill uses: the
// interview script's --out flag. What only a browser shows (keyboard-only
// completion, the notices on screen, copy, restore after a close, Forget, the
// policy enforced, reduced motion) is on the named checklist of spec v4 S9 on
// #313, run in the built-in browser before the PR opens.
//
// Nothing here commits a fixture. Every draft is derived from the shipped
// example or the measurement draft and written to a temporary folder.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { contractModule, contractRender, measurementDraft, root, run, scriptBlocks } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-contract-page-'));
after(() => rmSync(work, { recursive: true, force: true }));

const example = join(root, 'skills', 'contract', 'examples', 'release-notes.interview.json');
const template = readFileSync(join(root, 'skills', 'contract', 'assets', 'template.html'), 'utf8');
const Interview = createRequire(import.meta.url)(contractModule);
const kinds = JSON.parse(readFileSync(join(root, 'skills', 'contract', 'scripts', 'kinds.json'), 'utf8'));
const posix = process.platform !== 'win32';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

let n = 0;
/** A folder named as the interview script names its scratch folders. */
const scratch = () => {
  const dir = join(work, `contract-interview-${(n++).toString(16).padStart(16, '0')}`);
  mkdirSync(dir);
  return dir;
};
/** A draft derived from `source`, written to `dir`. */
function derive(source, mutate, dir = work, name = `case-${n++}.interview.json`) {
  const draft = JSON.parse(readFileSync(source, 'utf8'));
  if (mutate) mutate(draft);
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(draft, null, 2));
  return p;
}
function render(draftFile, pageFile, ...flags) {
  const r = run(contractRender, [draftFile, '--out', pageFile, ...flags]);
  assert.equal(r.code, 0, r.stderr);
  return readFileSync(pageFile, 'utf8');
}
/** The page's data, read back from its script block as the page reads it. */
function dataOf(html) {
  const blocks = scriptBlocks(html);
  const page = blocks[blocks.length - 1];
  const m = /const D = ([\s\S]*?);\nconst draft = D\.draft;/.exec(page);
  assert.ok(m, 'the page script holds its data line');
  return { text: m[1], value: JSON.parse(m[1]) };
}

/* -- claim 3: the page shows every draft string as text --------------------- */

const HOSTILE = '</script><!--<script>alert(1)</script>"quoted" <b>markup</b> $& $\' $` /*MODULE*/ /*DATA*/';

test('--out writes a page that holds every hostile draft string as data, inside its own script block', () => {
  const file = derive(example, d => {
    d.title = `Release notes ${HOSTILE}`.replace(/[\r\n]/g, ' ');
    for (const list of Object.values(d.parts)) for (const c of list) if (c.fields) for (const k of Object.keys(c.fields)) {
      if (k === 'choice' || k === 'status' || (c.kind === 'why')) continue;
      c.fields[k] = `${c.fields[k]} ${HOSTILE}`;
    }
    for (const q of d.questions) { q.situation += ` ${HOSTILE}`; for (const o of q.options) o.label += ` ${HOSTILE}`; }
  });
  const html = render(file, join(work, `hostile-${n++}.html`));
  // The tokenizer sees the template's three script elements and no more: no
  // draft string closed one or opened another.
  const blocks = scriptBlocks(html);
  assert.equal(blocks.length, (template.match(/<script>/g) || []).length);
  assert.match(blocks[1], /const Interview = \(\(\) => \{/, 'the module is in its block, not in the title');
  assert.match(blocks[2], /render\(\);\s*$/, 'the page script ends where the template ends it');
  // The data parses back to the draft it came from, and holds no raw "<".
  const { text, value } = dataOf(html);
  assert.ok(!text.includes('<'), 'a raw "<" in the inlined data');
  assert.deepEqual(value.draft, JSON.parse(readFileSync(file, 'utf8')));
  // The title is element content with its markup characters dropped.
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1];
  assert.ok(!/[<>&]/.test(title.replace(/^Hiring interview: /, '')), title);
});

test('every script block of a rendered page compiles', () => {
  const html = render(example, join(work, `compile-${n++}.html`));
  for (const [i, block] of scriptBlocks(html).entries()) {
    assert.doesNotThrow(() => new vm.Script(block, { filename: `script ${i}` }), `script block ${i} does not compile`);
  }
});

test('the template puts no slot in an attribute, and uses no style attribute and no inline handler', () => {
  for (const line of template.split('\n')) {
    if (/\/\*(TITLE|AVIATION|FONTS|DATA|MODULE)\*\//.test(line)) assert.doesNotMatch(line.replace(/<title>.*<\/title>/, ''), /=\s*"[^"]*\/\*[A-Z]+\*\//, line);
  }
  assert.match(template, /<meta http-equiv="Content-Security-Policy" content="\/\*CSP\*\/">/);
  const markup = template.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(markup, /\sstyle\s*=/i, 'a style attribute');
  assert.doesNotMatch(markup, /\son[a-z]+\s*=/i, 'an inline handler');
  // Nor does the page script build either one.
  const page = template.slice(template.lastIndexOf('<script>'));
  assert.doesNotMatch(page, /setAttribute\(\s*'(style|on[a-z]+)'/);
  assert.doesNotMatch(page, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/);
});

test('the page loads nothing from the network, and its policy allows exactly its own scripts and styles', () => {
  const html = render(example, join(work, `plain-${n++}.html`));
  assert.doesNotMatch(html, /<(link|img|iframe|object|embed|audio|video|source)\b/i);
  assert.doesNotMatch(html, /\s(src|href|srcset|action|formaction)\s*=/i);
  assert.doesNotMatch(html, /@import/i);
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")\s]{0,12})/g)) assert.ok(m[2].startsWith('data:'), `a url() that is not inline data: ${m[2]}`);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)[1];
  const policy = new Map(csp.split('; ').map(d => { const [k, ...v] = d.split(' '); return [k, v]; }));
  assert.deepEqual(policy.get('default-src'), ["'none'"]);
  assert.deepEqual(policy.get('base-uri'), ["'none'"]);
  assert.deepEqual(policy.get('form-action'), ["'none'"]);
  assert.deepEqual(policy.get('font-src'), ['data:']);
  assert.deepEqual(policy.get('img-src'), ['data:']);
  const hashes = tag => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  assert.deepEqual(policy.get('script-src'), hashes('script'));
  assert.deepEqual(policy.get('style-src'), hashes('style'));
  // The policy comes before anything it governs.
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'));
});

test('no control or subtitle on the page names a shape', () => {
  const page = template.slice(template.lastIndexOf('<script>'));
  const strings = [...page.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2]);
  const text = template.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ');
  for (const s of [...strings, text]) assert.doesNotMatch(s, /\b(tables?|lists?|rows?|columns?)\b/i, s);
});

test('a CLAUDE.md draft renders with the plain frames and no letter', () => {
  const file = derive(example, d => {
    d.type = 'CLAUDE.md';
    d.name = 'release-tools';
    d.parts.purpose = d.parts.purpose.filter(c => c.kind !== 'name');
  });
  const html = render(file, join(work, `claude-md-${n++}.html`));
  assert.equal(dataOf(html).value.draft.type, 'CLAUDE.md');
  const page = scriptBlocks(html).at(-1);
  assert.match(page, /const PLAIN = draft\.type === 'CLAUDE\.md';\nconst FRAME = PLAIN \? 'plain' : 'hiring';/);
  assert.match(page, /if \(!PLAIN\) sheet\.append\(h\('div', \{ class: 'sig' \}/);
});

/* -- the fill, in one pass (q20's review, moved here from issue 343) ---------- */

test('slots are filled in one pass: a title that spells a later slot takes no fill', () => {
  const file = derive(example, d => { d.title = 'Notes /*AVIATION*/ /*FONTS*/ /*MODULE*/ /*DATA*/ /*CSP*/'; });
  const html = render(file, join(work, `slots-${n++}.html`));
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1];
  assert.equal(title, 'Hiring interview: Notes /*AVIATION*/ /*FONTS*/ /*MODULE*/ /*DATA*/ /*CSP*/');
  assert.match(scriptBlocks(html)[1], /const Interview = /);
  assert.equal(html.split('const Interview = (() =>').length, 2, 'the module appears once');
});

/* -- claim 4: --out's refusals and the page's mode --------------------------- */

test('--out refuses a target that does not end in .html, and writes nothing', () => {
  const target = join(work, `page-${n++}.htm`);
  const r = run(contractRender, [example, '--out', target]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /ends in \.html/);
  assert.ok(!existsSync(target));
});

test('--out refuses an existing file that is not its own page, and leaves it as it was', () => {
  const target = join(work, `theirs-${n++}.html`);
  writeFileSync(target, '<!doctype html>\n<p>someone else\'s page</p>\n');
  const before = readFileSync(target);
  const r = run(contractRender, [example, '--out', target]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not a page this script wrote/);
  assert.deepEqual(readFileSync(target), before);
  // Its own page it replaces.
  const own = join(work, `own-${n++}.html`);
  render(example, own);
  render(example, own, '--shared');
  assert.equal(dataOf(readFileSync(own, 'utf8')).value.shared, true);
});

test('--out refuses a draft its check refuses, and writes no page', () => {
  const file = derive(example, d => { d.parts.roles[0].mark = 'Decided'; });
  const target = join(work, `refused-${n++}.html`);
  const r = run(contractRender, [file, '--out', target]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /parts\.roles\[0\]\.mark/);
  assert.ok(!existsSync(target));
});

test('the page is mode 600 wherever it lands unless --site is given; a draft outside a scratch folder keeps its mode', { skip: !posix && 'POSIX modes' }, () => {
  const loose = derive(example);
  chmodSync(loose, 0o644);
  const outside = join(work, `outside-${n++}.html`);
  render(loose, outside);
  assert.equal(statSync(outside).mode & 0o777, 0o600);
  assert.equal(statSync(loose).mode & 0o777, 0o644, 'a draft outside a scratch folder changed mode');
  const dir = scratch();
  const inside = derive(example, null, dir, 'draft.interview.json');
  chmodSync(inside, 0o644);
  render(inside, join(dir, 'interview.html'));
  assert.equal(statSync(inside).mode & 0o777, 0o600);
  const site = join(work, `site-${n++}.html`);
  render(example, site, '--site');
  assert.notEqual(statSync(site).mode & 0o777, 0o600);
});

/* -- claim 5: what a question shows before a pick ---------------------------- */

test('a high-stakes question shows no proposal and no fields until the person picks; stakes come from kinds.json', () => {
  const draft = JSON.parse(readFileSync(example, 'utf8'));
  assert.deepEqual(Interview.reveal(draft, kinds, 'stop-gap', false), { high: true, proposal: false, fields: false });
  assert.deepEqual(Interview.reveal(draft, kinds, 'stop-gap', true), { high: true, proposal: true, fields: true });
  assert.deepEqual(Interview.reveal(draft, kinds, 'job', false), { high: false, proposal: true, fields: true });
  // Flip the table, and the same draft follows it.
  const flipped = { ...kinds, kinds: kinds.kinds.map(k => (k.id === 'job' ? { ...k, stakes: 'high' } : k.id === 'stop' ? { ...k, stakes: 'low' } : k)) };
  assert.equal(Interview.reveal(draft, flipped, 'job', false).proposal, false);
  assert.equal(Interview.reveal(draft, flipped, 'stop-gap', false).proposal, true);
  // A draft cannot say otherwise: a clause carrying stakes is refused.
  const r = run(contractRender, [derive(example, d => { d.parts.roles[4].stakes = 'low'; }), '--check']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /parts\.roles\[4\]: unknown key "stakes"/);
  // The page asks the module, and shows the options' wording only when it says so.
  const page = template.slice(template.lastIndexOf('<script>'));
  assert.match(page, /const r = q \? Interview\.reveal\(draft, kinds, x\.id, S\.answers\.has\(x\.id\)\)/);
  assert.match(page, /if \(!r\.fields\) return `\[\$\{opening\(q\.situation\)\}\]`;/);
  assert.match(page, /showSays \? h\('span', \{ class: 'says' \}/);
});

/* -- claim 13: --site, and the folder line ----------------------------------- */

test('--site builds a page with no store, no Forget and no folder, saying it keeps nothing', () => {
  const dir = scratch();
  const draft = derive(example, null, dir, 'draft.interview.json');
  const html = render(draft, join(dir, 'interview.html'), '--site');
  const { value } = dataOf(html);
  assert.equal(value.site, true);
  assert.equal(value.folder, null);
  const page = scriptBlocks(html).at(-1);
  // The store is the one way the page reaches saved answers, and --site
  // gives it none; the only other storage it touches is the theme key.
  assert.match(page, /const store = D\.site \? null : /);
  const uses = [...page.matchAll(/localStorage\.([a-zA-Z]+)\(\s*'([^']*)'/g)].map(m => m[2]);
  assert.deepEqual([...new Set(uses)], ['aviation-scheme']);
  assert.equal((page.match(/window\.localStorage/g) || []).length, 1);
  assert.match(page, /if \(D\.site\) box\.append\(h\('p', null, 'This example keeps nothing\.'\)\);/);
  assert.match(page, /if \(!D\.site\) \{\n\s+const forget = /);
  // And the module, given no store, reads and writes nothing.
  const d = JSON.parse(readFileSync(example, 'utf8'));
  const hashes = { draft: 'a'.repeat(64), kinds: 'b'.repeat(64) };
  assert.equal(Interview.save(null, d, kinds, hashes, { answers: new Map([['job', { option: 'job-a' }]]), edits: [] }), false);
  assert.equal(Interview.restore(null, d, kinds, hashes).count, 0);
  assert.equal(Interview.forget(null, d), 0);
});

test('the top bar names a scratch folder, and no other folder', () => {
  const dir = scratch();
  const inside = render(derive(example, null, dir, 'draft.interview.json'), join(dir, 'interview.html'));
  assert.equal(dataOf(inside).value.folder, basename(dir));
  const outside = render(example, join(work, `elsewhere-${n++}.html`));
  assert.equal(dataOf(outside).value.folder, null);
});

test('no rendered page holds the running account\'s home folder, --site included', () => {
  const home = homedir();
  const forms = [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')];
  for (const flags of [[], ['--site'], ['--shared']]) {
    const dir = scratch();
    const html = render(derive(example, null, dir, 'draft.interview.json'), join(dir, 'interview.html'), ...flags);
    for (const f of forms) assert.ok(!html.includes(f), `the page holds the home folder (${flags.join(' ') || 'no flag'})`);
  }
});

/* -- claim 22: the page budget ----------------------------------------------- */

/* The page rendered from the measurement draft sets the budget, at the same
 * multiple as the limits (spec v4.1 S7 on #313): four times its size when
 * measured, 2026-10-18, at 373,180 bytes. The figure and the multiple go
 * into the threat model's limits entry with the owner's diff. */
const PAGE_BUDGET = 4 * 373180;

test('the page from the measurement draft is within the page budget', () => {
  const html = render(measurementDraft, join(work, `budget-${n++}.html`));
  assert.ok(Buffer.byteLength(html) <= PAGE_BUDGET, `${Buffer.byteLength(html)} bytes, over the budget of ${PAGE_BUDGET}`);
});

/* -- the assets -------------------------------------------------------------- */

/* The bundle comes from the Aviation design system at the merge commit of its
 * pull request 10, the first to carry the réseau ground (spec v4.2 S8). */
const BUNDLE = { commit: '6297a045e668d1c29beb11b1590c9519a38ad8c2', sha256: '2090155c4c687ff4cbe1cc4d334e72ff56b0e705e00275a6398dc2ff5cd11d54' };

test('the fonts and their licence are byte for byte groundtrack\'s, and the bundle is the pinned one', () => {
  const mine = join(root, 'skills', 'contract', 'assets');
  const theirs = join(root, 'skills', 'groundtrack', 'assets');
  const copied = ['Regular', 'Medium', 'SemiBold'].flatMap(w => [`IBMPlexMono-${w}-Latin1.woff2`, `IBMPlexMono-${w}-Pi.woff2`]).concat(['OFL.txt', 'FONTS.md']);
  assert.equal(copied.length, 8);
  for (const f of copied) assert.equal(sha(readFileSync(join(mine, f))), sha(readFileSync(join(theirs, f))), f);
  assert.equal(sha(readFileSync(join(mine, 'aviation.bundle.css'))), BUNDLE.sha256, `aviation.bundle.css is not the bundle at ${BUNDLE.commit}`);
});
