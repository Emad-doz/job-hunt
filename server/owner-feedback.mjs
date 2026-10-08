import {canonical} from './sources.mjs';
export function feedbackKey(job){return canonical(job.url)?'URL:'+canonical(job.url):job.id;}
export function saveFeedback(config,job,body,at){
 if(!['not-fit','review'].includes(body.decision)||!/^HQ-F-[a-f0-9-]{36}$/.test(body.requestId||''))throw new Error('Choose a supported owner decision.');
 const reason=String(body.reason||'').trim();if(reason.length>600||body.decision==='not-fit'&&!reason)throw new Error('Choose a reason of up to 600 characters.');
 const key=feedbackKey(job),feedback=config.ownerFeedback||{},old=feedback[key],history=old?.history||[];
 const duplicate=[...(old?[old]:[]),...history].find(f=>f.id===body.requestId);if(duplicate){if(duplicate.decision!==body.decision||duplicate.reason!==reason)throw new Error('This feedback request belongs to different data.');return {config,feedback:old,duplicate:true};}
 if((old?.id||'')!==String(body.expectedId||''))throw new Error('Your decision changed in another view. Refresh before saving.');
 if(!old&&Object.keys(feedback).length>=1500)throw new Error('The private feedback workbench is full. Existing decisions are retained.');
 const next={id:body.requestId,key,jobId:job.id,recordId:job.recordId||null,decision:body.decision,reason,at,source:'Owner preference · private HQ',history:old?[{id:old.id,decision:old.decision,reason:old.reason,at:old.at},...history].slice(0,9):[]};
 return {config:{...config,ownerFeedback:{...feedback,[key]:next}},feedback:next,duplicate:false};
}
