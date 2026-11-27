import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCalendarCache} from '../src/server/calendar-cache.mjs';
import {createCalendarStorage} from '../src/server/calendar-storage.mjs';
import {syncCalendars,startCalendarSync} from '../src/server/calendar-sync.mjs';
import {syncDay} from '../src/server/dates.mjs';
import {calendarTimezone} from '../src/server/settings.mjs';
const key=url=>createHash('sha256').update(url).digest('hex');
const config={calendar_timezone:'America/New_York',calendars:[{url:'SYNTHETIC-PRIVATE',title:'Work',color:'#af2842'}]};

test('a mistyped timezone keeps both background sync and artwork renderable',()=>{
 assert.equal(calendarTimezone({calendar_timezone:'America/New York'}),'America/New_York');
 assert.equal(calendarTimezone({calendar_timezone:'Europe/London'}),'Europe/London');
});

test('daily sync changes at 3am across DST rather than midnight or a rolling 24 hours',()=>{
 for(const [date,before,after] of [['2026-10-26','06:59','07:00'],['2026-11-01','07:59','08:00'],['2027-03-14','06:59','07:00']]) {
  assert.notEqual(syncDay(new Date(`${date}T${before}:00Z`),'America/New_York'),date);
  assert.equal(syncDay(new Date(`${date}T${after}:00Z`),'America/New_York'),date);
 }
});

test('scheduled sync warms parsing once daily even with no renders and survives restart',async()=>{
 const directory=await fs.mkdtemp('/tmp/art-frames-daily-');let clock=Date.parse('2026-10-26T06:00:00Z'),downloads=0,parses=0;
 const storage=createCalendarStorage(directory),fetcher=async()=>{downloads++;return 'COMPACT CALENDAR';};
 const parser={get:()=>{parses++;return {value:{events:{}},pending:Promise.resolve()};}};
 let cache=createCalendarCache({storage,fetcher,now:()=>clock});
 try {
  await syncCalendars(config,{cache,parser,now:new Date(clock)});assert.equal(downloads,1);
  clock=Date.parse('2026-10-26T07:00:00Z');await syncCalendars(config,{cache,parser,now:new Date(clock)});assert.equal(downloads,2);
  for(let i=1;i<=4;i++) {clock+=15*60000;await syncCalendars(config,{cache,parser,now:new Date(clock)});}
  assert.equal(downloads,2);assert.ok(parses>=2);
  cache=createCalendarCache({storage,fetcher,now:()=>clock});
  await syncCalendars(config,{cache,parser,now:new Date(clock)});assert.equal(downloads,2,'Restart must load the saved daily export');
  clock=Date.parse('2026-10-27T06:59:00Z');await syncCalendars(config,{cache,parser,now:new Date(clock)});assert.equal(downloads,2);
  clock=Date.parse('2026-10-27T07:00:00Z');await syncCalendars(config,{cache,parser,now:new Date(clock)});assert.equal(downloads,3);
  const file=path.join(directory,key('SYNTHETIC-PRIVATE')+'.json');
  assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.equal((await fs.stat(directory)).mode&0o777,0o700);
  assert.doesNotMatch(await fs.readFile(file,'utf8'),/SYNTHETIC-PRIVATE/);
  await cache.prune([]);assert.deepEqual(await fs.readdir(directory),[]);
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('persistent cache bounds retained files and rejects malformed or symlinked entries',async()=>{
 const directory=await fs.mkdtemp('/tmp/art-frames-storage-');const storage=createCalendarStorage(directory);
 try {
  for(let i=0;i<10;i++)await storage.save(key('feed-'+i),{text:'EVENTS',updatedAt:i,refreshKey:'2026-10-26'});
  assert.equal((await fs.readdir(directory)).length,8);
  assert.equal(await storage.load(key('feed-0')),null);
  const filename=path.join(directory,key('bad')+'.json');await fs.writeFile(filename,'{broken');assert.equal(await storage.load(key('bad')),null);
  const link=path.join(directory,key('linked')+'.json');await fs.symlink(filename,link);assert.equal(await storage.load(key('linked')),null);
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('the server sync timer runs independently of screen requests',async()=>{
 let calls=0;
 const stop=startCalendarSync({loadSettings:async()=>{calls++;return {};},intervalMs:5});
 try {await new Promise(resolve=>setTimeout(resolve,30));assert.ok(calls>=2);}
 finally {stop();}
 const before=calls;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls,before);
});
