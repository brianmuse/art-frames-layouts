import { cached, fetchText } from './fetch.mjs';
import { createStateFile } from './state-file.mjs';

// The last good forecast per location/units/timezone, kept in memory and on disk.
// An outage shows it for up to six hours, marked stale; failures are cached five minutes.
const staleMs=6*3600000,failSeconds=300;
export function createWeatherMemory(file) {
  let entries=null;
  const load=async()=>{
    if(entries) return entries;
    const saved=await file.load();
    entries ??= new Map(Array.isArray(saved?.entries) ? saved.entries.filter(item=>Array.isArray(item) && typeof item[0]==='string' && item[1] && typeof item[1].day==='string' && Number.isSafeInteger(item[1].at) && item[1].raw && typeof item[1].raw==='object').slice(-4) : []);
    return entries;
  };
  return {
    async get(key) {return (await load()).get(key) || null;},
    async set(key,value) {
      const map=await load();map.delete(key);map.set(key,value);
      while(map.size>4) map.delete(map.keys().next().value);
      await file.save({version:1,entries:[...map]});
    },
  };
}
export const weatherMemory=createWeatherMemory(createStateFile(process.env.DAYFRAME_SITE_STATE,'weather.json',{maxBytes:2_000_000}));

export function weatherData(raw, day, clock, location, units) {
  const current=raw.current || {}, daily=raw.daily || {}, hourly=raw.hourly || {};
  const first=key => daily[key]?.[0];
  const number=value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  const code=current.weather_code ?? first('weather_code');
  const label=code == null ? 'Conditions unavailable' : code===0 ? 'Clear skies' : code<3 ? 'Partly cloudy' : code===3 ? 'Overcast' : code<50 ? 'Foggy' : code<70 ? 'Rain' : code<80 ? 'Snow' : code<95 ? 'Showers' : 'Thunderstorms';
  const windows=[]; const future=[]; let active;
  for (let index=0; index<(hourly.time || []).length; index++) {
    const end=hourly.time[index];
    const start=new Date(Date.parse(end+'Z')-3600000).toISOString().slice(0,16);
    const chance=number(hourly.precipitation_probability?.[index]);
    if (end.slice(0,10)===day && end.slice(11,13)>=clock.slice(0,2) && chance!=null) future.push({time:end.slice(11,16),chance});
    if (start.slice(0,10)===day && end > `${day}T${clock}` && (hourly.rain?.[index] || 0)+(hourly.showers?.[index] || 0)>=.1) {
      if (active?.end===start) active.end=end;
      else { active={start,end}; windows.push(active); }
    } else active=undefined;
  }
  const peak=future.sort((a,b)=>b.chance-a.chance)[0];
  return {
    current:number(current.temperature_2m), high:number(first('temperature_2m_max')), low:number(first('temperature_2m_min')),
    label, location, humidity:number(current.relative_humidity_2m), sunset:first('sunset')?.slice(11,16) || null,
    rain_probability:number(first('precipitation_probability_max')),
    rain_peak_time:peak?.chance>0 ? peak.time : null,
    rain_windows:windows.map(window=>({start:window.start.slice(11),end:window.end.slice(11),ongoing:window.start<=`${day}T${clock}`})),
    unit:units==='celsius' ? 'C' : 'F',
  };
}

export async function weather(settings, day, clock, timezone, {memory=weatherMemory}={}) {
  if (!settings.city) return null;
  const units=settings.units || 'fahrenheit';
  const key=JSON.stringify([settings.city,units,timezone]);
  let raw;
  try {
    const location=await cached('city:'+settings.city,3600, async()=>{
      const params=new URLSearchParams({name:settings.city.split(',')[0].trim(),count:'10',language:'en',format:'json'});
      const result=JSON.parse(await fetchText('https://geocoding-api.open-meteo.com/v1/search?'+params,['geocoding-api.open-meteo.com']));
      const states={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'};
      const suffix=settings.city.split(',')[1]?.trim();
      const region=(states[suffix?.toUpperCase()] || suffix)?.toLowerCase();
      const match=(result.results || []).find(item => !region || [item.admin1,item.admin1_code,item.country,item.country_code].some(value=>value?.toLowerCase()===region));
      if (!match) throw new Error('Location unavailable');
      return match;
    },{failSeconds});
    const next=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
    const params=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),timezone,temperature_unit:units,daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset',current:'temperature_2m,relative_humidity_2m,weather_code',hourly:'precipitation_probability,rain,showers',start_date:day,end_date:next});
    raw=await cached('weather:'+params,600,async()=>JSON.parse(await fetchText('https://api.open-meteo.com/v1/forecast?'+params,['api.open-meteo.com'])),{failSeconds});
  } catch(error) {
    // Daily values are indexed by date, so only reuse a forecast for the same day.
    const saved=await memory.get(key).catch(()=>null);
    if (!saved || saved.day!==day || Date.now()-saved.at>staleMs) throw error;
    return {...weatherData(saved.raw,day,clock,settings.city,units),stale:true,updated_at:new Date(saved.at).toISOString()};
  }
  const saved=await memory.get(key).catch(()=>null);
  if (saved?.raw!==raw) await memory.set(key,{day,at:Date.now(),raw}).catch(()=>{});
  return weatherData(raw,day,clock,settings.city,units);
}
