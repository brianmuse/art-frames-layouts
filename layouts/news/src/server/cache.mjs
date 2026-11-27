import {createStateFile} from './state-file.mjs';
import {ProviderError,backoffMs,fetchText} from './fetch.mjs';
import {parseFeed} from './rss.mjs';
import {fetchForecast,weatherKey} from './weather.mjs';
import {host} from './topics.mjs';
import {readConfig,newsSettings,hostTimezone} from './settings.mjs';

// Feeds and the forecast live in /site-state/news-cache.json. A background loop
// refreshes them; renders read the saved copy and never wait for a refresh,
// except on the very first load of a feed (then a render returns 202).
export const refreshMs=20*60000;
const limits={feeds:12,weather:2};

export async function fetchFeed(url) {
  return parseFeed(await fetchText(url,[host],2_000_000,{timeoutMs:15000,redirects:2}));
}

export function newsRequest(settings,timezone) {
  return {
    feeds:settings.feeds,
    weather:settings.city && timezone ? {key:weatherKey(settings.city,settings.units,timezone),city:settings.city,units:settings.units,timezone} : null,
  };
}

const isEntry=entry=>entry && typeof entry==='object' && (entry.at===null || Number.isSafeInteger(entry.at))
  && (entry.failed_at===null || Number.isSafeInteger(entry.failed_at)) && Number.isSafeInteger(entry.failures) && (entry.error===null || typeof entry.error==='string');
const validFeed=entry=>isEntry(entry) && (entry.value===null || Array.isArray(entry.value) && entry.value.every(item=>item && typeof item.title==='string' && typeof item.source==='string'));
const validWeather=entry=>isEntry(entry) && (entry.value===null || typeof entry.value==='object' && !Array.isArray(entry.value));
function restore(saved) {
  const pick=(group,valid,max)=>Object.fromEntries(Object.entries(saved?.[group] && typeof saved[group]==='object' ? saved[group] : {}).filter(([,entry])=>valid(entry)).slice(-max));
  return {version:1,feeds:pick('feeds',validFeed,limits.feeds),weather:pick('weather',validWeather,limits.weather)};
}

// At most `concurrency` tasks at once. A finished task hands its slot straight
// to the next waiter, so a task that arrives in between cannot take it too.
export function createLimiter(concurrency) {
  let active=0;
  const queue=[];
  return async task=>{
    if (active>=concurrency) await new Promise(resolve=>queue.push(resolve));
    else active++;
    try {return await task();} finally {const next=queue.shift();if (next) next(); else active--;}
  };
}

export function createNewsCache({file,loadFeed=fetchFeed,loadWeather=fetchForecast,clock=()=>Date.now(),refreshMs:interval=refreshMs,concurrency=3}={}) {
  let state=null,loading=null;
  const running=new Map(),limited=createLimiter(concurrency);
  const load=()=>loading ||= Promise.resolve(file?.load()).catch(()=>null).then(saved=>{state=restore(saved);});
  const due=entry=>{
    if (!entry) return true;
    const now=clock();
    if (entry.failed_at!==null && (entry.at===null || entry.failed_at>entry.at)) return now-entry.failed_at>=Math.min(interval,backoffMs(entry.failures));
    return entry.at===null || now-entry.at>=interval;
  };
  const store=(group,key,entry)=>{
    const map=state[group];
    delete map[key];map[key]=entry;
    const keys=Object.keys(map);
    for (const old of keys.slice(0,Math.max(0,keys.length-limits[group]))) delete map[old];
  };
  const run=(group,key,task)=>{
    const id=group+'\n'+key;
    if (running.has(id)) return running.get(id);
    const promise=(async()=>{
      try {
        const value=await limited(task);
        store(group,key,{at:clock(),value,failed_at:null,failures:0,error:null});
      } catch (error) {
        const prior=state[group][key];
        store(group,key,{at:prior?.at ?? null,value:prior?.value ?? null,failed_at:clock(),failures:(prior?.failures || 0)+1,error:error instanceof ProviderError ? error.code : 'unavailable'});
      }
      await file?.save(state);
    })().finally(()=>running.delete(id));
    running.set(id,promise);
    return promise;
  };
  // Start every refresh that is due. Resolves when they finish.
  async function refresh(request,{prune=false}={}) {
    await load();
    if (prune) {
      const feeds=new Set(request.feeds.map(feed=>feed.url));
      for (const key of Object.keys(state.feeds)) if (!feeds.has(key)) delete state.feeds[key];
      // Before the first render the host timezone is unknown, so keep the forecast.
      if (request.weather) for (const key of Object.keys(state.weather)) if (key!==request.weather.key) delete state.weather[key];
    }
    await start(request);
  }
  // Starts due loads synchronously, so a render can see them as running.
  function start(request) {
    const tasks=[];
    for (const feed of request.feeds) if (due(state.feeds[feed.url])) tasks.push(run('feeds',feed.url,()=>loadFeed(feed.url)));
    const weather=request.weather;
    if (weather && due(state.weather[weather.key])) tasks.push(run('weather',weather.key,()=>loadWeather(weather)));
    return Promise.all(tasks);
  }
  const view=(group,key)=>{
    const entry=state[group][key];
    return {value:entry?.value ?? null,at:entry?.at ?? null,error:entry && entry.failed_at!==null && (entry.at===null || entry.failed_at>entry.at) ? entry.error : null,loading:running.has(group+'\n'+key)};
  };
  // The saved data for one render. Only a first load (no saved value yet) waits, up to waitMs.
  async function read(request,{waitMs=3000}={}) {
    await load();
    void start(request);
    const first=[...request.feeds.map(feed=>['feeds',feed.url]),...(request.weather ? [['weather',request.weather.key]] : [])]
      .filter(([group,key])=>!state[group][key]?.value && running.has(group+'\n'+key)).map(([group,key])=>running.get(group+'\n'+key));
    if (first.length && waitMs>0) {
      let timer;
      await Promise.race([Promise.all(first),new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);
      clearTimeout(timer);
    }
    const feeds=request.feeds.map(feed=>({...feed,...view('feeds',feed.url)}));
    const weather=request.weather ? view('weather',request.weather.key) : null;
    const preparing=[...feeds,...(weather ? [weather] : [])].some(item=>item.value===null && item.error===null && item.loading);
    return {feeds,weather,preparing};
  }
  return {refresh,read,async snapshot() {await load();return structuredClone(state);}};
}

export const newsCache=createNewsCache({file:createStateFile(process.env.DAYFRAME_SITE_STATE,'news-cache.json',{maxBytes:2_000_000})});

// Checks every minute; each feed refreshes about every 20 minutes, sooner after a failure.
export function startNewsRefresh({cache=newsCache,loadConfig=readConfig,host=hostTimezone,intervalMs=60000}={}) {
  let stopped=false,timer;
  async function tick() {
    try {await cache.refresh(newsRequest(newsSettings(await loadConfig()),await host.get()),{prune:true});}
    catch {console.warn('News background refresh could not complete');}
    if (!stopped) {timer=setTimeout(tick,intervalMs);timer.unref();}
  }
  void tick();
  return ()=>{stopped=true;clearTimeout(timer);};
}
