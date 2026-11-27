import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readConfig,newsSettings,displaySettings} from '../src/server/settings.mjs';
import {feedUrl} from '../src/server/topics.mjs';

const manifest=JSON.parse(await fs.readFile(new URL('../layout.json',import.meta.url),'utf8'));
const defaults=Object.fromEntries(manifest.settings.filter(setting=>'default' in setting).map(setting=>[setting.key,setting.default]));

test('a missing config.json applies the manifest defaults',async(t)=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'news-config-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const previous=process.env.DAYFRAME_SITE_CONFIG;
  process.env.DAYFRAME_SITE_CONFIG=path.join(directory,'config.json');
  t.after(()=>{if(previous===undefined) delete process.env.DAYFRAME_SITE_CONFIG; else process.env.DAYFRAME_SITE_CONFIG=previous;});
  const config=await readConfig();
  assert.deepEqual(config,{});
  const settings=newsSettings(config);
  assert.equal(settings.region,defaults.region);
  assert.equal(String(settings.count),defaults.headline_count);
  assert.equal(settings.units,defaults.units);
  assert.equal(settings.city,'','No city means no weather');
  assert.deepEqual(settings.feeds,[{url:feedUrl({topic:'Top stories'}),label:'Top stories'}]);
  await fs.writeFile(process.env.DAYFRAME_SITE_CONFIG,'[1,2]');
  await assert.rejects(readConfig(),/Layout settings are unavailable/);
});

test('invalid saved values fall back to defaults',()=>{
  const settings=newsSettings({region:'Atlantis',headline_count:'40',units:'kelvin',city:'  Boston,   MA ',topics:'not a list'});
  assert.equal(settings.region,'United States (English)');
  assert.equal(settings.count,6);
  assert.equal(settings.units,'fahrenheit');
  assert.equal(settings.city,'Boston, MA');
  assert.equal(settings.feeds.length,1);
  assert.equal(newsSettings({headline_count:'8',units:'celsius'}).count,8);
  assert.equal(newsSettings({units:'celsius'}).units,'celsius');
});

test('show_art defaults on and turns off only for false',()=>{
  const setting=manifest.display_settings.find(item=>item.key==='show_art');
  assert.equal(setting.type,'boolean');assert.equal(setting.default,true);
  assert.deepEqual(displaySettings({}),{show_art:true});
  assert.deepEqual(displaySettings({display_settings:{}}),{show_art:true});
  assert.deepEqual(displaySettings({display_settings:{show_art:true}}),{show_art:true});
  assert.deepEqual(displaySettings({display_settings:{show_art:false}}),{show_art:false});
});
