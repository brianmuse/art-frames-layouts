import assert from 'node:assert/strict';
import {test} from 'node:test';
import https from 'node:https';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {fetchForecast} from '../src/server/weather.mjs';
import {validateUrl,publicAddress} from '../src/server/fetch.mjs';

const fixture=await fs.readFile(new URL('../src/fixtures/sample-forecast.json',import.meta.url),'utf8');
// A fake https.get: each call answers from `answer(url)`. No test reaches the internet.
function script(t,answer) {
  const seen=[];
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    seen.push(url);
    assert.equal(options.servername,url.hostname);
    const next=answer(url);
    const request=new EventEmitter();
    queueMicrotask(()=>{
      const response=new EventEmitter();
      response.statusCode=next.status;response.headers={};response.complete=true;response.destroy=()=>{};
      receive(response);
      if (next.body!==undefined) {response.emit('data',Buffer.from(next.body));response.emit('end');}
    });
    return request;
  });
  return seen;
}
const places=JSON.stringify({results:[
  {name:'Boston',latitude:52.97,longitude:-0.02,admin1:'England',country:'United Kingdom',country_code:'GB'},
  {name:'Boston',latitude:42.36,longitude:-71.06,admin1:'Massachusetts',country:'United States',country_code:'US'},
]});

test('the forecast geocodes the city, picks the right state, then asks Open-Meteo',async(t)=>{
  const seen=script(t,url=>url.hostname==='geocoding-api.open-meteo.com' ? {status:200,body:places} : {status:200,body:fixture});
  const raw=await fetchForecast({city:'Boston, MA',units:'fahrenheit',timezone:'America/New_York'});
  assert.deepEqual(seen.map(url=>url.hostname),['geocoding-api.open-meteo.com','api.open-meteo.com']);
  assert.equal(seen[0].searchParams.get('name'),'Boston');
  assert.equal(seen[1].searchParams.get('latitude'),'42.36');
  assert.equal(raw.daily.time.length,8);
  assert.equal('_comment' in raw,false,'Only the pruned fields are kept');
});

test('an unknown city and a server error fail with a clear code',async(t)=>{
  script(t,()=>({status:200,body:JSON.stringify({results:[]})}));
  await assert.rejects(fetchForecast({city:'Nowhere, ZZ',units:'fahrenheit',timezone:'America/New_York'}),{code:'unknown-city'});
  t.mock.reset();
  script(t,url=>url.hostname==='geocoding-api.open-meteo.com' ? {status:200,body:places} : {status:429});
  await assert.rejects(fetchForecast({city:'Boston, Massachusetts',units:'celsius',timezone:'America/New_York'}),{code:'rate-limited'});
});

test('private addresses and other hosts are refused',async(t)=>{
  t.mock.method(dns,'lookup',async()=>[{address:'192.168.1.10',family:4}]);
  t.mock.method(https,'get',()=>assert.fail('No request to a private address'));
  await assert.rejects(fetchForecast({city:'Salem, MA',units:'fahrenheit',timezone:'America/New_York'}),{code:'blocked-address'});
  for (const url of ['http://api.open-meteo.com/v1/forecast','https://api.open-meteo.com.evil.example/','https://user@api.open-meteo.com/']) assert.throws(()=>validateUrl(url,['api.open-meteo.com']));
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1']) assert.equal(publicAddress(address),false);
});
