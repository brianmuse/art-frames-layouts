import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {sampleCacheState} from '../src/server/sample.mjs';

// Run the production server on a socket, as Art Frames does. `network` is a
// module that replaces DNS/HTTPS so no test reaches the internet.
async function start(t,{config,state,network}) {
  const directory=await fs.mkdtemp('/tmp/weather-site-');
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const socket=path.join(directory,'site.sock'),stateDir=path.join(directory,'state'),mock=path.join(directory,'mock.mjs');
  await fs.mkdir(stateDir,{mode:0o700});
  if (config) await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(config));
  if (state) await fs.writeFile(path.join(stateDir,'weather-cache.json'),JSON.stringify(state),{mode:0o600});
  await fs.writeFile(mock,network);
  const child=spawn(process.execPath,['--import',mock,'server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:path.join(directory,'config.json'),DAYFRAME_SITE_STATE:stateDir},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Website socket did not become ready')),10000);
    child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Website failed to start'));});
  });
  const send=(method,route,snapshot)=>new Promise((resolve,reject)=>{
    const body=snapshot ? JSON.stringify(snapshot) : '';
    const req=http.request({socketPath:socket,path:route,method,headers:snapshot ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} : {}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],html:Buffer.concat(parts).toString()}));
    });
    req.on('error',reject);req.end(body);
  });
  return {render:snapshot=>send('POST','/index.html',snapshot),get:route=>send('GET',route)};
}
const hang=`import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';dns.lookup=async()=>[{address:'8.8.8.8',family:4}];https.get=(url,options)=>{const request=new EventEmitter();options.signal.addEventListener('abort',()=>request.emit('error',new Error('synthetic abort')));return request;};`;
const offline=`import dns from 'node:dns/promises';dns.lookup=async()=>{throw Object.assign(new Error('offline'),{code:'ENOTFOUND'});};`;
const snapshot=()=>({version:1,now:new Date().toISOString(),timezone:'America/New_York',display:{width:3840,height:2160},data:{},display_settings:{show_art:true},art:{image:'/dayframe-art.jpg',title:'A public test artwork'}});

test('the first render returns 202 while the forecast loads for the first time',async(t)=>{
  const site=await start(t,{network:hang,config:{city:'Boston, MA'}});
  const started=Date.now();
  const result=await site.render(snapshot());
  assert.equal(result.status,202);
  assert.equal(result.html,'');
  assert.ok(Date.now()-started<8000,'The render does not wait for the 10-second download');
});

test('with no config.json the page asks for a city and fetches nothing',async(t)=>{
  const site=await start(t,{network:`import https from 'node:https';https.get=()=>{throw new Error('No request without a city');};`});
  const result=await site.render(snapshot());
  assert.equal(result.status,200);
  assert.match(result.html,/No city set/);
  assert.match(result.html,/Set your city in this layout’s settings to see the weather\./);
});

test('a provider outage on the first load renders the failure, not sample data',async(t)=>{
  const site=await start(t,{network:offline,config:{city:'Boston, MA'}});
  let result=await site.render(snapshot());
  for (let tries=0;result.status===202 && tries<5;tries++) result=await site.render(snapshot());
  assert.equal(result.status,200);
  assert.match(result.type,/text\/html/);
  assert.match(result.html,/Weather is unavailable/);
  assert.match(result.html,/Open-Meteo could not be reached\./);
  assert.doesNotMatch(result.html,/This week|Mostly clear/,'No fixture forecast in production');
});

test('a saved forecast renders the day and the week, escaped, with and without art',async(t)=>{
  const now=new Date();
  const config={city:'<b>Boston</b>, MA'};
  const state=sampleCacheState(now,'America/New_York',{config});
  const site=await start(t,{network:offline,config,state});
  const shown=await site.render(snapshot());
  assert.equal(shown.status,200);
  assert.match(shown.html,/&lt;b&gt;Boston&lt;\/b&gt;, MA/);
  assert.doesNotMatch(shown.html,/<b>Boston/);
  assert.match(shown.html,/This week/);
  assert.equal((shown.html.match(/class="week-name"/g) || []).length,7);
  assert.match(shown.html,/Today/);
  assert.match(shown.html,/Sunrise/);
  assert.match(shown.html,/<img id="art"[^>]*src="\/dayframe-art.jpg"/);
  assert.doesNotMatch(shown.html,/data:image|https?:\/\/(?!dayframe\.local)(?!www\.w3\.org)/,'Only local assets');
  const plain=await site.render({...snapshot(),display_settings:{show_art:false}});
  assert.doesNotMatch(plain.html,/<img id="art"/);
  assert.match(plain.html,/id="screen" class="plain/);
  const matted=await site.render({...snapshot(),art:{image:'/dayframe-art.jpg',viewport:{x:384,y:216,width:3072,height:1728}}});
  assert.match(matted.html,/--content-x:10%/);
  assert.equal((await site.get('/fonts/Inter-SemiBold.ttf')).status,200);
  assert.equal((await site.get('/../package.json')).status,400);
});
