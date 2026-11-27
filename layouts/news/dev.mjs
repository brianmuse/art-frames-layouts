import { dev } from 'astro';
import node from '@astrojs/node';
import {fileURLToPath} from 'node:url';
process.env.DAYFRAME_SITE_STATE ??= fileURLToPath(new URL('.secrets/state',import.meta.url));

const server = await dev({
  root: new URL('.', import.meta.url),
  output: 'server',
  adapter: node({ mode: 'middleware' }),
  server: { host: '127.0.0.1' },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.stop();
    process.exit(0);
  });
}
