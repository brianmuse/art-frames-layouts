// The one service instance shared by server.mjs (background sync) and renders.
import {createPhotoService} from './photo-service.mjs';

let instance=null;
export const photoService=()=>instance ||= createPhotoService();
