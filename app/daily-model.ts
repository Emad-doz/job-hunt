import type {Job,Snapshot,Activity} from './data';
import type {ScoutState,SameAs} from './scout';
import type {ReviewWorkflow} from './workflow';
import {canAppendReview} from './match';
import {ownerFeedbackFor,type OwnerFeedback} from './owner-feedback-model';
import {calendarDate,matchesJobDate,earliestDiscovery} from './job-dates';
import type {MatchAssessment} from './match';
import {ownerStatusFor} from './owner-status-model';

export type JobGroup='All jobs'|'Recommended'|'Tracked'|'Applied'|'Held'|'Not a fit'|'Rejected'|'Discovered'|'Interview'|'Offer';
export type JobItem={key:string;title:string;employer:string;location:string;salary:string;job?:Job;relatedJobs?:Job[];linked?:SameAs[];planning?:string;review?:ReviewWorkflow;discovery?:ReviewWorkflow['job'];fit?:MatchAssessment;aliases?:string[];label:string;group:JobGroup;interview?:{date:string;time:string};foundAt?:string;ownerFeedback?:OwnerFeedback;evidence?:ReturnType<typeof applicationEvidence>};
export function applicationEvidence(job:Job,events:Activity[]){const linked=events.filter(e=>e.recordId===job.id);if(linked.some(e=>e.type==='Confirmation'&&/receipt read through the private (?:Outlook|Gmail) connection/i.test(e.details)))return {label:'Reviewed email evidence',detail:'A matching message was read through HQ and reviewed before its reference was saved.'};if(job.confirmation?.trim()||linked.some(e=>/confirmation/i.test(e.type)&&!/(?:owner|candidate) (?:reports|reference)/i.test(e.details)))return {label:'Recorded reference',detail:'Evidence is recorded in the database. Read its source and method before treating it as a verified receipt.'};if(linked.some(e=>/Owner reports an application submitted/i.test(e.details)))return {label:'Owner-reported · receipt not saved',detail:'The application was recorded after your confirmation in HQ. No submission reference is saved here; this does not establish whether a mailbox search would find one.'};return {label:'Receipt not saved',detail:'The tracker records an application stage or date. No submission reference is recorded here.'};}
export const applicationRecorded=(job:Job)=>!!job.applied||['Applied','Submitted','Interview','Offer','Hired'].includes(job.status);
// Where a vacancy sits in the Jobs lists. Rejected collects recorded outcomes that ended (Rejected, Withdrawn, Closed); Archive is the owner's private "not for me"; everything else is active.
export type JobStage='Discovered'|'Applied'|'Interview'|'Offer'|'Rejected';
// A discovery the owner marked Closed has ended too, though it never became a tracked job.
export function jobStage(item:Pick<JobItem,'job'|'planning'>):JobStage{const s=item.job?.status||(item.planning==='Closed'?'Closed':'');return ['Rejected','Withdrawn','Closed'].includes(s)?'Rejected':['Offer','Hired'].includes(s)?'Offer':s==='Interview'?'Interview':item.job&&applicationRecorded(item.job)?'Applied':'Discovered';}
export type JobView='active'|'rejected'|'archive';
export const jobView=(item:Pick<JobItem,'job'|'ownerFeedback'|'planning'>):JobView=>jobStage(item)==='Rejected'?'rejected':item.ownerFeedback?.decision==='not-fit'?'archive':'active';
// The interview date the owner entered when setting Interview. It travels inside the note of that status change, so it is read back from the job's newest recorded event that carries one.
export const interviewNote=(date:string,time:string)=>date?'Interview on '+date+(time?' at '+time:'')+'. ':'';
export function interviewDate(job:Job,events:Activity[]){if(job.status!=='Interview')return undefined;const found=events.filter(e=>e.recordId===job.id).map(e=>({at:e.date,match:e.details.match(/Interview on (\d{4}-\d{2}-\d{2})(?: at (\d{2}:\d{2}))?/)})).filter(x=>x.match).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];return found?{date:found.match![1],time:found.match![2]||''}:undefined;}
export type AppliedPeriod='All dates'|'Past 7 days'|'Past 30 days'|'Date missing';
export const appliedDate=calendarDate;
export function matchesAppliedPeriod(value:string|undefined,period:AppliedPeriod,now=new Date()){
 return matchesJobDate(value,period,'','',now);
}
export const canSaveDiscovery=(w:ReviewWorkflow)=>canAppendReview(w)&&!!w.draft&&!w.job.stale&&!w.tracker;
export const sourceIdentity=(value:string)=>{try{const u=new URL(value);if((u.pathname==='/'||u.pathname==='/jobs'||u.pathname==='/careers')&&!['jk','currentJobId','gh_jid','jobId','job_id','id'].some(k=>u.searchParams.has(k)))return '';for(const key of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|msclkid|trk|trackingId|ref|referrer|source|sourceId)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.hostname.toLowerCase().replace(/^www\./,'')+u.pathname.replace(/\/+$/,'')+(u.search||'');}catch{return '';}};
export function collectJobs(data:Snapshot,state:ScoutState):JobItem[]{
  const newest=state.protected?(state.workflows||[]).filter(w=>!w.superseded).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];
  const discoveryHistory=state.protected?[...(state.workflows||[]).map(w=>({...w.job,createdAt:w.createdAt})),...state.results]:[];
  const items:JobItem[]=[],byUrl=new Map<string,JobItem>(),byId=new Map<string,JobItem>();
  // Postings the owner linked to a job: by the discovery's ID, and by its address so the same posting found again stays linked.
  const links=state.protected?state.sameAs||[]:[],linkFor=(id:string,url:string)=>links.find(l=>l.jobId===id)||(sourceIdentity(url)?links.find(l=>sourceIdentity(l.url)===sourceIdentity(url)):undefined);
  const joined=(id:string,url:string)=>{const link=linkFor(id,url),item=link?byId.get(link.recordId):undefined;if(item&&link&&!item.linked?.some(l=>l.jobId===link.jobId))item.linked=[...(item.linked||[]),link];return item;};
  const register=(item:JobItem,url:string,id:string)=>{if(sourceIdentity(url))byUrl.set(sourceIdentity(url),item);if(id)byId.set(id,item);};
  for(const job of data.mode==='synced'||!state.protected?data.jobs:[]){
    const existing=byUrl.get(sourceIdentity(job.url));
    if(existing){if(applicationRecorded(job)&&!applicationRecorded(existing.job!)){existing.relatedJobs=[...(existing.relatedJobs||[]),existing.job!];existing.job=job;existing.label=job.status;existing.evidence=applicationEvidence(job,data.events);}else existing.relatedJobs=[...(existing.relatedJobs||[]),job];existing.aliases!.push('tracker:'+job.id);byId.set(job.id,existing);if(applicationRecorded(job))existing.group='Applied';continue;}
    const item:JobItem={key:'tracker:'+job.id,aliases:['tracker:'+job.id],title:job.role,employer:job.employer,location:job.location,salary:job.salary,job,evidence:applicationEvidence(job,data.events),label:job.status,group:applicationRecorded(job)?'Applied':'Tracked'};items.push(item);register(item,job.url,job.id);
  }
  // Verified native IDs take priority over URL inference. Older receipts remain
  // inspectable; no native ID is invented for a discovery.
  for(const review of [...newest.filter(w=>w.tracker),...newest.filter(w=>!w.tracker)]){
    const url=review.job.url,existing=(review.tracker?byId.get(review.tracker.recordId):undefined)||byId.get(review.job.id)||byUrl.get(sourceIdentity(url))||(review.tracker?undefined:joined(review.job.id,url));
    if(existing){existing.aliases!.push('review:'+review.id);if(!existing.review){existing.review=review;existing.fit=review.currentFit;}register(existing,url,review.job.id);continue;}
    const item:JobItem={key:'review:'+review.id,aliases:['review:'+review.id],title:review.job.title,employer:review.job.employer,location:review.job.location,salary:review.job.salary,foundAt:earliestDiscovery(review.job.id,url,discoveryHistory),review,discovery:review.job,fit:review.currentFit,label:review.tracker?'Saved · tracker refresh needed':'Discovered',group:review.currentFit?.eligible?'Recommended':'Held'};items.push(item);register(item,url,review.job.id);
  }
  for(const discovery of state.protected?state.results:[]){
    const existing=byId.get(discovery.id)||byUrl.get(sourceIdentity(discovery.url))||joined(discovery.id,discovery.url);
    if(existing){existing.discovery=discovery;existing.aliases!.push('discovery:'+discovery.id);if(!existing.review)existing.fit=discovery.fit;register(existing,discovery.url,discovery.id);continue;}
    const item:JobItem={key:'discovery:'+discovery.id,aliases:['discovery:'+discovery.id],title:discovery.title,employer:discovery.employer,location:discovery.location,salary:discovery.salary,foundAt:earliestDiscovery(discovery.id,discovery.url,discoveryHistory),discovery,fit:discovery.fit,label:'Discovered',group:discovery.fit?.eligible?'Recommended':'Held'};items.push(item);register(item,discovery.url,discovery.id);
  }
  // A date the owner saved in HQ wins over one read from the note of the status change.
  return items.map(item=>{const kept=item.job&&state.protected?state.interviewDates?.[item.job.id]:undefined,interview=item.job?.status==='Interview'&&kept?{date:kept.date,time:kept.time}:item.job?interviewDate(item.job,data.events):undefined;if(interview)item={...item,interview};const ownerFeedback=ownerFeedbackFor(state,item.job?.url||item.discovery?.url||item.review?.job.url||'',item.job?.id||item.discovery?.id||item.review?.job.id||'');const planning=ownerStatusFor(state,item.discovery?.url||item.review?.job.url||'',item.discovery?.id||item.review?.job.id||'');return {...item,...(!item.job&&planning?{planning:planning.status}:{}),label:!item.job&&planning?planning.status+' · HQ':item.label,ownerFeedback,group:ownerFeedback?.decision==='not-fit'&&item.group!=='Applied'?'Not a fit':item.group};});
}
export function nextStep(item:JobItem){
  if(item.ownerFeedback?.decision==='not-fit'&&!item.job?.applied&&(!item.job||!applicationRecorded(item.job)))return {title:'You marked this job as not a fit.',detail:item.ownerFeedback.reason+' · Return it to review if you change your mind. Agent findings are retained.',step:0};
  if(item.job){if(['Closed','Rejected','Withdrawn','Hired'].includes(item.job.status))return {title:'Keep the recorded outcome and history.',detail:item.job.next==='Not documented'?'Read the recorded history and supporting evidence.':item.job.next,step:applicationRecorded(item.job)?3:0};if(applicationRecorded(item.job))return {title:'Keep the application evidence together.',detail:'Check your mailbox for this job, review a matching message and save its reference to the database.',step:3};return {title:'Prepare, apply, then record it.',detail:item.job.next==='Not documented'?'Review the original vacancy and your materials. Record the date after you apply yourself.':item.job.next,step:2};}
  const w=item.review;
  if(!w)return {title:'Start reviewing this discovery.',detail:'Scout recorded the vacancy source. Analyst, Application and Manager have not yet recorded a review for this job.',step:0};
  if(w.tracker)return {title:'Saved to your tracker. Refresh the tracker.',detail:w.tracker.recordId+' · '+w.tracker.eventId+' is verified. Your latest tracker view is still catching up.',step:2};
  if(w.job.stale)return {title:'Refresh this vacancy source.',detail:'This discovery was retained after a source error. Find jobs again before acting on it.',step:0};
  if(!w.currentFit?.eligible)return {title:'Held for a possible mismatch.',detail:w.currentFit?.blockers[0]||w.currentFit?.reasons.at(-1)||'Read the Analyst findings before deciding whether to pursue it.',step:0};
  if(!canSaveDiscovery(w))return {title:'Update the saved review.',detail:'Recheck saved jobs to prepare this vacancy with the current CV and screening rules.',step:0};
  return {title:'Review this opportunity.',detail:'Check the fit, original requirements and draft. Add it to your tracker when you want to pursue it.',step:0};
}
export async function requestScoutAction(action:'run'|'start'|'pause'|'append',body:object={},fetcher:typeof fetch=fetch){
  const response=await fetcher('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(60000)});
  const result=await response.json() as {error?:string;message?:string;saved?:boolean;started?:boolean};
  if(!response.ok)throw new Error(result.error||'This action could not be completed.');
  if(action==='append'&&!result.saved)throw new Error('No new confirmation returned. Refresh to inspect the recorded receipt.');
  return result.message||'Request accepted.';
}
