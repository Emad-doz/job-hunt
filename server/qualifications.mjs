// A bounded, descriptive comparison. This never makes eligibility decisions.
import {tagManager,lawDegree} from './skill-evidence.mjs';
export const QUALIFICATION_VERSION='qualification-mentions-v2';
const definitions=[
 ['ga4','GA4',/\bga4\b|google analytics\s*4\b/i],
 ['analytics','Google Analytics',/google analytics(?!\s*4\b)/i],
 ['gtm','Google Tag Manager',tagManager],
 ['cro','Conversion optimisation',/conversion (?:rate|optim)|conversie.?optimi/i],
 ['experimentation','A/B testing & experimentation',/a\/?b.?test|experimentation|experimenteren/i],
 ['seo','SEO',/\bseo\b|search engine optim|zoekmachine.?optimi/i],
 ['powerbi','Power BI',/\bpower\s?bi\b/i],
 ['sql','SQL',/\bsql\b/i],['python','Python',/\bpython\b/i],
 ['javascript','JavaScript',/\bjavascript\b/i],['typescript','TypeScript',/\btypescript\b/i],
 ['wordpress','WordPress',/\bwordpress\b/i],['shopify','Shopify',/\bshopify\b/i],
 ['ux','UX & customer journeys',/\bux\b|user experience|customer journey|klantreis/i],
 ['personalisation','Personalisation',/personali[sz]ation|personalisatie|crobox|blueconic/i],
 ['product','Product ownership',/product owner|product management|productmanagement/i],
 ['commerce','E-commerce',/\be.?commerce\b/i],
 ['stakeholders','Stakeholder collaboration',/\bstakeholders?\b/i],
 ['marketing','Digital marketing',/digital marketing|online marketing/i],
 ['privacy','GDPR / privacy',/\bgdpr\b|\bavg\b|algemene verordening gegevensbescherming/i],
 ['security','Information security governance',/information security governance|governance van informatiebeveiliging|management van informatiebeveiliging/i],
 ['dataquality','Data quality',/data quality|datakwaliteit/i],
 ['priorities','Task prioritisation',/prioriti[sz](?:e|ing|ation)|prioriteren van taken/i],
 ['architecture','Data architecture',/data architecture|data.?architectuur/i],
 ['leadership','People / team leadership',/people management|team leadership|leidinggeven|leidinggevende|manage a team|leading a team/i],
 ['law','Legal qualification / experience',new RegExp('law degree|degree in law|'+lawDegree+'|legal counsel|juridische (?:ervaring|opleiding)|rechtenstudie','i')]
];
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp);/g,' ').trim();
const sentences=value=>clean(value).split(/\r?\n|(?<=[.!?;])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
const negative=/\b(?:no|without|not|lack|lacking|geen|zonder)\b.{0,45}(?:experience|ervaring|knowledge|kennis|skill|proficien|familiar)|(?:experience|ervaring|knowledge|kennis).{0,30}\b(?:not|none|geen)\b/i;
const optional=/optional|preferred|nice to have|bonus|not (?:required|necessary)|no .{0,45}(?:required|necessary)|een pre|bij voorkeur|geen .{0,45}(?:vereist|nodig)/i;
// Retain only recognised keys, never extra CV text or contact details.
export function cvQualificationMentions(text){
 const lines=sentences(String(text||'').split(/\bReferences\b|\bReferenties\b/i)[0]).filter(s=>!/@|https?:|www\.|\b(?:phone|email|address|contact|straat|postcode)\b|\+?\d[\d ()-]{8,}/i.test(s));
 return definitions.filter(([, ,pattern])=>lines.some(s=>pattern.test(s)&&!negative.test(s))).map(([key])=>key);
}
export function qualificationOverview(description,profile){
 const lines=sentences(description),evidence=(profile?.evidence||[]).filter(s=>typeof s==='string').flatMap(sentences),keys=profile?.qualificationMentions;
 const items=[];
 for(const [key,label,pattern] of definitions){
  const found=lines.find(s=>pattern.test(s));if(!found)continue;
  const quote=evidence.find(s=>pattern.test(s)&&!negative.test(s));
  const mentioned=!!profile&&(Array.isArray(keys)?keys.includes(key):!!quote);
  items.push({key,label,status:!profile?'unknown':mentioned?'documented':'check',vacancyEvidence:found.slice(0,480),cvEvidence:mentioned?(quote?.slice(0,650)||'Recognised mention in the privately read CV; no retained sentence is available.'):'Not documented in the retained CV evidence. This does not prove you lack the skill.',note:optional.test(found)?'This excerpt contains optional / preferred wording. Check the original requirement.':'Mentioned in the vacancy; requirement level needs checking.'});
 }
 for(const [key,label,pattern] of [
  ['experience','Experience & seniority',/\b\d+\+?\s*(?:years?|jaar)\b|senior experience|senioriteit/i],
  ['education','Education / qualification',/\bbachelor|\bmaster|\bdegree|\bhbo\b|\bwo\b|opleiding|diploma/i],
  ['language','Language proficiency',/\b(?:english|dutch|nederlands|german|french|arabic)\b|language proficiency|taalvaardigheid/i],
  ['eligibility','Work eligibility',/work permit|right to work|visa sponsorship|werkvergunning/i]
 ]){const found=lines.find(s=>pattern.test(s));if(found)items.push({key,label,status:'unknown',vacancyEvidence:found.slice(0,480),cvEvidence:'Needs your review. Duration, qualification equivalence, proficiency and work eligibility are not inferred from keywords.',note:optional.test(found)?'Optional / preferred wording appears here; verify the original.':'Check the original requirement against your circumstances.'});}
 return {version:QUALIFICATION_VERSION,items,documented:items.filter(i=>i.status==='documented').length,total:items.length,cvReadAt:profile?.readAt||null,cvSource:profile?.sourceUrl||null,hasProfile:!!profile};
}
