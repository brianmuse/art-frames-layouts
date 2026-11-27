import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import zlib from 'node:zlib';
import {createPhotoCache,composeFrame,photoName,downloadImage} from '../src/server/photo-cache.mjs';
import {item,tinyImage,mockHttps} from './helpers.mjs';

const box={width:160,height:90};
const size=async buffer=>{const meta=await sharp(buffer).metadata();return [meta.width,meta.height];};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'photos-cache-'));

test('cover crops to the box shape and contain adds a blurred backdrop, never enlarging',async()=>{
  const portrait=await tinyImage(60,80,{r:240,g:240,b:240});
  const cover=await composeFrame(portrait,'cover',box);
  assert.deepEqual([cover.width,cover.height,cover.backdrop],[60,34,null]);
  assert.deepEqual(await size(cover.photo),[60,34]);
  const contain=await composeFrame(portrait,'contain',box);
  assert.deepEqual([contain.width,contain.height],[60,80]);
  assert.deepEqual(await size(contain.backdrop),[20,11],'A small backdrop in the box shape');
  const {data}=await sharp(contain.backdrop).raw().toBuffer({resolveWithObject:true});
  assert.ok(data[0]<150,'The backdrop is darkened');
  const large=await composeFrame(await tinyImage(800,300),'cover',box);
  assert.deepEqual([large.width,large.height],[160,90],'Large photos shrink to the box');
  // EXIF orientation 6 (rotated): the stored size follows the upright photo.
  const rotated=await sharp(await tinyImage(80,60)).withMetadata({orientation:6}).jpeg().toBuffer();
  const upright=await composeFrame(rotated,'contain',box);
  assert.deepEqual([upright.width,upright.height],[60,80]);
});

test('the cache stays within its bounds and evicts the least recently used photos',async()=>{
  const root=await temp();
  try {
    let downloads=0;
    const cache=createPhotoCache(root,{maxEntries:3,maxBytes:10_000_000,fetchImage:async()=>{downloads++;return tinyImage();}});
    const items=Array.from({length:5},(_,n)=>item(n));
    const names=[];
    for(const entry of items) {names.push(await cache.prepare(entry,{fit:'cover',box}));await new Promise(resolve=>setTimeout(resolve,3));}
    assert.equal(downloads,5);
    assert.equal(await cache.prepare(items[0],{fit:'cover',box}),names[0]);
    assert.equal(downloads,5,'A cached photo is not downloaded again');
    await cache.read(names[0]);
    const removed=await cache.evict({keep:new Set([names[1]])});
    assert.deepEqual(removed.sort(),[names[2],names[3]].sort(),'Oldest unused photos go first; kept and recently read ones stay');
    assert.equal(cache.totals().count,3);
    assert.deepEqual((await fs.readdir(path.join(root,'photos'))).filter(name=>name.endsWith('.jpg')).sort(),[names[0],names[1],names[4]].map(name=>name+'.jpg').sort());
    // Photos that left the album are removed.
    await cache.evict({itemIds:new Set([items[4].id])});
    assert.equal(cache.totals().count,1);
    assert.equal(await cache.read(names[0]),null);
    // The index survives a restart.
    await cache.flush();
    const again=createPhotoCache(root,{fetchImage:async()=>{throw new Error('no download expected');}});
    assert.ok(await again.read(names[4]));
    assert.deepEqual(await again.info(names[4]),{width:64,height:36,backdrop:false});
    assert.equal(await again.read(names[4],'backdrop'),null,'Cover photos have no backdrop');
    const mode=(await fs.stat(path.join(root,'photos',names[4]+'.jpg'))).mode & 0o777;
    assert.equal(mode,0o600);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('the byte bound evicts too',async()=>{
  const root=await temp();
  try {
    const cache=createPhotoCache(root,{maxEntries:100,maxBytes:1,fetchImage:async()=>tinyImage()});
    const a=await cache.prepare(item(1),{fit:'contain',box});
    assert.ok(await cache.read(a,'backdrop'),'Contain photos have a backdrop');
    assert.equal(await cache.read(a,'other'),null);
    await cache.prepare(item(2),{fit:'contain',box});
    await cache.evict({keep:new Set([a])});
    assert.equal(cache.totals().count,1,'Only the kept photo remains');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('cache file names are fixed-format and reads reject anything else',async()=>{
  const cache=createPhotoCache(null);
  assert.match(photoName(item(1).id,'cover',{width:3840,height:2160}),/^[a-f0-9]{24}-cover-3840x2160$/);
  for(const name of ['../index','index','x.jpg','',null]) assert.equal(await cache.read(name),null);
});

test('downloads use the image host only and require an image response',async t=>{
  const calls=mockHttps(t,url=>url.hostname==='lh3.googleusercontent.com'?{status:200,headers:{'content-type':'text/html'},body:'<html>'}:{status:500});
  await assert.rejects(downloadImage(item(1),{width:100,height:100}),{code:'not-image'});
  assert.match(calls[0],/^https:\/\/lh3\.googleusercontent\.com\/pw\/AP1GczTestItemBaseUrl000001=w100-h100-no$/);
  await assert.rejects(downloadImage({...item(2),url:'https://evil.example/pw/AP1GczTestItemBaseUrl000002'},{width:100,height:100}),{code:'unsupported-address'});
  assert.equal(calls.length,1);
});

test('files the index does not know are removed when the cache loads',async()=>{
  const root=await temp();
  try {
    const cache=createPhotoCache(root,{fetchImage:async()=>tinyImage()});
    const name=await cache.prepare(item(1),{fit:'contain',box});
    await cache.flush();
    const dir=path.join(root,'photos');
    // Leftovers from a restart in the middle of a write, and a photo the index lost.
    for(const stray of ['.0b1c2d3e-cut-short.tmp',photoName(item(9).id,'cover',box)+'.jpg','other.jpg']) await fs.writeFile(path.join(dir,stray),'x');
    const again=createPhotoCache(root,{fetchImage:async()=>{throw new Error('no download expected');}});
    assert.ok(await again.read(name),'The indexed photo stays');
    assert.ok(await again.read(name,'backdrop'),'Its backdrop stays');
    assert.deepEqual((await fs.readdir(dir)).sort(),['index.json',name+'-backdrop.jpg',name+'.jpg'].sort());
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

// A PNG header that claims 10000 x 10000 pixels (over the 80 million limit, under
// sharp's own default limit), with almost no pixel data.
function hugePng() {
  const chunk=(type,data)=>{
    const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
    const body=Buffer.concat([Buffer.from(type,'ascii'),data]);
    const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length,body,crc]);
  };
  const header=Buffer.alloc(13);
  header.writeUInt32BE(10000,0);header.writeUInt32BE(10000,4);
  header[8]=8;header[9]=2;// 8-bit RGB
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(16))),chunk('IEND',Buffer.alloc(0))]);
}

test('an image that claims too many pixels is refused before decoding',async()=>{
  const started=performance.now();
  await assert.rejects(composeFrame(hugePng(),'cover',box),/pixel limit/);
  await assert.rejects(composeFrame(hugePng(),'contain',box),/pixel limit/);
  assert.ok(performance.now()-started<2000);
});

test('an unreadable index keeps every file',async()=>{
  const root=await temp();
  try {
    const cache=createPhotoCache(root,{fetchImage:async()=>tinyImage()});
    const name=await cache.prepare(item(1),{fit:'cover',box});
    await cache.flush();
    const dir=path.join(root,'photos');
    await fs.writeFile(path.join(dir,'index.json'),'{not json');
    const again=createPhotoCache(root,{fetchImage:async()=>tinyImage()});
    assert.equal(await again.read(name),null,'The photo is not known without the index');
    assert.ok((await fs.readdir(dir)).includes(name+'.jpg'),'But its file is not deleted');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('an urgent download runs before queued downloads',async()=>{
  const root=await temp();
  try {
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const order=[];
    const cache=createPhotoCache(root,{fetchImage:async entry=>{order.push(entry.id);if(order.length===1) await gate;return tinyImage();}});
    const queued=[1,2,3,4].map(n=>cache.prepare(item(n),{fit:'cover',box}));
    await new Promise(resolve=>setTimeout(resolve,10));
    const promoted=cache.prepare(item(4),{fit:'cover',box,urgent:true});
    const urgent=cache.prepare(item(9),{fit:'cover',box,urgent:true});
    release();
    await Promise.all([...queued,promoted,urgent]);
    assert.deepEqual(order,[item(1),item(4),item(9),item(2),item(3)].map(entry=>entry.id),'The running download ends, then urgent ones, then the rest');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
