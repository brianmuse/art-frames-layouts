import { ProviderError } from './fetch.mjs';
import {calendarCache,cacheKey} from './calendar-cache.mjs';
import {calendarParser,parsed} from './calendar-parser.mjs';
import { weather } from './weather.mjs';
import { localDate,displayDays,syncDay } from './dates.mjs';
import {settings,calendarFeeds,calendarSchedule,calendarTimezone,hostTimezone} from './settings.mjs';
export {settings,displayDays};

const wait=async(pending,deadline,limit=1500)=>{
  let timer;
  try {await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,Math.min(limit,Math.max(1,deadline-Date.now())));})]);}
  finally {clearTimeout(timer);}
};
export async function calendar(url,days,timezone,name,color,now,{deadline=Date.now()+17000,refreshMs=86400000,timeoutMs=90000,syncAt='03:00',cache=calendarCache,parser=calendarParser}={}) {
  if(deadline<=Date.now()) throw new ProviderError('timeout');
  const options={feed:cacheKey(url),days,timezone,name,color,now};
  const feed=cache.get(url,{refreshMs,timeoutMs,refreshKey:refreshMs===86400000 ? syncDay(new Date(now),timezone,syncAt) : null,validate:text=>parsed(parser,text,options)});
  // A first download now includes its parse, so allow both former 1.5-second waits.
  if(!feed.text && feed.pending && !feed.error) await wait(feed.pending,deadline,3000);
  if(!feed.text) throw feed.error || (feed.pending ? new ProviderError('syncing') : new ProviderError());
  const text=feed.text;
  let syncStatus=feed.pending?'refreshing':feed.error?'stale':'connected';
  const updatedAt=feed.updatedAt, warning=feed.error;
  const state=parser.get(text,options);
  let value=state.value;
  if(!value && state.pending && !state.error) {
    // Serve the previous result for these days while a changed feed parses.
    value=parser.latest(options.feed,options);
    if(value) syncStatus='refreshing';
    else {await wait(state.pending,deadline);value=state.value;}
  }
  if(!value) throw state.error || new ProviderError('syncing');
  const events=Object.fromEntries(Object.entries(value.events).map(([day,items])=>[day,items.map(event=>({...event,past:!event.all_day && Date.parse(event.ends_at)<Date.parse(now)}))]));
  return {...value,events,sync_status:syncStatus,updated_at:updatedAt,warning};
}
// Production asks for an early 202 while a calendar's first sync is pending, so
// skip weather waits that the response would discard.
export async function dashboard(snapshot,config,{mode='current',deferWhenSyncing=false}={}) {
  // Keep the large base64 artwork out of the clone; the page draws over it unchanged.
  const {art,...rest}=snapshot;
  const {image_data,image_buffer,...artFields}=art && typeof art==='object' ? art : {};
  const result=structuredClone(rest);
  if(art && typeof art==='object') result.art=structuredClone(artFields);
  const encoded=typeof image_data==='string' ? image_data : (artFields.image?.startsWith?.('data:image/jpeg;base64,') ? artFields.image.split(',')[1] : null);
  if(encoded?.length>34_000_000) throw new Error('Artwork exceeds the display budget');
  if((Buffer.isBuffer(image_buffer) ? image_buffer.length : encoded ? Buffer.byteLength(encoded,'base64') : 0)>25000000) throw new Error('Artwork exceeds the display budget');
  const now=new Date(snapshot.now), timezone=calendarTimezone(config,snapshot.timezone);
  void hostTimezone.set(snapshot.timezone);
  result.timezone=timezone;
  const day=localDate(now,timezone);
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  // The TV's Schedule decides when this layout shows, so every render shows the planner.
  // Only the dev "art" preview shows the artwork alone. Saved hours and show_calendar values from
  // older versions are ignored.
  const active=mode!=='art';
  result.planner={active,plan:null};
  if (!active) return result;
  const days=displayDays(day), events=Object.fromEntries(days.map(value=>[value,[]])), errors=[];
  const feeds=calendarFeeds(config);
  const calendars=new Array(feeds.length);
  let calendarUnavailable=false;
  const deadline=Date.now()+17000;
  const schedule=calendarSchedule(config);
  const forecast=weather(config,day,clock,timezone).catch(()=>{errors.push('Weather provider is unavailable');return null;});
  const load=async(index)=>{
    const feed=feeds[index];
    const name=typeof feed.title==='string' ? feed.title.replace(/\s+/g,' ').trim().slice(0,100) : '';
    const color=/^#[0-9a-fA-F]{6}$/.test(feed.color) ? feed.color : '#af2842';
    try {
      const found=await calendar(feed.url,days,timezone,name,color,now.toISOString(),{deadline,...schedule});
      calendars[index]={name:found.name,color,status:found.sync_status,updated_at:found.updated_at,issue:found.warning?.code,http_status:found.warning?.status,skipped_events:found.skipped || 0};
      for(const value of days) events[value].push(...(found.events[value] || []));
    } catch(error) {
      calendarUnavailable ||= error.code!=='syncing';
      calendars[index]={name:name || `Calendar ${index+1}`,color,status:error.code==='syncing'?'syncing':'unavailable',issue:error instanceof ProviderError ? error.code : 'unavailable',http_status:error.status,phase:error.phase,transport:error.transport,received_bytes:error.received_bytes,limit_bytes:error.limit_bytes};
      if(error.code!=='syncing') errors.push(name ? name+' calendar is unavailable' : `Calendar ${index+1} is unavailable`);
    }
  };
  let next=0;
  await Promise.all(Array.from({length:Math.min(2,feeds.length)},async()=>{while(next<feeds.length) {const index=next++;await load(index);}}));
  const syncing=calendars.some(source=>source.status==='syncing');
  if(deferWhenSyncing && syncing) {
    result.planner.plan={date:day,calendar_days:[],today:[],tomorrow:[],todos:[],weather:null,errors,calendar_connected:true,calendar_unavailable:calendarUnavailable,calendar_syncing:true,calendars};
    return result;
  }
  const weatherResult=await forecast;
  for (const values of Object.values(events)) values.sort((left,right)=>Number(Boolean(right.all_day))-Number(Boolean(left.all_day)) || (Date.parse(left.starts_at)-Date.parse(right.starts_at)) || left.sort.localeCompare(right.sort));
  result.planner.plan={date:day,calendar_days:days.map(value=>({date:value,label:new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}),events:events[value]})),today:events[day] || [],tomorrow:[],todos:[],weather:weatherResult,errors,calendar_connected:feeds.length>0,calendar_unavailable:calendarUnavailable,calendar_syncing:syncing,calendars};
  return result;
}
