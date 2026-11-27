import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {weatherView,pruneForecast,conditions,clockLabel,forecastUrl,maxHours} from '../src/server/weather.mjs';
import {sampleForecast} from '../src/server/sample.mjs';

const zone='America/New_York';
const fixture=JSON.parse(await fs.readFile(new URL('../src/fixtures/sample-forecast.json',import.meta.url),'utf8'));
// 8:15 AM local on the fixture's first day (EST).
const morning=new Date('2026-11-02T13:15:00Z');

test('the fixture is a believable Boston week, and pruning keeps every field the page shows',()=>{
  const raw=pruneForecast(fixture);
  assert.equal(raw.daily.time.length,8);
  assert.equal(raw.hourly.time.length,48);
  for (const key of ['temperature_2m_max','temperature_2m_min','precipitation_probability_max','sunrise','sunset','weather_code']) assert.equal(raw.daily[key].length,8,key);
  for (const key of ['temperature_2m','apparent_temperature','weather_code','precipitation_probability','is_day']) assert.equal(raw.hourly[key].length,48,key);
  raw.daily.temperature_2m_max.forEach((high,index)=>assert.ok(high>raw.daily.temperature_2m_min[index] && high<70 && raw.daily.temperature_2m_min[index]>25,'November in Boston'));
  const dirty=pruneForecast({current:{temperature_2m:'hot',time:'<b>'},daily:{time:['2026-11-02','nope'],sunrise:['javascript:x']},hourly:{time:Array(500).fill('2026-11-02T00:00')}});
  assert.equal(dirty.current.temperature_2m,null);assert.equal(dirty.current.time,null);
  assert.deepEqual(dirty.daily.time,['2026-11-02',null]);assert.deepEqual(dirty.daily.sunrise,[null]);
  assert.equal(dirty.hourly.time.length,96,'Arrays are bounded');
});

test('the forecast request asks one fixed host for eight days in local time',()=>{
  const url=new URL(forecastUrl({latitude:42.36,longitude:-71.06},{units:'celsius',timezone:zone}));
  assert.equal(url.origin,'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('forecast_days'),'8');
  assert.equal(url.searchParams.get('timezone'),zone);
  assert.equal(url.searchParams.get('temperature_unit'),'celsius');
  assert.match(url.searchParams.get('daily'),/sunrise,sunset/);
  assert.match(url.searchParams.get('hourly'),/precipitation_probability/);
});

test('the day: now, feels like, high and low, rain chance, sunrise and sunset',()=>{
  const view=weatherView(pruneForecast(fixture),{now:morning,timezone:zone});
  assert.equal(view.current,45);assert.equal(view.feels,40);
  assert.equal(view.label,'Mostly clear');assert.equal(view.icon,'sun');
  assert.equal(view.high,54);assert.equal(view.low,41);assert.equal(view.rain,10);assert.equal(view.rainLabel,'Rain');
  assert.equal(view.sunrise,'6:23 AM');assert.equal(view.sunset,'4:34 PM');
  assert.equal(view.unit,'F');
});

test('the hourly strip covers the rest of the morning and runs into tomorrow in the evening',()=>{
  const raw=pruneForecast(fixture);
  const view=weatherView(raw,{now:morning,timezone:zone});
  assert.deepEqual(view.hours.map(hour=>hour.time),['9 AM','11 AM','1 PM','3 PM','5 PM','7 PM','9 PM','11 PM']);
  assert.deepEqual(view.hours.map(hour=>hour.temperature),[46,50,53,54,50,48,47,46]);
  assert.equal(view.hours.every(hour=>!hour.later),true);
  assert.equal(view.hours.at(-1).rain,55);
  const evening=weatherView(raw,{now:new Date('2026-11-03T00:40:00Z'),timezone:zone,fetchedAt:morning.valueOf()});
  assert.deepEqual(evening.hours.map(hour=>hour.time),['8 PM','10 PM','12 AM','2 AM','4 AM','6 AM','8 AM','10 AM']);
  assert.deepEqual(evening.hours.map(hour=>hour.day),['','','Tue','','','','','']);
  assert.equal(evening.hours[2].later,true);
  assert.equal(evening.current,48,'An old reading gives way to this hour’s forecast');
});

test('night hours get night icons',()=>{
  const raw=pruneForecast(fixture);
  raw.hourly.weather_code[22]=0;
  const view=weatherView(raw,{now:new Date('2026-11-03T00:40:00Z'),timezone:zone,fetchedAt:morning.valueOf()});
  assert.equal(view.hours[1].icon,'moon');assert.equal(view.hours[1].label,'Clear');
  assert.deepEqual(conditions(2,{day:false}),{label:'Partly cloudy',icon:'partly-night'});
  assert.deepEqual(conditions(0),{label:'Sunny',icon:'sun'});
  assert.equal(conditions(86).icon,'snow');assert.equal(conditions(66).icon,'sleet');assert.equal(conditions(null).label,'Conditions unavailable');
});

test('the week starts today and shows seven days',()=>{
  const view=weatherView(pruneForecast(fixture),{now:morning,timezone:zone});
  assert.deepEqual(view.week.map(day=>day.name),['Today','Tue','Wed','Thu','Fri','Sat','Sun']);
  assert.deepEqual(view.week.map(day=>[day.low,day.high]),[[41,54],[44,51],[40,49],[35,47],[37,52],[44,58],[46,56]]);
  assert.deepEqual(view.week.map(day=>day.rain),[10,85,40,0,5,10,20]);
  assert.equal(view.week[1].label,'Rain');
});

test('after midnight a saved forecast moves on a day; an old one is not shown as today',()=>{
  const raw=pruneForecast(fixture);
  const tomorrow=weatherView(raw,{now:new Date('2026-11-03T14:00:00Z'),timezone:zone,fetchedAt:morning.valueOf()});
  assert.equal(tomorrow.high,51);
  assert.equal(tomorrow.week[0].name,'Today');assert.equal(tomorrow.week.length,7,'Eight days cover a one-day-old forecast');
  assert.equal(weatherView(raw,{now:new Date('2026-11-20T14:00:00Z'),timezone:zone,fetchedAt:morning.valueOf()}),null);
});

test('celsius and the 12-hour clock',()=>{
  const view=weatherView(sampleForecast(morning,zone,{units:'celsius'}),{now:morning,timezone:zone,units:'celsius'});
  assert.equal(view.unit,'C');assert.equal(view.high,12);assert.equal(view.current,7);
  assert.equal(view.hours[0].time,'9 AM','12-hour clock in every unit, like morning and news');
  assert.equal(clockLabel('2026-11-02T00:05'),'12:05 AM');assert.equal(clockLabel('2026-11-02T12:30'),'12:30 PM');assert.equal(clockLabel(null),'');
});

test('the sample forecast moves to any day and follows the hour',()=>{
  const later=new Date('2026-12-15T20:10:00Z');
  const raw=sampleForecast(later,zone);
  assert.equal(raw.daily.time[0],'2026-12-15');
  assert.equal(raw.daily.sunrise[0],'2026-12-15T06:23');
  assert.equal(raw.current.temperature_2m,fixture.hourly.temperature_2m[15]);
  const view=weatherView(raw,{now:later,timezone:zone});
  assert.equal(view.week[0].name,'Today');assert.equal(view.week[1].name,'Wed');
});

test('a forecast saved late yesterday still fills the hourly strip this evening',()=>{
  // Open-Meteo's hourly data starts at midnight of the first day: 8 days of hours.
  const hours=[];
  for (let day=0;day<8;day++) for (let hour=0;hour<24;hour++) hours.push(`2026-11-${String(2+day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00`);
  const days=Array.from({length:8},(_,index)=>`2026-11-${String(2+index).padStart(2,'0')}`);
  const full={
    current:{time:'2026-11-02T21:00',temperature_2m:44,apparent_temperature:40,weather_code:0,is_day:0},
    daily:{time:days,weather_code:days.map(()=>1),temperature_2m_max:days.map(()=>55),temperature_2m_min:days.map(()=>40),precipitation_probability_max:days.map(()=>10),
      sunrise:days.map(day=>day+'T06:23'),sunset:days.map(day=>day+'T16:34')},
    hourly:{time:hours,temperature_2m:hours.map(()=>45),apparent_temperature:hours.map(()=>41),weather_code:hours.map(()=>2),precipitation_probability:hours.map(()=>0),is_day:hours.map(()=>1)},
  };
  const raw=pruneForecast(full);
  assert.equal(raw.hourly.time.length,maxHours);
  // Fetched 9 PM day 1, shown 8 PM day 2 (EST is UTC-5).
  const view=weatherView(raw,{now:new Date('2026-11-04T01:00:00Z'),timezone:zone,fetchedAt:Date.parse('2026-11-03T02:00:00Z')});
  assert.equal(view.hours.length,8);
  assert.deepEqual(view.hours.map(hour=>hour.time),['9 PM','11 PM','1 AM','3 AM','5 AM','7 AM','9 AM','11 AM']);
  // Two saved forecasts stay far below the cache file's 1 MB limit.
  const entry={at:0,value:raw,failed_at:null,failures:0,error:null};
  assert.ok(JSON.stringify({version:1,weather:{a:entry,b:entry}}).length<50_000);
});
