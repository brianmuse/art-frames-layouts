import {createStateFile} from './state-file.mjs';
import {ProviderError,backoffMs} from './fetch.mjs';
import {fetchForecast,weatherKey} from './weather.mjs';
import {readConfig,weatherSettings,hostTimezone} from './settings.mjs';

// The forecast lives in /site-state/weather-cache.json. A background loop
// refreshes it; renders read the saved copy and never wait for a refresh,
// except on the very first load (then a render returns 202).
// Adapted from the news layout's cache, with only the weather group.
export const refreshMs=20*60000;
const maxEntries=2;

export function weatherRequest(settings,timezone) {
  return settings.city && timezone ? {key:weatherKey(settings.city,settings.units,timezone),city:settings.city,units:settings.units,timezone} : null;
}

const validEntry=entry=>entry && typeof entry==='object' && (entry.at===null || Number.isSafeInteger(entry.at))
  && (entry.failed_at===null || Number.isSafeInteger(entry.failed_at)) && Number.isSafeInteger(entry.failures) && (entry.error===null || typeof entry.error==='string')
  && (entry.value===null || typeof entry.value==='object' && !Array.isArray(entry.value));
function restore(saved) {
  const group=saved?.weather && typeof saved.weather==='object' && !Array.isArray(saved.weather) ? saved.weather : {};
  return {version:1,weather:Object.fromEntries(Object.entries(group).filter(([,entry])=>validEntry(entry)).slice(-maxEntries))};
}

export function createWeatherCache({file,loadWeather=fetchForecast,clock=()=>Date.now(),refreshMs:interval=refreshMs}={}) {
  let state=null,loading=null;
  const running=new Map();
  const load=()=>loading ||= Promise.resolve(file?.load()).catch(()=>null).then(saved=>{state=restore(saved);});
  const due=entry=>{
    if (!entry) return true;
    const now=clock();
    if (entry.failed_at!==null && (entry.at===null || entry.failed_at>entry.at)) return now-entry.failed_at>=Math.min(interval,backoffMs(entry.failures));
    return entry.at===null || now-entry.at>=interval;
  };
  const store=(key,entry)=>{
    const map=state.weather;
    delete map[key];map[key]=entry;
    const keys=Object.keys(map);
    for (const old of keys.slice(0,Math.max(0,keys.length-maxEntries))) delete map[old];
  };
  const run=request=>{
    const {key}=request;
    if (running.has(key)) return running.get(key);
    const promise=(async()=>{
      try {
        const value=await loadWeather(request);
        store(key,{at:clock(),value,failed_at:null,failures:0,error:null});
      } catch (error) {
        const prior=state.weather[key];
        store(key,{at:prior?.at ?? null,value:prior?.value ?? null,failed_at:clock(),failures:(prior?.failures || 0)+1,error:error instanceof ProviderError ? error.code : 'unavailable'});
      }
      await file?.save(state);
    })().finally(()=>running.delete(key));
    running.set(key,promise);
    return promise;
  };
  // Starts a due load synchronously, so a render can see it as running.
  const start=request=>request && due(state.weather[request.key]) ? run(request) : Promise.resolve();
  // Start the refresh if it is due. Resolves when it finishes.
  async function refresh(request,{prune=false}={}) {
    await load();
    // Before the first render the host timezone is unknown, so keep the forecast.
    if (prune && request) for (const key of Object.keys(state.weather)) if (key!==request.key) delete state.weather[key];
    await start(request);
  }
  // The saved forecast for one render. Only a first load (no saved value yet) waits, up to waitMs.
  async function read(request,{waitMs=3000}={}) {
    await load();
    if (!request) return {weather:null,preparing:false};
    void start(request);
    const pending=running.get(request.key);
    if (!state.weather[request.key]?.value && pending && waitMs>0) {
      let timer;
      await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);
      clearTimeout(timer);
    }
    const entry=state.weather[request.key];
    const failed=entry && entry.failed_at!==null && (entry.at===null || entry.failed_at>entry.at);
    const weather={value:entry?.value ?? null,at:entry?.at ?? null,error:failed ? entry.error : null,loading:running.has(request.key)};
    return {weather,preparing:weather.value===null && weather.error===null && weather.loading};
  }
  return {refresh,read,async snapshot() {await load();return structuredClone(state);}};
}

export const weatherCache=createWeatherCache({file:createStateFile(process.env.DAYFRAME_SITE_STATE,'weather-cache.json',{maxBytes:1_000_000})});

// Checks every minute; the forecast refreshes about every 20 minutes, sooner after a failure.
export function startWeatherRefresh({cache=weatherCache,loadConfig=readConfig,host=hostTimezone,intervalMs=60000}={}) {
  let stopped=false,timer;
  async function tick() {
    try {await cache.refresh(weatherRequest(weatherSettings(await loadConfig()),await host.get()),{prune:true});}
    catch {console.warn('Weather background refresh could not complete');}
    if (!stopped) {timer=setTimeout(tick,intervalMs);timer.unref();}
  }
  void tick();
  return ()=>{stopped=true;clearTimeout(timer);};
}
