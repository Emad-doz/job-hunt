import assert from 'node:assert/strict';
import {COMPANY_SCHEMA,MOTIVATION_SCHEMA,MOTIVATION_LIMITS,researchBrief,companyFacts,motivationRequest,draftMotivation} from '../server/motivation.mjs';
import {createScout} from '../server/scout.mjs';
import {fitKey,basis} from '../server/cv-screening.mjs';

// Synthetic employer, vacancy and CV only. No network: both model requests are injected.
const job={id:'SYNTHETIC-M1',title:'Digital Analyst',employer:'Synthetic Retail BV',location:'Amsterdam',description:'We look for an analyst with GA4 and SQL to improve our webshop conversion.',completeness:'Full text',source:'Synthetic source',url:'https://example.test/jobs/1'};
const material={scope:'evidence',text:'GA4 dashboards for a webshop; A/B tests on checkout; SQL reporting.'},ai={apiKey:'sk-ant-synthetic-test-key-0000000000000000',model:'claude-opus-5-5'};

// The web research is told the employer, the role and the location, and nothing about the candidate.
const brief=researchBrief(job);assert(brief.includes('Synthetic Retail BV')&&brief.includes('Digital Analyst')&&brief.includes('Amsterdam'));assert(!brief.includes('GA4 dashboards')&&!brief.includes(job.description));
assert.deepEqual(COMPANY_SCHEMA.required,['identified','about','facts']);assert.deepEqual(MOTIVATION_SCHEMA.required,['language','motivation','angles','avoid','usedFacts']);

// Only facts with a public https source are kept, and the list is capped.
const kept=companyFacts({identified:true,about:'<b>Sells</b> shoes online.',facts:[{fact:'Runs a webshop in three countries.',source:'https://syntheticretail.test/about?utm_source=x'},{fact:'No source',source:''},{fact:'Local file',source:'http://127.0.0.1/secret'},{fact:'Script',source:'javascript:alert(1)'},...Array.from({length:12},(_,i)=>({fact:'Fact '+i,source:'https://syntheticretail.test/news/'+i}))]});
assert.equal(kept.facts.length,MOTIVATION_LIMITS.facts);assert.equal(kept.facts[0].source,'https://syntheticretail.test/about');assert.equal(kept.about,'Sells shoes online.');assert(kept.identified);
assert.equal(companyFacts({identified:true,facts:[]}).identified,false,'identified needs at least one sourced fact');assert.deepEqual(companyFacts(null).facts,[]);
assert(motivationRequest(job,{facts:[]}).includes('None found.'));assert(motivationRequest(job,kept).includes('1. Runs a webshop in three countries.'));

const calls=[];
const researchCall=async request=>{calls.push(['research',request]);return {found:{identified:true,about:'Sells shoes online.',facts:[{fact:'Runs a webshop in three countries.',source:'https://syntheticretail.test/about'},{fact:'Opened a new warehouse in 2026.',source:'https://news.example.test/warehouse'}]},servedBy:'claude-opus-5-5',usage:{input:900,output:300,cacheRead:0,cacheWrite:0},searches:3};};
const writeCall=async request=>{calls.push(['write',request]);return {text:JSON.stringify({language:'English',motivation:'Your webshop serves three countries, and improving conversion across them is the work I have done with GA4 dashboards and checkout tests. I would like to bring that to your team.',angles:['GA4 dashboards','Checkout tests'],avoid:['Team leadership'],usedFacts:[1,7,1]}),servedBy:'claude-opus-5-5',usage:{input:1200,output:200,cacheRead:0,cacheWrite:0}};};
const record=await draftMotivation({job,material,ai,researchCall,writeCall,clock:()=>Date.parse('2026-10-07T10:00:00Z')});
assert.equal(calls[0][0],'research');assert(!JSON.stringify(calls[0][1]).includes('GA4 dashboards'),'no CV material in the research request');assert.equal(calls[0][1].maxSearches,MOTIVATION_LIMITS.searches);
assert(calls[1][1].cvMaterial.includes('GA4 dashboards')&&calls[1][1].vacancy.includes('1. Runs a webshop in three countries.'));
assert(/^HQ-M-/.test(record.id));assert.equal(record.jobId,job.id);assert.equal(record.company.facts.length,2);assert.deepEqual(record.usedFacts,[1],'only numbers of facts that exist, once');assert.equal(record.searches,3);assert.equal(record.usage.input,2100);assert(record.costUsd>=.03,'search fees are part of the estimate');assert.equal(record.excerpt,false);
await assert.rejects(()=>draftMotivation({job,material,ai,researchCall,writeCall:async()=>({text:'not json',usage:{}})}),/unreadable/);
await assert.rejects(()=>draftMotivation({job,material,ai,researchCall,writeCall:async()=>({text:JSON.stringify({motivation:'Too short',angles:[],avoid:[],usedFacts:[],language:'English'}),usage:{}})}),/no usable motivation/);
// An employer the web research cannot identify still gets a draft, marked as resting on the CV and vacancy only.
const unknown=await draftMotivation({job,material,ai,researchCall:async()=>({found:{identified:false,about:'',facts:[]},usage:{},searches:2}),writeCall});assert.equal(unknown.company.identified,false);assert.deepEqual(unknown.usedFacts,[]);

// Through the server: off by default, needs room for two requests, records one draft per vacancy and hides nothing it should show.
const at='2026-10-07T10:00:00.000Z';
function server(aiConfig,usage={day:'2026-10-07',count:0}){
  let config={ai:aiConfig,state:{results:[job],aiUsage:usage}};const connections={settings:async()=>({SCOUT_CONFIG:config,CV_FILE_URL:'synthetic'}),updateScout:async fn=>{config=fn(config);}};
  const scout=createScout(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},cvMaterialReader:async()=>({profile:{skills:['GA4'],evidence:['GA4 dashboards for a webshop.','A/B tests on checkout.'],focusLabels:[],languages:[],readAt:at},text:material.text}),researchCall,motivationCall:writeCall,clock:()=>Date.parse(at),intervalMs:1e9});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));
  const get=async()=>(await scout.handle(new Request('https://hq.test/api/scout'))).json();
  return {post,get,scout};
}
const on={apiKey:ai.apiKey,model:ai.model,scope:'evidence',enabled:true,consentAt:at,consentVersion:2,dailyLimit:20};
{const off=server({...on,enabled:false});await off.get();const refused=await off.post({action:'ai-motivation',jobId:job.id});assert.equal(refused.status,400);assert(/Nothing was sent/.test((await refused.json()).error));off.scout.close?.();}
{const full=server(on,{day:'2026-10-07',count:19});await full.get();const refused=await full.post({action:'ai-motivation',jobId:job.id});assert.equal(refused.status,400);assert(/two of your daily model requests/.test((await refused.json()).error));full.scout.close?.();}
{const live=server(on);await live.get();assert.equal((await live.post({action:'ai-motivation',jobId:'MISSING'})).status,400);
  const started=await live.post({action:'ai-motivation',jobId:job.id});assert.equal(started.status,202);
  let state;for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,20));state=await live.get();if(state.motivationRun?.status!=='running')break;}
  assert.equal(state.motivationRun.status,'completed',String(state.motivationRun.error));assert.equal(state.motivations.length,1);assert.equal(state.motivations[0].jobId,job.id);assert.equal(state.ai.usedToday,2,'two requests counted');
  assert(state.events.some(e=>/motivation drafted/.test(e.details)));live.scout.close?.();}
// The interview date is kept privately in HQ: saved, replaced and removed without any Google request, and only for a tracked job.
{const hq=server(on);await hq.get();
  assert.equal((await hq.post({action:'interview-date',recordId:'SYNTHETIC-M1',date:'2026-10-12'})).status,400);assert.equal((await hq.post({action:'interview-date',recordId:'JOB-0110',date:'12-10-2026'})).status,400);assert.equal((await hq.post({action:'interview-date',recordId:'JOB-0110',date:'',time:'10:00'})).status,400);
  assert.equal((await hq.post({action:'interview-date',recordId:'JOB-0110',date:'2026-10-12',time:'14:00'})).status,200);let seen=await hq.get();assert.equal(seen.interviewDates['JOB-0110'].date,'2026-10-12');assert.equal(seen.interviewDates['JOB-0110'].time,'14:00');
  assert.equal((await hq.post({action:'interview-date',recordId:'JOB-0110',date:'2026-10-15'})).status,200);seen=await hq.get();assert.equal(seen.interviewDates['JOB-0110'].date,'2026-10-15');assert.equal(seen.interviewDates['JOB-0110'].time,'');
  assert.equal((await hq.post({action:'interview-date',recordId:'JOB-0110',date:''})).status,200);seen=await hq.get();assert.equal(seen.interviewDates['JOB-0110'],undefined);hq.scout.close?.();}
// Bulk archive: only listed discoveries that screening judged unrelated are put aside, once, and only after confirmation.
{const verdict=fit=>({fit,reason:'Synthetic verdict',by:'Analyst screening',model:'claude-opus-5-5',at,version:'model-screen-v1'});
  const offTopic={...job,id:'SYNTHETIC-U1',title:'Forklift driver',url:'https://example.test/jobs/u1',description:'Drive a forklift in a warehouse.',modelFit:verdict('unrelated')},other={...offTopic,id:'SYNTHETIC-U2',url:'https://example.test/jobs/u2'},wanted={...job,id:'SYNTHETIC-R1',url:'https://example.test/jobs/r1',modelFit:verdict('relevant')};
  const fits=Object.fromEntries([offTopic,other,wanted].map(j=>[fitKey(j),{fit:j.modelFit,basis:basis(j)}]));let config={ai:on,state:{profile:{skills:['GA4'],evidence:['GA4 dashboards.'],focusLabels:[],languages:[],focus:[]},results:[offTopic,other,wanted],modelFits:fits}};const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
  const scout=createScout(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
  assert.equal((await post({action:'archive-unrelated',jobIds:['SYNTHETIC-U1']})).status,400,'needs confirmation');
  const done=await (await post({action:'archive-unrelated',confirm:true,jobIds:['SYNTHETIC-U1','SYNTHETIC-R1','MISSING']})).json();assert.equal(done.moved,1,'a relevant or unknown discovery is never archived this way');
  const kept=Object.values(config.ownerFeedback);assert.equal(kept.length,1);assert.equal(kept[0].jobId,'SYNTHETIC-U1');assert.equal(kept[0].decision,'not-fit');assert(/archived together/.test(kept[0].reason));
  assert.equal((await (await post({action:'archive-unrelated',confirm:true,jobIds:['SYNTHETIC-U1','SYNTHETIC-U2']})).json()).moved,1,'already archived ones are skipped');assert.equal(Object.keys(config.ownerFeedback).length,2);scout.close?.();
  // A discovery that only survives in its saved review is archived as well.
  const gone={...offTopic,id:'SYNTHETIC-U3',url:'https://example.test/jobs/u3'};let second={ai:on,state:{profile:{skills:['GA4'],evidence:['GA4 dashboards.'],focusLabels:[],languages:[],focus:[]},results:[],workflows:[{id:'HQ-W-synthetic-u3',createdAt:at,job:gone,receipts:[],draft:null,tracker:null}],modelFits:{[fitKey(gone)]:{fit:gone.modelFit,basis:basis(gone)}}}};
  const later=createScout({settings:async()=>({SCOUT_CONFIG:second}),updateScout:async fn=>{second=fn(second);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9});await later.handle(new Request('https://hq.test/api/scout'));
  const viaReview=await (await later.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify({action:'archive-unrelated',confirm:true,jobIds:['SYNTHETIC-U3']})}))).json();assert.equal(viaReview.moved,1,String(viaReview.error||''));later.close?.();}
// Old review versions: deleted only on confirmation; every job keeps its newest review and anything saved to Google stays.
{const review=(id,jobId,extra={})=>({id,createdAt:at,job:{...job,id:jobId},receipts:[],draft:null,tracker:null,...extra});
  let config={ai:on,state:{results:[],workflows:[review('HQ-W-1','A'),review('HQ-W-2','A',{tracker:{recordId:'JOB-0001',eventId:'EVT-0001',at}}),review('HQ-W-3','A'),review('HQ-W-4','B'),review('HQ-W-5','B')]}};
  const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
  assert.equal((await post({action:'prune-reviews'})).status,400);
  const pruned=await (await post({action:'prune-reviews',confirm:true})).json();assert.equal(pruned.removed,2);assert.equal(pruned.kept,3);
  const left=(await (await scout.handle(new Request('https://hq.test/api/scout'))).json()).workflows.map(w=>w.id).sort();assert.deepEqual(left,['HQ-W-2','HQ-W-3','HQ-W-5'],'the newest of each job and the one saved to Google remain');
  assert.equal((await (await post({action:'prune-reviews',confirm:true})).json()).removed,0);scout.close?.();}
// Deleting archived discoveries: only confirmed, only archived ones, never one saved to Google, and a deleted one is not listed again.
{const review=(id,j,extra={})=>({id,createdAt:at,job:j,receipts:[],draft:null,tracker:null,...extra});
  const a={...job,id:'SYNTHETIC-D1',url:'https://example.test/jobs/d1'},b={...job,id:'SYNTHETIC-D2',url:'https://example.test/jobs/d2'},c={...job,id:'SYNTHETIC-D3',url:'https://example.test/jobs/d3'},d={...job,id:'SYNTHETIC-D4',url:'https://example.test/jobs/d4'};
  const shelf=j=>['URL:'+j.url,{id:'HQ-F-'+j.id,key:'URL:'+j.url,jobId:j.id,recordId:null,decision:'not-fit',reason:'Archived',at,source:'Owner preference',history:[]}];
  let config={ai:on,ownerFeedback:Object.fromEntries([shelf(a),shelf(c),shelf(d)]),state:{results:[a,b,c],workflows:[review('HQ-W-d1',a),review('HQ-W-d3',c,{tracker:{recordId:'JOB-0002',eventId:'EVT-0002',at}}),review('HQ-W-d4',d)],aiReviews:[{id:'HQ-A-d1',jobId:a.id}],motivations:[{id:'HQ-M-d1',jobId:a.id}]}};
  const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
  assert.equal((await post({action:'delete-archived',jobIds:[a.id]})).status,400,'needs confirmation');
  const done=await (await post({action:'delete-archived',confirm:true,jobIds:[a.id,b.id,c.id,d.id]})).json();assert.equal(done.removed,2,String(done.error||''));
  const after=await (await scout.handle(new Request('https://hq.test/api/scout'))).json();
  assert.deepEqual(after.results.map(j=>j.id).sort(),[b.id,c.id],'a discovery that was not archived, and one saved to Google, stay');assert.deepEqual(after.workflows.map(w=>w.id),['HQ-W-d3']);assert.equal(after.aiReviews.length,0);assert.equal(after.motivations.length,0);
  assert(config.dismissed['URL:'+a.url]&&config.dismissed['URL:'+d.url]&&!config.dismissed['URL:'+c.url]);assert(!config.ownerFeedback['URL:'+a.url]&&config.ownerFeedback['URL:'+c.url]);scout.close?.();}
// Deleting tracked jobs: confirmed, through the records connection; the database's reply removes the job's reviews and stops it being collected again, and Google's refusal is passed on as such.
{const tracked={...job,id:'SYNTHETIC-T1',url:'https://example.test/jobs/t1'},other={...job,id:'SYNTHETIC-T2',url:'https://example.test/jobs/t2'};let answer=body=>({ok:true,deleted:true,recordId:body.recordId,url:tracked.url,kept:'one line'});const asked=[];
  let config={ai:on,ownerFeedback:{['URL:'+tracked.url]:{id:'HQ-F-t1',key:'URL:'+tracked.url,jobId:tracked.id,recordId:'JOB-0002',decision:'not-fit',reason:'Archived',at,history:[]}},interviewDates:{'JOB-0002':{date:'2026-10-09',time:'',at}},state:{results:[tracked,other],workflows:[{id:'HQ-W-t1',createdAt:at,job:tracked,receipts:[],draft:null,tracker:{recordId:'JOB-0002',eventId:'EVT-0002',at}},{id:'HQ-W-t2',createdAt:at,job:other,receipts:[],draft:null,tracker:null}]}};
  const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async(url,init)=>{const body=JSON.parse(init.body);asked.push(body);return Response.json(answer(body));},clock:()=>Date.parse(at),intervalMs:1e9});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
  assert.equal((await post({action:'delete-jobs',recordIds:['JOB-0002']})).status,400,'needs confirmation');assert.equal((await post({action:'delete-jobs',confirm:true,recordIds:['not-an-id']})).status,400);assert.equal(asked.length,0);
  const done=await (await post({action:'delete-jobs',confirm:true,recordIds:['JOB-0002']})).json();assert.equal(done.removed,1,String(done.error));assert(/one line is kept/.test(done.message));
  assert.deepEqual([asked[0].operation,asked[0].recordId,asked[0].confirmDelete],['delete-record','JOB-0002',true]);assert(/^HQ-D-[a-f0-9-]{36}$/.test(asked[0].requestId));
  const after=await (await scout.handle(new Request('https://hq.test/api/scout'))).json();assert.deepEqual(after.workflows.map(w=>w.id),['HQ-W-t2']);assert.deepEqual(after.results.map(j=>j.id),[other.id]);
  assert(config.dismissed['URL:'+tracked.url]);assert.equal(Object.keys(config.ownerFeedback).length,0);assert.equal(config.interviewDates['JOB-0002'],undefined);
  answer=()=>({ok:false,error:'Unsupported append request.'});const refused=await post({action:'delete-jobs',confirm:true,recordIds:['JOB-0003']});assert.equal(refused.status,400);assert(/only be deleted once the database is your record/.test((await refused.json()).error));scout.close?.();}
// Filling the My CV fields: confirmed each time, model enabled, a readable stored CV, one counted request, a cleaned proposal that is not saved.
{const cvText='Synthetic Person'+String.fromCharCode(10)+'Digital Analyst'+String.fromCharCode(10)+'Built GA4 dashboards for Synthetic Retail BV. '.repeat(10);let stored={text:cvText},sent=null,config={ai:on};
  const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9,cvStore:async()=>stored,profileCall:async request=>{sent=request;return {text:JSON.stringify({name:' Synthetic Person ',headline:'Digital Analyst',email:'',phone:'',location:'',links:[],about:'',skills:['GA4','GA4'],languages:[],experience:[{title:'Analyst',employer:'Synthetic Retail BV',location:'',start:'2022-03',end:'Present',points:['Built GA4 dashboards']}],education:[],certificates:[],invented:'dropped'}),servedBy:'claude-opus-5-5',usage:{input:1000,output:300}};}});
  const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
  assert.equal((await post({action:'ai-profile'})).status,400,'needs its own confirmation');assert.equal(sent,null);
  stored={text:'too short'};assert.equal((await post({action:'ai-profile',confirm:true})).status,400,'needs a readable CV');assert.equal(sent,null);stored={text:cvText};
  const filled=await (await post({action:'ai-profile',confirm:true})).json();assert.equal(filled.proposed,true,String(filled.error));
  assert.equal(sent.cvText,cvText);assert(/Never add, infer or improve a fact/.test(sent.system));assert.equal(sent.schema.additionalProperties,false);
  assert.deepEqual([filled.profile.name,filled.profile.skills,filled.profile.experience[0].employer],['Synthetic Person',['GA4'],'Synthetic Retail BV']);assert(!('invented' in filled.profile),'only the known fields come back');assert(/not saved yet/.test(filled.message));
  assert.equal((await (await scout.handle(new Request('https://hq.test/api/scout'))).json()).ai.usedToday,1,'one request counted');
  let off={ai:{...on,enabled:false}};const closed=createScout({settings:async()=>({SCOUT_CONFIG:off}),updateScout:async fn=>{off=fn(off);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network');},clock:()=>Date.parse(at),intervalMs:1e9,cvStore:async()=>stored,profileCall:async()=>{throw new Error('must not be called');}});
  assert.equal((await closed.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify({action:'ai-profile',confirm:true})}))).status,400,'not while the model is switched off');scout.close?.();closed.close?.();}
console.log('Motivation checks passed: CV fields proposed by one confirmed model request and never saved by it, tracked jobs deleted through the records connection, archived discoveries deleted on confirmation, old review versions removed on confirmation, bulk archive of unrelated discoveries, a private interview date, research without CV material, sourced facts only, a capped list, checked fact references, search fees in the estimate, unreadable answers refused, off by default, the daily limit and one draft per vacancy. Synthetic data only.');
