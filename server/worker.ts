import {getSnapshot,type Settings} from './snapshot';
export default {async fetch(request:Request,env:Settings&{ASSETS:{fetch:(request:Request)=>Promise<Response>}}){
const path=new URL(request.url).pathname;
if(path==='/api/snapshot'){if(request.method!=='GET')return new Response('Read-only endpoint',{status:405,headers:{Allow:'GET'}});return getSnapshot(request,env);}
if(path.startsWith('/api/'))return new Response('Not found',{status:404});
const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');if(path==='/'||path.endsWith('.html'))headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});
}};

