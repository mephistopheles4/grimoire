import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: node clef-audit.prototype.mjs <box.json> [--audit <path>] [--clef <path>] [--run <path>]';

function parseArgs(argv) {
  let boxArg = null;
  let auditPath = process.env.EAGLE_EYE_AUDIT_PATH || resolve(HERE, '..', '..', 'skills', 'eagle-eye', 'audit.mjs');
  let clefPath = process.env.CLEF_TOOL_PATH || join(homedir(), '.claude', 'pact', 'tools', 'clef.mjs');
  let runPath = process.env.CLEF_RUN_PATH || join(homedir(), '.claude', 'pact-clef', 'run.json');

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--audit' && i + 1 < argv.length) {
      auditPath = resolve(argv[++i]);
    } else if (a === '--clef' && i + 1 < argv.length) {
      clefPath = resolve(argv[++i]);
    } else if (a === '--run' && i + 1 < argv.length) {
      runPath = resolve(argv[++i]);
    } else if (!a.startsWith('-') && !boxArg) {
      boxArg = a;
    } else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  if (!boxArg) {
    console.error(USAGE);
    process.exit(2);
  }
  return { boxPath: resolve(boxArg), auditPath, clefPath, runPath };
}

const { boxPath: BOX_PATH, auditPath: AUDIT_PATH, clefPath: CLEF_PATH, runPath: RUN_PATH } = parseArgs(process.argv.slice(2));

const ensureOut = execFileSync(process.execPath, [CLEF_PATH, 'ensure', '--wait', '45'], { encoding: 'utf8' });
const ensureJson = JSON.parse(ensureOut.trim());
if (ensureJson.state !== 'ready') {
  console.error(`Clef supervisor not ready: ${ensureOut.trim()}`);
  process.exit(1);
}

const runInfo = JSON.parse(readFileSync(RUN_PATH, 'utf8'));
if (!Number.isInteger(runInfo.port) || typeof runInfo.token !== 'string' || !runInfo.token) {
  console.error('Invalid Clef run.json: missing port or token.');
  process.exit(1);
}

const clefPort = runInfo.port;
const clefToken = runInfo.token;
const bridgeSecret = randomBytes(16).toString('hex');

const tokenMatch = (a, b) =>
  timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

function callClef(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: clefPort,
        path: '/v1/systemone',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${clefToken}`,
          host: `127.0.0.1:${clefPort}`,
        },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Clef request timed out')));
    req.end(body);
  });
}

function foldCriteriaIntoInstructions(questions) {
  const out = {};
  for (const [id, q] of Object.entries(questions ?? {})) {
    if (q?.type === 'noul' && q.criteria && typeof q.criteria === 'object') {
      const lines = Object.entries(q.criteria).map(([k, v]) => `${k}: ${v}`);
      const suffix = lines.length ? ` Criteria — ${lines.join(' ')}` : '';
      const { criteria: _dropped, ...rest } = q;
      out[id] = { ...rest, instructions: `${q.instructions ?? ''}${suffix}`.trim() };
    } else {
      out[id] = q;
    }
  }
  return out;
}

const server = createServer((req, res) => {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !tokenMatch(auth.slice(7), bridgeSecret)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/systemone') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not-found' }));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const forwardPayload = { state: parsed.state, questions: parsed.questions };
      let reply = await callClef(forwardPayload);
      if ((reply.status === 502 || reply.status === 400) && parsed.questions) {
        reply = await callClef({
          state: parsed.state,
          questions: foldCriteriaIntoInstructions(parsed.questions),
        });
      }
      if (reply.status !== 200 || !reply.json || typeof reply.json !== 'object') {
        console.error(`[bridge] Clef HTTP ${reply.status}: ${reply.text}`);
        res.writeHead(reply.status >= 400 ? reply.status : 502, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.json ?? { error: 'clef-error' }));
        return;
      }
      const answers = Object.fromEntries(
        Object.entries(reply.json).map(([k, v]) => [k, { type: 'noul', noul: v.noul }]),
      );
      const outBody = JSON.stringify({ model: 'clef-flash-q4_k_m', answers });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(outBody) });
      res.end(outBody);
    } catch (err) {
      console.error(`[bridge] transport error: ${err.message}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bridge-error', message: err.message }));
    }
  });
});

function stopClefSafely() {
  try {
    execFileSync(process.execPath, [CLEF_PATH, 'stop'], { stdio: 'ignore' });
  } catch {
    // best-effort cleanup
  }
}

server.listen(0, '127.0.0.1', () => {
  const { port: bridgePort } = server.address();
  const childEnv = {
    ...process.env,
    EAGLE_EYE_AUDIT_ENDPOINT: `http://127.0.0.1:${bridgePort}/v1/systemone`,
    TYPESAFE_API_KEY: bridgeSecret,
  };
  delete childEnv.OPENROUTER_API_KEY;

  const child = spawn(process.execPath, [AUDIT_PATH, BOX_PATH], {
    stdio: 'inherit',
    env: childEnv,
  });

  child.on('error', (err) => {
    console.error(`Failed to launch audit.mjs: ${err.message}`);
    server.close(() => {
      stopClefSafely();
      process.exit(1);
    });
  });

  child.on('exit', (code, signal) => {
    server.close(() => {
      stopClefSafely();
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 1);
      }
    });
  });
});
