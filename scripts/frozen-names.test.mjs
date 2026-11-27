// The product is called Art Frames, but the protocol between the host and its
// layouts keeps the old name "dayframe". The host and the layouts deploy separately,
// so a renamed literal on one side breaks the other. This test fails if one of
// these literals disappears. See the host repo's names.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['morning', 'news', 'photos', 'weather'];

const SOCKET = "'/run/dayframe-site/site.sock'";
const ORIGIN = "'http://dayframe.local'";

// File (relative to the repo root) → literals it must contain.
const frozen = {
  'README.md': [
    '/run/dayframe-site/site.sock',
    '/run/dayframe-apps/',
    'http://dayframe.local',
    '/dayframe.json',
    '/dayframe-art.jpg',
    '[data-dayframe-ready]',
    'DAYFRAME_SITE_CONFIG',
    'DAYFRAME_SITE_STATE',
  ],
  'layouts/morning/src/layouts/Frame.astro': ['data-dayframe-ready=', 'data-dayframe-server-rendered='],
  'layouts/news/src/layouts/Frame.astro': ['data-dayframe-ready=', 'data-dayframe-server-rendered='],
  'layouts/weather/src/layouts/Frame.astro': ['data-dayframe-ready=', 'data-dayframe-server-rendered='],
  'layouts/photos/src/pages/index.astro': ['data-dayframe-ready="true"'],
  'layouts/morning/src/fixtures/sample.json': ['"/dayframe-art.jpg"'],
  'layouts/news/src/fixtures/sample.json': ['"/dayframe-art.jpg"'],
  'layouts/news/src/server/page.mjs': ['http:\\/\\/dayframe\\.local\\/'],
  'layouts/weather/src/fixtures/sample.json': ['"/dayframe-art.jpg"'],
  'layouts/weather/src/server/page.mjs': ['http:\\/\\/dayframe\\.local\\/'],
  'layouts/photos/src/server/album-link.mjs': ["'dayframe-photos\\0'"],
  'layouts/photos/server.mjs': ['process.env.DAYFRAME_PHOTOS_NO_SYNC'],
};
for (const app of apps) {
  frozen[`layouts/${app}/server.mjs`] = [
    ...(frozen[`layouts/${app}/server.mjs`] ?? []),
    'process.env.DAYFRAME_SITE_SOCKET',
    SOCKET,
    ORIGIN,
  ];
  frozen[`layouts/${app}/Dockerfile`] = [
    'DAYFRAME_SITE_CONFIG=/site-config/config.json',
    'DAYFRAME_SITE_STATE=/site-state',
    'mkdir -p /run/dayframe-site ',
    // The Art Frames install file reads the manifest from the socket folder.
    'cp layout.json /run/dayframe-site/layout.json',
  ];
}

for (const [file, literals] of Object.entries(frozen)) {
  test(`${file} keeps the host protocol names`, () => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const literal of literals) {
      assert.ok(text.includes(literal), `${file} lost the frozen literal ${literal}`);
    }
  });
}

// Layout code that reads each frozen env name. A renamed read would get no value
// from the Dockerfile or the host.
const readers = {
  DAYFRAME_SITE_SOCKET: apps.map((app) => `layouts/${app}/server.mjs`),
  DAYFRAME_SITE_CONFIG: apps.map((app) => `layouts/${app}/src/server/settings.mjs`),
  DAYFRAME_SITE_STATE: [
    'layouts/morning/dev.mjs',
    'layouts/morning/src/server/settings.mjs',
    'layouts/morning/src/server/weather.mjs',
    'layouts/morning/src/server/calendar-cache.mjs',
    'layouts/news/dev.mjs',
    'layouts/news/src/server/settings.mjs',
    'layouts/news/src/server/cache.mjs',
    'layouts/weather/dev.mjs',
    'layouts/weather/src/server/settings.mjs',
    'layouts/weather/src/server/cache.mjs',
    'layouts/photos/dev.mjs',
    'layouts/photos/src/server/photo-service.mjs',
    'layouts/photos/src/server/dev-preview.mjs',
  ],
  DAYFRAME_PHOTOS_NO_SYNC: ['layouts/photos/server.mjs'],
};

for (const [name, files] of Object.entries(readers)) {
  test(`layout code still reads ${name}`, () => {
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(text.includes(`process.env.${name}`), `${file} no longer reads process.env.${name}`);
    }
  });
}

// Every env name the layout code reads must be one the Dockerfile sets or the
// host protocol defines. This catches a reader renamed to a name nobody sets.
const SKIP = new Set(['node_modules', 'dist', '.astro', 'tests', '.secrets', 'public']);
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sources(full);
    return /\.(?:mjs|js|ts|astro)$/.test(entry.name) ? [full] : [];
  });
}

for (const app of apps) {
  test(`${app} reads only env names that something sets`, () => {
    const dockerfile = fs.readFileSync(path.join(root, 'layouts', app, 'Dockerfile'), 'utf8');
    const allowed = new Set(Object.keys(readers));
    for (const line of dockerfile.split('\n').filter((l) => l.startsWith('ENV '))) {
      for (const [, name] of line.matchAll(/([A-Z_][A-Z0-9_]*)=/g)) allowed.add(name);
    }
    for (const file of sources(path.join(root, 'layouts', app))) {
      const text = fs.readFileSync(file, 'utf8');
      const where = path.relative(root, file);
      assert.doesNotMatch(text, /process\.env\[/, `${where} reads process.env by a computed key`);
      for (const [, name] of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        assert.ok(allowed.has(name), `${where} reads process.env.${name}, which no Dockerfile or host sets`);
      }
    }
  });
}

test('the sample artwork keeps its protocol file name', () => {
  for (const app of ['morning', 'news', 'weather']) {
    assert.ok(fs.existsSync(path.join(root, 'layouts', app, 'public', 'dayframe-art.jpg')), `${app} lost public/dayframe-art.jpg`);
  }
});
