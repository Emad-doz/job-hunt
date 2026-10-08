import assert from 'node:assert/strict';
import {emailMatch,createMail,classifyReply,proposeUpdates,describeReply,replyKey} from '../server/mail.mjs';
// A pasted email is read with the same rules as the mailbox check.
assert.deepEqual(describeReply('Great talent does not always fit an open role immediately. We will review your profile and keep it in mind for future opportunities.'),{status:'On hold',label:'No opening now, your profile is kept'});assert.equal(describeReply('Unfortunately we have decided to continue with other candidates.').status,'Rejected');assert.equal(describeReply('We would like to invite you for an interview next week.').status,'Interview');assert.deepEqual(describeReply('Thank you for your application. We received your application.'),{status:'',label:'Confirmation that your application arrived'});assert.deepEqual(describeReply('Could you send us your portfolio this week please?'),{status:'',label:'No clear outcome in this text'});
// The Tracker proposes a status from the words of a reply; it never decides. Synthetic messages only.
{
  assert.equal(classifyReply('Unfortunately we have decided to continue with other candidates')?.status,'Rejected');assert.equal(classifyReply('Helaas gaan wij niet verder met je sollicitatie')?.status,'Rejected');
  assert.equal(classifyReply('We would like to invite you for an interview')?.status,'Interview');assert.equal(classifyReply('Graag nodigen wij je uit voor een kennismakingsgesprek')?.status,'Interview');
  assert.equal(classifyReply('We are pleased to offer you the position')?.status,'Offer');assert.equal(classifyReply('Your weekly newsletter is here'),null);
  const jobs=[{recordId:'JOB-001',employer:'Synthetic Retail BV',role:'Digital Analyst',status:'Applied',appliedOn:'2026-09-20'},{recordId:'JOB-002',employer:'Example Labs',role:'CRO Specialist',status:'Applied',appliedOn:'2026-09-25'},{recordId:'JOB-003',employer:'Quiet Co',role:'Analyst',status:'Interview',appliedOn:''}];
  const message=(id,from,subject,preview,at,folder='inbox')=>({id,subject,bodyPreview:preview,from:{emailAddress:{address:from,name:''}},receivedDateTime:at,webLink:'https://outlook.live.com/mail/0/id/'+id,parentFolderId:folder});
  const proposals=proposeUpdates([
    message('1','hr@syntheticretail.example','Your application at Synthetic Retail BV','Unfortunately we have decided to continue with other candidates.','2026-10-01T09:00:00Z'),
    message('2','jobs@examplelabs.example','Next step','We would like to invite you for an interview next week.','2026-10-02T09:00:00Z'),
    message('3','noreply@examplelabs.example','Thanks','Thank you for your application. We received your application.','2026-09-26T09:00:00Z'),
    message('4','me@mailbox.example','Re: Synthetic Retail BV','Unfortunately I cannot make it','2026-10-03T09:00:00Z','sent'),
    message('5','hr@syntheticretail.example','Earlier','Unfortunately not selected at Synthetic Retail BV','2026-09-01T09:00:00Z'),
    message('6','talent@quietco.example','Quiet Co interview','We would like to schedule a call for your interview at Quiet Co','2026-10-02T10:00:00Z'),
    message('7','news@unrelated.example','Sale','Unfortunately this offer ends soon','2026-10-02T11:00:00Z'),
  ],jobs,'sent');
  assert.deepEqual(proposals.map(p=>[p.recordId,p.status]).sort(),[['JOB-001','Rejected'],['JOB-002','Interview']],'one entry per job; a clear outcome beats an older receipt; my own sent mail, a message from before the application, an unrelated sender and a message that only repeats the current status are ignored');
  assert(proposals.every(p=>p.url.startsWith('https://outlook.live.com/')&&p.basis&&p.excerpt.length<=320&&/^[a-f0-9]{24}$/.test(p.key)));
  // A reply the owner dealt with is left out of later checks together with everything older for that job; only newer mail is shown.
  const pair=[message('2','jobs@examplelabs.example','Next step','We would like to invite you for an interview next week.','2026-10-02T09:00:00Z'),message('3','noreply@examplelabs.example','Thanks','Thank you for your application. We received your application.','2026-09-26T09:00:00Z')];
  const [first]=proposeUpdates(pair,jobs,'sent');assert.equal(first.key,replyKey('JOB-002','2026-10-02T09:00:00Z','Next step'));
  assert.deepEqual(proposeUpdates(pair,jobs,'sent',{'JOB-002':first.receivedAt}),[],'the older receipt does not take the removed message\'s place');
  assert.deepEqual(proposeUpdates([...pair,message('12','jobs@examplelabs.example','Update','Unfortunately we decided to continue with other candidates.','2026-10-06T09:00:00Z')],jobs,'sent',{'JOB-002':first.receivedAt}).map(p=>[p.recordId,p.status]),[['JOB-002','Rejected']],'mail that arrived later is still shown');
  // The whole message is read when supplied: an employer named only below the preview is found, and so is an outcome there.
  const deep=proposeUpdates([{...message('13','no-reply@ats.example','Your application','Dear applicant,','2026-10-04T09:00:00Z'),body:{content:'Dear applicant, thank you for your interest in Example Labs. Unfortunately we have decided to continue with other candidates.'}}],jobs,'sent');assert.deepEqual(deep.map(p=>[p.recordId,p.status]),[['JOB-002','Rejected']]);
  // Two open applications at one employer: a message naming a role goes to that role; one naming none is listed for both, and says so.
  const twins=[{recordId:'JOB-010',employer:'Twin Works',role:'Digital Analyst',status:'Applied',appliedOn:''},{recordId:'JOB-011',employer:'Twin Works',role:'CRO Specialist',status:'Applied',appliedOn:''}];
  const named=proposeUpdates([message('14','hr@twinworks.example','Your application for CRO Specialist','Unfortunately we decided to continue with other candidates at Twin Works.','2026-10-05T09:00:00Z')],twins,'sent');assert.deepEqual(named.map(p=>p.recordId),['JOB-011']);assert(/names this role/.test(named[0].basis));
  const vague=proposeUpdates([message('15','hr@twinworks.example','Your application','Unfortunately we decided to continue with other candidates at Twin Works.','2026-10-05T09:00:00Z')],twins,'sent');assert.deepEqual(vague.map(p=>p.recordId),['JOB-010','JOB-011']);assert(/2 open applications/.test(vague[0].basis));
  // Once the newest outcome agrees with the tracker, older mail about that job is not dug up.
  assert.deepEqual(proposeUpdates([message('16','talent@quietco.example','Quiet Co interview','We would like to schedule a call for your interview at Quiet Co','2026-10-02T10:00:00Z'),message('17','talent@quietco.example','Quiet Co','Thank you for your application to Quiet Co. We received your application.','2026-09-20T10:00:00Z')],jobs,'sent'),[]);
  // A talent-pool answer proposes On hold; a bare receipt or any other employer message is shown with no status proposed.
  const pool=proposeUpdates([message('9','hello@syntheticretail.test','Thanks for your interest','Great talent does not always fit an open role immediately. We will review your profile and keep it in mind for future opportunities.','2026-10-06T09:00:00Z')],jobs,'sent');assert.deepEqual(pool.map(p=>[p.recordId,p.status,p.label]),[['JOB-001','On hold','No opening now, your profile is kept']]);
  const receipt=proposeUpdates([message('10','noreply@examplelabs.test','Thanks','Thank you for your application. We received your application.','2026-09-26T09:00:00Z')],jobs,'sent');assert.deepEqual(receipt.map(p=>[p.recordId,p.status,p.label]),[['JOB-002','','Confirmation that your application arrived']]);
  assert.equal(proposeUpdates([message('11','hr@examplelabs.test','Question','Could you send us your portfolio?','2026-10-01T09:00:00Z')],jobs,'sent')[0].label,'A message from this employer');
  assert.deepEqual(proposeUpdates([message('8','hr@syntheticretail.example','Update','Unfortunately we regret, other candidates','2026-10-05T09:00:00Z'),message('1','hr@syntheticretail.example','Older','We invite you for an interview at Synthetic Retail BV','2026-10-01T09:00:00Z')],jobs,'sent').map(p=>p.status),['Rejected'],'the newest classified message wins');
}
const at='2026-10-02T12:00:00Z',clientId='00000000-0000-4000-8000-000000000001',job={recordId:'JOB-0088',role:'Digital Analyst',employer:'Synthetic Company',status:'Applied',appliedOn:'2026-10-01',postingId:'123456'};
const message={id:'synthetic-message-id',internetMessageId:'<synthetic@example.test>',subject:'Your application for Digital Analyst at Synthetic Company',from:{emailAddress:{address:'hiring@example.test'}},receivedDateTime:at,webLink:'https://outlook.live.com/mail/0/id/synthetic',bodyPreview:'Thank you for your application for Digital Analyst at Synthetic Company.',body:{content:'Thank you for your application for Digital Analyst at Synthetic Company. We have received your application.'}};
assert.equal(emailMatch(message,job).kind,'outlook-receipt');assert.equal(emailMatch({...message,subject:'Hello',bodyPreview:'Nothing about the vacancy',body:{content:'Other company / role'}},job),null);
assert.equal(emailMatch({...message,body:{content:'Updates for Digital Analyst at Synthetic Company'},bodyPreview:'',subject:'Synthetic Company Digital Analyst news'},job).kind,'outlook-message');
assert.equal(emailMatch({...message,webLink:'https://attacker.test/message'},job).url,'');assert(emailMatch({...message,receivedDateTime:'2026-09-25T10:00:00Z'},job).match.includes('Earlier'));
let now=Date.parse(at),pending=true,outage=false,config={},tokenCalls=0,writes=[],graphCalls=[];
const connections={settings:async()=>({SCOUT_CONFIG:config}),updateScout:async fn=>{config=fn(config);}};
const fetcher=async(url,options)=>{
  if(url.startsWith('https://login.microsoftonline.com/')){
    const p=new URLSearchParams(options.body);assert.equal(p.get('client_id'),clientId);
    if(url.endsWith('/devicecode')){assert(p.get('scope').includes('Mail.Read'));assert(!p.get('scope').includes('Mail.Send'));return Response.json({device_code:'synthetic-server-device-code',user_code:'SYNTHETIC',expires_in:900,interval:5});}
    tokenCalls++;if(pending)return Response.json({error:'authorization_pending'},{status:400});return Response.json({access_token:'synthetic-server-access-token',refresh_token:'synthetic-server-refresh-token',scope:'Mail.Read',expires_in:3600});
  }
  if(url==='hq-records:operation'){const body=JSON.parse(options.body);if(body.operation==='read-application-record')return Response.json({ok:true,...job});assert.equal(body.operation,'attach-application-evidence');writes.push(body);return Response.json({ok:true,recordId:body.recordId,eventId:'EVT-0175',status:'Applied',appliedOn:job.appliedOn,at});}
  if(url.includes('/mailFolders/sentitems?'))return Response.json({id:'synthetic-sent-folder'});
  assert(url.startsWith('https://graph.microsoft.com/v1.0/me/messages'));assert.equal(options.headers.Authorization,'Bearer synthetic-server-access-token');assert.equal(options.redirect,'error');assert(!options.method||options.method==='GET');graphCalls.push(url);
  if(outage)return Response.json({error:'synthetic'},{status:503});
  if(url.includes('/synthetic-message-id?'))return Response.json(message);
  if(new URL(url).searchParams.get('$top')==='1')return Response.json({value:[]});
  return Response.json({value:[message,{...message,id:'not-matching',subject:'Other role',bodyPreview:'Other employer'},{...message,id:'sent-message',parentFolderId:'synthetic-sent-folder'},{...message,id:'draft',isDraft:true}]});
};
const api=createMail(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-password'},{fetcher,clock:()=>now});
const req=body=>new Request('https://hq.test/api/mail',{method:'POST',headers:{host:'hq.test',origin:'https://hq.test','content-type':'application/json'},body:JSON.stringify(body)});
const call=async body=>{const r=await api.handle(req(body));return {status:r.status,...await r.json()};};
assert.equal((await call({action:'connect'})).status,400);
assert.equal((await call({action:'save',clientId})).saved,true);assert.equal((await call({action:'connect'})).userCode,'SYNTHETIC');
assert.equal((await call({action:'poll'})).status,'pending');assert.equal(tokenCalls,0);
now+=5000;assert.equal((await call({action:'poll'})).status,'pending');pending=false;now+=5000;assert.equal((await call({action:'poll'})).status,'connected');
const visible=await(await api.handle(new Request('https://hq.test/api/mail'))).json();assert(visible.connected);assert(!JSON.stringify(visible).includes('synthetic-server'));assert(!JSON.stringify(visible).includes('device_code'));
const checked=await call({action:'check',recordId:job.recordId});assert(checked.checked,checked.error);assert.equal(checked.result.candidates.length,1);assert.equal(checked.result.scanned,4);assert.equal(writes.length,0);
const candidate=checked.result.candidates[0];assert.equal((await call({action:'attach',recordId:job.recordId,key:candidate.key,confirmEvidence:false})).status,400);assert.equal(writes.length,0);
const attach=await call({action:'attach',recordId:job.recordId,key:candidate.key,confirmEvidence:true,kind:'Hired',reference:'forged browser evidence'});assert(attach.saved,attach.error);assert.equal(writes.length,1);assert.equal(writes[0].kind,'outlook-receipt');assert(writes[0].reference.includes(message.subject));assert(!writes[0].reference.includes('forged'));
const repeat=await call({action:'attach',recordId:job.recordId,key:candidate.key,confirmEvidence:true});assert(repeat.saved);assert.equal(writes.length,1);
assert.equal(writes[0].receivedAt,message.receivedDateTime);
assert.equal((await call({action:'check',recordId:job.recordId})).status,400);now+=61000;outage=true;assert.equal((await call({action:'check',recordId:job.recordId})).status,400);assert(config.outlook.checks[0].candidates[0].attached);
const crossOrigin=new Request('https://hq.test/api/mail',{method:'POST',headers:{host:'hq.test',origin:'https://evil.test','content-type':'application/json'},body:'{}'});assert.equal((await api.handle(crossOrigin)).status,403);
assert.equal((await createMail(connections,{}).handle(req({action:'check'}))).status,403);
assert((await call({action:'disconnect'})).saved);assert.equal(config.outlook.tokens,null);assert(config.outlook.checks.length);assert.equal((await call({action:'send'})).status,400);
console.log('Outlook tests passed: read-only OAuth, protected tokens, bounded matching, owner-reviewed native evidence, idempotent attaches, rate limits and outage retention.');
