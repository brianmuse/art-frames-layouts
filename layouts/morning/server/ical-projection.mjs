import {StringDecoder} from 'node:string_decoder';

const eventFields=new Set(['UID','DTSTART','DTEND','DURATION','SUMMARY','RRULE','RDATE','EXDATE','EXRULE','RECURRENCE-ID','STATUS','SEQUENCE']);
const calendarFields=new Set(['VERSION','PRODID','CALSCALE','METHOD','X-WR-CALNAME','X-WR-TIMEZONE','NAME']);
const property=line=>line.split(/[;:]/,1)[0].toUpperCase();
const fail=code=>{throw Object.assign(new Error('Calendar projection failed'),{code});};

export class CalendarProjector {
  constructor({days=[],maxBytes=8_000_000}={}) {
    this.decoder=new StringDecoder('utf8');this.maxBytes=maxBytes;
    this.buffer='';this.pending=null;this.stack=[];this.parts=[];this.bytes=0;this.event=null;this.seen=false;this.closed=false;this.initial=true;
    if(days.length) {
      const ordered=[...days].sort();
      const bound=(day,offset)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10).replaceAll('-','');};
      this.first=bound(ordered[0],-2);this.last=bound(ordered.at(-1),2);
    }
  }
  write(chunk) {
    this.buffer+=this.decoder.write(chunk);
    let end;
    while((end=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);this.line(line);
    }
    if(this.buffer.length>131072) fail('projection-limit');
  }
  line(line) {
    if(this.initial) {line=line.replace(/^\uFEFF/,'');this.initial=false;}
    if(line.startsWith(' ') || line.startsWith('\t')) {
      if(this.pending!==null) {
        this.pending+=line.slice(1);
        if(this.pending.length>131072) fail('projection-limit');
      }
      return;
    }
    this.flush();
    const key=property(line),top=this.stack.at(-1);
    this.pending=key==='BEGIN' || key==='END' || this.stack.includes('VTIMEZONE') ||
      top==='VEVENT' && eventFields.has(key) || top==='VCALENDAR' && calendarFields.has(key) ? line : null;
  }
  emit(line) {
    const value=line+'\r\n',bytes=Buffer.byteLength(value);
    if(this.event) {
      this.event.bytes+=bytes;if(this.event.bytes>this.maxBytes) fail('projection-limit');this.event.lines.push(value);
    } else {
      this.bytes+=bytes;if(this.bytes>this.maxBytes) fail('projection-limit');this.parts.push(value);
    }
  }
  flush() {
    const line=this.pending;this.pending=null;if(line===null || !line) return;
    const component=/^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if(component) {
      const action=component[1].toUpperCase(),name=component[2].toUpperCase();
      if(action==='BEGIN') {
        if(this.stack.length>=8 || !this.stack.length && (name!=='VCALENDAR' || this.closed)) fail('invalid-feed');
        this.stack.push(name);
        if(name==='VCALENDAR') this.seen=true;
        if(name==='VEVENT' && this.stack.length!==2) fail('invalid-feed');
        if(name==='VEVENT' && this.stack.length===2) this.event={lines:[],bytes:0,recurring:false,duration:false,start:null,end:null};
        if(name==='VCALENDAR' || this.stack.includes('VTIMEZONE') || name==='VEVENT' && this.event) this.emit(line);
      } else {
        if(this.stack.at(-1)!==name) fail('invalid-feed');
        if(name==='VEVENT' && this.event) {
          this.emit(line);
          const event=this.event;this.event=null;
          const keep=!this.first || event.recurring || event.duration || !event.start ||
            event.start<=this.last && (event.end || event.start)>=this.first;
          if(keep) {this.bytes+=event.bytes;if(this.bytes>this.maxBytes) fail('projection-limit');for(const part of event.lines)this.parts.push(part);}
        } else if(name==='VCALENDAR' || this.stack.includes('VTIMEZONE')) this.emit(line);
        this.stack.pop();if(name==='VCALENDAR') this.closed=true;
      }
      return;
    }
    if(this.stack.includes('VTIMEZONE')) {this.emit(line);return;}
    if(this.stack.at(-1)==='VEVENT' && this.event) {
      const key=property(line);
      if(['RRULE','RDATE','RECURRENCE-ID'].includes(key)) this.event.recurring=true;
      if(key==='DURATION') this.event.duration=true;
      const date=/:(\d{8})(?:T\d{6}Z?)?$/.exec(line)?.[1];
      if(key==='DTSTART') this.event.start=date || null;
      if(key==='DTEND') this.event.end=date || null;
      this.emit(line);
    } else if(this.stack.at(-1)==='VCALENDAR') this.emit(line);
  }
  finish() {
    this.buffer+=this.decoder.end();
    if(this.buffer) this.line(this.buffer.replace(/\r$/,''));
    this.flush();
    if(!this.seen || !this.closed || this.stack.length || this.event) fail('invalid-feed');
    const result=this.parts.join('');this.parts=[];return result;
  }
}

export function projectCalendar(text,days) {
  const projector=new CalendarProjector({days});projector.write(Buffer.from(text,'utf8'));return projector.finish();
}
