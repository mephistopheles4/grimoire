// PROTOTYPE #88 — throwaway. Renders the recursion fixture with the patched
// layout and template, then serves it. Lives only on prototype/88-recursion.
//
//   node skills/groundtrack/prototype-88/serve.prototype.mjs [port]
//   open http://localhost:<port>/?variant=A   (A, B or C; &err=1; &motion=0)
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'proto88-')), 'page.html');
execFileSync(process.execPath, [join(here, '..', 'scripts', 'render.mjs'), join(here, 'recursion.prototype.flightpath.json'), '--out', out], { stdio: 'inherit' });
const port = Number(process.argv[2] || 48817);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(out));
}).listen(port, () => console.log(`http://localhost:${port}/?variant=A`));
