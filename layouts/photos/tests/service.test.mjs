import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPhotoService,MESSAGES,targetBox,takenLabel,clockLabel,timeBucket} from '../src/server/photo-service.mjs';
import {createPhotoCache} from '../src/server/photo-cache.mjs';
import {appSettings,displaySettings,DEFAULTS} from '../src/server/settings.mjs';
import {sampleAlbumPage} from '../src/server/samples.mjs';
import {item,tinyImage} from './helpers.mjs';

const LINK='https://photos.app.goo.gl/SyntheticCode12';
const snapshot={version:1,now:'2026-10-27T07:30:00-04:00',timezone:'America/New_York',display:{width:3840,height:2160},data:{},display_settings:{show_caption:true,show_clock:false}};
const small={...snapshot,display:{width:160,height:90}};

async function setup(t,{page,fetchImage=async()=>tinyImage(),config={album_url:LINK},renderWaitMs=50,clock,wrapCache=cache=>cache}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'photos-service-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50}));
  const pages=[];
  const service=createPhotoService({
    root,settings:async()=>config,renderWaitMs,clock,
    fetchPage:async url=>{pages.push(url);return typeof page==='function'?page():page;},
    cache:wrapCache(createPhotoCache(root,{fetchImage})),
  });
  return {service,pages,root};
}

test('settings defaults match the manifest',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../layout.json',import.meta.url)));
  for(const setting of manifest.settings) if('default' in setting) assert.equal(DEFAULTS[setting.key],setting.default,setting.key);
  assert.deepEqual(appSettings({}),{albumUrl:'',photoEvery:900_000,syncMs:10_800_000,order:'shuffle',fit:'contain'});
  assert.deepEqual(appSettings({album_url:' x ',photo_interval:'Once a day',sync_interval:'Every hour',order:'Newest first',fit:'cover'}),{albumUrl:'x',photoEvery:'day',syncMs:3_600_000,order:'newest',fit:'cover'});
  assert.equal(appSettings({photo_interval:'5 minutes'}).photoEvery,300_000);
  assert.deepEqual(appSettings({photo_interval:'Every second',sync_interval:'Every minute',order:'Random',fit:'stretch',album_url:7}),appSettings({}));
  const display=Object.fromEntries(manifest.display_settings.map(setting=>[setting.key,setting.default]));
  assert.deepEqual(display,{show_caption:true,show_clock:false});
  assert.deepEqual(displaySettings({}),{showCaption:true,showClock:false});
  assert.deepEqual(displaySettings({display_settings:{show_caption:false,show_clock:true}}),{showCaption:false,showClock:true});
});

test('returns 202 until the first sync and the first photo are ready',async t=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {service}=await setup(t,{page:()=>gate.then(()=>sampleAlbumPage([item(1)]))});
  assert.deepEqual(await service.render(small),{status:202},'The album is still loading');
  release();
  const result=await untilShown(service,small);
  assert.equal(result.status,200);
  assert.match(result.view.photo.src,/^\/photo\/[a-f0-9]{24}-contain-160x90\.jpg$/);
  assert.equal(result.view.photo.backdrop,result.view.photo.src.replace('.jpg','-backdrop.jpg'));
  assert.deepEqual([result.view.photo.width,result.view.photo.height,result.view.photo.fit],[64,48,'contain']);
});

test('returns 202 while the first photo is still downloading',async t=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {service}=await setup(t,{page:sampleAlbumPage([item(1)]),fetchImage:()=>gate.then(()=>tinyImage())});
  assert.deepEqual(await service.render(small),{status:202});
  release();
  assert.equal((await untilShown(service,small)).status,200);
});

test('an unreadable album shows the clear failure message',async t=>{
  const {service}=await setup(t,{page:'<html><body>Something new</body></html>'});
  const result=await service.render(small);
  assert.equal(result.status,200);
  assert.equal(result.view.message,'Couldn’t read the album. Google may have changed the page. Check that link sharing is on for the album, then try again later.');
  assert.equal(result.view.photo,null);
});

test('missing and unsupported links explain what to do',async t=>{
  const missing=await setup(t,{config:{}});
  assert.equal((await missing.service.render(small)).view.message,MESSAGES.missing);
  const other=await setup(t,{config:{album_url:'https://evil.example/album'}});
  assert.equal((await other.service.render(small)).view.message,MESSAGES.unsupported);
  assert.equal(other.pages.length,0,'An unsupported link is never fetched');
});

test('an empty album says so',async t=>{
  const {service}=await setup(t,{page:sampleAlbumPage([])});
  assert.equal((await service.render(small)).view.message,MESSAGES.empty);
});

// Snapshots at a given minute offset from 07:30 New York time.
const at=(minutes,extra={})=>({...small,now:new Date(Date.parse(small.now)+minutes*60000).toISOString(),...extra});
const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
// Render until the photo shows. The test run is busy, so downloads can be slow.
async function untilShown(service,snap,tries=50) {
  let result;
  for(let n=0;n<tries;n++) {result=await service.render(snap);if(result.status===200) return result;await settle();}
  return result;
}
const src=result=>result.view.photo.src;

test('a preview render does not advance the photo',async t=>{
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3)]),config:{album_url:LINK,order:'Newest first'},renderWaitMs:500});
  const before=src(await service.render(at(0,{render_purpose:'preview'})));
  const first=src(await service.render(at(0)));
  assert.equal(first,before,'The preview shows the photo the next update shows');
  await settle();
  for(let n=1;n<4;n++) assert.equal(src(await service.render(at(n*15,{render_purpose:'preview'}))),first,'Previews never advance, even in a later bucket');
  const second=src(await service.render(at(60)));
  assert.notEqual(second,first,'A normal update in a later bucket advances');
});

test('the photo changes once per time bucket, not once per render',async t=>{
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3)]),config:{album_url:LINK,order:'Newest first',photo_interval:'15 minutes'},renderWaitMs:500});
  const first=src(await service.render(at(0)));
  await settle();
  // Plain website previews, wake prepares and layout-rotation renders in the same bucket.
  for(const minute of [1,5,14]) assert.equal(src(await service.render(at(minute))),first,`minute ${minute}`);
  const second=src(await service.render(at(15)));
  assert.notEqual(second,first);
  await settle();
  assert.equal(src(await service.render(at(29))),second);
  // Skipping several buckets moves one step only.
  const third=src(await service.render(at(120)));
  assert.notEqual(third,second);assert.notEqual(third,first);
});

test('a host clock that goes back does not advance again and does not fail',async t=>{
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3)]),config:{album_url:LINK,order:'Newest first'},renderWaitMs:500,clock:()=>Date.parse(small.now)});
  await service.render(at(0));await settle();
  const later=src(await service.render(at(30)));
  await settle();
  for(const minute of [0,-600,15,29]) {
    const result=await service.render(at(minute));
    assert.equal(result.status,200);assert.equal(src(result),later,`minute ${minute}`);
  }
  assert.equal(src(await service.render({...small,now:'not a date'})),later,'An invalid time uses the layout clock (minute 0), which is earlier');
});

test('time buckets: minutes floor the local time, and once a day follows the local date',()=>{
  const iso=ms=>new Date(ms).toISOString();
  const span=(now,every,timezone='America/New_York',clock=Date.parse(now))=>{const bucket=timeBucket({now,timezone},every,clock);return [iso(bucket.start),iso(bucket.end)];};
  assert.deepEqual(span('2026-10-27T07:44:59-04:00',900_000),span('2026-10-27T07:30:00-04:00',900_000));
  assert.deepEqual(span('2026-10-27T07:45:00-04:00',900_000),['2026-10-27T11:45:00.000Z','2026-10-27T12:00:00.000Z']);
  // A +5:30 zone: 30 and 60 minutes change on :00 and :30 local, not UTC.
  assert.deepEqual(span('2026-10-27T10:20:00+05:30',1_800_000,'Asia/Kolkata'),['2026-10-27T04:30:00.000Z','2026-10-27T05:00:00.000Z'],'10:00–10:30 local');
  assert.deepEqual(span('2026-10-27T10:50:00+05:30',3_600_000,'Asia/Kolkata'),['2026-10-27T04:30:00.000Z','2026-10-27T05:30:00.000Z'],'10:00–11:00 local');
  // Once a day runs from local midnight to the next, including 25-hour days.
  assert.deepEqual(span('2026-10-27T23:59:00-04:00','day'),span('2026-10-27T00:01:00-04:00','day'));
  assert.deepEqual(span('2026-10-27T10:20:00+05:30','day','Asia/Kolkata'),['2026-10-26T18:30:00.000Z','2026-10-27T18:30:00.000Z']);
  assert.deepEqual(span('2026-11-01T10:20:00-05:00','day'),['2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z']);
  // A missing time, or a time more than a day ahead of the layout clock, uses the layout clock.
  assert.deepEqual(timeBucket({now:'bad'},900_000,1_800_000),{start:1_800_000,end:2_700_000});
  const clock=Date.parse('2026-10-27T07:30:00-04:00');
  assert.deepEqual(span('2027-10-27T07:30:00-04:00',900_000,'America/New_York',clock),span('2026-10-27T07:30:00-04:00',900_000));
});

test('changing the interval still moves the photo on the next real step',async t=>{
  const config={album_url:LINK,order:'Newest first',photo_interval:'15 minutes'};
  let now=Date.parse(small.now);
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3),item(4)]),config,renderWaitMs:500,clock:()=>now});
  const caption=async minutes=>{now=Date.parse(small.now)+minutes*60000;const result=await service.render(at(minutes));await settle();return result.view.caption;};
  assert.equal(await caption(0),'January 5, 2020');
  // 15 minutes, then once a day: the photo holds for today and changes tomorrow.
  config.photo_interval='Once a day';
  assert.equal(await caption(20),'January 5, 2020');
  assert.equal(await caption(16*60),'January 5, 2020','Still today in New York');
  assert.equal(await caption(24*60),'January 4, 2020','The next day moves one step');
  assert.equal(await caption(25*60),'January 4, 2020');
  // Once a day, then 15 minutes: the next 15-minute step moves.
  config.photo_interval='15 minutes';
  assert.equal(await caption(25*60+15),'January 3, 2020');
  assert.equal(await caption(25*60+20),'January 3, 2020');
});

test('the same bucket keeps one photo for every box, size and fit',async t=>{
  const config={album_url:LINK,order:'Newest first'};
  const {service}=await setup(t,{page:sampleAlbumPage(Array.from({length:8},(_,n)=>item(n+1))),config,renderWaitMs:500,clock:()=>Date.parse(small.now)});
  // Eight photos, so the current photo is not among the next few downloads.
  const first=await service.render(at(0));
  assert.equal(first.view.caption,'January 9, 2020');
  await settle();
  // A second TV with another size, a mat, then a fit change, all in the same bucket.
  const cached=async result=>Boolean(await service.cache.read(/\/photo\/(.+)\.jpg$/.exec(result.view.photo.src)[1]));
  const other=await service.render({...at(1),display:{width:320,height:240}});
  assert.equal(other.view.caption,'January 9, 2020','A new box prepares the current photo instead of moving on');
  assert.match(other.view.photo.src,/-320x240\.jpg$/);
  assert.ok(await cached(other),'The page points at a photo that is in the cache');
  const matted=await service.render({...at(2),art:{viewport:{x:10,y:10,width:100,height:60}}});
  assert.equal(matted.view.caption,'January 9, 2020');
  assert.ok(await cached(matted));
  config.fit='cover';
  const covered=await service.render(at(3));
  assert.equal(covered.view.caption,'January 9, 2020');
  assert.ok(await cached(covered));
  config.fit='contain';
  assert.equal((await service.render(at(14))).view.caption,'January 9, 2020');
  assert.equal((await service.render(at(15))).view.caption,'January 8, 2020','The next bucket moves one step');
});

test('a held photo that is slow to prepare returns 202, then shows on the next render',async t=>{
  let slow=false,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {service}=await setup(t,{page:sampleAlbumPage(Array.from({length:8},(_,n)=>item(n+1))),config:{album_url:LINK,order:'Newest first'},renderWaitMs:200,clock:()=>Date.parse(small.now),
    fetchImage:async(entry,box)=>{if(slow && box.width<1000) await gate;return tinyImage();}});
  assert.equal((await service.render(at(0))).view.caption,'January 9, 2020');
  await settle();
  slow=true;
  const tv={display:{width:320,height:240}};
  assert.deepEqual(await service.render({...at(1),...tv}),{status:202},'The TV keeps its image while the photo prepares');
  release();
  await settle();
  const next=await service.render({...at(2),...tv});
  assert.equal(next.view.caption,'January 9, 2020','The same photo, not the next one');
  assert.ok(await service.cache.read(/\/photo\/(.+)\.jpg$/.exec(next.view.photo.src)[1]));
});

test('a render downloads its photo ahead of queued downloads for other TVs',async t=>{
  const urgent=[];
  const {service}=await setup(t,{page:sampleAlbumPage(Array.from({length:8},(_,n)=>item(n+1))),config:{album_url:LINK,order:'Newest first'},renderWaitMs:500,clock:()=>Date.parse(small.now),
    wrapCache:cache=>({...cache,prepare:(entry,options)=>{if(options.urgent) urgent.push([entry.id,options.box.width]);return cache.prepare(entry,options);},directory:cache.directory})});
  await service.render(at(0));
  await settle();
  await service.render({...at(1),display:{width:320,height:240}});
  assert.deepEqual(urgent,[[item(8).id,160],[item(8).id,320]],'The first photo and the held photo for the new box');
});

test('the background loop downloads only for TVs that rendered',async t=>{
  const boxes=new Set();
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2)]),config:{album_url:LINK},renderWaitMs:500,
    wrapCache:cache=>({...cache,prepare:(entry,options)=>{boxes.add(`${options.box.width}x${options.box.height}`);return cache.prepare(entry,options);},directory:cache.directory})});
  await untilShown(service,{...small,display:{...small.display,id:'kitchen'}});
  await service.tick();await settle();
  assert.ok(![...boxes].some(box=>/^3840x/.test(box)),`No downloads for an unused shared 4K rotation: ${[...boxes]}`);
});

test('the display id is stored only as a hash',async t=>{
  const {service,root}=await setup(t,{page:sampleAlbumPage([item(1),item(2)]),config:{album_url:LINK},renderWaitMs:500});
  const raw='Living-room-TV-raw-identifier-1234';
  await untilShown(service,{...small,display:{...small.display,id:raw}});
  await settle();
  const text=await fs.readFile(path.join(root,'rotation.json'),'utf8');
  assert.ok(!text.includes(raw),'The raw id is not saved');
  const keys=Object.keys(JSON.parse(text).displays);
  assert.equal(keys.length,1);
  assert.match(keys[0],/^[0-9a-f]{24}$/);
});

test('a new album clears failures, even for a photo id it shares with the old album',async t=>{
  const shared=item(1);
  let now=Date.parse(small.now),broken=true;
  const config={album_url:LINK,order:'Newest first'};
  const {service}=await setup(t,{config,renderWaitMs:500,clock:()=>now,
    page:()=>config.album_url===LINK?sampleAlbumPage([shared,item(2)]):sampleAlbumPage([shared]),
    fetchImage:async entry=>{if(entry.id===shared.id && broken) throw Object.assign(new Error('gone'),{code:'not-found'});return tinyImage();}});
  // The shared photo fails many times in the first album; its next try is hours away.
  for(let n=0;n<9;n++) {await service.render(at(n*61));now+=61*60000;await service.tick();}
  broken=false;
  config.album_url='https://photos.app.goo.gl/OtherSynthetic';
  const minutes=(now-Date.parse(small.now))/60000;
  const result=await untilShown(service,at(minutes),10);
  assert.equal(result.view?.caption,takenLabel(shared),'The other album gets a fresh try at the photo');
});

test('a display id gives each TV its own rotation; without it TVs share one',async t=>{
  for(const ids of [true,false]) {
    const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3),item(4)]),config:{album_url:LINK,order:'Newest first'},renderWaitMs:500,clock:()=>Date.parse(small.now)});
    const tv=(name,minutes,purpose)=>at(minutes,{display:{...small.display,...(ids?{id:name}:{})},...(purpose?{render_purpose:purpose}:{})});
    const caption=async snap=>{const result=await service.render(snap);await settle();return result.view.caption;};
    assert.equal(await caption(tv('kitchen',0)),'January 5, 2020');
    assert.equal(await caption(tv('kitchen',15,'prepare')),'January 4, 2020','A wake prepare is a normal render');
    assert.equal(await caption(tv('kitchen',16,'scheduled')),'January 4, 2020','The scheduled render in the same bucket does not move again');
    assert.equal(await caption(tv('kitchen',30,'rotation')),'January 3, 2020');
    // The hall TV renders for the first time.
    const hall=await caption(tv('hall',31,'scheduled'));
    if(ids) assert.equal(hall,'January 5, 2020','The hall TV starts its own rotation');
    else assert.equal(hall,'January 3, 2020','Without ids the hall TV shares the kitchen rotation');
    assert.equal(await caption(tv('hall',32,'preview')),hall,'A preview never moves');
    assert.equal(await caption(tv('kitchen',33)),'January 3, 2020','The kitchen TV keeps its photo');
  }
});

test('bad photos do not show the download message while other photos remain',async t=>{
  const items=Array.from({length:7},(_,n)=>item(n+1));
  const bad=new Set(items.slice(3).map(entry=>entry.id));// The four newest photos.
  let now=Date.parse(small.now);
  const {service}=await setup(t,{
    page:sampleAlbumPage(items),config:{album_url:LINK,order:'Newest first'},renderWaitMs:500,clock:()=>now,
    fetchImage:async entry=>{if(bad.has(entry.id)) throw Object.assign(new Error('gone'),{code:'not-found'});return tinyImage();},
  });
  const results=[];
  for(let n=0;n<4;n++) {results.push(await service.render(at(n*15)));now+=15*60000;await service.tick();}
  assert.ok(results.every(result=>result.status===202 || result.view.message===null),'No download message');
  assert.ok(results.some(result=>result.view?.caption==='January 4, 2020'),'A good photo shows');
});

test('the download message shows when every photo fails',async t=>{
  let now=Date.parse(small.now);
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2)]),fetchImage:async()=>{throw Object.assign(new Error('x'),{code:'not-image'});},clock:()=>now,renderWaitMs:500});
  const result=await service.render(small);
  assert.equal(result.view.message,MESSAGES.download);
});

test('a new photo list clears failures for photos with a new URL and for a new album',async t=>{
  let now=Date.parse(small.now),fixed=false;
  const config={album_url:LINK,order:'Newest first',sync_interval:'Every hour'};
  const page=()=>sampleAlbumPage([item(1),fixed?item(2,{url:'https://lh3.googleusercontent.com/pw/AP1GczTestItemBaseUrlFixed02'}):item(2)]);
  const {service}=await setup(t,{page,config,renderWaitMs:500,clock:()=>now,
    fetchImage:async entry=>{if(entry.id===item(2).id && !/Fixed/.test(entry.url)) throw Object.assign(new Error('gone'),{code:'not-found'});return tinyImage();}});
  // Item 2 fails once an hour; after nine failures its next try is hours away.
  for(let n=0;n<9;n++) {await service.render(at(n*61));now+=61*60000;await service.tick();}
  fixed=true;now+=61*60000;await service.tick();// The re-sync brings a new URL for item 2.
  await settle();
  const minutes=(now-Date.parse(small.now))/60000;
  const shown=[];
  for(let n=0;n<2;n++) shown.push((await service.render(at(minutes+n*15))).view.caption);
  assert.ok(shown.includes('January 3, 2020'),`item 2 gets a fresh try: ${shown}`);
});

test('day buckets where clocks jump or repeat at midnight',()=>{
  const span=(iso,timezone)=>{const ms=Date.parse(iso);const bucket=timeBucket({now:iso,timezone},'day',ms);return [new Date(bucket.start).toISOString(),new Date(bucket.end).toISOString()];};
  // Santiago, 2026-09-06: midnight is skipped, so the day starts at 01:00 local.
  assert.deepEqual(span('2026-09-05T20:00:00Z','America/Santiago'),['2026-09-05T04:00:00.000Z','2026-09-06T04:00:00.000Z']);
  assert.deepEqual(span('2026-09-06T12:00:00Z','America/Santiago'),['2026-09-06T04:00:00.000Z','2026-09-07T03:00:00.000Z']);
  // Havana, 2026-11-01: midnight to 01:00 happens twice. Both are one day.
  assert.deepEqual(span('2026-11-01T04:30:00Z','America/Havana'),['2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z']);
  assert.deepEqual(span('2026-11-01T05:30:00Z','America/Havana'),span('2026-11-01T04:30:00Z','America/Havana'));
  assert.deepEqual(span('2026-10-31T12:00:00Z','America/Havana'),['2026-10-31T04:00:00.000Z','2026-11-01T04:00:00.000Z']);
});

test('Havana’s repeated midnight changes the photo once',async t=>{
  let now=Date.parse('2026-11-01T04:30:00Z');
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2),item(3)]),config:{album_url:LINK,order:'Newest first',photo_interval:'Once a day'},renderWaitMs:500,clock:()=>now});
  const render=async iso=>{now=Date.parse(iso);const result=await untilShown(service,{...small,timezone:'America/Havana',now:iso});await settle();return result.view.caption;};
  assert.equal(await render('2026-10-31T23:00:00Z'),'January 4, 2020');
  const first=await render('2026-11-01T04:30:00Z');
  assert.equal(first,'January 3, 2020');
  assert.equal(await render('2026-11-01T05:30:00Z'),first,'The second midnight is the same day');
});

for(const order of ['Shuffle','Newest first']) {
  test(`one photo that always fails does not stop the rotation (${order})`,async t=>{
    const items=Array.from({length:6},(_,n)=>item(n+1));
    const bad=items[order==='Shuffle'?2:0].id;
    let now=Date.parse(small.now);
    const {service}=await setup(t,{
      page:sampleAlbumPage(items),config:{album_url:LINK,order,photo_interval:'15 minutes'},renderWaitMs:500,clock:()=>now,
      fetchImage:async entry=>{if(entry.id===bad) throw Object.assign(new Error('gone'),{code:'not-found'});return tinyImage();},
    });
    const seen=[];
    for(let n=0;n<10;n++) {
      const result=await service.render(at(n*15));
      if(result.status===200) seen.push(src(result));
      now+=15*60000;
      await service.tick();
    }
    const distinct=new Set(seen);
    assert.equal(distinct.size,5,`All five good photos show: ${seen.length} renders`);
    assert.equal(seen.length,10);
    assert.equal(new Set(seen.slice(0,5)).size,5,'The first cycle shows each good photo once');
    assert.equal(new Set(seen.slice(5,10)).size,5,'The next cycle starts without waiting on the bad photo');
  });
}

test('a link change during a sync starts a new sync for the new link',async t=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const config={album_url:LINK};
  const {service,pages}=await setup(t,{config,renderWaitMs:30,page:()=>pages.length===1?gate.then(()=>sampleAlbumPage([item(1)])):sampleAlbumPage([item(7)])});
  assert.equal((await service.render(small)).status,202,'The first album is still loading');
  config.album_url='https://photos.app.goo.gl/OtherSynthetic';
  const second=service.render(small);
  release();
  const result=await second;
  const shown=result.status===200?result:await untilShown(service,small);
  assert.equal(pages.length,2,'The new link was fetched');
  assert.equal(pages[1],'https://photos.app.goo.gl/OtherSynthetic');
  assert.equal(shown.status,200);
  assert.equal(shown.view.caption,takenLabel(item(7)),'The photo is from the new album');
});

test('a large album logs one warning with the photo count',async t=>{
  const warnings=[];
  t.mock.method(console,'warn',text=>warnings.push(text));
  const page=sampleAlbumPage([item(1),item(2)]).replace(",'',",",'SyntheticToken',").replace(',"",[',',"SyntheticToken",[');
  const {service}=await setup(t,{page});
  await untilShown(service,small);
  assert.deepEqual(warnings.filter(text=>/more photos/.test(text)),['Album has more photos than its page lists; using the first 2']);
});

test('repeated download failures stop the 202 loop with a message',async t=>{
  let now=1_000_000;
  const {service}=await setup(t,{page:sampleAlbumPage([item(1)]),fetchImage:async()=>{throw Object.assign(new Error('x'),{code:'network'});},clock:()=>now});
  const results=[];
  for(let n=0;n<4;n++) {results.push(await service.render(small));now+=60*60000;}
  assert.deepEqual(results[0],{status:202});
  assert.equal(results.at(-1).view.message,MESSAGES.download);
});

test('a failed re-sync keeps showing saved photos, with a notice after a day',async t=>{
  let now=Date.UTC(2026,9,27,12),fail=false;
  const {service}=await setup(t,{page:()=>fail?'<html>changed</html>':sampleAlbumPage([item(1)]),clock:()=>now,renderWaitMs:500});
  assert.equal((await service.render(small)).status,200);
  fail=true;now+=4*3600000;
  await service.tick();
  const soon=await service.render(small);
  assert.ok(soon.view.photo);assert.equal(soon.view.notice,null);
  now+=25*3600000;
  await service.tick();
  const later=await service.render(small);
  assert.ok(later.view.photo);
  assert.equal(later.view.notice,MESSAGES.parse);
});

test('caption, clock and mat box',()=>{
  assert.equal(takenLabel({takenAt:Date.UTC(2023,6,1,2,0),offsetMs:-4*3600000}),'June 30, 2023','The photo’s own local date');
  assert.equal(takenLabel({takenAt:null}),null);
  assert.equal(clockLabel(snapshot),'7:30 AM');
  assert.equal(clockLabel({...snapshot,timezone:'Not/AZone'}),'11:30 AM');
  assert.deepEqual(targetBox(snapshot),{x:0,y:0,width:3840,height:2160,frame:{width:3840,height:2160}});
  assert.deepEqual(targetBox({...snapshot,art:{viewport:{x:200,y:100,width:3440,height:1960}}}),{x:200,y:100,width:3440,height:1960,frame:{width:3840,height:2160}});
  assert.equal(targetBox({...snapshot,art:{viewport:{x:3000,y:0,width:3000,height:100}}}).width,3840,'An out-of-frame viewport is ignored');
});

test('the background loop downloads for the whole 4K frame before any render',async t=>{
  const boxes=[];
  const {service}=await setup(t,{page:sampleAlbumPage([item(1),item(2)]),config:{album_url:LINK},
    wrapCache:cache=>({...cache,prepare:(entry,options)=>{boxes.push(`${options.box.width}x${options.box.height}`);return cache.prepare(entry,options);},directory:cache.directory})});
  await service.tick();
  assert.ok(boxes.includes('3840x2160'),`A 3840x2160 download: ${boxes}`);
});
