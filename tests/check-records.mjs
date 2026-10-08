import assert from 'node:assert/strict';
import {applyOperation,STATUSES,urlKey} from '../server/records.mjs';

// Synthetic records only. Each operation must answer as the Google bridge did and change nothing beyond what it names.
const now=new Date('2026-10-08T10:00:00Z'),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const fresh=()=>({jobs:[
  {id:'JOB-001',employer:'Synthetic Retail BV',role:'Digital Analyst',status:'Researching',applied:'',url:'https://example.test/jobs/1?jobid=7',source:'Example Board',postingId:'P-7',notes:'',confirmation:''},
  {id:'JOB-002',employer:'Example Labs',role:'CRO Specialist',status:'Applied',applied:'2026-10-01',url:'https://example.test/jobs/2',source:'Example Board',postingId:'',notes:'',confirmation:''}],
  events:[{id:'EVT-0007',recordId:'JOB-002',date:'2026-10-01',type:'Submitted',actor:'Candidate',details:'Synthetic earlier entry',evidence:'',next:'',due:'',category:'candidate'}],receipts:new Set()});
const run=(store,body)=>applyOperation(store,body,now);

// Reading: capabilities and one record, in the bridge's own shape.
assert.deepEqual(run(fresh(),{operation:'read-status-capabilities'}).reply,{ok:true,version:'owner-status-v1',statuses:STATUSES});
assert.deepEqual(run(fresh(),{operation:'read-application-record',recordId:'JOB-001'}).reply,{ok:true,recordId:'JOB-001',employer:'Synthetic Retail BV',role:'Digital Analyst',postingId:'P-7',url:'https://example.test/jobs/1?jobid=7',status:'Researching',appliedOn:'',reference:''});
assert.equal(run(fresh(),{operation:'read-application-record',recordId:'JOB-999'}).reply.ok,false);
assert.equal(run(fresh(),{operation:'edit-cell',recordId:'JOB-001',field:'status',value:'Offer'}).reply.ok,false,'there is no free edit');

// Deleting: only with an explicit confirmation; the job and its history go; an applied job leaves one line; its number is never used again.
{const request={operation:'delete-record',recordId:'JOB-002',requestId:'HQ-D-'+uuid(20),confirmDelete:true};
  assert.equal(run(fresh(),{...request,confirmDelete:undefined}).reply.ok,false,'needs confirmation');assert.equal(run(fresh(),{...request,requestId:'x'}).reply.ok,false);assert.equal(run(fresh(),{...request,recordId:'JOB-404'}).reply.ok,false);
  const store=fresh(),done=run(store,request);assert.equal(done.reply.ok,true,done.reply.error);assert.deepEqual([done.reply.deleted,done.reply.history,done.reply.kept],[true,1,'one line']);
  assert.deepEqual(store.jobs.map(j=>j.id),['JOB-001']);assert.equal(store.events.length,0);assert.deepEqual(done.removed.jobs,['JOB-002']);assert.deepEqual([done.removed.traces[0].employer,done.removed.traces[0].applied],['Example Labs','2026-10-01']);
  assert.equal(run(store,request).reply.ok,false,'it is gone');
  const plain=run(fresh(),{...request,recordId:'JOB-001'});assert.equal(plain.reply.kept,'nothing');assert.equal(plain.removed.traces.length,0,'a job never applied to leaves nothing');
  // After the highest-numbered job is deleted, the next new job still gets a fresh number.
  const receipts=w=>['01','02','03','04','00'].map((agentId,i)=>({id:'HQ-R-'+uuid(30+i),workflowId:w,agentId,inputReceipt:i?'HQ-R-'+uuid(29+i):null,at:now.toISOString(),title:'Synthetic',method:'Synthetic',findings:[],decision:'Synthetic'})),w='HQ-W-'+uuid(21);
  const later=run({...store,counters:{job:2,event:8}},{operation:'append-reviewed-discovery',workflowId:w,receipts:receipts(w),job:{title:'Web Analyst',employer:'New Synthetic Co',source:'Example Board',sourceId:'P-5',url:'https://example.test/jobs/5',location:'Amsterdam',availability:'Open'}});assert.equal(later.reply.recordId,'JOB-003','JOB-002 is not handed out again');assert.equal(later.reply.eventId,'EVT-0009');}

// Recording an application: only from an open status, only with the status and date the owner saw, journalled once.
{const store=fresh(),request={operation:'record-owner-application',recordId:'JOB-001',requestId:'HQ-A-'+uuid(1),appliedOn:'2026-10-07',expectedStatus:'Researching',expectedApplied:'',confirmApplied:true};
  const done=run(store,request);assert.equal(done.reply.ok,true,done.reply.error);assert.deepEqual([done.reply.status,done.reply.appliedOn,done.reply.eventId,done.reply.duplicate],['Applied','2026-10-07','EVT-0008',false]);
  assert.deepEqual([...done.jobs.keys()],['JOB-001']);assert.equal(done.events.length,1);assert.equal(done.events[0].type,'Submitted');assert.equal(done.events[0].date,'2026-10-07');assert.equal(done.events[0].category,'candidate');
  const again=run(store,request);assert.equal(again.reply.duplicate,true);assert.equal(again.reply.eventId,'EVT-0008');assert.equal(again.events.length,0,'a retry adds no second entry');
  assert.equal(run(store,{...request,appliedOn:'2026-10-06'}).reply.ok,false,'the same request ID cannot carry other data');
  assert.equal(run(fresh(),{...request,expectedStatus:'Shortlisted'}).reply.ok,false,'a record that changed is not overwritten');
  assert.equal(run(fresh(),{...request,appliedOn:'2026-10-09'}).reply.ok,false,'not a future date');
  assert.equal(run(fresh(),{...request,recordId:'JOB-002',expectedStatus:'Applied',expectedApplied:'2026-10-01'}).reply.ok,false,'not twice');
  assert.equal(run(fresh(),{...request,confirmApplied:false}).reply.ok,false);}

// A status change: owner-confirmed, with a reason, against the status the owner saw.
{const store=fresh(),request={operation:'record-owner-status',recordId:'JOB-002',requestId:'HQ-S-'+uuid(2),status:'Interview',expectedStatus:'Applied',expectedApplied:'2026-10-01',reason:'Synthetic invitation',confirmStatus:true};
  const done=run(store,request);assert.equal(done.reply.ok,true,done.reply.error);assert.equal(done.reply.status,'Interview');assert.equal(done.reply.appliedOn,'2026-10-01');assert.equal(store.jobs[1].status,'Interview');assert.equal(store.jobs[1].applied,'2026-10-01','the applied date is kept');
  assert(done.events[0].details.startsWith('[HQ status HQ-S-'+uuid(2)+'] Owner requests status Applied → Interview. Reason: Synthetic invitation.'));
  assert.equal(run(store,request).reply.duplicate,true);
  assert.equal(run(fresh(),{...request,expectedStatus:'Interview'}).reply.ok,false);assert.equal(run(fresh(),{...request,status:'Applied'}).reply.ok,false,'no change to the same status');
  assert.equal(run(fresh(),{...request,status:'Made up'}).reply.ok,false);assert.equal(run(fresh(),{...request,reason:'x'}).reply.ok,false);assert.equal(run(fresh(),{...request,confirmStatus:false}).reply.ok,false);
  assert.equal(run(fresh(),{...request,recordId:'JOB-001',status:'Applied',expectedStatus:'Researching',expectedApplied:''}).reply.ok,false,'Applied needs its date through the application control');}

// Evidence: appended to what is there, never before an application, once per request.
{const store=fresh(),request={operation:'attach-application-evidence',recordId:'JOB-002',requestId:'HQ-A-'+uuid(3),reference:'Synthetic confirmation reference',kind:'owner-reference',confirmEvidence:true};
  const done=run(store,request);assert.equal(done.reply.ok,true,done.reply.error);assert.equal(store.jobs[1].confirmation,'[HQ application HQ-A-'+uuid(3)+'] Synthetic confirmation reference');assert.equal(done.events[0].type,'Other');
  assert.equal(run(store,request).events.length,0);assert.equal(store.jobs[1].confirmation.split('\n').length,1);
  const second=run(store,{...request,requestId:'HQ-A-'+uuid(4),reference:'Second synthetic reference',kind:'outlook-receipt',receivedAt:'2026-10-02T08:00:00Z'});assert.equal(second.reply.ok,true,second.reply.error);assert.equal(store.jobs[1].confirmation.split('\n').length,2,'earlier evidence is kept');assert.equal(second.events[0].type,'Confirmation');assert.equal(second.events[0].date,'2026-10-02T08:00:00.000Z');assert.equal(second.events[0].category,'employer');
  assert.equal(run(fresh(),{...request,recordId:'JOB-001'}).reply.ok,false,'no evidence before an application');
  assert.equal(run(fresh(),{...request,kind:'outlook-receipt'}).reply.ok,false,'an Outlook reference needs its received time');}

// Saving a reviewed discovery: a new job with the next ID, or the existing job when the posting is already there.
{const receipts=(workflowId)=>['01','02','03','04','00'].map((agentId,i)=>({id:'HQ-R-'+uuid(10+i),workflowId,agentId,inputReceipt:i?'HQ-R-'+uuid(9+i):null,at:now.toISOString(),title:'Synthetic step',method:'Synthetic',findings:['Synthetic finding'],decision:'Synthetic'}));
  const workflowId='HQ-W-'+uuid(5),posting={title:'Web Analyst',employer:'New Synthetic Co',source:'Example Board',sourceId:'P-99',url:'https://example.test/jobs/99',location:'Amsterdam',availability:'Open when checked'};
  const store=fresh(),request={operation:'append-reviewed-discovery',workflowId,job:posting,receipts:receipts(workflowId),decision:'Owner review required'};
  const done=run(store,request);assert.equal(done.reply.ok,true,done.reply.error);assert.deepEqual([done.reply.recordId,done.reply.duplicate],['JOB-003',false]);
  const added=store.jobs[2];assert.deepEqual([added.id,added.employer,added.role,added.status,added.approval,added.applied,added.postingId],['JOB-003','New Synthetic Co','Web Analyst','Researching','Pending review','','P-99']);assert.equal(added.found,'2026-10-08');assert(added.notes.startsWith('[HQ workflow '+workflowId+'] Owner review required; Open when checked;'));
  assert.equal(done.events[0].type,'Discovered');assert.equal(done.events[0].agentId,'00');assert.equal(done.receipts.length,5);
  const again=run(store,request);assert.equal(again.reply.recordId,'JOB-003');assert.equal(store.jobs.length,3,'a retry adds no second job');assert.equal(again.events.length,0);assert.equal(again.receipts.length,0);
  const other='HQ-W-'+uuid(6),known=run(fresh(),{...request,workflowId:other,receipts:receipts(other),job:{...posting,url:'https://example.test/jobs/1/?jobid=7&utm=x',sourceId:'URL-1'}});assert.deepEqual([known.reply.recordId,known.reply.duplicate],['JOB-001',true],'a posting already tracked is matched, not added again');assert.equal(known.events[0].type,'Research');
  assert.equal(run(fresh(),{...request,receipts:receipts(workflowId).slice(0,4)}).reply.ok,false);assert.equal(run(fresh(),{...request,job:{...posting,url:'http://example.test/x'}}).reply.ok,false);}
assert.equal(urlKey('https://Example.test/jobs/1/?utm=a&jobid=7#top'),'https://example.test/jobs/1jobid=7');
// A refused operation hands back nothing to save.
{const refused=run(fresh(),{operation:'record-owner-status',recordId:'JOB-002',requestId:'bad',status:'Interview',expectedStatus:'Applied',expectedApplied:'2026-10-01',reason:'Synthetic',confirmStatus:true});assert.equal(refused.reply.ok,false);assert.equal(refused.jobs.size+refused.events.length+refused.receipts.length,0);}
console.log('Record checks passed: the bridge operations on database records — reads, application, status change, evidence and reviewed discovery, each idempotent and guarded as before; confirmed deletion with a one-line trace for applied jobs and no reuse of IDs; no free edit. Synthetic records only.');
