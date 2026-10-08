import assert from 'node:assert/strict';
import {extractProfile} from '../server/cv-reader.mjs';
import {createScout} from '../server/scout.mjs';
import {JSEARCH_LIMITS,mapJSearchJob,publicJSearch,saveJSearchSettings,searchJSearch} from '../server/jsearch.mjs';

// Synthetic postings, key and candidate only. The JSearch service is never contacted.
const at='2026-10-05T09:00:00Z',key='synthetic-jsearch-key-0000000000';
const profile={...extractProfile('Synthetic candidate. Senior CRO and Experimentation Lead. I run A/B tests and conversion optimization for e-commerce customer journeys. I use GA4, Google Tag Manager, Power BI and SQL for digital analytics. Digital Consultant building UX optimization workflows. English.'),readAt:at,modifiedAt:at};
const posting=(id,title,employer,extra={})=>({job_id:id,job_title:title,employer_name:employer,job_publisher:'LinkedIn',job_apply_link:'https://www.linkedin.com/jobs/view/'+id+'?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply',apply_options:[{publisher:'LinkedIn',apply_link:'https://www.linkedin.com/jobs/view/'+id+'?utm_source=x',is_direct:false}],job_description:'<p>Lead experimentation and conversion optimisation for the web shop.</p> Requires GA4, SQL and three years of A/B testing experience in e-commerce.',job_posted_at_datetime_utc:'2026-10-01T08:00:00.000Z',job_location:'Amsterdam, Netherlands',job_city:'Amsterdam',job_country:'NL',job_salary_string:'',job_min_salary:null,job_max_salary:null,...extra});

// 1. A posting becomes a discovery with its full text, a cleaned link and the site it is published on.
const linked=mapJSearchJob(posting('abc==','Experimentation Lead','Synthetic retailer'),profile,at);
assert.equal(linked.source,'LinkedIn');assert.equal(linked.url,'https://www.linkedin.com/jobs/view/abc==');assert.equal(linked.completeness,'Job listing description');assert(linked.id.startsWith('JSEARCH-'));assert.equal(linked.sourceId,'abc==');
assert(linked.description.startsWith('Lead experimentation')&&!linked.description.includes('<p>'));assert.equal(linked.publishedAt,'2026-10-01T08:00:00.000Z');assert.equal(linked.salary,'Unknown');assert(linked.skills.includes('GA4'));assert(linked.availability.includes('open the posting to confirm'));
// A direct employer link is preferred to a job-board copy; an unusable link falls back to the next one.
const direct=mapJSearchJob(posting('d1','CRO Specialist','Synthetic brand',{job_publisher:'Indeed',job_apply_link:'https://nl.indeed.com/viewjob?jk=d1',apply_options:[{publisher:'Indeed',apply_link:'https://nl.indeed.com/viewjob?jk=d1',is_direct:false},{publisher:'Synthetic brand careers',apply_link:'https://careers.example.test/jobs/cro-specialist?utm_medium=organic',is_direct:true}],job_min_salary:4000,job_max_salary:5200,job_salary_period:'MONTH'}),profile,at);
assert.equal(direct.url,'https://careers.example.test/jobs/cro-specialist');assert.equal(direct.source,'Google Jobs');assert.equal(direct.foundOn,'Synthetic brand careers');assert.equal(direct.salary,'Source range: 4,000–5,200 per month');
assert.equal(mapJSearchJob(posting('i1','Analyst','X',{job_publisher:'Indeed',job_apply_link:'https://nl.indeed.com/viewjob?jk=i1',apply_options:[]}),profile,at).source,'Indeed');
assert.equal(mapJSearchJob(posting('f1','Analyst','X',{job_apply_link:'javascript:alert(1)',apply_options:[{publisher:'Glassdoor',apply_link:'https://www.glassdoor.nl/job-listing/f1',is_direct:false}]}),profile,at).source,'Glassdoor');
for(const bad of [null,{},posting('','T','E'),posting('n1','','E'),posting('n2','T','E',{job_apply_link:'http://insecure.example.test/a',apply_options:[]}),posting('n3','T','E',{job_description:'Too short.'})])assert.equal(mapJSearchJob(bad,profile,at),null);

// 2. One request per role search, inside a monthly budget, with only the phrase and the area sent.
const calls=[],respond=(jobs,status=200)=>async(url,init)=>{calls.push({url:new URL(url),headers:init.headers});return status===200?Response.json({status:'OK',request_id:'synthetic',parameters:{},data:{jobs:typeof jobs==='function'?jobs(calls.length):jobs}}):new Response('{}',{status});};
const config={location:'Amsterdam',distance:25,terms:[],jsearch:{apiKey:key,monthlyLimit:6,country:'nl'}},state={};
let result=await searchJSearch(config,profile,state,{fetcher:respond(n=>[posting('p'+n,'CRO Specialist '+n,'Employer '+n)]),at});
assert.equal(calls.length,JSEARCH_LIMITS.phrases);assert.equal(result.listings.length,4);assert.equal(result.source.status,'synced');assert.equal(result.source.id,'JSearch');assert.equal(state.jsearchUsage.count,4);
const first=calls[0];assert.equal(first.url.origin+first.url.pathname,JSEARCH_LIMITS.endpoint);assert.equal(first.headers['x-api-key'],key);assert(!first.url.href.includes(key));
assert.deepEqual(Object.fromEntries(first.url.searchParams),{query:'CRO specialist in Amsterdam',country:'nl',date_posted:'month',radius:'25',num_pages:'1'});assert.deepEqual(calls.map(c=>c.url.searchParams.get('query').replace(' in Amsterdam','')),profile.terms.slice(0,4));
// The next check continues with the following phrases, asks for the last week, and stops at the monthly limit.
state.jsearchLast=result.source;calls.length=0;result=await searchJSearch(config,profile,state,{fetcher:respond([posting('q1','Digital Analyst','Employer')]),at});
assert.equal(calls.length,2);assert.equal(calls[0].url.searchParams.get('query'),profile.terms[4]+' in Amsterdam');assert.equal(calls[0].url.searchParams.get('date_posted'),'week');assert.equal(state.jsearchUsage.count,6);assert.equal(result.source.status,'partial');assert(result.source.error.includes('Monthly JSearch limit of 6'));
calls.length=0;result=await searchJSearch(config,profile,state,{fetcher:respond([]),at});assert.equal(calls.length,0);assert.equal(result.source.status,'error');
// A new month starts a new budget; a rejected key stops at once and says so; an odd answer is reported, not guessed at.
calls.length=0;result=await searchJSearch(config,profile,state,{fetcher:respond([],401),at:'2026-11-01T09:00:00Z'});assert.equal(calls.length,1);assert.equal(state.jsearchUsage.month,'2026-11');assert.equal(state.jsearchUsage.count,0);assert(result.source.error.startsWith('JSearch did not accept the saved key (HTTP 401). Copy the key again'));
result=await searchJSearch(config,profile,{},{fetcher:async()=>new Response(JSON.stringify({message:'You are not subscribed to this API.'}),{status:403}),at});assert(result.source.error.includes('HTTP 403: You are not subscribed to this API.')&&result.source.error.includes('subscribed to the JSearch API'));
result=await searchJSearch(config,profile,{jsearchUsage:{month:'2026-10',count:0}},{fetcher:async()=>Response.json({status:'OK',data:[]}),at});assert.equal(result.source.status,'error');assert(result.source.error.includes('could not finish'));

// 3. Settings: the key is write-only and the budget bounded.
assert.throws(()=>saveJSearchSettings({},{apiKey:'short'}),/exactly as shown/);assert.throws(()=>saveJSearchSettings({},{}),/Enter your JSearch API key/);assert.throws(()=>saveJSearchSettings({apiKey:key},{monthlyLimit:5}),/monthly limit/);assert.throws(()=>saveJSearchSettings({apiKey:key},{country:'Netherlands'}),/two-letter/);
assert.deepEqual(saveJSearchSettings({apiKey:key},{monthlyLimit:500,country:'DE'}),{apiKey:key,monthlyLimit:500,country:'de'});assert.equal(saveJSearchSettings({apiKey:key},{remove:true}),null);
assert(!JSON.stringify(publicJSearch({jsearch:{apiKey:key}},{},at)).includes(key));

// 4. Scout: JSearch alone is a valid source; postings join the board, survive later checks, go stale, and the hourly check asks once a day.
let now=Date.parse(at),settings={state:{},boards:[],terms:['cro specialist']},requests=0,reject=false,answer=()=>[posting('s1','CRO Specialist','Synthetic retailer'),posting('s2','Experimentation Lead','Synthetic brand')];
const env={HQ_ACCESS_PASSWORD:'synthetic-owner-password',HQ_PUBLIC_ORIGIN:'https://hq.example.test'};
const scout=createScout({settings:async()=>({SCOUT_CONFIG:settings}),updateScout:async fn=>{settings=fn(settings);}},env,{cvReader:async()=>profile,fetcher:async(url,init)=>{assert(String(url).startsWith(JSEARCH_LIMITS.endpoint));assert.equal(init.headers['x-api-key'],key);requests++;if(reject)return new Response(JSON.stringify({message:'Unauthorized'}),{status:401});return Response.json({status:'OK',data:{jobs:answer()}});},boardsDefault:[],intervalMs:40,clock:()=>now});
const view=async()=>(await scout.handle(new Request('https://hq.example.test/api/scout'))).json();
const act=(action,extra={})=>scout.handle(new Request('https://hq.example.test/api/scout',{method:'POST',headers:{Origin:env.HQ_PUBLIC_ORIGIN,Host:'hq.example.test','Content-Type':'application/json'},body:JSON.stringify({action,...extra})}));
const until=async done=>{for(let i=0;i<400;i++){const v=await view();if(done(v))return v;await new Promise(r=>setTimeout(r,5));}throw new Error('Scout task did not settle');};
try{
  let v=await view();assert.equal(v.configured,false);assert.equal(v.jsearch.configured,false);assert.equal((await act('run')).status,400);
  assert.equal((await act('jsearch-settings',{apiKey:'short'})).status,400);assert.equal(requests,0);
  // A new key is tried once at save: a refusal is shown with the service's own answer and is not charged; an accepted key says so.
  reject=true;let saved=await act('jsearch-settings',{apiKey:key,monthlyLimit:190,country:'nl'}),told=await saved.json();assert.equal(saved.status,200);assert.equal(told.accepted,false);assert(told.message.includes('Key saved, but the test request failed')&&told.message.includes('HTTP 401: Unauthorized'));
  v=await view();assert.equal(v.jsearch.last.status,'error');assert.equal(v.jsearch.usedThisMonth,0);assert.equal(requests,1);
  reject=false;requests=0;saved=await act('jsearch-settings',{apiKey:key,monthlyLimit:190,country:'nl'});told=await saved.json();assert.equal(told.accepted,true);assert(told.message.includes('Key saved and accepted')&&told.message.includes('returned 2 postings'));assert.equal(requests,1);
  assert.equal((await (await act('jsearch-settings',{monthlyLimit:200})).json()).message,'JSearch settings saved.');assert.equal(requests,1);
  const raw=await (await scout.handle(new Request('https://hq.example.test/api/scout'))).text();v=JSON.parse(raw);assert(v.configured&&v.jsearch.configured&&!raw.includes(key));assert.equal(v.jsearch.usedThisMonth,1);assert.equal(v.jsearch.monthlyLimit,200);
  assert.equal((await act('run')).status,200);v=await until(s=>s.status!=='running'&&s.lastRun);
  assert.equal(requests,2);assert.equal(v.results.length,2);assert(v.results.every(j=>j.source==='LinkedIn'&&j.completeness==='Job listing description'));assert.equal(v.jsearch.usedThisMonth,2);assert.equal(v.jsearch.last.count,2);assert.deepEqual(v.jsearch.last.queries,[{term:'cro specialist',count:2,error:null}]);
  assert(v.sources.some(s=>s.id==='JSearch'&&s.status==='synced'));assert.equal(v.error,null);assert.equal(v.unscreened,2);assert(v.results.find(j=>j.title==='CRO Specialist').fit.eligible);
  // A later answer without the first posting keeps it, adds the new one, and does not repeat a job already on the board, or the same job published on two sites.
  now+=11*60*1000;answer=()=>[posting('s2','Experimentation Lead','Synthetic brand'),posting('s3','Web Analyst','Synthetic bank'),posting('s3b','Web Analyst','Synthetic bank',{job_publisher:'Indeed',job_apply_link:'https://nl.indeed.com/viewjob?jk=s3b',apply_options:[]})];
  await act('run');v=await until(s=>s.status!=='running'&&s.lastRun===new Date(now).toISOString());assert.equal(requests,3);assert.deepEqual(v.results.map(j=>j.title).sort(),['CRO Specialist','Experimentation Lead','Web Analyst']);
  // Hourly checks reuse the last answer until a day has passed.
  assert.equal((await act('start')).status,200);now+=30*60*1000;v=await until(s=>s.lastRun===new Date(now).toISOString()&&s.status!=='running');
  assert.equal(requests,3);assert(v.sources.some(s=>s.id==='JSearch'&&s.status==='synced'));assert.equal(v.results.length,3);
  now+=24*3600000;v=await until(s=>s.lastRun===new Date(now).toISOString()&&s.status!=='running');assert.equal(requests,4);
  assert.equal((await act('pause')).status,200);await until(s=>s.status!=='running');
  // Postings not seen for two weeks are marked stale; removing the key leaves them on the board.
  now+=(JSEARCH_LIMITS.staleDays+1)*86400000;answer=()=>[];assert.equal((await act('run')).status,200);v=await until(s=>s.lastRun===new Date(now).toISOString()&&s.status!=='running');assert(v.results.length===3&&v.results.every(j=>j.stale));
  assert.equal((await act('jsearch-settings',{remove:true})).status,200);v=await view();assert.equal(v.jsearch.configured,false);assert.equal(v.jsearch.last,null);assert.equal(v.results.length,3);assert(!('jsearch' in settings));
}finally{scout.close();}
console.log('JSearch source checks passed: full-text postings with cleaned links and site labels, direct employer links preferred, exact request with the key in a header only, phrase rotation, monthly budget, a refused key reported with its HTTP status and not charged, a new key tried at save, odd answers reported, write-only settings, JSearch as the only source, postings kept across checks, one hourly request a day, stale marking and key removal. Synthetic data only; the service was not contacted.');
