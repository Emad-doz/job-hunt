import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import {createConnections} from '../server/connections.mjs';
import {extractProfile} from '../server/cv-reader.mjs';
import {assessMatch} from '../server/matching.mjs';
import {createScout} from '../server/scout.mjs';
import {requestAssessment} from '../server/model-client.mjs';
import {AI_VERSION,ASSESSMENT_SCHEMA,assessJob,cvMaterial,estimateCost,sanitizeCvText,saveAiSettings,verifyAssessment} from '../server/analyst-ai.mjs';

// Synthetic evidence only; never store the owner's CV, key or a real vacancy in tests.
const at='2026-10-05T09:00:00Z',key='sk-ant-synthetic-test-key-0000000000000000';
const cvText=['Synthetic Candidate','synthetic.candidate@example.test | +31 6 12345678 | linkedin.com/in/synthetic','Keizersgracht 1, 1015 AB Amsterdam','Senior CRO Specialist at Example Retail, 2019 - 2023.','I run A/B tests and conversion optimization for e-commerce customer journeys.','I use GA4, Google Tag Manager, Power BI and SQL for digital analytics.','Digital Consultant building UX optimization workflows with stakeholders.','English and Dutch.','References','Chief Digital Officer, reachable at referee@example.test'].join('\n');
const profile={...extractProfile(cvText),readAt:at,modifiedAt:at};
const job={id:'SYNTHETIC-1',sourceId:'1',source:'Owner import',employer:'Synthetic employer',title:'CRO Specialist',description:'Design A/B tests and improve conversion optimization across the checkout. Use GA4 and SQL every day. Five years of experimentation experience required. Fluent Dutch is preferred.',url:'https://example.test/vacancy',location:'Amsterdam',salary:'Unknown',readAt:at,availability:'Owner excerpt; unverified',completeness:'Owner-provided excerpt'};
const legal={...job,id:'SYNTHETIC-2',title:'Senior Legal Counsel',description:'Advise on commercial contracts. You must have a law degree. SQL and GA4 appear in internal reporting for the legal team.'};
const answer={verdict:'plausible',summary:'A plausible match on conversion work; the experience length is not settled by the CV material.',
  strengths:[
    {requirement:'A/B testing',link:'direct',vacancyQuote:'Design A/B tests and improve conversion optimization',cvQuote:'I run A/B tests and conversion optimization for e-commerce customer journeys.',reasoning:'Direct evidence.'},
    {requirement:'Team leadership',link:'inferred',vacancyQuote:'Use GA4 and SQL every day',cvQuote:'Led a team of twelve analysts across three countries.',reasoning:'Invented by the model.'}],
  gaps:[{requirement:'Five years of experimentation',vacancyQuote:'Five years of experimentation experience required',importance:'required',note:'The CV material does not state a duration.'},{requirement:'Budget ownership',vacancyQuote:'You own a seven-figure budget',importance:'unclear',note:'Not in the vacancy.'}],
  ownerChecks:['Confirm your Dutch level.'],seniority:'The vacancy asks for five years; the CV material documents a senior title without a total duration.',
  letter:'Dear hiring team,\n\nI run A/B tests and conversion optimization, and I increased checkout conversion by 37%.\n\n[your name]',interviewQuestions:['How is the experimentation roadmap prioritised?']};

// 1. Contact details never form part of the material; employment periods remain.
const sanitized=sanitizeCvText(cvText);
assert(!/@|\+31|linkedin|1015 AB|Chief Digital Officer|referee/.test(sanitized));
assert(sanitized.includes('2019 - 2023')&&sanitized.includes('Power BI'));
const full=cvMaterial(profile,cvText,'cv'),bounded=cvMaterial(profile,cvText,'evidence');
assert.equal(full.scope,'cv');assert.equal(bounded.scope,'evidence');assert(!bounded.text.includes('2019 - 2023'));assert(!/@|\+31/.test(bounded.text));
assert.throws(()=>cvMaterial(profile,'x'.repeat(40000)+' experience\n'.repeat(4000),'cv'),/assessment limit/);
assert.throws(()=>cvMaterial({evidence:[]},'','evidence'),/No retained CV evidence/);

// 2. Only quote-checked claims are kept; invented figures are flagged.
const checked=verifyAssessment(answer,full.text,job.title+' '+job.description);
assert.equal(checked.strengths.length,1);assert.equal(checked.unverified.length,1);assert(checked.unverified[0].reason.includes('CV quote'));
assert.deepEqual(checked.gaps.map(g=>g.quoteVerified),[true,false]);assert.deepEqual(checked.letterFlags,['37%']);
assert.throws(()=>verifyAssessment({verdict:'92%'},full.text,job.description),/unexpected shape/);
assert.equal(checked.strengths[0].link,'direct');
assert.equal(verifyAssessment({...answer,strengths:[{...answer.strengths[0],link:'certain'}]},full.text,job.title+' '+job.description).strengths[0].link,'related');
// A quote that spans a hyphenated PDF line wrap still counts as found.
const wrapped=verifyAssessment({...answer,strengths:[{requirement:'Testing',link:'direct',vacancyQuote:'Use GA4 and SQL every day',cvQuote:'conversion gains through data-driven testing',reasoning:'Direct.'}]},'I delivered conversion gains through data-\ndriven testing.',job.description);
assert.equal(wrapped.strengths.length,1);assert.equal(wrapped.unverified.length,0);
// Cost is an estimate from recorded tokens at list prices; unknown models get none.
assert.equal(estimateCost('claude-opus-5-5',{input:348,output:3985,cacheRead:0,cacheWrite:2420}),0.0932);assert.equal(estimateCost('claude-sonnet-5-5',{input:348,output:3985,cacheRead:0,cacheWrite:2420}),0.0466);assert.equal(estimateCost('another-model',{input:10,output:10}),null);

// 3. The real SDK request: key in a header only, schema-constrained, fallback enabled, CV block cacheable.
const sent=[];
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','request-id':'req_synthetic'}});
const message=(text,extra={})=>({id:'msg_synthetic',type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:900,output_tokens:400},...extra});
const fetcher=async(url,init)=>{sent.push({url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)});return reply(message(JSON.stringify(answer)));};
const recorded=await assessJob({job,profile,material:full,model:'claude-opus-5-5',apiKey:key,call:requestAssessment,fetcher,clock:()=>Date.parse(at)});
assert.equal(sent.length,1);const request=sent[0];
assert(request.url.endsWith('/v1/messages?beta=true')||request.url.endsWith('/v1/messages'));
assert.equal(request.headers.get('x-api-key'),key);assert(request.headers.get('anthropic-beta').includes('server-side-fallback-2026-07-01'));
assert.equal(request.body.model,'claude-opus-5-5');assert.equal(request.body.fallbacks,'default');assert.equal(request.body.max_tokens,16000);
assert.equal(request.body.output_config.effort,'medium');assert.equal(request.body.output_config.format.type,'json_schema');assert.deepEqual(request.body.output_config.format.schema,ASSESSMENT_SCHEMA);
assert(!('thinking' in request.body)&&!('temperature' in request.body)&&!('tool_choice' in request.body));
assert.equal(request.body.system.length,2);assert(!request.body.system[0].cache_control);assert.deepEqual(request.body.system[1].cache_control,{type:'ephemeral'});
const wire=JSON.stringify(request.body);assert(!wire.includes(key));assert(!/synthetic\.candidate@|\+31 6|1015 AB|referee@/.test(wire));assert(wire.includes('Five years of experimentation'));
assert.equal(recorded.limited,false);assert.equal(recorded.vacancyChars,job.description.length);assert.equal(recorded.costUsd,estimateCost('claude-opus-5-5',recorded.usage));assert.equal(typeof recorded.seconds,'number');assert(!request.body.messages[0].content.includes('truncated excerpt'));assert(JSON.stringify(request.body.system).includes('past tense'));
assert.equal(recorded.version,AI_VERSION);assert.equal(recorded.verdict,'plausible');assert.equal(recorded.strengths.length,1);assert.equal(recorded.usage.input,900);assert.equal(recorded.scope,'cv');assert(!JSON.stringify(recorded).includes(key));
await assert.rejects(requestAssessment({apiKey:key,model:'claude-opus-5-5',system:'s',cvMaterial:'c',vacancy:'v',schema:ASSESSMENT_SCHEMA,fetcher:async()=>reply({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}},401)}),e=>e.billed===false&&/rejected the saved API key/.test(e.message)&&!e.message.includes(key));
await assert.rejects(requestAssessment({apiKey:key,model:'claude-opus-5-5',system:'s',cvMaterial:'c',vacancy:'v',schema:ASSESSMENT_SCHEMA,fetcher:async()=>reply(message('',{content:[],stop_reason:'refusal',stop_details:{type:'refusal',category:'cyber',explanation:null}}))}),e=>e.billed===true&&/declined/.test(e.message));

// 4. Settings need an explicit choice and consent; the key is write-only.
assert.throws(()=>saveAiSettings({},{apiKey:'not-a-key',enabled:false}),/sk-ant-/);
assert.throws(()=>saveAiSettings({},{apiKey:key,enabled:true}),/Confirm/);
assert.throws(()=>saveAiSettings({},{apiKey:key,model:'gpt-x',enabled:false}),/supported model/);
assert.equal(saveAiSettings({},{apiKey:key,enabled:false}).scope,'evidence');
assert.equal(saveAiSettings({apiKey:key},{enabled:true,consent:true,scope:'cv',dailyLimit:3}).apiKey,key);

// 5. Scout: off by default, advisory, bounded, reused and never a tracker write.
let config={state:{profile,results:[job,legal],workflows:[]},boards:[]},calls=0,network=0,reads=0;
const env={HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_PUBLIC_ORIGIN:'https://hq.example.test'};
const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},env,{cvReader:async()=>profile,cvMaterialReader:async()=>{reads++;return {profile,text:cvText};},modelCall:async input=>{calls++;assert.equal(input.apiKey,key);assert(!/@|\+31/.test(input.cvMaterial));return {text:JSON.stringify(answer),servedBy:'claude-opus-5-5',fallback:false,usage:{input:900,output:400,cacheRead:0,cacheWrite:0}};},fetcher:async()=>{network++;throw new Error('No network in assessment tests');},boardsDefault:[],clock:()=>Date.parse(at)});
const get=async()=>(await scout.handle(new Request('https://hq.example.test/api/scout'))).json();
const post=(action,extra={})=>scout.handle(new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:env.HQ_PUBLIC_ORIGIN,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})}));
const settle=async()=>{for(let i=0;i<200;i++){const view=await get();if(view.aiRun&&view.aiRun.status!=='running')return view;await new Promise(r=>setTimeout(r,5));}throw new Error('Assessment did not settle');};
try{
  let view=await get();assert.equal(view.ai.configured,false);assert.equal(view.ai.enabled,false);assert.deepEqual(view.aiReviews,[]);
  let refused=await post('ai-review',{jobId:job.id});assert.equal(refused.status,400);assert((await refused.json()).error.includes('Nothing was sent'));assert.equal(calls,0);
  assert.equal((await post('ai-settings',{apiKey:key,enabled:true,scope:'cv'})).status,400);
  assert.equal((await post('ai-settings',{apiKey:key,enabled:false,scope:'cv'})).status,200);
  refused=await post('ai-review',{jobId:job.id});assert.equal(refused.status,400);assert.equal(calls,0);
  assert.equal((await post('ai-settings',{enabled:true,consent:true,scope:'cv',dailyLimit:2})).status,200);
  view=await get();assert(view.ai.enabled&&view.ai.configured);assert.equal(view.ai.scope,'cv');assert.equal(view.ai.dailyLimit,2);assert(!JSON.stringify(view).includes(key));
  assert.equal((await post('ai-review',{jobId:job.id})).status,202);view=await settle();
  assert.equal(view.aiRun.status,'completed');assert.equal(view.aiRun.assessed,1);assert.equal(calls,1);assert.equal(reads,1);assert.equal(view.aiReviews.length,1);assert.equal(view.aiReviews[0].jobId,job.id);assert.equal(view.aiReviews[0].unverified.length,1);assert.equal(view.ai.usedToday,1);
  assert(view.events.some(e=>e.agentId==='02'&&e.details.includes('model-based assessment recorded')&&e.details.includes('Advisory only')));
  // The retained record holds quoted evidence only: no key, contact line or unquoted CV text.
  const stored=JSON.stringify(config);assert(stored.includes(key));assert(!JSON.stringify(config.state).includes(key));assert(!/synthetic\.candidate@|\+31 6|1015 AB|Digital Consultant building/.test(JSON.stringify(config.state.aiReviews)));
  // Identical inputs are reused without another request; a held legal role stays held whatever the model says.
  await post('ai-review',{jobId:job.id});view=await settle();assert.equal(view.aiRun.reused,1);assert.equal(calls,1);
  await post('ai-review',{jobId:legal.id});view=await settle();assert.equal(calls,2);assert.equal(view.aiReviews.length,2);
  assert(!view.results.find(j=>j.id===legal.id).fit.eligible);assert.equal(view.workflows.length,0);
  // The daily limit stops further spend and says so.
  await post('ai-review',{jobId:job.id,force:true});view=await settle();assert.equal(calls,2);assert.equal(view.aiRun.skipped,1);assert(view.aiRun.error.includes('Daily limit'));
  assert.equal(network,0);
}finally{scout.close();}

// 6. Screening regression: letters inside ordinary words no longer mark a legal requirement optional.
const screen=description=>assessMatch({title:'Digital analyst',description},profile).eligible;
assert.equal(screen('Use GA4 and SQL. You must have a law degree and previous legal experience.'),false);
assert.equal(screen('Use GA4 and SQL. Required: LLM and comprehensive legal experience.'),false);
assert.equal(screen('Use GA4 and SQL. Juridische ervaring is een pre.'),true);
assert.equal(screen('Use GA4 and SQL. A law degree is preferred, not required.'),true);

// 6b. An aggregator excerpt is labelled as one, and text the owner pastes replaces it and survives later source checks.
{
  const excerpt='CRO Specialist bij een synthetische retailer. Wij maken tijdloze basics en groeien snel in Europa. Fulltime in Amsterdam. Solliciteer vandaag nog via onze website …';
  const fullText='CRO Specialist. Responsibilities: design and run A/B tests on the checkout, analyse funnels in GA4 and report results with SQL. Requirements: three years of hands-on experimentation experience, strong GA4 and SQL skills, fluent Dutch. We offer a hybrid role in Amsterdam.';
  let now=Date.parse(at),settings={state:{},boards:[],appId:'synthetic',appKey:'synthetic-secret',terms:['cro specialist'],ai:{apiKey:key,enabled:true,scope:'cv',model:'claude-opus-5-5',dailyLimit:5}};const seen=[];
  const adzuna=async url=>{assert(String(url).startsWith('https://api.adzuna.com/'));return Response.json({results:[{id:'777',title:'CRO Specialist',redirect_url:'https://www.adzuna.nl/details/777',description:excerpt,company:{display_name:'Synthetic retailer'},location:{display_name:'Amsterdam'},created:at}]});};
  const board=createScout({settings:async()=>({SCOUT_CONFIG:settings}),updateScout:async fn=>{settings=fn(settings);}},env,{cvReader:async()=>profile,cvMaterialReader:async()=>({profile,text:cvText}),modelCall:async input=>{seen.push(input.vacancy);return {text:JSON.stringify(answer),servedBy:'claude-opus-5-5',fallback:false,usage:{input:300,output:900,cacheRead:0,cacheWrite:0}};},fetcher:adzuna,boardsDefault:[],clock:()=>now});
  const view=async()=>(await board.handle(new Request('https://hq.example.test/api/scout'))).json();
  const act=(action,extra={})=>board.handle(new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:env.HQ_PUBLIC_ORIGIN,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})}));
  const idle=async done=>{for(let i=0;i<300;i++){const v=await view();if(done(v))return v;await new Promise(r=>setTimeout(r,5));}throw new Error('Scout task did not settle');};
  try{
    assert.equal((await act('run')).status,200);let v=await idle(s=>s.status!=='running'&&s.results.length===1);
    const found=v.results[0];assert.equal(found.id,'ADZUNA-777');assert.equal(found.completeness,'Aggregator excerpt');assert.equal(found.description,excerpt);
    await act('ai-review',{jobId:found.id});v=await idle(s=>s.aiRun&&s.aiRun.status!=='running');
    assert.equal(v.aiReviews.length,1);assert.equal(v.aiReviews[0].limited,true);assert.equal(v.aiReviews[0].vacancyChars,excerpt.length);assert.equal(v.aiReviews[0].costUsd,estimateCost('claude-opus-5-5',{input:300,output:900}));assert(seen[0].includes('truncated excerpt from a job aggregator'));
    assert.equal((await act('vacancy-text',{jobId:found.id,description:'Too short.'})).status,400);assert.equal((await act('vacancy-text',{jobId:'MISSING',description:fullText})).status,400);assert.equal((await act('vacancy-text',{jobId:found.id,description:'x'.repeat(18001)})).status,400);
    const saved=await act('vacancy-text',{jobId:found.id,description:'<p>'+fullText+'</p>'});assert.equal(saved.status,200);assert((await saved.json()).message.includes('Nothing was written to your tracker'));
    const raw=await (await board.handle(new Request('https://hq.example.test/api/scout'))).text();v=JSON.parse(raw);
    assert.equal(v.results[0].description,fullText);assert.equal(v.results[0].completeness,'Owner-provided full text');assert.equal(v.results[0].sourceExcerpt,excerpt);assert(v.results[0].ownerTextAt);assert(!('ownerTexts' in v));
    assert(v.events.some(e=>e.type==='Owner provided vacancy text'&&e.details.includes('Not independently verified')));assert.equal(Object.keys(settings.state.ownerTexts).length,1);
    // The fuller text is screened at once; the review of the excerpt stays as a superseded version.
    assert.equal(v.workflows.length,2);assert(v.workflows[0].superseded&&v.workflows[0].job.description===excerpt);assert(!v.workflows[1].superseded&&v.workflows[1].job.description===fullText);assert.equal(v.activeAgent,null);
    await act('ai-review',{jobId:found.id});v=await idle(s=>s.aiRun&&s.aiRun.status!=='running'&&s.aiReviews.length===2);
    assert.equal(v.aiReviews[1].limited,false);assert.equal(v.aiReviews[1].vacancyChars,fullText.length);assert(seen[1].includes('three years of hands-on experimentation')&&!seen[1].includes('truncated excerpt'));
    // A later source check returns the excerpt again; the owner's text stays.
    now+=11*60*1000;assert.equal((await act('run')).status,200);v=await idle(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString());
    assert.equal(v.results.length,1);assert.equal(v.results[0].description,fullText);assert.equal(v.results[0].sourceExcerpt,excerpt);assert.equal(v.results[0].completeness,'Owner-provided full text');
  }finally{board.close();}
}

// 7. A refused settings change is returned to the caller; it must not leave a rejection that stops the server.
const unhandled=[];process.on('unhandledRejection',reason=>unhandled.push(reason));
const settingsFile=path.join(os.tmpdir(),'hq-settings-check-'+randomBytes(6).toString('hex')+'.enc');
try{
  const private_=createConnections({HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_CONFIG_FILE:settingsFile},path.join(os.tmpdir(),'hq-public-root'));
  await assert.rejects(private_.updateScout(()=>{throw new Error('Refused change');}),/Refused change/);
  await new Promise(r=>setTimeout(r,20));assert.deepEqual(unhandled,[]);
  await private_.updateScout(c=>({...c,ai:saveAiSettings(c.ai,{apiKey:key,enabled:false})}));
  assert.equal((await private_.settings()).SCOUT_CONFIG.ai.apiKey,key);assert(!(await readFile(settingsFile,'utf8')).includes(key));
}finally{await rm(settingsFile,{force:true});}
console.log('Model-based Analyst checks passed: excerpts labelled, owner-pasted vacancy text kept across source checks, strength links, cost estimates, refused settings changes survive, contact lines excluded, quote-checked strengths, flagged figures, exact SDK request, write-only key, consent, off by default, reuse, daily limit, advisory-only screening and the optional-wording fix. Synthetic data only; no model was called.');
