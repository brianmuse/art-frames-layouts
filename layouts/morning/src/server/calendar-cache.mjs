import {createHash} from 'node:crypto';
import {fetchText,ProviderError,backoffMs} from './fetch.mjs';
import {CalendarProjector} from '../../server/ical-projection.mjs';
import path from 'node:path';
import {createCalendarStorage} from './calendar-storage.mjs';

export const cacheKey=url=>createHash('sha256').update(url).digest('hex');
// Retrying cannot fix these before the feed, its link or the schedule changes.
const holdCodes=['too-large','projection-limit','event-limit','recurrence-limit','access-denied','not-found','invalid-address','unsupported-address'];

async function download(url,{timeoutMs}) {
  const text=await fetchText(url,['calendar.google.com','www.google.com'],32_000_000,{timeoutMs,transform:new CalendarProjector()});
  if(!/^BEGIN:VCALENDAR\s*$/im.test(text.replace(/^\uFEFF/,''))) throw new ProviderError('invalid-feed');
  return text;
}

export function createCalendarCache({fetcher=download,now=()=>Date.now(),storage=null}={}) {
  const entries=new Map(),queue=[];
  let active=0;
  // A held failure waits for the next scheduled sync; others back off 1, 2, 4… minutes.
  const due=(state,refreshKey)=>state.error ? (state.hold && refreshKey!==null ? state.refreshKey!==refreshKey : now()>=state.nextAttemptAt) : !state.text || (refreshKey!==null ? state.refreshKey!==refreshKey : now()>=state.nextAttemptAt);
  function evict(key) {
    entries.delete(key);
    const index=queue.findIndex(task=>task.key===key);
    if(index>=0) {const [task]=queue.splice(index,1);task.state.pending=null;task.resolve();}
  }
  function trimBytes(current) {
    let total=[...entries.values()].reduce((sum,state)=>sum+(state.bytes || 0),0);
    for(const [key,state] of entries) {
      if(total<=32_000_000) break;
      if(key!==current) {total-=state.bytes || 0;evict(key);}
    }
  }
  const record=state=>({text:state.text,updatedAt:state.updatedAt,refreshKey:state.refreshKey,...state.error && {failure:{code:state.error.code,status:state.error.status ?? null,failures:state.failures,retryAt:state.nextAttemptAt,hold:state.hold}}});
  function drain() {
    while(active<4 && queue.length) {
      const task=queue.shift(),{state,key}=task;
      if(entries.get(key)!==state) {state.pending=null;task.resolve();continue;}
      active++;
      Promise.resolve().then(async()=>{
        if(!state.loaded) {
          state.loaded=true;
          const saved=await storage?.load(key);
          if(saved) {
            state.text=saved.text;state.bytes=saved.text ? Buffer.byteLength(saved.text) : 0;state.updatedAt=saved.updatedAt;state.refreshKey=saved.refreshKey;state.nextAttemptAt=saved.updatedAt===null ? 0 : saved.updatedAt+state.refreshMs;
            if(saved.failure) {
              const {code,status,failures,retryAt,hold}=saved.failure;
              state.error=new ProviderError(code,{status});state.failures=failures;state.nextAttemptAt=retryAt;state.hold=hold;
            }
            trimBytes(key);
          }
        }
        if(!due(state,task.refreshKey)) return;
        state.refreshKey=task.refreshKey;
        try {
          const text=await fetcher(task.url,{timeoutMs:task.timeoutMs});
          // Promote a new export only once it parses; otherwise keep serving the last good one.
          if(text!==state.text) await task.validate?.(text);
          state.text=text;state.bytes=Buffer.byteLength(text);trimBytes(key);state.error=null;state.failures=0;state.hold=false;state.updatedAt=now();state.nextAttemptAt=now()+state.refreshMs;
        } catch(error) {
          state.error=error instanceof ProviderError ? error : new ProviderError();
          state.failures=(state.failures || 0)+1;state.hold=holdCodes.includes(state.error.code);
          state.nextAttemptAt=now()+(state.hold ? state.refreshMs : Math.max(Math.min(state.refreshMs,backoffMs(state.failures)),(state.error.retryAt || 0)-now()));
        }
        await storage?.save(key,record(state));
      }).catch(()=>{}).finally(()=>{state.pending=null;active--;task.resolve();drain();});
    }
  }
  return {
    get(url,{refreshMs=86400000,timeoutMs=90000,refreshKey=null,validate=null}={}) {
      const key=cacheKey(url);
      let state=entries.get(key);
      if(!state) {
        while(entries.size>=8) {
          evict(entries.keys().next().value);
        }
        state={text:null,error:null,updatedAt:null,nextAttemptAt:0,pending:null,refreshKey:null,refreshMs,failures:0,hold:false,loaded:!storage};
      }
      if(state.refreshMs!==refreshMs) {
        state.refreshMs=refreshMs;
        if(!state.error && state.updatedAt!==null) state.nextAttemptAt=state.updatedAt+refreshMs;
      }
      entries.delete(key);entries.set(key,state);
      if(!state.pending && (!state.loaded || due(state,refreshKey))) {
        let resolve;
        state.pending=new Promise(done=>{resolve=done;});
        queue.push({key,state,url,resolve,refreshMs,timeoutMs,refreshKey,validate});
        drain();
      }
      return state;
    },
    async prune(urls) {await storage?.prune(urls.map(cacheKey));},
  };
}
export const calendarCache=createCalendarCache({storage:process.env.DAYFRAME_SITE_STATE ? createCalendarStorage(path.join(process.env.DAYFRAME_SITE_STATE,'calendars')) : null});
