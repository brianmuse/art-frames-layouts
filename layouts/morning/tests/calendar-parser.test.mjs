import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCalendarParser,runCalendarWorker} from '../src/server/calendar-parser.mjs';
import {ProviderError} from '../src/server/fetch.mjs';

const args={days:['2026-10-26'],timezone:'America/New_York',name:'Work',color:'#af2842',now:'2026-10-26T12:00:00Z'};
const result={name:'Work',color:'#af2842',events:{'2026-10-26':[]}};

test('parsing coalesces in the background and cached results survive later display times',async()=>{
 let calls=0,finish;
 const parser=createCalendarParser({parse:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 const first=parser.get('COMPACT FEED',args);await Promise.resolve();
 assert.ok(first.pending);assert.equal(first.value,null);assert.equal(calls,1);
 assert.equal(parser.get('COMPACT FEED',{...args,now:'2026-10-26T13:00:00Z'}),first);
 finish(result);await first.pending;
 assert.equal(parser.get('COMPACT FEED',args).value,result);assert.equal(calls,1);
 for(const changed of [{days:['2026-10-27']},{timezone:'UTC'},{name:'Renamed'},{color:'#8850a8'}])assert.notEqual(parser.get('COMPACT FEED',{...args,...changed}),first);
 // Finish the remaining queued jobs without retaining workers or timers.
 for(let i=0;i<4;i++){await Promise.resolve();finish(result);await new Promise(resolve=>setImmediate(resolve));}
});

test('parsing uses one worker and drops obsolete queued jobs within entry and byte budgets',async()=>{
 let active=0,peak=0,calls=0;const finishes=[];
 const parser=createCalendarParser({parse:()=>{calls++;active++;peak=Math.max(peak,active);return new Promise(resolve=>finishes.push(()=>{active--;resolve(result);}));}});
 const states=[];
 for(let i=0;i<12;i++)states.push(parser.get('x'.repeat(7_999_990)+i,args));
 await Promise.resolve();assert.equal(active,1);
 while(finishes.length){finishes.shift()();await new Promise(resolve=>setImmediate(resolve));}
 await Promise.all(states.map(state=>state.pending));assert.equal(peak,1);assert.equal(active,0);assert.equal(calls,4);
 assert.throws(()=>parser.get('x'.repeat(8_000_001),args),error=>error.code==='projection-limit');
});

test('parse failures retain a fixed reason during cooldown and retry without unhandled rejection',async()=>{
 let clock=0,calls=0;
 const parser=createCalendarParser({now:()=>clock,parse:async()=>{calls++;throw new ProviderError('parse-timeout');}});
 const state=parser.get('FAILED FEED',args);await state.pending;
 assert.equal(state.error.code,'parse-timeout');clock=10;
 assert.equal(parser.get('FAILED FEED',args).pending,null);assert.equal(calls,1);
 clock=60001;parser.get('FAILED FEED',args);await state.pending;assert.equal(calls,2);
});

test('a bounded worker can finish beyond the old two-second limit and still has a hard timeout',async()=>{
 const directory=await fs.mkdtemp('/tmp/art-frames-parser-'),workerPath=path.join(directory,'slow.mjs');
 await fs.writeFile(workerPath,`process.once('message',()=>setTimeout(()=>process.send(${JSON.stringify(result)}),2200));`);
 try {
  assert.deepEqual(await runCalendarWorker({}, {workerPath}),result);
  await assert.rejects(runCalendarWorker({}, {workerPath,timeoutMs:30}),error=>error.code==='parse-timeout');
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('the production parent heap flag cannot override the parser process heap bound',async()=>{
 const directory=await fs.mkdtemp('/tmp/art-frames-parser-heap-'),workerPath=path.join(directory,'heap.mjs');
 await fs.writeFile(workerPath,`import v8 from 'node:v8';process.once('message',()=>process.send({heap:v8.getHeapStatistics().heap_size_limit}));`);
 try {
  const moduleUrl=new URL('../src/server/calendar-parser.mjs',import.meta.url).href;
  const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=192','--input-type=module','-e',`import {runCalendarWorker} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await runCalendarWorker({}, {workerPath:${JSON.stringify(workerPath)}})));`]);
  const value=JSON.parse(stdout);assert.ok(value.heap<=128*1024*1024,'The child heap must stay below the parent’s 192 MB bound');
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
