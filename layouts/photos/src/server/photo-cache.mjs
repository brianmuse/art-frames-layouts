// Display-ready photos in /site-state/photos. Each photo is stored at no more
// than its own resolution and the display's: cover photos are already cropped to
// the screen shape; contain photos also get a small blurred, darkened backdrop.
// WeasyPrint has no CSS filter support, so the blur is done here with sharp, and
// the renderer scales both images up. Nothing is enlarged here, which keeps
// image memory small.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {privateDirectory,createStateFile} from './state-file.mjs';
import {getOnce,ProviderError} from './fetch.mjs';
import {imageHost} from './album-link.mjs';
import {requestBox,sizedUrl} from './image-url.mjs';

sharp.cache(false);
sharp.concurrency(1);

export const MAX_RESPONSE_BYTES=25_000_000;
const MAX_FILE_BYTES=20_000_000;
const MAX_SOURCE_BYTES=24_000_000;
const NAME=/^[a-f0-9]{24}-(?:cover|contain)-[0-9]{2,4}x[0-9]{2,4}$/;
export const validName=name=>typeof name==='string' && NAME.test(name);

export function photoName(itemId,fit,box) {
  const hash=createHash('sha256').update('photo\0'+itemId).digest('hex').slice(0,24);
  return `${hash}-${fit}-${box.width}x${box.height}`;
}

/** Download one album photo from the image CDN at the requested size. */
export async function downloadImage(item,request,{timeoutMs=60000}={}) {
  const url=sizedUrl(item.url,request);
  if(!url) throw new ProviderError('unsupported-address');
  const result=await getOnce(url,imageHost,{limit:MAX_SOURCE_BYTES,timeoutMs,accept:'image/jpeg,image/webp,image/png,image/*;q=0.8'});
  if(!/^image\//i.test(result.type)) throw new ProviderError('not-image');
  return result.body;
}

/**
 * Prepare one photo for the box. Returns {photo, width, height, backdrop}: a JPEG
 * at most box size (cover: cropped to the box shape) and, for contain, a small
 * blurred backdrop JPEG in the box shape.
 */
export async function composeFrame(source,fit,box) {
  const input=()=>sharp(source,{limitInputPixels:80_000_000,failOn:'error'}).rotate();
  const meta=await sharp(source,{limitInputPixels:80_000_000}).metadata();
  // EXIF orientations 5–8 swap width and height.
  const turned=(meta.orientation || 1)>=5;
  const width=turned?meta.height:meta.width,height=turned?meta.width:meta.height;
  if(!width || !height) throw new ProviderError('not-image');
  let photo,backdrop=null,size;
  if(fit==='cover') {
    const outWidth=Math.max(1,Math.round(Math.min(box.width,width,height*box.width/box.height)));
    size={width:outWidth,height:Math.max(1,Math.round(outWidth*box.height/box.width))};
    photo=await input().resize(size.width,size.height,{fit:'cover',position:sharp.strategy.attention}).jpeg({quality:86}).toBuffer();
  } else {
    const scale=Math.min(1,box.width/width,box.height/height);
    size={width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
    photo=await input().resize(size.width,size.height,{fit:'fill'}).jpeg({quality:86}).toBuffer();
    // A small, strongly blurred copy looks smooth when the renderer scales it up.
    const small={width:Math.max(16,Math.round(box.width/8)),height:Math.max(9,Math.round(box.height/8))};
    backdrop=await input().resize(small.width,small.height,{fit:'cover'}).blur(14).modulate({brightness:.45,saturation:.9}).jpeg({quality:90}).toBuffer();
  }
  if(photo.length>MAX_FILE_BYTES) photo=await sharp(photo).jpeg({quality:70}).toBuffer();
  if(photo.length>MAX_FILE_BYTES) throw new ProviderError('too-large');
  return {photo,backdrop,...size};
}

export function createPhotoCache(root,{maxBytes=300_000_000,maxEntries=400,fetchImage=downloadImage,compose=composeFrame}={}) {
  const directory=root && path.join(root,'photos');
  const indexFile=createStateFile(directory,'index.json',{maxBytes:400_000});
  let entries=null,loading=null,saveTimer=null;
  // Downloads run one at a time, which keeps memory use flat. A render that waits
  // on a photo uses the urgent lane, so it does not wait behind downloads ahead.
  const pending=new Map();
  const lanes={urgent:[],normal:[]};
  let running=false;
  function pump() {
    if(running) return;
    const job=lanes.urgent.shift() || lanes.normal.shift();
    if(!job) return;
    running=true;job.lane=null;
    job.run().then(job.resolve,job.reject).finally(()=>{running=false;pump();});
  }

  async function load() {
    if(entries) return entries;
    return loading ||= (async()=>{
      const saved=await indexFile.load();
      const result=new Map();
      for(const [name,entry] of Object.entries(saved?.entries || {})) {
        if(!validName(name) || !entry || !Number.isSafeInteger(entry.bytes)) continue;
        try {
          const stat=await fs.lstat(path.join(directory,name+'.jpg'));
          if(stat.isFile() && !stat.isSymbolicLink() && Number.isSafeInteger(entry.width) && Number.isSafeInteger(entry.height)) result.set(name,{bytes:entry.bytes,usedAt:Number(entry.usedAt) || 0,itemId:String(entry.itemId || ''),width:entry.width,height:entry.height,backdrop:entry.backdrop===true});
        } catch {/* missing file: drop the entry */}
      }
      // Remove files the index does not know, such as a write cut short by a restart.
      // Without a readable index nothing is known, so keep every file.
      const known=new Set(['index.json']);
      for(const [name,entry] of result) {known.add(name+'.jpg');if(entry.backdrop) known.add(name+'-backdrop.jpg');}
      let names=[];
      try {names=directory && saved?await fs.readdir(directory):[];} catch {/* no directory yet */}
      await Promise.all(names.filter(name=>!known.has(name)).map(name=>fs.unlink(path.join(directory,name)).catch(()=>{})));
      entries=result;
      return entries;
    })();
  }
  const save=()=>indexFile.save({version:1,entries:Object.fromEntries(entries)});
  // Reads touch usedAt often; write the index at most every few seconds.
  const saveSoon=()=>{if(!saveTimer) {saveTimer=setTimeout(()=>{saveTimer=null;void save();},5000);saveTimer.unref?.();}};

  async function write(file,body) {
    await privateDirectory(directory);
    const temporary=path.join(directory,'.'+randomUUID()+'.tmp');
    try {
      await fs.writeFile(temporary,body,{mode:0o600,flag:'wx'});
      await fs.rename(temporary,path.join(directory,file));
    } finally {await fs.unlink(temporary).catch(()=>{});}
  }
  const files=name=>[name+'.jpg',name+'-backdrop.jpg'];
  const removeFiles=name=>Promise.all(files(name).map(file=>fs.unlink(path.join(directory,file)).catch(()=>{})));

  const cache={
    directory,
    load,
    totals() {
      let bytes=0;for(const entry of entries?.values() || []) bytes+=entry.bytes;
      return {bytes,count:entries?.size || 0};
    },
    async has(name) {return (await load()).has(name);},
    /** Download and compose one photo once. Concurrent calls share the work. */
    async prepare(item,{fit,box,urgent=false}) {
      await load();
      const name=photoName(item.id,fit,box);
      if(entries.has(name)) return name;
      const waiting=pending.get(name);
      if(waiting) {
        // Move a queued download to the urgent lane when a render needs it now.
        if(urgent && waiting.lane==='normal') {
          lanes.normal.splice(lanes.normal.indexOf(waiting),1);
          lanes.urgent.push(waiting);waiting.lane='urgent';
        }
        return waiting.promise;
      }
      const job={lane:urgent?'urgent':'normal',run:async()=>{
        if(entries.has(name)) return name;
        const source=await fetchImage(item,requestBox(item,box,fit));
        const frame=await compose(source,fit,box);
        if(frame.backdrop) await write(name+'-backdrop.jpg',frame.backdrop);
        await write(name+'.jpg',frame.photo);
        entries.set(name,{bytes:frame.photo.length+(frame.backdrop?.length || 0),usedAt:Date.now(),itemId:item.id,width:frame.width,height:frame.height,backdrop:Boolean(frame.backdrop)});
        await save();
        return name;
      }};
      job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
      pending.set(name,job);
      lanes[job.lane].push(job);
      pump();
      try {return await job.promise;} finally {pending.delete(name);}
    },
    /** The stored size and parts of one photo, or null. */
    async info(name) {
      await load();
      const entry=entries.get(name);
      return entry?{width:entry.width,height:entry.height,backdrop:entry.backdrop}:null;
    },
    /** Read the photo, or its backdrop with part 'backdrop'. */
    async read(name,part='photo') {
      if(!validName(name) || !['photo','backdrop'].includes(part)) return null;
      await load();
      const entry=entries.get(name);
      if(!entry || (part==='backdrop' && !entry.backdrop)) return null;
      try {
        const file=path.join(directory,name+(part==='backdrop'?'-backdrop.jpg':'.jpg'));
        const stat=await fs.lstat(file);
        if(!stat.isFile() || stat.isSymbolicLink() || stat.size>MAX_RESPONSE_BYTES) return null;
        const body=await fs.readFile(file);
        entry.usedAt=Date.now();saveSoon();
        return body;
      } catch {return null;}
    },
    touch(name) {const entry=entries?.get(name);if(entry) {entry.usedAt=Date.now();saveSoon();}},
    /**
     * Remove photos that left the album, then the least recently used ones until
     * the cache is within its size and count bounds. Names in keep stay.
     */
    async evict({keep=new Set(),itemIds=null}={}) {
      await load();
      const remove=[];
      for(const [name,entry] of entries) if(itemIds && !itemIds.has(entry.itemId) && !keep.has(name)) remove.push(name);
      for(const name of remove) entries.delete(name);
      let {bytes,count}=cache.totals();
      const oldest=[...entries].filter(([name])=>!keep.has(name)).sort((a,b)=>a[1].usedAt-b[1].usedAt);
      for(const [name,entry] of oldest) {
        if(bytes<=maxBytes && count<=maxEntries) break;
        entries.delete(name);remove.push(name);bytes-=entry.bytes;count--;
      }
      if(!remove.length) return [];
      await save();
      await Promise.all(remove.map(removeFiles));
      return remove;
    },
    async flush() {clearTimeout(saveTimer);saveTimer=null;await save();},
  };
  return cache;
}
