import {randomUUID,createHash} from 'node:crypto';
import {overlap,mentionedSkills} from './cv-reader.mjs';
import {plain} from './sources.mjs';
import {assessMatch,MATCH_VERSION} from './matching.mjs';
const quote=(text,pattern)=>{const at=text.search(pattern);return at<0?'Not documented':text.slice(Math.max(0,at-80),Math.min(text.length,at+230));};
export const fingerprint=(job,profile)=>createHash('sha256').update(JSON.stringify([MATCH_VERSION,job.id,job.title,job.description,job.salary,job.location,profile.modifiedAt,profile.skills,profile.evidence,profile.roleFamilies,profile.legalBackground,profile.ownSkills??null,profile.ownRoles??null,job.modelFit?.fit??null,job.modelFit?.reason??null])).digest('hex');
export function buildWorkflow(job,profile,{clock=Date.now,mark=()=>{},event=()=>{}}={}){
  const id='HQ-W-'+randomUUID(),receipts=[];
  function receipt(agentId,title,findings,decision,method,handoff){mark(agentId,title,{workflowId:id,jobId:job.id});const r={id:'HQ-R-'+randomUUID(),workflowId:id,agentId,at:new Date(clock()).toISOString(),inputReceipt:receipts.at(-1)?.id||null,title,method,findings,decision};receipts.push(r);event(agentId,'Task completed',job.employer+' / '+job.title+': '+decision,handoff);return r;}
  receipt('01','Record source evidence',[{label:'Source',value:job.source+' / '+job.sourceId},{label:'Availability',value:job.availability},{label:'Read time',value:job.readAt}], 'Source recorded; not an application','Source response or owner-provided import',['01','02']);
  const fit=assessMatch(job,profile),skills=fit.coreSkills,requiredExperience=quote(job.description,/\b\d+\+?\s*(?:years?|jaar)\b|experience|ervaring/i),language=quote(job.description,/\b(?:english|dutch|nederlands|german|french|language|taal)\b/i);
  const matrix=[
    {label:'CV role screening',value:fit.label+' · '+fit.reasons.join(' ')},
    {label:'Requirement conflicts',value:fit.blockers.join('\n')||'No conflict detected by these bounded rules. This is not proof of eligibility.'},
    {label:'Skill evidence',value:skills.length?skills.join(', ')+' appear in both CV and vacancy. This is keyword evidence, not proof of proficiency.':'No supported CV skill keywords found in this vacancy.'},
    {label:'Possible skill gaps',value:mentionedSkills(job.description).filter(s=>!profile.skills.includes(s)).join(', ')?'Vacancy mentions '+mentionedSkills(job.description).filter(s=>!profile.skills.includes(s)).join(', ')+', absent from extracted CV keywords. Check whether mandatory or preferred; absence is not proof of missing ability.':'No additional supported skill keywords found. This does not establish that all requirements are met.'},
    {label:'Professional CV evidence',value:profile.evidence?.filter(s=>overlap(skills,s).length).slice(0,4).join('\n')||'No safe professional evidence sentence extracted; review your CV.'},
    {label:'Experience requirement',value:requiredExperience+' · duration and seniority fit need owner review.'},
    {label:'Location',value:job.location+' · '+(/Amsterdam/i.test(job.location)?'Amsterdam is explicitly listed.':'Commute / remote eligibility needs review.')},
    {label:'Language requirement',value:language+' · CV lists '+(profile.languages?.join(', ')||'no extracted language names')+'; proficiency levels are not inferred.'},
    {label:'Salary',value:job.salary+' · desired salary and eligibility have not been supplied.'},
    {label:'Requirements / gaps',value:job.completeness==='Employer feed description'?'Employer feed supplies a description. Qualifications, work permission and closing date need verification.':'Source excerpt may omit requirements. Read the original vacancy before applying.'},
    {label:'Assessment limits',value:''+(fit.basis==='model'?'Relevance was judged by a model against the CV; the other findings are local evidence rules. No full fit score or employer communication is claimed.':'Local evidence rules. No AI model, full fit score or employer communication is claimed.')}
  ];
  const usable=fit.eligible;
  receipt('02','Compare vacancy and professional CV evidence',matrix,usable?fit.label+'; proceed to a review draft':'Hold: '+fit.label+'; '+(fit.blockers[0]||fit.reasons.at(-1)),'CV role alignment, specific-skill evidence and qualification-conflict screening',usable?['02','03']:undefined);
  let draft=null,managerDecision='Needs owner assessment';
  if(usable){
    const evidence=profile.evidence?.filter(s=>overlap(skills,s).length).slice(0,4)||[];
    const letter=`Dear hiring team,\n\nI am interested in the ${job.title} role at ${job.employer}. ${skills.length?'My CV documents '+skills.join(', ')+', which also appear in your vacancy.':'[Add in one or two sentences how your experience fits this role.]'}\n\n${evidence.length?evidence.map(s=>'CV evidence for review: '+s).join('\n'):'[Add a verified achievement from your CV before sending.]'}\n\nI would welcome the opportunity to discuss the role.\n\n[Your name]\n\nDRAFT ONLY — verify the original requirements, factual wording and personal details before using.`;
    draft={letter,cvBullets:evidence.length?evidence:['Select a verified achievement from your CV.'],interviewQuestions:[`How does ${job.employer} measure success for ${job.title}?`,skills.length?`Which ${skills[0]} challenges are most important to this team?`:'Which challenges matter most to this team in the first six months?','What are the location, language and salary expectations?'],kind:'Evidence-based template; not AI-written or submitted'};
    receipt('03','Prepare application review materials',[{label:'Draft method',value:draft.kind},{label:'Tailoring',value:'Uses the documented role, employer and shared skills. CV sentences are quoted unchanged.'},{label:'Open checks',value:'Review full requirements, seniority, language, compensation and every statement.'}], 'Draft prepared for Manager review; nothing sent','Local factual draft template',['03','04']);
    managerDecision=job.completeness==='Employer feed description'&&!job.stale&&evidence.length?'Ready for owner review':'Needs source / evidence review';
    receipt('04','Review draft and evidence completeness',[{label:'Factual source',value:'Role / employer copied from source; professional evidence copied from CV.'},{label:'Outstanding checks',value:job.completeness==='Employer feed description'?'Owner must confirm eligibility and full fit.':'Full original requirements and availability remain unverified.'},{label:'Submission',value:'No application, message or outcome change performed.'},{label:'Authority',value:'Manager checks preparation only. Application approval remains with the owner.'}],managerDecision,'Local completeness and draft-consistency checks',['04','00']);
    receipt('00','Prepare Coordinator review queue',[{label:'Tracker state',value:'This is a private draft workflow, not a tracker record.'},{label:'Proposed new-record status',value:'Researching / Pending review'},{label:'Next action',value:managerDecision+'. Review source and draft; then explicitly append discovery.'}], 'Queued for owner review; no write performed','Read-only preparation; append gateway required');
  }
  return {id,job,fit,fingerprint:fingerprint(job,profile),createdAt:new Date(clock()).toISOString(),cvReadAt:profile.readAt,receipts,draft,managerDecision,stage:usable?'Coordinator review':'Analyst hold',tracker:null};
}
// Where a record operation is sent. It is not a web address: the host answers it from the owner's database (server/node-host.mjs), and tests answer it themselves.
export const RECORDS='hq-records:operation';
export const sendRecord=(fetcher,operation)=>fetcher(RECORDS,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation),signal:AbortSignal.timeout(40000)});
export async function appendWorkflow(workflow,config,fetcher=fetch){
  
  if(!workflow.draft)throw new Error('Analyst-held records need owner assessment before a Coordinator append.');
  if(!workflow.fit?.eligible||workflow.fit.version!==MATCH_VERSION)throw new Error('This discovery needs a current CV role review before a Coordinator append.');
  const response=await sendRecord(fetcher,{operation:'append-reviewed-discovery',workflowId:workflow.id,job:workflow.job,receipts:workflow.receipts,decision:workflow.managerDecision});
  if(!response.ok)throw new Error('The database did not accept the request (HTTP '+response.status+'). No successful write confirmed.');
  let result;try{result=await response.json();}catch{throw new Error('Bridge did not return a verified result. Check the deployment and retry the same workflow ID.');}
  if(!result.ok||!/^JOB-\d+$/.test(result.recordId)||!/^EVT-\d+$/.test(result.eventId))throw new Error(result.error||'No verified append receipt returned.');
  return {recordId:result.recordId,eventId:result.eventId,at:result.at,duplicate:!!result.duplicate,source:'HQ database'};
}
