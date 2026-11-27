// Which photo to show. The photo changes once per time bucket (the "Change photo
// every" setting), not once per render: every render in the same bucket shows the
// same photo, and the rotation moves one step when a new bucket starts. Each cycle
// shows every photo once before any repeats. Shuffle keeps one random order per
// cycle; newest first sorts by date taken.
//
// A bucket is {start, end} in epoch ms, so a change of interval compares real
// times. Each display key (from the snapshot's display.id) has its own rotation;
// the empty key is the shared rotation for hosts that send no display.id.

const MAX_IDS=2000;
const MAX_DISPLAYS=8;
const DAY_MS=86400000;

function shuffled(ids,random) {
  const list=[...ids];
  for(let index=list.length-1;index>0;index--) {
    const other=Math.floor(random()*(index+1));
    [list[index],list[other]]=[list[other],list[index]];
  }
  return list;
}

export function newestOrder(items) {
  return items.map((item,index)=>({item,index}))
    .sort((a,b)=>(b.item.takenAt ?? -Infinity)-(a.item.takenAt ?? -Infinity) || a.index-b.index)
    .map(({item})=>item.id);
}

const none=()=>false;

export function createRotation(file,{random=Math.random}={}) {
  let rotations=null,state=null,lock=Promise.resolve();

  const validBucket=value=>value && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.end>value.start?{start:value.start,end:value.end}:null;
  function readState(saved) {
    return {
      albumKey:typeof saved?.albumKey==='string'?saved.albumKey:null,
      order:saved?.order==='newest'?'newest':'shuffle',
      sequence:Array.isArray(saved?.sequence)?saved.sequence.filter(id=>typeof id==='string').slice(0,MAX_IDS):[],
      shown:Array.isArray(saved?.shown)?saved.shown.filter(id=>typeof id==='string').slice(0,MAX_IDS):[],
      current:typeof saved?.current==='string'?saved.current:null,
      // A bucket from an older version (a plain number) is dropped.
      bucket:validBucket(saved?.bucket),
      cycle:Number.isSafeInteger(saved?.cycle)?saved.cycle:0,
      usedAt:Number.isSafeInteger(saved?.usedAt)?saved.usedAt:0,
    };
  }

  // The file keeps each photo id once, in ids; displays refer to them by index.
  // Newest first stores no sequence, since the album gives it again.
  function decode(saved) {
    const table=Array.isArray(saved.ids)?saved.ids:[];
    const id=value=>Number.isSafeInteger(value) && typeof table[value]==='string'?table[value]:null;
    const list=value=>Array.isArray(value)?value.map(id).filter(Boolean):[];
    return {...saved,sequence:list(saved.sequence),shown:list(saved.shown),current:id(saved.current)};
  }

  // A display on another album saves no photo lists. Its next render starts the
  // current album fresh. Old ids for 8 albums can pass the file size cap.
  function encode(albumKey) {
    const ids=[],index=new Map();
    const ref=id=>{if(!index.has(id)) {index.set(id,ids.length);ids.push(id);}return index.get(id);};
    const displays={};
    for(const [key,value] of rotations) {
      const old=value.albumKey!==albumKey;
      displays[key]={
        albumKey:value.albumKey,order:value.order,
        sequence:value.order==='newest' || old?[]:value.sequence.map(ref),
        shown:old?[]:value.shown.map(ref),
        current:value.current===null?null:ref(value.current),
        bucket:value.bucket,cycle:value.cycle,usedAt:value.usedAt,
      };
    }
    return {version:3,ids,displays};
  }

  /**
   * The state for one display. create false (downloads ahead, the current photo,
   * a preview) never adds a display, so a display that was dropped stays dropped.
   */
  async function load(display='',{create=false,now=0}={}) {
    if(!rotations) {
      const saved=await file.load();
      rotations=new Map();
      if((saved?.version===3 || saved?.version===2) && saved.displays && typeof saved.displays==='object') {
        for(const [key,value] of Object.entries(saved.displays).slice(0,MAX_DISPLAYS)) rotations.set(key,readState(saved.version===3?decode({...value,ids:saved.ids}):value));
      } else if(saved) rotations.set('',readState(saved));
    }
    if(!rotations.has(display)) {
      state=readState(null);
      if(!create) return state;
      state.usedAt=now;
      rotations.set(display,state);
      // Forget the least recently used display when there are too many.
      if(rotations.size>MAX_DISPLAYS) {
        const oldest=[...rotations].filter(([key])=>key!==display).sort((a,b)=>a[1].usedAt-b[1].usedAt)[0][0];
        rotations.delete(oldest);
      }
    }
    state=rotations.get(display);
    return state;
  }

  // Bring the stored order up to date with the album and settings.
  function reconcile(items,{order,albumKey}) {
    const ids=new Set(items.map(item=>item.id));
    if(state.albumKey!==albumKey || state.order!==order) {
      Object.assign(state,{albumKey,order,sequence:[],shown:[],current:null,bucket:null,cycle:0});
    }
    state.shown=state.shown.filter(id=>ids.has(id));
    if(order==='newest') state.sequence=newestOrder(items);
    else {
      const kept=state.sequence.filter(id=>ids.has(id));
      const known=new Set(kept);
      const added=items.map(item=>item.id).filter(id=>!known.has(id));
      if(!kept.length) state.sequence=shuffled(added,random);
      else {
        // New photos join the rest of this cycle at random places.
        const shownSet=new Set(state.shown);
        const firstOpen=Math.max(0,kept.findIndex(id=>!shownSet.has(id)));
        for(const id of shuffled(added,random)) kept.splice(firstOpen+Math.floor(random()*(kept.length-firstOpen+1)),0,id);
        state.sequence=kept;
      }
    }
    if(state.current && !ids.has(state.current)) state.current=null;
  }

  function startCycle() {
    const last=state.current;
    state.shown=[];state.cycle++;
    if(state.order==='shuffle') {
      state.sequence=shuffled(state.sequence,random);
      // Do not show the last photo of one cycle again first in the next.
      if(state.sequence.length>1 && state.sequence[0]===last) {
        const swap=1+Math.floor(random()*(state.sequence.length-1));
        [state.sequence[0],state.sequence[swap]]=[state.sequence[swap],state.sequence[0]];
      }
    }
  }

  // Photos still to show this cycle. A photo that keeps failing to download is
  // skipped, so it cannot hold the cycle open.
  const remaining=skip=>{const shown=new Set(state.shown);return state.sequence.filter(id=>!shown.has(id) && !skip(id));};
  const save=albumKey=>file.save(encode(albumKey));

  function run(task) {
    const result=lock.then(task);
    lock=result.catch(()=>{});
    return result;
  }

  return {
    /**
     * Choose the photo for this render.
     * - bucket: {start, end} of the current time bucket. A later bucket moves one step.
     * - now: the layout's clock. A saved bucket more than a day ahead of it is dropped,
     *   so a clock that jumped ahead once cannot hold the photo for long.
     * - display: the display key; each key has its own rotation.
     * - ready(id): the photo is cached for this render. skip(id): it keeps failing.
     * - advance false (a preview): never moves or saves.
     * In the same bucket the current photo is returned even when it is not ready
     * for this render, so the caller can prepare it instead of moving on.
     */
    choose(items,{order,albumKey,ready,skip=none,bucket=null,now=Date.now(),display='',advance=true}) {
      return run(async()=>{
        await load(display,{create:advance,now});
        if(advance) state.usedAt=now;
        reconcile(items,{order,albumKey});
        const currentReady=state.current && ready(state.current)?state.current:null;
        if(!advance) return currentReady || remaining(skip).find(ready) || state.sequence.find(id=>ready(id) && !skip(id)) || null;
        if(state.bucket && state.bucket.start>now+DAY_MS) state.bucket=null;
        // A bucket that starts at the same time or earlier (the same bucket, an
        // interval change at the same start, or a clock that went back): keep the photo.
        const held=state.current && !skip(state.current) && state.bucket && bucket && bucket.start<=state.bucket.start;
        if(held) {await save(albumKey);return state.current;}
        if(!remaining(skip).length) startCycle();
        const next=remaining(skip).find(ready);
        if(!next) {
          // Nothing new is ready yet: keep the current photo and try again on the next render.
          await save(albumKey);
          return currentReady;
        }
        state.shown.push(next);state.current=next;
        if(bucket) state.bucket={start:bucket.start,end:bucket.end};
        await save(albumKey);
        return next;
      });
    },
    /** The next count photos to download ahead, without changing the rotation. */
    upcoming(items,{order,albumKey,skip=none,count=4,display=''}) {
      return run(async()=>{
        await load(display);
        reconcile(items,{order,albumKey});
        const list=remaining(skip);
        // Near the end of a cycle, the next cycle starts again from the order.
        for(const id of state.sequence) {if(list.length>=count) break;if(!list.includes(id) && !skip(id)) list.push(id);}
        return list.slice(0,count);
      });
    },
    current(display='') {return run(async()=>(await load(display)).current);},
  };
}
