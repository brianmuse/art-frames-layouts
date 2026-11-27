import assert from 'node:assert/strict';
import {test} from 'node:test';
import https from 'node:https';
import dns from 'node:dns/promises';
import {EventEmitter} from 'node:events';
import {fetchText,validateUrl,publicAddress} from '../src/server/fetch.mjs';
import {fetchFeed} from '../src/server/cache.mjs';

// A fake https.get: each call takes the next scripted response.
function script(t,responses) {
  const seen=[];
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    seen.push(url.href);
    assert.equal(options.servername,url.hostname);
    const next=responses.shift();
    const request=new EventEmitter();
    queueMicrotask(()=>{
      const response=new EventEmitter();
      response.statusCode=next.status;response.headers=next.headers || {};response.complete=true;response.destroy=()=>{};
      receive(response);
      if (next.body!==undefined) {response.emit('data',Buffer.from(next.body));response.emit('end');}
    });
    return request;
  });
  return seen;
}
const rss='<?xml version="1.0"?><rss version="2.0"><channel><item><title>Sample story - Daily Example</title><source url="https://example.test">Daily Example</source><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';

test('topic feeds follow the same-host redirect to the RSS topic path',async(t)=>{
  const seen=script(t,[{status:302,headers:{location:'https://news.google.com/rss/topics/SAMPLEID?hl=en-US&gl=US&ceid=US:en'}},{status:200,body:rss}]);
  const items=await fetchFeed('https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en');
  assert.deepEqual(items.map(item=>[item.title,item.source]),[['Sample story','Daily Example']]);
  assert.deepEqual(seen,['https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en','https://news.google.com/rss/topics/SAMPLEID?hl=en-US&gl=US&ceid=US:en']);
});

test('redirects to another host, plain HTTP or too many hops are refused',async(t)=>{
  script(t,[{status:302,headers:{location:'https://evil.example/rss'}}]);
  await assert.rejects(fetchFeed('https://news.google.com/rss'),{code:'unsupported-address'});
  t.mock.reset();
  script(t,[{status:301,headers:{location:'http://news.google.com/rss'}}]);
  await assert.rejects(fetchFeed('https://news.google.com/rss'),{code:'unsupported-address'});
  t.mock.reset();
  script(t,[1,2,3].map(()=>({status:302,headers:{location:'/rss/again'}})));
  await assert.rejects(fetchFeed('https://news.google.com/rss'),{code:'redirect'});
  t.mock.reset();
  script(t,[{status:302,headers:{location:'/rss/again'}}]);
  await assert.rejects(fetchText('https://news.google.com/rss',['news.google.com']),{code:'redirect'},'No redirects unless asked');
});

test('bodies are bounded and private addresses are blocked',async(t)=>{
  script(t,[{status:200,body:'x'.repeat(2000)}]);
  await assert.rejects(fetchText('https://news.google.com/rss',['news.google.com'],1000),{code:'too-large'});
  t.mock.reset();
  t.mock.method(dns,'lookup',async()=>[{address:'192.168.1.10',family:4}]);
  t.mock.method(https,'get',()=>assert.fail('No request to a private address'));
  await assert.rejects(fetchFeed('https://news.google.com/rss'),{code:'blocked-address'});
  for (const url of ['http://news.google.com/rss','https://user@news.google.com/rss','https://news.google.com:8443/rss','https://news.google.com.evil.example/rss']) assert.throws(()=>validateUrl(url,['news.google.com']));
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(address),false);
});

test('each redirect hop runs the public-address check again',async(t)=>{
  const lookups=[];
  t.mock.method(dns,'lookup',async host=>{lookups.push(host);return lookups.length===1 ? [{address:'8.8.8.8',family:4}] : [{address:'127.0.0.1',family:4}];});
  let requests=0;
  t.mock.method(https,'get',(url,options,receive)=>{
    requests++;
    const request=new EventEmitter();
    queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=302;response.headers={location:'/rss/topics/SAMPLEID'};response.destroy=()=>{};receive(response);});
    return request;
  });
  await assert.rejects(fetchFeed('https://news.google.com/rss/headlines/section/topic/WORLD'),{code:'blocked-address'});
  assert.deepEqual(lookups,['news.google.com','news.google.com']);
  assert.equal(requests,1,'No request to the private address');
});
