// Bundled into dist/server/db-client.mjs; the hosted runtime has no installed packages.
import mysql from 'mysql2/promise';

// Table definitions are sent once per start and database, not with every request.
const prepared=new Set();
const once=async(connection,settings,name,statements)=>{const key=name+'|'+settings.host+'|'+settings.port+'|'+settings.database;if(prepared.has(key))return;for(const statement of statements)await connection.query(statement);prepared.add(key);};
const open=({host,port,database,user,password})=>mysql.createConnection({host,port,database,user,password,connectTimeout:8000,charset:'utf8mb4'});
// Opens one connection, asks the server what it is and which tables this user can see, and closes it again. Nothing is created or changed.
export async function testConnection(settings){
  const connection=await open(settings);
  try{
    const [[info]]=await connection.query('SELECT VERSION() AS version');
    const [tables]=await connection.query('SHOW TABLES');
    return {version:String(info?.version||''),tables:tables.length};
  }finally{await connection.end().catch(()=>{});}
}
// Three tables, all prefixed hq_. A job or event keeps its searchable fields as columns and the whole record as JSON, so nothing the tracker held is dropped.
const tables=[
  'CREATE TABLE IF NOT EXISTS hq_jobs (id VARCHAR(64) NOT NULL PRIMARY KEY, seq INT NOT NULL, employer TEXT, `role` TEXT, `status` VARCHAR(64), applied VARCHAR(64), data JSON NOT NULL, imported_at DATETIME NOT NULL, INDEX hq_jobs_status (`status`)) CHARACTER SET utf8mb4',
  'CREATE TABLE IF NOT EXISTS hq_events (seq INT NOT NULL PRIMARY KEY, id VARCHAR(64), record_id VARCHAR(64), `type` VARCHAR(191), data JSON NOT NULL, imported_at DATETIME NOT NULL, INDEX hq_events_record (record_id)) CHARACTER SET utf8mb4',
  'CREATE TABLE IF NOT EXISTS hq_meta (`name` VARCHAR(64) NOT NULL PRIMARY KEY, `value` JSON NOT NULL) CHARACTER SET utf8mb4',
];
const text=(value,length)=>String(value??'').slice(0,length);
const receiptTable='CREATE TABLE IF NOT EXISTS hq_receipts (id VARCHAR(64) NOT NULL PRIMARY KEY, record_id VARCHAR(64), data JSON NOT NULL) CHARACTER SET utf8mb4';
const removedTable='CREATE TABLE IF NOT EXISTS hq_removed (id VARCHAR(64) NOT NULL PRIMARY KEY, data JSON NOT NULL, removed_at DATETIME NOT NULL) CHARACTER SET utf8mb4';
const parsed=value=>typeof value==='string'?JSON.parse(value):value;
const top=(rows,prefix)=>rows.reduce((n,row)=>Math.max(n,Number(String(parsed(row.data).id).match(new RegExp('^'+prefix+'(\\d+)$'))?.[1]||0)),0);
// Everything the site shows, read in one go: jobs and history in their stored order, and the tracker's control and overview values.
export async function readRecords(settings){
  const connection=await open(settings);
  try{
    await once(connection,settings,'records',tables);
    const [jobs]=await connection.query('SELECT data FROM hq_jobs ORDER BY seq');
    const [events]=await connection.query('SELECT data FROM hq_events ORDER BY seq');
    const [meta]=await connection.query('SELECT `name`,`value` FROM hq_meta');
    const named=Object.fromEntries(meta.map(row=>[row.name,parsed(row.value)]));
    return {jobs:jobs.map(row=>parsed(row.data)),events:events.map(row=>parsed(row.data)),controls:named.controls||{},overview:named.overview||[]};
  }finally{await connection.end().catch(()=>{});}
}
// One change to the records, all or nothing. The rows are locked while `work` decides what changes, so two requests cannot both take the same new ID.
export async function changeRecords(settings,work){
  const connection=await open(settings);
  try{
    await once(connection,settings,'changes',[...tables,receiptTable,removedTable]);
    await connection.beginTransaction();
    try{
      const [jobRows]=await connection.query('SELECT seq,data FROM hq_jobs ORDER BY seq FOR UPDATE');
      const [eventRows]=await connection.query('SELECT seq,data FROM hq_events ORDER BY seq FOR UPDATE');
      const [receiptRows]=await connection.query('SELECT id FROM hq_receipts');
      // The highest job and history numbers ever used, so a deleted job's ID is not handed out again.
      const [counterRows]=await connection.query("SELECT `value` FROM hq_meta WHERE `name`='counters' FOR UPDATE"),before=parsed(counterRows[0]?.value)||{},counters={job:Math.max(Number(before.job)||0,top(jobRows,'JOB-')),event:Math.max(Number(before.event)||0,top(eventRows,'EVT-'))};
      const seqOf=new Map(jobRows.map(row=>[parsed(row.data).id,row.seq]));
      let jobSeq=jobRows.reduce((n,row)=>Math.max(n,row.seq),-1),eventSeq=eventRows.reduce((n,row)=>Math.max(n,row.seq),-1);
      const result=work({jobs:jobRows.map(row=>parsed(row.data)),events:eventRows.map(row=>parsed(row.data)),receipts:new Set(receiptRows.map(row=>String(row.id))),counters});
      if(!result.reply?.ok){await connection.rollback();return result.reply;}
      const stamp=new Date().toISOString().slice(0,19).replace('T',' ');
      for(const job of result.jobs.values()){
        if(seqOf.has(job.id))await connection.query('UPDATE hq_jobs SET employer=?,`role`=?,`status`=?,applied=?,data=? WHERE id=?',[text(job.employer,2000),text(job.role,2000),text(job.status,64),text(job.applied,64),JSON.stringify(job),job.id]);
        else await connection.query('INSERT INTO hq_jobs (id,seq,employer,`role`,`status`,applied,data,imported_at) VALUES (?,?,?,?,?,?,?,?)',[text(job.id,64),++jobSeq,text(job.employer,2000),text(job.role,2000),text(job.status,64),text(job.applied,64),JSON.stringify(job),stamp]);
      }
      for(const event of result.events)await connection.query('INSERT INTO hq_events (seq,id,record_id,`type`,data,imported_at) VALUES (?,?,?,?,?,?)',[++eventSeq,text(event.id,64),text(event.recordId,64),text(event.type,191),JSON.stringify(event),stamp]);
      for(const receipt of result.receipts)await connection.query('INSERT INTO hq_receipts (id,record_id,data) VALUES (?,?,?)',[text(receipt.id,64),text(receipt.recordId,64),JSON.stringify(receipt)]);
      for(const id of result.removed?.jobs||[]){await connection.query('DELETE FROM hq_events WHERE record_id=?',[id]);await connection.query('DELETE FROM hq_jobs WHERE id=?',[id]);}
      for(const trace of result.removed?.traces||[])await connection.query('REPLACE INTO hq_removed (id,data,removed_at) VALUES (?,?,?)',[text(trace.id,64),JSON.stringify(trace),stamp]);
      const after={job:Math.max(counters.job,top([...result.jobs.values()].map(job=>({data:job})),'JOB-')),event:Math.max(counters.event,top(result.events.map(event=>({data:event})),'EVT-'))};
      await connection.query('REPLACE INTO hq_meta (`name`,`value`) VALUES (?,?)',['counters',JSON.stringify(after)]);
      await connection.commit();
      return result.reply;
    }catch(error){await connection.rollback().catch(()=>{});throw error;}
  }finally{await connection.end().catch(()=>{});}
}
// The owner's CV: one row of editable fields, and the uploaded PDF with the text read from it.
const profileTables=['CREATE TABLE IF NOT EXISTS hq_profile (id TINYINT NOT NULL PRIMARY KEY, data JSON NOT NULL, saved_at VARCHAR(40) NOT NULL) CHARACTER SET utf8mb4','CREATE TABLE IF NOT EXISTS hq_files (`name` VARCHAR(32) NOT NULL PRIMARY KEY, filename VARCHAR(191) NOT NULL, content MEDIUMBLOB NOT NULL, body MEDIUMTEXT, uploaded_at VARCHAR(40) NOT NULL) CHARACTER SET utf8mb4'];
const withProfile=async(settings,work)=>{const connection=await open(settings);try{await once(connection,settings,'profile',profileTables);return await work(connection);}finally{await connection.end().catch(()=>{});}};
export const readProfile=settings=>withProfile(settings,async connection=>{
  const [rows]=await connection.query('SELECT data,saved_at FROM hq_profile WHERE id=1');
  const [files]=await connection.query("SELECT filename,LENGTH(content) AS size,CHAR_LENGTH(body) AS characters,uploaded_at FROM hq_files WHERE `name`='cv'");
  const [photos]=await connection.query("SELECT filename,LENGTH(content) AS size,uploaded_at FROM hq_files WHERE `name`='photo'");
  return {photo:photos[0]?{type:photos[0].filename,size:Number(photos[0].size),uploadedAt:photos[0].uploaded_at}:null,profile:rows[0]?parsed(rows[0].data):null,savedAt:rows[0]?.saved_at||null,cv:files[0]?{filename:files[0].filename,size:Number(files[0].size),characters:Number(files[0].characters||0),uploadedAt:files[0].uploaded_at}:null};
});
export const writeProfile=(settings,profile,at)=>withProfile(settings,connection=>connection.query('REPLACE INTO hq_profile (id,data,saved_at) VALUES (1,?,?)',[JSON.stringify(profile),at]));
export const writeCv=(settings,{filename,bytes,text:body,uploadedAt})=>withProfile(settings,connection=>connection.query("REPLACE INTO hq_files (`name`,filename,content,body,uploaded_at) VALUES ('cv',?,?,?,?)",[text(filename,191),Buffer.from(bytes),body,uploadedAt]));
export const readCv=settings=>withProfile(settings,async connection=>{const [rows]=await connection.query("SELECT filename,content,body,uploaded_at FROM hq_files WHERE `name`='cv'");return rows[0]?{filename:rows[0].filename,bytes:rows[0].content,text:rows[0].body||'',uploadedAt:rows[0].uploaded_at}:null;});
// The profile photo: the picture as uploaded, with its type in the filename column.
export const writePhoto=(settings,{type,bytes,uploadedAt})=>withProfile(settings,connection=>connection.query("REPLACE INTO hq_files (`name`,filename,content,body,uploaded_at) VALUES ('photo',?,?,NULL,?)",[type,Buffer.from(bytes),uploadedAt]));
export const readPhoto=settings=>withProfile(settings,async connection=>{const [rows]=await connection.query("SELECT filename,content FROM hq_files WHERE `name`='photo'");return rows[0]?{type:rows[0].filename,bytes:rows[0].content}:null;});
export const removePhoto=settings=>withProfile(settings,connection=>connection.query("DELETE FROM hq_files WHERE `name`='photo'"));
