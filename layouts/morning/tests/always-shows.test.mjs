import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dashboard} from '../src/server/dashboard.mjs';

// The TV's Schedule decides when this layout shows, so the layout has no display hours of its own.
const snapshot={now:'2026-10-26T06:45:00-04:00',timezone:'America/New_York',data:{}};

test('the planner shows at any time of day, also before the old 07:00 default',async()=>{
 for(const now of ['2026-10-26T06:45:00-04:00','2026-10-26T12:00:00-04:00','2026-10-26T23:30:00-04:00']) {
  const result=await dashboard({...snapshot,now},{calendars:[]});
  assert.equal(result.planner.active,true,now);
  assert.equal(result.planner.plan.date,'2026-10-26',now);
 }
});

test('saved hours and show_calendar from older versions are ignored',async()=>{
 const old={calendars:[],morning_start:'07:00',morning_end:'07:30'};
 for(const extra of [{display_settings:{show_calendar:false}},{display_settings:{}},{}]) {
  const result=await dashboard({...snapshot,...extra},old);
  assert.equal(result.planner.active,true);
 }
});

test('render_purpose and ignore_display_hours do not change the planner',async()=>{
 for(const extra of [{render_purpose:'scheduled'},{render_purpose:'prepare'},{render_purpose:'preview'},{render_purpose:'preview',ignore_display_hours:false},{render_purpose:'preview',ignore_display_hours:true}]) {
  const result=await dashboard({...snapshot,...extra},{calendars:[]});
  assert.equal(result.planner.active,true,JSON.stringify(extra));
 }
});

test('the dev art preview shows only the artwork',async()=>{
 const result=await dashboard(snapshot,{calendars:[]},{mode:'art'});
 assert.deepEqual(result.planner,{active:false,plan:null});
});
