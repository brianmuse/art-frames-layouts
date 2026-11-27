import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCalendarCache} from '../src/server/calendar-cache.mjs';
import {ProviderError} from '../src/server/fetch.mjs';

test('downloads coalesce and fresh renders use cached data without fetching again',async()=>{
 let requests=0,resolve;let clock=100;
 const cache=createCalendarCache({now:()=>clock,fetcher:()=>{requests++;return new Promise(done=>{resolve=done;});}});
 const first=cache.get('PRIVATE-ONE',{refreshKey:'2026-10-26'});
 assert.equal(first.text,null);assert.ok(first.pending);
 assert.equal(cache.get('PRIVATE-ONE',{refreshKey:'2026-10-26'}),first);
 await Promise.resolve();assert.equal(requests,1);
 resolve('ICAL DATA');await first.pending;
 assert.equal(first.text,'ICAL DATA');assert.equal(first.updatedAt,100);
 clock=500;assert.equal(cache.get('PRIVATE-ONE',{refreshKey:'2026-10-26'}).pending,null);assert.equal(requests,1);
 cache.get('PRIVATE-ONE',{refreshKey:'2026-10-27'});await Promise.resolve();assert.equal(requests,2);
 resolve('NEXT DAY');await first.pending;
});

test('failed background refresh retains saved data and retries after cooldown',async()=>{
 let clock=0,calls=0;
 const cache=createCalendarCache({now:()=>clock,fetcher:async()=>{if(++calls===1)return 'SAVED';throw new ProviderError('timeout');}});
 const state=cache.get('PRIVATE-TWO',{refreshMs:100});await state.pending;
 clock=101;cache.get('PRIVATE-TWO',{refreshMs:100});await state.pending;
 assert.equal(state.text,'SAVED');assert.equal(state.error.code,'timeout');assert.equal(state.updatedAt,0);
 clock=102;cache.get('PRIVATE-TWO',{refreshMs:100});assert.equal(state.pending,null);assert.equal(calls,2);
 clock=60102;cache.get('PRIVATE-TWO',{refreshMs:100});await state.pending;assert.equal(calls,3);
});

test('slow downloads stay bounded to four active requests while obsolete queued entries are dropped',async()=>{
 let active=0,peak=0;const completions=[];
 const cache=createCalendarCache({fetcher:()=>{active++;peak=Math.max(peak,active);return new Promise(resolve=>completions.push(()=>{active--;resolve('BODY');}));}});
 const states=[];for(let i=0;i<20;i++)states.push(cache.get('PRIVATE-'+i));
 await Promise.resolve();assert.equal(active,4);assert.equal(peak,4);
 while(completions.length){completions.shift()();await new Promise(resolve=>setImmediate(resolve));}
 await Promise.all(states.map(state=>state.pending));assert.equal(active,0);assert.equal(peak,4);
});


test('changing cadence applies without restarting, including during an active download',async()=>{
 let clock=0,calls=0,resolve;
 const cache=createCalendarCache({now:()=>clock,fetcher:()=>{calls++;return new Promise(done=>{resolve=done;});}});
 const state=cache.get('PRIVATE-CADENCE',{refreshMs:86400000});await Promise.resolve();resolve('FIRST');await state.pending;
 clock=3600000;cache.get('PRIVATE-CADENCE',{refreshMs:900000});await Promise.resolve();assert.equal(calls,2);
 cache.get('PRIVATE-CADENCE',{refreshMs:3600000});resolve('UPDATED');await state.pending;
 assert.equal(state.nextAttemptAt,7200000);
 clock=7200001;cache.get('PRIVATE-CADENCE',{refreshMs:3600000});await Promise.resolve();assert.equal(calls,3);resolve('THIRD');await state.pending;
});


test('compact feed cache evicts old entries above its 32 MB total budget',async()=>{
 let calls=0;const cache=createCalendarCache({now:()=>0,fetcher:async()=>{calls++;return 'x'.repeat(8000000);}});
 for(let i=0;i<5;i++){const state=cache.get('BUDGET-'+i);await state.pending;}
 assert.equal(calls,5);
 const reloaded=cache.get('BUDGET-0');assert.ok(reloaded.pending);await reloaded.pending;assert.equal(calls,6);
});
