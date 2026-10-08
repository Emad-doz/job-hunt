import {useEffect,useState} from 'react';
import {ArrowUpRight,Check,Link2,LockKeyhole,Info} from 'lucide-react';
import type {Snapshot} from './data';
import type {ScoutState} from './scout';
import {OutlookConnection} from './mail';
import DatabaseSettings,{type DatabaseState} from './database-settings';
import Transfer from './transfer';

type Step={title:string;done:boolean;optional?:boolean;text:string;action?:{label:string;go:()=>void}};
// Setup: the steps first, each with its real state, then the two connections that are made on this page.
export default function Connections({data,scout,onProfile,onSearch}:{data:Snapshot;scout:ScoutState;onProfile:()=>void;onSearch:()=>void}){
  const [signedIn,setSignedIn]=useState<boolean|null>(null),[error,setError]=useState(''),[database,setDatabase]=useState<DatabaseState|null>(null),[cv,setCv]=useState<{stored:boolean;details:boolean}|null>(null),[mail,setMail]=useState<boolean|null>(null);
  useEffect(()=>{let stopped=false;
    fetch('/api/connections',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{const v=await r.json() as {protected?:boolean;error?:string};if(stopped)return;if(!r.ok)throw new Error(v.error||'Settings unavailable.');setSignedIn(!!v.protected);}).catch(e=>{if(!stopped){setSignedIn(false);setError(e instanceof Error?e.message:'Settings unavailable.');}});
    fetch('/api/mail',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json() as Promise<{connected?:boolean}>:null).then(v=>{if(!stopped&&v)setMail(!!v.connected);}).catch(()=>{});
    return()=>{stopped=true;};},[]);
  useEffect(()=>{if(!database?.ready){setCv(null);return;}let stopped=false;fetch('/api/profile',{cache:'no-store',signal:AbortSignal.timeout(20000)}).then(r=>r.ok?r.json() as Promise<{ready?:boolean;cv?:object|null;profile?:{name?:string;experience?:unknown[]}}>:null).then(v=>{if(!stopped&&v?.ready)setCv({stored:!!v.cv,details:!!(v.profile?.name||v.profile?.experience?.length)});}).catch(()=>{});return()=>{stopped=true;};},[database?.ready]);
  const locked=signedIn===false,toDatabase=()=>document.getElementById('database')?.scrollIntoView({behavior:'smooth'}),toMail=()=>document.getElementById('mail')?.scrollIntoView({behavior:'smooth'});
  const area=!!scout.location&&!!scout.country,sources=!!scout.adzunaConfigured||!!scout.jsearch?.configured,model=!!scout.ai?.enabled;
  const steps:Step[]=[
    {title:'Set your password and sign in',done:signedIn===true,text:signedIn?'You are signed in. Everything below is private to you.':'Copy .env.example to .env, set HQ_ACCESS_PASSWORD to a password of at least 20 characters, and start the app again. Sign in with the user name owner.'},
    {title:'Your database',done:!!database?.ready,text:database?.ready?(database.kind==='local'?'Your records are kept in a file on this machine. Nothing to set up.':'Your records are kept in your MySQL database.')+(data.mode==='synced'?' '+data.jobs.length+' jobs so far.':''):'The MySQL connection is saved but has not passed a test yet.',action:{label:'View',go:toDatabase}},
    {title:'Add your CV',done:!!cv?.stored&&!!cv?.details,text:cv?.stored&&cv?.details?'Your CV file is stored and your details are filled in.':cv?.stored?'Your CV file is stored. Fill in your details, or let the model fill them from the file.':'Upload your CV as a PDF and fill in your details. Screening and CV downloads use them.',action:{label:'Open My CV',go:onProfile}},
    {title:'Say where you search',done:area,text:area?'Searching around '+scout.location+' ('+String(scout.country).toUpperCase()+').':'Enter your town or region and your country, and the roles you look for.',action:{label:'Search settings',go:onSearch}},
    {title:'Connect a vacancy source',done:sources,text:sources?'A vacancy source is connected.':'Add a key for JSearch (Google for Jobs) or Adzuna. Both have a free plan; the README explains where to get one. Employer career pages can be added without any key.',action:{label:'Search settings',go:onSearch}},
    {title:'Switch on the AI model',done:model,optional:true,text:model?'Enabled. Screening by your CV, assessments, motivation drafts, filling your CV details and adapting your CV can use it; each is a paid request you start.':'Optional. With your own Anthropic API key the Analyst screens jobs by your CV and the Writer can fill in and adapt your CV. Without it, screening uses simple rules.',action:{label:'Search settings',go:onSearch}},
    {title:'Connect your mailbox',done:mail===true,optional:true,text:mail?'Outlook is connected, read-only. Check for replies reads recent mail when you press it.':'Optional, Outlook or Hotmail for now. Lets the Tracker read replies to your applications when you ask it to. It can never send mail.',action:{label:mail?'View':'Set up',go:toMail}},
  ];
  const next=steps.find(s=>!s.done&&!s.optional);
  return <section className="connections-view">
    <div className="connections-intro"><span className="connection-emblem"><Link2 size={28}/></span><div><p className="eyebrow">SETUP</p><h2>{next?'Next step: '+next.title:'Everything needed is set up.'}</h2><p>Everything runs on your own machine and your records stay in your own database. These are the steps to a working setup, with what is done and what is still open.</p></div></div>
    {error&&<div className="connection-feedback error" role="alert"><Info size={18}/><p>{error}</p></div>}
    {locked&&<div className="owner-lock"><LockKeyhole size={21}/><div><strong>Set a password to use your own data.</strong><p>Copy <code>.env.example</code> to <code>.env</code>, set <code>HQ_ACCESS_PASSWORD</code> to a password of at least 20 characters, and start the app again. Sign in with the user name <code>owner</code>. Your saved keys are encrypted with this password, so keep it the same. Until then this is a demo with fictional records.</p></div></div>}
    <ol className="setup-steps">{steps.map((s,i)=><li key={s.title} className={s.done?'done':s===next?'next':''}><span className="setup-mark" aria-hidden="true">{s.done?<Check size={15}/>:i+1}</span><div><strong>{s.title}{s.optional&&<em>optional</em>}</strong><p>{s.text}</p></div>{s.action&&!locked&&<button className={s===next?'subtle-button':'text-button'} onClick={s.action.go}>{s.action.label} <ArrowUpRight size={14}/></button>}</li>)}</ol>
    <DatabaseSettings onChange={setDatabase}/>
    <Transfer show={!!database?.protected}/>
    <div id="mail"><OutlookConnection/></div>
  </section>;
}
