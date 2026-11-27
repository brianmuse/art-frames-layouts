import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {feedUrl,newsFeeds,editions,topics,maxTopics} from '../src/server/topics.mjs';

const manifest=JSON.parse(await fs.readFile(new URL('../layout.json',import.meta.url),'utf8'));

test('builds the three Google News URL forms on the fixed host',()=>{
  assert.equal(feedUrl({topic:'Top stories'}),'https://news.google.com/rss?hl=en-US&gl=US&ceid=US%3Aen');
  assert.equal(feedUrl({topic:'Technology'}),'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US%3Aen');
  assert.equal(feedUrl({topic:'Sports',query:'  Red   Sox '}),'https://news.google.com/rss/search?q=Red+Sox&hl=en-US&gl=US&ceid=US%3Aen','Search wins over the topic');
  assert.equal(feedUrl({topic:'World'},'Mexico (Spanish)'),'https://news.google.com/rss/headlines/section/topic/WORLD?hl=es-419&gl=MX&ceid=MX%3Aes-419');
  for (const [name,section] of Object.entries(topics)) {
    const url=new URL(feedUrl({topic:name}));
    assert.equal(url.hostname,'news.google.com');
    assert.equal(url.pathname,section ? `/rss/headlines/section/topic/${section}` : '/rss');
  }
});

test('search text cannot change the host, path or edition',()=>{
  const url=new URL(feedUrl({query:'a&hl=xx#/../evil?\u0000'}));
  assert.equal(url.hostname,'news.google.com');
  assert.equal(url.pathname,'/rss/search');
  assert.equal(url.searchParams.get('q'),'a&hl=xx#/../evil?');
  assert.equal(url.searchParams.get('hl'),'en-US');
  assert.equal(url.searchParams.getAll('hl').length,1);
  assert.equal(new URL(feedUrl({query:'x'.repeat(500)})).searchParams.get('q').length,100);
});

test('rows become labeled feeds: default top stories, no duplicates, at most six',()=>{
  assert.deepEqual(newsFeeds({}),[{url:feedUrl({}),label:'Top stories'}]);
  assert.deepEqual(newsFeeds({topics:[]}).map(feed=>feed.label),['Top stories']);
  const feeds=newsFeeds({region:'United Kingdom (English)',topics:[{id:'a',topic:'Nation',query:''},{id:'b',topic:'Nation'},{id:'c',topic:'Bogus'},{id:'d',topic:'Sports',query:'Local rowing club results this weekend'},null,'x']});
  assert.deepEqual(feeds.map(feed=>feed.label),['U.K.','Top stories','Local rowing club results this…']);
  assert.ok(feeds.every(feed=>feed.url.includes('ceid=GB%3Aen')));
  const many=newsFeeds({topics:Object.keys(topics).map((topic,index)=>({id:String(index),topic}))});
  assert.equal(many.length,maxTopics);
});

test('manifest choices match the code tables',()=>{
  const region=manifest.settings.find(setting=>setting.key==='region');
  assert.deepEqual(region.choices,Object.keys(editions));
  const list=manifest.settings.find(setting=>setting.key==='topics');
  assert.equal(list.type,'list');assert.equal(list.max_items,maxTopics);
  assert.deepEqual(list.fields.find(field=>field.key==='topic').choices,Object.keys(topics));
});
