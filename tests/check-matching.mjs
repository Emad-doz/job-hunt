import assert from 'node:assert/strict';
import {assessMatch,MATCH_VERSION} from '../server/matching.mjs';
import {extractProfile} from '../server/cv-reader.mjs';
import {buildWorkflow,fingerprint} from '../server/workflow.mjs';
import {createScout} from '../server/scout.mjs';

// Synthetic professional evidence only; never store the owner's CV in tests.
const at='2026-10-02T12:00:00Z',profile={...extractProfile('Synthetic candidate. Senior CRO and Experimentation Lead. I run A/B tests and conversion optimization for e-commerce customer journeys. I use GA4, Google Tag Manager, Power BI and SQL for digital analytics. Digital Consultant building UX optimization workflows. I collaborate with stakeholders and with the legal team on privacy. Bachelor of Technology in Software Engineering. English. References\nChief Digital Officer at another business.'),readAt:at,modifiedAt:at};
assert.deepEqual(profile.terms,['CRO specialist','experimentation lead','digital analyst','digital consultant','ecommerce manager','data analyst']);assert(!profile.legalBackground);assert(profile.skills.includes('Power BI'));assert(profile.roleFamilies.includes('conversion'));assert(!profile.evidence.some(s=>s.includes('Chief Digital Officer')));
const base={id:'SYNTHETIC-1',sourceId:'1',source:'Owner import',employer:'Synthetic employer',title:'CRO Specialist',description:'Design A/B tests and improve conversion optimization. Use GA4 and SQL. Collaborate with stakeholders and legal colleagues on privacy.',url:'https://example.test/vacancy',location:'Amsterdam',salary:'Unknown',readAt:at,availability:'Owner excerpt; unverified',completeness:'Owner-provided excerpt'};
const cases=[
  [base,true],
  [{...base,title:'Digital analyst',description:'Work with GA4 and SQL for ecommerce conversion analytics.'},true],
  [{...base,title:'Product analyst',description:'GA4 and SQL to measure customer journeys and experiments.'},true],
  [{...base,title:'Experimentation Lead',description:'Lead A/B testing and use Google Tag Manager.'},true],
  [{...base,title:'Digital Consultant',description:'Improve customer journeys with UX optimization and GA4.'},true],
  [{...base,title:'Senior Legal Counsel',description:'Stakeholder collaboration and analytics. SQL and GA4 are mentioned in internal reporting.'},false],
  [{...base,title:'Legal Team Lead for Deal Desk - Transactions',employer:'Adyen',description:'Lead transaction contracts with stakeholders. Analytics, SQL and e-commerce data support the team.'},false],
  [{...base,title:'Compliance Officer',description:'Stakeholder collaboration and e-commerce data analytics.'},false],
  [{...base,title:'Jurist',description:'Analytics for e-commerce; stakeholder collaboration.'},false],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. You must have a law degree and five years of legal experience.'},false],
  [{...base,title:'Digital analyst',description:'GA4 and SQL. Qualifications: 5+ years legal experience.'},false],
  [{...base,title:'Digital analyst',description:'GA4 and SQL. LLB or LLM.'},false],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. You must have a law degree, Power BI is preferred.'},false],
  [{...base,title:'Chief Revenue Officer (CRO)',description:'CRO leadership, stakeholders and analytics.'},false],
  [{...base,title:'Account Manager',description:'Stakeholder collaboration, analytics, GA4 and SQL dashboards.'},false],
  [{...base,title:'Digital analyst',description:'Stakeholder collaboration and generic analytics.'},false],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. Legal experience is not required.'},true],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. A law degree is preferred, not required.'},true],
  [{...base,title:'CRO Specialist',description:'Use A/B testing and GA4. Work with the legal team on GDPR.'},true],
  // LLM is a language model unless legal wording stands beside it; GTM is go-to-market unless a tagging cue does.
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. LLM Integration: experience exposing platform data to language models.'},true],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. Improve our content flywheels including LLM optimizations.'},true],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. An LLM in European law is required.'},false],
  [{...base,title:'Digital analyst',description:'Use GA4 and SQL. Mastery of flawless reporting.'},true],
  [{...base,title:'Digital analyst',description:'Own the GTM strategy and the go-to-market plan with stakeholders.'},false],
  [{...base,title:'Digital analyst',description:'Set up tracking in GTM for the web shop.'},true],
];
for(const [job,eligible] of cases){const fit=assessMatch(job,profile);assert.equal(fit.eligible,eligible,job.title+' / '+job.description);assert.equal(fit.version,MATCH_VERSION);assert(fit.reasons.length);const w=buildWorkflow(job,profile);assert.equal(!!w.draft,eligible);assert.equal(w.receipts.length,eligible?5:2);assert.equal(w.stage,eligible?'Coordinator review':'Analyst hold');if(!eligible)assert(!w.receipts.some(r=>['03','04','00'].includes(r.agentId)));}
assert(!assessMatch(base,null).eligible);
// Title edits and matcher upgrades must not reuse an earlier positive review.
assert.notEqual(fingerprint(base,profile),fingerprint({...base,title:'Legal Counsel'},profile));
let config={state:{profile,results:[base,{...base,id:'legal',title:'Legal Counsel'}],workflows:[]},boards:[]},sourceCalls=0;
const old=buildWorkflow(base,profile);old.id='HQ-W-preserved';old.fingerprint='earlier-method';old.job={...base,id:'legal',title:'Legal Counsel'};delete old.fit;config.state.workflows=[old];
const env={HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_PUBLIC_ORIGIN:'https://hq.example.test'},scout=createScout({settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);} },env,{cvReader:async()=>profile,fetcher:async()=>{sourceCalls++;throw new Error('No network in matching migration');},boardsDefault:[],clock:()=>Date.parse(at)});
const get=async()=>(await scout.handle(new Request('https://hq.example.test/api/scout'))).json();
const request=(action,extra={})=>new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:env.HQ_PUBLIC_ORIGIN,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
try{
  let view=await get();assert.equal(view.matching.recommended,1);assert.equal(view.matching.held,1);assert.equal(view.results[0].id,base.id);assert(!view.workflows[0].currentFit.eligible);assert(!view.workflows[0].currentRules);assert.equal(view.workflows[0].id,old.id);
  const rejected=await scout.handle(request('append',{workflowId:old.id,confirmReviewed:true}));assert.equal(rejected.status,400);assert((await rejected.json()).error.includes('Held'));assert.equal(sourceCalls,0);
  assert.equal((await scout.handle(request('review'))).status,202);
  for(let i=0;i<100;i++){view=await get();if(view.reviewRun?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(view.reviewRun.prepared,2);assert.equal(view.reviewRun.held,1);assert.equal(view.workflows[0].id,old.id);assert(view.workflows[0].superseded);assert(view.workflows.slice(1).every(w=>w.currentRules));assert.equal(sourceCalls,0);
  const beforeIds=view.workflows.map(w=>w.id);await scout.handle(request('review'));for(let i=0;i<100;i++){view=await get();if(view.reviewRun?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}assert.equal(view.reviewRun.prepared,0);assert.deepEqual(view.workflows.map(w=>w.id),beforeIds);
}finally{scout.close();}
console.log('CV screening passed: legal requirements held, generic overlap rejected, relevant CRO / analytics / consulting retained, optional legal wording handled, drafts gated, saved reviews preserved and reclassified, no source or Sheet writes during migration.');
