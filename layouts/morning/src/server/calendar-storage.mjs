import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory} from './state-file.mjs';

export function createCalendarStorage(root) {
  let writes=Promise.resolve();
  const valid=key=>/^[a-f0-9]{64}$/.test(key);
  const prepare=()=>privateDirectory(root);
  function write(fn) {
    const task=writes.then(fn);writes=task.catch(()=>{});return task;
  }
  return {
    async load(key) {
      if(!valid(key)) return null;
      try {
        await prepare();
        const file=path.join(root,key+'.json'),stat=await fs.lstat(file);
        if(!stat.isFile() || stat.isSymbolicLink() || stat.size>16_100_000) return null;
        const value=JSON.parse(await fs.readFile(file,'utf8'));
        if(value.version!==1 || value.refreshKey!==null && !/^\d{4}-\d{2}-\d{2}$/.test(value.refreshKey)) return null;
        // A failure record may exist before any successful download.
        const failure=value.failure,validFailure=failure && /^[a-z-]{1,40}$/.test(failure.code) && (failure.status===null || Number.isInteger(failure.status)) && Number.isSafeInteger(failure.failures) && failure.failures>0 && (Number.isSafeInteger(failure.retryAt) || failure.retryAt===null) && typeof failure.hold==='boolean';
        if(failure!==undefined && !validFailure) return null;
        if(value.text===null ? value.updatedAt!==null || !failure : typeof value.text!=='string' || Buffer.byteLength(value.text)>8_000_000 || !Number.isSafeInteger(value.updatedAt) || value.updatedAt<0) return null;
        return {...value,...failure && {failure:{...failure,retryAt:failure.retryAt ?? 0}}};
      } catch {return null;}
    },
    save(key,value) {
      return write(async()=>{
        if(!valid(key)) throw new Error('Invalid calendar cache key');
        await prepare();
        const temporary=path.join(root,'.'+randomUUID()+'.tmp');
        try {
          await fs.writeFile(temporary,JSON.stringify({version:1,...value}),{mode:0o600,flag:'wx'});
          await fs.rename(temporary,path.join(root,key+'.json'));
          const files=await Promise.all((await fs.readdir(root)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>({name,stat:await fs.lstat(path.join(root,name))})));
          files.sort((a,b)=>a.stat.mtimeMs-b.stat.mtimeMs);
          for(const old of files.slice(0,Math.max(0,files.length-8))) await fs.unlink(path.join(root,old.name));
        } finally {await fs.unlink(temporary).catch(()=>{});}
      }).catch(()=>{console.warn('Calendar cache could not be saved');});
    },
    prune(keys) {
      return write(async()=>{
        await prepare();const keep=new Set(keys);
        for(const name of await fs.readdir(root)) if(/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(name.slice(0,-5))) await fs.unlink(path.join(root,name));
      }).catch(()=>{console.warn('Calendar cache cleanup could not complete');});
    },
  };
}
