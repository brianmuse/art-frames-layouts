import { parentPort, workerData } from 'node:worker_threads';
import ical from 'node-ical';
import {projectCalendar} from './ical-projection.mjs';

function localDate(date, timezone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=key=>parts.find(part=>part.type===key).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const clock=(date,timezone)=>new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);

export async function parseCalendar({text,days,timezone,name,color,now}) {
  const data=await ical.async.parseICS(projectCalendar(text,days));
  const meta=Object.values(data).find(item=>item.type==='VCALENDAR');
  const textValue=value=>typeof value==='string' ? value : typeof value?.val==='string' ? value.val : '';
  const title=String(name || textValue(meta?.['WR-CALNAME']) || textValue(meta?.['X-WR-CALNAME']) || textValue(meta?.NAME) || textValue(meta?.name) || 'Calendar').replace(/\s+/g,' ').trim().slice(0,100) || 'Calendar';
  const events=Object.fromEntries(days.map(day=>[day,[]]));
  const from=new Date(days[0]+'T00:00:00Z'); from.setUTCDate(from.getUTCDate()-2);
  const to=new Date(days.at(-1)+'T23:59:59Z'); to.setUTCDate(to.getUTCDate()+2);
  let count=0,skipped=0;
  for (const item of Object.values(data)) {
    if (item.type!=='VEVENT' || !item.start || item.status==='CANCELLED') continue;
    const options=item.rrule?.options;
    // One unsupported or broken series must not hide the rest of the calendar.
    // node-ical 0.27 reports freq as a name and camel-cased BY parts.
    if (options && (['MINUTELY','SECONDLY'].includes(options.freq) || options.freq>4 || (options.bySecond ?? options.bysecond)?.length>1 || (options.byMinute ?? options.byminute)?.length>1)) {skipped++;continue;}
    const found=[];
    try {
      for (const event of ical.expandRecurringEvent(item,{from,to,expandOngoing:true})) {
        if (++count>1000) throw Object.assign(new Error('Calendar exceeds the display budget'),{code:'event-limit'});
        if (event.event?.status==='CANCELLED' || !event.summary) continue;
        const allDay=event.isFullDay || event.start.dateOnly;
        const floating=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        const start=allDay ? floating(event.start) : localDate(event.start,timezone);
        const end=event.end || event.start;
        const exclusive=end>event.start ? new Date(end.valueOf()-1) : end;
        const last=allDay ? floating(exclusive) : localDate(exclusive,timezone);
        for (const day of days) {
          if (day<start || day>last) continue;
          const time=allDay ? 'All day' : `${day===start ? clock(event.start,timezone) : '00:00'} – ${day===last ? clock(end,timezone) : '23:59'}`;
          found.push([day,{all_day:Boolean(allDay),starts_at:event.start.toISOString(),ends_at:end.toISOString(),title:String(event.summary).replace(/\s+/g,' ').slice(0,300),time,calendar:title,color,past:!allDay && end<new Date(now),sort:allDay?'00:00':time.slice(0,5)}]);
        }
      }
    } catch(error) {
      if(error.code==='event-limit') throw error;
      skipped++;continue;
    }
    for (const [day,event] of found) events[day].push(event);
  }
  return {events,name:title,color,skipped};
}
async function processCalendar(input) {
  try {return await parseCalendar(input);}
  catch(error) {return {failed:true,code:['recurrence-limit','event-limit','projection-limit'].includes(error.code)?error.code:'invalid-feed'};}
}
if (parentPort) parentPort.postMessage(await processCalendar(workerData));
else if(process.send) {
  process.once('message',async input=>{process.send(await processCalendar(input),error=>process.exit(error?1:0));});
  process.once('disconnect',()=>process.exit(1));
}
