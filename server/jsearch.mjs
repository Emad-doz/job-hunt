import {createHash} from 'node:crypto';
import {plain} from './sources.mjs';
import {overlap} from './skill-evidence.mjs';
import {publicUrl} from './cv-screening.mjs';
import {searchTerms} from './search-plan.mjs';

// Google for Jobs postings (LinkedIn, Indeed, Glassdoor, employer sites) through the JSearch API. Only role phrases and the search area are sent.
export const JSEARCH_LIMITS={endpoint:'https://api.openwebninja.com/jsearch/search-v2',phrases:4,monthlyDefault:190,monthlyMax:10000,dailyHours:23,staleDays:14};
const publisher=name=>/linkedin/i.test(name)?'LinkedIn':/indeed/i.test(name)?'Indeed':/glassdoor/i.test(name)?'Glassdoor':'Google Jobs';
const money=job=>{const range=[job.job_min_salary,job.job_max_salary].filter(n=>Number.isFinite(n)&&n>0);return plain(job.job_salary_string).slice(0,150)||(range.length?'Source range: '+range.map(n=>n.toLocaleString('en-GB')).join('–')+(job.job_salary_period?' per '+String(job.job_salary_period).toLowerCase():' · period not supplied'):'Unknown');};
export function mapJSearchJob(job,profile,at){
  if(!job||typeof job!=='object'||!job.job_id||!job.job_title)return null;
  // Prefer a direct employer link; otherwise the first posting link that is a usable public address.
  const options=[...(Array.isArray(job.apply_options)?job.apply_options:[]).filter(o=>o?.is_direct),{apply_link:job.job_apply_link,publisher:job.job_publisher},...(Array.isArray(job.apply_options)?job.apply_options:[])];
  let url='',site='';for(const option of options){try{url=publicUrl(option?.apply_link);site=plain(option.publisher).slice(0,60);break;}catch{}}
  if(!url)return null;
  const title=plain(job.job_title).slice(0,180),description=plain(job.job_description).slice(0,18000),id=createHash('sha256').update(String(job.job_id)).digest('hex').slice(0,20);
  if(!title||description.length<40)return null;
  return {id:'JSEARCH-'+id,sourceId:String(job.job_id).slice(0,120),originalPostingId:String(job.job_id).slice(0,120),source:publisher(site||job.job_publisher||''),foundOn:site||plain(job.job_publisher).slice(0,60)||'Google for Jobs',title,employer:plain(job.employer_name).slice(0,120)||'Not supplied',location:plain(job.job_location).slice(0,120)||[job.job_city,job.job_state,job.job_country].map(plain).filter(Boolean).join(', ').slice(0,120)||'Not supplied',url,description,skills:overlap(profile?.skills||[],title+' '+description),salary:money(job),publishedAt:typeof job.job_posted_at_datetime_utc==='string'&&!Number.isNaN(Date.parse(job.job_posted_at_datetime_utc))?new Date(job.job_posted_at_datetime_utc).toISOString():null,readAt:at,availability:'Listed on Google for Jobs at source-read time (via JSearch); open the posting to confirm it is still open',completeness:'Job listing description',stale:false};
}
export const jsearchMonth=at=>String(at).slice(0,7);
// One search request. A refusal is reported with the service's own status and wording, so a wrong key can be told from a missing subscription.
async function ask(config,term,datePosted,fetcher){
  const settings=config.jsearch||{},params=new URLSearchParams({query:term+(config.location?' in '+config.location:''),country:settings.country||config.country||'us',date_posted:datePosted,radius:String(config.distance||25),num_pages:'1'});
  try{
    const r=await fetcher(JSEARCH_LIMITS.endpoint+'?'+params,{headers:{Accept:'application/json','x-api-key':settings.apiKey},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok){
      let said='';try{said=plain(JSON.parse((await r.text()).slice(0,2000))?.message).slice(0,120);}catch{}
      const detail=' (HTTP '+r.status+(said?': '+said:'')+')';
      return {status:r.status,error:r.status===401?'JSearch did not accept the saved key'+detail+'. Copy the key again from your OpenWeb Ninja account and save it here.':r.status===403?'JSearch refused the request'+detail+'. Check that your OpenWeb Ninja account is subscribed to the JSearch API.':r.status===429?'JSearch request limit reached'+detail+'. Saved discoveries retained.':'JSearch unavailable'+detail+'.'};
    }
    const payload=await r.json(),jobs=payload?.data?.jobs;if(!Array.isArray(jobs))throw new Error('Unexpected JSearch response.');
    return {status:200,jobs};
  }catch{return {status:0,error:'A JSearch query could not finish. Saved discoveries retained.'};}
}
const usage=(state,at)=>{const month=jsearchMonth(at);if(state.jsearchUsage?.month!==month)state.jsearchUsage={month,count:0};return state.jsearchUsage;};
// Tried once when a key is saved, so a wrong key shows at once instead of at the next source check.
export async function checkJSearchKey(config,term,state,{fetcher=fetch,at}){
  const spent=usage(state,at),answer=await ask(config,term,'month',fetcher);if(answer.status===200)spent.count++;
  return {source:{id:'JSearch',source:'Google for Jobs / JSearch',status:answer.error?'error':'synced',at,count:answer.jobs?.length||0,error:answer.error||null},queries:[{term,count:answer.jobs?.length||0,error:answer.error||null}]};
}
// One request per phrase, rotating through the phrases, inside a monthly request budget.
export async function searchJSearch(config,profile,state,{fetcher=fetch,at}){
  const limit=config.jsearch?.monthlyLimit||JSEARCH_LIMITS.monthlyDefault,spent=usage(state,at),terms=searchTerms(config,profile);
  const start=(state.jsearchCursor||0)%Math.max(1,terms.length),plan=terms.map((_,i)=>terms[(start+i)%terms.length]).slice(0,JSEARCH_LIMITS.phrases),listings=new Map(),queries=[];let lastError=null,succeeded=0;
  for(const term of plan){
    if(spent.count>=limit){lastError='Monthly JSearch limit of '+limit+' requests reached; saved discoveries are retained.';break;}
    const answer=await ask(config,term,state.jsearchLast?.count>0?'week':'month',fetcher);
    // A refused request is not charged against the month, and there is no point repeating it.
    if([401,403].includes(answer.status)){queries.push({term,count:0,error:answer.error});lastError=answer.error;break;}
    spent.count++;state.jsearchCursor=(terms.indexOf(term)+1)%terms.length;
    if(answer.error){queries.push({term,count:0,error:answer.error});lastError=answer.error;if(answer.status===429)break;continue;}
    for(const job of answer.jobs.slice(0,20)){const listing=mapJSearchJob(job,profile,at);if(listing&&!listings.has(listing.id))listings.set(listing.id,listing);}
    succeeded++;queries.push({term,count:answer.jobs.length,error:null});
  }
  return {listings:[...listings.values()],source:{id:'JSearch',source:'Google for Jobs / JSearch',status:succeeded?lastError?'partial':'synced':'error',at,count:listings.size,error:lastError},queries};
}
export function saveJSearchSettings(current={},body){
  if(body.remove===true)return null;
  const apiKey=String(body.apiKey||'').trim(),monthlyLimit=Number(body.monthlyLimit??current.monthlyLimit??JSEARCH_LIMITS.monthlyDefault),country=String(body.country||current.country||'us').trim().toLowerCase();
  if(apiKey&&!/^[\x21-\x7e]{16,200}$/.test(apiKey))throw new Error('Enter the JSearch API key exactly as shown in your OpenWeb Ninja account.');
  if(!apiKey&&!current.apiKey)throw new Error('Enter your JSearch API key.');
  if(!Number.isInteger(monthlyLimit)||monthlyLimit<10||monthlyLimit>JSEARCH_LIMITS.monthlyMax)throw new Error('Choose a monthly limit between 10 and '+JSEARCH_LIMITS.monthlyMax+' requests.');
  if(!/^[a-z]{2}$/.test(country))throw new Error('Enter a two-letter country code, such as us.');
  return {apiKey:apiKey||current.apiKey,monthlyLimit,country};
}
export const publicJSearch=(config={},state={},at='')=>({configured:!!config.jsearch?.apiKey,monthlyLimit:config.jsearch?.monthlyLimit||JSEARCH_LIMITS.monthlyDefault,country:config.jsearch?.country||'us',usedThisMonth:state.jsearchUsage?.month===jsearchMonth(at)?state.jsearchUsage.count||0:0,last:state.jsearchLast||null});
