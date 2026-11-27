// The mat opening, copied from the news layout. The TV renderer runs no script,
// so the page places its content here. Sizes are in the page's `u` units
// (1u = 1% of the screen width).

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
