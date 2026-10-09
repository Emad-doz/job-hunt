import {feedbackKey} from './owner-feedback.mjs';
export const planningStatuses=['Discovered','Researching','Shortlisted','Preparing','Ready to apply','On hold','Closed'];
export function savePlanningStatus(config,job,body,at){
 if(!planningStatuses.includes(body.status)||!/^HQ-P-[a-f0-9-]{36}$/.test(body.requestId||'')||body.confirmStatus!==true)throw new Error('Confirm a supported planning status.');
 const reason=typeof body.reason==='string'?body.reason.trim():'';if(reason.length<3||reason.length>500)throw new Error('Record a reason of 3–500 characters.');
 const key=feedbackKey(job),statuses=config.ownerStatuses||{},old=statuses[key],history=old?.history||[],same=[...(old?[old]:[]),...history].find(x=>x.id===body.requestId);
 if(same){if(same.status!==body.status||same.reason!==reason)throw new Error('This request ID belongs to different data.');return {config,status:old,duplicate:true};}
 if((old?.id||'')!==(body.expectedId||''))throw new Error('Planning status changed in another view. Refresh before saving.');
 if(!old&&Object.keys(statuses).length>=1500)throw new Error('Owner status history is at capacity.');
 const status={id:body.requestId,key,jobId:job.id,status:body.status,reason,at,source:'Owner planning decision · private HQ',history:old?[{id:old.id,status:old.status,reason:old.reason,at:old.at},...history].slice(0,9):[]};
 return {config:{...config,ownerStatuses:{...statuses,[key]:status}},status,duplicate:false};
}
