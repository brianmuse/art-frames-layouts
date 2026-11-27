// Generated sample photos for the dev preview and screenshots. No real photos.
import sharp from 'sharp';

const scenes={
  landscape:{width:3000,height:2000,svg:(w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25406b"/><stop offset=".55" stop-color="#e9906a"/><stop offset="1" stop-color="#f6d39a"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    <circle cx="${w*.68}" cy="${h*.56}" r="${h*.11}" fill="#ffe2a8"/>
    <path d="M0 ${h*.7} Q ${w*.25} ${h*.52} ${w*.5} ${h*.68} T ${w} ${h*.62} V ${h} H 0 Z" fill="#3c4f5c"/>
    <path d="M0 ${h*.82} Q ${w*.3} ${h*.7} ${w*.6} ${h*.84} T ${w} ${h*.8} V ${h} H 0 Z" fill="#1f2c33"/>
  </svg>`},
  portrait:{width:1500,height:2000,svg:(w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6f5e"/><stop offset="1" stop-color="#c9d98f"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="${w*.44}" y="${h*.35}" width="${w*.12}" height="${h*.65}" fill="#5b3b28"/>
    <circle cx="${w*.5}" cy="${h*.32}" r="${w*.32}" fill="#e4a33c"/>
    <circle cx="${w*.32}" cy="${h*.4}" r="${w*.2}" fill="#d9822b"/>
    <circle cx="${w*.68}" cy="${h*.42}" r="${w*.2}" fill="#c7672a"/>
  </svg>`},
};
export const SAMPLE_ITEMS={
  landscape:{id:'AF1QipSampleLandscape01',url:'https://lh3.googleusercontent.com/pw/SAMPLE-landscape-generated-image',width:3000,height:2000,takenAt:Date.UTC(2024,6,14,19,30),offsetMs:-4*3600000},
  portrait:{id:'AF1QipSamplePortrait001',url:'https://lh3.googleusercontent.com/pw/SAMPLE-portrait-generated-image',width:1500,height:2000,takenAt:Date.UTC(2023,9,2,15,0),offsetMs:-4*3600000},
};

export async function sampleImage(kind) {
  const scene=scenes[kind] || scenes.landscape;
  return sharp(Buffer.from(scene.svg(scene.width,scene.height))).jpeg({quality:88}).toBuffer();
}

/** A hand-written page in the shape of a shared album page, for the given items. */
export function sampleAlbumPage(items) {
  const rows=items.map(item=>[item.id,[item.url,item.width,item.height,null,null,null,null,null,[null,null,1],[123456]],item.takenAt,'hash',item.offsetMs,item.takenAt+1000,['owner'],[[2]],2,{'15':1}]);
  return `<!doctype html><html><head><title>Sample album</title></head><body><script class="ds:0">AF_initDataCallback({key: 'ds:0', hash: '1', data:[], sideChannel: {}});</script><script class="ds:1">AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([null,rows,'',['AF1QipSampleAlbum0001','Sample album']])}, sideChannel: {}});</script></body></html>`;
}
