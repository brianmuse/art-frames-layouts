import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWeatherCache,weatherRequest} from '../src/server/cache.mjs';
import {createStateFile} from '../src/server/state-file.mjs';
import {ProviderError} from '../src/server/fetch.mjs';
import {weatherSettings} from '../src/server/settings.mjs';

const request=weatherRequest(weatherSettings({city:'Boston, MA'}),'America/New_York');
const forecast=label=>({label,daily:{time:['2026-11-02']}});
const tempDir=async t=>{const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weather-cache-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

test('the request needs a city and the host timezone',()=>{
  assert.deepEqual(request,{key:JSON.stringify(['Boston, MA','fahrenheit','America/New_York']),city:'Boston, MA',units:'fahrenheit',timezone:'America/New_York'});
  assert.equal(weatherRequest(weatherSettings({}),'America/New_York'),null);
  assert.equal(weatherRequest(weatherSettings({city:'Boston, MA'}),null),null,'Background refresh waits for a timezone');
});

test('the first render waits briefly, then asks for 202 while the first load runs',async()=>{
  const slow=deferred();
  const cache=createWeatherCache({loadWeather:()=>slow.promise});
  const started=Date.now();
  const first=await cache.read(request,{waitMs:50});
  assert.ok(Date.now()-started<1000);
  assert.equal(first.preparing,true);
  slow.resolve(forecast('Arrived'));
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await cache.read(request,{waitMs:50});
  assert.equal(second.preparing,false);
  assert.equal(second.weather.value.label,'Arrived');
});

test('a failed first load renders an error instead of waiting forever; no city never loads',async()=>{
  const cache=createWeatherCache({loadWeather:async()=>{throw new ProviderError('timeout');}});
  const result=await cache.read(request,{waitMs:1000});
  assert.equal(result.preparing,false);
  assert.equal(result.weather.value,null);assert.equal(result.weather.error,'timeout');
  const idle=createWeatherCache({loadWeather:()=>assert.fail('No city, no request')});
  assert.deepEqual(await idle.read(null),{weather:null,preparing:false});
});

test('refreshes about every 20 minutes, keeps the last good copy and backs off after a failure',async(t)=>{
  const file=createStateFile(await tempDir(t),'weather-cache.json');
  let clock=1_000_000,calls=0,fail=false;
  const loadWeather=async()=>{calls++;if(fail) throw new ProviderError('network');return forecast('Version '+calls);};
  const cache=createWeatherCache({file,loadWeather,clock:()=>clock});
  await cache.refresh(request);
  assert.equal(calls,1);
  clock+=10*60000;await cache.refresh(request);
  assert.equal(calls,1,'Fresh data is not fetched again');
  clock+=11*60000;fail=true;await cache.refresh(request);
  assert.equal(calls,2);
  const stale=await cache.read(request,{waitMs:0});
  assert.equal(stale.weather.value.label,'Version 1','The last good copy stays');
  assert.equal(stale.weather.error,'network');assert.equal(stale.weather.at,1_000_000);
  clock+=30000;await cache.refresh(request);
  assert.equal(calls,2,'Backoff: the first retry waits a minute');
  clock+=31000;fail=false;await cache.refresh(request);
  assert.equal(calls,3);
  const recovered=await cache.read(request,{waitMs:0});
  assert.equal(recovered.weather.error,null);assert.equal(recovered.weather.value.label,'Version 3');
});

test('the cache survives a restart, is private and ignores invalid saved records',async(t)=>{
  const directory=await tempDir(t);
  const first=createWeatherCache({file:createStateFile(directory,'weather-cache.json'),loadWeather:async()=>forecast('Saved'),clock:()=>5_000_000});
  await first.refresh(request);
  assert.equal((await fs.stat(path.join(directory,'weather-cache.json'))).mode & 0o777,0o600);
  const restarted=createWeatherCache({file:createStateFile(directory,'weather-cache.json'),loadWeather:()=>assert.fail('Fresh saved data is reused'),clock:()=>5_000_000+60000});
  assert.equal((await restarted.read(request,{waitMs:0})).weather.value.label,'Saved');
  await fs.writeFile(path.join(directory,'weather-cache.json'),JSON.stringify({weather:{[request.key]:{at:'yesterday',value:'<b>'}}}));
  const broken=createWeatherCache({file:createStateFile(directory,'weather-cache.json'),loadWeather:()=>new Promise(()=>{})});
  assert.equal((await broken.read(request,{waitMs:0})).preparing,true,'Invalid records count as no data');
});

test('prune drops forecasts for an old city or unit',async()=>{
  const cache=createWeatherCache({loadWeather:async()=>forecast('x')});
  await cache.refresh(request);
  const celsius=weatherRequest(weatherSettings({city:'Boston, MA',units:'celsius'}),'America/New_York');
  await cache.refresh(celsius,{prune:true});
  assert.deepEqual(Object.keys((await cache.snapshot()).weather),[celsius.key]);
  await cache.refresh(null,{prune:true});
  assert.deepEqual(Object.keys((await cache.snapshot()).weather),[celsius.key],'Without a timezone, keep the forecast');
});
