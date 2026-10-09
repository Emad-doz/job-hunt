import assert from 'node:assert/strict';
import {createScout} from '../server/scout.mjs';
import {ownerTrail,OWNER_APPLIED} from '../server/workflow.mjs';

// The owner applied to a vacancy the screening holds or never reviewed. Synthetic values only; the records are answered by the test itself.
const at='2026-10-09T10:00:00.000Z',origin='https://hq.example.test',uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const posting=(id,extra={})=>({id,sourceId:id.toLowerCase(),title:'Synthetic warehouse lead',employer:'Synthetic employer',location:'Remote',salary:'Unknown',url:'https://board.example.test/vacancy/'+id,description:'Synthetic text',skills:[],publishedAt:null,readAt:at,source:'Synthetic board',availability:'Source listing only',...extra});
const heldReceipts=w=>[{id:'HQ-R-'+uuid(1),workflowId:w,agentId:'01',at,inputReceipt:null,title:'Record source evidence',method:'Synthetic',findings:[],decision:'Source recorded; not an application'},{id:'HQ-R-'+uuid(2),workflowId:w,agentId:'02',at,inputReceipt:'HQ-R-'+uuid(1),title:'Compare vacancy and professional CV evidence',method:'Synthetic',findings:[],decision:'Hold: Requirement mismatch; synthetic reason'}];
const held={id:'HQ-W-'+uuid(9),job:posting('HELD-1'),fit:{eligible:false},fingerprint:'old',createdAt:at,receipts:heldReceipts('HQ-W-'+uuid(9)),draft:null,managerDecision:'Needs owner assessment',stage:'Analyst hold',tracker:null};
let config={state:{results:[held.job,posting('NEW-2')],workflows:[held]}};const appended=[];
const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const scout=createScout(connections,{HQ_ACCESS_PASSWORD:'synthetic-password',HQ_PUBLIC_ORIGIN:origin},{clock:()=>Date.parse(at),boardsDefault:[],fetcher:async(_url,init)=>{const b=JSON.parse(init.body);assert.equal(b.operation,'append-reviewed-discovery');appended.push(b);return Response.json({ok:true,recordId:'JOB-10'+appended.length,eventId:'EVT-020'+appended.length,at});}});
const post=fields=>scout.handle(new Request(origin+'/api/scout',{method:'POST',headers:{Origin:origin,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action:'append',confirmReviewed:true,...fields})}));
await scout.handle(new Request(origin+'/api/scout'));
// Without the owner's statement a held discovery is still not saved.
const refused=await post({workflowId:held.id});assert.equal(refused.status,400);assert.match((await refused.json()).error,/Held by current CV role screening/);assert.equal(appended.length,0);
// With it: a complete trail of five receipts that keeps the screening result and says which steps did not happen.
const saved=await post({workflowId:held.id,ownerApplied:true,jobId:'HELD-1'}),told=await saved.json();assert.equal(saved.status,200,told.error);assert.equal(told.receipt.recordId,'JOB-101');
const sent=appended[0];assert.deepEqual([sent.workflowId,sent.decision,sent.receipts.map(r=>r.agentId).join(','),sent.receipts[1].decision,sent.receipts[2].decision],[held.id,OWNER_APPLIED,'01,02,03,04,00','Hold: Requirement mismatch; synthetic reason',"Skipped on the owner's decision"]);
sent.receipts.forEach((r,i)=>{assert.match(r.id,/^HQ-R-[a-f0-9-]{36}$/);assert.equal(r.workflowId,held.id);assert.equal(r.inputReceipt,i?sent.receipts[i-1].id:null);assert(Array.isArray(r.findings)&&r.findings.length<=12);});
assert(sent.receipts[3].findings.some(f=>/screening is advice/.test(f.value)));
// Asked again, the saved receipt is returned and nothing is written twice.
assert.equal((await post({workflowId:held.id,ownerApplied:true})).status,200);assert.equal(appended.length,1);
// A discovery nobody reviewed gets a trail that says so, and an unknown one is refused.
const fresh=await post({jobId:'NEW-2',ownerApplied:true});assert.equal(fresh.status,200,(await fresh.clone().json()).error);assert.deepEqual([appended[1].job.id,appended[1].receipts.length,appended[1].receipts[1].decision,appended[1].decision],['NEW-2',5,'Not screened',OWNER_APPLIED]);
assert.match((await(await post({jobId:'GONE-3',ownerApplied:true})).json()).error,/discovery not found/);assert.equal(appended.length,2);
// The trail is made once: a retry after a lost answer sends the same receipts.
const lost={id:'HQ-W-'+uuid(8),job:posting('LOST-4'),receipts:[]};lost.ownerTrail=ownerTrail(lost,at);assert.equal(ownerTrail({...lost,receipts:lost.ownerTrail},at),lost.ownerTrail);assert.equal(lost.ownerTrail.length,5);
scout.close();
console.log('Owner-applied checks passed: a held discovery stays held without the owner\'s statement, is saved with it under a complete trail that keeps the screening result, an unreviewed discovery says it was not screened, no double write. Synthetic values only.');
