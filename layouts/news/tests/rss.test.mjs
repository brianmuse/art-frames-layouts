import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {parseFeed,splitTitle,decodeEntities,cleanText,limits} from '../src/server/rss.mjs';

const fixture=await fs.readFile(new URL('./fixtures/feed.xml',import.meta.url),'utf8');
const item=(title,source='Daily Example',date='Sun, 01 Nov 2026 12:00:00 GMT')=>`<item><title>${title}</title><pubDate>${date}</pubDate><source url="https://example.test">${source}</source></item>`;
const feed=items=>`<?xml version="1.0"?><rss version="2.0"><channel><title>Sample</title>${items.join('')}</channel></rss>`;

test('parses titles, sources and dates from a Google News feed',()=>{
  const items=parseFeed(fixture);
  assert.deepEqual(items[0],{title:'Harbor ferry adds a late boat on Fridays',source:'Harbor Daily',published_at:'2026-11-01T12:40:00.000Z'});
  assert.equal(items.length,4,'The blank title is skipped');
  assert.equal(items[3].title,'Library opens a seed exchange');
  assert.equal(items[3].source,'Valley Post','No <source>: the " - Source" suffix becomes the source');
});

test('decodes entities once, reads CDATA literally and never reads the description HTML',()=>{
  const [,second,third]=parseFeed(fixture);
  assert.equal(second.title,'Bakers & brewers share a market stall – and a "secret" recipe');
  assert.equal(second.source,'Signal & Noise');
  assert.equal(third.title,'Town hall vote set for <Tuesday>','CDATA is plain text; the page escapes it');
  assert.equal(third.published_at,null,'An unreadable date has no age');
  assert.doesNotMatch(JSON.stringify(parseFeed(fixture)),/alert|script|<a |font color/);
  assert.equal(decodeEntities('&amp;lt;b&amp;gt;'),'&lt;b&gt;','Decoding happens once');
  assert.equal(decodeEntities('&#0;&#x1F;&#xD800;&#128512;&bogus;'),'😀&bogus;');
});

test('strips only the matching " - Source" suffix',()=>{
  assert.deepEqual(splitTitle('Rates hold steady - Daily Example','Daily Example'),{title:'Rates hold steady',source:'Daily Example'});
  assert.deepEqual(splitTitle('Rates hold steady - daily example','Daily Example'),{title:'Rates hold steady',source:'Daily Example'},'Case-insensitive');
  assert.deepEqual(splitTitle('Left - right debate continues - Other Paper','Daily Example'),{title:'Left - right debate continues - Other Paper',source:'Daily Example'},'A different suffix stays');
  assert.deepEqual(splitTitle('Daily Example','Daily Example'),{title:'Daily Example',source:'Daily Example'},'A title equal to the source is kept');
  assert.deepEqual(splitTitle('Left - right debate continues - Other Paper',''),{title:'Left - right debate continues',source:'Other Paper'});
  assert.deepEqual(splitTitle('No suffix here',''),{title:'No suffix here',source:''});
});

test('caps lengths and removes control and direction characters',()=>{
  const long='Word '.repeat(80)+'end';
  const [parsed]=parseFeed(feed([item(long,'S'.repeat(200))]));
  assert.ok([...parsed.title].length<=limits.title);
  assert.ok(parsed.title.endsWith('…'));
  assert.ok([...parsed.source].length<=limits.source);
  assert.equal(cleanText('a‮b\u0007c​d\n e',100),'a b c d e');
  assert.equal(cleanText('short',10),'short');
});

test('limits the item count, rejects non-RSS bodies and ignores future dates',()=>{
  const many=parseFeed(feed(Array.from({length:60},(_,index)=>item('Story '+index))));
  assert.equal(many.length,limits.items);
  assert.throws(()=>parseFeed('<html><body>Not a feed</body></html>'),{code:'invalid-feed'});
  assert.throws(()=>parseFeed(''),{code:'invalid-feed'});
  const [future]=parseFeed(feed([item('From the future','Daily Example','Fri, 01 Jan 2100 00:00:00 GMT')]));
  assert.equal(future.published_at,null);
});

test('unclosed items or titles in a 2 MB body parse in linear time',()=>{
  for (const body of ['<item>'.repeat(350_000),'<item>'+'<title>'.repeat(290_000)+'</item>','<item><title>x</title>'+'<source>'.repeat(250_000)+'</item>']) {
    const xml=`<?xml version="1.0"?><rss version="2.0"><channel>${body}</channel></rss>`;
    assert.ok(xml.length>=2_000_000);
    const started=performance.now();
    parseFeed(xml);
    assert.ok(performance.now()-started<500,`Parsed in ${Math.round(performance.now()-started)} ms`);
  }
  assert.deepEqual(parseFeed(feed([item('Kept'),'<itemize>noise</itemize>',item('Also kept')])).map(entry=>entry.title),['Kept','Also kept']);
  assert.deepEqual(parseFeed(feed([item('Closed'),'<item><title>Never closed - X</title>'])).map(entry=>entry.title),['Closed']);
});
