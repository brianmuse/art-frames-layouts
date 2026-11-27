// Reads photo entries from a Google Photos shared album page. This is unofficial:
// the page embeds its data in inline scripts such as
//   AF_initDataCallback({key: 'ds:1', hash: '2', data:[null,[[id,[url,w,h,…],taken,…,tz,…],…],token,…], sideChannel: {}});
// The parser treats the page as untrusted text, bounds every step, and returns
// plain values only. When the structured data is missing it falls back to a URL scan.
import {createHash} from 'node:crypto';

export const MAX_PAGE_BYTES=4_000_000;
// A larger single data block is skipped before JSON.parse, to bound heap use.
export const MAX_BLOCK_BYTES=3_000_000;
export const MAX_ITEMS=2000;
const MAX_BLOCKS=40;
const MAX_DEPTH=8;
const ID=/^[A-Za-z0-9_-]{6,200}$/;
// The image CDN base URL. Size parameters ("=w…-h…") are removed and added again later.
const BASE=/^https:\/\/lh[0-9]{1,2}\.googleusercontent\.com\/[A-Za-z0-9_\-/]{20,1500}$/;
// Google stores video details under this key in the item's extra-data object.
export const VIDEO_KEY='76647426';
const MIN_TIME=Date.UTC(1900,0,1),MAX_TIME=Date.UTC(2200,0,1);

export class ParseError extends Error {
  constructor() {super('Album page not understood');this.code='parse';}
}

/** Strip size parameters and check the host and path. Returns null when unusable. */
export function baseUrl(value) {
  if(typeof value!=='string' || value.length>2000) return null;
  const base=value.split('=')[0];
  if(!BASE.test(base)) return null;
  // Profile pictures and other account images are not album photos.
  if(/^https:\/\/[^/]+\/(?:a|a-|ogw)\//.test(base)) return null;
  return base;
}

const dimension=value=>Number.isSafeInteger(value) && value>0 && value<=100000?value:null;

function entry(value) {
  if(!Array.isArray(value) || value.length<3 || typeof value[0]!=='string' || !ID.test(value[0])) return null;
  const media=value[1];
  if(!Array.isArray(media)) return null;
  const url=baseUrl(media[0]);
  if(!url) return null;
  const taken=typeof value[2]==='number' && value[2]>MIN_TIME && value[2]<MAX_TIME?Math.round(value[2]):null;
  const offset=typeof value[4]==='number' && Math.abs(value[4])<=16*3600000?Math.round(value[4]):0;
  const video=value.some(part=>part && typeof part==='object' && !Array.isArray(part) && Object.hasOwn(part,VIDEO_KEY));
  return {id:value[0],url,width:dimension(media[1]),height:dimension(media[2]),takenAt:taken,offsetMs:offset,video};
}

// Find the end of the JSON array that starts at text[start] === '['.
function arrayEnd(text,start) {
  let depth=0,inString=false;
  for(let index=start;index<text.length;index++) {
    const char=text.charCodeAt(index);
    if(inString) {
      if(char===92) index++; // backslash
      else if(char===34) inString=false;
    } else if(char===34) inString=true;
    else if(char===91) depth++;
    else if(char===93 && --depth===0) return index+1;
  }
  return -1;
}

function dataBlocks(html) {
  const blocks=[];
  let from=0;
  while(blocks.length<MAX_BLOCKS) {
    const at=html.indexOf('AF_initDataCallback(',from);
    if(at<0) break;
    from=at+20;
    const match=/data:\s*\[/.exec(html.slice(at,at+400));
    if(!match) continue;
    const start=at+match.index+match[0].length-1;
    const end=arrayEnd(html,start);
    // An unbalanced block: the scan already reached the end of the text, so stop.
    if(end<0) break;
    from=end;
    if(end-start>MAX_BLOCK_BYTES) continue;
    try {blocks.push(JSON.parse(html.slice(start,end)));} catch {/* not JSON: skip */}
  }
  return blocks;
}

// The largest array of photo-shaped entries anywhere in the parsed data.
function largestList(value,depth=0,best={list:null,count:0}) {
  if(!Array.isArray(value) || depth>MAX_DEPTH) return best;
  let count=0;
  for(const item of value) if(entry(item)) count++;
  if(count>best.count) {best.list=value;best.count=count;}
  for(const item of value) if(Array.isArray(item)) largestList(item,depth+1,best);
  return best;
}

function structured(html) {
  let best={list:null,count:0},block=null,emptyAlbum=false;
  for(const data of dataBlocks(html)) {
    const found=largestList(data);
    if(found.count>best.count) {best={...found};block=data;}
    // An album with no items: an empty item list next to the album's own record.
    if(Array.isArray(data[1]) && !data[1].length && Array.isArray(data[3]) && typeof data[3][0]==='string' && ID.test(data[3][0])) emptyAlbum=true;
  }
  if(!best.list) return emptyAlbum?{method:'structured',items:[],videos:0,more:false,empty:true}:null;
  const items=[],seen=new Set();
  let videos=0;
  for(const value of best.list) {
    const item=entry(value);
    if(!item || seen.has(item.id)) continue;
    seen.add(item.id);
    // Videos are skipped. A video Google does not mark shows as its still frame.
    if(item.video) {videos++;continue;}
    delete item.video;
    items.push(item);
    if(items.length>=MAX_ITEMS) break;
  }
  // The item list is followed by a page token when the album has more items.
  const index=block.indexOf(best.list);
  const more=index>=0 && typeof block[index+1]==='string' && block[index+1].length>0;
  return {method:'structured',items,videos,more};
}

function fallback(html) {
  const items=[],seen=new Set();
  const pattern=/https:\/\/lh[0-9]{1,2}\.googleusercontent\.com\/[A-Za-z0-9_\-/]{20,1500}/g;
  let match;
  while((match=pattern.exec(html)) && items.length<MAX_ITEMS) {
    const url=baseUrl(match[0]);
    if(!url || seen.has(url)) continue;
    seen.add(url);
    const id='u'+createHash('sha256').update(url).digest('base64url').slice(0,32);
    items.push({id,url,width:null,height:null,takenAt:null,offsetMs:0});
  }
  return {method:'fallback',items,videos:0,more:false};
}

/** Parse an album page. Throws ParseError when no photo can be found. */
export function parseAlbum(input) {
  const html=Buffer.isBuffer(input)?input.subarray(0,MAX_PAGE_BYTES).toString('utf8'):String(input).slice(0,MAX_PAGE_BYTES);
  const result=structured(html);
  if(result && (result.items.length || result.videos || result.empty)) {delete result.empty;return result;}
  const loose=fallback(html);
  if(loose.items.length) return loose;
  throw new ParseError();
}
