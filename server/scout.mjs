import {randomUUID,createHash} from 'node:crypto';
import {readCv,readCvMaterial,overlap} from './cv-reader.mjs';
import {defaultBoards,parseBoards,boardText,readBoard,importedListing,canonical} from './sources.mjs';
import {buildWorkflow,fingerprint,sendRecord,appendWorkflow} from './workflow.mjs';
import {reviewPdf} from './report.mjs';
import {SEARCH_LIMITS,searchAdzuna,searchTerms} from './search-plan.mjs';
import {saveFeedback,feedbackKey} from './owner-feedback.mjs';
import {savePlanningStatus} from './owner-status.mjs';
import {assessMatch,focusLabels,MATCH_VERSION,REVIEW_LIMIT} from './matching.mjs';
import {AI_LIMITS,VERDICTS,aiFingerprint,assessJob,bundledCall,cvMaterial,estimateCost,publicAi,route,saveAiSettings} from './analyst-ai.mjs';
import {JSEARCH_LIMITS,searchJSearch,checkJSearchKey,saveJSearchSettings,publicJSearch} from './jsearch.mjs';
import {MOTIVATION_LIMITS,draftMotivation} from './motivation.mjs';
import {proposeFields} from './cv-fields.mjs';
import {tailorCv} from './cv-tailor.mjs';
import {SCREEN_LIMITS,TRIAGE_SCHEMA,TRIAGE_SYSTEM,basis,fitKey,triageRequest,triageVerdicts} from './cv-screening.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
// The full state is several megabytes. A page that already holds the current version gets only the few fields that change while a task runs.
const LIVE_FIELDS=['status','activeAgent','task','taskAt','taskContext','nextCheck'];
const liveOf=body=>Object.fromEntries(LIVE_FIELDS.map(key=>[key,body[key]??null]));
export function versionOf(body){const stable={...body};for(const key of LIVE_FIELDS)delete stable[key];return createHash('sha1').update(JSON.stringify(stable)).digest('hex').slice(0,16);}
export function versioned(since,body,version=versionOf(body)){return since&&since===version?json({unchanged:true,version,...liveOf(body)}):json({...body,version});}
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,' ').replace(/\s+/g,' ').trim();
const period=60*60*1000;
function safeListing(value){try{const u=new URL(value);if(u.protocol!=='https:'&&u.protocol!=='http:')return '';if(!/(^|\.)adzuna\.(nl|com|co\.uk)$/.test(u.hostname))return '';u.protocol='https:';u.username='';u.password='';u.searchParams.delete('app_id');u.searchParams.delete('app_key');return u.href;}catch{return '';}}
export function mapListing(item,profile,readAt){
  if(!item.id||!item.title||!safeListing(item.redirect_url))return null;
  const description=plain(item.description),skills=overlap(profile.skills,item.title+' '+description),salary=[item.salary_min,item.salary_max].filter(x=>Number.isFinite(x)&&x>0);
  return {id:'ADZUNA-'+item.id,sourceId:String(item.id),originalPostingId:String(item.id),title:plain(item.title),employer:plain(item.company?.display_name)||'Not supplied',location:plain(item.location?.display_name)||'Not supplied',url:safeListing(item.redirect_url),description,skills,salary:salary.length?(String(item.salary_is_predicted)==='1'?'Adzuna estimate: ':'Source range: ')+salary.map(n=>n.toLocaleString('en-GB')).join('–')+' · currency / period not supplied':'Unknown',publishedAt:item.created||null,readAt,source:'Adzuna',availability:'Present in source response; employer availability unverified'};
}
export function createScout(connections,environment,{fetcher=fetch,cvReader=readCv,cvMaterialReader=readCvMaterial,modelCall,triageCall=bundledCall('requestTriage'),researchCall=bundledCall('requestCompanyResearch'),motivationCall=bundledCall('requestMotivation'),profileCall=bundledCall('requestProfile'),tailorCall=bundledCall('requestTailoredCv'),cvStore=null,profileStore=null,clock=Date.now,intervalMs=period,boardsDefault=defaultBoards}={}){
  let state={enabled:false,status:'not-connected',activeAgent:null,task:null,taskAt:null,taskContext:null,lastRun:null,lastSuccess:null,nextCheck:null,error:null,stale:false,profile:null,results:[],events:[],attempts:0,day:'',sources:[],workflows:[],workflowNotice:null,reviewRun:null,aiReviews:[],aiUsage:{day:'',count:0},aiRun:null,motivations:[],motivationRun:null,ownerTexts:{},modelFits:{},triageRun:null,jsearchUsage:{month:'',count:0},jsearchCursor:0,jsearchLast:null,jsearchAt:null},timer=null,running=false,closed=false;
  // Building the full view (screening every discovery, serialising megabytes) is slow, so it is kept until the state changes: a task step, a saved change, or a minute passing.
  let revision=0,held=null;const touch=()=>{revision++;};
  const event=(agentId,type,details,handoff)=>{touch();const item={id:'HQ-E-'+randomUUID(),date:new Date(clock()).toISOString(),agentId,type,details,source:'Private HQ task runner',...(handoff?{handoff}:{})};state.events=[...state.events.slice(-79),item];return item;};
  const mark=(agentId,task,context=null)=>{state.taskContext=context;state.activeAgent=agentId;state.task=task;state.taskAt=new Date(clock()).toISOString();event(agentId,'Task started',task);};
  const fitFor=job=>assessMatch(job,state.profile);
  // Text the owner pasted for a vacancy outlives later source checks, which only return the excerpt again.
  const textKey=job=>canonical(job.url)||job.id;
  // A model verdict belongs to the vacancy, not to one source read, so it is kept beside the results and re-applied.
  const withModelFit=job=>{const kept=state.modelFits[fitKey(job)];return kept?{...job,modelFit:kept.fit}:job;};
  const needsScreening=job=>state.modelFits[fitKey(job)]?.basis!==basis(job);
  const keepFit=(job,fit)=>{state.modelFits={...state.modelFits,[fitKey(job)]:{basis:basis(job),fit}};};
  const idle=()=>{touch();running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;state.status=state.enabled?'waiting':'idle';schedule();};
  const withOwnerText=job=>{const own=state.ownerTexts[textKey(job)];return own&&job.description!==own.text?{...job,description:own.text,sourceExcerpt:job.sourceExcerpt??job.description,completeness:'Owner-provided full text',ownerTextAt:own.at,skills:state.profile?overlap(state.profile.skills,job.title+' '+own.text):job.skills}:job;};
  const matchView=()=>{const results=state.results.map(j=>({...j,fit:fitFor(j)})).sort((a,b)=>b.fit.priority-a.fit.priority||b.fit.coreSkills.length-a.fit.coreSkills.length),latest=new Map();for(const w of state.workflows)latest.set(w.job.id,w.id);return {results,workflows:state.workflows.map(w=>({...w,currentFit:fitFor(w.job),currentRules:!!state.profile&&w.fingerprint===fingerprint(w.job,state.profile),superseded:latest.get(w.job.id)!==w.id})),matching:{version:MATCH_VERSION,cvReadAt:state.profile?.readAt||null,focus:focusLabels(state.profile),recommended:results.filter(j=>j.fit.eligible).length,held:results.filter(j=>!j.fit.eligible).length}};};
  const persist=async()=>{touch();await connections.updateScout(current=>({...current,state:{...state,activeAgent:null,task:null,taskAt:null,taskContext:null,status:state.enabled?'waiting':state.status,nextCheck:null},enabled:state.enabled}));};
  const schedule=()=>{clearTimeout(timer);if(state.enabled&&!closed){state.nextCheck=new Date(clock()+intervalMs).toISOString();timer=setTimeout(()=>{if(running){schedule();return;}run('hourly').catch(error=>{state.status='error';state.error=error.message;schedule();});},intervalMs);timer.unref?.();}else state.nextCheck=null;};
  const ready=connections.settings().then(settings=>{if(!environment.HQ_ACCESS_PASSWORD)return;const saved=settings.SCOUT_CONFIG||{};if(saved.state)state={...state,...saved.state,activeAgent:null,task:null,taskAt:null,taskContext:null};state.enabled=!!saved.enabled;state.status=state.enabled?'waiting':state.lastRun?'paused':'not-connected';schedule();}).catch(()=>{state.error='Private Scout settings could not be read.';});
  async function run(mode='manual'){
    if(running)throw new Error('A Scout check is already running.');
    running=true;
    try{
    const settings=await connections.settings(),config=settings.SCOUT_CONFIG||{};
    const boards=config.boards??boardsDefault;if(!(config.appId&&config.appKey)&&!boards.length&&!config.jsearch?.apiKey)throw new Error('Configure Adzuna, JSearch or an employer job board first.');

    if(state.lastRun&&clock()-Date.parse(state.lastRun)<10*60*1000)throw new Error('Wait ten minutes between manual source checks.');
    const day=new Date(clock()).toISOString().slice(0,10);if(state.day!==day){state.day=day;state.attempts=0;}
    running=true;state.status='running';state.error=null;state.lastRun=new Date(clock()).toISOString();state.nextCheck=null;
      mark('01','Read the linked CV privately');
      const profile=await cvReader(settings,fetcher);state.profile=profile;event('01','Task completed','CV read verified; search terms, skill names and bounded professional evidence retained privately.');
      const terms=searchTerms(config,profile);if(!terms.length)throw new Error('No supported role keywords were found in this CV. Enter up to six role searches in Scout settings.');
      const listings=new Map(),at=new Date(clock()).toISOString(),sources=[],errors=[];mark('01','Check configured vacancy sources near '+(config.location||''));
      if(config.appId&&config.appKey){const result=await searchAdzuna(config,profile,state,{fetcher,mode,at});for(const item of result.listings)listings.set(String(item.id),item);sources.push(result.source);state.coverage=result.coverage;if(result.source.error)errors.push(result.source.error);}
      const fresh=[...listings.values()].map(item=>mapListing(item,profile,at)).filter(Boolean).map(j=>({...j,completeness:'Aggregator excerpt',stale:false}));
      if(config.jsearch?.apiKey){
        // A request budget per month: every manual check, and at most one hourly check a day.
        if(mode!=='hourly'||!state.jsearchAt||clock()-Date.parse(state.jsearchAt)>JSEARCH_LIMITS.dailyHours*3600000){
          const result=await searchJSearch(config,{...profile,terms},state,{fetcher,at}),sameJob=j=>(j.employer+'|'+j.title).toLowerCase().replace(/\s+/g,' '),returned=new Set(result.listings.map(j=>j.id)),known=new Set(state.results.filter(j=>!j.stale&&!returned.has(j.id)).map(sameJob));
          // The same vacancy published on two sites arrives as two postings; keep the first.
          fresh.push(...result.listings.filter(j=>{const same=sameJob(j);if(known.has(same))return false;known.add(same);return true;}));state.jsearchLast={...result.source,queries:result.queries};state.jsearchAt=at;sources.push(result.source);if(result.source.error)errors.push(result.source.error);
        }else if(state.jsearchLast)sources.push({...state.jsearchLast,queries:undefined});
      }
      const boardResults=await Promise.allSettled(boards.map(b=>readBoard(b,{...profile,terms},config.location||'',fetcher,at)));
      boardResults.forEach((r,i)=>{const b=boards[i],id=b.provider+':'+b.board;if(r.status==='fulfilled'){fresh.push(...r.value);sources.push({id,source:b.employer+' / '+b.provider,status:'synced',at,count:r.value.length,error:null});}else{const error='Cannot read '+b.employer+' feed: '+r.reason.message;errors.push(error);sources.push({id,source:b.employer+' / '+b.provider,status:'error',at,count:0,error});}});
      state.sources=sources;
      if(!sources.some(s=>s.status==='synced'||s.status==='partial'))throw new Error(errors.join(' ')||'No source responded successfully.');
      const failedSource=j=>j.source==='Adzuna'?sources.some(s=>s.id==='Adzuna'&&s.status!=='synced'):sources.some(s=>s.id.endsWith(':'+j.board)&&s.status==='error');
      const retained=state.results.filter(j=>j.source==='Adzuna'||failedSource(j)||['LinkedIn','Indeed','Glassdoor','Google Jobs','Owner import'].includes(j.source)).map(j=>failedSource(j)||j.source==='Adzuna'&&clock()-Date.parse(j.readAt)>7*86400000||j.completeness==='Job listing description'&&clock()-Date.parse(j.readAt)>JSEARCH_LIMITS.staleDays*86400000?{...j,stale:true}:j);
      const unique=new Map();for(const job of [...fresh,...retained].sort((a,b)=>fitFor(b).priority-fitFor(a).priority||b.readAt.localeCompare(a.readAt))){const key=canonical(job.url)||job.id;if(!unique.has(key))unique.set(key,job);}
      const before=new Set(state.results.map(j=>j.id));
      // A discovery the owner deleted from the archive is not taken in again when a source still lists it.
      state.results=[...unique.values()].filter(j=>!(config.dismissed||{})[feedbackKey(j)]).slice(0,SEARCH_LIMITS.storedResults).map(withOwnerText).map(withModelFit);
      state.runSummary={at,added:state.results.filter(j=>!before.has(j.id)).length,total:state.results.length,sources:sources.length,failed:sources.filter(s=>s.status==='error').length};
      event('01','Task completed',fresh.length+' source suggestions received; '+errors.length+' source errors. See each source timestamp.');
      prepareWorkflows(state.results.filter(j=>!j.stale),profile);
      state.lastSuccess=at;state.stale=errors.length>0;state.status=state.enabled?'waiting':'idle';state.error=errors.length?errors.join(' '):null;
    }catch(error){state.status='error';state.stale=!!state.lastSuccess;state.error=error instanceof Error?error.message:'Scout could not complete this check.';event(state.activeAgent||'01','Task failed',state.error);}
    finally{running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;schedule();try{await persist();}catch{state.error='The check finished, but private Scout history could not be saved.';}}
  }
  function prepareWorkflows(jobs,profile){
    state.workflowNotice=null;
    for(const job of jobs){if(state.workflows.some(w=>w.fingerprint===fingerprint(job,profile)))continue;if(state.workflows.length>=REVIEW_LIMIT){state.workflowNotice='The private workbench holds '+REVIEW_LIMIT+' review versions. Existing evidence is retained; use the remaining current reviews before preparing more.';break;}
      state.workflows.push(buildWorkflow(job,profile,{clock,mark,event}));}
  }
  async function reviewExisting(jobs){
    const startedAt=new Date(clock()).toISOString(),before=state.workflows.length;
    state.reviewRun={startedAt,finishedAt:null,status:'running',prepared:0,held:0,unchanged:0,error:null};
    try{
      mark('02','Read the linked CV and review recorded Scout discoveries');
      const profile=await cvReader(await connections.settings(),fetcher);state.profile=profile;
      event('02','Task completed','CV read verified for existing discoveries. Vacancy sources were not queried again.');
      prepareWorkflows(jobs,profile);
      const created=state.workflows.slice(before);
      state.reviewRun={startedAt,finishedAt:new Date(clock()).toISOString(),status:'completed',prepared:created.length,held:created.filter(w=>!w.draft).length,unchanged:jobs.filter(j=>state.workflows.slice(0,before).some(w=>w.fingerprint===fingerprint(j,profile))).length,error:null};
      event('00','Review batch completed',created.length+' new review versions recorded; '+state.reviewRun.held+' Analyst holds; '+state.reviewRun.unchanged+' unchanged versions retained. No tracker write or application performed.');
    }catch(error){
      const message=error instanceof Error?error.message:'Review could not finish.';
      state.reviewRun={...state.reviewRun,finishedAt:new Date(clock()).toISOString(),status:'failed',error:message};state.error=message;
      event(state.activeAgent||'02','Task failed',message);
    }finally{
      running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;state.status=state.reviewRun.status==='failed'?'error':state.enabled?'waiting':'idle';schedule();
      try{await persist();}catch{state.error='Reviews finished, but their private history could not be saved. Previous saved evidence is retained.';state.reviewRun={...state.reviewRun,status:'failed',error:state.error};}
    }
  }
  // A model task reads the CV once, sends the owner's chosen material and never writes to the tracker.
  async function modelTask(agentId,title,slot,work){
    const startedAt=new Date(clock()).toISOString();state[slot]={startedAt,finishedAt:null,status:'running',error:null};
    try{
      mark(agentId,title);
      const settings=await connections.settings(),ai=(settings.SCOUT_CONFIG||{}).ai||{},{profile,text}=await cvMaterialReader(settings,fetcher);state.profile=profile;
      const outcome=await work({ai,config:settings.SCOUT_CONFIG||{},profile,material:cvMaterial(profile,text,ai.scope),at:startedAt});
      state[slot]={...state[slot],...outcome,finishedAt:new Date(clock()).toISOString(),status:'completed'};
    }catch(error){
      const message=error instanceof Error?error.message:'The task could not finish.';
      state[slot]={...state[slot],finishedAt:new Date(clock()).toISOString(),status:'failed',error:message};
      event(state.activeAgent||agentId,'Task failed',message);
    }finally{
      idle();
      try{await persist();}catch{state[slot]={...state[slot],status:'failed',error:'The task finished, but its private record could not be saved.'};}
    }
  }
  const screenExisting=jobs=>modelTask('02','Screen recorded discoveries against the linked CV','triageRun',async({ai,profile,material,at})=>{
    const day=at.slice(0,10),limit=ai.dailyLimit||AI_LIMITS.dailyDefault;if(state.aiUsage.day!==day)state.aiUsage={day,count:0};
    const tally={relevant:0,possible:0,unrelated:0},usage={input:0,output:0,cacheRead:0,cacheWrite:0},matched=[];let screened=0,missed=0,skipped=0,servedBy=ai.model;
    for(let start=0;start<jobs.length;start+=SCREEN_LIMITS.batch){
      const batch=jobs.slice(start,start+SCREEN_LIMITS.batch);if(state.aiUsage.count>=limit){skipped+=batch.length;continue;}
      state.aiUsage.count++;
      let result;try{result=await triageCall({apiKey:ai.apiKey,model:ai.model,...route(ai),system:TRIAGE_SYSTEM,cvMaterial:'<cv_material scope="'+material.scope+'">\n'+material.text+'\n</cv_material>',listings:triageRequest(batch),schema:TRIAGE_SCHEMA,fetcher});}catch(error){if(error.billed===false)state.aiUsage.count--;throw error;}
      servedBy=result.servedBy||ai.model;for(const key of Object.keys(usage))usage[key]+=result.usage?.[key]||0;
      let raw;try{raw=JSON.parse(result.text);}catch{throw new Error('The model returned an unreadable screening. Nothing was recorded for this batch.');}
      const verdicts=triageVerdicts(raw,batch,servedBy,at);missed+=batch.length-verdicts.size;
      for(const [job,fit] of verdicts){keepFit(job,fit);tally[fit.fit]++;screened++;if(fit.fit!=='unrelated')matched.push(job.id);}
    }
    state.results=state.results.map(withModelFit);
    const worthReview=state.results.filter(j=>matched.includes(j.id));if(worthReview.length)prepareWorkflows(worthReview,profile);
    event('02','Task completed','Model screening: '+screened+' discoveries judged against the CV ('+tally.relevant+' relevant, '+tally.possible+' possible, '+tally.unrelated+' unrelated)'+(missed?'; '+missed+' left without a verdict':'')+(skipped?'; '+skipped+' not sent because the daily limit was reached':'')+'. Requirement conflicts still hold a job. No tracker write.');
    return {requested:jobs.length,screened,...tally,missed,skipped,model:servedBy,usage,costUsd:estimateCost(servedBy,usage),error:skipped?'Daily limit of '+limit+' model requests reached; '+skipped+' discoveries were not screened.':null};
  });
  // Starts screening of what is waiting, or says why it will not: 'off', 'none', 'limit' or 'busy'.
  async function beginScreening(chained=false){
    const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{},view=publicAi(ai,state.aiUsage,new Date(clock()).toISOString().slice(0,10));
    if(!view.enabled||!view.consentCurrent)return 'off';
    const jobs=state.results.filter(j=>!j.stale&&needsScreening(j)).slice(0,SCREEN_LIMITS.perRun);if(!jobs.length)return 'none';
    if(view.usedToday>=view.dailyLimit)return 'limit';if(running)return 'busy';
    // After a source check, keep any source error on screen while the screening runs.
    running=true;state.status='running';if(!chained)state.error=null;state.nextCheck=null;clearTimeout(timer);
    screenExisting(jobs).catch(()=>{idle();state.status='error';state.error='The model task stopped unexpectedly.';});
    return null;
  }
  async function assessExisting(jobs,ai,force){
    const startedAt=new Date(clock()).toISOString();
    state.aiRun={startedAt,finishedAt:null,status:'running',requested:jobs.length,assessed:0,reused:0,skipped:0,error:null};
    try{
      mark('02','Read the linked CV for a model-based assessment');
      const {profile,text}=await cvMaterialReader(await connections.settings(),fetcher);state.profile=profile;
      const material=cvMaterial(profile,text,ai.scope),day=startedAt.slice(0,10),limit=ai.dailyLimit||AI_LIMITS.dailyDefault;
      if(state.aiUsage.day!==day)state.aiUsage={day,count:0};
      for(const job of jobs){
        const print=aiFingerprint(job,material,ai.model);
        if(!force&&state.aiReviews.some(r=>r.fingerprint===print)){state.aiRun.reused++;continue;}
        if(state.aiUsage.count>=limit||state.aiReviews.length>=AI_LIMITS.stored){state.aiRun.skipped++;continue;}
        mark('02','Model-based assessment: '+job.employer+' / '+job.title,{workflowId:null,jobId:job.id});
        state.aiUsage.count++;
        let review;try{review=await assessJob({job,profile,material,model:ai.model,apiKey:ai.apiKey,...route(ai),call:modelCall,fetcher,clock});}catch(error){if(error.billed===false)state.aiUsage.count--;throw error;}
        state.aiReviews.push(review);state.aiRun.assessed++;
        event('02','Task completed',job.employer+' / '+job.title+': model-based assessment recorded ('+VERDICTS[review.verdict]+'; '+review.strengths.length+' quote-checked strengths, '+review.unverified.length+' discarded). Advisory only; CV screening and the tracker are unchanged.');
      }
      state.aiRun={...state.aiRun,finishedAt:new Date(clock()).toISOString(),status:'completed',error:state.aiRun.skipped?(state.aiReviews.length>=AI_LIMITS.stored?'The private workbench holds '+AI_LIMITS.stored+' assessments; earlier ones are retained and no more were requested.':'Daily limit of '+limit+' assessments reached; '+state.aiRun.skipped+' not requested.'):null};
    }catch(error){
      const message=error instanceof Error?error.message:'The assessment could not finish.';
      state.aiRun={...state.aiRun,finishedAt:new Date(clock()).toISOString(),status:'failed',error:message};
      event(state.activeAgent||'02','Task failed',message);
    }finally{
      running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;state.status=state.enabled?'waiting':'idle';schedule();
      try{await persist();}catch{state.aiRun={...state.aiRun,status:'failed',error:'The assessment finished, but its private record could not be saved.'};}
    }
  }
  return {
    async handle(request){
      await ready;
      if(!environment.HQ_ACCESS_PASSWORD)return json({protected:false,configured:false,...state,error:'Owner sign-in is required to configure real scouting.'},request.method==='GET'?200:403);
      if(request.method==='GET'){const config=(await connections.settings()).SCOUT_CONFIG||{};if(new URL(request.url).searchParams.get('report')==='pdf')return new Response(reviewPdf(matchView().workflows.filter(w=>!w.superseded),new Date(clock()).toISOString()),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="job-hunt-hq-review.pdf"','Cache-Control':'private, no-store'}});const since=new URL(request.url).searchParams.get('since'),key=revision+'|'+createHash('sha1').update(JSON.stringify({...config,state:undefined})).digest('hex')+'|'+new Date(clock()).toISOString().slice(0,10);if(held&&held.key===key&&clock()-held.at<(running?4000:60000)){if(since===held.version)return json({unchanged:true,version:held.version,...liveOf(state)});return versioned(since,{...held.body,...liveOf(state)},held.version);}const view=matchView(),body={...state,...view,ownerTexts:undefined,modelFits:undefined,unscreened:state.results.filter(j=>!j.stale&&needsScreening(j)).length,aiReviews:state.aiReviews.map(r=>r.costUsd===undefined?{...r,costUsd:estimateCost(r.servedBy,r.usage)}:r),ai:publicAi(config.ai,state.aiUsage,new Date(clock()).toISOString().slice(0,10)),webRun:undefined,webUsage:undefined,ownerFeedback:config.ownerFeedback||{},sameAs:Array.isArray(config.sameAs)?config.sameAs:[],ownerStatuses:config.ownerStatuses||{},interviewDates:config.interviewDates||{},searchLimits:SEARCH_LIMITS,protected:true,jsearch:publicJSearch(config,state,new Date(clock()).toISOString()),configured:!!(config.appId&&config.appKey)||!!config.jsearch?.apiKey||(config.boards??boardsDefault).length>0,adzunaConfigured:!!(config.appId&&config.appKey),boards:boardText(config.boards??boardsDefault),location:config.location||'',country:config.country||'',distance:config.distance||25,terms:config.terms||[],appId:config.appId||''};held={key,at:clock(),body,version:versionOf(body)};return versioned(since,body,held.version);}
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON content required'},415);
      try{
        const origin=new URL(request.headers.get('origin'));if(origin.origin!==new URL(environment.HQ_PUBLIC_ORIGIN||request.url).origin||origin.host!==request.headers.get('host'))throw new Error('Scout changes require a same-origin request.');
        const body=await request.json();touch();
        if(body.action==='interview-date'){
          // The interview's own date, kept privately in HQ beside the tracker record. It changes nothing in the database, so it also works for a job that is already in Interview.
          if(!/^JOB-\d{3,8}$/.test(body.recordId||''))throw new Error('Select a tracked job.');
          const date=String(body.date||''),time=String(body.time||'');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)||time&&!/^\d{2}:\d{2}$/.test(time)||time&&!date)throw new Error('Enter the interview date as a calendar date, with an optional time.');
          await connections.updateScout(c=>{const dates={...(c.interviewDates||{})};if(date)dates[body.recordId]={date,time,at:new Date(clock()).toISOString()};else delete dates[body.recordId];const keys=Object.keys(dates);for(const key of keys.slice(0,Math.max(0,keys.length-300)))delete dates[key];return {...c,interviewDates:dates};});
          return json({saved:true,message:date?'Interview date saved in HQ. Your tracker is unchanged.':'Interview date removed from HQ.'});
        }
        if(body.action==='archive-unrelated'){
          // Puts aside, in one confirmed step, the discoveries the page lists that screening judged unrelated. It is the same private "not a fit" preference as archiving one by one: reversible, and nothing is written to your tracker.
          if(running)throw new Error('Wait for the current task before archiving.');
          if(body.confirm!==true||!Array.isArray(body.jobIds)||!body.jobIds.length||body.jobIds.length>600)throw new Error('Confirm which screened discoveries to archive.');
          // A discovery that has left its source lives on only in its saved review; those count too.
          const wanted=new Set(body.jobIds.map(String)),known=new Map([...state.workflows.filter(w=>!w.superseded).map(w=>[w.job.id,w.job]),...state.results.map(j=>[j.id,j])]),jobs=[...known.values()].filter(j=>wanted.has(j.id)&&fitFor(j).label==='Screened as unrelated'),at=new Date(clock()).toISOString();let moved=0,full=false;
          await connections.updateScout(c=>{let config=c;moved=0;for(const job of jobs){const old=(config.ownerFeedback||{})[feedbackKey(job)];if(old?.decision==='not-fit')continue;try{config=saveFeedback(config,job,{decision:'not-fit',reason:'Screened as unrelated by the Analyst · archived together',requestId:'HQ-F-'+randomUUID(),expectedId:old?.id||''},at).config;moved++;}catch{full=true;break;}}return config;});
          return json({saved:true,moved,message:moved+' discover'+(moved===1?'y':'ies')+' moved to Archive. Your tracker and the screening are unchanged; Restore brings one back.'+(full?' The private list is full, so the rest were left.':'')});
        }
        if(body.action==='prune-reviews'){
          // Deletes replaced review versions for good. Each discovery keeps its newest review, and any review that was saved to your tracker keeps its record. Only the owner starts this, with an explicit confirmation.
          if(running)throw new Error('Wait for the current task before removing old reviews.');
          if(body.confirm!==true)throw new Error('Confirm that the old review versions may be deleted.');
          const latest=new Map();for(const w of state.workflows)latest.set(w.job.id,w.id);
          const before=state.workflows.length;state.workflows=state.workflows.filter(w=>latest.get(w.job.id)===w.id||!!w.tracker);const removed=before-state.workflows.length;
          if(removed){event('02','Task completed','Owner removed '+removed+' replaced review versions from the private workbench; '+state.workflows.length+' current reviews are kept. Your tracker is unchanged.');await persist();}
          return json({saved:true,removed,kept:state.workflows.length,message:removed?removed+' old review versions deleted. '+state.workflows.length+' current reviews are kept.':'There were no old review versions to delete.'});
        }
        if(body.action==='delete-jobs'){
          // Deletes tracked jobs for good, one confirmed request each. Only the owner's database can do this; the database has no such operation and refuses it.
          if(running)throw new Error('Wait for the current task before deleting.');
          if(body.confirm!==true||!Array.isArray(body.recordIds)||!body.recordIds.length||body.recordIds.length>200||body.recordIds.some(id=>!/^JOB-\d{3,8}$/.test(String(id))))throw new Error('Confirm which tracked jobs to delete.');
          const config=(await connections.settings()).SCOUT_CONFIG||{};
          const gone=[];let refused='';
          for(const recordId of [...new Set(body.recordIds.map(String))]){
            let reply;try{const r=await sendRecord(fetcher,{operation:'delete-record',recordId,requestId:'HQ-D-'+randomUUID(),confirmDelete:true});reply=await r.json();}catch{refused='The records could not be reached.';break;}
            if(!reply.ok||!reply.deleted){refused=/Unsupported/.test(reply.error||'')?'Tracked jobs can only be deleted once the database is your record. That needs the database.':reply.error||'A job could not be deleted.';break;}
            gone.push({id:recordId,url:reply.url||'',kept:reply.kept});
          }
          if(gone.length){
            const ids=new Set(gone.map(g=>g.id)),keys=new Set(gone.map(g=>feedbackKey({id:g.id,url:g.url}))),at=new Date(clock()).toISOString();
            await connections.updateScout(c=>{const feedback={...(c.ownerFeedback||{})},dismissed={...(c.dismissed||{})},dates={...(c.interviewDates||{})};for(const [key,entry] of Object.entries(feedback))if(keys.has(key)||ids.has(entry?.recordId))delete feedback[key];for(const key of keys)dismissed[key]=at;for(const id of ids)delete dates[id];return {...c,ownerFeedback:feedback,dismissed,interviewDates:dates};});
            const lost=new Set(state.workflows.filter(w=>ids.has(w.tracker?.recordId)||keys.has(feedbackKey(w.job))).map(w=>w.job.id));
            state.workflows=state.workflows.filter(w=>!lost.has(w.job.id));state.results=state.results.filter(j=>!lost.has(j.id)&&!keys.has(feedbackKey(j)));state.aiReviews=state.aiReviews.filter(r=>!lost.has(r.jobId));state.motivations=state.motivations.filter(m=>!lost.has(m.jobId));
            event('00','Task completed','Owner deleted '+gone.length+' tracked job'+(gone.length===1?'':'s')+' from the database.');await persist();
          }
          const traced=gone.filter(g=>g.kept==='one line').length;
          return json({saved:gone.length>0,removed:gone.length,error:gone.length?undefined:refused,message:gone.length+' job'+(gone.length===1?'':'s')+' deleted for good.'+(traced?' For '+traced+' you had applied to, one line is kept as a record of the application.':'')+(refused?' Then it stopped: '+refused:'')},gone.length?200:400);
        }
        if(body.action==='delete-archived'){
          // Deletes archived discoveries for good: the posting, its reviews, assessments and drafts leave HQ, and its address is remembered so a later search does not bring it back. Jobs in the tracker are never deleted, here or in the database.
          if(running)throw new Error('Wait for the current task before deleting.');
          if(body.confirm!==true||!Array.isArray(body.jobIds)||!body.jobIds.length||body.jobIds.length>1000)throw new Error('Confirm which archived discoveries to delete.');
          const wanted=new Set(body.jobIds.map(String)),known=new Map([...state.workflows.filter(w=>!w.tracker).map(w=>[w.job.id,w.job]),...state.results.map(j=>[j.id,j])]),saved=new Set(state.workflows.filter(w=>w.tracker).map(w=>w.job.id)),at=new Date(clock()).toISOString();let removed=[];
          await connections.updateScout(c=>{const feedback={...(c.ownerFeedback||{})},dismissed={...(c.dismissed||{})};removed=[];for(const job of known.values()){const key=feedbackKey(job);if(!wanted.has(job.id)||saved.has(job.id)||feedback[key]?.decision!=='not-fit')continue;delete feedback[key];dismissed[key]=at;removed.push(job.id);}const keys=Object.keys(dismissed);for(const key of keys.slice(0,Math.max(0,keys.length-4000)))delete dismissed[key];return {...c,ownerFeedback:feedback,dismissed};});
          if(removed.length){const gone=new Set(removed);state.results=state.results.filter(j=>!gone.has(j.id));state.workflows=state.workflows.filter(w=>!gone.has(w.job.id)||!!w.tracker);state.aiReviews=state.aiReviews.filter(r=>!gone.has(r.jobId));state.motivations=state.motivations.filter(m=>!gone.has(m.jobId));event('00','Task completed','Owner deleted '+removed.length+' archived discoveries from the private workbench. Your tracker is unchanged.');await persist();}
          return json({saved:true,removed:removed.length,message:removed.length?removed.length+' archived discover'+(removed.length===1?'y':'ies')+' deleted from HQ. They will not be collected again.':'Nothing was deleted.'});
        }
        if(body.action==='planning-status'){
          if(running)throw new Error('Wait for the current task before saving a planning choice.');
          const job=state.results.find(j=>j.id===body.jobId)||state.workflows.find(w=>w.job.id===body.jobId)?.job;if(!job)throw new Error('Recorded discovery not found.');
          let saved;await connections.updateScout(c=>{saved=savePlanningStatus(c,job,body,new Date(clock()).toISOString());return saved.config;});return json({saved:true,status:saved.status,duplicate:saved.duplicate});
        }
        // The owner says a discovery and a job already on the board are one vacancy, posted in two places. Only this private list changes: the job, its history and the discovery stay as they are.
        if(body.action==='link-job'){
          if(!/^JOB-\d{3,8}$/.test(body.recordId||''))throw new Error('Choose one of your jobs.');
          const job=state.results.find(j=>j.id===body.jobId)||state.workflows.find(w=>w.job.id===body.jobId)?.job;if(!job)throw new Error('Recorded discovery not found.');
          const r=await sendRecord(fetcher,{operation:'read-application-record',recordId:body.recordId}),v=await r.json();if(!r.ok||!v.ok||v.recordId!==body.recordId)throw new Error('That job could not be read from your records. Nothing was linked.');
          const link={jobId:String(job.id).slice(0,200),url:String(job.url||'').slice(0,2000),title:String(job.title||'').slice(0,200),employer:String(job.employer||'').slice(0,200),source:String(job.source||'').slice(0,80),recordId:body.recordId,at:new Date(clock()).toISOString()};
          await connections.updateScout(c=>({...c,sameAs:[...(Array.isArray(c.sameAs)?c.sameAs:[]).filter(l=>l.jobId!==link.jobId).slice(-499),link]}));touch();
          return json({saved:true,link,message:'Linked. This posting now shows with '+body.recordId+' instead of as a separate job. Nothing in the job itself was changed.'});
        }
        if(body.action==='unlink-job'){
          let found=false;await connections.updateScout(c=>{const list=Array.isArray(c.sameAs)?c.sameAs:[];found=list.some(l=>l.jobId===body.jobId);return {...c,sameAs:list.filter(l=>l.jobId!==body.jobId)};});touch();
          if(!found)throw new Error('That link is no longer saved.');return json({saved:true,message:'Link removed. The posting is a separate entry again.'});
        }
        if(body.action==='feedback'){
          if(running)throw new Error('Wait for the current task before saving your preference.');const config=(await connections.settings()).SCOUT_CONFIG||{};
          let job;if(body.recordId){if(!/^JOB-\d{3,8}$/.test(body.recordId))throw new Error('Select a native tracker ID.');
            const r=await sendRecord(fetcher,{operation:'read-application-record',recordId:body.recordId}),v=await r.json();if(!r.ok||!v.ok||v.recordId!==body.recordId)throw new Error('The record could not be verified. No preference saved.');job={id:v.recordId,recordId:v.recordId,url:v.url};
          }else{job=state.results.find(j=>j.id===body.jobId)||state.workflows.find(w=>w.job.id===body.jobId)?.job;if(!job)throw new Error('Recorded discovery not found.');}
          let saved;await connections.updateScout(c=>{saved=saveFeedback(c,job,body,new Date(clock()).toISOString());return saved.config;});return json({saved:true,feedback:saved.feedback,duplicate:saved.duplicate,message:body.decision==='not-fit'?'Not a fit saved privately in HQ. Agent advice and tracker status were preserved.':'Returned to review. Earlier owner feedback is retained in recent history.'});
        }
        if(body.action==='jsearch-settings'){
          if(running)throw new Error('Wait for the current check before changing sources.');
          let saved;await connections.updateScout(c=>{saved=saveJSearchSettings(c.jsearch,body);const {jsearch,...rest}=c;return saved?{...rest,jsearch:saved}:rest;});
          if(!saved){state.jsearchLast=null;state.jsearchAt=null;await persist();return json({saved:true,message:'JSearch key removed. Its earlier discoveries stay on your board.'});}
          if(!String(body.apiKey||'').trim())return json({saved:true,message:'JSearch settings saved.'});
          // Try the new key once now, so a wrong key shows here instead of at the next source check.
          const config=(await connections.settings()).SCOUT_CONFIG||{},term=(config.terms||[])[0]||state.profile?.terms?.[0]||'jobs',tried=await checkJSearchKey(config,term,state,{fetcher,at:new Date(clock()).toISOString()});
          state.jsearchLast={...tried.source,queries:tried.queries};await persist();
          return json({saved:true,accepted:!tried.source.error,message:tried.source.error?'Key saved, but the test request failed. '+tried.source.error:'Key saved and accepted: a test search for "'+term+'" returned '+tried.source.count+' postings. Press Find jobs on Today to bring postings onto your board.'});
        }
        if(body.action==='ai-screen'){
          if(running)throw new Error('Wait for the current task before starting another.');
          const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{},view=publicAi(ai,state.aiUsage,new Date(clock()).toISOString().slice(0,10));
          if(!view.enabled)throw new Error('Connect and enable the model-based Analyst in Settings first. Nothing was sent.');
          if(!view.consentCurrent)throw new Error('Open Settings and confirm the model connection again: it now also covers screening by your CV. Nothing was sent.');
          const jobs=state.results.filter(j=>!j.stale&&needsScreening(j)).slice(0,SCREEN_LIMITS.perRun);if(!jobs.length)throw new Error('Every current discovery already has a model verdict for its present text.');if(view.usedToday>=view.dailyLimit)throw new Error('Daily limit of '+view.dailyLimit+' model requests reached. Nothing was sent.');
          running=true;state.status='running';state.error=null;state.nextCheck=null;clearTimeout(timer);
          screenExisting(jobs).catch(()=>{idle();state.status='error';state.error='The model task stopped unexpectedly.';});
          return json({started:true,message:'Screening requested for '+jobs.length+' discoveries. Nothing is written to your tracker.'},202);
        }
        if(body.action==='vacancy-text'){
          if(running)throw new Error('Wait for the current task before changing a vacancy.');
          const index=state.results.findIndex(j=>j.id===body.jobId);if(index<0)throw new Error('Recorded discovery not found.');
          const text=plain(body.description);
          if(text.length<200)throw new Error('Paste at least 200 characters copied from the original vacancy.');
          if(text.length>18000)throw new Error('The pasted text exceeds 18,000 characters. Paste the vacancy itself without the rest of the page.');
          const job=state.results[index],key=textKey(job);
          if(!state.ownerTexts[key]&&Object.keys(state.ownerTexts).length>=300)throw new Error('The private workbench holds 300 owner-provided vacancy texts. Existing ones are retained.');
          state.ownerTexts={...state.ownerTexts,[key]:{text,at:new Date(clock()).toISOString()}};
          state.results=state.results.map((j,i)=>i===index?withOwnerText(j):j);
          event('01','Owner provided vacancy text',job.employer+' / '+job.title+': '+text.length+' characters recorded by the owner. Not independently verified; the source excerpt is retained.');
          // Screen the fuller text straight away with the CV evidence already held; no source or CV is read again.
          const reviewed=!!state.profile&&state.workflows.length<REVIEW_LIMIT;if(reviewed){prepareWorkflows([state.results[index]],state.profile);state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;}
          await persist();
          return json({saved:true,message:'Full vacancy text recorded privately'+(reviewed?' and screened against your saved CV evidence':'')+'. Request an assessment to use it. Nothing was written to your tracker.'});
        }
        if(body.action==='ai-settings'){
          if(running)throw new Error('Wait for the current task before changing the model connection.');
          let saved;await connections.updateScout(c=>{saved=saveAiSettings(c.ai,body);return {...c,ai:saved};});
          return json({saved:true,message:saved.enabled?'Model-based Analyst enabled. Nothing is sent until you request an assessment.':'Model connection saved and switched off. Nothing will be sent.'});
        }
        if(body.action==='ai-cv'){
          // One model request that adapts the owner's saved CV details to one recorded vacancy. The details, contact data included, are sent, so it is confirmed each time. The answer is checked against the saved details and goes back to the page as a proposal; nothing is saved here.
          if(running)throw new Error('Wait for the current task before preparing a CV.');
          if(body.confirm!==true)throw new Error('Confirm that your CV details may be sent to the model for this vacancy.');
          const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{},at=new Date(clock()).toISOString(),view=publicAi(ai,state.aiUsage,at.slice(0,10));
          if(!ai.apiKey||!ai.enabled||!view.consentCurrent)throw new Error('Connect and enable the model in Settings first. Nothing was sent.');
          // The vacancy is one HQ holds, or text the owner pasted for a job HQ has no text for.
          const pasted=body.vacancy&&typeof body.vacancy==='object'?body.vacancy:null;
          if(pasted&&(typeof pasted.description!=='string'||pasted.description.trim().length<200||pasted.description.length>20000||typeof pasted.title!=='string'||!pasted.title.trim()||typeof pasted.employer!=='string'||!pasted.employer.trim()))throw new Error('Paste the vacancy text (at least a few sentences) and give its title and employer.');
          const job=pasted?{id:'',title:pasted.title.trim().slice(0,200),employer:pasted.employer.trim().slice(0,200),location:String(pasted.location||'').slice(0,120),description:pasted.description}:state.results.find(j=>j.id===body.jobId)||state.workflows.find(w=>w.job.id===body.jobId)?.job;if(!job)throw new Error('Recorded vacancy not found.');
          if(!profileStore)throw new Error('The saved CV details cannot be read from here.');
          const saved=await profileStore();if(!saved)throw new Error('Fill in and save your details on My CV first. Nothing was sent.');
          const limit=ai.dailyLimit||AI_LIMITS.dailyDefault;if(state.aiUsage.day!==at.slice(0,10))state.aiUsage={day:at.slice(0,10),count:0};
          if(state.aiUsage.count+1>limit)throw new Error('Your daily limit of model requests is reached. Nothing was sent.');
          running=true;
          try{
            const prepared=await tailorCv({profile:saved,job,ai,call:async request=>{state.aiUsage.count+=1;return tailorCall(request);},fetcher});
            event('03','Task completed','A CV adapted to '+String(job.employer).slice(0,80)+' / '+String(job.title).slice(0,80)+' was proposed from the owner\'s saved details. Nothing was saved or sent to the employer.');await persist();
            return json({proposed:true,jobId:job.id,employer:job.employer,title:job.title,variant:prepared.variant,changes:prepared.changes,dropped:prepared.dropped,written:prepared.written,model:prepared.servedBy,cost:estimateCost(prepared.model,prepared.usage),message:'A CV adapted to this vacancy is ready below. It only selects and orders what is in your details; the headline and profile text are written by the model. Check it before you download.'});
          }catch(error){await persist();throw error;}finally{running=false;}
        }
        if(body.action==='ai-profile'){
          // One model request that copies the uploaded CV into the My CV fields. The whole CV text is sent, contact details included, so it needs its own confirmation each time. The answer goes back to the page as a proposal; nothing is saved here.
          if(running)throw new Error('Wait for the current task before filling the fields.');
          if(body.confirm!==true)throw new Error('Confirm that your whole CV text may be sent to the model for this.');
          const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{},at=new Date(clock()).toISOString(),view=publicAi(ai,state.aiUsage,at.slice(0,10));
          if(!ai.apiKey||!ai.enabled||!view.consentCurrent)throw new Error('Connect and enable the model in Settings first. Nothing was sent.');
          if(!cvStore)throw new Error('The stored CV cannot be read from here.');
          const cv=await cvStore();if(!cv||String(cv.text||'').trim().length<200)throw new Error('Upload a text-based PDF of your CV on the My CV page first. Nothing was sent.');
          const limit=ai.dailyLimit||AI_LIMITS.dailyDefault;if(state.aiUsage.day!==at.slice(0,10))state.aiUsage={day:at.slice(0,10),count:0};
          if(state.aiUsage.count+1>limit)throw new Error('Your daily limit of model requests is reached. Nothing was sent.');
          running=true;
          try{
            state.aiUsage.count+=1;
            const proposal=await proposeFields({cvText:cv.text,ai,call:profileCall,fetcher});
            event('02','Task completed','The model copied the uploaded CV into the My CV fields as a proposal for the owner to check. Nothing was saved.');await persist();
            return json({proposed:true,profile:proposal.profile,model:proposal.servedBy,cost:estimateCost(proposal.model,proposal.usage),message:'The fields are filled in from your CV but not saved yet. Check each one, correct what is wrong, then save.'});
          }catch(error){await persist();throw error;}finally{running=false;}
        }
        if(body.action==='ai-motivation'){
          // Two model requests for one vacancy: employer research on the public web (no CV material), then the motivation draft from the CV material, the vacancy and the facts found.
          if(running)throw new Error('Wait for the current task before preparing a motivation.');
          const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{},at=new Date(clock()).toISOString(),view=publicAi(ai,state.aiUsage,at.slice(0,10));
          if(!ai.apiKey||!ai.enabled||!view.consentCurrent)throw new Error('Connect and enable the model-based Analyst in Settings first. Nothing was sent.');
          const job=state.results.find(j=>j.id===body.jobId)||state.workflows.find(w=>w.job.id===body.jobId)?.job;if(!job)throw new Error('Recorded discovery not found.');
          const limit=ai.dailyLimit||AI_LIMITS.dailyDefault;if(state.aiUsage.day!==at.slice(0,10))state.aiUsage={day:at.slice(0,10),count:0};
          if(state.aiUsage.count+2>limit)throw new Error('This needs two of your daily model requests and '+Math.max(0,limit-state.aiUsage.count)+' are left today. Nothing was sent.');
          running=true;state.status='running';state.error=null;state.nextCheck=null;clearTimeout(timer);
          modelTask('02','Research '+job.employer+' and draft a motivation','motivationRun',async({ai,material})=>{
            state.aiUsage.count+=2;state.taskContext={jobId:job.id};
            const record=await draftMotivation({job,material,ai,researchCall,writeCall:motivationCall,fetcher,clock});
            state.motivations=[...state.motivations.filter(m=>m.jobId!==job.id),record].slice(-MOTIVATION_LIMITS.stored);
            event('02','Task completed',job.employer+' / '+job.title+': motivation drafted from '+record.company.facts.length+' employer facts found in '+record.searches+' web searches. Advisory only; nothing was sent to the employer and the tracker is unchanged.');
            return {jobId:job.id,searches:record.searches,facts:record.company.facts.length,costUsd:record.costUsd};
          }).catch(()=>{state.status='error';state.error='The motivation task stopped unexpectedly.';});
          return json({started:true,message:'Researching the employer and drafting a motivation. This takes about a minute.'},202);
        }
        if(body.action==='ai-review'){
          if(running)throw new Error('Wait for the current task before requesting an assessment.');
          const ai=((await connections.settings()).SCOUT_CONFIG||{}).ai||{};
          if(!ai.apiKey||!ai.enabled)throw new Error('Connect and enable the model-based Analyst in Settings first. Nothing was sent.');
          const jobs=body.jobId?state.results.filter(j=>j.id===body.jobId):state.results.filter(j=>!j.stale&&fitFor(j).eligible);
          if(!jobs.length)throw new Error(body.jobId?'Recorded discovery not found.':'No current recommended discoveries to assess.');
          running=true;state.status='running';state.error=null;state.nextCheck=null;clearTimeout(timer);
          assessExisting(jobs,ai,!!body.jobId&&body.force===true).catch(()=>{state.status='error';state.error='Model-based assessment stopped unexpectedly.';});
          return json({started:true,message:(body.jobId?'Assessment requested for this vacancy.':'Assessment requested for '+jobs.length+' recommended discoveries.')+' It is advisory: CV screening, drafts and the tracker are unchanged.'},202);
        }
        if(body.action==='review'){
          if(running)throw new Error('Wait for the current task before preparing reviews.');
          const jobs=state.results.filter(j=>!j.stale&&(!body.jobId||j.id===body.jobId));
          if(!jobs.length)throw new Error('No current recorded discoveries to review. Check Scout sources or import a vacancy first. Stale discoveries require a fresh source check.');
          if(state.workflows.length>=REVIEW_LIMIT)throw new Error('The private workbench is at capacity; existing review evidence is retained.');
          running=true;state.status='running';state.error=null;state.nextCheck=null;clearTimeout(timer);
          reviewExisting(jobs).catch(()=>{state.status='error';state.error='Private review processing stopped unexpectedly.';});
          return json({started:true,message:'Agents 02–04 review requested for recorded discoveries. Follow the real receipts below; no new vacancy search or tracker write was started.'},202);
        }
        if(body.action==='sources'){
          if(running)throw new Error('Wait for the current check before changing sources.');const boards=parseBoards(body.boards);await connections.updateScout(c=>({...c,boards}));return json({saved:true,message:'Employer boards saved. They will be checked on the next Scout run.'});
        }
        if(body.action==='import'){
          if(running)throw new Error('Wait for the current task before importing.');if(state.workflows.length>=REVIEW_LIMIT)throw new Error('The private review workbench is at capacity; previous evidence is retained.');running=true;state.status='running';
          try{mark('01','Read private CV for an owner-provided vacancy');state.profile=await cvReader(await connections.settings(),fetcher);const proposed=importedListing(body,state.profile,new Date(clock()).toISOString()),existing=state.results.find(j=>canonical(j.url)===canonical(proposed.url)),job=existing||proposed;
            if(!existing)state.results.push(job);prepareWorkflows([job],state.profile);const workflow=state.workflows.findLast(w=>w.job.id===job.id&&w.fingerprint===fingerprint(job,state.profile));if(!workflow)throw new Error('Review capacity reached; the recorded vacancy is retained.');
            return json({saved:true,workflowId:workflow.id,jobId:job.id,message:existing?'This URL was already recorded. Its current review is ready; no duplicate discovery was added.':body.importMethod==='daily-report'?'Daily report vacancy recorded privately and reviewed. Availability and report claims remain unverified; no write was made.':'Owner-provided vacancy recorded and reviewed. It is not independently verified or added to the tracker.'});}
          finally{running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;state.status=state.enabled?'waiting':'idle';await persist();}
        }
        if(body.action==='append'){
          if(running)throw new Error('Wait for the current task before saving to your tracker.');if(body.confirmReviewed!==true)throw new Error('Confirm that you reviewed this source and the proposed new discovery.');const workflow=state.workflows.find(w=>w.id===body.workflowId);if(!workflow)throw new Error('Workflow not found.');if(workflow.tracker)return json({saved:true,receipt:workflow.tracker,message:'This workflow already has a verified tracker receipt.'});if(!state.profile||!fitFor(workflow.job).eligible)throw new Error('Held by current CV role screening. Check the Analyst findings; no tracker write started.');if(workflow.fingerprint!==fingerprint(workflow.job,state.profile))throw new Error('Run agents 02–04 to update this saved review under the current matching rules. No tracker write started.');running=true;state.status='running';mark('00','Append reviewed discovery through the Coordinator bridge');
          try{workflow.tracker=await appendWorkflow(workflow,(await connections.settings()).SCOUT_CONFIG||{},fetcher);event('00','Task completed',workflow.tracker.recordId+' / '+workflow.tracker.eventId+' verified by append readback.');return json({saved:true,receipt:workflow.tracker,message:workflow.tracker.recordId+' confirmed in the tracker. Owner application approval is still pending.'});}
          catch(error){event('00','Task failed',error.message);throw error;}
          finally{running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;state.status=state.enabled?'waiting':'idle';await persist();}
        }
        if(body.action==='save'){
          if(running)throw new Error('Wait for the current check before changing search settings.');
          const appId=String(body.appId||'').trim(),appKey=String(body.appKey||'').trim(),location=String(body.location||'').trim(),country=String(body.country||'').trim().toLowerCase();
          if(location.length<2||location.length>100)throw new Error('Enter the town or region you search in.');
          if(!/^[a-z]{2}$/.test(country))throw new Error('Enter the two-letter code of the country you search in, such as us, gb, de or nl.');
          // Adzuna is one of the possible sources, not a requirement.
          if(appId&&!/^[A-Za-z0-9_-]{1,100}$/.test(appId)||appKey&&!/^[A-Za-z0-9_-]{8,250}$/.test(appKey))throw new Error('Enter a valid Adzuna app ID and key, or leave both empty.');
          const terms=String(body.terms||'').split(',').map(x=>x.trim()).filter(Boolean);if(terms.length>6||terms.some(t=>t.length<2||t.length>60))throw new Error('Use up to six comma-separated role searches, each 2–60 characters.');
          const distance=Number(body.distance);if(![10,25,50].includes(distance))throw new Error('Choose a radius of 10, 25 or 50 km.');
          await connections.updateScout(current=>{if(appId&&!appKey&&!current.appKey)throw new Error('Enter the Adzuna API key.');return {...current,appId,appKey:appId?appKey||current.appKey:'',location,country,distance,terms,enabled:false};});
          state.enabled=false;schedule();state.status='paused';state.stale=!!state.lastSuccess;await persist();return json({saved:true,message:'Private Scout settings saved. No new check was started; earlier suggestions retain their source timestamps.'});
        }
        if(body.action==='cv'){
          if(running)throw new Error('A check is already running.');
          running=true;state.status='running';mark('01','Verify private CV reading');
          try{state.profile=await cvReader(await connections.settings(),fetcher);event('01','Task completed','Private CV reading verified.');state.status=state.enabled?'waiting':'idle';state.error=null;await persist();return json({verified:true,profile:state.profile});}
          catch(error){state.status='error';state.error=error.message;event('01','Task failed',state.error);throw error;}
          finally{running=false;state.activeAgent=null;state.task=null;state.taskAt=null;state.taskContext=null;try{await persist();}catch{state.error='CV verification finished, but its private history could not be saved.';}}
        }
        if(body.action==='pause'){state.enabled=false;schedule();await persist();if(!running)state.status='paused';return json({paused:true,message:running?'Future checks paused. The current check will finish.':'Automatic checks paused.'});}
        if(body.action==='run'||body.action==='start'){
          const config=(await connections.settings()).SCOUT_CONFIG||{};if(!(config.appId&&config.appKey)&&!(config.boards??boardsDefault).length&&!config.jsearch?.apiKey)throw new Error('Configure a vacancy source first.');if(running)throw new Error('A Scout check is already running.');
          if(body.action==='start'){
            state.enabled=true;
            if(state.lastRun&&clock()-Date.parse(state.lastRun)<10*60*1000){
              state.status='waiting';schedule();await persist();
              return json({started:true,message:'Hourly Scout enabled. Your recent check is retained; the next check is scheduled.'});
            }
            await persist();
          }
          if(body.action==='run'&&body.screen===true){
            // One owner action: check the sources, then screen what is new by the CV. The hourly check never screens.
            const wait=state.lastRun?10*60*1000-(clock()-Date.parse(state.lastRun)):0;state.screenSkipped=null;
            if(wait>0){
              const why=await beginScreening(),minutes=Math.ceil(wait/60000);
              if(why)throw new Error('Sources were checked less than ten minutes ago'+(why==='none'?' and nothing is waiting to be screened':why==='limit'?' and the daily screening limit is reached':why==='off'?' and screening by your CV is not switched on':'')+'. Try again in '+minutes+(minutes===1?' minute.':' minutes.'));
              return json({started:true,message:'Sources were checked a few minutes ago, so only the screening by your CV was started.'},202);
            }
            run().then(()=>beginScreening(true)).then(why=>{state.screenSkipped=why;}).catch(error=>{state.status='error';state.error=error.message;schedule();});
            return json({started:true,message:'Searching your sources. New discoveries are screened by your CV straight after.'});
          }
          run().catch(error=>{state.status='error';state.error=error.message;schedule();});return json({started:true,message:'Scout check requested. Watch verified task events below.'});
        }
        throw new Error('Unsupported Scout action.');
      }catch(error){return json({error:error.message||'Scout action failed.'},400);}finally{touch();}
    },
    busy(){return running;},
    // After an import the saved state is read again, so the next save does not write the old one back.
    async reload(){if(running)throw new Error('Wait for the current task to finish before importing.');const saved=(await connections.settings()).SCOUT_CONFIG||{};state={...state,results:[],workflows:[],events:[],aiReviews:[],motivations:[],ownerTexts:{},modelFits:{},profile:null,...(saved.state||{}),activeAgent:null,task:null,taskAt:null,taskContext:null};state.enabled=!!saved.enabled;state.status=state.enabled?'waiting':state.lastRun?'paused':'not-connected';touch();schedule();},
    close(){closed=true;clearTimeout(timer);}
  };
}
