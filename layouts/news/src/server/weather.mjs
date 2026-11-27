import {cached,fetchText} from './fetch.mjs';

// Open-Meteo adapter, adapted from the morning layout. The background refresh
// fetches a two-day forecast and the cache keeps it; each render reads today's
// values from it, so a saved forecast stays correct after midnight.
const states={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'};

export const weatherKey=(city,units,timezone)=>JSON.stringify([city,units,timezone]);

async function locate(city) {
  return cached('city:'+city,3600,async()=>{
    const params=new URLSearchParams({name:city.split(',')[0].trim(),count:'10',language:'en',format:'json'});
    const result=JSON.parse(await fetchText('https://geocoding-api.open-meteo.com/v1/search?'+params,['geocoding-api.open-meteo.com'],1_000_000,{timeoutMs:10000}));
    const suffix=city.split(',')[1]?.trim();
    const region=(states[suffix?.toUpperCase()] || suffix)?.toLowerCase();
    const match=(result.results || []).find(item=>!region || [item.admin1,item.admin1_code,item.country,item.country_code].some(value=>value?.toLowerCase()===region));
    if (!match || !Number.isFinite(match.latitude) || !Number.isFinite(match.longitude)) throw new Error('Location unavailable');
    return {latitude:match.latitude,longitude:match.longitude};
  },{failSeconds:300});
}

// Keep only the fields we show, with bounded arrays of numbers and times.
const numbers=list=>Array.isArray(list) ? list.slice(0,48).map(value=>typeof value==='number' && Number.isFinite(value) ? value : null) : [];
const times=list=>Array.isArray(list) ? list.slice(0,48).map(value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value) ? value : null) : [];
export function pruneForecast(raw) {
  const current=raw?.current || {},daily=raw?.daily || {},hourly=raw?.hourly || {};
  const one=value=>typeof value==='number' && Number.isFinite(value) ? value : null;
  return {
    current:{time:times([current.time])[0] ?? null,temperature_2m:one(current.temperature_2m),weather_code:one(current.weather_code)},
    daily:{time:times(daily.time),weather_code:numbers(daily.weather_code),temperature_2m_max:numbers(daily.temperature_2m_max),temperature_2m_min:numbers(daily.temperature_2m_min),precipitation_probability_max:numbers(daily.precipitation_probability_max)},
    hourly:{time:times(hourly.time),temperature_2m:numbers(hourly.temperature_2m),weather_code:numbers(hourly.weather_code),precipitation_probability:numbers(hourly.precipitation_probability)},
  };
}

export async function fetchForecast({city,units,timezone}) {
  const location=await locate(city);
  const params=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),timezone,temperature_unit:units,forecast_days:'2',
    current:'temperature_2m,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',hourly:'temperature_2m,weather_code,precipitation_probability'});
  return pruneForecast(JSON.parse(await fetchText('https://api.open-meteo.com/v1/forecast?'+params,['api.open-meteo.com'],2_000_000,{timeoutMs:10000})));
}

export function conditions(code) {
  if (code==null) return 'Conditions unavailable';
  return code===0 ? 'Clear skies' : code<3 ? 'Partly cloudy' : code===3 ? 'Overcast' : code<50 ? 'Foggy' : code<70 ? 'Rain' : code<80 ? 'Snow' : code<95 ? 'Showers' : 'Thunderstorms';
}
export function localClock(date,timezone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const value=key=>parts.find(part=>part.type===key).value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}
// 12-hour clock in every unit, like morning; the two layouts can share one TV.
const hourLabel=time=>{
  const hour=Number(time.slice(11,13));
  return `${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`;
};
const round=value=>typeof value==='number' ? Math.round(value) : null;

// Today's view of a saved forecast: now, high/low and five points three hours apart.
// fetchedAt decides whether "current" is still current; otherwise use this hour's forecast.
export function weatherView(raw,{now,timezone,units='fahrenheit',fetchedAt=now.valueOf(),location=''}) {
  const clock=localClock(now,timezone),day=clock.slice(0,10);
  const daily=raw?.daily || {},hourly=raw?.hourly || {};
  const today=(daily.time || []).indexOf(day);
  const hours=hourly.time || [];
  const thisHour=hours.indexOf(clock.slice(0,13)+':00');
  const fresh=now.valueOf()-fetchedAt<=90*60000;
  let current=fresh ? round(raw?.current?.temperature_2m) : null,code=fresh ? raw?.current?.weather_code ?? null : null;
  if (current==null && thisHour>=0) {current=round(hourly.temperature_2m?.[thisHour]);code=hourly.weather_code?.[thisHour] ?? null;}
  if (today<0 && thisHour<0) return null;
  const first=hours.findIndex(time=>time && time>clock);
  const strip=[];
  for (let index=first;first>=0 && index<hours.length && strip.length<5;index+=3) {
    const temperature=round(hourly.temperature_2m?.[index]);
    if (temperature==null) continue;
    strip.push({time:hourLabel(hours[index]),temperature,label:conditions(hourly.weather_code?.[index] ?? null),rain:round(hourly.precipitation_probability?.[index])});
  }
  return {
    location,unit:units==='celsius' ? 'C' : 'F',
    current,label:conditions(code ?? (today>=0 ? daily.weather_code?.[today] : null) ?? null),
    high:today>=0 ? round(daily.temperature_2m_max?.[today]) : null,
    low:today>=0 ? round(daily.temperature_2m_min?.[today]) : null,
    rain:today>=0 ? round(daily.precipitation_probability_max?.[today]) : null,
    hours:strip,
  };
}
