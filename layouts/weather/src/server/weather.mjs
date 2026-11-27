import {ProviderError,cached,fetchText} from './fetch.mjs';

// Open-Meteo adapter, adapted from the news layout. The background refresh
// fetches an eight-day forecast and the cache keeps it. Each render reads today
// and the week from it, so a saved forecast stays correct after midnight.
const states={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'};
// Common names for country codes.
const countries={USA:'US',UK:'GB'};

export const hosts={geocoding:'geocoding-api.open-meteo.com',forecast:'api.open-meteo.com'};
// Open-Meteo's hourly data starts at midnight of the first day. Keep four days,
// so a forecast saved late in the evening still fills the strip a day later.
export const forecastDays=8,maxHours=96;
export const weatherKey=(city,units,timezone)=>JSON.stringify([city,units,timezone]);

async function locate(city) {
  return cached('city:'+city,3600,async()=>{
    const params=new URLSearchParams({name:city.split(',')[0].trim(),count:'10',language:'en',format:'json'});
    const result=JSON.parse(await fetchText(`https://${hosts.geocoding}/v1/search?`+params,[hosts.geocoding],1_000_000,{timeoutMs:10000}));
    const suffix=city.split(',')[1]?.trim();
    const code=suffix?.toUpperCase();
    // A 2-letter suffix can be a US state or a country code ("Toronto, CA").
    // Try the state or region name first, then the country code.
    const regions=suffix ? [states[code] || suffix,countries[code] || (code.length===2 ? code : null)].filter(Boolean).map(value=>value.toLowerCase()) : [null];
    const places=result.results || [];
    const fits=region=>item=>!region || [item.admin1,item.admin1_code,item.country,item.country_code].some(value=>value?.toLowerCase()===region);
    const match=regions.map(region=>places.find(fits(region))).find(Boolean);
    if (!match || !Number.isFinite(match.latitude) || !Number.isFinite(match.longitude)) throw new ProviderError('unknown-city');
    return {latitude:match.latitude,longitude:match.longitude};
  },{failSeconds:300});
}

// Keep only the fields we show, with bounded arrays of numbers and times.
const numbers=(list,max)=>Array.isArray(list) ? list.slice(0,max).map(value=>typeof value==='number' && Number.isFinite(value) ? value : null) : [];
const times=(list,max)=>Array.isArray(list) ? list.slice(0,max).map(value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value) ? value : null) : [];
export function pruneForecast(raw) {
  const current=raw?.current || {},daily=raw?.daily || {},hourly=raw?.hourly || {};
  const one=value=>typeof value==='number' && Number.isFinite(value) ? value : null;
  const days=forecastDays,hours=maxHours;
  return {
    current:{time:times([current.time],1)[0] ?? null,temperature_2m:one(current.temperature_2m),apparent_temperature:one(current.apparent_temperature),weather_code:one(current.weather_code),is_day:one(current.is_day)},
    daily:{time:times(daily.time,days),weather_code:numbers(daily.weather_code,days),temperature_2m_max:numbers(daily.temperature_2m_max,days),temperature_2m_min:numbers(daily.temperature_2m_min,days),
      precipitation_probability_max:numbers(daily.precipitation_probability_max,days),sunrise:times(daily.sunrise,days),sunset:times(daily.sunset,days)},
    hourly:{time:times(hourly.time,hours),temperature_2m:numbers(hourly.temperature_2m,hours),apparent_temperature:numbers(hourly.apparent_temperature,hours),weather_code:numbers(hourly.weather_code,hours),
      precipitation_probability:numbers(hourly.precipitation_probability,hours),is_day:numbers(hourly.is_day,hours)},
  };
}

export function forecastUrl({latitude,longitude},{units,timezone}) {
  const params=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),timezone,temperature_unit:units,forecast_days:String(forecastDays),
    current:'temperature_2m,apparent_temperature,weather_code,is_day',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly:'temperature_2m,apparent_temperature,weather_code,precipitation_probability,is_day'});
  return `https://${hosts.forecast}/v1/forecast?`+params;
}

export async function fetchForecast({city,units,timezone}) {
  const location=await locate(city);
  return pruneForecast(JSON.parse(await fetchText(forecastUrl(location,{units,timezone}),[hosts.forecast],2_000_000,{timeoutMs:10000})));
}

// WMO weather codes as words and an icon name. Finer than morning and news,
// because here the weather is the whole screen.
export function conditions(code,{day=true}={}) {
  const sky=(clear,night)=>day ? clear : night;
  if (code==null) return {label:'Conditions unavailable',icon:'cloud'};
  if (code===0) return {label:sky('Sunny','Clear'),icon:sky('sun','moon')};
  if (code===1) return {label:'Mostly clear',icon:sky('sun','moon')};
  if (code===2) return {label:'Partly cloudy',icon:sky('partly','partly-night')};
  if (code===3) return {label:'Cloudy',icon:'cloud'};
  if (code===45 || code===48) return {label:'Fog',icon:'fog'};
  if (code>=51 && code<=55) return {label:'Drizzle',icon:'drizzle'};
  if (code===56 || code===57) return {label:'Freezing drizzle',icon:'sleet'};
  if (code===61) return {label:'Light rain',icon:'rain'};
  if (code===63) return {label:'Rain',icon:'rain'};
  if (code===65) return {label:'Heavy rain',icon:'rain'};
  if (code===66 || code===67) return {label:'Freezing rain',icon:'sleet'};
  if (code===71) return {label:'Light snow',icon:'snow'};
  if (code===73 || code===77) return {label:'Snow',icon:'snow'};
  if (code===75) return {label:'Heavy snow',icon:'snow'};
  if (code===80) return {label:'Showers',icon:'drizzle'};
  if (code===81 || code===82) return {label:'Heavy showers',icon:'rain'};
  if (code===85 || code===86) return {label:'Snow showers',icon:'snow'};
  if (code===95) return {label:'Thunderstorms',icon:'storm'};
  if (code===96 || code===99) return {label:'Storms with hail',icon:'storm'};
  return {label:'Cloudy',icon:'cloud'};
}

export function localClock(date,timezone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const value=key=>parts.find(part=>part.type===key).value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}
// 12-hour clock in every unit, like morning and news; the layouts can share one TV.
export const hourLabel=time=>{
  const hour=Number(time.slice(11,13));
  return `${hour%12 || 12} ${hour<12 ? 'AM' : 'PM'}`;
};
export const clockLabel=time=>{
  if (typeof time!=='string' || time.length<16) return '';
  const hour=Number(time.slice(11,13));
  return `${hour%12 || 12}:${time.slice(14,16)} ${hour<12 ? 'AM' : 'PM'}`;
};
const round=value=>typeof value==='number' ? Math.round(value) : null;
const weekday=(day,style)=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:style,timeZone:'UTC'});

// Points on the hourly strip, two hours apart. Eight points cover the rest of a
// morning; later in the day the strip runs on into tomorrow.
export const stripPoints=8,stripStep=2;

// The view of a saved forecast for one render: now, today, the strip and the week.
// fetchedAt decides whether "current" is still current; otherwise use this hour's forecast.
export function weatherView(raw,{now,timezone,units='fahrenheit',fetchedAt=now.valueOf()}) {
  const clock=localClock(now,timezone),day=clock.slice(0,10);
  const daily=raw?.daily || {},hourly=raw?.hourly || {};
  const today=(daily.time || []).indexOf(day);
  const hours=hourly.time || [];
  const thisHour=hours.indexOf(clock.slice(0,13)+':00');
  if (today<0) return null;
  const fresh=now.valueOf()-fetchedAt<=90*60000;
  const current=raw?.current || {};
  let temperature=null,feels=null,code=null,isDay=null;
  if (fresh) {temperature=round(current.temperature_2m);feels=round(current.apparent_temperature);code=current.weather_code ?? null;isDay=current.is_day ?? null;}
  if (temperature==null && thisHour>=0) {
    temperature=round(hourly.temperature_2m?.[thisHour]);feels=round(hourly.apparent_temperature?.[thisHour]);
    code=hourly.weather_code?.[thisHour] ?? null;isDay=hourly.is_day?.[thisHour] ?? null;
  }
  const sunrise=daily.sunrise?.[today] ?? null,sunset=daily.sunset?.[today] ?? null;
  if (isDay==null && sunrise && sunset) isDay=clock>=sunrise && clock<sunset ? 1 : 0;
  const sky=conditions(code ?? daily.weather_code?.[today] ?? null,{day:isDay!==0});

  const strip=[];
  const first=hours.findIndex(time=>time && time>clock);
  for (let index=first;first>=0 && index<hours.length && strip.length<stripPoints;index+=stripStep) {
    const temp=round(hourly.temperature_2m?.[index]);
    if (temp==null || !hours[index]) continue;
    const {label,icon}=conditions(hourly.weather_code?.[index] ?? null,{day:hourly.is_day?.[index]!==0});
    const later=hours[index].slice(0,10)!==day;
    strip.push({time:hourLabel(hours[index]),temperature:temp,label,icon,rain:round(hourly.precipitation_probability?.[index]),
      day:later && (!strip.length || !strip.at(-1).later) ? weekday(hours[index].slice(0,10),'short') : '',later});
  }

  const week=[];
  for (let index=today;index<(daily.time || []).length && week.length<7;index++) {
    const high=round(daily.temperature_2m_max?.[index]),low=round(daily.temperature_2m_min?.[index]);
    if (high==null || low==null || !daily.time[index]) continue;
    const {label,icon}=conditions(daily.weather_code?.[index] ?? null);
    week.push({date:daily.time[index],name:index===today ? 'Today' : weekday(daily.time[index],'short'),label,icon,high,low,rain:round(daily.precipitation_probability_max?.[index])});
  }

  return {
    unit:units==='celsius' ? 'C' : 'F',units,
    current:temperature,feels,label:sky.label,icon:sky.icon,
    high:round(daily.temperature_2m_max?.[today]),low:round(daily.temperature_2m_min?.[today]),
    rain:round(daily.precipitation_probability_max?.[today]),
    // Open-Meteo gives one chance for any precipitation; name the likely kind.
    rainLabel:conditions(daily.weather_code?.[today] ?? null).icon==='snow' ? 'Snow' : 'Rain',
    sunrise:clockLabel(sunrise),sunset:clockLabel(sunset),
    hours:strip,week,
  };
}
