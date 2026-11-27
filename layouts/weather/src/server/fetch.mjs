import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

class ProviderFailure extends Error {
  constructor(code='unavailable',details={}) {
    super('Provider unavailable');
    this.code=code;
    if(Number.isInteger(details.status) && details.status>=100 && details.status<=599) this.status=details.status;
    if(['dns','connect','tls','headers','body'].includes(details.phase)) this.phase=details.phase;
    if(['ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(details.transport)) this.transport=details.transport;
    for(const key of ['received_bytes','limit_bytes','content_length']) {
      if(Number.isSafeInteger(details[key]) && details[key]>=0 && details[key]<=1_000_000_000) this[key]=details[key];
    }
  }
}
export const ProviderError=ProviderFailure;
// Shared retry cooldown: 1, 2, 4… minutes, capped at an hour.
export const backoffMs=failures=>Math.min(3_600_000,60000*2**Math.max(0,failures-1));

export function validateUrl(value, hosts) {
  let url;
  try {url=new URL(value);} catch {throw new ProviderError('invalid-address');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !hosts.includes(url.hostname)) throw new ProviderError('unsupported-address');
  return url;
}

export function publicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}

// Copied from the news layout. Open-Meteo does not redirect, so callers pass
// redirects:0. redirects follows at most that many hops, and only to the fixed
// hosts. The deadline covers every hop.
export async function fetchText(value, hosts, limit = 4_000_000, {timeoutMs=5000,transform=null,redirects=0,deadline=null}={}) {
  const url = validateUrl(value, hosts);
  const end = deadline ?? Date.now()+Math.max(1,Math.min(180000,Math.floor(timeoutMs)));
  if (end <= Date.now()) throw new ProviderError('timeout');
  const signal = AbortSignal.timeout(Math.max(1,end-Date.now()));
  let addresses;
  try { addresses = await Promise.race([
    dns.lookup(url.hostname, {all:true}),
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError('timeout')), {once:true})),
  ]); } catch(error) {throw new ProviderError(signal.aborted ? 'timeout' : 'network',{phase:'dns',transport:error.code});}
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new ProviderError('blocked-address');
  const pinned = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    let phase='connect',size=0,status,contentLength;
    const failure=(code,error)=>new ProviderError(code,{phase,status,transport:error?.code,received_bytes:size,limit_bytes:limit,content_length:contentLength});
    const request = https.get(url, {
      agent:false, signal, servername:url.hostname,
      lookup: (_host, options, done) => options.all ? done(null, [pinned]) : done(null, pinned.address, pinned.family),
      headers:{'User-Agent':'ArtFrames-Weather/0.1', 'Accept-Encoding':'identity'},
    }, response => {
      phase='body';
      status=response.statusCode;
      contentLength=Number(response.headers?.['content-length']);
      if ([301,302,303,307,308].includes(response.statusCode) && redirects>0 && typeof response.headers?.location === 'string') {
        response.destroy();
        let next;
        try { next=new URL(response.headers.location, url).href; } catch { reject(new ProviderError('redirect',{status:response.statusCode,phase:'headers'})); return; }
        fetchText(next, hosts, limit, {transform, redirects:redirects-1, deadline:end}).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.destroy(); reject(new ProviderError(response.statusCode===401 || response.statusCode===403 ? 'access-denied' : response.statusCode===404 ? 'not-found' : response.statusCode===429 ? 'rate-limited' : response.statusCode>=300 && response.statusCode<400 ? 'redirect' : 'unavailable',{status:response.statusCode,phase:'headers'})); return; }
      const parts = [];
      response.on('data', part => {
        size += part.length;
        if (size > limit) {
          // Settle the limit failure before destroy can emit a request-level error.
          reject(failure('too-large'));
          response.destroy();
          return;
        }
        if(transform) {
          try {transform.write(part);} catch(error) {
            reject(failure(error.code==='projection-limit'?'projection-limit':'invalid-feed'));
            response.destroy();
          }
        } else parts.push(part);
      });
      response.on('end', () => {
        if(response.complete===false) {reject(failure('network'));return;}
        try {resolve(transform ? transform.finish() : Buffer.concat(parts).toString('utf8'));}
        catch(error) {reject(failure(error.code==='projection-limit'?'projection-limit':'invalid-feed'));}
      });
      response.on('error', error => reject(failure(size>limit ? 'too-large' : signal.aborted ? 'timeout' : 'network',error)));
    });
    request.on('socket',socket=>{
      socket.once('connect',()=>{phase='tls';});
      socket.once('secureConnect',()=>{phase='headers';});
    });
    request.on('error', error => reject(failure(size>limit ? 'too-large' : signal.aborted ? 'timeout' : 'network',error)));
  });
}

const cache = new Map();
// failSeconds briefly remembers a failure so each render does not wait on it again.
export async function cached(key, seconds, load, {failSeconds=0}={}) {
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.value;
  cache.delete(key);
  if (cache.size >= 16) cache.delete(cache.keys().next().value);
  const value = Promise.resolve().then(load).catch(error=>{throw error instanceof ProviderError ? error : new ProviderError();});
  value.catch(()=>{});
  const entry = {expires:Date.now()+seconds*1000, value};
  cache.set(key, entry);
  try { return await value; } catch(error) {
    if (cache.get(key)===entry) { if (failSeconds>0) entry.expires=Date.now()+failSeconds*1000; else cache.delete(key); }
    throw error;
  }
}
