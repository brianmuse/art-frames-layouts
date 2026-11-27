import {newsCache,newsRequest} from './cache.mjs';
import {newsSettings,displaySettings,timezoneOr,hostTimezone} from './settings.mjs';
import {weatherView} from './weather.mjs';
import {fitPage} from './view.mjs';

const maxAgeMs=72*3600000,staleMs=45*60000;

export function timeAgo(then,now) {
  const minutes=Math.floor((now-then)/60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes<1) return 'Just now';
  if (minutes<60) return `${minutes} min ago`;
  const hours=Math.floor(minutes/60);
  if (hours<24) return `${hours} hr ago`;
  const days=Math.floor(hours/24);
  return days===1 ? 'Yesterday' : `${days} days ago`;
}

const hints={
  'network':'Google News could not be reached.',
  'timeout':'Google News did not respond in time.',
  'rate-limited':'Google News is limiting requests.',
  'invalid-feed':'Google News returned an unreadable feed.',
  'too-large':'The feed is larger than the download limit.',
  'access-denied':'Google News refused the request.',
  'not-found':'Google News has no feed for this topic.',
  'redirect':'Google News moved this feed.',
  'blocked-address':'Google News resolved to a blocked address.',
};
export const issue=code=>Object.hasOwn(hints,code) ? hints[code] : 'The news service is unavailable.';
const summary=feeds=>feeds.slice(0,2).map(feed=>feed.label).join(', ')+(feeds.length>2 ? ` +${feeds.length-2} more` : '');
const key=title=>title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// One merged list: the top story of each topic in turn, then the next, without
// repeats. A topic label appears only when more than one topic is set.
export function mergeHeadlines(feeds,{count,now}) {
  const lists=feeds.map(feed=>(feed.value || []).filter(item=>{
    const published=Date.parse(item.published_at);
    return !Number.isFinite(published) || now-published<=maxAgeMs;
  }));
  const seen=new Set(),merged=[];
  for (let index=0;merged.length<count && lists.some(list=>index<list.length);index++) {
    lists.forEach((list,feedIndex)=>{
      const item=list[index];
      if (!item || merged.length>=count || seen.has(key(item.title))) return;
      seen.add(key(item.title));
      const published=Date.parse(item.published_at);
      merged.push({title:item.title,source:item.source,age:Number.isFinite(published) ? timeAgo(published,now) : '',topic:feeds.length>1 ? feeds[feedIndex].label : ''});
    });
  }
  return merged;
}

export function buildNews(read,settings,{now,timezone}) {
  const time=now.valueOf();
  const feeds=read.feeds;
  const headlines=mergeHeadlines(feeds,{count:settings.count,now:time});
  const failed=feeds.filter(feed=>!feed.value && feed.error);
  const refreshFailed=feeds.filter(feed=>feed.value && feed.error);
  const saved=feeds.filter(feed=>feed.value && Number.isFinite(feed.at)).map(feed=>feed.at);
  const oldest=saved.length ? Math.min(...saved) : null;
  const allFailed=failed.length>0 && failed.length===feeds.length;
  const status=allFailed ? {title:'Headlines couldn’t load',detail:issue(failed[0].error)}
    : failed.length ? {title:`${summary(failed)} couldn’t load`,detail:failed.length===1 ? issue(failed[0].error) : 'Showing the topics that loaded.'}
    : refreshFailed.length ? {title:'Showing saved headlines',detail:`${summary(refreshFailed)} couldn’t refresh. ${issue(refreshFailed[0].error)}`} : null;
  let weather=null;
  if (read.weather) {
    const view=read.weather.value ? weatherView(read.weather.value,{now,timezone,units:settings.units,fetchedAt:read.weather.at,location:settings.city}) : null;
    const ago=read.weather.at ? time-read.weather.at : 0;
    weather=view ? {...view,updated:ago>staleMs ? `Forecast updated ${timeAgo(read.weather.at,time).toLowerCase()}` : ''}
      : {unavailable:true,location:settings.city,message:read.weather.loading && !read.weather.error ? 'Loading the forecast…' : 'Weather is unavailable.'};
  }
  const day=now.toLocaleDateString('en-US',{weekday:'long',timeZone:timezone});
  const date=now.toLocaleDateString('en-US',{month:'long',day:'numeric',timeZone:timezone});
  return {
    day,date,weather,headlines,status,
    heading:feeds.length===1 ? feeds[0].label : 'Headlines',
    updated:oldest!==null && time-oldest>staleMs ? `Updated ${timeAgo(oldest,time).toLowerCase()}` : '',
    empty:headlines.length || allFailed ? '' : 'No recent headlines.',
  };
}

// Keep the large base64 artwork out of the page model; the page links the host's copy.
function pageSnapshot(snapshot) {
  const {art,...rest}=snapshot;
  const {image_data,image_buffer,...artFields}=art && typeof art==='object' ? art : {};
  const encoded=typeof image_data==='string' ? image_data : null;
  if (encoded?.length>34_000_000) throw new Error('Artwork exceeds the display budget');
  if ((Buffer.isBuffer(image_buffer) ? image_buffer.length : encoded ? Buffer.byteLength(encoded,'base64') : 0)>25_000_000) throw new Error('Artwork exceeds the display budget');
  const result=structuredClone(rest);
  if (art && typeof art==='object') result.art=structuredClone(artFields);
  return result;
}

export function presentPage(snapshot,news) {
  const result=pageSnapshot(snapshot);
  const {show_art}=displaySettings(snapshot);
  // Host protocol name: keep 'dayframe' (see the host repo's names.py).
  const art=show_art && typeof result.art?.image==='string' && /^(?:\/(?!\/)|http:\/\/dayframe\.local\/)/.test(result.art.image) ? result.art : null;
  return {...result,show_art,news,art,layout:fitPage(news,result)};
}

// The production render: read the cache, then build the page model.
export async function newsPage(snapshot,config,{cache=newsCache,waitMs=3000}={}) {
  const parsed=new Date(snapshot.now);
  const now=Number.isFinite(parsed.valueOf()) ? parsed : new Date();
  const timezone=timezoneOr(snapshot.timezone);
  void hostTimezone.set(snapshot.timezone);
  const settings=newsSettings(config);
  const read=await cache.read(newsRequest(settings,timezone),{waitMs});
  if (read.preparing) return {preparing:true};
  return presentPage({...snapshot,timezone},buildNews(read,settings,{now,timezone}));
}
