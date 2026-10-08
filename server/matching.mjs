import {overlap,lawDegree} from './skill-evidence.mjs';

// These are explainable evidence rules, not a probability or a full fit assessment.
export const MATCH_VERSION='cv-role-evidence-v5';
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
  const sharedSkills=overlap(profile?.skills||[],all),coreSkills=sharedSkills.filter(s=>specific.has(s));
  const supported=supportedFamilies(profile),roleMatches=families.filter(f=>supported.includes(f.id)&&f.title.test(title)).map(f=>f.label);
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
  if(!roleMatches.length)reasons.push('Role title does not align with the documented CV role families.');
  if(!coreSkills.length)reasons.push('No specific shared role skills found. Generic analytics or stakeholder wording alone is insufficient.');
  // A model verdict on the whole role lets any profession through; the keyword rules above only know one field of work.
  const screened=job.modelFit&&['relevant','possible','unrelated'].includes(job.modelFit.fit)?job.modelFit:null,ruleMatch=roleMatches.length>0&&coreSkills.length>0,modelMatch=!!screened&&screened.fit!=='unrelated';
  const verdict=screened?(screened.by||'Model screening')+' against your CV: '+(screened.fit==='possible'?'possible match':screened.fit)+'. '+screened.reason:'';
  if(modelMatch&&!ruleMatch)reasons.splice(0,reasons.length,verdict,coreSkills.length?'Shared tool names found by the keyword rules: '+coreSkills.join(', ')+'.':'The keyword rules found no shared tool names; the model judged the role as a whole.');else if(screened)reasons.push(verdict);
  const eligible=!blockers.length&&(ruleMatch||modelMatch);
  const label=blockers.length?'Requirement mismatch':ruleMatch?(coreSkills.length>=2?'Closer CV match':'Possible CV match'):modelMatch?(screened.fit==='relevant'?'Model-screened match':'Model-screened possibility'):screened?'Screened as unrelated':'Insufficient role evidence';
  return {version:MATCH_VERSION,eligible,label,priority:!eligible?0:ruleMatch?(coreSkills.length>=2?2:1):screened.fit==='relevant'?2:1,basis:ruleMatch?'rules':modelMatch?'model':'none',roleMatches,coreSkills,sharedSkills,reasons,blockers,limitations:['Evidence screening only; seniority, language proficiency, salary and full eligibility need review.','Absence from extracted CV evidence does not prove absence of ability.']};
}
