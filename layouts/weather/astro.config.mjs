import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
// Keep the server modules out of the bundle: dist imports #server/* (package.json
// "imports") at runtime, so server.mjs's background sync shares one cache/parser
// instance with renders.
export default defineConfig({output:'server',adapter:node({mode:'middleware'}),build:{format:'directory'},server:{host:'127.0.0.1'},vite:{build:{rollupOptions:{external:[/^#server\//]}}}});
