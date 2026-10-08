// Your records live in your own database: the site reads jobs and history from it and saves every change to it. By default that is a file on this machine; a MySQL database can be used instead. This file keeps that choice, tests it, and answers for the records.
import {applyOperation} from './records.mjs';
import {storeFor,usesMysql,mysqlReady,localFile} from './store.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const hostName=/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/,plainName=/^[A-Za-z0-9_$-]{1,64}$/;
// What went wrong, in words the owner can act on. The driver's own message is never passed on: it can repeat the user name and host.
export function explainFailure(error){
  const code=String(error?.code||'');
  if(code==='ER_ACCESS_DENIED_ERROR')return 'The database refused this user name or password.';
  if(code==='ER_DBACCESS_DENIED_ERROR'||code==='ER_TABLEACCESS_DENIED_ERROR')return 'This user may not use that database fully. Give the user all privileges on it.';
  if(code==='ER_BAD_DB_ERROR')return 'No database with that name exists on the server.';
  if(code==='ENOTFOUND'||code==='EAI_AGAIN')return 'That host name could not be found.';
  if(code==='ECONNREFUSED')return 'Nothing answered at that host and port. On the same machine the host is usually localhost or 127.0.0.1, port 3306.';
  if(code==='ETIMEDOUT'||code==='PROTOCOL_SEQUENCE_TIMEOUT')return 'The database did not answer in time.';
  if(code==='ERR_MODULE_NOT_FOUND')return 'The database driver is missing from this build. Run the build again.';
  if(code==='ER_DATA_TOO_LONG')return 'A record is longer than the database column allows.';
  if(code==='EACCES'||code==='EPERM'||code==='EROFS')return 'The data folder cannot be written to. Check its permissions.';
  if(code==='ERR_SQLITE_ERROR')return 'The local database file could not be used. It may be damaged or locked by another program.';
  return 'The database could not be used'+(code?' ('+code.slice(0,40)+')':'')+'.';
}
export function createDatabase(connections,environment,{client,local,clock=Date.now}={}){
  let busy=false,lastGood=null;
  const config=async()=>((await connections.settings()).SCOUT_CONFIG||{}).database||{};
  const save=update=>connections.updateScout(c=>({...c,database:update(c.database||{})}));
  const use=c=>storeFor(c,environment,{...(client?{mysql:client}:{}),...(local?{local}:{})});
  const ready=c=>!usesMysql(c)||mysqlReady(c);
  const view=c=>({protected:true,kind:usesMysql(c)?'mysql':'local',ready:ready(c),file:localFile(environment),configured:!!(c.host&&c.database&&c.user&&c.password),host:c.host||'',port:c.port||3306,database:c.database||'',user:c.user||'',passwordSaved:!!c.password,last:c.last||null});
  return {
  // Whether the records can be read and saved.
  async live(){try{return ready(await config());}catch{return false;}},
  // One fixed, owner-confirmed operation on the records (see records.mjs), all or nothing.
  async change(body){try{const store=use(await config());return Response.json({...await store.client.changeRecords(store.settings,held=>applyOperation(held,body,new Date(clock()))),store:'database'});}catch(error){return Response.json({ok:false,error:error.code?explainFailure(error):error.message});}},
  // What the page shows. If a read fails, the last good records are returned marked stale.
  async snapshot(){
    try{const store=use(await config()),held=await store.client.readRecords(store.settings),at=new Date(clock()).toISOString();lastGood={mode:'synced',jobs:held.jobs.map(({sheetRow,...job})=>job),events:held.events,controls:held.controls,overview:held.overview,syncedAt:at,fetchedAt:at,stale:false,error:null,source:store.kind==='mysql'?'Your MySQL database':'Your database file on this machine',dateWarnings:0};return json(lastGood);}
    catch(error){const message=error.code?explainFailure(error):error.message;return lastGood?json({...lastGood,stale:true,error:message}):json({error:message},503);}
  },
  async handle(request){
    if(!environment.HQ_ACCESS_PASSWORD)return json({error:'Owner sign-in required for the database settings.'},403);
    if(request.method==='GET'){try{return json(view(await config()));}catch{return json({error:'Database settings unavailable.'},503);}}
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    try{const origin=new URL(request.headers.get('origin'));if(origin.origin!==new URL(environment.HQ_PUBLIC_ORIGIN||request.url).origin||origin.host!==request.headers.get('host'))throw new Error();}catch{return json({error:'Cross-site database request refused.'},403);}
    if(busy)return json({error:'Another database request is running.'},409);busy=true;
    try{
      const body=await request.json(),old=await config();
      // Your records live in whichever database is in use. Changing it shows that one's records instead, so every such change has to be confirmed.
      const moving='Your jobs and CV are in the database that is in use now. Confirm that the app should use a different one; nothing is copied across.';
      if(body.action==='use-local'){
        if(usesMysql(old)&&body.confirmMove!==true)throw new Error(moving);
        await save(x=>({...x,kind:'local'}));lastGood=null;return json({saved:true,...view(await config()),message:'The app uses the database file on this machine.'});
      }
      if(body.action==='save'){
        const host=String(body.host||'').trim(),port=body.port===undefined||body.port===''?3306:Number(body.port),database=String(body.database||'').trim(),user=String(body.user||'').trim(),password=typeof body.password==='string'?body.password:'';
        if(!hostName.test(host))throw new Error('Enter the database host as a plain name or address, such as localhost.');
        if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Enter a port between 1 and 65535. MySQL normally uses 3306.');
        if(!plainName.test(database))throw new Error('Enter the database name exactly as your database server shows it.');
        if(!plainName.test(user))throw new Error('Enter the database user name exactly as your database server shows it.');
        if(password.length>200)throw new Error('That password is too long.');
        if(!password&&!old.password)throw new Error('Enter the database password.');
        const elsewhere=!usesMysql(old)||old.host!==host||(old.port||3306)!==port||old.database!==database||old.user!==user;
        if(elsewhere&&body.confirmMove!==true)throw new Error(moving);
        const same=!elsewhere&&!password;
        await save(x=>({kind:'mysql',host,port,database,user,password:password||x.password,last:same?x.last||null:null}));lastGood=null;
        return json({saved:true,...view(await config()),message:same?'MySQL connection saved.':'MySQL connection saved. Test it: nothing is read or saved there until the test passes.'});
      }
      if(body.action==='test'){
        const at=new Date(clock()).toISOString();let last;
        if(usesMysql(old)&&!(old.host&&old.database&&old.user&&old.password))throw new Error('Save the MySQL connection first.');
        // A MySQL connection is tested before it counts, so the test itself may use it untested.
        try{const store=use(usesMysql(old)?{...old,last:{ok:true}}:old),result=await store.client.testConnection(store.settings);last={ok:true,at,message:'Working. '+String(result.version).slice(0,40)+' · '+result.tables+' table'+(result.tables===1?'':'s')+'.'};}
        catch(error){last={ok:false,at,message:explainFailure(error)};}
        // A failed test of a connection that already works does not switch the records off; the failure is kept beside the last good test.
        await save(x=>({...x,last:last.ok||!x.last?.ok?last:{...x.last,warning:last.message,warnedAt:at}}));
        return json({tested:true,...view(await config()),message:last.message},last.ok?200:502);
      }
      throw new Error('Unsupported database action.');
    }catch(error){return json({error:error.message||'Database request failed.'},400);}finally{busy=false;}
  }};
}
