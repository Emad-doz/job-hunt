import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {sendRecord} from './workflow.mjs';
import {applicationBridge} from './applications.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const scopes='https://graph.microsoft.com/Mail.Read offline_access';
const authRoot='https://login.microsoftonline.com/common/oauth2/v2.0/';
// The second mailbox the Tracker can read. Like Outlook it is asked for reading only.
const GMAIL={scopes:'https://www.googleapis.com/auth/gmail.readonly',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',api:'https://gmail.googleapis.com/gmail/v1/users/me/'};
export const MAIL_PROVIDERS={outlook:'Outlook / Hotmail',gmail:'Gmail'};
const providerOf=c=>c?.provider==='gmail'?'gmail':'outlook';
// Messages written for Outlook, said for Gmail.
const gmailWords=value=>String(value).replace(/Outlook or Hotmail|Outlook/g,'Gmail').replace(/Microsoft/g,'Google').replace(/Mail\.Read/g,'gmail.readonly');
const callbackPath='/api/mail/callback';
const loginCookie='__Host-hq-outlook-login';
const digest=value=>createHash('sha256').update(value).digest();
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(digest(a),digest(b));
function cookieValue(request){return (request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(loginCookie+'='))?.slice(loginCookie.length+1)||'';}
function publicOrigin(request,environment,stored){
  const u=new URL(environment.HQ_PUBLIC_ORIGIN||stored||request.url);
  // On your own machine the address is http://localhost; anywhere else it has to be HTTPS.
  const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.protocol!=='https:'&&!local||u.username||u.password)throw new Error('The mailbox sign-in needs the app to be opened at http://localhost or at an HTTPS address.');
  return u.origin;
}
function loginFailure(value){
  if(value.error==='invalid_client')return 'Microsoft rejected the app credential. Check the client secret value and its expiry in Connections.';
  if(value.error==='invalid_grant')return 'Microsoft sign-in expired or could not be verified. Start a fresh sign-in from HQ.';
  if(value.error==='invalid_request')return 'Microsoft rejected the sign-in settings. Check the exact Web return address registered for HQ.';
  return 'Microsoft could not complete this sign-in. Start again from HQ or check the app registration.';
}
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const norm=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function secureMessageLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['outlook.live.com','outlook.office.com','outlook.office365.com','mail.google.com'].includes(u.hostname)?u.href:'';}catch{return '';}}
export function emailMatch(message,job){
  const subject=clean(message.subject),text=norm(subject+' '+message.bodyPreview+' '+(message.body?.content||'')),role=norm(job.role),employer=norm(job.employer);
  const employerMatch=employer.length>=3&&(' '+text+' ').includes(' '+employer+' '),roleMatch=role.length>=6&&(' '+text+' ').includes(' '+role+' ');
  const posting=String(job.postingId||'');const idMatch=posting.length>=5&&clean(subject+' '+(message.body?.content||'')).includes(posting);
  if(!employerMatch||!roleMatch&&!idMatch)return null;
  const receipt=/\b(?:thank you for (?:your )?applying|thank you for your application|we (?:have )?received your application|application (?:has been )?received|je sollicitatie .*binnen|sollicitatie (?:is )?ontvangen|bedankt voor (?:je|uw) sollicitatie)\b/i.test(clean(subject+' '+(message.body?.content||message.bodyPreview||'')))||receiptMore.test(clean(subject+' '+(message.body?.content||message.bodyPreview||'')));
  const applied=/^\d{4}-\d{2}-\d{2}$/.test(job.appliedOn||'')?job.appliedOn:null,received=String(message.receivedDateTime||'');
  if(!message.id||!received||Number.isNaN(Date.parse(received)))return null;
  // An exact employer / role mention is evidence of a possible association,
  // not proof of sender authenticity or an application outcome.
  return {subject:subject.slice(0,300),sender:clean(message.from?.emailAddress?.address).slice(0,254),receivedAt:received,url:secureMessageLink(message.webLink),excerpt:clean(message.body?.content||message.bodyPreview).slice(0,500),kind:(message.mailbox==='gmail'?'gmail':'outlook')+(receipt?'-receipt':'-message'),match:applied&&received.slice(0,10)<applied?'Earlier than the reported application; verify the association.':'Employer and role / posting ID match; verify sender and vacancy.',reference:((message.mailbox==='gmail'?'Gmail':'Outlook')+' · '+subject+' · from '+clean(message.from?.emailAddress?.address)+' · received '+received+' · message '+clean(message.internetMessageId||message.id)+' · '+secureMessageLink(message.webLink)).slice(0,1500)};
}
// A Gmail message in the shape the matching code reads from Outlook: headers, the received time, the text and whether it was sent by the owner.
const decoded=data=>{try{return Buffer.from(String(data||''),'base64url').toString('utf8');}catch{return '';}};
function gmailBody(part,depth=0){
  if(!part||depth>8)return {plain:'',html:''};let plain='',html='';
  if(!part.filename&&part.body?.data){if(part.mimeType==='text/plain')plain=decoded(part.body.data);else if(part.mimeType==='text/html')html=decoded(part.body.data).replace(/<(style|script)[\s\S]*?<\/\1>/gi,' ');}
  for(const child of Array.isArray(part.parts)?part.parts.slice(0,30):[]){const inner=gmailBody(child,depth+1);plain+=(plain&&inner.plain?'\n':'')+inner.plain;html+=inner.html;}
  return {plain,html};
}
export function gmailShape(raw){
  if(!raw||typeof raw.id!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(raw.id))return null;
  const header=name=>String((Array.isArray(raw.payload?.headers)?raw.payload.headers:[]).find(h=>String(h?.name).toLowerCase()===name)?.value||''),from=header('from'),address=(from.match(/<([^<>\s]+@[^<>\s]+)>/)||from.match(/([^\s<>"]+@[^\s<>"]+)/)||[])[1]||'',labels=Array.isArray(raw.labelIds)?raw.labelIds:[],received=Number(raw.internalDate),body=gmailBody(raw.payload);
  return {mailbox:'gmail',id:raw.id,internetMessageId:header('message-id'),subject:header('subject'),from:{emailAddress:{name:from.replace(/<[^>]*>/,'').replace(/"/g,'').trim(),address}},receivedDateTime:Number.isFinite(received)&&received>0?new Date(received).toISOString():'',webLink:'https://mail.google.com/mail/u/0/#all/'+raw.id,bodyPreview:String(raw.snippet||''),body:{content:(body.plain||body.html).slice(0,200000)},parentFolderId:labels.includes('SENT')?'SENT':'INBOX',isDraft:labels.includes('DRAFT')};
}
// The Tracker reads replies and proposes a status; it never changes one. A proposal is a guess from the words in a message, for the owner to read and confirm.
// The same kinds of wording in German, French, Spanish, Italian and Portuguese. Letters with accents need their own word boundaries.
const wide=source=>new RegExp('(?<![\\p{L}\\p{N}])(?:'+source+')(?![\\p{L}\\p{N}])','iu');
const sorry='leider|malheureusement|lamentablemente|desafortunadamente|purtroppo|infelizmente';
const replyKinds=[
  {status:'Rejected',label:'Looks like a rejection',words:/\b(?:unfortunately[^.!?]{0,160}\b(?:not|other|another|unable|decided|will not)|helaas[^.!?]{0,160}\b(?:niet|geen|andere|afgewezen)|we regret|regret to inform|not (?:be )?(?:moving|proceeding|going) forward|will not be (?:moving|proceeding)|decided not to (?:proceed|continue)|(?:other|another) candidates?|not (?:been )?selected|not a match|position has been filled|niet verder (?:gaan|te gaan)|niet door(?:gaan)?|andere kandida|afgewezen|afwijzing|geen vervolg|niet geselecteerd)\b/i,
    more:wide('(?:'+sorry+')[^.!?]{0,160}(?:nicht|kein\\p{L}*|absage|ander\\p{L}*|pas|autres?|no|otr[oa]s?|non|altr[oi]|não|outr[oa]s?)|absage|nicht berücksichtigen|anderweitig besetzt|nicht in die engere (?:aus)?wahl|nous regrettons|au regret de|pas (?:été )?retenue?|ne pas donner suite|d.autres candidat\\p{L}*|lamentamos (?:informar|comunicar)\\p{L}*|no ha sido seleccionad[oa]|hemos decidido no|otros candidatos|siamo spiacenti|non è stat[oa] selezionat[oa]|altri candidati|não foi selecionad[oa]|outros candidatos')},
  {status:'Offer',label:'Looks like an offer',words:/\b(?:pleased to offer|job offer|offer letter|contract (?:proposal|voorstel)|arbeidsvoorwaardenvoorstel|aanbod doen|aanbieding)\b/i,
    more:wide('vertragsangebot|angebot unterbreiten|proposition d.embauche|promesse d.embauche|proposition de contrat|plaisir de vous proposer le poste|carta de oferta|oferta formal|nos complace ofrecer\\p{L}*|propuesta de contrato|proposta di assunzione|lettera di assunzione|lieti di offrir\\p{L}*|proposta de contrato|prazer de lhe oferecer')},
  {status:'Interview',label:'Looks like an interview invitation',words:/\b(?:interview|schedule a (?:call|meeting)|your availability|invite you|would like to (?:meet|speak)|calendly|kennismakingsgesprek|kennismaking|sollicitatiegesprek|gesprek (?:in te plannen|plannen)|uitnodig\w*|beschikbaarheid)\b/i,
    more:wide('vorstellungsgespräch\\p{L}*|kennenlerngespräch\\p{L}*|bewerbungsgespräch\\p{L}*|zu einem gespräch einladen|terminvorschl\\p{L}*|ihre verfügbarkeit|entretien|vos disponibilités|vous rencontrer|entrevista|(?:su|tu) disponibilidad|colloquio|(?:sua|tua) disponibilità|sua disponibilidade')},
];
const receiptMore=wide('vielen dank für (?:ihre|deine) bewerbung|bewerbung (?:ist )?(?:bei uns )?eingegangen|eingang (?:ihrer|deiner) bewerbung|bewerbung erhalten|merci (?:pour|de) votre candidature|bien reçu votre candidature|accusons réception|gracias por (?:tu|su) (?:candidatura|solicitud|postulación)|hemos recibido (?:tu|su) (?:candidatura|solicitud|postulación)|grazie per la (?:tua|sua) candidatura|abbiamo ricevuto la (?:tua|sua) candidatura|obrigad[oa] pela (?:sua )?candidatura|recebemos a sua candidatura');
const receiptBase=/\b(?:thank you for (?:your )?applying|thank you for your application|we (?:have )?received your application|application (?:has been )?received|sollicitatie (?:is )?ontvangen|bedankt voor (?:je|uw) sollicitatie)\b/i,receiptWords={test:value=>receiptBase.test(value)||receiptMore.test(value)};
export function classifyReply(text){const value=clean(text);for(const kind of replyKinds)if(kind.words.test(value)||kind.more.test(value))return kind;return null;}
// "No opening for you now, we keep your profile" is an answer too, though not a rejection of a person or an invitation.
const poolMore=wide('(?:bewerber|talent)pool|für zukünftige (?:stellen|vakanzen|positionen)|vivier|conservons votre (?:candidature|cv|profil)|futures opportunités|futuras (?:vacantes|oportunidades|vagas)|conservaremos (?:tu|su)|future (?:opportunità|posizioni)|banco de talentos');
const poolBase=/\b(?:keep (?:it|you|your (?:profile|details|cv|resume))(?: on file)? in mind|keep your (?:profile|details|cv|resume) on file|future (?:opportunities|openings|roles|vacancies)|talent (?:pool|community)|doesn.t always fit|no (?:suitable|matching) (?:role|position|vacancy)|in portefeuille|toekomstige (?:vacatures|mogelijkheden)|in ons bestand)\b/i,poolWords={test:value=>poolBase.test(value)||poolMore.test(value)};
// The same reading for one piece of text, such as an email the owner pasted because the mailbox check did not find it.
export function describeReply(text){
  const body=clean(text).slice(0,6000);let kind=classifyReply(body);
  if(kind?.status==='Rejected'&&receiptWords.test(body)&&!/\b(?:helaas|unfortunately|regret|leider|malheureusement|lamentablemente|desafortunadamente|purtroppo|infelizmente)\b[^.]{0,120}\b(?:not|niet|other|andere|nicht|kein\w*|pas|autres?|no|otr\w+|non|altr\w+|outr\w+)\b/i.test(body))kind=null;
  return kind?{status:kind.status,label:kind.label}:poolWords.test(body)?{status:'On hold',label:'No opening now, your profile is kept'}:receiptWords.test(body)?{status:'',label:'Confirmation that your application arrived'}:{status:'',label:'No clear outcome in this text'};
}
// Which recorded jobs do recent messages seem to answer? A message is tied to a job by the employer's name in its subject, preview or sender. Per job the newest message with a clear outcome wins; without one, the newest other message from that employer is still shown, with no status proposed.
// A reply the owner removed from the list is remembered by a hash of the job, the time it arrived and its subject, so a later check does not show it again. Those three are kept with every listed reply, so replies listed by an earlier check can be removed too.
export const replyKey=(recordId,receivedAt,subject)=>createHash('sha256').update(recordId+'|'+receivedAt+'|'+String(subject).slice(0,300)).digest('hex').slice(0,24);
const keyed=scan=>scan?{...scan,proposals:(scan.proposals||[]).map(p=>({...p,key:replyKey(p.recordId,p.receivedAt,p.subject)}))}:null;
// seen holds, per job, the time of the newest message the owner has already dealt with (removed from the list, or acted on). Nothing at or before it is shown for that job again, so an older message never takes a removed one's place.
export function proposeUpdates(messages,jobs,sentFolder='',seen={}){
  const outcomes=new Map(),notes=new Map(),settled=new Set();
  for(const message of [...messages].sort((a,b)=>String(b.receivedDateTime).localeCompare(String(a.receivedDateTime)))){
    const received=String(message.receivedDateTime||'');if(!message.id||message.isDraft||message.parentFolderId===sentFolder||Number.isNaN(Date.parse(received)))continue;
    // The whole message is read when Outlook supplies it; the short preview is the fallback.
    const sender=clean(message.from?.emailAddress?.address).toLowerCase(),subject=clean(message.subject),whole=clean(message.body?.content).slice(0,6000),body=subject+' '+(whole||clean(message.bodyPreview)),text=' '+norm(body+' '+clean(message.from?.emailAddress?.name))+' ';
    let kind=classifyReply(body);
    // A receipt that only thanks for applying is not an outcome, even if it also says "unfortunately we cannot reply to everyone".
    if(kind?.status==='Rejected'&&receiptWords.test(body)&&!/\b(?:helaas|unfortunately|regret|leider|malheureusement|lamentablemente|desafortunadamente|purtroppo|infelizmente)\b[^.]{0,120}\b(?:not|niet|other|andere|nicht|kein\w*|pas|autres?|no|otr\w+|non|altr\w+|outr\w+)\b/i.test(body))kind=null;
    const note=kind?null:poolWords.test(body)?{status:'On hold',label:'No opening now, your profile is kept'}:receiptWords.test(body)?{status:'',label:'Confirmation that your application arrived'}:{status:'',label:'A message from this employer'};
    const matched=[];
    for(const job of jobs){
      const employer=norm(job.employer),token=employer.split(' ').find(part=>part.length>=4)||'';
      const named=employer.length>=3&&text.includes(' '+employer+' '),domain=token.length>=4&&(sender.split('@')[1]||'').split('.').slice(0,-1).join('').replace(/[^a-z0-9]/g,'').includes(token.replace(/[^a-z0-9]/g,''));
      if(!named&&!domain)continue;
      if(/^\d{4}-\d{2}-\d{2}$/.test(job.appliedOn||'')&&received.slice(0,10)<job.appliedOn)continue;
      matched.push({job,named});
    }
    // Several open applications at one employer: a message that names a role belongs to that role only.
    const byRole=matched.filter(m=>{const role=norm(m.job.role);return role.length>=6&&text.includes(' '+role+' ');}),chosen=byRole.length?byRole:matched;
    for(const {job,named} of chosen){
      if(settled.has(job.recordId)||seen[job.recordId]&&received<=seen[job.recordId])continue;
      const found=kind||note,target=kind?outcomes:notes;
      // The newest outcome already matches the tracker: older mail about this job is history, not news.
      if(found.status&&found.status===job.status){settled.add(job.recordId);continue;}
      if(target.has(job.recordId))continue;
      target.set(job.recordId,{key:replyKey(job.recordId,received,subject),recordId:job.recordId,employer:job.employer.slice(0,160),role:job.role.slice(0,200),current:job.status,status:found.status,label:found.label,subject:subject.slice(0,300),sender:sender.slice(0,254),receivedAt:received,excerpt:clean(message.bodyPreview).slice(0,320),url:secureMessageLink(message.webLink),basis:(named?'The employer is named in the message.':'The sender address matches the employer name.')+(byRole.length?' It names this role.':matched.length>1?' You have '+matched.length+' open applications there and the message names none of the roles, so it is listed for each.':'')});
    }
  }
  return jobs.map(job=>settled.has(job.recordId)?null:outcomes.get(job.recordId)||notes.get(job.recordId)).filter(Boolean);
}
export function createMail(connections,environment,{fetcher=fetch,clock=Date.now}={}){
  let device=null,webLogin=null,busy=false;
  const config=async()=>((await connections.settings()).SCOUT_CONFIG||{}).outlook||{};
  const save=update=>connections.updateScout(c=>({...c,outlook:update(c.outlook||{})}));
  async function oauth(endpoint,params){const response=await fetcher(endpoint.startsWith('https://')?endpoint:authRoot+endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),redirect:'error',signal:AbortSignal.timeout(20000)});let value;try{value=await response.json();}catch{throw new Error('Microsoft sign-in response unavailable.');}return {response,value};}
  function checkedToken(value,provider='outlook'){
    if(provider==='gmail'){
      const scopesGranted=String(value.scope||'').split(' ').filter(Boolean);
      // Reading only: any Gmail permission beyond gmail.readonly is refused, so the app can never hold a right to send or change mail.
      if(!value.access_token||!scopesGranted.includes(GMAIL.scopes)||scopesGranted.some(s=>s!==GMAIL.scopes&&/mail\.google\.com|\/auth\/gmail\./.test(s)))throw new Error('Read-only Gmail permission was not confirmed. Reconnect and allow reading only.');
      return {access:value.access_token,refresh:value.refresh_token||'',expiresAt:clock()+Math.max(60,Math.min(86400,Number(value.expires_in)||3600))*1000};
    }
    const granted=String(value.scope||'').toLowerCase().split(' ').map(s=>s.replace('https://graph.microsoft.com/',''));
    if(!value.access_token||!granted.includes('mail.read')||granted.some(s=>/mail\.(send|readwrite)/.test(s)))throw new Error('Read-only Microsoft mail permission was not confirmed. Reconnect with Mail.Read only.');
    return {access:value.access_token,refresh:value.refresh_token||'',expiresAt:clock()+Math.max(60,Math.min(86400,Number(value.expires_in)||3600))*1000};
  }
  async function token(){const c=await config();if(c.tokens?.access&&c.tokens.expiresAt>clock()+60000)return c.tokens.access;if(!c.clientId||!c.tokens?.refresh)throw new Error('Connect Outlook in Connections before checking email.');if(c.tokens.flow==='web'&&!c.clientSecret)throw new Error('Save the Microsoft app credential in Connections before refreshing Outlook.');const google=providerOf(c)==='gmail',{response,value}=google?await oauth(GMAIL.token,{client_id:c.clientId,client_secret:c.clientSecret,grant_type:'refresh_token',refresh_token:c.tokens.refresh}):await oauth('token',{client_id:c.clientId,grant_type:'refresh_token',refresh_token:c.tokens.refresh,scope:scopes,...(c.tokens.flow==='web'?{client_secret:c.clientSecret}:{})});if(!response.ok){await save(x=>({...x,error:'Outlook sign-in expired. Reconnect to check email.'}));throw new Error('Outlook sign-in expired. Reconnect in Connections.');}const next=checkedToken(value,providerOf(c));next.refresh=next.refresh||c.tokens.refresh;if(c.tokens.flow)next.flow=c.tokens.flow;await save(x=>({...x,tokens:next,error:null}));return next.access;}
  async function graph(path,access){
    const response=await fetcher('https://graph.microsoft.com/v1.0/me/messages'+path,{headers:{Authorization:'Bearer '+access,Accept:'application/json',Prefer:'IdType="ImmutableId", outlook.body-content-type="text"'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(response.status===429?'Outlook throttled this check. Saved email evidence is retained.':response.status===401||response.status===403?'Outlook access unavailable. Reconnect with read-only Mail.Read permission.':'Outlook check unavailable. Saved email evidence is retained.');return response.json();
  }
  async function gmail(path,access){
    const response=await fetcher(GMAIL.api+path,{headers:{Authorization:'Bearer '+access,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(response.status===429?'Gmail throttled this check. Saved email evidence is retained.':response.status===401||response.status===403?'Gmail access unavailable. Reconnect with the read-only permission.':'Gmail check unavailable. Saved email evidence is retained.');return response.json();
  }
  // Recent received mail, newest first. Gmail lists only IDs, so each message is one more request, eight at a time and never more than the limit.
  async function gmailMessages(access,startMs,limit){
    const ids=[];let pageToken='',capped=false;
    for(let page=0;page<4&&ids.length<limit;page++){
      const list=await gmail('messages?'+new URLSearchParams({q:'after:'+Math.floor(startMs/1000)+' -in:sent -in:drafts -in:chats',maxResults:'100',...(pageToken?{pageToken}:{})}),access);
      if(list.messages!==undefined&&!Array.isArray(list.messages))throw new Error('Gmail returned an unexpected message list.');
      ids.push(...(list.messages||[]).map(m=>String(m?.id||'')).filter(id=>/^[A-Za-z0-9_-]{6,64}$/.test(id)));pageToken=typeof list.nextPageToken==='string'?list.nextPageToken:'';if(!pageToken)break;
    }
    if(pageToken||ids.length>limit){capped=true;ids.length=Math.min(ids.length,limit);}
    const messages=[];for(let i=0;i<ids.length;i+=8)messages.push(...await Promise.all(ids.slice(i,i+8).map(async id=>gmailShape(await gmail('messages/'+id+'?format=full',access)))));
    return {messages:messages.filter(m=>m&&!m.isDraft&&m.parentFolderId!=='SENT'),capped};
  }
  async function tracked(recordId){
    if(!/^JOB-\d{3,8}$/.test(recordId||''))throw new Error('Select a real tracked vacancy.');const c=(await connections.settings()).SCOUT_CONFIG||{};
    
    const response=await sendRecord(fetcher,{operation:'read-application-record',recordId});
    const value=await response.json();if(!response.ok||!value.ok||value.recordId!==recordId)throw new Error(/Unsupported append request/.test(value.error||'')?'Update the deployed Database before checking tracked applications.':value.error||'Tracked vacancy could not be read from the database.');return value;
  }
  async function check(recordId){
    const job=await tracked(recordId);if(!job.appliedOn&&!['Applied','Submitted','Interview','Offer','Hired','Rejected','Withdrawn','Closed'].includes(job.status))throw new Error('Record your application before checking its email evidence.');
    const access=await token(),c=await config();if(c.lastCheck&&clock()-Date.parse(c.lastCheck)<60000)throw new Error('Wait one minute between email checks.');
    if(providerOf(c)==='gmail'){
      const now=new Date(clock()),start=new Date(Math.max(clock()-90*86400000,/^\d{4}-\d{2}-\d{2}$/.test(job.appliedOn||'')?Date.parse(job.appliedOn)-86400000:clock()-30*86400000)).toISOString(),{messages,capped}=await gmailMessages(access,Date.parse(start),150),candidates=[];
      for(const message of messages){if(candidates.length>=10)break;const matched=emailMatch(message,job);if(!matched)continue;const key=createHash('sha256').update(recordId+'|'+message.id).digest('hex'),previous=c.checks?.find(r=>r.recordId===recordId)?.candidates.find(v=>v.key===key);candidates.push({...matched,key,attached:previous?.attached||null});}
      const result={recordId,checkedAt:now.toISOString(),from:start,to:now.toISOString(),scanned:messages.length,capped,candidates};
      await save(x=>({...x,lastCheck:result.checkedAt,error:null,checks:[...(x.checks||[]).filter(v=>v.recordId!==recordId).slice(-19),result]}));return result;
    }
    const sentResponse=await fetcher('https://graph.microsoft.com/v1.0/me/mailFolders/sentitems?$select=id',{headers:{Authorization:'Bearer '+access,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!sentResponse.ok)throw new Error('Outlook sent-folder identity unavailable. No incoming-message check completed.');const sent=await sentResponse.json();if(!sent.id)throw new Error('Outlook did not identify Sent Items. No check completed.');
    const now=new Date(clock()),start=new Date(Math.max(clock()-90*86400000,/^\d{4}-\d{2}-\d{2}$/.test(job.appliedOn||'')?Date.parse(job.appliedOn)-86400000:clock()-30*86400000)).toISOString();
    const parameters=new URLSearchParams({'$filter':'receivedDateTime ge '+start+' and receivedDateTime le '+now.toISOString()+' and isDraft eq false','$orderby':'receivedDateTime desc','$top':'50','$select':'id,internetMessageId,subject,from,receivedDateTime,webLink,bodyPreview,parentFolderId,isDraft'});
    let path='?'+parameters,scanned=0,capped=false,candidates=[];
    for(let page=0;page<3;page++){
      const payload=await graph(path,access);if(!Array.isArray(payload.value))throw new Error('Outlook returned an unexpected message list.');
      for(const message of payload.value.slice(0,50)){scanned++;if(message.isDraft||message.parentFolderId===sent.id||candidates.length>=10)continue;if(!emailMatch(message,job))continue;
        const full=await graph('/'+encodeURIComponent(message.id)+'?'+new URLSearchParams({'$select':'id,internetMessageId,subject,from,receivedDateTime,webLink,body,parentFolderId,isDraft'}),access);if(full.isDraft||full.parentFolderId===sent.id)continue;const matched=emailMatch(full,job);if(matched){const key=createHash('sha256').update(recordId+'|'+message.id).digest('hex'),previous=c.checks?.find(r=>r.recordId===recordId)?.candidates.find(v=>v.key===key);candidates.push({...matched,key,attached:previous?.attached||null});}
      }
      if(!payload['@odata.nextLink'])break;
      const next=new URL(payload['@odata.nextLink']);if(next.origin!=='https://graph.microsoft.com'||next.pathname!=='/v1.0/me/messages')throw new Error('Unexpected Outlook pagination link.');path=next.search;capped=page===2;
    }
    const result={recordId,checkedAt:now.toISOString(),from:start,to:now.toISOString(),scanned,capped,candidates};
    await save(x=>({...x,lastCheck:result.checkedAt,error:null,checks:[...(x.checks||[]).filter(v=>v.recordId!==recordId).slice(-19),result]}));return result;
  }
  // One pass over recent mail for all applications still open. Only message previews are read; nothing is changed in the database or Outlook.
  async function scan(input){
    const jobs=(Array.isArray(input)?input:[]).slice(0,80).filter(j=>j&&/^JOB-\d{3,8}$/.test(j.recordId||'')&&typeof j.employer==='string'&&j.employer.trim()).map(j=>({recordId:j.recordId,employer:clean(j.employer).slice(0,160),role:clean(j.role).slice(0,200),status:clean(j.status).slice(0,40),appliedOn:/^\d{4}-\d{2}-\d{2}$/.test(j.appliedOn||'')?j.appliedOn:''}));
    if(!jobs.length)throw new Error('No recorded applications are waiting for a reply.');
    const access=await token(),c=await config();if(c.lastCheck&&clock()-Date.parse(c.lastCheck)<60000)throw new Error('Wait one minute between email checks.');
    if(providerOf(c)==='gmail'){
      const now=new Date(clock()),start=new Date(clock()-45*86400000).toISOString(),{messages,capped}=await gmailMessages(access,Date.parse(start),300);
      const result={checkedAt:now.toISOString(),from:start,scanned:messages.length,capped,jobs:jobs.length,proposals:proposeUpdates(messages,jobs,'SENT',c.repliesSeen||{})};
      await save(x=>({...x,lastCheck:result.checkedAt,error:null,scan:result}));return result;
    }
    const sentResponse=await fetcher('https://graph.microsoft.com/v1.0/me/mailFolders/sentitems?$select=id',{headers:{Authorization:'Bearer '+access,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!sentResponse.ok)throw new Error('Outlook sent-folder identity unavailable. No incoming-message check completed.');const sent=await sentResponse.json();if(!sent.id)throw new Error('Outlook did not identify Sent Items. No check completed.');
    const now=new Date(clock()),start=new Date(clock()-45*86400000).toISOString();
    const parameters=new URLSearchParams({'$filter':'receivedDateTime ge '+start+' and receivedDateTime le '+now.toISOString()+' and isDraft eq false','$orderby':'receivedDateTime desc','$top':'50','$select':'id,subject,from,receivedDateTime,webLink,bodyPreview,body,parentFolderId,isDraft'});
    let path='?'+parameters,capped=false;const messages=[];
    for(let page=0;page<6;page++){
      const payload=await graph(path,access);if(!Array.isArray(payload.value))throw new Error('Outlook returned an unexpected message list.');messages.push(...payload.value.slice(0,50));
      if(!payload['@odata.nextLink'])break;
      const next=new URL(payload['@odata.nextLink']);if(next.origin!=='https://graph.microsoft.com'||next.pathname!=='/v1.0/me/messages')throw new Error('Unexpected Outlook pagination link.');path=next.search;capped=page===5;
    }
    const result={checkedAt:now.toISOString(),from:start,scanned:messages.length,capped,jobs:jobs.length,proposals:proposeUpdates(messages,jobs,sent.id,c.repliesSeen||{})};
    await save(x=>({...x,lastCheck:result.checkedAt,error:null,scan:result}));return result;
  }
  const browserCookie=(value,maxAge)=>loginCookie+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
  async function callback(request){
    const u=new URL(request.url),flow=webLogin;
    const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Content-Type':'text/plain; charset=utf-8'};
    if(request.method!=='GET')return new Response('Use the sign-in started from HQ.',{status:405,headers});
    if(!flow||flow.expiresAt<=clock()||u.origin!==new URL(flow.redirectUri).origin||u.searchParams.getAll('state').length!==1||!same(u.searchParams.get('state'),flow.state)||!same(cookieValue(request),flow.cookie))return new Response('Sign-in could not be verified. Return to HQ and start a fresh mailbox sign-in. Keep this URL private.',{status:400,headers});
    if(busy)return new Response('Another HQ mail action is finishing. Return to HQ to check the connection.',{status:409,headers});
    busy=true;webLogin=null;
    let outcome='failed';
    try{
      if(u.searchParams.has('error')){await save(x=>({...x,signInError:u.searchParams.get('error')==='access_denied'?'Microsoft consent was cancelled. You can start sign-in again from HQ.':'Microsoft sign-in was not completed. Start again from HQ.'}));}
      else{
        const code=u.searchParams.get('code');if(u.searchParams.getAll('code').length!==1||!code||code.length>16000)throw new Error('Microsoft did not return a usable authorization. Start sign-in again from HQ.');
        const c=await config();if(c.clientId!==flow.clientId||!c.clientSecret)throw new Error('The Microsoft app settings changed during sign-in. Start again from HQ.');
        const google=flow.provider==='gmail';if(providerOf(c)!==(flow.provider||'outlook'))throw new Error('The mailbox settings changed during sign-in. Start again from HQ.');
        const {response,value}=google?await oauth(GMAIL.token,{client_id:flow.clientId,client_secret:c.clientSecret,grant_type:'authorization_code',code,redirect_uri:flow.redirectUri,code_verifier:flow.verifier}):await oauth('token',{client_id:flow.clientId,client_secret:c.clientSecret,grant_type:'authorization_code',code,redirect_uri:flow.redirectUri,code_verifier:flow.verifier,scope:scopes});
        if(!response.ok)throw new Error(loginFailure(value));
        const tokens=checkedToken(value,flow.provider);if(!tokens.refresh)throw new Error('Microsoft offline access was not granted. Start sign-in again from HQ.');tokens.flow='web';
        if(google)await gmail('profile',tokens.access);else await graph('?'+new URLSearchParams({'$top':'1','$select':'id'}),tokens.access);
        await save(x=>({...x,tokens,verifiedAt:new Date(clock()).toISOString(),error:null,signInError:null}));device=null;outcome='connected';
      }
    }catch(error){await save(x=>({...x,signInError:error.message||'Microsoft sign-in could not be verified. Start again from HQ.'}));}
    finally{busy=false;}
    return new Response(null,{status:303,headers:{...headers,'Set-Cookie':browserCookie('',0),Location:new URL('/?outlook='+outcome+'#connections',flow.redirectUri).href}});
  }
  return {async handle(request){
    const response=await this.answer(request);if(response.status===303||!(response.headers.get('content-type')||'').includes('json'))return response;
    let current={};try{current=await config();}catch{}if(providerOf(current)!=='gmail')return response;
    const value=await response.json();for(const key of ['message','error','signInError'])if(typeof value[key]==='string')value[key]=gmailWords(value[key]);
    const worded=json(value,response.status),cookie=response.headers.get('set-cookie');if(cookie)worded.headers.set('Set-Cookie',cookie);return worded;
  },async answer(request){
    if(!environment.HQ_ACCESS_PASSWORD)return json({error:'Owner sign-in required for private email evidence.'},403);
    if(new URL(request.url).pathname===callbackPath)return callback(request);
    if(request.method==='GET'){try{const c=await config();let redirectUri='';try{redirectUri=publicOrigin(request,environment,c.webOrigin)+callbackPath;}catch{}return json({protected:true,provider:providerOf(c),providers:MAIL_PROVIDERS,configured:!!c.clientId,browserReady:!!(c.clientId&&c.clientSecret&&redirectUri),redirectUri,clientSecretConfigured:!!c.clientSecret,clientId:c.clientId||'',connected:!!c.tokens?.refresh&&!c.error,verifiedAt:c.verifiedAt||null,lastCheck:c.lastCheck||null,error:c.error||null,signInError:c.signInError||null,checks:c.checks||[],scan:keyed(c.scan)});}catch{return json({error:'Private mail settings unavailable.'},503);}}
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    try{const origin=new URL(request.headers.get('origin'));if(origin.origin!==new URL(environment.HQ_PUBLIC_ORIGIN||request.url).origin||origin.host!==request.headers.get('host'))throw new Error();}catch{return json({error:'Email actions require a same-origin request.'},403);}
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    if(busy)return json({error:'Wait for the current email action.'},409);busy=true;
    try{
      const body=await request.json();
      if(body.action==='save'){
        const previous=await config(),secret=body.clientSecret,provider=body.provider===undefined?providerOf(previous):String(body.provider);
        if(!MAIL_PROVIDERS[provider])throw new Error('Choose Outlook or Gmail.');
        if(provider==='gmail'){if(!/^[0-9]{6,20}-[a-z0-9]{8,60}\.apps\.googleusercontent\.com$/.test(body.clientId||''))throw new Error('Enter the Client ID of your Google OAuth client. It ends with .apps.googleusercontent.com.');}
        else if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.clientId||''))throw new Error('Enter the Application (client) ID from your Microsoft app registration.');
        // Another mailbox or another app starts clean: the saved secret and sign-in belong to the old one.
        const same=body.clientId===previous.clientId&&provider===providerOf(previous);if(!same&&secret===undefined&&provider==='gmail')throw new Error('Enter the Client secret of your Google OAuth client as well.');
        if(secret!==undefined&&(typeof secret!=='string'||secret.length<12||secret.length>1024||/[\r\n]/.test(secret)))throw new Error('Enter the Microsoft client secret Value. Keep it out of chat and GitHub.');
        const webOrigin=secret!==undefined?publicOrigin(request,environment):previous.webOrigin;
        await save(x=>({...(same?x:{clientId:body.clientId,checks:x.checks||[],repliesSeen:x.repliesSeen}),provider,...(secret!==undefined?{clientSecret:secret,webOrigin}:{}),signInError:null}));device=null;webLogin=null;return json({saved:true,message:secret!==undefined?'Microsoft app credential saved privately. Register the shown Web return address, then connect Outlook.':'Microsoft app ID saved. Add the private app credential to enable browser sign-in.'});
      }
      if(body.action==='connect-browser'){
        const c=await config();if(!c.clientId||!c.clientSecret)throw new Error('Save your Microsoft app ID and private client secret first.');
        const origin=publicOrigin(request,environment,c.webOrigin);if(new URL(request.url).origin!==origin)throw new Error('Start sign-in from the registered private HQ address.');
        const state=randomBytes(32).toString('base64url'),cookie=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),redirectUri=origin+callbackPath;
        const google=providerOf(c)==='gmail',challenge=createHash('sha256').update(verifier).digest('base64url'),url=new URL(google?GMAIL.authorize:authRoot+'authorize');
        // Google hands out a lasting sign-in only when asked for offline access with a fresh consent.
        url.search=new URLSearchParams(google?{client_id:c.clientId,response_type:'code',redirect_uri:redirectUri,scope:GMAIL.scopes,state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'}:{client_id:c.clientId,response_type:'code',redirect_uri:redirectUri,response_mode:'query',scope:scopes,state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
        await save(x=>({...x,signInError:null}));webLogin={provider:providerOf(c),clientId:c.clientId,state,cookie,verifier,redirectUri,expiresAt:clock()+900000};device=null;
        const response=json({status:'redirect',url:url.href});response.headers.set('Set-Cookie',browserCookie(cookie,900));return response;
      }
      if(body.action==='connect'){
        const c=await config();if(providerOf(c)==='gmail')throw new Error('Gmail is connected with the browser sign-in.');if(!c.clientId)throw new Error('Save your Microsoft app client ID first.');const {response,value}=await oauth('devicecode',{client_id:c.clientId,scope:scopes});
        if(!response.ok||!value.device_code||!value.user_code)throw new Error('Microsoft could not start sign-in. Check that the registered app supports personal accounts and allows public client flows.');
        device={clientId:c.clientId,code:value.device_code,expiresAt:clock()+Math.min(1800,Number(value.expires_in)||900)*1000,interval:Math.max(5,Number(value.interval)||5),nextPoll:clock()+Math.max(5,Number(value.interval)||5)*1000};
        return json({status:'pending',userCode:value.user_code,url:'https://microsoft.com/devicelogin',expiresAt:new Date(device.expiresAt).toISOString(),interval:device.interval});
      }
      if(body.action==='poll'){
        if(!device||device.expiresAt<=clock()){device=null;throw new Error('Microsoft sign-in expired. Start Connect Outlook again.');}
        if(clock()<device.nextPoll)return json({status:'pending',interval:device.interval});device.nextPoll=clock()+device.interval*1000;
        const {response,value}=await oauth('token',{client_id:device.clientId,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:device.code});
        if(value.error==='authorization_pending'||value.error==='slow_down'){if(value.error==='slow_down')device.interval+=5;return json({status:'pending',interval:device.interval});}
        if(!response.ok){device=null;throw new Error('Microsoft sign-in was not completed. Start again or review the permissions in Microsoft.');}
        const tokens=checkedToken(value);if(!tokens.refresh)throw new Error('Microsoft offline access was not granted. Reconnect to keep the private connection.');
        await graph('?'+new URLSearchParams({'$top':'1','$select':'id'}),tokens.access);await save(x=>({...x,tokens,verifiedAt:new Date(clock()).toISOString(),error:null}));device=null;return json({status:'connected',message:'Outlook reading verified. HQ has no send, delete or mail-edit permission.'});
      }
      if(body.action==='disconnect'){device=null;webLogin=null;await save(x=>({...x,tokens:null,verifiedAt:null,error:null,signInError:null}));return json({saved:true,message:'HQ mail tokens removed. Saved evidence remains. Revoke Microsoft consent in your account too if desired.'});}
      // Reading a pasted email needs no mailbox access; the text is not stored.
      if(body.action==='read-text'){if(typeof body.text!=='string'||body.text.trim().length<20)throw new Error('Paste the text of the email first.');return json({read:true,...describeReply(body.text)});}
      // Takes one reply off the list for good and remembers, for that job, that mail up to it has been dealt with. Only HQ's private list changes: the email and the job are untouched.
      if(body.action==='remove-reply'){if(!/^[a-f0-9]{24}$/.test(String(body.key||'')))throw new Error('Check for replies again before removing this one.');let scan=null,found=false;await save(x=>{const old=keyed(x.scan),gone=old?.proposals.find(p=>p.key===body.key),seenNow={...(x.repliesSeen||{})};found=!!gone;if(gone&&!(seenNow[gone.recordId]>gone.receivedAt))seenNow[gone.recordId]=gone.receivedAt;const ids=Object.keys(seenNow);for(const id of ids.slice(0,Math.max(0,ids.length-600)))delete seenNow[id];scan=old?{...old,proposals:old.proposals.filter(p=>p.key!==body.key)}:null;return {...x,repliesSeen:seenNow,scan};});if(!found)throw new Error('That reply is no longer listed. Check for replies again.');return json({saved:true,scan,message:'Removed. Mail for this job up to that message will not be listed again; the email itself and the job are unchanged.'});}
      if(body.action==='scan'){const result=await scan(body.jobs);return json({scanned:true,result,message:result.proposals.length?result.proposals.length+' repl'+(result.proposals.length===1?'y':'ies')+' from employers found in '+result.scanned+' recent messages. Read each message before confirming anything; nothing was changed.':'No message from an employer you applied to was found in '+result.scanned+' recent messages. Nothing was changed.'});}
      if(body.action==='check')return json({checked:true,result:await check(body.recordId),message:'Outlook check completed. Review any matches before attaching evidence; no application outcome was changed.'});
      if(body.action==='attach'){
        if(body.confirmEvidence!==true)throw new Error('Confirm that this message relates to this vacancy.');
        const c=await config(),result=c.checks?.find(x=>x.recordId===body.recordId),candidate=result?.candidates.find(x=>x.key===body.key);if(!candidate)throw new Error('Check Outlook for this vacancy before attaching evidence.');
        if(candidate.attached)return json({saved:true,receipt:candidate.attached,message:'This message is already saved as evidence for this job.'});
        const hash=createHash('sha256').update(body.recordId+'|'+candidate.key).digest('hex'),uuid=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
        const receipt=await applicationBridge({operation:'attach-application-evidence',recordId:body.recordId,requestId:'HQ-A-'+uuid,reference:candidate.reference,kind:candidate.kind,receivedAt:candidate.receivedAt},(await connections.settings()).SCOUT_CONFIG||{},fetcher);
        await save(x=>({...x,checks:(x.checks||[]).map(r=>r.recordId===body.recordId?{...r,candidates:r.candidates.map(v=>v.key===body.key?{...v,attached:receipt}:v)}:r)}));return json({saved:true,receipt,message:'Verified Outlook message reference saved in the database. Application status and existing evidence were preserved.'});
      }
      throw new Error('Unsupported email action.');
    }catch(error){return json({error:error.message||'Email evidence unavailable. Saved records retained.'},400);}finally{busy=false;}
  }};
}
