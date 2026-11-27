// Development sample data, shaped like the saved cache. Production never uses it.
import fixture from '../fixtures/sample-news.json' with {type:'json'};
import {createNewsCache} from './cache.mjs';
import {newsFeeds} from './topics.mjs';
import {localClock,weatherKey} from './weather.mjs';

export const sampleConfig={city:'Boston, MA',units:'fahrenheit',headline_count:'7',topics:[{id:'top',topic:'Top stories',query:''},{id:'tech',topic:'Technology',query:''},{id:'science',topic:'Science',query:''}]};

const nextDay=day=>new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
// A plausible two-day forecast in local time: cool morning, mild afternoon, evening rain.
export function sampleForecast(now,timezone) {
  const clock=localClock(now,timezone),today=clock.slice(0,10),tomorrow=nextDay(today);
  const time=[],temperature=[],code=[],rain=[];
  for (const day of [today,tomorrow]) for (let hour=0;hour<24;hour++) {
    time.push(`${day}T${String(hour).padStart(2,'0')}:00`);
    temperature.push(Math.round((52+10*Math.sin((hour-9)*Math.PI/12))*10)/10);
    code.push(hour<10 ? 1 : hour<16 ? 2 : hour<20 ? 3 : 61);
    rain.push(hour<16 ? 5 : hour<20 ? 30 : 65);
  }
  const index=Number(clock.slice(11,13));
  return {
    current:{time:clock,temperature_2m:temperature[index],weather_code:code[index]},
    daily:{time:[today,tomorrow],weather_code:[2,61],temperature_2m_max:[62,58],temperature_2m_min:[42,45],precipitation_probability_max:[65,70]},
    hourly:{time,temperature_2m:temperature,weather_code:code,precipitation_probability:rain},
  };
}

// The cache file contents for the sample config. `stale` ages the data and marks one failed refresh.
export function sampleCacheState(now,timezone,{stale=false,config=sampleConfig}={}) {
  const age=stale ? 3*3600000 : 0,at=now.valueOf()-(stale ? age : 6*60000);
  const feeds={};
  newsFeeds(config).forEach((feed,index)=>{
    const sample=fixture.feeds.find(item=>item.label===feed.label) || fixture.feeds[index % fixture.feeds.length];
    const value=sample.items.map(item=>({title:item.title,source:item.source,published_at:new Date(now.valueOf()-age-item.minutes_ago*60000).toISOString()}));
    const failed=stale && index===1;
    feeds[feed.url]={at,value,failed_at:failed ? now.valueOf()-60000 : null,failures:failed ? 1 : 0,error:failed ? 'timeout' : null};
  });
  const weather={};
  if (config.city) weather[weatherKey(config.city,config.units || 'fahrenheit',timezone)]={at,value:sampleForecast(now,timezone),failed_at:null,failures:0,error:null};
  return {version:1,feeds,weather};
}

// An in-memory cache over the sample. Its providers never answer, so nothing is fetched.
export function sampleCache(now,timezone,options) {
  const state=sampleCacheState(now,timezone,options);
  const never=()=>new Promise(()=>{});
  return createNewsCache({file:{load:async()=>state,save:async()=>{}},loadFeed:never,loadWeather:never,clock:()=>now.valueOf()});
}
