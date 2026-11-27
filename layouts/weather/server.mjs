// Optional default-site service. No TCP listener, credentials, or controller data mounts.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './dist/server/entry.mjs';
// The built entry imports src/server unbundled, so this is the render's cache instance.
import {startWeatherRefresh} from './src/server/cache.mjs';

const root = await fs.realpath(fileURLToPath(new URL('./dist/client', import.meta.url)));
// Host protocol name: keep 'dayframe' (see the host repo's names.py).
const endpoint = process.env.DAYFRAME_SITE_SOCKET || '/run/dayframe-site/site.sock';
const maxAsset = 25_000_000;
const types = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
process.umask(0o007);

const server = http.createServer(async (req, res) => {
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://dayframe.local').pathname);
    if (req.method === 'POST') {
      let size = 0;
      const parts = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 40_000_000) { res.writeHead(413).end(); return; }
        parts.push(chunk);
      }
      const snapshot = JSON.parse(Buffer.concat(parts).toString('utf8'));
      parts.length = 0;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid snapshot');
      // Hold the artwork as one binary buffer instead of a large base64 string.
      if (typeof snapshot.art?.image_data === 'string') { snapshot.art.image_buffer = Buffer.from(snapshot.art.image_data, 'base64'); delete snapshot.art.image_data; }
      req.url = route.replace(/index\.html$/, '');
      req.method = 'GET';
      delete req.headers['content-length'];
      delete req.headers['content-type'];
      delete req.headers['transfer-encoding'];
      await handler(req, res, () => res.writeHead(404).end(), { snapshot });
    } else if (req.method === 'GET') {
      if (route.split('/').some(part => part.startsWith('.'))) throw new Error('Hidden path');
      const candidate = await fs.realpath(path.resolve(root, '.' + route));
      if (!candidate.startsWith(root + path.sep)) throw new Error('Invalid path');
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > maxAsset) throw new Error('Invalid asset');
      res.writeHead(200, { 'Content-Type': types[path.extname(candidate)] || 'application/octet-stream' });
      res.end(await fs.readFile(candidate));
    } else { res.writeHead(405).end(); }
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
try {
  if (!(await fs.lstat(endpoint)).isSocket()) throw new Error('Refusing to replace a non-socket');
  await fs.unlink(endpoint);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
server.listen(endpoint, async () => { await fs.chmod(endpoint, 0o660); console.log('Default website socket ready'); startWeatherRefresh(); });
