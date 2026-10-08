import {sendRecord} from './workflow.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export const statusOptions=['Discovered','Researching','Shortlisted','Preparing','Ready to apply','Applied','Interview','Offer','Hired','Rejected','Withdrawn','Closed','On hold'];
export function statusInput(body){
 if(body.confirmStatus!==true||!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-S-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Confirm a status choice for an existing tracker record.');
 if(!statusOptions.includes(body.status)||typeof body.expectedStatus!=='string'||body.expectedStatus.length>80||typeof body.expectedApplied!=='string'||body.expectedApplied.length>80)throw new Error('Choose a supported tracker status and refresh the record.');
 const reason=typeof body.reason==='string'?body.reason.trim():'';if(reason.length<3||reason.length>500)throw new Error('Record a reason or evidence reference of 3–500 characters.');
 if(body.status==='Applied'&&!body.expectedApplied)throw new Error('Use the application control to record Applied with its date.');
 if(body.status===body.expectedStatus)throw new Error('Choose a different status.');
 return {operation:'record-owner-status',recordId:body.recordId,requestId:body.requestId,status:body.status,expectedStatus:body.expectedStatus,expectedApplied:body.expectedApplied,reason,confirmStatus:true};
}
export async function statusCapabilities(config,fetcher=fetch){
 let response;try{response=await sendRecord(fetcher,{operation:'read-status-capabilities'});}catch{throw new Error('The database could not be reached. No write was started.');}
 if(!response.ok)throw new Error('The database could not be reached.');// An Apps Script deployment older than the status version answers with an error page instead of JSON.
 let v;try{v=await response.json();}catch{return {available:false,statuses:[],message:'The database did not answer the status check. No status write was started.'};}
 if(!v.ok){if(/Unsupported append request/.test(v.error||''))return {available:false,statuses:[],message:'The existing Database needs the owner status update version. No status write was started.'};throw new Error(v.error||'tracker status readback failed.');}
 if(v.version!=='owner-status-v1'||!Array.isArray(v.statuses)||!v.statuses.length||v.statuses.some(s=>!statusOptions.includes(s)))throw new Error('Unrecognized tracker status capability.');return {available:true,statuses:v.statuses};
}
export function applicationInput(body){
  if(body.confirmApplied!==true)throw new Error('Confirm that you have already submitted this application yourself.');
  if(!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-A-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('A tracked JOB record and application request ID are required.');
  const date=body.appliedOn;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Choose a valid application date.');
  if(typeof body.expectedStatus!=='string'||body.expectedStatus.length>80||typeof body.expectedApplied!=='string'||body.expectedApplied.length>80)throw new Error('Refresh this tracked vacancy before recording your application.');
  return {operation:'record-owner-application',recordId:body.recordId,requestId:body.requestId,appliedOn:date,expectedStatus:body.expectedStatus,expectedApplied:body.expectedApplied,confirmApplied:true};
}
export function evidenceInput(body){
  if(body.confirmEvidence!==true||!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-A-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Confirm the evidence for this tracked vacancy.');
  const reference=String(body.reference||'').trim();
  if(reference.length<8||reference.length>1500)throw new Error('Enter an email reference or receipt summary of 8–1500 characters.');
  // Browser input can never claim that the server independently read an email.
  return {operation:'attach-application-evidence',recordId:body.recordId,requestId:body.requestId,reference,kind:'owner-reference',confirmEvidence:true};
}
export async function applicationBridge(input,config,fetcher=fetch){
  
  let response;
  try{response=await sendRecord(fetcher,{...input});}catch{throw new Error('Confirmation unavailable. A write may have been saved; retry this same request or refresh before acting again.');}
  if(!response.ok)throw new Error('Database unavailable. No completed update confirmed; refresh or retry this same request.');
  let value;try{value=await response.json();}catch{throw new Error('No readback received. Refresh or retry this same request.');}
  if(!value.ok){if(/Unsupported append request/.test(value.error||''))throw new Error('The database refused this kind of update. No successful update confirmed.');throw new Error(value.error||'No update confirmed.');}
  if(value.recordId!==input.recordId||!/^EVT-\d+$/.test(value.eventId||'')||typeof value.status!=='string'||typeof value.at!=='string'||input.operation==='record-owner-status'&&value.status!==input.status)throw new Error('The database returned an incomplete receipt. Refresh or retry this same request.');
  return {recordId:value.recordId,eventId:value.eventId,status:value.status,appliedOn:value.appliedOn||'',at:value.at,source:'HQ database',duplicate:!!value.duplicate};
}
export function createApplications(connections,environment,{fetcher=fetch}={}){
  return {async handle(request){
    if(!environment.HQ_ACCESS_PASSWORD)return json({error:'Owner sign-in is required to record an application.'},403);
    if(request.method==='GET'){
      if(new URL(request.url).searchParams.get('capabilities')==='status'){try{return json(await statusCapabilities((await connections.settings()).SCOUT_CONFIG||{},fetcher));}catch(error){return json({error:error.message},503);}}
      const id=new URL(request.url).searchParams.get('recordId');if(!/^JOB-\d{3,8}$/.test(id||''))return json({error:'Select a tracked record.'},400);
      try{const c=(await connections.settings()).SCOUT_CONFIG||{},action=new URL(request.url).searchParams.get('action'),pending=(c.applicationRequests||[]).find(x=>x.input.recordId===id&&(action==='status'?x.action==='status':x.action!=='status'));return json({pending:pending?{requestId:pending.input.requestId,action:pending.action,input:pending.input,requestedAt:pending.requestedAt}:null});}catch{return json({error:'Pending application confirmation unavailable.'},503);}
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    try{const origin=new URL(request.headers.get('origin')),expected=new URL(environment.HQ_PUBLIC_ORIGIN||request.url);if(origin.origin!==expected.origin||origin.host!==request.headers.get('host'))throw new Error();}catch{return json({error:'Application records require a same-origin request.'},403);}
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON content required'},415);
    try{
      const body=await request.json(),input=body.action==='applied'?applicationInput(body):body.action==='evidence'?evidenceInput(body):body.action==='status'?statusInput(body):null;
      if(body.action==='resolve-status'){
        if(body.confirmCurrent!==true||!/^JOB-\d{3,8}$/.test(body.recordId||'')||!/^HQ-S-[a-f0-9-]{36}$/.test(body.requestId||'')||typeof body.currentStatus!=='string'||typeof body.currentApplied!=='string'||body.currentStatus.length>80||body.currentApplied.length>80)throw new Error('Confirm the latest visible tracker record before resolving a pending request.');
        const c=(await connections.settings()).SCOUT_CONFIG||{},pending=(c.applicationRequests||[]).find(x=>x.action==='status'&&x.input.recordId===body.recordId&&x.input.requestId===body.requestId);if(!pending)throw new Error('No matching status request is pending. Refresh this job.');
        
        let response;try{response=await sendRecord(fetcher,{operation:'read-application-record',recordId:body.recordId});}catch{throw new Error('readback unavailable; the earlier request is retained.');}
        const record=await response.json();if(!response.ok||!record.ok||record.recordId!==body.recordId||typeof record.status!=='string'||typeof record.appliedOn!=='string')throw new Error('Fresh tracker record could not be verified. The earlier request is retained.');
        if(record.status!==body.currentStatus||record.appliedOn!==body.currentApplied)throw new Error('The record differs from what you see. Refresh before keeping its current status.');
        if(record.status===pending.input.expectedStatus&&record.appliedOn===pending.input.expectedApplied)throw new Error('The record still has its original state. Retry the same request to verify or repair it.');
        await connections.updateScout(current=>{const existing=(current.applicationRequests||[]).find(x=>x.input.requestId===body.requestId);if(!existing||JSON.stringify(existing.input)!==JSON.stringify(pending.input))throw new Error('Pending request changed. Refresh before resolving it.');return {...current,applicationRequests:current.applicationRequests.filter(x=>x.input.requestId!==body.requestId),resolvedStatusRequests:[...(current.resolvedStatusRequests||[]),{requestId:body.requestId,recordId:body.recordId,status:record.status,appliedOn:record.appliedOn,at:new Date().toISOString(),source:'Owner kept fresh readback; earlier request completion not inferred'}].slice(-20)};});
        return json({resolved:true,recordId:record.recordId,status:record.status,appliedOn:record.appliedOn,message:'Current tracker status retained. No write was performed; the earlier pending request was released.'});
      }
      if(!input)throw new Error('Unsupported application action.');
      // Retain the exact owner-confirmed request, without its secret, before any
      // write. Reloading the page can then repair an uncertain result.
      const c=(await connections.settings()).SCOUT_CONFIG||{};
      // An earlier request for this job that never got its confirmation would block every later change. If the database no longer shows the record that request started from, it has been overtaken: release it and carry on. No write is made for it.
      const leftover=(c.applicationRequests||[]).filter(x=>x.input.recordId===input.recordId&&x.input.requestId!==input.requestId);
      if(leftover.length&&leftover.every(x=>Date.now()-Date.parse(x.requestedAt)>120000)){
        let record=null;try{const response=await sendRecord(fetcher,{operation:'read-application-record',recordId:input.recordId}),value=await response.json();if(response.ok&&value.ok&&value.recordId===input.recordId&&typeof value.status==='string'&&typeof value.appliedOn==='string')record=value;}catch{}
        if(!record)throw new Error('An earlier change for this job was never confirmed, and the record could not be read to check it. Try again in a moment.');
        if(leftover.some(x=>record.status===x.input.expectedStatus&&record.appliedOn===x.input.expectedApplied))throw new Error('An earlier change for this job from '+leftover[0].requestedAt.slice(0,10)+' was never confirmed and the database still shows the record as it was before it. Retry that change first: open the job and use the same control again.');
        const released=leftover.map(x=>x.input.requestId);
        await connections.updateScout(current=>({...current,applicationRequests:(current.applicationRequests||[]).filter(x=>!released.includes(x.input.requestId)),resolvedStatusRequests:[...(current.resolvedStatusRequests||[]),...leftover.map(x=>({requestId:x.input.requestId,recordId:input.recordId,status:record.status,appliedOn:record.appliedOn,at:new Date().toISOString(),source:'Released automatically: the record had moved on from the record this unconfirmed '+x.action+' request started from'}))].slice(-20)}));
      }
      await connections.updateScout(current=>{const pending=current.applicationRequests||[],same=pending.find(x=>x.input.requestId===input.requestId);if(same&&JSON.stringify(same.input)!==JSON.stringify(input))throw new Error('This request ID belongs to different application data.');if(!same&&pending.some(x=>x.input.recordId===input.recordId))throw new Error('This job has an earlier request awaiting readback. Verify that request before another change.');if(!same&&pending.length>=20)throw new Error('Verify the pending requests before recording more.');return {...current,applicationRequests:same?pending:[...pending,{action:body.action,input,requestedAt:new Date().toISOString()}]};});
      const receipt=await applicationBridge(input,(await connections.settings()).SCOUT_CONFIG||{},fetcher);
      let pendingClear=true;try{await connections.updateScout(current=>({...current,applicationRequests:(current.applicationRequests||[]).filter(x=>x.input.requestId!==input.requestId)}));}catch{pendingClear=false;}
      return json({saved:true,receipt,pendingClear,message:body.action==='status'?'Owner-confirmed status recorded in the database. Dates and evidence were retained.':body.action==='applied'?'Application recorded in the database. This is your report; employer confirmation remains separate.':'Evidence reference added to the database. Existing references and application status were preserved.'});
    }catch(error){return json({error:error.message||'No update confirmed.'},400);}
  }};
}
