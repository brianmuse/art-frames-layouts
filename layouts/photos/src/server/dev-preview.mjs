// Dev-only preview: generated sample photos through the real service code, with
// no network. Production never imports this module's services.
import path from 'node:path';
import {createPhotoService} from './photo-service.mjs';
import {createPhotoCache} from './photo-cache.mjs';
import {createStateFile} from './state-file.mjs';
import {createRotation} from './rotation.mjs';
import {SAMPLE_ITEMS,sampleImage,sampleAlbumPage} from './samples.mjs';

const root=path.join(process.env.DAYFRAME_SITE_STATE || '.secrets/state','preview');
export const previewCache=createPhotoCache(root,{fetchImage:item=>sampleImage(item.id===SAMPLE_ITEMS.portrait.id?'portrait':'landscape')});
const services=new Map();

export function previewService(kind,fit) {
  const key=`${kind}:${fit}`;
  if(!services.has(key)) {
    const items=kind==='portrait'?[SAMPLE_ITEMS.portrait]:kind==='empty'?[]:[SAMPLE_ITEMS.landscape];
    services.set(key,createPhotoService({
      root:path.join(root,key.replace(':','-')),
      settings:async()=>({album_url:kind==='missing'?'':'https://photos.app.goo.gl/SampleAlbum',fit,order:'Newest first'}),
      fetchPage:async()=>kind==='error'?'<html><body>No album data here.</body></html>':sampleAlbumPage(items),
      cache:previewCache,
      rotation:createRotation(createStateFile(null,'rotation.json')),
      albumFile:createStateFile(null,'album.json'),
      renderWaitMs:15000,
    }));
  }
  return services.get(key);
}
