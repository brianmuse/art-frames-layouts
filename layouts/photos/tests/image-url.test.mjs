import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestBox,sizedUrl} from '../src/server/image-url.mjs';

const BASE='https://lh3.googleusercontent.com/pw/AP1GczSyntheticBase0000';
const FRAME={width:3840,height:2160};

test('builds the size parameters',()=>{
  assert.equal(sizedUrl(BASE,FRAME),BASE+'=w3840-h2160-no');
  assert.equal(sizedUrl(BASE+'=w100-h100',{width:1620.2,height:2160}),BASE+'=w1621-h2160-no');
  assert.equal(sizedUrl(BASE,{width:99999,height:0}),BASE+'=w7680-h1-no');
  assert.equal(sizedUrl(BASE,{width:3024,height:1701,crop:true}),BASE+'=w3024-h1701-p-no');
  assert.equal(sizedUrl('https://evil.example/pw/AP1GczSyntheticBase0000',FRAME),null);
});

test('asks for a screen-shaped crop or a fitted photo, never more than the original',()=>{
  const portrait={width:3024,height:4032};
  assert.deepEqual(requestBox(portrait,FRAME,'contain'),{width:1620,height:2160,crop:false});
  assert.deepEqual(requestBox(portrait,FRAME,'cover'),{width:3024,height:1701,crop:true},'Full width of the original, cut to 16:9');
  assert.deepEqual(requestBox({width:8000,height:6000},FRAME,'cover'),{width:3840,height:2160,crop:true});
  assert.deepEqual(requestBox({width:1920,height:1080},FRAME,'cover'),{width:1920,height:1080,crop:true},'A crop would enlarge, so ask for the original size');
  assert.deepEqual(requestBox({width:8000,height:6000},FRAME,'contain'),{width:2880,height:2160,crop:false});
  assert.deepEqual(requestBox({width:1920,height:1080},FRAME,'contain'),{width:1920,height:1080,crop:false});
  assert.deepEqual(requestBox({width:null,height:null},FRAME,'cover'),{width:3840,height:3840,crop:false});
});
