const colors: Record<string,string> = {green:'#3e785c',blue:'#386c9b',orange:'#a96a2c',red:'#b83b3b',grey:'#65716a',maroon:'#af2842',lilac:'#8850a8'};
function opening(snapshot: Record<string,any>) {
  const viewport=snapshot.art?.viewport;
  if (!viewport) return null;
  const {x,y,width,height}=viewport;
  const screenWidth=snapshot.display?.width || 3840,screenHeight=snapshot.display?.height || 2160;
  if (![x,y,width,height,screenWidth,screenHeight].every(Number.isFinite) || x<0 || y<0 || width<=0 || height<=0 || x+width>screenWidth || y+height>screenHeight) return null;
  return {x:x/screenWidth,y:y/screenHeight,width:width/screenWidth,height:height/screenHeight,scale:Math.min(width/screenWidth,height/screenHeight)};
}
export function framingStyle(snapshot: Record<string,any>) {
  const frame=opening(snapshot);
  if (!frame) return {};
  return {'--content-x':`${frame.x*100}%`,'--content-y':`${frame.y*100}%`,'--content-width':`${frame.width*100}%`,'--content-height':`${frame.height*100}%`,'--content-scale':frame.scale};
}
// The TV renderer runs no script, so the agenda is fitted here. Sizes are in the page's `u` units and mirror dashboard.astro.
// Inter Regular advance widths (thousandths of an em) for ASCII 32–126; other characters use a wide fallback.
const interWidths='281,288,466,633,642,982,644,300,365,365,501,662,288,460,288,360,631,407,610,618,646,593,620,566,619,620,288,302,662,662,662,511,966,690,654,730,722,601,590,746,743,269,571,672,565,903,753,765,639,765,644,642,646,744,690,985,682,679,629,365,360,365,471,456,323,562,612,571,612,583,370,613,591,242,242,549,242,876,591,600,612,612,376,528,327,591,562,818,546,562,552,426,333,426,662'.split(',').map(Number);
const textWidth=(text:string,size:number,spacing=0)=>[...text].reduce((total,char)=>{
  const code=char.codePointAt(0) || 0;
  return total+size*((code>=32 && code<127 ? interWidths[code-32]/1000 : code>=0x2e80 ? 1.25 : .8)+spacing);
},0);
// Greedy line count at spaces; long words break anywhere (overflow-wrap: anywhere). Slightly pessimistic on purpose.
export function lineCount(text:string,size:number,width:number,spacing=0) {
  let lines=1,used=0;
  const space=textWidth(' ',size,spacing),room=width*.96;
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    let length=textWidth(word,size,spacing);
    if (used && used+space+length<=room) {used+=space+length;continue;}
    if (used) lines++;
    while (length>room) {lines++;length-=room;}
    used=length;
  }
  return lines;
}
// Vertical spacing, roomiest first. The fitter picks the roomiest step that shows the whole day; titles wrap to two lines only in the roomy steps.
// Group and day gaps stay wider than row padding so the agenda reads in chunks.
const spacingSteps=[
  {header:1.3,event:.6,group:1.6,headingGap:.4,dayGap:1.6,dayPad:.65,lines:2},
  {header:1.3,event:.45,group:1.4,headingGap:.35,dayGap:1.4,dayPad:.6,lines:2},
  {header:1.2,event:.5,group:1.4,headingGap:.35,dayGap:1.4,dayPad:.6,lines:1},
  {header:1.05,event:.35,group:1.15,headingGap:.3,dayGap:1.2,dayPad:.5,lines:1},
  {header:1.05,event:.22,group:.95,headingGap:.25,dayGap:1,dayPad:.4,lines:1},
];
const border=.05,safety=.25,textLine=1.25,titleLine=1.25*1.25,headingLine=.9*1.3;
export const eventColor = (event: any) => /^#[0-9a-fA-F]{6}$/.test(event.color) ? event.color : (Object.hasOwn(colors,event.color) ? colors[event.color] : colors.green);
// Calendar dots sit on the dark fade, so lift dark colors until they stand out from it on a dim screen (4.5:1). The rail uses the same color, slightly translucent.
export function calendarSectionStyle(event: any) {
  let rgb=[1,3,5].map(offset=>parseInt(eventColor(event).slice(offset,offset+2),16));
  const luminance=(channels:number[])=>channels.map(channel=>channel/255<=.04045 ? channel/255/12.92 : ((channel/255+.055)/1.055)**2.4).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
  const backdrop=luminance([11,23,20]);
  while ((luminance(rgb)+.05)/(backdrop+.05)<4.5) rgb=rgb.map(channel=>Math.ceil(channel+(255-channel)*.08));
  return {'--calendar-color':`#${rgb.map(channel=>channel.toString(16).padStart(2,'0')).join('')}`,'--calendar-rail':`rgba(${rgb},.85)`};
}
export function clockTime(value?: string) {
  if (!value) return '—';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
export function eventTimes(value: string) {
  const [start, end] = value.split(' – ');
  const format = (time: string) => /^\d{2}:\d{2}$/.test(time) ? clockTime(time) : time;
  return {start:format(start), end:end ? format(end) : ''};
}
export function eventDuration(event: any) {
  if (event.all_day) return '';
  const start=Date.parse(event.starts_at),end=Date.parse(event.ends_at);
  let minutes;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end<=start) return '';
    minutes=Math.max(1,Math.round((end-start)/60000));
  } else {
    // Legacy/sample snapshots have clock ranges but no exact instants.
    const range=/^(\d{2}):(\d{2}) – (\d{2}):(\d{2})$/.exec(event.time || '');
    if (!range) return '';
    const [fromHour,fromMinute,toHour,toMinute]=range.slice(1).map(Number);
    if (fromHour>23 || toHour>23 || fromMinute>59 || toMinute>59) return '';
    minutes=(toHour*60+toMinute)-(fromHour*60+fromMinute);
    if (minutes<0) minutes+=1440;
    if (!minutes) return '';
  }
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  if (days) return [`${days}d`,hours?`${hours}h`:'',rest?`${rest}m`:''].filter(Boolean).join(' ');
  return [hours?`${hours} hr`:'',rest?`${rest} min`:''].filter(Boolean).join(' ');
}
export function calendarIssue(source:any) {
  const hints:Record<string,string>={
    'invalid-address':'Use the secret iCal address in this layout’s settings.',
    'unsupported-address':'Use the secret iCal address in this layout’s settings.',
    'access-denied':'Check calendar access in this layout’s settings.',
    'not-found':'Check the saved private iCal link.',
    'redirect':'Use the secret iCal address instead of a calendar webpage.',
    'invalid-feed':'The calendar did not return a readable iCal feed.',
    'too-large':'The calendar feed exceeds the download limit.',
    'projection-limit':'This calendar contains too much display data.',
    'parse-timeout':'This calendar took too long to process.',
    'memory-limit':'This calendar exceeds the processing limit.',
    'event-limit':'This calendar exceeds the event limit.',
    'recurrence-limit':'This calendar contains an unsupported recurrence.',
    'network':'The calendar service could not be reached.',
    'timeout':'The calendar service timed out.',
    'rate-limited':'The calendar service is limiting requests.',
  };
  const hint=Object.hasOwn(hints,source.issue) ? hints[source.issue] : 'Showing available calendars';
  return Number.isInteger(source.http_status) && source.http_status>=100 && source.http_status<=599 ? `HTTP ${source.http_status} · ${hint}` : source.issue==='timeout' ? 'No response before the calendar timeout.' : hint;
}
export function sourceSummary(sources:any[]) {
  const names=sources.slice(0,2).map(source=>source.name.length>24 ? source.name.slice(0,23)+'…' : source.name);
  return names.join(', ')+(sources.length>2 ? ` +${sources.length-2} more` : '');
}
// Start clock order: all-day first, untimed last. The sort is stable, so ties keep feed order.
const startKey=(event:any)=>event.all_day ? -1 : /^\d{2}:\d{2}/.test(event.time) ? Number(event.time.slice(0,2))*60+Number(event.time.slice(3,5)) : 1440;
// Legend lines for the chronological timeline: dot, gap, uppercase name and trailing space per calendar (SemiBold, so widths get 8% extra).
export function legendLines(names:string[],width:number) {
  let lines=1,used=0;
  for (const name of names) {
    const length=Math.min(width,.95+textWidth(String(name).toUpperCase(),.9,.1)*1.08);
    if (used && used+length>width*.96) {lines++;used=0;}
    used+=length+1.2;
  }
  return lines;
}
export function dashboardView(snapshot: Record<string, any>, {timeline='grouped'}: {timeline?: string} = {}) {
  const chronological=timeline==='chronological';
  const plan = snapshot.planner?.plan;
  const format = (date: string) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',timeZone:'UTC'});
  const days = plan?.calendar_days || [{date: snapshot.now.slice(0,10),label:'Today',events:plan?.today || []}];
  const weekend = days.length === 2;
  const calendars = new Map<string, string>();
  for (const day of days) for (const event of day.events || []) {
    if (event.calendar) calendars.set(event.calendar, eventColor(event));
  }
  const today=plan?.date || snapshot.now.slice(0,10);
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:snapshot.timezone || 'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(snapshot.now));
  const nowInstant=Date.parse(snapshot.now);
  const exactNext=days.flatMap((day:any)=>day.date>=today ? day.events || [] : []).filter((event:any)=>!event.all_day && /^\d{2}:\d{2}/.test(event.time) && Date.parse(event.starts_at)>nowInstant).reduce((best:any,event:any)=>!best || Date.parse(event.starts_at)<Date.parse(best.starts_at) ? event : best,null);
  let nextMarked=false;
  const agendaDays=days.map((day:any)=>({...day,events:(day.events || []).map((event:any)=>{
    const [start,end]=String(event.time).split(' – ');
    const timed=/^\d{2}:\d{2}$/.test(start);
    const startsAt=Date.parse(event.starts_at), endsAt=Date.parse(event.ends_at), now=Date.parse(snapshot.now);
    const instants=Number.isFinite(startsAt) && Number.isFinite(endsAt) && !event.all_day;
    const endClock=end && end<start ? '24:00' : end;
    let state=day.date<today || event.past ? 'past' : 'scheduled';
    if(day.date===today && timed && endClock) {
      if(instants ? endsAt<=now : endClock<=clock) state='past';
      else if(instants ? startsAt<=now : start<=clock) state='now';
    }
    if(!nextMarked && (!exactNext || event===exactNext) && day.date>=today && timed && (instants ? startsAt>now : day.date>today || start>clock)) {state='next';nextMarked=true;}
    return {...event,state,times:eventTimes(event.time),duration:eventDuration(event)};
  })}));
  const sources=plan?.calendars || Array.from(calendars, ([name,color])=>({name,color}));
  const calendarKey=(name:any,source:any)=>JSON.stringify([name || 'Calendar',eventColor(source)]);
  const sourceOrder=plan?.calendars ? sources.map((source:any)=>calendarKey(source.name,source)) : days.flatMap((day:any)=>day.events || []).map((event:any)=>calendarKey(event.calendar,event));
  const frame=opening(snapshot),scale=frame?.scale || 1;
  const panelWidth=34*(frame?.width ?? 1)/scale,room=.9*56.25*(frame?.height ?? 1)/scale-safety,titleWidth=Math.min(20,panelWidth-14);
  for (const day of agendaDays) for (const event of day.events) event.lines=Math.min(2,lineCount(event.title,1.25,titleWidth,-.025));
  const unavailable=sources.filter((source:any)=>source.status==='unavailable'),syncing=sources.filter((source:any)=>['syncing','refreshing'].includes(source.status)),stale=sources.filter((source:any)=>source.status==='stale');
  const status=unavailable.length ? {icon:'!',title:`${sourceSummary(unavailable)} couldn’t sync`,detail:unavailable.length===1 ? calendarIssue(unavailable[0]) : 'Showing available calendars'}
    : syncing.length ? {icon:'↻',title:`Updating ${sourceSummary(syncing)}`,detail:'Calendar downloads run in the background'}
    : stale.length ? {icon:'!',title:'Showing saved calendar data',detail:`${sourceSummary(stale)} couldn’t refresh`} : null;
  const statusHeight=status ? .6+.75+border+Math.max(1,.8*textLine*lineCount(status.title,.85,panelWidth-1.5)+.15+.75*textLine*lineCount(status.detail,.75,panelWidth-1.5)) : 0;
  const todos:string[]=plan?.todos || [];
  const tasksHeight=(shown:number)=>{
    if (!shown) return 0;
    const width=panelWidth-1.5,rows:number[]=[];
    let used=0;
    for (const title of todos.slice(0,shown)) {
      const lines=lineCount(title,.85,width),length=textWidth(String(title),.85);
      if (lines===1 && used && used+.6+length<=width*.96) {used+=.6+length;continue;}
      rows.push(lines);used=lines>1 ? width : length;
    }
    return .8+border+.5+textLine+.4+rows.reduce((total,lines)=>total+lines*.85*textLine,0)+(rows.length-1)*.6+(shown<todos.length ? .4+.85*textLine : 0);
  };
  // Upcoming events first, then the latest earlier ones; weekend days take turns so both stay visible.
  const turns=(lists:any[][])=>Array.from({length:Math.max(0,...lists.map(list=>list.length))},(_,index)=>lists.map(list=>list[index])).flat().filter(Boolean);
  const priority=[...turns(agendaDays.map((day:any)=>day.events.filter((event:any)=>event.state!=='past'))),...turns(agendaDays.map((day:any)=>day.events.filter((event:any)=>event.state==='past').reverse()))];
  const arrange=(selected:Set<any>)=>agendaDays.map((day:any)=>{
    const visible=day.events.filter((event:any)=>selected.has(event)),groups=new Map<string,any>();
    for (const event of visible) {
      const key=calendarKey(event.calendar,event);
      if (!groups.has(key)) groups.set(key,{name:event.calendar || 'Calendar',color:eventColor(event),events:[]});
      groups.get(key).events.push(event);
    }
    const sorted=Array.from(groups,([key,group])=>({...group,order:sourceOrder.indexOf(key),headingLines:1})).sort((left,right)=>(left.order<0?sourceOrder.length:left.order)-(right.order<0?sourceOrder.length:right.order));
    // Chronological: one rail per day, calendars interleaved, with a legend in place of the calendar headings.
    const calendars=sorted.map(({name,color})=>({name,color}));
    return {...day,visible,dateLabel:format(day.date),
      groups:!chronological ? sorted : visible.length ? [{chronological:true,calendars,headingLines:legendLines(calendars.map(calendar=>calendar.name),panelWidth-7.4),events:[...visible].sort((left,right)=>startKey(left)-startKey(right))}] : [],
      hiddenEarlier:day.events.filter((event:any)=>event.state==='past' && !selected.has(event)).length,
      hiddenLater:day.events.filter((event:any)=>event.state!=='past' && !selected.has(event)).length};
  });
  const height=(layout:any[],step:any,shown:number)=>2.3*1.15+step.header+Math.max(0,layout.length-1)*step.dayGap+statusHeight+tasksHeight(shown)
    +layout.reduce((total:number,day:any)=>total+(weekend ? 1.1*textLine+2*step.dayPad+border : 0)+Math.max(0,day.groups.length-1)*step.group
      +day.groups.reduce((sum:number,group:any)=>sum+group.headingLines*headingLine+step.headingGap+group.events.reduce((rows:number,event:any)=>rows+Math.min(step.lines,event.lines)*titleLine+2*step.event,0),0)
      +(!day.events.length || day.hiddenEarlier+day.hiddenLater ? .95*textLine+1.2 : 0),0);
  // Show every event (then as many tasks as allowed) at the roomiest spacing that fits; otherwise show the most events at the roomiest one-line spacing.
  let fit:any=null;
  for (let shown=Math.min(todos.length,weekend?2:5);!fit && shown>=0;shown--) {
    const layout=arrange(new Set(priority)),step=spacingSteps.find(step=>height(layout,step,shown)<=room);
    if (step) fit={layout,step,shown};
  }
  const oneLine=spacingSteps.filter(step=>step.lines===1);
  for (let count=priority.length-1;!fit && count>=0;count--) {
    const layout=arrange(new Set(priority.slice(0,count))),step=oneLine.find(step=>height(layout,step,0)<=room);
    if (!count || step) fit={layout,step:step || oneLine.at(-1),shown:0};
  }
  fit ||= {layout:arrange(new Set()),step:oneLine.at(-1),shown:0};
  const {step}=fit;
  const used=height(fit.layout,step,fit.shown);
  for (const day of fit.layout) for (const event of day.visible) event.lines=Math.min(step.lines,event.lines);
  return {
    plan, days:fit.layout, weekend, chronological, unavailable, syncing, stale, status, visibleTasks:fit.shown,
    space:{available:room,used}, oneLine:step.lines===1,
    spacing:{'--header-gap':step.header,'--event-pad':step.event,'--group-gap':step.group,'--heading-gap':step.headingGap,'--day-gap':step.dayGap,'--day-pad':step.dayPad},
    date: weekend ? `${format(days[0].date)} – ${format(days[1].date)}` : format(days[0].date),
    heading: weekend ? 'This weekend' : new Date(snapshot.now).toLocaleDateString('en-US',{weekday:'long',timeZone:snapshot.timezone || 'UTC'}),
    calendars: plan?.calendars || Array.from(calendars, ([name,color])=>({name,color})),
  };
}
export function weatherView(weather: any) {
  const temperature = (value: any) => typeof value === 'number' ? `${value}°` : '—';
  return {
    current: typeof weather?.current === 'number' ? `${weather.current}°${weather.unit}` : '—',
    label: weather?.label || 'Weather unavailable',
    eyebrow: weather?.stale ? 'Outside · Saved forecast' : 'Outside',
    high: temperature(weather?.high), low: temperature(weather?.low),
    humidity: typeof weather?.humidity === 'number' ? `${weather.humidity}%` : '—',
    sunset: clockTime(weather?.sunset),
    rain: typeof weather?.rain_probability === 'number' ? `${weather.rain_probability}%` : '—',
    rainTiming: weather?.rain_windows?.length
      ? weather.rain_windows.map((window: any) => `${window.ongoing ? 'Now' : clockTime(window.start)} – ${clockTime(window.end)}`).join(' · ')
      : weather?.rain_probability>=20 && weather?.rain_peak_time ? `Highest chance around ${clockTime(weather.rain_peak_time)}` : '',
  };
}
