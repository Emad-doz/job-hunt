import {useEffect,useRef,useState} from 'react';
import {Layers3,Radio,RefreshCw} from 'lucide-react';
import type {ScoutState} from './scout';
import './review-launch.css';
import {zone} from './zone';

export const REVIEW_ALERT_MS=14000;
export function canRunReview(state:ScoutState,replay:boolean,busy:boolean){return state.protected&&!state.connectionError&&!replay&&!busy&&state.status!=='running'&&state.results.some(j=>!j.stale);}
export async function requestEvidenceReview(fetcher:typeof fetch=fetch){
  const response=await fetcher('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review'}),signal:AbortSignal.timeout(60000)});
  const result=await response.json() as {error?:string;message?:string;started?:boolean};
  if(!response.ok)throw new Error(result.error||'The review request could not be accepted.');
  if(response.status!==202||result.started!==true)throw new Error('No accepted review request was confirmed. Refresh the task connection before trying again.');
  return result.message||'Review requested for saved discoveries.';
}
export function useReviewLaunch(state:ScoutState,refresh:()=>Promise<void>){
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[alertUntil,setAlertUntil]=useState(0);
  const inFlight=useRef(false),lastBatch=useRef<string|null|undefined>(undefined);
  useEffect(()=>{if(!state.protected||state.connectionError)return;const batch=state.reviewRun?.startedAt||null;
    if(state.reviewRun?.status==='failed'){lastBatch.current=batch;setAlertUntil(0);return;}
    if(lastBatch.current===undefined){lastBatch.current=batch;if(state.reviewRun?.status==='running'&&state.status==='running'&&!!state.activeAgent)setAlertUntil(Date.now()+REVIEW_ALERT_MS);return;}
    if(batch&&batch!==lastBatch.current){lastBatch.current=batch;setAlertUntil(until=>until>Date.now()?until:Date.now()+REVIEW_ALERT_MS);}else lastBatch.current=batch;
  },[state.protected,state.connectionError,state.reviewRun?.startedAt,state.reviewRun?.status]);
  useEffect(()=>{if(!alertUntil)return;const timer=setTimeout(()=>setAlertUntil(0),Math.max(0,alertUntil-Date.now()));return()=>clearTimeout(timer);},[alertUntil]);
  async function run(replay:boolean){
    if(inFlight.current||!canRunReview(state,replay,busy))return;
    inFlight.current=true;setBusy(true);setNotice('');setError('');
    try{const message=await requestEvidenceReview();setNotice(message);setAlertUntil(Date.now()+REVIEW_ALERT_MS);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Review connection unavailable.');await refresh();}
    finally{inFlight.current=false;setBusy(false);}
  }
  return {busy,notice,error,alerting:alertUntil>0&&!state.connectionError&&state.protected,run};
}
type ControlProps={state:ScoutState;replay:boolean;busy:boolean;alerting:boolean;notice:string;error:string;onRun:()=>void;still:boolean;showButton?:boolean};
export function HomeReviewControl({state,replay,busy,alerting,notice,error,onRun,still,showButton=true}:ControlProps){
  const available=canRunReview(state,replay,busy);
  const reason=replay?'Close historical replay to run a current review.':!state.protected?'Sign in to review real discoveries.':state.connectionError?'Reconnect to the task runner before requesting a review.':state.status==='running'?'A verified HQ task is running.':!state.results.some(j=>!j.stale)?'Check Scout sources for current discoveries first.':'Review saved discoveries against your linked CV, then prepare drafts and Manager feedback where suitable.';
  const batch=state.reviewRun;
  return <section className={'home-review-control '+(alerting?'office-alert ':'')+(still?'alert-still':'')} aria-label="Headquarters review controls"><div className="home-review-main"><div><p className="eyebrow">YOUR NEXT REVIEW</p><strong>Bring the review team to their desks.</strong><p>{reason}</p></div>{showButton&&<button className="primary-button" onClick={onRun} disabled={!available} aria-label="Let's start reviewing">{busy?<RefreshCw className="review-request-spinner" size={17}/>:<Layers3 size={17}/>} {busy?'Requesting review…':"Let's start reviewing"}</button>}</div>
    {alerting&&<div className="home-review-alert" role="status"><Radio size={16}/><span>Review request accepted · team returning to desks. Studio animation; real task status is on each monitor.</span></div>}
    {error&&<p className="home-review-error" role="alert">{error}</p>}{notice&&!error&&<p className="home-review-notice" role="status">{notice}</p>}
    {batch&&<p className="home-review-summary" role="status">{batch.status==='running'?'Verified review in progress.':batch.status==='failed'?'Last review failed: '+batch.error:`Last review: ${batch.prepared} new versions · ${batch.held} Analyst holds · ${batch.unchanged} unchanged`}{batch.finishedAt?' · '+new Date(batch.finishedAt).toLocaleString('en-GB',{timeZone:zone()}):''}</p>}
  </section>;
}
