// Where the records and the CV are kept. By default that is a SQLite file in the data folder on this machine (store-local.mjs). Someone who hosts the app can point it at a MySQL database instead (db-client.mjs, bundled into dist/server).
import path from 'node:path';
import * as localClient from './store-local.mjs';
const names=['testConnection','readRecords','changeRecords','readProfile','writeProfile','writeCv','readCv','writePhoto','readPhoto','removePhoto','exportAll'];
let bundled;
const mysqlClient=Object.fromEntries(names.map(name=>[name,async(...args)=>{bundled??=import(new URL('../dist/server/db-client.mjs',import.meta.url));return (await bundled)[name](...args);}]));
export const dataDir=environment=>path.resolve(environment.HQ_DATA_DIR||'data');
export const localFile=environment=>path.join(dataDir(environment),'job-hunt.db');
export const usesMysql=config=>config?.kind==='mysql';
// A MySQL connection counts once it is saved and has passed a test. The local file needs neither.
export const mysqlReady=config=>!!(usesMysql(config)&&config.host&&config.database&&config.user&&config.password&&config.last?.ok);
export function storeFor(config,environment,{mysql=mysqlClient,local=localClient}={}){
  const c=config||{};
  if(usesMysql(c)){
    if(!mysqlReady(c))throw new Error('The MySQL connection is saved but has not passed a test yet. Test it in Settings, or go back to the local file.');
    return {kind:'mysql',client:mysql,settings:{host:c.host,port:c.port||3306,database:c.database,user:c.user,password:c.password}};
  }
  return {kind:'local',client:local,settings:{file:localFile(environment)}};
}
