import assert from 'node:assert/strict';
import {createProfile,cleanProfile,emptyProfile} from '../server/profile.mjs';

// Synthetic CV details and an injected database and PDF reader: nothing is stored or parsed for real.
const tidy=cleanProfile({name:'  Synthetic   Person ',headline:'Digital Analyst',email:'person@example.test',unknown:'dropped',links:['https://example.test/in/synthetic','https://example.test/in/synthetic',''],about:'Line one\r\n\r\n\r\n\r\nLine two   ',skills:['GA4','ga4','SQL','',' Looker Studio '],languages:[{name:'Dutch',level:'B2'},{level:'no name'}],experience:[{title:'Analyst',employer:'Synthetic Retail BV',start:'2022-03',end:'Present',points:['Built dashboards','',' Ran tests ']},{}],education:[{degree:'BSc',school:'Example University'},{notes:'nothing else'}],certificates:['GA4 certificate','GA4 certificate']});
assert.deepEqual(Object.keys(tidy),Object.keys(emptyProfile()),'only the known fields are kept');
assert.equal(tidy.name,'Synthetic Person');assert.deepEqual(tidy.links,['https://example.test/in/synthetic']);assert.equal(tidy.about,'Line one\n\nLine two');assert.deepEqual(tidy.skills,['GA4','SQL','Looker Studio'],'skills are trimmed and not repeated');
assert.deepEqual(tidy.languages,[{name:'Dutch',level:'B2'}]);assert.equal(tidy.experience.length,1);assert.deepEqual(tidy.experience[0].points,['Built dashboards','Ran tests']);assert.equal(tidy.education.length,1);assert.deepEqual(tidy.certificates,['GA4 certificate']);
assert.deepEqual(cleanProfile(null),emptyProfile());assert.equal(cleanProfile({skills:Array.from({length:300},(_,i)=>'Skill '+i)}).skills.length,80);assert.equal(cleanProfile({about:'x'.repeat(9000)}).about.length,2500);

let database={};
const connections={settings:async()=>({SCOUT_CONFIG:{database}})};
const held={profile:null,savedAt:null,cv:null};let parsed='Synthetic Person\nDigital Analyst\n'+'Experience with dashboards. '.repeat(20);
let picture=null;
const client={writePhoto:async(settings,photo)=>{picture=photo;},readPhoto:async()=>picture,removePhoto:async()=>{picture=null;},readProfile:async()=>({photo:picture&&{type:picture.type,size:picture.bytes.length,uploadedAt:picture.uploadedAt},profile:held.profile,savedAt:held.savedAt,cv:held.cv&&{filename:held.cv.filename,size:held.cv.bytes.length,characters:held.cv.text.length,uploadedAt:held.cv.uploadedAt}}),writeProfile:async(settings,profile,at)=>{held.profile=profile;held.savedAt=at;},writeCv:async(settings,cv)=>{held.cv=cv;},readCv:async()=>held.cv};
const api=createProfile(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{client,local:client,parse:async()=>{if(parsed===null)throw new Error('unreadable');return parsed;},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
const get=(query='')=>api.handle(new Request('https://hq.test/api/profile'+query));
const post=(body,headers={},origin='https://hq.test')=>api.handle(new Request('https://hq.test/api/profile',{method:'POST',headers:{host:'hq.test',origin,'content-type':'application/json',...headers},body:body instanceof Uint8Array?body:JSON.stringify(body)}));
const pdf=(size=400)=>{const bytes=new Uint8Array(size).fill(32);bytes.set([...'%PDF-1.7\n'].map(c=>c.charCodeAt(0)));return bytes;};

assert.equal((await createProfile(connections,{}).handle(new Request('https://hq.test/api/profile'))).status,403);
assert.equal((await post({action:'save',profile:{}},{},'https://elsewhere.test')).status,403);
const first=await (await get()).json();assert.equal(first.ready,true);assert.deepEqual(first.profile,emptyProfile());assert.equal(first.cv,null);assert.equal((await get('?file=cv')).status,404);
// Saving keeps the cleaned fields and nothing else.
const saved=await (await post({action:'save',profile:{name:' Synthetic Person ',skills:['GA4','GA4'],secret:'x'}})).json();assert.equal(saved.saved,true);assert.equal(held.profile.name,'Synthetic Person');assert.deepEqual(held.profile.skills,['GA4']);assert(!('secret' in held.profile));
assert.equal((await (await get()).json()).profile.name,'Synthetic Person');assert.equal((await post({action:'erase'})).status,400);
// Uploading: a real PDF header, a size limit, the text read once, the file given back unchanged, the saved fields untouched.
assert.equal((await post(new Uint8Array(400).fill(65),{'content-type':'application/pdf'})).status,400,'not a PDF');assert.equal((await post(pdf(5_000_001),{'content-type':'application/pdf'})).status,400,'too large');assert.equal(held.cv,null);
const up=await (await post(pdf(),{'content-type':'application/pdf','x-file-name':encodeURIComponent('Synthetic CV 2026.pdf')})).json();assert.equal(up.saved,true,String(up.error));assert.deepEqual([up.cv.filename,up.cv.size,up.cv.characters],['Synthetic CV 2026.pdf',400,parsed.length]);assert.equal(held.profile.name,'Synthetic Person');
const file=await get('?file=cv');assert.equal(file.headers.get('content-type'),'application/pdf');assert(/Synthetic CV 2026\.pdf/.test(file.headers.get('content-disposition')));assert.equal((await file.arrayBuffer()).byteLength,400);
parsed=null;const scanned=await (await post(pdf(),{'content-type':'application/pdf'})).json();assert.equal(scanned.saved,true);assert.equal(scanned.cv.characters,0);assert(/almost no text/.test(scanned.message),'an unreadable PDF is stored and said to be unreadable');
// The photo: a real JPG or PNG of at most 2 MB, given back as it was, removable.
const jpg=(size=500)=>{const bytes=new Uint8Array(size).fill(1);bytes.set([0xff,0xd8,0xff,0xe0]);return bytes;};
assert.equal((await post(new Uint8Array(500).fill(7),{'content-type':'image/jpeg'})).status,400,'not a picture');assert.equal((await post(jpg(2_000_001),{'content-type':'image/jpeg'})).status,400,'too large');assert.equal((await post(jpg(),{'content-type':'image/png'})).status,400,'type and content must agree');assert.equal(picture,null);assert.equal((await get('?file=photo')).status,404);
const shot=await (await post(jpg(),{'content-type':'image/jpeg'})).json();assert.equal(shot.saved,true,String(shot.error));assert.equal(shot.photo.size,500);assert.equal((await (await get()).json()).photo.type,'image/jpeg');
const served=await get('?file=photo');assert.equal(served.headers.get('content-type'),'image/jpeg');assert.equal((await served.arrayBuffer()).byteLength,500);
assert.equal((await (await post({action:'remove-photo'})).json()).photo,null);assert.equal(picture,null);assert.equal(held.profile.name,'Synthetic Person','the details are untouched by the photo');
// A MySQL connection that has not passed its test is not used for the CV either, and the page is told so.
database={kind:'mysql',host:'localhost',database:'synthetic_hq',user:'synthetic_user',password:'synthetic-db-password'};const none=await (await get()).json();assert.equal(none.ready,false);assert(/has not passed a test/.test(none.message));assert.equal((await post({action:'save',profile:{}})).status,400);
console.log('CV profile checks passed: photo upload with type and size checks, known fields only with bounded sizes, owner-only and same-site, saving, PDF upload with header and size checks, text read once, file returned, unreadable PDFs reported, database required. Synthetic values only.');
