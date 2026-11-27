import { defineMiddleware } from 'astro:middleware';
import { photoService } from '#server/service.mjs';

// Dev-only switches: ?preview=landscape|portrait|error|empty|missing&fit=cover|contain&caption=0&clock=1
async function devService(url: URL, snapshot: Record<string, any>) {
  const kind = url.searchParams.get('preview');
  if (!kind) return photoService();
  const { previewService } = await import('#server/dev-preview.mjs');
  const fit = url.searchParams.get('fit') === 'cover' ? 'cover' : 'contain';
  snapshot.display_settings = { show_caption: url.searchParams.get('caption') !== '0', show_clock: url.searchParams.get('clock') === '1' };
  return previewService(kind, fit);
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith('/photo/')) return next();
  let snapshot = context.locals.snapshot;
  if (!snapshot && !import.meta.env.DEV) return new Response(null, { status: 400 });
  snapshot ||= { version: 1, now: new Date().toISOString(), timezone: 'America/New_York', display: { width: 3840, height: 2160 }, data: {}, display_settings: {} };
  const service = import.meta.env.DEV ? await devService(context.url, snapshot) : photoService();
  const result = await service.render(snapshot);
  if (result.status === 202) return new Response(null, { status: 202, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } });
  context.locals.view = result.view;
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
