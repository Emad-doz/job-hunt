export type MatchAssessment={version:string;eligible:boolean;label:string;priority:number;roleMatches:string[];coreSkills:string[];sharedSkills:string[];reasons:string[];blockers:string[];limitations:string[]};
export type MatchReview={currentFit?:MatchAssessment;currentRules?:boolean;superseded?:boolean};
export const canAppendReview=(review:MatchReview)=>review.currentFit?.eligible===true&&review.currentRules===true&&!review.superseded;
export function MatchEvidence({fit,previous=false}:{fit?:MatchAssessment;previous?:boolean}){
  return <section className={'match-evidence '+(fit?.eligible?'match-positive':'match-held')} aria-label="CV role screening"><strong>{fit?.label||'CV screening unavailable'}</strong>{fit&&<><p>{fit.reasons.join(' ')}</p>{fit.blockers.length>0&&<ul>{fit.blockers.map((s,i)=><li key={i}>{s}</li>)}</ul>}<small>CV evidence screening · seniority, salary, language proficiency and full requirements still need review.</small></>}{previous&&<p className="match-review-needed">This saved review used earlier rules or CV evidence. Start reviewing to record a current review. Previous receipts are preserved.</p>}</section>;
}
