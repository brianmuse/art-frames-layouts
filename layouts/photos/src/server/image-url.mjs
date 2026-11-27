// Google image CDN size parameters. "=wW-hH" scales the photo to fit inside W×H and
// keeps its aspect ratio; Google does not enlarge past the original. "-p" crops to
// exactly W×H around the subject (and would enlarge, so the layout never asks for more
// than the original). "-no" removes the play-button overlay of video stills.
import {baseUrl} from './album-parser.mjs';

const MAX_SIDE=7680;
const clamp=value=>Math.max(1,Math.min(MAX_SIDE,Math.ceil(value)));

/**
 * The pixel box to ask Google for. Cover asks for a crop in the screen shape at no
 * more than the original resolution; contain asks for the photo to fit the screen.
 */
export function requestBox(item,box,fit) {
  const {width,height}=item;
  if(!width || !height) {
    // Unknown shape (fallback parser): ask for enough pixels for either orientation.
    const side=Math.max(box.width,box.height);
    return {width:clamp(side),height:clamp(side),crop:false};
  }
  if(fit==='cover') {
    const cropWidth=Math.min(box.width,width,height*box.width/box.height);
    return {width:clamp(Math.floor(cropWidth)),height:clamp(Math.floor(cropWidth*box.height/box.width)),crop:true};
  }
  const ratio=Math.min(1,box.width/width,box.height/height);
  return {width:clamp(width*ratio),height:clamp(height*ratio),crop:false};
}

/** A sized image URL, or null when the base URL is not an allowed CDN address. */
export function sizedUrl(base,{width,height,crop=false}) {
  const clean=baseUrl(base);
  if(!clean) return null;
  return `${clean}=w${clamp(width)}-h${clamp(height)}${crop?'-p':''}-no`;
}
