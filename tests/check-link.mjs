import assert from 'node:assert/strict';
import {createScout} from '../server/scout.mjs';

// Linking a discovery to a job already on the board. Synthetic values only; the records are answered by the test itself.
const at='2026-10-09T10:00:00.000Z',origin='https://hq.example.test';
let config={state:{results:[{id:'OTHER-9',sourceId:'other-9',title:'Synthetic analyst',employer:'Synthetic employer',location:'Remote',salary:'Unknown',url:'https://another-board.example.test/vacancy/777',description:'Synthetic text',skills:[],publishedAt:null,readAt:at,source:'Another synthetic board',availability:'Source listing only'}]}},reads=[],writes=0;
const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const scout=createScout(connections,{HQ_ACCESS_PASSWORD:'synthetic-password',HQ_PUBLIC_ORIGIN:origin},{clock:()=>Date.parse(at),boardsDefault:[],fetcher:async(_url,init)=>{const b=JSON.parse(init.body);if(b.operation==='read-application-record'){reads.push(b.recordId);return b.recordId==='JOB-4040'?Response.json({ok:false,error:'Not found'},{status:404}):Response.json({ok:true,recordId:b.recordId,url:'https://example.test/jobs/1'});}writes++;return Response.json({ok:true});}});
const post=(action,fields={})=>scout.handle(new Request(origin+'/api/scout',{method:'POST',headers:{Origin:origin,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...fields})}));
const view=async()=>await(await scout.handle(new Request(origin+'/api/scout'))).json();
assert.deepEqual((await view()).sameAs,[]);
// Refused: no real job ID, an unknown discovery, a job that cannot be read. Nothing is saved.
for(const [fields,pattern] of [[{jobId:'OTHER-9',recordId:'DEMO-1'},/Choose one of your jobs/],[{jobId:'NOPE',recordId:'JOB-0088'},/discovery not found/],[{jobId:'OTHER-9',recordId:'JOB-4040'},/could not be read/]]){const r=await post('link-job',fields);assert.equal(r.status,400);assert.match((await r.json()).error,pattern);}
assert.equal(config.sameAs,undefined);
// Linked: the job is only read to verify it exists; the link is a private note beside the discovery, and linking again replaces it.
const linked=await post('link-job',{jobId:'OTHER-9',recordId:'JOB-0088'}),told=await linked.json();assert.equal(linked.status,200,told.error);assert.match(told.message,/shows with JOB-0088/);
assert.deepEqual([config.sameAs.length,config.sameAs[0].jobId,config.sameAs[0].recordId,config.sameAs[0].url,config.sameAs[0].source,config.sameAs[0].at,writes],[1,'OTHER-9','JOB-0088','https://another-board.example.test/vacancy/777','Another synthetic board',at,0]);
assert.deepEqual((await view()).sameAs.map(l=>l.recordId),['JOB-0088']);
assert.equal((await post('link-job',{jobId:'OTHER-9',recordId:'JOB-0090'})).status,200);assert.deepEqual(config.sameAs.map(l=>l.recordId),['JOB-0090']);
// Undone: the posting is its own entry again; undoing twice says so.
assert.equal((await post('unlink-job',{jobId:'OTHER-9'})).status,200);assert.deepEqual([config.sameAs,(await view()).sameAs],[[],[]]);
assert.match((await(await post('unlink-job',{jobId:'OTHER-9'})).json()).error,/no longer saved/);assert.equal(writes,0,'no record was changed');
scout.close();
console.log('Link checks passed: a verified job and a recorded discovery only, one link per posting, shown to the page, undone on request, no record changed. Synthetic values only.');
