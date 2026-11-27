import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CalendarProjector,projectCalendar} from '../server/ical-projection.mjs';
import {parseCalendar} from '../server/calendar-worker.mjs';
const wrap=body=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Work\r\n'+body+'\r\nEND:VCALENDAR\r\n';
const event=(id,date,extra='')=>`BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:${date}T130000Z\r\nDTEND:${date}T140000Z\r\nSUMMARY:Meeting ${id}\r\n${extra}END:VEVENT`;

test('streaming keeps calendar fields, folded Unicode names and timezone components, dropping notes and alarms',()=>{
 const zone='BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n';
 const source=Buffer.from('\uFEFF'+wrap(zone+event('current','20261026','DESCRIPTION:PRIVATE NOTES\r\n hidden continuation\r\nATTENDEE:PRIVATE EMAIL\r\nBEGIN:VALARM\r\nDESCRIPTION:PRIVATE ALARM\r\nEND:VALARM\r\n')).replace('SUMMARY:Meeting current','SUMMARY:Afternoon ca\r\n fé'));
 const projector=new CalendarProjector();for(let i=0;i<source.length;i+=7)projector.write(source.subarray(i,i+7));
 const output=projector.finish();assert.match(output,/SUMMARY:Afternoon café/);assert.match(output,/BEGIN:VTIMEZONE/);assert.match(output,/X-WR-CALNAME:Work/);assert.doesNotMatch(output,/PRIVATE|VALARM|ATTENDEE|DESCRIPTION/);
});

test('date projection keeps relevant spans, recurrence definitions and moved overrides',()=>{
 const source=wrap([event('old','20100101'),event('current','20261026'),event('future','20271026'),event('series','20100101','RRULE:FREQ=DAILY\r\n'),event('series','20271026','RECURRENCE-ID:20261026T130000Z\r\n'),event('duration','20260101','DURATION:P365D\r\n')].join('\r\n'));
 const output=projectCalendar(source,['2026-10-26']);
 assert.doesNotMatch(output,/UID:old|UID:future/);for(const id of ['current','series','duration'])assert.match(output,new RegExp('UID:'+id));
 assert.match(output,/RECURRENCE-ID:20261026/);
});

test('stream projection and date projection retain recurrence/DST and exclusive all-day behavior',async()=>{
 const source=wrap('BEGIN:VEVENT\r\nUID:repeat\r\nDTSTART;TZID=America/New_York:20261025T090000\r\nDTEND;TZID=America/New_York:20261025T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Weekly\r\nEND:VEVENT');
 const result=await parseCalendar({text:source,days:['2026-11-01'],timezone:'America/New_York',name:'',color:'#af2842',now:'2026-11-01T12:00:00Z'});
 assert.equal(result.events['2026-11-01'][0].time,'09:00 – 10:00');assert.equal(result.name,'Work');
});

test('projection rejects malformed structure and bounds retained display data',()=>{
 assert.throws(()=>projectCalendar('not a calendar',['2026-10-26']),error=>error.code==='invalid-feed');
 assert.throws(()=>projectCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR',[]),error=>error.code==='invalid-feed');
 const small=new CalendarProjector({maxBytes:40});assert.throws(()=>{small.write(Buffer.from(wrap(event('one','20261026'))));small.finish();},error=>error.code==='projection-limit');
});
