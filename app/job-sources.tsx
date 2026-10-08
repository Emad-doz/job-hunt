import {useEffect,useState,type FormEvent} from 'react';
import {Briefcase,Check,ExternalLink} from 'lucide-react';
import type {ScoutState} from './scout';
import {zone} from './zone';

export type JSearchState={configured:boolean;monthlyLimit:number;country:string;usedThisMonth:number;last:null|{status:string;at:string;count:number;error:string|null;queries?:{term:string;count:number;error:string|null}[]}};
const stamp=(at:string|null|undefined)=>at?new Date(at).toLocaleString('en-GB',{timeZone:zone(),day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'not yet';
// A second vacancy source beside Adzuna: Google for Jobs postings with their full text.
export default function JSearchSettings({state,refresh}:{state:ScoutState;refresh:()=>Promise<void>}){
  const source=state.jsearch,[apiKey,setApiKey]=useState(''),[country,setCountry]=useState(source?.country||'nl'),[limit,setLimit]=useState(source?.monthlyLimit||190),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{if(source){setCountry(source.country);setLimit(source.monthlyLimit);}},[source?.country,source?.monthlyLimit]);
  const locked=!state.protected||!!state.connectionError||busy||state.status==='running';
  async function send(body:object){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'jsearch-settings',...body}),signal:AbortSignal.timeout(60000)}),result=await response.json() as {error?:string;message?:string};if(!response.ok)throw new Error(result.error||'Settings could not be saved.');setNotice(result.message||'Saved.');setApiKey('');await refresh();}catch(e){setError(e instanceof Error?e.message:'Settings could not be saved.');}finally{setBusy(false);}}
  const save=(e:FormEvent)=>{e.preventDefault();send({apiKey,country,monthlyLimit:limit});};
  return <section className="scout-view"><article className="source-card"><header><Briefcase size={23}/><div><p className="eyebrow">VACANCY SOURCE · OPTIONAL</p><h3>Google for Jobs · JSearch</h3></div><span className="badge">{source?.configured?'Key saved':'Key needed'}</span></header>
    <p>Reads Google for Jobs, which gathers postings from LinkedIn, Indeed, Glassdoor and employers' own sites, through the JSearch API. Postings arrive with their full description and a link to the posting. Only your role searches and search area are sent; your CV is not.</p>
    {error&&<div className="connection-feedback error" role="alert">{error}</div>}{notice&&<div className="connection-feedback success" role="status"><Check size={17}/>{notice}</div>}
    <form onSubmit={save}><label className="connection-field">JSearch API key<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} required={!source?.configured} placeholder={source?.configured?'Saved · leave blank to keep':'Enter directly here; never in chat'} disabled={locked}/></label>
    <div className="scout-search-fields"><label className="connection-field">Monthly request limit<input type="number" min={10} max={10000} value={limit} onChange={e=>setLimit(Number(e.target.value))} disabled={locked}/></label><label className="connection-field">Country<input value={country} onChange={e=>setCountry(e.target.value)} maxLength={2} disabled={locked}/></label></div>
    <div className="scout-actions source-actions"><button className="subtle-button" disabled={locked}>Save JSearch source <Check size={15}/></button>{source?.configured&&<button type="button" className="text-button" disabled={locked} onClick={()=>send({remove:true})}>Remove key</button>}</div></form>
    <p className="quiet">{source?`${source.usedThisMonth} of ${source.monthlyLimit} requests used this month. `:''}Used when you press Find jobs and at most once a day by the hourly check. Each role search is one request and returns up to ten postings; the free plan allows 200 requests a month.</p>
    {source?.last&&<details className="daily-search-controls"><summary>Last JSearch check · {stamp(source.last.at)} · {source.last.count} postings{source.last.error?' · needs attention':''}</summary>{source.last.error&&<p>{source.last.error}</p>}{source.last.queries?.map((q,i)=><p key={i}>{q.term} · {q.error||q.count+' returned postings'}</p>)}</details>}
    <a href="https://www.openwebninja.com/api/jsearch" className="text-button" target="_blank" rel="noreferrer">Get a JSearch key from OpenWeb Ninja <ExternalLink size={14}/></a></article></section>;
}
