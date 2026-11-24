import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const run = JSON.parse(readFileSync(join(HERE, 'run.json'), 'utf8'));
if (!Number.isInteger(run.port) || typeof run.agentToken !== 'string' || !run.agentToken) {
  console.error('Invalid run.json');
  process.exit(1);
}

const [status = 'note', ...rest] = process.argv.slice(2);
const text = rest.join(' ').trim();
const body = JSON.stringify({ status, text });

const req = request(
  {
    hostname: '127.0.0.1',
    port: run.port,
    path: '/reply',
    method: 'POST',
    headers: {
      authorization: `Bearer ${run.agentToken}`,
      host: `127.0.0.1:${run.port}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: 10_000,
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8')}`);
        process.exit(1);
      }
      console.log('ok');
    });
  },
);

req.on('error', (err) => {
  console.error(`Reply failed: ${err.message}`);
  process.exit(1);
});

req.end(body);
