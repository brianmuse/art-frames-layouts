// The TV renderer runs no script, so the page is fitted here. Sizes are in the
// page's `u` units (1u = 1% of the screen width) and mirror index.astro.

// The mat opening as fractions of the screen, from art.viewport.
export function opening(snapshot) {
  const viewport=snapshot?.art?.viewport;
  if (!viewport || typeof viewport!=='object') return null;
  const {x,y,width,height}=viewport;
  const screenWidth=snapshot.display?.width || 3840,screenHeight=snapshot.display?.height || 2160;
  if (![x,y,width,height,screenWidth,screenHeight].every(Number.isFinite) || x<0 || y<0 || width<=0 || height<=0 || x+width>screenWidth || y+height>screenHeight) return null;
  return {x:x/screenWidth,y:y/screenHeight,width:width/screenWidth,height:height/screenHeight,scale:Math.min(width/screenWidth,height/screenHeight)};
}
export function framingStyle(frame) {
  if (!frame) return {};
  return {'--content-x':`${frame.x*100}%`,'--content-y':`${frame.y*100}%`,'--content-width':`${frame.width*100}%`,'--content-height':`${frame.height*100}%`,'--content-scale':String(frame.scale)};
}

// Inter Regular advance widths (thousandths of an em) for ASCII 32–126; other characters use a wide fallback.
const interWidths='281,288,466,633,642,982,644,300,365,365,501,662,288,460,288,360,631,407,610,618,646,593,620,566,619,620,288,302,662,662,662,511,966,690,654,730,722,601,590,746,743,269,571,672,565,903,753,765,639,765,644,642,646,744,690,985,682,679,629,365,360,365,471,456,323,562,612,571,612,583,370,613,591,242,242,549,242,876,591,600,612,612,376,528,327,591,562,818,546,562,552,426,333,426,662'.split(',').map(Number);
const textWidth=(text,size,spacing=0)=>[...String(text)].reduce((total,char)=>{
  const code=char.codePointAt(0) || 0;
  return total+size*((code>=32 && code<127 ? interWidths[code-32]/1000 : .8)+spacing);
},0);
// Greedy line count at spaces; long words break anywhere. Slightly pessimistic on purpose.
export function lineCount(text,size,width,spacing=0) {
  let lines=1,used=0;
  const space=textWidth(' ',size,spacing),room=width*.96;
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    let length=textWidth(word,size,spacing);
    if (used && used+space+length<=room) {used+=space+length;continue;}
    if (used) lines++;
    while (length>room) {lines++;length-=room;}
    used=length;
  }
  return lines;
}

export const sizes={panelWidth:40,panelHeight:.92,title:1.5,titleLine:1.25,meta:.95,metaLine:1.3,metaGap:.3,heading:.95,headingGap:1,border:.05,safety:.4};
const pads=[1.05,.9,.75,.6,.48,.38,.3];

// Pick the roomiest row padding that shows every headline with up to two lines
// each. If none fits, drop headlines from the end.
export function fitPage(news,snapshot) {
  const frame=opening(snapshot),scale=frame?.scale || 1;
  const width=sizes.panelWidth*(frame?.width ?? 1)/scale;
  const room=sizes.panelHeight*56.25*(frame?.height ?? 1)/scale-sizes.safety;
  const headlines=news?.headlines || [];
  const lines=headlines.map(item=>Math.min(2,lineCount(item.title,sizes.title,width,-.02)));
  const fixed=sizes.heading*1.3+sizes.headingGap
    +(news?.updated ? .8+sizes.meta*sizes.metaLine : 0)
    +(news?.status ? .8+.8+sizes.border+.9*1.25*lineCount(news.status.title,.9,width-1.5)+.15+.8*1.3*lineCount(news.status.detail,.8,width-1.5) : 0)
    +(news?.empty ? 1.2*1.3+1.2 : 0);
  const height=(count,pad)=>fixed+lines.slice(0,count).reduce((total,count)=>total+2*pad+sizes.border+count*sizes.title*sizes.titleLine+sizes.metaGap+sizes.meta*sizes.metaLine,0);
  for (let count=headlines.length;count>0;count--) {
    const pad=pads.find(value=>height(count,value)<=room);
    if (pad!==undefined) return {frame,style:{...framingStyle(frame),'--row-pad':String(pad)},count,lines:lines.slice(0,count),used:height(count,pad),room};
  }
  return {frame,style:{...framingStyle(frame),'--row-pad':String(pads.at(-1))},count:0,lines:[],used:fixed,room};
}
