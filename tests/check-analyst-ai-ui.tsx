import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ScoutState} from '../app/scout';
import AnalystAssessment,{AnalystAiSettings,ModelScout,MotivationDraft,latestAssessment,type AiReview,type AiState,type Motivation} from '../app/analyst-ai';
import JSearchSettings from '../app/job-sources';

// Synthetic records only.
const at='2026-10-05T09:00:00Z',key='sk-ant-synthetic-test-key-0000000000000000';
const ai:AiState={configured:true,enabled:true,model:'claude-opus-5-5',scope:'cv',dailyLimit:20,usedToday:3,consentAt:at,models:{'claude-opus-5-5':'Claude Opus 5.5','claude-sonnet-5-5':'Claude Sonnet 5.5'},scopes:{evidence:'Retained CV evidence only',cv:'Professional CV text, contact lines removed'},version:'analyst-model-v1'};
const review:AiReview={id:'HQ-A-1',jobId:'SOURCE-1',at,model:'claude-opus-5-5',servedBy:'claude-opus-5-5',fallback:false,scope:'cv',cvReadAt:at,verdict:'plausible',summary:'A plausible match on conversion work.',
  strengths:[{requirement:'A/B testing',vacancyQuote:'Design A/B tests',cvQuote:'I run A/B tests',reasoning:'Direct evidence.'}],unverified:[{requirement:'Team leadership',reason:'The CV quote was not found in the CV material sent.'}],
  gaps:[{requirement:'Five years of experimentation',vacancyQuote:'Five years required',importance:'required',note:'No duration stated.',quoteVerified:true}],ownerChecks:['Confirm your Dutch level.'],seniority:'Senior title, duration not stated.',letter:'Dear hiring team, I improved conversion by 37%.',letterFlags:['37%'],interviewQuestions:['How is the roadmap prioritised?'],usage:{input:900,output:400,cacheRead:0,cacheWrite:0}};
const base:ScoutState={protected:true,configured:true,enabled:false,status:'idle',activeAgent:null,task:null,taskAt:null,lastRun:at,lastSuccess:at,nextCheck:null,error:null,stale:false,location:'Amsterdam',distance:25,terms:[],appId:'',profile:null,events:[],results:[]};
const panel=(state:ScoutState,locked=false)=>renderToStaticMarkup(<AnalystAssessment jobId="SOURCE-1" state={state} refresh={async()=>{}} locked={locked} onSettings={()=>{}}/>);

// Off by default: an explanation and a route to Settings, never a request button.
const off=panel(base);assert(off.includes('switched off'));assert(off.includes('Set up in Settings'));assert(!off.includes('Get a full assessment'));
assert(panel({...base,ai:{...ai,enabled:false}}).includes('switched off'));

// Enabled without a result: one clear action, with the disclosure beside it.
const ready=panel({...base,ai});assert(ready.includes('Get a full assessment'));assert(ready.includes('3 of 20 assessments used today'));assert(ready.includes('to Anthropic'));assert(ready.includes('your tracker are not changed'));

// A recorded assessment keeps model output visibly separate from checked evidence.
const state={...base,ai,aiReviews:[{...review,id:'HQ-A-0',jobId:'OTHER'},{...review,id:'HQ-A-old',verdict:'stretch' as const},review]};
assert.equal(latestAssessment(state,'SOURCE-1')?.id,'HQ-A-1');assert.equal(latestAssessment(state,'MISSING'),undefined);
const shown=panel(state);
for(const text of ['Model-based · advisory','Plausible match','Design A/B tests','I run A/B tests','1 suggested strength was discarded','Five years required','Only you can confirm','Check these figures','37%','Claude Opus 5.5','Assess again','Professional CV text, contact lines removed'])assert(shown.includes(text),text);
assert(!shown.includes('Team leadership'));assert(!/\d+\s?% (?:match|fit)/i.test(shown));
// Running, limit and failure states never offer a second request.
assert(/<button[^>]*disabled=""[^>]*>.*?Analyst is assessing/.test(panel({...state,aiRun:{startedAt:at,finishedAt:null,status:'running',requested:1,assessed:0,reused:0,skipped:0,error:null}})));
assert(/<button[^>]*disabled=""/.test(panel({...state,ai:{...ai,usedToday:20}})));assert(panel({...state,ai:{...ai,usedToday:20}}).includes('daily limit reached'));
assert(/<button[^>]*disabled=""/.test(panel(state,true)));
assert(panel({...state,aiRun:{startedAt:at,finishedAt:at,status:'failed',requested:1,assessed:0,reused:0,skipped:0,error:'Anthropic rejected the saved API key.'}}).includes('Last assessment failed: Anthropic rejected the saved API key.'));
assert(panel({...state,aiReviews:[{...review,fallback:true,servedBy:'claude-opus-4-8'}]}).includes('substitute model'));

// Strength links, the excerpt warning and the cost estimate are shown; older records without them still render.
const labelled=panel({...base,ai,aiReviews:[{...review,strengths:[{...review.strengths[0],link:'direct' as const},{...review.strengths[0],requirement:'Size guidance',link:'inferred' as const}],limited:true,vacancyChars:500,costUsd:0.0932,seconds:42}]});
for(const text of ['ai-link direct','ai-link inferred','Based on a 500-character source excerpt','Treat this verdict as provisional','About $0.09 at list prices','42 s'])assert(labelled.includes(text),text);
assert(!shown.includes('ai-link'));assert(!shown.includes('at list prices'));assert(!shown.includes('source excerpt'));
// An excerpt-only discovery offers a place to paste the full vacancy; an employer-feed description does not.
const listing={id:'SOURCE-1',sourceId:'1',title:'Synthetic analyst',employer:'Synthetic employer',location:'Amsterdam',url:'https://example.test/jobs/1',description:'x'.repeat(500),skills:[],salary:'Unknown',publishedAt:null,readAt:at,source:'Adzuna',availability:'Source listing only'};
const short=panel({...base,ai,results:[{...listing,completeness:'Aggregator excerpt'}]});
for(const text of ['Scout holds only a 500-character excerpt of this vacancy from Adzuna','Add the full vacancy text','<textarea','minLength="200"','HQ does not fetch the page','not written to your tracker','https://example.test/jobs/1'])assert(short.includes(text),text);
const pasted=panel({...base,ai,results:[{...listing,completeness:'Owner-provided full text',ownerTextAt:at,sourceExcerpt:'Short.'}]});
assert(pasted.includes('Full vacancy text provided by you'));assert(pasted.includes('not independently verified'));assert(pasted.includes('Replace the vacancy text'));assert(!pasted.includes('Scout holds only'));
assert(!panel({...base,ai,results:[{...listing,completeness:'Employer feed description'}]}).includes('<textarea'));assert(!panel({...base,results:[{...listing,completeness:'Aggregator excerpt'}]}).includes('<textarea'));

// Today: one Find jobs action searches and screens; this bar shows that work is running, then what it did.
const bar=(state:ScoutState,locked=false)=>renderToStaticMarkup(<ModelScout state={state} refresh={async()=>{}} locked={locked} onSettings={()=>{}}/>);
const live={...ai,consentCurrent:true};
assert.equal(bar({...base,protected:false,ai:live}),'');
assert(bar(base).includes('needs the model connection')&&bar(base).includes('Open Settings'));assert(!bar(base).includes('subtle-button'));
assert(bar({...base,ai}).includes('confirm the model connection once in Settings'));
// Nothing waiting: no second button, only what Find jobs does and what it costs.
const idle=bar({...base,ai:live,unscreened:0});assert(idle.includes('Find jobs searches your sources, then the Analyst screens what is new against your CV'));assert(idle.includes('paid model request'));assert(!idle.includes('<button'));assert(!/web search/i.test(idle));
// Discoveries the hourly check found can be screened without another search.
const offered=bar({...base,ai:live,unscreened:4});assert(offered.includes('Screen 4 waiting by my CV')&&offered.includes('Found by the hourly check'));assert(!offered.includes('disabled=""'));assert(bar({...base,ai:live,unscreened:4},true).includes('disabled=""'));
const limited=bar({...base,ai:{...live,usedToday:20},unscreened:1});assert(limited.includes('disabled=""')&&limited.includes('daily limit for model requests is reached'));
// While work runs there is a visible, announced progress state with the current step and task, and no button to press twice.
const searching=bar({...base,ai:live,unscreened:4,status:'running',task:'Check configured vacancy sources near Amsterdam'});
for(const text of ['class="scout-progress"','role="status"','aria-live="polite"','scout-progress-bar','<li class="active"><span>1</span>Searching your sources','Screening by your CV','Check configured vacancy sources near Amsterdam','This can take a few minutes','the work carries on'])assert(searching.includes(text),text);assert(!searching.includes('<button'));
const screeningNow=bar({...base,ai:live,status:'running',task:'Screen recorded discoveries against the linked CV',triageRun:{startedAt:at,finishedAt:null,status:'running',error:null}});assert(screeningNow.includes('<li class="done">')&&screeningNow.includes('<li class="active"><span>2</span>Screening by your CV'));
const assessingNow=bar({...base,ai:live,status:'running',task:'Model-based assessment: Synthetic employer / Analyst',aiRun:{startedAt:at,finishedAt:null,status:'running',requested:1,assessed:0,reused:0,skipped:0,error:null}});assert(assessingNow.includes('Model-based assessment: Synthetic employer / Analyst')&&!assessingNow.includes('<ol>'));
assert(!bar({...base,ai:live,status:'running',connectionError:'Execution connection unavailable'}).includes('scout-progress'));
// Afterwards: what the search added and what the screening decided.
const after=bar({...base,ai:live,runSummary:{at,added:30,total:134,sources:6,failed:1},triageRun:{startedAt:at,finishedAt:at,status:'completed',error:'Daily limit of 3 model requests reached; 60 discoveries were not screened.',screened:60,relevant:7,possible:9,unrelated:44,missed:0,costUsd:0.2}});
for(const text of ['30 new discoveries, 134 on your board','1 of 6 sources could not be read','60 judged against your CV, 7 relevant, 9 possible, 44 unrelated','about $0.20 in tokens at list prices','Daily limit of 3 model requests reached'])assert(after.includes(text),text);
assert(bar({...base,ai:live,runSummary:{at,added:1,total:5,sources:2,failed:0}}).includes('1 new discovery, 5 on your board.'));
assert(bar({...base,ai:live,triageRun:{startedAt:at,finishedAt:at,status:'failed',error:'Anthropic could not be reached.'}}).includes('Last screening failed: Anthropic could not be reached.'));

// The Google for Jobs source keeps its key write-only and shows its budget and what the service answered.
const source=(state:ScoutState)=>renderToStaticMarkup(<JSearchSettings state={state} refresh={async()=>{}}/>);
const empty=source(base);for(const text of ['Google for Jobs · JSearch','Key needed','LinkedIn, Indeed, Glassdoor','your CV is not','type="password"','Enter directly here; never in chat','200 requests a month','openwebninja.com/api/jsearch'])assert(empty.includes(text),text);assert(!empty.includes('Remove key'));
const connected=source({...base,jsearch:{configured:true,monthlyLimit:190,country:'nl',usedThisMonth:12,last:{status:'partial',at,count:17,error:'Monthly JSearch limit of 190 requests reached; saved discoveries are retained.',queries:[{term:'cro specialist',count:10,error:null},{term:'web analyst',count:0,error:'JSearch unavailable (HTTP 500).'}]}}});
for(const text of ['Key saved','Saved · leave blank to keep','12 of 190 requests used this month','Remove key','17 postings','needs attention','cro specialist · 10 returned postings','web analyst · JSearch unavailable (HTTP 500).'])assert(connected.includes(text),text);assert(!connected.includes('synthetic-jsearch-key'));
assert(source({...base,protected:false}).includes('disabled=""'));

// Settings: write-only key, explicit scope and a plain statement of what leaves the server.
const settings=renderToStaticMarkup(<AnalystAiSettings state={{...base,ai}} refresh={async()=>{}}/>);
for(const text of ['Anthropic API key','type="password"','Saved · leave blank to keep','CV material that may be sent','sent to Anthropic','Daily limit','an assessment or a screening','CV screening &amp; assessments','Tick the consent line and save once more','billed separately','Nothing is sent while this is off'])assert(settings.includes(text),text);
assert(!renderToStaticMarkup(<AnalystAiSettings state={{...base,ai:live}} refresh={async()=>{}}/>).includes('save once more'));
assert(!settings.includes(key));assert(!settings.includes('sk-ant-'));
const first=renderToStaticMarkup(<AnalystAiSettings state={base} refresh={async()=>{}}/>);assert(first.includes('Not connected'));assert(first.includes('Enter directly here; never in chat'));
assert(renderToStaticMarkup(<AnalystAiSettings state={{...base,protected:false}} refresh={async()=>{}}/>).includes('disabled=""'));
const whole=settings+renderToStaticMarkup(<AnalystAiSettings state={{...base,ai:live}} refresh={async()=>{}}/>);assert(!/web search|Web searches/i.test(whole));
// The motivation panel: what is sent is stated before the first request, a draft shows its sources and which facts it used, and an unidentified employer is said plainly.
{
  const show=(s:ScoutState,locked=false)=>renderToStaticMarkup(<MotivationDraft jobId="SOURCE-1" state={s} refresh={async()=>{}} locked={locked} onSettings={()=>{}}/>);
  const ready={...state,ai:{...ai,enabled:true,consentCurrent:true}};const empty=show(ready);assert(empty.includes('Research the employer &amp; draft a motivation')&&empty.includes('employer name, role and location only')&&empty.includes('two of your daily model requests'));
  const draft:Motivation={id:'HQ-M-1',jobId:'SOURCE-1',at,model:'claude-opus-5-5',scope:'evidence',company:{identified:true,about:'Sells shoes online.',facts:[{fact:'Runs a webshop in three countries.',source:'https://syntheticretail.test/about'},{fact:'Opened a warehouse.',source:'https://news.example.test/w'}]},language:'English',motivation:'Synthetic motivation sentence about the webshop.',angles:['GA4 dashboards'],avoid:['Team leadership'],usedFacts:[1],searches:3,costUsd:.08,excerpt:false};
  const filled=show({...ready,motivations:[draft]});assert(filled.includes('Synthetic motivation sentence')&&filled.includes('https://syntheticretail.test/about')&&filled.includes('used in the draft')&&filled.includes('What to emphasise')&&filled.includes('Do not claim')&&filled.includes('3 web searches')&&filled.includes('$0.08'));assert.equal(filled.split('used in the draft').length-1,1);
  assert(show({...ready,motivations:[{...draft,company:{identified:false,about:'',facts:[]},usedFacts:[]}]}).includes('could not identify this employer'));
  assert(!show({...ready,motivations:[{...draft,jobId:'OTHER'}]}).includes('Synthetic motivation sentence'));
  assert(show({...ready,ai:{...ai,enabled:false}}).includes('Connect the model in Settings'));
}
console.log('Model-based Analyst UI checks passed: motivation panel, no web search left, strength links, excerpt warning, pasted vacancy text, cost estimate, off by default, disclosed request, checked evidence shown, discarded claims and flagged figures surfaced, no fit percentage, guarded running / limit / failure states and write-only settings. Synthetic data only.');
