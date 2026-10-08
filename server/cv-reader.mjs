import {Worker} from 'node:worker_threads';
import {skillPatterns} from './skill-evidence.mjs';
import {cvQualificationMentions} from './qualifications.mjs';
import {profileFocus,focusLabels} from './matching.mjs';
export {overlap,mentionedSkills} from './skill-evidence.mjs';

const roles=[['CRO specialist',/\bcro\b|conversion rate|conversion optim/i],['experimentation lead',/a\/?b test|experimentation/i],['digital analyst',/ga4|google analytics|web analytics|digital analytics/i],['digital consultant',/digital consult|digital strategy/i],['ecommerce manager',/e.?commerce/i],['product owner',/product owner|product management/i],['SEO specialist',/\bseo\b|search engine optim/i],['web specialist',/wordpress|web platform|web development/i],['data analyst',/data analyst|data analysis|\bsql\b/i],['digital marketing',/digital marketing|online marketing/i]];
export function extractProfile(text){
  if(text.trim().length<100)throw new Error('The CV has too little readable text. Use a text-based PDF; scanned images are not supported.');
  const professional=text.split(/\bReferences\b|\bReferenties\b/i)[0],focus=profileFocus(professional);
  const evidence=professional.split(/\r?\n|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>=30&&s.length<=650&&!/@|https?:|www\.|\b(?:phone|email|address|references?|contact|straat|postcode)\b|\+?\d[\d ()-]{8,}/i.test(s)&&Object.values(skillPatterns).some(p=>p.test(s))).slice(0,24);
  return {skills:Object.entries(skillPatterns).filter(([,pattern])=>pattern.test(professional)).map(([name])=>name),qualificationMentions:cvQualificationMentions(professional),terms:roles.filter(([,pattern])=>pattern.test(professional)).map(([name])=>name).slice(0,6),wordCount:text.trim().split(/\s+/).length,evidence,...focus,focusLabels:focusLabels(focus),languages:['English','Dutch','Arabic','German','French'].filter(l=>new RegExp('\\b'+l+'\\b','i').test(professional))};
}
async function bounded(response,limit){
  if(!response.body)throw new Error('The CV response was empty.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('The CV exceeds the 2 MB reader limit. Use a smaller document.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export function parsePdf(bytes){return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../dist/server/pdf-reader.cjs',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:96}});
  const timeout=setTimeout(()=>{worker.terminate();reject(new Error('PDF reading timed out. Use a smaller text-based PDF.'));},12000);
  const finish=()=>{clearTimeout(timeout);worker.terminate();};
  worker.once('message',result=>{finish();result.error?reject(new Error(result.error)):resolve(result.text);});
  worker.once('error',()=>{finish();reject(new Error('The PDF reader could not process this CV.'));});
  worker.once('exit',code=>{if(code!==0){clearTimeout(timeout);reject(new Error('The PDF reader stopped before completing.'));}});
});}
// The text is transient: callers must not persist it. Only the bounded profile is retained.
const missing='Upload your CV as a text-based PDF on the My CV page first.';
// The CV is the PDF the owner uploaded on My CV. `store` returns its text with the file name and upload time.
// `own` adds the owner's own skills and role names (matching.mjs ownWords); a failure there never blocks reading the CV.
export const storedCvMaterial=(store,own)=>async()=>{const cv=await store();if(!cv||String(cv.text||'').trim().length<200)throw new Error(missing);let words={};try{words=own?await own():{};}catch{}return {profile:{...extractProfile(cv.text),...words,name:cv.filename||'cv.pdf',mimeType:'application/pdf',modifiedAt:cv.uploadedAt||null,readAt:new Date().toISOString(),sourceUrl:''},text:cv.text};};
export const storedCv=(store,own)=>async()=>(await storedCvMaterial(store,own)()).profile;
// Without a CV store there is nothing to read.
export async function readCvMaterial(){throw new Error(missing);}
export async function readCv(){throw new Error(missing);}
