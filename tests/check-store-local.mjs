import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,existsSync} from 'node:fs';
import {createDatabase} from '../server/database.mjs';
import {createProfile} from '../server/profile.mjs';
import {createApplications} from '../server/applications.mjs';
import {RECORDS} from '../server/workflow.mjs';
import {closeAll} from '../server/store-local.mjs';

// The default store: a real SQLite file in a throwaway data folder. Synthetic records only; nothing leaves this machine.
const dir=mkdtempSync(path.join(os.tmpdir(),'job-hunt-data-')),environment={HQ_ACCESS_PASSWORD:'synthetic-owner-password-123',HQ_DATA_DIR:dir};
let config={};const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const database=createDatabase(connections,environment),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const post=(api,url,body,headers={})=>api.handle(new Request('https://hq.test'+url,{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json',...headers},body:body instanceof Uint8Array?body:JSON.stringify(body)}));

// Nothing to set up: the local file is ready, empty, and created on first use.
assert.equal(await database.live(),true);
const view=await (await database.handle(new Request('https://hq.test/api/database'))).json();assert.deepEqual([view.kind,view.ready,view.file],['local',true,path.join(dir,'job-hunt.db')]);
const empty=await (await database.snapshot()).json();assert.deepEqual([empty.mode,empty.jobs.length,empty.events.length,empty.stale],['synced',0,0,false]);assert(/file on this machine/.test(empty.source));assert(existsSync(path.join(dir,'job-hunt.db')));
const tested=await (await post(database,'/api/database',{action:'test'})).json();assert.equal(tested.last.ok,true,tested.message);assert(/SQLite \d/.test(tested.message));

// Saving a reviewed discovery creates the first job with the first IDs; every later operation is one transaction.
const receipts=w=>['01','02','03','04','00'].map((agentId,i)=>({id:'HQ-R-'+uuid(10+i),workflowId:w,agentId,inputReceipt:i?'HQ-R-'+uuid(9+i):null,at:'2026-10-08T10:00:00.000Z',title:'Synthetic',method:'Synthetic',findings:['Synthetic finding'],decision:'Synthetic'})),workflow='HQ-W-'+uuid(1);
const added=await (await database.change({operation:'append-reviewed-discovery',workflowId:workflow,receipts:receipts(workflow),decision:'Owner review required',job:{title:'Web Analyst',employer:'Synthetic Employer',source:'Example Board',sourceId:'P-1',url:'https://example.test/jobs/1',location:'Synthetic City',availability:'Open'}})).json();
assert.deepEqual([added.ok,added.recordId,added.eventId,added.store],[true,'JOB-001','EVT-0001','database']);
assert.equal((await (await database.change({operation:'append-reviewed-discovery',workflowId:workflow,receipts:receipts(workflow),job:{title:'Web Analyst',employer:'Synthetic Employer',source:'Example Board',sourceId:'P-1',url:'https://example.test/jobs/1',location:'Synthetic City',availability:'Open'}})).json()).recordId,'JOB-001','a retry adds nothing');
// The applications endpoint saves through the records address, as the host wires it.
const applications=createApplications(connections,environment,{fetcher:async(url,init)=>{assert.equal(url,RECORDS);return database.change(JSON.parse(init.body));}});
const applied=await post(applications,'/api/applications',{action:'applied',recordId:'JOB-001',requestId:'HQ-A-'+uuid(2),appliedOn:'2026-10-07',expectedStatus:'Researching',expectedApplied:'',confirmApplied:true});assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
const status=await post(applications,'/api/applications',{action:'status',recordId:'JOB-001',requestId:'HQ-S-'+uuid(3),status:'Interview',expectedStatus:'Applied',expectedApplied:'2026-10-07',reason:'Synthetic invitation',confirmStatus:true});assert.equal(status.status,200,JSON.stringify(await status.clone().json()));
let shown=await (await database.snapshot()).json();assert.deepEqual([shown.jobs.length,shown.jobs[0].status,shown.jobs[0].applied,shown.events.length],[1,'Interview','2026-10-07',3]);
// A refused operation changes nothing.
assert.equal((await (await database.change({operation:'record-owner-status',recordId:'JOB-001',requestId:'HQ-S-'+uuid(4),status:'Offer',expectedStatus:'Applied',expectedApplied:'2026-10-07',reason:'Stale request',confirmStatus:true})).json()).ok,false);
assert.equal((await (await database.snapshot()).json()).jobs[0].status,'Interview');
// Deleting removes the job and its history, keeps one line for an applied job, and never hands its number out again.
const gone=await (await database.change({operation:'delete-record',recordId:'JOB-001',requestId:'HQ-D-'+uuid(5),confirmDelete:true})).json();assert.deepEqual([gone.ok,gone.kept,gone.history],[true,'one line',3]);
shown=await (await database.snapshot()).json();assert.deepEqual([shown.jobs.length,shown.events.length],[0,0]);
const second='HQ-W-'+uuid(6),next=await (await database.change({operation:'append-reviewed-discovery',workflowId:second,receipts:receipts(second).map((r,i)=>({...r,id:'HQ-R-'+uuid(20+i),inputReceipt:i?'HQ-R-'+uuid(19+i):null})),job:{title:'CRO Analyst',employer:'Other Synthetic Employer',source:'Example Board',sourceId:'P-2',url:'https://example.test/jobs/2',location:'Synthetic City',availability:'Open'}})).json();
assert.deepEqual([next.recordId,next.eventId],['JOB-002','EVT-0004'],'numbers of deleted records are not reused');

// The CV: details, the PDF with its text, and the photo live in the same file.
const profile=createProfile(connections,environment,{parse:async()=>'Synthetic Person. '+'Built made-up dashboards. '.repeat(12)});
const first=await (await profile.handle(new Request('https://hq.test/api/profile'))).json();assert.deepEqual([first.ready,first.cv,first.profile.name],[true,null,'']);
assert.equal((await (await post(profile,'/api/profile',{action:'save',profile:{name:'Synthetic Person',skills:['GA4','SQL']}})).json()).saved,true);
const pdf=new Uint8Array(400).fill(32);pdf.set([...'%PDF-1.7\n'].map(c=>c.charCodeAt(0)));assert.equal((await (await post(profile,'/api/profile',pdf,{'content-type':'application/pdf','x-file-name':'synthetic.pdf'})).json()).saved,true);
const jpg=new Uint8Array(300).fill(1);jpg.set([0xff,0xd8,0xff,0xe0]);assert.equal((await (await post(profile,'/api/profile',jpg,{'content-type':'image/jpeg'})).json()).saved,true);
const held=await (await profile.handle(new Request('https://hq.test/api/profile'))).json();assert.deepEqual([held.profile.name,held.profile.skills,held.cv.filename,held.cv.size,held.photo.size],['Synthetic Person',['GA4','SQL'],'synthetic.pdf',400,300]);
assert.equal((await (await profile.handle(new Request('https://hq.test/api/profile?file=cv'))).arrayBuffer()).byteLength,400);assert.equal((await (await profile.handle(new Request('https://hq.test/api/profile?file=photo'))).arrayBuffer()).byteLength,300);
assert((await profile.storedCv()).text.includes('made-up dashboards'));assert.equal((await profile.storedProfile()).name,'Synthetic Person');

// A restart finds everything again.
closeAll();const again=createDatabase(connections,environment);const after=await (await again.snapshot()).json();assert.deepEqual([after.jobs.length,after.jobs[0].id,after.events.length],[1,'JOB-002',1]);
assert.equal((await createProfile(connections,environment).storedProfile()).name,'Synthetic Person');
// A MySQL connection that has not passed a test is not used, and going back to the file is one confirmed step.
config={database:{kind:'mysql',host:'localhost',database:'synthetic',user:'synthetic',password:'synthetic'}};assert.equal(await again.live(),false);const untested=await (await again.snapshot()).json();assert.equal(untested.stale,true,'the last good records are shown as stale, not replaced');assert(/has not passed a test/.test(untested.error));
assert.equal((await post(again,'/api/database',{action:'use-local'})).status,400,'changing where the records live needs a confirmation');assert.equal((await (await post(again,'/api/database',{action:'use-local',confirmMove:true})).json()).kind,'local');assert.equal((await (await again.snapshot()).json()).jobs.length,1);
closeAll();
console.log('Local store checks passed: ready with no setup, records saved and read from a real SQLite file, transactions, deletion without reuse of IDs, the CV with its file and photo, a restart, and a confirmed change of store. Synthetic values only.');
