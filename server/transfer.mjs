// Moving everything between installations, or keeping a backup: one file with the records, the CV, the photo and the settings. Keys, passwords and sign-in tokens are never in it; they are entered again after an import.
import {storeFor} from './store.mjs';
import {EXPORT_FORMAT,EXPORT_VERSION,exportFile,portableSettings} from './export-data.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
// The shape an import must have. Anything else is refused before a single row is touched.
export function readExport(value){
  if(!value||typeof value!=='object'||value.format!==EXPORT_FORMAT)throw new Error('This is not a Job Hunt export file.');
  if(value.version!==EXPORT_VERSION)throw new Error('This export was made by a different version and cannot be read by this one.');
  const records=value.records||{},cv=value.cv||{},list=name=>{const items=records[name]??[];if(!Array.isArray(items))throw new Error('The export file is damaged ('+name+').');return items;};
  const jobs=list('jobs'),events=list('events'),receipts=list('receipts'),removed=list('removed'),files=Array.isArray(cv.files)?cv.files:[];
  if(jobs.some(job=>!job||typeof job.id!=='string'||!job.id)||new Set(jobs.map(job=>job.id)).size!==jobs.length)throw new Error('The export file is damaged (job IDs).');
  if(files.some(file=>!file||!['cv','photo'].includes(file.name)||typeof file.content!=='string'))throw new Error('The export file is damaged (files).');
  return {records:{jobs,events,receipts,removed,meta:records.meta&&typeof records.meta==='object'?records.meta:{}},cv:{profile:cv.profile&&typeof cv.profile==='object'?cv.profile:null,savedAt:typeof cv.savedAt==='string'?cv.savedAt:null,files},settings:value.settings&&typeof value.settings==='object'?value.settings:{}};
}
// The imported settings replace the local ones, except what is secret or belongs to this machine: the keys entered here, the consent given here, and where this installation keeps its records.
export function mergeSettings(current,imported){
  const here=current||{},from=portableSettings(imported),out={...from,database:here.database};
  if(here.appKey)out.appKey=here.appKey;
  if(from.ai||here.ai)out.ai={...(from.ai||{}),...(here.ai?.apiKey?{apiKey:here.ai.apiKey,enabled:here.ai.enabled,consentAt:here.ai.consentAt,consentVersion:here.ai.consentVersion}:{})};
  if(from.jsearch||here.jsearch)out.jsearch={...(from.jsearch||{}),...(here.jsearch?.apiKey?{apiKey:here.jsearch.apiKey}:{})};
  if(from.outlook||here.outlook)out.outlook={...(from.outlook||{}),...(here.outlook?.clientSecret?{clientSecret:here.outlook.clientSecret}:{}),...(here.outlook?.tokens?{tokens:here.outlook.tokens,verifiedAt:here.outlook.verifiedAt}:{})};
  // Older exports name the country only with the vacancy source.
  out.country=from.country||here.country||from.jsearch?.country||'';
  if(out.database===undefined)delete out.database;
  return out;
}
export function createTransfer(connections,environment,{reload=async()=>{},working=()=>false,local,client,clock=Date.now}={}){
  let busy=false;
  const store=async()=>storeFor(((await connections.settings()).SCOUT_CONFIG||{}).database,environment,{...(client?{mysql:client}:{}),...(local?{local}:{})});
  return {async handle(request){
    if(!environment.HQ_ACCESS_PASSWORD)return json({error:'Owner sign-in required.'},403);
    const url=new URL(request.url);
    if(request.method==='GET'){
      try{const held=await store(),data=await held.client.exportAll(held.settings),at=new Date(clock()).toISOString();
        return new Response(JSON.stringify(exportFile({...data,settings:(await connections.settings()).SCOUT_CONFIG||{},at,source:'Job Hunt'})),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="job-hunt-export-'+at.slice(0,10)+'.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }catch(error){return json({error:error.message||'The export could not be made.'},502);}
    }
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    try{const origin=new URL(request.headers.get('origin'));if(origin.origin!==new URL(environment.HQ_PUBLIC_ORIGIN||request.url).origin||origin.host!==request.headers.get('host'))throw new Error();}catch{return json({error:'Cross-site import refused.'},403);}
    if(busy)return json({error:'Another import is running.'},409);busy=true;
    try{
      if(url.searchParams.get('confirm')!=='1')throw new Error('Confirm the import.');
      let parsed;try{parsed=JSON.parse(await request.text());}catch{throw new Error('The file could not be read. Choose the export file as it was downloaded.');}
      const data=readExport(parsed),held=await store();
      if(working())throw new Error('A task is running. Wait for it to finish, then import.');
      if(!held.client.importAll)throw new Error('An import needs the database file on this machine. Go back to it in the database settings first.');
      // What is here now is replaced as a whole, so that has to be asked for when there is something to lose.
      const now=await held.client.readRecords(held.settings),profile=await held.client.readProfile(held.settings),occupied=now.jobs.length>0||!!profile.profile||!!profile.cv;
      if(occupied&&url.searchParams.get('replace')!=='1')return json({error:'This installation already holds '+now.jobs.length+' job'+(now.jobs.length===1?'':'s')+(profile.profile||profile.cv?' and a CV':'')+'. Importing replaces them. Confirm that they may be replaced.',occupied:true},409);
      await held.client.importAll(held.settings,data);
      await connections.updateScout(current=>mergeSettings(current,data.settings));
      await reload();
      const discoveries=Array.isArray(data.settings.state?.results)?data.settings.state.results.length:0;
      return json({imported:true,jobs:data.records.jobs.length,events:data.records.events.length,discoveries,cv:data.cv.files.some(f=>f.name==='cv'),photo:data.cv.files.some(f=>f.name==='photo'),message:data.records.jobs.length+' jobs, '+data.records.events.length+' history entries and '+discoveries+' discoveries imported'+(data.cv.profile?', with your CV details':'')+'. Keys and passwords are not part of an export: enter your vacancy source and AI keys again in Search preferences, and reconnect your mailbox.'});
    }catch(error){return json({error:error.message||'The import failed. Nothing was changed.'},400);}finally{busy=false;}
  }};
}
