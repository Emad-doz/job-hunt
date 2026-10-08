// The owner's records: the fixed operations that may change a job or its history, applied to the records held in memory for the length of one database transaction.
// The operations, their checks, wording and replies were taken over from the Google Apps Script that used to perform them, so the modules that call them did not have to change. One goes beyond it: the owner can delete a job for good, with an explicit confirmation. Nothing here freely edits a record.
export const STATUSES=['Discovered','Researching','Shortlisted','Preparing','Ready to apply','Applied','Interview','Offer','Hired','Rejected','Withdrawn','Closed','On hold'];
const undocumented='Not separately documented — see source notes';
const today=now=>new Intl.DateTimeFormat('en-CA',{timeZone:process.env.HQ_TIMEZONE||Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
// The highest number in use, or ever used: an ID is never handed out twice, also not after its job was deleted.
export const highest=(list,prefix)=>list.reduce((n,item)=>Math.max(n,Number(String(item.id).match(new RegExp('^'+prefix+'(\\d+)$'))?.[1]||0)),0);
const nextId=(list,prefix,width,floor=0)=>prefix+String(Math.max(highest(list,prefix),floor)+1).padStart(width,'0');
// The same classification the page applies to tracker rows, so a new entry is filed like the old ones.
function classify(type,actor,details){const all=(type+' '+details).toLowerCase();if(/administrativ|user.directed|candidate.directed|not.*employer|not newly.*rejection|status.change|reconcil|audit|classification/.test(all))return 'administrative';if(/^(candidate|owner|user|me)$/i.test(actor.trim()))return 'candidate';if(/confirmation|receipt|email received|interview|employer|response|rejection|offer/.test(type.toLowerCase()))return 'employer';return 'other';}
export function urlKey(value){
  const text=String(value||'').toLowerCase(),base=text.split(/[?#]/)[0].replace(/\/$/,'');
  const identity=text.match(/[?&](jk|currentjobid|gh_jid|jobid|job_id)=([^&#]+)/g)||[];
  return base+identity.map(s=>s.replace(/^[?&]/,'')).sort().join('&');
}
// store: {jobs:[...], events:[...], receipts:Set of known receipt ids, counters:{job,event} highest numbers ever used}. Returns the reply and what must be saved: changed or new jobs, new events, new receipt rows, and what was removed.
export function applyOperation(store,body,now=new Date()){
  const out={jobs:new Map(),events:[],receipts:[],removed:{jobs:[],traces:[]}},used=store.counters||{};
  const event=(recordId,date,type,actor,details,evidence,next='')=>{const entry={id:nextId(store.events,'EVT-',4,used.event),recordId,date,sourceDate:date,type,actor,details:String(details).slice(0,45000),evidence:String(evidence).slice(0,45000),next,due:'',category:classify(type,actor,String(details))};if(actor.startsWith('00 — '))entry.agentId='00';store.events.push(entry);out.events.push(entry);return entry.id;};
  const touch=job=>{out.jobs.set(job.id,job);return job;};
  const only=recordId=>{const found=store.jobs.filter(j=>j.id===recordId);if(found.length!==1)throw new Error('Record ID missing or duplicated. No record was changed.');return found[0];};
  try{
    if(body.operation==='read-status-capabilities')return {reply:{ok:true,version:'owner-status-v1',statuses:STATUSES},...out};
    if(body.operation==='read-application-record'){
      if(!/^JOB-\d{3,8}$/.test(body.recordId||''))throw new Error('Invalid tracker Record ID.');
      const job=only(body.recordId);return {reply:{ok:true,recordId:job.id,employer:job.employer,role:job.role,postingId:job.postingId||'',url:job.url,status:job.status,appliedOn:job.applied||'',reference:job.confirmation||''},...out};
    }
    if(body.operation==='delete-record'){
      // Removes a job and its history for good. For a job the owner applied to, one line is kept (who, what, where, when) so there is still a record of having applied; nothing else survives.
      if(body.confirmDelete!==true||!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-D-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Confirm the deletion of one tracked job.');
      const job=only(body.recordId),applied=!!job.applied||['Applied','Interview','Offer','Hired','Rejected','Withdrawn','Closed'].includes(job.status),history=store.events.filter(e=>e.recordId===job.id).length;
      store.jobs=store.jobs.filter(j=>j.id!==job.id);store.events=store.events.filter(e=>e.recordId!==job.id);out.removed.jobs.push(job.id);
      if(applied)out.removed.traces.push({id:job.id,employer:job.employer,role:job.role,url:job.url,postingId:job.postingId||'',source:job.source||'',status:job.status,applied:job.applied||'',removedAt:now.toISOString()});
      return {reply:{ok:true,deleted:true,recordId:job.id,employer:job.employer,role:job.role,url:job.url,history,kept:applied?'one line':'nothing',at:now.toISOString()},...out};
    }
    if(body.operation==='record-owner-status'){
      if(body.confirmStatus!==true||!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-S-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Confirm a status change for a native record.');
      if(!STATUSES.includes(body.status)||typeof body.expectedStatus!=='string'||body.expectedStatus.length>80||typeof body.expectedApplied!=='string'||body.expectedApplied.length>80||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)throw new Error('Invalid owner status request.');
      if(body.status===body.expectedStatus)throw new Error('Choose a different status.');
      const job=only(body.recordId),tag='[HQ status '+body.requestId+']',details=tag+' Owner requests status '+body.expectedStatus+' → '+body.status+'. Reason: '+body.reason.trim()+'. Application date retained: '+(body.expectedApplied||'(empty)')+'. Owner report; no employer communication independently verified.';
      const existing=store.events.find(e=>String(e.details).startsWith(tag+' '));
      if(existing&&(existing.recordId!==body.recordId||existing.details!==details))throw new Error('Request ID already belongs to different data.');
      if(body.status==='Applied'&&!job.applied)throw new Error('Record Applied with its date using the application control.');
      const receipt=(eventId,duplicate)=>({ok:true,recordId:job.id,eventId,status:job.status,appliedOn:job.applied||'',at:now.toISOString(),duplicate});
      if(existing&&job.status===body.status&&(job.applied||'')===body.expectedApplied)return {reply:receipt(existing.id,true),...out};
      if(job.status!==body.expectedStatus||(job.applied||'')!==body.expectedApplied)throw new Error('This record changed since the request. Its current status and dates were preserved. Refresh and inspect it.');
      const eventId=existing?.id||event(job.id,now.toISOString(),'Other','Candidate',details,'Owner confirmation in private HQ');
      job.status=body.status;touch(job);
      return {reply:receipt(eventId,!!existing),...out};
    }
    if(body.operation==='record-owner-application'||body.operation==='attach-application-evidence'){
      if(!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-A-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Invalid tracked record or request ID.');
      const application=body.operation==='record-owner-application';
      if(application){
        if(body.confirmApplied!==true||typeof body.appliedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.appliedOn)||Number.isNaN(Date.parse(body.appliedOn))||new Date(body.appliedOn).toISOString().slice(0,10)!==body.appliedOn||body.appliedOn>today(now))throw new Error('Confirm an already submitted application and a valid date, today or earlier.');
        if(typeof body.expectedStatus!=='string'||body.expectedStatus.length>80||typeof body.expectedApplied!=='string'||body.expectedApplied.length>80)throw new Error('Refresh the record before recording your application.');
      }else if(!['owner-reference','outlook-receipt','outlook-message'].includes(body.kind)||typeof body.reference!=='string'||body.reference.length<8||body.reference.length>1500)throw new Error('Invalid evidence reference.');
      if(!application&&body.kind.startsWith('outlook-')&&(typeof body.receivedAt!=='string'||Number.isNaN(Date.parse(body.receivedAt))||Date.parse(body.receivedAt)>now.getTime()+300000))throw new Error('A verified email received timestamp is required.');
      const job=only(body.recordId),tag='[HQ application '+body.requestId+']',applied=job.applied||'',held=job.confirmation||'';
      const existing=store.events.find(e=>String(e.details).startsWith(tag+' '));
      const details=tag+' '+(application?'Owner reports an application submitted on '+body.appliedOn+'. Employer confirmation not independently verified. Requested status: '+body.expectedStatus+' → Applied; previous applied date: '+(body.expectedApplied||'(empty)')+'.':'Evidence appended; '+(body.kind==='outlook-receipt'?'receipt read through the private Outlook connection.':body.kind==='outlook-message'?'message read through the private Outlook connection; no outcome inferred.':'owner-provided reference; email contents not independently read.')+' '+body.reference+(body.kind.startsWith('outlook-')?' · original received timestamp '+body.receivedAt:''));
      if(existing&&(existing.recordId!==body.recordId||existing.details!==details))throw new Error('Request ID already belongs to different data.');
      const receipt=eventId=>({ok:true,recordId:job.id,eventId,status:job.status,appliedOn:job.applied||'',at:now.toISOString(),duplicate:!!existing});
      if(application){
        // A retry never regresses a later status or rewrites an already recorded date.
        if(existing&&job.status==='Applied'&&applied===body.appliedOn)return {reply:receipt(existing.id),...out};
        if(existing&&['Interview','Offer','Hired','Rejected','Withdrawn','Closed'].includes(job.status))return {reply:receipt(existing.id),...out};
        if(!['Discovered','Researching','Shortlisted','Preparing','Ready to apply','On hold'].includes(job.status)||applied)throw new Error('Application already recorded or this status cannot be changed to Applied. Existing status and date preserved.');
        if(job.status!==body.expectedStatus||applied!==body.expectedApplied)throw new Error('This record changed since you opened it. Refresh before retrying.');
        const eventId=existing?.id||event(job.id,body.appliedOn,'Submitted','Candidate',details,'Owner confirmation in private HQ');
        job.applied=body.appliedOn;job.appliedDate=body.appliedOn;job.status='Applied';touch(job);
        return {reply:receipt(eventId),...out};
      }
      if(!['Applied','Interview','Offer','Hired','Rejected','Withdrawn','Closed'].includes(job.status)&&!applied)throw new Error('Record your application before attaching application evidence.');
      if(held.includes(tag)){if(!existing)throw new Error('Evidence journal missing. Owner review needed.');return {reply:receipt(existing.id),...out};}
      if((held+'\n'+tag+' '+body.reference).length>45000)throw new Error('Evidence field is at capacity. Existing evidence preserved.');
      const outlook=body.kind.startsWith('outlook-'),eventId=existing?.id||event(job.id,outlook?new Date(body.receivedAt).toISOString():now.toISOString(),body.kind==='outlook-receipt'?'Confirmation':body.kind==='outlook-message'?'Email received':'Other',outlook?'Outlook message / employer':'Candidate',details,body.reference);
      job.confirmation=held+(held?'\n':'')+tag+' '+body.reference;touch(job);
      return {reply:receipt(eventId),...out};
    }
    if(body.operation!=='append-reviewed-discovery'||!/^HQ-W-[a-f0-9-]{36}$/.test(body.workflowId||''))throw new Error('Unsupported append request.');
    const posting=body.job,receipts=body.receipts;
    if(!posting||!Array.isArray(receipts)||receipts.length!==5||receipts.map(r=>r.agentId).join(',')!=='01,02,03,04,00')throw new Error('A complete five-role review trail is required.');
    for(const key of ['title','employer','source','sourceId','url','location'])if(typeof posting[key]!=='string'||!posting[key]||posting[key].length>2000)throw new Error('Invalid discovery fields.');
    if(!/^https:\/\/[^/@\s]+\//.test(posting.url))throw new Error('A public HTTPS source URL is required.');
    receipts.forEach((r,i)=>{if(!/^HQ-R-[a-f0-9-]{36}$/.test(r.id)||r.workflowId!==body.workflowId||r.inputReceipt!==(i?receipts[i-1].id:null)||!Array.isArray(r.findings)||r.findings.length>12)throw new Error('Invalid receipt chain.');});
    const tag='[HQ workflow '+body.workflowId+']';
    let existing=store.jobs.find(j=>String(j.notes||'').includes(tag)),duplicate=false;
    if(!existing){existing=store.jobs.find(j=>urlKey(j.url)===urlKey(posting.url)||(j.source===posting.source&&j.postingId&&String(j.postingId)===posting.sourceId));duplicate=!!existing;}
    let recordId=existing?.id;
    if(!recordId){
      recordId=nextId(store.jobs,'JOB-',3,used.job);const date=today(now),notes=tag+' '+String(body.decision||'Owner review required')+'; '+posting.availability+'; see HQ Workflow Log for role evidence.';
      const job={id:recordId,employer:posting.employer,role:posting.title,location:posting.location,status:'Researching',salary:posting.salary||'Unknown',language:'Needs verification',url:posting.url,found:date,applied:'',foundDate:date,confirmation:'',verified:'Not independently verified',next:'Review source, eligibility and draft before application approval.',due:'',notes:notes.slice(0,45000),source:posting.source,approval:'Pending review',gate:'STOP: approval needed',requirements:undocumented,fit:undocumented,gaps:undocumented,postingId:posting.originalPostingId??(String(posting.sourceId).startsWith('URL-')?'':posting.sourceId)};
      store.jobs.push(job);touch(job);
    }
    const journal=store.events.find(e=>String(e.details).includes(tag)),eventId=journal?.id||event(recordId,now.toISOString(),duplicate?'Research':'Discovered','00 — Recruitment Coordinator',tag+' '+(duplicate?'Existing tracker record matched; role receipts added.':'Reviewed discovery appended as Researching / Pending review. No application submitted.'),posting.url,'Owner review required');
    for(const r of receipts)if(!store.receipts.has(r.id)){store.receipts.add(r.id);out.receipts.push({id:r.id,workflowId:body.workflowId,recordId,agentId:r.agentId,at:String(r.at||''),inputReceipt:r.inputReceipt||'',title:String(r.title||''),method:String(r.method||''),findings:r.findings,decision:String(r.decision||''),url:posting.url});}
    return {reply:{ok:true,recordId,eventId,duplicate,at:now.toISOString()},...out};
  }catch(error){return {reply:{ok:false,error:String(error.message||'The record could not be changed.')},jobs:new Map(),events:[],receipts:[],removed:{jobs:[],traces:[]}};}
}
