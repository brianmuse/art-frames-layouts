// Google News editions. The keys are the choice values in layout.json.
// Only Latin-script editions: the bundled Inter font has no CJK, Arabic or
// Cyrillic glyphs, and the TV renderer has no other fonts.
export const editions={
  'United States (English)':{hl:'en-US',gl:'US',ceid:'US:en',nation:'U.S.'},
  'United Kingdom (English)':{hl:'en-GB',gl:'GB',ceid:'GB:en',nation:'U.K.'},
  'Canada (English)':{hl:'en-CA',gl:'CA',ceid:'CA:en',nation:'Canada'},
  'Canada (French)':{hl:'fr-CA',gl:'CA',ceid:'CA:fr',nation:'Canada'},
  'Australia (English)':{hl:'en-AU',gl:'AU',ceid:'AU:en',nation:'Australia'},
  'Ireland (English)':{hl:'en-IE',gl:'IE',ceid:'IE:en',nation:'Ireland'},
  'New Zealand (English)':{hl:'en-NZ',gl:'NZ',ceid:'NZ:en',nation:'New Zealand'},
  'India (English)':{hl:'en-IN',gl:'IN',ceid:'IN:en',nation:'India'},
  'Germany (German)':{hl:'de',gl:'DE',ceid:'DE:de',nation:'Germany'},
  'France (French)':{hl:'fr',gl:'FR',ceid:'FR:fr',nation:'France'},
  'Spain (Spanish)':{hl:'es',gl:'ES',ceid:'ES:es',nation:'Spain'},
  'Mexico (Spanish)':{hl:'es-419',gl:'MX',ceid:'MX:es-419',nation:'Mexico'},
  'Italy (Italian)':{hl:'it',gl:'IT',ceid:'IT:it',nation:'Italy'},
  'Netherlands (Dutch)':{hl:'nl',gl:'NL',ceid:'NL:nl',nation:'Netherlands'},
  'Brazil (Portuguese)':{hl:'pt-BR',gl:'BR',ceid:'BR:pt-419',nation:'Brazil'},
};
export const defaultEdition='United States (English)';

// Topic choice values in layout.json, mapped to Google News section IDs.
export const topics={
  'Top stories':null,
  'World':'WORLD',
  'Nation':'NATION',
  'Business':'BUSINESS',
  'Technology':'TECHNOLOGY',
  'Entertainment':'ENTERTAINMENT',
  'Science':'SCIENCE',
  'Sports':'SPORTS',
  'Health':'HEALTH',
};
export const host='news.google.com';
export const maxTopics=6;
const maxQuery=100;

export const editionFor=value=>Object.hasOwn(editions,value) ? editions[value] : editions[defaultEdition];
const params=(edition,extra={})=>new URLSearchParams({...extra,hl:edition.hl,gl:edition.gl,ceid:edition.ceid}).toString();

// One feed URL. Search text, when present, wins over the topic.
export function feedUrl({topic='Top stories',query=''}={},editionName=defaultEdition) {
  const edition=editionFor(editionName);
  const search=cleanQuery(query);
  if (search) return `https://${host}/rss/search?${params(edition,{q:search})}`;
  const section=Object.hasOwn(topics,topic) ? topics[topic] : null;
  return section ? `https://${host}/rss/headlines/section/topic/${section}?${params(edition)}` : `https://${host}/rss?${params(edition)}`;
}
export function cleanQuery(value) {
  return typeof value==='string' ? [...value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()].slice(0,maxQuery).join('') : '';
}
function label({topic,query},edition) {
  const search=cleanQuery(query);
  if (search) return [...search].length>32 ? [...search].slice(0,31).join('').trimEnd()+'…' : search;
  if (topic==='Nation') return edition.nation;
  return Object.hasOwn(topics,topic) ? topic : 'Top stories';
}

// The configured rows as feeds, in order, without duplicates. No rows means top stories.
export function newsFeeds(config={}) {
  const editionName=Object.hasOwn(editions,config.region) ? config.region : defaultEdition;
  const edition=editions[editionName];
  const rows=Array.isArray(config.topics) ? config.topics.filter(row=>row && typeof row==='object') : [];
  const feeds=[];
  for (const row of rows.length ? rows : [{topic:'Top stories'}]) {
    const value={topic:Object.hasOwn(topics,row.topic) ? row.topic : 'Top stories',query:cleanQuery(row.query)};
    const url=feedUrl(value,editionName);
    if (feeds.some(feed=>feed.url===url)) continue;
    feeds.push({url,label:label(value,edition)});
    if (feeds.length>=maxTopics) break;
  }
  return feeds;
}
