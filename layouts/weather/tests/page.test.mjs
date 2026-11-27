import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildWeather,presentPage,weatherPage,rangeBars,temperatureColor,timeAgo} from '../src/server/page.mjs';
import {sampleCache,sampleConfig,sampleForecast} from '../src/server/sample.mjs';
import {weatherSettings} from '../src/server/settings.mjs';

const zone='America/New_York';
const now=new Date('2026-11-02T13:15:00Z');
const settings=weatherSettings({city:'Boston, MA'});
const saved=(extra={})=>({weather:{value:sampleForecast(now,zone),at:now.valueOf()-6*60000,error:null,loading:false,...extra}});

test('time ago reads naturally',()=>{
  assert.equal(timeAgo(now-20000,now),'Just now');
  assert.equal(timeAgo(now-12*60000,now),'12 min ago');
  assert.equal(timeAgo(now-3*3600000,now),'3 hr ago');
  assert.equal(timeAgo(now-30*3600000,now),'Yesterday');
});

test('a fresh forecast shows the day and the week with no status line',()=>{
  const page=buildWeather(saved(),settings,{now,timezone:zone});
  assert.equal(page.day,'Monday');assert.equal(page.date,'November 2');assert.equal(page.place,'Boston, MA');
  assert.equal(page.weather.current,45);
  assert.equal(page.weather.week.length,7);
  assert.equal(page.updated,'');assert.equal(page.message,undefined);
});

test('stale data stays on screen with when it was updated and why it did not refresh',()=>{
  const page=buildWeather(saved({at:now.valueOf()-2*3600000,error:'network'}),settings,{now,timezone:zone});
  assert.equal(page.weather.high,54);
  assert.equal(page.updated,'Updated 2 hr ago · Couldn’t refresh. Open-Meteo could not be reached.');
  const quiet=buildWeather(saved({at:now.valueOf()-30*60000}),settings,{now,timezone:zone});
  assert.equal(quiet.updated,'','Half an hour old is still current');
  const recent=buildWeather(saved({at:now.valueOf()-21*60000,error:'timeout'}),settings,{now,timezone:zone});
  assert.equal(recent.updated,'','A failed refresh of recent data stays quiet');
  const lostRecent=buildWeather(saved({at:now.valueOf()-21*60000,error:'unknown-city'}),settings,{now,timezone:zone});
  assert.equal(lostRecent.updated,'');
  const lostOld=buildWeather(saved({at:now.valueOf()-2*3600000,error:'unknown-city'}),settings,{now,timezone:zone});
  assert.equal(lostOld.updated,'Updated 2 hr ago · Couldn’t find the city');
});

test('no forecast, no city or an unknown city each say so plainly, never with sample data',()=>{
  const down=buildWeather({weather:{value:null,at:null,error:'timeout',loading:false}},settings,{now,timezone:zone});
  assert.deepEqual(down.message,{title:'Weather is unavailable',detail:'Open-Meteo did not respond in time.'});
  assert.equal(down.weather,undefined);
  const loading=buildWeather({weather:{value:null,at:null,error:null,loading:true}},settings,{now,timezone:zone});
  assert.equal(loading.message.detail,'The saved forecast is out of date.','A first load returns 202 before this point, so there is no loading message');
  const lost=buildWeather({weather:{value:null,at:null,error:'unknown-city',loading:false}},weatherSettings({city:'Atlantis, XX'}),{now,timezone:zone});
  assert.equal(lost.message.detail,'Couldn’t find “Atlantis, XX”. Check the city in this layout’s settings.');
  const none=buildWeather({weather:null},weatherSettings({}),{now,timezone:zone});
  assert.equal(none.message.title,'No city set');
  const old=buildWeather({weather:{value:sampleForecast(now,zone),at:now.valueOf(),error:null,loading:false}},settings,{now:new Date(now.valueOf()+20*86400000),timezone:zone});
  assert.equal(old.message.detail,'The saved forecast is out of date.');
});

test('range bars share one scale for the week, and today marks the temperature now',()=>{
  const week=[{name:'Today',low:40,high:50},{name:'Tue',low:30,high:60},{name:'Wed',low:45,high:45}];
  const bars=rangeBars(week,{current:45});
  assert.deepEqual(bars.map(day=>[Math.round(day.bar.left),Math.round(day.bar.width)]),[[33,33],[0,100],[50,4]]);
  assert.equal(rangeBars([{name:'Tue',low:60,high:60},{name:'Wed',low:30,high:60}])[0].bar.left,96,'A short bar still fits in the track');
  assert.equal(bars[0].bar.now,50);
  assert.equal('now' in bars[1].bar,false);
  assert.deepEqual(rangeBars([]),[]);
});

test('bar colors run from cold blue to warm apricot in either unit',()=>{
  assert.equal(temperatureColor(0),'#9cbee2');
  assert.equal(temperatureColor(50),'#c8deb2');
  assert.equal(temperatureColor(10,'celsius'),temperatureColor(50));
  assert.equal(temperatureColor(120),'#e89276');
  assert.match(temperatureColor(71),/^#[0-9a-f]{6}$/);
});

test('show_art off removes the artwork; a mat keeps the content in the opening',()=>{
  const forecast=buildWeather(saved(),settings,{now,timezone:zone});
  const art={image:'/dayframe-art.jpg',image_data:'AAAA',title:'Art'};
  const shown=presentPage({now:now.toISOString(),art,display_settings:{show_art:true}},forecast);
  assert.equal(shown.art.image,'/dayframe-art.jpg');
  assert.equal('image_data' in shown.art,false,'Base64 artwork stays out of the page model');
  assert.equal(presentPage({art,display_settings:{show_art:false}},forecast).art,null);
  assert.equal(presentPage({art:{image:'https://elsewhere.example/a.jpg'}},forecast).art,null,'Only host-served artwork');
  const mat=presentPage({display:{width:3840,height:2160},art:{...art,viewport:{x:384,y:216,width:3072,height:1728}}},forecast);
  assert.deepEqual(mat.layout.style,{'--content-x':'10%','--content-y':'10%','--content-width':'80%','--content-height':'80%','--content-scale':'0.8'});
});

test('the dev sample renders through the real cache path without fetching',async()=>{
  const snapshot={now:'2026-11-02T08:15:00-05:00',timezone:zone,display_settings:{show_art:true},art:{image:'/dayframe-art.jpg'}};
  const page=await weatherPage(snapshot,sampleConfig,{cache:sampleCache(new Date(snapshot.now),zone),waitMs:0});
  assert.equal(page.forecast.place,'Boston, MA');
  assert.equal(page.forecast.weather.week[0].bar.now>0,true);
  const stale=await weatherPage(snapshot,sampleConfig,{cache:sampleCache(new Date(snapshot.now),zone,{stale:true}),waitMs:0});
  assert.match(stale.forecast.updated,/^Updated 3 hr ago · Couldn’t refresh\./);
  const failed=await weatherPage(snapshot,sampleConfig,{cache:sampleCache(new Date(snapshot.now),zone,{failed:true}),waitMs:0});
  assert.equal(failed.forecast.message.title,'Weather is unavailable');
});
