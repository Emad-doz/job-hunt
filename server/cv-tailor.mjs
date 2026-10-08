// A CV adapted to one vacancy: one model request the owner starts. The model may choose and order what is already in the owner's saved details, and write the headline and the profile paragraph. It cannot add a skill, a job, a date or an achievement: whatever it returns is checked against the saved details and anything that is not there is dropped.
import {cleanProfile} from './profile.mjs';
import {route} from './analyst-ai.mjs';
const text={type:'string'},texts={type:'array',items:text};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const tailorSchema=object({headline:text,about:text,skills:texts,experience:{type:'array',items:object({entry:{type:'integer'},points:texts})},changes:texts});
export const tailorSystem=[
  'You adapt one person\'s CV to one vacancy. The reference material is the person\'s saved CV details as JSON; the request is the vacancy. You are not writing a new CV: you choose, order and summarise what is already there.',
  'Truth comes first. Every fact must come from the saved details. Never add a skill, tool, employer, job title, date, degree, language, number or achievement that is not in them, and never stretch one (for example "used" must not become "led"). If the vacancy asks for something the person does not have, leave it out; do not suggest it.',
  'skills: a selection of the saved skills, copied exactly as written, most relevant to the vacancy first. Leave out the ones that do not matter for this vacancy. Add none.',
  'experience: for each saved job that is worth showing, give its position in the saved list as `entry` (the first job is 0) and the points to show, each copied exactly from that job\'s saved points, most relevant first. Do not rewrite a point, do not merge points and do not move a point to another job. Keep every job that fills the timeline; you may show fewer points for less relevant jobs.',
  'headline: a short professional title for this application, built only from titles and skills the saved details contain. about: a profile paragraph of at most 90 words in the first person without "I" at the start of every sentence, in the language of the saved About me, that says what this person offers for this vacancy using only facts from the saved details. Do not name the employer of the vacancy and do not make claims about motivation or personality that the saved details do not support.',
  'changes: up to six short notes for the person, in plain English, on what you emphasised, what you left out, and any requirement of the vacancy the saved details do not cover. Do not address the employer.',
].join('\n');
const same=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
// Builds the adapted CV from the owner's saved details and the model's answer, keeping only what the saved details contain.
export function applyTailoring(profile,answer){
  const saved=cleanProfile(profile),raw=answer&&typeof answer==='object'?answer:{},dropped=[];
  const skillOf=new Map(saved.skills.map(s=>[same(s),s])),skills=[];
  for(const skill of Array.isArray(raw.skills)?raw.skills:[]){const kept=skillOf.get(same(skill));if(!kept){dropped.push('skill "'+String(skill).slice(0,60)+'"');continue;}if(!skills.includes(kept))skills.push(kept);}
  const chosen=new Map();
  for(const item of Array.isArray(raw.experience)?raw.experience:[]){const index=Number(item?.entry),job=saved.experience[index];if(!Number.isInteger(index)||!job||chosen.has(index)){dropped.push('an experience entry that is not in your details');continue;}
    const pointOf=new Map(job.points.map(p=>[same(p),p])),points=[];for(const point of Array.isArray(item.points)?item.points:[]){const kept=pointOf.get(same(point));if(!kept){dropped.push('a rewritten point under '+(job.title||job.employer||'a job'));continue;}if(!points.includes(kept))points.push(kept);}
    chosen.set(index,{...job,points});}
  // Jobs stay in the saved order, so the timeline reads as it does on the full CV.
  const experience=[...chosen.keys()].sort((a,b)=>a-b).map(index=>chosen.get(index));
  const variant=cleanProfile({...saved,headline:String(raw.headline||'').trim()||saved.headline,about:String(raw.about||'').trim()||saved.about,skills:skills.length?skills:saved.skills,experience:experience.length?experience:saved.experience});
  const changes=(Array.isArray(raw.changes)?raw.changes:[]).map(c=>String(c||'').replace(/\s+/g,' ').trim().slice(0,240)).filter(Boolean).slice(0,6);
  return {variant,changes,dropped:[...new Set(dropped)].slice(0,12),written:{headline:variant.headline!==saved.headline,about:variant.about!==saved.about}};
}
export async function tailorCv({profile,job,ai,call,fetcher}){
  const saved=cleanProfile(profile);if(!saved.experience.length&&!saved.skills.length)throw new Error('Fill in your details on My CV first: there is nothing to adapt yet.');
  const model=ai.model||'claude-opus-5-5',description=String(job.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(description.length<200)throw new Error('This vacancy has too little text to adapt a CV to. Add the full vacancy text to the job first.');
  const vacancy='Vacancy: '+String(job.title||'').slice(0,200)+'\nEmployer: '+String(job.employer||'').slice(0,200)+'\nLocation: '+String(job.location||'').slice(0,120)+'\n\n'+description.slice(0,20000);
  const result=await call({apiKey:ai.apiKey,model,...route(ai),system:tailorSystem,profileJson:JSON.stringify(saved),vacancy,schema:tailorSchema,fetcher});
  let parsed;try{parsed=JSON.parse(result.text);}catch{throw new Error('The model\'s answer could not be read. Nothing was changed.');}
  return {...applyTailoring(saved,parsed),model,servedBy:result.servedBy||model,usage:result.usage||null};
}
