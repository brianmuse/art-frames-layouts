// Hardened HTTPS GET for fixed Google hosts: public DNS pinning, bounded bodies,
// deadlines and manual redirects. Adapted from the morning layout's fetch helper.
import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class ProviderError extends Error {
  constructor(code='unavailable',details={}) {
    super('Provider unavailable');
    this.code=code;
    if(Number.isInteger(details.status) && details.status>=100 && details.status<=599) this.status=details.status;
  }
}
// Retry cooldown after a failure: 1, 2, 4… minutes, capped.
export const backoffMs=(failures,capMs=3_600_000)=>Math.min(capMs,60000*2**Math.max(0,failures-1));

export function publicAddress(address) {
  try {
    let parsed=ipaddr.parse(address);
    if(parsed.kind()==='ipv6' && parsed.isIPv4MappedAddress()) parsed=parsed.toIPv4Address();
    return parsed.range()==='unicast';
  } catch {return false;}
}

// allowHost is a predicate on the lowercase host name. Only https on port 443.
export function checkUrl(value,allowHost) {
  let url;
  try {url=value instanceof URL?new URL(value.href):new URL(value);} catch {throw new ProviderError('invalid-address');}
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !allowHost(url.hostname)) throw new ProviderError('unsupported-address');
  return url;
}

/**
 * One GET. Returns {status:200, body:Buffer, type} or, with redirects allowed,
 * {status:3xx, location:URL} without reading the body. Never follows a redirect itself.
 */
export async function getOnce(value,allowHost,{limit=8_000_000,timeoutMs=20000,allowRedirect=false,accept='*/*'}={}) {
  const url=checkUrl(value,allowHost);
  const signal=AbortSignal.timeout(Math.max(1,Math.min(120000,Math.floor(timeoutMs))));
  let addresses;
  try {
    addresses=await Promise.race([
      dns.lookup(url.hostname,{all:true}),
      new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new ProviderError('timeout')),{once:true})),
    ]);
  } catch {throw new ProviderError(signal.aborted?'timeout':'network');}
  if(!addresses.length || addresses.some(item=>!publicAddress(item.address))) throw new ProviderError('blocked-address');
  const pinned=addresses.find(item=>item.family===4) || addresses[0];
  return new Promise((resolve,reject)=>{
    let size=0;
    const request=https.get(url,{
      agent:false,signal,servername:url.hostname,
      lookup:(_host,options,done)=>options.all?done(null,[pinned]):done(null,pinned.address,pinned.family),
      headers:{'User-Agent':'ArtFrames-Photos/0.1','Accept-Encoding':'identity','Accept':accept},
    },response=>{
      const status=response.statusCode;
      if(allowRedirect && [301,302,303,307,308].includes(status)) {
        const location=response.headers.location;
        response.destroy();
        let next;
        try {next=new URL(location,url);} catch {reject(new ProviderError('redirect',{status}));return;}
        resolve({status,location:next});
        return;
      }
      if(status!==200) {
        response.destroy();
        reject(new ProviderError(status===401 || status===403?'access-denied':status===404 || status===410?'not-found':status===429?'rate-limited':status>=300 && status<400?'redirect':'unavailable',{status}));
        return;
      }
      const declared=Number(response.headers['content-length']);
      if(Number.isFinite(declared) && declared>limit) {response.destroy();reject(new ProviderError('too-large'));return;}
      const parts=[];
      response.on('data',part=>{
        size+=part.length;
        if(size>limit) {reject(new ProviderError('too-large'));response.destroy();return;}
        parts.push(part);
      });
      response.on('end',()=>{
        if(response.complete===false) {reject(new ProviderError('network'));return;}
        resolve({status,body:Buffer.concat(parts),type:String(response.headers['content-type'] || '')});
      });
      response.on('error',()=>reject(new ProviderError(size>limit?'too-large':signal.aborted?'timeout':'network')));
    });
    request.on('error',()=>reject(new ProviderError(size>limit?'too-large':signal.aborted?'timeout':'network')));
  });
}

/**
 * GET with redirects. Each hop is checked again with allowHop(url, hop) before the
 * request; allowHop throws or returns false to stop.
 */
export async function getFollowing(value,allowHost,{maxRedirects=3,allowHop=()=>true,...options}={}) {
  let url=checkUrl(value,allowHost);
  for(let hop=0;;hop++) {
    const result=await getOnce(url,allowHost,{...options,allowRedirect:true});
    if(!result.location) return {...result,url};
    if(hop>=maxRedirects) throw new ProviderError('redirect');
    url=checkUrl(result.location,allowHost);
    if(!allowHop(url,hop+1)) throw new ProviderError('redirect');
  }
}
