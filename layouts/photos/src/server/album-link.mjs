// Shared album links. Only two fixed forms are accepted, and the layout rebuilds the
// URL from the parsed parts instead of passing the user's text through.
import {createHash} from 'node:crypto';

export const SHORT_HOST='photos.app.goo.gl';
export const ALBUM_HOST='photos.google.com';
const TOKEN=/^[A-Za-z0-9_-]{1,200}$/;
// lh3.googleusercontent.com, and lh4, lh5 … when the album uses them.
export const imageHost=host=>/^lh[0-9]{1,2}\.googleusercontent\.com$/.test(host);
export const pageHost=host=>host===SHORT_HOST || host===ALBUM_HOST;

export class LinkError extends Error {
  constructor(code) {super('Unsupported album link');this.code=code;}
}

function parse(value) {
  if(typeof value!=='string') throw new LinkError('missing');
  const text=value.trim();
  if(!text) throw new LinkError('missing');
  if(text.length>1000) throw new LinkError('unsupported');
  let url;
  try {url=new URL(text);} catch {throw new LinkError('unsupported');}
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) throw new LinkError('unsupported');
  return url;
}

// A photos.google.com share URL, optionally with the signed-in /u/<n>/ prefix.
function shareUrl(url) {
  if(url.hostname!==ALBUM_HOST) return null;
  const match=/^(?:\/u\/[0-9]{1,2})?\/share\/([A-Za-z0-9_-]{10,200})\/?$/.exec(url.pathname);
  const key=url.searchParams.get('key');
  if(!match || !key || !TOKEN.test(key)) return null;
  return `https://${ALBUM_HOST}/share/${match[1]}?key=${key}`;
}

/** The canonical album URL to fetch, or a LinkError. */
export function albumLink(value) {
  const url=parse(value);
  if(url.hostname===SHORT_HOST) {
    const match=/^\/([A-Za-z0-9_-]{4,64})\/?$/.exec(url.pathname);
    if(!match) throw new LinkError('unsupported');
    return {kind:'short',url:`https://${SHORT_HOST}/${match[1]}`};
  }
  const share=shareUrl(url);
  if(!share) throw new LinkError('unsupported');
  return {kind:'share',url:share};
}

/** A redirect hop from the short link is allowed only to a share page. */
export function allowedRedirect(url) {
  return shareUrl(url)!==null;
}

// Keep the 'dayframe-photos' prefix. A new prefix orphans every stored album cache.
/** A stable key for the configured album that does not reveal the link. */
export function linkKey(canonical) {
  return createHash('sha256').update('dayframe-photos\0'+canonical).digest('hex').slice(0,32);
}
