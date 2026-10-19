// The contract skill's hiring page, at the seam the skill uses: the
// interview script's --out flag. A few tests run the rendered page's own
// scripts on a small stand-in document, to drive its logic: what it draws at
// load, and what a press or a keystroke leaves in its store. What only a
// browser shows (keyboard-only completion, real focus and pointer events,
// copy, restore after a close, the policy enforced, reduced motion) is on the
// named checklist of spec v4 S9 on #313, run in the built-in browser before
// the PR opens.
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
  assert.match(page, /if \(!PLAIN && shown === paras\.length\) sheet\.append\(h\('div', \{ class: 'sig' \}/);
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

test('--site builds a page with no store, no Reset and no folder, saying it keeps nothing', () => {
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
  assert.match(page, /D\.site \? null : resetButton\(\),/);
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
 * measured, 2026-10-18, at the head of the review of issue 344, at 381,464
 * bytes. The figure and the multiple go into the threat model's limits entry
 * with the owner's diff. */
const PAGE_BUDGET = 4 * 381464;

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

/* -- the page's own logic, run on a stand-in document ------------------------- */

/* A document just big enough for the page script: elements with children,
 * properties, a class list and listeners; focus that moves and fires blur
 * and focus; and a selector matcher for the selectors the page uses. A
 * selector it does not know throws, so a page change that needs more says
 * so. Reduced motion is on, so no animation runs. Timers run on a hand
 * clock. */
function standIn() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  const clock = {
    setTimeout: (fn, ms = 0) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
  const compound = part => {
    const m = /^([a-z0-9]*|\*)((?:\.[a-zA-Z0-9_-]+)*)((?::not\(\[[a-z]+\]\))*)$/.exec(part);
    if (!m) throw new Error(`the stand-in document does not know the selector ${part}`);
    const classes = m[2].split('.').filter(Boolean);
    const nots = [...m[3].matchAll(/:not\(\[([a-z]+)\]\)/g)].map(x => x[1]);
    return el => (m[1] === '' || m[1] === '*' || el.tagName === m[1].toUpperCase())
      && classes.every(c => el.classList.contains(c))
      && nots.every(a => !(el[a] || el.hasAttribute(a)));
  };
  const matcher = selector => {
    const steps = selector.trim().split(/\s+/).map(compound);
    return el => {
      if (!steps[steps.length - 1](el)) return false;
      let i = steps.length - 2;
      for (let up = el.parentElement; up && i >= 0; up = up.parentElement) if (steps[i](up)) i--;
      return i < 0;
    };
  };
  let doc = null;
  /** An event at `target`, bubbling to the document unless told not to. */
  function fire(target, type, init = {}) {
    let stopped = false;
    const e = { type, target, key: init.key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
    const path = [target];
    if (init.bubbles !== false) {
      for (let x = target.parentNode; x; x = x.parentNode) path.push(x);
      path.push(doc);
    }
    for (const x of path) {
      for (const fn of (x.listeners.get(type) || []).slice()) fn(e);
      if (stopped) break;
    }
    return e;
  }
  class Text {
    constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
    get textContent() { return this.data; }
  }
  class El {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = tag.toUpperCase();
      this.childNodes = [];
      this.parentNode = null;
      this.attrs = new Map();
      this.listeners = new Map();
      this.style = {};
      this.hidden = false;
      const names = new Set();
      this.classList = {
        add: (...c) => c.forEach(x => names.add(x)),
        remove: (...c) => c.forEach(x => names.delete(x)),
        toggle: (c, on = !names.has(c)) => { if (on) names.add(c); else names.delete(c); return on; },
        contains: c => names.has(c),
        names,
      };
      if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') { this.value = ''; this.selectionStart = 0; this.selectionEnd = 0; }
    }
    get className() { return [...this.classList.names].join(' '); }
    set className(v) { this.classList.names.clear(); for (const c of String(v).split(/\s+/)) if (c) this.classList.names.add(c); }
    get parentElement() { return this.parentNode instanceof El ? this.parentNode : null; }
    get children() { return this.childNodes.filter(x => x instanceof El); }
    get textContent() { return this.childNodes.map(x => x.textContent).join(''); }
    set textContent(v) { this.replaceChildren(String(v)); }
    get innerText() { return this.textContent; }
    get offsetHeight() { return 0; }
    get scrollHeight() { return 0; }
    append(...kids) {
      for (const k of kids) {
        const node = typeof k === 'string' ? new Text(k) : k;
        if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    replaceChildren(...kids) {
      for (const x of this.childNodes) x.parentNode = null;
      this.childNodes = [];
      this.append(...kids);
    }
    remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
    contains(x) { for (let y = x; y; y = y.parentNode) if (y === this) return true; return false; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    removeAttribute(k) { this.attrs.delete(k); }
    hasAttribute(k) { return this.attrs.has(k); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(s) { return this.descendants().filter(matcher(s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    matches(s) { return matcher(s)(this); }
    closest(s) { const m = matcher(s); for (let x = this; x; x = x.parentElement) if (m(x)) return x; return null; }
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    scrollIntoView() {}
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    /* Focus moves: the element that had it gets blur, even when a redraw
     * has already taken it out of the page, as some browsers do. */
    focus() {
      const was = doc.activeElement;
      if (was === this) return;
      doc.activeElement = this;
      if (was && was !== doc.body) fire(was, 'blur', { bubbles: false });
      fire(this, 'focus', { bubbles: false });
    }
    blur() { if (doc.activeElement === this) { doc.activeElement = doc.body; fire(this, 'blur', { bubbles: false }); } }
  }
  const html = new El('html');
  const body = new El('body');
  const app = new El('div');
  app.id = 'app';
  body.append(app);
  html.append(body);
  doc = {
    documentElement: html,
    body,
    activeElement: body,
    listeners: new Map(),
    createElement: tag => new El(tag),
    createElementNS: (ns, tag) => new El(tag),
    createTextNode: data => new Text(data),
    getElementById: id => html.descendants().find(el => el.id === id) || null,
    querySelectorAll: s => html.querySelectorAll(s),
    querySelector: s => html.querySelector(s),
    addEventListener: El.prototype.addEventListener,
  };
  return { doc, clock, fire };
}

/** A page rendered from the shipped example and loaded on a stand-in
 *  document. Its store holds `seed` when given, saved by the module the page
 *  inlines, under the page's own hashes. */
const pages = new Map();
function loadPage({ flags = [], seed } = {}) {
  const at = flags.join(' ');
  if (!pages.has(at)) pages.set(at, render(example, join(work, `logic-${n++}.html`), ...flags));
  const html = pages.get(at);
  const D = dataOf(html).value;
  const map = new Map();
  const store = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  if (seed) Interview.save(store, D.draft, D.kinds, D.hashes, seed);
  const { doc, clock, fire } = standIn();
  const sandbox = {
    document: doc,
    localStorage: store,
    matchMedia: () => ({ matches: true }),
    navigator: {},
    innerHeight: 800,
    addEventListener() {},
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const [i, block] of scriptBlocks(html).entries()) vm.runInContext(block, ctx, { filename: `script ${i}` });
  const all = () => doc.documentElement.descendants();
  const prefix = `contract-interview:${D.draft.type}:${D.draft.name}:`;
  return {
    D, map, clock, doc,
    key: k => all().find(el => el.pageKey === k) || null,
    keys: start => all().filter(el => typeof el.pageKey === 'string' && el.pageKey.startsWith(start)),
    text: () => doc.documentElement.textContent,
    /** The block saved under this draft's key, or null. */
    saved: () => (map.has(prefix + D.hashes.draft) ? JSON.parse(map.get(prefix + D.hashes.draft)).block : null),
    click: el => fire(el, 'click'),
    /** A press as a pointer makes it: focus, then click. */
    press: el => { el.focus(); fire(el, 'click'); },
    type: (el, value) => { el.value = value; fire(el, 'input'); },
    fire,
  };
}

test('a page whose store holds an edit of every kind loads, and names each change', () => {
  const edits = [
    { op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'a restored duty' } },
    { op: 'rename', part: 'roles', kind: 'duty', name: 'Chores' },
    { op: 'move', id: 'duty-read', to: 1 },
    { op: 'remove', id: 'stays-out-one-pr' },
    { op: 'rekind', id: 'duty-group', kind: 'checked', fields: { what: 'the changes', by: 'a person' } },
    { op: 'none', part: 'roles', kind: 'trigger' },
  ];
  let page;
  assert.doesNotThrow(() => { page = loadPage({ seed: { answers: new Map(), edits } }); });
  const text = page.text();
  assert.doesNotMatch(text, /did not fit this draft/, 'the seeded edits were dropped, so the test proves nothing');
  assert.match(text, /Changes brought back from this browser/);
  assert.match(text, /Added an entry: a duty/);
  assert.match(text, /Renamed a schedule: a duty in roles/);
  assert.match(text, /Moved [^.]*\(duty-read\)/);
  assert.match(text, /Removed [^.]*\(stays-out-one-pr\)/);
  assert.match(text, /Changed the kind of [^.]*\(duty-group\)/);
  assert.match(text, /Agreed where its trigger lives in roles holds none/);
  assert.doesNotMatch(text, /Forget/, 'the page still names Forget');
});

test('the notices are open at load, on a page from disk and on the published example, and the info button toggles them', () => {
  for (const [flags, says] of [[[], /Your answers are kept in this browser until you press Reset/], [['--site'], /This example keeps nothing\./]]) {
    const page = loadPage({ flags });
    assert.match(page.text(), says, `the notice at load (${flags.join(' ') || 'no flag'})`);
    assert.equal(page.key('info').getAttribute('aria-expanded'), 'true');
    page.click(page.key('info'));
    assert.doesNotMatch(page.text(), says, 'the info button closes the notices');
    assert.equal(page.key('info').getAttribute('aria-expanded'), 'false');
    page.click(page.key('info'));
    assert.match(page.text(), says, 'and opens them again');
  }
});

test('Reset holds against a second press and a long stay on the button; Undo works only when chosen within ten seconds', () => {
  const seed = () => ({ answers: new Map([['job', { option: 'job-b' }]]), edits: [] });
  const page = loadPage({ seed: seed() });
  const entries = p => [...p.map.keys()].filter(k => k.startsWith(`contract-interview:${p.D.draft.type}:${p.D.draft.name}:`));
  assert.ok(page.saved(), 'the seeded answer is in the store');
  page.press(page.key('reset'));
  assert.equal(page.saved(), null, 'Reset left the answers in the store');
  assert.match(page.key('reset').getAttribute('aria-label'), /^Reset\. Leave and come back within ten seconds to undo$/, 'the Reset tip does not say how to undo');
  // A double-click, or a second Enter, with the focus still on the button.
  page.press(page.key('reset'));
  assert.equal(page.saved(), null, 'a second press at once wrote the answers back');
  assert.doesNotMatch(page.text(), /Undone/);
  // The pointer leaves while the focus stays, and Enter comes before any return.
  page.fire(page.key('reset'), 'mouseleave', { bubbles: false });
  page.clock.tick(100);
  page.click(page.key('reset'));
  assert.equal(page.saved(), null, 'Undo was offered after a leave with no return');
  // That press redraws the page, which puts the focus back on the new
  // button: the page's own refocus is no return, so a second Enter undoes nothing.
  assert.ok(!page.key('reset').classList.contains('armed'), 'the redraw\'s own refocus counted as a return');
  page.click(page.key('reset'));
  assert.equal(page.saved(), null, 'a second Enter after the leave undid Reset');
  // Nor does a click elsewhere that redraws the page and leaves the focus on Reset.
  page.fire(page.key('reset'), 'mouseleave', { bubbles: false });
  page.clock.tick(1000);
  page.click(page.key('info'));
  page.click(page.key('reset'));
  assert.equal(page.saved(), null, 'a redraw after the leave counted as a return');
  page.click(page.key('info'));
  // The focus stays past the ten seconds, then leaves and comes back.
  page.clock.tick(11000);
  page.key('reset').blur();
  page.press(page.key('reset'));
  assert.equal(page.saved(), null, 'Undo was still offered after ten seconds');
  // A later save writes no entry until the person answers again.
  page.click(page.key('info'));
  assert.deepEqual(entries(page), [], 'a save after Reset wrote an entry back');
  // Saving starts again with the next answer, and an answer taken back is gone from the store too.
  page.click(page.key('mode'));
  const why = page.key('why:why');
  why.textContent = 'mine';
  page.fire(why, 'input');
  assert.equal(page.saved().answers[0].id, 'why', 'the first answer after Reset was not saved');
  why.textContent = '';
  page.fire(why, 'input');
  assert.deepEqual(page.saved().answers, [], 'an answer taken back after Reset stayed in the store');
  // A leave late in the ten seconds does not start them again.
  const late = loadPage({ seed: seed() });
  late.press(late.key('reset'));
  late.clock.tick(9000);
  late.key('reset').blur();
  late.clock.tick(2000);
  late.press(late.key('reset'));
  assert.equal(late.saved(), null, 'a late leave started the ten seconds again');
  // Undo chosen on purpose: leave the button, come back, press, in time.
  const again = loadPage({ seed: seed() });
  again.press(again.key('reset'));
  again.clock.tick(1500);
  again.key('reset').blur();
  again.press(again.key('reset'));
  assert.equal((again.saved() || { answers: [] }).answers[0]?.id, 'job', 'Undo chosen within ten seconds did not put the answers back');
  assert.match(again.text(), /Undone: your answers are back\./);
  // A quick leave counts too, by the pointer: off the button at once, back later, in time.
  const quick = loadPage({ seed: seed() });
  quick.press(quick.key('reset'));
  quick.clock.tick(500);
  quick.fire(quick.key('reset'), 'mouseleave', { bubbles: false });
  quick.clock.tick(2000);
  quick.fire(quick.key('reset'), 'mouseenter', { bubbles: false });
  quick.click(quick.key('reset'));
  assert.ok(quick.saved(), 'Undo was not offered after a quick pointer leave and return within ten seconds');
  // A new answer after Reset withdraws Undo, so it never puts the cleared answers over newer work.
  const newer = loadPage({ seed: seed() });
  newer.press(newer.key('reset'));
  newer.click(newer.key('blank:job'));
  newer.fire(newer.key('opt:job-c'), 'change');
  assert.equal(newer.saved().answers[0].option, 'job-c');
  newer.key('reset').blur();
  newer.press(newer.key('reset'));
  assert.doesNotMatch(newer.text(), /Undone/, 'Undo put the cleared answers over a newer pick');
});

test('a planted restored value keeps its restored mark until its own Keep: a typed edit, a chip, skip or flag tap keeps the mark, and a new pick or Agree takes no planted chip or flag', () => {
  const D = dataOf(render(example, join(work, `planted-${n++}.html`))).value;
  const answerOf = (page, id) => page.saved().answers.find(a => a.id === id);
  // A keystroke in each of a planted answer's fields: the answer, its chip
  // and its flag stay restored and Proposed, each field holding what was typed.
  const edited = loadPage({ seed: { answers: new Map([['job', { fields: { does: 'planted does', for: 'planted for' }, chip: 0, flag: true }]]), edits: [] } });
  edited.click(edited.key('blank:job'));
  edited.type(edited.key('field:job:does'), 'planted does!');
  edited.type(edited.key('field:job:for'), 'planted for!');
  assert.deepEqual(answerOf(edited, 'job'), { id: 'job', fields: { does: 'planted does!', for: 'planted for!' }, mark: 'Proposed', chip: 0, flag: true, restored: true }, 'a typed edit took a planted answer as the person\'s');
  assert.match(edited.text(), /1 answer came back from this browser\. Each shows a dotted line, even as you type in it, until you press its Keep; Agree or a new pick replaces it\./);
  edited.click(edited.key('sign'));
  assert.match(edited.text(), /1restored, not kept yet/, 'the tally does not count the restored answer as not kept');
  edited.click(edited.key('sign'));
  // The question's own Keep makes the restored answer the person's.
  if (!edited.key('done:job')) edited.click(edited.key('blank:job'));
  assert.ok(edited.key('keep:job'), 'a restored answer to a question has no Keep');
  edited.click(edited.key('keep:job'));
  assert.equal(answerOf(edited, 'job').restored, undefined, 'a restored answer to a question has no Keep');
  // The same for the name heading, whose Agree then takes the drafted name
  // and no planted flag, and for the why blank, kept only by its own Keep.
  const named = loadPage({ seed: { answers: new Map([['name', { fields: { name: 'planted' }, flag: true }], ['why', { fields: { text: 'planted why' } }]]), edits: [] } });
  named.type(named.key('field:name:name'), 'planted!');
  assert.deepEqual(answerOf(named, 'name'), { id: 'name', fields: { name: 'planted!' }, mark: 'Proposed', flag: true, restored: true }, 'a typed edit took a planted name as the person\'s');
  named.click(named.key('agree:name'));
  assert.deepEqual(answerOf(named, 'name'), { id: 'name', fields: D.draft.parts.purpose.find(c => c.id === 'name').fields, mark: 'Confirmed' }, 'Agree kept a planted flag');
  named.click(named.key('mode'));
  const why = named.key('why:why');
  why.textContent = 'planted why!';
  named.fire(why, 'input');
  assert.deepEqual(answerOf(named, 'why'), { id: 'why', fields: { text: 'planted why!' }, mark: 'Proposed', restored: true }, 'a typed edit took a planted why as the person\'s');
  named.click(named.key('keep:why'));
  assert.deepEqual(answerOf(named, 'why'), { id: 'why', fields: { text: 'planted why!' }, mark: 'Decided' }, 'the why\'s own Keep did not keep it');
  // The name and the why warn on a key or an email, as every other typed field does.
  const warns = () => named.doc.documentElement.querySelectorAll('.warn').map(w => w.textContent).filter(Boolean);
  named.type(named.key('field:name:name'), `ghp_${'A1b2C3d4E5'.repeat(4)}`);
  assert.match(warns().join('\n'), /^This holds a key-shaped value\. It is already kept in this browser/m, 'the name took a key with no warning');
  const why2 = named.key('why:why');
  why2.textContent = 'write to a@example.org';
  named.fire(why2, 'input');
  assert.equal(warns().filter(w => /^This holds an email address\./.test(w)).length, 1, 'the why took an email with no warning');
  // A chip, skip or flag tap on a planted pick leaves it restored.
  const tapped = loadPage({ seed: { answers: new Map([['job', { option: 'job-b' }]]), edits: [] } });
  tapped.click(tapped.key('blank:job'));
  for (const press of [p => p.keys('chip:job:')[0], p => p.key('chip:job:skip'), p => p.key('flag:job')]) {
    tapped.click(press(tapped));
    assert.equal(answerOf(tapped, 'job').restored, true, 'a tap cleared the restored mark');
  }
  // A new pick replaces the planted value, and brings no planted chip or flag with it.
  const picked = loadPage({ seed: { answers: new Map([['job', { option: 'job-b', chip: 0, flag: true }]]), edits: [] } });
  assert.equal(answerOf(picked, 'job').chip, 0, 'the seeded chip came back');
  assert.equal(answerOf(picked, 'job').flag, true, 'the seeded flag came back');
  picked.click(picked.key('blank:job'));
  picked.fire(picked.key('opt:job-c'), 'change');
  assert.deepEqual(answerOf(picked, 'job'), { id: 'job', option: 'job-c', mark: 'Confirmed' });
  // A field edit on a planted added entry leaves the entry a proposal.
  const added = { op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'planted duty' } };
  const entry = loadPage({ seed: { answers: new Map(), edits: [added] } });
  entry.click(entry.key('mode'));
  entry.type(entry.key('field:added-1:text'), 'planted duty, and mine');
  assert.equal(entry.saved().edits[0].restored, true, 'a field edit kept a planted entry without its Keep');
});

test('the answer block names a tapped chip by its place in the question, carries none of the draft\'s chip text, and reads back with the text', () => {
  const page = loadPage();
  const chips = page.D.draft.questions.find(q => q.clause === 'job').chips;
  page.click(page.key('blank:job'));
  page.fire(page.key('opt:job-b'), 'change');
  page.click(page.keys('chip:job:')[1]);
  page.click(page.key('sign'));
  const text = page.key('block').value;
  for (const c of chips) assert.ok(!text.includes(c), `the block carries the chip text ${JSON.stringify(c)}`);
  const block = JSON.parse(text.replace(/^```json\n|```\n$/g, ''));
  assert.equal(block.answers.find(a => a.id === 'job').chip, 1);
  // The script reads it back, and prints the chip's own text from the draft.
  const dir = scratch();
  writeFileSync(join(dir, 'answers.json'), text);
  const r = run(contractRender, [example, '--answers', join(dir, 'answers.json')]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`purpose/job picked .*; chip ${JSON.stringify(chips[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});
