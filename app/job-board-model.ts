import type {JobItem} from './daily-model';
import {jobDateInfo} from './job-dates';
export type FitFilter='All fit levels'|'Recommended'|'Not a fit'|'Needs checking'|'Not assessed';
export type JobSort='Highest match'|'Job name A–Z'|'Employer A–Z'|'Found newest'|'Found oldest'|'Applied newest';
export function jobFitLabel(item:JobItem){if(item.ownerFeedback?.decision==='not-fit')return 'Not a fit · your decision';if(item.fit)return item.fit.label;return 'Not assessed';}
export function matchesFit(item:JobItem,filter:FitFilter){
 if(filter==='All fit levels')return true;
 if(filter==='Not a fit')return item.ownerFeedback?.decision==='not-fit'||!!item.fit?.blockers.length;
 if(filter==='Recommended')return item.ownerFeedback?.decision!=='not-fit'&&item.fit?.eligible===true;
 if(filter==='Not assessed')return !item.fit;
 return item.ownerFeedback?.decision!=='not-fit'&&!!item.fit&&!item.fit.eligible;
}
export function sortJobs(items:JobItem[],sort:JobSort){return items.slice().sort((a,b)=>{
 const name=()=>a.title.localeCompare(b.title)||a.employer.localeCompare(b.employer)||a.key.localeCompare(b.key);
 if(sort==='Job name A–Z')return name();if(sort==='Employer A–Z')return a.employer.localeCompare(b.employer)||name();
 if(sort==='Highest match'){
   const rank=(i:JobItem)=>i.ownerFeedback?.decision==='not-fit'?-1:i.fit?.eligible?2:i.fit?.blockers.length?0:i.fit?1:0;
   return rank(b)-rank(a)||(b.fit?.priority||0)-(a.fit?.priority||0)||(b.fit?.sharedSkills.length||0)-(a.fit?.sharedSkills.length||0)||name();
 }
 const basis=sort==='Applied newest'?'applied':'found',ad=jobDateInfo(a,basis).date,bd=jobDateInfo(b,basis).date;
 if(!ad||!bd)return ad?-1:bd?1:name();return (sort==='Found oldest'?ad.localeCompare(bd):bd.localeCompare(ad))||name();
});}
