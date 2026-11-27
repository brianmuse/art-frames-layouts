import {settings,calendarFeeds,calendarSchedule,calendarTimezone,hostTimezone} from './settings.mjs';
import {calendarCache,cacheKey} from './calendar-cache.mjs';
import {calendarParser,parsed} from './calendar-parser.mjs';
import {localDate,displayDays,syncDay} from './dates.mjs';

export async function syncCalendars(config,{now=new Date(),cache=calendarCache,parser=calendarParser,host=null}={}) {
  const timezone=calendarTimezone(config,host),schedule=calendarSchedule(config),feeds=calendarFeeds(config);
  const days=displayDays(localDate(now,timezone));
  await cache.prune(feeds.map(feed=>feed.url));
  await Promise.all(feeds.map(async feed=>{
    const options={feed:cacheKey(feed.url),days,timezone,name:feed.title,color:feed.color,now:now.toISOString()};
    const state=cache.get(feed.url,{...schedule,refreshKey:schedule.refreshMs===86400000?syncDay(now,timezone,schedule.syncAt):null,validate:text=>parsed(parser,text,options)});
    await state.pending;
    if(state.text) await parser.get(state.text,options).pending;
  }));
}

export function startCalendarSync({loadSettings=settings,now=()=>new Date(),intervalMs=60000,host=hostTimezone}={}) {
  let stopped=false,timer;
  async function tick() {
    try {await syncCalendars(await loadSettings(),{now:now(),host:await host.get()});}
    catch {console.warn('Calendar background sync could not complete');}
    if(!stopped) {timer=setTimeout(tick,intervalMs);timer.unref();}
  }
  void tick();
  return ()=>{stopped=true;clearTimeout(timer);};
}
