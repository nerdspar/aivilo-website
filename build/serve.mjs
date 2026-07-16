/**
 * Zero-dependency local preview server for the prerendered site in dist/.
 * Mimics the nginx `try_files $uri $uri/ =404` clean-URL behaviour so
 * /platform, /services, etc. resolve exactly like they will in production.
 *
 *   node build/prerender.mjs && node build/serve.mjs
 *   → http://localhost:4321
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = process.env.PORT || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json',
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
  } catch {}
  return null;
}

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const base = join(DIST, clean);
  // try_files $uri  $uri/  (index.html) ; healthz special-case
  return (
    (await tryFile(base)) ||
    (await tryFile(join(base, 'index.html'))) ||
    null
  );
}

createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok\n');
  }
  const file = await resolve(req.url);
  if (!file) {
    const notFound = await tryFile(join(DIST, '404.html'));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(notFound ? await readFile(notFound) : 'Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}  (serving ${DIST})`);
});
