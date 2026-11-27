// Development sample data, shaped like the saved cache. Production never uses it.
import fixture from '../fixtures/sample-forecast.json' with {type:'json'};
import {createWeatherCache} from './cache.mjs';
import {localClock,pruneForecast,weatherKey} from './weather.mjs';

export const sampleConfig={city:'Boston, MA',units:'fahrenheit'};

const shiftDay=(day,days)=>new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const toCelsius=value=>typeof value==='number' ? Math.round((value-32)*5/9*10)/10 : value;

// The made-up Boston forecast, moved so that its first day is the local today.
// The current reading follows this hour's forecast.
export function sampleForecast(now,timezone,{units='fahrenheit'}={}) {
  const clock=localClock(now,timezone),today=clock.slice(0,10);
  const offset=Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(fixture.daily.time[0]+'T12:00:00Z'))/86400000);
  const move=time=>typeof time==='string' ? shiftDay(time.slice(0,10),offset)+time.slice(10) : time;
  const raw=structuredClone(fixture);
  for (const group of [raw.daily,raw.hourly]) for (const key of ['time','sunrise','sunset']) if (group[key]) group[key]=group[key].map(move);
  const hour=raw.hourly.time.indexOf(clock.slice(0,13)+':00');
  // The fixture's own reading is for its hour (8 AM); other hours use the hourly forecast.
  if (hour>=0 && clock.slice(11,13)!==fixture.current.time.slice(11,13)) {
    raw.current={time:clock,temperature_2m:raw.hourly.temperature_2m[hour],apparent_temperature:raw.hourly.apparent_temperature[hour],weather_code:raw.hourly.weather_code[hour],is_day:raw.hourly.is_day[hour]};
  } else raw.current.time=clock;
  if (units==='celsius') {
    for (const key of ['temperature_2m','apparent_temperature']) {raw.current[key]=toCelsius(raw.current[key]);raw.hourly[key]=raw.hourly[key].map(toCelsius);}
    for (const key of ['temperature_2m_max','temperature_2m_min']) raw.daily[key]=raw.daily[key].map(toCelsius);
  }
  return pruneForecast(raw);
}

// The cache file contents for the sample config. `stale` ages the forecast and
// marks one failed refresh. `failed` has no forecast and a failed first load.
export function sampleCacheState(now,timezone,{stale=false,failed=false,config=sampleConfig}={}) {
  const at=now.valueOf()-(stale ? 3*3600000 : 6*60000);
  const units=config.units==='celsius' ? 'celsius' : 'fahrenheit';
  const weather={};
  if (config.city && failed) weather[weatherKey(config.city,units,timezone)]={at:null,value:null,failed_at:now.valueOf()-60000,failures:1,error:'network'};
  else if (config.city) weather[weatherKey(config.city,units,timezone)]={at,value:sampleForecast(now,timezone,{units}),failed_at:stale ? now.valueOf()-60000 : null,failures:stale ? 1 : 0,error:stale ? 'timeout' : null};
  return {version:1,weather};
}

// An in-memory cache over the sample. Its provider never answers, so nothing is fetched.
export function sampleCache(now,timezone,options) {
  const state=sampleCacheState(now,timezone,options);
  return createWeatherCache({file:{load:async()=>state,save:async()=>{}},loadWeather:()=>new Promise(()=>{}),clock:()=>now.valueOf()});
}
