import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeDemo} from '../app/data';
import type {ScoutState} from '../app/scout';
import {collectJobs,sourceIdentity,nextStep,jobStage,jobView,interviewDate,interviewNote} from '../app/daily-model';
import {matchesFit,sortJobs} from '../app/job-board-model';
import EvidenceSources from '../app/evidence-sources';
import DailyWorkspace,{JobDetail} from '../app/daily';
import {saveJobStatus,statusCapability} from '../app/job-status-model';
import {awaitingReply,openProposals,suggestionFor} from '../app/tracker-inbox';
import JobStatus from '../app/job-status';
const at='2026-10-04T10:00:00Z',demo=makeDemo(),fit={version:'synthetic',eligible:true,label:'Closer CV match',priority:3,roleMatches:['CRO'],sharedSkills:['GA4'],coreSkills:['GA4'],blockers:[],reasons:['Synthetic documented evidence'],limitations:['Full requirements need checking']};
const raw={id:'SOURCE-1',sourceId:'source-1',title:'Synthetic analyst',employer:'Synthetic employer',location:'Amsterdam',salary:'Unknown',url:'https://example.test/jobs/1?utm_source=scout',description:'GA4 reporting required',skills:['GA4'],publishedAt:null,readAt:at,source:'Synthetic source',availability:'Source listing only',fit};
const state:ScoutState={protected:true,configured:true,enabled:true,status:'waiting',activeAgent:null,task:null,taskAt:null,lastRun:at,lastSuccess:at,nextCheck:at,error:null,stale:false,location:'Amsterdam',distance:25,terms:[],appId:'',profile:null,events:[],results:[raw],workflows:[],bridgeConfigured:true};
const native={...demo.jobs[0],id:'JOB-0088',role:raw.title,employer:raw.employer,url:'https://example.test/jobs/1?utm_source=tracker',status:'Researching',found:'2026-10-02',foundDate:'2026-10-02',applied:'',appliedDate:'',confirmation:''};
const data={...demo,mode:'synced' as const,stale:false,error:null,jobs:[native],events:[]};
assert.equal(collectJobs(data,state).length,1);assert.equal(collectJobs(data,state)[0].job?.id,native.id);assert.equal(collectJobs(data,state)[0].discovery?.id,raw.id);assert.equal(collectJobs(data,state)[0].fit?.priority,3);
assert.equal(sourceIdentity('https://www.example.test/view?jk=123&utm_source=a'),sourceIdentity('https://example.test/view?utm_source=b&jk=123'));assert.notEqual(sourceIdentity('https://example.test/view?jk=123'),sourceIdentity('https://example.test/view?jk=456'));assert.notEqual(sourceIdentity('https://example.test/find?id=1'),sourceIdentity('https://example.test/find?id=2'));
const bare=collectJobs({...data,jobs:[]},state)[0];assert.equal(bare.key,'discovery:'+raw.id);assert.equal(bare.label,'Discovered');assert(!bare.review);assert(nextStep(bare).title.includes('Start reviewing'));assert(matchesFit(bare,'Recommended'));
const unknown={...bare,key:'unknown',title:'A role',fit:undefined,discovery:undefined,foundAt:''};const held={...bare,key:'held',fit:{...fit,eligible:false,priority:0,blockers:['Specialist qualification missing']}};assert(matchesFit(unknown,'Not assessed'));assert(matchesFit(held,'Not a fit'));assert(!matchesFit(held,'Recommended'));
assert.equal(sortJobs([unknown,held,bare],'Highest match')[0].key,bare.key);assert.equal(sortJobs([bare,unknown],'Job name A–Z')[0].key,unknown.key);assert.equal(sortJobs([unknown,bare],'Found oldest')[0].key,bare.key,'Missing dates stay last in both directions');
const duplicate={...native,id:'JOB-0089',status:'Shortlisted'};const combined=collectJobs({...data,jobs:[native,duplicate]},state);assert.equal(combined.length,1);assert.equal(combined[0].relatedJobs?.[0].id,duplicate.id);assert(combined[0].aliases?.includes('tracker:'+duplicate.id));
assert.equal(collectJobs(demo,state).length,1,'Private source never mixes with demo tracker');assert.equal(collectJobs(demo,{...state,protected:false}).some(i=>i.discovery),false);
const props={mode:'jobs' as const,data:{...data,jobs:[]},state,refresh:async()=>{},sync:async()=>data,selected:bare.key,group:'All jobs' as const,onSelect:()=>{},onGroup:()=>{},onSettings:()=>{},onOffice:()=>{},onRecheck:()=>{},reviewBusy:false,reviewNotice:'',reviewError:'',replay:false};
const markup=renderToStaticMarkup(<DailyWorkspace {...props}/>);assert(markup.includes(raw.title));assert(markup.includes('Sort jobs'));assert(markup.includes('Filter by fit'));assert(markup.includes('Job lists')&&markup.includes('Filter by status')&&markup.includes('Archive '+raw.title));assert(markup.includes('No recorded agent handoff yet'));assert(markup.includes('Source ID:'));assert(!markup.includes('separate from tracker records'));assert(markup.includes('Highest match'));
// Three lists: active, rejected (recorded outcomes that ended) and the owner's archive. Status chips filter the active list.
{
  const at2=(status:string,applied='')=>({job:{...native,status,applied}});
  assert.equal(jobStage({job:undefined}),'Discovered');assert.equal(jobStage(at2('Researching')),'Discovered');assert.equal(jobStage(at2('Applied','2026-10-02')),'Applied');assert.equal(jobStage(at2('Interview','2026-10-02')),'Interview');assert.equal(jobStage(at2('Offer','2026-10-02')),'Offer');
  for(const ended of ['Rejected','Withdrawn','Closed']){assert.equal(jobStage(at2(ended,'2026-10-02')),'Rejected');assert.equal(jobView({...at2(ended),ownerFeedback:undefined}),'rejected');}
  const shelved={id:'HQ-F-1',key:'k',jobId:raw.id,recordId:null,decision:'not-fit' as const,reason:'Archived from the list',at,source:'Owner preference',history:[]};
  assert.equal(jobView({job:undefined,ownerFeedback:shelved}),'archive');assert.equal(jobView({job:undefined,ownerFeedback:{...shelved,decision:'review'}}),'active');assert.equal(jobView({...at2('Rejected'),ownerFeedback:shelved}),'rejected','a recorded outcome wins over the archive');
  const interview={...native,id:'JOB-0090',role:'Synthetic interview role',url:'https://example.test/jobs/2',status:'Interview',applied:'2026-10-01',appliedDate:'2026-10-01'},rejected={...native,id:'JOB-0091',role:'Synthetic rejected role',url:'https://example.test/jobs/3',status:'Rejected',applied:'2026-09-20',appliedDate:'2026-09-20'};
  const board={...props,selected:'',data:{...data,jobs:[interview,rejected]}};
  const activeList=renderToStaticMarkup(<DailyWorkspace {...board}/>);assert(activeList.includes(interview.role)&&activeList.includes(raw.title)&&!activeList.includes(rejected.role),'rejected jobs leave the active list');assert(activeList.includes('2 of 2 jobs'));
  const rejectedList=renderToStaticMarkup(<DailyWorkspace {...board} group="Rejected"/>);assert(rejectedList.includes(rejected.role)&&!rejectedList.includes(interview.role)&&!rejectedList.includes('Filter by status')&&!rejectedList.includes('Archive '+rejected.role));
  const archived={...state,ownerFeedback:{[raw.id]:shelved}};
  const archiveList=renderToStaticMarkup(<DailyWorkspace {...board} state={archived} group="Not a fit"/>);assert(archiveList.includes(raw.title)&&archiveList.includes('Restore '+raw.title)&&!archiveList.includes(interview.role));
  assert(!renderToStaticMarkup(<DailyWorkspace {...board} state={archived}/>).includes('Archive '+raw.title),'an archived job leaves the active list');
  assert(renderToStaticMarkup(<DailyWorkspace {...board} state={archived} group="Not a fit" data={{...data,jobs:[]}} />).includes('1 of 1 jobs'));
}
// The Tracker's Outlook proposals: only open applications are checked, a proposal lapses once the tracker status moved on, and the status editor opens filled in but never confirmed.
{
  const applied={...native,id:'JOB-0101',status:'Applied',applied:'2026-09-20'},closed={...native,id:'JOB-0102',status:'Rejected',applied:'2026-09-01'},early={...native,id:'JOB-0103',status:'Researching',applied:''};
  const tracker={...data,jobs:[applied,closed,early]};assert.deepEqual(awaitingReply(tracker).map(j=>j.recordId),['JOB-0101']);assert.equal(awaitingReply(tracker)[0].appliedOn,'2026-09-20');
  const proposal={recordId:'JOB-0101',employer:'Synthetic employer',role:'Synthetic analyst',current:'Applied',status:'Rejected',label:'Looks like a rejection',subject:'Your application',sender:'hr@example.test',receivedAt:at,excerpt:'Unfortunately',url:'',basis:'The employer is named in the message.'};
  const scan={checkedAt:at,scanned:10,capped:false,jobs:1,proposals:[proposal]};assert.equal(openProposals(scan,tracker).length,1);assert.equal(openProposals(scan,{...tracker,jobs:[{...applied,status:'Rejected'}]}).length,0);assert.equal(openProposals(null,tracker).length,0);
  assert.equal(openProposals({...scan,proposals:[{...proposal,status:'',label:'A message from this employer'}]},tracker).length,1,'a reply with no proposed status is still listed');
  const suggestion=suggestionFor(proposal);assert.equal(suggestion.status,'Rejected');assert(suggestion.reason.includes('Your application')&&suggestion.reason.includes('hr@example.test'));
  const item=collectJobs(tracker,{...state,results:[]}).find(i=>i.job?.id==='JOB-0101')!;
  const filled=renderToStaticMarkup(<JobStatus item={item} data={tracker} state={{...state,results:[]}} replay={false} refresh={async()=>{}} sync={async()=>tracker} suggest={suggestion}/>);assert(filled.includes('aria-expanded="true"')&&filled.includes('Filled in from a reply the Tracker found in your mailbox'));
  assert(renderToStaticMarkup(<JobStatus item={item} data={tracker} state={{...state,results:[]}} replay={false} refresh={async()=>{}} sync={async()=>tracker}/>).includes('aria-expanded="false"'));
}
// The interview date entered with an Interview status travels in the note of that change and is read back from the job's newest event that carries one.
{
  assert.equal(interviewNote('2026-10-12','14:00'),'Interview on 2026-10-12 at 14:00. ');assert.equal(interviewNote('2026-10-12',''),'Interview on 2026-10-12. ');assert.equal(interviewNote('',''),'');
  const meeting={...native,id:'JOB-0110',status:'Interview',applied:'2026-10-01'},event=(id:string,date:string,details:string)=>({...demo.events[0],id,recordId:'JOB-0110',date,details});
  const log=[event('EVT-1','2026-10-02T09:00:00Z','[HQ status x] Owner requests status Applied → Interview. Reason: Interview on 2026-10-09 at 10:30. Phone call.'),event('EVT-2','2026-10-05T09:00:00Z','[HQ status y] Owner requests status Applied → Interview. Reason: Interview on 2026-10-12. Second round.'),event('EVT-3','2026-10-06T09:00:00Z','Unrelated note')];
  assert.deepEqual(interviewDate(meeting,log),{date:'2026-10-12',time:''});assert.deepEqual(interviewDate(meeting,log.slice(0,1)),{date:'2026-10-09',time:'10:30'});assert.equal(interviewDate(meeting,[]),undefined);assert.equal(interviewDate({...meeting,status:'Rejected'},log),undefined,'shown only while the job is in Interview');
  const listed=collectJobs({...data,jobs:[meeting],events:log},{...state,results:[]})[0];assert.deepEqual(listed.interview,{date:'2026-10-12',time:''});
  // A date saved in HQ wins, also for a job that was already in Interview with no dated note; it is not shown once the job leaves Interview.
  const keptDate={interviewDates:{'JOB-0110':{date:'2026-10-20',time:'09:30',at}}};assert.deepEqual(collectJobs({...data,jobs:[meeting],events:log},{...state,results:[],...keptDate})[0].interview,{date:'2026-10-20',time:'09:30'});assert.deepEqual(collectJobs({...data,jobs:[meeting],events:[]},{...state,results:[],...keptDate})[0].interview,{date:'2026-10-20',time:'09:30'});assert.equal(collectJobs({...data,jobs:[{...meeting,status:'Rejected'}],events:[]},{...state,results:[],...keptDate})[0].interview,undefined);
  const editor=renderToStaticMarkup(<JobStatus item={listed} data={{...data,jobs:[meeting],events:log}} state={{...state,results:[]}} replay={false} refresh={async()=>{}} sync={async()=>data}/>);assert(editor.includes('Interview date for this job')&&editor.includes('Saved in HQ only')&&editor.includes('value="2026-10-12"'));
  assert(renderToStaticMarkup(<DailyWorkspace {...props} selected="" data={{...data,jobs:[meeting],events:log}} state={{...state,results:[]}}/>).includes('Interview 2026-10-12'));
}
const card=renderToStaticMarkup(<EvidenceSources data={data} state={state} onOpen={()=>{}}/>);assert(/<button[^>]*class="unified-board-link"/.test(card));assert(card.includes('1 jobs on your board'));assert(!card.includes('HQ Scout discoveries'));
const detail=renderToStaticMarkup(<JobDetail {...props} item={collectJobs(data,state)[0]} onBack={()=>{}}/>);assert(detail.includes('Edit job status'));assert(detail.includes('JOB-0088'));assert(detail.includes('Source ID:'));
const input={action:'status' as const,recordId:native.id,requestId:'HQ-S-00000000-0000-4000-8000-000000000001',status:'Shortlisted',expectedStatus:'Researching',expectedApplied:'',reason:'Owner reviewed suitability',confirmStatus:true as const};
const receipt={recordId:native.id,eventId:'EVT-0200',status:'Shortlisted',appliedOn:'',at,duplicate:false,source:'Synthetic bridge'};
assert.equal((await saveJobStatus(input,async()=>Response.json({saved:true,receipt}))).status,'Shortlisted');await assert.rejects(()=>saveJobStatus(input,async()=>Response.json({saved:true,receipt:{...receipt,status:'Interview'}})),/not confirmed/);await assert.rejects(()=>saveJobStatus(input,async()=>Response.json({saved:false,error:'Record changed'},{status:400})),/Record changed/);
assert.equal((await statusCapability(async()=>Response.json({available:false,statuses:[],message:'Upgrade bridge'}))).available,false);
// One vacancy posted in two places: a discovery with another address is its own entry until the owner links it to the job; then it shows inside that job, stays linked when found again under a new ID, and can be told apart on the job.
{const elsewhere={...raw,id:'OTHER-9',sourceId:'other-9',url:'https://another-board.example.test/vacancy/777',source:'Another synthetic board'},twice={...state,results:[elsewhere]};
  const apart=collectJobs(data,twice);assert.deepEqual(apart.map(i=>i.key).sort(),['discovery:OTHER-9','tracker:JOB-0088']);
  const link={jobId:'OTHER-9',url:elsewhere.url,title:elsewhere.title,employer:elsewhere.employer,source:elsewhere.source,recordId:'JOB-0088',at};
  const one=collectJobs(data,{...twice,sameAs:[link]});assert.deepEqual([one.length,one[0].key,one[0].job?.id,one[0].discovery?.id,one[0].linked?.map(l=>l.jobId),one[0].aliases?.includes('discovery:OTHER-9')],[1,'tracker:JOB-0088','JOB-0088','OTHER-9',['OTHER-9'],true]);
  const again=collectJobs(data,{...twice,results:[{...elsewhere,id:'OTHER-10',url:elsewhere.url+'?utm_source=alert'}],sameAs:[link]});assert.deepEqual([again.length,again[0].linked?.length],[1,1],'the same posting found again under a new ID stays linked');
  assert.equal(collectJobs(data,{...twice,sameAs:[{...link,recordId:'JOB-4040'}]}).length,2,'a link to a job that is gone leaves the posting as its own entry');
  assert.equal(collectJobs(data,{...twice,protected:false,sameAs:[link]}).some(i=>i.linked),false);
  const shown=renderToStaticMarkup(<JobDetail item={one[0]} data={data} state={{...twice,sameAs:[link]}} replay={false} refresh={async()=>{}} sync={async()=>undefined} onBack={()=>{}}/>);assert(shown.includes('ALSO POSTED AS')&&shown.includes('Another synthetic board')&&shown.includes('Unlink'));
  const offer=renderToStaticMarkup(<JobDetail item={apart.find(i=>i.key==='discovery:OTHER-9')!} data={data} state={twice} replay={false} refresh={async()=>{}} sync={async()=>undefined} onBack={()=>{}}/>);assert(offer.includes('Already one of your jobs? Link it')&&offer.includes('JOB-0088')&&!offer.includes('ALSO POSTED AS'));}
console.log('Unified board checks passed: clickable single total, raw discoveries, native/source identity and history, tracking URL deduplication, fit and stable sorting, full records, protected demo separation and truthful status receipts. Synthetic data only.');
