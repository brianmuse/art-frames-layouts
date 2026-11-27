import fs from 'node:fs/promises';
import {createStateFile} from './state-file.mjs';
import {newsFeeds,editions,defaultEdition} from './topics.mjs';

// config.json exists only after the user saves settings once. A missing file
// means every manifest default applies.
export async function readConfig() {
  const path=process.env.DAYFRAME_SITE_CONFIG || '.secrets/config.json';
  try {
    if ((await fs.stat(path)).size>150000) throw new Error('Settings too large');
    const result=JSON.parse(await fs.readFile(path,'utf8'));
    if (!result || typeof result!=='object' || Array.isArray(result)) throw new Error('Invalid settings');
    return result;
  } catch (error) { if(error.code==='ENOENT') return {}; throw new Error('Layout settings are unavailable'); }
}

export const headlineCounts=['5','6','7','8'];
// Defaults match layout.json.
export function newsSettings(config={}) {
  return {
    region:Object.hasOwn(editions,config.region) ? config.region : defaultEdition,
    feeds:newsFeeds(config),
    count:headlineCounts.includes(config.headline_count) ? Number(config.headline_count) : 6,
    city:typeof config.city==='string' ? config.city.replace(/\s+/g,' ').trim().slice(0,100) : '',
    units:config.units==='celsius' ? 'celsius' : 'fahrenheit',
  };
}

// Per-TV display settings. Art Frames fills defaults, but older snapshots may omit them.
export function displaySettings(snapshot) {
  return {show_art:snapshot?.display_settings?.show_art!==false};
}

const validZone=zone=>{
  if(typeof zone!=='string' || !zone.trim() || zone.length>64) return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:zone.trim()}).format();return true;} catch {return false;}
};
export const timezoneOr=(zone,fallback='America/New_York')=>validZone(zone) ? zone.trim() : fallback;
// The background refresh runs without a render, so remember the host's last timezone.
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
