import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

test('a slow calendar stays in the background and the real screen response shows loading',async()=>{
 const dir=await fs.mkdtemp('/tmp/art-frames-background-'),socket=path.join(dir,'site.sock'),config=path.join(dir,'config.json'),mock=path.join(dir,'mock.mjs');
 await fs.writeFile(config,JSON.stringify({calendars:[{id:'work',title:'Work',url:'https://calendar.google.com/SYNTHETIC-PRIVATE-SLOW',color:'#af2842'}]}));
 await fs.writeFile(mock,`import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';dns.lookup=async()=>[{address:'8.8.8.8',family:4}];https.get=(url,options)=>{const request=new EventEmitter();options.signal.addEventListener('abort',()=>request.emit('error',new Error('synthetic abort')));return request;};`);
 const child=spawn(process.execPath,['--import',mock,'server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:config},stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped'));});});
  const started=Date.now(),body=JSON.stringify({now:'2026-10-26T12:00:00Z',timezone:'America/New_York',data:{}});
  const result=await new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:'/index.html',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{const parts=[];response.on('data',p=>parts.push(p));response.on('end',()=>resolve({status:response.statusCode,html:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end(body);});
  assert.equal(result.status,202);
  assert.ok(Date.now()-started<8000,'Screen must not wait for the 90-second download');
  assert.equal(result.html,'');

  assert.doesNotMatch(result.html,/SYNTHETIC-PRIVATE-SLOW|No events scheduled|couldn’t sync/);
 } finally {
  if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
  await fs.rm(dir,{recursive:true,force:true});
 }
});

test('slow processing keeps the screen responsive and a later render uses the completed calendar',async()=>{
 const dir=await fs.mkdtemp('/tmp/art-frames-processing-'),socket=path.join(dir,'site.sock'),config=path.join(dir,'config.json'),mock=path.join(dir,'mock.mjs'),worker=path.join(dir,'slow-worker.mjs');
 // The background sync validates with the real date, so render that same day.
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()),compact=day.replaceAll('-','');
 const text=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:slow-processing\r\nDTSTART:${compact}T130000Z\r\nDTEND:${compact}T140000Z\r\nSUMMARY:Completed work event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
 await fs.writeFile(config,JSON.stringify({calendars:[{id:'work',title:'Work',url:'https://calendar.google.com/SYNTHETIC-PRIVATE-PROCESSING',color:'#af2842'}]}));
 await fs.writeFile(worker,`await new Promise(resolve=>setTimeout(resolve,4000));await import(${JSON.stringify(new URL('../server/calendar-worker.mjs',import.meta.url).href)});`);
 await fs.writeFile(mock,`import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';import {createRequire,syncBuiltinESMExports} from 'node:module';const require=createRequire(import.meta.url),children=require('node:child_process'),original=children.fork;children.fork=(_file,args,options)=>original(${JSON.stringify(worker)},args,options);syncBuiltinESMExports();dns.lookup=async()=>[{address:'8.8.8.8',family:4}];https.get=(url,options,receive)=>{const request=new EventEmitter();queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;response.complete=true;receive(response);response.emit('data',Buffer.from(${JSON.stringify(text)}));response.emit('end');});return request;};`);
 const child=spawn(process.execPath,['--import',mock,'server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:config},stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped'));});});
  const request=()=>new Promise((resolve,reject)=>{const body=JSON.stringify({now:day+'T12:00:00Z',timezone:'America/New_York',data:{}});const req=http.request({socketPath:socket,path:'/index.html',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{const parts=[];response.on('data',p=>parts.push(p));response.on('end',()=>resolve({status:response.statusCode,html:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end(body);});
  const first=await request();assert.equal(first.status,202);assert.equal(first.html,'');assert.doesNotMatch(first.html,/couldn’t sync|SYNTHETIC-PRIVATE-PROCESSING/);
  await new Promise(resolve=>setTimeout(resolve,3000));
  const second=await request();assert.equal(second.status,200);assert.match(second.html,/Completed work event/);assert.doesNotMatch(second.html,/couldn’t sync|Loading calendar events|SYNTHETIC-PRIVATE-PROCESSING/);
 } finally {
  if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
  await fs.rm(dir,{recursive:true,force:true});
 }
});
