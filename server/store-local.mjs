// The default place for your records: one SQLite file on your own machine, opened with Node's built-in SQLite. No server to install and nothing to configure. It offers the same functions as the MySQL client (db-client.mjs), so the rest of the app does not care which one is in use.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const tables=[
  'CREATE TABLE IF NOT EXISTS hq_jobs (id TEXT NOT NULL PRIMARY KEY, seq INTEGER NOT NULL, employer TEXT, role TEXT, status TEXT, applied TEXT, data TEXT NOT NULL, imported_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS hq_jobs_status ON hq_jobs (status)',
  'CREATE TABLE IF NOT EXISTS hq_events (seq INTEGER NOT NULL PRIMARY KEY, id TEXT, record_id TEXT, type TEXT, data TEXT NOT NULL, imported_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS hq_events_record ON hq_events (record_id)',
  'CREATE TABLE IF NOT EXISTS hq_meta (name TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hq_receipts (id TEXT NOT NULL PRIMARY KEY, record_id TEXT, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hq_removed (id TEXT NOT NULL PRIMARY KEY, data TEXT NOT NULL, removed_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hq_profile (id INTEGER NOT NULL PRIMARY KEY, data TEXT NOT NULL, saved_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hq_files (name TEXT NOT NULL PRIMARY KEY, filename TEXT NOT NULL, content BLOB NOT NULL, body TEXT, uploaded_at TEXT NOT NULL)',
];
// One open file per path for the life of the process. SQLite is fast enough that every request simply uses it in turn.
const opened=new Map();
function open({file}){
  let database=opened.get(file);if(database)return database;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  database=new DatabaseSync(file);database.exec('PRAGMA journal_mode=WAL');database.exec('PRAGMA foreign_keys=ON');for(const statement of tables)database.exec(statement);
  opened.set(file,database);return database;
}
const text=(value,length)=>String(value??'').slice(0,length);
const top=(rows,prefix)=>rows.reduce((n,row)=>Math.max(n,Number(String(JSON.parse(row.data).id).match(new RegExp('^'+prefix+'(\\d+)$'))?.[1]||0)),0);

export async function testConnection(settings){
  const database=open(settings),version=database.prepare('SELECT sqlite_version() AS version').get().version,count=database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
  return {version:'SQLite '+version,tables:Number(count)};
}
export async function readRecords(settings){
  const database=open(settings),named=Object.fromEntries(database.prepare('SELECT name,value FROM hq_meta').all().map(row=>[row.name,JSON.parse(row.value)]));
  return {jobs:database.prepare('SELECT data FROM hq_jobs ORDER BY seq').all().map(row=>JSON.parse(row.data)),events:database.prepare('SELECT data FROM hq_events ORDER BY seq').all().map(row=>JSON.parse(row.data)),controls:named.controls||{},overview:named.overview||[]};
}
// One change to the records, all or nothing.
export async function changeRecords(settings,work){
  const database=open(settings);database.exec('BEGIN IMMEDIATE');
  try{
    const jobRows=database.prepare('SELECT seq,data FROM hq_jobs ORDER BY seq').all(),eventRows=database.prepare('SELECT seq,data FROM hq_events ORDER BY seq').all();
    const before=JSON.parse(database.prepare("SELECT value FROM hq_meta WHERE name='counters'").get()?.value||'{}');
    // The highest job and history numbers ever used, so a deleted job's ID is not handed out again.
    const counters={job:Math.max(Number(before.job)||0,top(jobRows,'JOB-')),event:Math.max(Number(before.event)||0,top(eventRows,'EVT-'))};
    const known=new Set(jobRows.map(row=>JSON.parse(row.data).id));let jobSeq=jobRows.reduce((n,row)=>Math.max(n,row.seq),-1),eventSeq=eventRows.reduce((n,row)=>Math.max(n,row.seq),-1);
    const result=work({jobs:jobRows.map(row=>JSON.parse(row.data)),events:eventRows.map(row=>JSON.parse(row.data)),receipts:new Set(database.prepare('SELECT id FROM hq_receipts').all().map(row=>String(row.id))),counters});
    if(!result.reply?.ok){database.exec('ROLLBACK');return result.reply;}
    const stamp=new Date().toISOString();
    for(const job of result.jobs.values()){
      if(known.has(job.id))database.prepare('UPDATE hq_jobs SET employer=?,role=?,status=?,applied=?,data=? WHERE id=?').run(text(job.employer,2000),text(job.role,2000),text(job.status,64),text(job.applied,64),JSON.stringify(job),job.id);
      else database.prepare('INSERT INTO hq_jobs (id,seq,employer,role,status,applied,data,imported_at) VALUES (?,?,?,?,?,?,?,?)').run(text(job.id,64),++jobSeq,text(job.employer,2000),text(job.role,2000),text(job.status,64),text(job.applied,64),JSON.stringify(job),stamp);
    }
    for(const event of result.events)database.prepare('INSERT INTO hq_events (seq,id,record_id,type,data,imported_at) VALUES (?,?,?,?,?,?)').run(++eventSeq,text(event.id,64),text(event.recordId,64),text(event.type,191),JSON.stringify(event),stamp);
    for(const receipt of result.receipts)database.prepare('INSERT OR REPLACE INTO hq_receipts (id,record_id,data) VALUES (?,?,?)').run(text(receipt.id,64),text(receipt.recordId,64),JSON.stringify(receipt));
    for(const id of result.removed?.jobs||[]){database.prepare('DELETE FROM hq_events WHERE record_id=?').run(id);database.prepare('DELETE FROM hq_jobs WHERE id=?').run(id);}
    for(const trace of result.removed?.traces||[])database.prepare('INSERT OR REPLACE INTO hq_removed (id,data,removed_at) VALUES (?,?,?)').run(text(trace.id,64),JSON.stringify(trace),stamp);
    const after={job:Math.max(counters.job,top([...result.jobs.values()].map(job=>({data:JSON.stringify(job)})),'JOB-')),event:Math.max(counters.event,top(result.events.map(event=>({data:JSON.stringify(event)})),'EVT-'))};
    database.prepare("INSERT OR REPLACE INTO hq_meta (name,value) VALUES ('counters',?)").run(JSON.stringify(after));
    database.exec('COMMIT');return result.reply;
  }catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
}
// The owner's CV: one row of editable fields, the uploaded PDF with the text read from it, and the photo.
export async function readProfile(settings){
  const database=open(settings),row=database.prepare('SELECT data,saved_at FROM hq_profile WHERE id=1').get(),file=database.prepare("SELECT filename,LENGTH(content) AS size,LENGTH(body) AS characters,uploaded_at FROM hq_files WHERE name='cv'").get(),photo=database.prepare("SELECT filename,LENGTH(content) AS size,uploaded_at FROM hq_files WHERE name='photo'").get();
  return {photo:photo?{type:photo.filename,size:Number(photo.size),uploadedAt:photo.uploaded_at}:null,profile:row?JSON.parse(row.data):null,savedAt:row?.saved_at||null,cv:file?{filename:file.filename,size:Number(file.size),characters:Number(file.characters||0),uploadedAt:file.uploaded_at}:null};
}
export async function writeProfile(settings,profile,at){open(settings).prepare('INSERT OR REPLACE INTO hq_profile (id,data,saved_at) VALUES (1,?,?)').run(JSON.stringify(profile),at);}
export async function writeCv(settings,{filename,bytes,text:body,uploadedAt}){open(settings).prepare("INSERT OR REPLACE INTO hq_files (name,filename,content,body,uploaded_at) VALUES ('cv',?,?,?,?)").run(text(filename,191),Buffer.from(bytes),body,uploadedAt);}
export async function readCv(settings){const row=open(settings).prepare("SELECT filename,content,body,uploaded_at FROM hq_files WHERE name='cv'").get();return row?{filename:row.filename,bytes:Buffer.from(row.content),text:row.body||'',uploadedAt:row.uploaded_at}:null;}
export async function writePhoto(settings,{type,bytes,uploadedAt}){open(settings).prepare("INSERT OR REPLACE INTO hq_files (name,filename,content,body,uploaded_at) VALUES ('photo',?,?,NULL,?)").run(type,Buffer.from(bytes),uploadedAt);}
export async function readPhoto(settings){const row=open(settings).prepare("SELECT filename,content FROM hq_files WHERE name='photo'").get();return row?{type:row.filename,bytes:Buffer.from(row.content)}:null;}
export async function removePhoto(settings){open(settings).prepare("DELETE FROM hq_files WHERE name='photo'").run();}
// Everything the file holds, for moving it to another installation or keeping a backup: rows as they are, files as base64.
export async function exportAll(settings){
  const database=open(settings),all=sql=>database.prepare(sql).all(),profile=database.prepare('SELECT data,saved_at FROM hq_profile WHERE id=1').get();
  return {records:{jobs:all('SELECT data FROM hq_jobs ORDER BY seq').map(r=>JSON.parse(r.data)),events:all('SELECT data FROM hq_events ORDER BY seq').map(r=>JSON.parse(r.data)),meta:Object.fromEntries(all('SELECT name,value FROM hq_meta').map(r=>[r.name,JSON.parse(r.value)])),receipts:all('SELECT data FROM hq_receipts').map(r=>JSON.parse(r.data)),removed:all('SELECT data FROM hq_removed').map(r=>JSON.parse(r.data))},
    cv:{profile:profile?JSON.parse(profile.data):null,savedAt:profile?.saved_at||null,files:all('SELECT name,filename,content,body,uploaded_at FROM hq_files').map(f=>({name:f.name,filename:f.filename,content:Buffer.from(f.content).toString('base64'),body:f.body||null,uploadedAt:f.uploaded_at}))}};
}
// Replaces everything the file holds with an export, all or nothing.
export async function importAll(settings,{records,cv}){
  const database=open(settings),stamp=new Date().toISOString();database.exec('BEGIN IMMEDIATE');
  try{
    for(const table of ['hq_events','hq_jobs','hq_meta','hq_receipts','hq_removed','hq_profile','hq_files'])database.exec('DELETE FROM '+table);
    records.jobs.forEach((job,i)=>database.prepare('INSERT INTO hq_jobs (id,seq,employer,role,status,applied,data,imported_at) VALUES (?,?,?,?,?,?,?,?)').run(text(job.id,64),i,text(job.employer,2000),text(job.role,2000),text(job.status,64),text(job.applied,64),JSON.stringify(job),stamp));
    records.events.forEach((event,i)=>database.prepare('INSERT INTO hq_events (seq,id,record_id,type,data,imported_at) VALUES (?,?,?,?,?,?)').run(i,text(event.id,64),text(event.recordId,64),text(event.type,191),JSON.stringify(event),stamp));
    for(const [name,value] of Object.entries(records.meta||{}))if(name!=='import')database.prepare('INSERT OR REPLACE INTO hq_meta (name,value) VALUES (?,?)').run(text(name,64),JSON.stringify(value));
    for(const receipt of records.receipts||[])database.prepare('INSERT OR REPLACE INTO hq_receipts (id,record_id,data) VALUES (?,?,?)').run(text(receipt.id,64),text(receipt.recordId,64),JSON.stringify(receipt));
    for(const trace of records.removed||[])database.prepare('INSERT OR REPLACE INTO hq_removed (id,data,removed_at) VALUES (?,?,?)').run(text(trace.id,64),JSON.stringify(trace),text(trace.removedAt||stamp,40));
    if(cv.profile)database.prepare('INSERT INTO hq_profile (id,data,saved_at) VALUES (1,?,?)').run(JSON.stringify(cv.profile),cv.savedAt||stamp);
    for(const file of cv.files||[])database.prepare('INSERT INTO hq_files (name,filename,content,body,uploaded_at) VALUES (?,?,?,?,?)').run(file.name,text(file.filename,191),Buffer.from(file.content,'base64'),file.body??null,file.uploadedAt||stamp);
    // Numbers already used stay used: by the imported records and by the ones they once replaced.
    const counters=records.meta?.counters||{},used={job:Math.max(Number(counters.job)||0,top(records.jobs.map(j=>({data:JSON.stringify(j)})),'JOB-'),top((records.removed||[]).map(j=>({data:JSON.stringify(j)})),'JOB-')),event:Math.max(Number(counters.event)||0,top(records.events.map(e=>({data:JSON.stringify(e)})),'EVT-'))};
    database.prepare("INSERT OR REPLACE INTO hq_meta (name,value) VALUES ('counters',?)").run(JSON.stringify(used));
    database.exec('COMMIT');
  }catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
}
// For tests and for a clean shutdown.
export function closeAll(){for(const database of opened.values())try{database.close();}catch{}opened.clear();}
