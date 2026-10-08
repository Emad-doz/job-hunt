import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, scryptSync, createCipheriv, createDecipheriv} from 'node:crypto';

// Your private settings, encrypted on disk with a key derived from your access password: the search and model settings, the mail connection, and the MySQL connection if you use one.
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const isWithin=(target,root)=>target===root||target.startsWith(root+path.sep);
export function createConnections(environment,publicRoot){
  const password=environment.HQ_ACCESS_PASSWORD;
  const file=path.resolve(environment.HQ_CONFIG_FILE||path.join(environment.HQ_DATA_DIR||'data','settings.enc'));
  if(isWithin(file,path.resolve(publicRoot)))throw new Error('HQ_CONFIG_FILE must be outside the public asset directory.');
  let stored={},failure=null,queue=Promise.resolve(),held=null;
  // One salt and the key derived from it for the life of the process; every save still gets its own random nonce.
  const keyFor=salt=>{if(!held||!held.salt.equals(salt))held={salt,key:scryptSync(password,salt,32)};return held.key;};
  const save=async next=>{
    const salt=held?.salt||randomBytes(16),iv=randomBytes(12),key=keyFor(salt),cipher=createCipheriv('aes-256-gcm',key,iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(next),'utf8'),cipher.final()]);
    const box={version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(box),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
    stored=next;
  };
  const loaded=password?fs.readFile(file,'utf8').then(async text=>{
    const box=JSON.parse(text);if(box.version!==1)throw new Error();
    const key=keyFor(Buffer.from(box.salt,'base64'));
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64'));decipher.setAuthTag(Buffer.from(box.tag,'base64'));
    stored=JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));
  }).catch(error=>{if(error.code!=='ENOENT')failure='Your saved settings could not be unlocked. Use the access password they were saved with, or remove the settings file in the data folder to start again.';}):Promise.resolve();
  const effective=()=>({...environment,SCOUT_CONFIG:stored.scout});
  return {
    async settings(){await loaded;if(failure)throw new Error(failure);return effective();},
    async updateScout(update){await loaded;if(failure)throw new Error(failure);if(!password)throw new Error('Owner sign-in is required.');const mutation=async()=>{const next=update(stored.scout||{});await save({...stored,scout:next});};const result=queue.then(mutation,mutation);queue=result.then(()=>{},()=>{});return result;},
    // Only says whether the owner is signed in and where settings are kept. Each connection has its own page and endpoint.
    async handle(request){
      await loaded;
      if(failure)return json({error:failure},503);
      if(request.method!=='GET')return json({error:'Nothing is saved here any more. Use the database, My CV, search, model and Outlook settings.'},405);
      return json({protected:!!password,storage:password?'Encrypted server settings':'Owner sign-in required'});
    }
  };
}
