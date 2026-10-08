import assert from 'node:assert/strict';
import {applyOperation} from '../server/records.mjs';
import {applicationInput,evidenceInput,applicationBridge,createApplications,statusInput,statusOptions,statusCapabilities} from '../server/applications.mjs';
const secret='synthetic-application-bridge-secret-32',uuid='HQ-A-00000000-0000-4000-8000-000000000001';
const input={recordId:'JOB-0088',requestId:uuid,appliedOn:'2026-10-02',expectedStatus:'Ready to apply',expectedApplied:'',confirmApplied:true};
assert.equal(applicationInput(input).operation,'record-owner-application');
assert.throws(()=>applicationInput({...input,recordId:'DEMO-001'}));assert.throws(()=>applicationInput({...input,confirmApplied:false}));assert.throws(()=>applicationInput({...input,appliedOn:'2026-02-30'}));
assert.equal(evidenceInput({recordId:input.recordId,requestId:uuid,reference:'Synthetic email subject (2026-10-02)',confirmEvidence:true,kind:'outlook-receipt'}).kind,'owner-reference');
const payload=applicationInput(input);
// The stand-in for the records answers with the real record operations on one synthetic job.
const records={jobs:[{id:input.recordId,employer:'Synthetic Employer',role:'Synthetic Role',status:input.expectedStatus,applied:'',url:'https://example.test/jobs/88',confirmation:''}],events:[],receipts:new Set()};
const saved=applyOperation(records,payload,new Date('2026-10-08T10:00:00Z')).reply;assert(saved.ok,saved.error);assert.equal(saved.status,'Applied');
const config={};
await assert.rejects(()=>applicationBridge(payload,config,async()=>Response.json({ok:false,error:'Unsupported append request.'})),/refused this kind of update/);
await assert.rejects(()=>applicationBridge(payload,config,async()=>{throw Error('Synthetic outage');}),/may have been saved/);
const request=body=>new Request('https://hq.test/api/applications',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)});
let calls=0;
let durableConfig={...config};const apiConnections={settings:async()=>({SCOUT_CONFIG:durableConfig}),updateScout:async fn=>{durableConfig=fn(durableConfig);}};
const api=createApplications(apiConnections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async(url,options)=>{calls++;const sent=JSON.parse(options.body);assert(sent.operation==='record-owner-application');assert(!('status' in sent));return Response.json({...saved,ok:true});}});
assert.equal((await api.handle(request({action:'applied',...input,status:'Hired'}))).status,200);assert.equal(calls,1);
assert.equal((await api.handle(request({action:'applied',...input,confirmApplied:false}))).status,400);assert.equal(calls,1);
assert.equal((await api.handle(new Request('https://hq.test/api/applications',{method:'POST',headers:{host:'hq.test',origin:'https://evil.test','content-type':'application/json'},body:JSON.stringify(input)}))).status,403);
assert.equal((await createApplications({},{},{}).handle(request(input))).status,403);
const uncertain=createApplications(apiConnections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async()=>{throw Error('Synthetic outage after request');}});
assert.equal((await uncertain.handle(request({action:'applied',...input}))).status,400);
const pending=await(await uncertain.handle(new Request('https://hq.test/api/applications?recordId='+input.recordId))).json();assert.equal(pending.pending.requestId,input.requestId);assert.equal(pending.pending.input.expectedApplied,'');assert(!JSON.stringify(pending).includes(secret));assert.equal((await api.handle(request({action:'applied',...input}))).status,200);assert.equal(durableConfig.applicationRequests.length,0);
// A leftover unconfirmed request no longer blocks the job for good: once Google has moved on from the record it started from, it is released; while Google still shows that record, or the request is fresh, the block stays.
{
  const old=new Date(Date.now()-600000).toISOString(),other=input.requestId.slice(0,-1)+(input.requestId.endsWith('a')?'b':'a');
  const make=(record,requestedAt)=>{let store={...config,applicationRequests:[{action:'applied',input:{...applicationInput(input),requestId:other},requestedAt}]};let writes=0;const conn={settings:async()=>({SCOUT_CONFIG:store}),updateScout:async fn=>{store=fn(store);}};
    const app=createApplications(conn,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async(url,options)=>{const sent=JSON.parse(options.body);if(sent.operation==='read-application-record')return Response.json({ok:true,recordId:input.recordId,...record});writes++;return Response.json({...saved,ok:true});}});return {app,store:()=>store,writes:()=>writes};};
  const moved=make({status:'Applied',appliedOn:'2026-10-06'},old),first=await moved.app.handle(request({action:'applied',...input}));assert.equal(first.status,200,'the record moved on: the leftover is released and the new change goes through');assert.equal(moved.store().applicationRequests.length,0);assert(moved.store().resolvedStatusRequests.some(r=>r.requestId===other&&/Released automatically/.test(r.source)));assert.equal(moved.writes(),1);
  const same=make({status:input.expectedStatus,appliedOn:input.expectedApplied},old),second=await same.app.handle(request({action:'applied',...input}));assert.equal(second.status,400);assert(/never confirmed/.test((await second.json()).error));assert.equal(same.store().applicationRequests.length,1);assert.equal(same.writes(),0);
  const fresh=make({status:'Applied',appliedOn:'2026-10-06'},new Date().toISOString()),third=await fresh.app.handle(request({action:'applied',...input}));assert.equal(third.status,400);assert(/awaiting readback/.test((await third.json()).error),'a request made moments ago is not released');
}
console.log('Application tests passed: leftover requests released once the record moved on, narrow owner writes, native IDs, evidence preservation, duplicate retries, partial repair, advanced statuses, authentication and failures.');

// Owner status changes retain every field except Status and journal a request.
const statusBody={action:'status',recordId:input.recordId,requestId:'HQ-S-00000000-0000-4000-8000-000000000001',status:'Shortlisted',expectedStatus:'Ready to apply',expectedApplied:'',reason:'Owner reviewed the original vacancy',confirmStatus:true};
assert.equal(statusInput(statusBody).operation,'record-owner-status');
for(const invalid of [{...statusBody,status:'Invented'},{...statusBody,confirmStatus:false},{...statusBody,reason:''},{...statusBody,status:'Applied'}])assert.throws(()=>statusInput(invalid));
const statusPayload=statusInput(statusBody);
const statusRecords={jobs:[{id:input.recordId,employer:'Synthetic Employer',role:'Synthetic Role',status:statusBody.expectedStatus,applied:'',url:'https://example.test/jobs/88',confirmation:''}],events:[],receipts:new Set()};
const caps=applyOperation(statusRecords,{operation:'read-status-capabilities'}).reply;assert(caps.ok);assert.deepEqual(caps.statuses,statusOptions,'the page and the records offer the same statuses');
const statusSaved=applyOperation(statusRecords,statusPayload,new Date('2026-10-08T10:00:00Z')).reply;assert(statusSaved.ok,statusSaved.error);assert.equal(statusSaved.status,'Shortlisted');
assert.equal((await statusCapabilities(config,async()=>Response.json({ok:false,error:'Unsupported append request.'}))).available,false);{const old=await statusCapabilities(config,async()=>new Response('<html>Error</html>',{status:200}));assert.equal(old.available,false);assert(/did not answer the status check/.test(old.message),'an answer that is not a record reply is explained, not reported as a failure');}assert.equal((await statusCapabilities(config,async()=>Response.json(caps))).available,true);await assert.rejects(()=>statusCapabilities(config,async()=>Response.json({ok:true,version:'owner-status-v1',statuses:['Delete everything']})),/Unrecognized/);
const statusApi=createApplications(apiConnections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async()=>Response.json({...statusSaved,ok:true})});
assert.equal((await statusApi.handle(request(statusBody))).status,200);assert.equal(durableConfig.applicationRequests.length,0);
const statusUncertain=createApplications(apiConnections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async()=>{throw Error('Synthetic outage');}});assert.equal((await statusUncertain.handle(request(statusBody))).status,400);const statusPending=await(await statusUncertain.handle(new Request('https://hq.test/api/applications?recordId='+input.recordId+'&action=status'))).json();assert.equal(statusPending.pending.input.status,'Shortlisted');assert(!JSON.stringify(statusPending).includes(secret));const ordinaryPending=await(await statusUncertain.handle(new Request('https://hq.test/api/applications?recordId='+input.recordId))).json();assert.equal(ordinaryPending.pending,null);assert.equal((await statusApi.handle(request({...statusBody,requestId:statusBody.requestId.slice(0,-1)+'7'}))).status,400,'Conflicting requests cannot jump an uncertain update');assert.equal((await statusApi.handle(request(statusBody))).status,200);
console.log('Owner status checks passed: native choices, field and evidence preservation, strict owner confirmation, concurrent-change guards, exact partial retries, private pending recovery and old-bridge capability gating. Synthetic data only.');

assert.equal((await statusUncertain.handle(request(statusBody))).status,400);
const resolver=createApplications(apiConnections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:async(_url,init)=>{assert.equal(JSON.parse(init.body).operation,'read-application-record');return Response.json({ok:true,recordId:input.recordId,status:'Interview',appliedOn:'2026-10-01'});}});
const resolveBody={action:'resolve-status',recordId:input.recordId,requestId:statusBody.requestId,currentStatus:'Interview',currentApplied:'2026-10-01',confirmCurrent:true};
assert.equal((await resolver.handle(request({...resolveBody,confirmCurrent:false}))).status,400);assert.equal((await resolver.handle(request({...resolveBody,currentStatus:'Applied'}))).status,400);assert.equal(durableConfig.applicationRequests.length,1,'Mismatch retains the exact pending request');
const resolved=await(await resolver.handle(request(resolveBody))).json();assert(resolved.resolved);assert.equal(resolved.status,'Interview');assert.equal(durableConfig.applicationRequests.length,0);assert.equal(durableConfig.resolvedStatusRequests[0].requestId,statusBody.requestId);assert(!JSON.stringify(resolved).includes(secret));assert(resolved.message.includes('No write'));
assert.equal((await resolver.handle(request(resolveBody))).status,400,'Resolution cannot clear a different or missing request');
console.log('Pending status recovery checks passed: owner confirmation, fresh native readback, unchanged records, mismatch retention and a private resolution audit.');
