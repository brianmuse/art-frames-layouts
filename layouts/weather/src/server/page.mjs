import {weatherCache,weatherRequest} from './cache.mjs';
import {weatherSettings,displaySettings,timezoneOr,hostTimezone} from './settings.mjs';
import {weatherView} from './weather.mjs';
import {framingStyle,opening} from './view.mjs';

const staleMs=45*60000;

export function timeAgo(then,now) {
  const minutes=Math.floor((now-then)/60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes<1) return 'Just now';
  if (minutes<60) return `${minutes} min ago`;
  const hours=Math.floor(minutes/60);
  if (hours<24) return `${hours} hr ago`;
  const days=Math.floor(hours/24);
  return days===1 ? 'Yesterday' : `${days} days ago`;
}

const hints={
  'network':'Open-Meteo could not be reached.',
  'timeout':'Open-Meteo did not respond in time.',
  'rate-limited':'Open-Meteo is limiting requests.',
  'too-large':'The forecast is larger than the download limit.',
  'access-denied':'Open-Meteo refused the request.',
  'blocked-address':'Open-Meteo resolved to a blocked address.',
};
export const issue=code=>Object.hasOwn(hints,code) ? hints[code] : 'The weather service is unavailable.';

// Bar colors by temperature in °F: cold blue, mild sage, warm straw, hot apricot.
const stops=[[10,[156,190,226]],[32,[176,208,224]],[50,[200,222,178]],[65,[232,214,150]],[80,[238,182,132]],[95,[232,146,118]]];
export function temperatureColor(value,units='fahrenheit') {
  const f=units==='celsius' ? value*9/5+32 : value;
  if (!Number.isFinite(f)) return '#d1dfbe';
  let color=stops[0][1];
  if (f>=stops.at(-1)[0]) color=stops.at(-1)[1];
  else for (let index=1;index<stops.length;index++) if (f<stops[index][0]) {
    const [t0,c0]=stops[index-1],[t1,c1]=stops[index];
    const k=Math.max(0,(f-t0)/(t1-t0));
    color=c0.map((part,channel)=>Math.round(part+(c1[channel]-part)*k));
    break;
  }
  return '#'+color.map(part=>part.toString(16).padStart(2,'0')).join('');
}

// Each day's high/low as a bar on one shared scale for the week.
export function rangeBars(week,{current=null,units='fahrenheit'}={}) {
  if (!week.length) return [];
  const min=Math.min(...week.map(day=>day.low)),max=Math.max(...week.map(day=>day.high));
  const span=Math.max(1,max-min);
  const at=value=>Math.max(0,Math.min(100,(value-min)/span*100));
  return week.map((day,index)=>{
    const left=at(day.low),width=Math.max(4,at(day.high)-left);
    const bar={left:Math.min(left,100-width),width,from:temperatureColor(day.low,units),to:temperatureColor(day.high,units)};
    // Today's dot marks the temperature now.
    if (index===0 && day.name==='Today' && typeof current==='number') bar.now=at(current);
    return {...day,bar};
  });
}

export function buildWeather(read,settings,{now,timezone}) {
  const time=now.valueOf();
  const day=now.toLocaleDateString('en-US',{weekday:'long',timeZone:timezone});
  const date=now.toLocaleDateString('en-US',{month:'long',day:'numeric',timeZone:timezone});
  const base={day,date,place:settings.city};
  if (!settings.city) return {...base,message:{title:'No city set',detail:'Set your city in this layout’s settings to see the weather.'}};
  const entry=read.weather;
  const view=entry?.value ? weatherView(entry.value,{now,timezone,units:settings.units,fetchedAt:entry.at ?? time}) : null;
  if (!view) {
    const detail=entry?.error==='unknown-city' ? `Couldn’t find “${settings.city}”. Check the city in this layout’s settings.`
      : entry?.error ? issue(entry.error)
      : 'The saved forecast is out of date.';
    return {...base,message:{title:'Weather is unavailable',detail}};
  }
  const ago=entry.at ? time-entry.at : 0;
  const notes=[];
  // A recent forecast is still good, so a failed refresh stays quiet until the data is stale.
  if (ago>staleMs) notes.push(`Updated ${timeAgo(entry.at,time).toLowerCase()}`);
  if (ago>staleMs && entry.error) notes.push(entry.error==='unknown-city' ? 'Couldn’t find the city' : 'Couldn’t refresh. '+issue(entry.error));
  return {...base,weather:{...view,week:rangeBars(view.week,{current:view.current,units:settings.units})},updated:notes.join(' · ')};
}

// Keep the large base64 artwork out of the page model; the page links the host's copy.
function pageSnapshot(snapshot) {
  const {art,...rest}=snapshot;
  const {image_data,image_buffer,...artFields}=art && typeof art==='object' ? art : {};
  const encoded=typeof image_data==='string' ? image_data : null;
  if (encoded?.length>34_000_000) throw new Error('Artwork exceeds the display budget');
  if ((Buffer.isBuffer(image_buffer) ? image_buffer.length : encoded ? Buffer.byteLength(encoded,'base64') : 0)>25_000_000) throw new Error('Artwork exceeds the display budget');
  const result=structuredClone(rest);
  if (art && typeof art==='object') result.art=structuredClone(artFields);
  return result;
}

export function presentPage(snapshot,forecast) {
  const result=pageSnapshot(snapshot);
  const {show_art}=displaySettings(snapshot);
  // Host protocol name: keep 'dayframe' (see the host repo's names.py).
  const art=show_art && typeof result.art?.image==='string' && /^(?:\/(?!\/)|http:\/\/dayframe\.local\/)/.test(result.art.image) ? result.art : null;
  const frame=opening(result);
  return {...result,show_art,forecast,art,layout:{frame,style:framingStyle(frame)}};
}

// The production render: read the cache, then build the page model.
export async function weatherPage(snapshot,config,{cache=weatherCache,waitMs=3000}={}) {
  const parsed=new Date(snapshot.now);
  const now=Number.isFinite(parsed.valueOf()) ? parsed : new Date();
  const timezone=timezoneOr(snapshot.timezone);
  void hostTimezone.set(snapshot.timezone);
  const settings=weatherSettings(config);
  const read=await cache.read(weatherRequest(settings,timezone),{waitMs});
  if (read.preparing) return {preparing:true};
  return presentPage({...snapshot,timezone},buildWeather(read,settings,{now,timezone}));
}
