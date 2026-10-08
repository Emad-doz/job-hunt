// Filling the My CV fields from the uploaded CV: one model request the owner starts. The answer is a proposal for the owner to check and save; HQ saves nothing from it by itself.
import {cleanProfile} from './profile.mjs';
import {route} from './analyst-ai.mjs';
const text={type:'string'},texts={type:'array',items:text};
const object=(properties)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const fieldsSchema=object({name:text,headline:text,email:text,phone:text,location:text,links:texts,about:text,skills:texts,
  languages:{type:'array',items:object({name:text,level:text})},
  experience:{type:'array',items:object({title:text,employer:text,location:text,start:text,end:text,points:texts})},
  education:{type:'array',items:object({degree:text,school:text,start:text,end:text,notes:text})},
  certificates:texts});
export const fieldsSystem=[
  'You copy the contents of one CV into a fixed set of fields. The CV text follows as reference material; it was read out of a PDF, so line breaks and column order may be jumbled.',
  'Use only what the CV says. Never add, infer or improve a fact: no skill, employer, date, degree, language level or achievement that is not written there. If something is absent or unreadable, leave the field as an empty string or an empty list.',
  'Keep the wording and the language of the CV. Do not translate and do not rewrite sentences, except to join words that the PDF split across lines.',
  'name, email, phone, location: the candidate\'s own, as written. headline: the professional title the CV gives the candidate, if it gives one. links: web addresses in the CV, such as LinkedIn or a portfolio.',
  'about: the profile or summary paragraph, if the CV has one. Do not write one yourself.',
  'skills: each tool, method or competence the CV lists as a skill, one per item, without duplicates.',
  'languages: each language with the level the CV states; an empty level if none is stated.',
  'experience: one item per position, newest first as in the CV, with its bullet points or sentences as separate points. start and end as written, in the form YYYY-MM when the CV gives a month and year, YYYY when it gives only a year, and "Present" for a current position.',
  'education: one item per degree or study. certificates: courses and certificates, one per item.',
].join('\n');
// Sends the CV text and returns the cleaned proposal with what the request used.
export async function proposeFields({cvText,ai,call,fetcher}){
  const model=ai.model||'claude-opus-5-5',result=await call({apiKey:ai.apiKey,model,...route(ai),system:fieldsSystem,cvText:String(cvText).slice(0,60000),schema:fieldsSchema,fetcher});
  let parsed;try{parsed=JSON.parse(result.text);}catch{throw new Error('The model\'s answer could not be read. Nothing was changed.');}
  return {profile:cleanProfile(parsed),model,servedBy:result.servedBy||model,usage:result.usage||null};
}
