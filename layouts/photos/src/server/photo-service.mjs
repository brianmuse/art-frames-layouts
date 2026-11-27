// Album sync, photo download and the per-render choice. One instance serves the
// background loop and every render, so they share the cache and the rotation.
import {albumLink,allowedRedirect,linkKey,pageHost,LinkError} from './album-link.mjs';
import {parseAlbum,MAX_PAGE_BYTES} from './album-parser.mjs';
import {getFollowing,backoffMs,ProviderError} from './fetch.mjs';
import {createStateFile} from './state-file.mjs';
import {createPhotoCache,photoName} from './photo-cache.mjs';
import {createRotation} from './rotation.mjs';
import {appSettings,displaySettings,loadConfig} from './settings.mjs';
import {createHash} from 'node:crypto';

export const MESSAGES=Object.freeze({
  missing:'Add a Google Photos shared album link in this layout’s settings.',
  unsupported:'This link isn’t a Google Photos shared album link. Copy the album’s Share link again.',
  parse:'Couldn’t read the album. Google may have changed the page. Check that link sharing is on for the album, then try again later.',
  denied:'The album link no longer works. Check that the album is still shared.',
  redirect:'The album link led to an unexpected page. Copy the album’s Share link again.',
  network:'Couldn’t reach Google Photos. The layout will try again.',
  empty:'The album has no photos yet.',
  download:'Couldn’t download photos from the album. The layout will try again.',
});

export function errorMessage(code) {
  if(code==='parse') return MESSAGES.parse;
  if(code==='missing' || code==='unsupported') return MESSAGES[code];
  if(code==='access-denied' || code==='not-found') return MESSAGES.denied;
  if(code==='redirect') return MESSAGES.redirect;
  return MESSAGES.network;
}

/** Fetch the album page, following the short link only to a share page. */
export async function fetchAlbumPage(canonical,{timeoutMs=30000}={}) {
  const result=await getFollowing(canonical,pageHost,{
    maxRedirects:3,limit:MAX_PAGE_BYTES,timeoutMs,accept:'text/html',
    allowHop:url=>allowedRedirect(url),
  });
  if(!/^text\/html/i.test(result.type)) throw new ProviderError('parse');
  return result.body;
}

const FRAME={width:3840,height:2160};
const DOWNLOAD_FAILURE_LIMIT=3;
const STALE_NOTICE_MS=24*3600000;

/** The target box: the mat opening when Art Frames sends one, else the whole frame. */
export function targetBox(snapshot) {
  const width=Number.isSafeInteger(snapshot?.display?.width) && snapshot.display.width>0 && snapshot.display.width<=7680?snapshot.display.width:FRAME.width;
  const height=Number.isSafeInteger(snapshot?.display?.height) && snapshot.display.height>0 && snapshot.display.height<=4320?snapshot.display.height:FRAME.height;
  const view=snapshot?.art?.viewport;
  if(view && ['x','y','width','height'].every(key=>Number.isSafeInteger(view[key])) && view.x>=0 && view.y>=0 && view.width>=16 && view.height>=9 && view.x+view.width<=width && view.y+view.height<=height) {
    return {x:view.x,y:view.y,width:view.width,height:view.height,frame:{width,height}};
  }
  return {x:0,y:0,width,height,frame:{width,height}};
}

const DAY_MS=86400000;

// The zone's offset from UTC at this instant, in ms.
function zoneOffset(ms,timeZone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(new Date(ms));
  const part=name=>Number(parts.find(item=>item.type===name)?.value);
  const local=Date.UTC(part('year'),part('month')-1,part('day'),part('hour'),part('minute'),part('second'));
  return local-Math.floor(ms/1000)*1000;
}

/**
 * The time bucket for this render, as {start, end} in epoch ms. Minute intervals
 * floor the local time, so 30 and 60 minutes change on :00 and :30 local in any
 * zone. Once a day runs from local midnight to the next. The snapshot time is used
 * unless it is missing or more than a day ahead of the layout's clock.
 */
export function timeBucket(snapshot,every,clockMs=Date.now()) {
  let ms=Date.parse(snapshot?.now);
  if(!Number.isFinite(ms) || ms>clockMs+DAY_MS) ms=clockMs;
  const timeZone=validZone(snapshot?.timezone)?snapshot.timezone:'UTC';
  if(every==='day') {
    // The local date as a day number. Where clocks jump or repeat at midnight
    // (Santiago, Havana), the day starts at its first real instant.
    const localDay=at=>Math.floor((at+zoneOffset(at,timeZone))/DAY_MS);
    const firstInstant=day=>{
      let low=day*DAY_MS-36*3600000,high=day*DAY_MS+36*3600000;
      while(high-low>1000) {const mid=Math.floor((low+high)/2/1000)*1000;if(localDay(mid)>=day) high=mid;else low=mid;}
      return high;
    };
    const today=localDay(ms);
    return {start:firstInstant(today),end:firstInstant(today+1)};
  }
  const offset=zoneOffset(ms,timeZone);
  const start=Math.floor((ms+offset)/every)*every-offset;
  return {start,end:start+every};
}

// Errors that mean the network or Google is down, not that one photo is bad.
const TRANSPORT=new Set(['network','timeout','blocked-address','rate-limited','unavailable']);
const ITEM_RETRY_CAP_MS=6*3600000;

/**
 * The rotation key for this TV. Hosts that send display.id get one rotation per
 * TV; without it, all TVs share the empty key. The id is opaque, so only a hash
 * of it is kept.
 */
export function displayKey(snapshot) {
  const id=snapshot?.display?.id;
  if(typeof id!=='string' || !id || id.length>200) return '';
  return createHash('sha256').update(id).digest('hex').slice(0,24);
}

const validZone=zone=>{
  if(typeof zone!=='string' || !zone || zone.length>64) return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:zone}).format();return true;} catch {return false;}
};

/** "June 3, 2018" in the photo's own local time. */
export function takenLabel(item) {
  if(!Number.isFinite(item?.takenAt)) return null;
  const date=new Date(item.takenAt+(item.offsetMs || 0));
  if(Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'});
}

export function clockLabel(snapshot) {
  const now=new Date(snapshot?.now);
  if(Number.isNaN(now.getTime())) return null;
  const timeZone=validZone(snapshot?.timezone)?snapshot.timezone:'UTC';
  return now.toLocaleTimeString('en-US',{timeZone,hour:'numeric',minute:'2-digit'});
}

export function createPhotoService({
  root=process.env.DAYFRAME_SITE_STATE,
  settings=loadConfig,
  fetchPage=fetchAlbumPage,
  cache=createPhotoCache(root),
  rotation=createRotation(createStateFile(root,'rotation.json',{maxBytes:2_000_000})),
  albumFile=createStateFile(root,'album.json',{maxBytes:2_000_000}),
  clock=()=>Date.now(),
  renderWaitMs=3000,
}={}) {
  let album=null,albumLoaded=null,syncing=null;
  const prefetching=new Map();
  // Displays that rendered recently and their boxes, so the background loop
  // downloads ahead for each. The shared key '' joins only when a render has no
  // display.id.
  const displays=new Map();
  // Network or Google failures in a row. Bad single photos do not count.
  let downloadFailures=0,downloadRetryAt=0;
  // Photos that failed to download: id -> {failures, retryAt, url}. A failing photo
  // is skipped until its retry time, so it cannot stop the rotation.
  const itemFailures=new Map();
  // Downloads wait for the retry time; the rotation passes over a failed photo
  // until a download succeeds, so the cycle can finish without it.
  const waiting=id=>(itemFailures.get(id)?.retryAt ?? 0)>clock();
  const failed=id=>itemFailures.has(id);

  async function loadAlbum() {
    if(album) return album;
    return albumLoaded ||= albumFile.load().then(saved=>{
      album=saved && typeof saved==='object' && Array.isArray(saved.items)?saved:{version:1,items:[]};
      return album;
    });
  }

  async function syncAlbum(key,canonical) {
    const prior=await loadAlbum();
    const attemptAt=clock();
    try {
      const parsed=parseAlbum(await fetchPage(canonical));
      album={version:1,albumKey:key,syncedAt:attemptAt,attemptAt,method:parsed.method,videos:parsed.videos,more:parsed.more,items:parsed.items,error:null,failures:0};
      // A new photo list: forget failures for another album, for photos that left
      // and for photos with a new URL, so they get a fresh try.
      if(prior.albumKey!==key) itemFailures.clear();
      else {
        const urls=new Map(parsed.items.map(item=>[item.id,item.url]));
        for(const [id,entry] of itemFailures) if(urls.get(id)!==entry.url) itemFailures.delete(id);
      }
      if(parsed.more) console.warn(`Album has more photos than its page lists; using the first ${parsed.items.length}`);
    } catch(error) {
      const code=error instanceof ProviderError || error?.code==='parse'?error.code:'unavailable';
      const failures=(prior.albumKey===key?prior.failures || 0:0)+1;
      // A failed sync keeps the last good photo list for the same album.
      album={...(prior.albumKey===key?prior:{version:1,albumKey:key,items:[],syncedAt:null}),attemptAt,error:{code,at:attemptAt},failures};
      console.warn(`Album sync failed: ${code}`);
    }
    await albumFile.save(album);
    return album;
  }

  function due(current,key,syncMs) {
    if(current.albumKey!==key) return true;
    if(current.error) return clock()-(current.attemptAt || 0)>=Math.min(syncMs,backoffMs(current.failures || 1));
    return clock()-(current.syncedAt || 0)>=syncMs;
  }

  // Coalesce: one album sync at a time. A sync for a different link waits for the
  // running one, then runs, so a link change is never answered with the old album.
  function syncNow(key,canonical) {
    if(syncing && syncing.key===key) return syncing.promise;
    const before=syncing?syncing.promise.catch(()=>{}):Promise.resolve();
    const entry={key};
    entry.promise=before.then(()=>syncAlbum(key,canonical)).finally(()=>{if(syncing===entry) syncing=null;});
    syncing=entry;
    return entry.promise;
  }

  // Download one photo for a box. Returns 'ok', 'item' (this photo is bad) or
  // 'transport' (the network or Google is down).
  async function download(item,{fit,box,urgent=false}) {
    try {
      await cache.prepare(item,{fit,box,urgent});
      downloadFailures=0;itemFailures.delete(item.id);
      return 'ok';
    } catch(error) {
      const code=error?.code || 'image';
      console.warn(`Photo download failed: ${code}`);
      if(TRANSPORT.has(code)) {
        // Google or the network is down: wait before trying any photo.
        downloadFailures++;
        downloadRetryAt=clock()+backoffMs(downloadFailures,15*60000);
        return 'transport';
      }
      // This photo is bad (gone, not an image, too large, cannot decode): skip it for a while.
      const failures=(itemFailures.get(item.id)?.failures || 0)+1;
      itemFailures.delete(item.id);
      itemFailures.set(item.id,{failures,retryAt:clock()+backoffMs(failures,ITEM_RETRY_CAP_MS),url:item.url});
      if(itemFailures.size>4000) itemFailures.delete(itemFailures.keys().next().value);
      return 'item';
    }
  }

  function prefetch(items,{order,albumKey,fit,box,display=''}) {
    const job=`${display}|${fit}|${box.width}x${box.height}`;
    if(prefetching.has(job)) return prefetching.get(job);
    if(clock()<downloadRetryAt) return Promise.resolve();
    const task=(async()=>{
      const byId=new Map(items.map(item=>[item.id,item]));
      const ids=await rotation.upcoming(items,{order,albumKey,skip:waiting,count:4,display});
      const keep=new Set(ids.map(id=>photoName(id,fit,box)));
      const current=await rotation.current(display);
      if(current) keep.add(photoName(current,fit,box));
      for(const id of ids) if(await download(byId.get(id),{fit,box})==='transport') break;
      await cache.evict({keep,itemIds:new Set(byId.keys())});
    })().finally(()=>{prefetching.delete(job);});
    prefetching.set(job,task);
    return task;
  }

  const wait=(promise,ms)=>Promise.race([Promise.resolve(promise).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,ms))]);

  const service={
    cache,
    /** One background pass: sync the album when due, then download ahead. */
    async tick() {
      const config=appSettings(await settings());
      let link;
      try {link=albumLink(config.albumUrl);} catch {return;}
      const key=linkKey(link.url);
      let current=await loadAlbum();
      if(due(current,key,config.syncMs)) current=await syncNow(key,link.url);
      if(current.albumKey!==key || !current.items.length) return;
      const targets=displays.size?displays:new Map([['',{width:FRAME.width,height:FRAME.height}]]);
      for(const [display,box] of targets) await prefetch(current.items,{order:config.order,albumKey:key,fit:config.fit,box,display});
    },
    /**
     * Decide this render. Returns {status:202} while the first photo is not ready,
     * or {status:200, view}. Never throws for album or download problems.
     */
    async render(snapshot) {
      const display=displaySettings(snapshot);
      const box=targetBox(snapshot);
      const base={box,display,clock:display.showClock?clockLabel(snapshot):null};
      const message=text=>({status:200,view:{...base,photo:null,message:text}});
      let config;
      try {config=appSettings(await settings());} catch {return message(MESSAGES.network);}
      let link;
      try {link=albumLink(config.albumUrl);} catch(error) {return message(MESSAGES[error instanceof LinkError?error.code:'unsupported'] || MESSAGES.unsupported);}
      const key=linkKey(link.url);
      const tv=displayKey(snapshot);
      displays.delete(tv);displays.set(tv,{width:box.width,height:box.height});
      if(displays.size>8) displays.delete(displays.keys().next().value);
      let current=await loadAlbum();
      if(current.albumKey!==key) {
        const pending=syncNow(key,link.url);
        current=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),renderWaitMs))]) || current;
        if(current.albumKey!==key) return {status:202};
      }
      if(!current.items.length) return message(current.error?errorMessage(current.error.code):MESSAGES.empty);
      const options={order:config.order,albumKey:key,fit:config.fit,box:{width:box.width,height:box.height},display:tv};
      await cache.load();
      const readyNames=new Set();
      const ready=id=>readyNames.has(photoName(id,config.fit,options.box));
      const refresh=async()=>{readyNames.clear();for(const item of current.items) {const name=photoName(item.id,config.fit,options.box);if(await cache.has(name)) readyNames.add(name);}};
      await refresh();
      // "scheduled", "prepare" and "rotation" are normal renders; only a preview stays still.
      const advance=snapshot?.render_purpose!=='preview';
      const bucket=timeBucket(snapshot,config.photoEvery,clock());
      const choice={...options,ready,skip:failed,bucket,now:clock(),advance};
      let id=await rotation.choose(current.items,choice);
      if(id && !ready(id)) {
        // The photo for this bucket is not ready for this box yet (another TV size,
        // a mat or a fit change): prepare it instead of moving the rotation on.
        const item=current.items.find(entry=>entry.id===id);
        if(clock()>=downloadRetryAt) await wait(download(item,{fit:config.fit,box:options.box,urgent:true}),renderWaitMs);
        await refresh();
        if(!ready(id)) id=null;
        else Promise.resolve(prefetch(current.items,options)).catch(()=>{});
      } else if(!id) {
        // Nothing is ready: download the next photo first, ahead of other downloads.
        const [next]=await rotation.upcoming(current.items,{...options,skip:waiting,count:1});
        const first=next && clock()>=downloadRetryAt?download(current.items.find(entry=>entry.id===next),{fit:config.fit,box:options.box,urgent:true}):null;
        const ahead=prefetch(current.items,options);
        // If that photo fails, wait for the others instead.
        await wait((async()=>{if(first && await first==='ok') return;await ahead;})(),renderWaitMs);
        await refresh();
        id=await rotation.choose(current.items,choice);
        if(id && !ready(id)) id=null;
      } else Promise.resolve(prefetch(current.items,options)).catch(()=>{});
      const allFailed=current.items.every(item=>failed(item.id));
      if(!id) return downloadFailures>=DOWNLOAD_FAILURE_LIMIT || allFailed?message(MESSAGES.download):{status:202};
      const item=current.items.find(entry=>entry.id===id);
      const name=photoName(id,config.fit,options.box);
      cache.touch(name);
      const info=await cache.info(name);
      const stale=current.error && clock()-(current.syncedAt || 0)>STALE_NOTICE_MS;
      return {status:200,view:{
        ...base,
        photo:{src:`/photo/${name}.jpg`,backdrop:info?.backdrop?`/photo/${name}-backdrop.jpg`:null,width:info?.width || box.width,height:info?.height || box.height,fit:config.fit},
        caption:display.showCaption?takenLabel(item):null,
        notice:stale?errorMessage(current.error.code):null,
        message:null,
      }};
    },
  };
  return service;
}

export function startPhotoSync(service,{intervalMs=60000}={}) {
  let stopped=false,timer;
  async function tick() {
    try {await service.tick();} catch {console.warn('Photo background sync could not complete');}
    if(!stopped) {timer=setTimeout(tick,intervalMs);timer.unref?.();}
  }
  void tick();
  return ()=>{stopped=true;clearTimeout(timer);};
}
