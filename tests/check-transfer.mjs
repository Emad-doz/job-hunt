import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync} from 'node:fs';
import {createTransfer,mergeSettings,readExport} from '../server/transfer.mjs';
import {createDatabase} from '../server/database.mjs';
import * as local from '../server/store-local.mjs';

// Export and import against a real SQLite file in a throwaway folder. Synthetic records only; nothing leaves this machine.
const environment={HQ_ACCESS_PASSWORD:'synthetic-owner-password-123',HQ_DATA_DIR:mkdtempSync(path.join(os.tmpdir(),'job-hunt-transfer-'))},settings={file:path.join(environment.HQ_DATA_DIR,'job-hunt.db')};
let config={appId:'local-app',appKey:'SECRET-local-source-key',country:'gb',ai:{apiKey:'SECRET-local-model-key',enabled:true,consentAt:'2026-10-01T00:00:00.000Z',consentVersion:2,model:'local-model'},outlook:{clientId:'local-client',tokens:{refresh:'SECRET-local-token'},verifiedAt:'2026-10-02T00:00:00.000Z'},state:{results:[{id:'OLD-1'}],lastRun:'2026-10-01T00:00:00.000Z'},enabled:true},reloads=0;
const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},transfer=createTransfer(connections,environment,{reload:async()=>{reloads++;},clock:()=>Date.parse('2026-10-08T10:00:00.000Z')});
const send=(body,query='?confirm=1',headers={})=>transfer.handle(new Request('https://hq.test/api/transfer'+query,{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
const job=(n,extra={})=>({id:'JOB-'+String(n).padStart(4,'0'),employer:'Synthetic Employer '+n,role:'Synthetic role',status:'Applied',applied:'2026-09-0'+n,...extra}),event=(n,recordId)=>({id:'EVT-'+String(n).padStart(4,'0'),recordId,type:'Application recorded',date:'2026-09-01'});
const moved={format:'job-hunt-export',version:1,exportedAt:'2026-10-08T09:00:00.000Z',source:'Synthetic',
  records:{jobs:[job(3),job(7,{status:'Interview'})],events:[event(4,'JOB-0003'),event(12,'JOB-0007')],meta:{counters:{job:9,event:12},import:{at:'2026-01-01'}},receipts:[{id:'HQ-R-1',recordId:'JOB-0007',title:'Synthetic receipt'}],removed:[{id:'JOB-0008',employer:'Synthetic removed',removedAt:'2026-09-20T00:00:00.000Z'}]},
  cv:{profile:{name:'Synthetic Person',headline:'Synthetic analyst'},savedAt:'2026-10-05T00:00:00.000Z',files:[{name:'cv',filename:'synthetic.pdf',content:Buffer.from('%PDF-synthetic').toString('base64'),body:'Synthetic CV text',uploadedAt:'2026-10-04T00:00:00.000Z'},{name:'photo',filename:'synthetic.png',content:Buffer.from([137,80,78,71]).toString('base64'),body:null,uploadedAt:'2026-10-04T00:00:00.000Z'}]},
  settings:{appId:'moved-app',appKey:'SECRET-must-not-arrive',terms:['synthetic analyst'],database:{kind:'mysql',password:'SECRET-must-not-arrive'},ai:{model:'moved-model',dailyLimit:20,apiKey:'SECRET-must-not-arrive'},jsearch:{country:'nl',monthlyLimit:190},outlook:{clientId:'moved-client',repliesSeen:{'JOB-0007':'2026-10-01T00:00:00Z'},tokens:{refresh:'SECRET-must-not-arrive'}},state:{results:[{id:'NEW-1'},{id:'NEW-2'}],activeAgent:'01',task:'running'},enabled:true}};

// Refused before anything is touched: no sign-in, another site, no confirmation, another file, a damaged file.
assert.equal((await createTransfer(connections,{}).handle(new Request('https://hq.test/api/transfer'))).status,403);
assert.equal((await send(moved,'?confirm=1',{origin:'https://elsewhere.test'})).status,403);
for(const [body,query,pattern] of [[moved,'',/Confirm the import/],['not json','?confirm=1',/could not be read/],[{format:'something-else'},'?confirm=1',/not a Job Hunt export/],[{...moved,version:2},'?confirm=1',/different version/],[{...moved,records:{...moved.records,jobs:[job(1),job(1)]}},'?confirm=1',/job IDs/],[{...moved,cv:{files:[{name:'other',content:'x'}]}},'?confirm=1',/files/]]){const r=await send(body,query);assert.equal(r.status,400);assert(pattern.test((await r.json()).error));}
assert.equal((await local.readRecords(settings)).jobs.length,0);assert.equal(reloads,0);

// Into an empty installation: records, CV and settings arrive; this machine's keys, consent and database choice stay.
const done=await send(moved),told=await done.json();assert.equal(done.status,200,told.error);assert.deepEqual([told.jobs,told.events,told.discoveries,told.cv,told.photo,reloads],[2,2,2,true,true,1]);assert(/Keys and passwords are not part of an export/.test(told.message));
const now=await local.readRecords(settings);assert.deepEqual([now.jobs.map(j=>j.id),now.jobs[1].status,now.events.map(e=>e.id)],[['JOB-0003','JOB-0007'],'Interview',['EVT-0004','EVT-0012']]);
const profile=await local.readProfile(settings);assert.equal(profile.profile.name,'Synthetic Person');assert.equal((await local.readCv(settings)).text,'Synthetic CV text');assert.equal((await local.readCv(settings)).bytes.toString(),'%PDF-synthetic');assert.equal((await local.readPhoto(settings)).bytes.length,4);
assert.deepEqual([config.appId,config.appKey,config.terms,config.ai.model,config.ai.apiKey,config.ai.enabled,config.jsearch.country,config.country,config.outlook.clientId,config.outlook.tokens.refresh,config.outlook.repliesSeen['JOB-0007'],config.enabled,config.state.results.length,config.state.task,config.database],['moved-app','SECRET-local-source-key',['synthetic analyst'],'moved-model','SECRET-local-model-key',true,'nl','gb','moved-client','SECRET-local-token','2026-10-01T00:00:00Z',false,2,null,undefined]);
assert(!JSON.stringify(config).includes('must-not-arrive'),'a secret smuggled into an export file is dropped');
assert.equal(mergeSettings({},{jsearch:{country:'nl'}}).country,'nl');assert.throws(()=>readExport(null),/not a Job Hunt export/);

// Numbers stay used: the next job comes after the highest one ever given out, not after the highest one present.
const database=createDatabase(connections,environment),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),workflow='HQ-W-'+uuid(1),receipts=['01','02','03','04','00'].map((agentId,i)=>({id:'HQ-R-'+uuid(10+i),workflowId:workflow,agentId,inputReceipt:i?'HQ-R-'+uuid(9+i):null,at:'2026-10-08T10:00:00.000Z',title:'Synthetic',method:'Synthetic',findings:['Synthetic finding'],decision:'Synthetic'}));
const added=await (await database.change({operation:'append-reviewed-discovery',workflowId:workflow,receipts,decision:'Owner review required',job:{title:'Web Analyst',employer:'Synthetic New Employer',source:'Example Board',sourceId:'P-1',url:'https://example.test/jobs/1',location:'Synthetic City',availability:'Open'}})).json();
assert.deepEqual([added.recordId,added.eventId],['JOB-010','EVT-0013'],JSON.stringify(added));

// A second import does not overwrite silently: it says what is here and waits for the replacement to be confirmed.
const again=await send({...moved,records:{...moved.records,jobs:[job(1)],events:[]},cv:{profile:null,files:[]}}),asked=await again.json();assert.equal(again.status,409);assert.equal(asked.occupied,true);assert(/already holds 3 jobs and a CV/.test(asked.error));assert.equal((await local.readRecords(settings)).jobs.length,3);
assert.equal((await send({...moved,records:{...moved.records,jobs:[job(1)],events:[]},cv:{profile:null,files:[]}},'?confirm=1&replace=1')).status,200);
const replaced=await local.readRecords(settings);assert.deepEqual([replaced.jobs.map(j=>j.id),replaced.events.length,(await local.readProfile(settings)).profile,await local.readCv(settings)],[['JOB-0001'],0,null,null]);

// The export of this installation: readable by the import, with nothing secret in it.
await send(moved,'?confirm=1&replace=1');
const out=await transfer.handle(new Request('https://hq.test/api/transfer'));assert.equal(out.status,200);assert(/attachment; filename="job-hunt-export-2026-10-08\.json"/.test(out.headers.get('content-disposition')));
const raw=await out.text(),exported=JSON.parse(raw);assert(!/SECRET/.test(raw),'no key or token leaves in an export');
assert.deepEqual([exported.format,exported.version,exported.records.jobs.length,exported.records.events.length,exported.records.receipts.length,exported.records.removed[0].id,exported.cv.profile.name,exported.cv.files.map(f=>f.name).sort(),exported.settings.appId,exported.settings.outlook.clientId],['job-hunt-export',1,2,2,1,'JOB-0008','Synthetic Person',['cv','photo'],'moved-app','moved-client']);
assert.equal((await send(exported,'?confirm=1&replace=1')).status,200);assert.deepEqual((await local.exportAll(settings)).records.jobs,exported.records.jobs);
local.closeAll();
console.log('Transfer checks passed: refusals before any change, import into an empty installation, local keys kept, used numbers kept, confirmed replacement, export without secrets, round trip');
