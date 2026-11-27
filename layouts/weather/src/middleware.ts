import { defineMiddleware } from 'astro:middleware';
import sample from './fixtures/sample.json';
import { weatherPage } from '#server/page.mjs';
import { readConfig } from '#server/settings.mjs';
import { sampleCache, sampleConfig } from '#server/sample.mjs';

// Production renders the host's snapshot from the saved cache. Development can
// add ?data=sample for fixtures, with art=off, mat=on, stale=on, units=celsius,
// city=off, weather=off and time=HH:MM to try each state.
export const onRequest = defineMiddleware(async (context, next) => {
  const query = context.url.searchParams;
  let page;
  if (import.meta.env.DEV && query.get('data') === 'sample') {
    const snapshot: Record<string, any> = structuredClone(sample);
    if (query.get('art') === 'off') snapshot.display_settings = { show_art: false };
    if (query.get('art') === 'none') delete snapshot.art;
    if (query.get('mat') === 'on' && snapshot.art) snapshot.art.viewport = { x: 288, y: 162, width: 3264, height: 1836 };
    const time = query.get('time') || '';
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) snapshot.now = snapshot.now.slice(0, 11) + time + snapshot.now.slice(16);
    const config: Record<string, any> = structuredClone(sampleConfig);
    if (query.get('units') === 'celsius') config.units = 'celsius';
    if (query.get('city') === 'off') config.city = '';
    const now = new Date(snapshot.now);
    // weather=off: no saved forecast and a failed first load.
    const cache = sampleCache(now, snapshot.timezone, { stale: query.get('stale') === 'on', failed: query.get('weather') === 'off', config });
    page = await weatherPage(snapshot, config, { cache, waitMs: 0 });
  } else {
    let snapshot = context.locals.snapshot;
    // Development without a host: the real clock and the configured city.
    if (!snapshot && import.meta.env.DEV) snapshot = { ...structuredClone(sample), now: new Date().toISOString() };
    if (!snapshot) return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    page = await weatherPage(snapshot, await readConfig());
  }
  if (page.preparing) return new Response(null, { status: 202, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } });
  context.locals.page = page;
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
