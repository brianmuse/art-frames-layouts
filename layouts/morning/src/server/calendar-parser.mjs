import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {ProviderError,backoffMs} from './fetch.mjs';

// Resolve from this file, not the cwd. Production loads src/server unbundled
// (astro.config externals), so this is <layout>/server in dev, tests and the image.
const defaultWorker=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','server','calendar-worker.mjs');
// Deterministic for the same compact text: retry only when the text changes.
export const parseLimits=['recurrence-limit','event-limit','projection-limit'];

export async function runCalendarWorker(input,{workerPath=defaultWorker,timeoutMs=90000}={}) {
  // A separate process is necessary: the website's V8 heap startup flag
  // overrides worker-thread resourceLimits, even with an empty execArgv.
  const worker=fork(workerPath,[],{execArgv:['--max-old-space-size=96','--max-semi-space-size=8','--stack-size=2048'],stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});
  let timer;
  try {
    return await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new ProviderError('parse-timeout')),timeoutMs);
      worker.once('message',result=>result.failed ? reject(new ProviderError(parseLimits.includes(result.code)?result.code:'invalid-feed')) : resolve(result));
      worker.once('error',error=>reject(new ProviderError(error.code==='ENOMEM'?'memory-limit':'invalid-feed')));
      worker.once('exit',(_code,signal)=>reject(new ProviderError(signal==='SIGABRT'?'memory-limit':'invalid-feed')));
      worker.send(input,error=>{if(error)reject(new ProviderError('invalid-feed'));});
    });
  } finally {
    clearTimeout(timer);
    if(worker.exitCode===null && worker.signalCode===null) {
      const exited=new Promise(resolve=>worker.once('exit',resolve));
      worker.kill('SIGKILL');await exited;
    }
  }
}

// Parsing survives the screen request. Keep one worker active on the NAS and
// reuse a result until its feed, display days or presentation settings change.
export function createCalendarParser({parse=runCalendarWorker,now=()=>Date.now()}={}) {
  const entries=new Map(),latest=new Map(),queue=[];
  let active=false,pendingBytes=0;
  function evict(key) {
    entries.delete(key);
    const index=queue.findIndex(task=>task.key===key);
    if(index>=0) {const [task]=queue.splice(index,1);pendingBytes-=task.bytes;task.state.pending=null;task.resolve();}
  }
  function drain() {
    if(active || !queue.length) return;
    const task=queue.shift();
    active=true;
    Promise.resolve().then(()=>parse(task.input)).then(value=>{
      task.state.value=value;task.state.error=null;task.state.failures=0;
      if(task.feed) {
        latest.delete(task.feed);latest.set(task.feed,{value,scope:task.scope});
        while(latest.size>8) latest.delete(latest.keys().next().value);
      }
    },error=>{
      task.state.error=error instanceof ProviderError ? error : new ProviderError('invalid-feed');
      task.state.failures++;
      task.state.retryAt=parseLimits.includes(task.state.error.code) ? Infinity : now()+backoffMs(task.state.failures);
    }).finally(()=>{pendingBytes-=task.bytes;task.state.pending=null;active=false;task.resolve();drain();});
  }
  return {
    get(text,{days,timezone,name,color,now:displayNow,feed=null}) {
      const bytes=Buffer.byteLength(text);
      if(bytes>8_000_000) throw new ProviderError('projection-limit');
      const key=createHash('sha256').update(text).update(JSON.stringify([days,timezone,name,color])).digest('hex');
      let state=entries.get(key);
      if(!state) {
        while(entries.size>=8) evict(entries.keys().next().value);
        state={value:null,error:null,pending:null,retryAt:0,failures:0};
      }
      entries.delete(key);entries.set(key,state);
      if(!state.value && !state.pending && now()>=state.retryAt) {
        while(pendingBytes+bytes>32_000_000 && queue.length) evict(queue[0].key);
        let resolve;state.pending=new Promise(done=>{resolve=done;});
        pendingBytes+=bytes;queue.push({key,state,feed,scope:JSON.stringify([days,timezone]),input:{text,days,timezone,name,color,now:displayNow},resolve,bytes});drain();
      }
      return state;
    },
    // The newest successful result for a feed and the same days, served while a
    // changed feed or presentation setting is parsed again.
    latest(feed,{days,timezone}) {
      const found=latest.get(feed);
      return found?.scope===JSON.stringify([days,timezone]) ? found.value : null;
    },
  };
}
// Resolves with the parsed result or rejects with its fixed reason.
export async function parsed(parser,text,options) {
  const state=parser.get(text,options);
  await state.pending;
  // retryAt tells the download cache not to fetch the same text again before then.
  if(!state.value) throw Object.assign(state.error || new ProviderError('parse-busy'),{retryAt:state.retryAt});
  return state.value;
}
export const calendarParser=createCalendarParser();
