import type {Snapshot} from './data';
import type {ReviewWorkflow} from './workflow';
import {canSaveDiscovery,applicationRecorded} from './daily-model';
import {saveApplication,canMarkApplied,type ApplicationReceipt} from './application-record';
import type {OwnerFeedback} from './owner-feedback-model';
export {ownerFeedbackFor} from './owner-feedback-model';
export async function requestOwnerFeedback(body:object,fetcher:typeof fetch=fetch){const r=await fetcher('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'feedback',...body}),signal:AbortSignal.timeout(45000)}),v=await r.json() as {saved?:boolean;feedback?:OwnerFeedback;error?:string};if(!r.ok||!v.saved||!v.feedback?.id)throw new Error(v.error||'No saved owner preference confirmed.');return v.feedback;}
export type DiscoveryApplicationAttempt={requestId:string;appliedOn:string;input?:object};
export async function recordDiscoveryApplication(workflow:ReviewWorkflow,attempt:DiscoveryApplicationAttempt,fetcher:typeof fetch=fetch):Promise<{recordId:string;receipt?:ApplicationReceipt;alreadyRecorded?:boolean}>{
 if(!canSaveDiscovery(workflow)&&!workflow.tracker)throw new Error('This discovery needs an eligible, current review before it can be added from HQ.');
 const appended=await fetcher('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'append',workflowId:workflow.id,confirmReviewed:true}),signal:AbortSignal.timeout(60000)}),v=await appended.json() as {saved?:boolean;receipt?:{recordId:string};error?:string};
 if(!appended.ok||!v.saved||!/^JOB-\d{3,8}$/.test(v.receipt?.recordId||''))throw new Error(v.error||'No verified discovery append received. Retry the same review; it will not create a duplicate.');
 const recordId=v.receipt!.recordId;
 if(!attempt.input){const read=await fetcher('/api/snapshot',{cache:'no-store',signal:AbortSignal.timeout(20000)}),snapshot=await read.json() as Snapshot;if(!read.ok||snapshot.mode!=='synced'||snapshot.stale)throw new Error('The discovery was saved, but a fresh tracker record could not be read. Retry to finish recording Applied.');const job=snapshot.jobs.find(j=>j.id===recordId);if(!job)throw new Error('Saved tracker ID not visible yet. Retry to finish recording Applied.');
  if(applicationRecorded(job))return {recordId,alreadyRecorded:true};if(!canMarkApplied(job))throw new Error('The tracker already has a later or closed status. Its outcome was preserved; inspect the tracker.');
  attempt.input={action:'applied',requestId:attempt.requestId,recordId,appliedOn:attempt.appliedOn,expectedStatus:job.status,expectedApplied:job.applied,confirmApplied:true};
 }
 const receipt=await saveApplication(attempt.input,fetcher);if(receipt.recordId!==recordId)throw new Error('Application receipt refers to a different vacancy. Refresh the tracker.');return {recordId,receipt};
}
