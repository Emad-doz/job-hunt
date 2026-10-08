import {useRef,useState} from 'react';
import {Check,Download,Upload} from 'lucide-react';

// One file with everything: for a backup, or for moving to another installation. Keys and passwords are never in it.
export default function Transfer({show}:{show:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[file,setFile]=useState<File|null>(null),[replace,setReplace]=useState(false),input=useRef<HTMLInputElement>(null);
  async function bring(){
    if(!file)return;setBusy(true);setError('');setNotice('');
    try{const r=await fetch('/api/transfer?confirm=1'+(replace?'&replace=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:file,signal:AbortSignal.timeout(120000)}),v=await r.json() as {error?:string;message?:string;occupied?:boolean};
      if(v.occupied){setReplace(true);setError(v.error||'This installation already holds records.');return;}
      if(!r.ok||v.error)throw new Error(v.error||'The import failed. Nothing was changed.');
      setNotice((v.message||'Imported.')+' Reload the page to see everything.');setFile(null);setReplace(false);if(input.current)input.current.value='';
    }catch(e){setError(e instanceof Error?e.message:'The import failed. Nothing was changed.');}finally{setBusy(false);}
  }
  if(!show)return null;
  return <section className="scout-view" id="transfer"><article className="source-card"><header><Download size={23}/><div><p className="eyebrow">MOVE OR BACK UP</p><h3>Everything in one file</h3></div></header>
    <p>An export holds your jobs and their history, your CV file, photo and details, your discoveries and your settings. Keys, passwords and mailbox sign-ins are never part of it. The file is not encrypted: keep it where you keep your CV.</p>
    {error&&<div className="connection-feedback error" role="alert">{error}</div>}{notice&&<div className="connection-feedback success" role="status"><Check size={17}/>{notice} <button type="button" className="text-button" onClick={()=>window.location.reload()}>Reload now</button></div>}
    <div className="scout-actions source-actions"><a className="subtle-button" href="/api/transfer" download>Download an export <Download size={15}/></a></div>
    <details className="daily-search-controls"><summary>Import an export file</summary>
      <p>Importing replaces the jobs, history, CV, discoveries and settings of this installation with the ones in the file. The keys you entered here are kept.</p>
      <label className="connection-field">Export file<input ref={input} type="file" accept="application/json,.json" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);setReplace(false);setError('');setNotice('');}}/></label>
      <div className="scout-actions source-actions"><button type="button" className="subtle-button" disabled={busy||!file} onClick={bring}>{busy?'Importing…':replace?'Confirm: replace what is here':'Import this file'} <Upload size={15}/></button>{replace&&!busy&&<button type="button" className="text-button" onClick={()=>{setReplace(false);setError('');}}>Cancel</button>}</div></details>
  </article></section>;
}
