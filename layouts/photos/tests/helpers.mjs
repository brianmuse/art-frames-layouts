// Test helpers: a fake HTTPS layer and tiny generated images. No network.
import https from 'node:https';
import dns from 'node:dns/promises';
import {EventEmitter} from 'node:events';
import sharp from 'sharp';

/** Mock DNS and https.get. routes(url) returns {status, headers, body} or throws. */
export function mockHttps(t,routes,{address='142.250.0.1'}={}) {
  const calls=[];
  t.mock.method(dns,'lookup',async host=>[{address:typeof address==='function'?address(host):address,family:4}]);
  t.mock.method(https,'get',(url,options,receive)=>{
    calls.push(String(url));
    const request=new EventEmitter();
    queueMicrotask(()=>{
      let reply;
      try {reply=routes(new URL(String(url)));} catch(error) {request.emit('error',error);return;}
      const response=new EventEmitter();
      response.statusCode=reply.status ?? 200;
      response.headers=reply.headers || {};
      response.complete=true;
      response.destroy=()=>{};
      receive(response);
      if(reply.body!==undefined) response.emit('data',Buffer.from(reply.body));
      response.emit('end');
    });
    return request;
  });
  return calls;
}

export const tinyImage=(width=64,height=48,color={r:200,g:120,b:60})=>sharp({create:{width,height,channels:3,background:color}}).jpeg().toBuffer();

export const item=(n,extra={})=>({id:`AF1QipTestItem${String(n).padStart(4,'0')}`,url:`https://lh3.googleusercontent.com/pw/AP1GczTestItemBaseUrl${String(n).padStart(6,'0')}`,width:400,height:300,takenAt:Date.UTC(2020,0,1)+n*86400000,offsetMs:0,...extra});
