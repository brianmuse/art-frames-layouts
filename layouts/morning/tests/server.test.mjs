import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

test('production server keeps contexts separate and renders safe provider errors', async()=>{
  const directory=await fs.mkdtemp('/tmp/art-frames-site-');
  const socket=path.join(directory,'site.sock');
  const config=path.join(directory,'config.json');
  await fs.writeFile(config,JSON.stringify({work_calendar_url:'https://127.0.0.1/SYNTHETIC-PRIVATE-FEED'}),{mode:0o600});
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DAYFRAME_SITE_SOCKET:socket,DAYFRAME_SITE_CONFIG:config},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Website socket did not become ready')),10000);
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('Website failed to start'));});
    });
    const artwork=(await fs.readFile('public/dayframe-art.jpg')).toString('base64');
    const request=snapshot=>new Promise((resolve,reject)=>{
      const body=JSON.stringify(snapshot);
      const req=http.request({socketPath:socket,path:'/index.html',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
        const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,html:Buffer.concat(parts).toString()}));
      });
      req.on('error',reject);req.end(body);
    });
    const base={now:'2026-10-26T08:00:00-04:00',timezone:'America/New_York',data:{},art:{image:'/dayframe-art.jpg',image_data:artwork,title:'A public test artwork'}};
    const [first,second]=await Promise.all([request(base),request({...base,now:'2026-10-27T08:00:00-04:00'})]);
    assert.equal(first.status,200);assert.equal(second.status,200);
    assert.match(first.html,/Oct 26/);assert.doesNotMatch(first.html,/Oct 27/);
    assert.match(second.html,/Oct 27/);assert.doesNotMatch(second.html,/Oct 26/);
    assert.match(first.html,/Work[\s\S]*couldn’t sync/);
    assert.match(first.html,/Use the secret iCal address in this layout’s settings/);
    assert.match(first.html,/Calendar data is unavailable/);
    assert.doesNotMatch(first.html,/No events scheduled/);
    assert.doesNotMatch(first.html,/SYNTHETIC-PRIVATE-FEED/);
    assert.doesNotMatch(first.html,/data:image\/jpeg;base64,|glass_theme|dark-glass/);
    assert.equal(first.html.includes(artwork),false);
    assert.match(first.html,/data-dayframe-server-rendered/);
    await fs.writeFile(config,JSON.stringify({calendars:[{id:'new',title:'',url:'https://127.0.0.1/NEW-PRIVATE-LINK',color:'#8850a8'}]}));
    const failed=await request(base);
    assert.equal(failed.status,200);
    assert.match(failed.html,/Calendar 1[\s\S]*couldn’t sync/);
    assert.match(failed.html,/Calendar data is unavailable/);
    assert.doesNotMatch(failed.html,/No events scheduled|NEW-PRIVATE-LINK/);
    await fs.writeFile(config,JSON.stringify({calendars:Array.from({length:8},(_,i)=>({id:'feed-'+i,title:'Calendar '+i,url:'https://127.0.0.1/PRIVATE-FEED-'+i,color:'#8850a8'}))}));
    const many=await request(base);
    assert.equal(many.status,200);
    assert.match(many.html,/6 more/);
    assert.doesNotMatch(many.html,/PRIVATE-FEED-/);
    // The layout has no display hours: the planner shows at any time and for any render purpose.
    // Saved values for removed settings (morning_start, morning_end, glass_theme) are ignored.
    await fs.writeFile(config,JSON.stringify({calendars:[],glass_theme:'Dark',morning_start:'07:00',morning_end:'09:30'}));
    const evening={...base,now:'2026-10-26T22:00:00Z'};
    for(const extra of [{},{render_purpose:'scheduled'},{render_purpose:'preview'},{render_purpose:'preview',ignore_display_hours:false},{render_purpose:'preview',ignore_display_hours:true},{display_settings:{show_calendar:false}}]) {
      const page=await request({...evening,...extra});
      assert.equal(page.status,200);
      assert.doesNotMatch(page.html,/<main[^>]*id="plan"[^>]* hidden/,JSON.stringify(extra));
      assert.match(page.html,/Calendars aren’t connected/);
      assert.doesNotMatch(page.html,/dark-glass/);
    }
  } finally {
    if(child.exitCode===null && child.signalCode===null) {
      const stopped=new Promise(resolve=>child.once('exit',resolve));
      child.kill(); await stopped;
    }
    await fs.rm(directory,{recursive:true,force:true});
  }
});
