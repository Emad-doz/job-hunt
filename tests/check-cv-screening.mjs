import assert from 'node:assert/strict';
import {versioned} from '../server/scout.mjs';
import {extractProfile} from '../server/cv-reader.mjs';
import {assessMatch} from '../server/matching.mjs';
import {buildWorkflow} from '../server/workflow.mjs';
import {createScout} from '../server/scout.mjs';
import {requestTriage} from '../server/model-client.mjs';
import * as client from '../server/model-client.mjs';
import {CONSENT_VERSION,saveAiSettings} from '../server/analyst-ai.mjs';
import {SCREEN_LIMITS,TRIAGE_SCHEMA,publicUrl,triageRequest,triageVerdicts} from '../server/cv-screening.mjs';

// Synthetic people, vacancies and addresses only. No model or website is contacted.
const at='2026-10-05T09:00:00Z',key='sk-ant-synthetic-test-key-0000000000000000';
// A profession the keyword rules know nothing about: screening must not depend on one field of work.
const nurseCv='Synthetic Candidate. Registered paediatric nurse with eight years on a children\'s ward. I coordinate shift handovers, train new nurses and manage medication rounds for twenty patients. BIG registered. Dutch and English.';
const nurse={...extractProfile(nurseCv),readAt:at,modifiedAt:at};
assert.deepEqual(nurse.roleFamilies,[]);
const ward={id:'A-1',sourceId:'1',source:'Adzuna',title:'Senior paediatric nurse',employer:'Synthetic hospital',description:'Lead the children\'s ward team on day shifts, coordinate handovers and mentor new nurses. BIG registration required.',url:'https://careers.example.test/jobs/senior-paediatric-nurse',location:'Amsterdam',salary:'Unknown',readAt:at,availability:'Source listing',completeness:'Aggregator excerpt'};
const verdict=(fit,reason='Ward leadership and handover coordination match eight years of paediatric nursing.')=>({fit,reason,by:'Analyst screening',model:'claude-opus-5-5',at});

// 1. The keyword rules alone hold a fitting job in an unknown profession; a model verdict lets it through, and a requirement conflict still wins.
assert.equal(assessMatch(ward,nurse).label,'Insufficient role evidence');
const matched=assessMatch({...ward,modelFit:verdict('relevant')},nurse);
assert(matched.eligible);assert.equal(matched.label,'Model-screened match');assert.equal(matched.basis,'model');assert.equal(matched.priority,2);assert(matched.reasons[0].includes('Analyst screening against your CV: relevant'));assert(!matched.reasons.join(' ').includes('does not align'));
assert.equal(assessMatch({...ward,modelFit:verdict('possible')},nurse).label,'Model-screened possibility');
const unrelated=assessMatch({...ward,modelFit:verdict('unrelated','A software role.')},nurse);assert(!unrelated.eligible);assert.equal(unrelated.label,'Screened as unrelated');
const conflict=assessMatch({...ward,title:'Legal counsel, healthcare',modelFit:verdict('relevant')},nurse);assert(!conflict.eligible);assert.equal(conflict.label,'Requirement mismatch');
assert(!assessMatch({...ward,modelFit:{fit:'excellent',reason:'x'}},nurse).eligible);
// The draft for a model-screened job never contains an empty list or "undefined".
const review=buildWorkflow({...ward,modelFit:verdict('relevant')},nurse);
assert(review.draft&&!/undefined|documents ,/.test(JSON.stringify(review.draft)));assert(review.draft.letter.includes('[Add in one or two sentences'));assert(review.receipts.find(r=>r.agentId==='02').findings.some(f=>f.value.includes('judged by a model')));
assert(buildWorkflow(ward,nurse).receipts.find(r=>r.agentId==='02').findings.some(f=>f.value.includes('No AI model')));

// 2. Posting links are cleaned of tracking and must be a public address for one page; verdicts are matched to their vacancy by reference.
assert.equal(publicUrl('https://jobs.example.test/view?id=123&utm_source=x&gclid=y#apply'),'https://jobs.example.test/view?id=123');
for(const bad of ['http://jobs.example.test/a','https://user:pw@jobs.example.test/a','https://jobs.example.test/','https://localhost/a','https://10.0.0.1/a','javascript:alert(1)','not a link',''])assert.throws(()=>publicUrl(bad),bad);
const pair=[ward,{...ward,id:'A-2',title:'Java engineer'}],judged=triageVerdicts({verdicts:[{ref:'2',fit:'unrelated',reason:'Software.'},{ref:'1',fit:'relevant',reason:'Fits.'},{ref:'1',fit:'unrelated',reason:'duplicate'},{ref:'9',fit:'relevant',reason:'no such ref'},{ref:'2',fit:'great',reason:'bad label'}]},pair,'m',at);
assert.equal(judged.size,2);assert.equal(judged.get(pair[0]).fit,'relevant');assert.equal(judged.get(pair[1]).fit,'unrelated');assert(triageRequest(pair).includes('<vacancy ref="2">')&&triageRequest(pair).includes('(truncated excerpt)'));

// 3. The screening request the official SDK sends is schema-bound. The web search for vacancies is gone; the only web search is the employer research behind a motivation draft.
const sent=[];
const screening=await requestTriage({apiKey:key,model:'claude-opus-5-5',system:'s',cvMaterial:'c',listings:'l',schema:TRIAGE_SCHEMA,fetcher:async(url,init)=>{sent.push({url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)});return new Response(JSON.stringify({id:'m',type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text:'{"verdicts":[]}'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:50,output_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});}});
assert.equal(screening.text,'{"verdicts":[]}');assert.deepEqual(sent[0].body.output_config.format.schema,TRIAGE_SCHEMA);assert.equal(sent[0].body.messages[0].content,'l');assert(!sent[0].body.stream&&!('tools' in sent[0].body));assert.equal(sent[0].headers.get('x-api-key'),key);assert(!JSON.stringify(sent[0].body).includes(key));
assert.deepEqual(Object.keys(client).sort(),['requestAssessment','requestCompanyResearch','requestMotivation','requestProfile','requestTailoredCv','requestTriage']);

// 4. Scout: consent that names screening, excerpts judged by the CV, verdicts kept across source checks, limits, and never a tracker write.
const excerpt=title=>title+' at a synthetic employer in Amsterdam. Join a friendly team and grow with us. Apply today through our careers site and tell us about yourself …';
let now=Date.parse(at),settings={state:{},boards:[],appId:'synthetic',appKey:'synthetic-secret',terms:['ward nurse'],ai:{apiKey:key,enabled:true,scope:'cv',model:'claude-opus-5-5',dailyLimit:3,consentAt:at}},triageCalls=0,triageInput=null,listings=[{id:'1',title:'Paediatric ward nurse',employer:'Synthetic hospital'},{id:'2',title:'Java engineer',employer:'Synthetic software'}];
const adzuna=async url=>{assert(String(url).startsWith('https://api.adzuna.com/'));return Response.json({results:listings.map(l=>({id:l.id,title:l.title,redirect_url:'https://www.adzuna.nl/details/'+l.id,description:excerpt(l.title),company:{display_name:l.employer},location:{display_name:'Amsterdam'},created:at}))});};
const env={HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_PUBLIC_ORIGIN:'https://hq.example.test'};
const scout=createScout({settings:async()=>({SCOUT_CONFIG:settings}),updateScout:async fn=>{settings=fn(settings);}},env,{cvReader:async()=>nurse,cvMaterialReader:async()=>({profile:nurse,text:nurseCv}),modelCall:async()=>{throw new Error('No assessment expected');},
  triageCall:async input=>{triageCalls++;triageInput=input;const count=(input.listings.match(/<vacancy ref=/g)||[]).length;return {text:JSON.stringify({verdicts:[{ref:'1',fit:'relevant',reason:'Paediatric ward work matches the CV.'},{ref:'2',fit:'unrelated',reason:'Software engineering.'}].slice(0,count)}),servedBy:'claude-opus-5-5',fallback:false,usage:{input:900,output:100,cacheRead:0,cacheWrite:0}};},fetcher:adzuna,boardsDefault:[],clock:()=>now});
const view=async()=>(await scout.handle(new Request('https://hq.example.test/api/scout'))).json();
const act=(action,extra={})=>scout.handle(new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:env.HQ_PUBLIC_ORIGIN,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})}));
const until=async done=>{for(let i=0;i<400;i++){const v=await view();if(done(v))return v;await new Promise(r=>setTimeout(r,5));}throw new Error('Scout task did not settle');};
try{
  assert.equal((await act('run')).status,200);let v=await until(s=>s.status!=='running'&&s.results.length===2);
  assert.equal(v.unscreened,2);assert(v.results.every(j=>!j.fit.eligible));assert(!('modelFits' in v)&&!('webRun' in v));
  // Consent given before screening existed does not cover it; the removed web search is no longer an action at all.
  let refused=await act('ai-screen');assert.equal(refused.status,400);assert((await refused.json()).error.includes('confirm the model connection again'));
  refused=await act('web-search');assert.equal(refused.status,400);assert((await refused.json()).error.includes('Unsupported Scout action'));assert.equal(triageCalls,0);
  assert.equal((await act('ai-settings',{enabled:true,consent:true,scope:'cv',dailyLimit:3})).status,200);assert.equal(settings.ai.consentVersion,CONSENT_VERSION);assert(!('webDailyLimit' in settings.ai));
  v=await view();assert(v.ai.consentCurrent);assert(!('webDailyLimit' in v.ai));
  // Screening by CV: the nurse excerpt becomes a match, the engineer is marked unrelated, and nothing is left to screen.
  assert.equal((await act('ai-screen')).status,202);v=await until(s=>s.triageRun&&s.triageRun.status!=='running');
  assert.equal(v.triageRun.screened,2);assert.equal(v.triageRun.relevant,1);assert.equal(v.triageRun.unrelated,1);assert.equal(typeof v.triageRun.costUsd,'number');assert.equal(v.unscreened,0);assert.equal(triageCalls,1);assert(triageInput.listings.includes('(truncated excerpt)')&&triageInput.cvMaterial.includes('paediatric nurse'));
  const byTitle=title=>v.results.find(j=>j.title===title);assert.equal(byTitle('Paediatric ward nurse').fit.label,'Model-screened match');assert.equal(byTitle('Java engineer').fit.label,'Screened as unrelated');
  assert(v.events.some(e=>e.agentId==='02'&&e.details.startsWith('Model screening: 2 discoveries')&&e.details.includes('No tracker write')));assert(v.workflows.some(w=>w.job.title==='Paediatric ward nurse'&&w.draft&&!w.tracker));assert.equal(v.status,'idle');
  refused=await act('ai-screen');assert.equal(refused.status,400);assert((await refused.json()).error.includes('already has a model verdict'));assert.equal(triageCalls,1);
  // Verdicts survive the next source check; only a new discovery is left to screen, and a missing verdict is counted, not invented.
  now+=11*60*1000;listings=[...listings,{id:'3',title:'Ward coordinator',employer:'Synthetic clinic'}];await act('run');v=await until(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString());
  assert.equal(v.results.find(j=>j.title==='Paediatric ward nurse').fit.label,'Model-screened match');assert.equal(v.unscreened,1);
  settings.ai.dailyLimit=1;refused=await act('ai-screen');assert.equal(refused.status,400);assert((await refused.json()).error.includes('Daily limit of 1 model requests'));settings.ai.dailyLimit=3;
  await act('ai-screen');v=await until(s=>s.triageRun.status!=='running'&&s.triageRun.requested===1);assert.equal(v.triageRun.screened,1);assert.equal(triageCalls,2);assert.equal(v.unscreened,0);
  // Find jobs is one owner action: the source check, then screening of what is new. A plain source check, as the hourly one is, never screens.
  settings.ai.dailyLimit=10;now+=11*60*1000;listings=[...listings,{id:'4',title:'Night nurse',employer:'Synthetic hospice'}];
  let started=await act('run',{screen:true});assert.equal(started.status,200);assert((await started.json()).message.includes('screened by your CV straight after'));
  v=await until(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString()&&s.triageRun.requested===1&&s.triageRun.status==='completed'&&s.unscreened===0);
  assert.equal(triageCalls,3);assert.equal(v.runSummary.added,1);assert.equal(v.runSummary.total,4);assert.equal(v.runSummary.failed,0);assert.equal(v.screenSkipped,null);
  // Inside the ten-minute gap there is nothing to do, and it says when to try again instead of failing a source check.
  started=await act('run',{screen:true});assert.equal(started.status,400);const refusal=(await started.json()).error;assert(refusal.includes('nothing is waiting to be screened')&&refusal.includes('Try again in 10 minutes.'));
  now+=11*60*1000;listings=[...listings,{id:'5',title:'Ward sister',employer:'Synthetic infirmary'}];await act('run');v=await until(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString());assert.equal(v.unscreened,1);assert.equal(triageCalls,3);
  // Inside the gap with a discovery waiting, only the screening starts.
  started=await act('run',{screen:true});assert.equal(started.status,202);assert((await started.json()).message.includes('only the screening'));v=await until(s=>s.status!=='running'&&s.unscreened===0);assert.equal(triageCalls,4);assert.equal(v.lastRun,new Date(now).toISOString());
  // Without the model connection the same button still searches, and records why nothing was screened.
  settings.ai.enabled=false;now+=11*60*1000;listings=[...listings,{id:'6',title:'Care assistant',employer:'Synthetic home'}];await act('run',{screen:true});v=await until(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString()&&s.screenSkipped==='off');assert.equal(v.unscreened,1);assert.equal(triageCalls,4);settings.ai.enabled=true;
  assert(!JSON.stringify(settings.state).includes(key));assert(v.workflows.every(w=>!w.tracker));assert.equal(SCREEN_LIMITS.batch,60);
}finally{scout.close();}
assert.equal(saveAiSettings({apiKey:key,enabled:true,scope:'cv',consentAt:at},{enabled:true,consent:true,scope:'cv'}).consentVersion,CONSENT_VERSION);
// A page that already holds the current version gets only the live task fields; any other change sends the full state again.
{const body={status:'waiting',activeAgent:null,task:null,taskAt:null,results:[{id:'SYNTHETIC-1'}]},full=await versioned(null,body).json();assert(full.version&&full.results.length===1&&!full.unchanged);
 const same=await versioned(full.version,{...body,status:'running',activeAgent:'01',task:'Synthetic task'}).json();assert(same.unchanged&&same.activeAgent==='01'&&same.task==='Synthetic task'&&!('results' in same));
 const changed=await versioned(full.version,{...body,results:[{id:'SYNTHETIC-1'},{id:'SYNTHETIC-2'}]}).json();assert(!changed.unchanged&&changed.results.length===2&&changed.version!==full.version);}
console.log('CV screening checks passed: light polling, any profession screened by a model verdict, requirement conflicts still hold, drafts without empty wording, cleaned public links, exact SDK screening request, no web search request or action left, renewed consent, verdicts kept across source checks, only new discoveries screened, the daily limit, and one Find jobs action that searches then screens. Synthetic data only; no model was contacted.');
