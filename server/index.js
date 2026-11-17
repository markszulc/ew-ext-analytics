import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { handleApi } from './api.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${resolve(root)}${sep}`)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    if (status === 500) console.error('Static request failed:', error.message);
    res.writeHead(status);
    res.end(status === 404 ? 'Not found. Run npm run build before starting the server.' : 'Unable to serve this file.');
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.log(`Page insights: http://127.0.0.1:${server.address().port}`);
});
