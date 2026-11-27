import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dashboardView,calendarIssue,weatherView} from '../src/lib/dashboard.ts';

test('agenda separates ongoing, next and earlier events using the display timezone',()=>{
  const snapshot={now:'2026-10-26T16:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendars:[{name:'Work',color:'#af2842',status:'unavailable',issue:'invalid-address'}],calendar_days:[{date:'2026-10-26',label:'Monday',events:[{time:'08:00 – 09:00',title:'Earlier',past:true},{time:'11:00 – 13:00',title:'Current'},{time:'14:00 – 15:00',title:'Next'},{time:'16:00 – 17:00',title:'Later'}]}]}}};
  const view=dashboardView(snapshot);
  assert.deepEqual(view.days[0].events.map(event=>event.state),['past','now','next','scheduled']);
  assert.equal(view.days[0].events[1].times.start,'11:00 AM');
  assert.equal(view.unavailable[0].name,'Work');
  assert.equal(calendarIssue(view.unavailable[0]),'Use the secret iCal address in this layout’s settings.');
});

test('a busy day keeps upcoming plans ahead of older meetings and reports what it hides',()=>{
 const events=Array.from({length:40},(_,i)=>({time:`${String(6+Math.floor(i/3)).padStart(2,'0')}:${String(i%3*20).padStart(2,'0')} – ${String(7+Math.floor(i/3)).padStart(2,'0')}:00`,title:'Meeting '+i}));
 const view=dashboardView({now:'2026-10-26T14:30:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendar_days:[{date:'2026-10-26',events}]}}});
 const day=view.days[0],earlier=day.events.filter(event=>event.state==='past'),upcoming=day.events.filter(event=>event.state!=='past');
 assert.ok(day.visible.length>10 && day.visible.length<40,String(day.visible.length));
 assert.ok(upcoming.every(event=>day.visible.includes(event)) || !day.visible.some(event=>event.state==='past'),'upcoming events come first');
 const shownEarlier=earlier.filter(event=>day.visible.includes(event));
 assert.deepEqual(shownEarlier,earlier.slice(earlier.length-shownEarlier.length),'the latest earlier events fill the rest');
 assert.equal(day.hiddenEarlier,earlier.length-shownEarlier.length);
 assert.equal(day.hiddenLater,upcoming.filter(event=>!day.visible.includes(event)).length);
 assert.equal(day.visible.length+day.hiddenEarlier+day.hiddenLater,40);
});

test('weekend prior-day events are earlier and only one upcoming event is marked',()=>{
  const view=dashboardView({now:'2026-11-01T13:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-11-01',calendar_days:[{date:'2026-10-31',events:[{time:'09:00 – 10:00',title:'Saturday'}]},{date:'2026-11-01',events:[{time:'10:00 – 11:00',title:'Sunday'},{time:'12:00 – 13:00',title:'Later'}]}]}}});
  assert.deepEqual(view.days.flatMap(day=>day.events.map(event=>event.state)),['past','next','scheduled']);
  assert.equal(view.weekend,true);
});


test('exact end and overnight events use real instants for Now and earlier states',()=>{
  const events=[{time:'09:00 – 12:00',starts_at:'2026-10-26T13:00:00Z',ends_at:'2026-10-26T16:00:00Z',title:'Ended'}, {time:'08:35 – 15:00',starts_at:'2026-10-26T12:35:00Z',ends_at:'2026-10-26T19:00:00Z',title:'Ongoing'}];
  const view=dashboardView({now:'2026-10-26T16:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendar_days:[{date:'2026-10-26',events}]}}});
  assert.deepEqual(view.days[0].events.map(event=>event.state),['past','now']);
  const overnight=dashboardView({now:'2026-10-27T03:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendar_days:[{date:'2026-10-26',events:[{time:'22:00 – 00:00',starts_at:'2026-10-27T02:00:00Z',ends_at:'2026-10-27T04:00:00Z',title:'Overnight'}]}]}}});
  assert.equal(overnight.days[0].events[0].state,'now');
});


test('Up next uses the earliest real instant across the repeated DST hour',()=>{
 const events=[{time:'01:15 – 01:30',starts_at:'2026-11-01T06:15:00Z',ends_at:'2026-11-01T06:30:00Z',title:'Later standard time'},{time:'01:45 – 01:55',starts_at:'2026-11-01T05:45:00Z',ends_at:'2026-11-01T05:55:00Z',title:'Earlier daylight time'}];
 const view=dashboardView({now:'2026-11-01T05:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-11-01',calendar_days:[{date:'2026-11-01',events}]}}});
 assert.equal(view.days[0].events.find(event=>event.state==='next').title,'Earlier daylight time');
});


test('rain timing stays secondary and omits speculative timing for very low rain chances',()=>{
 const low=weatherView({rain_probability:3,rain_peak_time:'23:00',rain_windows:[]});
 assert.equal(low.rain,'3%');assert.equal(low.rainTiming,'');
 assert.equal(weatherView({rain_probability:60,rain_peak_time:'14:00'}).rainTiming,'Highest chance around 2:00 PM');
 assert.equal(weatherView({rain_probability:60,rain_windows:[{start:'14:00',end:'17:00',ongoing:false}]}).rainTiming,'2:00 PM – 5:00 PM');
});

test('framing uses the painting opening and rejects malformed geometry',async()=>{
 const {framingStyle}=await import('../src/lib/dashboard.ts');
 const base={display:{width:3840,height:2160},art:{viewport:{x:96,y:108,width:3648,height:1944}}};
 assert.deepEqual(framingStyle(base),{'--content-x':'2.5%','--content-y':'5%','--content-width':'95%','--content-height':'90%','--content-scale':.9});
 assert.deepEqual(framingStyle({}),{});
 for(const viewport of [{x:-1,y:0,width:100,height:100},{x:0,y:0,width:4000,height:2160},{x:0,y:0,width:100,height:NaN},{x:'96',y:108,width:3648,height:1944}]) assert.deepEqual(framingStyle({...base,art:{viewport}}),{});
});


test('calendar sections follow configured order and retain each selected event once',()=>{
 const events=[{time:'All day',title:'School holiday',calendar:'Family',color:'lilac',all_day:true},{time:'09:00 – 10:00',title:'Standup',calendar:'Work',color:'maroon'},{time:'12:00 – 13:00',title:'Lunch',calendar:'Family',color:'lilac'},{time:'18:00 – 19:00',title:'Review',calendar:'Work',color:'maroon'}];
 const calendars=[{name:'Work',color:'maroon'},{name:'Family',color:'lilac'}];
 const view=dashboardView({now:'2026-10-26T12:00:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendars,calendar_days:[{date:'2026-10-26',events}]}}});
 const day=view.days[0];
 assert.deepEqual(day.groups.map(group=>group.name),['Work','Family']);
 assert.deepEqual(day.groups[0].events.map(event=>event.title),['Standup','Review']);
 assert.deepEqual(day.groups[1].events.map(event=>event.title),['School holiday','Lunch']);
 assert.deepEqual(new Set(day.groups.flatMap(group=>group.events)),new Set(day.visible));
 assert.equal(day.dateLabel,'Oct 26');
 const empty=dashboardView({now:'2026-10-26T12:00:00Z',planner:{plan:{today:[]}}});
 assert.deepEqual(empty.days[0].groups,[]);
});

test('equally named calendars with distinct colors retain separate sections',()=>{
 const events=[{time:'09:00',title:'One',calendar:'Shared',color:'maroon'},{time:'10:00',title:'Two',calendar:'Shared',color:'lilac'}];
 const view=dashboardView({now:'2026-10-26T12:00:00Z',planner:{plan:{today:events}}});
 assert.equal(view.days[0].groups.length,2);
 assert.deepEqual(view.days[0].groups.map(group=>group.events[0].title),['One','Two']);
});

test('calendar dots and rails keep their color and stand out from the dark fade',async()=>{
 const {calendarSectionStyle}=await import('../src/lib/dashboard.ts');
 const luminance=hex=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(channel=>channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
 for(const color of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#d9a6f6','maroon','lilac']) {
  const dot=calendarSectionStyle({color})['--calendar-color'];
  assert.match(dot,/^#[0-9a-f]{6}$/);assert.ok((luminance(dot)+.05)/(luminance('#0b1714')+.05)>=4.5,color);
 }
 assert.deepEqual(calendarSectionStyle({color:'#ffffff'}),{'--calendar-color':'#ffffff','--calendar-rail':'rgba(255,255,255,.85)'});
 assert.deepEqual(calendarSectionStyle({color:'lilac'}),{'--calendar-color':'#9b6bb6','--calendar-rail':'rgba(155,107,182,.85)'});
 assert.deepEqual(calendarSectionStyle({color:'invalid'}),calendarSectionStyle({color:'green'}));
});


test('many calendar sections all fit when there is room for their headings',()=>{
 const events=Array.from({length:12},(_,index)=>({time:`${String(index+7).padStart(2,'0')}:00`,title:'Event '+index,calendar:'Calendar '+(index%8),color:'maroon'}));
 const view=dashboardView({now:'2026-10-26T06:00:00Z',planner:{plan:{today:events}}}),day=view.days[0];
 assert.equal(day.visible.length,12);assert.equal(day.hiddenLater,0);assert.equal(day.groups.length,8);
 assert.equal(new Set(day.groups.flatMap(group=>group.events)).size,12);
 assert.ok(view.space.used<=view.space.available);
});


test('hidden old calendars do not reduce the capacity of the visible calendar',()=>{
 const older=Array.from({length:30},(_,index)=>({time:'06:00 – 07:00',title:'Earlier '+index,calendar:'Old '+index,color:'maroon'}));
 const upcoming=Array.from({length:12},(_,index)=>({time:`${String(index+10).padStart(2,'0')}:00`,title:'Upcoming '+index,calendar:'Work',color:'maroon'}));
 const day=dashboardView({now:'2026-10-26T09:00:00Z',planner:{plan:{today:[...older,...upcoming]}}}).days[0];
 assert.ok(upcoming.every(event=>day.visible.some(visible=>visible.title===event.title)));
 assert.equal(day.hiddenLater,0);assert.equal(day.hiddenEarlier,30-day.visible.filter(event=>event.state==='past').length);
 assert.ok(day.hiddenEarlier>0);
});


test('event duration uses exact instants across overnight and DST transitions',async()=>{
 const {eventDuration}=await import('../src/lib/dashboard.ts');
 assert.equal(eventDuration({starts_at:'2026-10-26T13:00:00Z',ends_at:'2026-10-26T13:30:00Z'}),'30 min');
 assert.equal(eventDuration({starts_at:'2026-10-26T23:30:00Z',ends_at:'2026-10-27T01:00:00Z'}),'1 hr 30 min');
 assert.equal(eventDuration({time:'01:30 – 01:30',starts_at:'2026-11-01T01:30:00-04:00',ends_at:'2026-11-01T01:30:00-05:00'}),'1 hr');
 assert.equal(eventDuration({time:'01:30 – 03:30',starts_at:'2026-03-08T01:30:00-05:00',ends_at:'2026-03-08T03:30:00-04:00'}),'1 hr');
 assert.equal(eventDuration({starts_at:'2026-10-26T09:00:00Z',ends_at:'2026-10-28T10:30:00Z'}),'2d 1h 30m');
});

test('event duration falls back to clock ranges and omits unknown or all-day lengths',async()=>{
 const {eventDuration}=await import('../src/lib/dashboard.ts');
 assert.equal(eventDuration({time:'09:00 – 09:15'}),'15 min');
 assert.equal(eventDuration({time:'09:00 – 10:00'}),'1 hr');
 assert.equal(eventDuration({time:'23:30 – 01:00'}),'1 hr 30 min');
 for(const event of [{time:'All day',all_day:true},{time:'09:00'},{time:'09:00 – 09:00'},{time:'25:00 – 26:00'},{starts_at:'2026-10-26T10:00:00Z',ends_at:'2026-10-26T09:00:00Z'}]) assert.equal(eventDuration(event),'');
});


const busyDay=(count,{long=false,calendars=1,weekend=false,viewport}={})=>{
 const events=Array.from({length:count},(_,index)=>({time:`${String(6+Math.floor(index/4)).padStart(2,'0')}:${String(index%4*15).padStart(2,'0')} – ${String(7+Math.floor(index/4)).padStart(2,'0')}:00`,title:long && index%2 ? `Quarterly planning ${index}: roadmap priorities and staffing for the platform group` : 'Standup '+index,calendar:'Calendar '+(index%calendars),color:['maroon','lilac','blue','green','orange','red','grey'][index%7]}));
 const days=weekend ? [{date:'2026-10-31',label:'Saturday',events},{date:'2026-11-01',label:'Sunday',events:events.slice(0,count>>1).map(event=>({...event,title:'Sun '+event.title}))}] : [{date:'2026-10-26',label:'Monday',events}];
 return {now:`${days[0].date}T12:00:00Z`,timezone:'America/New_York',display:{width:3840,height:2160},art:viewport && {viewport},planner:{plan:{date:days[0].date,calendar_days:days}}};
};
// Worst single-event cost at the tightest spacing: a one-line row plus a new calendar heading and gap.
const largestStep=1.5625+2*.22+.9*1.3+.25+.95;

test('the agenda fills the available height without exceeding it',()=>{
 for (const options of [{},{long:true},{calendars:6},{long:true,calendars:6},{weekend:true},{weekend:true,long:true,calendars:3},{viewport:{x:384,y:216,width:3072,height:1728}},{viewport:{x:0,y:400,width:3840,height:1360},long:true}]) for (const count of [3,12,25,60]) {
  for (const timeline of ['grouped','chronological']) {
  const view=dashboardView(busyDay(count,options),{timeline}),label=JSON.stringify({count,timeline,...options});
  assert.ok(view.space.used<=view.space.available,label);
  const hidden=view.days.reduce((total,day)=>total+day.hiddenEarlier+day.hiddenLater,0);
  if (hidden) assert.ok(view.space.available-view.space.used<largestStep,label+' leaves '+(view.space.available-view.space.used));
  for (const day of view.days) assert.equal(day.visible.length+day.hiddenEarlier+day.hiddenLater,day.events.length,label);
 }}
});

test('the chronological timeline interleaves calendars in start order with one rail and legend per day',async()=>{
 const {legendLines}=await import('../src/lib/dashboard.ts');
 const events=[{time:'12:00 – 13:00',title:'Lunch',calendar:'Family',color:'lilac'},{time:'09:00 – 10:00',title:'Standup',calendar:'Work',color:'maroon'},{time:'All day',title:'Holiday',calendar:'Family',color:'lilac',all_day:true},{time:'09:00',title:'Reminder',calendar:'Family',color:'lilac'},{time:'18:00 – 19:00',title:'Review',calendar:'Work',color:'maroon'}];
 const snapshot={now:'2026-10-26T13:30:00Z',timezone:'America/New_York',planner:{plan:{date:'2026-10-26',calendars:[{name:'Work',color:'maroon'},{name:'Family',color:'lilac'}],calendar_days:[{date:'2026-10-26',events}]}}};
 const view=dashboardView(snapshot,{timeline:'chronological'}),[group]=view.days[0].groups;
 assert.equal(view.chronological,true);assert.equal(view.days[0].groups.length,1);
 assert.deepEqual(group.events.map(event=>event.title),['Holiday','Standup','Reminder','Lunch','Review']);
 assert.deepEqual(group.calendars.map(calendar=>calendar.name),['Work','Family']);
 assert.deepEqual(group.events.map(event=>event.state),['scheduled','now','scheduled','next','scheduled']);
 assert.equal(dashboardView(snapshot).chronological,false);
 assert.equal(legendLines(['Work','Family'],26.6),1);
 assert.ok(legendLines(Array.from({length:8},(_,index)=>'Calendar '+index),26.6)>1);
 const weekend=dashboardView(busyDay(10,{weekend:true,calendars:3}),{timeline:'chronological'});
 assert.ok(weekend.days.every(day=>day.groups.length===1 && day.groups[0].events.length===day.visible.length));
});

test('the agenda shows every event when they fit and prefers the roomiest spacing',()=>{
 const light=dashboardView(busyDay(4)),busy=dashboardView(busyDay(25));
 assert.equal(light.days[0].visible.length,4);assert.equal(light.spacing['--event-pad'],.6);
 assert.equal(dashboardView(busyDay(10)).days[0].hiddenLater,0);
 assert.ok(busy.days[0].visible.length>10,'more than the old fixed cap of ten');
 assert.ok(busy.spacing['--event-pad']<light.spacing['--event-pad']);
});

test('long titles wrap to two lines only when the whole day fits roomily',async()=>{
 const {lineCount}=await import('../src/lib/dashboard.ts');
 assert.equal(lineCount('Team standup',1.25,17.5,-.025),1);
 assert.equal(lineCount('Quarterly planning: roadmap priorities and staffing for the platform group',1.25,17.5,-.025),3);
 assert.equal(lineCount('x'.repeat(40),1.25,17.5),2);
 const roomy=dashboardView(busyDay(4,{long:true})),tight=dashboardView(busyDay(60,{long:true}));
 assert.ok(!roomy.oneLine && roomy.days[0].visible.some(event=>event.lines===2));
 assert.ok(tight.oneLine && tight.days[0].visible.every(event=>event.lines===1));
 assert.equal(tight.days[0].visible.length,dashboardView(busyDay(60)).days[0].visible.length);
});

test('weekend days share the budget so a busy Saturday cannot crowd out Sunday',()=>{
 const view=dashboardView(busyDay(40,{weekend:true}));
 assert.ok(view.days.every(day=>day.visible.length>2),view.days.map(day=>day.visible.length).join());
 assert.ok(view.days.every(day=>day.hiddenLater>0));
 assert.ok(view.space.used<=view.space.available);
});

test('tasks only use space that events do not need',()=>{
 const todos=['Renew library books','Order birthday gift','Call the plumber','Pay water bill','Sign field trip form','Book flights'];
 const light=busyDay(4);light.planner.plan.todos=todos;
 assert.equal(dashboardView(light).visibleTasks,5);
 const busy=busyDay(60);busy.planner.plan.todos=todos;
 const view=dashboardView(busy),alone=dashboardView(busyDay(60));
 assert.equal(view.visibleTasks,0);assert.equal(view.days[0].visible.length,alone.days[0].visible.length);
});

test('a hidden-events line appears only when events are hidden and is part of the budget',()=>{
 const all=dashboardView(busyDay(8)).days[0];
 assert.equal(all.hiddenEarlier+all.hiddenLater,0);
 const status=busyDay(60);status.planner.plan.calendars=[{name:'Calendar 0',color:'maroon',status:'unavailable',issue:'timeout'}];
 const view=dashboardView(status),plain=dashboardView(busyDay(60));
 assert.ok(view.status && view.days[0].visible.length<plain.days[0].visible.length,'the sync notice reserves its own space');
 assert.ok(view.space.used<=view.space.available);
});
