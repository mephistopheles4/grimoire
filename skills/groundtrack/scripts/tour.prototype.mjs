// PROTOTYPE for #98 — throwaway, never merge. Stage 1 of the guided tour.
// Renders the three examples, splices four tour variants into each page, and
// serves them:
//   node skills/groundtrack/scripts/tour.prototype.mjs
//   → http://localhost:8731/greet-proto.html?variant=D
// Question: where do a tour's captions come from, and what can each source do?
//   ?variant=A  derived  — the renderer walks the page's own data-help notes
//   ?variant=B  authored — the file carries {target, caption}; reader's state untouched
//   ?variant=C  authored — the file carries {target, caption, state}; the tour drives the page
//   ?variant=D  B + C    — {target, state, region, what, now}. The winner.
// Only greet carries authored steps; B/C/D on the other two say so.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';

const scripts = dirname(fileURLToPath(import.meta.url));
const here = join(tmpdir(), 'grimoire-98-tour');
mkdirSync(here, { recursive: true });
for (const n of ['greet', 'pr-313', 'map-300-woodwork']) {
  execFileSync(process.execPath, [join(scripts, 'render.mjs'), resolve(scripts, '../examples', `${n}.flightpath.json`),
    '--out', join(here, `${n}.html`)], { stdio: 'ignore' });
}

// What the agent would author into the flightpath file. Only greet has one:
// that asymmetry is part of the answer.
const AUTHORED = {
  greet: {
    static: [
      { target: '#run', caption: 'Three recorded runs of greet. One succeeds, two fail in different ways. Pick one; everything else on the page follows it.' },
      { target: '#plan', caption: 'The change as a call graph: greet calls lookupName. Two boxes because this change touches two functions — nothing else runs.' },
      { target: '.btn-group', caption: 'Step the run one move at a time, or play it. The arrow keys do the same.' },
      { target: '#cut', caption: 'The cutaway is the source of whichever node the cursor is in. Step 1 is the only call that can fail.' },
      { target: '#stack', caption: 'Who called whom, right now. When lookupName is running it sits on top of greet.' },
      { target: '#errpath', caption: 'Where a throw travels. In "no such user" it stops at greet\'s catch; in "the post fails" nothing stops it.' },
      { target: '#ledger', caption: 'Every read and write to the outside world, in order: the db.get, then the POST.' },
      { target: '#titleblock', caption: 'What this file is: two nodes, three runs, two changed files. The traces were written by hand, not recorded.' },
    ],
    driven: [
      { target: '#plan', state: { run: 0, at: 0 }, caption: 'The change as a call graph: greet calls lookupName. This tour follows the one run that goes wrong on purpose.' },
      { target: '#run', state: { run: 1, at: 0 }, caption: 'Switched to "no such user". The lookup finds no row — watch where the failure goes.' },
      { target: '#cut', state: { run: 1, at: 2 }, caption: 'The cursor is in greet, on the call to lookupName. This is the only call that can fail.' },
      { target: '#stack', state: { run: 1, at: 5 }, caption: 'lookupName is on the stack above greet, and it has just thrown NoSuchUser.' },
      { target: '#errpath', state: { run: 1, at: 6 }, caption: 'The throw leaves lookupName and lands in greet\'s catch. The run survives.' },
      { target: '#ledger', state: { run: 1, at: 9 }, caption: 'Two effects so far: the empty db read, then the POST of the fallback "Hello there".' },
      { target: '#errpath', state: { run: 2, at: 'end' }, caption: 'Now "the post fails": the same POST, but it throws SendFailed and nothing catches it.' },
      { target: '.btn-group', state: { run: 0, at: 0 }, caption: 'That is the whole change. Back at the start of the happy run — step it yourself.' },
    ],
    // D: B's region explanation + C's walk. region = what it is (stable),
    // now = what the walk is showing there at this moment.
    mixed: [
      { target: '#plan', state: { run: 1, at: 0 }, region: 'The graph',
        what: 'The change as a call graph: greet calls lookupName. Two boxes because this change touches two functions — nothing else runs.',
        now: 'We\'ll follow "no such user", the run where the lookup finds nothing.' },
      { target: '#run', state: { run: 1, at: 0 }, region: 'Runs',
        what: 'Three recorded runs of greet. One succeeds, two fail in different ways. Everything else on the page follows the one picked here.',
        now: '"no such user" is picked. The cursor is at the start.' },
      { target: '#cut', state: { run: 1, at: 2 }, region: 'Cutaway',
        what: 'The source of whichever node the cursor is in, with the current step marked.',
        now: 'The cursor is in greet, on the call to lookupName — the only call that can fail.' },
      { target: '#stack', state: { run: 1, at: 5 }, region: 'Call stack',
        what: 'Who called whom, right now. The running node sits on top.',
        now: 'lookupName is on top of greet, and it has just thrown NoSuchUser.' },
      { target: '#errpath', state: { run: 1, at: 6 }, region: 'Error path',
        what: 'Where a throw travels, and where it stops.',
        now: 'The throw leaves lookupName and lands in greet\'s catch. The run survives.' },
      { target: '#ledger', state: { run: 1, at: 9 }, region: 'Effects ledger',
        what: 'Every read and write to the outside world, in order.',
        now: 'Two so far: the empty db read, then the POST of the fallback "Hello there".' },
      { target: '#errpath', state: { run: 2, at: 'end' }, region: 'Error path',
        what: 'Same region, different run: "the post fails".',
        now: 'The POST throws SendFailed and nothing catches it. The run ends uncaught.' },
      { target: '.btn-group', state: { run: 0, at: 0 }, region: 'Step controls',
        what: 'Step one move at a time, or play the run. The arrow keys do the same.',
        now: 'Back at the start of the happy run. Your turn.' },
    ],
  },
};

function inject(name) {
  const html = readFileSync(join(here, `${name}.html`), 'utf8');
  const authored = JSON.stringify(AUTHORED[name] || null).replace(/</g, '\\u003c');
  const block = `
<style id="proto98">
.p98-spot { position: fixed; z-index: 30; pointer-events: none; outline: 2px solid var(--av-caution, #c60);
  outline-offset: 2px; transition: all .18s ease; }
.p98-spot.scrim { box-shadow: 0 0 0 9999px color-mix(in srgb, var(--av-paper, #fff) 72%, transparent); }
.p98-card { position: fixed; z-index: 31; width: min(40ch, calc(100vw - 24px)); padding: 10px 12px;
  background: var(--av-paper, #fff); color: var(--av-ink, #000); border: 1px solid var(--av-ink, #000);
  font-size: var(--av-t-annot, 12px); line-height: 1.5; }
.p98-card.dock { left: 8px !important; right: 8px; width: auto; top: auto !important; bottom: 8px; border-width: 2px;
  font-size: 14px; }
.p98-card .k { text-transform: uppercase; letter-spacing: .08em; opacity: .7; font-size: 11px; display: flex; justify-content: space-between; }
.p98-now { margin-top: 8px; padding-left: 8px; border-left: 3px solid var(--av-caution, #c60); font-weight: 600; }
.p98-card .row { display: flex; gap: 6px; margin-top: 8px; }
.p98-card button { font: inherit; padding: 2px 8px; border: 1px solid currentColor; background: none; color: inherit; cursor: pointer; }
.p98-bar { position: fixed; z-index: 40; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
  background: #1b1030; color: #fff; font: 12px/1 system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; box-shadow: 0 6px 20px #0006; }
.p98-bar button { background: #fff2; color: #fff; border: 0; border-radius: 999px; padding: 5px 10px; cursor: pointer; font: inherit; }
.p98-bar label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
.p98-bar .lbl { min-width: 17ch; text-align: center; font-weight: 600; }
body.p98-dock .p98-bar { bottom: auto; top: 10px; }
</style>
<script id="proto98js">
(function () {
  var AUTHORED = ${authored};
  var KEYS = ['A', 'B', 'C', 'D'];
  var NAMES = { A: 'derived · data-help walk', B: 'authored · static', C: 'authored · drives page', D: 'B + C · explains and walks' };
  var q = new URLSearchParams(location.search);
  var v = KEYS.indexOf(q.get('variant')) >= 0 ? q.get('variant') : 'A';
  var LS = 'p98-seen-' + location.pathname;
  function ls(k, val) { try { if (val === undefined) return localStorage.getItem(k); if (val === null) localStorage.removeItem(k); else localStorage.setItem(k, val); } catch (e) { return null; } }
  var auto = q.get('auto') === '1';

  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; }
  function label(el) { return (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 28) || el.tagName.toLowerCase(); }

  function steps() {
    if (v === 'A') {
      return Array.prototype.filter.call(document.querySelectorAll('[data-help]'), visible).map(function (el) {
        return { el: el, caption: el.getAttribute('data-help'), head: label(el) };
      });
    }
    if (!AUTHORED) return null;
    return (v === 'B' ? AUTHORED.static : v === 'D' ? AUTHORED.mixed : AUTHORED.driven).map(function (s) { return s; });
  }

  // Drive the page through its own controls, the way a reader would.
  function applyState(s) {
    if (!s) return;
    var run = document.getElementById('run');
    if (run && String(run.value) !== String(s.run)) { run.value = String(s.run); run.dispatchEvent(new Event('change', { bubbles: true })); run.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('first').click();
    if (s.at === 'end') document.getElementById('last').click();
    else for (var i = 0; i < s.at; i++) document.getElementById('next').click();
  }

  var spot, card, list = null, idx = 0;
  function close() { if (spot) spot.remove(); if (card) card.remove(); spot = card = null; list = null; document.body.classList.remove('p98-dock'); }
  function place() {
    if (!list) return;
    var s = list[idx];
    var el = s.el || document.querySelector(s.target);
    if (!el) return;
    var r = el.getBoundingClientRect();
    spot.style.left = (r.left - 2) + 'px'; spot.style.top = (r.top - 2) + 'px';
    spot.style.width = (r.width + 4) + 'px'; spot.style.height = (r.height + 4) + 'px';
    if (v === 'C') return; // docked
    var cw = card.offsetWidth, ch = card.offsetHeight, W = innerWidth, H = innerHeight, x, y;
    if (r.bottom + ch + 14 < H) { y = r.bottom + 10; } else if (r.top - ch - 14 > 0) { y = r.top - ch - 10; } else { y = Math.min(H - ch - 12, r.top + 12); }
    x = Math.max(12, Math.min(W - cw - 12, r.left));
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }
  function show(i) {
    idx = Math.max(0, Math.min(list.length - 1, i));
    var s = list[idx];
    if (v === 'C' || v === 'D') applyState(s.state);
    var head = s.region || s.head || 'tour';
    card.innerHTML = '<div class="k"><span></span><span>' + (idx + 1) + ' / ' + list.length + '</span></div>'
      + '<div style="margin-top:6px"></div>'
      + (v === 'D' ? '<div class="p98-now"></div>' : '')
      + '<div class="row"><button data-a="prev">back</button><button data-a="next">' + (idx === list.length - 1 ? 'done' : 'next') + '</button><button data-a="close" style="margin-left:auto">esc</button></div>';
    card.children[0].children[0].textContent = head;
    card.children[1].textContent = v === 'D' ? s.what : s.caption;
    if (v === 'D') card.children[2].textContent = s.now;
    setTimeout(place, 0); setTimeout(place, 120);
  }
  function start() {
    close();
    list = steps();
    if (!list || !list.length) { flash('This file carries no tour. Variant ' + v + ' has nothing to show.'); list = null; return; }
    spot = document.createElement('div'); spot.className = 'p98-spot scrim'; // decided: the scrim always shows while a tour runs
    card = document.createElement('div'); card.className = 'p98-card' + (v === 'C' ? ' dock' : '');
    if (v === 'C') document.body.classList.add('p98-dock');
    card.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'prev') show(idx - 1);
      if (a === 'next') { if (idx === list.length - 1) close(); else show(idx + 1); }
      if (a === 'close') close();
    });
    document.body.appendChild(spot); document.body.appendChild(card);
    show(0);
  }
  function flash(msg) {
    var f = document.createElement('div'); f.className = 'p98-card'; f.style.left = '50%'; f.style.top = '40%'; f.style.transform = 'translateX(-50%)';
    f.textContent = msg; document.body.appendChild(f); setTimeout(function () { f.remove(); }, 2600);
  }
  window.addEventListener('resize', place);
  window.addEventListener('keydown', function (e) {
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (list) {
      if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); if (idx === list.length - 1) close(); else show(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); e.preventDefault(); show(idx - 1); }
      else if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    }
    if (e.key === ']') go(1);
    if (e.key === '[') go(-1);
  }, true);

  function go(d) { var k = KEYS[(KEYS.indexOf(v) + d + KEYS.length) % KEYS.length]; q.set('variant', k); location.search = q.toString(); }

  // The affordance on the page itself: a TOUR button in the lockup row.
  var btn = document.createElement('button'); btn.className = 'btn'; btn.type = 'button'; btn.textContent = 'tour';
  btn.setAttribute('data-p98', ''); btn.style.marginLeft = 'auto'; btn.style.marginRight = '8px';
  btn.addEventListener('click', start);
  var scheme = document.getElementById('schemeToggle'); scheme.parentNode.insertBefore(btn, scheme);

  // Prototype switcher — not part of the design.
  var bar = document.createElement('div'); bar.className = 'p98-bar';
  bar.innerHTML = '<button data-g="-1">‹</button><span class="lbl"></span><button data-g="1">›</button>'
    + '<label><input type="checkbox" id="p98auto"> first-visit overlay</label><button id="p98reset">forget visit</button>';
  bar.querySelector('.lbl').textContent = v + ' · ' + NAMES[v];
  bar.addEventListener('click', function (e) { var g = e.target.getAttribute('data-g'); if (g) go(+g); });
  document.body.appendChild(bar);
  var cb = bar.querySelector('#p98auto'); cb.checked = auto;
  cb.addEventListener('change', function () { if (cb.checked) q.set('auto', '1'); else q.delete('auto'); ls(LS, null); location.search = q.toString(); });
  bar.querySelector('#p98reset').addEventListener('click', function () { ls(LS, null); location.reload(); });

  // Overlay mode: everyone sees it once, then never again.
  if (auto && !ls(LS)) { ls(LS, '1'); setTimeout(start, 300); }
})();
</script>
`;
  const out = html.replace(/<\/body>(?![\s\S]*<\/body>)/, block + '</body>');
  if (out === html) throw new Error('no </body> in ' + name);
  writeFileSync(join(here, `${name}-proto.html`), out);
  console.log('wrote', `${name}-proto.html`);
}

for (const n of ['greet', 'pr-313', 'map-300-woodwork']) inject(n);

createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'greet-proto.html';
  if (!/^[\w-]+\.html$/.test(name)) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(here, name))); }
  catch { res.writeHead(404).end(); }
}).listen(8731, () => console.log('http://localhost:8731/greet-proto.html?variant=D'));
