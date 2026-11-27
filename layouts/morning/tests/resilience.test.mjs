import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import dns from 'node:dns/promises';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCalendarCache} from '../src/server/calendar-cache.mjs';
import {createCalendarStorage} from '../src/server/calendar-storage.mjs';
import {createCalendarParser,parsed} from '../src/server/calendar-parser.mjs';
import {syncCalendars} from '../src/server/calendar-sync.mjs';
import {calendarTimezone,createHostTimezone} from '../src/server/settings.mjs';
import {createStateFile} from '../src/server/state-file.mjs';
import {calendar,dashboard} from '../src/server/dashboard.mjs';
import {weather,createWeatherMemory} from '../src/server/weather.mjs';
import {ProviderError} from '../src/server/fetch.mjs';
import {projectCalendar} from '../server/ical-projection.mjs';
import {parseCalendar} from '../server/calendar-worker.mjs';

const wrap=body=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+body+'\r\nEND:VCALENDAR\r\n';
const event=(id,extra='')=>`BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z\r\nSUMMARY:Meeting ${id}\r\n${extra}END:VEVENT`;
const args={feed:'f'.repeat(64),days:['2026-10-26'],timezone:'America/New_York',name:'Work',color:'#af2842',now:'2026-10-26T12:00:00Z'};
const value={name:'Work',color:'#af2842',events:{'2026-10-26':[]}};
const tempDir=prefix=>fs.mkdtemp(path.join(os.tmpdir(),prefix));

test('a download that fails to parse keeps serving the last good export, marked stale',async()=>{
 const directory=await tempDir('art-frames-promote-');let clock=0,body='GOOD';
 const storage=createCalendarStorage(directory),fetcher=async()=>body;
 const validate=async text=>{if(text==='BROKEN')throw new ProviderError('invalid-feed');};
 try {
  const cache=createCalendarCache({storage,fetcher,now:()=>clock});
  const state=cache.get('PRIVATE-PROMOTE',{refreshMs:100,validate});await state.pending;
  assert.equal(state.text,'GOOD');
  body='BROKEN';clock=101;cache.get('PRIVATE-PROMOTE',{refreshMs:100,validate});await state.pending;
  assert.equal(state.text,'GOOD');assert.equal(state.error.code,'invalid-feed');assert.equal(state.updatedAt,0);
  const restarted=createCalendarCache({storage,fetcher,now:()=>clock}).get('PRIVATE-PROMOTE',{refreshMs:100,validate});await restarted.pending;
  assert.equal(restarted.text,'GOOD','Disk must keep the last good export');assert.equal(restarted.error.code,'invalid-feed');
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('transient failures back off 1, 2, 4 minutes; limit and access errors wait for the next scheduled sync, across restarts',async()=>{
 const directory=await tempDir('art-frames-backoff-');let clock=0,calls=0,error='network';
 const storage=createCalendarStorage(directory),fetcher=async()=>{calls++;throw new ProviderError(error);};
 try {
  let cache=createCalendarCache({storage,fetcher,now:()=>clock});
  const at=(time,key='2026-10-26')=>{clock=time;const state=cache.get('PRIVATE-BACKOFF',{refreshKey:key});return state.pending;};
  await at(0);assert.equal(calls,1);
  await at(59999);assert.equal(calls,1);await at(60000);assert.equal(calls,2);
  await at(179999);assert.equal(calls,2);await at(180000);assert.equal(calls,3);
  await at(419999);assert.equal(calls,3);
  cache=createCalendarCache({storage,fetcher,now:()=>clock});
  await at(419999);assert.equal(calls,3,'A restart keeps the backoff');
  await at(420000);assert.equal(calls,4);
  let n=0;
  for(const code of ['too-large','event-limit','access-denied','not-found']) {
   error=code;const key='2026-10-'+String(10+ ++n),before=calls;
   await at(clock+3600000,key);assert.equal(calls,before+1);
   await at(clock+3*3600000,key);assert.equal(calls,before+1,code+' waits for the next sync');
  }
  const day='2026-11-01';await at(clock+60000,day);const before=calls;
  cache=createCalendarCache({storage,fetcher,now:()=>clock});
  await at(clock+7200000,day);assert.equal(calls,before,'A restart keeps a held failure');
  await at(clock+60000,'2026-11-02');assert.equal(calls,before+1);
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('deterministic parse limits are not retried for the same text; transient ones back off',async()=>{
 let clock=0,calls=0,code='event-limit';
 const parser=createCalendarParser({now:()=>clock,parse:async()=>{calls++;throw new ProviderError(code);}});
 const state=parser.get('LIMITED',args);await state.pending;
 clock=86400000;parser.get('LIMITED',args);assert.equal(state.pending,null);assert.equal(calls,1);
 code='parse-timeout';const other=parser.get('SLOW',args);await other.pending;
 clock+=60000;parser.get('SLOW',args);await other.pending;assert.equal(calls,3);
 clock+=60000;parser.get('SLOW',args);assert.equal(other.pending,null);
 clock+=60000;parser.get('SLOW',args);await other.pending;assert.equal(calls,4);
});

test('the host timezone is followed unless an explicit layout timezone is saved',async()=>{
 assert.equal(calendarTimezone({},'Europe/London'),'Europe/London');
 assert.equal(calendarTimezone({calendar_timezone:''},'Europe/London'),'Europe/London');
 assert.equal(calendarTimezone({calendar_timezone:'America/New_York'},'Europe/London'),'America/New_York');
 assert.equal(calendarTimezone({calendar_timezone:'Not/AZone'},'Asia/Tokyo'),'Asia/Tokyo');
 // 23:30 in New York is already the next day in London.
 const snapshot={now:'2026-10-27T03:30:00Z',timezone:'Europe/London',data:{}};
 const followed=await dashboard(snapshot,{calendars:[]});
 assert.equal(followed.timezone,'Europe/London');assert.equal(followed.planner.plan.date,'2026-10-27');
 const explicit=await dashboard(snapshot,{calendars:[],calendar_timezone:'America/New_York'});
 assert.equal(explicit.timezone,'America/New_York');assert.equal(explicit.planner.plan.date,'2026-10-26');
});

test('background sync remembers the host timezone across restarts and uses it for display days',async()=>{
 const directory=await tempDir('art-frames-host-');
 try {
  await createHostTimezone(createStateFile(directory,'host.json')).set('Asia/Tokyo');
  const host=await createHostTimezone(createStateFile(directory,'host.json')).get();
  assert.equal(host,'Asia/Tokyo');assert.equal((await fs.stat(path.join(directory,'host.json'))).mode&0o777,0o600);
  const seen=[];
  const cache={prune:async()=>{},get:(_url,options)=>{seen.push(options.refreshKey);return {text:null,pending:null};}};
  await syncCalendars({calendars:[{url:'SYNTHETIC',title:'Work',color:'#af2842'}]},{cache,parser:{},now:new Date('2026-10-26T20:00:00Z'),host});
  assert.deepEqual(seen,['2026-10-27'],'05:00 in Tokyo is past the 03:00 sync on the 27th');
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('a DTSTAMP or LAST-MODIFIED change does not change the compact feed or trigger a reparse',async()=>{
 const first=wrap(event('one','DTSTAMP:20261026T010000Z\r\nLAST-MODIFIED:20261025T010000Z\r\nSEQUENCE:2\r\n'));
 const second=wrap(event('one','DTSTAMP:20261027T090000Z\r\nLAST-MODIFIED:20261027T080000Z\r\nSEQUENCE:2\r\n'));
 const a=projectCalendar(first,[]),b=projectCalendar(second,[]);
 assert.equal(a,b);assert.match(a,/SEQUENCE:2/);assert.doesNotMatch(a,/DTSTAMP|LAST-MODIFIED/);
 let clock=0,parses=0,body=a;
 const parser=createCalendarParser({parse:async()=>{parses++;return value;}});
 const cache=createCalendarCache({now:()=>clock,fetcher:async()=>body});
 const validate=text=>parsed(parser,text,args);
 const state=cache.get('PRIVATE-STAMP',{refreshMs:100,validate});await state.pending;
 body=b;clock=200;cache.get('PRIVATE-STAMP',{refreshMs:100,validate});await state.pending;
 assert.equal(parser.get(state.text,args).value,value);assert.equal(parses,1);
});

test('a transient parse failure does not download the same feed again before the parser retries it',async()=>{
 let clock=0,downloads=0;
 const parser=createCalendarParser({now:()=>clock,parse:async()=>{throw new ProviderError('parse-timeout');}});
 await parser.get('SLOW',args).pending;clock=60000;await parser.get('SLOW',args).pending;
 const cache=createCalendarCache({now:()=>clock,fetcher:async()=>{downloads++;return 'SLOW';}});
 const validate=text=>parsed(parser,text,args);
 const state=cache.get('PRIVATE-SLOW',{validate});await state.pending;
 assert.equal(state.error.code,'parse-timeout');assert.equal(downloads,1);
 clock=120000;cache.get('PRIVATE-SLOW',{validate});assert.equal(state.pending,null,'The parser retries this text at 180000');
 clock=180000;cache.get('PRIVATE-SLOW',{validate});await state.pending;assert.equal(downloads,2);
});

test('a render serves the last parse for the feed while a changed setting parses again',async()=>{
 const finishes=[];let parses=0;
 const parser=createCalendarParser({parse:()=>{parses++;return new Promise(resolve=>finishes.push(resolve));}});
 const feed={text:'COMPACT',pending:null,error:null,updatedAt:5};
 const cache={get:()=>feed};
 const call=name=>calendar('https://calendar.google.com/SYNTHETIC',['2026-10-26'],'America/New_York',name,'#af2842','2026-10-26T12:00:00Z',{cache,parser});
 const first=call('Work');await Promise.resolve();await Promise.resolve();finishes.shift()({...value,events:{'2026-10-26':[{all_day:false,starts_at:'2026-10-26T13:00:00Z',ends_at:'2026-10-26T14:00:00Z',title:'Kept',sort:'09:00'}]}});
 assert.equal((await first).sync_status,'connected');
 const started=Date.now(),served=await call('Renamed');
 assert.ok(Date.now()-started<500,'No wait while a previous parse exists');
 assert.equal(served.sync_status,'refreshing');assert.equal(served.events['2026-10-26'][0].title,'Kept');assert.equal(parses,2);
 finishes.shift()(value);
 await assert.rejects(calendar('https://calendar.google.com/OTHER',['2026-10-26'],'America/New_York','Third','#af2842','2026-10-26T12:00:00Z',{cache,parser,deadline:Date.now()+20}),error=>error.code==='syncing','Another feed has no previous parse to serve');
 finishes.shift()?.(value);
});

test('one unsupported recurrence is skipped and counted without hiding the rest of the feed',async()=>{
 const text=wrap(event('fine')+'\r\n'+event('minutely','RRULE:FREQ=MINUTELY\r\n'));
 const result=await parseCalendar({text,days:['2026-10-26'],timezone:'America/New_York',name:'Work',color:'#af2842',now:'2026-10-26T12:00:00Z'});
 assert.deepEqual(result.events['2026-10-26'].map(item=>item.title),['Meeting fine']);assert.equal(result.skipped,1);
});

test('the parser worker path does not depend on the working directory',async()=>{
 const moduleUrl=new URL('../src/server/calendar-parser.mjs',import.meta.url).href,text=JSON.stringify(wrap(event('cwd')));
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',`import {runCalendarWorker} from ${JSON.stringify(moduleUrl)};const r=await runCalendarWorker({text:${text},days:['2026-10-26'],timezone:'UTC',name:'',color:'#af2842',now:'2026-10-26T12:00:00Z'});console.log(r.events['2026-10-26'][0].title);`],{cwd:os.tmpdir()});
 assert.equal(stdout.trim(),'Meeting cwd');
});

test('weather shows the last good forecast, marked stale, during an outage and caches the failure',async(t)=>{
 let clock=Date.parse('2026-10-26T12:00:00Z'),requests=0,failing=false;
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 t.mock.method(https,'get',(url,options,receive)=>{
  requests++;const request=new EventEmitter();
  queueMicrotask(()=>{
   if(failing) {request.emit('error',Object.assign(new Error('PRIVATE'),{code:'ECONNRESET'}));return;}
   const response=new EventEmitter();response.statusCode=200;response.complete=true;receive(response);
   const body=url.hostname.startsWith('geocoding') ? {results:[{latitude:1,longitude:2,admin1:'Massachusetts'}]} : {current:{temperature_2m:51},daily:{temperature_2m_max:[60]}};
   response.emit('data',Buffer.from(JSON.stringify(body)));response.emit('end');
  });
  return request;
 });
 const directory=await tempDir('art-frames-weather-');
 try {
  const memory=createWeatherMemory(createStateFile(directory,'weather.json'));
  const settings={city:'Synthetic Stale Town, MA'};
  const fresh=await weather(settings,'2026-10-26','08:00','America/New_York',{memory});
  assert.equal(fresh.current,51);assert.equal(fresh.stale,undefined);
  failing=true;clock+=2*3600000;
  const stale=await weather(settings,'2026-10-26','10:00','America/New_York',{memory:createWeatherMemory(createStateFile(directory,'weather.json'))});
  assert.equal(stale.current,51);assert.equal(stale.stale,true);assert.equal(stale.updated_at,'2026-10-26T12:00:00.000Z');
  const before=requests;clock+=60000;
  assert.equal((await weather(settings,'2026-10-26','10:01','America/New_York',{memory})).stale,true);
  assert.equal(requests,before,'A recent failure is not retried on every render');
  clock+=5*3600000;
  await assert.rejects(weather(settings,'2026-10-26','15:00','America/New_York',{memory}),error=>error instanceof ProviderError && !error.message.includes('PRIVATE'));
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
