import type {ScoutState} from './scout';
import {feedbackIdentity} from './owner-feedback-model';
export type OwnerStatus={id:string;key:string;jobId:string;status:string;reason:string;at:string;source:string;history:{id:string;status:string;reason:string;at:string}[]};
export function ownerStatusFor(state:ScoutState,url:string,id:string){if(!state.protected)return undefined;return state.ownerStatuses?.[feedbackIdentity(url)]||Object.values(state.ownerStatuses||{}).find(x=>x.jobId===id);}
export async function savePlanningStatus(body:object,fetcher:typeof fetch=fetch){const r=await fetcher('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'planning-status',...body}),signal:AbortSignal.timeout(20000)}),v=await r.json() as {saved?:boolean;status?:OwnerStatus;error?:string};if(!r.ok||!v.saved||!v.status?.id)throw new Error(v.error||'No saved planning status confirmed.');return v.status;}
