import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mergeHeadlines,buildNews,timeAgo,presentPage,newsPage} from '../src/server/page.mjs';
import {weatherView} from '../src/server/weather.mjs';
import {fitPage,opening} from '../src/server/view.mjs';
import {sampleCache,sampleConfig,sampleForecast,sampleCacheState} from '../src/server/sample.mjs';
import {newsSettings} from '../src/server/settings.mjs';

const now=Date.parse('2026-11-01T12:00:00Z');
const item=(title,minutes,source='Daily Example')=>({title,source,published_at:new Date(now-minutes*60000).toISOString()});
const feed=(label,values,extra={})=>({label,url:'https://news.google.com/rss?'+label,value:values,at:now-5*60000,error:null,loading:false,...extra});

test('time ago reads naturally',()=>{
  assert.equal(timeAgo(now-20000,now),'Just now');
  assert.equal(timeAgo(now-12*60000,now),'12 min ago');
  assert.equal(timeAgo(now-3*3600000,now),'3 hr ago');
  assert.equal(timeAgo(now-30*3600000,now),'Yesterday');
  assert.equal(timeAgo(now-80*3600000,now),'3 days ago');
});

test('topics merge into one list, taking turns, without repeats or old stories',()=>{
  const merged=mergeHeadlines([
    feed('Top stories',[item('Shared story',5),item('Top two',30),item('Top three',60)]),
    feed('Science',[item('Shared  story!',8),item('Science two',40),item('Very old',5000)]),
  ],{count:5,now});
  assert.deepEqual(merged.map(entry=>entry.title),['Shared story','Top two','Science two','Top three']);
  assert.deepEqual(merged.map(entry=>entry.topic),['Top stories','Top stories','Science','Top stories']);
  assert.equal(merged[0].age,'5 min ago');
  const single=mergeHeadlines([feed('Top stories',Array.from({length:10},(_,index)=>item('Story '+index,index)))],{count:6,now});
  assert.equal(single.length,6);
  assert.equal(single[0].topic,'','One topic needs no label');
});

test('failures show what still works and say what failed',()=>{
  const settings=newsSettings({headline_count:'6'});
  const news=buildNews({feeds:[feed('Top stories',[item('Works',5)]),feed('Sports',null,{at:null,error:'timeout'})],weather:null},settings,{now:new Date(now),timezone:'America/New_York'});
  assert.deepEqual(news.headlines.map(entry=>entry.title),['Works']);
  assert.deepEqual(news.status,{title:'Sports couldn’t load',detail:'Google News did not respond in time.'});
  assert.equal(news.weather,null);
  assert.equal(news.day,'Sunday');assert.equal(news.date,'November 1');
  const down=buildNews({feeds:[feed('Top stories',null,{at:null,error:'network'})],weather:{value:null,at:null,error:'network',loading:false}},newsSettings({city:'Boston, MA'}),{now:new Date(now),timezone:'America/New_York'});
  assert.deepEqual(down.status,{title:'Headlines couldn’t load',detail:'Google News could not be reached.'});
  assert.equal(down.empty,'','One message, not two');
  assert.deepEqual(down.weather,{unavailable:true,location:'Boston, MA',message:'Weather is unavailable.'});
  assert.equal(JSON.stringify(down).includes('Sample'),false,'No invented data');
});

test('when every topic fails, one message says so',()=>{
  const news=buildNews({feeds:[feed('Top stories',null,{at:null,error:'timeout'}),feed('Science',null,{at:null,error:'network'})],weather:null},newsSettings({}),{now:new Date(now),timezone:'America/New_York'});
  assert.deepEqual(news.status,{title:'Headlines couldn’t load',detail:'Google News did not respond in time.'});
  assert.equal(news.empty,'');
  assert.deepEqual(news.headlines,[]);
  assert.doesNotMatch(JSON.stringify(news),/Showing the topics that loaded|Headlines are unavailable/);
});

test('stale data shows an updated marker instead of failing',()=>{
  const news=buildNews({feeds:[feed('Top stories',[item('Saved story',200)],{at:now-3*3600000,error:'network'})],weather:{value:sampleForecast(new Date(now),'America/New_York'),at:now-2*3600000,error:'network',loading:false}},newsSettings({city:'Boston, MA'}),{now:new Date(now),timezone:'America/New_York'});
  assert.equal(news.updated,'Updated 3 hr ago');
  assert.equal(news.status.title,'Showing saved headlines');
  assert.match(news.status.detail,/Top stories couldn’t refresh\. Google News could not be reached\./);
  assert.equal(news.weather.updated,'Forecast updated 2 hr ago');
  const fresh=buildNews({feeds:[feed('Top stories',[item('New',2)])],weather:null},newsSettings({}),{now:new Date(now),timezone:'America/New_York'});
  assert.equal(fresh.updated,'');assert.equal(fresh.status,null);
});

test('weather reads today from a saved two-day forecast',()=>{
  const forecast=sampleForecast(new Date(now),'America/New_York');
  const view=weatherView(forecast,{now:new Date(now),timezone:'America/New_York',location:'Boston, MA'});
  assert.equal(view.high,62);assert.equal(view.low,42);
  assert.equal(typeof view.current,'number');
  assert.equal(view.hours.length,5);
  assert.deepEqual(view.hours.map(hour=>hour.time),['8 AM','11 AM','2 PM','5 PM','8 PM'],'Local 07:00 (EST), so the strip starts at 8 AM');
  const tomorrow=weatherView(forecast,{now:new Date(now+86400000),timezone:'America/New_York',fetchedAt:now});
  assert.equal(tomorrow.high,58,'After midnight the saved forecast uses the next day');
  assert.equal(weatherView(forecast,{now:new Date(now+3*86400000),timezone:'America/New_York',fetchedAt:now}),null,'An old forecast is not shown as today');
  assert.deepEqual(weatherView(forecast,{now:new Date(now),timezone:'America/New_York',units:'celsius'}).hours.map(hour=>hour.time),['8 AM','11 AM','2 PM','5 PM','8 PM'],'12-hour clock in every unit, like morning');
});

test('show_art off removes the artwork; a mat keeps the content in the opening',()=>{
  const news={headlines:[{title:'One',source:'A',age:'',topic:''}],status:null,updated:''};
  const art={image:'/dayframe-art.jpg',image_data:'AAAA',title:'Art'};
  const shown=presentPage({now:'2026-11-01T12:00:00Z',art,display_settings:{show_art:true}},news);
  assert.equal(shown.show_art,true);assert.equal(shown.art.image,'/dayframe-art.jpg');
  assert.equal('image_data' in shown.art,false,'Base64 artwork stays out of the page model');
  for (const display_settings of [{show_art:false}]) assert.equal(presentPage({art,display_settings},news).art,null);
  assert.equal(presentPage({art:{image:'https://elsewhere.example/a.jpg'}},news).art,null,'Only host-served artwork');
  const mat=presentPage({display:{width:3840,height:2160},art:{...art,viewport:{x:384,y:216,width:3072,height:1728}}},news);
  assert.deepEqual(mat.layout.style,{'--content-x':'10%','--content-y':'10%','--content-width':'80%','--content-height':'80%','--content-scale':'0.8','--row-pad':mat.layout.style['--row-pad']});
  assert.equal(opening({art:{viewport:{x:0,y:0,width:5000,height:10}}}),null,'An impossible viewport is ignored');
});

test('the layout fits eight long headlines on one page, dropping only what cannot fit',()=>{
  const long='A long headline that keeps going well past the width of one line on the screen';
  const headlines=Array.from({length:8},(_,index)=>({title:long+' '+index,source:'Source',age:'1 hr ago',topic:'Science'}));
  const fit=fitPage({headlines,status:null,updated:''},{});
  assert.equal(fit.count,8);
  assert.ok(fit.used<=fit.room);
  const crowded=fitPage({headlines,status:{title:'Sports couldn’t load',detail:'Google News did not respond in time.'},updated:'Updated 3 hr ago'},{art:{viewport:{x:960,y:540,width:1920,height:1080}}});
  assert.ok(crowded.count>=4 && crowded.used<=crowded.room);
});

test('the status block counts every line of a long title',()=>{
  const headlines=Array.from({length:8},(_,index)=>({title:'A long headline that keeps going well past the width of one line on the screen '+index,source:'Source',age:'1 hr ago',topic:'Search'}));
  const short={title:'Sports couldn’t load',detail:'Google News did not respond in time.'};
  const long={title:'Neighborhood school board budget meeting, Downtown farmers market vendor news +4 more couldn’t load',detail:short.detail};
  const one=fitPage({headlines,status:short,updated:''},{}),two=fitPage({headlines,status:long,updated:''},{});
  // Same headlines and detail: only the title differs, by one wrapped line (.9u × 1.25).
  const fixedOne=fitPage({headlines:[],status:short,updated:''},{}).used,fixedTwo=fitPage({headlines:[],status:long,updated:''},{}).used;
  assert.ok(Math.abs(fixedTwo-fixedOne-.9*1.25)<1e-9,`Expected one extra title line, got ${fixedTwo-fixedOne}`);
  assert.ok(two.used<=two.room && one.used<=one.room);
});

test('the stale sample ages its headlines with the saved data',()=>{
  const at=new Date('2026-11-02T13:15:00Z');
  const state=sampleCacheState(at,'America/New_York',{stale:true});
  for (const entry of Object.values(state.feeds)) for (const item of entry.value) assert.ok(Date.parse(item.published_at)<=entry.at,'Published before the saved copy');
  const fresh=sampleCacheState(at,'America/New_York');
  const first=Object.values(fresh.feeds)[0].value[0];
  assert.equal(at-Date.parse(first.published_at),22*60000);
});

test('the dev sample renders through the real cache path without fetching',async()=>{
  const snapshot={now:'2026-11-02T08:15:00-05:00',timezone:'America/New_York',display_settings:{show_art:true},art:{image:'/dayframe-art.jpg'}};
  const page=await newsPage(snapshot,sampleConfig,{cache:sampleCache(new Date(snapshot.now),snapshot.timezone),waitMs:0});
  assert.equal(page.news.headlines.length,7);
  assert.equal(page.news.heading,'Headlines');
  assert.equal(page.news.weather.location,'Boston, MA');
});
