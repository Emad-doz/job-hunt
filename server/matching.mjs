import {overlap,lawDegree,skillPatterns} from './skill-evidence.mjs';

// These are explainable evidence rules, not a probability or a full fit assessment.
export const MATCH_VERSION='cv-role-evidence-v6';
export const REVIEW_LIMIT=1500;
const families=[
  {id:'conversion',label:'CRO & experimentation',title:/\bcro\b|conversion(?: rate)? optimi[sz]|experiment(?:ation|s)? (?:lead|manager|specialist|analyst)|(?:lead|manager|specialist|analyst).*experiment|growth (?:analyst|optimi[sz])/i,cv:/\bcro\b|conversion(?: rate)? optimi[sz]|a\/?b test|experimentation/i},
  {id:'analytics',label:'Digital & product analytics',title:/(?:digital|web|product|marketing|customer|behavio\w*|conversion|e.?commerce) (?:data )?analy(?:st|tics)|(?:digital|web|product|marketing|customer) insights|(?:analytics|insights) (?:specialist|consultant|lead|manager)|(?:data|business intelligence|bi) analyst|power bi (?:specialist|analyst|consultant)/i,cv:/ga4|google analytics|google tag manager|digital analytics|web analytics|behavioral analytics|behavioural analytics|power bi|data analys/i},
  {id:'commerce',label:'E-commerce & digital growth',title:/e.?commerce|e.?business|digital (?:growth|experience)|growth (?:marketing|specialist|manager)|personalization|personalisatie/i,cv:/e.?commerce|funnel optimi[sz]|personalization|personalisatie/i},
  {id:'consulting',label:'Digital consulting & UX',title:/digital consultant|digital (?:strategy|transformation)|ux (?:specialist|consultant|analyst)|customer journey|web (?:specialist|consultant)/i,cv:/digital consult|digital strategy|ux optimi[sz]|customer journey/i},
  {id:'marketing',label:'Digital marketing & SEO',title:/digital market|online market|\bseo\b|marketing analyst/i,cv:/digital marketing|online marketing|\bseo\b|search engine optimi[sz]/i},
  {id:'product',label:'Product ownership',title:/product (?:owner|manager)|product ownership/i,cv:/product owner|product management/i}
];
const specific=new Set(['GA4','Google Tag Manager','CRO','Experimentation','Power BI','SQL','SEO','Digital marketing','UX optimization','Personalization']);
const lawTitle=/\b(?:lawyer|attorney|solicitor|paralegal|jurist|advocaat|litigation|notaris|notary)\b|legal (?:counsel|advisor|adviser|specialist|officer|manager|director|associate|team lead|lead|head)|(?:head|director|lead) of legal|juridisch(?:e)? (?:adviseur|medewerker)|(?:regulatory|compliance) (?:counsel|officer|manager|specialist)/i;
const lawQualification=new RegExp('\\b(?:law|legal) degree\\b|degree (?:in|of) law|bachelor.{0,25}\\b(?:laws?|rechten)\\b|master.{0,25}\\b(?:laws?|rechten)\\b|'+lawDegree+'|(?:admitted|qualified).{0,35}(?:bar|lawyer|attorney)|(?:legal|juridisch\\w*) (?:work )?(?:experience|ervaring)|(?:ervaring|experience).{0,35}(?:as a lawyer|as an attorney|als advocaat)','i');
const optional=/not (?:required|necessary)|no .{0,25}(?:required|necessary)|preferred|nice.to.have|desirable|a plus|advantage|preference|\been pre\b|not mandatory|geen .{0,25}vereist/i;
const required=/\brequired\b|\bmust\b|mandatory|essential|minimum|at least|\bneed\b|\byou have\b|\byou hold\b|\byou bring\b|qualifications|requirements|\d+\+?\s*(?:years?|jaar)|\bvereist\b|\bminimaal\b/i;
const snippets=text=>String(text||'').replace(/<[^>]*>/g,' ').split(/\n|(?<=[.!?;,])\s+/).map(s=>s.trim()).filter(Boolean);

// The owner's own words: the skills on My CV, the job titles there, and the roles being searched for. They are compared literally, without accents or capitals, so they work for any profession and in whatever language they were written.
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu,' ').trim();
const rank=/^(?:senior|junior|medior|lead|principal|head|chief|sr|jr|interim|trainee|intern|m|f|v|x|d|w)$/;
export function ownWords(details,terms=[]){
  const tidy=(values,max,limit)=>[...new Map(values.map(v=>String(v||'').replace(/\s+/g,' ').trim()).filter(v=>v.length>=2&&v.length<=limit&&fold(v).length>=2).map(v=>[fold(v),v])).values()].slice(0,max);
  return {ownSkills:tidy(Array.isArray(details?.skills)?details.skills:[],60,60),ownRoles:tidy([...(Array.isArray(terms)?terms:[]),...String(details?.headline||'').split(/[|·•,;/]| [-–—] /),...(Array.isArray(details?.experience)?details.experience.map(e=>e?.title):[])],30,80)};
}
const named=(text,phrase)=>(' '+text+' ').includes(' '+phrase+' ');
// A role name matches a title when every word of it is there, in any order, leaving out ranks such as senior or lead.
const roleNamed=(title,role)=>{const words=fold(role).split(' ').filter(w=>w&&!rank.test(w));if(!words.length||words.join('').length<4)return false;const present=new Set(title.split(' '));return words.every(w=>present.has(w));};
export function profileFocus(text){
  const professional=String(text||'').split(/\bReferences\b|\bReferenties\b/i)[0];
  return {roleFamilies:families.filter(f=>f.cv.test(professional)).map(f=>f.id),legalBackground:new RegExp('(?:bachelor|master|degree).{0,45}(?:of laws?|in law|rechten)|'+lawDegree+'|(?:employment|experience|worked|work|role).{0,65}(?:lawyer|attorney|legal counsel|advocaat)|(?:senior|junior) legal counsel','i').test(professional)};
}
export function focusLabels(profile){return families.filter(f=>supportedFamilies(profile).includes(f.id)).map(f=>f.label);}
function supportedFamilies(profile){
  if(Array.isArray(profile?.roleFamilies))return profile.roleFamilies;
  // Older saved profiles can be classified without fetching or exposing the full CV.
  const text=[...(profile?.terms||[]),...(profile?.skills||[]),...(profile?.evidence||[])].join(' ');
  return families.filter(f=>f.cv.test(text)).map(f=>f.id);
}
export function assessMatch(job,profile){
  const title=String(job.title||''),description=String(job.description||''),all=title+' '+description;
  const known=overlap(profile?.skills||[],all),folded=fold(all),listed=new Set(Object.keys(skillPatterns).map(fold));
  // A skill the built-in list already knows keeps its own rule; anything else the owner listed counts when the vacancy names it.
  const own=(profile?.ownSkills||[]).filter(s=>!listed.has(fold(s))&&named(folded,fold(s))),sharedSkills=[...known,...own],coreSkills=[...known.filter(s=>specific.has(s)),...own];
  const supported=supportedFamilies(profile),foldedTitle=fold(title),roleMatches=[...families.filter(f=>supported.includes(f.id)&&f.title.test(title)).map(f=>f.label),...(profile?.ownRoles||[]).filter(r=>roleNamed(foldedTitle,r)).slice(0,3)];
  const blockers=[];
  if(!profile)blockers.push('CV evidence unavailable; read the linked CV before making a recommendation.');
  if(!profile?.legalBackground){
    if(lawTitle.test(title))blockers.push('This is a legal / compliance specialist role. A legal career or qualification is not documented in the extracted CV evidence.');
    for(const sentence of snippets(description))if(lawQualification.test(sentence)&&!optional.test(sentence)){blockers.push((required.test(sentence)?'Required':'Mentioned')+' legal qualification / experience is not documented in the CV: '+sentence.slice(0,360));break;}
  }
  if(/chief revenue officer|chief risk officer/i.test(title))blockers.push('CRO here denotes an executive revenue / risk role, not conversion optimisation.');
  const reasons=[];
  if(roleMatches.length)reasons.push('Role title aligns with documented CV focus: '+roleMatches.join(', ')+'.');
  if(coreSkills.length)reasons.push('Specific shared evidence: '+coreSkills.join(', ')+'.');
  if(!roleMatches.length)reasons.push('Role title does not align with the role families found in your CV, the job titles on My CV or your search terms.');
  if(!coreSkills.length)reasons.push('No specific shared skills found: none of the skills on My CV is named in this vacancy. Generic wording alone is insufficient.');
  // A model verdict judges the role as a whole; the rules above only compare names.
  const screened=job.modelFit&&['relevant','possible','unrelated'].includes(job.modelFit.fit)?job.modelFit:null,ruleMatch=roleMatches.length>0&&coreSkills.length>0,modelMatch=!!screened&&screened.fit!=='unrelated';
  const verdict=screened?(screened.by||'Model screening')+' against your CV: '+(screened.fit==='possible'?'possible match':screened.fit)+'. '+screened.reason:'';
  if(modelMatch&&!ruleMatch)reasons.splice(0,reasons.length,verdict,coreSkills.length?'Shared tool names found by the keyword rules: '+coreSkills.join(', ')+'.':'The keyword rules found no shared tool names; the model judged the role as a whole.');else if(screened)reasons.push(verdict);
  const eligible=!blockers.length&&(ruleMatch||modelMatch);
  const label=blockers.length?'Requirement mismatch':ruleMatch?(coreSkills.length>=2?'Closer CV match':'Possible CV match'):modelMatch?(screened.fit==='relevant'?'Model-screened match':'Model-screened possibility'):screened?'Screened as unrelated':'Insufficient role evidence';
  return {version:MATCH_VERSION,eligible,label,priority:!eligible?0:ruleMatch?(coreSkills.length>=2?2:1):screened.fit==='relevant'?2:1,basis:ruleMatch?'rules':modelMatch?'model':'none',roleMatches,coreSkills,sharedSkills,reasons,blockers,limitations:['Evidence screening only; seniority, language proficiency, salary and full eligibility need review.','Absence from extracted CV evidence does not prove absence of ability.']};
}
