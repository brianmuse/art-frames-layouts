import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {experimental_AstroContainer} from 'astro/container';

// Render the built Astro component with a fixed snapshot, without contacting providers.
async function render(snapshot) {
 const chunks=new URL('../dist/server/chunks/',import.meta.url);
 for(const file of await fs.readdir(chunks)) {
  if(!file.startsWith('dashboard_')) continue;
  const module=await import(new URL(file,chunks));
  if(module.page) {
   const container=await experimental_AstroContainer.create();
   return container.renderToString(module.page().default,{locals:{snapshot}});
  }
 }
 throw new Error('Built dashboard component missing; run the build first');
}
const event=(time,title,calendar='Work')=>({time,title,calendar,color:calendar==='Work'?'maroon':'lilac'});
const snapshot=days=>({now:'2026-10-26T12:00:00Z',timezone:'America/New_York',planner:{active:true,plan:{date:'2026-10-26',calendar_days:days}}});

test('the built weekday agenda separates calendars without repeating per-event labels',async()=>{
 const html=await render(snapshot([{date:'2026-10-26',label:'Monday',events:[event('09:00 – 09:30','Design <review>'),event('12:00 – 13:00','Lunch','Family'),event('18:00 – 19:00','Dinner','Family')]}]));
 assert.match(html,/class="calendar-heading"[^>]*>[\s\S]*?<span[^>]*>Work/);
 assert.match(html,/class="calendar-heading"[^>]*>[\s\S]*?<span[^>]*>Family/);
 assert.equal((html.match(/class="calendar-heading"/g)||[]).length,2);
 assert.match(html,/<h1[^>]*id="weekday"[^>]*>Monday/);
 assert.match(html,/<p[^>]*id="date"[^>]*>Oct 26/);
 assert.match(html,/9:00 AM/);assert.doesNotMatch(html,/9:30 AM|range-end/);
 assert.match(html,/class="duration"[^>]*aria-label="Duration: 30 min"[^>]*>30 min/);
 assert.match(html,/Design &lt;review&gt;/);assert.doesNotMatch(html,/<review>/);
 assert.doesNotMatch(html,/Up next|class="event-state"/);
 assert.doesNotMatch(html,/calendar-chip|event-source|period-heading|agenda-heading/);
});

test('weekends retain both dated days with their own calendar sections',async()=>{
 const html=await render(snapshot([{date:'2026-10-31',label:'Saturday',events:[event('09:00 – 10:00','Saturday plan')]},{date:'2026-11-01',label:'Sunday',events:[event('12:00 – 13:00','Sunday plan')]}]));
 assert.match(html,/class="day-heading"[^>]*>Saturday/);assert.match(html,/class="day-heading"[^>]*>Sunday/);
 assert.match(html,/Oct 31/);assert.match(html,/Nov 1/);
 assert.doesNotMatch(html,/class="period-heading"/);
 assert.equal((html.match(/class="event /g)||[]).length,2);
 assert.equal((html.match(/class="calendar-heading"/g)||[]).length,2);
});


test('all-day events keep their label and start-only reminders do not invent durations',async()=>{
 const html=await render(snapshot([{date:'2026-10-26',label:'Monday',events:[{...event('All day','Holiday'),all_day:true},event('09:00','Reminder')]}]));
 assert.match(html,/All day/);assert.match(html,/9:00 AM/);
 assert.doesNotMatch(html,/class="duration"|range-end/);
});


test('the calendar sits on the artwork with light ink and muted durations',async()=>{
 const html=await render(snapshot([{date:'2026-10-26',label:'Monday',events:[event('09:00 – 09:30','Design review')]}]));
 assert.doesNotMatch(html,/dark-glass|has-glass|--glass-image/);
 assert.match(html,/Design review/);assert.match(html,/Duration: 30 min/);
});

test('the build imports src/server unbundled, so renders and background sync share one cache and parser',async()=>{
 const sources=[];
 for(const file of await fs.readdir(new URL('../dist/server/',import.meta.url),{recursive:true})) {
  if(file.endsWith('.mjs')) sources.push(await fs.readFile(new URL('../dist/server/'+file,import.meta.url),'utf8'));
 }
 assert.ok(sources.length);
 for(const source of sources) assert.doesNotMatch(source,/createCalendarCache\(|calendar-worker/);
 assert.ok(sources.some(source=>/from\s*["']#server\/dashboard\.mjs["']/.test(source)),'dist imports #server/dashboard.mjs');
});

test('a busy day renders every fitted event and an accurate hidden-events line',async()=>{
 const {dashboardView}=await import('../src/lib/dashboard.ts');
 const events=Array.from({length:30},(_,index)=>event(`${String(7+Math.floor(index/3)).padStart(2,'0')}:${String(index%3*20).padStart(2,'0')} – ${String(8+Math.floor(index/3)).padStart(2,'0')}:00`,'Meeting '+index,index%2?'Work':'Family'));
 const data=snapshot([{date:'2026-10-26',label:'Monday',events}]),html=await render(data),day=dashboardView(data).days[0];
 assert.equal((html.match(/class="event /g)||[]).length,day.visible.length);
 assert.ok(day.visible.length>10 && day.visible.length<30);
 assert.match(html,new RegExp(`class="more-events"[^>]*>${day.hiddenEarlier} earlier · ${day.hiddenLater} later events`));
 assert.equal(day.hiddenEarlier+day.hiddenLater,30-day.visible.length);
 assert.match(html,/id="plan" style="[^"]*--event-pad:/);
 const light=await render(snapshot([{date:'2026-10-26',label:'Monday',events:events.slice(0,3)}]));
 assert.doesNotMatch(light,/class="more-events"/);
});

test('each calendar draws a rail with one node per event, marked by state',async()=>{
 const html=await render({...snapshot([{date:'2026-10-26',label:'Monday',events:[event('07:00 – 08:00','Gym','Family'),event('07:30 – 09:00','Standup'),event('09:00 – 09:30','Review'),event('10:00 – 11:00','Planning')]}]),now:'2026-10-26T12:15:00Z'});
 assert.equal((html.match(/class="node"/g)||[]).length,4);
 assert.match(html,/class="event past first last"[^>]*>[\s\S]*?class="node"[\s\S]*?Gym/);
 assert.match(html,/class="event now first"[^>]*>[\s\S]*?Standup/);
 assert.match(html,/class="event next"[^>]*>[\s\S]*?Review/);
 assert.match(html,/class="event scheduled last"[^>]*>[\s\S]*?Planning/);
 assert.match(html,/class="calendar-group" style="--calendar-color:#[0-9a-f]{6};--calendar-rail:rgba\(/);
 assert.doesNotMatch(html,/calendar-legend|chronological/);
});

test('the chronological timeline renders one rail with per-event colors and a legend',async()=>{
 const {experimental_AstroContainer}=await import('astro/container');
 const chunks=new URL('../dist/server/chunks/',import.meta.url);
 let html;
 for(const file of await fs.readdir(chunks)) {
  if(!file.startsWith('dashboard_')) continue;
  const module=await import(new URL(file,chunks));
  if(module.page) html=await (await experimental_AstroContainer.create()).renderToString(module.page().default,{locals:{timeline:'chronological',snapshot:snapshot([{date:'2026-10-26',label:'Monday',events:[event('09:00 – 09:30','Standup'),event('18:00 – 19:00','Review'),event('12:00 – 13:00','Lunch','Family')]}])}});
 }
 assert.equal((html.match(/class="calendar-group chronological"/g)||[]).length,1);
 assert.doesNotMatch(html,/class="calendar-heading"/);
 assert.match(html,/class="calendar-legend"[^>]*><span style="--calendar-color:#c76779[^>]*>Work<\/span><span style="--calendar-color:#9b6bb6[^>]*>Family/);
 assert.match(html,/class="event next first" style="--calendar-color:#c76779[^>]*>[\s\S]*?Standup[\s\S]*?class="event scheduled" style="--calendar-color:#9b6bb6[^>]*>[\s\S]*?Lunch[\s\S]*?class="event scheduled last" style="--calendar-color:#c76779[^>]*>[\s\S]*?Review/);
});
