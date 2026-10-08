const tagCue='(?:\\btag|ga4|google analytics|adobe analytics|tracking|pixel|data ?layer|looker|bigquery)';
// "GTM" in a vacancy usually means go-to-market; it counts as Google Tag Manager only beside a tagging or analytics-tool cue.
export const tagManager=new RegExp('google tag manager|\\bgtm\\b[^.;]{0,80}'+tagCue+'|'+tagCue+'[^.;]{0,80}\\bgtm\\b','i');
// "LLM" is nearly always a language model; it counts as a law degree only beside legal wording.
export const lawDegree='\\bllb\\b|\\bjuris doctor\\b|\\bllm\\b(?=[^.;]{0,60}\\b(?:laws?|legal|degree|rechten)\\b)|\\b(?:laws?|legal|llb|rechten)\\b[^.;]{0,60}\\bllm\\b';
export const skillPatterns={
  GA4:/\bga4\b|google analytics/i, 'Google Tag Manager':tagManager,
  SEO:/\bseo\b|search engine optim/i, CRO:/\bcro\b|conversion rate|conversion optim/i,
  Analytics:/analytics|data analys/i, 'Power BI':/power\s?bi/i,
  WordPress:/wordpress/i,Shopify:/shopify/i,SQL:/\bsql\b/i,Python:/\bpython\b/i,JavaScript:/javascript|typescript/i,
  Experimentation:/a\/?b test|experimentation/i, 'UX optimization':/ux optimi[sz]|user experience optimi[sz]|funnel optimi[sz]|customer journey/i,
  Personalization:/personali[sz]ation|crobox|blueconic/i,
  'Product ownership':/product owner|product management|roadmap/i,'E-commerce':/e.?commerce/i,
  'Stakeholder collaboration':/stakeholder/i,'Digital marketing':/digital marketing|online marketing/i
};
export function overlap(skills,text){return skills.filter(skill=>skillPatterns[skill]?.test(text));}
export function mentionedSkills(text){return overlap(Object.keys(skillPatterns),text);}
