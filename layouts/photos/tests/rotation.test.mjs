import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRotation} from '../src/server/rotation.mjs';
import {createStateFile} from '../src/server/state-file.mjs';
import {item} from './helpers.mjs';

const memory=()=>{let value=null;return {load:async()=>value && structuredClone(value),save:async next=>{value=structuredClone(next);}};};
// A seeded generator, so a failure is repeatable.
const seeded=(seed=7)=>()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const all=()=>true;
const options={order:'shuffle',albumKey:'album-a',ready:all};
// A time bucket from minute m to m+length.
const at=(m,length=1)=>({start:m*60000,end:(m+length)*60000});

test('shuffle shows every photo once per cycle, then starts a new order',async()=>{
  const items=Array.from({length:25},(_,n)=>item(n));
  const rotation=createRotation(memory(),{random:seeded()});
  const cycles=[];
  for(let cycle=0;cycle<4;cycle++) {
    const shown=[];
    for(let n=0;n<items.length;n++) shown.push(await rotation.choose(items,options));
    assert.equal(new Set(shown).size,items.length,`cycle ${cycle} has no repeats`);
    if(cycles.length) assert.notEqual(shown[0],cycles.at(-1).at(-1),'No repeat across the cycle boundary');
    cycles.push(shown);
  }
  assert.notDeepEqual(cycles[0],cycles[1],'Each cycle has its own order');
});

test('the position survives a restart from /site-state',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'photos-rotation-'));
  try {
    const items=Array.from({length:6},(_,n)=>item(n));
    const first=createRotation(createStateFile(root,'rotation.json'),{random:seeded(3)});
    const shown=[await first.choose(items,options),await first.choose(items,options),await first.choose(items,options)];
    const second=createRotation(createStateFile(root,'rotation.json'),{random:seeded(9)});
    for(let n=0;n<3;n++) shown.push(await second.choose(items,options));
    assert.equal(new Set(shown).size,6);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('newest first follows the date taken and shows new photos next',async()=>{
  const items=[item(1),item(5),item(3),item(2,{takenAt:null})];
  const rotation=createRotation(memory());
  const newest={...options,order:'newest'};
  assert.equal(await rotation.choose(items,newest),item(5).id);
  assert.equal(await rotation.choose(items,newest),item(3).id);
  const added=[...items,item(9)];
  assert.equal(await rotation.choose(added,newest),item(9).id,'A newly added photo comes next');
  assert.equal(await rotation.choose(added,newest),item(1).id);
  assert.equal(await rotation.choose(added,newest),item(2).id,'Undated photos come last');
  assert.equal(await rotation.choose(added,newest),item(9).id,'Then the cycle starts again');
});

test('a preview does not advance or save the rotation',async()=>{
  const items=Array.from({length:5},(_,n)=>item(n));
  const file=memory();
  const rotation=createRotation(file,{random:seeded()});
  const peek=await rotation.choose(items,{...options,advance:false});
  assert.equal(await file.load(),null,'Nothing saved');
  const first=await rotation.choose(items,options);
  assert.equal(first,peek,'The preview showed what the next update shows');
  for(let n=0;n<3;n++) assert.equal(await rotation.choose(items,{...options,advance:false}),first);
  const second=await rotation.choose(items,options);
  assert.notEqual(second,first);
});

test('photos that are not downloaded yet wait for a later turn in the same cycle',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const rotation=createRotation(memory(),{random:seeded()});
  const ready=new Set([items[2].id]);
  assert.equal(await rotation.choose(items,{...options,ready:id=>ready.has(id)}),items[2].id);
  assert.equal(await rotation.choose(items,{...options,ready:id=>ready.has(id)}),items[2].id,'Nothing new ready: keep the current photo');
  const rest=[];
  for(let n=0;n<3;n++) rest.push(await rotation.choose(items,options));
  assert.deepEqual(new Set(rest),new Set([items[0].id,items[1].id,items[3].id]));
  assert.equal(await createRotation(memory()).choose(items,{...options,ready:()=>false}),null);
});

test('a different album or order starts a fresh rotation',async()=>{
  const rotation=createRotation(memory(),{random:seeded()});
  const a=[item(1),item(2)],b=[item(7)];
  await rotation.choose(a,options);
  assert.equal(await rotation.choose(b,{...options,albumKey:'album-b'}),item(7).id);
  assert.equal(await rotation.current(),item(7).id);
  assert.deepEqual((await rotation.upcoming(a,options)).length,2);
});

test('one step per bucket; the same or an earlier bucket keeps the photo',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const file=memory();
  const rotation=createRotation(file,{random:seeded()});
  const first=await rotation.choose(items,{...options,bucket:at(100)});
  assert.equal(await rotation.choose(items,{...options,bucket:at(100)}),first);
  assert.equal(await rotation.choose(items,{...options,bucket:at(99)}),first,'The clock went back');
  const second=await rotation.choose(items,{...options,bucket:at(105)});
  assert.notEqual(second,first);
  assert.equal(await rotation.choose(items,{...options,bucket:at(101)}),second,'Still no re-advance after going back');
  assert.deepEqual((await file.load()).displays[''].bucket,at(105));
  // The bucket survives a restart.
  assert.equal(await createRotation(file).choose(items,{...options,bucket:at(105)}),second);
});

for(const order of ['shuffle','newest']) {
  test(`a photo that keeps failing is skipped and the cycle still completes (${order})`,async()=>{
    const items=Array.from({length:5},(_,n)=>item(n));
    const bad=items[order==='newest'?0:2].id;
    const rotation=createRotation(memory(),{random:seeded()});
    const shown=[];
    for(let n=0;n<8;n++) shown.push(await rotation.choose(items,{...options,order,bucket:at(n),ready:id=>id!==bad,skip:id=>id===bad}));
    assert.ok(!shown.includes(bad));
    assert.equal(new Set(shown.slice(0,4)).size,4,'All four good photos in the first cycle');
    assert.equal(new Set(shown.slice(4,8)).size,4,'And again in the next cycle, with no stall');
    assert.ok(!(await rotation.upcoming(items,{...options,order,skip:id=>id===bad})).includes(bad));
  });
}

test('a longer or shorter bucket compares real times',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const rotation=createRotation(memory(),{random:seeded()});
  const first=await rotation.choose(items,{...options,bucket:at(600,15)});// 10:00–10:15
  assert.equal(await rotation.choose(items,{...options,bucket:at(0,1440)}),first,'Today, once a day: hold');
  const second=await rotation.choose(items,{...options,bucket:at(1440,1440)});
  assert.notEqual(second,first,'Tomorrow moves');
  const third=await rotation.choose(items,{...options,bucket:at(1440+615,15)});
  assert.notEqual(third,second,'Back to 15 minutes: the next step moves');
});

test('a saved bucket far ahead of the clock does not hold the photo',async()=>{
  const items=Array.from({length:3},(_,n)=>item(n));
  const rotation=createRotation(memory(),{random:seeded()});
  const now=Date.UTC(2026,9,27);
  const future=await rotation.choose(items,{...options,bucket:{start:now+400*86400000,end:now+400*86400000+900000},now:now+400*86400000});
  const back=await rotation.choose(items,{...options,bucket:{start:now,end:now+900000},now});
  assert.notEqual(back,future,'The clock came back from a jump: the rotation moves again');
  assert.equal(await rotation.choose(items,{...options,bucket:{start:now,end:now+900000},now}),back);
});

test('each display key has its own rotation, saved together',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const file=memory();
  const rotation=createRotation(file,{random:seeded()});
  const newest={...options,order:'newest'};
  assert.equal(await rotation.choose(items,{...newest,display:'kitchen',bucket:at(0)}),item(3).id);
  assert.equal(await rotation.choose(items,{...newest,display:'kitchen',bucket:at(1)}),item(2).id);
  assert.equal(await rotation.choose(items,{...newest,display:'hall',bucket:at(1)}),item(3).id,'A new display starts at the beginning');
  assert.equal(await rotation.current('kitchen'),item(2).id);
  const again=createRotation(file);
  assert.equal(await again.choose(items,{...newest,display:'kitchen',bucket:at(1)}),item(2).id,'Saved per display');
  assert.equal(await again.choose(items,{...newest,display:'hall',bucket:at(1)}),item(3).id);
  for(let n=0;n<10;n++) await again.choose(items,{...newest,display:`tv-${n}`,bucket:at(2),now:n});
  assert.ok(Object.keys((await file.load()).displays).length<=8,'Only the most recent displays are kept');
});

test('a version 1 file becomes the shared rotation',async()=>{
  const items=Array.from({length:3},(_,n)=>item(n));
  const file=memory();
  await file.save({version:1,albumKey:'album-a',order:'newest',sequence:items.map(entry=>entry.id).reverse(),shown:[item(2).id],current:item(2).id,bucket:105,cycle:1});
  const rotation=createRotation(file);
  assert.equal(await rotation.current(),item(2).id);
  assert.equal(await rotation.choose(items,{...options,order:'newest',bucket:at(0)}),item(1).id,'The old number bucket is dropped, so it moves');
});

test('a bucket with the same start holds the photo, whatever its end',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const rotation=createRotation(memory(),{random:seeded()});
  const first=await rotation.choose(items,{...options,bucket:at(600,15)});
  assert.equal(await rotation.choose(items,{...options,bucket:at(600,60)}),first,'15 to 60 minutes at 10:00: hold');
  assert.equal(await rotation.choose(items,{...options,bucket:at(600,5)}),first,'Then 5 minutes at 10:00: hold');
  assert.notEqual(await rotation.choose(items,{...options,bucket:at(605,5)}),first);
});

test('a display that keeps its photo stays recent, and downloads never add a display',async()=>{
  const items=Array.from({length:3},(_,n)=>item(n));
  const file=memory();
  const rotation=createRotation(file,{random:seeded()});
  await rotation.choose(items,{...options,display:'kitchen',bucket:at(0,1440),now:0});
  for(let n=0;n<7;n++) await rotation.choose(items,{...options,display:`tv-${n}`,bucket:at(1),now:1+n});
  // Once a day: the kitchen TV holds its photo, but it still counts as used.
  const held=await rotation.current('kitchen');
  assert.equal(await rotation.choose(items,{...options,display:'kitchen',bucket:at(0,1440),now:20}),held);
  await rotation.choose(items,{...options,display:'tv-new',bucket:at(1),now:21});
  const keys=Object.keys((await file.load()).displays);
  assert.ok(keys.includes('kitchen'),'The kitchen TV is kept');
  assert.ok(!keys.includes('tv-0'),'The least recently used TV is dropped');
  await rotation.upcoming(items,{...options,display:'tv-0'});
  assert.equal(await rotation.current('tv-0'),null);
  await rotation.choose(items,{...options,display:'kitchen',bucket:at(0,1440),now:22});
  assert.ok(!Object.keys((await file.load()).displays).includes('tv-0'),'Downloads and lookups do not bring it back');
});

for(const order of ['shuffle','newest']) {
  test(`8 displays with 2000 long ids fit in the rotation file (${order})`,async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'photos-rotation-'));
    try {
      const items=Array.from({length:2000},(_,n)=>({...item(n),id:`AF1Qip${String(n).padStart(6,'0')}`.padEnd(200,'x')}));
      const file=createStateFile(root,'rotation.json',{maxBytes:2_000_000});
      const rotation=createRotation(file,{random:seeded()});
      for(let tv=0;tv<8;tv++) for(let step=0;step<(tv===7?1999:50);step++) await rotation.choose(items,{...options,order,display:`tv-${tv}`,bucket:at(step),now:step});
      const size=(await fs.stat(path.join(root,'rotation.json'))).size;
      assert.ok(size<2_000_000,`${size} bytes`);
      assert.equal(Object.keys((await file.load()).displays).length,8,'The last save wrote all 8 displays');
      const again=createRotation(file);
      assert.equal(await again.current('tv-7'),await rotation.current('tv-7'),'It loads back');
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
}

test('a held photo saves its last use, so the TV survives a restart and an eviction',async()=>{
  const items=Array.from({length:3},(_,n)=>item(n));
  const file=memory();
  const rotation=createRotation(file,{random:seeded()});
  await rotation.choose(items,{...options,display:'kitchen',bucket:at(0,1440),now:0});
  for(let n=0;n<7;n++) await rotation.choose(items,{...options,display:`tv-${n}`,bucket:at(1),now:1+n});
  await rotation.choose(items,{...options,display:'kitchen',bucket:at(0,1440),now:20});
  assert.equal((await file.load()).displays.kitchen.usedAt,20,'The held render saved its time');
  const again=createRotation(file,{random:seeded()});
  await again.choose(items,{...options,display:'tv-new',bucket:at(1),now:21});
  const keys=Object.keys((await file.load()).displays);
  assert.ok(keys.includes('kitchen'),'The kitchen TV is kept after a restart');
  assert.ok(!keys.includes('tv-0'),'The least recently used TV is dropped');
});

test('newest first saves no sequence',async()=>{
  const items=Array.from({length:4},(_,n)=>item(n));
  const file=memory();
  await createRotation(file).choose(items,{...options,order:'newest',bucket:at(0)});
  const saved=(await file.load()).displays[''];
  assert.deepEqual(saved.sequence,[]);
  assert.equal(saved.order,'newest');
});

test('displays on an old album save no photo lists, so 8 old albums fit in the file',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'photos-rotation-'));
  try {
    const album=a=>Array.from({length:2000},(_,n)=>({...item(n),id:`AF1Qip${a}-${String(n).padStart(6,'0')}`.padEnd(200,'x')}));
    const file=createStateFile(root,'rotation.json',{maxBytes:2_000_000});
    const rotation=createRotation(file,{random:seeded()});
    for(let tv=0;tv<8;tv++) await rotation.choose(album(tv),{...options,albumKey:`album-${tv}`,display:`tv-${tv}`,bucket:at(0),now:tv});
    const saved=await file.load();
    assert.ok(saved,'The file was saved and loads');
    assert.equal(Object.keys(saved.displays).length,8,'The last save wrote all 8 displays');
    for(let tv=0;tv<7;tv++) {
      assert.deepEqual(saved.displays[`tv-${tv}`].sequence,[],`tv-${tv} keeps no sequence`);
      assert.deepEqual(saved.displays[`tv-${tv}`].shown,[],`tv-${tv} keeps no shown list`);
    }
    assert.equal(saved.displays['tv-7'].sequence.length,2000,'The current album keeps its order');
    // An old-album TV starts its new album fresh on its next render.
    const again=createRotation(file,{random:seeded()});
    assert.ok(await again.choose(album(7),{...options,albumKey:'album-7',display:'tv-0',bucket:at(1),now:9}));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
