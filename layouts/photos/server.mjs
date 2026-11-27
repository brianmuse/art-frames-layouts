// The layout's HTTP server on the Art Frames Unix socket. No TCP listener.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './dist/server/entry.mjs';
// The built entry imports src/server unbundled, so this is the render's instance.
import { photoService } from './src/server/service.mjs';
import { startPhotoSync } from './src/server/photo-service.mjs';

const root = await fs.realpath(fileURLToPath(new URL('./dist/client', import.meta.url)));
// Host protocol name: keep 'dayframe' (see the host repo's names.py).
const endpoint = process.env.DAYFRAME_SITE_SOCKET || '/run/dayframe-site/site.sock';
const maxAsset = 25_000_000;
const types = { '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
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
      // The layout asks for no artwork; drop any image data instead of holding it.
      if (snapshot.art) delete snapshot.art.image_data;
      req.url = route.replace(/index\.html$/, '');
      req.method = 'GET';
      delete req.headers['content-length'];
      delete req.headers['content-type'];
      delete req.headers['transfer-encoding'];
      await handler(req, res, () => res.writeHead(404).end(), { snapshot });
    } else if (req.method === 'GET' && /^\/photo\/[a-z0-9-]+\.jpg$/.test(route)) {
      req.url = route;
      await handler(req, res, () => res.writeHead(404).end());
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
server.requestTimeout = 15_000;
server.headersTimeout = 5_000;
try {
  if (!(await fs.lstat(endpoint)).isSocket()) throw new Error('Refusing to replace a non-socket');
  await fs.unlink(endpoint);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
server.listen(endpoint, async () => {
  await fs.chmod(endpoint, 0o660);
  console.log('Photos socket ready');
  // Host protocol name: keep 'dayframe' (see the host repo's names.py).
  if (process.env.DAYFRAME_PHOTOS_NO_SYNC !== '1') startPhotoSync(photoService());
});
