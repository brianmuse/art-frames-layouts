import type { APIRoute } from 'astro';
import { photoService } from '#server/service.mjs';

export const prerender = false;

// The finished frame for one photo, from the private cache in /site-state.
export const GET: APIRoute = async ({ params }) => {
  const requested = String(params.name || '');
  const part = requested.endsWith('-backdrop') ? 'backdrop' : 'photo';
  const name = part === 'backdrop' ? requested.slice(0, -'-backdrop'.length) : requested;
  let body = await photoService().cache.read(name, part);
  if (!body && import.meta.env.DEV) body = await (await import('#server/dev-preview.mjs')).previewCache.read(name, part);
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
};
