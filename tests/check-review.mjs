import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildWorkflow,appendWorkflow,RECORDS} from '../server/workflow.mjs';
import {readBoard,parseBoards,importedListing,vacancyUrl} from '../server/sources.mjs';
import {extractProfile} from '../server/cv-reader.mjs';
import {createScout} from '../server/scout.mjs';
import {reviewPdf} from '../server/report.mjs';
const at='2026-10-02T12:00:00Z',profile={...extractProfile('Synthetic applicant. I used GA4 analytics and SQL to evaluate digital experiments. I coordinated CRO experimentation across product teams. English and Dutch. Email: synthetic@example.test Phone +31 612345678. References available.'),readAt:at,modifiedAt:at};
assert(profile.evidence.length);assert(!JSON.stringify(profile.evidence).includes('@'));assert(!JSON.stringify(profile.evidence).includes('612345678'));
assert.throws(()=>vacancyUrl('http://localhost/'),/HTTPS/);assert.throws(()=>vacancyUrl('https://127.0.0.1/path'),/HTTPS/);assert.throws(()=>vacancyUrl('https://user:secret@site.test/'),/HTTPS/);
assert.equal(vacancyUrl('https://nl.indeed.com/viewjob?jk=abc&utm_source=x&token=secret'),'https://nl.indeed.com/viewjob?jk=abc');
assert.throws(()=>parseBoards('https://attacker.test/board'),/Supported/);
const boards=parseBoards('https://jobs.lever.co/sample | Sample\nhttps://jobs.eu.lever.co/eu | EU\nhttps://jobs.ashbyhq.com/sample | Sample\nhttps://job-boards.greenhouse.io/sample | Sample');
const responses=[[{id:'native-l',text:'Digital analyst',descriptionPlain:'GA4 and SQL',categories:{location:'Amsterdam'},hostedUrl:'https://jobs.lever.co/sample/native-l'}],[{id:'native-eu',text:'Digital analyst',descriptionPlain:'GA4 and SQL',categories:{location:'Amsterdam'},hostedUrl:'https://jobs.eu.lever.co/eu/native-eu'}],{jobs:[{title:'Digital analyst',location:'Amsterdam',descriptionPlain:'GA4 and SQL',jobUrl:'https://jobs.ashbyhq.com/sample/native-a',isListed:true},{title:'Hidden',location:'Amsterdam',descriptionPlain:'GA4 and SQL',jobUrl:'https://jobs.ashbyhq.com/sample/hidden',isListed:false}]},{jobs:[{id:123,title:'Digital analyst',location:{name:'Amsterdam'},content:'<p>GA4 and SQL</p>',absolute_url:'https://job-boards.greenhouse.io/sample/jobs/123'}]}];
for(let i=0;i<boards.length;i++){const jobs=await readBoard(boards[i],profile,'Amsterdam',async(url,options)=>{assert(options.redirect==='error');assert(!options.headers.Authorization);return Response.json(responses[i]);},at);assert.equal(jobs.length,1);assert(jobs[0].sourceId);}
const job=importedListing({url:'https://www.linkedin.com/jobs/view/456/',title:'Digital analyst',employer:'Synthetic employer',location:'Amsterdam',description:'Digital analyst using GA4 and SQL. Three years of experience. English required. Analyse conversion experiments with stakeholders.',salary:''},profile,at);
const marked=[],events=[],workflow=buildWorkflow(job,profile,{clock:()=>Date.parse(at),mark:(id,task)=>marked.push(id),event:(...e)=>events.push(e)});
assert.deepEqual(marked,['01','02','03','04','00']);assert.equal(workflow.receipts.length,5);assert(workflow.draft.letter.includes('DRAFT ONLY'));assert.equal(workflow.managerDecision,'Needs source / evidence review');assert.equal(workflow.tracker,null);
workflow.receipts.forEach((r,i)=>assert.equal(r.inputReceipt,i?workflow.receipts[i-1].id:null));assert.equal(events.filter(e=>e[3]).length,4);
const held=buildWorkflow({...job,id:'no-match',title:'Baker',description:'Baking sourdough bread. Work with flour and yeast.'},profile);assert.equal(held.receipts.length,2);assert.equal(held.draft,null);
assert.equal(RECORDS,'hq-records:operation');
const result=await appendWorkflow(workflow,{},async(url,options)=>{assert(options.method==='POST');assert(JSON.parse(options.body).operation==='append-reviewed-discovery');return Response.json({ok:true,recordId:'JOB-088',eventId:'EVT-174',at});});assert.equal(result.recordId,'JOB-088');
// Full Scout source partial failure, private config and persisted version deduplication.
let config={appId:'synthetic',appKey:'synthetic-key',boards:[boards[2]],location:'Amsterdam',terms:['digital analyst'],},now=Date.parse(at),outage=false;
const connection={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const fetcher=async(url)=>url.includes('adzuna')?Response.json({results:[{id:'ad-1',title:'Digital analyst',description:'GA4 and SQL analytics',redirect_url:'https://www.adzuna.nl/jobs/land/ad/123',company:{display_name:'Synthetic'},location:{display_name:'Amsterdam'}}]}):outage?new Response('unavailable',{status:503}):Response.json(responses[2]);
const scout=createScout(connection,{HQ_ACCESS_PASSWORD:'synthetic-long-password-123',HQ_PUBLIC_ORIGIN:'https://hq.example.test'},{fetcher,cvReader:async()=>profile,clock:()=>now,boardsDefault:[]});
const request=(action,extra={})=>new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:'https://hq.example.test',Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const get=async()=> (await scout.handle(new Request('https://hq.example.test/api/scout'))).json();
const wait=async()=>{for(let i=0;i<100;i++){const s=await get();if(s.lastRun&&s.status!=='running'&&!s.activeAgent)return s;await new Promise(r=>setTimeout(r,5));}throw new Error('Run not settled');};
try{assert.equal((await scout.handle(request('run'))).status,200);const state=await wait();assert.equal(state.workflows.length,2);assert.equal(state.workflows[0].receipts.length,5);assert(!JSON.stringify(state).includes('synthetic-key'));now+=11*60*1000;outage=true;await scout.handle(request('run'));const stale=await wait();assert(stale.stale);assert(stale.results.some(j=>j.source==='Ashby'&&j.stale));assert.equal(stale.workflows.length,2);assert(stale.sources.some(s=>s.status==='error'));assert.equal((await scout.handle(request('append',{workflowId:state.workflows[0].id}))).status,400);const pdf=await scout.handle(new Request('https://hq.example.test/api/scout?report=pdf'));assert.equal(pdf.headers.get('Content-Type'),'application/pdf');assert(Buffer.from(await pdf.arrayBuffer()).subarray(0,8).toString().startsWith('%PDF-1.4'));}finally{scout.close();}
// Migration path: saved discoveries can continue through 02–04 without a source query.
let reviewConfig={state:{results:[job,{...job,id:'held',url:'https://example.test/baker',title:'Baker',description:'Baking bread using yeast and flour.'},{...job,id:'stale',stale:true}],workflows:[],attempts:72,day:at.slice(0,10),lastRun:at}},releaseCv,cvVersion=profile,cvUnavailable=false;
const savedReviews=createScout({settings:async()=>({SCOUT_CONFIG:reviewConfig}),updateScout:async fn=>{reviewConfig=fn(reviewConfig);}},{HQ_ACCESS_PASSWORD:'synthetic-long-password',HQ_PUBLIC_ORIGIN:'https://hq.example.test'},{fetcher:async()=>{throw new Error('Vacancy source must not be queried during review');},cvReader:async()=>{await new Promise(resolve=>{releaseCv=resolve;});if(cvUnavailable)throw new Error('CV unavailable');return cvVersion;},clock:()=>Date.parse(at),boardsDefault:[]});
const readReviews=async()=> (await savedReviews.handle(new Request('https://hq.example.test/api/scout'))).json();
const settleReview=async()=>{for(let i=0;i<100;i++){const s=await readReviews();if(s.reviewRun?.status!=='running'&&s.status!=='running')return s;await new Promise(r=>setTimeout(r,5));}throw new Error('Review not settled');};
try{
  assert.equal((await savedReviews.handle(request('review'))).status,202);
  const working=await readReviews();assert.equal(working.activeAgent,'02');assert(working.task.includes('recorded'));assert.equal(working.attempts,72);
  assert.equal((await savedReviews.handle(request('review'))).status,400);
  await new Promise(r=>setTimeout(r,0));releaseCv();let done=await settleReview();
  assert.equal(done.reviewRun.prepared,2);assert.equal(done.reviewRun.held,1);assert.equal(done.workflows.length,2);assert.equal(done.workflows[0].receipts.length,5);assert.equal(done.activeAgent,null);assert.equal(done.nextCheck,null);assert(done.events.some(e=>e.agentId==='03'));assert(done.events.some(e=>e.agentId==='04'));assert(done.workflows.every(w=>w.tracker===null));const initialIds=done.workflows.map(w=>w.id);
  assert.equal((await savedReviews.handle(request('review'))).status,202);await new Promise(r=>setTimeout(r,0));releaseCv();done=await settleReview();assert.equal(done.reviewRun.prepared,0);assert.equal(done.reviewRun.unchanged,2);assert.deepEqual(done.workflows.map(w=>w.id),initialIds);
  assert.equal((await savedReviews.handle(request('review',{jobId:'stale'}))).status,400);
  cvVersion={...profile,modifiedAt:'2026-10-02T13:00:00Z'};await savedReviews.handle(request('review',{jobId:job.id}));await new Promise(r=>setTimeout(r,0));releaseCv();done=await settleReview();assert.equal(done.reviewRun.prepared,1);assert.equal(done.workflows.length,3);assert.deepEqual(done.workflows.slice(0,2).map(w=>w.id),initialIds);assert.equal(done.attempts,72);
  cvUnavailable=true;await savedReviews.handle(request('review'));await new Promise(r=>setTimeout(r,0));releaseCv();done=await settleReview();assert.equal(done.reviewRun.status,'failed');assert.equal(done.error,'CV unavailable');assert.equal(done.workflows.length,3);assert.equal(done.activeAgent,null);assert.equal(done.task,null);assert.equal(reviewConfig.state.workflows.length,3);
}finally{savedReviews.close();}
await fs.mkdir('work',{recursive:true});
await fs.writeFile('work/workflow-review-test.pdf',reviewPdf([workflow,held],at));
console.log('Verified: all source adapters, URL/privacy boundaries, five receipts, Analyst holds, draft review, partial-source stale retention, version deduplication, and authenticated PDF route. Synthetic fixtures only.');
