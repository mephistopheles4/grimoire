import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  let htmlArg = null;
  let port = Number.parseInt(process.env.CHANNEL_PORT ?? '4175', 10);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' && i + 1 < argv.length) {
      port = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (!a.startsWith('-') && !htmlArg) {
      htmlArg = a;
    } else {
      console.error('Usage: node channel-server.mjs <rendered-eagle-eye.html> [--port <port>]');
      process.exit(2);
    }
  }
  if (!htmlArg || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Usage: node channel-server.mjs <rendered-eagle-eye.html> [--port <port>]');
    process.exit(2);
  }
  return { boxHtmlPath: resolve(htmlArg), requestedPort: port };
}

const { boxHtmlPath: BOX_HTML_PATH, requestedPort } = parseArgs(process.argv.slice(2));
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_PATH = join(HERE, 'run.json');
const STATE_PATH = join(HERE, 'state.json');
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CMD_BYTES = 16 * 1024;
const POLL_TIMEOUT_MS = 540_000;
const VALID_KINDS = new Set(['option-pick', 'send-picks', 'focus-row']);
const VALID_MODES = new Set(['on', 'off']);

const baseHtml = readFileSync(BOX_HTML_PATH, 'utf8');
const pageToken = randomBytes(32).toString('hex');
const agentToken = randomBytes(32).toString('hex');

const tokenEqual = (given, expected) => {
  if (typeof given !== 'string' || !given) return false;
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
};

const queue = [];
const sseClients = new Set();
let pollWaiter = null;
let lastReply = null;
let latestState = null;
let eventSeq = 0;

function statusSnapshot() {
  return {
    liveSync: sseClients.size > 0,
    agentPolling: Boolean(pollWaiter),
    pendingCount: queue.length,
    lastReply,
  };
}

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function broadcastStatus() {
  broadcastEvent('status', statusSnapshot());
}

function persistState(stateObj) {
  latestState = stateObj;
  const tmpPath = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(stateObj, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, STATE_PATH);
}

function buildInjectedSnippet(origin, token) {
  return `
<style id="grim-63-styles">
  .grim-channel {
    padding: 12px var(--sp-gutter);
    border-bottom: 1px solid var(--av-ink-30);
    background: var(--av-surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .grim-channel-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .grim-sync-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .grim-note {
    flex: 1 1 220px;
    min-width: 180px;
    font-size: 12.5px;
    padding: 6px 10px;
  }
  .grim-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .grim-channel .chip.on:disabled,
  .grim-channel .chip.on:disabled:hover {
    background: transparent;
    border-color: var(--av-ink-12);
    color: var(--av-ink-30);
  }
  .grim-feedback {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 16px;
    border-top: 1px solid var(--av-ink-12);
    padding-top: 8px;
    font-size: 12.5px;
    color: var(--av-ink-80);
  }
  .grim-feedback[hidden] {
    display: none !important;
  }
  .grim-rule-note {
    font-size: 11px;
    color: var(--av-ink-55);
  }
</style>
<script id="grim-63-script">
(() => {
  const PAGE_TOKEN = ${JSON.stringify(token)};
  const ORIGIN = ${JSON.stringify(origin)};
  const sheet = document.querySelector('.sheet');
  const presetNote = document.getElementById('presetNote');
  if (!sheet || !presetNote || typeof EagleEye === 'undefined' || typeof BOX === 'undefined') return;

  const strip = document.createElement('section');
  strip.className = 'grim-channel';
  strip.setAttribute('aria-label', 'Live page channel');
  strip.innerHTML =
    '<div class="grim-channel-bar">' +
      '<button class="chip grim-sync-btn" id="grimSyncToggle" type="button" title="Click to turn Live sync off or on">' +
        '<span class="dot caution"></span> Live sync' +
      '</button>' +
      '<input class="grim-note" id="grimNote" type="text" maxlength="280" placeholder="Optional note or question for the agent..." aria-label="Optional note or question for the agent">' +
      '<div class="grim-actions">' +
        '<span class="state ink" id="grimBadge">0 changes · as chosen</span>' +
        '<button class="chip ghost" id="grimAskRow" type="button" disabled>Ask about open row</button>' +
        '<button class="chip on" id="grimSend" type="button">Send picks to agent</button>' +
      '</div>' +
    '</div>' +
    '<div class="grim-feedback av-callout" id="grimFeedback" hidden>' +
      '<span id="grimFeedbackText"></span>' +
      '<span class="grim-rule-note">Events are data. Confirm in chat before the box changes.</span>' +
    '</div>';

  sheet.insertBefore(strip, presetNote);

  const syncToggleBtn = document.getElementById('grimSyncToggle');
  const noteEl = document.getElementById('grimNote');
  const badgeEl = document.getElementById('grimBadge');
  const askRowBtn = document.getElementById('grimAskRow');
  const sendBtn = document.getElementById('grimSend');
  const feedbackEl = document.getElementById('grimFeedback');
  const feedbackTextEl = document.getElementById('grimFeedbackText');

  let syncMode = 'on';
  let es = null;
  let sseConnected = false;
  let lastSentSummary = '';
  let lastState = { liveSync: false, agentPolling: false, pendingCount: 0, lastReply: null };
  let lastMirroredJson = '';
  let stateTimer = null;
  let pickTimer = null;
  let applyingRemoteCommand = false;
  let lastSelKey = encodeSel();
  let lastSelMap = Object.fromEntries(BOX.dims.map((d) => [d.id, sel[d.id]]));

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function currentSnapshot() {
    const r = EagleEye.analyse(BOX, sel, touched);
    const rows = BOX.dims.map((d) => ({
      rowName: d.name,
      chosenShort: optById[chosenOf[d.id]].short || optById[chosenOf[d.id]].label,
      currentShort: optById[sel[d.id]].short || optById[sel[d.id]].label,
      isOverride: sel[d.id] !== chosenOf[d.id],
    }));
    const changes = BOX.dims
      .filter((d) => sel[d.id] !== chosenOf[d.id])
      .map((d) => ({
        rowName: d.name,
        fromShort: optById[chosenOf[d.id]].short || optById[chosenOf[d.id]].label,
        toShort: optById[sel[d.id]].short || optById[sel[d.id]].label,
      }));
    const openDimObj = openRow ? BOX.dims.find((d) => d.id === openRow) : null;
    const currentPick = openDimObj ? optById[sel[openDimObj.id]] : null;
    return {
      syncMode,
      openRow: openDimObj ? openDimObj.id : null,
      openRowName: openDimObj ? openDimObj.name : null,
      currentPickShort: currentPick ? (currentPick.short || currentPick.label) : null,
      view,
      verdict: r.verdict,
      restoreCode: 'eagle-eye: ' + (encodeSel() || 'none'),
      changeCount: changes.length,
      changes,
      rows,
    };
  }

  function renderFeedback() {
    const rep = lastState.lastReply;
    if (syncMode === 'off') {
      feedbackEl.hidden = false;
      feedbackEl.classList.remove('av-callout--normal', 'av-callout--caution');
      feedbackEl.classList.add('av-callout--caution');
      feedbackTextEl.textContent = 'Live sync is off — use Export to paste picks into chat.';
      return;
    }
    if (!lastSentSummary && !rep) {
      feedbackEl.hidden = true;
      return;
    }
    feedbackEl.hidden = false;
    feedbackEl.classList.remove('av-callout--normal', 'av-callout--caution');
    if (rep && rep.text && !lastSentSummary) {
      const cls = rep.status === 'confirmed' || rep.status === 'ready' || rep.status === 'synced'
        ? 'av-callout--normal'
        : 'av-callout--caution';
      feedbackEl.classList.add(cls);
      const time = new Date(rep.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      feedbackTextEl.textContent = 'Agent (' + time + ' · ' + rep.status + '): ' + rep.text;
    } else {
      feedbackEl.classList.add('av-callout--caution');
      feedbackTextEl.textContent = lastSentSummary;
    }
  }

  function paintStatus(s) {
    lastState = s;
    const queued = s.pendingCount > 0 ? ' · ' + s.pendingCount + ' queued' : '';
    const pollTag = s.agentPolling ? ' · listening' : '';
    if (syncMode === 'off') {
      syncToggleBtn.className = 'chip ghost grim-sync-btn';
      syncToggleBtn.setAttribute('aria-pressed', 'false');
      syncToggleBtn.innerHTML = '<span class="dot caution"></span> Live sync: off';
    } else if (!sseConnected) {
      syncToggleBtn.className = 'chip ghost grim-sync-btn';
      syncToggleBtn.setAttribute('aria-pressed', 'false');
      syncToggleBtn.innerHTML = '<span class="dot caution"></span> ' + escapeHtml('Reconnecting…' + queued);
    } else {
      syncToggleBtn.className = 'chip grim-sync-btn';
      syncToggleBtn.setAttribute('aria-pressed', 'true');
      syncToggleBtn.innerHTML = '<span class="dot normal"></span> Live sync' + escapeHtml(pollTag + queued);
    }
    renderFeedback();
  }

  function scheduleMirror(snap) {
    if (syncMode === 'off') return;
    const body = JSON.stringify(snap);
    if (body === lastMirroredJson) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(async () => {
      if (syncMode === 'off') return;
      try {
        const res = await fetch(ORIGIN + '/state', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + PAGE_TOKEN,
          },
          body,
        });
        if (res.ok) lastMirroredJson = body;
      } catch {}
    }, 120);
  }

  async function postEvent(kind, lastChanged) {
    if (syncMode === 'off') return;
    clearTimeout(pickTimer);
    pickTimer = null;
    const snap = currentSnapshot();
    const payload = {
      kind,
      syncMode,
      restoreCode: snap.restoreCode,
      verdict: snap.verdict,
      openRow: snap.openRow,
      openRowName: snap.openRowName,
      ...(kind === 'focus-row' && snap.currentPickShort ? { currentPickShort: snap.currentPickShort } : {}),
      ...(lastChanged ? { lastChanged } : {}),
      changes: snap.changes,
      note: noteEl.value.trim(),
    };
    sendBtn.disabled = true;
    askRowBtn.disabled = true;
    try {
      const res = await fetch(ORIGIN + '/event', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + PAGE_TOKEN,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastState.lastReply = null;
      if (kind === 'option-pick' && lastChanged) {
        lastSentSummary =
          'Synced pick (' + lastChanged.rowName + ': ' + lastChanged.toShort + ') at ' + nowStr +
          (data.agentPolling ? ' — agent woken up.' : ' — state updated.');
      } else if (kind === 'focus-row' && snap.openRowName) {
        lastSentSummary =
          'Sent question on ' + snap.openRowName + ' at ' + nowStr +
          (data.agentPolling ? ' — agent woken up.' : ' — queued.');
      } else {
        lastSentSummary =
          'Sent picks (' + snap.changeCount + ' changes, ' + snap.verdict + ') at ' + nowStr +
          (data.agentPolling ? ' — agent woken up.' : ' — queued.');
      }
      if (kind !== 'option-pick') noteEl.value = '';
      renderFeedback();
    } catch (err) {
      lastSentSummary = 'Send failed (' + err.message + '). Use Export paste-back instead.';
      renderFeedback();
    } finally {
      syncButtons(snap);
    }
  }

  function syncButtons(snap) {
    const off = syncMode === 'off';
    sendBtn.disabled = off;
    sendBtn.classList.toggle('on', !off);
    sendBtn.classList.toggle('ghost', off);
    askRowBtn.disabled = off || !snap.openRowName;
    askRowBtn.textContent = snap.openRowName ? 'Ask about ' + snap.openRowName : 'Ask about open row';
  }

  function syncChannelUI() {
    const snap = currentSnapshot();
    const cls = snap.verdict === 'consistent' ? 'normal' : (snap.verdict === 'as chosen' ? 'ink' : 'caution');
    badgeEl.className = 'state ' + cls;
    badgeEl.textContent = snap.changeCount + ' change' + (snap.changeCount === 1 ? '' : 's') + ' · ' + snap.verdict;
    syncButtons(snap);
    scheduleMirror(snap);

    const newKey = encodeSel();
    if (newKey !== lastSelKey) {
      const prevMap = lastSelMap;
      const diffDims = BOX.dims.filter((d) => sel[d.id] !== prevMap[d.id]);
      lastSelKey = newKey;
      lastSelMap = Object.fromEntries(BOX.dims.map((d) => [d.id, sel[d.id]]));
      if (!applyingRemoteCommand && syncMode !== 'off' && diffDims.length > 0) {
        const d0 = diffDims[0];
        const lastChanged = {
          rowName: d0.name,
          fromShort: optById[prevMap[d0.id]].short || optById[prevMap[d0.id]].label,
          toShort: optById[sel[d0.id]].short || optById[sel[d0.id]].label,
        };
        lastState.lastReply = null;
        lastSentSummary = 'Syncing pick: ' + lastChanged.rowName + ' -> ' + lastChanged.toShort + '...';
        renderFeedback();
        clearTimeout(pickTimer);
        pickTimer = setTimeout(() => postEvent('option-pick', lastChanged), 350);
      }
    }
  }

  function disconnectSSE() {
    if (es) {
      es.close();
      es = null;
    }
    sseConnected = false;
  }

  function connectSSE() {
    disconnectSSE();
    es = new EventSource(ORIGIN + '/events?token=' + encodeURIComponent(PAGE_TOKEN));
    es.addEventListener('open', () => {
      sseConnected = true;
      paintStatus(lastState);
    });
    es.addEventListener('status', (ev) => {
      sseConnected = true;
      try {
        paintStatus(JSON.parse(ev.data));
      } catch {}
    });
    es.addEventListener('command', (ev) => {
      if (syncMode !== 'on') return;
      applyingRemoteCommand = true;
      try {
        const cmd = JSON.parse(ev.data);
        if (cmd.reset) {
          resetAll();
          clearPreset();
        }
        if (cmd.set && typeof cmd.set === 'object') {
          presetOwned = false;
          pending = null;
          for (const [d, o] of Object.entries(cmd.set)) {
            if (Object.hasOwn(optById, o) && optById[o].dim.id === d) {
              sel[d] = o;
              touched.add(d);
            }
          }
        }
        if (cmd.openRow !== undefined) {
          openDim(cmd.openRow);
        }
        if (cmd.view === 'findings' || cmd.view === 'sheet') {
          view = cmd.view;
        }
        if (typeof cmd.note === 'string' && cmd.note) {
          lastSentSummary = '';
        }
        lastSelKey = encodeSel();
        lastSelMap = Object.fromEntries(BOX.dims.map((d) => [d.id, sel[d.id]]));
        update();
        syncChannelUI();
      } catch {} finally {
        applyingRemoteCommand = false;
      }
    });
    es.addEventListener('error', () => {
      sseConnected = false;
      paintStatus(lastState);
    });
  }

  syncToggleBtn.addEventListener('click', () => {
    syncMode = syncMode === 'on' ? 'off' : 'on';
    if (syncMode === 'off') {
      clearTimeout(stateTimer);
      clearTimeout(pickTimer);
      pickTimer = null;
      disconnectSSE();
      paintStatus(lastState);
      syncChannelUI();
    } else {
      if (!es) connectSSE();
      lastMirroredJson = '';
      lastSentSummary = 'Live sync turned on.';
      lastState.lastReply = null;
      paintStatus(lastState);
      syncChannelUI();
    }
  });

  sendBtn.addEventListener('click', () => postEvent('send-picks'));
  askRowBtn.addEventListener('click', () => postEvent('focus-row'));

  const viewEl = document.getElementById('view');
  if (viewEl) {
    new MutationObserver(() => syncChannelUI()).observe(viewEl, { childList: true });
  }
  document.addEventListener('click', () => setTimeout(syncChannelUI, 0));

  connectSSE();
  syncChannelUI();
})();
</script>
`;
}

function injectHtml(html, origin, token) {
  const idx = html.lastIndexOf('</body>');
  const snippet = buildInjectedSnippet(origin, token);
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sanitizeChangeItem(c) {
  return {
    rowName: String(c?.rowName ?? '').slice(0, 80),
    fromShort: String(c?.fromShort ?? '').slice(0, 80),
    toShort: String(c?.toShort ?? '').slice(0, 80),
  };
}

let actualPort = 0;
let expectedOrigin = '';
let pageHtml = '';

const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${actualPort}`) {
    return sendJson(res, 400, { error: 'invalid-host' });
  }

  const reqUrl = new URL(req.url || '/', expectedOrigin);

  if (req.method === 'GET' && reqUrl.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(pageHtml),
      'cache-control': 'no-store',
    });
    return res.end(pageHtml);
  }

  if (req.method === 'GET' && reqUrl.pathname === '/events') {
    if (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin) {
      return sendJson(res, 403, { error: 'invalid-origin' });
    }
    const token = reqUrl.searchParams.get('token') ?? '';
    if (!tokenEqual(token, pageToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    sseClients.add(res);
    res.write(`event: status\ndata: ${JSON.stringify(statusSnapshot())}\n\n`);
    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25_000);
    heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/state') {
    if (req.headers.origin !== expectedOrigin) {
      return sendJson(res, 403, { error: 'invalid-origin' });
    }
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenEqual(auth.slice(7), pageToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      return sendJson(res, 415, { error: 'invalid-content-type' });
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'invalid-body' });
    }

    const syncMode = VALID_MODES.has(body.syncMode) ? body.syncMode : 'on';
    const sanitized = {
      updatedAt: new Date().toISOString(),
      syncMode,
      openRow: body.openRow ? String(body.openRow).slice(0, 64) : null,
      openRowName: body.openRowName ? String(body.openRowName).slice(0, 80) : null,
      view: body.view === 'sheet' ? 'sheet' : 'findings',
      verdict: String(body.verdict ?? '').slice(0, 40),
      restoreCode: String(body.restoreCode ?? '').slice(0, 300),
      changeCount: Number.isFinite(body.changeCount) ? Number(body.changeCount) : 0,
      changes: Array.isArray(body.changes) ? body.changes.slice(0, 32).map(sanitizeChangeItem) : [],
      rows: Array.isArray(body.rows)
        ? body.rows.slice(0, 32).map((r) => ({
            rowName: String(r?.rowName ?? '').slice(0, 80),
            chosenShort: String(r?.chosenShort ?? '').slice(0, 80),
            currentShort: String(r?.currentShort ?? '').slice(0, 80),
            isOverride: Boolean(r?.isOverride),
          }))
        : [],
    };
    persistState(sanitized);
    console.log(`[state] mode=${syncMode} row=${sanitized.openRowName || 'overview'} changes=${sanitized.changeCount} verdict=${sanitized.verdict}`);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && reqUrl.pathname === '/event') {
    if (req.headers.origin !== expectedOrigin) {
      return sendJson(res, 403, { error: 'invalid-origin' });
    }
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenEqual(auth.slice(7), pageToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      return sendJson(res, 415, { error: 'invalid-content-type' });
    }

    let body;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'invalid-body' });
    }

    eventSeq += 1;
    const kind = VALID_KINDS.has(body.kind) ? body.kind : 'send-picks';
    const syncMode = VALID_MODES.has(body.syncMode) ? body.syncMode : 'on';
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 32).map(sanitizeChangeItem) : [];
    const lastChanged = body.lastChanged && typeof body.lastChanged === 'object'
      ? sanitizeChangeItem(body.lastChanged)
      : null;

    const evt = {
      type: 'event',
      id: eventSeq,
      receivedAt: new Date().toISOString(),
      kind,
      syncMode,
      restoreCode: String(body.restoreCode ?? '').slice(0, 300),
      verdict: String(body.verdict ?? '').slice(0, 40),
      openRow: body.openRow ? String(body.openRow).slice(0, 64) : null,
      openRowName: body.openRowName ? String(body.openRowName).slice(0, 80) : null,
      ...(kind === 'focus-row' && body.currentPickShort
        ? { currentPickShort: String(body.currentPickShort).slice(0, 80) }
        : {}),
      ...(lastChanged ? { lastChanged } : {}),
      changes,
      note: String(body.note ?? '').slice(0, 280),
    };

    const hadPoller = Boolean(pollWaiter);
    lastReply = null;
    if (pollWaiter) {
      const resolvePoll = pollWaiter;
      pollWaiter = null;
      resolvePoll(evt);
    } else {
      queue.push(evt);
    }
    console.log(`[event] #${evt.id} kind=${kind} mode=${syncMode} poller=${hadPoller} queued=${queue.length}`);
    broadcastStatus();
    return sendJson(res, 200, { ok: true, id: evt.id, agentPolling: hadPoller });
  }

  if (req.method === 'GET' && reqUrl.pathname === '/poll') {
    if (req.headers.origin !== undefined) {
      return sendJson(res, 403, { error: 'origin-not-allowed' });
    }
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenEqual(auth.slice(7), agentToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    if (queue.length > 0) {
      const evt = queue.shift();
      console.log(`[poll] delivered queued #${evt.id}`);
      broadcastStatus();
      return sendJson(res, 200, evt);
    }
    if (pollWaiter) {
      const prev = pollWaiter;
      pollWaiter = null;
      prev({ type: 'replaced' });
    }

    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollWaiter === finish) pollWaiter = null;
      broadcastStatus();
      if (!res.writableEnded) sendJson(res, 200, payload);
    };
    const timer = setTimeout(() => finish({ type: 'timeout' }), POLL_TIMEOUT_MS);
    timer.unref();
    pollWaiter = finish;
    console.log('[poll] waiting');
    broadcastStatus();

    req.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (pollWaiter === finish) pollWaiter = null;
        console.log('[poll] closed');
        broadcastStatus();
      }
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/reply') {
    if (req.headers.origin !== undefined) {
      return sendJson(res, 403, { error: 'origin-not-allowed' });
    }
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenEqual(auth.slice(7), agentToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      return sendJson(res, 415, { error: 'invalid-content-type' });
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_CMD_BYTES);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'invalid-body' });
    }
    lastReply = {
      at: new Date().toISOString(),
      status: String(body.status ?? 'note').slice(0, 40),
      text: String(body.text ?? '').slice(0, 600),
    };
    console.log(`[reply] status=${lastReply.status}`);
    broadcastStatus();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && reqUrl.pathname === '/command') {
    if (req.headers.origin !== undefined) {
      return sendJson(res, 403, { error: 'origin-not-allowed' });
    }
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenEqual(auth.slice(7), agentToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      return sendJson(res, 415, { error: 'invalid-content-type' });
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_CMD_BYTES);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'invalid-body' });
    }

    const cmd = {
      ...(body.reset === true ? { reset: true } : {}),
      ...(body.set && typeof body.set === 'object' ? { set: body.set } : {}),
      ...(body.openRow !== undefined ? { openRow: body.openRow } : {}),
      ...(body.view === 'findings' || body.view === 'sheet' ? { view: body.view } : {}),
      ...(typeof body.note === 'string' ? { note: body.note.slice(0, 600) } : {}),
    };

    if (cmd.note) {
      lastReply = {
        at: new Date().toISOString(),
        status: 'synced',
        text: cmd.note,
      };
    }

    console.log(`[command] clients=${sseClients.size} openRow=${cmd.openRow ?? 'unchanged'}`);
    broadcastEvent('command', cmd);
    if (cmd.note) broadcastStatus();
    return sendJson(res, 200, { ok: true, clients: sseClients.size });
  }

  return sendJson(res, 404, { error: 'not-found' });
});

function onListening() {
  actualPort = server.address().port;
  expectedOrigin = `http://127.0.0.1:${actualPort}`;
  pageHtml = injectHtml(baseHtml, expectedOrigin, pageToken);
  writeFileSync(
    RUN_PATH,
    `${JSON.stringify(
      {
        port: actualPort,
        origin: expectedOrigin,
        pageToken,
        agentToken,
        pid: process.pid,
        started: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log(`CHANNEL URL: ${expectedOrigin}/`);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && actualPort === 0) {
    server.listen(0, '127.0.0.1');
  } else {
    console.error(err);
    process.exit(1);
  }
});

server.listen(requestedPort, '127.0.0.1', onListening);
