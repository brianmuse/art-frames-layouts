import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {parseAlbum,ParseError,MAX_ITEMS,MAX_PAGE_BYTES,MAX_BLOCK_BYTES,baseUrl} from '../src/server/album-parser.mjs';
import {sampleAlbumPage} from '../src/server/samples.mjs';
import {item} from './helpers.mjs';

const fixture=name=>fs.readFile(new URL(`./fixtures/${name}`,import.meta.url));

test('reads structured entries with sizes and dates, and skips videos and bad rows',async()=>{
  const result=parseAlbum(await fixture('album-structured.html'));
  assert.equal(result.method,'structured');
  assert.equal(result.videos,1);
  assert.equal(result.more,true,'A page token means the album has more items');
  assert.deepEqual(result.items,[
    {id:'AF1QipSyntheticPhotoOne001',url:'https://lh3.googleusercontent.com/pw/AP1GczSyntheticLandscapeBaseUrl0001',width:4032,height:3024,takenAt:1688220000000,offsetMs:-14400000},
    {id:'AF1QipSyntheticPhotoTwo002',url:'https://lh4.googleusercontent.com/pw/AP1GczSyntheticPortraitBaseUrl0002',width:3024,height:4032,takenAt:1700000000000,offsetMs:3600000},
    {id:'AF1QipSyntheticNoDate0005',url:'https://lh5.googleusercontent.com/pw/AP1GczSyntheticNoDateBaseUrl0005',width:1600,height:1200,takenAt:null,offsetMs:0},
  ]);
  // Only plain values come out: no markup, no album title, no avatar.
  assert.doesNotMatch(JSON.stringify(result),/<|title|ACg8oc|evil/);
});

test('falls back to an image URL scan when the structured data is missing',async()=>{
  const result=parseAlbum(await fixture('album-fallback.html'));
  assert.equal(result.method,'fallback');
  assert.deepEqual(result.items.map(entry=>entry.url),[
    'https://lh3.googleusercontent.com/pw/AP1GczSyntheticFallbackPhoto0001',
    'https://lh3.googleusercontent.com/pw/AP1GczSyntheticFallbackPhoto0002',
    'https://lh6.googleusercontent.com/pw/AP1GczSyntheticFallbackPhoto0003',
  ]);
  for(const entry of result.items) {
    assert.match(entry.id,/^u[A-Za-z0-9_-]{32}$/);
    assert.equal(entry.width,null);assert.equal(entry.takenAt,null);
  }
});

test('a page without photos is a parse error',async()=>{
  assert.throws(()=>parseAlbum(Buffer.from('')),ParseError);
  const unknown=await fixture('album-unknown.html');
  assert.throws(()=>parseAlbum(unknown),{code:'parse'});
  assert.throws(()=>parseAlbum('AF_initDataCallback({key: \'ds:1\', data:[[[[[[[[[[[[[["'),ParseError);
});

test('an empty album is not a parse error',()=>{
  const result=parseAlbum(sampleAlbumPage([]));
  assert.deepEqual(result.items,[]);
});

test('the item count is capped',()=>{
  const page=sampleAlbumPage(Array.from({length:MAX_ITEMS+50},(_,n)=>item(n)));
  const result=parseAlbum(page);
  assert.equal(result.items.length,MAX_ITEMS);
});

test('base URLs lose size parameters and must be on an image host',()=>{
  assert.equal(baseUrl('https://lh3.googleusercontent.com/pw/AP1GczSyntheticBase0000=w400-h300-no'),'https://lh3.googleusercontent.com/pw/AP1GczSyntheticBase0000');
  for(const value of ['http://lh3.googleusercontent.com/pw/AP1GczSyntheticBase0000','https://lh3.googleusercontent.com/a/ACg8ocSyntheticAvatar000','https://lh3.googleusercontent.com/pw/x"onerror="y','https://lh3.googleusercontent.com/pw/short',null,{}]) assert.equal(baseUrl(value),null,String(value));
});

test('an unbalanced page parses in linear time',()=>{
  // Many callbacks whose data never closes: each scan would otherwise run to the end.
  const page='<script>'+'AF_initDataCallback({key: \'ds:1\', data:[ "x", '.repeat(60000).slice(0,2_000_000)+'</script>';
  assert.ok(page.length>=1_900_000);
  const started=performance.now();
  assert.throws(()=>parseAlbum(page),ParseError);
  assert.ok(performance.now()-started<500,`took ${Math.round(performance.now()-started)} ms`);
});

test('pages and data blocks over the size limits are not parsed whole',()=>{
  assert.equal(MAX_PAGE_BYTES,4_000_000);
  // A photo entry past the page limit is never seen.
  const far=' '.repeat(MAX_PAGE_BYTES)+sampleAlbumPage([item(1)]);
  assert.throws(()=>parseAlbum(far),ParseError);
  // One huge block is skipped before JSON.parse; a normal block after it still counts.
  const huge=`<script>AF_initDataCallback({key: 'ds:2', data:[${'[0],'.repeat(800_000)}0], sideChannel: {}});</script>`;
  assert.ok(huge.length>MAX_BLOCK_BYTES);
  const original=JSON.parse;
  let biggest=0;
  JSON.parse=(text,...rest)=>{biggest=Math.max(biggest,text.length);return original(text,...rest);};
  try {
    const result=parseAlbum(huge+sampleAlbumPage([item(2)]));
    assert.deepEqual(result.items.map(entry=>entry.id),[item(2).id]);
  } finally {JSON.parse=original;}
  assert.ok(biggest<MAX_BLOCK_BYTES,'The huge block never reached JSON.parse');
});
