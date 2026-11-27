import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {sampleAlbumPage} from '../src/server/samples.mjs';
import {item,tinyImage} from './helpers.mjs';

const LINK='https://photos.app.goo.gl/SyntheticServerCode';
const SHARE='https://photos.google.com/share/AF1QipSyntheticServerAlbum?key=SyntheticServerKey';

function call(socket,{method='POST',route='/index.html',body}={}) {
  return new Promise((resolve,reject)=>{
    const text=body===undefined?undefined:JSON.stringify(body);
    const req=http.request({socketPath:socket,path:route,method,headers:text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));
      res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],body:Buffer.concat(parts)}));
    });
    req.on('error',reject);req.end(text);
  });
}

test('the socket server syncs a fake album, serves photo assets and keeps previews still',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'photos-server-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const socket=path.join(dir,'site.sock'),config=path.join(dir,'config.json'),state=path.join(dir,'state'),mock=path.join(dir,'mock.mjs');
  await fs.writeFile(config,JSON.stringify({album_url:LINK,order:'Newest first',fit:'cover'}));
  const page=sampleAlbumPage([item(1),item(2)]);
  const image=(await tinyImage(400,300)).toString('base64');
  // Fake Google: the short link redirects to the share page; the CDN returns a tiny JPEG.
  await fs.writeFile(mock,`import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';
dns.lookup=async()=>[{address:'142.250.0.1',family:4}];
const page=${JSON.stringify(page)},image=Buffer.from(${JSON.stringify(image)},'base64');
https.get=(url,options,receive)=>{const request=new EventEmitter();url=new URL(String(url));queueMicrotask(()=>{const response=new EventEmitter();response.complete=true;response.destroy=()=>{};
if(url.hostname==='photos.app.goo.gl'){response.statusCode=302;response.headers={location:${JSON.stringify(SHARE)}};receive(response);return;}
response.statusCode=200;response.headers={'content-type':url.hostname==='photos.google.com'?'text/html; charset=utf-8':'image/jpeg'};receive(response);response.emit('data',url.hostname==='photos.google.com'?Buffer.from(page):image);response.emit('end');});return request;};`);
  const child=spawn(process.execPath,['--import',mock,'server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:config,DAYFRAME_SITE_STATE:state},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped'));});});

  const snapshot={version:1,now:'2026-10-27T07:30:00-04:00',timezone:'America/New_York',display:{width:3840,height:2160},data:{},display_settings:{show_caption:true,show_clock:true}};
  let first=await call(socket,{body:snapshot});
  for(let n=0;first.status===202 && n<10;n++) {await new Promise(resolve=>setTimeout(resolve,300));first=await call(socket,{body:snapshot});}
  assert.equal(first.status,200);
  assert.match(first.type,/^text\/html/);
  const html=first.body.toString();
  const src=/<img id="photo" src="(\/photo\/[a-f0-9]{24}-cover-3840x2160\.jpg)"/.exec(html)?.[1];
  assert.ok(src,'The page uses one local photo asset');
  assert.match(html,/January 3, 2020/,'Newest first: item 2 is newer');
  assert.match(html,/7:30 AM/);
  assert.doesNotMatch(html,/SyntheticServer|googleusercontent|https?:\/\/(?!dayframe\.local)/,'No album link or remote URL in the page');

  const asset=await call(socket,{method:'GET',route:src});
  assert.equal(asset.status,200);assert.equal(asset.type,'image/jpeg');
  assert.ok(asset.body.length<25_000_000);
  assert.equal((await call(socket,{method:'GET',route:src.replace('.jpg','-backdrop.jpg')})).status,404,'Cover has no backdrop');
  assert.equal((await call(socket,{method:'GET',route:'/photo/0000.jpg'})).status,404);
  assert.notEqual((await call(socket,{method:'GET',route:'/photo/../../config.json'})).status,200);
  assert.equal((await call(socket,{method:'GET',route:'/fonts/Inter-Regular.ttf'})).status,200);

  const preview={...snapshot,render_purpose:'preview'};
  for(let n=0;n<2;n++) assert.match((await call(socket,{body:preview})).body.toString(),/January 3, 2020/,'A preview keeps the current photo');
  await new Promise(resolve=>setTimeout(resolve,300));
  const same=(await call(socket,{body:{...snapshot,now:'2026-10-27T07:44:00-04:00'}})).body.toString();
  assert.match(same,/January 3, 2020/,'A render in the same 15-minute bucket keeps the photo');
  const later={...snapshot,now:'2026-10-27T07:46:00-04:00'};
  const next=(await call(socket,{body:later})).body.toString();
  assert.match(next,/<img id="photo"/);
  assert.doesNotMatch(next,/January 3, 2020/,'The next bucket shows the next photo');
  assert.match(next,/January 2, 2020/);
  const plain=(await call(socket,{body:{...later,display_settings:{show_caption:false,show_clock:false}}})).body.toString();
  assert.doesNotMatch(plain,/id="label"/,'The caption turns off');
  const files=await fs.readdir(state);
  assert.deepEqual(files.filter(name=>!name.startsWith('.')).sort(),['album.json','photos','rotation.json']);
  assert.doesNotMatch(await fs.readFile(path.join(state,'album.json'),'utf8'),/SyntheticServerCode|SyntheticServerKey/,'The link is not saved in state');
});

test('a bad saved link renders a fixed message and never echoes the value',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'photos-server-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const socket=path.join(dir,'site.sock'),config=path.join(dir,'config.json');
  await fs.writeFile(config,JSON.stringify({album_url:'https://evil.example/<script>alert(1)</script>'}));
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:config,DAYFRAME_SITE_STATE:path.join(dir,'state')},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped'));});});
  const result=await call(socket,{body:{now:'2026-10-27T07:30:00Z',timezone:'UTC',data:{}}});
  assert.equal(result.status,200);
  const html=result.body.toString();
  assert.match(html,/isn’t a Google Photos shared album link/);
  assert.doesNotMatch(html,/evil|alert/);
  assert.equal((await call(socket,{method:'POST',body:[1,2]})).status,400);
});
