import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,Mail,ShieldCheck} from 'lucide-react';
import type {Job,Snapshot} from './data';
import type {ScoutState} from './scout';
import './application-record.css';
import {zone} from './zone';
export type ApplicationReceipt={recordId:string;eventId:string;status:string;appliedOn:string;at:string;duplicate:boolean;source:string};
export function amsterdamToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:zone(),year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function canMarkApplied(job:Job){return /^JOB-\d{3,8}$/.test(job.id)&&!job.applied&&['Discovered','Researching','Shortlisted','Preparing','Ready to apply','On hold'].includes(job.status);}
export function hasApplication(job:Job){return !!job.applied||['Applied','Submitted','Interview','Offer','Hired','Rejected','Withdrawn','Closed'].includes(job.status);}
export async function saveApplication(body:object,fetcher:typeof fetch=fetch){
  const response=await fetcher('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  const value=await response.json() as {saved?:boolean;receipt?:ApplicationReceipt;error?:string;message?:string};
  if(!response.ok||!value.saved||!value.receipt||!/^EVT-\d+$/.test(value.receipt.eventId))throw new Error(value.error||'No verified update received. Refresh before trying again.');
  return value.receipt;
}
export default function ApplicationRecord({job,data,scout,replay=false,onRefresh,initialOpen=false}:{initialOpen?:boolean;job:Job;data:Snapshot;scout:ScoutState;replay?:boolean;onRefresh:()=>Promise<Snapshot|undefined>}){
  const [open,setOpen]=useState(initialOpen),[date,setDate]=useState(amsterdamToday),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<ApplicationReceipt|null>(null),[reference,setReference]=useState(''),[evidenceConfirmed,setEvidenceConfirmed]=useState(false),[notice,setNotice]=useState('');
  const request=useRef<{id:string;payload:string}|null>(null),saving=useRef(false);
  useEffect(()=>{setOpen(initialOpen);setDate(amsterdamToday());setConfirmed(false);setError('');setReceipt(null);setReference('');setEvidenceConfirmed(false);setNotice('');request.current=null;},[job.id]);
  useEffect(()=>{if(data.mode!=='synced'||!scout.protected)return;let stopped=false;fetch('/api/applications?recordId='+encodeURIComponent(job.id),{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)return;const value=await r.json() as {pending?:{requestId:string;action:string;input:Record<string,unknown>}};if(stopped||!value.pending||request.current||saving.current)return;const {operation,requestId,...input}=value.pending.input;request.current={id:value.pending.requestId,payload:JSON.stringify({action:value.pending.action,...input})};setError('An earlier owner-confirmed request still needs readback. Retry this same request to verify or repair it; later statuses will be preserved.');}).catch(()=>{});return()=>{stopped=true;};},[job.id,data.mode,scout.protected]);
  const reason=data.mode==='demo'?'Demo records cannot change your real tracker.':replay?'Leave historical replay before recording an application.':data.stale||data.error?'Refresh the tracker connection before recording a change.':!scout.protected||scout.connectionError?'Owner connection unavailable.':'';
  const locked=!!reason||busy;
  async function save(e:FormEvent,action:'applied'|'evidence',retry=false){
    e.preventDefault();const retryLocked=busy||data.mode!=='synced'||replay||!scout.protected||!!scout.connectionError;if(saving.current||(retry?retryLocked:locked)||retry&&!request.current)return;if(!retry&&(action==='applied'&&(!canMarkApplied(job)||!confirmed)||action==='evidence'&&!evidenceConfirmed))return;
    saving.current=true;setBusy(true);setError('');setNotice('');
    const body=retry?JSON.parse(request.current!.payload):action==='applied'?{action,recordId:job.id,appliedOn:date,expectedStatus:job.status,expectedApplied:job.applied,confirmApplied:true}:{action,recordId:job.id,reference,confirmEvidence:true};
    action=body.action;
    const payload=JSON.stringify(body);if(request.current?.payload!==payload)request.current={id:'HQ-A-'+crypto.randomUUID(),payload};
    try{const saved=await saveApplication({...body,requestId:request.current.id});if(saved.recordId!==job.id)throw new Error('receipt refers to a different vacancy. Refresh before proceeding.');setReceipt(saved);setNotice(action==='applied'?'Applied recorded in the database. Employer confirmation remains separate.':'Email reference saved in the database.');request.current=null;setOpen(false);setReference('');setEvidenceConfirmed(false);const next=await onRefresh();if(!next||next.stale||next.mode!=='synced')setNotice(p=>p+' The view could not refresh; the verified receipt below remains valid.');}
    catch(e){setError(e instanceof Error?e.message:'Confirmation unavailable. Retry the same request or refresh.');}
    finally{saving.current=false;setBusy(false);}
  }
  return <section className="application-record" aria-label="Record your application">
    <p className="eyebrow">YOUR APPLICATION / GOOGLE TRACKER</p><h3>{hasApplication(job)?'Application history':'Already applied yourself?'}</h3>
    <p>Record an application you submitted outside HQ. This updates your tracker in the database; HQ does not send an application.</p>
    {reason&&<p className="quiet">{reason}</p>}
    {error&&<p className="connection-feedback error" role="alert">{error}</p>}{error&&request.current&&<button className="subtle-button" disabled={busy||replay||!scout.protected||!!scout.connectionError} onClick={e=>save(e,JSON.parse(request.current!.payload).action,true)}>Retry the same request</button>}{notice&&<p className="connection-feedback success" role="status">{notice}</p>}
    {receipt&&<div className="application-receipt"><Check size={17}/><div><strong>readback verified</strong><small>{receipt.recordId} · {receipt.eventId} · {new Date(receipt.at).toLocaleString('en-GB',{timeZone:zone()})}</small><span>Tracker status: {receipt.status}{receipt.appliedOn?' · applied '+receipt.appliedOn:''}</span></div></div>}
    {canMarkApplied(job)&&!receipt&&(!open?<button type="button" className="primary-button" disabled={locked} onClick={()=>setOpen(true)}><Check size={16}/>Mark as applied</button>:<form onSubmit={e=>save(e,'applied')}>
      <label className="connection-field">Application date<input type="date" value={date} max={amsterdamToday()} required disabled={locked} onChange={e=>{setDate(e.target.value);setConfirmed(false);}}/></label>
      <p className="quiet">Status → Applied · Applied on → {date||'choose a date'}. Approval and existing evidence are preserved.</p>
      <label className="application-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)}/>I already submitted this application myself.</label>
      <div className="application-buttons"><button className="primary-button" disabled={locked||!confirmed||!date}>{busy?'Saving…':'Confirm applied'}</button><button type="button" className="subtle-button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>
    </form>)}
    {!canMarkApplied(job)&&!hasApplication(job)&&<p className="quiet">This record’s status cannot be changed by this control.</p>}
    {(hasApplication(job)||receipt)&&<details className="application-evidence"><summary><Mail size={16}/>Add an email receipt or reference</summary><p>Paste a subject, date and message link or receipt reference. This is labelled as owner-provided evidence. Existing references remain intact.</p><form onSubmit={e=>save(e,'evidence')}><label className="connection-field">Email evidence<textarea value={reference} minLength={8} maxLength={1500} required rows={3} disabled={locked} onChange={e=>{setReference(e.target.value);setEvidenceConfirmed(false);}}/></label><label className="application-check"><input type="checkbox" checked={evidenceConfirmed} disabled={locked} onChange={e=>setEvidenceConfirmed(e.target.checked)}/>This evidence relates to this vacancy.</label><button className="subtle-button" disabled={locked||!evidenceConfirmed||reference.trim().length<8}>{busy?'Saving…':'Save evidence'}</button></form></details>}
    {job.confirmation&&<div className="recorded-evidence"><span className="eyebrow">EXISTING SUBMISSION REFERENCE</span><p>{job.confirmation}</p></div>}
    <p className="quiet"><ShieldCheck size={14}/>Only owner-confirmed records. Agents 01–04 remain read-only.</p>
  </section>;
}
