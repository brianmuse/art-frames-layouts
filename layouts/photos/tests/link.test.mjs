import assert from 'node:assert/strict';
import {test} from 'node:test';
import {albumLink,allowedRedirect,LinkError,imageHost} from '../src/server/album-link.mjs';
import {fetchAlbumPage} from '../src/server/photo-service.mjs';
import {mockHttps} from './helpers.mjs';

const SHARE='https://photos.google.com/share/AF1QipSyntheticAlbumId0000?key=SyntheticKey123';

test('accepts both shared album link forms and rebuilds them',()=>{
  assert.deepEqual(albumLink('https://photos.app.goo.gl/SyntheticCode12'),{kind:'short',url:'https://photos.app.goo.gl/SyntheticCode12'});
  assert.deepEqual(albumLink('  https://photos.app.goo.gl/SyntheticCode12/  '),{kind:'short',url:'https://photos.app.goo.gl/SyntheticCode12'});
  assert.deepEqual(albumLink(SHARE),{kind:'share',url:SHARE});
  // The signed-in /u/<n>/ prefix and extra query values are dropped.
  assert.equal(albumLink('https://photos.google.com/u/1/share/AF1QipSyntheticAlbumId0000?key=SyntheticKey123&pli=1').url,SHARE);
});

test('rejects other hosts, schemes and shapes',()=>{
  for(const value of [
    '', '   ', null, 42,
    'http://photos.app.goo.gl/SyntheticCode12',
    'https://photos.app.goo.gl.evil.example/SyntheticCode12',
    'https://evil.example/https://photos.app.goo.gl/SyntheticCode12',
    'https://user:pass@photos.app.goo.gl/SyntheticCode12',
    'https://photos.app.goo.gl:8443/SyntheticCode12',
    'https://photos.app.goo.gl/../etc/passwd',
    'https://photos.app.goo.gl/a/b',
    'https://photos.google.com/share/AF1QipSyntheticAlbumId0000',
    'https://photos.google.com/share/AF1QipSyntheticAlbumId0000?key=bad%20key',
    'https://photos.google.com/album/AF1QipSyntheticAlbumId0000?key=SyntheticKey123',
    'https://google.com/share/AF1QipSyntheticAlbumId0000?key=SyntheticKey123',
    'https://lh3.googleusercontent.com/pw/AP1GczSyntheticBase',
    'javascript:alert(1)',
  ]) assert.throws(()=>albumLink(value),LinkError,String(value));
  assert.equal(albumLink.length,1);
});

test('only share pages are allowed redirect targets, and only lhN image hosts',()=>{
  assert.equal(allowedRedirect(new URL(SHARE)),true);
  assert.equal(allowedRedirect(new URL('https://photos.google.com/login')),false);
  assert.equal(allowedRedirect(new URL('https://accounts.google.com/share/AF1QipSyntheticAlbumId0000?key=k')),false);
  assert.equal(imageHost('lh3.googleusercontent.com'),true);
  assert.equal(imageHost('lh12.googleusercontent.com'),true);
  assert.equal(imageHost('lh3.googleusercontent.com.evil.example'),false);
  assert.equal(imageHost('googleusercontent.com'),false);
  assert.equal(imageHost('evil-lh3.googleusercontent.com'),false);
});

test('follows the short link to the share page and revalidates every hop',async t=>{
  const calls=mockHttps(t,url=>url.hostname==='photos.app.goo.gl'?{status:302,headers:{location:SHARE}}:{status:200,headers:{'content-type':'text/html; charset=utf-8'},body:'<html>ok</html>'});
  const body=await fetchAlbumPage('https://photos.app.goo.gl/SyntheticCode12');
  assert.equal(body.toString(),'<html>ok</html>');
  assert.deepEqual(calls,['https://photos.app.goo.gl/SyntheticCode12',SHARE]);
});

test('hostile redirects stop before any request to the new address',async t=>{
  for(const location of [
    'https://evil.example/share/AF1QipSyntheticAlbumId0000?key=k',
    'http://photos.google.com/share/AF1QipSyntheticAlbumId0000?key=SyntheticKey123',
    'https://photos.google.com/login?continue=x',
    'https://lh3.googleusercontent.com/pw/AP1GczSyntheticBaseUrl000001',
    'https://photos.app.goo.gl/AnotherCode',
    'https://consent.google.com/ml?continue=https://photos.google.com',
  ]) {
    await t.test(location,async t=>{
      const calls=mockHttps(t,()=>({status:302,headers:{location}}));
      await assert.rejects(fetchAlbumPage('https://photos.app.goo.gl/SyntheticCode12'),error=>['redirect','unsupported-address'].includes(error.code));
      assert.equal(calls.length,1,'The redirect target is never requested');
    });
  }
});

test('a redirect loop on allowed pages stops after three hops',async t=>{
  const calls=mockHttps(t,()=>({status:302,headers:{location:SHARE}}));
  await assert.rejects(fetchAlbumPage(SHARE),{code:'redirect'});
  assert.equal(calls.length,4);
});

test('private addresses are refused before connecting',async t=>{
  const calls=mockHttps(t,()=>({status:200,body:''}),{address:'10.0.0.7'});
  await assert.rejects(fetchAlbumPage(SHARE),{code:'blocked-address'});
  assert.equal(calls.length,0);
});

test('a page larger than the limit is refused',async t=>{
  mockHttps(t,()=>({status:200,headers:{'content-type':'text/html','content-length':'9000000'},body:''}));
  await assert.rejects(fetchAlbumPage(SHARE),{code:'too-large'});
});
