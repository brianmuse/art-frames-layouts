import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// A real 0700 directory, not a symlink; shared with the calendar cache.
export async function privateDirectory(root) {
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const stat=await fs.lstat(root);
  if(!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid state directory');
  await fs.chmod(root,0o700);
}
// Small private JSON records beside the calendar cache: 0600 files in a 0700
// directory, written atomically and read with a size bound.
export function createStateFile(root,name,{maxBytes=1_000_000}={}) {
  let writes=Promise.resolve();
  const file=root && path.join(root,name);
  const prepare=()=>privateDirectory(root);
  return {
    async load() {
      if(!file) return null;
      try {
        await prepare();
        const stat=await fs.lstat(file);
        if(!stat.isFile() || stat.isSymbolicLink() || stat.size>maxBytes) return null;
        return JSON.parse(await fs.readFile(file,'utf8'));
      } catch {return null;}
    },
    save(value) {
      if(!file) return Promise.resolve();
      const task=writes.then(async()=>{
        await prepare();
        const body=JSON.stringify(value);
        if(Buffer.byteLength(body)>maxBytes) throw new Error('State record too large');
        const temporary=path.join(root,'.'+randomUUID()+'.tmp');
        try {
          await fs.writeFile(temporary,body,{mode:0o600,flag:'wx'});
          await fs.rename(temporary,file);
        } finally {await fs.unlink(temporary).catch(()=>{});}
      }).catch(()=>{console.warn('Layout state could not be saved');});
      writes=task;return task;
    },
  };
}
