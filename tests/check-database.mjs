import assert from 'node:assert/strict';
import {createDatabase,explainFailure} from '../server/database.mjs';
import {createApplications} from '../server/applications.mjs';
import {RECORDS} from '../server/workflow.mjs';

// The optional MySQL connection, with synthetic settings and an injected driver: no database is contacted. The default local file is covered in check-store-local.mjs.
let config={};const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const calls=[];let fail=null;
const stored={jobs:[{id:'JOB-9001',employer:'Synthetic Employer',role:'Synthetic Role',status:'Interview',applied:'',url:'https://example.test/jobs/1',postingId:'P-1',sheetRow:{Priority:'High'}},{id:'JOB-9002',employer:'Synthetic Employer',role:'Other Role',status:'Rejected',applied:''}],events:[{id:'EVT-0001',recordId:'JOB-9001',type:'Synthetic',details:'Synthetic entry'}]};
const client={testConnection:async settings=>{calls.push(settings);if(fail)throw fail;return {version:'MySQL 8.4.6-synthetic',tables:6};},readRecords:async()=>{if(fail)throw fail;return {jobs:stored.jobs,events:stored.events,controls:{},overview:[]};},changeRecords:async(settings,work)=>{if(fail)throw fail;return work({jobs:stored.jobs,events:stored.events,receipts:new Set()}).reply;}};
// The local file is replaced by a stand-in too, so this test writes nothing to disk.
const local={testConnection:async()=>({version:'SQLite synthetic',tables:9}),readRecords:async()=>({jobs:[],events:[],controls:{},overview:[]}),changeRecords:async(settings,work)=>work({jobs:[],events:[],receipts:new Set()}).reply};
const api=createDatabase(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_DATA_DIR:'synthetic-data'},{client,local,clock:()=>Date.parse('2026-10-08T10:00:00Z')});
const get=()=>api.handle(new Request('https://hq.test/api/database'));
const post=(body,origin='https://hq.test')=>api.handle(new Request('https://hq.test/api/database',{method:'POST',headers:{host:'hq.test',origin,'content-type':'application/json'},body:JSON.stringify(body)}));
const good={action:'save',confirmMove:true,host:'localhost',port:3306,database:'synthetic_hq',user:'synthetic_user',password:'synthetic-db-password'};

assert.equal((await createDatabase(connections,{}).handle(new Request('https://hq.test/api/database'))).status,403,'no owner sign-in, no database settings');
assert.equal((await post(good,'https://elsewhere.test')).status,403,'cross-site requests are refused');
// Out of the box the local file is in use and ready.
const start=await (await get()).json();assert.deepEqual([start.kind,start.ready,start.configured,start.last],['local',true,false,null]);assert(start.file.endsWith('job-hunt.db'));assert.equal(await api.live(),true);
assert.equal((await (await api.snapshot()).json()).jobs.length,0);
for(const bad of [{host:'mysql://localhost'},{host:'local host'},{port:0},{port:70000},{database:'bad name;'},{user:'a`b'},{password:''},{password:'x'.repeat(201)}])assert.equal((await post({...good,...bad})).status,400,JSON.stringify(bad));
assert.equal((await post({...good,confirmMove:undefined})).status,400,'moving to MySQL needs a confirmation: the local records do not come along');
assert.equal(Object.keys(config).length,0,'a refused save stores nothing');

// Saved is not yet usable: nothing is read or saved there until the test has passed.
const saved=await (await post(good)).json();assert.equal(saved.saved,true);assert.deepEqual([saved.kind,saved.configured,saved.ready],['mysql',true,false]);assert.equal(await api.live(),false);
assert(!JSON.stringify(saved).includes('synthetic-db-password')&&!JSON.stringify(await (await get()).json()).includes('synthetic-db-password'),'the password is never sent back');
assert.equal((await (await api.change({operation:'read-status-capabilities'})).json()).ok,false);
const tested=await post({action:'test'});assert.equal(tested.status,200);const result=await tested.json();assert.equal(result.last.ok,true);assert.equal(result.ready,true);assert(/MySQL 8\.4\.6-synthetic · 6 tables/.test(result.message));assert.equal(await api.live(),true);
assert.deepEqual(calls[0],{host:'localhost',port:3306,database:'synthetic_hq',user:'synthetic_user',password:'synthetic-db-password'});

// The records: what the page shows comes from the database, without columns kept from an import; a change is one fixed operation.
const shown=await (await api.snapshot()).json();assert.equal(shown.mode,'synced');assert.equal(shown.jobs.length,2);assert.equal(shown.source,'Your MySQL database');assert(!('sheetRow' in shown.jobs[0]));
const read=await (await api.change({operation:'read-application-record',recordId:'JOB-9001'})).json();assert.deepEqual([read.ok,read.status,read.postingId,read.store],[true,'Interview','P-1','database']);
const changed=await (await api.change({operation:'record-owner-status',recordId:'JOB-9001',requestId:'HQ-S-00000000-0000-4000-8000-000000000001',status:'Offer',expectedStatus:'Interview',expectedApplied:'',reason:'Synthetic offer',confirmStatus:true})).json();assert.equal(changed.status,'Offer',String(changed.error));
// The whole path as the host wires it: the applications endpoint sends its operation to the records address, and the database answers it.
{const routed=async(url,init)=>{assert.equal(url,RECORDS,'record operations go to the internal records address and nowhere else');return api.change(JSON.parse(init.body));};
  const applications=createApplications(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher:routed});
  const send=body=>applications.handle(new Request('https://hq.test/api/applications',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));
  const caps=await (await applications.handle(new Request('https://hq.test/api/applications?capabilities=status'))).json();assert.equal(caps.available,true,String(caps.error||caps.message));assert(caps.statuses.includes('Rejected'));
  const done=await send({action:'status',recordId:'JOB-9001',requestId:'HQ-S-00000000-0000-4000-8000-000000000002',status:'Rejected',expectedStatus:'Offer',expectedApplied:'',reason:'Synthetic end-to-end change',confirmStatus:true});const receipt=await done.json();
  assert.equal(done.status,200,String(receipt.error));assert.equal(stored.jobs[0].status,'Rejected');}
// A failed read serves the last good records marked stale; a failed change says so; a failed test of a working connection does not switch the records off.
fail=Object.assign(new Error("Access denied for user 'synthetic_user'@'localhost' (using password: YES)"),{code:'ER_ACCESS_DENIED_ERROR'});
const stale=await (await api.snapshot()).json();assert.equal(stale.stale,true);assert.equal(stale.jobs.length,2);assert.equal(stale.error,'The database refused this user name or password.');
assert.equal((await (await api.change({operation:'read-status-capabilities'})).json()).ok,false);
const refused=await post({action:'test'});assert.equal(refused.status,502);const told=await refused.json();assert.equal(told.message,'The database refused this user name or password.');assert(!JSON.stringify(told).includes('using password'));assert.equal(told.ready,true);assert.equal(told.last.ok,true);assert.equal(told.last.warning,told.message);fail=null;
assert(/localhost or 127\.0\.0\.1/.test(explainFailure({code:'ECONNREFUSED'})));assert.equal(explainFailure({code:'SOMETHING_NEW'}),'The database could not be used (SOMETHING_NEW).');assert.equal(explainFailure(new Error('raw text')),'The database could not be used.');

// A blank password keeps the saved one and the test result. Another database needs an explicit confirmation and a new test.
assert.equal((await (await post({...good,confirmMove:undefined,password:''})).json()).ready,true);assert.equal(config.database.password,'synthetic-db-password');
assert.equal((await post({...good,confirmMove:undefined,password:'',database:'other_db'})).status,400,'another database is not used silently');assert.equal(config.database.database,'synthetic_hq');
const moved=await (await post({...good,password:'',database:'other_db'})).json();assert.equal(moved.ready,false);assert.equal(moved.last,null);assert.equal(await api.live(),false);
// Going back to the local file is confirmed as well, and works at once.
assert.equal((await post({action:'use-local'})).status,400);const back=await (await post({action:'use-local',confirmMove:true})).json();assert.deepEqual([back.kind,back.ready],['local',true]);assert.equal((await (await api.snapshot()).json()).jobs.length,0);
console.log('Database checks passed: the local file by default, MySQL only after a passed test and a confirmation, password never returned, records served and changed through fixed operations, the applications endpoint saving through the records address, stale fallback, plain failure messages. Synthetic values only.');
