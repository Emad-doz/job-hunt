// The owner's CV as HQ keeps it: the uploaded PDF and a set of editable fields, both in the owner's database. Nothing here is sent anywhere; the fields are whatever the owner saved.
import {parsePdf} from './cv-reader.mjs';
import {storeFor} from './store.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const line=(value,length)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,length);
const block=(value,length)=>String(value??'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,length);
const list=(value,most,each)=>(Array.isArray(value)?value:[]).slice(0,most*3).map(each).filter(Boolean).slice(0,most);
const once=items=>{const seen=new Set();return items.filter(item=>{const key=item.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});};
export const emptyProfile=()=>({name:'',headline:'',email:'',phone:'',location:'',links:[],about:'',skills:[],languages:[],experience:[],education:[],certificates:[]});
// Whatever arrives is cut to the known fields and sensible sizes. An entry with nothing in it is dropped.
export function cleanProfile(input){
  const p=input&&typeof input==='object'?input:{};
  return {
    name:line(p.name,120),headline:line(p.headline,160),email:line(p.email,160),phone:line(p.phone,60),location:line(p.location,120),
    links:once(list(p.links,6,v=>line(v,300))),about:block(p.about,2500),skills:once(list(p.skills,80,v=>line(v,80))),
    languages:list(p.languages,12,v=>{const name=line(v?.name,60);return name?{name,level:line(v?.level,60)}:null;}),
    experience:list(p.experience,25,v=>{const entry={title:line(v?.title,160),employer:line(v?.employer,160),location:line(v?.location,120),start:line(v?.start,20),end:line(v?.end,20),points:list(v?.points,12,x=>line(x,400))};return entry.title||entry.employer||entry.points.length?entry:null;}),
    education:list(p.education,12,v=>{const entry={degree:line(v?.degree,200),school:line(v?.school,200),start:line(v?.start,20),end:line(v?.end,20),notes:block(v?.notes,600)};return entry.degree||entry.school?entry:null;}),
    certificates:once(list(p.certificates,25,v=>line(v,200))),
  };
}
export function createProfile(connections,environment,{client,local,parse=parsePdf,clock=Date.now}={}){
  let busy=false;
  // The CV is kept in the same database as the records.
  const store=async()=>storeFor(((await connections.settings()).SCOUT_CONFIG||{}).database,environment,{...(client?{mysql:client}:{}),...(local?{local}:{})});
  const cvView=cv=>cv?{filename:cv.filename,size:cv.size,uploadedAt:cv.uploadedAt,characters:cv.characters}:null;
  return {
  // The text of the uploaded CV, for a request the owner starts elsewhere in HQ.
  // The saved details, for a request the owner starts elsewhere in HQ.
  async storedProfile(){return (await (await store()).client.readProfile((await store()).settings)).profile||null;},
  async storedCv(){const cv=await (await store()).client.readCv((await store()).settings);return cv?{text:cv.text||'',filename:cv.filename,uploadedAt:cv.uploadedAt}:null;},
  async handle(request){
    if(!environment.HQ_ACCESS_PASSWORD)return json({error:'Owner sign-in required for the CV.'},403);
    const url=new URL(request.url);
    if(request.method==='GET'){
      let held;try{held=await store();}catch(error){return json({protected:true,ready:false,profile:emptyProfile(),cv:null,message:error.message});}
      const settings=held.settings,db=held.client;
      try{
        if(url.searchParams.get('file')==='cv'){const cv=await db.readCv(settings);if(!cv?.bytes)return json({error:'No CV has been uploaded.'},404);return new Response(cv.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+String(cv.filename||'cv.pdf').replace(/[^\w. -]/g,'_')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
        if(url.searchParams.get('file')==='photo'){const photo=await db.readPhoto(settings);if(!photo?.bytes)return json({error:'No photo has been uploaded.'},404);return new Response(photo.bytes,{headers:{'Content-Type':photo.type==='image/png'?'image/png':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
        const held=await db.readProfile(settings);return json({protected:true,ready:true,profile:{...emptyProfile(),...(held.profile||{})},savedAt:held.savedAt||null,cv:cvView(held.cv),photo:held.photo||null});
      }catch{return json({error:'Your CV could not be read from the database just now.'},502);}
    }
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    try{const origin=new URL(request.headers.get('origin'));if(origin.origin!==new URL(environment.HQ_PUBLIC_ORIGIN||request.url).origin||origin.host!==request.headers.get('host'))throw new Error();}catch{return json({error:'Cross-site CV request refused.'},403);}
    if(busy)return json({error:'Another CV request is running.'},409);busy=true;
    try{
      const held=await store(),settings=held.settings,db=held.client,at=new Date(clock()).toISOString();
      if((request.headers.get('content-type')||'').startsWith('application/pdf')){
        // The upload itself: kept as the file it is, with its text read out once so screening and the model can use it.
        const bytes=new Uint8Array(await request.arrayBuffer());
        if(bytes.length<200||bytes.length>5_000_000)throw new Error('Upload a PDF of at most 5 MB.');
        if(String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('That file is not a PDF.');
        let filename='cv.pdf';try{filename=line(decodeURIComponent(request.headers.get('x-file-name')||''),120)||'cv.pdf';}catch{}
        let text='';try{text=String(await parse(Buffer.from(bytes))||'').slice(0,60000);}catch{}
        await db.writeCv(settings,{filename,bytes,text,uploadedAt:at});
        return json({saved:true,cv:{filename,size:bytes.length,uploadedAt:at,characters:text.length},message:text.length>200?'CV stored: '+text.length+' characters of text were read from it.':'CV stored, but almost no text could be read from it. It may be a scanned image; a text-based PDF works better.'});
      }
      const kind=(request.headers.get('content-type')||'').split(';')[0].trim();
      if(kind==='image/jpeg'||kind==='image/png'){
        // The profile photo. It is kept as uploaded and used only on a CV the owner builds in their own browser.
        const bytes=new Uint8Array(await request.arrayBuffer());
        if(bytes.length<100||bytes.length>2_000_000)throw new Error('Upload a photo of at most 2 MB.');
        const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47;
        if(kind==='image/jpeg'&&!jpeg||kind==='image/png'&&!png)throw new Error('That file is not a JPG or PNG picture.');
        await db.writePhoto(settings,{type:kind,bytes,uploadedAt:at});
        return json({saved:true,photo:{type:kind,size:bytes.length,uploadedAt:at},message:'Photo stored.'});
      }
      const body=await request.json();
      if(body.action==='remove-photo'){await db.removePhoto(settings);return json({saved:true,photo:null,message:'Photo removed.'});}
      if(body.action==='save'){const profile=cleanProfile(body.profile);await db.writeProfile(settings,profile,at);return json({saved:true,profile,savedAt:at,message:'Your CV details are saved.'});}
      throw new Error('Unsupported CV action.');
    }catch(error){return json({error:error.code?'Your CV could not be saved to the database just now.':error.message||'CV request failed.'},400);}finally{busy=false;}
  }};
}
