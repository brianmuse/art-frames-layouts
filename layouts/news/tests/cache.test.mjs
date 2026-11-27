import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNewsCache,newsRequest,createLimiter} from '../src/server/cache.mjs';
import {createStateFile} from '../src/server/state-file.mjs';
import {ProviderError} from '../src/server/fetch.mjs';
import {newsSettings} from '../src/server/settings.mjs';

const request={feeds:[{url:'https://news.google.com/rss?a',label:'Top stories'},{url:'https://news.google.com/rss?b',label:'Science'}],weather:null};
const items=title=>[{title,source:'Daily Example',published_at:'2026-11-01T12:00:00.000Z'}];
const tempDir=async t=>{const directory=await fs.mkdtemp(path.join(os.tmpdir(),'news-cache-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('the first render waits briefly, then asks for 202 while a first load runs',async()=>{
  const slow=deferred();
  const cache=createNewsCache({loadFeed:()=>slow.promise,loadWeather:()=>assert.fail('No weather')});
  const started=Date.now();
  const first=await cache.read(request,{waitMs:50});
  assert.ok(Date.now()-started<1000);
  assert.equal(first.preparing,true);
  slow.resolve(items('Arrived'));
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await cache.read(request,{waitMs:50});
  assert.equal(second.preparing,false);
  assert.equal(second.feeds[0].value[0].title,'Arrived');
});

test('a fast first load renders in the same request',async()=>{
  const cache=createNewsCache({loadFeed:async url=>items(url.endsWith('a') ? 'A' : 'B')});
  const result=await cache.read(request,{waitMs:1000});
  assert.equal(result.preparing,false);
  assert.deepEqual(result.feeds.map(feed=>feed.value[0].title),['A','B']);
  assert.deepEqual(result.feeds.map(feed=>feed.label),['Top stories','Science']);
});

test('a failed first load renders an error instead of waiting forever',async()=>{
  const cache=createNewsCache({loadFeed:async()=>{throw new ProviderError('timeout');}});
  const result=await cache.read(request,{waitMs:1000});
  assert.equal(result.preparing,false);
  assert.equal(result.feeds[0].value,null);
  assert.equal(result.feeds[0].error,'timeout');
});

test('refreshes about every 20 minutes, keeps the last good copy and backs off after a failure',async(t)=>{
  const file=createStateFile(await tempDir(t),'news-cache.json');
  let clock=1_000_000,calls=0,fail=false;
  const loadFeed=async()=>{calls++;if(fail) throw new ProviderError('network');return items('Version '+calls);};
  const cache=createNewsCache({file,loadFeed,clock:()=>clock});
  await cache.refresh(request);
  assert.equal(calls,2);
  clock+=10*60000;await cache.refresh(request);
  assert.equal(calls,2,'Fresh data is not fetched again');
  clock+=11*60000;fail=true;await cache.refresh(request);
  assert.equal(calls,4);
  const stale=await cache.read(request,{waitMs:0});
  assert.equal(stale.feeds[0].value[0].title,'Version 1','The last good copy stays');
  assert.equal(stale.feeds[0].error,'network');
  assert.equal(stale.feeds[0].at,1_000_000);
  clock+=30000;await cache.refresh(request);
  assert.equal(calls,4,'Backoff: the first retry waits a minute');
  clock+=31000;fail=false;await cache.refresh(request);
  assert.equal(calls,6);
  const recovered=await cache.read(request,{waitMs:0});
  assert.equal(recovered.feeds[0].error,null);
  assert.match(recovered.feeds[0].value[0].title,/Version [56]/);
});

test('the cache survives a restart and ignores invalid saved records',async(t)=>{
  const directory=await tempDir(t);
  const file=createStateFile(directory,'news-cache.json');
  const first=createNewsCache({file,loadFeed:async()=>items('Saved'),clock:()=>5_000_000});
  await first.refresh(request);
  const stat=await fs.stat(path.join(directory,'news-cache.json'));
  assert.equal(stat.mode & 0o777,0o600);
  const restarted=createNewsCache({file:createStateFile(directory,'news-cache.json'),loadFeed:()=>assert.fail('Fresh saved data is reused'),clock:()=>5_000_000+60000});
  const result=await restarted.read(request,{waitMs:0});
  assert.equal(result.feeds[0].value[0].title,'Saved');
  await fs.writeFile(path.join(directory,'news-cache.json'),JSON.stringify({feeds:{[request.feeds[0].url]:{at:'yesterday',value:'<b>'}},weather:{x:{at:1,value:[]}}}));
  const broken=createNewsCache({file:createStateFile(directory,'news-cache.json'),loadFeed:()=>new Promise(()=>{})});
  const fallback=await broken.read(request,{waitMs:0});
  assert.equal(fallback.preparing,true,'Invalid records count as no data');
  const saved=await broken.snapshot();
  assert.deepEqual(saved.weather,{});
});

test('prune drops feeds that are no longer configured',async()=>{
  const cache=createNewsCache({loadFeed:async()=>items('x')});
  await cache.refresh(request);
  await cache.refresh({feeds:[request.feeds[1]],weather:null},{prune:true});
  assert.deepEqual(Object.keys((await cache.snapshot()).feeds),[request.feeds[1].url]);
});

test('weather uses the host timezone and is skipped without a city',()=>{
  assert.equal(newsRequest(newsSettings({}),'America/New_York').weather,null);
  const weather=newsRequest(newsSettings({city:'Boston, MA'}),'America/New_York').weather;
  assert.deepEqual(weather,{key:JSON.stringify(['Boston, MA','fahrenheit','America/New_York']),city:'Boston, MA',units:'fahrenheit',timezone:'America/New_York'});
  assert.equal(newsRequest(newsSettings({city:'Boston, MA'}),null).weather,null,'Background refresh waits for a timezone');
});

test('the limiter never runs more than its limit, even when a task arrives as a slot frees',async()=>{
  const limit=createLimiter(1);
  let active=0,max=0;
  const run=gate=>limit(async()=>{active++;max=Math.max(max,active);try {await gate;} finally {active--;}});
  const first=deferred();
  void run(first.promise);void run(new Promise(()=>{}));
  first.resolve();
  // New tasks arrive on every microtask while the first slot is handed over.
  for (let hop=0;hop<20;hop++) {void run(new Promise(()=>{}));await Promise.resolve();}
  assert.equal(max,1);
});
