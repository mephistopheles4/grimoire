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

const req = request(
  {
    hostname: '127.0.0.1',
    port: run.port,
    path: '/poll',
    method: 'GET',
    headers: {
      authorization: `Bearer ${run.agentToken}`,
      host: `127.0.0.1:${run.port}`,
    },
    timeout: 560_000,
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode !== 200) {
        console.error(`HTTP ${res.statusCode}: ${text}`);
        process.exit(1);
      }
      console.log(text);
    });
  },
);

req.on('error', (err) => {
  console.error(`Poll failed: ${err.message}`);
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy(new Error('Poll request timed out'));
});

req.end();
