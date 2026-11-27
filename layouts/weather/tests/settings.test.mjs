import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readConfig,weatherSettings,displaySettings,timezoneOr} from '../src/server/settings.mjs';

const manifest=JSON.parse(await fs.readFile(new URL('../layout.json',import.meta.url),'utf8'));
const defaults=Object.fromEntries(manifest.settings.filter(setting=>'default' in setting).map(setting=>[setting.key,setting.default]));

test('a missing config.json applies the manifest defaults',async(t)=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weather-config-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const previous=process.env.DAYFRAME_SITE_CONFIG;
  process.env.DAYFRAME_SITE_CONFIG=path.join(directory,'config.json');
  t.after(()=>{if(previous===undefined) delete process.env.DAYFRAME_SITE_CONFIG; else process.env.DAYFRAME_SITE_CONFIG=previous;});
  const config=await readConfig();
  assert.deepEqual(config,{});
  assert.deepEqual(weatherSettings(config),{city:'',units:defaults.units});
  await fs.writeFile(process.env.DAYFRAME_SITE_CONFIG,'[1,2]');
  await assert.rejects(readConfig(),/Layout settings are unavailable/);
});

test('saved values are cleaned and invalid ones fall back to defaults',()=>{
  assert.deepEqual(weatherSettings({city:'  Boston,   MA ',units:'kelvin'}),{city:'Boston, MA',units:'fahrenheit'});
  assert.equal(weatherSettings({units:'celsius'}).units,'celsius');
  assert.equal(weatherSettings({city:42}).city,'');
  assert.equal(weatherSettings({city:'x'.repeat(300)}).city.length,100);
  assert.deepEqual(manifest.settings.map(setting=>setting.key),['city','units']);
});

test('show_art defaults on and turns off only for false; bad timezones fall back',()=>{
  const setting=manifest.display_settings.find(item=>item.key==='show_art');
  assert.equal(setting.default,true);
  assert.deepEqual(displaySettings({}),{show_art:true});
  assert.deepEqual(displaySettings({display_settings:{show_art:false}}),{show_art:false});
  assert.equal(timezoneOr('Europe/Paris'),'Europe/Paris');
  assert.equal(timezoneOr('Mars/Olympus'),'America/New_York');
});
