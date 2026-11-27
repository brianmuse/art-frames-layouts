import fs from 'node:fs/promises';
import {createStateFile} from './state-file.mjs';

export async function settings() {
  const path=process.env.DAYFRAME_SITE_CONFIG || '.secrets/config.json';
  try {
    if ((await fs.stat(path)).size>150000) throw new Error('Settings too large');
    const result=JSON.parse(await fs.readFile(path,'utf8'));
    if (!result || typeof result!=='object' || Array.isArray(result)) throw new Error('Invalid settings');
    return result;
  } catch (error) { if(error.code==='ENOENT') return {}; throw new Error('Layout settings are unavailable'); }
}

const validZone=zone=>{
  if(typeof zone!=='string' || !zone.trim() || zone.length>64) return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:zone.trim()}).format();return true;} catch {return false;}
};
// An explicit layout setting wins; blank follows the timezone Art Frames sends.
export function calendarTimezone(config,host=null) {
  for(const zone of [config.calendar_timezone,host]) if(validZone(zone)) return zone.trim();
  return 'America/New_York';
}
// The background sync runs without a render, so remember the host's last timezone.
export function createHostTimezone(file) {
  let zone=null,loaded=null;
  const load=()=>loaded ||= file.load().then(value=>{if(zone===null && validZone(value?.timezone)) zone=value.timezone.trim();},()=>{});
  return {
    async get() {await load();return zone;},
    async set(value) {
      if(!validZone(value)) return;
      await load();value=value.trim();
      if(value===zone) return;
      zone=value;await file.save({version:1,timezone:value});
    },
  };
}
export const hostTimezone=createHostTimezone(createStateFile(process.env.DAYFRAME_SITE_STATE,'host.json',{maxBytes:4096}));
export function calendarFeeds(config) {
  const legacy=[{id:'legacy-work',url:config.work_calendar_url,title:'Work',color:'#af2842'},{id:'legacy-family',url:config.family_calendar_url,title:'Family',color:'#8850a8'}];
  return (Array.isArray(config.calendars) ? config.calendars : legacy).filter(item=>item && typeof item.url==='string' && item.url.trim()).slice(0,8).map(item=>({...item,title:typeof item.title==='string'?item.title.replace(/\s+/g,' ').trim().slice(0,100):'',color:/^#[0-9a-fA-F]{6}$/.test(item.color)?item.color:'#af2842'}));
}
export function calendarSchedule(config) {
  return {refreshMs:{'Daily':86400000,'Hourly':3600000,'Every 15 minutes':900000}[config.calendar_refresh] || 86400000,timeoutMs:{'30 seconds':30000,'90 seconds':90000,'180 seconds':180000}[config.calendar_timeout] || 90000,syncAt:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.calendar_sync_at)?config.calendar_sync_at:'03:00'};
}
