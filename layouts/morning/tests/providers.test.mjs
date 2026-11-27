import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCalendar } from '../server/calendar-worker.mjs';
import { displayDays, dashboard, calendar } from '../src/server/dashboard.mjs';
import { weatherData } from '../src/server/weather.mjs';
import { publicAddress, validateUrl, cached, ProviderError, fetchText } from '../src/server/fetch.mjs';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';

const wrap=body=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const event=body=>`BEGIN:VEVENT\r\nUID:example\r\n${body}\r\nEND:VEVENT`;
const parse=(text,days=['2026-10-26'])=>parseCalendar({text,days,timezone:'America/New_York',name:'Work',color:'maroon',now:'2026-10-26T12:00:00Z'}).then(result=>result.events);

test('today/weekend dates and calendar timezone boundaries',async()=>{
  assert.deepEqual(displayDays('2026-11-01'),['2026-10-31','2026-11-01']);
  const result=await parse(wrap(event('DTSTART:20261027T010000Z\r\nDTEND:20261027T020000Z\r\nSUMMARY:Locally Monday')));
  assert.equal(result['2026-10-26'][0].time,'21:00 – 22:00');
});

test('cancelled recurrence overrides and exclusive midnight ends stay absent',async()=>{
  const text=wrap(event('DTSTART;TZID=America/New_York:20261025T090000\r\nDTEND;TZID=America/New_York:20261025T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Daily')+'\r\n'+event('RECURRENCE-ID;TZID=America/New_York:20261026T090000\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T100000\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled'));
  assert.deepEqual((await parse(text))['2026-10-26'],[]);
  const midnight=wrap(event('DTSTART;TZID=America/New_York:20261025T230000\r\nDTEND;TZID=America/New_York:20261026T000000\r\nSUMMARY:Ended yesterday'));
  assert.deepEqual((await parse(midnight))['2026-10-26'],[]);
});

test('all-day exclusive end matches in local development and UTC containers',async()=>{
  const previous=process.env.TZ;
  try {
    for(const tz of ['America/New_York','UTC']) {
      process.env.TZ=tz;
      const result=await parse(wrap(event('DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101\r\nSUMMARY:Trip')),['2026-10-31','2026-11-01']);
      assert.equal(result['2026-10-31'].length,1);
      assert.equal(result['2026-11-01'].length,0);
    }
  } finally { if(previous==null) delete process.env.TZ; else process.env.TZ=previous; }
});

test('weekly recurrence stays at local time over daylight saving',async()=>{
  const text=wrap(event('DTSTART;TZID=America/New_York:20261025T090000\r\nDTEND;TZID=America/New_York:20261025T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Weekly'));
  const result=await parse(text,['2026-10-31','2026-11-01']);
  assert.equal(result['2026-11-01'][0].time,'09:00 – 10:00');
});

test('weather uses preceding-hour amounts and separates showers; null is unavailable',()=>{
  const result=weatherData({current:{temperature_2m:50,relative_humidity_2m:68},daily:{temperature_2m_max:[62],temperature_2m_min:[40],sunset:['2026-10-26T17:45'],precipitation_probability_max:[70]},hourly:{time:['2026-10-26T09:00','2026-10-26T10:00','2026-10-26T11:00','2026-10-26T12:00'],rain:[.2,.1,0,.3],showers:[0,0,0,0]}},'2026-10-26','08:30','Home','fahrenheit');
  assert.equal(result.current,50); assert.equal(result.sunset,'17:45');
  assert.deepEqual(result.rain_windows,[{start:'08:00',end:'10:00',ongoing:true},{start:'11:00',end:'12:00',ongoing:false}]);
  assert.equal(weatherData({},'2026-10-26','08:00','Home','fahrenheit').current,null);
});

test('provider URLs and resolved addresses cannot target private services',()=>{
  for(const url of ['http://api.open-meteo.com','https://secret@api.open-meteo.com/','https://api.open-meteo.com:8443/','https://127.0.0.1/']) assert.throws(()=>validateUrl(url,['api.open-meteo.com']));
  for(const address of ['127.0.0.1','192.168.1.70','169.254.169.254','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(address),false);
  assert.equal(publicAddress('8.8.8.8'),true);
});

test('provider failures remain explicit and exclude private links from snapshots',async()=>{
  const base={now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}};
  const result=await dashboard(base,{work_calendar_url:'https://127.0.0.1/SECRET-FEED'});
  assert.deepEqual(result.planner.plan.errors,['Work calendar is unavailable']);
  assert.equal(result.planner.plan.calendar_connected,true);
  assert.equal(result.planner.plan.calendar_unavailable,true);
  assert.doesNotMatch(JSON.stringify(result),/SECRET-FEED/);
  assert.equal(base.planner,undefined);
});

test('cached provider requests coalesce and failed values can be retried',async()=>{
  let calls=0;
  await Promise.all([cached('example',60,async()=>++calls),cached('example',60,async()=>++calls)]);
  assert.equal(calls,1);
  await assert.rejects(cached('retry',60,async()=>{throw new Error('PRIVATE');}),/Provider unavailable/);
  assert.equal(await cached('retry',60,async()=>42),42);
});

test('the layout fetches a Google feed and parses it in the bounded worker',async(t)=>{
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    assert.equal(url.hostname,'calendar.google.com');
    assert.equal(options.servername,'calendar.google.com');
    const request=new EventEmitter();
    queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=200;
      receive(response);
      response.emit('data',Buffer.from(wrap(event('DTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T100000\r\nSUMMARY:Real parser path'))));
      response.emit('end');
    });
    return request;
  });
  const result=await dashboard({now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}},{work_calendar_url:'https://calendar.google.com/SYNTHETIC-WORKER-FEED'});
  assert.deepEqual(result.planner.plan.errors,[]);
  assert.equal(result.planner.plan.today[0].title,'Real parser path');
  assert.equal(result.planner.plan.today[0].time,'09:00 – 10:00');
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-WORKER-FEED/);
});


test('calendars use feed names, title overrides, custom colors, and safe fallback names',async()=>{
  const text=wrap('X-WR-CALNAME:Shared Home\r\n'+event('DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z\r\nSUMMARY:Visit'));
  const base={text,days:['2026-10-26'],timezone:'America/New_York',color:'#8850a8',now:'2026-10-26T12:00:00Z'};
  const inferred=await parseCalendar({...base,name:''});
  assert.equal(inferred.name,'Shared Home');
  assert.equal(inferred.events['2026-10-26'][0].calendar,'Shared Home');
  assert.equal(inferred.events['2026-10-26'][0].color,'#8850a8');
  assert.equal((await parseCalendar({...base,name:'Our plans'})).name,'Our plans');
  assert.equal((await parseCalendar({...base,text:wrap(''),name:''})).name,'Calendar');
});

test('three independently named feeds merge and empty calendars retain their legend',async(t)=>{
  const names=['Home','School','Holidays'];
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    const index=Number(url.pathname.at(-1));
    const request=new EventEmitter();
    queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=200;receive(response);
      response.emit('data',Buffer.from(wrap(`X-WR-CALNAME:${names[index]}\r\n`+(index===2 ? '' : event(`DTSTART:20261026T${index===0?'14':'13'}0000Z\r\nDTEND:20261026T150000Z\r\nSUMMARY:Plan ${index}`)))));
      response.emit('end');
    });
    return request;
  });
  const calendars=names.map((_,i)=>({id:`feed-${i}`,title:i===1?'Kids':'',url:`https://calendar.google.com/SYNTHETIC-MULTI-${i}`,color:['#af2842','#8850a8','#123456'][i]}));
  const result=await dashboard({now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}},{calendars});
  assert.deepEqual(result.planner.plan.calendars.map(item=>item.name),['Home','Kids','Holidays']);
  assert.deepEqual(result.planner.plan.today.map(item=>item.calendar),['Kids','Home']);
  assert.deepEqual(result.planner.plan.calendars.map(item=>item.color),['#af2842','#8850a8','#123456']);
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-MULTI/);
});

test('an explicitly empty calendar list does not revive legacy links',async()=>{
  const result=await dashboard({now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}},{calendars:[],work_calendar_url:'https://127.0.0.1/OLD-SECRET'});
  assert.equal(result.planner.plan.calendar_connected,false);
  assert.deepEqual(result.planner.plan.errors,[]);
});


test('provider errors expose only fixed reasons and preserve them across cache failures',async()=>{
  for(const [url,code] of [['not-a-link','invalid-address'],['https://example.com/SECRET','unsupported-address']]) {
    assert.throws(()=>validateUrl(url,['calendar.google.com']),error=>error.code===code && !error.message.includes('SECRET'));
  }
  await assert.rejects(cached('fixed-reason',60,async()=>{throw new ProviderError('access-denied');}),error=>error.code==='access-denied');
  const failed=await dashboard({now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}},{calendars:[{id:'private',url:'not-a-valid-link-SECRET',title:'Work',color:'#af2842'}]});
  assert.equal(failed.planner.plan.calendars[0].status,'unavailable');
  assert.equal(failed.planner.plan.calendars[0].issue,'invalid-address');
  assert.doesNotMatch(JSON.stringify(failed),/valid-link-SECRET/);
});


test('background calendar download allows a longer headers wait and reports timeout phase without a fake HTTP status',async(t)=>{
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  let requested;
  t.mock.method(AbortSignal,'timeout',milliseconds=>{
    requested=milliseconds;const controller=new AbortController();setTimeout(()=>controller.abort(),10);return controller.signal;
  });
  t.mock.method(https,'get',(url,options)=>{
    const request=new EventEmitter();
    queueMicrotask(()=>{const socket=new EventEmitter();request.emit('socket',socket);socket.emit('connect');socket.emit('secureConnect');});
    options.signal.addEventListener('abort',()=>request.emit('error',Object.assign(new Error('URL-AND-TOKEN-PRIVATE'),{code:'ABORT_ERR'})));
    return request;
  });
  await assert.rejects(calendar('https://calendar.google.com/SYNTHETIC-SLOW-FEED',['2026-10-26'],'America/New_York','Work','#af2842','2026-10-26T12:00:00Z'),error=>error.code==='timeout' && error.phase==='headers' && error.status===undefined && !error.message.includes('PRIVATE'));
  assert.equal(requested,90000);
});

test('provider HTTP rejection retains status without returning provider body or URL',async(t)=>{
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    const request=new EventEmitter();queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=403;response.destroy=()=>{};receive(response);});return request;
  });
  const result=await dashboard({now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{}},{calendars:[{title:'Work',url:'https://calendar.google.com/SYNTHETIC-FORBIDDEN'}]});
  const failed=result.planner.plan.calendars[0];
  assert.equal(failed.http_status,403);assert.equal(failed.issue,'access-denied');assert.equal(failed.phase,'headers');
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-FORBIDDEN/);
});

test('expired overall calendar budget does not start another request',async(t)=>{
  t.mock.method(https,'get',()=>assert.fail('No request after deadline'));
  await assert.rejects(calendar('https://calendar.google.com/SHOULD-NOT-FETCH',['2026-10-26'],'UTC','','#af2842','2026-10-26T12:00:00Z',{deadline:Date.now()-1}),error=>error.code==='timeout');
});


test('a retry preserves the last failure instead of reporting perpetual initial syncing',async(t)=>{
 let clock=1000000,requests=0;
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 t.mock.method(https,'get',()=>{
  const request=new EventEmitter();
  if(++requests===1)queueMicrotask(()=>request.emit('error',Object.assign(new Error('private transport detail'),{code:'ECONNRESET'})));
  return request;
 });
 const args=['https://calendar.google.com/SYNTHETIC-RETRY-ERROR',['2026-10-26'],'America/New_York','Work','#af2842','2026-10-26T12:00:00Z'];
 await assert.rejects(calendar(...args),error=>error.code==='network');
 clock+=60001;
 await assert.rejects(calendar(...args),error=>error.code==='network' && error.transport==='ECONNRESET');
 assert.equal(requests,2);
});


test('our body-size cutoff stays too-large even when destroy emits a request error first',async(t)=>{
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 t.mock.method(https,'get',(url,options,receive)=>{
  const request=new EventEmitter();queueMicrotask(()=>{
   const response=new EventEmitter();response.statusCode=200;response.headers={'content-length':'9'};
   response.destroy=()=>{request.emit('error',new Error('PRIVATE-RAW-ERROR'));response.emit('error',new Error('PRIVATE-RAW-ERROR'));};
   receive(response);response.emit('data',Buffer.alloc(9));
  });return request;
 });
 await assert.rejects(fetchText('https://calendar.google.com/PRIVATE-SIZE',['calendar.google.com'],8),error=>error.code==='too-large' && error.status===200 && error.received_bytes===9 && error.limit_bytes===8 && error.content_length===9 && !error.message.includes('PRIVATE'));
});

test('an interrupted body preserves bytes and transport but never returns partial calendar text',async(t)=>{
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 t.mock.method(https,'get',(url,options,receive)=>{
  const request=new EventEmitter();queueMicrotask(()=>{
   const response=new EventEmitter();response.statusCode=200;response.headers={'content-length':'8'};
   receive(response);response.emit('data',Buffer.from('abc'));response.emit('error',Object.assign(new Error('PRIVATE-RAW-ERROR'),{code:'ECONNRESET'}));
  });return request;
 });
 await assert.rejects(fetchText('https://calendar.google.com/PRIVATE-INTERRUPT',['calendar.google.com'],8),error=>error.code==='network' && error.status===200 && error.phase==='body' && error.transport==='ECONNRESET' && error.received_bytes===3 && error.limit_bytes===8);
});


test('a full corporate-size export streams down to compact fields before bounded day parsing',async(t)=>{
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 const old=Array.from({length:12789},(_,i)=>`BEGIN:VEVENT\r\nUID:old-${i}\r\nDTSTART:20100101T130000Z\r\nDTEND:20100101T140000Z\r\nSUMMARY:Historical ${i}\r\nDESCRIPTION:${'PRIVATE-NOTES '.repeat(150)}\r\nEND:VEVENT`).join('\r\n');
 const source=Buffer.from(wrap(old+'\r\n'+event('DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z\r\nSUMMARY:Current appointment')));
 assert.ok(source.length>25000000);
 t.mock.method(https,'get',(url,options,receive)=>{
  const request=new EventEmitter();queueMicrotask(()=>{
   const response=new EventEmitter();response.statusCode=200;response.complete=true;response.headers={'content-length':String(source.length)};
   response.destroy=()=>request.emit('error',new Error('unexpected cutoff'));
   receive(response);for(let i=0;i<source.length;i+=16384)response.emit('data',source.subarray(i,i+16384));response.emit('end');
  });return request;
 });
 const result=await calendar('https://calendar.google.com/SYNTHETIC-CORPORATE-SIZE',['2026-10-26'],'America/New_York','Work','#af2842','2026-10-26T12:00:00Z');
 assert.equal(result.events['2026-10-26'].length,1);assert.equal(result.events['2026-10-26'][0].title,'Current appointment');assert.doesNotMatch(JSON.stringify(result),/PRIVATE-NOTES|Historical/);
});

test('cached parsed events update their past state on each render',async(t)=>{
 let requests=0;
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
 t.mock.method(https,'get',(url,options,receive)=>{
  requests++;const request=new EventEmitter();queueMicrotask(()=>{
   const response=new EventEmitter();response.statusCode=200;response.complete=true;receive(response);
   response.emit('data',Buffer.from(wrap(event('DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z\r\nSUMMARY:Cached timing event'))));response.emit('end');
  });return request;
 });
 const args=['https://calendar.google.com/SYNTHETIC-PAST-CACHE',['2026-10-26'],'America/New_York','Work','#af2842'];
 assert.equal((await calendar(...args,'2026-10-26T12:00:00Z')).events['2026-10-26'][0].past,false);
 assert.equal((await calendar(...args,'2026-10-26T15:00:00Z')).events['2026-10-26'][0].past,true);assert.equal(requests,1);
});
