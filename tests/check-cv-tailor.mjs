import assert from 'node:assert/strict';
import {applyTailoring,tailorCv,tailorSchema,tailorSystem} from '../server/cv-tailor.mjs';
import {createScout} from '../server/scout.mjs';

// Synthetic CV details and vacancy only. No network: the model request is injected.
const profile={name:'Synthetic Person',headline:'Digital Analyst',email:'person@example.test',phone:'',location:'Amsterdam',links:[],about:'Analyst with made-up experience.',skills:['GA4','SQL','Looker Studio','A/B testing','Python'],languages:[{name:'Dutch',level:'B2'}],
  experience:[{title:'Digital Analyst',employer:'Synthetic Retail BV',location:'Amsterdam',start:'2022-03',end:'Present',points:['Built the GA4 reporting stack.','Ran A/B tests on checkout.','Trained marketers to read dashboards.']},{title:'Web Analyst',employer:'Example Labs',location:'Utrecht',start:'2019-01',end:'2022-02',points:['Migrated tracking to GA4.','Weekly performance reviews.']}],
  education:[{degree:'BSc Information Science',school:'Example University',start:'2014',end:'2018',notes:''}],certificates:['Synthetic certificate']};

// The model's answer is rebuilt from the saved details: it can choose and order, and write two texts, and nothing else survives.
const answer={headline:'CRO-minded Digital Analyst',about:'Analyst who runs made-up experiments.',skills:['a/b testing','GA4','Kubernetes','SQL','GA4'],
  experience:[{entry:1,points:['Migrated tracking to GA4.']},{entry:0,points:['Ran A/B tests on checkout.','Led a team of ten analysts.','Built the GA4 reporting stack.']},{entry:7,points:[]},{entry:0,points:['Trained marketers to read dashboards.']}],changes:['Put experimentation first.','  ','The vacancy asks for Kubernetes, which your details do not show.']};
const made=applyTailoring(profile,answer);
assert.deepEqual(made.variant.skills,['A/B testing','GA4','SQL'],'saved skills only, in the model\'s order, in the saved spelling, once');
assert.deepEqual(made.variant.experience.map(x=>x.employer),['Synthetic Retail BV','Example Labs'],'jobs stay in the saved order');
assert.deepEqual(made.variant.experience[0].points,['Ran A/B tests on checkout.','Built the GA4 reporting stack.'],'saved points only, in the model\'s order');
assert.deepEqual(made.variant.experience[1].points,['Migrated tracking to GA4.']);
assert.equal(made.variant.experience[0].start,'2022-03');assert.equal(made.variant.experience[0].title,'Digital Analyst','titles and dates are the saved ones');
assert.equal(made.variant.headline,'CRO-minded Digital Analyst');assert.equal(made.variant.about,'Analyst who runs made-up experiments.');assert.deepEqual(made.written,{headline:true,about:true});
assert.deepEqual([made.variant.name,made.variant.email,made.variant.education,made.variant.languages,made.variant.certificates],[profile.name,profile.email,profile.education,profile.languages,profile.certificates],'everything else is untouched');
assert(made.dropped.some(d=>/Kubernetes/.test(d)));assert(made.dropped.some(d=>/rewritten point under Digital Analyst/.test(d)));assert(made.dropped.some(d=>/not in your details/.test(d)));
assert.deepEqual(made.changes,['Put experimentation first.','The vacancy asks for Kubernetes, which your details do not show.']);assert(!JSON.stringify(made.variant).includes('team of ten'));
// An empty or broken answer leaves the saved CV as it is.
const empty=applyTailoring(profile,{});assert.deepEqual(empty.variant.skills,profile.skills);assert.equal(empty.variant.experience.length,2);assert.equal(empty.variant.about,profile.about);assert.deepEqual(empty.written,{headline:false,about:false});
assert.deepEqual(applyTailoring(profile,null).variant.skills,profile.skills);
assert.equal(tailorSchema.additionalProperties,false);assert(/Never add a skill/.test(tailorSystem)&&/copied exactly/.test(tailorSystem));

const job={id:'SYNTHETIC-C1',title:'CRO Analyst',employer:'Synthetic Retail BV',location:'Amsterdam',url:'https://example.test/jobs/c1',source:'Synthetic source',description:'We look for an analyst who runs experiments on our webshop checkout and reports on them with GA4 and SQL. '.repeat(4)};
const ai={apiKey:'sk-ant-synthetic-test-key-0000000000000000',model:'claude-opus-5-5'};
let sent=null;const call=async request=>{sent=request;return {text:JSON.stringify(answer),servedBy:'claude-opus-5-5',usage:{input:1200,output:300}};};
const direct=await tailorCv({profile,job,ai,call});assert.equal(direct.variant.skills.length,3);assert(sent.vacancy.includes('CRO Analyst')&&sent.vacancy.includes('experiments on our webshop'));assert.equal(JSON.parse(sent.profileJson).name,'Synthetic Person');
await assert.rejects(()=>tailorCv({profile,job:{...job,description:'Too short.'},ai,call}),/too little text/);await assert.rejects(()=>tailorCv({profile:{name:'Only a name'},job,ai,call}),/nothing to adapt/);
await assert.rejects(()=>tailorCv({profile,job,ai,call:async()=>({text:'not json'})}),/could not be read/);

// The page-facing action: confirmed each time, model enabled, a recorded vacancy, saved details, one counted request, nothing saved.
const at='2026-10-08T10:00:00.000Z',on={apiKey:ai.apiKey,model:ai.model,scope:'evidence',enabled:true,consentAt:at,consentVersion:2,dailyLimit:20};
let config={ai:on,state:{results:[job]}},stored=profile,calls=0;
const scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network in tests');},clock:()=>Date.parse(at),intervalMs:1e9,profileStore:async()=>stored,tailorCall:async request=>{calls++;return call(request);}});
const post=body=>scout.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)}));await scout.handle(new Request('https://hq.test/api/scout'));
assert.equal((await post({action:'ai-cv',jobId:job.id})).status,400,'needs its own confirmation');assert.equal((await post({action:'ai-cv',confirm:true,jobId:'UNKNOWN'})).status,400);
stored=null;assert.equal((await post({action:'ai-cv',confirm:true,jobId:job.id})).status,400,'needs saved details');assert.equal(calls,0);stored=profile;
const done=await (await post({action:'ai-cv',confirm:true,jobId:job.id})).json();assert.equal(done.proposed,true,String(done.error));assert.equal(calls,1);
assert.deepEqual([done.employer,done.title,done.variant.skills.length,done.variant.experience.length],['Synthetic Retail BV','CRO Analyst',3,2]);assert(/Check it before you download/.test(done.message));assert(done.dropped.length>0);
const after=await (await scout.handle(new Request('https://hq.test/api/scout'))).json();assert.equal(after.ai.usedToday,1,'one request counted');assert(!JSON.stringify(config).includes('CRO-minded'),'the adapted CV is not stored');
// A vacancy HQ has no text for: the owner pastes it, with a title and an employer; it is used for the request and kept nowhere.
assert.equal((await post({action:'ai-cv',confirm:true,vacancy:{title:'CRO Analyst',employer:'Pasted Employer',description:'Too short.'}})).status,400);assert.equal((await post({action:'ai-cv',confirm:true,vacancy:{title:'',employer:'Pasted Employer',description:job.description}})).status,400);assert.equal(calls,1);
const fromText=await (await post({action:'ai-cv',confirm:true,vacancy:{title:'CRO Analyst',employer:'Pasted Employer',location:'Utrecht',description:'Pastedmarker vacancy body about experiments on a webshop checkout with GA4 and SQL. '.repeat(4)}})).json();assert.equal(fromText.proposed,true,String(fromText.error));assert.equal(fromText.employer,'Pasted Employer');assert.equal(calls,2);assert(sent.vacancy.includes('Pasted Employer')&&sent.vacancy.includes('Utrecht'));assert(sent.vacancy.includes('Pastedmarker'));assert(!JSON.stringify(config).includes('Pastedmarker'),'the pasted text is not stored');assert(JSON.stringify(config).includes('Pasted Employer'),'the activity journal names the employer and title the CV was prepared for');
let off={ai:{...on,enabled:false},state:{results:[job]}};const closed=createScout({settings:async()=>({SCOUT_CONFIG:off}),updateScout:async fn=>{off=fn(off);}},{HQ_ACCESS_PASSWORD:'synthetic-owner-password-123'},{fetcher:async()=>{throw new Error('no network');},clock:()=>Date.parse(at),intervalMs:1e9,profileStore:async()=>stored,tailorCall:async()=>{throw new Error('must not be called');}});
assert.equal((await closed.handle(new Request('https://hq.test/api/scout',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify({action:'ai-cv',confirm:true,jobId:job.id})}))).status,400,'not while the model is switched off');
scout.close?.();closed.close?.();
console.log('Adapted CV checks passed: saved skills and points only, saved order of jobs, untouched facts, dropped additions reported, confirmed and counted request, a pasted vacancy accepted, nothing stored. Synthetic values only.');
