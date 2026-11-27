import {ProviderError} from './fetch.mjs';

// Google News RSS is untrusted text. Take only the plain-text fields we show,
// decode entities once, remove control and direction-override characters, and
// cap every length. Astro escapes the result when it renders; feed HTML (the
// <description> field) is never read.
export const limits={title:180,source:48,items:40};

const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…',middot:'·',bull:'•',laquo:'«',raquo:'»',eacute:'é',egrave:'è',aacute:'á',agrave:'à',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',ccedil:'ç',uuml:'ü',ouml:'ö',auml:'ä',szlig:'ß',euro:'€',pound:'£',copy:'©',reg:'®',trade:'™',deg:'°'};
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g,(match,value)=>{
    if (value[0]!=='#') return Object.hasOwn(named,value) ? named[value] : match;
    const code=value[1]==='x' || value[1]==='X' ? parseInt(value.slice(2),16) : parseInt(value.slice(1),10);
    if (!Number.isInteger(code) || code<32 || code>0x10ffff || (code>=0xd800 && code<=0xdfff) || (code>=0x7f && code<0xa0)) return '';
    return String.fromCodePoint(code);
  });
}

// C0/C1 controls, zero-width and bidirectional formatting characters.
const invisible=/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
export function cleanText(value,max) {
  let text=String(value ?? '').replace(invisible,' ').replace(/\s+/g,' ').trim();
  const chars=[...text];
  if (chars.length<=max) return text;
  text=chars.slice(0,max-1).join('');
  const space=text.lastIndexOf(' ');
  if (space>max*.6) text=text.slice(0,space);
  return text.replace(/[\s,;:–—-]+$/,'')+'…';
}

// Find the next <name ...>…</name> from `from` with indexOf only, so a body of
// unclosed tags costs linear time. Returns null when no complete element is left.
function nextElement(xml,name,from=0) {
  const open='<'+name,close='</'+name+'>';
  for (let start=xml.indexOf(open,from);start>=0;start=xml.indexOf(open,start+open.length)) {
    const after=xml[start+open.length];
    if (after!=='>' && after!==' ' && after!=='\t' && after!=='\n' && after!=='\r') continue;
    const tagEnd=xml.indexOf('>',start);
    if (tagEnd<0) return null;
    const end=xml.indexOf(close,tagEnd);
    if (end<0) return null;
    return {body:xml.slice(tagEnd+1,end),next:end+close.length};
  }
  return null;
}
// One element's text. CDATA is literal; anything else is entity-encoded XML.
function element(xml,name) {
  const found=nextElement(xml,name);
  if (!found) return '';
  const body=found.body.trim();
  const cdata=/^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(body);
  return cdata ? cdata[1] : decodeEntities(body);
}

const normalize=text=>text.toLowerCase().replace(/\s+/g,' ').trim();
// Google News titles end with " - Source". Strip that suffix and keep the
// source separately. Without a <source>, treat a short last " - " part as it.
export function splitTitle(rawTitle,rawSource='') {
  let title=String(rawTitle ?? '').replace(/\s+/g,' ').trim(),source=String(rawSource ?? '').replace(/\s+/g,' ').trim();
  if (source) {
    const suffix=' - '+source;
    if (title.length>suffix.length && normalize(title).endsWith(normalize(suffix))) title=title.slice(0,title.length-suffix.length).trim();
  } else {
    const match=/^(.*\S)\s+-\s+([^-]{1,60})$/.exec(title);
    if (match) {title=match[1];source=match[2].trim();}
  }
  return {title,source};
}

export function parseFeed(xml) {
  const text=String(xml ?? '');
  if (!/<rss[\s>]/i.test(text) || !/<channel[\s>]/i.test(text)) throw new ProviderError('invalid-feed');
  const items=[];
  let from=0;
  while (items.length<limits.items) {
    const found=nextElement(text,'item',from);
    if (!found) break;
    from=found.next;
    const body=found.body;
    const split=splitTitle(element(body,'title'),element(body,'source'));
    const title=cleanText(split.title,limits.title),source=cleanText(split.source,limits.source);
    if (!title) continue;
    const published=Date.parse(element(body,'pubDate'));
    // Ignore dates that are not real or are far in the future.
    const valid=Number.isFinite(published) && published>Date.UTC(2000,0,1) && published<Date.now()+86400000;
    items.push({title,source,published_at:valid ? new Date(published).toISOString() : null});
  }
  return items;
}
