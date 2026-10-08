import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, timingSafeEqual} from 'node:crypto';
import {createConnections} from './connections.mjs';
import {createScout} from './scout.mjs';
import {createApplications} from './applications.mjs';
import {createMail} from './mail.mjs';
import {createDatabase} from './database.mjs';
import {createProfile} from './profile.mjs';
import {createTransfer} from './transfer.mjs';
import {storedCv,storedCvMaterial} from './cv-reader.mjs';
import {ownWords} from './matching.mjs';
import {RECORDS} from './workflow.mjs';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.glb':'model/gltf-binary'};
const digest=value=>createHash('sha256').update(value).digest();

export function createHqServer(worker, environment, rootDirectory){
  const root=path.resolve(rootDirectory);
  const password=environment.HQ_ACCESS_PASSWORD;
  if(password && password.length<20)throw new Error('Use an access password of at least 20 characters.');
  const expected=password ? digest('Basic '+Buffer.from((environment.HQ_ACCESS_USERNAME||'owner')+':'+password).toString('base64')) : null;
  const connections=createConnections(environment,root);
  // Scout, applications and mail change records by sending one fixed operation to the records address (workflow.mjs); it is answered here, by the database.
  const database=createDatabase(connections,environment),profile=createProfile(connections,environment);
  const routed=async(url,init)=>url===RECORDS?database.change(JSON.parse(init.body)):fetch(url,init);
  const storedCvText=()=>profile.storedCv();
  const ownScreeningWords=async()=>ownWords(await profile.storedProfile(),((await connections.settings()).SCOUT_CONFIG||{}).terms);
  const scout=createScout(connections,environment,{fetcher:routed,cvStore:storedCvText,profileStore:()=>profile.storedProfile(),cvReader:storedCv(storedCvText,ownScreeningWords),cvMaterialReader:storedCvMaterial(storedCvText,ownScreeningWords)});
  const applications=createApplications(connections,environment,{fetcher:routed});
  const mail=createMail(connections,environment,{fetcher:routed});
  const transfer=createTransfer(connections,environment,{reload:()=>scout.reload(),working:()=>scout.busy()});
  const assets={async fetch(request){
    let pathname;
    try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Invalid path',{status:400});}
    const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!target.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
    // Unhashed files are revalidated on every load so a deploy shows at once; content-hashed chunks never change.
    try{return new Response(await fs.readFile(target),{headers:{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':/\/chunk-[A-Z0-9]{6,}\.(?:js|css)$/.test(pathname)?'private, max-age=31536000, immutable':'private, no-cache'}});}catch{return new Response('Not found',{status:404});}
  }};
  // What this process has been asked since it started and how much processor time it has used. Counts only; no request content.
  const usage={startedAt:new Date().toISOString(),requests:{},refused:0};
  const count=name=>{usage.requests[name]=(usage.requests[name]||0)+1;};
  const server=http.createServer(async(req,res)=>{
    try{
      // Never trust identity headers supplied by visitors or a generic proxy.
      const headers=new Headers();
      for(const [key,value] of Object.entries(req.headers))if(value && !['authorization','oai-authenticated-user-id','oai-authenticated-user-email'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
      if(expected && !timingSafeEqual(expected,digest(req.headers.authorization||''))){
        res.writeHead(401,{'WWW-Authenticate':'Basic realm="Job Hunt", charset="UTF-8"','Cache-Control':'no-store'});
        usage.refused++;res.end('Owner sign-in required');return;
      }
      const host=req.headers.host||'localhost';
      const local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
      const url=new URL(req.url,(local?'http://':'https://')+host);
      // One address on your own machine: pages opened at 127.0.0.1 or [::1] move to localhost, where a mailbox sign-in can return.
      if(local&&url.hostname!=='localhost'&&req.method==='GET'&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/assets/')){res.writeHead(302,{Location:'http://localhost'+(url.port?':'+url.port:'')+url.pathname+url.search,'Cache-Control':'no-store'});res.end();return;}
      let body;
      if(['/api/connections','/api/scout','/api/applications','/api/mail','/api/database','/api/profile','/api/transfer'].includes(url.pathname)&&req.method==='POST'){
        // A CV upload is a whole PDF; every other request is a small piece of JSON.
        const chunks=[],limit=url.pathname==='/api/transfer'?60_000_000:url.pathname==='/api/profile'?5_600_000:65536;let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413,{'Cache-Control':'no-store'});res.end('Connection settings exceed the 64 KB limit');return;}chunks.push(chunk);}
        body=Buffer.concat(chunks);
      }
      const request=new Request(url,{method:req.method,headers,...(body?{body}: {})});
      count(url.pathname.startsWith('/api/')?req.method+' '+url.pathname:'pages and files');
      let result;
      if(url.pathname==='/api/health'&&expected){const cpu=process.cpuUsage(),uptime=process.uptime();result=Response.json({startedAt:usage.startedAt,uptimeSeconds:Math.round(uptime),cpuSeconds:Math.round((cpu.user+cpu.system)/1e4)/100,cpuShare:Math.round((cpu.user+cpu.system)/1e4/uptime)/100,memoryMb:Math.round(process.memoryUsage().rss/1048576),refusedWithoutSignIn:usage.refused,requests:usage.requests},{headers:{'Cache-Control':'private, no-store'}});}
      else if(url.pathname==='/api/connections')result=await connections.handle(request);
      else if(url.pathname==='/api/scout')result=await scout.handle(request);
      else if(url.pathname==='/api/applications')result=await applications.handle(request);
      else if(url.pathname==='/api/mail'||url.pathname==='/api/mail/callback')result=await mail.handle(request);
      else if(url.pathname==='/api/database')result=await database.handle(request);
      else if(url.pathname==='/api/profile')result=await profile.handle(request);
      else if(url.pathname==='/api/transfer'&&expected)result=await transfer.handle(request);
      else if(url.pathname==='/api/snapshot'&&req.method==='GET'&&expected&&await database.live())result=await database.snapshot();
      else{
        const settings=environment;
        result=await worker.fetch(new Request(request,{headers}),{...settings,ASSETS:assets});
      }
      const responseHeaders=Object.fromEntries(result.headers);
      responseHeaders['referrer-policy']='no-referrer';
      responseHeaders['x-frame-options']='DENY';
      res.writeHead(result.status,responseHeaders);
      res.end(Buffer.from(await result.arrayBuffer()));
    }catch{
      res.writeHead(500,{'Cache-Control':'no-store'});res.end('Headquarters temporarily unavailable');
    }
  });
  server.on('close',()=>scout.close());return server;
}
