import fs from 'node:fs/promises';

// Manifest defaults. config.json does not exist until the user saves settings once.
export const DEFAULTS=Object.freeze({album_url:'',photo_interval:'15 minutes',sync_interval:'Every 3 hours',order:'Shuffle',fit:'contain'});
export const DISPLAY_DEFAULTS=Object.freeze({show_caption:true,show_clock:false});
// 'day' changes the photo at local midnight in the snapshot timezone.
const PHOTO_INTERVALS={'5 minutes':300_000,'15 minutes':900_000,'30 minutes':1_800_000,'60 minutes':3_600_000,'Once a day':'day'};
const INTERVALS={'Every hour':3_600_000,'Every 3 hours':10_800_000,'Every 6 hours':21_600_000};

export async function loadConfig(file=process.env.DAYFRAME_SITE_CONFIG || '.secrets/config.json') {
  try {
    if((await fs.stat(file)).size>150000) throw new Error('Settings too large');
    const result=JSON.parse(await fs.readFile(file,'utf8'));
    if(!result || typeof result!=='object' || Array.isArray(result)) throw new Error('Invalid settings');
    return result;
  } catch(error) {
    if(error.code==='ENOENT') return {};
    throw new Error('Layout settings are unavailable');
  }
}

/** Saved values with unknown or invalid values replaced by the defaults. */
export function appSettings(config={}) {
  const pick=(key,allowed)=>allowed.includes(config[key])?config[key]:DEFAULTS[key];
  return {
    albumUrl:typeof config.album_url==='string'?config.album_url.trim():'',
    photoEvery:PHOTO_INTERVALS[pick('photo_interval',Object.keys(PHOTO_INTERVALS))],
    syncMs:INTERVALS[pick('sync_interval',Object.keys(INTERVALS))],
    order:pick('order',['Shuffle','Newest first'])==='Newest first'?'newest':'shuffle',
    fit:pick('fit',['contain','cover']),
  };
}

export function displaySettings(snapshot) {
  const values=snapshot?.display_settings && typeof snapshot.display_settings==='object'?snapshot.display_settings:{};
  const flag=key=>typeof values[key]==='boolean'?values[key]:DISPLAY_DEFAULTS[key];
  return {showCaption:flag('show_caption'),showClock:flag('show_clock')};
}
